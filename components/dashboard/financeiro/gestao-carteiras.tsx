"use client"

import { useMemo, useRef, useState } from "react"
import {
  Wallet,
  Plus,
  Pencil,
  Trash2,
  ArrowLeftRight,
  Mic,
  Send,
  Building2,
  User,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
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
import { useFinanceiro } from "@/lib/financeiro-store"
import type { Carteira, CarteiraTipo } from "@/lib/financeiro-types"
import {
  parseLancamentoCarteira,
  resolverCarteiraPorNome,
} from "@/lib/voice-financeiro-nlp"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  disposeSpeechRecognition,
  getSpeechRecognitionConstructor,
  humanizeSpeechError,
  isBenignSpeechError,
  logSpeechRecognitionError,
  logVoiceEnvironmentOnce,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionInstance,
} from "@/lib/web-speech-recognition"

const emptyForm: Omit<Carteira, "id"> = {
  nome: "",
  saldoInicial: 0,
  cor: "#6366f1",
  tipo: "empresa",
}

export function GestaoCarteiras() {
  const {
    carteiras,
    setCarteiras,
    saldoCarteira,
    adicionarMovimento,
    registrarTransferencia,
    movimentos,
  } = useFinanceiro()
  const { toast } = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Carteira | null>(null)
  const [form, setForm] = useState<Omit<Carteira, "id">>(emptyForm)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [transferOpen, setTransferOpen] = useState(false)
  const [trDe, setTrDe] = useState("")
  const [trPara, setTrPara] = useState("")
  const [trValor, setTrValor] = useState("")
  const [trObs, setTrObs] = useState("")

  const [lancTexto, setLancTexto] = useState("")
  const [carteiraPendente, setCarteiraPendente] = useState<string | null>(null)
  const [parsedPendente, setParsedPendente] = useState<ReturnType<typeof parseLancamentoCarteira> | null>(null)
  const [escolhaCarteiraOpen, setEscolhaCarteiraOpen] = useState(false)
  const voiceRecognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)

  const movimentosRecentes = useMemo(
    () =>
      [...movimentos]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 12),
    [movimentos]
  )

  const openNovo = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    setFormOpen(true)
  }

  const openEdit = (c: Carteira) => {
    setEditing(c)
    setForm({
      nome: c.nome,
      saldoInicial: c.saldoInicial,
      cor: c.cor,
      tipo: c.tipo,
    })
    setFormOpen(true)
  }

  const salvarCarteira = () => {
    const nome = form.nome.trim()
    if (!nome) {
      toast({ title: "Nome obrigatório", variant: "destructive" })
      return
    }
    if (editing) {
      setCarteiras((prev) =>
        prev.map((c) => (c.id === editing.id ? { ...c, ...form, nome } : c))
      )
      toast({ title: "Carteira atualizada" })
    } else {
      const novo: Carteira = {
        id: `cart-${Date.now()}`,
        ...form,
        nome,
      }
      setCarteiras((prev) => [...prev, novo])
      toast({ title: "Carteira criada" })
    }
    setFormOpen(false)
  }

  const confirmarDelete = () => {
    if (!deleteId) return
    setCarteiras((prev) => prev.filter((c) => c.id !== deleteId))
    toast({ title: "Carteira removida" })
    setDeleteId(null)
  }

  const executarLancamento = (
    parsed: NonNullable<ReturnType<typeof parseLancamentoCarteira>>,
    carteiraId: string
  ) => {
    adicionarMovimento({
      carteiraId,
      tipo: parsed.tipo,
      valor: parsed.valor,
      descricao: parsed.descricao,
      categoria: parsed.categoria,
    })
    toast({
      title: parsed.tipo === "entrada" ? "Entrada registrada" : "Saída registrada",
      description: `${parsed.descricao} — ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(parsed.valor)}`,
    })
    setLancTexto("")
    setParsedPendente(null)
    setCarteiraPendente(null)
    setEscolhaCarteiraOpen(false)
  }

  const processarTextoLancamento = (texto: string) => {
    const parsed = parseLancamentoCarteira(texto)
    if (!parsed) {
      toast({
        title: "Não entendi",
        description: "Informe valor em reais e o que foi gasto ou recebido. Ex.: Gastei 50 reais de gasolina na carteira Pessoal",
        variant: "destructive",
      })
      return
    }

    let carteira: Carteira | null = null
    if (parsed.carteiraMencionada) {
      carteira = resolverCarteiraPorNome(carteiras, parsed.carteiraMencionada)
    }

    if (carteira) {
      executarLancamento(parsed, carteira.id)
      return
    }

    if (parsed.carteiraMencionada) {
      toast({
        title: "Carteira não encontrada",
        description: `Nenhuma carteira parecida com "${parsed.carteiraMencionada}".`,
        variant: "destructive",
      })
      return
    }

    setParsedPendente(parsed)
    setEscolhaCarteiraOpen(true)
    toast({
      title: "Em qual carteira deseja lançar?",
      description: "Selecione a carteira abaixo.",
    })
  }

  const confirmarCarteiraEscolhida = () => {
    if (!parsedPendente || !carteiraPendente) {
      toast({ title: "Selecione uma carteira", variant: "destructive" })
      return
    }
    executarLancamento(parsedPendente, carteiraPendente)
  }

  const ouvirVoz = () => {
    logVoiceEnvironmentOnce()
    const SR = getSpeechRecognitionConstructor()
    if (!SR) {
      toast({ title: "Voz indisponível", description: "Use Chrome ou Edge.", variant: "destructive" })
      return
    }

    if (voiceListening && voiceRecognitionRef.current) {
      try {
        voiceRecognitionRef.current.stop()
      } catch (err) {
        console.error("[OmniGestão Voice] GestaoCarteiras stop()", err)
        disposeSpeechRecognition(voiceRecognitionRef.current)
        voiceRecognitionRef.current = null
        setVoiceListening(false)
      }
      return
    }

    disposeSpeechRecognition(voiceRecognitionRef.current)
    voiceRecognitionRef.current = null

    const rec = new SR() as SpeechRecognitionInstance
    rec.lang = "pt-BR"
    rec.continuous = false
    rec.interimResults = false
    setVoiceListening(true)

    rec.onresult = (e: Event) => {
      const ev = e as SpeechRecognitionEventLike
      let transcript = ""
      const start = typeof ev.resultIndex === "number" ? ev.resultIndex : 0
      for (let i = start; i < ev.results.length; i++) {
        const chunk = ev.results[i]?.[0]?.transcript
        if (chunk) transcript += chunk
      }
      const t = transcript.trim()
      if (t) {
        setLancTexto(t)
        processarTextoLancamento(t)
      }
    }
    rec.onerror = (ev: Event) => {
      logSpeechRecognitionError("GestaoCarteiras.ouvirVoz.onerror", ev)
      const code = (ev as SpeechRecognitionErrorEventLike).error
      disposeSpeechRecognition(rec)
      voiceRecognitionRef.current = null
      setVoiceListening(false)
      if (isBenignSpeechError(code)) return
      toast({
        title: "Erro no microfone",
        description: humanizeSpeechError(code),
        variant: "destructive",
      })
    }
    rec.onend = () => {
      voiceRecognitionRef.current = null
      setVoiceListening(false)
    }
    voiceRecognitionRef.current = rec

    try {
      rec.start()
    } catch (err) {
      console.error("[OmniGestão Voice] GestaoCarteiras recognition.start()", err)
      disposeSpeechRecognition(rec)
      voiceRecognitionRef.current = null
      setVoiceListening(false)
      toast({
        title: "Erro no microfone",
        description: "Não foi possível iniciar. Tente novamente em um instante.",
        variant: "destructive",
      })
    }
  }

  const transferir = () => {
    const valor = parseFloat(trValor.replace(",", "."))
    if (!trDe || !trPara || trDe === trPara || !Number.isFinite(valor) || valor <= 0) {
      toast({ title: "Preencha origem, destino e valor válidos", variant: "destructive" })
      return
    }
    const ok = registrarTransferencia(trDe, trPara, valor, trObs.trim() || undefined)
    if (!ok) {
      toast({
        title: "Transferência recusada",
        description: "Saldo insuficiente na carteira de origem.",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Transferência concluída" })
    setTransferOpen(false)
    setTrDe("")
    setTrPara("")
    setTrValor("")
    setTrObs("")
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lançamento inteligente (texto ou voz)</CardTitle>
          <CardDescription>
            Ex.: &quot;Gastei 50 reais de gasolina na carteira Pessoal&quot; ou &quot;Entrada de 200 reais na carteira
            Empresa&quot;. Se não disser a carteira, o sistema pergunta onde lançar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Textarea
              placeholder="Digite ou use o microfone…"
              value={lancTexto}
              onChange={(e) => setLancTexto(e.target.value)}
              className="min-h-[80px] bg-card"
            />
            <div className="flex sm:flex-col gap-2 shrink-0">
              <Button type="button" variant="secondary" className="gap-2" onClick={ouvirVoz}>
                <Mic className={`w-4 h-4 ${voiceListening ? "animate-pulse" : ""}`} />
                {voiceListening ? "Ouvindo…" : "Voz"}
              </Button>
              <Button
                type="button"
                className="gap-2"
                onClick={() => processarTextoLancamento(lancTexto)}
              >
                <Send className="w-4 h-4" />
                Lançar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-between items-center">
        <h2 className="text-lg font-semibold text-foreground">Carteiras</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            Transferir entre carteiras
          </Button>
          <Button onClick={openNovo}>
            <Plus className="w-4 h-4 mr-2" />
            Nova carteira
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {carteiras.map((c) => {
          const saldo = saldoCarteira(c.id)
          return (
            <Card
              key={c.id}
              className="border-border overflow-hidden"
              style={{ borderLeftWidth: 4, borderLeftColor: c.cor }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Wallet className="w-5 h-5 shrink-0 text-muted-foreground" />
                    <CardTitle className="text-base truncate">{c.nome}</CardTitle>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteId(c.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.tipo === "empresa" ? (
                    <Building2 className="w-3.5 h-3.5" />
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                  {c.tipo === "empresa" ? "Empresa" : "Pessoal"}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground tabular-nums">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(saldo)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Saldo atual (movimentos + transferências)</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Movimentos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {movimentosRecentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
            ) : (
              movimentosRecentes.map((m) => {
                const cart = carteiras.find((x) => x.id === m.carteiraId)
                return (
                  <div
                    key={m.id}
                    className="flex justify-between items-center text-sm border-b border-border/60 pb-2"
                  >
                    <div>
                      <span className={cn(m.tipo === "entrada" ? "text-green-600" : "text-red-600")}>
                        {m.tipo === "entrada" ? "+" : "−"}{" "}
                        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(m.valor)}
                      </span>
                      <span className="text-muted-foreground"> · {cart?.nome ?? "?"}</span>
                      <p className="text-muted-foreground text-xs">{m.descricao}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(m.at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar carteira" : "Nova carteira"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Saldo inicial</Label>
              <Input
                type="number"
                step="0.01"
                value={form.saldoInicial}
                onChange={(e) =>
                  setForm((f) => ({ ...f, saldoInicial: parseFloat(e.target.value) || 0 }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Cor</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  className="h-10 w-16 p-1 cursor-pointer"
                  value={form.cor}
                  onChange={(e) => setForm((f) => ({ ...f, cor: e.target.value }))}
                />
                <Input
                  value={form.cor}
                  onChange={(e) => setForm((f) => ({ ...f, cor: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as CarteiraTipo }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empresa">Empresa</SelectItem>
                  <SelectItem value="pessoal">Pessoal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={salvarCarteira}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir entre carteiras</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>De</Label>
              <Select value={trDe} onValueChange={setTrDe}>
                <SelectTrigger>
                  <SelectValue placeholder="Origem" />
                </SelectTrigger>
                <SelectContent>
                  {carteiras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} ({new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(saldoCarteira(c.id))})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Para</Label>
              <Select value={trPara} onValueChange={setTrPara}>
                <SelectTrigger>
                  <SelectValue placeholder="Destino" />
                </SelectTrigger>
                <SelectContent>
                  {carteiras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input value={trValor} onChange={(e) => setTrValor(e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1">
              <Label>Observação (opcional)</Label>
              <Input value={trObs} onChange={(e) => setTrObs(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={transferir}>Transferir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={escolhaCarteiraOpen} onOpenChange={setEscolhaCarteiraOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Em qual carteira deseja lançar?</DialogTitle>
          </DialogHeader>
          <Select value={carteiraPendente ?? ""} onValueChange={setCarteiraPendente}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {carteiras.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscolhaCarteiraOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarCarteiraEscolhida}>Confirmar lançamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir carteira?</AlertDialogTitle>
            <AlertDialogDescription>
              Os lançamentos ficam no histórico; a carteira some da lista. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
