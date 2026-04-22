"use client"

import { useState, useEffect, useCallback } from "react"
import { 
  Banknote, 
  CreditCard, 
  QrCode, 
  FileText, 
  Printer, 
  FileCheck, 
  X,
  Plus,
  Minus,
  Calculator,
  Eye,
  EyeOff,
  Receipt,
  Wallet,
  CalendarClock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import type { MaquininhaConfig } from "@/lib/rafacell-centro-financeiro"
import { getMaquininhasParaPdvForStore } from "@/lib/rafacell-centro-financeiro"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { normalizeDocDigits } from "@/lib/cpf"
import { cn } from "@/lib/utils"

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
  total: number
  discountReais: number
  discountPercent: number
  onDiscountReaisChange: (value: number) => void
  onDiscountPercentChange: (value: number) => void
  custoPeca?: number
  selectedCustomer?: Customer | null
  /** Saldo de crédito/vale (mesmo CPF) para abatimento. */
  customerStoreCredit?: number
  onConfirm?: (payments: PaymentMethod[]) => void
  /** Quando definido ao abrir, adiciona automaticamente uma linha quitando o total restante com essa forma (pagamento “full” em um toque). */
  instantPayIntent?: PaymentMethodType | null
  onInstantPayIntentConsumed?: () => void
  /** Persiste CPF/CNPJ no cadastro do cliente (carnê / à prazo). */
  onCustomerCpfUpdate?: (customerId: string, cpf: string) => void
}

