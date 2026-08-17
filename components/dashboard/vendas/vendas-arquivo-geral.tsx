"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Search, RefreshCw,
  TrendingUp, BarChart3, AlertTriangle,
  Printer, Eye, XCircle, ChevronLeft, ChevronRight,
  CheckCircle, Filter, X, Tag, Clock, DollarSign, UserCheck, RotateCcw,
  Receipt, Download, MoreHorizontal, Loader2, Calendar, Wrench, ShieldCheck, Monitor,
  Send, Trash2, ListChecks, PanelsTopLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { sanitizeOperatorLabel } from "@/lib/pdv-operator-label"
import { CupomNaoFiscal, type CupomData } from "./cupom-nao-fiscal"
import { TrocasDevolucao } from "./trocas-devolucao"
import { WorkspaceCorrecaoVenda } from "./workspace-correcao-venda"
import { QuarentenaRecoveryDialog } from "./quarentena-recovery-dialog"
import { useToast } from "@/hooks/use-toast"
import type { SaleRecord } from "@/lib/operations-sale-types"
import { useOperationsStore } from "@/lib/operations-store"
import { subscribeEvent } from "@/lib/events/event-bus"
import {
  isSaleIdentityConflictCode,
  SALE_IDENTITY_CONFLICT_GUIDANCE,
  SALE_IDENTITY_CONFLICT_TITLE,
  saleSyncActionsForCode,
} from "@/lib/vendas/sale-identity-conflict"
import {
  classifyLocalSaleSync,
  displaySaleNumber,
  isProvisionalSaleRef,
} from "@/lib/vendas/local-sale-identity"

// ── Types ─────────────────────────────────────────────────────────────────────

type VendaItem = {
  id: string
  dbId: string
  at: string
  cliente: string
  total: number
  status: string
  operador: string | null
  /** FK do terminal PDV (Fase 3). null para vendas legadas (rótulo "Sem terminal"). */
  terminalId: string | null
  formaPagamento: string
  quantidadeItens: number
  cancelada: boolean
  canceladaEm: string | null
  motivoCancelamento: string | null
  rowKey: string
  kind: "REMOTE_CONFIRMED" | "LOCAL_PENDING" | "LOCAL_QUARANTINED"
  clientSaleId?: string
}

type TerminalOption = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "INACTIVE"
}

type Kpis = {
  totalVendas: number
  faturamento: number
  cancelamentos: number
  devolvidas: number
  concluidas: number
  ticketMedio: number
}

type ApiResponse = {
  ok: boolean
  vendas: VendaItem[]
  total: number
  kpis: Kpis
  terminais?: TerminalOption[]
}

type VendaDetalhe = {
  id: string
  dbId: string
  at: string
  clienteNome: string | null
  clienteId: string | null
  clienteCpf: string | null
  total: number
  desconto: number
  status: string
  operador: string | null
  canceladaEm: string | null
  canceladaPor: string | null
  motivoCancelamento: string | null
  estoqueReposto?: boolean
  estornoFinanceiro?: boolean
  sessaoId: string | null
  terminalId?: string | null
  terminal?: { id: string; code: string; name: string } | null
  observacao: string | null
  /**
   * Presente só quando a venda nasceu de uma recuperação de quarentena. Guarda o
   * número ANTIGO como auditoria — a identidade atual continua sendo `id`.
   */
  recovery?: {
    recoveredFromPedidoId: string
    recoveredAt: string | null
    motivo: string | null
    conflictCode: string | null
  } | null
  correcoes: Array<{
    at: string
    operador: string
    motivo: string
    campos: string[]
    pagamentoAnterior?: string
    pagamentoNovo?: string
    clienteAnterior?: string | null
    clienteNovo?: string | null
    observacaoAnterior?: string | null
    observacaoNova?: string | null
    supervisorNome?: string
  }>
  pagamentos: Array<{ label: string; valor: number }>
  itens: Array<{
    id: string
    nome: string
    quantidade: number
    precoUnitario: number
    lineTotal: number
    acessorio?: { modelLabel?: string; colorLabel?: string }
  }>
  devolucoes: Array<{
    id: string
    localId: string
    at: string
    tipo: string
    valorTotal: number
    creditoEmitido: number
    operador: string
    motivo: string
    modo?: string | null
    novaVendaId?: string | null
    itens: Array<{ nome: string; quantidade: number; valorTotal: number }>
  }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBrl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function fmtDateParts(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      time: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    }
  } catch {
    return { date: iso, time: "" }
  }
}

/** Data local (yyyy-mm-dd) de N dias atrás — para os chips de período rápido. */
function isoDia(offsetDias = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - offsetDias)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    concluida: "Concluída",
    cancelada: "Cancelada",
    devolvida: "Devolvida",
    parcialmente_devolvida: "Dev. Parcial",
  }
  return map[s] ?? s
}

function statusBadgeClass(s: string): string {
  if (s === "cancelada") return "border-destructive/30 bg-destructive/10 text-destructive"
  if (s === "devolvida" || s === "parcialmente_devolvida") return "border-warning/30 bg-warning/10 text-warning"
  return "border-success/20 bg-success/10 text-success"
}

const PAGE_SIZE = 20

function paymentBreakdownLabels(pb: SaleRecord["paymentBreakdown"]): string[] {
  const formas: string[] = []
  if (pb.dinheiro > 0) formas.push("Dinheiro")
  if (pb.pix > 0) formas.push("Pix")
  if (pb.cartaoDebito > 0) formas.push("Débito")
  if (pb.cartaoCredito > 0) formas.push("Crédito")
  if (pb.carne > 0) formas.push("Carnê")
  if (pb.aPrazo > 0) formas.push("À Prazo")
  if (pb.creditoVale > 0) formas.push("Vale")
  return formas
}

function saleRecordToPagamentos(s: SaleRecord): Array<{ label: string; valor: number }> {
  const pb = s.paymentBreakdown
  const rows: Array<{ label: string; valor: number }> = []
  if (pb.dinheiro > 0) rows.push({ label: "Dinheiro", valor: pb.dinheiro })
  if (pb.pix > 0) rows.push({ label: "Pix", valor: pb.pix })
  if (pb.cartaoDebito > 0) rows.push({ label: "Débito", valor: pb.cartaoDebito })
  if (pb.cartaoCredito > 0) rows.push({ label: "Crédito", valor: pb.cartaoCredito })
  if (pb.carne > 0) rows.push({ label: "Carnê", valor: pb.carne })
  if (pb.aPrazo > 0) rows.push({ label: "A Prazo", valor: pb.aPrazo })
  if (pb.creditoVale > 0) rows.push({ label: "Vale/Crédito", valor: pb.creditoVale })
  return rows
}

