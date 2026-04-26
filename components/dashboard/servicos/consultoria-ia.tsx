"use client"

import { useMemo, useRef, useState } from "react"
import { ClipboardCopy, Headphones, Mic, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"

type Result = {
  diagnosticoTecnico: string
  listaDePecas: string[]
  mensagemWhatsAppStatus: string
  perguntasDeConfirmacao: string[]
}

type Props = {
  /** Quando fornecido, habilita aplicar direto na Ordem de Serviço. */
  osId?: string | null
  /** Loja atual (header x-assistec-loja-id). */
  lojaId?: string
}

export function ConsultoriaIA({ osId, lojaId }: Props) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcript, setTranscript] = useState("")
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)

  const canSend = useMemo(() => !!audioFile || !!transcript.trim(), [audioFile, transcript])

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: "Copiado", description: label })
    } catch {
      toast({ title: "Falha ao copiar", description: "Copie manualmente.", variant: "destructive" })
    }
  }

  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith("audio/") && !f.name.toLowerCase().endsWith(".webm")) {
      toast({ title: "Arquivo inválido", description: "Envie um áudio (mp3, wav, m4a, webm).", variant: "destructive" })
      return
    }
    setAudioFile(f)
  }

  const handleProcess = async () => {
    if (!canSend) {
      toast({ title: "Envie um áudio ou transcrição", description: "Para iniciar a consultoria.", variant: "destructive" })
      return
    }
    setBusy(true)
    setResult(null)
    setStage("Transcrevendo reunião…")
    setProgress(18)
    try {
      let res: Response
      if (audioFile) {
        const fd = new FormData()
        fd.set("audio", audioFile)
        if (transcript.trim()) fd.set("transcript", transcript.trim())
        res = await fetch("/api/marketing/consultoria", { method: "POST", credentials: "include", body: fd })
      } else {
        res = await fetch("/api/marketing/consultoria", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: transcript.trim() }),
        })
      }
      setStage("Extraindo diagnóstico e peças…")
      setProgress(62)
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        result?: Result
        error?: string
        message?: string
        creditsRemaining?: number
      }
      if (res.status === 402 || j.error === "sem_creditos") {
        toast({
          title: "Sem créditos",
          description: j.message || "Recarregue créditos para continuar.",
          variant: "destructive",
        })
        return
      }
      if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`)
      const r = j.result
      if (!r || !r.diagnosticoTecnico) throw new Error("Resposta vazia.")
      setResult(r)
      setStage("Pronto")
      setProgress(100)
      toast({ title: "Consultoria pronta", description: "Laudo + peças + WhatsApp gerados." })
    } catch (e) {
      toast({
        title: "Falha na consultoria",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
      setStage("Falha")
      setProgress(0)
    } finally {
      setBusy(false)
    }
  }

  const handleApplyToOs = async () => {
    const id = String(osId || "").trim()
    const loja = String(lojaId || "").trim()
    if (!id || !loja) {
      toast({ title: "O.S. não vinculada", description: "Abra uma O.S. em modo edição para aplicar automaticamente.", variant: "destructive" })
      return
    }
    if (!result) {
      toast({ title: "Sem resultado", description: "Processe a consultoria antes de aplicar.", variant: "destructive" })
      return
    }
    setApplyBusy(true)
    try {
      // 1) busca a OS atual para reaproveitar campos obrigatórios do PATCH
      const get = await fetch(`/api/ordens-servico/${encodeURIComponent(id)}`, {
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-assistec-loja-id": loja },
      })
      const gj = (await get.json().catch(() => ({}))) as { ordem?: any; error?: string }
      if (!get.ok) throw new Error(gj.error || `HTTP ${get.status}`)
      const ordem = gj.ordem
      if (!ordem?.id) throw new Error("O.S. não encontrada.")

      const payload = {
        clienteId: ordem.cliente?.id || ordem.clienteId,
        equipamento: ordem.equipamento,
        defeito: ordem.defeito,
        laudoTecnico: result.diagnosticoTecnico,
        valorBase: ordem.valorBase ?? 0,
        itens: Array.isArray(ordem.itens)
          ? ordem.itens.map((it: any) => ({ produtoId: it?.produto?.id || it?.produtoId, quantidade: it?.quantidade })).filter((x: any) => x.produtoId)
          : [],
        // “pecasNecessarias”: como não existe coluna first-class na OS, persistimos no payload JSON.
        payload: {
          ...(ordem.payload && typeof ordem.payload === "object" ? ordem.payload : {}),
          pecasNecessarias: result.listaDePecas,
        },
      }

      // 2) aplica PATCH
      const patch = await fetch(`/api/ordens-servico/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-assistec-loja-id": loja },
        body: JSON.stringify(payload),
      })
      const pj = (await patch.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!patch.ok) throw new Error(pj.error || `HTTP ${patch.status}`)

      toast({ title: "Aplicado na O.S.", description: "Laudo técnico e peças necessárias foram preenchidos automaticamente." })
    } catch (e) {
      toast({ title: "Falha ao aplicar", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-blue-600" />
            Brain-IA · Consultoria Técnica
          </CardTitle>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
            Reuniões e laudos
          </span>
        </div>
        <p className="text-sm text-slate-600">
          Suba um áudio de conversa com o cliente (ou transcrição). A IA extrai diagnóstico, peças e mensagem de status (WhatsApp).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Áudio (opcional)</Label>
            <div className="flex gap-2">
              <Input ref={fileRef} type="file" accept="audio/*" onChange={onPickAudio} className="cursor-pointer" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAudioFile(null)
                  if (fileRef.current) fileRef.current.value = ""
                }}
              >
                Limpar
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              {audioFile ? (
                <span className="inline-flex items-center gap-2">
                  <Headphones className="h-3.5 w-3.5" />
                  {audioFile.name}
                </span>
              ) : (
                "Se houver OPENAI_API_KEY, o sistema transcreve automaticamente."
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-slate-600">Transcrição (opcional)</Label>
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={5}
              placeholder="Cole aqui um resumo do que foi dito na bancada / pelo cliente…"
              className="border-slate-200 bg-white text-slate-800"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Progress value={progress} className="h-2 bg-slate-200 [&_[data-slot=progress-indicator]]:bg-blue-600" />
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <span>{stage || "Pronto para processar"}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void handleProcess()} disabled={busy} className="bg-blue-600 text-white hover:bg-blue-500">
            <Mic className="mr-2 h-4 w-4" />
            {busy ? "Processando…" : "Processar consultoria"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleApplyToOs()}
            disabled={busy || applyBusy || !osId || !lojaId || !result}
          >
            {applyBusy ? "Aplicando…" : "Vincular e Aplicar na O.S."}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTranscript("")
              setAudioFile(null)
              setResult(null)
              setStage("")
              setProgress(0)
              if (fileRef.current) fileRef.current.value = ""
            }}
          >
            Resetar
          </Button>
        </div>

        {result ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">Diagnóstico técnico</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(result.diagnosticoTecnico, "Diagnóstico copiado")}>
                  <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700">{result.diagnosticoTecnico}</pre>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">Lista de peças</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy((result.listaDePecas || []).join("\n"), "Lista de peças copiada")}
                >
                  <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
              <ul className="mt-2 space-y-1 text-[11px] text-slate-700">
                {(result.listaDePecas || []).length ? (
                  result.listaDePecas.map((p, idx) => <li key={idx}>- {p}</li>)
                ) : (
                  <li className="text-slate-500">Sem peças claras — revise a transcrição.</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">Ação WhatsApp</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copy(result.mensagemWhatsAppStatus, "Mensagem WhatsApp copiada")}
                >
                  <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
                  Copiar
                </Button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700">{result.mensagemWhatsAppStatus}</pre>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