export function PaymentModal({ 
  isOpen, 
  onClose, 
  cartSubtotal = 0,
  total = 450.00,
  discountReais = 0,
  discountPercent = 0,
  onDiscountReaisChange,
  onDiscountPercentChange,
  custoPeca = 120.00,
  selectedCustomer,
  customerStoreCredit = 0,
  onConfirm,
  instantPayIntent = null,
  onInstantPayIntentConsumed,
  onCustomerCpfUpdate,
}: PaymentModalProps) {
  const { config } = useConfigEmpresa()
  const { lojaAtivaId } = useLojaAtiva()
  const storeIdForPdv = (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID
  const { toast } = useToast()
  const [payments, setPayments] = useState<PaymentMethod[]>([])
  const [currentValue, setCurrentValue] = useState("")
  const [selectedType, setSelectedType] = useState<PaymentMethodType | null>(null)
  const [carneInstallments, setCarneInstallments] = useState("3")
  const [showMerchantPanel, setShowMerchantPanel] = useState(false)
  const [cpfDraft, setCpfDraft] = useState("")
  const [cartaoLiberado, setCartaoLiberado] = useState(true)
  const [maquininhasAtivasPdv, setMaquininhasAtivasPdv] = useState<MaquininhaConfig[]>([])
  const [maquininhaPdvId, setMaquininhaPdvId] = useState("")

  useEffect(() => {
    if (!isOpen) {
      setCpfDraft("")
      return
    }
    setCpfDraft(selectedCustomer?.cpf?.trim() ?? "")
  }, [isOpen, selectedCustomer?.id, selectedCustomer?.cpf])

  const cpfEfetivo = cpfDraft.trim() || selectedCustomer?.cpf?.trim() || ""
  const fluxoPrazoOuCarne =
    !!selectedCustomer &&
    (selectedType === "carne" ||
      selectedType === "a_prazo" ||
      payments.some((p) => p.type === "carne" || p.type === "a_prazo"))
  const exibirCapturaCpf = fluxoPrazoOuCarne && !documentoClienteValido(cpfEfetivo)
  const docInvalidoParaConfirmar =
    payments.some((p) => p.type === "carne" || p.type === "a_prazo") && !documentoClienteValido(cpfEfetivo)

  const totalPaid = payments.reduce((sum, p) => sum + p.value, 0)
  const remaining = Math.max(0, total - totalPaid)
  useEffect(() => {
    if (!isOpen) return
    const pdv = getMaquininhasParaPdvForStore(storeIdForPdv)
    setCartaoLiberado(pdv.length > 0)
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
      setPayments([])
      setCurrentValue("")
      setSelectedType(null)
    }
  }, [isOpen])

  const handleAddPayment = useCallback(
    (type: PaymentMethodType) => {
      if (type === "a_prazo" && !selectedCustomer) {
        toast({
          variant: "destructive",
          title: "Cliente obrigatório",
          description: "Selecione o cliente (com identificação) para lançar à prazo em Contas a Receber.",
        })
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
      if ((type === "cartao_debito" || type === "cartao_credito") && !cartaoLiberado) {
        toast({
          variant: "destructive",
          title: "Cartão indisponível",
          description: "Ative uma maquininha em Configurações → Financeiro (cartões).",
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
        const raw = currentValue.replace(",", ".").trim()
        const parsed = parseFloat(raw)
        const value = Number.isFinite(parsed) && parsed > 0 ? parsed : max
        if (value <= 0) return prev

        const maq =
          type === "cartao_debito" || type === "cartao_credito"
            ? maquininhasAtivasPdv.find((m) => m.id === maquininhaPdvId) ?? maquininhasAtivasPdv[0]
            : undefined

        const newPayment: PaymentMethod = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type,
          value: Math.min(value, max),
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
      cartaoLiberado,
      currentValue,
      customerStoreCredit,
      maquininhaPdvId,
      maquininhasAtivasPdv,
      selectedCustomer,
      cpfEfetivo,
      toast,
      total,
    ]
  )

  useEffect(() => {
    if (!isOpen || !instantPayIntent) return
    const t = instantPayIntent
    const tid = window.setTimeout(() => {
      try {
        if (t === "carne") {
          /** Carnê: abre o fluxo de parcelamento (não lança valor automaticamente). */
          setSelectedType("carne")
        } else {
          handleAddPayment(t)
        }
      } finally {
        onInstantPayIntentConsumed?.()
      }
    }, 0)
    return () => window.clearTimeout(tid)
  }, [handleAddPayment, instantPayIntent, isOpen, onInstantPayIntentConsumed])

  const handleRemovePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id))
  }

  const handleQuickValue = (value: number) => {
    setCurrentValue(value.toString())
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
    const valorTotal = parseFloat(currentValue) || remaining
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
        return "À prazo"
      case "credito_vale":
        return "Crédito/Vale"
      default:
        return payment.type
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto bg-card border-border">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            Finalizar Pagamento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatCurrency(cartSubtotal)}</span>
            </div>
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
          <Card className="bg-secondary border-2 border-primary">
            <CardContent className="pt-6 pb-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">Total a Pagar</p>
                <p className="text-5xl font-bold text-primary">{formatCurrency(total)}</p>
              </div>
            </CardContent>
          </Card>

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
              <Card className={`${remaining > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                <CardContent className="pt-4 pb-4">
                  <p className={`text-xs uppercase mb-1 ${remaining > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {remaining > 0 ? 'Restante' : 'Completo'}
                  </p>
                  <p className={`text-2xl font-bold ${remaining > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                    {formatCurrency(remaining)}
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

          {/* Input de Valor */}
          {remaining > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Valor a Adicionar</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    placeholder={remaining.toFixed(2)}
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                    className="pl-10 h-12 text-lg font-semibold bg-secondary border-border"
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
                  onClick={() => handleQuickValue(remaining)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  Total Restante
                </Button>
              </div>
            </div>
          )}

          {/* Botões de Forma de Pagamento */}
          {remaining > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Escolha a Forma de Pagamento</Label>
              {selectedCustomer && customerStoreCredit > 0 && (
                <p className="text-xs text-muted-foreground">
                  Crédito em haver disponível: <span className="text-primary font-medium">{formatCurrency(customerStoreCredit)}</span>
                </p>
              )}
              {!cartaoLiberado && (
                <p className="text-xs text-amber-600/90">
                  Cartão débito/crédito: ative uma maquininha em{" "}
                  <strong>Configurações → Financeiro (cartões)</strong> (aba Taxas de cartão).
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setSelectedType("dinheiro")
                    handleAddPayment("dinheiro")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "dinheiro"
                      ? "border-emerald-500 bg-emerald-500/10 dark:border-emerald-400/70 dark:bg-emerald-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-emerald-400/45"
                  )}
                >
                  <Banknote className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span>Dinheiro</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setSelectedType("pix")
                    handleAddPayment("pix")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "pix"
                      ? "border-teal-500 bg-teal-500/10 dark:border-teal-400/70 dark:bg-teal-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-teal-400/45"
                  )}
                >
                  <QrCode className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  <span>Pix</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!cartaoLiberado}
                  title={
                    !cartaoLiberado
                      ? "Ative pelo menos uma maquininha em Configurações → Financeiro (cartões)"
                      : undefined
                  }
                  onClick={() => {
                    setSelectedType("cartao_debito")
                    handleAddPayment("cartao_debito")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "cartao_debito"
                      ? "border-slate-500 bg-slate-500/10 dark:border-slate-400/70 dark:bg-slate-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-slate-400/45"
                  )}
                >
                  <CreditCard className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                  <span>Débito</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!cartaoLiberado}
                  title={
                    !cartaoLiberado
                      ? "Ative pelo menos uma maquininha em Configurações → Financeiro (cartões)"
                      : undefined
                  }
                  onClick={() => {
                    setSelectedType("cartao_credito")
                    handleAddPayment("cartao_credito")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "cartao_credito"
                      ? "border-blue-500 bg-blue-500/10 dark:border-blue-400/70 dark:bg-blue-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-blue-400/45"
                  )}
                >
                  <CreditCard className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <span>Crédito</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!selectedCustomer}
                  title={
                    !selectedCustomer
                      ? "Selecione o cliente no PDV para faturar à prazo em Contas a Receber"
                      : "Gera título em Contas a Receber ao confirmar a venda"
                  }
                  onClick={() => {
                    setSelectedType("a_prazo")
                    handleAddPayment("a_prazo")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "a_prazo"
                      ? "border-violet-500 bg-violet-500/10 dark:border-violet-400/70 dark:bg-violet-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-violet-400/45"
                  )}
                >
                  <CalendarClock className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  <span>À prazo</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!selectedCustomer || customerStoreCredit <= 0}
                  onClick={() => {
                    setSelectedType("credito_vale")
                    handleAddPayment("credito_vale")
                  }}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "credito_vale"
                      ? "border-amber-500 bg-amber-500/10 dark:border-amber-400/70 dark:bg-amber-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-amber-400/45"
                  )}
                >
                  <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span>Crédito/Vale</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!selectedCustomer}
                  title={!selectedCustomer ? "Selecione o cliente no PDV para carnê ou boleto" : undefined}
                  onClick={() => setSelectedType("carne")}
                  className={cn(
                    "h-14 flex flex-col gap-0.5 border-2 text-xs font-semibold text-foreground shadow-sm transition-colors bg-background hover:bg-muted/30 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/65",
                    selectedType === "carne"
                      ? "border-orange-500 bg-orange-500/10 dark:border-orange-400/70 dark:bg-orange-500/20"
                      : "border-border dark:border-zinc-600 dark:hover:border-orange-400/45"
                  )}
                >
                  <FileText className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  <span>Carnê</span>
                </Button>
              </div>
            </div>
          )}

          {/* Módulo Carnê */}
          {selectedType === "carne" && remaining > 0 && (
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
                            {n}x de {formatCurrency((parseFloat(currentValue) || remaining) / n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Valor Total Carnê</Label>
                    <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                      <span className="font-semibold">{formatCurrency(parseFloat(currentValue) || remaining)}</span>
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
                  {gerarParcelasCarne(parseFloat(currentValue) || remaining, parseInt(carneInstallments || "1", 10)).map((p) => (
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

          {/* Botões de Impressão */}
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">Impressão e Documentos</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                variant="outline"
                className="h-14 border-border hover:bg-secondary"
                disabled={remaining > 0}
                onClick={() => toast({ title: "Cupom pronto para impressão", description: "Envie para a impressora térmica conectada." })}
              >
                <Printer className="w-5 h-5 mr-2" />
                <div className="text-left">
                  <p className="text-sm font-semibold">Imprimir Cupom</p>
                  <p className="text-xs text-muted-foreground">Térmica 80mm</p>
                </div>
              </Button>
              
              <Button
                size="lg"
                variant="outline"
                className="h-14 border-border hover:bg-secondary"
                disabled={remaining > 0}
                onClick={() => toast({ title: "Contrato de garantia gerado", description: "Documento preparado para impressão A4." })}
              >
                <FileCheck className="w-5 h-5 mr-2" />
                <div className="text-left">
                  <p className="text-sm font-semibold">Gerar Contrato</p>
                  <p className="text-xs text-muted-foreground">Garantia A4</p>
                </div>
              </Button>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12 border-border"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (docInvalidoParaConfirmar) {
                  toast({
                    variant: "destructive",
                    title: "CPF/CNPJ obrigatório",
                    description: "Complete e salve o documento do cliente para carnê ou faturamento à prazo.",
                  })
                  return
                }
                onConfirm?.(payments)
                onClose()
              }}
              disabled={remaining > 0 || docInvalidoParaConfirmar}
              className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {remaining > 0
                ? `Falta ${formatCurrency(remaining)}`
                : docInvalidoParaConfirmar
                  ? "Informe o CPF/CNPJ"
                  : "Confirmar Pagamento"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
