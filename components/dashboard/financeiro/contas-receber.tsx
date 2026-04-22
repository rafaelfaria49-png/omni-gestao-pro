"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { flushSync } from "react-dom"
import { useRouter } from "next/navigation"
import {
  Plus,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Calendar,
  User,
  Pencil,
  Trash2,
  Banknote,
  Undo2,
  Printer,
  AlertTriangle,
  RotateCcw,
  ChevronRight,
  Receipt,
  X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { useFinanceiro } from "@/lib/financeiro-store"
import { contasReceberLegacyImportKey, contasReceberStorageKey } from "@/lib/contas-receber-storage"
import type { ContaReceberRow } from "@/lib/contas-receber-types"
export type { ContaReceberRow } from "@/lib/contas-receber-types"
import {
  calcSaldoDevedorClienteTodaLoja,
  FORMAS_PAGAMENTO_RECIBO,
  imprimirReciboPagamento,
  RECIBO_LOJA_NOME_PADRAO,
} from "@/lib/contas-receber-recibo"
import { useToast } from "@/hooks/use-toast"
import type { PagamentoLinha } from "@/lib/contas-receber-pagamentos"
import {
  ensureHistoricoMigrado,
  extrairLinhasEstornoLog,
  extrairLinhasSistema,
  extrairObservacoesLivres,
  gerarIdPagamento,
  gerarIdParcelaPlano,
  isoParaBr,
  listarPagamentosEfetivos,
  parcelaJaConstaComoPaga,
  precisaPersistirMigracaoHistorico,
  rebuildObservacoesPagamento,
  brParaIso,
  tituloExibicaoHistoricoPagamento,
  vencimentoParcelaParaEstorno,
} from "@/lib/contas-receber-pagamentos"

const FRASE_CONFIRMACAO_LIMPAR = "EXCLUIR TUDO"

const menuBaixaClass =
  "text-green-600 focus:text-green-700 focus:bg-green-500/15 cursor-pointer font-medium"
const menuExcluirClass = "text-red-600 focus:text-red-700 focus:bg-red-500/15 cursor-pointer font-medium"
const menuEstornoClass =
  "text-orange-600 focus:text-orange-700 focus:bg-orange-500/15 cursor-pointer font-medium"

type BaixaModalModo = "receber" | "marcarComRecibo" | "reemitir"

function normBuscaTxt(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** LocalStorage tem prioridade: só acrescenta títulos que existem no servidor e ainda não estão no browser. */
function mergeContasLocalWins(local: ContaReceberRow[], server: ContaReceberRow[]): ContaReceberRow[] {
  const ids = new Set(local.map((c) => String(c.id)))
  const extra = server.filter((c) => !ids.has(String(c.id)))
  return extra.length ? [...local, ...extra] : local
}

function parseValorBr(s: string): number {
  const x = s
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "")
  if (!x) return 0
  const norm = x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "")
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/**
 * Regra: Novo saldo devedor = saldo atual + valor estornado (entrada do contrato não é reaplicada aqui).
 * Em título quitado, `valor` espelha o montante da quitação; se coincide com o estorno integral, reabre com esse mesmo saldo.
 */
function restaurarSaldoDevedorAposEstorno(conta: ContaReceberRow, valorEstornado: number): number {
  const v = Math.round((Number(conta.valor) || 0) * 100) / 100
  const pm = Math.round(valorEstornado * 100) / 100
  const st = (conta.status || "").toLowerCase()
  if (st === "pago" && Math.abs(v - pm) <= 0.02) {
    return Math.max(v, pm)
  }
  return Math.min(Math.round((v + pm) * 100) / 100, 1e12)
}

function montarObservacoesAposEstorno(
  conta: ContaReceberRow,
  newHist: PagamentoLinha[],
  valorEstorno: number,
  dataBr: string
): string {
  const livre = extrairObservacoesLivres(conta.observacoesPagamento)
  const sistema = extrairLinhasSistema(conta.observacoesPagamento)
  const prevLogs = extrairLinhasEstornoLog(conta.observacoesPagamento)
  const novaLinhaLog = `Estorno de R$ ${valorEstorno.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} realizado em ${dataBr}`
  const logs = [...prevLogs, novaLinhaLog].filter((x, i, a) => a.indexOf(x) === i)
  return rebuildObservacoesPagamento({
    observacoesLivre: livre,
    historico: newHist,
    linhasSistemaExtras: sistema,
    linhasLogsEstorno: logs,
  })
}

function inferirStatusTituloAposEstorno(conta: ContaReceberRow, novoSaldo: number): string {
  if (novoSaldo <= 0.009) return "pago"
  const d = parseBrDate(conta.vencimento ?? "")
  if (!d) return "pendente"
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return d.getTime() < hoje.getTime() ? "atrasado" : "pendente"
}

/** Remove linhas do histórico estruturado e recalcula saldo ao apagar recebimentos PAGO (espelha estorno local). */
function aplicarRemocoesHistoricoConta(
  conta: ContaReceberRow,
  idsRemover: string[]
): { conta: ContaReceberRow; movimentoIdsRemovidos: string[] } {
  if (idsRemover.length === 0) return { conta, movimentoIdsRemovidos: [] }
  const mig = ensureHistoricoMigrado(conta)
  const remover = new Set(idsRemover)
  const removidos = mig.historicoPagamentos.filter((h) => remover.has(h.id))
  const newHist = mig.historicoPagamentos.filter((h) => !remover.has(h.id))
  let valorTitulo = Number(conta.valor) || 0
  const movimentoIdsRemovidos: string[] = []
  for (const l of removidos) {
    if (l.status === "PAGO" && Number(l.valor) > 0) {
      valorTitulo = Math.round((valorTitulo + l.valor) * 100) / 100
      if (l.movimentoId) movimentoIdsRemovidos.push(l.movimentoId)
    }
  }
  const livre = extrairObservacoesLivres(conta.observacoesPagamento)
  const sistema = extrairLinhasSistema(conta.observacoesPagamento)
  const obs = rebuildObservacoesPagamento({
    observacoesLivre: livre,
    historico: newHist,
    linhasSistemaExtras: sistema,
    linhasLogsEstorno: extrairLinhasEstornoLog(conta.observacoesPagamento),
  })
  let movimentoBaixaId = conta.movimentoBaixaId
  for (const l of removidos) {
    if (l.movimentoId && movimentoBaixaId === l.movimentoId) movimentoBaixaId = undefined
  }
  const novoStatus = inferirStatusTituloAposEstorno(conta, valorTitulo)
  return {
    conta: {
      ...conta,
      valor: valorTitulo,
      status: novoStatus,
      historicoPagamentos: newHist,
      observacoesPagamento: obs,
      movimentoBaixaId,
    },
    movimentoIdsRemovidos,
  }
}

/** Mantém só linhas PAGO e remove logs textuais de estorno (limpeza de testes / ruído). */
function limparEstornosHistoricoConta(conta: ContaReceberRow): ContaReceberRow {
  const mig = ensureHistoricoMigrado(conta)
  const newHist = mig.historicoPagamentos.filter((h) => h.status === "PAGO")
  const livre = extrairObservacoesLivres(conta.observacoesPagamento)
  const sistema = extrairLinhasSistema(conta.observacoesPagamento)
  const obs = rebuildObservacoesPagamento({
    observacoesLivre: livre,
    historico: newHist,
    linhasSistemaExtras: sistema,
    linhasLogsEstorno: [],
  })
  return { ...conta, historicoPagamentos: newHist, observacoesPagamento: obs }
}

/**
 * Saldo que deve ser diluído nas parcelas: se houver `total_value` e `entry_value`,
 * usa no máximo (total − entrada) e nunca mais que o saldo devedor atual (`valor`).
 * Ex.: (1290 − 200) / 4 = 272,50.
 */
function saldoParaParcelamento(conta: ContaReceberRow): number {
  const v = Number(conta.valor) || 0
  if (conta.total_value == null || conta.entry_value == null) return v
  const total = Number(conta.total_value)
  const entry = Number(conta.entry_value)
  if (!Number.isFinite(total) || !Number.isFinite(entry)) return v
  const entryClamped = Math.max(0, Math.round(entry * 100) / 100)
  const aposEntrada = Math.max(0, Math.round((total - entryClamped) * 100) / 100)
  return Math.min(v, aposEntrada)
}

function valorParcelaSugerido(conta: ContaReceberRow, numParcelas: number): number {
  const n = Math.max(1, Math.min(12, Math.round(numParcelas) || 1))
  const base = saldoParaParcelamento(conta)
  return Math.round((base / n) * 100) / 100
}

/** total_value − entry_value quando ambos existem; caso contrário null. */
function saldoAposEntradaContrato(conta: ContaReceberRow): number | null {
  if (conta.total_value == null || conta.entry_value == null) return null
  const t = Number(conta.total_value)
  const e = Number(conta.entry_value)
  if (!Number.isFinite(t) || !Number.isFinite(e)) return null
  return Math.max(0, Math.round((t - e) * 100) / 100)
}

/**
 * Saldo em aberto antes do recebimento: min(valor gravado, total−entrada) quando há contrato,
 * para não usar total bruto (ex.: 1290) ignorando entrada (200).
 */
function saldoAberturaRecebimento(conta: ContaReceberRow): number {
  const v = Math.round((Number(conta.valor) || 0) * 100) / 100
  const cap = saldoAposEntradaContrato(conta)
  if (cap === null) return v
  return Math.min(v, cap)
}

/** Saldo restante após receber `valorRecebendo`: abertura − valor (equiv. Total − Entrada − pago quando valor = total bruto). */
function saldoRestanteAposReceberPreview(conta: ContaReceberRow, valorRecebendo: number): number {
  const vr = Math.round((Number(valorRecebendo) || 0) * 100) / 100
  const ab = saldoAberturaRecebimento(conta)
  return Math.max(0, Math.round((ab - vr) * 100) / 100)
}

function loadContasFromStorage(lojaId: string): ContaReceberRow[] {
  if (typeof window === "undefined") return []
  const k = contasReceberStorageKey(lojaId)
  try {
    const rawV2 = localStorage.getItem(k)
    if (rawV2) {
      const p = JSON.parse(rawV2) as unknown
      return Array.isArray(p) ? (p as ContaReceberRow[]) : []
    }
    const leg = localStorage.getItem(contasReceberLegacyImportKey(lojaId))
    if (leg) {
      const p = JSON.parse(leg) as unknown
      const rows = Array.isArray(p) ? (p as ContaReceberRow[]) : []
      localStorage.setItem(k, JSON.stringify(rows))
      return rows
    }
  } catch {
    /* ignore */
  }
  return []
}

function addDaysBr(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString("pt-BR")
}

function parseBrDate(s: string): Date | null {
  const m = String(s || "")
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  const yy = Number(m[3])
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null
  const d = new Date(yy, mm - 1, dd, 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function addMonthsSameDayBr(br: string, months: number): string {
  const base = parseBrDate(br)
  if (!base) return br
  const day = base.getDate()
  const target = new Date(base.getTime())
  target.setMonth(target.getMonth() + months)
  // se o mês não tiver aquele dia, JS avança; corrigimos pra último dia do mês
  if (target.getDate() !== day) {
    target.setDate(0)
  }
  return target.toLocaleDateString("pt-BR")
}

type ParcelaStatusUI = "pago" | "pendente" | "atrasado" | "parcial"

/** Saldo em aberto da parcela no plano (abatimentos parciais reduzem `parcelas[idx].valor`). */
function valorRestanteParcelaNoPlano(conta: ContaReceberRow, idx: number, nParcelas: number): number {
  const p = conta.parcelas?.[idx]
  if (p != null && Number.isFinite(Number(p.valor))) {
    return Math.max(0, Math.round(Number(p.valor) * 100) / 100)
  }
  if (nParcelas > 1) {
    const mig = ensureHistoricoMigrado(conta)
    const anyPago = mig.historicoPagamentos.some((h) => h.status === "PAGO" && h.parcelaIndex === idx)
    if (anyPago) return 0
  }
  return valorParcelaSugerido(conta, nParcelas)
}

function computeParcelasAposRecebimento(
  conta: ContaReceberRow,
  parcelasInformadas: number,
  parcelaIdx: number | undefined,
  valorRecebido: number
): ContaReceberRow["parcelas"] | undefined {
  if (parcelasInformadas <= 1 || parcelaIdx == null || !conta.parcelas || parcelaIdx >= conta.parcelas.length) {
    return conta.parcelas
  }
  const copy = conta.parcelas.map((x) => ({ ...x }))
  const cur = copy[parcelaIdx]
  const atual = Number(cur.valor)
  const baseRestante = Number.isFinite(atual) && atual > 0 ? atual : valorParcelaSugerido(conta, parcelasInformadas)
  const novo = Math.max(0, Math.round((baseRestante - valorRecebido) * 100) / 100)
  copy[parcelaIdx] = { ...cur, valor: novo }
  return copy
}

function statusParcelaPlano(idx: number, vencBr: string, nParcelas: number, conta: ContaReceberRow): ParcelaStatusUI {
  const mig = ensureHistoricoMigrado(conta)
  if (nParcelas <= 1) {
    const pago = mig.historicoPagamentos.some(
      (h) =>
        h.status === "PAGO" &&
        (h.parcelaIndex === idx || h.parcelaIndex === undefined || h.parcelaIndex === 0)
    )
    if (pago) return "pago"
  } else {
    const restante = valorRestanteParcelaNoPlano(conta, idx, nParcelas)
    const pagosIdx = mig.historicoPagamentos.filter((h) => h.status === "PAGO" && h.parcelaIndex === idx)
    if (restante <= 0.02) return "pago"
    if (pagosIdx.length > 0) return "parcial"
  }
  const d = parseBrDate(vencBr)
  if (d) {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const vd = new Date(d.getTime())
    vd.setHours(0, 0, 0, 0)
    if (vd.getTime() < hoje.getTime()) return "atrasado"
  }
  return "pendente"
}

function linhaPagoParcela(idx: number, nParcelas: number, conta: ContaReceberRow): PagamentoLinha | undefined {
  const mig = ensureHistoricoMigrado(conta)
  const candidatos = mig.historicoPagamentos.filter(
    (h) =>
      h.status === "PAGO" &&
      (nParcelas > 1 ? h.parcelaIndex === idx : h.parcelaIndex === idx || h.parcelaIndex === undefined || h.parcelaIndex === 0)
  )
  if (candidatos.length === 0) return undefined
  return candidatos[candidatos.length - 1]
}

function formaPagamentoComIcone(forma: string): { icon: string; label: string } {
  const f = String(forma || "").toLowerCase()
  if (f.includes("pix")) return { icon: "💠", label: forma || "PIX" }
  if (f.includes("débito") || f.includes("debito")) return { icon: "💳", label: forma || "Cartão débito" }
  if (f.includes("crédito") || f.includes("credito")) return { icon: "💳", label: forma || "Cartão crédito" }
  if (f.includes("cartão") || f.includes("cartao")) return { icon: "💳", label: forma || "Cartão" }
  if (f.includes("dinheiro")) return { icon: "💵", label: forma || "Dinheiro" }
  if (f.includes("boleto")) return { icon: "📄", label: forma || "Boleto" }
  return { icon: "💰", label: forma || "—" }
}

function dataHojeIsoLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Entrada única do pipeline de baixa: abatimento parcial, quitação e atualização de saldo/parcelas/histórico. */
export type ProcessarPagamentoInput = {
  conta: ContaReceberRow
  baseContas: ContaReceberRow[]
  forma: string
  valorRecebido: number
  movId: string
  ab: number
  saldo: number
  livre: string
  novaLinhaPag: PagamentoLinha
  parcelasInformadas: number
  proximoVenc: string
}

export function processarPagamento(inp: ProcessarPagamentoInput): {
  contaAtualizada: ContaReceberRow
  next: ContaReceberRow[]
} {
  const { conta, baseContas, forma, movId, ab, saldo, livre, novaLinhaPag, parcelasInformadas, proximoVenc, valorRecebido } =
    inp
  const mig = ensureHistoricoMigrado(conta)
  const histCompleto = [...mig.historicoPagamentos.filter((h) => h.id !== novaLinhaPag.id), novaLinhaPag]
  const sistemaLinhas = extrairLinhasSistema(conta.observacoesPagamento)
  const obs = rebuildObservacoesPagamento({
    observacoesLivre: livre,
    historico: histCompleto,
    linhasSistemaExtras: sistemaLinhas,
    linhasLogsEstorno: extrairLinhasEstornoLog(conta.observacoesPagamento),
  })
  const parcelasPlano = parcelasInformadas
  const parcelasNext = computeParcelasAposRecebimento(conta, parcelasInformadas, novaLinhaPag.parcelaIndex, valorRecebido)
  const parcelasEfetivas =
    saldo <= 0.009 && Array.isArray(conta.parcelas) && conta.parcelas.length > 0
      ? conta.parcelas.map((p) => ({ ...p, valor: 0 }))
      : parcelasNext
  const contaAtualizada: ContaReceberRow =
    saldo <= 0.009
      ? {
          ...conta,
          status: "pago",
          movimentoBaixaId: movId,
          valor: Math.round(ab * 100) / 100,
          parcelasTotal: parcelasPlano,
          parcelas: parcelasEfetivas,
          formaPagamentoPreferida: forma,
          observacoesPagamento: obs,
          historicoPagamentos: histCompleto,
        }
      : {
          ...conta,
          status: conta.status === "atrasado" ? "atrasado" : "pendente",
          valor: saldo,
          vencimento: proximoVenc.trim() || conta.vencimento,
          movimentoBaixaId: undefined,
          parcelasTotal: parcelasPlano,
          parcelas: parcelasEfetivas,
          formaPagamentoPreferida: forma,
          observacoesPagamento: obs,
          historicoPagamentos: histCompleto,
        }
  const next = baseContas.map((c) => (String(c.id) === String(conta.id) ? contaAtualizada : c))
  return { contaAtualizada, next }
}

const dialogOmniClass =
  "gap-0 p-0 max-h-[90vh] flex flex-col overflow-hidden rounded-xl border border-primary/15 bg-card text-card-foreground shadow-xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"

const alertDialogOmniClass =
  "border-primary/20 bg-card text-card-foreground shadow-xl duration-300 sm:rounded-xl"

export function ContasReceber() {
  const { lojaAtivaId, opsStorageKey } = useLojaAtiva()
  const { toast } = useToast()
  const router = useRouter()
  const { carteiras, setMovimentos, movimentos } = useFinanceiro()

  /** Mesmo critério do PDV (`OperationsProvider`): evita ler `assistec-pro-contas-receber-v2-loja-1` enquanto ops usa só a chave legacy. */
  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)

  const [filtro, setFiltro] = useState<"abertos" | "todos" | "pendente" | "atrasado" | "pago">("abertos")
  const [busca, setBusca] = useState("")
  const [selectedTituloIds, setSelectedTituloIds] = useState<string[]>([])
  const [contas, setContas] = useState<ContaReceberRow[]>([])

  const [novaOpen, setNovaOpen] = useState(false)
  const [novaDesc, setNovaDesc] = useState("")
  const [novaCliente, setNovaCliente] = useState("")
  const [novaValor, setNovaValor] = useState("")
  const [novaVenc, setNovaVenc] = useState("")
  const [novaTipo, setNovaTipo] = useState("Manual")

  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | number | null>(null)
  const [editDesc, setEditDesc] = useState("")
  const [editCliente, setEditCliente] = useState("")
  const [editValor, setEditValor] = useState("")
  const [editVenc, setEditVenc] = useState("")
  const [editTipo, setEditTipo] = useState("")
  const [editStatus, setEditStatus] = useState("")
  const [editEntradaValor, setEditEntradaValor] = useState("")
  const [editEntradaForma, setEditEntradaForma] = useState<string>("")
  const [editParcelasTotal, setEditParcelasTotal] = useState("1")
  const [editObsPagamento, setEditObsPagamento] = useState("")
  /** Contrato: alinham parcelas a (total_value − entry_value) ÷ N */
  const [editTotalOriginal, setEditTotalOriginal] = useState("")
  const [editEntryOriginal, setEditEntryOriginal] = useState("")
  const [editParcelasDetalhe, setEditParcelasDetalhe] = useState<Array<{ id?: string; venc: string; valor: string }>>([])
  const [editHistoricoPagamentos, setEditHistoricoPagamentos] = useState<PagamentoLinha[]>([])
  const editVencAtualRef = useRef("")
  const editPlanoDbRef = useRef<{ inicialN: number } | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ContaReceberRow | null>(null)
  const [estornandoId, setEstornandoId] = useState<string | null>(null)
  const [estornandoPagamentoKey, setEstornandoPagamentoKey] = useState<string | null>(null)
  const [limparOpen, setLimparOpen] = useState(false)
  const [limparConfirmacao, setLimparConfirmacao] = useState("")
  const [estornoMovimentoConfirm, setEstornoMovimentoConfirm] = useState<ContaReceberRow | null>(null)
  const [estornoLinhaConfirm, setEstornoLinhaConfirm] = useState<{ conta: ContaReceberRow; linha: PagamentoLinha } | null>(
    null
  )
  /** IDs de linhas do histórico marcadas para remoção definitiva ao clicar em Salvar / Imprimir. */
  const [baixaHistoricoRemoverIds, setBaixaHistoricoRemoverIds] = useState<string[]>([])
  const [limparEstornosHistBaixaOpen, setLimparEstornosHistBaixaOpen] = useState(false)
  type PendingRecebimento = ProcessarPagamentoInput & {
    imprimir: boolean
    agora: Date
    descMov: string
  }
  const [baixaOpen, setBaixaOpen] = useState(false)
  const [baixaConta, setBaixaConta] = useState<ContaReceberRow | null>(null)
  const [baixaModo, setBaixaModo] = useState<BaixaModalModo>("receber")
  const [baixaForma, setBaixaForma] = useState<string>("")
  const [baixaValor, setBaixaValor] = useState<string>("")
  const [baixaParcelasTotal, setBaixaParcelasTotal] = useState<string>("1")
  const [baixaObsPagamento, setBaixaObsPagamento] = useState<string>("")
  const [baixaProximoVenc, setBaixaProximoVenc] = useState<string>("")
  const [baixaVencOriginal, setBaixaVencOriginal] = useState<string>("")
  const [baixaVencBase, setBaixaVencBase] = useState<string>("")
  const [baixaParcelaSel, setBaixaParcelaSel] = useState<number>(0)
  const [baixaRegistrando, setBaixaRegistrando] = useState(false)
  /** Na modal de baixa: lista completa do histórico de pagamentos (senão mostra só os 5 eventos mais recentes). */
  const [baixaHistVerTudo, setBaixaHistVerTudo] = useState(false)
  /** Nº de parcelas na modal de baixa (1–12); única fonte para UI + `executarRecebimento` / `processarPagamento`. */
  const baixaNParcelas = useMemo(
    () => Math.max(1, Math.min(12, Math.round(Number(baixaParcelasTotal) || 1))),
    [baixaParcelasTotal]
  )
  const baixaRecebimentoEmCursoRef = useRef(false)
  const histBaixaInputRefs = useRef<Record<string, { data: HTMLInputElement | null; valor: HTMLInputElement | null }>>({})

  const baixaContaLive = useMemo(() => {
    if (!baixaConta) return null
    return contas.find((c) => String(c.id) === String(baixaConta.id)) ?? baixaConta
  }, [contas, baixaConta])

  /** Histórico do título na modal (mais recente primeiro) — limitado na UI para não pesar a renderização. */
  const baixaHistoricoPagamentosUi = useMemo(() => {
    if (!baixaContaLive) return []
    const h = ensureHistoricoMigrado(baixaContaLive).historicoPagamentos
    const relevante = h.filter(
      (x) => x.status === "PAGO" || (x.status === "PENDENTE" && Math.abs(Number(x.valor) || 0) > 0.005)
    )
    return [...relevante].sort((a, b) => {
      const da = a.dataPagamento || ""
      const db = b.dataPagamento || ""
      if (db !== da) return db.localeCompare(da)
      return String(b.id).localeCompare(String(a.id))
    })
  }, [baixaContaLive])

  /** Vencimentos exibidos na baixa: prioridade absoluta ao plano persistido em `conta.parcelas` (sem recalcular datas na UI). */
  const parcelasVencimentos = useMemo(() => {
    const n = baixaNParcelas
    const live = baixaContaLive
    if (live?.parcelas && live.parcelas.length === n) {
      return live.parcelas.map((p) => String(p.vencimento ?? "").trim())
    }
    const base = (baixaVencBase || "").trim()
    if (!base) return []
    return Array.from({ length: n }, (_, idx) => addMonthsSameDayBr(base, idx + 1))
  }, [baixaNParcelas, baixaVencBase, baixaContaLive])

  const baixaParcelaSugestao = useMemo(() => {
    if (!baixaContaLive) return 0
    const n = baixaNParcelas
    if (n > 1) return valorRestanteParcelaNoPlano(baixaContaLive, baixaParcelaSel, n)
    return valorParcelaSugerido(baixaContaLive, n)
  }, [baixaContaLive, baixaNParcelas, baixaParcelaSel])

  const baixaAbertura = useMemo(
    () => (baixaContaLive ? saldoAberturaRecebimento(baixaContaLive) : 0),
    [baixaContaLive]
  )

  const baixaValorNumerico = useMemo(() => parseValorBr(baixaValor), [baixaValor])

  const baixaSaldoRestanteAposReceber = useMemo(
    () => (baixaContaLive ? saldoRestanteAposReceberPreview(baixaContaLive, baixaValorNumerico) : 0),
    [baixaContaLive, baixaValorNumerico]
  )

  /** Limite da operação atual: saldo da parcela selecionada (plano) ou saldo do título (1x). */
  const baixaLimiteOperacaoAtual = useMemo(() => {
    if (!baixaContaLive) return 0
    const n = baixaNParcelas
    if (n > 1) return valorRestanteParcelaNoPlano(baixaContaLive, baixaParcelaSel, n)
    return baixaAbertura
  }, [baixaContaLive, baixaNParcelas, baixaParcelaSel, baixaAbertura])

  /** Valor digitado é menor que o máximo possível nesta operação → abatimento parcial (não quita parcela/título). */
  const baixaEhAbatimento = useMemo(() => {
    if (baixaValorNumerico <= 0.009) return false
    return baixaValorNumerico + 0.009 < baixaLimiteOperacaoAtual
  }, [baixaValorNumerico, baixaLimiteOperacaoAtual])

  const persist = useCallback(
    (rows: ContaReceberRow[]) => {
      if (typeof window === "undefined") return
      try {
        localStorage.setItem(contasReceberStorageKey(lojaKey), JSON.stringify(rows))
        void fetch("/api/ops/contas-receber-persist", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            [ASSISTEC_LOJA_HEADER]: lojaKey,
          },
          body: JSON.stringify({ rows }),
        }).catch(() => {})
        /** Garante que a lista na tela atualize antes de `window.print()` (evita estado “atrasado” ao fechar a impressão). */
        flushSync(() => {
          setContas(rows)
        })
        window.dispatchEvent(new Event("assistec-contas-receber-imported"))
        /** Refresh do App Router fora do caminho crítico e após o diálogo de impressão típico. */
        window.setTimeout(() => {
          try {
            router.refresh()
          } catch {
            /* ignore */
          }
        }, 2000)
      } catch {
        toast({ title: "Não foi possível salvar", variant: "destructive" })
      }
    },
    [lojaKey, toast, router]
  )

  const reload = useCallback(() => {
    const raw = loadContasFromStorage(lojaKey)
    const migrated = raw.map((r) => ensureHistoricoMigrado(r))
    if (typeof window !== "undefined") {
      let needSave = false
      for (let i = 0; i < raw.length; i++) {
        if (precisaPersistirMigracaoHistorico(raw[i], migrated[i])) {
          needSave = true
          break
        }
      }
      if (needSave) {
        try {
          localStorage.setItem(contasReceberStorageKey(lojaKey), JSON.stringify(migrated))
        } catch {
          /* ignore */
        }
      }
    }
    setContas(migrated)

    void (async () => {
      try {
        const r = await fetch(`/api/ops/contas-receber-list?lojaId=${encodeURIComponent(lojaKey)}`, {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            [ASSISTEC_LOJA_HEADER]: lojaKey,
          },
        })
        if (!r.ok) return
        const j = (await r.json()) as { rows?: ContaReceberRow[] }
        const fromServer = j.rows ?? []
        setContas((prev) => mergeContasLocalWins(prev, fromServer))
      } catch {
        /* ignore */
      }
    })()
  }, [lojaKey])

  useEffect(() => {
    reload()
  }, [reload])

  const baixaModalTituloIdRef = useRef<string | null>(null)
  const baixaValorInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (baixaOpen && baixaConta) baixaModalTituloIdRef.current = String(baixaConta.id)
    if (!baixaOpen) baixaModalTituloIdRef.current = null
  }, [baixaOpen, baixaConta?.id])

  /** Após persist em `contas`, atualiza o título aberto na modal para o mesmo objeto (histórico não “ressuscita”). */
  useEffect(() => {
    if (!baixaOpen || !baixaModalTituloIdRef.current) return
    const fresh = contas.find((c) => String(c.id) === baixaModalTituloIdRef.current)
    if (fresh) setBaixaConta(fresh)
  }, [baixaOpen, contas])

  useEffect(() => {
    const on = () => reload()
    window.addEventListener("assistec-contas-receber-imported", on)
    return () => window.removeEventListener("assistec-contas-receber-imported", on)
  }, [reload])

  /** Trava dos botões = só durante o processamento síncrono da baixa; não confundir com validação “parcela já paga”. */
  const liberarTravaBaixaRecebimento = useCallback(() => {
    baixaRecebimentoEmCursoRef.current = false
    setBaixaRegistrando(false)
  }, [])

  const contasFiltradas = useMemo(() => {
    const q = normBuscaTxt(busca)
    let list = contas
    if (filtro === "abertos") list = list.filter((c) => c.status !== "pago")
    else if (filtro === "pago") {
      list = list.filter((c) => (c.status || "").toLowerCase() === "pago")
    } else if (filtro !== "todos") list = list.filter((c) => c.status === filtro)
    if (q) {
      list = list.filter((c) => {
        const cliente = normBuscaTxt(c.cliente)
        const desc = normBuscaTxt(c.descricao)
        // OR: cliente (campo) OU descrição (algumas importações carregam o nome no título)
        return cliente.includes(q) || desc.includes(q)
      })
    }
    if (filtro === "abertos") {
      // pendentes e atrasados primeiro
      list = [...list].sort((a, b) => {
        const aw = a.status === "atrasado" ? 0 : a.status === "pendente" ? 1 : 2
        const bw = b.status === "atrasado" ? 0 : b.status === "pendente" ? 1 : 2
        return aw - bw
      })
    }
    return list
  }, [contas, filtro, busca])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    console.log("[contas-receber] DADOS_RECEBIDOS:", {
      lojaKey,
      opsStorageKey,
      storageKey: contasReceberStorageKey(lojaKey),
      contasLen: contas.length,
      filtradasLen: contasFiltradas.length,
      filtro,
    })
  }, [lojaKey, opsStorageKey, contas.length, contasFiltradas.length, filtro])

  const recebidosTabela = useMemo(() => {
    const q = normBuscaTxt(busca)
    let titulos = contas.filter((c) => (c.status || "").toLowerCase() === "pago")
    if (q) {
      titulos = titulos.filter((c) => {
        const cliente = normBuscaTxt(c.cliente)
        const desc = normBuscaTxt(c.descricao)
        return cliente.includes(q) || desc.includes(q)
      })
    }
    type LinhaRec = {
      conta: ContaReceberRow
      linha: PagamentoLinha | null
      valorExibido: number
      dataExibida: string
      dataIsoKey: string
      forma: string
      chaveEstorno: string
      responsavel: string
    }
    const linhas: LinhaRec[] = []
    for (const conta of titulos) {
      const mig = ensureHistoricoMigrado(conta)
      const pagos = listarPagamentosEfetivos(mig.historicoPagamentos)
      if (pagos.length === 0) {
        const mov = conta.movimentoBaixaId ? movimentos.find((m) => m.id === conta.movimentoBaixaId) : undefined
        const dataBr = mov?.at ? new Date(mov.at).toLocaleDateString("pt-BR") : conta.vencimento || "—"
        const dataIsoKey = mov?.at
          ? new Date(mov.at).toISOString().slice(0, 10)
          : brParaIso(String(conta.vencimento ?? "").trim()) || "2000-01-01"
        const valor = mov ? Math.round(mov.valor * 100) / 100 : Math.round((Number(conta.valor) || 0) * 100) / 100
        const responsavel = mov ? "Caixa · OMNI Gestão" : "—"
        linhas.push({
          conta: mig,
          linha: null,
          valorExibido: valor,
          dataExibida: dataBr,
          dataIsoKey,
          forma: conta.formaPagamentoPreferida ?? "—",
          chaveEstorno: `t-${conta.id}-leg`,
          responsavel,
        })
      } else {
        for (const linha of pagos) {
          const dataBr = isoParaBr(linha.dataPagamento) || "—"
          const dataIsoKey = linha.dataPagamento && /^\d{4}-\d{2}-\d{2}$/.test(linha.dataPagamento)
            ? linha.dataPagamento
            : "0000-00-00"
          const valorArred = Math.round(Number(linha.valor) * 100) / 100
          const movLinha = linha.movimentoId ? movimentos.find((m) => m.id === linha.movimentoId) : undefined
          const responsavel = movLinha ? "Caixa · OMNI Gestão" : "Registro local"
          linhas.push({
            conta: mig,
            linha,
            valorExibido: valorArred,
            dataExibida: dataBr,
            dataIsoKey,
            forma: linha.forma,
            chaveEstorno: `t-${conta.id}-p-${linha.id}`,
            responsavel,
          })
        }
      }
    }
    return linhas.sort((a, b) => {
      const ta = new Date(a.dataIsoKey + "T12:00:00").getTime()
      const tb = new Date(b.dataIsoKey + "T12:00:00").getTime()
      return tb - ta
    })
  }, [contas, movimentos, busca])

  const recebidosPorDia = useMemo(() => {
    const map = new Map<string, typeof recebidosTabela>()
    for (const row of recebidosTabela) {
      const key = row.dataIsoKey
      const arr = map.get(key) ?? []
      arr.push(row)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort((a, b) => {
      const ta = new Date(a[0] + "T12:00:00").getTime()
      const tb = new Date(b[0] + "T12:00:00").getTime()
      return tb - ta
    })
  }, [recebidosTabela])

  const recebidosResumoAba = useMemo(() => {
    const hojeIso = dataHojeIsoLocal()
    const totalHoje = recebidosTabela
      .filter((r) => r.dataIsoKey === hojeIso)
      .reduce((s, r) => s + r.valorExibido, 0)
    const agora = new Date()
    const y = agora.getFullYear()
    const m = agora.getMonth()
    const inicioMes = new Date(y, m, 1, 12, 0, 0, 0)
    const fimMes = new Date(y, m + 1, 0, 12, 0, 0, 0)
    const totalAReceberMes = contas
      .filter((c) => {
        const st = (c.status || "").toLowerCase()
        if (st !== "pendente" && st !== "atrasado") return false
        const dv = parseBrDate(c.vencimento ?? "")
        if (!dv) return st === "pendente" || st === "atrasado"
        return dv >= inicioMes && dv <= fimMes
      })
      .reduce((s, c) => s + (Number(c.valor) || 0), 0)
    const totalAtraso = contas
      .filter((c) => (c.status || "").toLowerCase() === "atrasado")
      .reduce((s, c) => s + (Number(c.valor) || 0), 0)
    return { totalHoje, totalAReceberMes, totalAtraso }
  }, [recebidosTabela, contas])

  const resumo = useMemo(() => {
    const totalReceber = contas.filter((c) => c.status === "pendente").reduce((s, c) => s + c.valor, 0)
    const pendentes = contas.filter((c) => c.status === "pendente").length
    const atrasados = contas.filter((c) => c.status === "atrasado").length
    const recebidoMes = contas.filter((c) => c.status === "pago").reduce((s, c) => s + c.valor, 0)
    return { totalReceber, pendentes, atrasados, recebidoMes }
  }, [contas])

  const carteiraPadrao = useMemo(() => {
    return carteiras.find((c) => c.tipo === "empresa")?.id ?? carteiras[0]?.id ?? ""
  }, [carteiras])

  const getStatusConfig = (status: string) => {
    const s = (status || "").toLowerCase()
    switch (s) {
      case "pago":
        return { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/10", label: "Recebido" }
      case "atrasado":
        return { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Atrasado" }
      default:
        return { icon: Clock, color: "text-yellow-500", bg: "bg-yellow-500/10", label: "Pendente" }
    }
  }

  const emitirReciboCompleto = useCallback(
    (
      conta: ContaReceberRow,
      forma: string,
      dataPagamento: Date,
      listaContas: ContaReceberRow[],
      /** Valor deste recebimento (abatimento parcial: não usar `conta.valor`, que é saldo remanescente). */
      valorPagoDestaOperacao?: number
    ) => {
      const saldo = calcSaldoDevedorClienteTodaLoja(listaContas, conta.cliente)
      const vp =
        valorPagoDestaOperacao != null && Number.isFinite(valorPagoDestaOperacao)
          ? Math.round(valorPagoDestaOperacao * 100) / 100
          : conta.valor
      imprimirReciboPagamento({
        lojaNome: RECIBO_LOJA_NOME_PADRAO,
        cliente: conta.cliente,
        descricaoTitulo: conta.descricao,
        valorPago: vp,
        dataPagamento,
        formaPagamento: forma,
        saldoDevedorAtual: saldo,
      })
    },
    []
  )

  type AplicarRecebimentoResult = {
    contaAtualizada: ContaReceberRow
    next: ContaReceberRow[]
    deveImprimir: boolean
    forma: string
    agora: Date
    valorRecebido: number
  }

  const aplicarRecebimentoInterno = useCallback(
    (p: PendingRecebimento): AplicarRecebimentoResult => {
      const {
        conta,
        baseContas,
        forma,
        valorRecebido,
        imprimir,
        movId,
        agora,
        descMov,
        ab,
        saldo,
        livre,
        novaLinhaPag,
        parcelasInformadas,
        proximoVenc,
      } = p

      flushSync(() => {
        setMovimentos((prev) => [
          ...prev,
          {
            id: movId,
            carteiraId: carteiraPadrao,
            tipo: "entrada" as const,
            valor: Math.round(valorRecebido * 100) / 100,
            descricao: descMov,
            categoria: "Contas a receber",
            status: "Pago",
            at: agora.toISOString(),
          },
        ])
      })

      const { contaAtualizada, next } = processarPagamento({
        conta,
        baseContas,
        forma,
        valorRecebido,
        movId,
        ab,
        saldo,
        livre,
        novaLinhaPag,
        parcelasInformadas,
        proximoVenc,
      })
      persist(next)
      flushSync(() => {
        setBaixaOpen(false)
      })
      toast({
        title: "Recebimento registrado",
        description:
          saldo <= 0.009
            ? imprimir
              ? "Baixa registrada. Você pode imprimir o recibo na janela que abrir em seguida."
              : "Título quitado e entrada lançada no fluxo de caixa."
            : "Baixa parcial registrada e entrada lançada no fluxo de caixa.",
      })
      return {
        contaAtualizada,
        next,
        deveImprimir: imprimir,
        forma,
        agora,
        valorRecebido,
      }
    },
    [carteiraPadrao, persist, setBaixaOpen, setMovimentos, toast]
  )

  const abrirModalBaixa = (conta: ContaReceberRow, modo: BaixaModalModo) => {
    liberarTravaBaixaRecebimento()
    setBaixaConta(conta)
    setBaixaModo(modo)
    setBaixaForma(conta.formaPagamentoPreferida ?? "")
    const nFromDb =
      conta.parcelas && conta.parcelas.length > 0
        ? conta.parcelas.length
        : Math.max(1, Math.min(12, Math.round(Number(conta.parcelasTotal) || 1)))
    setBaixaParcelasTotal(String(nFromDb))
    const p0 = conta.parcelas?.[0]
    setBaixaVencOriginal(p0?.vencimento?.trim() || conta.vencimento || "")
    setBaixaVencBase(conta.vencimento ?? "")
    if (modo === "receber") {
      setBaixaValor("0,00")
    } else {
      setBaixaValor(String(saldoAberturaRecebimento(conta)).replace(".", ","))
    }
    setBaixaObsPagamento(conta.observacoesPagamento ?? "")
    if (nFromDb > 1) {
      const nextV = conta.parcelas?.[1]?.vencimento?.trim()
      setBaixaProximoVenc(nextV || addMonthsSameDayBr(conta.vencimento ?? "", 1))
    } else {
      setBaixaProximoVenc(addDaysBr(30))
    }
    setBaixaParcelaSel(0)
    setBaixaHistoricoRemoverIds([])
    setBaixaHistVerTudo(false)
    setBaixaOpen(true)
  }

  const executarRecebimento = (
    conta: ContaReceberRow,
    forma: string,
    valorRecebido: number,
    imprimir: boolean,
    opts?: { parcelaSel?: number; proximoVencOverride?: string; baseContas?: ContaReceberRow[] }
  ) => {
    if (baixaRecebimentoEmCursoRef.current) return
    if (conta.status === "pago") {
      toast({ title: "Já recebido", description: "Este título já consta como recebido.", variant: "destructive" })
      return
    }
    if (conta.movimentoBaixaId) {
      toast({ title: "Já recebido", description: "Baixa já vinculada a uma movimentação.", variant: "destructive" })
      return
    }
    if (!carteiraPadrao) {
      toast({
        title: "Carteira não encontrada",
        description: "Cadastre uma carteira em Gestão de Carteiras antes de receber.",
        variant: "destructive",
      })
      return
    }
    if (!Number.isFinite(valorRecebido) || valorRecebido <= 0) {
      toast({ title: "Valor a receber inválido", variant: "destructive" })
      return
    }
    const ab = saldoAberturaRecebimento(conta)
    const livre = extrairObservacoesLivres(baixaObsPagamento)
    const parcelasInformadas = baixaNParcelas
    const parcelaSelEfetivo = opts?.parcelaSel ?? baixaParcelaSel
    const proximoVencEfetivo = opts?.proximoVencOverride ?? baixaProximoVenc
    const mig = ensureHistoricoMigrado(conta)
    const parc = parcelasInformadas > 1 ? conta.parcelas?.[parcelaSelEfetivo] : undefined
    const parcelaIdStable = parc?.id?.trim() || undefined
    const valorRestanteParcela =
      parcelasInformadas > 1 ? valorRestanteParcelaNoPlano(conta, parcelaSelEfetivo, parcelasInformadas) : ab
    const maxReceber = Math.min(ab, valorRestanteParcela)
    if (valorRecebido > maxReceber + 0.009) {
      toast({
        title: "Valor acima do permitido",
        description: `Digite até R$ ${maxReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (saldo da parcela ou do título).`,
        variant: "destructive",
      })
      return
    }
    if (
      parcelaJaConstaComoPaga(mig.historicoPagamentos, {
        parcelasInformadas,
        parcelaIndex: parcelasInformadas > 1 ? parcelaSelEfetivo : undefined,
        parcelaId: parcelaIdStable,
        valorRestanteParcela: parcelasInformadas > 1 ? valorRestanteParcela : undefined,
      })
    ) {
      toast({
        title: "Parcela já recebida",
        description: "Esta parcela já consta como paga no histórico do título. Estorne antes de registrar de novo.",
        variant: "destructive",
      })
      return
    }
    baixaRecebimentoEmCursoRef.current = true
    setBaixaRegistrando(true)
    const baseContas = opts?.baseContas ?? contas
    const movId = `mov-cr-${String(conta.id)}-${Date.now()}`
    const agora = new Date()
    const descMov = `Recebimento (${forma}) — ${conta.descricao}`
    const saldo = Math.max(0, Math.round((ab - valorRecebido) * 100) / 100)
    const vencimentoParcelaBr =
      parcelasInformadas > 1
        ? conta.parcelas?.[parcelaSelEfetivo]?.vencimento?.trim() || undefined
        : conta.parcelas?.length === 1
          ? conta.parcelas[0]?.vencimento?.trim() || undefined
          : conta.vencimento?.trim() || undefined
    const novaLinhaPag: PagamentoLinha = {
      id: gerarIdPagamento(),
      dataPagamento: agora.toISOString().slice(0, 10),
      valor: Math.round(valorRecebido * 100) / 100,
      forma,
      status: "PAGO",
      movimentoId: movId,
      parcelaIndex: parcelasInformadas > 1 ? parcelaSelEfetivo : undefined,
      parcelaId: parcelasInformadas > 1 ? parcelaIdStable : undefined,
      vencimentoParcelaBr: vencimentoParcelaBr || undefined,
    }
    const p: PendingRecebimento = {
      conta,
      baseContas,
      forma,
      valorRecebido,
      imprimir,
      movId,
      agora,
      descMov,
      ab,
      saldo,
      livre,
      novaLinhaPag,
      parcelasInformadas,
      proximoVenc: proximoVencEfetivo,
    }

    let saveWatchdog: number | undefined
    const clearWatchdog = () => {
      if (saveWatchdog != null) {
        window.clearTimeout(saveWatchdog)
        saveWatchdog = undefined
      }
    }

    saveWatchdog = window.setTimeout(() => {
      saveWatchdog = undefined
      if (!baixaRecebimentoEmCursoRef.current) return
      liberarTravaBaixaRecebimento()
      baixaRecebimentoEmCursoRef.current = false
      toast({
        title: "Tempo esgotado ao salvar",
        description:
          "A gravação demorou mais de 5 segundos. Verifique o navegador ou libere espaço em disco e tente salvar novamente.",
        variant: "destructive",
      })
    }, 5000)

    queueMicrotask(() => {
      let resultadoImpressao: AplicarRecebimentoResult | null = null
      try {
        resultadoImpressao = aplicarRecebimentoInterno(p)
        clearWatchdog()
      } catch (e) {
        clearWatchdog()
        console.error("[contas-receber] executarRecebimento:", e)
        toast({
          title: "Erro ao registrar recebimento",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        })
      } finally {
        clearWatchdog()
        liberarTravaBaixaRecebimento()
      }
      /** Lista e modal já commitados em `aplicarRecebimentoInterno`; impressão é o último passo (não bloqueia o save). */
      if (resultadoImpressao?.deveImprimir) {
        const r = resultadoImpressao
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.setTimeout(() => {
                liberarTravaBaixaRecebimento()
                baixaRecebimentoEmCursoRef.current = false
                try {
                  emitirReciboCompleto(r.contaAtualizada, r.forma, r.agora, r.next, r.valorRecebido)
                } catch (e) {
                  console.error("[contas-receber] recibo:", e)
                  toast({
                    title: "Recebimento gravado",
                    description:
                      "O comprovante não pôde ser gerado ou impresso; o recebimento já está registrado. Tente reimprimir pelo menu do título.",
                    variant: "destructive",
                  })
                }
              }, 0)
            })
          })
        })
      }
    })
  }

  const emitirReciboParcela = useCallback(
    (conta: ContaReceberRow, linha: PagamentoLinha) => {
      if (!linha.dataPagamento) {
        toast({ title: "Sem data de recebimento", variant: "destructive" })
        return
      }
      const saldo = calcSaldoDevedorClienteTodaLoja(contas, conta.cliente)
      imprimirReciboPagamento({
        lojaNome: RECIBO_LOJA_NOME_PADRAO,
        cliente: conta.cliente,
        descricaoTitulo: conta.descricao,
        valorPago: Math.round(linha.valor * 100) / 100,
        dataPagamento: new Date(linha.dataPagamento + "T12:00:00"),
        formaPagamento: linha.forma,
        saldoDevedorAtual: saldo,
      })
    },
    [contas, toast]
  )

  const registrarRecebimentoClick = (imprimir: boolean) => {
    if (baixaRecebimentoEmCursoRef.current) return
    let rows = contas
    let removeuHistorico = false
    if (baixaConta && baixaHistoricoRemoverIds.length > 0) {
      const alvo = rows.find((x) => String(x.id) === String(baixaConta.id))
      if (alvo) {
        const { conta: atualizada, movimentoIdsRemovidos } = aplicarRemocoesHistoricoConta(alvo, baixaHistoricoRemoverIds)
        rows = rows.map((x) => (String(x.id) === String(baixaConta.id) ? atualizada : x))
        persist(rows)
        if (movimentoIdsRemovidos.length > 0) {
          const setIds = new Set(movimentoIdsRemovidos)
          setMovimentos((prev) => prev.filter((m) => !setIds.has(m.id)))
        }
        setBaixaHistoricoRemoverIds([])
        removeuHistorico = true
        toast({
          title: "Histórico gravado",
          description: "Linhas removidas permanentemente do título (localStorage).",
        })
      } else {
        setBaixaHistoricoRemoverIds([])
      }
    }
    const c = rows.find((x) => String(x.id) === String(baixaConta?.id)) ?? baixaConta
    if (!c || !baixaForma) {
      toast({ title: "Selecione a forma de pagamento", variant: "destructive" })
      return
    }
    /** Sempre o valor do campo "Valor a receber" (fonte única para Salvar / Imprimir). */
    const vr = parseValorBr(baixaValor)
    if (!Number.isFinite(vr) || vr <= 0) {
      if (removeuHistorico) return
      toast({
        title: "Valor a receber inválido",
        description: "Informe um valor para registrar, ou use Salvar só após marcar linhas do histórico para remoção.",
        variant: "destructive",
      })
      return
    }
    executarRecebimento(c, baixaForma, vr, imprimir, { baseContas: rows })
  }

  const confirmarLimparEstornosHistBaixa = useCallback(() => {
    if (!baixaConta) return
    const alvo = contas.find((x) => String(x.id) === String(baixaConta.id))
    if (!alvo) return
    const atualizada = limparEstornosHistoricoConta(alvo)
    const next = contas.map((c) => (String(c.id) === String(baixaConta.id) ? atualizada : c))
    persist(next)
    setLimparEstornosHistBaixaOpen(false)
    toast({
      title: "Histórico de estornos limpo",
      description: "Mantidos apenas recebimentos ativos (PAGO). Logs de estorno em texto foram removidos.",
    })
  }, [baixaConta, contas, persist, toast])

  const confirmarMarcarComRecibo = () => {
    if (!baixaConta || !baixaForma) {
      toast({ title: "Selecione a forma de pagamento", variant: "destructive" })
      return
    }
    const conta = baixaConta
    if (conta.status === "pago") return
    const agora = new Date()
    const contaPaga: ContaReceberRow = { ...conta, status: "pago" }
    const next = contas.map((c) => (String(c.id) === String(conta.id) ? contaPaga : c))
    persist(next)
    toast({ title: "Marcado como pago", description: "Gerando recibo…" })
    emitirReciboCompleto(contaPaga, baixaForma, agora, next)
    setBaixaOpen(false)
  }

  const confirmarReemitirRecibo = () => {
    if (!baixaConta || !baixaForma) {
      toast({ title: "Selecione a forma de pagamento", variant: "destructive" })
      return
    }
    emitirReciboCompleto(baixaConta, baixaForma, new Date(), contas)
    setBaixaOpen(false)
    toast({ title: "Recibo enviado para impressão" })
  }

  const mudarParaPendente = (conta: ContaReceberRow) => {
    if (conta.status !== "pago") return
    if (conta.movimentoBaixaId) {
      setMovimentos((prev) => prev.filter((m) => m.id !== conta.movimentoBaixaId))
    }
    const next = contas.map((c) =>
      String(c.id) === String(conta.id) ? { ...c, status: "pendente", movimentoBaixaId: undefined } : c
    )
    persist(next)
    toast({
      title: "Título voltou para pendente",
      description: "Útil quando o status veio errado na planilha. Ajuste manualmente se precisar receber de novo.",
    })
  }

  const solicitarEstornoMovimentoCaixa = useCallback(
    (conta: ContaReceberRow) => {
      if (conta.status !== "pago" || !conta.movimentoBaixaId) {
        toast({
          title: "Não é possível estornar",
          description: "Use esta opção apenas para títulos recebidos com lançamento no caixa.",
          variant: "destructive",
        })
        return
      }
      const mov = movimentos.find((m) => m.id === conta.movimentoBaixaId)
      if (!mov) {
        toast({
          title: "Movimento não encontrado",
          description: "O lançamento no caixa não existe mais nesta loja.",
          variant: "destructive",
        })
        return
      }
      const valor = Math.round(mov.valor * 100) / 100
      if (valor <= 0) {
        toast({ title: "Valor inválido", variant: "destructive" })
        return
      }
      setEstornoMovimentoConfirm(conta)
    },
    [movimentos, toast]
  )

  const confirmarEstornoMovimentoCaixa = useCallback(async () => {
    const conta = estornoMovimentoConfirm
    if (!conta || !conta.movimentoBaixaId) {
      setEstornoMovimentoConfirm(null)
      return
    }
    const mov = movimentos.find((m) => m.id === conta.movimentoBaixaId)
    if (!mov) {
      toast({
        title: "Movimento não encontrado",
        description: "O lançamento no caixa não existe mais nesta loja.",
        variant: "destructive",
      })
      setEstornoMovimentoConfirm(null)
      return
    }
    const valor = Math.round(mov.valor * 100) / 100
    const idKey = String(conta.id)
    setEstornandoId(idKey)
    try {
      const res = await fetch("/api/financeiro/contas-receber/estornar", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaKey },
        body: JSON.stringify({
          lojaId: lojaKey,
          tituloId: conta.id,
          movimentoId: conta.movimentoBaixaId,
          valorEstorno: valor,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast({
          title: "Estorno não registrado",
          description: data.error ?? `Servidor respondeu ${res.status}`,
          variant: "destructive",
        })
        return
      }

      setMovimentos((prev) => prev.filter((m) => m.id !== conta.movimentoBaixaId))
      const mig = ensureHistoricoMigrado(conta)
      const linhaMov = mig.historicoPagamentos.find((h) => h.movimentoId === conta.movimentoBaixaId)
      const novoSaldo = restaurarSaldoDevedorAposEstorno(conta, valor)
      const parcelasTotalCorrigido =
        linhaMov?.parcelaIndex != null
          ? Math.max(conta.parcelasTotal ?? 1, linhaMov.parcelaIndex + 1)
          : (conta.parcelasTotal ?? 1)
      const dataBr = new Date().toLocaleDateString("pt-BR")
      const newHist = mig.historicoPagamentos.map((h) =>
        h.movimentoId === conta.movimentoBaixaId
          ? { ...h, status: "PENDENTE" as const, dataPagamento: null, movimentoId: undefined }
          : h
      )
      const obs = montarObservacoesAposEstorno(conta, newHist, valor, dataBr)
      const novoStatus = inferirStatusTituloAposEstorno(conta, novoSaldo)

      const atualizada: ContaReceberRow = {
        ...conta,
        status: novoStatus,
        movimentoBaixaId: undefined,
        valor: novoSaldo,
        parcelasTotal: parcelasTotalCorrigido,
        observacoesPagamento: obs,
        historicoPagamentos: newHist,
      }
      const next = contas.map((c) => (String(c.id) === String(conta.id) ? atualizada : c))
      persist(next)
      toast({ title: "Pagamento estornado", description: "Saldo restaurado e lançamento removido do caixa." })
    } catch (e) {
      toast({ title: "Falha na rede", description: String(e), variant: "destructive" })
    } finally {
      setEstornandoId(null)
      setEstornoMovimentoConfirm(null)
    }
  }, [contas, estornoMovimentoConfirm, lojaKey, movimentos, persist, setMovimentos, toast])

  const solicitarEstornoLinha = useCallback(
    (conta: ContaReceberRow, linha: PagamentoLinha | null) => {
      if (linha) {
        if (linha.status !== "PAGO") return
        setEstornoLinhaConfirm({ conta, linha })
        return
      }
      solicitarEstornoMovimentoCaixa(conta)
    },
    [solicitarEstornoMovimentoCaixa]
  )

  const confirmarEstornoLinha = useCallback(async () => {
    const pair = estornoLinhaConfirm
    if (!pair) return
    const { conta, linha } = pair
    const valor = Math.round(linha.valor * 100) / 100
    const key = `${conta.id}-${linha.id}`
    setEstornandoPagamentoKey(key)
    try {
      const res = await fetch("/api/financeiro/contas-receber/estornar-parcela", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaKey },
        body: JSON.stringify({
          lojaId: lojaKey,
          tituloId: conta.id,
          pagamentoId: linha.id,
          valorEstorno: valor,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        toast({
          title: "Estorno não registrado",
          description: data.error ?? `Servidor respondeu ${res.status}`,
          variant: "destructive",
        })
        return
      }

      if (linha.movimentoId) {
        setMovimentos((prev) => prev.filter((m) => m.id !== linha.movimentoId))
      }

      const mig = ensureHistoricoMigrado(conta)
      const newHist = mig.historicoPagamentos.map((h) =>
        h.id === linha.id ? { ...h, status: "PENDENTE" as const, dataPagamento: null, movimentoId: undefined } : h
      )
      const novoSaldo = restaurarSaldoDevedorAposEstorno(conta, valor)
      const parcelasTotalCorrigido =
        linha.parcelaIndex != null
          ? Math.max(conta.parcelasTotal ?? 1, linha.parcelaIndex + 1)
          : (conta.parcelasTotal ?? 1)
      const novoStatus = inferirStatusTituloAposEstorno(conta, novoSaldo)
      const dataBr = new Date().toLocaleDateString("pt-BR")
      const obs = montarObservacoesAposEstorno(conta, newHist, valor, dataBr)
      let movimentoBaixaId = conta.movimentoBaixaId
      if (linha.movimentoId && conta.movimentoBaixaId === linha.movimentoId) {
        movimentoBaixaId = undefined
      }

      let parcelasOut = conta.parcelas
      if (linha.parcelaIndex != null && conta.parcelas && conta.parcelas[linha.parcelaIndex]) {
        const copy = [...conta.parcelas]
        const i = linha.parcelaIndex
        const cur = copy[i]
        const restante = Number(cur.valor)
        const base = Number.isFinite(restante) ? restante : 0
        const novo = Math.round((base + valor) * 100) / 100
        copy[i] = { ...cur, valor: novo }
        parcelasOut = copy
      }

      const atualizada: ContaReceberRow = {
        ...conta,
        status: novoStatus,
        valor: novoSaldo,
        parcelasTotal: parcelasTotalCorrigido,
        parcelas: parcelasOut,
        observacoesPagamento: obs,
        historicoPagamentos: newHist,
        movimentoBaixaId,
      }
      const next = contas.map((c) => (String(c.id) === String(conta.id) ? atualizada : c))
      persist(next)
      toast({ title: "Estorno concluído", description: "Parcela voltou para pendente e o saldo foi recalculado." })
    } catch (e) {
      toast({ title: "Falha na rede", description: String(e), variant: "destructive" })
    } finally {
      setEstornandoPagamentoKey(null)
      setEstornoLinhaConfirm(null)
    }
  }, [contas, estornoLinhaConfirm, lojaKey, persist, setMovimentos, toast])

  const atualizarHistoricoLinha = useCallback(
    (contaId: string | number, pagamentoId: string, patch: Partial<PagamentoLinha>) => {
      const conta = contas.find((c) => String(c.id) === String(contaId))
      if (!conta) return
      const mig = ensureHistoricoMigrado(conta)
      const idx = mig.historicoPagamentos.findIndex((h) => h.id === pagamentoId)
      if (idx < 0) return
      const linha = mig.historicoPagamentos[idx]
      if (linha.status !== "PAGO") return
      let novoValorTitulo = Math.round((Number(conta.valor) || 0) * 100) / 100
      const vOld = linha.valor
      let novoLinha: PagamentoLinha = { ...linha, ...patch }
      if (patch.valor != null && Math.abs(patch.valor - vOld) > 0.001) {
        novoValorTitulo = Math.round((novoValorTitulo + (vOld - patch.valor)) * 100) / 100
      }
      const hist = mig.historicoPagamentos.map((h) => (h.id === pagamentoId ? novoLinha : h))
      const livre = extrairObservacoesLivres(conta.observacoesPagamento)
      const sistema = extrairLinhasSistema(conta.observacoesPagamento)
      const obs = rebuildObservacoesPagamento({
        observacoesLivre: livre,
        historico: hist,
        linhasSistemaExtras: sistema,
        linhasLogsEstorno: extrairLinhasEstornoLog(conta.observacoesPagamento),
      })
      if (linha.movimentoId && patch.valor != null && Math.abs(patch.valor - vOld) > 0.001) {
        setMovimentos((prev) =>
          prev.map((m) =>
            m.id === linha.movimentoId ? { ...m, valor: Math.round(patch.valor! * 100) / 100 } : m
          )
        )
      }
      const atualizada: ContaReceberRow = {
        ...conta,
        valor: novoValorTitulo,
        observacoesPagamento: obs,
        historicoPagamentos: hist,
      }
      const next = contas.map((c) => (String(c.id) === String(contaId) ? atualizada : c))
      persist(next)
    },
    [contas, persist, setMovimentos]
  )

  const marcarComoPago = (conta: ContaReceberRow) => {
    if (conta.status === "pago") return
    const contaPaga: ContaReceberRow = { ...conta, status: "pago" }
    const next = contas.map((c) => (String(c.id) === String(conta.id) ? contaPaga : c))
    persist(next)
    toast({
      title: "Marcado como pago",
      description: "Somente o status foi alterado. Use Receber se quiser lançar a entrada no caixa.",
    })
  }

  const abrirEdicao = (conta: ContaReceberRow) => {
    setEditId(conta.id)
    setEditDesc(conta.descricao)
    setEditCliente(conta.cliente)
    setEditValor(String(conta.valor).replace(".", ","))
    setEditVenc(conta.vencimento)
    setEditTipo(conta.tipo)
    const s = (conta.status || "").toLowerCase()
    setEditStatus(s === "pago" || s === "atrasado" || s === "pendente" ? s : "pendente")
    setEditEntradaValor("")
    setEditEntradaForma(conta.formaPagamentoPreferida ?? "")
    setEditObsPagamento(conta.observacoesPagamento ?? "")
    setEditTotalOriginal(
      conta.total_value != null && Number.isFinite(Number(conta.total_value))
        ? String(conta.total_value).replace(".", ",")
        : ""
    )
    setEditEntryOriginal(
      conta.entry_value != null && Number.isFinite(Number(conta.entry_value))
        ? String(conta.entry_value).replace(".", ",")
        : ""
    )
    setEditHistoricoPagamentos(ensureHistoricoMigrado(conta).historicoPagamentos.map((x) => ({ ...x })))
    if (conta.parcelas && conta.parcelas.length > 0) {
      editPlanoDbRef.current = { inicialN: conta.parcelas.length }
      setEditParcelasDetalhe(
        conta.parcelas.map((x, i) => ({
          id: x.id?.trim() || `legacy-${String(conta.id)}-${i}`,
          venc: x.vencimento,
          valor: String(x.valor).replace(".", ","),
        }))
      )
      /** Plano soberano: N = quantidade de parcelas persistidas (evita redistribuir por parcelasTotal desalinhado). */
      setEditParcelasTotal(String(conta.parcelas.length))
    } else {
      editPlanoDbRef.current = null
      setEditParcelasDetalhe([])
      setEditParcelasTotal(String(conta.parcelasTotal ?? 1))
    }
    setEditOpen(true)
  }

  const saldoRestantePreview = useMemo(() => {
    const total = parseValorBr(editValor)
    const entrada = parseValorBr(editEntradaValor)
    if (!Number.isFinite(total) || total <= 0) return 0
    if (!Number.isFinite(entrada) || entrada <= 0) return total
    return Math.max(0, Math.round((total - entrada) * 100) / 100)
  }, [editValor, editEntradaValor])

  /** Snapshot alinhado às regras da modal de recebimento (contrato + valor + parcelas em edição). */
  const editContaPreview = useMemo((): ContaReceberRow | null => {
    if (editId === null || !editOpen) return null
    const valor = parseValorBr(editValor)
    const totalRaw = parseValorBr(editTotalOriginal)
    const entryRaw = parseValorBr(editEntryOriginal)
    const n = Math.max(1, Math.min(12, Math.round(Number(editParcelasTotal) || 1)))
    const parcelas =
      editParcelasDetalhe.length > 0
        ? editParcelasDetalhe.map((p, i) => ({
            id: p.id?.trim() || `pv-${String(editId)}-${i}`,
            vencimento: p.venc,
            valor: parseValorBr(p.valor),
          }))
        : undefined
    return {
      id: editId,
      descricao: editDesc,
      cliente: editCliente,
      valor: Number.isFinite(valor) ? Math.max(0, valor) : 0,
      vencimento: editVenc,
      status: editStatus,
      tipo: editTipo,
      total_value: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : undefined,
      entry_value: Number.isFinite(entryRaw) && entryRaw >= 0 ? entryRaw : undefined,
      parcelasTotal: n,
      parcelas,
      observacoesPagamento: editObsPagamento,
      historicoPagamentos: editHistoricoPagamentos,
    }
  }, [
    editId,
    editOpen,
    editDesc,
    editCliente,
    editValor,
    editVenc,
    editStatus,
    editTipo,
    editTotalOriginal,
    editEntryOriginal,
    editParcelasTotal,
    editParcelasDetalhe,
    editObsPagamento,
    editHistoricoPagamentos,
  ])

  const editSaldoEmAbertoAlinhado = useMemo(
    () => (editContaPreview ? saldoAberturaRecebimento(editContaPreview) : 0),
    [editContaPreview]
  )

  editVencAtualRef.current = editVenc

  const saldoDistribuicaoParcelasRef = useRef(0)
  saldoDistribuicaoParcelasRef.current = editContaPreview ? saldoParaParcelamento(editContaPreview) : 0

  useEffect(() => {
    if (!editOpen) {
      editPlanoDbRef.current = null
    }
  }, [editOpen])

  /**
   * Redistribui só quando `editParcelasTotal` muda (ou abre sem plano DB). Não depende de `contas` nem de `editVenc`:
   * com plano persistido e mesmo N, o snapshot em `editPlanoDbRef` impede sobrescrever datas/valores carregados do storage.
   */
  useEffect(() => {
    if (!editOpen || editId === null) return
    const nAsk = Math.max(1, Math.min(12, Math.round(Number(editParcelasTotal) || 1)))
    const plano = editPlanoDbRef.current
    if (plano && nAsk === plano.inicialN) {
      return
    }
    const base = String(editVencAtualRef.current ?? "").trim()
    const saldo = Math.max(0, Math.round(saldoDistribuicaoParcelasRef.current * 100) / 100)
    const per = nAsk > 0 ? Math.round((saldo / nAsk) * 100) / 100 : 0
    setEditParcelasDetalhe(
      Array.from({ length: nAsk }, (_, idx) => ({
        id: gerarIdParcelaPlano(),
        venc: base ? addMonthsSameDayBr(base, idx + 1) : "",
        valor: String(per).replace(".", ","),
      }))
    )
  }, [editOpen, editId, editParcelasTotal])

  const editParcelaSugestao = useMemo(() => {
    if (!editContaPreview) return 0
    const n = Math.max(1, Math.min(12, Math.round(Number(editParcelasTotal) || 1)))
    return valorParcelaSugerido(editContaPreview, n)
  }, [editContaPreview, editParcelasTotal])

  const darBaixaParcial = () => {
    if (editId === null) return
    const entrada = parseValorBr(editEntradaValor)
    if (entrada <= 0) {
      toast({ title: "Valor de entrada inválido", variant: "destructive" })
      return
    }
    const forma = (editEntradaForma || "").trim()
    if (!forma) {
      toast({ title: "Selecione a forma de pagamento", variant: "destructive" })
      return
    }
    const totalAtual = parseValorBr(editValor)
    if (totalAtual <= 0) {
      toast({ title: "Saldo atual inválido", variant: "destructive" })
      return
    }
    if (entrada > totalAtual + 0.009) {
      toast({ title: "Entrada maior que o saldo", description: "Digite um valor menor ou igual ao saldo devedor.", variant: "destructive" })
      return
    }

    const now = new Date()
    const dd = now.toLocaleDateString("pt-BR")
    const registro = `${dd} — Entrada ${forma}: R$ ${entrada.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
    const nextObs = [editObsPagamento.trim(), registro].filter(Boolean).join("\n")
    const saldo = Math.max(0, Math.round((totalAtual - entrada) * 100) / 100)
    const statusNext = saldo <= 0.009 ? "pago" : editStatus === "atrasado" ? "atrasado" : "pendente"

    const next = contas.map((c) =>
      String(c.id) === String(editId)
        ? {
            ...c,
            valor: saldo,
            status: statusNext,
            parcelasTotal: Math.max(1, Math.min(12, Math.round(Number(editParcelasTotal) || 1))),
            formaPagamentoPreferida: forma,
            observacoesPagamento: nextObs,
          }
        : c
    )
    persist(next)
    setEditValor(String(saldo).replace(".", ","))
    setEditStatus(statusNext)
    setEditObsPagamento(nextObs)
    setEditEntradaValor("")
    toast({ title: "Baixa parcial registrada", description: saldo <= 0.009 ? "Título quitado." : "Saldo atualizado." })
  }

  const salvarEdicao = () => {
    if (editId === null) return
    const valor = parseValorBr(editValor)
    if (valor <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" })
      return
    }
    const orig = contas.find((x) => String(x.id) === String(editId))
    if (!orig) return
    const origHist = ensureHistoricoMigrado(orig).historicoPagamentos
    let valorTitulo = valor
    const movimentosHistoricoAtualizados = new Set<string>()
    for (const hNew of editHistoricoPagamentos) {
      const hOld = origHist.find((x) => x.id === hNew.id)
      if (!hOld || hOld.status !== "PAGO" || hNew.status !== "PAGO") continue
      if (Math.abs((hOld.valor ?? 0) - (hNew.valor ?? 0)) <= 0.001) continue
      valorTitulo = Math.round((valorTitulo + (hOld.valor - hNew.valor)) * 100) / 100
      if (hOld.movimentoId) {
        movimentosHistoricoAtualizados.add(hOld.movimentoId)
        setMovimentos((prev) =>
          prev.map((m) =>
            m.id === hOld.movimentoId ? { ...m, valor: Math.round(hNew.valor * 100) / 100 } : m
          )
        )
      }
    }

    const statusNorm =
      editStatus === "pendente" || editStatus === "pago" || editStatus === "atrasado" ? editStatus : "pendente"
    let movimentoBaixaId = orig?.movimentoBaixaId

    if (orig?.movimentoBaixaId) {
      if (statusNorm !== "pago") {
        setMovimentos((prev) => prev.filter((m) => m.id !== orig.movimentoBaixaId))
        movimentoBaixaId = undefined
      } else if (!movimentosHistoricoAtualizados.has(orig.movimentoBaixaId)) {
        setMovimentos((prev) =>
          prev.map((m) =>
            m.id === orig.movimentoBaixaId
              ? {
                  ...m,
                  valor,
                  descricao: `Recebimento — ${editDesc.trim() || "Título"}`,
                }
              : m
          )
        )
      }
    }

    const totalMeta = editTotalOriginal.trim() === "" ? undefined : parseValorBr(editTotalOriginal)
    const entryMeta = editEntryOriginal.trim() === "" ? undefined : parseValorBr(editEntryOriginal)

    const obsFinal = rebuildObservacoesPagamento({
      observacoesLivre: extrairObservacoesLivres(editObsPagamento),
      historico: editHistoricoPagamentos,
      linhasSistemaExtras: extrairLinhasSistema(orig.observacoesPagamento),
      linhasLogsEstorno: extrairLinhasEstornoLog(orig.observacoesPagamento),
    })

    const next = contas.map((c) =>
      String(c.id) === String(editId)
        ? {
            ...c,
            descricao: editDesc.trim() || c.descricao,
            cliente: editCliente.trim() || "—",
            valor: valorTitulo,
            vencimento: editVenc.trim() || c.vencimento,
            tipo: editTipo.trim() || c.tipo,
            status: statusNorm || c.status,
            movimentoBaixaId,
            parcelasTotal: Math.max(1, Math.min(12, Math.round(Number(editParcelasTotal) || 1))),
            formaPagamentoPreferida: (editEntradaForma || "").trim() || undefined,
            observacoesPagamento: obsFinal,
            historicoPagamentos: editHistoricoPagamentos,
            total_value: totalMeta !== undefined && Number.isFinite(totalMeta) && totalMeta >= 0 ? totalMeta : undefined,
            entry_value: entryMeta !== undefined && Number.isFinite(entryMeta) && entryMeta >= 0 ? entryMeta : undefined,
            parcelas:
              editParcelasDetalhe.length > 0
                ? editParcelasDetalhe
                    .map((p) => ({
                      id: (p.id && String(p.id).trim()) || gerarIdParcelaPlano(),
                      vencimento: String(p.venc || "").trim(),
                      valor: parseValorBr(p.valor || ""),
                    }))
                    .filter((p) => p.vencimento && p.valor > 0)
                : undefined,
          }
        : c
    )
    persist(next)
    console.log("[Contas a Receber] Salvar alterações — total de títulos na tabela (localStorage):", next.length, {
      loja: lojaKey,
    })
    setEditOpen(false)
    toast({ title: "Título atualizado" })
  }

  const salvarNova = () => {
    const valor = parseValorBr(novaValor)
    if (!novaDesc.trim() || valor <= 0) {
      toast({ title: "Preencha descrição e valor", variant: "destructive" })
      return
    }
    const row: ContaReceberRow = {
      id: `cr-${Date.now()}`,
      descricao: novaDesc.trim(),
      cliente: novaCliente.trim() || "—",
      valor,
      vencimento: novaVenc.trim() || "—",
      status: "pendente",
      tipo: novaTipo.trim() || "Manual",
    }
    persist([row, ...contas])
    setNovaOpen(false)
    setNovaDesc("")
    setNovaCliente("")
    setNovaValor("")
    setNovaVenc("")
    setNovaTipo("Manual")
    toast({ title: "Título criado" })
  }

  const confirmarExclusao = () => {
    if (!deleteTarget) return
    if (deleteTarget.movimentoBaixaId) {
      setMovimentos((prev) => prev.filter((m) => m.id !== deleteTarget.movimentoBaixaId))
    }
    persist(contas.filter((c) => String(c.id) !== String(deleteTarget.id)))
    setDeleteTarget(null)
    toast({ title: "Título removido" })
  }

  const limparTudoContasReceber = () => {
    if (limparConfirmacao !== FRASE_CONFIRMACAO_LIMPAR) return
    try {
      localStorage.removeItem(contasReceberStorageKey(lojaKey))
      localStorage.removeItem(contasReceberLegacyImportKey(lojaKey))
      setContas([])
      window.dispatchEvent(new Event("assistec-contas-receber-imported"))
      toast({ title: "Lista de contas a receber limpa para esta loja" })
    } catch {
      toast({ title: "Não foi possível limpar os dados", variant: "destructive" })
    }
    setLimparConfirmacao("")
    setLimparOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-black/70">Total a receber (apenas pendentes)</p>
            <p className="text-xl font-bold text-black">
              R$ {resumo.totalReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-black/70">Pendentes</p>
            <p className="text-xl font-bold text-yellow-500">{resumo.pendentes}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-black/70">Atrasados</p>
            <p className="text-xl font-bold text-red-500">{resumo.atrasados}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <p className="text-sm text-black/70">Recebido (soma na lista)</p>
            <p className="text-xl font-bold text-green-500">
              R$ {resumo.recebidoMes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "abertos" as const, label: "Pendentes + atrasados" },
            { key: "pendente" as const, label: "Pendentes" },
            { key: "atrasado" as const, label: "Atrasados" },
            { key: "pago" as const, label: "Recebidos" },
            { key: "todos" as const, label: "Ver Todos" },
          ].map((item) => (
            <Button key={item.key} variant={filtro === item.key ? "default" : "outline"} size="sm" onClick={() => setFiltro(item.key)}>
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cr-busca-cliente" className="text-xs text-black/70">
              Pesquisa por nome do cliente
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/70" />
              <Input
                id="cr-busca-cliente"
                placeholder="Ex: Nome do cliente, CPF ou ID do pedido"
                className="pl-10 w-56"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Filtrar pela coluna Cliente"
              />
            </div>
            <p className="text-[11px] text-black/70 max-w-[14rem] leading-snug">
              Filtra por Cliente <em>ou</em> Descrição (sem diferenciar maiúsculas/minúsculas e sem acentos).
            </p>
          </div>
          <Button type="button" onClick={() => setNovaOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Novo título
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Contas a receber</CardTitle>
          <CardDescription>
            Títulos a receber — controle local. A busca usa o nome do cliente gravado no título (na importação, o texto após
            o hífen na descrição; não é o campo Cadastrado por). Parcelas da planilha aparecem como linhas separadas com o
            mesmo cliente extraído.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filtro === "pago" ? (
            recebidosTabela.length === 0 ? (
              <p className="text-sm text-black/70 py-8 text-center">
                Nenhum recebimento nesta visão. Ajuste a filtragem ou registre baixas em títulos pendentes.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.07] to-transparent shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/70">
                        Total recebido hoje
                      </p>
                      <p className="mt-1 text-xl font-bold text-primary tabular-nums">
                        R$ {recebidosResumoAba.totalHoje.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/70">
                        Total a receber (mês)
                      </p>
                      <p className="mt-1 text-xl font-bold text-black tabular-nums">
                        R$ {recebidosResumoAba.totalAReceberMes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[10px] text-black/70 mt-1">Pendentes e atrasados com vencimento no mês atual.</p>
                    </CardContent>
                  </Card>
                  <Card className="border-destructive/25 bg-destructive/[0.04] shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/70">
                        Total em atraso
                      </p>
                      <p className="mt-1 text-xl font-bold text-destructive tabular-nums">
                        R$ {recebidosResumoAba.totalAtraso.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                <div className="space-y-6">
                  {recebidosPorDia.map(([iso, linhas]) => {
                    const subtotalDia = linhas.reduce((s, r) => s + r.valorExibido, 0)
                    const isoValido = /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso !== "0000-00-00"
                    const tituloDia = !isoValido
                      ? "Sem data no histórico"
                      : new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                    return (
                      <div key={iso} className="space-y-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between border-b border-border pb-2">
                          <h3 className="text-sm font-semibold text-black capitalize">{tituloDia}</h3>
                          <span className="text-xs text-black/70">
                            Subtotal do dia:{" "}
                            <span className="font-semibold tabular-nums text-black">
                              R$ {subtotalDia.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </span>
                          </span>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-border bg-card/50 shadow-sm">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-secondary/50 text-left text-black/70">
                                <th className="p-2.5 font-medium">Cliente</th>
                                <th className="p-2.5 font-medium text-right">Valor</th>
                                <th className="p-2.5 font-medium">Data</th>
                                <th className="p-2.5 font-medium">Forma</th>
                                <th className="p-2.5 font-medium">Responsável</th>
                                <th className="p-2.5 font-medium w-28">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linhas.map((row) => {
                                const fp = formaPagamentoComIcone(row.forma)
                                return (
                                  <tr
                                    key={row.chaveEstorno}
                                    className="border-b border-border/70 last:border-0 transition-colors hover:bg-primary/[0.04]"
                                  >
                                    <td className="p-2.5 align-top">
                                      <span className="font-medium text-black">{row.conta.cliente}</span>
                                      <p className="text-[11px] text-black/70 line-clamp-1">{row.conta.descricao}</p>
                                    </td>
                                    <td className="p-2.5 align-top text-right tabular-nums font-medium">
                                      R$ {row.valorExibido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="p-2.5 align-top text-black/70">{row.dataExibida}</td>
                                    <td className="p-2.5 align-top">
                                      <span className="inline-flex items-center gap-1.5" title={fp.label}>
                                        <span className="text-base leading-none" aria-hidden>
                                          {fp.icon}
                                        </span>
                                        <span className="text-[13px]">{fp.label}</span>
                                      </span>
                                    </td>
                                    <td className="p-2.5 align-top text-[13px] text-black/70">{row.responsavel}</td>
                                    <td className="p-2.5 align-top">
                                      <div className="flex flex-wrap items-center gap-1">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          className="h-8 shrink-0 text-orange-800 border-orange-300/80 hover:bg-orange-500/15"
                                          disabled={estornandoPagamentoKey === row.chaveEstorno}
                                          onClick={() => solicitarEstornoLinha(row.conta, row.linha)}
                                          aria-label="Estornar recebimento"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                          Estorno
                                        </Button>
                                        {row.linha ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 shrink-0 border-primary/25 text-primary hover:bg-primary/10"
                                            onClick={() => emitirReciboParcela(row.conta, row.linha!)}
                                            aria-label="Imprimir recibo"
                                          >
                                            <Receipt className="w-3.5 h-3.5 mr-1" />
                                            Recibo
                                          </Button>
                                        ) : null}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          ) : contasFiltradas.length === 0 ? (
            <p className="text-sm text-black/70 py-8 text-center">
              Nenhum título nesta visão. Importe um extrato em Configurações ou crie um novo título.
            </p>
          ) : (
            <div className="space-y-3">
              {contasFiltradas.map((conta) => {
                const statusConfig = getStatusConfig(conta.status)
                const podeReceber = conta.status !== "pago"

                return (
                  <div
                    key={String(conta.id)}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <Checkbox
                        checked={selectedTituloIds.includes(String(conta.id))}
                        onCheckedChange={(v) => {
                          const id = String(conta.id)
                          setSelectedTituloIds((prev) =>
                            v === true ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)
                          )
                        }}
                        aria-label={`Selecionar título ${conta.descricao}`}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-black truncate">{conta.descricao}</p>
                        <div className="flex items-center gap-2 text-sm text-black/70 flex-wrap">
                          <User className="w-3 h-3 shrink-0" />
                          <span className="truncate text-black">{conta.cliente}</span>
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-xs shrink-0">{conta.tipo}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-end">
                      <div className="text-right">
                        <p className="font-semibold text-black">
                          R$ {conta.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                        <div className="flex items-center justify-end gap-1 text-sm text-black/70">
                          <Calendar className="w-3 h-3" />
                          {conta.vencimento}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "px-2 py-1 rounded-full text-xs font-medium transition-colors",
                          statusConfig.bg,
                          statusConfig.color
                        )}
                      >
                        {statusConfig.label}
                      </span>
                      {podeReceber && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="shrink-0"
                          onClick={() => abrirModalBaixa(conta, "receber")}
                        >
                          <Banknote className="w-4 h-4 mr-1" />
                          Receber
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Ações">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {podeReceber && (
                            <DropdownMenuItem className={menuBaixaClass} onClick={() => abrirModalBaixa(conta, "receber")}>
                              <Banknote className="w-4 h-4 mr-2" />
                              Dar baixa / Receber
                            </DropdownMenuItem>
                          )}
                          {podeReceber && (
                            <DropdownMenuItem className={menuBaixaClass} onClick={() => marcarComoPago(conta)}>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Marcar como pago
                            </DropdownMenuItem>
                          )}
                          {podeReceber && (
                            <DropdownMenuItem
                              className={menuBaixaClass}
                              onClick={() => abrirModalBaixa(conta, "marcarComRecibo")}
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              Marcar como pago e gerar recibo
                            </DropdownMenuItem>
                          )}
                          {conta.status === "pago" && (
                            <DropdownMenuItem className={menuBaixaClass} onClick={() => abrirModalBaixa(conta, "reemitir")}>
                              <Printer className="w-4 h-4 mr-2" />
                              Gerar recibo
                            </DropdownMenuItem>
                          )}
                          {conta.status === "pago" &&
                            (conta.movimentoBaixaId ||
                              listarPagamentosEfetivos(ensureHistoricoMigrado(conta).historicoPagamentos).length > 0) && (
                              <DropdownMenuItem
                                className={menuEstornoClass}
                                disabled={
                                  estornandoId === String(conta.id) ||
                                  estornandoPagamentoKey?.startsWith(`${conta.id}-`)
                                }
                                onClick={() => {
                                  const mig = ensureHistoricoMigrado(conta)
                                  const pagos = listarPagamentosEfetivos(mig.historicoPagamentos)
                                  if (pagos.length > 0) {
                                    solicitarEstornoLinha(mig, pagos[pagos.length - 1]!)
                                  } else {
                                    solicitarEstornoMovimentoCaixa(mig)
                                  }
                                }}
                              >
                                <RotateCcw className="w-4 h-4 mr-2" />
                                Estornar pagamento
                              </DropdownMenuItem>
                            )}
                          {conta.status === "pago" && (
                            <DropdownMenuItem onClick={() => mudarParaPendente(conta)}>
                              <Undo2 className="w-4 h-4 mr-2" />
                              Mudar para pendente
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => abrirEdicao(conta)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className={menuExcluirClass} onClick={() => setDeleteTarget(conta)}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className={cn(dialogOmniClass, "sm:max-w-md")}>
          <div className="max-h-[90vh] overflow-y-auto overscroll-contain px-3 pt-4 pb-3 text-[13px] leading-snug">
            <DialogHeader className="space-y-1 pr-7 pb-2 text-left">
              <DialogTitle className="text-base leading-tight">Novo título a receber</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <div>
                <Label htmlFor="cr-nova-desc" className="text-xs">
                  Descrição
                </Label>
                <Input
                  id="cr-nova-desc"
                  className="h-8 text-sm"
                  value={novaDesc}
                  onChange={(e) => setNovaDesc(e.target.value)}
                  placeholder="Ex.: Serviço / venda"
                />
              </div>
              <div>
                <Label htmlFor="cr-nova-cli" className="text-xs">
                  Cliente
                </Label>
                <Input id="cr-nova-cli" className="h-8 text-sm" value={novaCliente} onChange={(e) => setNovaCliente(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cr-nova-val" className="text-xs">
                  Valor (R$)
                </Label>
                <Input id="cr-nova-val" className="h-8 text-sm" value={novaValor} onChange={(e) => setNovaValor(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label htmlFor="cr-nova-ven" className="text-xs">
                  Vencimento
                </Label>
                <Input id="cr-nova-ven" className="h-8 text-sm" value={novaVenc} onChange={(e) => setNovaVenc(e.target.value)} placeholder="DD/MM/AAAA" />
              </div>
              <div>
                <Label htmlFor="cr-nova-tipo" className="text-xs">
                  Tipo / referência
                </Label>
                <Input id="cr-nova-tipo" className="h-8 text-sm" value={novaTipo} onChange={(e) => setNovaTipo(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex flex-row flex-wrap items-center justify-start gap-2 border-t border-border pt-2">
              <Button variant="outline" type="button" size="sm" onClick={() => setNovaOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={salvarNova}>
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={baixaOpen}
        onOpenChange={(open) => {
          setBaixaOpen(open)
          if (!open) {
            baixaRecebimentoEmCursoRef.current = false
            setBaixaRegistrando(false)
            setBaixaConta(null)
            setBaixaForma("")
            setBaixaValor("")
            setBaixaParcelasTotal("1")
            setBaixaObsPagamento("")
            setBaixaProximoVenc("")
            setBaixaVencOriginal("")
            setBaixaParcelaSel(0)
            setBaixaVencBase("")
            setBaixaHistoricoRemoverIds([])
            setBaixaHistVerTudo(false)
          }
        }}
      >
        <DialogContent className={cn(dialogOmniClass, "sm:max-w-md min-h-0 max-h-[min(92dvh,720px)]")}>
          <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4 pb-2 text-[13px] leading-snug">
            <DialogHeader className="space-y-1 pr-7 pb-2 text-left">
              <DialogTitle className="text-base leading-tight">
                {baixaModo === "receber" && "Dar baixa / Receber"}
                {baixaModo === "marcarComRecibo" && "Marcar como pago e gerar recibo"}
                {baixaModo === "reemitir" && "Gerar recibo de pagamento"}
              </DialogTitle>
              <DialogDescription className="text-xs leading-snug">
                {baixaModo === "receber" &&
                  "Informe a forma e o valor a receber. Se o valor for menor que o saldo, a baixa será parcial (o restante fica pendente)."}
                {baixaModo === "marcarComRecibo" &&
                  "O título será marcado como pago (sem lançamento no caixa) e o recibo será impresso."}
                {baixaModo === "reemitir" && "Reimpressão do recibo; informe a forma de pagamento para constar no cupom."}
              </DialogDescription>
            </DialogHeader>
          {baixaContaLive && (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-[13px]">
                <p className="font-medium text-black line-clamp-2">{baixaContaLive.descricao}</p>
                <p className="text-black">{baixaContaLive.cliente}</p>
                <p className="font-semibold tabular-nums">
                  R$ {baixaAbertura.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                {baixaContaLive.total_value != null && baixaContaLive.entry_value != null && (
                  <p className="text-[11px] text-black/70 mt-1">
                    Contrato: total R${" "}
                    {Number(baixaContaLive.total_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · entrada R${" "}
                    {Number(baixaContaLive.entry_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · saldo em
                    aberto = min(valor do título, total − entrada). Parcela sugerida = saldo após entrada ÷ parcelas.
                  </p>
                )}
                {Math.abs(baixaAbertura - baixaContaLive.valor) > 0.02 && (
                  <p className="text-[11px] text-amber-600/90 mt-1">
                    Valor gravado no título (R${" "}
                    {baixaContaLive.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) difere do saldo em
                    aberto; o recebimento usa o saldo em aberto.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cr-baixa-forma" className="text-xs">
                  Forma de pagamento *
                </Label>
                <Select value={baixaForma} onValueChange={setBaixaForma}>
                  <SelectTrigger id="cr-baixa-forma" className="h-8 w-full text-sm">
                    <SelectValue placeholder="Selecione…" />
                  </SelectTrigger>
                  <SelectContent>
                    {baixaModo === "receber" ? (
                      <>
                        <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="PIX">PIX</SelectItem>
                        <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
                        <SelectItem value="Cartão de Débito">Cartão de Débito</SelectItem>
                      </>
                    ) : (
                      FORMAS_PAGAMENTO_RECIBO.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              {baixaModo === "receber" && (
                <div className="rounded-md border border-border bg-secondary/20 p-2 space-y-2">
                  {baixaNParcelas > 1 &&
                    parcelasVencimentos.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[13px] font-medium">Plano de parcelas</p>
                        <div className="max-h-[min(280px,45vh)] overflow-y-auto overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-border/80 bg-muted/40 text-left text-black/70">
                                <th className="px-2 py-2 font-medium">#</th>
                                <th className="px-2 py-2 font-medium">Vencimento</th>
                                <th className="px-2 py-2 font-medium text-right">Valor</th>
                                <th className="px-2 py-2 font-medium">Status</th>
                                <th className="px-2 py-2 font-medium text-right w-[108px]">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {parcelasVencimentos.map((venc, idx) => {
                                const nParc = baixaNParcelas
                                const isSel = baixaParcelaSel === idx
                                const st = statusParcelaPlano(idx, venc, nParc, baixaContaLive)
                                const linhaP = linhaPagoParcela(idx, nParc, baixaContaLive)
                                const valorLinha = valorRestanteParcelaNoPlano(baixaContaLive, idx, nParc)
                                const next =
                                  parcelasVencimentos[idx + 1] ??
                                  (baixaVencBase || venc ? addMonthsSameDayBr(baixaVencBase || venc, idx + 2) : "")
                                const nextVencFin = next.trim() ? next : addDaysBr(30)
                                const selecionarLinha = () => {
                                  setBaixaParcelaSel(idx)
                                  setBaixaValor(String(valorLinha).replace(".", ","))
                                  setBaixaVencOriginal(venc)
                                  setBaixaProximoVenc(nextVencFin)
                                }
                                const badge =
                                  st === "pago" ? (
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                                    >
                                      Pago
                                    </Badge>
                                  ) : st === "parcial" ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-sky-500/45 bg-sky-500/15 text-sky-900 dark:text-sky-200"
                                      >
                                        PARCIAL
                                      </Badge>
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-amber-500/40 bg-amber-500/12 text-amber-900 dark:text-amber-200 text-[10px] px-1.5 py-0"
                                      >
                                        Saldo em aberto
                                      </Badge>
                                    </div>
                                  ) : st === "atrasado" ? (
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-red-500/40 bg-red-500/15 text-red-800 dark:text-red-300"
                                    >
                                      Atrasado
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                                    >
                                      Pendente
                                    </Badge>
                                  )
                                return (
                                  <tr
                                    key={`parc-row-${idx}`}
                                    className={cn(
                                      "cursor-pointer border-b border-border/50 transition-colors last:border-b-0",
                                      "hover:bg-red-500/[0.10] hover:shadow-[inset_0_0_0_1px_rgba(239,68,68,0.28)]",
                                      isSel && "bg-sky-600/15 ring-2 ring-inset ring-sky-500 shadow-sm"
                                    )}
                                    onClick={selecionarLinha}
                                  >
                                    <td className="p-0 align-middle">
                                      <div className="flex min-h-[48px] items-center px-2 py-2.5 font-medium tabular-nums">
                                        {idx + 1}/{nParc}
                                      </div>
                                    </td>
                                    <td className="p-0 align-middle">
                                      <div className="flex min-h-[48px] items-center px-2 py-2.5 text-black/70 tabular-nums">
                                        {venc}
                                      </div>
                                    </td>
                                    <td className="p-0 align-middle">
                                      <div className="flex min-h-[48px] items-center justify-end px-2 py-2.5 text-right tabular-nums font-medium">
                                        R${" "}
                                        {valorLinha.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                      </div>
                                    </td>
                                    <td className="p-0 align-middle">
                                      <div className="flex min-h-[48px] w-full items-center px-2 py-2.5 text-left pointer-events-none">
                                        {badge}
                                      </div>
                                    </td>
                                    <td className="p-0 align-middle w-[120px]" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex min-h-[48px] items-center justify-end gap-1 px-1 py-1">
                                        {st !== "pago" ? (
                                          <button
                                            type="button"
                                            className={cn(
                                              "inline-flex h-11 min-h-[44px] min-w-[44px] flex-1 max-w-[52px] items-center justify-center rounded-md",
                                              "text-sky-800 dark:text-sky-200 hover:bg-red-500/12 hover:ring-1 hover:ring-red-500/30",
                                              "active:bg-sky-600 active:text-white active:ring-2 active:ring-sky-400/70 active:scale-[0.97] transition-colors duration-150"
                                            )}
                                            title="Preencher valor desta parcela e confirmar com Salvar e imprimir"
                                            onClick={() => {
                                              selecionarLinha()
                                              window.requestAnimationFrame(() => baixaValorInputRef.current?.focus())
                                            }}
                                          >
                                            <ChevronRight className="w-4 h-4 pointer-events-none" />
                                          </button>
                                        ) : (
                                          linhaP && (
                                            <>
                                              <button
                                                type="button"
                                                className={cn(
                                                  "inline-flex h-11 min-h-[44px] min-w-[44px] flex-1 max-w-[52px] items-center justify-center rounded-md",
                                                  "text-orange-700 hover:bg-orange-500/15",
                                                  "active:bg-red-600 active:text-white active:scale-[0.97] transition-colors duration-150"
                                                )}
                                                title="Estornar"
                                                onClick={() => solicitarEstornoLinha(baixaContaLive, linhaP)}
                                              >
                                                <RotateCcw className="w-3.5 h-3.5 pointer-events-none" />
                                              </button>
                                              <button
                                                type="button"
                                                className={cn(
                                                  "inline-flex h-11 min-h-[44px] min-w-[44px] flex-1 max-w-[52px] items-center justify-center rounded-md",
                                                  "text-primary hover:bg-primary/10",
                                                  "active:bg-red-600 active:text-white active:scale-[0.97] transition-colors duration-150"
                                                )}
                                                title="Imprimir recibo"
                                                onClick={() => emitirReciboParcela(baixaContaLive, linhaP)}
                                              >
                                                <Receipt className="w-3.5 h-3.5 pointer-events-none" />
                                              </button>
                                            </>
                                          )
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-black/70">
                          Linha {baixaParcelaSel + 1}/{parcelasVencimentos.length}. O recebimento usa sempre o valor do campo{" "}
                          <span className="font-medium text-black">Valor a receber</span> — ajuste e confirme no rodapé.
                        </p>
                      </div>
                    )}
                  <div className="space-y-2">
                    {baixaNParcelas > 1 ? (
                      <p className="text-[13px] font-semibold tracking-tight text-foreground">
                        Parcela: {baixaParcelaSel + 1} de{" "}
                        {baixaNParcelas}
                      </p>
                    ) : (
                      <p className="text-[13px] font-semibold tracking-tight text-foreground">Título à vista</p>
                    )}
                    <div>
                      <Label htmlFor="cr-baixa-valor" className="text-xs">
                        Valor a receber (R$) *
                      </Label>
                      <Input
                        id="cr-baixa-valor"
                        ref={baixaValorInputRef}
                        className="h-9 text-sm"
                        value={baixaValor}
                        onChange={(e) => setBaixaValor(e.target.value)}
                        placeholder={
                          baixaNParcelas > 1
                            ? String(baixaParcelaSugestao).replace(".", ",")
                            : String(baixaAbertura).replace(".", ",")
                        }
                      />
                      <p className="text-[10px] text-black/70 mt-0.5">
                        Saldo disponível nesta parcela/operação: R${" "}
                        {baixaParcelaSugestao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      {baixaNParcelas > 1 && (
                        <p className="text-[10px] text-black/70 mt-0.5">
                          Clique numa parcela acima para preencher o valor total; edite para abatimento parcial.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="cr-baixa-proxvenc" className="text-xs">
                        Próximo vencimento
                      </Label>
                      <Input
                        id="cr-baixa-proxvenc"
                        className="h-8 text-sm"
                        value={baixaProximoVenc}
                        onChange={(e) => setBaixaProximoVenc(e.target.value)}
                        placeholder={addDaysBr(30)}
                      />
                      <p className="text-[10px] text-black/70 mt-0.5">Sugestão automática: 30 dias para frente.</p>
                    </div>
                    <div />
                  </div>

                  {baixaVencOriginal?.trim() && (
                    <p className="text-[11px] text-black/70">
                      Recebendo parcela com vencimento original em: <span className="font-medium">{baixaVencOriginal}</span>
                    </p>
                  )}

                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-black/70">Saldo restante (após receber)</p>
                      <p className="text-base font-semibold tabular-nums">
                        R$ {baixaSaldoRestanteAposReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                      {baixaContaLive.total_value != null && baixaContaLive.entry_value != null && (
                        <p className="text-[11px] text-black/70 mt-1">
                          Abatimento da entrada: o saldo em aberto (R${" "}
                          {baixaAbertura.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) já considera total −
                          entrada quando o valor gravado no título está acima disso. Após receber: saldo em aberto −
                          agora = R${" "}
                          {baixaSaldoRestanteAposReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.
                          {Math.abs(baixaAbertura - (Number(baixaContaLive.total_value) - Number(baixaContaLive.entry_value))) <
                          0.02 ? (
                            <span>
                              {" "}
                              (equivale a total R${" "}
                              {Number(baixaContaLive.total_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} −
                              entrada R${" "}
                              {Number(baixaContaLive.entry_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} −
                              agora R${" "}
                              {baixaValorNumerico.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})
                            </span>
                          ) : null}
                        </p>
                      )}
                      <p className="text-[11px] text-black/70">
                        {baixaEhAbatimento
                          ? "Abatimento: o valor digitado é menor que o saldo desta parcela/operação — confirme com o botão abaixo."
                          : baixaValorNumerico > 0 && baixaValorNumerico + 0.009 < baixaAbertura
                            ? "Baixa parcial no título."
                            : "Quitação do saldo indicado."}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-black/70">Sugestão</p>
                      <p className="text-xs font-medium">
                        {baixaEhAbatimento
                          ? "Confirmar abatimento"
                          : baixaValorNumerico > 0 && baixaValorNumerico + 0.009 < baixaAbertura
                            ? "Dar baixa parcial"
                            : "Receber total"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="cr-baixa-obs" className="text-xs">
                      Observações de pagamento
                    </Label>
                    <textarea
                      id="cr-baixa-obs"
                      value={baixaObsPagamento}
                      onChange={(e) => setBaixaObsPagamento(e.target.value)}
                      className="mt-1 min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      placeholder="Ex: Nome do cliente, CPF ou ID do pedido"
                    />
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[12px] font-medium">Histórico de pagamentos</p>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {baixaHistoricoPagamentosUi.length > 5 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-black/70"
                            onClick={() => setBaixaHistVerTudo((v) => !v)}
                          >
                            {baixaHistVerTudo ? "Mostrar menos" : `Ver tudo (${baixaHistoricoPagamentosUi.length})`}
                          </Button>
                        ) : null}
                        {ensureHistoricoMigrado(baixaContaLive).historicoPagamentos.some((x) => x.status !== "PAGO") ||
                        extrairLinhasEstornoLog(baixaContaLive.observacoesPagamento).length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-black/70 hover:text-black"
                            onClick={() => setLimparEstornosHistBaixaOpen(true)}
                            title="Remover linhas PENDENTE (estorno) e logs de estorno em texto"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            <span className="text-[11px]">Limpar estornos</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {baixaHistoricoPagamentosUi.length === 0 ? (
                      <p className="text-[11px] text-black/70">Nenhum recebimento registrado ainda neste título.</p>
                    ) : (
                      <ul className="space-y-1.5 max-h-32 overflow-y-auto overscroll-contain pr-1">
                        {(baixaHistVerTudo ? baixaHistoricoPagamentosUi : baixaHistoricoPagamentosUi.slice(0, 5)).map((h) => {
                          const marcadaRemocao = baixaHistoricoRemoverIds.includes(h.id)
                          return (
                          <li
                            key={`${h.id}-${h.dataPagamento}-${h.valor}-${h.status}`}
                            className={cn(
                              "rounded-md border p-1.5 space-y-1",
                              marcadaRemocao && "border-dashed border-destructive/50 bg-destructive/[0.04]",
                              !marcadaRemocao &&
                                (h.status === "PENDENTE"
                                  ? "border-orange-500/35 bg-orange-500/[0.06]"
                                  : "border-border/70 bg-card/40")
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={cn(
                                  "text-[11px] text-foreground leading-snug pr-1 min-w-0 flex-1",
                                  h.status !== "PAGO" && "line-through decoration-foreground/50 text-black/70"
                                )}
                              >
                                {h.status === "PAGO"
                                  ? tituloExibicaoHistoricoPagamento(h, baixaContaLive)
                                  : (() => {
                                      const n = h.parcelaIndex != null ? h.parcelaIndex + 1 : "?"
                                      const v =
                                        h.vencimentoParcelaBr ||
                                        vencimentoParcelaParaEstorno(h, baixaContaLive) ||
                                        "—"
                                      return `Estornado — parcela ${n} (venc. ${v})`
                                    })()}
                              </p>
                              <div className="flex shrink-0 items-center gap-0.5">
                                {marcadaRemocao && (
                                  <span className="text-[10px] text-destructive font-medium whitespace-nowrap hidden sm:inline">
                                    Remover ao salvar
                                  </span>
                                )}
                                {h.status === "PAGO" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-orange-700 hover:bg-orange-500/15"
                                    aria-label="Estornar recebimento"
                                    onClick={() => solicitarEstornoLinha(baixaContaLive, h)}
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-7 w-7",
                                    marcadaRemocao
                                      ? "text-destructive bg-destructive/10"
                                      : "text-black/70 hover:text-destructive"
                                  )}
                                  aria-label={
                                    marcadaRemocao
                                      ? "Desfazer remoção desta linha"
                                      : "Marcar linha para remoção permanente ao salvar"
                                  }
                                  title="Remove ao clicar em Salvar ou Imprimir"
                                  onClick={() =>
                                    setBaixaHistoricoRemoverIds((prev) =>
                                      prev.includes(h.id) ? prev.filter((x) => x !== h.id) : [...prev, h.id]
                                    )
                                  }
                                >
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <Label className="text-[10px] text-black/70">Data do recebimento</Label>
                                <Input
                                  className={cn(
                                    "h-7 text-xs",
                                    h.status !== "PAGO" && "line-through opacity-80"
                                  )}
                                  defaultValue={isoParaBr(h.dataPagamento)}
                                  disabled={h.status !== "PAGO"}
                                  ref={(el) => {
                                    const cur = histBaixaInputRefs.current[h.id] ?? { data: null, valor: null }
                                    cur.data = el
                                    histBaixaInputRefs.current[h.id] = cur
                                  }}
                                  onBlur={(e) => {
                                    const iso = brParaIso(e.target.value.trim())
                                    if (!iso || iso === h.dataPagamento) return
                                    atualizarHistoricoLinha(baixaContaLive.id, h.id, { dataPagamento: iso })
                                  }}
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] text-black/70">Valor (R$)</Label>
                                <Input
                                  className={cn(
                                    "h-7 text-xs",
                                    h.status !== "PAGO" && "line-through opacity-80"
                                  )}
                                  defaultValue={String(h.valor).replace(".", ",")}
                                  disabled={h.status !== "PAGO"}
                                  ref={(el) => {
                                    const cur = histBaixaInputRefs.current[h.id] ?? { data: null, valor: null }
                                    cur.valor = el
                                    histBaixaInputRefs.current[h.id] = cur
                                  }}
                                  onBlur={(e) => {
                                    const v = parseValorBr(e.target.value)
                                    if (!Number.isFinite(v) || Math.abs(v - h.valor) < 0.005) return
                                    atualizarHistoricoLinha(baixaContaLive.id, h.id, { valor: v })
                                  }}
                                />
                              </div>
                            </div>
                          </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
          </div>
          <div className="shrink-0 border-t border-border bg-muted/40 px-3 py-2.5 flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setBaixaOpen(false)}>
                Fechar
              </Button>
              {baixaModo === "receber" && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className={cn(
                      "min-h-10 px-4 text-white transition-colors",
                      "active:scale-[0.98] active:bg-red-600 active:ring-2 active:ring-red-500/70",
                      baixaEhAbatimento ? "bg-sky-600 hover:bg-sky-700" : "bg-green-600 hover:bg-green-700"
                    )}
                    disabled={baixaRegistrando}
                    aria-busy={baixaRegistrando}
                    aria-label={
                      baixaEhAbatimento
                        ? "Confirmar abatimento, gravar e imprimir o comprovante"
                        : "Registrar recebimento, gravar e imprimir o comprovante"
                    }
                    onClick={() => registrarRecebimentoClick(true)}
                  >
                    <Banknote className="mr-1.5 h-3.5 w-3.5" />
                    <Printer className="mr-1.5 h-3.5 w-3.5" />
                    {baixaEhAbatimento ? "Confirmar e imprimir" : "Salvar e imprimir"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "min-h-10 px-4 transition-all duration-500 ease-out",
                      "hover:bg-red-500/10 hover:border-red-400/45 active:bg-sky-500/15"
                    )}
                    disabled={baixaRegistrando}
                    aria-busy={baixaRegistrando}
                    aria-label={
                      baixaEhAbatimento
                        ? "Confirmar abatimento sem abrir impressão"
                        : "Registrar recebimento sem abrir impressão"
                    }
                    onClick={() => registrarRecebimentoClick(false)}
                  >
                    {baixaEhAbatimento ? "Confirmar sem comprovante" : "Registrar sem imprimir"}
                  </Button>
                </>
              )}
              {baixaModo === "marcarComRecibo" && (
                <Button type="button" size="sm" className="bg-green-600 text-white hover:bg-green-700" onClick={confirmarMarcarComRecibo}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  Marcar como pago e imprimir
                </Button>
              )}
              {baixaModo === "reemitir" && (
                <Button type="button" size="sm" className="bg-green-600 text-white hover:bg-green-700" onClick={confirmarReemitirRecibo}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  Imprimir recibo
                </Button>
              )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={limparEstornosHistBaixaOpen} onOpenChange={setLimparEstornosHistBaixaOpen}>
        <AlertDialogContent className={cn(alertDialogOmniClass, "sm:max-w-md")}>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar histórico de estornos?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove permanentemente as linhas em estado de estorno (PENDENTE) e os textos de log de estorno neste título.
              Recebimentos ativos (PAGO) permanecem. Esta ação grava imediatamente no armazenamento local.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={confirmarLimparEstornosHistBaixa}
            >
              Limpar estornos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className={cn(dialogOmniClass, "sm:max-w-lg")}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pt-4 pb-2 text-[13px] leading-snug">
            <DialogHeader className="space-y-1 pr-7 pb-2 text-left">
              <DialogTitle className="text-base leading-tight">Editar título</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
            <div>
              <Label htmlFor="cr-ed-desc" className="text-xs">
                Descrição
              </Label>
              <Input id="cr-ed-desc" className="h-8 text-sm" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cr-ed-cli" className="text-xs">
                Cliente
              </Label>
              <Input id="cr-ed-cli" className="h-8 text-sm" value={editCliente} onChange={(e) => setEditCliente(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cr-ed-val" className="text-xs">
                Valor (R$)
              </Label>
              <Input id="cr-ed-val" className="h-8 text-sm" value={editValor} onChange={(e) => setEditValor(e.target.value)} />
              <p className="text-[10px] text-black/70 mt-0.5">
                Saldo em aberto (mesma regra do recebimento):{" "}
                <span className="font-semibold text-black tabular-nums">
                  R$ {editSaldoEmAbertoAlinhado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </p>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div>
                <Label htmlFor="cr-ed-total-orig" className="text-xs">
                  Total original (total_value)
                </Label>
                <Input
                  id="cr-ed-total-orig"
                  className="h-8 text-sm"
                  placeholder="Ex.: 1290,00"
                  value={editTotalOriginal}
                  onChange={(e) => setEditTotalOriginal(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cr-ed-entry-orig" className="text-xs">
                  Entrada (entry_value)
                </Label>
                <Input
                  id="cr-ed-entry-orig"
                  className="h-8 text-sm"
                  placeholder="Ex.: 200,00"
                  value={editEntryOriginal}
                  onChange={(e) => setEditEntryOriginal(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cr-ed-ven" className="text-xs">
                Vencimento
              </Label>
              <Input id="cr-ed-ven" className="h-8 text-sm" value={editVenc} onChange={(e) => setEditVenc(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cr-ed-tipo" className="text-xs">
                Tipo / referência
              </Label>
              <Input id="cr-ed-tipo" className="h-8 text-sm" value={editTipo} onChange={(e) => setEditTipo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <p id="cr-ed-st" className="text-xs font-medium text-foreground">
                Status
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={cn(
                    "min-h-11 w-full rounded-md border px-2 text-sm font-medium transition-colors",
                    editStatus === "pendente"
                      ? "border-sky-500 bg-sky-600 text-white shadow-sm ring-2 ring-sky-400/40"
                      : "border-border bg-background hover:bg-red-500/10 hover:border-red-400/40 active:bg-sky-500/20"
                  )}
                  onClick={() => setEditStatus("pendente")}
                >
                  Pendente
                </button>
                <button
                  type="button"
                  className={cn(
                    "min-h-11 w-full rounded-md border px-2 text-sm font-medium transition-colors",
                    editStatus === "atrasado"
                      ? "border-sky-500 bg-sky-600 text-white shadow-sm ring-2 ring-sky-400/40"
                      : "border-border bg-background hover:bg-red-500/10 hover:border-red-400/40 active:bg-sky-500/20"
                  )}
                  onClick={() => setEditStatus("atrasado")}
                >
                  Atrasado
                </button>
              </div>
              <button
                type="button"
                className={cn(
                  "min-h-10 w-full rounded-md border px-2 text-sm font-medium transition-colors",
                  editStatus === "pago"
                    ? "border-sky-500 bg-sky-600 text-white shadow-sm ring-2 ring-sky-400/40"
                    : "border-border bg-background hover:bg-red-500/10 hover:border-red-400/40 active:bg-sky-500/20"
                )}
                onClick={() => setEditStatus("pago")}
              >
                Pago (recebido)
              </button>
            </div>

            <div className="rounded-md border border-border bg-secondary/20 p-2 space-y-1.5">
              <p className="text-[13px] font-medium">Pagamento / parcelamento</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cr-ed-entrada" className="text-xs">
                    Valor de entrada (R$)
                  </Label>
                  <Input
                    id="cr-ed-entrada"
                    className="h-8 text-sm"
                    placeholder="Ex.: 100,00"
                    value={editEntradaValor}
                    onChange={(e) => setEditEntradaValor(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="cr-ed-forma" className="text-xs">
                    Forma de pagamento
                  </Label>
                  <Select value={editEntradaForma} onValueChange={setEditEntradaForma}>
                    <SelectTrigger id="cr-ed-forma" className="h-8 w-full text-sm">
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="Pix">Pix</SelectItem>
                      <SelectItem value="Cartão">Cartão</SelectItem>
                      <SelectItem value="Boleto">Boleto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-1.5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cr-ed-parcelas" className="text-xs">
                    Número de parcelas
                  </Label>
                  <Input
                    id="cr-ed-parcelas"
                    className="h-8 text-sm"
                    inputMode="numeric"
                    value={editParcelasTotal}
                    onChange={(e) => setEditParcelasTotal(e.target.value)}
                    placeholder="1"
                  />
                  <p className="text-[10px] text-black/70 mt-0.5">De 1x até 12x.</p>
                </div>
                <div className="flex flex-col justify-end gap-0.5">
                  <p className="text-[11px] text-black/70">Saldo em aberto (recebimento)</p>
                  <p className="text-base font-semibold tabular-nums">
                    R$ {editSaldoEmAbertoAlinhado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </p>
                  {parseValorBr(editEntradaValor) > 0.005 && (
                    <p className="text-[10px] text-black/70">
                      Após entrada avulsa (simulação): R${" "}
                      {saldoRestantePreview.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-black/70">
                Valor sugerido por parcela: R${" "}
                {editParcelaSugestao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                <span> (base parcelamento ÷ parcelas, alinhado ao recebimento)</span>
              </p>

              <div>
                <Label htmlFor="cr-ed-obs" className="text-xs">
                  Observações de pagamento
                </Label>
                <textarea
                  id="cr-ed-obs"
                  value={editObsPagamento}
                  onChange={(e) => setEditObsPagamento(e.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  placeholder="Ex: Nome do cliente, CPF ou ID do pedido"
                />
              </div>
            </div>

            {editHistoricoPagamentos.length > 0 && (
              <div className="rounded-md border border-border bg-secondary/10 p-2 space-y-2">
                <p className="text-[13px] font-medium">Histórico de recebimentos</p>
                <p className="text-[10px] text-black/70">
                  Ajuste data e valor das linhas; as alterações serão gravadas ao clicar em Salvar alterações.
                </p>
                <ul className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {editHistoricoPagamentos.map((h) => {
                    const editConta = contas.find((c) => String(c.id) === String(editId))
                    return (
                      <li key={h.id} className="rounded-md border border-border/80 p-2 space-y-1.5">
                        <p className="text-[11px] text-foreground leading-snug">
                          {tituloExibicaoHistoricoPagamento(h, editConta ?? undefined)}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-black/70">Data do recebimento</Label>
                            <Input
                              key={`ed-hd-${h.id}-${h.dataPagamento}-${h.valor}`}
                              className="h-7 text-xs"
                              defaultValue={isoParaBr(h.dataPagamento)}
                              disabled={h.status !== "PAGO"}
                              onBlur={(e) => {
                                if (h.status !== "PAGO") return
                                const iso = brParaIso(e.target.value.trim())
                                if (!iso || iso === h.dataPagamento) return
                                setEditHistoricoPagamentos((prev) =>
                                  prev.map((x) => (x.id === h.id ? { ...x, dataPagamento: iso } : x))
                                )
                              }}
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-black/70">Valor (R$)</Label>
                            <Input
                              key={`ed-hv-${h.id}-${h.valor}-${h.dataPagamento}`}
                              className="h-7 text-xs"
                              defaultValue={String(h.valor).replace(".", ",")}
                              disabled={h.status !== "PAGO"}
                              onBlur={(e) => {
                                if (h.status !== "PAGO") return
                                const v = parseValorBr(e.target.value)
                                if (!Number.isFinite(v) || Math.abs(v - h.valor) < 0.005) return
                                setEditHistoricoPagamentos((prev) =>
                                  prev.map((x) => (x.id === h.id ? { ...x, valor: v } : x))
                                )
                              }}
                            />
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

              {editParcelasDetalhe.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/10 p-2 space-y-1.5">
                  <p className="text-[13px] font-medium">Parcelas (valores e vencimentos)</p>
                  <div className="space-y-1.5">
                    {editParcelasDetalhe.map((p, idx) => (
                      <div key={`ed-parc-${idx}`} className="grid gap-1.5 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs text-black/70">Parcela {idx + 1}</Label>
                          <Input
                            className="h-8 text-sm"
                            value={p.venc}
                            onChange={(e) => {
                              const v = e.target.value
                              setEditParcelasDetalhe((prev) => prev.map((x, i) => (i === idx ? { ...x, venc: v } : x)))
                            }}
                            placeholder="DD/MM/AAAA"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-black/70">Valor (R$)</Label>
                          <Input
                            className="h-8 text-sm"
                            value={p.valor}
                            onChange={(e) => {
                              const v = e.target.value
                              setEditParcelasDetalhe((prev) => prev.map((x, i) => (i === idx ? { ...x, valor: v } : x)))
                            }}
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-muted/40 px-3 py-2.5 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" type="button" size="sm" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={darBaixaParcial}
              disabled={!editEntradaValor.trim() || !editEntradaForma.trim()}
            >
              Dar baixa parcial
            </Button>
            <Button type="button" size="sm" onClick={salvarEdicao}>
              Salvar alterações
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!estornoMovimentoConfirm} onOpenChange={(o) => !o && setEstornoMovimentoConfirm(null)}>
        <AlertDialogContent className={alertDialogOmniClass}>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {estornoMovimentoConfirm?.movimentoBaixaId
                ? (() => {
                    const mov = movimentos.find((m) => m.id === estornoMovimentoConfirm.movimentoBaixaId)
                    const valor = mov ? Math.round(mov.valor * 100) / 100 : 0
                    return `Estornar o pagamento de R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}? O lançamento será removido do caixa e o saldo devedor será restaurado.`
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 text-white hover:bg-orange-700"
              onClick={() => void confirmarEstornoMovimentoCaixa()}
            >
              Estornar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!estornoLinhaConfirm} onOpenChange={(o) => !o && setEstornoLinhaConfirm(null)}>
        <AlertDialogContent className={alertDialogOmniClass}>
          <AlertDialogHeader>
            <AlertDialogTitle>Estornar este recebimento?</AlertDialogTitle>
            <AlertDialogDescription>
              {estornoLinhaConfirm
                ? (() => {
                    const venc = vencimentoParcelaParaEstorno(estornoLinhaConfirm.linha, estornoLinhaConfirm.conta)
                    const val = estornoLinhaConfirm.linha.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                    const resto =
                      ` O valor de R$ ${val} voltará ao saldo devedor e a linha ficará pendente.`
                    return venc
                      ? `Deseja estornar o pagamento da parcela com vencimento em ${venc}?${resto}`
                      : `O valor de R$ ${val} voltará ao saldo devedor e a linha ficará pendente.`
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 text-white hover:bg-orange-700"
              onClick={() => void confirmarEstornoLinha()}
            >
              Estornar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className={alertDialogOmniClass}>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir título?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o lançamento de contas a receber
              {deleteTarget?.movimentoBaixaId ? " e a movimentação de caixa vinculada à baixa" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarExclusao}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-destructive/35 bg-destructive/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            Ações críticas
          </CardTitle>
          <CardDescription>
            Operações irreversíveis neste navegador. Use apenas quando precisar recomeçar os dados de Contas a Receber
            desta loja.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="border-destructive/60 text-destructive hover:bg-destructive/10"
            onClick={() => {
              setLimparConfirmacao("")
              setLimparOpen(true)
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Limpar tudo Contas a Receber
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={limparOpen}
        onOpenChange={(open) => {
          setLimparOpen(open)
          if (!open) setLimparConfirmacao("")
        }}
      >
        <DialogContent className={cn(dialogOmniClass, "sm:max-w-md")}>
          <div className="max-h-[90vh] overflow-y-auto overscroll-contain px-3 pt-4 pb-3 text-[13px] leading-snug">
            <DialogHeader className="space-y-1 pr-7 pb-2 text-left">
              <DialogTitle className="text-base leading-tight">Limpar todos os títulos desta loja?</DialogTitle>
              <DialogDescription className="text-xs leading-snug">
                Remove do navegador todos os lançamentos de Contas a Receber desta loja. Esta ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="cr-limpar-frase" className="text-xs">
                Digite <span className="font-mono font-semibold">{FRASE_CONFIRMACAO_LIMPAR}</span> para habilitar a exclusão
              </Label>
              <Input
                id="cr-limpar-frase"
                value={limparConfirmacao}
                onChange={(e) => setLimparConfirmacao(e.target.value)}
                placeholder={FRASE_CONFIRMACAO_LIMPAR}
                autoComplete="off"
                className="h-8 font-mono text-sm"
              />
            </div>
            <div className="mt-3 flex flex-row flex-wrap items-center justify-start gap-2 border-t border-border pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLimparOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={limparConfirmacao !== FRASE_CONFIRMACAO_LIMPAR}
                onClick={limparTudoContasReceber}
              >
                Limpar definitivamente
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
