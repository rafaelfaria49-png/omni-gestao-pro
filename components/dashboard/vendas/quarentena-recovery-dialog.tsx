"use client"

/**
 * Console de recuperação administrada de vendas em quarentena
 * (GOAL PDV-VENDAS-QUARENTENA-RECOVERY-ALL-P0-006A).
 *
 * Fluxo: analisar → preview (dry-run) → confirmação → execução → resultado.
 * A primeira tela NUNCA muta: o preview chama uma rota read-only.
 *
 * Decisões de UI que são requisito operacional, não estética:
 *  - cada linha declara o próprio veredito em texto claro, sempre visível — risco
 *    operacional não fica escondido atrás de tooltip ou legenda;
 *  - as quatro faixas (recuperável / precisa autorização / já recuperada / bloqueada)
 *    são estados, não etapas: sem numeração 01/02/03;
 *  - a execução mostra spinner, não barra de progresso: o lote é UMA requisição, e uma
 *    barra determinística seria mentira.
 */

import { useCallback, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import {
  useOperationsStore,
  type QuarantineRecoveryPlanItemView,
  type QuarantineRecoveryResultView,
  type QuarantineRecoverySummaryView,
} from "@/lib/operations-store"

type Step = "preview" | "result"

const EMPTY_SUMMARY: QuarantineRecoverySummaryView = {
  total: 0,
  ready: 0,
  alreadyRecovered: 0,
  requiresConfirmation: 0,
  blocked: 0,
  valorTotal: 0,
  valorExecutavel: 0,
  byClass: {},
}

function fmtBrl(v: number): string {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Faixa operacional → token semântico. Sem cor hardcoded. */
const BUCKET_TONE = {
  READY: { dot: "bg-success", text: "text-success", label: "Recuperável" },
  REQUIRES_CONFIRMATION: { dot: "bg-warning", text: "text-warning", label: "Precisa de autorização" },
  ALREADY_RECOVERED: { dot: "bg-muted-foreground", text: "text-muted-foreground", label: "Já recuperada" },
  BLOCKED: { dot: "bg-destructive", text: "text-destructive", label: "Bloqueada" },
} as const

const RESULT_TONE = {
  RECOVERED: { dot: "bg-success", text: "text-success", label: "Recuperada" },
  ALREADY_RECOVERED: { dot: "bg-muted-foreground", text: "text-muted-foreground", label: "Já existia" },
  REQUIRES_CONFIRMATION: { dot: "bg-warning", text: "text-warning", label: "Aguarda autorização" },
  BLOCKED: { dot: "bg-destructive", text: "text-destructive", label: "Bloqueada" },
  FAILED: { dot: "bg-destructive", text: "text-destructive", label: "Falhou" },
} as const

/** Faixa do resumo. Ordenada por prioridade operacional, não por gravidade. */
function BucketTile({
  count,
  label,
  tone,
  active,
}: {
  count: number
  label: string
  tone: string
  active: boolean
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border px-3 py-2.5",
        active ? "border-border bg-muted/30" : "border-border/60 bg-transparent opacity-60",
      )}
    >
      <p className={cn("text-xl font-bold tabular-nums leading-none", active ? tone : "text-muted-foreground")}>
        {count}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  )
}

