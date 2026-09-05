"use client"

/**
 * PdvRecebimentoModal — Recebimento de Contas a Receber no PDV (F5/F9).
 *
 * Fluxo: buscar cliente → abas **Em aberto / Recebidos** → marcar N títulos (com valor
 * parcial por título quando ativado) → confirmar → gravar em UMA operação.
 *
 * Backend:
 *  - lote: `POST /api/pdv/receber-conta-lote` (atômico, idempotente, revalidado no
 *    servidor — G2);
 *  - singular: `POST /api/pdv/receber-conta`, preservado no botão "Quitar este título".
 *
 * A decisão financeira (seleção, payload, idempotência, leitura de conflito, abas)
 * mora em `lib/contas-receber-lote.ts`; o casamento cliente × título em
 * `lib/contas-receber-cliente-match.ts`. Este arquivo é a casca visual — o harness
 * `node` do Vitest não compila `.tsx`, então a regra precisa ser testável fora dele.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  User,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import type { ContaReceberRow } from "@/lib/contas-receber-types"
import { usePdvCliente, type PdvClienteResult } from "@/hooks/use-pdv-cliente"
import { useCaixa } from "@/components/dashboard/caixa/caixa-provider"
import {
  getActiveFormasPagamento,
  type FormaPagamentoConfig,
} from "@/lib/pdv-formas-pagamento"
import {
  calcSaldoDevedorClienteDeSaldos,
  imprimirReciboLote,
  imprimirReciboPagamento,
  resolveReciboLojaNome,
  type ReciboLoteItem,
} from "@/lib/contas-receber-recibo"
import { tituloPertenceAoCliente } from "@/lib/contas-receber-cliente-match"
import {
  buildItensLote,
  encerrarIdempotencyKey,
  estadoSelecionarTodos,
  interpretarErroLote,
  limparSelecaoAposConflito,
  loteEconomicFingerprint,
  parseValorBR,
  partitionTitulos,
  resolveIdempotencyKey,
  selecionaveis,
  valorReceberDoTitulo,
  novaTravaSubmissao,
  iniciarSubmissao,
  encerrarSubmissao,
  type LoteItemPayload,
  type TravaSubmissao,
} from "@/lib/contas-receber-lote"
import { saldoAbertoDaRow, PAY_EPS } from "@/lib/contas-receber-aberto"
import { crediarioPrintAllowed } from "@/lib/pdv-print-runtime"
import type { PdvImpressaoConfig } from "@/lib/pdv-impressao-config"
import { cn } from "@/lib/utils"

const FORMAS_EXCLUIDAS_RECEBIMENTO = new Set(["multiplo", "a_prazo"])

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

/**
 * Pills de domínio. Cor semântica sobre fundo/borda tingidos — nunca `--warning`/
 * `--destructive` como cor de texto solta (restrição registrada no design critique).
 */
function statusBadgeClass(s: string): string {
  const k = (s || "").toLowerCase()
  if (k === "pago") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (k === "parcial") return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
  if (k === "cancelado") return "border-muted bg-muted/30 text-muted-foreground"
  if (k === "vencido" || k === "atrasado")
    return "border-destructive/40 bg-destructive/10 text-destructive"
  return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
}

/** Chave local que identifica a tentativa SINGULAR em curso (título × operação × valor). */
function opKey(row: ContaReceberRow, op: "liquidar" | "parcial", valor?: number): string {
  return `${String(row.id)}:${op}:${op === "parcial" ? (valor ?? 0).toFixed(2) : "total"}`
}

/** Linha de título já resolvida contra o saldo canônico do servidor. */
type LinhaTitulo = {
  localKey: string
  tituloId?: string
  descricao: string
  vencimento: string
  status: string
  saldoAberto: number
  valorBruto: number
  vencido: boolean
  row: ContaReceberRow
}

/** Resultado confirmado do lote — tudo aqui veio da resposta do servidor. */
type LoteResultado = {
  totalRecebido: number
  formaLabel: string
  itens: Array<{ localKey: string; descricao: string; valorRecebido: number; saldoDepois: number }>
  saldoDevedorAtual: number
  jaRegistrado: boolean
}

export interface PdvRecebimentoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Cliente já selecionado no PDV — pré-seleciona na busca ao abrir. */
  preselectedCustomerName?: string | null
  /** Formas de pagamento da Config V3 (somente ativas entram no seletor). */
  formasPagamento?: FormaPagamentoConfig[]
  impressaoConfig?: PdvImpressaoConfig
  lojaNome?: string
  hotkeyLabel?: string
  onReceived?: () => void
}

