"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import {
  Banknote,
  CreditCard,
  QrCode,
  FileText,
  X,
  Plus,
  Calculator,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Receipt,
  Wallet,
  CalendarClock,
  Layers,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useToast } from "@/hooks/use-toast"
import { PdvVisorTotal } from "./painel-total"
import type { MaquininhaConfig } from "@/lib/centro-financeiro"
import { getMaquininhasParaPdvForStore } from "@/lib/centro-financeiro"
import { normalizeDocDigits } from "@/lib/cpf"
import { cn } from "@/lib/utils"
import { useStoreSettings } from "@/lib/store-settings-provider"
import {
  findFormaByPaymentType,
  getFormasForPaymentModal,
  getFormaPagamentoIcon,
  formaPagamentoOutlineClasses,
  toPaymentMethodType,
  type FormaPagamentoConfig,
  type FormaPagamentoConfigId,
} from "@/lib/pdv-formas-pagamento"
import {
  PIX_QR_KIND_OPCOES_OPERADOR,
  isPixQrKind,
  type PixQrKind,
} from "@/lib/fiscal/payment/pix-qr-kind"

function formatMoneyInput(value: string): string {
  const clean = value.replace(/\D/g, "")
  if (!clean) return ""
  const cents = parseInt(clean, 10)
  if (isNaN(cents)) return ""
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function parseMoneyString(value: string): number {
  const clean = value.replace(/\D/g, "")
  if (!clean) return 0
  return parseInt(clean, 10) / 100
}

/** CPF (11) ou CNPJ (14) só com dígitos. */
function documentoClienteValido(raw: string): boolean {
  const d = normalizeDocDigits(raw)
  return d.length === 11 || d.length === 14
}

export type PaymentMethodType =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "carne"
  /** À vista faturado em conta do cliente → Contas a Receber (diferente de carnê parcelado). */
  | "a_prazo"
  | "credito_vale"

export interface PaymentMethod {
  id: string
  type: PaymentMethodType
  value: number
  installments?: number
  /** Maquininha usada no caixa (cartão débito/crédito). */
  maquininhaId?: string
  maquininhaNome?: string
  /** Config de parcelamento para à prazo (parcelas, primeiro vencimento, intervalo). */
  aPrazoConfig?: { parcelas: number; primeiroVencimento: string; intervalDias: number }
}

/** Ajusta valores lançados para que a soma bata com `total` (ex.: troco em dinheiro). */
export function normalizePaymentsToMatchTotal(payments: PaymentMethod[], total: number): PaymentMethod[] {
  const sum = payments.reduce((s, p) => s + p.value, 0)
  let excess = Math.round((sum - total) * 100) / 100
  if (excess <= 0.02) return payments

  const adjusted = payments.map((p) => ({ ...p }))
  const trimFrom = (predicate: (t: PaymentMethodType) => boolean) => {
    for (let i = adjusted.length - 1; i >= 0 && excess > 0.02; i--) {
      if (!predicate(adjusted[i].type)) continue
      const take = Math.min(adjusted[i].value, excess)
      adjusted[i].value = Math.round((adjusted[i].value - take) * 100) / 100
      excess = Math.round((excess - take) * 100) / 100
    }
  }
  trimFrom((t) => t === "dinheiro")
  trimFrom((t) => t !== "dinheiro")
  return adjusted.filter((p) => p.value > 0.02)
}

interface Customer {
  id: string
  name: string
  cpf: string
  phone: string
  saldoDevedor?: number
}

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  /** Subtotal do carrinho (antes de desconto). */
  cartSubtotal: number
  /** Imposto estimado incluído no total (Configurações → Vendas). */
  impostoEstimado?: number
  total: number
  discountReais: number
  discountPercent: number
  onDiscountReaisChange: (value: number) => void
  onDiscountPercentChange: (value: number) => void
  custoPeca?: number
  selectedCustomer?: Customer | null
  /** Saldo de crédito/vale (mesmo CPF) para abatimento. */
  customerStoreCredit?: number
  /** ID local do operador do caixa (auditoria). */
  cashierId?: string
  onConfirm?: (
    payments: PaymentMethod[],
    meta?: {
      cashierId?: string
      discountAuthorizedByAdminId?: string
      discountReais?: number
      discountPercent?: number
      pixQrKind?: PixQrKind
    }
  ) => boolean | void | Promise<boolean | void>
  /** Quando definido ao abrir, adiciona automaticamente uma linha quitando o total restante com essa forma (pagamento “full” em um toque). */
  instantPayIntent?: PaymentMethodType | null
  onInstantPayIntentConsumed?: () => void
  /** Persiste CPF/CNPJ no cadastro do cliente (carnê / à prazo). */
  onCustomerCpfUpdate?: (customerId: string, cpf: string) => void
  /**
   * Modo Pagamento Múltiplo (convergência operacional): quando `true`, o modal
   * abre **sem** auto-add e foca o campo "Valor a Adicionar", exibindo um banner
   * explicando o fluxo de divisão (informe o valor parcial → escolha a forma →
   * repita até zerar). Não muda nenhuma lógica de `handleAddPayment`/array de
   * pagamentos — só descobre a UX nativa do modal para Clássico/Supermercado.
   */
  multipayHint?: boolean
  /**
   * Layout enterprise em 2 colunas + navegação por teclado (setas/Enter/Esc),
   * sem rolagem no desktop. Opt-in: ligado pelo PDV Clássico (flagship). Os demais
   * shells (Supermercado / Venda Completa / Black Edition) mantêm o layout padrão.
   */
  twoColumn?: boolean
  /**
   * Disparado quando uma forma exige cliente (à prazo / carnê) e nenhum está
   * selecionado. O shell deve abrir o seletor de cliente (`PdvClientePicker`) POR CIMA
   * do modal — sem fechá-lo, para preservar os pagamentos em andamento. Ao selecionar
   * o cliente, o shell atualiza `selectedCustomer` e o fluxo à prazo é liberado.
   */
  onRequireCustomer?: () => void
}

