"use client"

import { useEffect, useMemo, useState } from "react"
import { MessageCircle, Smartphone, RefreshCw, CheckCircle2, XCircle, Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { type OrdemServico, getNextNumeroOS } from "@/components/dashboard/os/ordens-servico"
import { parseVoiceIntent, voiceNormalize } from "@/lib/voice-intents"
import { useOperationsStore } from "@/lib/operations-store"
import { appendAuditLog } from "@/lib/audit-log"

type ConnectionStatus = "disconnected" | "connecting" | "connected"

export function WhatsAppConnection() {
  const { config } = useConfigEmpresa()
  const {
    inventory,
    ordens,
    setOrdens,
    caixa,
    finalizeSaleTransaction,
    incrementOsAbertasDia,
  } = useOperationsStore()
  const [status, setStatus] = useState<ConnectionStatus>("disconnected")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [audioTranscript, setAudioTranscript] = useState("")
  const [botReply, setBotReply] = useState("")
  const [activities, setActivities] = useState<string[]>([
    "QR Code gerado para conexão.",
    "Robô iniciado e aguardando autenticação.",
  ])
  const operador = useMemo(() => {
    const nome = config.empresa.nomeFantasia.trim()
    return nome ? nome.split(" ")[0] : "Rafael"
  }, [config.empresa.nomeFantasia])

  useEffect(() => {
    const onDailyReport = () => {
      setActivities((prev) => [
        `Resumo de fechamento diário gerado para envio ao WhatsApp (${new Date().toLocaleTimeString("pt-BR")}).`,
        ...prev,
      ])
    }
    window.addEventListener("assistec-daily-report", onDailyReport)
    return () => window.removeEventListener("assistec-daily-report", onDailyReport)
  }, [])

  const handleRefresh = () => {
    setIsRefreshing(true)
    setStatus("connecting")
    setActivities((prev) => [
      `QR atualizado em ${new Date().toLocaleTimeString("pt-BR")}.`,
      ...prev,
    ])
    setTimeout(() => {
      setIsRefreshing(false)
      // Simula tentativa de conexão
      setStatus("connected")
      setActivities((prev) => [
        `Sessão conectada em ${new Date().toLocaleTimeString("pt-BR")}.`,
        ...prev,
      ])
    }, 2000)
  }

  const handleDisconnect = () => {
    setStatus("disconnected")
    setActivities((prev) => [
      `Sessão desconectada em ${new Date().toLocaleTimeString("pt-BR")}.`,
      ...prev,
    ])
  }

  const formatBrl = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)

  const handleProcessAudio = () => {
    if (status !== "connected") return
    const transcript = audioTranscript.trim()
    if (!transcript) return
    const intent = parseVoiceIntent(transcript)
    if (!intent) {
      const msg = `Comando não mapeado recebido: "${transcript}".`
      setActivities((prev) => [msg, ...prev])
      setBotReply("Comando não mapeado. Tente: 'Nova Venda' ou 'Ver Estoque'.")
      return
    }

    if (intent.kind === "pdv_sale") {
      const normalizedItem = voiceNormalize(intent.itemName || "")
      const target =
        inventory.find((i) => voiceNormalize(i.name).includes(normalizedItem) || normalizedItem.includes(voiceNormalize(i.name))) ??
        inventory.find((i) => i.stock > 0)
      const value = intent.price ?? target?.price ?? 0
      if (!target || target.stock <= 0) {
        setActivities((prev) => [`Venda não registrada: sem estoque ou produto não encontrado.`, ...prev])
        setBotReply("Não encontrei item com estoque para vincular à venda.")
        return
      }
      if (value <= 0) {
        setActivities((prev) => [`Venda não registrada: valor inválido.`, ...prev])
        setBotReply("Informe um preço ou escolha um produto com valor válido.")
        return
      }

      const wasCaixaFechado = !caixa.isOpen
      const userWa = `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (WhatsApp)`
      const formatBrlAudit = (n: number) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

      const result = finalizeSaleTransaction({
        lines: [{ inventoryId: target.id, quantity: 1, name: target.name, unitPrice: value }],
        total: value,
        linkedOsId: null,
        paymentBreakdown: { dinheiro: 0, pix: value, cartaoDebito: 0, cartaoCredito: 0, carne: 0, creditoVale: 0 },
        openCaixaIfClosed: true,
        saldoInicialAoAbrir: 0,
      })

      if (!result.ok) {
        setActivities((prev) => [`Venda não registrada: ${result.reason}`, ...prev])
        setBotReply(`Não foi possível finalizar: ${result.reason}`)
        return
      }

      if (wasCaixaFechado) {
        appendAuditLog({
          action: "caixa_aberto",
          userLabel: userWa,
          detail: "Abertura automática para venda via WhatsApp (saldo inicial R$ 0,00)",
        })
      }
      appendAuditLog({
        action: "sale_finalized",
        userLabel: userWa,
        detail: `Total ${formatBrlAudit(value)} | Zap (Pix) | ${target.name}`,
      })

      setActivities((prev) => [
        `Venda pelo robô Zap: ${target.name} — ${formatBrl(value)}. Caixa, estoque e faturamento do dia atualizados.`,
        ...prev,
      ])
      setBotReply(
        `Entendido, ${operador}! Venda de ${intent.itemName || target.name} (${formatBrl(value)}) registrada no mesmo fluxo do PDV.`
      )
      return
    }

    if (intent.kind === "fechar_dia") {
      void fetch("/api/whatsapp/send-daily", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: config.empresa.contato.whatsappDono || config.empresa.contato.whatsapp,
          empresaNome: config.empresa.nomeFantasia,
        }),
      })
        .then((r) => {
          if (r.ok) {
            setActivities((prev) => [`Fechamento: resumo enviado ao WhatsApp do dono.`, ...prev])
            setBotReply(`Entendido, ${operador}! Resumo do dia enviado.`)
          } else {
            setActivities((prev) => [`Fechamento: falha no envio automático. Abra o painel ou configure a API WhatsApp.`, ...prev])
            setBotReply(`Não consegui enviar pelo servidor. Verifique WHATSAPP_API_* e o número do dono.`)
          }
        })
        .catch(() => {
          setActivities((prev) => [`Fechamento: erro de rede ao enviar resumo.`, ...prev])
          setBotReply("Erro de rede ao solicitar o fechamento.")
        })
      return
    }

    if (intent.kind === "os_new") {
      const now = new Date()
      const novaOS: OrdemServico = {
        id: `wa-${Date.now()}`,
        numero: getNextNumeroOS(ordens),
        cliente: { nome: intent.clienteNome || "Cliente WhatsApp", telefone: "", cpf: "" },
        aparelho: { marca: "", modelo: "A definir", imei: "", cor: "" },
        checklist: [],
        defeito: "Aberta automaticamente via comando WhatsApp.",
        solucao: "",
        status: "em_reparo",
        dataEntrada: now.toISOString().split("T")[0],
        horaEntrada: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        dataPrevisao: "",
        dataSaida: null,
        horaSaida: null,
        valorServico: 0,
        valorPecas: 0,
        fotos: [],
        observacoes: `Origem: WhatsApp | Frase: "${transcript}"`,
        termoGarantia: "garantia_troca_tela",
        textoGarantiaEditado: "",
      }
      setOrdens((prev) => [...prev, novaOS])
      incrementOsAbertasDia()
      appendAuditLog({
        action: "os_created",
        userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (WhatsApp)`,
        detail: `OS ${novaOS.numero} — ${novaOS.cliente.nome}`,
      })
      setActivities((prev) => [`O.S. ${novaOS.numero} criada via WhatsApp para ${novaOS.cliente.nome}.`, ...prev])
      setBotReply(`Entendido, ${operador}! ${novaOS.numero} criada com sucesso para ${novaOS.cliente.nome}.`)
      return
    }

    setActivities((prev) => [`Intent ${intent.kind} processada via WhatsApp.`, ...prev])
    setBotReply(`Entendido, ${operador}! Comando "${intent.kind}" recebido e processado.`)
  }

  const statusConfig = {
    disconnected: {
      icon: XCircle,
      text: "Aguardando conexão com o Robô de Comando",
      color: "text-muted-foreground",
      bgColor: "bg-muted",
    },
    connecting: {
      icon: RefreshCw,
      text: "Conectando...",
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
    connected: {
      icon: CheckCircle2,
      text: "WhatsApp conectado com sucesso!",
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
  }

  const currentStatus = statusConfig[status]
  const StatusIcon = currentStatus.icon

  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-500/10">
            <MessageCircle className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <CardTitle className="text-lg">Conexão WhatsApp</CardTitle>
            <CardDescription>
              Integração com robô de comandos
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Explicação */}
        <div className="p-4 rounded-lg bg-secondary/50 border border-border">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-primary mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Conecte seu WhatsApp para lançar OS e Vendas via áudio ou texto
              </p>
              <p className="text-xs text-muted-foreground">
                Após conectar, você poderá enviar comandos de voz ou texto diretamente pelo WhatsApp para registrar ordens de serviço, vendas e muito mais.
              </p>
            </div>
          </div>
        </div>

        {/* QR Code Area */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-56 h-56 rounded-2xl bg-card border-2 border-dashed border-border flex items-center justify-center">
              {status === "connecting" ? (
                <RefreshCw className="w-12 h-12 text-muted-foreground animate-spin" />
              ) : status === "connected" ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-16 h-16 text-green-500" />
                  <span className="text-sm text-green-500 font-medium">Conectado</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  {/* Placeholder QR Code */}
                  <div className="w-40 h-40 bg-foreground/5 rounded-lg grid grid-cols-5 gap-1 p-2">
                    {Array.from({ length: 25 }).map((_, i) => (
                      <div
                        key={i}
                        className={`rounded-sm ${
                          Math.random() > 0.4 ? "bg-foreground/80" : "bg-transparent"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Escaneie com seu WhatsApp</p>
                </div>
              )}
            </div>
          </div>

          {/* Status */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${currentStatus.bgColor}`}>
            <StatusIcon className={`w-4 h-4 ${currentStatus.color} ${status === "connecting" ? "animate-spin" : ""}`} />
            <span className={`text-sm font-medium ${currentStatus.color}`}>
              {currentStatus.text}
            </span>
          </div>

        <div className="w-full p-3 rounded-lg border border-border bg-secondary/30">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Status da Conexão</p>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                status === "connected" ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm font-medium">
              {status === "connected" ? "Online" : "Offline"}
            </span>
          </div>
        </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar QR Code
          </Button>
          <Button
            variant="default"
            className="flex-1"
            disabled={status === "connected"}
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            Testar Conexão
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-primary/40 hover:bg-primary/10"
            onClick={handleDisconnect}
            disabled={status !== "connected"}
          >
            Desconectar Sessão
          </Button>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Simulação de áudio recebido</p>
          <Textarea
            value={audioTranscript}
            onChange={(e) => setAudioTranscript(e.target.value)}
            placeholder="Ex.: Venda de Película de R$ 25"
            className="min-h-20"
            disabled={status !== "connected"}
          />
          <div className="flex gap-2">
            <Button onClick={handleProcessAudio} disabled={status !== "connected" || !audioTranscript.trim()}>
              <Mic className="w-4 h-4 mr-2" />
              Processar Áudio
            </Button>
            <Button variant="outline" onClick={() => setAudioTranscript("")}>
              Limpar
            </Button>
          </div>
          {botReply ? (
            <p className="text-sm rounded-md bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-300 p-2">
              {botReply}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">Histórico de Atividades</h4>
          <div className="rounded-lg border border-border bg-secondary/20 p-3 max-h-40 overflow-y-auto space-y-2">
            {activities.map((activity, index) => (
              <p key={`${activity}-${index}`} className="text-xs text-muted-foreground">
                • {activity}
              </p>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-3 pt-4 border-t border-border">
          <h4 className="text-sm font-medium text-foreground">Como conectar:</h4>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">1</span>
              <span>Abra o WhatsApp no seu celular</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">2</span>
              <span>Vá em Configurações &gt; Aparelhos conectados</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">3</span>
              <span>Toque em &quot;Conectar um aparelho&quot; e escaneie o QR Code acima</span>
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