export function PdvRecebimentoModal({
  open,
  onOpenChange,
  preselectedCustomerName,
  formasPagamento = [],
  impressaoConfig,
  lojaNome,
  hotkeyLabel = "F5",
  onReceived,
}: PdvRecebimentoModalProps) {
  const { lojaAtivaId, empresaDocumentos } = useLojaAtiva()
  const { toast } = useToast()
  const { caixa, sessaoId, adicionarEntrada } = useCaixa()
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const storeId = lojaAtivaId?.trim() || ""
  const { query, setQuery, results, loading: loadingClientes, clear: clearClienteSearch } = usePdvCliente(storeId)

  const [selectedCliente, setSelectedCliente] = useState<PdvClienteResult | null>(null)
  /** Resposta canônica COMPLETA da loja — as abas são derivadas, nunca filtram a fonte. */
  const [rows, setRows] = useState<ContaReceberRow[]>([])
  const [loadingTitulos, setLoadingTitulos] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [parcialValue, setParcialValue] = useState<Record<string, string>>({})
  const [parcialAtivo, setParcialAtivo] = useState(false)
  const [formaPagto, setFormaPagto] = useState<string>("dinheiro")
  const [tab, setTab] = useState<"abertos" | "recebidos">("abertos")
  const [etapa, setEtapa] = useState<"lista" | "confirmar" | "sucesso">("lista")
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [gravando, setGravando] = useState(false)
  const [resultado, setResultado] = useState<LoteResultado | null>(null)
  /** Saldo REALMENTE em aberto por título (id/localKey → saldoAberto), vindo do audit. */
  const [saldoAbertoMap, setSaldoAbertoMap] = useState<Record<string, number>>({})
  /** `localKey → ContaReceberTitulo.id` (conferência extra no payload do lote). */
  const [tituloIdMap, setTituloIdMap] = useState<Record<string, string>>({})
  /** `localKey → vencido` calculado pelo servidor (data + saldo), não por status textual. */
  const [vencidoMap, setVencidoMap] = useState<Record<string, boolean>>({})

  /**
   * Identidade da OPERAÇÃO de recebimento (não do título), enviada ao servidor.
   * Criada na 1ª tentativa e reusada enquanto ela não confirma: se a chamada commitou e a
   * resposta se perdeu, o retry é reconhecido como repetição em vez de virar uma segunda
   * entrada no caixa. Descartada no desfecho definitivo — dois pagamentos legítimos de
   * mesmo valor recebem chaves distintas.
   */
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map())
  const loteKeysRef = useRef<Map<string, string>>(new Map())
  /** Trava síncrona do duplo submit: `gravando` só vale no próximo render. */
  const travaRef = useRef<TravaSubmissao>(novaTravaSubmissao())

  const formasAtivas = useMemo(
    () =>
      getActiveFormasPagamento(formasPagamento).filter((f) => !FORMAS_EXCLUIDAS_RECEBIMENTO.has(f.id)),
    [formasPagamento],
  )

  const caixaOk = caixa.isOpen && !!sessaoId?.trim()

  /**
   * Nome real da unidade para o cupom. Ordem de confiança: prop do call site (o PDV
   * Classic já passa) → cadastro da unidade ativa (`useLojaAtiva`, fonte que os três
   * PDVs já carregam) → rótulo neutro. Nada aqui inventa razão social/nome fantasia.
   */
  const reciboLojaNome = useMemo(
    () => resolveReciboLojaNome(lojaNome, empresaDocumentos?.nomeFantasia, empresaDocumentos?.razaoSocial),
    [lojaNome, empresaDocumentos?.nomeFantasia, empresaDocumentos?.razaoSocial],
  )

  const fetchTitulos = useCallback(async () => {
    if (!storeId) return
    setLoadingTitulos(true)
    setError(null)
    try {
      const r = await fetch("/api/ops/contas-receber-list", {
        method: "GET",
        headers: { [ASSISTEC_LOJA_HEADER]: storeId },
        cache: "no-store",
      })
      const j = (await r.json().catch(() => null)) as {
        ok?: boolean
        rows?: ContaReceberRow[]
        audit?: Array<{ id?: string; localKey?: string; saldoAberto?: number; vencido?: boolean }>
        error?: string
      } | null
      if (!r.ok || !j) throw new Error(j?.error || `HTTP ${r.status}`)
      const list = Array.isArray(j.rows) ? j.rows : []
      // Saldo aberto real (valor − pagamentos no histórico) calculado pelo servidor.
      const map: Record<string, number> = {}
      const ids: Record<string, string> = {}
      const vencidos: Record<string, boolean> = {}
      for (const a of Array.isArray(j.audit) ? j.audit : []) {
        const sa = typeof a.saldoAberto === "number" && Number.isFinite(a.saldoAberto) ? a.saldoAberto : null
        if (a.localKey && a.id) ids[String(a.localKey)] = String(a.id)
        if (a.localKey && typeof a.vencido === "boolean") vencidos[String(a.localKey)] = a.vencido
        if (sa == null) continue
        if (a.localKey) map[String(a.localKey)] = sa
        if (a.id) map[String(a.id)] = sa
      }
      setSaldoAbertoMap(map)
      setTituloIdMap(ids)
      setVencidoMap(vencidos)
      // A listagem canônica inteira fica em memória: "Recebidos" precisa dos títulos
      // já baixados, que o filtro por status descartava cedo demais.
      setRows(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setRows([])
    } finally {
      setLoadingTitulos(false)
    }
  }, [storeId])

  useEffect(() => {
    if (!open) return
    setParcialValue({})
    setParcialAtivo(false)
    setError(null)
    setAviso(null)
    setSelectedCliente(null)
    setSelecionados([])
    setTab("abertos")
    setEtapa("lista")
    setResultado(null)
    encerrarSubmissao(travaRef.current)
    setGravando(false)
    // Nova sessão do modal: chaves pendentes de tentativas anteriores não valem mais.
    idempotencyKeysRef.current.clear()
    loteKeysRef.current.clear()
    clearClienteSearch()
    const pre = preselectedCustomerName?.trim()
    if (pre) setQuery(pre)
    void fetchTitulos()
  }, [open, preselectedCustomerName, fetchTitulos, clearClienteSearch, setQuery])

  useEffect(() => {
    if (!open) return
    if (!caixaOk) {
      toast({
        variant: "destructive",
        title: "Caixa fechado",
        description: "Abra o caixa antes de receber contas.",
      })
      onOpenChange(false)
      return
    }
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [open, caixaOk, toast, onOpenChange])

  useEffect(() => {
    if (formasAtivas.length === 0) return
    if (!formasAtivas.some((f) => f.id === formaPagto)) {
      setFormaPagto(formasAtivas[0]!.id)
    }
  }, [formasAtivas, formaPagto])

  /**
   * Saldo realmente em aberto do título. Fonte canônica: `row.saldoAberto` do servidor
   * (valor − ledger efetivo); o mapa do `audit` da mesma resposta é o fallback.
   * A coluna `valor` (bruta) não diminui após baixa parcial e nunca serve como saldo.
   */
  const saldoAbertoDe = useCallback(
    (row: ContaReceberRow): number => saldoAbertoDaRow(row, saldoAbertoMap),
    [saldoAbertoMap],
  )

  /**
   * Títulos do cliente selecionado. O casamento é determinístico
   * (`clienteId` → documento → telefone → nome exato): sem substring, "Ana" não
   * arrasta "Mariana". Sem identificação segura o título simplesmente não aparece.
   */
  const doCliente: LinhaTitulo[] = useMemo(() => {
    if (!selectedCliente) return []
    return rows
      .filter((r) => tituloPertenceAoCliente({ clienteId: r.clienteId, cliente: r.cliente }, selectedCliente))
      .map((r) => {
        const localKey = String(r.id)
        return {
          localKey,
          tituloId: tituloIdMap[localKey],
          descricao: r.descricao || "Título",
          vencimento: r.vencimento || "—",
          status: r.status || "",
          saldoAberto: saldoAbertoDe(r),
          valorBruto: Number.isFinite(Number(r.valor)) ? Number(r.valor) : 0,
          vencido: vencidoMap[localKey] === true,
          row: r,
        }
      })
  }, [rows, selectedCliente, saldoAbertoDe, tituloIdMap, vencidoMap])

  const { abertos, recebidos } = useMemo(() => partitionTitulos(doCliente), [doCliente])

  const selecionadosSet = useMemo(() => new Set(selecionados), [selecionados])

  const { itens: itensLote, total: totalSelecionado } = useMemo(
    () => buildItensLote(abertos, selecionados, parcialAtivo ? parcialValue : {}),
    [abertos, selecionados, parcialAtivo, parcialValue],
  )

  /** Total do cabeçalho: soma dos saldos CANÔNICOS, arredondada em centavos. */
  const totalAberto = useMemo(
    () => Math.round(abertos.reduce((s, t) => s + t.saldoAberto, 0) * 100) / 100,
    [abertos],
  )
  const qtdVencidos = useMemo(() => abertos.filter((t) => t.vencido).length, [abertos])

  const selecaoEstado = useMemo(
    () => estadoSelecionarTodos(abertos, selecionados),
    [abertos, selecionados],
  )

  const formaLabel = formasAtivas.find((f) => f.id === formaPagto)?.label ?? formaPagto

  /** Seleção só sobrevive enquanto o título continuar em aberto na lista recarregada. */
  useEffect(() => {
    const validos = new Set(selecionaveis(abertos))
    setSelecionados((prev) => {
      const next = prev.filter((k) => validos.has(k))
      return next.length === prev.length ? prev : next
    })
  }, [abertos])

  const toggleTitulo = useCallback((localKey: string) => {
    setSelecionados((prev) =>
      prev.includes(localKey) ? prev.filter((k) => k !== localKey) : [...prev, localKey],
    )
  }, [])

  const toggleTodos = useCallback(() => {
    const alvo = selecionaveis(abertos)
    setSelecionados((prev) => (prev.length >= alvo.length ? [] : alvo))
  }, [abertos])

  /**
   * Saldo devedor do cliente para o rodapé do recibo SINGULAR.
   * Soma o saldo remanescente DESTE título aos saldos dos demais títulos do MESMO
   * cliente — determinado pelo matcher, não por nome aproximado (que somava homônimos).
   */
  const saldoDevedorClienteApos = useCallback(
    (localKey: string, saldoRemanescenteTitulo: number): number => {
      const outros = doCliente.filter((t) => t.localKey !== localKey).map((t) => t.saldoAberto)
      return calcSaldoDevedorClienteDeSaldos(saldoRemanescenteTitulo, outros)
    },
    [doCliente],
  )

  const podeImprimir = !!impressaoConfig && crediarioPrintAllowed(impressaoConfig)

  const tryPrintRecibo = useCallback(
    (linha: LinhaTitulo, valorPago: number, saldoRemanescenteTitulo: number) => {
      if (!podeImprimir) return
      try {
        imprimirReciboPagamento(
          {
            lojaNome: reciboLojaNome,
            cliente: linha.row.cliente || selectedCliente?.name || "—",
            descricaoTitulo: linha.descricao,
            valorPago,
            dataPagamento: new Date(),
            formaPagamento: formaLabel,
            saldoDevedorAtual: saldoDevedorClienteApos(linha.localKey, saldoRemanescenteTitulo),
          },
          { bobina: impressaoConfig?.bobinaTamanho === "58mm" ? "58mm" : "80mm" },
        )
      } catch (e) {
        console.error("[PdvRecebimentoModal] recibo:", e)
        toast({
          title: "Comprovante não impresso",
          description: "O recebimento foi registrado. Tente reimprimir pelo financeiro.",
        })
      }
    },
    [podeImprimir, impressaoConfig, reciboLojaNome, formaLabel, selectedCliente?.name, toast, saldoDevedorClienteApos],
  )

  const tryPrintReciboLote = useCallback(
    (res: LoteResultado) => {
      if (!podeImprimir) return
      try {
        const itens: ReciboLoteItem[] = res.itens.map((i) => ({
          descricao: i.descricao,
          valorRecebido: i.valorRecebido,
          saldoRestante: i.saldoDepois,
        }))
        imprimirReciboLote(
          {
            lojaNome: reciboLojaNome,
            cliente: selectedCliente?.name || "—",
            dataPagamento: new Date(),
            formaPagamento: res.formaLabel,
            itens,
            totalRecebido: res.totalRecebido,
            saldoDevedorAtual: res.saldoDevedorAtual,
          },
          { bobina: impressaoConfig?.bobinaTamanho === "58mm" ? "58mm" : "80mm" },
        )
      } catch (e) {
        console.error("[PdvRecebimentoModal] recibo lote:", e)
        toast({
          title: "Comprovante não impresso",
          description: "O recebimento foi registrado. Tente reimprimir pelo financeiro.",
        })
      }
    },
    [podeImprimir, impressaoConfig, reciboLojaNome, selectedCliente?.name, toast],
  )

  // ─── recebimento singular (preservado) ─────────────────────────────────────

  const idempotencyKeyFor = useCallback((row: ContaReceberRow, op: "liquidar" | "parcial", valor?: number) => {
    const k = opKey(row, op, valor)
    const cached = idempotencyKeysRef.current.get(k)
    if (cached) return cached
    const fresh =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    idempotencyKeysRef.current.set(k, fresh)
    return fresh
  }, [])

  const dropIdempotencyKey = useCallback((row: ContaReceberRow, op: "liquidar" | "parcial", valor?: number) => {
    idempotencyKeysRef.current.delete(opKey(row, op, valor))
  }, [])

  const postRecebimento = useCallback(
    async (row: ContaReceberRow, op: "liquidar" | "parcial", valor?: number) => {
      if (!storeId || !sessaoId) return { ok: false as const, error: "caixa_fechado" }
      const idempotencyKey = idempotencyKeyFor(row, op, valor)
      const r = await fetch("/api/pdv/receber-conta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeId,
        },
        body: JSON.stringify({
          op,
          localKey: String(row.id),
          valor: op === "parcial" ? valor : undefined,
          formaPagamento: formaPagto,
          sessaoId,
          idempotencyKey,
        }),
      })
      const j = (await r.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        code?: string
        valorRecebido?: number
        titulo?: { status?: string; valor?: number }
      } | null
      if (!r.ok || !j?.ok) {
        const code = j?.code || j?.error
        if (code === "ja_pago" || code === "nada_em_aberto" || code === "ja_quitado") {
          return { ok: false as const, error: "Este título já está quitado." }
        }
        if (code === "valor_maior_que_aberto") {
          return {
            ok: false as const,
            error: "O valor é maior que o saldo em aberto do título. Atualizei o saldo — confira e tente novamente.",
          }
        }
        return { ok: false as const, error: j?.error || `HTTP ${r.status}` }
      }
      dropIdempotencyKey(row, op, valor)
      return { ok: true as const, valorRecebido: j.valorRecebido ?? valor ?? Number(row.valor) }
    },
    [storeId, sessaoId, formaPagto, idempotencyKeyFor, dropIdempotencyKey],
  )

  /** "Quitar este título" — recebimento individual, inalterado no contrato. */
  const callLiquidar = useCallback(
    async (linha: LinhaTitulo) => {
      if (!storeId || travaRef.current.ativo) return
      setBusyId(linha.localKey)
      try {
        const res = await postRecebimento(linha.row, "liquidar")
        if (!res.ok) throw new Error(res.error)
        if (formaPagto === "dinheiro" && res.valorRecebido > 0) {
          adicionarEntrada(res.valorRecebido)
        }
        toast({
          title: "Recebimento confirmado",
          description: `${linha.row.cliente || "—"} — ${brl(res.valorRecebido)} (${formaLabel}).`,
        })
        // Quitação total: nada remanesce DESTE título → saldo do recibo = demais títulos.
        tryPrintRecibo(linha, res.valorRecebido, 0)
        await fetchTitulos()
        onReceived?.()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast({ variant: "destructive", title: "Falha ao receber", description: msg })
      } finally {
        setBusyId(null)
      }
    },
    [
      storeId,
      postRecebimento,
      formaPagto,
      formaLabel,
      adicionarEntrada,
      toast,
      fetchTitulos,
      tryPrintRecibo,
      onReceived,
    ],
  )

  // ─── recebimento em lote (G3) ──────────────────────────────────────────────

  const gravarLote = useCallback(async () => {
    if (!storeId || !sessaoId) {
      toast({ variant: "destructive", title: "Caixa fechado", description: "Abra o caixa antes de receber." })
      return
    }
    if (itensLote.length === 0) return

    // Trava SÍNCRONA do duplo envio: `gravando` só chega ao DOM no próximo render,
    // então Enter + clique no mesmo tick chegariam aqui duas vezes. Tomada antes de
    // qualquer escrita e liberada no `finally`.
    if (!iniciarSubmissao(travaRef.current)) return

    const fingerprint = loteEconomicFingerprint({ sessaoId, formaPagamento: formaPagto, itens: itensLote })
    const idempotencyKey = resolveIdempotencyKey(loteKeysRef.current, fingerprint)
    /** Snapshot da tentativa: a resposta é lida contra o que foi ENVIADO. */
    const enviados: LoteItemPayload[] = itensLote
    const descricaoPorKey = new Map(abertos.map((t) => [t.localKey, t.descricao]))

    setGravando(true)
    setAviso(null)
    try {
      const r = await fetch("/api/pdv/receber-conta-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: storeId },
        body: JSON.stringify({
          sessaoId,
          formaPagamento: formaPagto,
          idempotencyKey,
          itens: enviados,
        }),
      })
      const j = (await r.json().catch(() => null)) as
        | {
            ok?: boolean
            jaRegistrado?: boolean
            totalRecebido?: number
            itens?: Array<{ localKey?: string; valorRecebido?: number; saldoDepois?: number }>
            error?: string
            code?: string
            detalhes?: Array<{ localKey?: string; motivo?: string; saldoReal?: number; saldoEsperado?: number }>
          }
        | null

      if (!r.ok || !j?.ok) {
        const conflito = interpretarErroLote(r.status, j)
        // Desfecho definitivo: a próxima tentativa nasce com chave nova. Só falha de
        // rede (abaixo, no catch) preserva a chave para o retry incerto.
        if (conflito.definitivo) encerrarIdempotencyKey(loteKeysRef.current, fingerprint)
        setSelecionados((prev) => limparSelecaoAposConflito(prev, conflito))
        setEtapa("lista")
        setAviso(conflito.mensagem)
        if (conflito.recarregar) await fetchTitulos()
        if (conflito.caixaFechado) onOpenChange(false)
        toast({ variant: "destructive", title: "Recebimento não gravado", description: conflito.mensagem })
        return
      }

      // Autoridade do valor é o servidor: `totalRecebido` recalculado dentro da transação.
      const totalRecebido = Number(j.totalRecebido) || 0
      const itensResp = Array.isArray(j.itens) ? j.itens : []
      const porKey = new Map(itensResp.map((i) => [String(i.localKey ?? ""), i]))
      const itensRecibo = enviados.map((e) => {
        const resp = porKey.get(e.localKey)
        return {
          localKey: e.localKey,
          descricao: descricaoPorKey.get(e.localKey) ?? "Título",
          valorRecebido: Number(resp?.valorRecebido ?? e.valorReceber) || 0,
          saldoDepois: Number(resp?.saldoDepois ?? 0) || 0,
        }
      })
      // Saldo devedor do recibo: o que sobrou nos títulos do lote (número do servidor)
      // + os títulos abertos do cliente que ficaram de fora.
      const noLote = new Set(enviados.map((e) => e.localKey))
      const saldoDevedorAtual = calcSaldoDevedorClienteDeSaldos(
        itensRecibo.reduce((s, i) => s + i.saldoDepois, 0),
        abertos.filter((t) => !noLote.has(t.localKey)).map((t) => t.saldoAberto),
      )

      const res: LoteResultado = {
        totalRecebido,
        formaLabel,
        itens: itensRecibo,
        saldoDevedorAtual,
        jaRegistrado: j.jaRegistrado === true,
      }

      encerrarIdempotencyKey(loteKeysRef.current, fingerprint)

      // Reflexo LOCAL no CaixaProvider, exatamente uma vez por operação confirmada.
      // Vale também no replay (`jaRegistrado`): a única forma de chegar aqui com essa
      // chave é o retry de uma tentativa cuja resposta se perdeu — o servidor gravou,
      // mas este cliente caiu no `catch` e nunca somou a entrada. Somar agora converge
      // o estado local sem gerar nenhuma segunda operação no servidor (que se recusou
      // a regravar). Duas execuções concorrentes são impossíveis: a trava é síncrona.
      if (formaPagto === "dinheiro" && totalRecebido > 0) {
        adicionarEntrada(totalRecebido)
      }

      setResultado(res)
      setSelecionados([])
      setParcialValue({})
      setParcialAtivo(false)
      setEtapa("sucesso")
      tryPrintReciboLote(res)
      await fetchTitulos()
      onReceived?.()
    } catch (e) {
      // Rede/timeout: NÃO é desfecho. A chave sobrevive para que o retry desta mesma
      // seleção seja reconhecido como replay em vez de virar um segundo recebimento.
      const msg = e instanceof Error ? e.message : String(e)
      setEtapa("lista")
      setAviso("Não deu para confirmar o recebimento. Tente de novo — a operação não será duplicada.")
      toast({ variant: "destructive", title: "Falha ao receber", description: msg })
    } finally {
      encerrarSubmissao(travaRef.current)
      setGravando(false)
    }
  }, [
    storeId,
    sessaoId,
    formaPagto,
    formaLabel,
    itensLote,
    abertos,
    adicionarEntrada,
    fetchTitulos,
    onOpenChange,
    onReceived,
    toast,
    tryPrintReciboLote,
  ])

  const selectCliente = (c: PdvClienteResult) => {
    setSelectedCliente(c)
    setSelecionados([])
    setAviso(null)
    setQuery(c.name)
  }

  const voltarCliente = () => {
    setSelectedCliente(null)
    setSelecionados([])
    setAviso(null)
    setEtapa("lista")
    setResultado(null)
    clearClienteSearch()
    queueMicrotask(() => searchInputRef.current?.focus())
  }

  /** Fechar é bloqueado enquanto o lote está no ar — a resposta ainda vai chegar. */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && travaRef.current.ativo) return
      onOpenChange(next)
    },
    [onOpenChange],
  )

  const bloqueado = gravando || formasAtivas.length === 0
  const ctaLabel =
    itensLote.length === 0
      ? "Selecione os títulos"
      : itensLote.length === 1
        ? `Receber 1 título — ${brl(totalSelecionado)}`
        : `Receber ${itensLote.length} títulos — ${brl(totalSelecionado)}`

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-5xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-card border-border"
        onEscapeKeyDown={(e) => {
          if (travaRef.current.ativo) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (travaRef.current.ativo) e.preventDefault()
        }}
      >
        <DialogHeader className="p-4 sm:p-6 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2 min-w-0">
            <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-primary shrink-0" />
            <span className="truncate">Receber conta</span>
            <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground shrink-0">
              {hotkeyLabel}
            </kbd>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground/80 line-clamp-2 sm:line-clamp-none">
            Busque o cliente, marque os títulos e receba tudo numa operação só. A baixa no financeiro e o
            lançamento no caixa acontecem juntos: ou tudo grava, ou nada grava.
          </DialogDescription>
        </DialogHeader>

        {!selectedCliente ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-w-0">
            <div className="space-y-1">
              <Label htmlFor="pdv-receber-busca" className="text-xs text-muted-foreground">
                Cliente (nome, telefone ou CPF)
              </Label>
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="pdv-receber-busca"
                  ref={searchInputRef}
                  className="pl-9 h-10 bg-secondary border-border"
                  placeholder="Digite para buscar…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            {loadingClientes && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando clientes…
              </p>
            )}
            {!loadingClientes && query.trim().length >= 1 && results.length === 0 && (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
                Nenhum cliente encontrado.
              </p>
            )}
            <ul className="space-y-1">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-muted/50 cursor-pointer min-w-0"
                    onClick={() => selectCliente(c)}
                  >
                    <User className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.document, c.phone].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : etapa === "sucesso" && resultado ? (
          <SucessoLote
            resultado={resultado}
            cliente={selectedCliente.name}
            podeImprimir={podeImprimir}
            onImprimir={() => tryPrintReciboLote(resultado)}
            onConcluir={() => {
              setResultado(null)
              setEtapa("lista")
            }}
            onFechar={() => onOpenChange(false)}
            hotkeyLabel={hotkeyLabel}
          />
        ) : etapa === "confirmar" ? (
          <ConfirmarLote
            cliente={selectedCliente}
            formaLabel={formaLabel}
            itens={itensLote}
            descricaoPorKey={new Map(abertos.map((t) => [t.localKey, t.descricao]))}
            total={totalSelecionado}
            saldoRestanteCliente={Math.max(0, Math.round((totalAberto - totalSelecionado) * 100) / 100)}
            gravando={gravando}
            onVoltar={() => setEtapa("lista")}
            onGravar={() => void gravarLote()}
          />
        ) : (
          <>
            <div className="px-4 sm:px-6 pt-3 shrink-0 space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-xs font-medium truncate max-w-full">
                  {selectedCliente.name}
                </Badge>
                {selectedCliente.document && (
                  <span className="text-xs text-muted-foreground truncate">{selectedCliente.document}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={voltarCliente}
                  disabled={gravando}
                >
                  Trocar cliente
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 min-w-0" role="tablist" aria-label="Títulos do cliente">
                <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1">
                  <TabButton
                    active={tab === "abertos"}
                    onClick={() => setTab("abertos")}
                    label="Em aberto"
                    count={abertos.length}
                    controls="pdv-receber-painel"
                  />
                  <TabButton
                    active={tab === "recebidos"}
                    onClick={() => setTab("recebidos")}
                    label="Recebidos"
                    count={recebidos.length}
                    controls="pdv-receber-painel"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8"
                  onClick={() => void fetchTitulos()}
                  disabled={loadingTitulos || gravando}
                >
                  {loadingTitulos ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="sr-only sm:not-sr-only">Recarregar</span>
                    </>
                  )}
                </Button>
              </div>

              {tab === "abertos" && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs min-w-0">
                  <span className="text-muted-foreground">
                    Saldo em aberto{" "}
                    <strong className="ml-1 text-sm font-bold tabular-nums text-foreground">{brl(totalAberto)}</strong>
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    Vencidos
                    {qtdVencidos > 0 && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />}
                    <strong className="text-sm font-bold tabular-nums text-foreground">{qtdVencidos}</strong>
                  </span>
                  <span className="text-muted-foreground">
                    Títulos{" "}
                    <strong className="ml-1 text-sm font-bold tabular-nums text-foreground">{abertos.length}</strong>
                  </span>
                </div>
              )}

              {aviso && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <span className="min-w-0">{aviso}</span>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  Não foi possível carregar os títulos: {error}
                </div>
              )}
            </div>

            <div id="pdv-receber-painel" className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 min-w-0">
              {loadingTitulos && rows.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando títulos…
                </p>
              ) : tab === "abertos" ? (
                abertos.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                    {error
                      ? "Recebimento bloqueado até a lista carregar."
                      : `${selectedCliente.name} não tem saldo devedor nesta loja. Títulos já quitados ficam na aba Recebidos.`}
                  </div>
                ) : (
                  <>
                    <div className="hidden md:flex items-center gap-3 px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span className="w-5 shrink-0" />
                      <span className="min-w-0 flex-1">Título</span>
                      <span className="w-[92px] shrink-0">Vencimento</span>
                      <span className="w-[120px] shrink-0 text-right">Saldo em aberto</span>
                      <span className="w-[150px] shrink-0" />
                    </div>
                    <ul className="space-y-1">
                      {abertos.map((t) => (
                        <LinhaAberta
                          key={t.localKey}
                          linha={t}
                          checked={selecionadosSet.has(t.localKey)}
                          onToggle={() => toggleTitulo(t.localKey)}
                          parcialAtivo={parcialAtivo}
                          parcialValue={parcialValue[t.localKey] ?? ""}
                          onParcialChange={(v) => setParcialValue((p) => ({ ...p, [t.localKey]: v }))}
                          onQuitar={() => void callLiquidar(t)}
                          busy={busyId === t.localKey}
                          disabled={bloqueado || busyId !== null}
                        />
                      ))}
                    </ul>
                  </>
                )
              ) : recebidos.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum título recebido deste cliente nesta loja.
                </div>
              ) : (
                <ul className="space-y-1">
                  {recebidos.map((t) => (
                    <li
                      key={t.localKey}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 min-w-0"
                    >
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-bold uppercase shrink-0", statusBadgeClass("pago"))}
                      >
                        Baixado
                      </Badge>
                      <div className="min-w-0 flex-1 basis-[min(100%,12rem)]">
                        <p className="truncate text-sm font-semibold text-foreground">{t.descricao}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          Vencimento {t.vencimento} · <span className="font-mono">{t.localKey}</span>
                        </p>
                      </div>
                      <div className="ml-auto text-right shrink-0">
                        <p className="text-sm font-bold tabular-nums text-foreground">{brl(t.valorBruto)}</p>
                        <p className="text-[10px] text-muted-foreground">valor do título</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t border-border bg-card p-3 sm:p-4">
              {tab === "abertos" ? (
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between min-w-0">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xl font-extrabold tabular-nums text-foreground">{brl(totalSelecionado)}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-xs text-muted-foreground">
                        {itensLote.length} de {abertos.length} selecionados
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={toggleTodos}
                        disabled={bloqueado || abertos.length === 0}
                      >
                        {selecaoEstado === "todos" ? "Limpar seleção" : "Selecionar todos"}
                      </Button>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={parcialAtivo}
                          onCheckedChange={(v) => setParcialAtivo(v === true)}
                          disabled={bloqueado}
                          aria-label="Informar valor parcial por título"
                        />
                        Valor parcial por título
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-row items-end gap-2 min-w-0">
                    <div className="space-y-1 min-w-0 w-[128px] shrink-0 sm:w-[190px]">
                      <Label htmlFor="pdv-receber-forma" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Forma de pagamento
                      </Label>
                      {formasAtivas.length === 0 ? (
                        <p className="text-xs text-destructive">Nenhuma forma ativa na Config V3.</p>
                      ) : (
                        <Select value={formaPagto} onValueChange={setFormaPagto} disabled={gravando}>
                          <SelectTrigger id="pdv-receber-forma" className="h-10 bg-secondary border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {formasAtivas.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="lg"
                      className="h-10 min-w-0 flex-1 px-3 font-bold whitespace-normal sm:flex-none sm:whitespace-nowrap"
                      disabled={bloqueado || itensLote.length === 0}
                      onClick={() => setEtapa("confirmar")}
                    >
                      {ctaLabel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground min-w-0">
                    Títulos já baixados — não voltam para a lista de cobrança.
                  </span>
                  <Button type="button" variant="outline" onClick={() => setTab("abertos")}>
                    Voltar para Em aberto
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
  controls,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  controls: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:gap-2 sm:px-3",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  )
}

function LinhaAberta({
  linha,
  checked,
  onToggle,
  parcialAtivo,
  parcialValue,
  onParcialChange,
  onQuitar,
  busy,
  disabled,
}: {
  linha: LinhaTitulo
  checked: boolean
  onToggle: () => void
  parcialAtivo: boolean
  parcialValue: string
  onParcialChange: (v: string) => void
  onQuitar: () => void
  busy: boolean
  disabled: boolean
}) {
  const parcial = parseValorBR(parcialValue)
  const excedeSaldo = parcial != null && parcial > linha.saldoAberto + PAY_EPS
  const aplicado = valorReceberDoTitulo(linha, parcialAtivo ? parcialValue : undefined)
  const restante = Math.max(0, Math.round((linha.saldoAberto - aplicado) * 100) / 100)

  return (
    <li
      className={cn(
        "rounded-lg border bg-background px-3 py-2 transition-colors min-w-0",
        checked ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          disabled={disabled}
          className="h-5 w-5 shrink-0"
          aria-label={`Selecionar ${linha.descricao}`}
        />
        <div className="min-w-0 flex-1 basis-[min(100%,12rem)]">
          <p className="truncate text-sm font-semibold text-foreground">{linha.descricao}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {linha.vencido && (
              <Badge
                variant="outline"
                className={cn("px-1 py-0 text-[10px] font-bold uppercase", statusBadgeClass("vencido"))}
              >
                Vencido
              </Badge>
            )}
            {(linha.status || "").toLowerCase() === "parcial" && (
              <Badge
                variant="outline"
                className={cn("px-1 py-0 text-[10px] font-bold uppercase", statusBadgeClass("parcial"))}
              >
                Parcial
              </Badge>
            )}
            <span className="truncate font-mono">{linha.localKey}</span>
          </p>
        </div>
        <div className="w-[92px] shrink-0 flex items-center gap-1.5">
          {linha.vencido && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />}
          <span className={cn("text-xs tabular-nums", linha.vencido ? "font-bold text-foreground" : "text-muted-foreground")}>
            {linha.vencimento}
          </span>
        </div>
        <div className="ml-auto w-[120px] shrink-0 text-right">
          <p className="text-base font-extrabold tabular-nums text-foreground">{brl(linha.saldoAberto)}</p>
          {linha.valorBruto > linha.saldoAberto + PAY_EPS && (
            <p className="text-[10px] text-muted-foreground">de {brl(linha.valorBruto)}</p>
          )}
        </div>
        <div className="w-full sm:w-[150px] shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full whitespace-nowrap"
            disabled={disabled || busy || linha.saldoAberto <= PAY_EPS}
            onClick={onQuitar}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Quitar este título
              </>
            )}
          </Button>
        </div>
      </div>

      {parcialAtivo && checked && (
        <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-border/60 pt-2 min-w-0">
          <div className="space-y-1 min-w-0 w-[150px]">
            <Label htmlFor={`parcial-${linha.localKey}`} className="text-[10px] text-muted-foreground">
              Abater agora
            </Label>
            <Input
              id={`parcial-${linha.localKey}`}
              type="text"
              inputMode="decimal"
              placeholder={linha.saldoAberto.toFixed(2).replace(".", ",")}
              value={parcialValue}
              onChange={(e) => onParcialChange(e.target.value)}
              disabled={disabled}
              className={cn("h-9 bg-secondary border-border", excedeSaldo && "border-destructive")}
              aria-describedby={excedeSaldo ? `parcial-hint-${linha.localKey}` : undefined}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Fica devendo <strong className="tabular-nums text-foreground">{brl(restante)}</strong>
          </p>
          {excedeSaldo && (
            <p id={`parcial-hint-${linha.localKey}`} className="text-xs text-foreground">
              Acima do saldo — será limitado a {brl(linha.saldoAberto)}.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function ConfirmarLote({
  cliente,
  formaLabel,
  itens,
  descricaoPorKey,
  total,
  saldoRestanteCliente,
  gravando,
  onVoltar,
  onGravar,
}: {
  cliente: PdvClienteResult
  formaLabel: string
  itens: LoteItemPayload[]
  descricaoPorKey: Map<string, string>
  total: number
  saldoRestanteCliente: number
  gravando: boolean
  onVoltar: () => void
  onGravar: () => void
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-w-0">
        <div>
          <h3 className="text-base font-bold text-foreground">Confirmar recebimento</h3>
          <p className="text-sm text-muted-foreground max-w-[70ch]">
            Revise antes de gravar. A baixa dos títulos, a movimentação financeira e o lançamento no caixa
            acontecem juntos: ou tudo grava, ou nada grava.
          </p>
        </div>

        <dl className="rounded-lg border border-border divide-y divide-border">
          <div className="flex flex-wrap gap-2 px-3 py-2 min-w-0">
            <dt className="w-40 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">Cliente</dt>
            <dd className="min-w-0 flex-1 text-sm text-foreground">
              {cliente.name}
              {cliente.document ? <span className="block text-xs text-muted-foreground">{cliente.document}</span> : null}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2 px-3 py-2 min-w-0">
            <dt className="w-40 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">Forma de pagamento</dt>
            <dd className="min-w-0 flex-1 text-sm text-foreground">{formaLabel}</dd>
          </div>
          <div className="flex flex-wrap gap-2 px-3 py-2 min-w-0">
            <dt className="w-40 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
              {itens.length === 1 ? "1 título" : `${itens.length} títulos`}
            </dt>
            <dd className="min-w-0 flex-1 space-y-1">
              {itens.map((i) => (
                <div key={i.localKey} className="flex items-center justify-between gap-3 text-sm min-w-0">
                  <span className="truncate text-foreground">{descricaoPorKey.get(i.localKey) ?? i.localKey}</span>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">{brl(i.valorReceber)}</span>
                </div>
              ))}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-3 min-w-0">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Total a receber</dt>
            <dd className="text-xl font-extrabold tabular-nums text-foreground">{brl(total)}</dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Depois da gravação o cliente fica devendo{" "}
          <strong className="tabular-nums text-foreground">{brl(saldoRestanteCliente)}</strong> nesta loja.
        </p>
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
        <span className="text-xs text-muted-foreground min-w-0" aria-live="polite">
          {gravando ? "Gravando o recebimento — não feche esta janela." : ""}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <Button type="button" variant="outline" onClick={onVoltar} disabled={gravando}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <Button type="button" className="font-bold" onClick={onGravar} disabled={gravando}>
            {gravando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gravando…
              </>
            ) : (
              `Gravar ${brl(total)}`
            )}
          </Button>
        </div>
      </div>
    </>
  )
}

function SucessoLote({
  resultado,
  cliente,
  podeImprimir,
  onImprimir,
  onConcluir,
  onFechar,
  hotkeyLabel,
}: {
  resultado: LoteResultado
  cliente: string
  podeImprimir: boolean
  onImprimir: () => void
  onConcluir: () => void
  onFechar: () => void
  hotkeyLabel: string
}) {
  const qtd = resultado.itens.length
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-w-0">
        <div className="flex flex-col items-center text-center gap-2">
          <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden />
          <h3 className="text-base font-bold text-foreground">
            {resultado.jaRegistrado ? "Recebimento já estava registrado" : "Recebimento confirmado"}
          </h3>
          <p className="text-3xl font-extrabold tabular-nums text-foreground">{brl(resultado.totalRecebido)}</p>
          <p className="text-sm text-muted-foreground">
            {qtd === 1 ? "1 título" : `${qtd} títulos`} de {cliente} · {resultado.formaLabel}
          </p>
        </div>

        <ul className="mx-auto mt-4 max-w-md space-y-1">
          {resultado.itens.map((i) => (
            <li
              key={i.localKey}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm min-w-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-foreground">{i.descricao}</span>
                <span className="text-[11px] text-muted-foreground">
                  {i.saldoDepois > PAY_EPS ? `abatido — resta ${brl(i.saldoDepois)}` : "quitado"}
                </span>
              </span>
              <span className="shrink-0 tabular-nums font-bold text-foreground">{brl(i.valorRecebido)}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Saldo devedor do cliente nesta loja:{" "}
          <strong className="tabular-nums text-foreground">{brl(resultado.saldoDevedorAtual)}</strong>
        </p>
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 min-w-0">
        <span className="text-xs text-muted-foreground min-w-0">
          Recibo consolidado — um documento para os {qtd === 1 ? "1 título" : `${qtd} títulos`}.
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {podeImprimir && (
            <Button type="button" variant="outline" onClick={onImprimir}>
              <Printer className="mr-1 h-4 w-4" /> Imprimir recibo
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onConcluir}>
            Ver títulos
          </Button>
          <Button type="button" className="font-bold" onClick={onFechar}>
            Concluir <kbd className="ml-1.5 text-[10px] font-bold">{hotkeyLabel}</kbd>
          </Button>
        </div>
      </div>
    </>
  )
}
