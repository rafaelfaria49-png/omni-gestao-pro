"use client"

import { useRef, useState } from "react"
import { Mic, Sparkles, Loader2, Settings2, Lock } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import type { PlanoAssinatura } from "@/services/ai-orchestrator"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { mestreModelPolicy } from "@/lib/ai-model-policy"
import { AI_MODELS_MOSAIC } from "@/lib/ai-models-list"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  disposeSpeechRecognition,
  getSpeechRecognitionConstructor,
  humanizeSpeechError,
  logSpeechRecognitionError,
  logVoiceEnvironmentOnce,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionInstance,
} from "@/lib/web-speech-recognition"

export function AiMestreCommandBar() {
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  /** Incrementado a cada nova sessão de voz — evita que onerror/onend de sessões antigas alterem o estado após re-render ou novo start(). */
  const voiceSessionGenRef = useRef(0)
  /** Texto acumulado na sessão de voz; o envio ocorre só em `onend` (fim do reconhecimento). */
  const voiceLastHeardRef = useRef("")
  const { toast } = useToast()
  const { config } = useConfigEmpresa()
  const planoRaw = config.assinatura.plano as PlanoAssinatura
  const { lojaAtivaId, opsStorageKey } = useLojaAtiva()
  const lojaId = (lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey) ?? LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID
  const { settings, blob, save } = useStoreSettings()
  const plano = (blob.planoAssinaturaOverride || planoRaw) as PlanoAssinatura
  const policy = mestreModelPolicy(plano)
  const selectedModel = (blob.aiMestreModel || "").trim() || policy.model
  const modelLabel = (id: string) => AI_MODELS_MOSAIC.find((m) => m.id === id)?.label || id

  const runOrchestrator = async (cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed) {
      toast({ title: "Digite ou fale um comando", variant: "destructive" })
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/ai/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
        body: JSON.stringify({
          command: trimmed,
          plano,
          lojaId,
          // Básico: servidor trava o modelo. Ouro: respeita o modelo escolhido (lista permitida).
          model: plano === "ouro" ? selectedModel : undefined,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
        decision?: { label: string; provider: string }
        blockedReason?: string
        integration?: { llmConfigured?: boolean; backend?: string | null; stockRowsLoaded?: boolean; fallbackUsed?: boolean }
      }
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Falha na requisição")
      }
      toast({
        title: data.ok ? `IA Mestre → ${data.decision?.label ?? "OK"}` : "Recurso Premium",
        description: data.message ?? "",
        variant: data.ok ? "default" : "destructive",
        duration: 7000,
      })
      setText("")
    } catch (e) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const startVoice = () => {
    logVoiceEnvironmentOnce()
    const SR = getSpeechRecognitionConstructor()
    if (!SR) {
      toast({ title: "Voz indisponível", description: "Use Chrome ou Edge.", variant: "destructive" })
      return
    }

    if (listening && recognitionRef.current) {
      voiceSessionGenRef.current += 1
      try {
        recognitionRef.current.stop()
      } catch (err) {
        console.error("[OmniGestão Voice] AiMestre stop()", err)
        disposeSpeechRecognition(recognitionRef.current)
        recognitionRef.current = null
        setListening(false)
      }
      return
    }

    disposeSpeechRecognition(recognitionRef.current)
    recognitionRef.current = null

    voiceSessionGenRef.current += 1
    const sessionGen = voiceSessionGenRef.current
    voiceLastHeardRef.current = ""

    const rec = new SR() as SpeechRecognitionInstance
    rec.lang = "pt-BR"
    rec.continuous = false
    /** Atualiza o campo enquanto fala; o envio automático é só em `onend` (quando o motor encerra a sessão). */
    rec.interimResults = true
    rec.maxAlternatives = 1

    setListening(true)

    rec.onresult = (e: Event) => {
      if (sessionGen !== voiceSessionGenRef.current) return
      const ev = e as SpeechRecognitionEventLike
      let full = ""
      for (let i = 0; i < ev.results.length; i++) {
        full += ev.results[i]?.[0]?.transcript ?? ""
      }
      const display = full.trim()
      if (display) {
        voiceLastHeardRef.current = display
        setText(display)
      }
    }

    rec.onerror = (ev: Event) => {
      logSpeechRecognitionError("AiMestreCommandBar.onerror", ev)
      if (sessionGen !== voiceSessionGenRef.current) return
      const code = (ev as SpeechRecognitionErrorEventLike).error
      voiceLastHeardRef.current = ""
      disposeSpeechRecognition(rec)
      recognitionRef.current = null
      setListening(false)
      const label = code ? `${humanizeSpeechError(code)} (código: ${code})` : "Erro desconhecido no reconhecimento."
      toast({
        title: "Microfone / reconhecimento de voz",
        description: label,
        variant: "destructive",
        duration: 8000,
      })
    }

    rec.onend = () => {
      if (sessionGen !== voiceSessionGenRef.current) return
      recognitionRef.current = null
      setListening(false)
      const pending = voiceLastHeardRef.current.trim()
      voiceLastHeardRef.current = ""
      if (pending) {
        setText(pending)
        void runOrchestrator(pending)
      }
    }

    recognitionRef.current = rec

    // Evita corrida com o batch do React e o "InvalidStateError" ao chamar start() no mesmo tick do dispose anterior.
    queueMicrotask(() => {
      if (sessionGen !== voiceSessionGenRef.current) return
      if (recognitionRef.current !== rec) return
      try {
        rec.start()
      } catch (err) {
        console.error("[OmniGestão Voice] AiMestreCommandBar recognition.start()", err)
        disposeSpeechRecognition(rec)
        recognitionRef.current = null
        setListening(false)
        toast({
          title: "Microfone",
          description:
            err instanceof Error
              ? `Não foi possível iniciar: ${err.message}`
              : "Não foi possível iniciar o reconhecimento. Aguarde um instante e tente novamente.",
          variant: "destructive",
        })
      }
    })
  }

  return (
    <div
      className="pointer-events-none fixed top-16 left-0 right-0 z-40 flex justify-center px-3 md:px-4"
      role="search"
      aria-label="Comando único IA Mestre"
    >
      <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-3 py-2 shadow-lg shadow-primary/10 backdrop-blur-md">
        <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div>
          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="rounded-full" title="Modelo da IA Mestre">
                <Settings2 className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
              {plano === "ouro" ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium">Modelo da IA Mestre</div>
                  <Select
                    value={selectedModel}
                    onValueChange={(v) => {
                      const next = String(v || "").trim()
                      void save({
                        printerConfig: {
                          ...(settings?.printerConfig && typeof settings.printerConfig === "object"
                            ? (settings.printerConfig as any)
                            : {}),
                          aiMestreModel: next,
                        },
                      })
                    }}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Selecione um modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {policy.options.map((m) => (
                        <SelectItem key={m} value={m}>
                          {modelLabel(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">Selecionado: {modelLabel(selectedModel)}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Lock className="h-4 w-4" aria-hidden />
                    Seleção de modelos é Premium (Ouro)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    No Bronze/Prata o backend força modelos rápidos e baratos para manter o custo baixo.
                  </div>
                  <div className="max-h-48 overflow-auto rounded-md border p-2">
                    <ul className="space-y-1 text-xs">
                      {AI_MODELS_MOSAIC.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">{m.label}</span>
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runOrchestrator(text)
          }}
          placeholder="Pergunte à IA Mestre (suporte, imagem, vídeo, música, pesquisa…)"
          className="h-10 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          disabled={loading}
        />
        <Button
          type="button"
          size="icon"
          variant={listening ? "secondary" : "ghost"}
          className="shrink-0 rounded-full"
          disabled={loading}
          onClick={startVoice}
          title="Falar comando"
        >
          {listening ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Button
          type="button"
          size="sm"
          className="shrink-0 rounded-full"
          disabled={loading || !text.trim()}
          onClick={() => void runOrchestrator(text)}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}
        </Button>
      </div>
    </div>
  )
}
