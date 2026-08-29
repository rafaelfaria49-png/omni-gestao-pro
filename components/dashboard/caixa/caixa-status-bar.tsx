"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Lock,
  Unlock,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Monitor,
  Loader2,
  ChevronRight,
  EyeOff,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useCaixa } from "./caixa-provider"
import { useAtualizarCaixa } from "./use-atualizar-caixa"
import { AberturaCaixaModal } from "./abertura-caixa-modal"
import { FechamentoCaixaModal } from "./fechamento-caixa-modal"
import { CaixaDashboard } from "./caixa-dashboard"
import { useCaixaResumo } from "./use-caixa-resumo"
import { cn } from "@/lib/utils"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useTerminalAtivo } from "@/lib/pdv-terminal"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { appendAuditLog } from "@/lib/audit-log"
import { useOperationsStore } from "@/lib/operations-store"
import { PdvPendingSyncBadge } from "@/components/dashboard/vendas/pdv-pending-sync-badge"
import { SupervisorGateDialog } from "./supervisor-gate-dialog"

/** Janela de "resumo revelado" após autorização do supervisor (Caixa Seguro). */
const REVEAL_MS = 5 * 60 * 1000

interface CaixaStatusBarProps {
  /** Incrementado por comando de voz para abrir o fluxo de abertura de caixa. */
  openAberturaSignal?: number
  onOpenAberturaSignalConsumed?: () => void
  /** Incrementado pelo PDV (menu Operações) para abrir o fechamento sem passar pelo diálogo genérico. */
  openFechamentoSignal?: number
  onOpenFechamentoSignalConsumed?: () => void
  /** PDV: encosta na largura útil, sem margem inferior nem cantos que “encolhem” a mesa. */
  variant?: "default" | "pdv"
}