function PixQrKindPicker({
  pixTotal,
  value,
  onChange,
}: {
  pixTotal: number
  value: PixQrKind | null
  onChange: (next: PixQrKind | null) => void
}) {
  if (pixTotal <= 0.02) return null
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-card px-3 py-3">
      <div className="min-w-0 space-y-1">
        <Label className="text-sm font-medium text-foreground">Como o PIX foi recebido</Label>
        <p className="text-xs text-muted-foreground">
          Só para a nota fiscal. Não muda o valor. Se não souber, deixe em branco — a venda fecha e a NFC-e fica bloqueada.
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        {PIX_QR_KIND_OPCOES_OPERADOR.map((opcao) => {
          const selected = value === opcao.kind
          return (
            <button
              key={opcao.kind}
              type="button"
              onClick={() => onChange(selected ? null : opcao.kind)}
              className={cn(
                "flex w-full min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted/50",
              )}
            >
              <span className="min-w-0 text-sm font-medium">{opcao.titulo}</span>
              <span className="min-w-0 text-xs text-muted-foreground">{opcao.descricao}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PaymentModal({ 
  isOpen, 
  onClose, 
  cartSubtotal = 0,
  impostoEstimado = 0,
  total = 450.00,
  discountReais = 0,
  discountPercent = 0,
  onDiscountReaisChange,
  onDiscountPercentChange,
  custoPeca = 120.00,
  selectedCustomer,
  customerStoreCredit = 0,
  cashierId,
  onConfirm,
  instantPayIntent = null,
  onInstantPayIntentConsumed,
  onCustomerCpfUpdate,
  multipayHint = false,
  twoColumn = false,
  onRequireCustomer,
}: PaymentModalProps) {
  const { config } = useConfigEmpresa()
  const [isConfirming, setIsConfirming] = useState(false)
  const [showFinalConfirm, setShowFinalConfirm] = useState(false)
  const { pdvParams, storeId: storeIdForPdv } = useStoreSettings()
  const { toast } = useToast()
  const [payments, setPayments] = useState<PaymentMethod[]>([])
  const [pixQrKind, setPixQrKind] = useState<PixQrKind | null>(null)
  const [currentValue, setCurrentValue] = useState("")
  const [selectedType, setSelectedType] = useState<PaymentMethodType | null>(null)
  const valueInputRef = useRef<HTMLInputElement | null>(null)
  const [carneInstallments, setCarneInstallments] = useState("3")
  const [aPrazoEntradaStr, setAPrazoEntradaStr] = useState("")
  const [aPrazoEntradaType, setAPrazoEntradaType] = useState<PaymentMethodType>("dinheiro")
  const [aPrazoParcelas, setAPrazoParcelas] = useState("1")
  const [aPrazoPrimeiroVencDate, setAPrazoPrimeiroVencDate] = useState("") // YYYY-MM-DD
  const [aPrazoObs, setAPrazoObs] = useState("")
  const [showMerchantPanel, setShowMerchantPanel] = useState(false)
  const [cpfDraft, setCpfDraft] = useState("")
  const [cartaoLiberado, setCartaoLiberado] = useState(true)
  const [maquininhasAtivasPdv, setMaquininhasAtivasPdv] = useState<MaquininhaConfig[]>([])
  const [maquininhaPdvId, setMaquininhaPdvId] = useState("")
  const [adminSessionOk, setAdminSessionOk] = useState(false)
  const [authorizedAdmin, setAuthorizedAdmin] = useState<{ id: string; name: string } | null>(null)
  const [supervisorPin, setSupervisorPin] = useState("")
  const [supervisorBusy, setSupervisorBusy] = useState(false)
  const [supervisorErr, setSupervisorErr] = useState<string | null>(null)
  const [highlightedFormaId, setHighlightedFormaId] = useState<FormaPagamentoConfigId | null>(null)
  const formaBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const finalCancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const finalConfirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const finalConfirmBusyRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      setCpfDraft("")
      setIsConfirming(false)
      finalConfirmBusyRef.current = false
      return
    }
    setCpfDraft(selectedCustomer?.cpf?.trim() ?? "")
  }, [isOpen, selectedCustomer?.id, selectedCustomer?.cpf])

  const cpfEfetivo = cpfDraft.trim() || selectedCustomer?.cpf?.trim() || ""

  const formasPagamento = pdvParams.formasPagamento ?? []
  const formasModal = useMemo(() => {
    const list = getFormasForPaymentModal(formasPagamento)
    // Pagamento Múltiplo permite combinar qualquer forma "permitirNoMultiplo" + À Prazo:
    // o saldo à prazo vira Conta a Receber (não entra no caixa) via o card de configuração.
    return multipayHint ? list.filter((f) => f.permitirNoMultiplo || f.id === "a_prazo") : list
  }, [formasPagamento, multipayHint])

  const resolveFormaForType = useCallback(
    (type: PaymentMethodType, preferId?: FormaPagamentoConfigId) =>
      findFormaByPaymentType(formasPagamento, type, preferId),
    [formasPagamento],
  )

  const guardFormaRules = useCallback(
    (forma: FormaPagamentoConfig | undefined, type: PaymentMethodType): boolean => {
      const exigirCliente =
        forma?.exigirCliente ??
        (type === "a_prazo" || type === "carne")
      if (exigirCliente && !selectedCustomer) {
        // Em vez de só barrar, pede ao shell para abrir o seletor de cliente
        // (com cadastro rápido). O modal permanece aberto e o carrinho intacto.
        onRequireCustomer?.()
        toast({
          title: "Selecione o cliente",
          description:
            type === "a_prazo"
              ? "Abrindo a busca de cliente para liberar a venda a prazo."
              : "Abrindo a busca de cliente para esta forma de pagamento.",
        })
        return false
      }
      const exigirCpf = forma?.exigirCpf ?? (type === "a_prazo" || type === "carne")
      if (exigirCpf && selectedCustomer && !documentoClienteValido(cpfEfetivo)) {
        toast({
          variant: "destructive",
          title: "CPF/CNPJ obrigatório",
          description: "Informe e salve o CPF ou CNPJ do cliente para carnê, boleto ou faturamento à prazo.",
        })
        return false
      }
      if (forma?.exigirAutorizacao && !adminSessionOk) {
        toast({
          variant: "destructive",
          title: "Autorização necessária",
          description: "Informe a senha do supervisor para usar esta forma de pagamento.",
        })
        return false
      }
      return true
    },
    [adminSessionOk, cpfEfetivo, selectedCustomer, toast, onRequireCustomer],
  )
  const fluxoPrazoOuCarne =
    !!selectedCustomer &&
    (selectedType === "carne" ||
      selectedType === "a_prazo" ||
      payments.some((p) => p.type === "carne" || p.type === "a_prazo"))
  const exibirCapturaCpf = fluxoPrazoOuCarne && !documentoClienteValido(cpfEfetivo)
  const docInvalidoParaConfirmar =
    payments.some((p) => p.type === "carne" || p.type === "a_prazo") && !documentoClienteValido(cpfEfetivo)

  const totalPaid = payments.reduce((sum, p) => sum + p.value, 0)
  const pixTotal = payments.reduce((sum, p) => (p.type === "pix" ? sum + p.value : sum), 0)
  const faltaPagar = Math.max(0, total - totalPaid)
  const temDinheiro = payments.some((p) => p.type === "dinheiro")
  const troco =
    temDinheiro && totalPaid > total + 0.009 ? Math.round((totalPaid - total) * 100) / 100 : 0
  const dinheiroRecebido = selectedType === "dinheiro" ? parseMoneyString(currentValue) : 0
  const trocoEstimado =
    selectedType === "dinheiro" && !multipayHint && dinheiroRecebido > faltaPagar + 0.009
      ? Math.round((dinheiroRecebido - faltaPagar) * 100) / 100
      : 0

  const descontoManualAtivo = useMemo(() => {
    const r = Number(discountReais) || 0
    const p = Number(discountPercent) || 0
    return r > 0.009 || p > 0.009
  }, [discountPercent, discountReais])

  /** Habilita o botão Confirmar (twoColumn): só quando o pagamento pode realmente ser fechado. */
  const podeConfirmar =
    !isConfirming &&
    faltaPagar <= 0.02 &&
    !docInvalidoParaConfirmar &&
    !(descontoManualAtivo && !adminSessionOk)

  const handlePaymentConfirmIntent = useCallback(() => {
    if (isConfirming || showFinalConfirm || finalConfirmBusyRef.current) return
    if (docInvalidoParaConfirmar) {
      toast({
        variant: "destructive",
        title: "CPF/CNPJ obrigatório",
        description: "Complete e salve o documento do cliente para carnê ou faturamento à prazo.",
      })
      return
    }
    if (descontoManualAtivo && !adminSessionOk) {
      toast({
        variant: "destructive",
        title: "Supervisor obrigatório",
        description: "Autorize o desconto manual para confirmar a venda.",
      })
      return
    }
    setShowFinalConfirm(true)
  }, [adminSessionOk, descontoManualAtivo, docInvalidoParaConfirmar, isConfirming, showFinalConfirm, toast])

  const handleMainDialogKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (showFinalConfirm || isConfirming) return

      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isTextEntry =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true ||
        target?.getAttribute("role") === "combobox"

      if (e.key === "Enter") {
        if (isTextEntry) return
        if (target instanceof HTMLButtonElement && target !== confirmBtnRef.current) return
        if (!podeConfirmar) return
        e.preventDefault()
        handlePaymentConfirmIntent()
        return
      }

      if (isTextEntry) return
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      if (tag !== "BUTTON" && target !== confirmBtnRef.current && target !== cancelBtnRef.current) return

      e.preventDefault()
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        cancelBtnRef.current?.focus()
      } else {
        confirmBtnRef.current?.focus()
      }
    },
    [handlePaymentConfirmIntent, isConfirming, podeConfirmar, showFinalConfirm],
  )

  const returnFocusToPaymentConfirm = useCallback(() => {
    window.requestAnimationFrame(() => {
      confirmBtnRef.current?.focus()
    })
  }, [])

  const handleFinalDialogOpenChange = useCallback(
    (open: boolean) => {
      setShowFinalConfirm(open)
      if (!open && !finalConfirmBusyRef.current) {
        returnFocusToPaymentConfirm()
      }
    },
    [returnFocusToPaymentConfirm],
  )

  const handleFinalDialogKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isConfirming) return
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      finalCancelBtnRef.current?.focus()
      return
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      finalConfirmBtnRef.current?.focus()
    }
  }, [isConfirming])

  const handleFinalConfirm = useCallback(() => {
    if (finalConfirmBusyRef.current || isConfirming) return
    finalConfirmBusyRef.current = true
    setShowFinalConfirm(false)
    setIsConfirming(true)
    setTimeout(() => {
      void (async () => {
        try {
          const normalized = normalizePaymentsToMatchTotal(payments, total)
          const adminIdForAudit = descontoManualAtivo ? (authorizedAdmin?.id || undefined) : undefined
          const success = await onConfirm?.(normalized, {
            cashierId,
            discountAuthorizedByAdminId: descontoManualAtivo ? adminIdForAudit : undefined,
            discountReais: Number(discountReais) || 0,
            discountPercent: Number(discountPercent) || 0,
            ...(pixTotal > 0.02 && isPixQrKind(pixQrKind) ? { pixQrKind } : {}),
          })
          if (success === false) {
            finalConfirmBusyRef.current = false
            setIsConfirming(false)
            returnFocusToPaymentConfirm()
            return
          }
          onClose()
        } catch (err) {
          finalConfirmBusyRef.current = false
          setIsConfirming(false)
          toast({
            variant: "destructive",
            title: "Erro ao confirmar",
            description: err instanceof Error ? err.message : "Erro desconhecido",
          })
        }
      })()
    }, 50)
  }, [isConfirming, payments, total, pixTotal, pixQrKind, descontoManualAtivo, authorizedAdmin, onConfirm, cashierId, discountReais, discountPercent, onClose, returnFocusToPaymentConfirm, toast])

  // ── Computações à prazo ──────────────────────────────────────────────────────
  const aPrazoBundleTotal = Math.min(
    parseMoneyString(currentValue) > 0 ? parseMoneyString(currentValue) : faltaPagar,
    faltaPagar,
  )
  const aPrazoEntradaVal = Math.max(0, Math.min(parseMoneyString(aPrazoEntradaStr), aPrazoBundleTotal - 0.01))
  const aPrazoSaldoVal = Math.round((aPrazoBundleTotal - aPrazoEntradaVal) * 100) / 100
  const aPrazoParcelasN = Math.max(1, parseInt(aPrazoParcelas, 10) || 1)
  const aPrazoParcelaBase = Math.round((aPrazoSaldoVal / aPrazoParcelasN) * 100) / 100

  useEffect(() => {
    if (!isOpen) return
    const pdv = getMaquininhasParaPdvForStore(storeIdForPdv)
    setCartaoLiberado(true)
    setMaquininhasAtivasPdv(pdv)
    setMaquininhaPdvId((prev) => {
      if (pdv.length === 0) return ""
      if (prev && pdv.some((m) => m.id === prev)) return prev
      return pdv[0]!.id
    })
  }, [isOpen, storeIdForPdv])
  const lucro = total - custoPeca
  const margemLucro = ((lucro / total) * 100).toFixed(1)

  useEffect(() => {
    if (!isOpen) {
      setShowFinalConfirm(false)
      setPayments([])
      setPixQrKind(null)
      setCurrentValue("")
      setSelectedType(null)
      setSupervisorPin("")
      setSupervisorErr(null)
      setSupervisorBusy(false)
      setAuthorizedAdmin(null)
      setAPrazoEntradaStr("")
      setAPrazoEntradaType("dinheiro")
      setAPrazoParcelas("1")
      setAPrazoPrimeiroVencDate("")
      setAPrazoObs("")
    }
  }, [isOpen])

  useEffect(() => {
    if (pixTotal <= 0.02 && pixQrKind !== null) setPixQrKind(null)
  }, [pixTotal, pixQrKind])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch("/api/auth/admin", { method: "GET", credentials: "include", cache: "no-store" })
        const j = (await r.json().catch(() => null)) as { authenticated?: boolean; admin?: { id?: string; name?: string } }
        if (!r.ok || !j) return
        if (cancelled) return
        const ok = j?.authenticated === true
        setAdminSessionOk(ok)
        setAuthorizedAdmin(ok && j?.admin?.id ? { id: String(j.admin.id), name: String(j.admin.name || "Admin") } : null)
      } catch {
        // falha transiente: manter estado anterior para evitar “fim de sessão” falso
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const handleAddPayment = useCallback(
    (type: PaymentMethodType, preferFormaId?: FormaPagamentoConfigId) => {
      const forma = resolveFormaForType(type, preferFormaId)
      if (!guardFormaRules(forma, type)) return
      if (type === "a_prazo" && !selectedCustomer) {
        onRequireCustomer?.()
        toast({ title: "Selecione o cliente", description: "Abrindo a busca de cliente para a venda a prazo." })
        return
      }
      if ((type === "a_prazo" || type === "carne") && selectedCustomer && !documentoClienteValido(cpfEfetivo)) {
        toast({
          variant: "destructive",
          title: "CPF/CNPJ obrigatório",
          description: "Informe e salve o CPF ou CNPJ do cliente para carnê, boleto ou faturamento à prazo.",
        })
        return
      }
      if (type === "carne" && !selectedCustomer) {
        toast({
          variant: "destructive",
          title: "Cliente obrigatório",
          description: "Selecione o cliente para emitir carnê ou boleto parcelado.",
        })
        return
      }
      setPayments((prev) => {
        const paid = prev.reduce((s, p) => s + p.value, 0)
        const rem = Math.max(0, total - paid)
        if (rem <= 0.009) return prev

        let max = rem
        if (type === "credito_vale") {
          max = Math.min(rem, Math.max(0, customerStoreCredit))
        }
        const parsed = parseMoneyString(currentValue)
        const parsedOk = Number.isFinite(parsed) && parsed > 0
        const base = parsedOk ? parsed : max
        let value = type === "dinheiro" ? base : Math.min(base, max)
        const permitirTroco = forma?.permitirTroco ?? type === "dinheiro"
        if (type === "dinheiro" && !permitirTroco) {
          value = Math.min(value, rem)
        }
        if (value <= 0) return prev

        const maq =
          type === "cartao_debito" || type === "cartao_credito"
            ? maquininhasAtivasPdv.find((m) => m.id === maquininhaPdvId) ?? maquininhasAtivasPdv[0]
            : undefined

    const newPayment: PaymentMethod = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
          value,
          installments: type === "carne" ? parseInt(carneInstallments, 10) || 1 : undefined,
          ...(maq ? { maquininhaId: maq.id, maquininhaNome: maq.nome } : {}),
    }
        return [...prev, newPayment]
      })
    setCurrentValue("")
    setSelectedType(null)
    },
    [
      carneInstallments,
      currentValue,
      customerStoreCredit,
      guardFormaRules,
      maquininhaPdvId,
      maquininhasAtivasPdv,
      resolveFormaForType,
      selectedCustomer,
      cpfEfetivo,
      toast,
      total,
      onRequireCustomer,
    ]
  )

  useEffect(() => {
    if (!isOpen || !instantPayIntent) return
    // Modo Pagamento Múltiplo tem precedência: não auto-adicionar nenhuma forma,
    // mesmo que um intent residual chegue junto. O foco será para o campo de valor.
    if (multipayHint) {
      onInstantPayIntentConsumed?.()
      return
    }
    const t = instantPayIntent
    const tid = window.setTimeout(() => {
      try {
        if (t === "carne" || t === "a_prazo") {
          /** Carnê / à prazo: abre o fluxo de configuração. */
          setSelectedType(t)
          // Sem cliente, pede o seletor (com cadastro rápido) já na abertura —
          // o card de configuração fica pronto para quando o cliente for escolhido.
          if (!selectedCustomer) onRequireCustomer?.()
        } else {
          handleAddPayment(t)
        }
      } finally {
        onInstantPayIntentConsumed?.()
      }
    }, 0)
    return () => window.clearTimeout(tid)
  }, [handleAddPayment, instantPayIntent, isOpen, multipayHint, onInstantPayIntentConsumed, selectedCustomer, onRequireCustomer])

  // Modo múltiplo: ao abrir, foca o campo "Valor a Adicionar" para sinalizar o fluxo
  // (digite o valor parcial → escolha a forma → repita). Banner explica visualmente.
  useEffect(() => {
    if (!isOpen || !multipayHint) return
    const tid = window.setTimeout(() => {
      try {
        valueInputRef.current?.focus()
        valueInputRef.current?.select()
      } catch {
        /* ignore */
      }
    }, 60)
    return () => window.clearTimeout(tid)
  }, [isOpen, multipayHint])

  const handleRemovePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id))
  }

  const handleQuickValue = (value: number) => {
    setCurrentValue(formatMoneyInput((value * 100).toFixed(0)))
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const gerarParcelasCarne = (valorTotal: number, qtd: number) => {
    const baseDate = new Date()
    return Array.from({ length: qtd }, (_, i) => {
      const venc = new Date(baseDate)
      venc.setMonth(venc.getMonth() + i + 1)
      return {
        numero: i + 1,
        valor: valorTotal / qtd,
        vencimento: venc.toLocaleDateString("pt-BR"),
      }
    })
  }

  const handleGerarBoletoCarne = () => {
    const valorTotal = parseMoneyString(currentValue) || faltaPagar
    const qtd = Math.max(1, parseInt(carneInstallments || "1", 10))
    const parcelas = gerarParcelasCarne(valorTotal, qtd)
    const empresa = config.empresa
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Carnê — parcelamento</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px">
        <h2>Carnê de parcelamento</h2>
        <p><strong>CNPJ:</strong> ${empresa.cnpj}</p>
        <p><strong>Cliente:</strong> ${selectedCustomer?.name || "Consumidor"} | <strong>CPF:</strong> ${selectedCustomer?.cpf || "-"}</p>
        <p><strong>Valor Total:</strong> ${formatCurrency(valorTotal)}</p>
        <hr />
        ${parcelas
          .map(
            (p) =>
              `<p><strong>${p.numero}/${qtd}</strong> - Valor: ${formatCurrency(p.valor)} | Vencimento: ${p.vencimento}</p>`
          )
          .join("")}
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  const handleConfirmarAPrazo = useCallback(() => {
    if (!selectedCustomer) {
      toast.error("⚠️ Selecione um cliente para venda à prazo.")
      return
    }
    if (!documentoClienteValido(cpfEfetivo)) {
      toast({ variant: "destructive", title: "CPF/CNPJ obrigatório", description: "Informe e salve o documento do cliente para faturamento à prazo." })
      return
    }
    if (aPrazoSaldoVal <= 0.009) {
      toast({ variant: "destructive", title: "Saldo inválido", description: "O saldo a prazo deve ser maior que zero." })
      return
    }

    const primeiroVenc = aPrazoPrimeiroVencDate
      ? (() => { const [y, m, d] = aPrazoPrimeiroVencDate.split("-"); return `${d}/${m}/${y}` })()
      : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toLocaleDateString("pt-BR") })()

    const toAdd: PaymentMethod[] = []
    if (aPrazoEntradaVal > 0.009) {
      toAdd.push({
        id: `${Date.now()}-entrada`,
        type: aPrazoEntradaType,
        value: aPrazoEntradaVal,
      })
    }
    toAdd.push({
      id: `${Date.now()}-aprazo`,
      type: "a_prazo",
      value: aPrazoSaldoVal,
      aPrazoConfig: {
        parcelas: aPrazoParcelasN,
        primeiroVencimento: primeiroVenc,
        intervalDias: 30,
        ...(aPrazoObs.trim() ? { observacao: aPrazoObs.trim() } : {}),
      },
    })

    setPayments((prev) => [...prev, ...toAdd])
    setCurrentValue("")
    setSelectedType(null)
    setAPrazoEntradaStr("")
  }, [
    selectedCustomer,
    cpfEfetivo,
    aPrazoSaldoVal,
    aPrazoEntradaVal,
    aPrazoEntradaType,
    aPrazoParcelasN,
    aPrazoPrimeiroVencDate,
    aPrazoObs,
    toast,
  ])

  /** Forma "à prazo" está configurada/ativa? (controla a sugestão de saldo restante). */
  const aPrazoFormaAtiva = useMemo(
    () => formasModal.some((f) => f.id === "a_prazo"),
    [formasModal],
  )

  /**
   * Exigência RafaCell: ao pagar um valor parcial (ex.: R$ 22 de R$ 39,90), sugerir
   * lançar o saldo restante (R$ 17,90) como Conta a Receber em 1 toque — sem o
   * operador calcular. Abre o card "Configurar À Prazo" já com o saldo = falta a pagar.
   * Sem cliente, pede o seletor (preserva carrinho e pagamentos já lançados).
   */
  const sugerirSaldoAPrazo = useCallback(() => {
    if (faltaPagar <= 0.02) return
    if (!selectedCustomer) {
      onRequireCustomer?.()
      toast({ title: "Selecione o cliente", description: "Abrindo a busca de cliente para lançar o saldo a prazo." })
      return
    }
    setCurrentValue("")
    setAPrazoEntradaStr("")
    setSelectedType("a_prazo")
    if (!aPrazoPrimeiroVencDate) {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      setAPrazoPrimeiroVencDate(d.toISOString().split("T")[0])
    }
  }, [faltaPagar, selectedCustomer, onRequireCustomer, aPrazoPrimeiroVencDate, toast])

  /** Lista enriquecida (runtime + ícone + disabled + tooltip): fonte única do grid clássico e da lista enterprise. */
  const formaRuntimeList = useMemo(() => {
    return formasModal.flatMap((forma) => {
      const runtime = toPaymentMethodType(forma.id)
      if (!runtime) return []
      const Icon = getFormaPagamentoIcon(forma.icon)
      const isCartao = runtime === "cartao_debito" || runtime === "cartao_credito"
      // Formas que exigem cliente NÃO ficam desabilitadas sem cliente: o clique abre
      // o seletor de cliente (com cadastro rápido) via onRequireCustomer.
      const disabled =
        (isCartao && !cartaoLiberado) ||
        (runtime === "credito_vale" && customerStoreCredit <= 0) ||
        (forma.exigirAutorizacao && !adminSessionOk)
      const title =
        isCartao && !cartaoLiberado
          ? "Ative pelo menos uma maquininha em Configurações → Financeiro (cartões)"
          : runtime === "a_prazo" && !selectedCustomer
            ? "Selecione/cadastre o cliente para liberar venda à prazo"
            : runtime === "carne" && !selectedCustomer
              ? "Selecione/cadastre o cliente para carnê ou boleto"
              : forma.exigirAutorizacao && !adminSessionOk
                ? "Exige autorização do supervisor"
                : runtime === "a_prazo"
                  ? "Configura parcelas e vencimento — gera título em Contas a Receber"
                  : undefined
      return [{ forma, runtime, Icon, disabled, title }]
    })
  }, [formasModal, cartaoLiberado, customerStoreCredit, selectedCustomer, adminSessionOk])

  const enabledFormaList = useMemo(
    () => formaRuntimeList.filter((f) => !f.disabled),
    [formaRuntimeList],
  )

  /** Aplica a forma escolhida (clique ou Enter). Mesma regra do botão do grid clássico. */
  const activateForma = useCallback(
    (forma: FormaPagamentoConfig, runtime: PaymentMethodType) => {
      if (!guardFormaRules(forma, runtime)) return
      if (runtime === "a_prazo") {
        setSelectedType("a_prazo")
        if (!aPrazoPrimeiroVencDate) {
          const d = new Date()
          d.setDate(d.getDate() + 30)
          setAPrazoPrimeiroVencDate(d.toISOString().split("T")[0])
        }
        return
      }
      if (runtime === "carne") {
        setSelectedType("carne")
        return
      }
      if (runtime === "dinheiro" && !multipayHint) {
        setSelectedType("dinheiro")
        return
      }
      setSelectedType(runtime)
      handleAddPayment(runtime, forma.id)
    },
    [guardFormaRules, aPrazoPrimeiroVencDate, multipayHint, handleAddPayment],
  )

  /** Navegação por setas na lista de formas (layout enterprise / twoColumn). */
  const handlePaymentListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const navKeys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]
      if (!navKeys.includes(e.key)) return
      if (enabledFormaList.length === 0) return
      e.preventDefault()
      const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1
      const curIdx = enabledFormaList.findIndex((f) => f.forma.id === highlightedFormaId)
      const baseIdx = curIdx < 0 ? (dir > 0 ? -1 : 0) : curIdx
      const nextIdx = (baseIdx + dir + enabledFormaList.length) % enabledFormaList.length
      const next = enabledFormaList[nextIdx]
      if (!next) return
      setHighlightedFormaId(next.forma.id)
      formaBtnRefs.current[next.forma.id]?.focus()
    },
    [enabledFormaList, highlightedFormaId],
  )

  // Layout enterprise: ao escolher Dinheiro, foca o campo de valor para digitar e ver o troco.
  useEffect(() => {
    if (!isOpen || !twoColumn || multipayHint) return
    if (selectedType !== "dinheiro") return
    const t = window.setTimeout(() => {
      valueInputRef.current?.focus()
      valueInputRef.current?.select()
    }, 30)
    return () => window.clearTimeout(t)
  }, [isOpen, twoColumn, multipayHint, selectedType])

  // Layout enterprise: quando o total fica quitado, foca "Confirmar" para finalizar com Enter.
  useEffect(() => {
    if (!isOpen || !twoColumn) return
    if (payments.length === 0 || !podeConfirmar) return
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 40)
    return () => window.clearTimeout(t)
  }, [isOpen, twoColumn, payments.length, podeConfirmar])

  const getPaymentIcon = (type: string) => {
    switch (type) {
      case "dinheiro": return <Banknote className="w-4 h-4" />
      case "pix": return <QrCode className="w-4 h-4" />
      case "cartao_debito": return <CreditCard className="w-4 h-4" />
      case "cartao_credito": return <CreditCard className="w-4 h-4" />
      case "carne": return <FileText className="w-4 h-4" />
      case "a_prazo": return <CalendarClock className="w-4 h-4" />
      case "credito_vale": return <Wallet className="w-4 h-4" />
      default: return null
    }
  }

  const getPaymentLabel = (payment: PaymentMethod) => {
    const nomeMaq = payment.maquininhaNome ? ` — ${payment.maquininhaNome}` : ""
    switch (payment.type) {
      case "dinheiro":
        return "Dinheiro"
      case "pix":
        return "Pix"
      case "cartao_debito":
        return `Cartão débito${nomeMaq}`
      case "cartao_credito":
        return `Cartão crédito${nomeMaq}`
      case "carne":
        return "Carnê"
      case "a_prazo":
        return payment.aPrazoConfig && payment.aPrazoConfig.parcelas > 1
          ? `À prazo ${payment.aPrazoConfig.parcelas}x`
          : "À prazo"
      case "credito_vale":
        return "Crédito/Vale"
      default:
        return payment.type
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Layout ENTERPRISE (twoColumn) — PDV Clássico (flagship).
  // 2 colunas, sem rolagem no desktop, navegação por teclado (setas/Enter/Esc).
  // Os demais shells caem no `return` padrão (single-column) logo abaixo.
  // ════════════════════════════════════════════════════════════════════════
  if (twoColumn) {
    return (
      <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <DialogContent
          onOpenAutoFocus={
            multipayHint
              ? undefined
              : (e) => {
                  // Ao abrir: 1ª forma útil selecionada e pronta para Enter.
                  e.preventDefault()
                  const first = enabledFormaList[0]
                  if (first) {
                    setHighlightedFormaId(first.forma.id)
                    requestAnimationFrame(() => formaBtnRefs.current[first.forma.id]?.focus())
                  }
                }
          }
          onEscapeKeyDown={(e) => {
            // Esc volta uma etapa (sai do sub-fluxo) antes de fechar o modal.
            if (selectedType) {
              e.preventDefault()
              setSelectedType(null)
              requestAnimationFrame(() => {
                if (highlightedFormaId) formaBtnRefs.current[highlightedFormaId]?.focus()
              })
            }
          }}
          onKeyDown={handleMainDialogKeyDown}
          className="w-[94vw] max-w-[1000px] sm:max-w-[1000px] max-h-[95vh] flex flex-col p-0 overflow-hidden bg-card border-border"
        >
          <DialogHeader className="px-5 py-2.5 border-b border-border shrink-0">
            <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
              <Calculator className="w-6 h-6 text-primary" />
              Finalizar Pagamento
            </DialogTitle>
            <p className="text-[11px] text-muted-foreground">
              Setas escolhem a forma · Enter confirma a seleção · Esc volta uma etapa
            </p>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[45fr_55fr]">
            {/* ── Coluna esquerda: financeiro ── */}
            <div className="min-w-0 space-y-3 p-4 lg:border-r lg:border-border">
              <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatCurrency(cartSubtotal)}</span>
                </div>
                {impostoEstimado > 0.009 ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Imposto estimado</span>
                    <span className="font-medium">{formatCurrency(impostoEstimado)}</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Desconto (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={discountReais || ""}
                      onChange={(e) => onDiscountReaisChange(parseFloat(e.target.value) || 0)}
                      className="h-10 bg-secondary border-border"
                      placeholder="0,00"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Desconto (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      value={discountPercent || ""}
                      onChange={(e) => onDiscountPercentChange(parseFloat(e.target.value) || 0)}
                      className="h-10 bg-secondary border-border"
                      placeholder="0"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  O percentual incide sobre o subtotal; o valor em R$ soma ao desconto (limitado ao subtotal).
                </p>
              </div>

              <PdvVisorTotal
                label="Total a pagar"
                valorFormatado={formatCurrency(total)}
                glow="none"
                className="bg-primary/5 border border-primary/25 rounded-xl py-2.5 text-center [&_p]:text-2xl [&_p]:font-bold"
              />

              {faltaPagar > 0 && (
                <div className="space-y-3">
                  <Label className="text-sm text-muted-foreground">
                    {selectedType === "dinheiro" && !multipayHint ? "Cliente entregou" : "Valor a adicionar"}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground select-none">R$</span>
                    <Input
                      ref={valueInputRef}
                      type="text"
                      inputMode="numeric"
                      placeholder={faltaPagar.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      value={currentValue}
                      onChange={(e) => setCurrentValue(formatMoneyInput(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return
                        e.preventDefault()
                        if (selectedType === "dinheiro" && !multipayHint) {
                          handleAddPayment("dinheiro")
                          return
                        }
                        const hi = formaRuntimeList.find((f) => f.forma.id === highlightedFormaId && !f.disabled)
                        if (hi) activateForma(hi.forma, hi.runtime)
                      }}
                      className="pl-12 h-12 text-lg font-semibold bg-secondary border-border"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleQuickValue(50)} className="border-border hover:bg-primary hover:text-primary-foreground">R$ 50</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickValue(100)} className="border-border hover:bg-primary hover:text-primary-foreground">R$ 100</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickValue(200)} className="border-border hover:bg-primary hover:text-primary-foreground">R$ 200</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickValue(faltaPagar)} className="border-border hover:bg-primary hover:text-primary-foreground">{selectedType === "dinheiro" && !multipayHint ? "Exato" : "Restante"}</Button>
                  </div>

                  {selectedType === "dinheiro" && !multipayHint && (
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Total a cobrar</span>
                        <span className="font-semibold tabular-nums">{formatCurrency(faltaPagar)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Recebido em dinheiro</span>
                        <span className="font-semibold tabular-nums">
                          {dinheiroRecebido > 0 ? formatCurrency(dinheiroRecebido) : <span className="text-muted-foreground/50">—</span>}
                        </span>
                      </div>
                      {trocoEstimado > 0 && (
                        <div className="flex justify-between items-center font-bold border-t border-emerald-500/30 pt-2 text-emerald-700 dark:text-emerald-300">
                          <span>Troco a dar</span>
                          <span className="tabular-nums text-lg">{formatCurrency(trocoEstimado)}</span>
                        </div>
                      )}
                      <Button
                        type="button"
                        className="w-full mt-1 h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                        onClick={() => handleAddPayment("dinheiro")}
                      >
                        {dinheiroRecebido > 0 ? "Confirmar Dinheiro" : "Confirmar valor exato"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {descontoManualAtivo && !adminSessionOk ? (
                <div className="rounded-xl border-2 border-amber-500/35 bg-amber-500/10 px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-200">
                    Desconto manual exige supervisor
                  </p>
                  <p className="mt-1 text-xs text-foreground/80 dark:text-white/70">
                    Para confirmar a venda com desconto, informe a <strong>Senha do Supervisor</strong>.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Senha do Supervisor</Label>
                      <Input
                        type="password"
                        value={supervisorPin}
                        onChange={(e) => setSupervisorPin(e.target.value)}
                        className="h-11 bg-background"
                        placeholder="PIN"
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={supervisorBusy || supervisorPin.trim().length === 0}
                      onClick={async () => {
                        setSupervisorErr(null)
                        setSupervisorBusy(true)
                        try {
                          const r = await fetch("/api/auth/admin", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ pin: supervisorPin.trim() }),
                          })
                          if (!r.ok) {
                            setSupervisorErr("Senha inválida.")
                            setAdminSessionOk(false)
                            setAuthorizedAdmin(null)
                            return
                          }
                          const j = (await r.json().catch(() => null)) as { admin?: { id?: string; name?: string } }
                          setAdminSessionOk(true)
                          setAuthorizedAdmin(j?.admin?.id ? { id: String(j.admin.id), name: String(j.admin.name || "Admin") } : { id: "admin", name: "Admin" })
                          setSupervisorPin("")
                        } catch {
                          setSupervisorErr("Falha ao validar senha.")
                          setAdminSessionOk(false)
                          setAuthorizedAdmin(null)
                        } finally {
                          setSupervisorBusy(false)
                        }
                      }}
                    >
                      Autorizar
                    </Button>
                  </div>
                  {supervisorErr ? <p className="mt-2 text-xs text-destructive">{supervisorErr}</p> : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <button
                  onClick={() => setShowMerchantPanel(!showMerchantPanel)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showMerchantPanel ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showMerchantPanel ? "Ocultar informações do lojista" : "Ver informações do lojista"}
                </button>
                {showMerchantPanel && (
                  <Card className="bg-muted/30 border-dashed border-muted">
                    <CardContent className="pt-4 pb-4">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Custo da Peça</p>
                          <p className="font-semibold text-foreground">{formatCurrency(custoPeca)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Lucro da Operação</p>
                          <p className="font-semibold text-green-500">{formatCurrency(lucro)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Margem</p>
                          <p className="font-semibold text-primary">{margemLucro}%</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* ── Coluna direita: pagamento ── */}
            <div className="min-w-0 space-y-3 p-4">
              {multipayHint && faltaPagar > 0.009 && (
                <div className="rounded-xl border-2 border-violet-500/40 bg-violet-500/10 px-4 py-3 dark:bg-violet-500/15">
                  <div className="flex items-start gap-3">
                    <Layers className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-violet-800 dark:text-violet-100">Pagamento Múltiplo</p>
                      <p className="text-xs text-violet-900/80 dark:text-violet-100/80">
                        Informe o valor parcial ao lado e escolha a forma. Repita até zerar o restante.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {exibirCapturaCpf && selectedCustomer && (
                <Card className="border-amber-500/50 bg-amber-500/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-amber-950 dark:text-amber-100">
                      CPF ou CNPJ obrigatório (carnê / à prazo)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Cliente <strong>{selectedCustomer.name}</strong> não possui documento válido. Informe o CPF (11 dígitos) ou CNPJ (14 dígitos).
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1">
                        <Label>CPF ou CNPJ</Label>
                        <Input
                          className="h-11 bg-background"
                          placeholder="Somente números"
                          value={cpfDraft}
                          onChange={(e) => setCpfDraft(e.target.value)}
                          inputMode="numeric"
                          autoComplete="off"
                        />
                      </div>
                      <Button
                        type="button"
                        className="shrink-0"
                        disabled={!documentoClienteValido(cpfDraft)}
                        onClick={() => {
                          const d = normalizeDocDigits(cpfDraft)
                          if (!selectedCustomer || !documentoClienteValido(d)) return
                          onCustomerCpfUpdate?.(selectedCustomer.id, d)
                          toast({ title: "Documento salvo", description: "CPF/CNPJ atualizado no cadastro do cliente." })
                        }}
                      >
                        Salvar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {faltaPagar > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm text-muted-foreground">Forma de pagamento</Label>
                    <span className="text-[11px] text-muted-foreground">↑↓ navega · Enter seleciona</span>
                  </div>
                  {selectedCustomer && customerStoreCredit > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Crédito em haver disponível: <span className="text-primary font-medium">{formatCurrency(customerStoreCredit)}</span>
                    </p>
                  )}
                  {maquininhasAtivasPdv.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Taxas de cartão não configuradas — venda registrada sem abatimento de taxa.
                    </p>
                  )}
                  {cartaoLiberado && maquininhasAtivasPdv.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Maquininha (nome no caixa)</Label>
                      <Select value={maquininhaPdvId} onValueChange={setMaquininhaPdvId}>
                        <SelectTrigger className="h-10 bg-secondary border-border">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {maquininhasAtivasPdv.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div
                    role="group"
                    aria-label="Formas de pagamento"
                    onKeyDown={handlePaymentListKeyDown}
                    className="flex flex-col gap-1.5"
                  >
                    {formaRuntimeList.map(({ forma, runtime, Icon, disabled, title }) => {
                      const isSelected = selectedType === runtime
                      const isHighlighted = highlightedFormaId === forma.id
                      return (
                        <button
                          key={forma.id}
                          ref={(el) => {
                            formaBtnRefs.current[forma.id] = el
                          }}
                          type="button"
                          disabled={disabled}
                          title={title}
                          onFocus={() => setHighlightedFormaId(forma.id)}
                          onClick={() => activateForma(forma, runtime)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border-2 px-3.5 py-2 text-left text-sm font-semibold text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                            formaPagamentoOutlineClasses(forma.cor, isSelected),
                            isHighlighted && !disabled && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="min-w-0 flex-1">{forma.label}</span>
                          {isSelected ? (
                            <Check className="h-4 w-4 shrink-0 text-primary" />
                          ) : isHighlighted && !disabled ? (
                            <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {payments.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <Card className="bg-green-500/10 border-green-500/30">
                    <CardContent className="pt-3 pb-3">
                      <p className="text-xs text-green-400 uppercase mb-1">Pago</p>
                      <p className="text-xl font-bold text-green-500">{formatCurrency(totalPaid)}</p>
                    </CardContent>
                  </Card>
                  <Card
                    className={
                      faltaPagar > 0.009
                        ? "border-amber-500/30 bg-amber-500/10"
                        : troco > 0
                          ? "border-emerald-500/35 bg-emerald-500/10"
                          : "border-green-500/30 bg-green-500/10"
                    }
                  >
                    <CardContent className="pt-3 pb-3">
                      <p className={`mb-1 text-xs uppercase ${faltaPagar > 0.009 ? "text-amber-400" : troco > 0 ? "text-emerald-400" : "text-green-400"}`}>
                        {faltaPagar > 0.009 ? "Restante" : troco > 0 ? "Troco" : "Completo"}
                      </p>
                      <p className={`text-xl font-bold ${faltaPagar > 0.009 ? "text-amber-500" : troco > 0 ? "text-emerald-500" : "text-green-500"}`}>
                        {formatCurrency(faltaPagar > 0.009 ? faltaPagar : troco > 0 ? troco : 0)}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {payments.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Formas adicionadas</Label>
                  <div className="flex flex-wrap gap-2">
                    {payments.map((payment) => (
                      <Badge key={payment.id} variant="secondary" className="px-3 py-2 text-sm flex items-center gap-2 bg-secondary">
                        {getPaymentIcon(payment.type)}
                        {getPaymentLabel(payment)}
                        {payment.installments && ` ${payment.installments}x`}
                        : {formatCurrency(payment.value)}
                        <button onClick={() => handleRemovePayment(payment.id)} className="ml-1 hover:text-primary transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <PixQrKindPicker pixTotal={pixTotal} value={pixQrKind} onChange={setPixQrKind} />

              {aPrazoFormaAtiva && faltaPagar > 0.02 && selectedType !== "a_prazo" && selectedType !== "carne" && (
                <button
                  type="button"
                  onClick={sugerirSaldoAPrazo}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-violet-500/45 bg-violet-500/10 px-4 py-3 text-left transition-colors hover:bg-violet-500/15"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <CalendarClock className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-violet-800 dark:text-violet-100">
                        Lançar {formatCurrency(faltaPagar)} restante À Prazo
                      </span>
                      <span className="block text-[11px] text-violet-900/70 dark:text-violet-100/70">
                        Gera Conta a Receber do saldo — não entra no caixa
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                </button>
              )}

              {selectedType === "a_prazo" && faltaPagar > 0 && (
                <Card className="border-violet-500/50 bg-violet-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CalendarClock className="w-5 h-5 text-violet-500" />
                      Configurar À Prazo
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Total à prazo</Label>
                        <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                          <span className="font-semibold">{formatCurrency(aPrazoBundleTotal)}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Parcelas do saldo</Label>
                        <Select value={aPrazoParcelas} onValueChange={setAPrazoParcelas}>
                          <SelectTrigger className="bg-secondary border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                              <SelectItem key={n} value={n.toString()}>
                                {n}x de {formatCurrency(Math.round((aPrazoSaldoVal / n) * 100) / 100)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">Entrada (opcional)</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground select-none">R$</span>
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder="0,00"
                            value={aPrazoEntradaStr}
                            onChange={(e) => setAPrazoEntradaStr(formatMoneyInput(e.target.value))}
                            className="pl-12 h-10 bg-secondary border-border"
                          />
                        </div>
                        <Select value={aPrazoEntradaType} onValueChange={(v) => setAPrazoEntradaType(v as PaymentMethodType)}>
                          <SelectTrigger className="w-32 bg-secondary border-border shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dinheiro">Dinheiro</SelectItem>
                            <SelectItem value="pix">Pix</SelectItem>
                            <SelectItem value="cartao_debito">Débito</SelectItem>
                            <SelectItem value="cartao_credito">Crédito</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Primeiro vencimento</Label>
                        <Input
                          type="date"
                          value={aPrazoPrimeiroVencDate}
                          onChange={(e) => setAPrazoPrimeiroVencDate(e.target.value)}
                          className="h-10 bg-secondary border-border"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Saldo financiado</Label>
                        <div className="h-10 px-3 flex items-center bg-violet-500/10 rounded-md border border-violet-500/30">
                          <span className="font-bold text-violet-700 dark:text-violet-300">{formatCurrency(aPrazoSaldoVal)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">Observação (opcional)</Label>
                      <Input
                        type="text"
                        placeholder="Ex.: combinado pagar dia 10"
                        value={aPrazoObs}
                        onChange={(e) => setAPrazoObs(e.target.value)}
                        className="h-10 bg-secondary border-border"
                      />
                    </div>

                    {aPrazoSaldoVal > 0.009 && aPrazoPrimeiroVencDate && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {Array.from({ length: aPrazoParcelasN }, (_, i) => {
                          const [y, m, d] = aPrazoPrimeiroVencDate.split("-")
                          const vd = new Date(Number(y), Number(m) - 1, Number(d))
                          vd.setDate(vd.getDate() + i * 30)
                          const valorP =
                            i === aPrazoParcelasN - 1
                              ? Math.round((aPrazoSaldoVal - aPrazoParcelaBase * (aPrazoParcelasN - 1)) * 100) / 100
                              : aPrazoParcelaBase
                          return (
                            <p key={i + 1}>
                              {i + 1}/{aPrazoParcelasN} — {formatCurrency(valorP)} — vence em {vd.toLocaleDateString("pt-BR")}
                            </p>
                          )
                        })}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {aPrazoEntradaVal > 0.009 && (
                        <Badge className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15">
                          Entrada {formatCurrency(aPrazoEntradaVal)}
                        </Badge>
                      )}
                      <Badge className="bg-violet-500/15 border border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/15">
                        Financiado {formatCurrency(aPrazoSaldoVal)}{aPrazoParcelasN > 1 ? ` em ${aPrazoParcelasN}x` : ""}
                      </Badge>
                    </div>

                    <Button
                      className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold"
                      disabled={aPrazoSaldoVal <= 0.009 || !documentoClienteValido(cpfEfetivo)}
                      onClick={handleConfirmarAPrazo}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Confirmar À Prazo{aPrazoParcelasN > 1 ? ` ${aPrazoParcelasN}x` : ""}
                    </Button>
                    {!documentoClienteValido(cpfEfetivo) && (
                      <p className="text-xs text-destructive text-center">
                        Informe e salve o CPF/CNPJ do cliente para continuar.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {selectedType === "carne" && faltaPagar > 0 && (
                <Card className="border-primary bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-5 h-5 text-primary" />
                      Configurar Carnê
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Parcelas</Label>
                        <Select value={carneInstallments} onValueChange={setCarneInstallments}>
                          <SelectTrigger className="bg-secondary border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                              <SelectItem key={n} value={n.toString()}>
                                {n}x de {formatCurrency((parseMoneyString(currentValue) || faltaPagar) / n)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Valor Total Carnê</Label>
                        <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                          <span className="font-semibold">{formatCurrency(parseMoneyString(currentValue) || faltaPagar)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={() => handleAddPayment("carne")}>
                        <Plus className="w-4 h-4 mr-2" />
                        Adicionar Carnê {carneInstallments}x
                      </Button>
                      <Button
                        variant="outline"
                        className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                        onClick={handleGerarBoletoCarne}
                      >
                        <Receipt className="w-4 h-4 mr-2" />
                        Gerar Boleto/Carnê
                      </Button>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {gerarParcelasCarne(parseMoneyString(currentValue) || faltaPagar, parseInt(carneInstallments || "1", 10)).map((p) => (
                        <p key={p.numero}>{p.numero}/{carneInstallments} - {formatCurrency(p.valor)} - vence em {p.vencimento}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* ── Rodapé fixo ── */}
          <div className="px-5 py-2.5 border-t border-border bg-card shrink-0">
            {faltaPagar > 0.02 && payments.length > 0 && (
              <p className="mb-2 text-center text-[11px] text-muted-foreground">
                Falta <span className="font-bold text-amber-500">{formatCurrency(faltaPagar)}</span> para concluir
              </p>
            )}
            <div className="flex gap-3">
              <Button ref={cancelBtnRef} type="button" variant="outline" onClick={onClose} className="flex-1 h-11 border-border">
                Cancelar
              </Button>
              <Button
                ref={confirmBtnRef}
                type="button"
                onClick={handlePaymentConfirmIntent}
                disabled={!podeConfirmar}
                className={cn(
                  "flex-1 h-11 font-bold transition-colors",
                  podeConfirmar
                    ? "bg-emerald-600 text-zinc-950 hover:bg-emerald-500"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isConfirming
                  ? "Processando..."
                  : faltaPagar > 0.02
                    ? `Falta ${formatCurrency(faltaPagar)}`
                    : docInvalidoParaConfirmar
                      ? "Informe o CPF/CNPJ"
                      : "Confirmar Pagamento"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showFinalConfirm} onOpenChange={handleFinalDialogOpenChange}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            finalConfirmBtnRef.current?.focus()
          }}
          onEscapeKeyDown={(e) => {
            if (isConfirming) {
              e.preventDefault()
              return
            }
            e.preventDefault()
            handleFinalDialogOpenChange(false)
          }}
          onKeyDown={handleFinalDialogKeyDown}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar venda?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirme para registrar esta venda. A operação não poderá ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={finalCancelBtnRef} disabled={isConfirming}>Não, voltar</AlertDialogCancel>
            <AlertDialogAction
              ref={finalConfirmBtnRef}
              disabled={isConfirming}
              className="bg-emerald-600 text-zinc-950 hover:bg-emerald-500"
              onClick={(e) => {
                if (finalConfirmBusyRef.current || isConfirming) {
                  e.preventDefault()
                  return
                }
                handleFinalConfirm()
              }}
            >
              Sim, finalizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
    )
  }

  return (
    <>
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        onKeyDown={handleMainDialogKeyDown}
        className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-card border-border"
      >
        <DialogHeader className="p-6 pb-2 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            Finalizar Pagamento
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatCurrency(cartSubtotal)}</span>
            </div>
            {impostoEstimado > 0.009 ? (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Imposto estimado</span>
                <span className="font-medium">{formatCurrency(impostoEstimado)}</span>
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Desconto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={discountReais || ""}
                  onChange={(e) => onDiscountReaisChange(parseFloat(e.target.value) || 0)}
                  className="h-10 bg-secondary border-border"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Desconto (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={discountPercent || ""}
                  onChange={(e) => onDiscountPercentChange(parseFloat(e.target.value) || 0)}
                  className="h-10 bg-secondary border-border"
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O percentual incide sobre o subtotal; o valor em R$ soma ao desconto (limitado ao subtotal).
            </p>
          </div>

          {/* Total em Destaque - Visível para o Cliente */}
          <PdvVisorTotal
            label="Total a pagar"
            valorFormatado={formatCurrency(total)}
            glow="none"
            className="bg-primary/5 border border-primary/25 rounded-2xl py-4 text-center [&_p]:text-2xl [&_p]:font-bold"
          />

          {/* Banner Modo Pagamento Múltiplo (convergência operacional) */}
          {multipayHint && faltaPagar > 0.009 && (
            <div className="rounded-xl border-2 border-violet-500/40 bg-violet-500/10 px-4 py-3 dark:bg-violet-500/15">
              <div className="flex items-start gap-3">
                <Layers className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-violet-800 dark:text-violet-100">
                    Pagamento Múltiplo
                  </p>
                  <p className="text-xs text-violet-900/80 dark:text-violet-100/80">
                    Informe o valor parcial no campo abaixo e escolha a forma de pagamento.
                    Repita até zerar o restante. Para pagar tudo de uma forma, deixe o valor em branco.
                  </p>
                </div>
              </div>
            </div>
          )}

          {exibirCapturaCpf && selectedCustomer && (
            <Card className="border-amber-500/50 bg-amber-500/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-amber-950 dark:text-amber-100">
                  CPF ou CNPJ obrigatório (carnê / à prazo)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Cliente <strong>{selectedCustomer.name}</strong> não possui documento válido. Informe o CPF (11 dígitos) ou
                  CNPJ (14 dígitos) para continuar.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-1">
                    <Label>CPF ou CNPJ</Label>
                    <Input
                      className="h-11 bg-background"
                      placeholder="Somente números"
                      value={cpfDraft}
                      onChange={(e) => setCpfDraft(e.target.value)}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    className="shrink-0"
                    disabled={!documentoClienteValido(cpfDraft)}
                    onClick={() => {
                      const d = normalizeDocDigits(cpfDraft)
                      if (!selectedCustomer || !documentoClienteValido(d)) return
                      onCustomerCpfUpdate?.(selectedCustomer.id, d)
                      toast({ title: "Documento salvo", description: "CPF/CNPJ atualizado no cadastro do cliente." })
                    }}
                  >
                    Salvar no cadastro
                  </Button>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Status de Pagamento */}
          {payments.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-green-500/10 border-green-500/30">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-green-400 uppercase mb-1">Pago</p>
                  <p className="text-2xl font-bold text-green-500">{formatCurrency(totalPaid)}</p>
                </CardContent>
              </Card>
              <Card
                className={
                  faltaPagar > 0.009
                    ? "border-amber-500/30 bg-amber-500/10"
                    : troco > 0
                      ? "border-emerald-500/35 bg-emerald-500/10"
                      : "border-green-500/30 bg-green-500/10"
                }
              >
                <CardContent className="pt-4 pb-4">
                  <p
                    className={`mb-1 text-xs uppercase ${
                      faltaPagar > 0.009 ? "text-amber-400" : troco > 0 ? "text-emerald-400" : "text-green-400"
                    }`}
                  >
                    {faltaPagar > 0.009 ? "Restante" : troco > 0 ? "Troco" : "Completo"}
                  </p>
                  <p
                    className={`text-2xl font-bold ${
                      faltaPagar > 0.009 ? "text-amber-500" : troco > 0 ? "text-emerald-500" : "text-green-500"
                    }`}
                  >
                    {formatCurrency(faltaPagar > 0.009 ? faltaPagar : troco > 0 ? troco : 0)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Pagamentos Adicionados */}
          {payments.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Formas de Pagamento Adicionadas</Label>
              <div className="flex flex-wrap gap-2">
                {payments.map((payment) => (
                  <Badge 
                    key={payment.id} 
                    variant="secondary" 
                    className="px-3 py-2 text-sm flex items-center gap-2 bg-secondary"
                  >
                    {getPaymentIcon(payment.type)}
                    {getPaymentLabel(payment)}
                    {payment.installments && ` ${payment.installments}x`}
                    : {formatCurrency(payment.value)}
                    <button
                      onClick={() => handleRemovePayment(payment.id)}
                      className="ml-1 hover:text-primary transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <PixQrKindPicker pixTotal={pixTotal} value={pixQrKind} onChange={setPixQrKind} />

          {/* Input de Valor */}
          {faltaPagar > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">{selectedType === "dinheiro" && !multipayHint ? "Cliente entregou" : "Valor a Adicionar"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground select-none">R$</span>
                  <Input
                    ref={valueInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder={faltaPagar.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    value={currentValue}
                    onChange={(e) => setCurrentValue(formatMoneyInput(e.target.value))}
                    className="pl-12 h-12 text-lg font-semibold bg-secondary border-border"
                  />
                </div>
              </div>
              
              {/* Valores Rápidos */}
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(50)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 50
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(100)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 100
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(200)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 200
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickValue(faltaPagar)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  {selectedType === "dinheiro" && !multipayHint ? "Exato" : "Restante"}
                </Button>
              </div>

              {/* Troco automático — aparece ao selecionar Dinheiro (fluxo dois passos) */}
              {selectedType === "dinheiro" && !multipayHint && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Total a cobrar</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(faltaPagar)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Recebido em dinheiro</span>
                    <span className="font-semibold tabular-nums">
                      {dinheiroRecebido > 0 ? formatCurrency(dinheiroRecebido) : <span className="text-muted-foreground/50">—</span>}
                    </span>
                  </div>
                  {trocoEstimado > 0 && (
                    <div className="flex justify-between items-center font-bold border-t border-emerald-500/30 pt-2 text-emerald-700 dark:text-emerald-300">
                      <span>Troco a dar</span>
                      <span className="tabular-nums text-lg">{formatCurrency(trocoEstimado)}</span>
                    </div>
                  )}
                  <Button
                    type="button"
                    className="w-full mt-1 h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                    onClick={() => handleAddPayment("dinheiro")}
                  >
                    {dinheiroRecebido > 0
                      ? `Confirmar Dinheiro${trocoEstimado > 0 ? ` · Troco ${formatCurrency(trocoEstimado)}` : ""}`
                      : "Confirmar valor exato"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Botões de Forma de Pagamento */}
          {faltaPagar > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Escolha a Forma de Pagamento</Label>
              {selectedCustomer && customerStoreCredit > 0 && (
                <p className="text-xs text-muted-foreground">
                  Crédito em haver disponível: <span className="text-primary font-medium">{formatCurrency(customerStoreCredit)}</span>
                </p>
              )}
              {maquininhasAtivasPdv.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Taxas de cartão não configuradas — venda será registrada sem abatimento de taxa.
                </p>
              )}
              {cartaoLiberado && maquininhasAtivasPdv.length > 1 && (
                <div className="space-y-2 max-w-md">
                  <Label className="text-xs text-muted-foreground">Maquininha (nome no caixa)</Label>
                  <Select value={maquininhaPdvId} onValueChange={setMaquininhaPdvId}>
                    <SelectTrigger className="h-11 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {maquininhasAtivasPdv.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {formasModal.map((forma) => {
                  const runtime = toPaymentMethodType(forma.id)
                  if (!runtime) return null
                  const Icon = getFormaPagamentoIcon(forma.icon)
                  const isSelected = selectedType === runtime
                  const isCartao = runtime === "cartao_debito" || runtime === "cartao_credito"
                  // Sem cliente, à prazo/carnê continuam clicáveis: o clique abre o
                  // seletor de cliente (com cadastro rápido) via onRequireCustomer.
                  const disabled =
                    (isCartao && !cartaoLiberado) ||
                    (runtime === "credito_vale" && customerStoreCredit <= 0) ||
                    (forma.exigirAutorizacao && !adminSessionOk)
                  const title =
                    isCartao && !cartaoLiberado
                      ? "Ative pelo menos uma maquininha em Configurações → Financeiro (cartões)"
                      : runtime === "a_prazo" && !selectedCustomer
                        ? "Selecione/cadastre o cliente para liberar venda à prazo"
                        : runtime === "carne" && !selectedCustomer
                          ? "Selecione/cadastre o cliente para carnê ou boleto"
                          : forma.exigirAutorizacao && !adminSessionOk
                            ? "Exige autorização do supervisor"
                            : runtime === "a_prazo"
                              ? "Configura parcelas e vencimento — gera título em Contas a Receber"
                              : undefined

                  return (
                    <button
                      key={forma.id}
                      type="button"
                      disabled={disabled}
                      title={title}
                      onClick={() => {
                        if (!guardFormaRules(forma, runtime)) return
                        if (runtime === "a_prazo") {
                          setSelectedType("a_prazo")
                          if (!aPrazoPrimeiroVencDate) {
                            const d = new Date()
                            d.setDate(d.getDate() + 30)
                            setAPrazoPrimeiroVencDate(d.toISOString().split("T")[0])
                          }
                          return
                        }
                        if (runtime === "carne") {
                          setSelectedType("carne")
                          return
                        }
                        if (runtime === "dinheiro" && !multipayHint) {
                          setSelectedType("dinheiro")
                          return
                        }
                        setSelectedType(runtime)
                        handleAddPayment(runtime, forma.id)
                      }}
                      className={cn(
                        "h-[4.5rem] flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 text-xs font-semibold text-foreground bg-background hover:bg-muted/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                        formaPagamentoOutlineClasses(forma.cor, isSelected),
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="leading-none text-center">{forma.shortLabel}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Sugestão de saldo restante → À Prazo (1 toque) */}
          {aPrazoFormaAtiva && faltaPagar > 0.02 && selectedType !== "a_prazo" && selectedType !== "carne" && (
            <button
              type="button"
              onClick={sugerirSaldoAPrazo}
              className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-violet-500/45 bg-violet-500/10 px-4 py-3 text-left transition-colors hover:bg-violet-500/15"
            >
              <span className="flex min-w-0 items-center gap-2">
                <CalendarClock className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-violet-800 dark:text-violet-100">
                    Lançar {formatCurrency(faltaPagar)} restante À Prazo
                  </span>
                  <span className="block text-[11px] text-violet-900/70 dark:text-violet-100/70">
                    Gera Conta a Receber do saldo — não entra no caixa
                  </span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
            </button>
          )}

          {/* Módulo À Prazo */}
          {selectedType === "a_prazo" && faltaPagar > 0 && (
            <Card className="border-violet-500/50 bg-violet-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-violet-500" />
                  Configurar À Prazo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Total à prazo</Label>
                    <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                      <span className="font-semibold">{formatCurrency(aPrazoBundleTotal)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Parcelas do saldo</Label>
                    <Select value={aPrazoParcelas} onValueChange={setAPrazoParcelas}>
                      <SelectTrigger className="bg-secondary border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n}x de {formatCurrency(Math.round((aPrazoSaldoVal / n) * 100) / 100)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Entrada (opcional)</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground select-none">R$</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="0,00"
                        value={aPrazoEntradaStr}
                        onChange={(e) => setAPrazoEntradaStr(formatMoneyInput(e.target.value))}
                        className="pl-12 h-10 bg-secondary border-border"
                      />
                    </div>
                    <Select value={aPrazoEntradaType} onValueChange={(v) => setAPrazoEntradaType(v as PaymentMethodType)}>
                      <SelectTrigger className="w-32 bg-secondary border-border shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="pix">Pix</SelectItem>
                        <SelectItem value="cartao_debito">Débito</SelectItem>
                        <SelectItem value="cartao_credito">Crédito</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Primeiro vencimento</Label>
                    <Input
                      type="date"
                      value={aPrazoPrimeiroVencDate}
                      onChange={(e) => setAPrazoPrimeiroVencDate(e.target.value)}
                      className="h-10 bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Saldo financiado</Label>
                    <div className="h-10 px-3 flex items-center bg-violet-500/10 rounded-md border border-violet-500/30">
                      <span className="font-bold text-violet-700 dark:text-violet-300">{formatCurrency(aPrazoSaldoVal)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Observação (opcional)</Label>
                  <Input
                    type="text"
                    placeholder="Ex.: combinado pagar dia 10"
                    value={aPrazoObs}
                    onChange={(e) => setAPrazoObs(e.target.value)}
                    className="h-10 bg-secondary border-border"
                  />
                </div>

                {aPrazoSaldoVal > 0.009 && aPrazoPrimeiroVencDate && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {Array.from({ length: aPrazoParcelasN }, (_, i) => {
                      const [y, m, d] = aPrazoPrimeiroVencDate.split("-")
                      const vd = new Date(Number(y), Number(m) - 1, Number(d))
                      vd.setDate(vd.getDate() + i * 30)
                      const valorP = i === aPrazoParcelasN - 1
                        ? Math.round((aPrazoSaldoVal - aPrazoParcelaBase * (aPrazoParcelasN - 1)) * 100) / 100
                        : aPrazoParcelaBase
                      return (
                        <p key={i + 1}>
                          {i + 1}/{aPrazoParcelasN} — {formatCurrency(valorP)} — vence em{" "}
                          {vd.toLocaleDateString("pt-BR")}
                        </p>
                      )
                    })}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {aPrazoEntradaVal > 0.009 && (
                    <Badge className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15">
                      Entrada {formatCurrency(aPrazoEntradaVal)}
                    </Badge>
                  )}
                  <Badge className="bg-violet-500/15 border border-violet-500/40 text-violet-700 dark:text-violet-300 hover:bg-violet-500/15">
                    Financiado {formatCurrency(aPrazoSaldoVal)}{aPrazoParcelasN > 1 ? ` em ${aPrazoParcelasN}x` : ""}
                  </Badge>
                </div>

                <Button
                  className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold"
                  disabled={aPrazoSaldoVal <= 0.009 || !documentoClienteValido(cpfEfetivo)}
                  onClick={handleConfirmarAPrazo}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Confirmar À Prazo{aPrazoParcelasN > 1 ? ` ${aPrazoParcelasN}x` : ""}
                </Button>
                {!documentoClienteValido(cpfEfetivo) && (
                  <p className="text-xs text-destructive text-center">
                    Informe e salve o CPF/CNPJ do cliente para continuar.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Módulo Carnê */}
          {selectedType === "carne" && faltaPagar > 0 && (
            <Card className="border-primary bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Configurar Carnê
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Parcelas</Label>
                    <Select value={carneInstallments} onValueChange={setCarneInstallments}>
                      <SelectTrigger className="bg-secondary border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n}x de {formatCurrency((parseMoneyString(currentValue) || faltaPagar) / n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Valor Total Carnê</Label>
                    <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                      <span className="font-semibold">{formatCurrency(parseMoneyString(currentValue) || faltaPagar)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-primary hover:bg-primary/90"
                    onClick={() => handleAddPayment("carne")}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Carnê {carneInstallments}x
                  </Button>
                  <Button
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={handleGerarBoletoCarne}
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Gerar Boleto/Carnê
                  </Button>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {gerarParcelasCarne(parseMoneyString(currentValue) || faltaPagar, parseInt(carneInstallments || "1", 10)).map((p) => (
                    <p key={p.numero}>{p.numero}/{carneInstallments} - {formatCurrency(p.valor)} - vence em {p.vencimento}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Separator className="bg-border" />

          {/* Painel do Lojista (Discreto) */}
          <div className="space-y-2">
            <button
              onClick={() => setShowMerchantPanel(!showMerchantPanel)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showMerchantPanel ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showMerchantPanel ? "Ocultar informações do lojista" : "Ver informações do lojista"}
            </button>
            
            {showMerchantPanel && (
              <Card className="bg-muted/30 border-dashed border-muted">
                <CardContent className="pt-4 pb-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Custo da Peça</p>
                      <p className="font-semibold text-foreground">{formatCurrency(custoPeca)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Lucro da Operação</p>
                      <p className="font-semibold text-green-500">{formatCurrency(lucro)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Margem</p>
                      <p className="font-semibold text-primary">{margemLucro}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Separator className="bg-border" />

          {descontoManualAtivo && !adminSessionOk ? (
            <div className="rounded-xl border-2 border-amber-500/35 bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-200">
                Desconto manual exige supervisor
              </p>
              <p className="mt-1 text-xs text-foreground/80 dark:text-white/70">
                Para confirmar a venda com desconto, informe a <strong>Senha do Supervisor</strong>.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Senha do Supervisor</Label>
                  <Input
                    type="password"
                    value={supervisorPin}
                    onChange={(e) => setSupervisorPin(e.target.value)}
                    className="h-11 bg-background"
                    placeholder="PIN"
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={supervisorBusy || supervisorPin.trim().length === 0}
                  onClick={async () => {
                    setSupervisorErr(null)
                    setSupervisorBusy(true)
                    try {
                      const r = await fetch("/api/auth/admin", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ pin: supervisorPin.trim() }),
                      })
                      if (!r.ok) {
                        setSupervisorErr("Senha inválida.")
                        setAdminSessionOk(false)
                        setAuthorizedAdmin(null)
                        return
                      }
                      const j = (await r.json().catch(() => null)) as { admin?: { id?: string; name?: string } }
                      setAdminSessionOk(true)
                      setAuthorizedAdmin(j?.admin?.id ? { id: String(j.admin.id), name: String(j.admin.name || "Admin") } : { id: "admin", name: "Admin" })
                      setSupervisorPin("")
                    } catch {
                      setSupervisorErr("Falha ao validar senha.")
                      setAdminSessionOk(false)
                      setAuthorizedAdmin(null)
                    } finally {
                      setSupervisorBusy(false)
                    }
                  }}
                >
                  Autorizar
                </Button>
              </div>
              {supervisorErr ? <p className="mt-2 text-xs text-destructive">{supervisorErr}</p> : null}
            </div>
          ) : null}

        </div>

        <div className="p-6 border-t border-border bg-card shrink-0">
          {/* Botões de Ação */}
          <div className="flex gap-3">
            <Button
              ref={cancelBtnRef}
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12 border-border"
            >
              Cancelar
            </Button>
            <Button
              ref={confirmBtnRef}
              type="button"
              onClick={handlePaymentConfirmIntent}
              disabled={!podeConfirmar}
              className="flex-1 h-12 bg-emerald-600 font-bold text-zinc-950 hover:bg-emerald-500 disabled:opacity-50"
            >
              {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isConfirming
                ? "Processando..."
                : faltaPagar > 0.02
                  ? `Falta ${formatCurrency(faltaPagar)}`
                  : docInvalidoParaConfirmar
                    ? "Informe o CPF/CNPJ"
                    : "Confirmar Pagamento"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={showFinalConfirm} onOpenChange={handleFinalDialogOpenChange}>
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          finalConfirmBtnRef.current?.focus()
        }}
        onEscapeKeyDown={(e) => {
          if (isConfirming) {
            e.preventDefault()
            return
          }
          e.preventDefault()
          handleFinalDialogOpenChange(false)
        }}
        onKeyDown={handleFinalDialogKeyDown}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Finalizar venda?</AlertDialogTitle>
          <AlertDialogDescription>
            Confirme para registrar esta venda. A operação não poderá ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={finalCancelBtnRef} disabled={isConfirming}>Não, voltar</AlertDialogCancel>
          <AlertDialogAction
            ref={finalConfirmBtnRef}
            disabled={isConfirming}
            className="bg-emerald-600 text-zinc-950 hover:bg-emerald-500"
            onClick={(e) => {
              if (finalConfirmBusyRef.current || isConfirming) {
                e.preventDefault()
                return
              }
              handleFinalConfirm()
            }}
          >
            Sim, finalizar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
