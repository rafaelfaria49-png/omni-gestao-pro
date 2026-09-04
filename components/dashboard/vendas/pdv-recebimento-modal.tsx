"use client"

/**
 * PdvRecebimentoModal — Recebimento rápido de Contas a Receber no PDV (F5).
 *
 * Fluxo: buscar cliente (nome/telefone/CPF) → listar títulos abertos → quitar total ou parcial.
 * Backend: POST /api/pdv/receber-conta (baixa + movimentação + sessão de caixa).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Loader2, Search, User, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  imprimirReciboPagamento,
  RECIBO_LOJA_NOME_PADRAO,
} from "@/lib/contas-receber-recibo"
import { isTituloEmAberto, saldoAbertoDaRow, somaSaldoEmAberto, PAY_EPS } from "@/lib/contas-receber-aberto"
import { crediarioPrintAllowed } from "@/lib/pdv-print-runtime"
import type { PdvImpressaoConfig } from "@/lib/pdv-impressao-config"
import { cn } from "@/lib/utils"

const STATUS_RECEBIVEL = new Set(["pendente", "parcial", "atrasado", "vencido"])

const FORMAS_EXCLUIDAS_RECEBIMENTO = new Set(["multiplo", "a_prazo"])

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

function statusLabel(s: string): string {
  const k = (s || "").toLowerCase()
  if (k === "pago") return "Pago"
  if (k === "parcial") return "Parcial"
  if (k === "cancelado") return "Cancelado"
  if (k === "vencido" || k === "atrasado") return "Vencido"
  return "Pendente"
}

function statusBadgeClass(s: string): string {
  const k = (s || "").toLowerCase()
  if (k === "pago") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (k === "parcial") return "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
  if (k === "cancelado") return "border-muted bg-muted/30 text-muted-foreground"
  if (k === "vencido" || k === "atrasado")
    return "border-destructive/40 bg-destructive/10 text-destructive"
  return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
}

function normClienteKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Chave local que identifica a tentativa em curso (título × operação × valor). */
function opKey(row: ContaReceberRow, op: "liquidar" | "parcial", valor?: number): string {
  return `${String(row.id)}:${op}:${op === "parcial" ? (valor ?? 0).toFixed(2) : "total"}`
}