export function CaixaStatusBar({
  openAberturaSignal = 0,
  onOpenAberturaSignalConsumed,
  openFechamentoSignal = 0,
  onOpenFechamentoSignalConsumed,
  variant = "default",
}: CaixaStatusBarProps) {
  const { caixa, sessaoId, sessaoDesatualizada } = useCaixa()
  const { atualizando, atualizarCaixa } = useAtualizarCaixa("manual")
  const { registrarOperacaoCaixa } = useOperationsStore()
  const { lojaAtivaId } = useLojaAtiva()
  const { terminal, clear: clearTerminal } = useTerminalAtivo(lojaAtivaId)
  const { toast } = useToast()
  const [showAbertura, setShowAbertura] = useState(false)
  const [showFechamento, setShowFechamento] = useState(false)
  // Números autoritativos do caixa (mesma fonte do Resumo do caixa e do Fechamento):
  // vendas canceladas/estornadas NUNCA entram em Entradas/Saídas/Saldo. `resumoRefreshKey`
  // força nova reconciliação após sangria/suprimento.
  const [resumoRefreshKey, setResumoRefreshKey] = useState(0)
  const { entradas, saidas, saldoEsperado } = useCaixaResumo(caixa.isOpen, resumoRefreshKey)

  // Sangria/Suprimento acessível em TODOS os PDVs — a barra é compartilhada
  // (Clássico, Rápido/Supermercado, Assistência, Venda Completa). Reusa o mesmo
  // endpoint idempotente com retry (`registrarOperacaoCaixaServer`).
  const [operationType, setOperationType] = useState<"sangria" | "suprimento" | null>(null)
  const [opValor, setOpValor] = useState("")
  const [opMotivo, setOpMotivo] = useState("")
  const [opSaving, setOpSaving] = useState(false)
  const opLabel = operationType === "sangria" ? "Sangria" : "Suprimento"

  // ── Resumo do Caixa protegido (Supervisor Gate / Caixa Seguro) ───────────────
  // Por padrão a barra fica RECOLHIDA: sem valores, sem ações. Ver o resumo ou
  // disparar ação sensível (sangria/suprimento/fechamento) exige PIN de supervisor
  // validado no servidor (POST /api/auth/admin). A janela revelada dura 5 min e
  // SEMPRE pede o PIN de novo (não reaproveita o cookie admin) — protegido por padrão.
  const [revealed, setRevealed] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const revealTimerRef = useRef<number | null>(null)
  const pendingActionRef = useRef<(() => void) | null>(null)
  const revealedRef = useRef(false)
  useEffect(() => {
    revealedRef.current = revealed
  }, [revealed])

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current != null) {
      window.clearTimeout(revealTimerRef.current)
      revealTimerRef.current = null
    }
  }, [])

  const hideResumo = useCallback(() => {
    clearRevealTimer()
    setRevealed(false)
  }, [clearRevealTimer])

  const grantReveal = useCallback(() => {
    clearRevealTimer()
    setRevealed(true)
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null
      setRevealed(false)
    }, REVEAL_MS)
  }, [clearRevealTimer])

  const requestGate = useCallback((action: (() => void) | null) => {
    pendingActionRef.current = action
    setGateOpen(true)
  }, [])

  const onGateAuthorized = useCallback(() => {
    grantReveal()
    const action = pendingActionRef.current
    pendingActionRef.current = null
    action?.()
  }, [grantReveal])

  // Recolhe ao desmontar (trocar de PDV/rota) e quando o caixa fecha.
  useEffect(() => clearRevealTimer, [clearRevealTimer])
  useEffect(() => {
    if (!caixa.isOpen) hideResumo()
  }, [caixa.isOpen, hideResumo])

  const closeOp = () => {
    setOperationType(null)
    setOpValor("")
    setOpMotivo("")
  }

  const confirmOp = async () => {
    const tipo = operationType
    if (!tipo) return
    const valor = parseFloat(opValor.replace(",", ".")) || 0
    const motivo = opMotivo.trim()
    if (valor <= 0) {
      toast({ variant: "destructive", title: "Valor inválido", description: "Informe um valor maior que zero." })
      return
    }
    if (!motivo) {
      toast({ variant: "destructive", title: "Motivo obrigatório", description: "Descreva o motivo da operação." })
      return
    }
    const label = tipo === "sangria" ? "Sangria" : "Suprimento"
    setOpSaving(true)
    appendAuditLog({
      action: tipo === "sangria" ? "sangria_caixa" : "suprimento_caixa",
      userLabel: terminal?.code || "Caixa",
      detail: `R$ ${valor.toFixed(2)} — ${motivo}`,
    })
    try {
      if (lojaAtivaId && sessaoId) {
        const localId = `caixaop:${sessaoId}:${tipo}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
        const r = await registrarOperacaoCaixa({
          sessaoId,
          tipo,
          valor,
          motivo,
          localId,
          operador: terminal?.code || "",
        })
        if (r.ok) {
          toast({
            title: tipo === "sangria" ? "Sangria registrada" : "Suprimento registrado",
            description: `R$ ${valor.toFixed(2)} — ${motivo}`,
          })
        } else {
          toast({
            variant: "destructive",
            title: `${label} não confirmada no servidor`,
            description:
              r.reason === "client_error"
                ? "Aplicada apenas no caixa local. Verifique antes de fechar o caixa."
                : "Sem sucesso após várias tentativas. Só no caixa local — reenvie antes de fechar.",
          })
        }
      } else {
        // Sem sessão confirmada no servidor: não silenciar (mesma regra do Clássico).
        toast({
          variant: "destructive",
          title: `${label} só no caixa local`,
          description: "Caixa sem sessão confirmada no servidor. Reabra o caixa para registrar com segurança.",
        })
      }
    } finally {
      setOpSaving(false)
      closeOp()
      // Recarrega operações do servidor para refletir a sangria/suprimento nos totais.
      setResumoRefreshKey((k) => k + 1)
    }
  }

  const terminalPill = terminal ? (
    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
      <Monitor className="mr-1 h-3 w-3" />
      {terminal.code || terminal.name}
    </Badge>
  ) : null

  useEffect(() => {
    if (!openAberturaSignal) return
    if (!caixa.isOpen) {
      setShowAbertura(true)
    }
    onOpenAberturaSignalConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sinal é um contador; callback opcional
  }, [openAberturaSignal, caixa.isOpen])

  useEffect(() => {
    if (!openFechamentoSignal) return
    if (caixa.isOpen) {
      // Fechar caixa é ação sensível: se o resumo não está revelado, exige PIN.
      if (revealedRef.current) {
        setShowFechamento(true)
      } else {
        requestGate(() => setShowFechamento(true))
      }
    }
    onOpenFechamentoSignalConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFechamentoSignal, caixa.isOpen])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value)
  }

  const formatTime = (date: Date | null) => {
    if (!date) return "--:--"
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  }

  // Ação de recuperação: reconsulta a sessão ativa no servidor sem exigir fechar
  // e abrir outro caixa. Disponível em TODOS os PDVs (a barra é compartilhada).
  // NUNCA abre sessão nova — só lê a que já existe no servidor.
  const botaoAtualizarCaixa = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void atualizarCaixa()}
      disabled={atualizando}
      className="h-8 shrink-0 rounded-lg border-border"
    >
      {atualizando ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-1.5 h-4 w-4" />
      )}
      {atualizando ? "Atualizando…" : "Atualizar caixa"}
    </Button>
  )

  if (!caixa.isOpen) {
    return (
      <>
        <PdvPendingSyncBadge className={cn("mb-2", variant === "pdv" && "mx-2 mt-2")} />
        <div
          className={cn(
            "bg-warning/10 border border-warning/30 rounded-lg p-4 mb-4",
            variant === "pdv" && "rounded-none border-x-0 border-t-0 mb-0 px-2 py-1.5 sm:px-3 sm:py-2"
          )}
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning">
                <Lock className="h-4 w-4" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold text-warning">Caixa Fechado</span>
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  {terminalPill}
                  {terminal && (
                    <button
                      type="button"
                      onClick={() => clearTerminal()}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Trocar
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Abra o caixa para realizar vendas</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {/* Antes de abrir outro caixa: confere se já existe sessão aberta no servidor. */}
              {botaoAtualizarCaixa}
              <Button onClick={() => setShowAbertura(true)} className="h-9 rounded-lg bg-primary font-semibold hover:bg-primary/90">
                <Unlock className="w-4 h-4 mr-2" />
                Abrir Caixa
              </Button>
            </div>
          </div>
        </div>

        <AberturaCaixaModal isOpen={showAbertura} onClose={() => setShowAbertura(false)} />
      </>
    )
  }

  return (
    <>
      <PdvPendingSyncBadge className={cn("mb-2", variant === "pdv" && "mx-2 mt-2")} />
      {/* Caixa aberto na tela mas sem referência de sessão utilizável: a venda seria
          recusada com "Sessão de caixa inválida". Recuperável sem fechar o caixa. */}
      {sessaoDesatualizada && (
        <div
          className={cn(
            "mb-2 flex flex-col items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 sm:flex-row sm:items-center sm:justify-between",
            variant === "pdv" && "mx-2 mt-2"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-semibold text-warning">Sessão de caixa desatualizada</p>
              <p className="text-xs text-muted-foreground">
                O caixa está aberto, mas este dispositivo perdeu a referência da sessão. Atualize para
                voltar a finalizar vendas — o carrinho é mantido.
              </p>
            </div>
          </div>
          {botaoAtualizarCaixa}
        </div>
      )}
      <div
        className={cn(
          "bg-success/10 border border-success/30 rounded-lg mb-4 overflow-hidden",
          variant === "pdv" && "rounded-none border-x-0 border-t-0 mb-0"
        )}
      >
        {revealed ? (
          <>
            <CaixaDashboard />
            <div
              className={cn(
                "flex flex-col gap-3 p-3 xl:flex-row xl:items-center",
                variant === "pdv" && "px-2 py-1.5 sm:px-3 sm:py-2"
              )}
            >
              {/* Identidade do caixa */}
              <div className="flex min-w-0 shrink-0 items-center gap-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
                  <Unlock className="h-4 w-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-success">Caixa Aberto</span>
                    <Badge variant="outline" className="shrink-0 border-success/30 bg-success/5 px-1.5 py-0 text-[10px] text-success">
                      <Clock className="mr-1 h-3 w-3" />
                      Desde {formatTime(caixa.dataAbertura)}
                    </Badge>
                    {terminalPill}
                  </div>
                  <p className="text-xs text-muted-foreground">Pronto para vendas</p>
                </div>
              </div>

              {/* Resumo — grid uniforme: nunca desalinha ao quebrar linha */}
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4 xl:mx-auto xl:max-w-2xl">
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    <DollarSign className="h-3 w-3 shrink-0" />
                    Abertura
                  </p>
                  <p className="truncate text-sm font-semibold tabular-nums text-foreground">{formatCurrency(caixa.saldoInicial)}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    <TrendingUp className="h-3 w-3 shrink-0 text-success" />
                    Entradas
                  </p>
                  <p className="truncate text-sm font-semibold tabular-nums text-success">{formatCurrency(entradas)}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5">
                  <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                    <TrendingDown className="h-3 w-3 shrink-0 text-destructive" />
                    Saídas
                  </p>
                  <p className="truncate text-sm font-semibold tabular-nums text-destructive">{formatCurrency(saidas)}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-success/35 bg-success/10 px-2.5 py-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-success/90 dark:text-success">
                    Saldo Atual
                  </p>
                  <p className="truncate text-base font-bold leading-snug tabular-nums text-success">{formatCurrency(saldoEsperado)}</p>
                </div>
              </div>

              {/* Ações */}
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {botaoAtualizarCaixa}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={hideResumo}
                  className="h-8 rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <EyeOff className="mr-1.5 h-4 w-4" />
                  Ocultar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOperationType("sangria")}
                  disabled={opSaving || showFechamento}
                  className="h-8 rounded-lg border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  <TrendingDown className="mr-1.5 h-4 w-4" />
                  Sangria
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOperationType("suprimento")}
                  disabled={opSaving || showFechamento}
                  className="h-8 rounded-lg border-success/40 text-success hover:bg-success hover:text-success-foreground transition-colors"
                >
                  <TrendingUp className="mr-1.5 h-4 w-4" />
                  Suprimento
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFechamento(true)}
                  disabled={opSaving || showFechamento}
                  className="h-8 rounded-lg border-destructive/50 font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                  <Lock className="mr-1.5 h-4 w-4" />
                  Fechar Caixa
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div
            className={cn(
              "flex flex-col sm:flex-row items-center justify-between gap-3 p-3",
              variant === "pdv" && "px-2 py-1.5 sm:px-3 sm:py-2"
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
                <Unlock className="h-4 w-4" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold text-success">Caixa Aberto</span>
                  <Badge variant="outline" className="shrink-0 border-success/30 bg-success/5 px-1.5 py-0 text-[10px] text-success">
                    <Clock className="mr-1 h-3 w-3" />
                    Desde {formatTime(caixa.dataAbertura)}
                  </Badge>
                  {terminalPill}
                </div>
                <p className="text-xs text-muted-foreground">Resumo do caixa protegido</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {/* Recuperação de sessão não revela valores — fica disponível também
                  com o Resumo protegido (Caixa Seguro). */}
              {botaoAtualizarCaixa}
              <Button
                variant="outline"
                size="sm"
                onClick={() => requestGate(null)}
                className="h-8 shrink-0 rounded-lg border-border"
              >
                <Lock className="w-4 h-4 mr-2" />
                Resumo do Caixa
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <SupervisorGateDialog
        open={gateOpen}
        onOpenChange={(o) => {
          setGateOpen(o)
          if (!o) pendingActionRef.current = null
        }}
        onAuthorized={onGateAuthorized}
        title="Resumo do Caixa protegido"
        description="Informe a senha do supervisor para ver valores, vendas e ações do caixa."
      />

      <FechamentoCaixaModal isOpen={showFechamento} onClose={() => setShowFechamento(false)} />

      {/* Sangria / Suprimento — disponível em todos os PDVs via barra compartilhada */}
      <Dialog open={operationType !== null} onOpenChange={(open) => { if (!open) closeOp() }}>
        <DialogContent className="max-w-sm border-border bg-card">
          <DialogHeader>
            <DialogTitle>{opLabel} de Caixa</DialogTitle>
            <DialogDescription>
              {operationType === "sangria"
                ? "Retirada de dinheiro do caixa."
                : "Entrada de dinheiro (reforço) no caixa."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-sm">Valor</Label>
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={opValor}
                onChange={(e) => setOpValor(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Motivo</Label>
              <Input
                placeholder={operationType === "sangria" ? "Ex.: retirada para o banco" : "Ex.: troco / reforço"}
                value={opMotivo}
                onChange={(e) => setOpMotivo(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeOp} disabled={opSaving}>
                Cancelar
              </Button>
              <Button onClick={() => void confirmOp()} disabled={opSaving}>
                {opSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registrando…
                  </>
                ) : (
                  `Confirmar ${opLabel}`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