function saleRecordToVendaItem(s: SaleRecord): VendaItem {
  const formas = paymentBreakdownLabels(s.paymentBreakdown)
  const kind = classifyLocalSaleSync(s)
  return {
    id: s.id,
    dbId: s.serverId ?? s.id,
    at: s.at,
    cliente: s.customerName?.trim() || "—",
    total: s.total,
    status: "concluida",
    operador: sanitizeOperatorLabel(s.cashierId) || null,
    terminalId: s.terminalId ?? null,
    formaPagamento: formas.length > 0 ? formas.join(" + ") : "—",
    quantidadeItens: s.lines.reduce((sum, l) => sum + l.quantity, 0),
    cancelada: false,
    canceladaEm: null,
    motivoCancelamento: null,
    rowKey: `local:${s.clientSaleId || s.id}`,
    kind,
    clientSaleId: s.clientSaleId,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VendasArquivoGeral() {
  const { lojaAtivaId, empresaDocumentos, getEnderecoDocumentos } = useLojaAtiva()
  const storeId = (lojaAtivaId ?? "").trim()
  // Rótulo amigável da unidade (nome fantasia da loja ativa). Substitui o storeId
  // técnico nos textos visíveis ao operador (subtítulo e ficha de detalhe). O storeId
  // cru segue sendo usado apenas internamente (headers de API, filtros, deps).
  const unidadeLabel = (empresaDocumentos.nomeFantasia || "").trim()
  const {
    sales: opsSales,
    retrySyncSale,
    retrySyncSaleRetroactive,
    discardLocalPendingSale,
    bulkDiscardLocalPendingSales,
    recoverQuarantinedSale,
  } = useOperationsStore()
  const { toast } = useToast()
  
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Filters
  const [busca, setBusca] = useState("")
  const [buscaInput, setBuscaInput] = useState("")
  const [statusFiltro, setStatusFiltro] = useState("todos")
  const [pagamentoFiltro, setPagamentoFiltro] = useState("todos")
  const [operadorFiltro, setOperadorFiltro] = useState("")
  const [operadorInput, setOperadorInput] = useState("")
  const [terminalFiltro, setTerminalFiltro] = useState("todos") // "todos" | "sem" | <terminalId>
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [page, setPage] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [exportando, setExportando] = useState(false)

  // Data
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [vendas, setVendas] = useState<VendaItem[]>([])
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<Kpis>({ totalVendas: 0, faturamento: 0, cancelamentos: 0, devolvidas: 0, concluidas: 0, ticketMedio: 0 })
  const [terminais, setTerminais] = useState<TerminalOption[]>([])
  const terminalMap = useMemo(
    () => new Map(terminais.map((t) => [t.id, t] as const)),
    [terminais],
  )
  const [remoteSales, setRemoteSales] = useState<SaleRecord[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)

  // Detalhe drawer
  const [detalheOpen, setDetalheOpen] = useState(false)
  const [detalheLoading, setDetalheLoading] = useState(false)
  const [detalhe, setDetalhe] = useState<VendaDetalhe | null>(null)
  /** Venda apenas no operations-store (syncPending) — detalhe local, sem API. */
  const [detalhePendenteLocal, setDetalhePendenteLocal] = useState<SaleRecord | null>(null)
  const [saldoCredito, setSaldoCredito] = useState<number | null>(null)
  /**
   * `detalhePendenteLocal` é uma cópia estática tirada no momento em que o drawer abre;
   * `syncBlockedCode` muda a cada tentativa de reenvio, então derivamos a versão "viva"
   * direto de `opsSales` para o banner de sessão fechada refletir o estado atual sem
   * precisar espelhar manualmente o snapshot do drawer.
   */
  const pendenteLocalLive = useMemo(
    () =>
      detalhePendenteLocal
        ? opsSales.find(
            (s) =>
              (detalhePendenteLocal.clientSaleId && s.clientSaleId === detalhePendenteLocal.clientSaleId) ||
              s.id === detalhePendenteLocal.id,
          ) ?? detalhePendenteLocal
        : null,
    [detalhePendenteLocal, opsSales],
  )
  const pendingSaleSyncActions = saleSyncActionsForCode(pendenteLocalLive?.syncBlockedCode)
  const conflitoIdentidade = pendingSaleSyncActions.quarantined

  // Cupom modal
  const [cupomOpen, setCupomOpen] = useState(false)
  const [cupomData, setCupomData] = useState<CupomData | null>(null)

  // Troca / Devolução modal
  const [trocaOpen, setTrocaOpen] = useState(false)
  const [trocaSaleId, setTrocaSaleId] = useState<string | null>(null)
  const [trocaInitialSale, setTrocaInitialSale] = useState<SaleRecord | undefined>(undefined)

  // Cancel dialog
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)
  const [cancelMotivo, setCancelMotivo] = useState("")
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelConfirmForcar, setCancelConfirmForcar] = useState(false)

  // Reenvio / descarte de vendas locais pendentes (limpeza LOCAL, não cancela no servidor)
  const [reenviandoId, setReenviandoId] = useState<string | null>(null)
  const [descartandoLocalId, setDescartandoLocalId] = useState<string | null>(null)
  const [descartandoLocalLoading, setDescartandoLocalLoading] = useState(false)
  const [bulkLimparOpen, setBulkLimparOpen] = useState(false)
  const [bulkLimparLoading, setBulkLimparLoading] = useState(false)
  // Sync retroativo (venda pendente cuja sessão de caixa original está fechada) — exige
  // confirmação explícita, nunca automática. `retroativoConfirmId` abre o AlertDialog;
  // `retroativoLoading` cobre o próprio reenvio.
  const [retroativoConfirmId, setRetroativoConfirmId] = useState<string | null>(null)
  const [retroativoLoading, setRetroativoLoading] = useState(false)
  const [recoveringSaleId, setRecoveringSaleId] = useState<string | null>(null)
  const [recoverMotivo, setRecoverMotivo] = useState("")
  const [recoverLoading, setRecoverLoading] = useState(false)
  const [recoverClosedSessionConfirm, setRecoverClosedSessionConfirm] = useState(false)
  /** Console administrativo de recuperação EM LOTE das quarentenas. */
  const [quarentenaRecoveryOpen, setQuarentenaRecoveryOpen] = useState(false)

  // Workspace Enterprise — ficha completa + correções (única via de correção de venda)
  const [workspaceVendaId, setWorkspaceVendaId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setApiError(false)
    try {
      const params = new URLSearchParams({
        storeId,
        take: String(PAGE_SIZE),
        skip: String(page * PAGE_SIZE),
        ...(busca ? { q: busca } : {}),
        ...(statusFiltro !== "todos" ? { status: statusFiltro } : {}),
        ...(pagamentoFiltro !== "todos" ? { pagamento: pagamentoFiltro } : {}),
        ...(operadorFiltro.trim() ? { operador: operadorFiltro.trim() } : {}),
        ...(terminalFiltro !== "todos" ? { terminalId: terminalFiltro } : {}),
        ...(fromDate ? { from: new Date(fromDate).toISOString() } : {}),
        ...(toDate ? { to: new Date(toDate + "T23:59:59").toISOString() } : {}),
      })
      const res = await fetch(`/api/vendas/historico?${params}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "x-assistec-loja-id": storeId },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ApiResponse
      // Filtra id técnico que possa ter sido persistido em `Venda.operador`
      // (fallback de `cashierId` quando a venda foi gravada sem sessão). Nome
      // legível é mantido; UUID/timestamp-hash → null ("—"). Nunca substitui.
      setVendas(
        (data.vendas ?? []).map((v) => ({
          ...v,
          operador: sanitizeOperatorLabel(v.operador) || null,
          rowKey: v.rowKey || `remote:${v.id}`,
          kind: v.kind ?? "REMOTE_CONFIRMED",
        })),
      )
      setTotal(data.total ?? 0)
      setKpis(data.kpis ?? { totalVendas: 0, faturamento: 0, cancelamentos: 0, devolvidas: 0, concluidas: 0, ticketMedio: 0 })
      if (Array.isArray(data.terminais)) setTerminais(data.terminais)
    } catch {
      setApiError(true)
    } finally {
      setLoading(false)
    }
  }, [storeId, page, busca, statusFiltro, pagamentoFiltro, operadorFiltro, terminalFiltro, fromDate, toDate])

  const fetchRemoteSales = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ops/vendas-list?lojaId=${encodeURIComponent(storeId)}`,
        { credentials: "include", headers: { "x-assistec-loja-id": storeId } },
      )
      if (res.ok) {
        const data = (await res.json()) as { sales?: SaleRecord[] }
        setRemoteSales(data.sales ?? [])
      }
    } catch (err: unknown) {
      console.warn("[vendas-arquivo] falha ao carregar do servidor:", err)
    }
  }, [storeId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    return subscribeEvent("venda_finalizada", (payload) => {
      if (payload.storeId !== storeId) return
      void load()
      void fetchRemoteSales()
    })
  }, [storeId, load, fetchRemoteSales])

  useEffect(() => {
    const t = setTimeout(() => { setPage(0); setBusca(buscaInput) }, 400)
    return () => clearTimeout(t)
  }, [buscaInput])

  useEffect(() => {
    const t = setTimeout(() => { setPage(0); setOperadorFiltro(operadorInput) }, 400)
    return () => clearTimeout(t)
  }, [operadorInput])

  // Reset page on filter change
  useEffect(() => { setPage(0) }, [statusFiltro, pagamentoFiltro, terminalFiltro, fromDate, toDate])

  useEffect(() => {
    let cancelled = false
    setRemoteLoading(true)
    void fetchRemoteSales().finally(() => {
      if (!cancelled) setRemoteLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchRemoteSales])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const { mergedVendas, pendingSyncIds, conflitoIdentidadeIds } = useMemo(() => {
    const historicoIds = new Set(vendas.map((v) => v.id))
    const remoteClientSaleIds = new Set(
      vendas.map((v) => v.clientSaleId).filter((id): id is string => Boolean(id)),
    )

    // Ids pendentes SEM filtro: alimentam o botão "Limpar pendentes locais" e os
    // guards de ação mesmo quando a linha está oculta por algum filtro ativo.
    const pendingSync = new Set(
      opsSales.filter((s) => s.id && s.syncPending === true).map((s) => s.id),
    )
    // Conflitos permanentes de identidade continuam pendentes, mas ficam em quarentena:
    // sem reenvio, retroativo ou descarte simples.
    const conflitosIdentidade = new Set(
      opsSales
        .filter((s) => s.id && s.syncPending === true && isSaleIdentityConflictCode(s.syncBlockedCode))
        .map((s) => s.id),
    )

    // Só vendas LOCAIS pendentes entram no merge — elas ainda não existem no
    // servidor. Vendas persistidas vêm exclusivamente da página filtrada do
    // /api/vendas/historico: misturar a lista remota inteira (extraRemote antigo)
    // reinjetava tudo que estava fora da página e anulava paginação e filtros.
    const dentroDoPeriodo = (at: string) => {
      if (!fromDate && !toDate) return true
      const t = new Date(at).getTime()
      if (Number.isNaN(t)) return true
      if (fromDate && t < new Date(`${fromDate}T00:00:00`).getTime()) return false
      if (toDate && t > new Date(`${toDate}T23:59:59.999`).getTime()) return false
      return true
    }
    const buscaTrim = busca.trim().toLowerCase()
    const operadorTrim = operadorFiltro.trim().toLowerCase()

    const extraLocal = opsSales
      .filter((s) => {
        if (!s.id || s.syncPending !== true) return false
        if (s.clientSaleId && remoteClientSaleIds.has(s.clientSaleId)) return false
        const quarantined = isSaleIdentityConflictCode(s.syncBlockedCode)
        if (historicoIds.has(s.id) && !quarantined && !s.clientSaleId) return false
        if (!dentroDoPeriodo(s.at)) return false
        // Pendentes locais são sempre "concluída" na prática — filtros de outro
        // status as escondem, como aconteceria se estivessem no servidor.
        if (statusFiltro !== "todos" && statusFiltro !== "concluida") return false
        if (pagamentoFiltro !== "todos") {
          const pb = s.paymentBreakdown as unknown as Record<string, number> | undefined
          if (!((Number(pb?.[pagamentoFiltro]) || 0) > 0)) return false
        }
        if (terminalFiltro !== "todos") {
          if (terminalFiltro === "sem" ? !!s.terminalId : s.terminalId !== terminalFiltro) return false
        }
        if (operadorTrim) {
          const op = (sanitizeOperatorLabel(s.cashierId) || "").toLowerCase()
          if (!op.includes(operadorTrim)) return false
        }
        return true
      })
      .map(saleRecordToVendaItem)
      .filter(
        (v) =>
          !buscaTrim ||
          v.id.toLowerCase().includes(buscaTrim) ||
          v.cliente.toLowerCase().includes(buscaTrim),
      )

    const merged = [...vendas, ...extraLocal].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
    return {
      mergedVendas: merged,
      pendingSyncIds: pendingSync,
      conflitoIdentidadeIds: conflitosIdentidade,
    }
  }, [vendas, opsSales, fromDate, toDate, busca, statusFiltro, pagamentoFiltro, terminalFiltro, operadorFiltro])

  const isVendaPendenteSync = useCallback(
    (vendaId: string) => pendingSyncIds.has(vendaId),
    [pendingSyncIds],
  )

  const hasRemoteConfirmed = useCallback(
    (vendaId: string) => mergedVendas.some((v) => v.id === vendaId && v.kind === "REMOTE_CONFIRMED"),
    [mergedVendas],
  )

  const blocksConfirmedSaleAction = useCallback(
    (vendaId: string) => isVendaPendenteSync(vendaId) && !hasRemoteConfirmed(vendaId),
    [hasRemoteConfirmed, isVendaPendenteSync],
  )

  const getPendingSaleRecord = useCallback(
    (vendaId: string) =>
      opsSales.find(
        (s) =>
          s.syncPending === true &&
          (s.id === vendaId || s.clientSaleId === vendaId || `local:${s.clientSaleId || s.id}` === vendaId),
      ) ?? null,
    [opsSales],
  )

  const toastVendaPendenteBloqueada = useCallback(
    (acao: "cancelar" | "corrigir" | "troca" | "imprimir") => {
      const desc =
        acao === "cancelar"
          ? "Venda pendente não pode ser cancelada até sincronizar com o servidor."
          : "Esta ação só está disponível após a venda ser confirmada no servidor."
      // Situação neutra (ação ainda indisponível, não um erro) — toast informativo,
      // nunca destructive, em todas as ações bloqueadas por sincronização pendente.
      toast({
        title: "Venda pendente de sincronização",
        description: desc,
      })
    },
    [toast],
  )

  // ── Pendentes locais: reenviar / descartar (LOCAL) / limpeza em lote ─────────
  const handleReenviarSync = useCallback(
    async (vendaId: string) => {
      if (!isVendaPendenteSync(vendaId)) {
        toast({
          title: "Venda não pendente",
          description: "Esta venda não precisa de reenvio.",
        })
        return
      }
      const pendingSale = getPendingSaleRecord(vendaId)
      if (isSaleIdentityConflictCode(pendingSale?.syncBlockedCode)) {
        toast({
          title: SALE_IDENTITY_CONFLICT_TITLE,
          description: SALE_IDENTITY_CONFLICT_GUIDANCE,
          variant: "destructive",
        })
        return
      }
      setReenviandoId(vendaId)
      const res = await retrySyncSale(vendaId)
      setReenviandoId(null)
      if (res.ok) {
        toast({
          title: "Venda sincronizada",
          description: `${vendaId} foi confirmada no servidor.`,
        })
        void fetchRemoteSales()
        load()
      } else if (isSaleIdentityConflictCode(res.code)) {
        toast({
          title: SALE_IDENTITY_CONFLICT_TITLE,
          description: SALE_IDENTITY_CONFLICT_GUIDANCE,
          variant: "destructive",
        })
      } else {
        toast({
          title: `Falha ao reenviar ${vendaId}`,
          description: res.reason.slice(0, 220),
          variant: "destructive",
        })
      }
    },
    [retrySyncSale, fetchRemoteSales, getPendingSaleRecord, load, toast, isVendaPendenteSync],
  )

  /**
   * Confirmação final de "Sincronizar retroativo" — só chamado depois do AlertDialog.
   * Envia `allowClosedOriginalSession` para gravar na PRÓPRIA sessão original fechada
   * (nunca no caixa atual). Nunca usado pelo retry automático nem pelo reenvio normal.
   */
  const handleConfirmReenviarRetroativo = useCallback(async () => {
    if (!retroativoConfirmId) return
    const vendaId = retroativoConfirmId
    setRetroativoLoading(true)
    const res = await retrySyncSaleRetroactive(vendaId)
    setRetroativoLoading(false)
    setRetroativoConfirmId(null)
    if (res.ok) {
      toast({
        title: "Venda sincronizada retroativamente",
        description: `${vendaId} foi gravada na sessão de caixa original.`,
      })
      void fetchRemoteSales()
      load()
    } else {
      toast({
        title: `Falha ao sincronizar ${vendaId}`,
        description: res.reason.slice(0, 220),
        variant: "destructive",
      })
    }
  }, [retroativoConfirmId, retrySyncSaleRetroactive, fetchRemoteSales, load, toast])

  const handleConfirmDescarteLocal = useCallback(async () => {
    if (!descartandoLocalId) return
    if (conflitoIdentidadeIds.has(descartandoLocalId)) {
      setDescartandoLocalId(null)
      toast({
        title: SALE_IDENTITY_CONFLICT_TITLE,
        description: SALE_IDENTITY_CONFLICT_GUIDANCE,
        variant: "destructive",
      })
      return
    }
    setDescartandoLocalLoading(true)
    const id = descartandoLocalId
    const res = await discardLocalPendingSale(id)
    setDescartandoLocalLoading(false)
    setDescartandoLocalId(null)
    // Detalhe local aberto desta venda — fechar para evitar referência stale.
    setDetalhePendenteLocal((cur) => (cur?.id === id ? null : cur))
    if (!res.ok) {
      toast({
        title: `Descarte local não concluído (${id})`,
        description: res.reason.slice(0, 220),
        variant: "destructive",
      })
      return
    }
    if (res.mode === "discarded") {
      toast({
        title: "Venda local descartada",
        description: `${id} não existia no servidor — removida apenas do dispositivo. Estoque/financeiro intactos.`,
      })
    } else {
      toast({
        title: "Venda existia no servidor",
        description: `${id} foi reconciliada como sincronizada. Nada descartado.`,
      })
      void fetchRemoteSales()
      load()
    }
  }, [conflitoIdentidadeIds, descartandoLocalId, discardLocalPendingSale, fetchRemoteSales, load, toast])

  const handleConfirmBulkLimpar = useCallback(async () => {
    setBulkLimparLoading(true)
    const res = await bulkDiscardLocalPendingSales()
    setBulkLimparLoading(false)
    setBulkLimparOpen(false)
    if (!res.ok) {
      toast({
        title: "Limpeza não concluída",
        description: "Tente novamente em instantes.",
        variant: "destructive",
      })
      return
    }
    const partes = [
      `${res.discarded} descartada${res.discarded !== 1 ? "s" : ""}`,
      `${res.reconciled} sincronizada${res.reconciled !== 1 ? "s" : ""}`,
    ]
    if (res.conflicts > 0) partes.push(`${res.conflicts} conflito${res.conflicts !== 1 ? "s" : ""}`)
    toast({
      title: `Limpeza local concluída (${res.total} pendentes)`,
      description: `${partes.join(" · ")}. Apenas estado local foi alterado.`,
    })
    if (res.reconciled > 0) {
      void fetchRemoteSales()
      load()
    }
  }, [bulkDiscardLocalPendingSales, fetchRemoteSales, load, toast])

  const recoveringSale = useMemo(
    () => (recoveringSaleId ? getPendingSaleRecord(recoveringSaleId) : null),
    [recoveringSaleId, getPendingSaleRecord],
  )

  const openRecoverDialog = useCallback((vendaId: string) => {
    setRecoveringSaleId(vendaId)
    setRecoverMotivo("")
    setRecoverClosedSessionConfirm(false)
  }, [])

  const handleRecoverQuarantined = useCallback(
    async (allowClosedOriginalSession: boolean) => {
      if (!recoveringSaleId || recoverMotivo.trim().length < 5) return
      setRecoverLoading(true)
      const res = await recoverQuarantinedSale({
        saleId: recoveringSaleId,
        motivo: recoverMotivo.trim(),
        allowClosedOriginalSession,
      })
      setRecoverLoading(false)
      if (res.ok) {
        toast({
          title: "Venda recuperada",
          description: `Novo número server-side: ${res.saleId}. A venda que ocupava o número antigo permanece intacta.`,
        })
        setRecoveringSaleId(null)
        setRecoverMotivo("")
        setRecoverClosedSessionConfirm(false)
        setDetalheOpen(false)
        void fetchRemoteSales()
        load()
        return
      }
      if (res.code === "CAIXA_ORIGINAL_FECHADO" && !allowClosedOriginalSession) {
        setRecoverClosedSessionConfirm(true)
        return
      }
      toast({
        title: "Não foi possível recuperar",
        description: res.reason.slice(0, 220),
        variant: "destructive",
      })
    },
    [recoveringSaleId, recoverMotivo, recoverQuarantinedSale, fetchRemoteSales, load, toast],
  )

  // ── Detalhe ──────────────────────────────────────────────────────────────────
  const openDetalhe = useCallback(async (rowKeyOrId: string) => {
    setDetalheOpen(true)
    setSaldoCredito(null)

    const row =
      mergedVendas.find((v) => v.rowKey === rowKeyOrId) ??
      mergedVendas.find((v) => v.kind === "REMOTE_CONFIRMED" && v.id === rowKeyOrId) ??
      mergedVendas.find((v) => v.id === rowKeyOrId)
    const isLocalEntity = row?.kind === "LOCAL_PENDING" || row?.kind === "LOCAL_QUARANTINED"

    if (isLocalEntity && row) {
      const local =
        opsSales.find(
          (s) =>
            s.syncPending === true &&
            ((row.clientSaleId && s.clientSaleId === row.clientSaleId) || s.id === row.id),
        ) ?? getPendingSaleRecord(row.id)
      setDetalheLoading(false)
      setDetalhe(null)
      setDetalhePendenteLocal(local)
      if (!local) {
        toast({
          title: "Venda pendente",
          description: "Dados locais indisponíveis. Atualize a página ou aguarde a sincronização.",
          variant: "destructive",
        })
      }
      return
    }

    setDetalhePendenteLocal(null)
    setDetalheLoading(true)
    setDetalhe(null)
    const vendaId = row?.id ?? rowKeyOrId
    try {
      const res = await fetch(`/api/vendas/${encodeURIComponent(vendaId)}`, {
        credentials: "include",
        headers: { "x-assistec-loja-id": storeId },
      })
      const data = await res.json()
      if (data.ok) {
        // Sanitiza o operador vindo do banco (reimpressão de cupom + detalhe usam
        // este valor). Id técnico → oculto; nome legível preservado. Sem substituição.
        const vendaDetalhe = data.venda as VendaDetalhe
        setDetalhe({ ...vendaDetalhe, operador: sanitizeOperatorLabel(vendaDetalhe.operador) || null })
        // Busca saldo atual em haver se a venda tem devoluções com crédito e CPF do cliente
        const venda = data.venda as VendaDetalhe
        if (venda.clienteCpf) {
          const totalCreditoGerado = venda.devolucoes.reduce((s, d) => s + (d.creditoEmitido ?? 0), 0)
          if (totalCreditoGerado > 0) {
            try {
              const doc = venda.clienteCpf.replace(/\D/g, "")
              const rCred = await fetch(
                `/api/ops/credito-cliente?lojaId=${encodeURIComponent(storeId)}&doc=${encodeURIComponent(doc)}`,
                { credentials: "include" }
              )
              if (rCred.ok) {
                const jCred = (await rCred.json()) as { creditos?: Record<string, { nome: string; saldo: number }> }
                const saldo = jCred.creditos?.[doc]?.saldo
                setSaldoCredito(typeof saldo === "number" ? saldo : null)
              }
            } catch { /* silent */ }
          }
        }
      }
    } catch {
      toast({ title: "Erro", description: "Não foi possível carregar o detalhe da venda.", variant: "destructive" })
    } finally {
      setDetalheLoading(false)
    }
  }, [storeId, toast, mergedVendas, opsSales, getPendingSaleRecord])

  // ── Cupom ────────────────────────────────────────────────────────────────────
  const openCupom = useCallback((d: VendaDetalhe) => {
    const lojaNome = empresaDocumentos.nomeFantasia || empresaDocumentos.razaoSocial || "Loja"
    const lojaCnpj = empresaDocumentos.cnpj || undefined
    const lojaEndereco = getEnderecoDocumentos() || undefined

    setCupomData({
      numeroPedido: d.id,
      at: d.at,
      lojaNome,
      lojaCnpj,
      lojaEndereco,
      clienteNome: d.clienteNome,
      clienteCpf: d.clienteCpf,
      operador: d.operador,
      sessaoId: d.sessaoId,
      itens: d.itens,
      pagamentos: d.pagamentos,
      total: d.total,
      desconto: d.desconto,
      status: d.status,
    })
    setCupomOpen(true)
  }, [empresaDocumentos])

  const openCupomFromRow = useCallback(async (vendaId: string) => {
    if (blocksConfirmedSaleAction(vendaId)) {
      toastVendaPendenteBloqueada("imprimir")
      return
    }
    try {
      const res = await fetch(`/api/vendas/${encodeURIComponent(vendaId)}`, {
        credentials: "include",
        headers: { "x-assistec-loja-id": storeId },
      })
      const data = await res.json()
      if (data.ok) openCupom(data.venda)
    } catch {
      toast({ title: "Erro", description: "Não foi possível carregar os dados do cupom.", variant: "destructive" })
    }
  }, [storeId, openCupom, toast, blocksConfirmedSaleAction, toastVendaPendenteBloqueada])

  // ── Cancelamento ─────────────────────────────────────────────────────────────
  const handleCancelar = useCallback(async (forcar = false) => {
    if (!cancelandoId || !cancelMotivo.trim()) return
    if (blocksConfirmedSaleAction(cancelandoId)) {
      toastVendaPendenteBloqueada("cancelar")
      setCancelandoId(null)
      setCancelMotivo("")
      setCancelConfirmForcar(false)
      return
    }
    setCancelLoading(true)
    try {
      const res = await fetch(`/api/vendas/${encodeURIComponent(cancelandoId)}/cancelar`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-assistec-loja-id": storeId,
        },
        body: JSON.stringify({
          motivo: cancelMotivo.trim(),
          canceladaPor: "Operador",
          forcar,
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        if (data.requireConfirm && !forcar) {
          setCancelConfirmForcar(true)
          return
        }
        toast({ title: "Erro", description: data.error ?? "Falha ao cancelar venda.", variant: "destructive" })
        return
      }
      toast({ title: "Venda cancelada", description: `${cancelandoId} cancelada com sucesso.` })
      setCancelandoId(null)
      setCancelMotivo("")
      setCancelConfirmForcar(false)
      // Refresh detail if open
      if (detalhe?.id === cancelandoId) {
        await openDetalhe(cancelandoId)
      }
      load()
    } catch {
      toast({ title: "Erro", description: "Falha ao cancelar venda.", variant: "destructive" })
    } finally {
      setCancelLoading(false)
    }
  }, [cancelandoId, cancelMotivo, storeId, detalhe, openDetalhe, load, toast, blocksConfirmedSaleAction, toastVendaPendenteBloqueada])

  const openTroca = useCallback(
    (vendaId: string) => {
      if (blocksConfirmedSaleAction(vendaId)) {
        toastVendaPendenteBloqueada("troca")
        return
      }
      setTrocaSaleId(vendaId)
      setTrocaInitialSale(remoteSales.find((s) => s.id === vendaId))
      setTrocaOpen(true)
    },
    [remoteSales, blocksConfirmedSaleAction, toastVendaPendenteBloqueada],
  )

  const closeTroca = useCallback(() => {
    setTrocaOpen(false)
    setTrocaSaleId(null)
    setTrocaInitialSale(undefined)
  }, [])

  const startCancel = useCallback((vendaId: string) => {
    if (blocksConfirmedSaleAction(vendaId)) {
      toastVendaPendenteBloqueada("cancelar")
      return
    }
    setCancelandoId(vendaId)
    setCancelMotivo("")
    setCancelConfirmForcar(false)
  }, [blocksConfirmedSaleAction, toastVendaPendenteBloqueada])

  const clearAllFilters = useCallback(() => {
    setStatusFiltro("todos")
    setPagamentoFiltro("todos")
    setBuscaInput("")
    setBusca("")
    setOperadorFiltro("")
    setOperadorInput("")
    setTerminalFiltro("todos")
    setFromDate("")
    setToDate("")
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 50)
  }, [])

  // ── Exportação CSV ───────────────────────────────────────────────────────────
  // Exporta as vendas do servidor respeitando os filtros ativos da tela.
  // Formato para Excel pt-BR: separador ';', decimal com vírgula, BOM UTF-8.
  const EXPORT_MAX = 5000
  const handleExportar = useCallback(async () => {
    setExportando(true)
    try {
      const PAGE = 200
      const linhas: VendaItem[] = []
      let skip = 0
      let totalServidor = Infinity
      while (skip < totalServidor && linhas.length < EXPORT_MAX) {
        const params = new URLSearchParams({
          storeId,
          take: String(PAGE),
          skip: String(skip),
          ...(busca ? { q: busca } : {}),
          ...(statusFiltro !== "todos" ? { status: statusFiltro } : {}),
          ...(pagamentoFiltro !== "todos" ? { pagamento: pagamentoFiltro } : {}),
          ...(operadorFiltro.trim() ? { operador: operadorFiltro.trim() } : {}),
          ...(terminalFiltro !== "todos" ? { terminalId: terminalFiltro } : {}),
          ...(fromDate ? { from: new Date(fromDate).toISOString() } : {}),
          ...(toDate ? { to: new Date(toDate + "T23:59:59").toISOString() } : {}),
        })
        const res = await fetch(`/api/vendas/historico?${params}`, {
          credentials: "include",
          cache: "no-store",
          headers: { "x-assistec-loja-id": storeId },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as ApiResponse
        const lote = data.vendas ?? []
        linhas.push(...lote.map((v) => ({ ...v, operador: sanitizeOperatorLabel(v.operador) || null })))
        totalServidor = data.total ?? lote.length
        skip += PAGE
        if (lote.length === 0) break
      }
      if (linhas.length === 0) {
        toast({ title: "Nada para exportar", description: "Nenhuma venda encontrada com os filtros atuais." })
        return
      }
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
      const num = (n: number) => n.toFixed(2).replace(".", ",")
      const cabecalho = [
        "Data", "Hora", "Cupom", "Cliente", "Total (R$)", "Pagamento", "Itens",
        "Operador", "Terminal", "Status", "Cancelada em", "Motivo cancelamento",
      ]
      const csv = [cabecalho.join(";")]
      for (const v of linhas) {
        const { date, time } = fmtDateParts(v.at)
        csv.push([
          esc(date),
          esc(time),
          esc(v.id),
          esc(v.cliente === "—" ? "" : v.cliente),
          num(v.total),
          esc(v.formaPagamento === "—" ? "" : v.formaPagamento),
          String(v.quantidadeItens),
          esc(v.operador ?? ""),
          esc(v.terminalId ? (terminalMap.get(v.terminalId)?.code || "PDV") : ""),
          esc(statusLabel(v.status)),
          esc(v.canceladaEm ? fmtDate(v.canceladaEm) : ""),
          esc(v.motivoCancelamento ?? ""),
        ].join(";"))
      }
      const blob = new Blob(["﻿" + csv.join("\r\n")], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `vendas_${isoDia(0)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      const truncado = linhas.length >= EXPORT_MAX && totalServidor > EXPORT_MAX
      toast({
        title: "Exportação concluída",
        description: `${linhas.length.toLocaleString("pt-BR")} venda(s) no arquivo CSV${truncado ? ` — limite de ${EXPORT_MAX.toLocaleString("pt-BR")} atingido, refine os filtros para exportar o restante` : ""}.`,
      })
    } catch {
      toast({ title: "Falha na exportação", description: "Não foi possível gerar o arquivo. Tente novamente.", variant: "destructive" })
    } finally {
      setExportando(false)
    }
  }, [storeId, busca, statusFiltro, pagamentoFiltro, operadorFiltro, terminalFiltro, fromDate, toDate, terminalMap, toast])

  // ── KPI Cards ──────────────────────────────────────────────────────────────

  const kpiCards = [
    {
      label: "Concluídas",
      value: kpis.concluidas.toLocaleString("pt-BR"),
      icon: CheckCircle,
      tone: "text-success",
      bg: "bg-success/10",
    },
    {
      label: "Faturamento líquido",
      value: fmtBrl(kpis.faturamento),
      icon: TrendingUp,
      tone: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Ticket médio",
      value: fmtBrl(kpis.ticketMedio),
      icon: DollarSign,
      tone: "text-info",
      bg: "bg-info/10",
    },
    {
      label: "Cancelamentos",
      value: kpis.cancelamentos.toLocaleString("pt-BR"),
      icon: XCircle,
      tone: "text-destructive",
      bg: "bg-destructive/10",
    },
  ]

  const hasActiveFilters = statusFiltro !== "todos" || pagamentoFiltro !== "todos" || terminalFiltro !== "todos" || busca !== "" || fromDate !== "" || toDate !== "" || operadorFiltro !== ""

  // Períodos rápidos (padrão de mercado): um clique preenche De/Até; clicar de novo limpa.
  const periodoChips = [
    { label: "Hoje", from: isoDia(0), to: isoDia(0) },
    { label: "Ontem", from: isoDia(1), to: isoDia(1) },
    { label: "7 dias", from: isoDia(6), to: isoDia(0) },
    { label: "30 dias", from: isoDia(29), to: isoDia(0) },
  ]

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-5 pb-8 min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary shadow-sm">
            <Receipt className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Vendas</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Consulte, corrija, reimprima, cancele ou registre trocas e devoluções
              {unidadeLabel && <> · {unidadeLabel}</>}
              {remoteLoading && (
                <span className="inline-flex items-center gap-1 ml-2 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  sincronizando…
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {conflitoIdentidadeIds.size > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setQuarentenaRecoveryOpen(true)}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Recuperar vendas em quarentena
                  <Badge
                    variant="outline"
                    className="border-destructive/30 bg-destructive/15 text-[9px] px-1 py-0 text-destructive"
                  >
                    {conflitoIdentidadeIds.size}
                  </Badge>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Analisa e recupera vendas reais cujo número colidiu — nenhuma venda existente é alterada
              </TooltipContent>
            </Tooltip>
          )}
          {pendingSyncIds.size > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-warning/40 text-warning hover:bg-warning/10"
                  onClick={() => setBulkLimparOpen(true)}
                  disabled={bulkLimparLoading}
                >
                  <ListChecks className="h-4 w-4" />
                  Limpar pendentes locais
                  <Badge variant="outline" className="border-warning/30 bg-warning/15 text-[9px] px-1 py-0 text-warning">
                    {pendingSyncIds.size}
                  </Badge>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Verifica no servidor e descarta apenas as órfãs locais (não cancela vendas reais)</TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 hover:bg-muted/40"
            onClick={() => void handleExportar()}
            disabled={exportando || loading}
          >
            {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportando ? "Exportando…" : "Exportar CSV"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpiCards.map((k) => (
          <Card key={k.label} className="border-border bg-card">
            <CardContent className="flex items-center gap-3 pt-4 pb-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${k.bg}`}>
                <k.icon className={`h-4 w-4 ${k.tone}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">{k.label}</p>
                {loading ? (
                  <Skeleton className="mt-1 h-5 w-20" />
                ) : (
                  <p className="text-lg font-bold text-foreground leading-tight tabular-nums">{k.value}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar operacional */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="pl-9 h-10 bg-background"
                placeholder="Buscar por cupom, cliente ou ID da venda…"
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {periodoChips.map((c) => {
                  const ativo = fromDate === c.from && toDate === c.to
                  return (
                    <Button
                      key={c.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 rounded-full px-3 text-xs font-medium",
                        ativo && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                      )}
                      onClick={() => {
                        if (ativo) {
                          setFromDate("")
                          setToDate("")
                        } else {
                          setFromDate(c.from)
                          setToDate(c.to)
                        }
                      }}
                    >
                      {c.label}
                    </Button>
                  )
                })}
              </div>
              <Button
                variant={showFilters ? "default" : "outline"}
                size="sm"
                className="gap-1.5 h-9"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter className="h-4 w-4" />
                Filtros
                {hasActiveFilters && (
                  <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold">
                    !
                  </span>
                )}
              </Button>
              <Badge variant="outline" className="h-9 px-3 font-normal text-muted-foreground border-border">
                {loading ? "…" : `${total.toLocaleString("pt-BR")} registro${total !== 1 ? "s" : ""}`}
              </Badge>
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 pt-3 border-t border-border">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Status
                </Label>
                <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                  <SelectTrigger className="h-9 text-sm bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os status</SelectItem>
                    <SelectItem value="concluida">Concluída</SelectItem>
                    <SelectItem value="cancelada">Cancelada</SelectItem>
                    <SelectItem value="devolvida">Devolvida</SelectItem>
                    <SelectItem value="parcialmente_devolvida">Dev. Parcial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Pagamento
                </Label>
                <Select value={pagamentoFiltro} onValueChange={setPagamentoFiltro}>
                  <SelectTrigger className="h-9 text-sm bg-background">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todas as formas</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="pix">Pix</SelectItem>
                    <SelectItem value="cartaoDebito">Débito</SelectItem>
                    <SelectItem value="cartaoCredito">Crédito</SelectItem>
                    <SelectItem value="carne">Carnê</SelectItem>
                    <SelectItem value="aPrazo">A Prazo</SelectItem>
                    <SelectItem value="creditoVale">Vale/Crédito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> De
                </Label>
                <Input type="date" className="h-9 text-sm bg-background" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Até
                </Label>
                <Input type="date" className="h-9 text-sm bg-background" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <UserCheck className="h-3 w-3" /> Operador
                </Label>
                <Input
                  className="h-9 text-sm bg-background"
                  placeholder="Nome ou ID…"
                  value={operadorInput}
                  onChange={(e) => setOperadorInput(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> Terminal
                </Label>
                <Select value={terminalFiltro} onValueChange={setTerminalFiltro}>
                  <SelectTrigger className="h-9 text-sm bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os terminais</SelectItem>
                    {terminais.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name || t.code}
                        {t.status === "INACTIVE" ? " (inativo)" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="sem">Sem terminal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <div className="sm:col-span-2 lg:col-span-6 flex justify-end">
                  <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5 h-8" onClick={clearAllFilters}>
                    <X className="h-3.5 w-3.5" />
                    Limpar filtros
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabela ERP */}
      {apiError ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-8 py-14 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Erro ao carregar histórico</p>
            <p className="text-sm text-muted-foreground">Seus dados estão seguros. Verifique a conexão e tente novamente.</p>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 border-border">
                  <TableHead className="min-w-[130px] font-semibold text-foreground">Data / Hora</TableHead>
                  <TableHead className="min-w-[120px] font-semibold text-foreground">Cupom</TableHead>
                  <TableHead className="min-w-[140px] font-semibold text-foreground">Cliente</TableHead>
                  {/* Total logo após Cliente: nunca fica sob a coluna fixa de Ações
                      quando a tabela estoura na horizontal (notebook/zoom). */}
                  <TableHead className="min-w-[110px] font-semibold text-foreground text-right whitespace-nowrap pr-4">Total</TableHead>
                  <TableHead className="min-w-[100px] font-semibold text-foreground hidden md:table-cell">Pagamento</TableHead>
                  <TableHead className="min-w-[80px] font-semibold text-foreground hidden lg:table-cell text-center">Itens</TableHead>
                  <TableHead className="min-w-[90px] font-semibold text-foreground hidden xl:table-cell">Operador</TableHead>
                  <TableHead className="min-w-[90px] font-semibold text-foreground hidden xl:table-cell">Terminal</TableHead>
                  <TableHead className="min-w-[100px] font-semibold text-foreground">Status</TableHead>
                  <TableHead className="w-[130px] min-w-[120px] font-semibold text-foreground text-right sticky right-0 z-30 bg-card border-l border-border/60 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.12)]">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border">
                      <TableCell>
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16 font-mono" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-32" />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <Skeleton className="h-5 w-16" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-5 w-20" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-center">
                        <div className="flex justify-center">
                          <Skeleton className="h-5 w-8" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </TableCell>
                      <TableCell className="w-[130px] min-w-[120px] text-right sticky right-0 z-30 bg-card border-l border-border/60 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.10)]">
                        <div className="flex justify-end gap-1.5 whitespace-nowrap">
                          <Skeleton className="h-7 w-7 rounded-md" />
                          <Skeleton className="h-7 w-7 rounded-md" />
                          <Skeleton className="h-7 w-7 rounded-md" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : mergedVendas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <BarChart3 className="h-10 w-10 text-muted-foreground/50" />
                        <p className="font-medium text-foreground">
                          {hasActiveFilters ? "Nenhuma venda encontrada" : "Nenhuma venda registrada"}
                        </p>
                        <p className="text-sm text-muted-foreground max-w-sm">
                          {hasActiveFilters
                            ? "Ajuste os filtros ou limpe a busca."
                            : "As vendas do PDV aparecem aqui após sincronização com o banco."}
                        </p>
                        {hasActiveFilters && (
                          <Button variant="outline" size="sm" onClick={clearAllFilters}>
                            Limpar filtros
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                    mergedVendas.map((v) => {
                    const { date, time } = fmtDateParts(v.at)
                    const isPendenteSync = v.kind === "LOCAL_PENDING"
                    const isQuarantined = v.kind === "LOCAL_QUARANTINED"
                    const pendingSale = isPendenteSync || isQuarantined ? getPendingSaleRecord(v.id) : null
                    const displayId =
                      v.kind === "LOCAL_PENDING"
                        ? "Venda pendente"
                        : v.kind === "LOCAL_QUARANTINED"
                          ? "Conflito de identificação"
                          : v.id
                    const menuAcoes: Array<{ key: string; node: ReactNode }> = []
                    if (v.kind === "REMOTE_CONFIRMED") {
                      menuAcoes.push({
                        key: "workspace",
                        node: (
                          <DropdownMenuItem onClick={() => setWorkspaceVendaId(v.id)}>
                            <PanelsTopLeft className="h-4 w-4 mr-2" /> Workspace · Corrigir
                          </DropdownMenuItem>
                        ),
                      })
                      if (!v.cancelada) {
                        menuAcoes.push({
                          key: "troca",
                          node: (
                            <DropdownMenuItem onClick={() => openTroca(v.id)}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Troca / Devolução
                            </DropdownMenuItem>
                          ),
                        })
                        menuAcoes.push({
                          key: "cancel",
                          node: (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => startCancel(v.id)}>
                                <XCircle className="h-4 w-4 mr-2" /> Cancelar venda
                              </DropdownMenuItem>
                            </>
                          ),
                        })
                      }
                    } else if (v.kind === "LOCAL_PENDING") {
                      menuAcoes.push({
                        key: "retry",
                        node: (
                          <DropdownMenuItem onClick={() => void handleReenviarSync(v.id)}>
                            <Send className="h-4 w-4 mr-2" /> Reenviar sincronização
                          </DropdownMenuItem>
                        ),
                      })
                      if (pendingSale?.syncBlockedCode === "CAIXA_ORIGINAL_FECHADO") {
                        menuAcoes.push({
                          key: "retro",
                          node: (
                            <DropdownMenuItem onClick={() => setRetroativoConfirmId(v.id)}>
                              <Clock className="h-4 w-4 mr-2" /> Sincronizar retroativo
                            </DropdownMenuItem>
                          ),
                        })
                      }
                      menuAcoes.push({
                        key: "discard",
                        node: (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDescartandoLocalId(v.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Descartar venda local
                          </DropdownMenuItem>
                        ),
                      })
                    } else if (isQuarantined) {
                      menuAcoes.push({
                        key: "conflict",
                        node: (
                          <DropdownMenuItem onClick={() => void openDetalhe(v.rowKey)}>
                            <AlertTriangle className="h-4 w-4 mr-2" /> Ver conflito
                          </DropdownMenuItem>
                        ),
                      })
                      menuAcoes.push({
                        key: "recover",
                        node: (
                          <DropdownMenuItem onClick={() => openRecoverDialog(v.id)}>
                            <RotateCcw className="h-4 w-4 mr-2" /> Recuperar venda
                          </DropdownMenuItem>
                        ),
                      })
                    }
                    return (
                      <TableRow
                        key={v.rowKey}
                        onClick={() => void openDetalhe(v.rowKey)}
                        className={cn(
                          "group cursor-pointer border-border transition-colors hover:bg-muted/30",
                          v.cancelada && "opacity-80 bg-destructive/[0.02]",
                        )}
                      >
                        <TableCell className="tabular-nums">
                          <div className="text-foreground font-medium">{date}</div>
                          <div className="text-[11px] text-muted-foreground">{time}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-foreground">{displayId}</span>
                            {(isPendenteSync || v.kind === "LOCAL_PENDING") && (
                              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[9px] px-1 py-0 text-warning">
                                Pendente
                              </Badge>
                            )}
                            {isQuarantined && (
                              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[9px] px-1 py-0 text-destructive">
                                Quarentena
                              </Badge>
                            )}
                          </div>
                          {isQuarantined && v.id !== displayId && (
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{v.id}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-foreground truncate max-w-[160px] inline-block" title={v.cliente}>
                            {v.cliente}
                          </span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap pr-4">
                          <span className={cn("font-bold tabular-nums text-foreground", v.cancelada && "line-through text-muted-foreground")}>
                            {fmtBrl(v.total)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-xs text-muted-foreground">{v.formaPagamento}</span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-center tabular-nums text-muted-foreground">
                          {v.quantidadeItens}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <span className="text-xs text-muted-foreground truncate max-w-[100px] inline-block" title={v.operador ?? ""}>
                            {v.operador ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          {v.terminalId ? (
                            <Badge variant="outline" className="text-[10px]">
                              <Monitor className="mr-1 h-3 w-3" />
                              {terminalMap.get(v.terminalId)?.code || "PDV"}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Sem terminal</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px] font-semibold", statusBadgeClass(v.status))}>
                            {statusLabel(v.status)}
                          </Badge>
                        </TableCell>
                        {/* Ações enxutas: 2 diretas + menu "⋯". stopPropagation impede o
                            clique nas ações de abrir o detalhe (linha inteira é clicável). */}
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          className="w-[130px] min-w-[120px] text-right sticky right-0 z-30 bg-card border-l border-border/60 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.10)]"
                        >
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void openDetalhe(v.rowKey)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Detalhes</TooltipContent>
                            </Tooltip>
                            {!isPendenteSync && !isQuarantined ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void openCupomFromRow(v.id)}>
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Imprimir</TooltipContent>
                              </Tooltip>
                            ) : isQuarantined ? (
                              // Quarentena técnica: a ação disponível é apenas abrir a
                              // orientação; reenvio/retroativo/descarte ficam ausentes.
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => void openDetalhe(v.rowKey)}
                                  >
                                    <AlertTriangle className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{SALE_IDENTITY_CONFLICT_TITLE} — ver detalhes</TooltipContent>
                              </Tooltip>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-warning hover:text-warning hover:bg-warning/10"
                                    onClick={() => void handleReenviarSync(v.id)}
                                    disabled={reenviandoId === v.id}
                                  >
                                    {reenviandoId === v.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reenviar sincronização</TooltipContent>
                              </Tooltip>
                            )}
                            {menuAcoes.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {menuAcoes.map((acao) => (
                                  <div key={acao.key}>{acao.node}</div>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && !loading && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Página {page + 1} de {totalPages} · {total.toLocaleString("pt-BR")} vendas
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Detalhe Drawer ─────────────────────────────────────────────────────── */}
      <Sheet
        open={detalheOpen}
        onOpenChange={(open) => {
          setDetalheOpen(open)
          if (!open) {
            setDetalhePendenteLocal(null)
            setDetalhe(null)
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0 bg-card border-border">
          <SheetHeader className="shrink-0 space-y-0 border-b border-border px-6 pt-5 pb-4">
            <div className="flex items-start gap-3 pr-8 min-w-0">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Receipt className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-lg font-bold leading-tight text-foreground">
                  {detalhePendenteLocal
                    ? isProvisionalSaleRef(detalhePendenteLocal.id)
                      ? displaySaleNumber(detalhePendenteLocal.id, true)
                      : `Venda ${detalhePendenteLocal.id}`
                    : detalhe
                      ? `Venda ${detalhe.id}`
                      : "Detalhes da Venda"}
                  {detalhePendenteLocal ? (
                    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] font-semibold text-warning">
                      Pendente
                    </Badge>
                  ) : detalhe ? (
                    <Badge variant="outline" className={cn("text-[10px] font-semibold", statusBadgeClass(detalhe.status))}>
                      {statusLabel(detalhe.status)}
                    </Badge>
                  ) : null}
                </SheetTitle>
                {detalhePendenteLocal ? (
                  <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
                    {fmtDate(detalhePendenteLocal.at)} · Pendente de sincronização
                  </SheetDescription>
                ) : detalhe ? (
                  <SheetDescription className="mt-0.5 text-xs text-muted-foreground">
                    {fmtDate(detalhe.at)} · {detalhe.operador ?? "Operador"}
                    {detalhe.terminal ? <> · {detalhe.terminal.name || detalhe.terminal.code}</> : null}
                  </SheetDescription>
                ) : (
                  <SheetDescription className="mt-0.5 text-xs text-muted-foreground">Carregando…</SheetDescription>
                )}
              </div>
            </div>
          </SheetHeader>

          {/* Faixa herói — o total é o que o operador procura primeiro. */}
          {(detalhePendenteLocal || detalhe) && (
            <div className="shrink-0 border-b border-border bg-muted/30 px-6 py-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total</p>
                  <p
                    className={cn(
                      "text-xl font-bold tabular-nums leading-tight",
                      detalhe?.status === "cancelada" ? "text-muted-foreground line-through" : "text-primary",
                    )}
                  >
                    {fmtBrl((detalhePendenteLocal ?? detalhe)!.total)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Itens</p>
                  <p className="text-xl font-bold tabular-nums leading-tight text-foreground">
                    {detalhePendenteLocal
                      ? detalhePendenteLocal.lines.reduce((s, l) => s + l.quantity, 0)
                      : detalhe!.itens.reduce((s, it) => s + it.quantidade, 0)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pagamento</p>
                  <p
                    className="mt-1 truncate text-sm font-semibold leading-tight text-foreground"
                    title={
                      detalhePendenteLocal
                        ? paymentBreakdownLabels(detalhePendenteLocal.paymentBreakdown).join(" + ")
                        : detalhe!.pagamentos.map((pg) => pg.label).join(" + ")
                    }
                  >
                    {(detalhePendenteLocal
                      ? paymentBreakdownLabels(detalhePendenteLocal.paymentBreakdown).join(" + ")
                      : detalhe!.pagamentos.map((pg) => pg.label).join(" + ")) || "—"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/*
            Procedência de recuperação. Deliberadamente discreta e em tom neutro: a
            venda é normal e o número atual é o canônico. O número antigo aparece
            apenas como trilha de auditoria, nunca como erro permanente.
          */}
          {!detalhePendenteLocal && detalhe?.recovery && (
            <div className="shrink-0 border-b border-border bg-muted/20 px-6 py-2.5">
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  Venda recuperada de conflito de identificação · Número original{" "}
                  <span className="font-mono text-foreground">
                    {detalhe.recovery.recoveredFromPedidoId}
                  </span>
                  {detalhe.recovery.recoveredAt && <> · {fmtDate(detalhe.recovery.recoveredAt)}</>}
                </span>
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {detalhePendenteLocal ? (
              <>
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1 min-w-0">
                    <p className="font-semibold text-foreground">
                      Venda pendente de sincronização
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Esta venda ainda não foi confirmada no servidor. Os dados abaixo vêm apenas do dispositivo local.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Informações</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Cupom / pedido</p>
                      <p className="font-mono text-xs font-semibold text-foreground">{detalhePendenteLocal.id}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Data</p>
                      <p className="font-medium text-foreground">{fmtDate(detalhePendenteLocal.at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cliente</p>
                      <p className="font-medium text-foreground">{detalhePendenteLocal.customerName?.trim() || "—"}</p>
                    </div>
                    {detalhePendenteLocal.customerCpf && (
                      <div>
                        <p className="text-xs text-muted-foreground">CPF</p>
                        <p className="font-medium text-foreground">{detalhePendenteLocal.customerCpf}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Operador</p>
                      <p className="font-medium text-foreground">{sanitizeOperatorLabel(detalhePendenteLocal.cashierId) || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Terminal</p>
                      {detalhePendenteLocal.terminalId ? (
                        <p className="font-medium text-foreground">
                          {terminalMap.get(detalhePendenteLocal.terminalId)?.name
                            || terminalMap.get(detalhePendenteLocal.terminalId)?.code
                            || detalhePendenteLocal.terminalId}
                        </p>
                      ) : (
                        <p className="font-medium text-muted-foreground">Sem terminal</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Loja</p>
                      <p className="text-xs text-foreground">{unidadeLabel || "—"}</p>
                    </div>
                  </div>
                </div>

                <Separator className="bg-border" />

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Itens ({detalhePendenteLocal.lines.length})
                  </h3>
                  {detalhePendenteLocal.lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum item no registro local</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detalhePendenteLocal.lines.map((it, i) => (
                        <div key={`${it.inventoryId}-${i}`} className="flex items-center justify-between text-sm py-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground truncate">{it.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {it.quantity}x {fmtBrl(it.unitPrice)}
                            </p>
                          </div>
                          <p className="font-semibold text-foreground ml-4 shrink-0">{fmtBrl(it.lineTotal)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator className="bg-border" />

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pagamento</h3>
                  {(() => {
                    const pagamentos = saleRecordToPagamentos(detalhePendenteLocal)
                    return pagamentos.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <div className="space-y-1">
                        {pagamentos.map((pg, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{pg.label}</span>
                            <span className="font-medium text-foreground">{fmtBrl(pg.valor)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  <div className="flex justify-between font-bold text-base text-foreground pt-1 border-t border-border">
                    <span>Total</span>
                    <span>{fmtBrl(detalhePendenteLocal.total)}</span>
                  </div>
                </div>

                {conflitoIdentidade && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Venda precisa de recuperação
                    </p>
                    <p>
                      O número desta venda já estava em uso. Seus dados foram preservados e nenhuma venda existente foi
                      alterada.
                    </p>
                    <p className="text-muted-foreground">
                      Número conflitante: <span className="font-mono text-foreground">{detalhePendenteLocal.id}</span>
                    </p>
                  </div>
                )}

                {!conflitoIdentidade && pendenteLocalLive?.syncBlockedCode === "CAIXA_ORIGINAL_FECHADO" && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Venda de caixa já fechado
                    </p>
                    <p>Data original: {fmtDate(detalhePendenteLocal.at)}</p>
                    <p>Esta venda será lançada retroativamente na sessão de caixa original.</p>
                    <p className="font-medium">Isso pode alterar uma conferência/fechamento antigo.</p>
                  </div>
                )}

                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Próximos passos</p>
                  {conflitoIdentidade ? (
                    <p>
                      Preserve os dados desta venda neste dispositivo. A recuperação gera um <span className="font-medium text-foreground">novo número server-side</span> e
                      nunca altera a venda que já ocupa o número conflitante.
                    </p>
                  ) : (
                    <>
                      <p>
                        Clique em <span className="font-medium text-foreground">Reenviar sincronização</span> para tentar
                        gravar de novo no servidor. Se a venda nunca chegou no banco (operador, rede ou validação) e você
                        quer apenas limpar o registro local, use{" "}
                        <span className="font-medium text-foreground">Descartar venda local</span>.
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Importante:</span> descartar é limpeza LOCAL — o
                        sistema verifica no servidor antes. Se a venda já tiver sido gravada no banco, o descarte é
                        bloqueado e ela é reconciliada como sincronizada. Estoque, financeiro e caixa de vendas não
                        persistidas permanecem intactos.
                      </p>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  {conflitoIdentidade && (
                    <Button
                      type="button"
                      className="h-10 gap-2 text-sm"
                      onClick={() => openRecoverDialog(detalhePendenteLocal.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Recuperar venda
                    </Button>
                  )}
                  {pendingSaleSyncActions.canManualRetry && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 gap-2 text-sm border-warning/40 text-warning hover:bg-warning/10"
                      onClick={() => void handleReenviarSync(detalhePendenteLocal.id)}
                      disabled={reenviandoId === detalhePendenteLocal.id}
                    >
                      {reenviandoId === detalhePendenteLocal.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Reenviar sincronização
                    </Button>
                  )}
                  {pendingSaleSyncActions.canRetroactiveRetry &&
                    pendenteLocalLive?.syncBlockedCode === "CAIXA_ORIGINAL_FECHADO" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 gap-2 text-sm border-warning/40 text-warning hover:bg-warning/10"
                      onClick={() => setRetroativoConfirmId(detalhePendenteLocal.id)}
                    >
                      <Clock className="h-4 w-4" />
                      Sincronizar retroativo
                    </Button>
                  )}
                  {pendingSaleSyncActions.canDiscard && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 gap-2 text-sm text-destructive border-destructive/30 hover:bg-destructive/5"
                      onClick={() => setDescartandoLocalId(detalhePendenteLocal.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Descartar venda local
                    </Button>
                  )}
                </div>
              </>
            ) : detalheLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : detalhe ? (
              <>
                {/* Status banner */}
                {detalhe.status !== "concluida" && (
                  <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 ${statusBadgeClass(detalhe.status)}`}>
                    {detalhe.status === "cancelada" ? (
                      <XCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 shrink-0" />
                    )}
                    <div className="text-sm">
                      <p className="font-semibold">{statusLabel(detalhe.status)}</p>
                      {detalhe.canceladaEm && (
                        <p className="text-[11px] opacity-80">{fmtDate(detalhe.canceladaEm)}</p>
                      )}
                      {detalhe.motivoCancelamento && (
                        <p className="text-[11px] opacity-80">Motivo: {detalhe.motivoCancelamento}</p>
                      )}
                      {detalhe.canceladaPor && (
                        <p className="text-[11px] opacity-80">Por: {detalhe.canceladaPor}</p>
                      )}
                      {detalhe.status === "cancelada" && detalhe.estoqueReposto && (
                        <p className="text-[11px] opacity-80">Estoque reposto ao cancelar</p>
                      )}
                      {detalhe.status === "cancelada" && detalhe.estornoFinanceiro && (
                        <p className="text-[11px] opacity-80">Estorno financeiro registrado</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Client + Operator info */}
                <section className="overflow-hidden rounded-xl border border-border bg-background/40">
                  <header className="border-b border-border bg-muted/30 px-4 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Informações</p>
                  </header>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Cliente</p>
                      <p className="font-medium text-foreground">{detalhe.clienteNome ?? "—"}</p>
                    </div>
                    {detalhe.clienteCpf && (
                      <div>
                        <p className="text-xs text-muted-foreground">CPF</p>
                        <p className="font-medium text-foreground">{detalhe.clienteCpf}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Operador</p>
                      <p className="font-medium text-foreground">{detalhe.operador ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Terminal</p>
                      {detalhe.terminal ? (
                        <p className="font-medium text-foreground">
                          {detalhe.terminal.name || detalhe.terminal.code}{" "}
                          <span className="text-xs text-muted-foreground">({detalhe.terminal.code})</span>
                        </p>
                      ) : (
                        <p className="font-medium text-muted-foreground">Sem terminal</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Items */}
                <section className="overflow-hidden rounded-xl border border-border bg-background/40">
                  <header className="border-b border-border bg-muted/30 px-4 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Itens ({detalhe.itens.length})
                    </p>
                  </header>
                  <div className="px-4 py-1.5">
                    {detalhe.itens.length === 0 ? (
                      <p className="py-2 text-sm text-muted-foreground">Nenhum item registrado</p>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {detalhe.itens.map((it) => (
                          <div key={it.id} className="flex items-center justify-between text-sm py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-foreground truncate">{it.nome}</p>
                              <p className="text-xs text-muted-foreground">
                                {it.quantidade}x {fmtBrl(it.precoUnitario)}
                              </p>
                              {it.acessorio && (it.acessorio.modelLabel || it.acessorio.colorLabel) && (
                                <p className="text-xs text-muted-foreground/80 mt-0.5 break-words">
                                  Modelo: {it.acessorio.modelLabel ?? "Não informado"}
                                  {" · "}
                                  Cor: {it.acessorio.colorLabel ?? "Não informado"}
                                </p>
                              )}
                            </div>
                            <p className="font-semibold text-foreground ml-4 shrink-0 tabular-nums">{fmtBrl(it.lineTotal)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {/* Payments + Total */}
                <section className="overflow-hidden rounded-xl border border-border bg-background/40">
                  <header className="border-b border-border bg-muted/30 px-4 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagamento</p>
                  </header>
                  <div className="space-y-1 px-4 py-3">
                    {detalhe.pagamentos.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      detalhe.pagamentos.map((pg, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{pg.label}</span>
                          <span className="font-medium text-foreground tabular-nums">{fmtBrl(pg.valor)}</span>
                        </div>
                      ))
                    )}
                    {detalhe.itens.length > 0 && (
                      <div className="flex justify-between text-sm text-muted-foreground pt-1">
                        <span>Subtotal ({detalhe.itens.length} {detalhe.itens.length === 1 ? "item" : "itens"})</span>
                        <span className="tabular-nums">
                          {fmtBrl(detalhe.itens.reduce((acc, it) => acc + it.lineTotal, 0))}
                        </span>
                      </div>
                    )}
                    {(detalhe.desconto ?? 0) > 0 && (
                      <div className="flex justify-between text-sm text-destructive">
                        <span>Desconto</span>
                        <span className="tabular-nums">-{fmtBrl(detalhe.desconto)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
                    <span className="text-sm font-semibold text-foreground">Total</span>
                    <span className="text-lg font-bold tabular-nums text-primary">{fmtBrl(detalhe.total)}</span>
                  </div>
                </section>

                {/* Devoluções vinculadas */}
                {detalhe.devolucoes.length > 0 && (
                  <>
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Devoluções ({detalhe.devolucoes.length})
                      </h3>
                      {detalhe.devolucoes.map((dev) => {
                        const isTrocaImediata = dev.modo === "troca_imediata"
                        const badgeLabel = isTrocaImediata
                          ? "Troca imediata"
                          : dev.tipo === "vale_credito"
                            ? "Vale/Crédito"
                            : dev.tipo === "troca"
                              ? "Troca"
                              : dev.tipo === "devolucao"
                                ? "Devolução"
                                : "Estoque"
                        return (
                          <div key={dev.id} className="rounded-lg border border-border bg-background/40 p-3 text-sm space-y-1">
                            <div className="flex justify-between">
                              <Badge variant="outline" className={`text-[10px] ${isTrocaImediata ? "border-primary/40 bg-primary/10 text-primary" : ""}`}>
                                {badgeLabel}
                              </Badge>
                              <span className="font-semibold text-destructive">{fmtBrl(dev.valorTotal)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{fmtDate(dev.at)} · {dev.operador || "Operador"}</p>
                            {dev.creditoEmitido > 0 && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400">Crédito gerado: {fmtBrl(dev.creditoEmitido)}</p>
                            )}
                            {dev.motivo && <p className="text-xs text-muted-foreground">Motivo: {dev.motivo}</p>}
                            {dev.itens.map((it, i) => (
                              <p key={i} className="text-xs text-foreground/70">{it.quantidade}x {it.nome}</p>
                            ))}
                            {/* Mini-timeline da troca imediata */}
                            {isTrocaImediata && (
                              <div className="mt-2 rounded border border-primary/20 bg-primary/5 p-2 text-[11px]">
                                <p className="font-semibold text-primary mb-1">Fluxo da troca</p>
                                <p className="font-mono text-foreground/80">
                                  {detalhe.id} <span className="text-muted-foreground">→</span> dev {dev.localId}
                                  {dev.novaVendaId ? (
                                    <>
                                      {" "}<span className="text-muted-foreground">→</span> nova venda <span className="text-primary">{dev.novaVendaId}</span>
                                    </>
                                  ) : null}
                                </p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
                {/* Saldo em haver — mostrado quando há crédito vinculado ao CPF desta venda */}
                {saldoCredito !== null && detalhe?.clienteCpf && (
                  <>
                    <div className={`rounded-lg border p-3 text-sm ${
                      saldoCredito > 0
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-muted bg-muted/20"
                    }`}>
                      <p className={`text-xs font-semibold ${
                        saldoCredito > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                      }`}>
                        {saldoCredito > 0 ? `Saldo em haver: ${fmtBrl(saldoCredito)}` : "Crédito totalmente utilizado"}
                      </p>
                      {saldoCredito > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">Disponível para uso no PDV</p>
                      )}
                    </div>
                  </>
                )}

                {/* Histórico de correções */}
                {detalhe.correcoes && detalhe.correcoes.length > 0 && (
                  <>
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="h-3 w-3" />
                        Correções ({detalhe.correcoes.length})
                      </h3>
                      {detalhe.correcoes.map((c, i) => (
                        <div key={i} className="rounded-lg border border-border bg-background/40 p-3 text-sm space-y-1">
                          <div className="flex justify-between items-start">
                            <Badge variant="outline" className="text-[10px]">Correção</Badge>
                            <span className="text-[11px] text-muted-foreground">{fmtDate(c.at)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{c.operador}{c.supervisorNome ? ` · Supervisor: ${c.supervisorNome}` : ""}</p>
                          <p className="text-xs text-foreground/80">Motivo: {c.motivo}</p>
                          {c.campos.includes("formaPagamento") && (
                            <p className="text-xs text-foreground/70">
                              Pagamento: <span className="line-through text-muted-foreground">{c.pagamentoAnterior}</span>{" → "}<span className="font-medium">{c.pagamentoNovo}</span>
                            </p>
                          )}
                          {c.campos.includes("cliente") && (
                            <p className="text-xs text-foreground/70">
                              Cliente: <span className="line-through text-muted-foreground">{c.clienteAnterior ?? "—"}</span>{" → "}<span className="font-medium">{c.clienteNovo ?? "—"}</span>
                            </p>
                          )}
                          {c.campos.includes("observacao") && (
                            <p className="text-xs text-foreground/70">
                              Obs.: <span className="line-through text-muted-foreground">{c.observacaoAnterior ?? "—"}</span>{" → "}<span className="font-medium">{c.observacaoNova ?? "—"}</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Não foi possível carregar o detalhe.</p>
              </div>
            )}
          </div>

          {/* Drawer actions — apenas vendas persistidas no servidor */}
          {detalhe && !detalheLoading && !detalhePendenteLocal && (
            <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-4 space-y-2">
              {/* Hierarquia: Imprimir é a ação primária; correção/troca secundárias;
                  Cancelar destrutivo isolado, sem o mesmo peso das demais. */}
              <div className="flex gap-2">
                <Button className="flex-1 h-10 gap-2 text-sm" onClick={() => openCupom(detalhe)}>
                  <Printer className="h-4 w-4" />
                  Imprimir recibo
                </Button>
                {detalhe.status !== "cancelada" && (
                  <Button
                    variant="outline"
                    className="flex-1 h-10 gap-2 text-sm"
                    onClick={() => setWorkspaceVendaId(detalhe.id)}
                  >
                    <Wrench className="h-4 w-4" />
                    Corrigir venda
                  </Button>
                )}
              </div>
              {detalhe.status !== "cancelada" && (
                <div className="flex items-center gap-2">
                  {detalhe.status !== "devolvida" && (
                    <Button
                      variant="outline"
                      className="flex-1 h-10 gap-2 text-sm"
                      onClick={() => openTroca(detalhe.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Trocar / Devolver
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="h-10 gap-2 px-4 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setCancelandoId(detalhe.id)
                      setCancelMotivo("")
                      setCancelConfirmForcar(false)
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Cancel Dialog ──────────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!cancelandoId}
        onOpenChange={(o) => {
          if (!o && !cancelLoading) {
            setCancelandoId(null)
            setCancelMotivo("")
            setCancelConfirmForcar(false)
          }
        }}
      >
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                {cancelLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 space-y-1">
                <AlertDialogTitle className="text-foreground text-left">
                  {cancelConfirmForcar ? "Confirmar cancelamento com devoluções" : "Cancelar venda"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground text-left">
                  {cancelConfirmForcar
                    ? "Esta venda possui devoluções registradas. O cancelamento irá apenas marcar a venda — as devoluções serão mantidas."
                    : `A venda ${cancelandoId ?? ""} será marcada como cancelada no histórico.`}
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          {!cancelConfirmForcar && (
            <div className="space-y-3 py-1">
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                  Atenção
                </p>
                <p>
                  O cancelamento registra o motivo e marca a venda como cancelada. A reposição de estoque e o estorno
                  financeiro (caixa e títulos a prazo) são aplicados automaticamente quando houver.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cancel-motivo" className="text-sm text-foreground">
                  Motivo do cancelamento <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="cancel-motivo"
                  placeholder="Descreva o motivo (obrigatório)…"
                  value={cancelMotivo}
                  onChange={(e) => setCancelMotivo(e.target.value)}
                  className="min-h-[88px] resize-none bg-background border-border"
                  disabled={cancelLoading}
                  autoFocus
                />
              </div>
            </div>
          )}

          {cancelConfirmForcar && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
              Deseja continuar mesmo assim?
            </div>
          )}

          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border" disabled={cancelLoading}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
              disabled={cancelLoading || (!cancelConfirmForcar && !cancelMotivo.trim())}
              onClick={(e) => {
                e.preventDefault()
                void handleCancelar(cancelConfirmForcar)
              }}
            >
              {cancelLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {cancelLoading ? "Cancelando…" : cancelConfirmForcar ? "Confirmar mesmo assim" : "Confirmar cancelamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Descarte de venda local pendente (individual) ─────────────────────── */}
      <AlertDialog
        open={!!descartandoLocalId}
        onOpenChange={(o) => {
          if (!o && !descartandoLocalLoading) setDescartandoLocalId(null)
        }}
      >
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
                {descartandoLocalLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Trash2 className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 space-y-1">
                <AlertDialogTitle className="text-foreground text-left">
                  Descartar venda local pendente
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground text-left">
                  Esta é uma limpeza <span className="font-medium text-foreground">LOCAL</span>. O sistema irá verificar
                  no servidor antes — se a venda <span className="font-mono text-xs">{descartandoLocalId ?? ""}</span> já
                  estiver gravada no banco, o descarte é bloqueado e ela é reconciliada como sincronizada.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
              Garantias
            </p>
            <p>· Nunca apaga venda confirmada no servidor.</p>
            <p>· Não altera estoque, financeiro ou caixa.</p>
            <p>· Apenas remove o registro local deste dispositivo.</p>
          </div>
          {descartandoLocalId && conflitoIdentidadeIds.has(descartandoLocalId) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {SALE_IDENTITY_CONFLICT_TITLE}
              </p>
              <p>{SALE_IDENTITY_CONFLICT_GUIDANCE}</p>
            </div>
          )}
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border" disabled={descartandoLocalLoading}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90 gap-2"
              disabled={
                descartandoLocalLoading ||
                (!!descartandoLocalId && conflitoIdentidadeIds.has(descartandoLocalId))
              }
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDescarteLocal()
              }}
            >
              {descartandoLocalLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {descartandoLocalLoading ? "Verificando…" : "Confirmar descarte local"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sync retroativo (venda pendente com sessão de caixa original fechada) ── */}
      <AlertDialog
        open={!!retroativoConfirmId}
        onOpenChange={(o) => {
          if (!o && !retroativoLoading) setRetroativoConfirmId(null)
        }}
      >
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
                {retroativoLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 space-y-1">
                <AlertDialogTitle className="text-foreground text-left">
                  Confirmar sincronização retroativa
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground text-left">
                  A venda <span className="font-mono text-xs">{retroativoConfirmId ?? ""}</span> pertence a uma sessão de
                  caixa já fechada. Ela será gravada na sessão de caixa ORIGINAL (não no caixa de hoje), preservando data e
                  valores originais. Isso pode alterar uma conferência/fechamento já encerrado daquele dia.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
              Garantias
            </p>
            <p>· Nunca sincroniza no caixa atual — mantém a sessão e a data originais.</p>
            <p>· Não duplica venda, estoque ou movimentação financeira em reenvios repetidos.</p>
            <p>· Ação manual: só ocorre com esta confirmação explícita.</p>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border" disabled={retroativoLoading}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90 gap-2"
              disabled={retroativoLoading}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmReenviarRetroativo()
              }}
            >
              {retroativoLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {retroativoLoading ? "Sincronizando…" : "Confirmar sincronização retroativa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!recoveringSaleId && !recoverClosedSessionConfirm}
        onOpenChange={(o) => {
          if (!o && !recoverLoading) {
            setRecoveringSaleId(null)
            setRecoverMotivo("")
          }
        }}
      >
        <DialogContent className="border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Venda precisa de recuperação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              O número desta venda já estava em uso. Seus dados foram preservados e nenhuma venda existente foi
              alterada.
            </p>
            {recoveringSale && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs space-y-1">
                <p>Número conflitante: <span className="font-mono text-foreground">{recoveringSale.id}</span></p>
                <p>Data: <span className="text-foreground">{fmtDate(recoveringSale.at)}</span></p>
                <p>Total: <span className="text-foreground">{fmtBrl(recoveringSale.total)}</span></p>
                <p>
                  Pagamento:{" "}
                  <span className="text-foreground">
                    {paymentBreakdownLabels(recoveringSale.paymentBreakdown).join(" + ") || "—"}
                  </span>
                </p>
                <p>Itens: <span className="text-foreground">{recoveringSale.lines.length}</span></p>
                <p>Terminal: <span className="text-foreground">{recoveringSale.terminalId || "Sem terminal"}</span></p>
                <p>Sessão original: <span className="font-mono text-foreground">{recoveringSale.sessaoId || "—"}</span></p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="recover-motivo" className="text-sm text-foreground">
                Motivo da recuperação <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="recover-motivo"
                placeholder="Descreva o motivo (mínimo 5 caracteres)…"
                value={recoverMotivo}
                onChange={(e) => setRecoverMotivo(e.target.value)}
                className="min-h-[88px] resize-none bg-background border-border"
                disabled={recoverLoading}
              />
            </div>
            <p className="text-xs">
              A recuperação usa o Writer V2, gera um novo número server-side e aplica estoque/financeiro uma única vez.
              A venda antiga permanece intacta.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={recoverLoading}
                onClick={() => {
                  setRecoveringSaleId(null)
                  setRecoverMotivo("")
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={recoverLoading || recoverMotivo.trim().length < 5}
                onClick={() => void handleRecoverQuarantined(false)}
              >
                {recoverLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Recuperar venda
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={recoverClosedSessionConfirm}
        onOpenChange={(o) => {
          if (!o && !recoverLoading) setRecoverClosedSessionConfirm(false)
        }}
      >
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-left">Lançamento retroativo</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-left space-y-2">
              <span className="block">
                A sessão de caixa original desta venda já está fechada. A recuperação usa a sessão original — não joga
                no caixa atual.
              </span>
              <span className="block">
                A venda que ocupa o número antigo permanece intacta. Um novo número será gerado no servidor. Estoque e
                financeiro são aplicados uma única vez.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border" disabled={recoverLoading}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90 gap-2"
              disabled={recoverLoading}
              onClick={(e) => {
                e.preventDefault()
                void handleRecoverQuarantined(true)
              }}
            >
              {recoverLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar lançamento retroativo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Recuperação administrada EM LOTE das quarentenas ──────────────────── */}
      <QuarentenaRecoveryDialog
        open={quarentenaRecoveryOpen}
        onOpenChange={setQuarentenaRecoveryOpen}
        unidadeLabel={unidadeLabel || undefined}
        onFinished={() => {
          void fetchRemoteSales()
          load()
        }}
      />

      {/* ── Limpeza em lote de pendentes locais (administrativa) ──────────────── */}
      <AlertDialog
        open={bulkLimparOpen}
        onOpenChange={(o) => {
          if (!o && !bulkLimparLoading) setBulkLimparOpen(false)
        }}
      >
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
                {bulkLimparLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ListChecks className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 space-y-1">
                <AlertDialogTitle className="text-foreground text-left">
                  Limpar pendentes locais ({pendingSyncIds.size})
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground text-left">
                  Ação administrativa. Para CADA venda pendente, o sistema consulta o servidor:
                  <span className="block mt-1">· Já existe no banco → reconcilia como sincronizada (NÃO descarta).</span>
                  <span className="block">· Não existe → descarta apenas o registro local.</span>
                  <span className="block">· Conflito técnico de identificação → mantém em quarentena (NÃO descarta).</span>
                  <span className="block">· Erro na consulta → contabiliza conflito e mantém pendente.</span>
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
              Esta é uma limpeza LOCAL — não cancela vendas fiscais nem altera caixa/estoque/financeiro.
            </p>
            <p>Vendas confirmadas no servidor permanecem intactas no histórico.</p>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border" disabled={bulkLimparLoading}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90 gap-2"
              disabled={bulkLimparLoading || pendingSyncIds.size === 0}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmBulkLimpar()
              }}
            >
              {bulkLimparLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {bulkLimparLoading ? "Verificando no servidor…" : "Limpar pendentes locais"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cupom Modal ────────────────────────────────────────────────────────── */}
      {cupomData && (
        <CupomNaoFiscal
          isOpen={cupomOpen}
          onClose={() => setCupomOpen(false)}
          data={cupomData}
        />
      )}

      {/* ── Troca / Devolução ──────────────────────────────────────────────────── */}
      <Dialog
        open={trocaOpen}
        onOpenChange={(o) => {
          if (!o) closeTroca()
        }}
      >
        <DialogContent className="max-h-[min(90vh,680px)] w-[min(100vw-2rem,82rem)] sm:max-w-[82rem] border-border bg-card p-0 flex flex-col overflow-hidden">
          <DialogHeader className="border-b border-border px-4 py-3 sm:px-6">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              Troca / Devolução
              {trocaSaleId && (
                <span className="font-mono text-xs font-normal text-muted-foreground">{trocaSaleId}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6">
            <Suspense fallback={
              <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Carregando formulário…</span>
              </div>
            }>
              {trocaSaleId && (
                <TrocasDevolucao
                   key={trocaSaleId}
                   initialSaleId={trocaSaleId}
                   initialSale={trocaInitialSale}
                   onRegistered={() => {
                     load()
                     if (detalhe?.id === trocaSaleId) void openDetalhe(trocaSaleId)
                     closeTroca()
                   }}
                />
              )}
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Workspace Enterprise da Venda — ficha completa + correções (única via) ── */}
      <WorkspaceCorrecaoVenda
        vendaId={workspaceVendaId}
        storeId={storeId}
        open={!!workspaceVendaId}
        onOpenChange={(o) => { if (!o) setWorkspaceVendaId(null) }}
      />

    </div>
    </TooltipProvider>
  )
}
