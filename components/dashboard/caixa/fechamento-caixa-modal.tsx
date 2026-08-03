"use client"

import { useMemo, useState } from "react"
import {
  Lock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  AlertTriangle,
  Printer,
  Copy,
  Layers,
  Wallet,
  Banknote,
  QrCode,
  CreditCard,
  Receipt,
  CalendarClock,
  Ticket,
  Hash,
  User,
  Monitor,
  Clock,
  BarChart3,
  ClipboardList,
  Calculator,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ConferenciaCaixa } from "./conferencia-caixa"
import { useSession } from "next-auth/react"
import { useCaixa } from "./caixa-provider"
import { ensureLedger, useOperationsStore } from "@/lib/operations-store"
import { appendAuditLog } from "@/lib/audit-log"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { operatorDisplayName } from "@/lib/pdv-operator-label"
import { usePdvOperadorNome } from "@/lib/pdv-operador-nome"
import { useTerminalAtivo } from "@/lib/pdv-terminal"
import { activeCaixaSessionUrl } from "@/lib/pdv-caixa-session"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { escapeHtml, openThermalHtmlPrint } from "@/lib/thermal-print"
import {
  filterSalesDaSessao,
  receitaTotalDoDia,
  type FechamentoPosSnapshot,
  type DinheiroContadoDetalhado,
} from "@/lib/caixa-fechamento-resumo"
import { useCaixaResumo } from "./use-caixa-resumo"
import { FechamentoPosFechamentoDialog } from "./fechamento-pos-fechamento-dialog"
import { CalculadoraDinheiroCaixa } from "./calculadora-dinheiro-caixa"

