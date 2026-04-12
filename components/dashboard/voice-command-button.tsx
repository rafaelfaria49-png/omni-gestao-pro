"use client"

import { Mic, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRef, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { parseVoiceIntent, type VoiceIntent } from "@/lib/voice-intents"
import {
  disposeSpeechRecognition,
  getSpeechRecognitionConstructor,
  humanizeSpeechError,
  isBenignSpeechError,
  logSpeechRecognitionError,
  logVoiceEnvironmentOnce,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionInstance,
} from "@/lib/web-speech-recognition"

interface VoiceCommandButtonProps {
  /** Disparado após reconhecer um intent mapeado. Pode ser assíncrono (ex.: checagem de assinatura). */
  onIntent: (intent: VoiceIntent) => void | Promise<void>
  /** Atalho visual: nova venda rápida (sem voz). */
  onQuickSale?: () => void
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous?: boolean
  onresult: ((event: any) => void) | null
  onerror: ((event: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

const UNMAPPED_TOAST =
  "Comando não mapeado. Tente: 'Nova Venda' ou 'Ver Estoque'"

export function VoiceCommandButton({ onIntent, onQuickSale }: VoiceCommandButtonProps) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const { toast } = useToast()

  const executeVoiceCommand = (text: string) => {
    const intent = parseVoiceIntent(text)
    if (!intent) {
      toast({
        title: "Comando de voz",
        description: UNMAPPED_TOAST,
        duration: 4500,
      })
      return
    }
    void Promise.resolve(onIntent(intent)).catch(() => {
      toast({
        title: "Comando de voz",
        description: "Não foi possível executar o comando agora.",
        duration: 4000,
      })
    })
  }

  const resetMicState = () => {
    disposeSpeechRecognition(recognitionRef.current as SpeechRecognitionInstance | null)
    recognitionRef.current = null
    setIsListening(false)
  }

  const handleVoiceClick = () => {
    logVoiceEnvironmentOnce()
    const SR = getSpeechRecognitionConstructor()
    if (!SR) {
      toast({
        title: "Voz indisponível",
        description: "Seu navegador não suporta reconhecimento de voz.",
      })
      return
    }

    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (err) {
        console.error("[OmniGestão Voice] VoiceCommandButton stop()", err)
        resetMicState()
      }
      return
    }

    resetMicState()

    const recognition = new SR() as unknown as SpeechRecognitionInstance & SpeechRecognitionLike
    recognition.lang = "pt-BR"
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false

    recognition.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript || ""
      executeVoiceCommand(text)
    }

    recognition.onerror = (ev: Event) => {
      logSpeechRecognitionError("VoiceCommandButton.onerror", ev)
      const code = (ev as SpeechRecognitionErrorEventLike).error
      recognitionRef.current = null
      setIsListening(false)
      if (isBenignSpeechError(code)) return
      toast({
        title: "Voz",
        description: humanizeSpeechError(code),
        duration: 5000,
        variant: "destructive",
      })
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setIsListening(false)
    }

    recognitionRef.current = recognition
    setIsListening(true)

    try {
      recognition.start()
    } catch (err) {
      console.error("[OmniGestão Voice] VoiceCommandButton recognition.start()", err)
      resetMicState()
      toast({
        title: "Voz",
        description:
          "Não foi possível iniciar o microfone. Aguarde um segundo e tente de novo (evite cliques duplos).",
        variant: "destructive",
        duration: 5000,
      })
    }
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-6">
      <Button
        size="lg"
        onClick={handleVoiceClick}
        className={`
          relative h-14 px-6 rounded-full font-semibold text-base
          bg-primary hover:bg-primary/90 text-primary-foreground
          shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30
          transition-all duration-300
          ${isListening ? "animate-pulse ring-4 ring-primary/30" : ""}
        `}
      >
        <div
          className={`
          absolute inset-0 rounded-full bg-primary/50
          ${isListening ? "animate-ping" : "hidden"}
        `}
        />
        <Mic className={`w-5 h-5 mr-3 ${isListening ? "animate-bounce" : ""}`} />
        <span>{isListening ? "Ouvindo..." : "Novo Comando de Voz"}</span>
      </Button>

      <Button
        size="lg"
        variant="outline"
        onClick={onQuickSale}
        className="h-14 px-6 rounded-full font-semibold text-base border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
      >
        <ShoppingBag className="w-5 h-5 mr-3" />
        <span>Nova Venda Rápida</span>
      </Button>
    </div>
  )
}