function clienteMatchesTitulo(cliente: PdvClienteResult, tituloCliente: string): boolean {
  const keyTitulo = normClienteKey(tituloCliente || "")
  if (!keyTitulo) return false
  const names = [cliente.name, cliente.document, cliente.phone].filter(Boolean) as string[]
  return names.some((n) => {
    const k = normClienteKey(n)
    return k && (keyTitulo.includes(k) || k.includes(keyTitulo))
  })
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
  const { lojaAtivaId } = useLojaAtiva()
  const { toast } = useToast()
  const { caixa, sessaoId, adicionarEntrada } = useCaixa()
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const storeId = lojaAtivaId?.trim() || ""
  const { query, setQuery, results, loading: loadingClientes, clear: clearClienteSearch } = usePdvCliente(storeId)

  const [selectedCliente, setSelectedCliente] = useState<PdvClienteResult | null>(null)
  const [rows, setRows] = useState<ContaReceberRow[]>([])
  const [loadingTitulos, setLoadingTitulos] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parcialValue, setParcialValue] = useState<Record<string, string>>({})
  const [formaPagto, setFormaPagto] = useState<string>("dinheiro")
  /** Saldo REALMENTE em aberto por título (id/localKey → saldoAberto), vindo do audit do servidor. */
  const [saldoAbertoMap, setSaldoAbertoMap] = useState<Record<string, number>>({})
  /**
   * Identidade da OPERAÇÃO de recebimento (não do título), enviada ao servidor.
   * Criada na 1ª tentativa e reusada enquanto ela não confirma: se a chamada commitou e a
   * resposta se perdeu, o retry é reconhecido como repetição em vez de virar uma segunda
   * entrada no caixa. Descartada no sucesso — dois pagamentos legítimos de mesmo valor
   * recebem chaves distintas.
   */
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map())

  const formasAtivas = useMemo(
    () =>
      getActiveFormasPagamento(formasPagamento).filter((f) => !FORMAS_EXCLUIDAS_RECEBIMENTO.has(f.id)),
    [formasPagamento],
  )

  const caixaOk = caixa.isOpen && !!sessaoId?.trim()

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
        audit?: Array<{ id?: string; localKey?: string; saldoAberto?: number }>
        error?: string
      } | null
      if (!r.ok || !j) throw new Error(j?.error || `HTTP ${r.status}`)
      const list = Array.isArray(j.rows) ? j.rows : []
      // Saldo aberto real (valor − pagamentos no histórico) calculado pelo servidor.
      const map: Record<string, number> = {}
      for (const a of Array.isArray(j.audit) ? j.audit : []) {
        const sa = typeof a.saldoAberto === "number" && Number.isFinite(a.saldoAberto) ? a.saldoAberto : null
        if (sa == null) continue
        if (a.localKey) map[String(a.localKey)] = sa
        if (a.id) map[String(a.id)] = sa
      }
      setSaldoAbertoMap(map)
      setRows(list.filter((row) => STATUS_RECEBIVEL.has((row.status || "").toLowerCase())))
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
    setError(null)
    setSelectedCliente(null)
    // Nova sessão do modal: chaves pendentes de tentativas anteriores não valem mais.
    idempotencyKeysRef.current.clear()
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
   * Lista operacional de cobrança: cliente casado E saldo canônico acima do epsilon.
   * Título zerado sai daqui — "PENDENTE com R$ 0" não é dívida em aberto.
   */
  const filtered = useMemo(() => {
    if (!selectedCliente) return []
    return rows.filter(
      (r) => clienteMatchesTitulo(selectedCliente, r.cliente || "") && isTituloEmAberto(r, saldoAbertoMap),
    )
  }, [rows, selectedCliente, saldoAbertoMap])

  /**
   * Saldo devedor do cliente após este recebimento, para o rodapé do recibo.
   * Fonte autoritativa: o saldo em aberto do servidor (`saldoAbertoDe`) — NUNCA o `valor` bruto
   * da coluna nem inferência por status. Soma o saldo remanescente DESTE título (já calculado como
   * saldo em aberto − valor pago) aos saldos dos demais títulos abertos do mesmo cliente.
   */
  const saldoDevedorClienteApos = useCallback(
    (row: ContaReceberRow, saldoRemanescenteTitulo: number): number => {
      const key = normClienteKey(row.cliente || "")
      const outros = key
        ? rows
            .filter((r) => String(r.id) !== String(row.id) && normClienteKey(r.cliente || "") === key)
            .map((r) => saldoAbertoDe(r))
        : []
      return calcSaldoDevedorClienteDeSaldos(saldoRemanescenteTitulo, outros)
    },
    [rows, saldoAbertoDe],
  )

  const formaLabel = formasAtivas.find((f) => f.id === formaPagto)?.label ?? formaPagto

  const tryPrintRecibo = useCallback(
    (row: ContaReceberRow, valorPago: number, saldoRemanescenteTitulo: number) => {
      if (!impressaoConfig || !crediarioPrintAllowed(impressaoConfig)) return
      try {
        imprimirReciboPagamento(
          {
            lojaNome: lojaNome?.trim() || RECIBO_LOJA_NOME_PADRAO,
            cliente: row.cliente || selectedCliente?.name || "—",
            descricaoTitulo: row.descricao || "Título",
            valorPago,
            dataPagamento: new Date(),
            formaPagamento: formaLabel,
            saldoDevedorAtual: saldoDevedorClienteApos(row, saldoRemanescenteTitulo),
          },
          { bobina: impressaoConfig.bobinaTamanho === "58mm" ? "58mm" : "80mm" },
        )
      } catch (e) {
        console.error("[PdvRecebimentoModal] recibo:", e)
        toast({
          title: "Comprovante não impresso",
          description: "O recebimento foi registrado. Tente reimprimir pelo financeiro.",
        })
      }
    },
    [impressaoConfig, lojaNome, formaLabel, selectedCliente?.name, toast, saldoDevedorClienteApos],
  )

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

  const callLiquidar = useCallback(
    async (row: ContaReceberRow) => {
      if (!storeId) return
      setBusyId(String(row.id))
      try {
        const res = await postRecebimento(row, "liquidar")
        if (!res.ok) throw new Error(res.error)
        if (formaPagto === "dinheiro" && res.valorRecebido > 0) {
          adicionarEntrada(res.valorRecebido)
        }
        toast({
          title: "Recebimento confirmado",
          description: `${row.cliente || "—"} — ${brl(res.valorRecebido)} (${formaLabel}).`,
        })
        await fetchTitulos()
        // Quitação total: nada remanesce DESTE título → saldo do recibo = demais títulos do cliente.
        tryPrintRecibo(row, res.valorRecebido, 0)
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
      rows,
      tryPrintRecibo,
      onReceived,
    ],
  )

  const callParcial = useCallback(
    async (row: ContaReceberRow) => {
      if (!storeId) return
      const raw = parcialValue[String(row.id)] ?? ""
      const valor = Number(raw.replace(/\./g, "").replace(",", "."))
      if (!Number.isFinite(valor) || valor <= 0) {
        toast({ variant: "destructive", title: "Valor inválido", description: "Informe um valor parcial maior que zero." })
        return
      }
      const saldoAberto = saldoAbertoDe(row)
      if (valor > saldoAberto + PAY_EPS) {
        toast({
          variant: "destructive",
          title: "Valor excede o saldo",
          description: `Saldo em aberto do título: ${brl(saldoAberto)}.`,
        })
        return
      }
      setBusyId(String(row.id))
      try {
        const res = await postRecebimento(row, "parcial", valor)
        if (!res.ok) throw new Error(res.error)
        if (formaPagto === "dinheiro" && res.valorRecebido > 0) {
          adicionarEntrada(res.valorRecebido)
        }
        toast({
          title: "Pagamento parcial registrado",
          description: `${brl(valor)} abatido — ${row.cliente || "—"}.`,
        })
        setParcialValue((p) => ({ ...p, [String(row.id)]: "" }))
        await fetchTitulos()
        // Saldo remanescente DESTE título a partir do saldo autoritativo (servidor) − valor pago agora.
        const saldoRem = Math.max(0, Math.round((saldoAberto - valor) * 100) / 100)
        tryPrintRecibo(row, valor, saldoRem)
        onReceived?.()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast({ variant: "destructive", title: "Falha ao registrar parcial", description: msg })
      } finally {
        setBusyId(null)
      }
    },
    [
      storeId,
      parcialValue,
      postRecebimento,
      formaPagto,
      toast,
      fetchTitulos,
      rows,
      tryPrintRecibo,
      onReceived,
      adicionarEntrada,
      saldoAbertoDe,
    ],
  )

  const totalRestante = useMemo(
    () => somaSaldoEmAberto(filtered, saldoAbertoMap),
    [filtered, saldoAbertoMap],
  )

  const selectCliente = (c: PdvClienteResult) => {
    setSelectedCliente(c)
    setQuery(c.name)
  }

  const voltarCliente = () => {
    setSelectedCliente(null)
    clearClienteSearch()
    queueMicrotask(() => searchInputRef.current?.focus())
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-6 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" />
            Receber conta
            <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
              {hotkeyLabel}
            </kbd>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground/80">
            Busque o cliente, selecione o título e registre o recebimento. Baixa no financeiro e movimentação na sessão
            de caixa ativa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-w-0">
          {!selectedCliente ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Cliente (nome, telefone ou CPF)</Label>
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
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
              <ul className="space-y-1 max-h-48 overflow-y-auto">
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
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-xs font-medium truncate max-w-full">
                  {selectedCliente.name}
                </Badge>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={voltarCliente}>
                  Trocar cliente
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
                <div className="space-y-1 min-w-0" />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Forma de pagamento</Label>
                  {formasAtivas.length === 0 ? (
                    <p className="text-xs text-destructive">Nenhuma forma ativa na Config V3.</p>
                  ) : (
                    <Select value={formaPagto} onValueChange={setFormaPagto}>
                      <SelectTrigger className="h-10 bg-secondary border-border">
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
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Títulos abertos</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{filtered.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo total</p>
                  <p className="text-lg font-bold tabular-nums text-foreground">{brl(totalRestante)}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchTitulos()}
                    disabled={loadingTitulos}
                  >
                    {loadingTitulos ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Recarregar"}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {!loadingTitulos && filtered.length === 0 && !error && (
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhum título em aberto para este cliente.
                </div>
              )}

              <ul className="space-y-2">
                {filtered.map((row) => {
                  const id = String(row.id)
                  const valor = saldoAbertoDe(row)
                  const busy = busyId === id
                  const parcialStr = parcialValue[id] ?? ""
                  const jaPago = (row.status || "").toLowerCase() === "pago"
                  return (
                    <li
                      key={id}
                      className={cn(
                        "rounded-lg border border-border bg-background p-3 space-y-2 shadow-sm",
                        jaPago && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-foreground">{row.descricao || "—"}</p>
                          <p className="text-[10px] text-muted-foreground/80">
                            Vence: {row.vencimento || "—"} · <span className="font-mono">{id}</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-bold uppercase ${statusBadgeClass(row.status)}`}
                          >
                            {statusLabel(row.status)}
                          </Badge>
                          <p className="mt-1 text-lg font-extrabold tabular-nums text-foreground">{brl(valor)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end pt-1 border-t border-border/50">
                        <div className="space-y-1 min-w-0">
                          <Label className="text-[10px] text-muted-foreground">Valor parcial (opcional)</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={parcialStr}
                            onChange={(e) => setParcialValue((p) => ({ ...p, [id]: e.target.value }))}
                            className="h-9 bg-secondary border-border"
                            disabled={busy || jaPago || formasAtivas.length === 0}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || jaPago || !parcialStr.trim() || formasAtivas.length === 0}
                          onClick={() => void callParcial(row)}
                          className="h-9 whitespace-nowrap"
                        >
                          Baixa parcial
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || jaPago || valor <= 0 || formasAtivas.length === 0}
                          onClick={() => void callLiquidar(row)}
                          className="h-9 whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="mr-1 h-4 w-4" /> Quitar total
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-border bg-card shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Fechar (ESC)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