interface FechamentoCaixaModalProps {
  isOpen: boolean
  onClose: () => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

export function FechamentoCaixaModal({ isOpen, onClose }: FechamentoCaixaModalProps) {
  const { caixa, fecharCaixa, sessaoId } = useCaixa()
  const { dailyLedger, sales } = useOperationsStore()
  const { empresaDocumentos, lojaAtivaId } = useLojaAtiva()
  const { data: session } = useSession()
  const operadorNomeAbertura = usePdvOperadorNome(lojaAtivaId)
  const { terminal } = useTerminalAtivo(lojaAtivaId)
  // Terminal ativo do device (mesmo em que o caixa foi aberto) — Fase 3: mostrar
  // o PDV no comprovante/relatório de fechamento. "Sem terminal" para sessões legadas.
  const terminalLabel = terminal
    ? `${terminal.code}${terminal.name && terminal.name !== terminal.code ? ` · ${terminal.name}` : ""}`
    : "Sem terminal"
  const { toast } = useToast()

  const [valorContado, setValorContado] = useState("")
  // Detalhamento por denominação (calculadora). Só existe quando o total da
  // calculadora foi aplicado no campo; edição manual do valor o invalida (→ null).
  const [dinheiroContadoDetalhado, setDinheiroContadoDetalhado] =
    useState<DinheiroContadoDetalhado | null>(null)
  const [observacao, setObservacao] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [posFechamentoOpen, setPosFechamentoOpen] = useState(false)
  const [posFechamentoSnapshot, setPosFechamentoSnapshot] = useState<FechamentoPosSnapshot | null>(null)

  const ledger = ensureLedger(dailyLedger)
  const userAudit = (empresaDocumentos.nomeFantasia || "").trim() || "Loja"

  // Fonte ÚNICA e autoritativa — idêntica à do Resumo do caixa e da barra de status.
  // Reconcilia o status das vendas (cancelamentos da tela Vendas) e exclui canceladas
  // de TODOS os totais. Garante que o fechamento grave os mesmos números exibidos.
  const { resumo, opsCarregando, saldoEsperado, entradas, saidas, sessionSales, operacoesSessao, vendasSessao } =
    useCaixaResumo(isOpen)

  // Operador da sessão para o comprovante — nome LEGÍVEL (fonte única: abertura do
  // caixa → sessão → e-mail; nunca o `cashierId` técnico). O `cashierId` permanece
  // em cada venda para auditoria. Mostra o operador quando houve venda na sessão;
  // mantém vazio (→ "—") em sessão sem vendas para não inventar dado.
  const operadorDisplay = operatorDisplayName({ aberturaNome: operadorNomeAbertura, session })
  const operadoresSessao = useMemo(() => {
    const houveVenda = filterSalesDaSessao(sales, {
      sessaoId,
      dataAbertura: caixa.dataAbertura,
    }).some((s) => !!s.cashierId)
    return houveVenda && operadorDisplay ? [operadorDisplay] : []
  }, [sales, sessaoId, caixa.dataAbertura, operadorDisplay])

  // Receita total do dia (faturamento) — vendas líquidas + serviços recebidos.
  // Fonte única (helper) para casar com a reimpressão do histórico.
  const receitaTotalDia = receitaTotalDoDia(resumo)

  // Saldo total movimentado (inclui pix/cartão) — AUTORITATIVO (resumo das vendas ativas,
  // sem canceladas). Substitui o antigo acumulador local `getSaldoAtual()` que ficava
  // inflado por vendas canceladas. É o número gravado como `saldoFinal` no fechamento.
  // Conferência de gaveta usa o DINHEIRO físico esperado (não inclui pix/cartão).
  const saldoDinheiroEsperado = resumo.saldoDinheiroEsperado
  const valorContadoNum = parseFloat(valorContado) || 0
  const diferenca = valorContadoNum - saldoDinheiroEsperado
  const temDiferenca = valorContado !== "" && Math.abs(diferenca) > 0.01

  const buildResumoTexto = () => {
    const pg = resumo.porPagamento
    const lines = [
      "==== FECHAMENTO DE CAIXA ====",
      `Loja: ${userAudit}`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      sessaoId ? `Sessão: ${sessaoId}` : "",
      `Terminal: ${terminalLabel}`,
      operadoresSessao.length ? `Operador(es): ${operadoresSessao.join(", ")}` : "",
      "--- RESUMO FINANCEIRO ---",
      `Vendas produtos:  ${fmt(resumo.totalLiquido)}`,
      `Serviços receb.:  ${fmt(resumo.recebimentosContas)}`,
      resumo.outrosRecebimentos > 0 ? `Outros receb.:    ${fmt(resumo.outrosRecebimentos)}` : "",
      "----------------------------",
      `RECEITA TOTAL DIA:${fmt(receitaTotalDia)}`,
      "--- VENDAS POR ORIGEM ---",
      ...resumo.porOrigem.map((o) => `${o.label.padEnd(20)} ${fmt(o.valorBruto)} (${o.qtdItens} itens)`),
      "--- FORMAS DE PAGAMENTO ---",
      `Dinheiro:   ${fmt(pg.dinheiro)}`,
      `Pix:        ${fmt(pg.pix)}`,
      `Débito:     ${fmt(pg.cartaoDebito)}`,
      `Crédito:    ${fmt(pg.cartaoCredito)}`,
      `Carnê:      ${fmt(pg.carne)}`,
      `A prazo:    ${fmt(pg.aPrazo)}`,
      `Vale/Créd.: ${fmt(pg.creditoVale)}`,
      "--- CONSOLIDAÇÃO ---",
      `Vendas (qtd):     ${resumo.qtdVendas}`,
      `Subtotal bruto:   ${fmt(resumo.subtotalBruto)}`,
      `Descontos:       -${fmt(resumo.descontos)}`,
      `Total líquido:    ${fmt(resumo.totalLiquido)}`,
      `Total recebido:   ${fmt(resumo.totalRecebido)}`,
      `A prazo (fiado):  ${fmt(resumo.aPrazo)}`,
      `Ticket médio:     ${fmt(resumo.ticketMedio)}`,
      resumo.qtdRecebimentosContas > 0
        ? `Serviços recebidos: ${fmt(resumo.recebimentosContas)} (${resumo.qtdRecebimentosContas})`
        : "",
      resumo.recebimentosContasDinheiro > 0
        ? `  CR em dinheiro: ${fmt(resumo.recebimentosContasDinheiro)}`
        : "",
      "================================",
      "    RECEITA TOTAL DO DIA",
      `        ${fmt(receitaTotalDia)}`,
      "================================",
      "--- CAIXA (GAVETA) ---",
      `Abertura:         ${fmt(resumo.saldoInicial)}`,
      `(+) Dinheiro:     ${fmt(pg.dinheiro)}`,
      resumo.recebimentosContasDinheiro > 0
        ? `(+) Receb. CR:    ${fmt(resumo.recebimentosContasDinheiro)}`
        : "",
      `(+) Suprimentos:  ${fmt(resumo.suprimentos)}`,
      `(-) Sangrias:     ${fmt(resumo.sangrias)}`,
      `= Saldo dinheiro: ${fmt(saldoDinheiroEsperado)}`,
      valorContado ? `Valor contado:    ${fmt(valorContadoNum)}` : "",
      temDiferenca ? `Diferença:        ${fmt(diferenca)}` : "",
      observacao ? `Obs: ${observacao}` : "",
      "=============================",
    ]
      .filter(Boolean)
      .join("\n")
    return lines
  }

  const handleImprimirRelatorio = () => {
    const inner = `
      <div style="text-align:center;font-weight:700">FECHAMENTO DE CAIXA</div>
      <div style="font-size:10px;text-align:center;margin:4px 0">${escapeHtml(userAudit)}</div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:11px;margin:0">${escapeHtml(buildResumoTexto())}</pre>
      <div style="height:14mm" aria-hidden="true"></div>
    `
    openThermalHtmlPrint(inner, "Fechamento de caixa")
  }

  const handleCopiarRelatorio = async () => {
    try {
      await navigator.clipboard.writeText(buildResumoTexto())
      toast({ title: "Copiado", description: "Resumo do fechamento na área de transferência." })
    } catch {
      toast({ title: "Erro", description: "Não foi possível copiar.", variant: "destructive" })
    }
  }

  const handleFecharCaixa = async () => {
    // ── Regra 4: validar unidade ativa ANTES de qualquer coisa ──────────────
    // Sem unidade não há como persistir nem identificar a sessão no servidor.
    if (!lojaAtivaId) {
      console.error("[caixa/fechar] bloqueado: lojaAtivaId ausente")
      toast({
        variant: "destructive",
        title: "Unidade não selecionada",
        description: "Selecione a unidade ativa antes de fechar o caixa.",
      })
      return
    }

    const lojaId = lojaAtivaId
    const terminalId = terminal?.id ?? null

    // POST de fechamento (reutilizado na reconciliação). Devolve ok + status + erro.
    const postFechar = async (
      sessaoIdToClose: string,
    ): Promise<{ ok: boolean; status: number; error?: string; fechadaEm?: string | null }> => {
      try {
        const res = await fetch("/api/ops/caixa/fechar", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "x-assistec-loja-id": lojaId },
          body: JSON.stringify({
            sessaoId: sessaoIdToClose,
            saldoFinal: saldoEsperado,
            saldoContado: valorContado !== "" ? valorContadoNum : undefined,
            observacao: observacao.trim(),
            payload: {
              ledger,
              saldoInicial: caixa.saldoInicial,
              // Autoritativos (vendas ativas + operações do servidor) — sem canceladas.
              totalEntradas: entradas,
              totalSaidas: saidas,
              dataAberturaReal: caixa.dataAbertura?.toISOString() ?? null,
              // Consolidação ERP (por origem + por pagamento + totais) para o
              // comprovante de fechamento e futura impressão térmica. JSONB — sem schema novo.
              resumoFechamento: resumo,
              saldoDinheiroEsperado,
              operadores: operadoresSessao,
              terminalId,
              terminalLabel,
              // Metadado opcional (JSONB aditivo) — só quando a calculadora foi usada
              // e seu total corresponde ao valor contado aplicado. Sem schema novo.
              ...(dinheiroContadoDetalhado && valorContado !== ""
                ? { dinheiroContadoDetalhado }
                : {}),
            },
          }),
        })
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { sessao?: { fechadaEm?: string | null } }
            | null
          return { ok: true, status: res.status, fechadaEm: data?.sessao?.fechadaEm ?? null }
        }
        const errData = (await res.json().catch(() => null)) as { error?: string } | null
        return { ok: false, status: res.status, error: errData?.error }
      } catch (err: unknown) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : "Falha de rede" }
      }
    }

    // Reconciliação (Regra 5): busca a sessão ABERTA atual da loja E DESTE TERMINAL.
    // Sem o escopo de terminal, um PDV sem `sessaoId` local fechava a sessão do
    // outro PDV da mesma loja (mesma causa do F-01 da readiness 002A).
    const buscarSessaoAberta = async (): Promise<string | null> => {
      try {
        const res = await fetch(activeCaixaSessionUrl(lojaId, terminalId), {
          credentials: "include",
          cache: "no-store",
          headers: { "x-assistec-loja-id": lojaId },
        })
        if (!res.ok) return null
        const data = (await res.json()) as { sessoes?: Array<{ id: string }> }
        return data.sessoes?.[0]?.id ?? null
      } catch {
        return null
      }
    }

    setSalvando(true)
    let persisted = false
    let lastError: { status: number; error?: string } | null = null
    let fechadaEmResult: string | null = null
    let sid = sessaoId

    try {
      // Regra 5 (passo 1): sem sessaoId local → reconcilia buscando a sessão ABERTA
      // da loja. Se não houver nenhuma, tenta abertura retroativa idempotente (o guard
      // do /abrir devolve a sessão existente ou registra uma recuperável).
      if (!sid) {
        console.warn("[caixa/fechar] sessaoId ausente — reconciliando", { storeId: lojaId, terminalId })
        sid = await buscarSessaoAberta()
        if (!sid) {
          try {
            const abrirRes = await fetch("/api/ops/caixa/abrir", {
              method: "POST",
              credentials: "include",
              cache: "no-store",
              headers: { "Content-Type": "application/json", "x-assistec-loja-id": lojaId },
              body: JSON.stringify({
                saldoInicial: caixa.saldoInicial,
                observacao: "Sessão retroativa — abertura não registrada no servidor",
                ...(terminalId ? { terminalId } : {}),
              }),
            })
            if (abrirRes.ok) {
              const abrirData = (await abrirRes.json()) as { sessaoId?: string }
              sid = abrirData.sessaoId ?? null
            }
          } catch (err: unknown) {
            console.error("[caixa/fechar] abertura retroativa falhou:", err)
          }
        }
      }

      if (sid) {
        console.info("[caixa/fechar] fechando", { storeId: lojaId, sessaoId: sid, terminalId })
        let r = await postFechar(sid)
        console.info("[caixa/fechar] resposta", {
          storeId: lojaId, sessaoId: sid, terminalId, status: r.status, ok: r.ok, error: r.error,
        })

        // Regra 5 (passo 2): sessaoId inválido (404) → reconcilia e tenta UMA vez mais.
        if (!r.ok && r.status === 404) {
          const reconciliado = await buscarSessaoAberta()
          if (reconciliado && reconciliado !== sid) {
            console.warn("[caixa/fechar] sessaoId inválido — reconciliado", {
              storeId: lojaId, antigo: sid, novo: reconciliado, terminalId,
            })
            sid = reconciliado
            r = await postFechar(sid)
            console.info("[caixa/fechar] resposta (retry)", {
              storeId: lojaId, sessaoId: sid, terminalId, status: r.status, ok: r.ok, error: r.error,
            })
          }
        }

        if (r.ok) {
          persisted = true
          fechadaEmResult = r.fechadaEm ?? null
        } else {
          lastError = { status: r.status, error: r.error }
        }
      } else {
        console.error("[caixa/fechar] nenhuma sessão ABERTA encontrada", { storeId: lojaId, terminalId })
        lastError = { status: 0, error: "Nenhuma sessão de caixa aberta encontrada no servidor." }
      }
    } finally {
      setSalvando(false)
    }

    // ── Regras 1, 2, 3: sem confirmação do servidor → NÃO fecha localmente ──
    // Mantém o caixa aberto, a sessão e os inputs intactos para nova tentativa.
    if (!persisted) {
      const detalhe =
        lastError?.status === 404
          ? "A sessão não consta como aberta no servidor. Atualize a página e tente novamente."
          : lastError?.error
            ? `Erro do servidor: ${lastError.error}`
            : "Não foi possível confirmar o fechamento no servidor. O caixa continua ABERTO."
      toast({
        variant: "destructive",
        title: "Fechamento não concluído",
        description: detalhe,
      })
      return
    }

    // ── Sucesso confirmado pelo servidor: monta o snapshot ANTES de resetar ──
    // qualquer estado local (Regra 7 do GOAL) — o diálogo pós-fechamento depende
    // dele para o comprovante, e não deve inventar/buscar nada novo.
    const snapshot: FechamentoPosSnapshot = {
      loja: userAudit,
      sessaoId: sid,
      terminalLabel,
      operadores: operadoresSessao,
      dataAbertura: caixa.dataAbertura ? caixa.dataAbertura.toISOString() : null,
      fechadaEm: fechadaEmResult,
      saldoInicial: caixa.saldoInicial,
      totalEntradas: entradas,
      totalSaidas: saidas,
      saldoDinheiroEsperado,
      saldoMovimentadoEsperado: saldoEsperado,
      valorContado: valorContado !== "" ? valorContadoNum : null,
      diferenca: valorContado !== "" && temDiferenca ? diferenca : null,
      observacao: observacao.trim(),
      resumo,
      dinheiroContadoDetalhado: valorContado !== "" ? dinheiroContadoDetalhado : null,
    }

    if (valorContado !== "" && temDiferenca) {
      const pgAudit = resumo.porPagamento
      appendAuditLog({
        action: "quebra_caixa",
        userLabel: `${userAudit} (fechamento)`,
        detail: `Esperado ${fmt(saldoEsperado)} | Contado ${fmt(valorContadoNum)} | Diferença ${fmt(diferenca)} | Dia: Din ${fmt(pgAudit.dinheiro)} Pix ${fmt(pgAudit.pix)} Déb ${fmt(pgAudit.cartaoDebito)} Créd ${fmt(pgAudit.cartaoCredito)} Carnê ${fmt(pgAudit.carne)} Vale ${fmt(pgAudit.creditoVale)}`,
      })
    }
    if (observacao.trim()) {
      appendAuditLog({
        action: "quebra_caixa",
        userLabel: `${userAudit} (fechamento)`,
        detail: `Obs: ${observacao.trim()}`,
      })
    }

    fecharCaixa()
    setValorContado("")
    setDinheiroContadoDetalhado(null)
    setObservacao("")
    onClose()
    toast({ title: "Caixa fechado", description: "Sessão encerrada e registrada no servidor." })
    setPosFechamentoSnapshot(snapshot)
    setPosFechamentoOpen(true)
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[92vw] border-border bg-card p-0 sm:max-w-3xl">
        <div className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pb-2 pt-6">
            <DialogTitle className="flex items-center gap-3 text-xl font-bold tracking-tight text-foreground">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
                <Lock className="h-5 w-5 text-destructive" />
              </span>
              Fechamento de Caixa
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Confira os valores e conte o dinheiro em caixa antes de fechar.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <div className="space-y-4 pt-4">
              {/* Cabeçalho da sessão (operador / sessão / terminal / abertura) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <SessaoChip
                  icon={Hash}
                  label={sessaoId ? `Sessão ${sessaoId.slice(0, 10)}…` : "Sessão não registrada"}
                />
                <SessaoChip
                  icon={User}
                  label={operadoresSessao.length ? `Operador: ${operadoresSessao.join(", ")}` : "Operador: —"}
                />
                <SessaoChip icon={Monitor} label={`Terminal: ${terminalLabel}`} />
                {caixa.dataAbertura && (
                  <SessaoChip
                    icon={Clock}
                    label={`Aberto às ${caixa.dataAbertura.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                  />
                )}
              </div>

              <Tabs defaultValue="resumo">
                <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl p-1">
                  <TabsTrigger value="resumo" className="gap-2 rounded-lg">
                    <BarChart3 className="h-4 w-4" />
                    Resumo
                  </TabsTrigger>
                  <TabsTrigger value="conferencia" className="gap-2 rounded-lg">
                    <ClipboardList className="h-4 w-4" />
                    Conferência
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="conferencia" className="pt-3">
                  <ConferenciaCaixa
                    vendasSessao={vendasSessao}
                    sessionSales={sessionSales}
                    operacoesSessao={operacoesSessao}
                  />
                </TabsContent>

                <TabsContent value="resumo" className="space-y-4 pt-3">
              {/* Resumo financeiro — RECEITA TOTAL DO DIA (faturamento, separado da gaveta) */}
              <Card className="overflow-hidden border-success/25 bg-gradient-to-br from-success/10 via-success/5 to-transparent shadow-sm">
                <CardContent className="space-y-3 pt-4 pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/15">
                      <TrendingUp className="h-4 w-4 text-success" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">Resumo financeiro do dia</h3>
                      <p className="text-[11px] text-muted-foreground">
                        Vendas + serviços recebidos · não inclui abertura nem suprimentos
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Vendas de produtos</span>
                      <span className="font-medium tabular-nums text-foreground">{fmt(resumo.totalLiquido)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Serviços recebidos</span>
                      <span className="font-medium tabular-nums text-foreground">{fmt(resumo.recebimentosContas)}</span>
                    </div>
                    {resumo.outrosRecebimentos > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Outros recebimentos</span>
                        <span className="font-medium tabular-nums text-foreground">{fmt(resumo.outrosRecebimentos)}</span>
                      </div>
                    )}
                    <Separator className="bg-border" />
                    <div className="flex items-end justify-between gap-3 pt-0.5">
                      <span className="font-semibold text-foreground">Receita total do dia</span>
                      <span className="text-3xl font-bold tracking-tight tabular-nums text-success">{fmt(receitaTotalDia)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* KPIs operacionais */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiMini label="Vendas" value={String(resumo.qtdVendas)} sub="quantidade" />
                <KpiMini label="Total líquido" value={fmt(resumo.totalLiquido)} />
                <KpiMini label="Recebido" value={fmt(resumo.totalRecebido)} accent="text-success" />
                <KpiMini label="Ticket médio" value={fmt(resumo.ticketMedio)} accent="text-info" />
              </div>

              {/* Vendas por origem */}
              <Card className="bg-secondary border-border">
                <CardContent className="space-y-2 pt-4 pb-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Layers className="h-4 w-4 text-primary" />
                    Vendas por origem
                  </h3>
                  {resumo.porOrigem.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma venda nesta sessão.</p>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      {resumo.porOrigem.map((o) => (
                        <div key={o.key} className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {o.label}
                            <span className="ml-1 text-xs text-muted-foreground/70">({o.qtdItens})</span>
                          </span>
                          <span className="font-medium tabular-nums text-foreground">{fmt(o.valorBruto)}</span>
                        </div>
                      ))}
                      <Separator className="bg-border" />
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span>Subtotal bruto</span>
                        <span className="tabular-nums text-foreground">{fmt(resumo.subtotalBruto)}</span>
                      </div>
                      {resumo.descontos > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-warning">Descontos</span>
                          <span className="font-medium tabular-nums text-warning">- {fmt(resumo.descontos)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recebimentos de contas (PDV F5 — não são vendas) */}
              {resumo.qtdRecebimentosContas > 0 && (
                <Card className="bg-secondary border-border">
                  <CardContent className="space-y-2 pt-4 pb-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Wallet className="h-4 w-4 text-info" />
                      Serviços recebidos
                      {opsCarregando ? (
                        <span className="text-xs font-normal text-muted-foreground">(atualizando…)</span>
                      ) : null}
                    </h3>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Títulos recebidos ({resumo.qtdRecebimentosContas})
                        </span>
                        <span className="font-medium tabular-nums text-info">
                          {fmt(resumo.recebimentosContas)}
                        </span>
                      </div>
                      {resumo.recebimentosContasDinheiro > 0 &&
                        resumo.recebimentosContasDinheiro < resumo.recebimentosContas && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Em dinheiro (gaveta)</span>
                            <span className="font-medium tabular-nums text-foreground">
                              {fmt(resumo.recebimentosContasDinheiro)}
                            </span>
                          </div>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Baixas de Contas a Receber no PDV — não entram no total de vendas.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Formas de pagamento */}
              <Card className="bg-secondary border-border">
                <CardContent className="space-y-3 pt-4 pb-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <DollarSign className="h-4 w-4 text-primary" />
                    Formas de pagamento
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <PgtoBox icon={Banknote} label="Dinheiro" value={resumo.porPagamento.dinheiro} total={resumo.porPagamento.total} />
                    <PgtoBox icon={QrCode} label="Pix" value={resumo.porPagamento.pix} total={resumo.porPagamento.total} />
                    <PgtoBox icon={CreditCard} label="Cartão débito" value={resumo.porPagamento.cartaoDebito} total={resumo.porPagamento.total} />
                    <PgtoBox icon={CreditCard} label="Cartão crédito" value={resumo.porPagamento.cartaoCredito} total={resumo.porPagamento.total} />
                    <PgtoBox icon={Receipt} label="Carnê" value={resumo.porPagamento.carne} total={resumo.porPagamento.total} />
                    <PgtoBox icon={CalendarClock} label="A prazo (fiado)" value={resumo.porPagamento.aPrazo} total={resumo.porPagamento.total} />
                    <PgtoBox icon={Ticket} label="Crédito/Vale" value={resumo.porPagamento.creditoVale} total={resumo.porPagamento.total} />
                    <div className="flex min-w-0 flex-col justify-center gap-1 rounded-xl border border-primary/25 bg-primary/10 p-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total das vendas</span>
                      <span className="text-xl font-bold leading-none tracking-tight tabular-nums text-foreground">
                        {fmt(resumo.porPagamento.total)}
                      </span>
                    </div>
                  </div>
                  {resumo.qtdVendasMultiplas > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {resumo.qtdVendasMultiplas} venda(s) com múltiplas formas de pagamento.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Caixa (gaveta) — conferência de dinheiro físico */}
              <Card className="bg-secondary border-border">
                <CardContent className="space-y-3 pt-4 pb-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Wallet className="h-4 w-4 text-primary" />
                    Caixa (gaveta) — dinheiro físico
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Abertura</span>
                      <span className="font-medium tabular-nums text-foreground">{fmt(resumo.saldoInicial)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-success">
                        <Banknote className="h-3.5 w-3.5" />+ Dinheiro (vendas)
                      </span>
                      <span className="font-medium tabular-nums text-success">+ {fmt(resumo.porPagamento.dinheiro)}</span>
                    </div>
                    {resumo.recebimentosContasDinheiro > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-info">+ Serviços recebidos (dinheiro)</span>
                        <span className="font-medium tabular-nums text-info">
                          + {fmt(resumo.recebimentosContasDinheiro)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-success">
                        <TrendingUp className="h-3.5 w-3.5" />+ Suprimentos
                      </span>
                      <span className="font-medium tabular-nums text-success">+ {fmt(resumo.suprimentos)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-destructive">
                        <TrendingDown className="h-3.5 w-3.5" />- Sangrias
                      </span>
                      <span className="font-medium tabular-nums text-destructive">- {fmt(resumo.sangrias)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5">
                      <span className="text-sm font-semibold text-foreground">Saldo esperado em dinheiro</span>
                      <span className="text-xl font-bold tracking-tight tabular-nums text-success">{fmt(saldoDinheiroEsperado)}</span>
                    </div>
                  </div>
                  <p className="rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                    Saldo total movimentado (inclui pix/cartão):{" "}
                    <span className="font-medium tabular-nums text-foreground">{fmt(saldoEsperado)}</span>
                  </p>
                </CardContent>
              </Card>
                </TabsContent>
              </Tabs>
              {/* Contagem da gaveta — input sempre visível, independente da aba ativa */}
              <Card className="bg-secondary border-border">
                <CardContent className="space-y-4 pt-4 pb-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Calculator className="h-4 w-4 text-primary" />
                    Contagem da gaveta
                  </h3>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Dinheiro contado na gaveta</Label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">
                        R$
                      </span>
                      <Input
                        type="number"
                        placeholder="Digite o dinheiro contado..."
                        value={valorContado}
                        onChange={(e) => {
                          setValorContado(e.target.value)
                          // Edição manual invalida o detalhamento aplicado pela calculadora.
                          setDinheiroContadoDetalhado(null)
                        }}
                        className="pl-12 h-14 text-xl font-bold tabular-nums bg-background border-border"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Conferência contra o saldo esperado em dinheiro ({fmt(saldoDinheiroEsperado)}). Pix/cartão não entram na gaveta.
                    </p>
                  </div>

                  {/* Calculadora de conferência de dinheiro físico (cédulas/moedas).
                      Aplica o total no campo acima por ação explícita do operador. */}
                  <CalculadoraDinheiroCaixa
                    saldoDinheiroEsperado={saldoDinheiroEsperado}
                    onAplicar={(t, detalhe) => {
                      setValorContado(t.toFixed(2))
                      setDinheiroContadoDetalhado(detalhe)
                    }}
                  />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Observação (opcional)</Label>
                    <Input
                      placeholder="Ex.: Conferido por supervisor, sangria realizada..."
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      className="h-11 bg-background border-border"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Status da Conferência */}
              {valorContado !== "" && (
                <Card
                  className={`border ${temDiferenca ? "bg-warning/10 border-warning/30" : "bg-success/10 border-success/30"}`}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {temDiferenca ? (
                          <AlertTriangle className="w-5 h-5 text-warning" />
                        ) : (
                          <CheckCircle className="w-5 h-5 text-success" />
                        )}
                        <span className={`font-medium ${temDiferenca ? "text-warning" : "text-success"}`}>
                          {temDiferenca ? "Diferença Encontrada" : "Conferência OK"}
                        </span>
                      </div>
                      {temDiferenca && (
                        <span
                          className={`font-bold tabular-nums ${diferenca > 0 ? "text-success" : "text-destructive"}`}
                        >
                          {diferenca > 0 ? "+" : ""}
                          {fmt(diferenca)}
                        </span>
                      )}
                    </div>
                    {temDiferenca && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {diferenca > 0
                          ? "Há dinheiro a mais no caixa. Verifique se houve entrada não registrada."
                          : "Há dinheiro faltando no caixa. Verifique se houve saída não registrada."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 shrink-0 border-t border-border bg-card px-6 py-4">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="h-12 flex-1 border-border gap-2"
                  onClick={handleImprimirRelatorio}
                >
                  <Printer className="h-4 w-4" />
                  Imprimir relatório
                </Button>
                <Button
                  variant="outline"
                  className="h-12 flex-1 border-border gap-2"
                  onClick={() => void handleCopiarRelatorio()}
                >
                  <Copy className="h-4 w-4" />
                  Copiar resumo
                </Button>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-12 flex-1 border-border"
                  disabled={salvando}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleFecharCaixa}
                  disabled={salvando}
                  className="h-12 flex-1 bg-destructive font-semibold text-destructive-foreground hover:bg-destructive/90"
                >
                  <Lock className="mr-2 h-4 w-4" />
                  {salvando ? "Salvando..." : "Confirmar Fechamento"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <FechamentoPosFechamentoDialog
      open={posFechamentoOpen}
      onOpenChange={setPosFechamentoOpen}
      snapshot={posFechamentoSnapshot}
    />
    </>
  )
}

function KpiMini({
  label,
  value,
  sub,
  accent = "text-foreground",
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-base font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

/**
 * Box de forma de pagamento — ícone em chip, valor em destaque e barra com a
 * participação da forma no total. Formas zeradas ficam esmaecidas (mas visíveis,
 * para o operador confirmar que não houve recebimento naquela forma).
 */
function PgtoBox({
  icon: Icon,
  label,
  value,
  total,
}: {
  icon: LucideIcon
  label: string
  value: number
  total: number
}) {
  const ativo = value > 0.001
  const pct = ativo && total > 0.001 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div
      className={cn(
        "min-w-0 space-y-1.5 rounded-xl border p-3",
        ativo ? "border-border bg-background/70 shadow-sm" : "border-border/50 bg-background/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
              ativo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className={cn("truncate text-xs font-medium", ativo ? "text-muted-foreground" : "text-muted-foreground/50")}>
            {label}
          </span>
        </span>
        {ativo && (
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">{pct}%</span>
        )}
      </div>
      <p
        className={cn(
          "truncate text-lg font-bold leading-none tracking-tight tabular-nums",
          ativo ? "text-foreground" : "text-muted-foreground/40",
        )}
      >
        {fmt(value)}
      </p>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Chip do cabeçalho da sessão (sessão / operador / terminal / abertura). */
function SessaoChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground/70" />
      <span className="truncate">{label}</span>
    </span>
  )
}