export function QuarentenaRecoveryDialog({
  open,
  onOpenChange,
  unidadeLabel,
  onFinished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unidadeLabel?: string
  /** Chamado após execução com pelo menos uma venda reconciliada. */
  onFinished?: () => void
}) {
  const { previewQuarantineRecovery, recoverQuarantinedSalesBatch } = useOperationsStore()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>("preview")
  const [analyzing, setAnalyzing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)
  const [writerEnabled, setWriterEnabled] = useState(false)
  const [items, setItems] = useState<QuarantineRecoveryPlanItemView[]>([])
  const [summary, setSummary] = useState<QuarantineRecoverySummaryView>(EMPTY_SUMMARY)
  const [results, setResults] = useState<QuarantineRecoveryResultView[]>([])
  const [motivo, setMotivo] = useState("")
  const [retroConfirm, setRetroConfirm] = useState(false)

  const reset = useCallback(() => {
    setStep("preview")
    setAnalyzed(false)
    setItems([])
    setSummary(EMPTY_SUMMARY)
    setResults([])
    setMotivo("")
    setRetroConfirm(false)
    setWriterEnabled(false)
  }, [])

  const analisar = useCallback(async () => {
    setAnalyzing(true)
    const res = await previewQuarantineRecovery()
    setAnalyzing(false)
    if (!res.ok) {
      toast({
        title: "Não foi possível analisar",
        description: res.reason.slice(0, 220),
        variant: "destructive",
      })
      return
    }
    setItems(res.items)
    setSummary(res.summary)
    setWriterEnabled(res.writerEnabled)
    setAnalyzed(true)
    setStep("preview")
  }, [previewQuarantineRecovery, toast])

  /** Quantas vendas a execução vai TENTAR agora, dada a autorização marcada. */
  const tentativas = summary.ready + (retroConfirm ? summary.requiresConfirmation : 0)

  const executar = useCallback(async () => {
    setExecuting(true)
    const res = await recoverQuarantinedSalesBatch({
      motivo: motivo.trim(),
      allowClosedOriginalSession: retroConfirm,
    })
    setExecuting(false)
    if (!res.ok) {
      toast({
        title: "Não foi possível recuperar",
        description: res.reason.slice(0, 220),
        variant: "destructive",
      })
      return
    }
    setResults(res.results)
    setStep("result")
    const recuperadas = res.summary.recovered
    toast({
      title:
        recuperadas > 0
          ? `${recuperadas} venda${recuperadas !== 1 ? "s" : ""} recuperada${recuperadas !== 1 ? "s" : ""}`
          : "Nenhuma venda recuperada",
      description:
        `${res.summary.alreadyRecovered} já existia(m) · ${res.summary.blocked} bloqueada(s) · ` +
        `${res.summary.failed} falha(s). Nenhuma venda existente foi alterada.`,
    })
    if (res.reconciled > 0) onFinished?.()
  }, [motivo, onFinished, recoverQuarantinedSalesBatch, retroConfirm, toast])

  const podeExecutar =
    writerEnabled && !executing && motivo.trim().length >= 5 && tentativas > 0

  const resultSummary = useMemo(() => {
    const acc = { RECOVERED: 0, ALREADY_RECOVERED: 0, REQUIRES_CONFIRMATION: 0, BLOCKED: 0, FAILED: 0 }
    for (const result of results) acc[result.status] += 1
    return acc
  }, [results])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (analyzing || executing)) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="border-border bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {step === "result" ? "Resultado da recuperação" : "Recuperar vendas em quarentena"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === "result"
              ? "Nenhuma venda existente foi alterada. Vendas com evidência no servidor saíram da quarentena."
              : unidadeLabel
                ? `Vendas reais preservadas localmente após colisão de número · ${unidadeLabel}`
                : "Vendas reais preservadas localmente após colisão de número."}
          </DialogDescription>
        </DialogHeader>

        {step === "preview" ? (
          <div className="space-y-4">
            {!analyzed ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  A análise lê o servidor sem gravar nada e classifica cada venda em quarentena:
                  recuperável, precisa de autorização, já recuperada ou bloqueada.
                </p>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
                    <span>
                      Nenhuma venda que ocupa um número antigo será alterada, renumerada ou apagada.
                      Cada venda recuperada recebe um número novo gerado pelo servidor.
                    </span>
                  </p>
                </div>
                <Button type="button" className="w-full gap-2" disabled={analyzing} onClick={() => void analisar()}>
                  {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {analyzing ? "Analisando…" : "Analisar quarentenas"}
                </Button>
              </div>
            ) : summary.total === 0 ? (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-success" />
                <p className="mt-2 text-sm font-medium text-foreground">Nenhuma venda em quarentena</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Não há conflito de identificação pendente nesta unidade.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <BucketTile
                    count={summary.ready}
                    label="Recuperáveis"
                    tone={BUCKET_TONE.READY.text}
                    active={summary.ready > 0}
                  />
                  <BucketTile
                    count={summary.requiresConfirmation}
                    label="Caixa fechado — precisa autorização"
                    tone={BUCKET_TONE.REQUIRES_CONFIRMATION.text}
                    active={summary.requiresConfirmation > 0}
                  />
                  <BucketTile
                    count={summary.alreadyRecovered}
                    label="Já recuperadas"
                    tone={BUCKET_TONE.ALREADY_RECOVERED.text}
                    active={summary.alreadyRecovered > 0}
                  />
                  <BucketTile
                    count={summary.blocked}
                    label="Bloqueadas"
                    tone={BUCKET_TONE.BLOCKED.text}
                    active={summary.blocked > 0}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {summary.total} venda{summary.total !== 1 ? "s" : ""} em quarentena ·{" "}
                  <span className="tabular-nums text-foreground">{fmtBrl(summary.valorTotal)}</span> no total
                  {summary.valorExecutavel !== summary.valorTotal && (
                    <>
                      {" · "}
                      <span className="tabular-nums text-foreground">{fmtBrl(summary.valorExecutavel)}</span>{" "}
                      recuperável
                    </>
                  )}
                  . Valores informativos.
                </p>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {items.map((item, index) => {
                    const tone = BUCKET_TONE[item.bucket]
                    return (
                      <div key={`${item.conflictingPedidoId}:${item.clientSaleId ?? index}`} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-mono text-xs font-semibold text-foreground">
                            {item.conflictingPedidoId || "—"}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {fmtDate(item.at)} · {fmtBrl(item.total)}
                          </span>
                        </div>
                        <p className={cn("mt-1 flex items-start gap-1.5 text-[11px]", tone.text)}>
                          <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                          <span className="min-w-0">
                            <span className="font-medium">{tone.label}</span>
                            <span className="text-muted-foreground"> — {item.reason}</span>
                          </span>
                        </p>
                      </div>
                    )
                  })}
                </div>

                {!writerEnabled && (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
                    <p className="flex items-start gap-2 text-xs text-warning">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        A numeração server-side está desligada nesta instalação. A análise acima é real,
                        mas a execução permanece indisponível até que o Writer V2 seja habilitado.
                      </span>
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="batch-recover-motivo" className="text-sm text-foreground">
                    Motivo da recuperação <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="batch-recover-motivo"
                    placeholder="Descreva o motivo (mínimo 5 caracteres)…"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="min-h-[72px] resize-none border-border bg-background"
                    disabled={executing}
                  />
                </div>

                {summary.requiresConfirmation > 0 && (
                  <label
                    htmlFor="batch-retro-confirm"
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5"
                  >
                    <Checkbox
                      id="batch-retro-confirm"
                      checked={retroConfirm}
                      onCheckedChange={(checked) => setRetroConfirm(checked === true)}
                      disabled={executing}
                      className="mt-px"
                    />
                    <span className="min-w-0 text-xs text-foreground">
                      Confirmo o lançamento retroativo na sessão original de{" "}
                      <span className="font-semibold tabular-nums">{summary.requiresConfirmation}</span>{" "}
                      venda{summary.requiresConfirmation !== 1 ? "s" : ""} com caixa já fechado.
                      <span className="mt-0.5 block text-muted-foreground">
                        Nenhum valor será movido para o caixa atual.
                      </span>
                    </span>
                  </label>
                )}

                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={executing}
                    onClick={() => {
                      reset()
                      onOpenChange(false)
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" className="gap-2" disabled={!podeExecutar} onClick={() => void executar()}>
                    {executing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {executing
                      ? `Recuperando ${tentativas} venda${tentativas !== 1 ? "s" : ""}…`
                      : tentativas > 0
                        ? `Recuperar ${tentativas} venda${tentativas !== 1 ? "s" : ""}`
                        : "Nada a recuperar"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <BucketTile
                count={resultSummary.RECOVERED}
                label="Recuperadas"
                tone={RESULT_TONE.RECOVERED.text}
                active={resultSummary.RECOVERED > 0}
              />
              <BucketTile
                count={resultSummary.ALREADY_RECOVERED}
                label="Já existiam"
                tone={RESULT_TONE.ALREADY_RECOVERED.text}
                active={resultSummary.ALREADY_RECOVERED > 0}
              />
              <BucketTile
                count={resultSummary.REQUIRES_CONFIRMATION}
                label="Aguardam autorização"
                tone={RESULT_TONE.REQUIRES_CONFIRMATION.text}
                active={resultSummary.REQUIRES_CONFIRMATION > 0}
              />
              <BucketTile
                count={resultSummary.BLOCKED + resultSummary.FAILED}
                label="Bloqueadas ou com falha"
                tone={RESULT_TONE.BLOCKED.text}
                active={resultSummary.BLOCKED + resultSummary.FAILED > 0}
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {results.map((result, index) => {
                const tone = RESULT_TONE[result.status]
                return (
                  <div key={`${result.conflictingPedidoId}:${result.clientSaleId ?? index}`} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground line-through">
                        {result.conflictingPedidoId || "—"}
                      </span>
                      {result.venda ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-success/30 bg-success/10 px-1.5 py-0 font-mono text-[10px] text-success"
                        >
                          {result.venda.pedidoId}
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground">sem número novo</span>
                      )}
                    </div>
                    <p className={cn("mt-1 flex items-start gap-1.5 text-[11px]", tone.text)}>
                      <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
                      <span className="min-w-0">
                        <span className="font-medium">{tone.label}</span>
                        <span className="text-muted-foreground"> — {result.reason}</span>
                      </span>
                    </p>
                  </div>
                )
              })}
            </div>

            {resultSummary.REQUIRES_CONFIRMATION > 0 && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Clock className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  As vendas que aguardam autorização continuam em quarentena. Analise novamente e marque
                  a confirmação de lançamento retroativo para recuperá-las.
                </span>
              </p>
            )}
            {resultSummary.BLOCKED + resultSummary.FAILED > 0 && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>
                  Vendas bloqueadas mantêm a cópia local preservada. O motivo técnico de cada uma está
                  na linha correspondente — nada foi descartado.
                </span>
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setResults([])
                  setMotivo("")
                  setRetroConfirm(false)
                  setAnalyzed(false)
                  setStep("preview")
                }}
              >
                <ArrowLeft className="h-4 w-4" />
                Analisar de novo
              </Button>
              <Button
                type="button"
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                Concluir
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
