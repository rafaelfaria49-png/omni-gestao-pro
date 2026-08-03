"use client"

import { useState } from "react"
import {
  Unlock,
  DollarSign,
  Calculator,
  CheckCircle2,
  Printer,
  Copy,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useCaixa } from "./caixa-provider"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useTerminalAtivo } from "@/lib/pdv-terminal"
import { setPdvOperadorNome } from "@/lib/pdv-operador-nome"
import { appendAuditLog } from "@/lib/audit-log"
import { useToast } from "@/hooks/use-toast"
import { escapeHtml, openThermalHtmlPrint } from "@/lib/thermal-print"
import { useOperationsStore, type InventoryItem } from "@/lib/operations-store"
import {
  decideAberturaCaixa,
  type AberturaCaixaServerResponse,
} from "@/lib/pdv-caixa-session"

/** Número de itens com divergência de estoque que dispara o toast de aviso. */
const STOCK_DIFF_THRESHOLD = 3
/** Diferença em unidades em um único item que dispara o toast, independente do count. */
const STOCK_BIG_DIFF_UNITS = 10

interface AberturaCaixaModalProps {
  isOpen: boolean
  onClose: () => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

const fmtDateTime = (d: Date) =>
  d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

const RECEIPT_TITLE = "COMPROVANTE DE ABERTURA DE CAIXA"

export function AberturaCaixaModal({ isOpen, onClose }: AberturaCaixaModalProps) {
  const { abrirCaixa, setSessaoId } = useCaixa()
  const { empresaDocumentos, lojaAtivaId } = useLojaAtiva()
  const { terminal } = useTerminalAtivo(lojaAtivaId)
  const { toast } = useToast()
  const { inventory, setInventory } = useOperationsStore()

  const [abrindo, setAbrindo] = useState(false)
  const [saldoInicial, setSaldoInicial] = useState("")
  const [observacao, setObservacao] = useState("")
  const [operador, setOperador] = useState("")
  const [step, setStep] = useState<"form" | "comprovante">("form")
  const [comprovante, setComprovante] = useState<{
    hora: string
    saldo: number
    operador: string
    loja: string
    sessaoId?: string
    observacao?: string
  } | null>(null)

  const handleQuickValue = (value: number) => {
    setSaldoInicial(value.toString())
  }

  const handleAbrirCaixa = async () => {
    setAbrindo(true)
    try {
      const valor = parseFloat(saldoInicial) || 0
      const nomeOp = operador.trim()
      const nomeLoja = (empresaDocumentos.nomeFantasia || "Loja").trim() || "Administrador"
      const agora = new Date()
      const obsTrim = observacao.trim()

      // ── 1. Registrar sessão no servidor ───────────────────────────────────
      // O servidor decide PRIMEIRO. O estado local só é marcado como aberto
      // depois de uma resposta 2xx com `sessaoId` válido.
      //
      // Antes, `abrirCaixa(valor)` rodava aqui no topo: uma falha de rede, um
      // 401/403 ou uma resposta sem `sessaoId` deixavam o cliente em
      // `isOpen: true` + `sessaoId: null` — "Caixa Aberto" na tela e toda venda
      // recusada com "Sessão de caixa inválida", virando pendência fantasma.
      // Essa é a causa produtora do incidente PDV-CAIXA-SESSION-RECOVERY.
      if (!lojaAtivaId) {
        toast({
          variant: "destructive",
          title: "Loja não identificada",
          description: "Selecione a unidade antes de abrir o caixa.",
        })
        return
      }

      let resposta: Parameters<typeof decideAberturaCaixa>[0]["resposta"]
      try {
        const res = await fetch("/api/ops/caixa/abrir", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-assistec-loja-id": lojaAtivaId,
          },
          body: JSON.stringify({
            saldoInicial: valor,
            operador: nomeOp,
            observacao: obsTrim,
            ...(terminal?.id ? { terminalId: terminal.id } : {}),
          }),
        })
        resposta = res.ok
          ? { ok: true, body: (await res.json()) as AberturaCaixaServerResponse }
          : { ok: false, reason: "http", status: res.status }
      } catch (err: unknown) {
        console.error("[caixa/abrir] server:", err)
        resposta = { ok: false, reason: "rede" }
      }

      const decisao = decideAberturaCaixa({
        saldoDigitado: valor,
        operadorDigitado: nomeOp,
        resposta,
      })

      if (decisao.action === "recusar") {
        console.error("[caixa/abrir] recusado:", decisao.reason, decisao.status ?? "")
        toast({
          variant: "destructive",
          title: "Caixa não foi aberto",
          description:
            decisao.reason === "rede"
              ? "Sem resposta do servidor. O caixa continua fechado neste dispositivo — verifique a conexão e tente de novo."
              : decisao.reason === "http"
                ? `O servidor recusou a abertura (HTTP ${decisao.status}). Nada foi alterado — tente de novo.`
                : "O servidor respondeu sem identificar a sessão. Nada foi alterado — tente de novo.",
        })
        return
      }

      // ── 2. Confirmado pelo servidor: só agora o estado local abre ─────────
      const sid = decisao.sessaoId
      const saldoConfirmado = decisao.saldoInicial
      const operadorDaSessao = decisao.operador

      abrirCaixa(saldoConfirmado)
      setSessaoId(sid)

      // Fonte oficial de EXIBIÇÃO do operador (PDV/caixa/comprovantes). Espelha o
      // que será gravado em `SessaoCaixa.operador`. Vazio → cai para a sessão.
      setPdvOperadorNome(lojaAtivaId, operadorDaSessao)

      appendAuditLog({
        action: "caixa_aberto",
        userLabel: `${nomeLoja} (sessão ${sid})`,
        detail: `Saldo inicial ${fmt(saldoConfirmado)}${operadorDaSessao ? ` | Operador: ${operadorDaSessao}` : ""}${obsTrim ? ` | Obs: ${obsTrim}` : ""}`,
      })

      if (decisao.jaEstavaAberto) {
        toast({
          title: "Caixa já estava aberto",
          description: "Recuperamos a sessão atual do servidor — use este caixa.",
        })
      }

      // ── 3. Reconciliação de estoque ────────────────────────────────────────
      if (lojaAtivaId) {
        try {
          const invRes = await fetch(
            `/api/ops/inventory?lojaId=${encodeURIComponent(lojaAtivaId)}`,
            { credentials: "include", headers: { "x-assistec-loja-id": lojaAtivaId } },
          )
          if (invRes.ok) {
            const invData = (await invRes.json()) as { items?: InventoryItem[] }
            const freshItems = invData.items ?? []
            if (freshItems.length > 0) {
              const localSnapshot = inventory
              const diffsCount = freshItems.reduce((acc, fresh) => {
                const local = localSnapshot.find((l) => l.id === fresh.id)
                return local && Math.abs(local.stock - fresh.stock) > 0 ? acc + 1 : acc
              }, 0)
              const hasBigDiff = freshItems.some((fresh) => {
                const local = localSnapshot.find((l) => l.id === fresh.id)
                return local !== undefined && Math.abs(local.stock - fresh.stock) >= STOCK_BIG_DIFF_UNITS
              })
              setInventory(freshItems)
              if (diffsCount >= STOCK_DIFF_THRESHOLD || hasBigDiff) {
                toast({
                  variant: "destructive",
                  title: "Estoque com divergências",
                  description: `${diffsCount} ite${diffsCount === 1 ? "m" : "ns"} com saldo diferente do sistema. Estoque atualizado.`,
                })
              }
            }
          } else {
            console.error("[caixa/abrir] estoque sync HTTP:", invRes.status)
          }
        } catch (err: unknown) {
          console.error("[caixa/abrir] estoque sync:", err)
        }
      }

      // Comprovante espelha o que o servidor confirmou, não o que foi digitado.
      setComprovante({
        hora: fmtDateTime(agora),
        saldo: saldoConfirmado,
        operador: operadorDaSessao,
        loja: nomeLoja,
        sessaoId: sid,
        observacao: obsTrim || undefined,
      })
      setStep("comprovante")
    } finally {
      setAbrindo(false)
    }
  }

  const handleCopiar = async () => {
    if (!comprovante) return
    const text = [
      RECEIPT_TITLE,
      `Loja: ${comprovante.loja}`,
      `Data/Hora: ${comprovante.hora}`,
      `Saldo Inicial: ${fmt(comprovante.saldo)}`,
      comprovante.operador ? `Operador: ${comprovante.operador}` : "",
      comprovante.sessaoId ? `Sessão: ${comprovante.sessaoId}` : "",
      comprovante.observacao ? `Observação: ${comprovante.observacao}` : "",
      "—",
    ]
      .filter(Boolean)
      .join("\n")
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: "Copiado!", description: "Comprovante copiado para a área de transferência." })
    } catch {
      toast({ title: "Erro", description: "Não foi possível copiar.", variant: "destructive" })
    }
  }

  const handleImprimir = () => {
    if (!comprovante) return
    const inner = `
      <div style="text-align:center;font-weight:700">${escapeHtml(RECEIPT_TITLE)}</div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <p><strong>Loja:</strong> ${escapeHtml(comprovante.loja)}</p>
      <p><strong>Data/Hora:</strong> ${escapeHtml(comprovante.hora)}</p>
      <p><strong>Saldo inicial:</strong> ${escapeHtml(fmt(comprovante.saldo))}</p>
      ${comprovante.operador ? `<p><strong>Operador:</strong> ${escapeHtml(comprovante.operador)}</p>` : ""}
      ${comprovante.sessaoId ? `<p><strong>Sessão:</strong> ${escapeHtml(comprovante.sessaoId)}</p>` : ""}
      ${comprovante.observacao ? `<p><strong>Obs.:</strong> ${escapeHtml(comprovante.observacao)}</p>` : ""}
    `
    openThermalHtmlPrint(inner, RECEIPT_TITLE)
  }

  const handleClose = () => {
    setSaldoInicial("")
    setObservacao("")
    setOperador("")
    setStep("form")
    setComprovante(null)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="flex max-h-[min(92dvh,720px)] max-w-md flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-md">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-border px-6 pb-3 pt-6 pr-14">
            <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
              {step === "comprovante" ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              ) : (
                <Unlock className="w-6 h-6 text-primary" />
              )}
              {step === "comprovante" ? "Caixa Aberto!" : "Abertura de Caixa"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {step === "comprovante"
                ? "Caixa aberto com sucesso. Guarde o comprovante abaixo."
                : "Informe o valor em dinheiro disponível para iniciar as operações do dia."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8 pt-2">
            {step === "form" ? (
              <div className="space-y-6 pt-2">
                {/* Ícone Central */}
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
                    <DollarSign className="w-10 h-10 text-primary" />
                  </div>
                </div>

                {/* Input de Valor */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Saldo Inicial do Caixa</Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">
                      R$
                    </span>
                    <Input
                      type="number"
                      placeholder="0,00"
                      value={saldoInicial}
                      onChange={(e) => setSaldoInicial(e.target.value)}
                      className="pl-12 h-14 text-2xl font-bold text-center bg-secondary border-border"
                    />
                  </div>
                </div>

                {/* Valores Rápidos */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Valores rápidos</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {[50, 100, 200, 300].map((value) => (
                      <Button
                        key={value}
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickValue(value)}
                        className="border-border hover:bg-primary hover:text-primary-foreground"
                      >
                        R$ {value}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <Card className="bg-secondary border-border">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Valor de abertura:</span>
                      </div>
                      <span className="text-xl font-bold text-primary">
                        {fmt(parseFloat(saldoInicial) || 0)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Operador</Label>
                    <Input
                      value={operador}
                      onChange={(e) => setOperador(e.target.value)}
                      placeholder="Ex.: Caixa 1 / Nome"
                      className="h-11 bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Observação (opcional)</Label>
                    <Input
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      placeholder="Ex.: Troco inicial conferido"
                      className="h-11 bg-secondary border-border"
                    />
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-muted-foreground">
                  O valor informado será usado como troco inicial para as vendas do dia.
                </p>

                {/* Botões */}
                <div className="flex gap-3 pt-1">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="flex-1 h-12 border-border"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => void handleAbrirCaixa()}
                    disabled={abrindo}
                    className="flex-1 h-12 bg-primary hover:bg-primary/90 font-semibold"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    {abrindo ? "Abrindo..." : "Abrir Caixa"}
                  </Button>
                </div>
              </div>
            ) : (
              /* ── Comprovante ── */
              <div className="space-y-5 pt-2">
                <div className="flex justify-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                </div>

                <Card className="bg-secondary border-border">
                  <CardContent className="space-y-3 pt-4 pb-4">
                    <p className="text-center text-xs font-semibold uppercase tracking-wide text-foreground">
                      {RECEIPT_TITLE}
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Loja</span>
                        <span className="font-medium">{comprovante?.loja}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data/Hora</span>
                        <span className="font-medium">{comprovante?.hora}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Saldo inicial</span>
                        <span className="text-xl font-bold text-emerald-500">
                          {fmt(comprovante?.saldo ?? 0)}
                        </span>
                      </div>
                      {comprovante?.operador && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Operador</span>
                          <span className="font-medium">{comprovante.operador}</span>
                        </div>
                      )}
                      {comprovante?.sessaoId && (
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground shrink-0">Sessão</span>
                          <span className="font-mono text-[11px] text-right break-all">{comprovante.sessaoId}</span>
                        </div>
                      )}
                      {comprovante?.observacao && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground">Observação</span>
                          <span className="font-medium text-xs leading-snug">{comprovante.observacao}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    className="h-11 gap-2 border-border"
                    onClick={handleImprimir}
                  >
                    <Printer className="w-4 h-4" />
                    Imprimir comprovante
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 gap-2 border-border"
                    onClick={() => void handleCopiar()}
                  >
                    <Copy className="w-4 h-4" />
                    Copiar resumo
                  </Button>
                </div>

                <Button onClick={handleClose} className="h-12 w-full gap-2">
                  <X className="w-4 h-4" />
                  Fechar
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
