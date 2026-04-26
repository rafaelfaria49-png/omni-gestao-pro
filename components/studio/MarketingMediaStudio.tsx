"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Clapperboard,
  Image as ImageIcon,
  Mic2,
  Sparkles,
  UserRound,
  Video,
  Volume2,
  Wand2,
  CheckCircle2,
  Circle,
  Upload,
  Instagram,
  Globe2,
  Facebook,
  Music,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { cn } from "@/lib/utils"
import type { BrandVoiceProfile, GrowthPackV2, MarketingContentTab } from "@/lib/marketing-growth-pack"
import { MarketingMediaWaveform } from "@/components/studio/MarketingMediaWaveform"
import { AutomacaoAgendamento } from "@/components/studio/AutomacaoAgendamento"
import { MascoteStudio } from "@/components/studio/MascoteStudio"

export type PremiumVoiceKind = "especialista" | "vendedor" | "atendente"
export type VideoStyleKind = "cinematic" | "produto" | "avatar"
export type ImageAssistStyleKind = "realismo" | "banner" | "personagem3d"
export type ImageFormatKind = "square" | "vertical" | "wide"
export type VideoVibeKind = "tecnico" | "venda" | "urgencia"

type Props = {
  pack: GrowthPackV2
  classic: boolean
  lojaId: string
  initialTextSource: MarketingContentTab
  brandVoice: BrandVoiceProfile
}

export function MarketingMediaStudio({ pack, classic, lojaId, initialTextSource, brandVoice }: Props) {
  const { toast } = useToast()
  const [studioSection, setStudioSection] = useState<"criacao" | "calendario" | "performance">("criacao")
  const [credits, setCredits] = useState<number | null>(null)
  const [textSource, setTextSource] = useState<MarketingContentTab>(initialTextSource)
  const [voiceKind, setVoiceKind] = useState<PremiumVoiceKind>("especialista")
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  // Pode ser útil futuramente para auto-play / seek com waveform real.
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [videoStyle, setVideoStyle] = useState<VideoStyleKind>("cinematic")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoMockReady, setVideoMockReady] = useState(false)

  const [videoVibe, setVideoVibe] = useState<VideoVibeKind>("tecnico")
  const [captionsEnabled, setCaptionsEnabled] = useState(true)
  const [captionIdx, setCaptionIdx] = useState(0)

  const [timelineStep, setTimelineStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0)
  const [timelineFiles, setTimelineFiles] = useState<Array<File | null>>([null, null, null, null, null, null])
  const [timelinePreviews, setTimelinePreviews] = useState<Array<string | null>>([null, null, null, null, null, null])
  const [channels, setChannels] = useState<{ instagram: boolean; tiktok: boolean; facebook: boolean; gmb: boolean }>({
    instagram: true,
    tiktok: true,
    facebook: true,
    gmb: true,
  })

  const [reviewText, setReviewText] = useState("")
  const [reviewReply, setReviewReply] = useState("")
  const [reviewBusy, setReviewBusy] = useState(false)

  const [avatarMode, setAvatarMode] = useState<"photo" | "preset">("photo")
  const [avatarPhotoFile, setAvatarPhotoFile] = useState<File | null>(null)
  const [avatarPhotoPreview, setAvatarPhotoPreview] = useState<string | null>(null)
  const [avatarPreset, setAvatarPreset] = useState<"3d" | "realista">("realista")
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarStage, setAvatarStage] = useState<string>("")
  const [avatarProgress, setAvatarProgress] = useState<number>(0)
  const [avatarVideoUrl, setAvatarVideoUrl] = useState<string | null>(null)

  const [imagePrompt, setImagePrompt] = useState("")
  const [imageAssistStyle, setImageAssistStyle] = useState<ImageAssistStyleKind>("realismo")
  const [imageFormat, setImageFormat] = useState<ImageFormatKind>("square")
  const [imageBusy, setImageBusy] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<
    Array<{
      id: string
      url: string
      prompt: string
      style: ImageAssistStyleKind
      format: ImageFormatKind
      createdAt: number
      pending?: boolean
    }>
  >([])

  const [cloneOpen, setCloneOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    setTextSource(initialTextSource)
  }, [initialTextSource])

  const refreshCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/media-credits", {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
      })
      const j = (await res.json().catch(() => ({}))) as { credits?: number }
      if (res.ok && typeof j.credits === "number") setCredits(j.credits)
    } catch {
      setCredits(null)
    }
  }, [lojaId])

  useEffect(() => {
    void refreshCredits()
  }, [refreshCredits])

  const refreshImageGallery = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/image", {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        images?: Array<{
          id: string
          url: string
          prompt?: string
          style?: string
          format?: string
          createdAt?: string
        }>
      }
      if (!res.ok || !j || !Array.isArray(j.images)) return
      const parsed = j.images
        .map((it) => {
          if (!it || typeof it.url !== "string" || !it.url) return null
          const style = (it.style as ImageAssistStyleKind) || "realismo"
          const format = (it.format as ImageFormatKind) || "square"
          return {
            id: String(it.id),
            url: String(it.url),
            prompt: typeof it.prompt === "string" ? it.prompt : "",
            style: style === "banner" || style === "personagem3d" || style === "realismo" ? style : "realismo",
            format: format === "vertical" || format === "wide" || format === "square" ? format : "square",
            createdAt: it.createdAt ? new Date(it.createdAt).getTime() : Date.now(),
          }
        })
        .filter(Boolean) as Array<{
        id: string
        url: string
        prompt: string
        style: ImageAssistStyleKind
        format: ImageFormatKind
        createdAt: number
      }>
      setGeneratedImages(parsed)
    } catch {
      /* ignore */
    }
  }, [lojaId])

  useEffect(() => {
    void refreshImageGallery()
  }, [refreshImageGallery])

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
      if (avatarPhotoPreview) URL.revokeObjectURL(avatarPhotoPreview)
      for (const u of timelinePreviews) if (u) URL.revokeObjectURL(u)
    }
  }, [imagePreview, avatarPhotoPreview, timelinePreviews])

  const sourceText = useMemo(() => (pack[textSource] || "").trim(), [pack, textSource])

  const buildAutoVisualPrompt = useCallback(
    (opts: { style: ImageAssistStyleKind; format: ImageFormatKind; copy: string }) => {
      const copy = opts.copy.trim()
      const base = copy
        .replaceAll(/\s+/g, " ")
        .replaceAll(/[#@][\p{L}\p{N}_-]+/gu, "")
        .slice(0, 420)
        .trim()

      const quality = [
        "fotorrealista",
        "8k",
        "iluminação cinematográfica",
        "profundidade de campo (bokeh) suave",
        "detalhes nítidos",
        "cores naturais",
        "sem texto na imagem",
        "sem logos de marcas reais",
      ].join(", ")

      const formatHint =
        opts.format === "vertical"
          ? "formato vertical 9:16, composição para Stories/Reels"
          : opts.format === "wide"
            ? "formato 16:9 widescreen, composição para site"
            : "formato quadrado 1:1, composição para Feed"

      if (opts.style === "realismo") {
        return [
          `Fotografia hiper-realista (${quality}).`,
          "Ambiente: assistência técnica (bancada organizada), ferramentas reais, foco em confiança.",
          "Cena: técnico(a) trabalhando em um smartphone moderno, mãos e detalhes nítidos, sem logos de marcas reais.",
          formatHint + ".",
          "Texto/tema do post:",
          base || "(sem texto)",
        ].join("\n")
      }
      if (opts.style === "banner") {
        return [
          "Banner promocional limpo, visual moderno e profissional.",
          "Estética: alto contraste, tipografia clara, hierarquia forte, espaço para preço/oferta (mas NÃO escreva texto no render).",
          `Qualidade: ${quality}.`,
          "Elementos: gradiente suave, ícones minimalistas, sem poluição visual.",
          formatHint + ".",
          "Tema/oferta do post:",
          base || "(sem texto)",
        ].join("\n")
      }
      return [
        "Render 3D estilo Pixar/Disney, personagem simpático com smartphone 'com vida' (olhos/expressão), cores vibrantes.",
        `Qualidade: iluminação suave cinematográfica, materiais PBR, render limpo, alta definição, sem texto.`,
        "Fundo: cenário simples e moderno, iluminação suave, acabamento premium.",
        formatHint + ".",
        "Tema do post:",
        base || "(sem texto)",
      ].join("\n")
    },
    []
  )

  const handleGenerateImageFromPost = () => {
    const copy = (pack[textSource] || "").trim()
    if (!copy) {
      toast({
        title: "Sem Pack",
        description: "Gere o Pack de Crescimento (ou selecione uma aba com texto) para criar o prompt automático.",
        variant: "destructive",
      })
      return
    }
    setImagePrompt(buildAutoVisualPrompt({ style: imageAssistStyle, format: imageFormat, copy }))
    toast({ title: "Prompt automático criado", description: "Ajuste se quiser e clique em Gerar Imagem." })
  }

  const handleGenerateImage = async () => {
    const prompt = imagePrompt.trim()
    if (!prompt) {
      toast({ title: "Prompt vazio", description: "Descreva a imagem (ou gere do Pack).", variant: "destructive" })
      return
    }
    const pendingId = `pending-${Date.now()}`
    setGeneratedImages((prev) => [
      { id: pendingId, url: "", prompt: "Pintando a arte…", style: imageAssistStyle, format: imageFormat, createdAt: Date.now(), pending: true },
      ...prev,
    ])
    setImageBusy(true)
    try {
      const res = await fetch("/api/marketing/image", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({ prompt, style: imageAssistStyle, format: imageFormat }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        imageUrl?: string
        creditsRemaining?: number
        error?: string
        message?: string
        jobId?: string
      }
      if (res.status === 402 || data.error === "sem_creditos") {
        toast({
          title: "Sem créditos",
          description: data.message || "Recarregue créditos para continuar.",
          variant: "destructive",
        })
        if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
        return
      }
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
      const url = typeof data.imageUrl === "string" ? data.imageUrl : ""
      if (!url) throw new Error("Sem imagem na resposta.")
      const id = String(data.jobId || `image-${Date.now()}`)
      setGeneratedImages((prev) => [
        { id, url, prompt: prompt.slice(0, 700), style: imageAssistStyle, format: imageFormat, createdAt: Date.now() },
        ...prev.filter((p) => p.id !== pendingId),
      ])
      void refreshImageGallery()
      toast({ title: "Imagem gerada", description: "Card adicionado na galeria." })
    } catch (e) {
      setGeneratedImages((prev) => prev.filter((p) => p.id !== pendingId))
      toast({
        title: "Falha ao gerar imagem",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setImageBusy(false)
    }
  }

  const onImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Envie uma imagem (JPG, PNG, WebP).", variant: "destructive" })
      return
    }
    setImageFile(f)
    setVideoMockReady(false)
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }

  const captionWords = useMemo(() => {
    const s = sourceText || ""
    const cleaned = s
      .replaceAll(/\s+/g, " ")
      .replaceAll(/[^\p{L}\p{N}\s!?.,-]/gu, "")
      .trim()
    const words = cleaned.split(" ").filter(Boolean).slice(0, 24)
    return words.length ? words : ["Agência", "IA", "Mestre"]
  }, [sourceText])

  useEffect(() => {
    if (!captionsEnabled || !(videoMockReady || videoBusy)) return
    const id = window.setInterval(() => {
      setCaptionIdx((i) => (i + 1) % captionWords.length)
    }, 190)
    return () => window.clearInterval(id)
  }, [captionsEnabled, videoMockReady, videoBusy, captionWords.length])

  const vibeLabel = (v: VideoVibeKind) =>
    v === "tecnico" ? "Foco Técnico (Lo-fi)" : v === "venda" ? "Energia de Venda (Upbeat)" : "Urgência (Fast)"

  const captionColor = useMemo(() => {
    if (!captionsEnabled) return classic ? "bg-slate-900" : "bg-white"
    if (videoVibe === "urgencia") return classic ? "bg-red-600" : "bg-red-500"
    if (videoVibe === "venda") return classic ? "bg-emerald-600" : "bg-emerald-400"
    return classic ? "bg-blue-600" : "bg-cyan-300"
  }, [captionsEnabled, classic, videoVibe])

  const handleGenerateVoice = async () => {
    if (!sourceText) {
      toast({
        title: "Sem texto",
        description: "Escolha uma aba do pack com conteúdo ou gere o Pack antes.",
        variant: "destructive",
      })
      return
    }
    setVoiceBusy(true)
    try {
      const res = await fetch("/api/marketing/voice", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({
          text: sourceText,
          voice: voiceKind,
          sourceTab: textSource,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        audioUrl?: string
        creditsRemaining?: number
        error?: string
        message?: string
      }
      if (res.status === 402 || data.error === "sem_creditos") {
        toast({
          title: "Sem créditos",
          description: data.message || "Recarregue créditos para continuar.",
          variant: "destructive",
        })
        if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
        return
      }
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
      const url = typeof data.audioUrl === "string" ? data.audioUrl : "/api/marketing/voice/demo"
      setAudioUrl(url)
      toast({
        title: "Locução (mock)",
        description: "Crédito debitado. Prévia de áudio carregada — integre TTS real quando disponível.",
      })
    } catch (e) {
      toast({
        title: "Falha na locução",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setVoiceBusy(false)
    }
  }

  const handleGenerateVideo = async () => {
    if (!imageFile) {
      toast({ title: "Imagem obrigatória", description: "Envie uma imagem base para o vídeo.", variant: "destructive" })
      return
    }
    setVideoBusy(true)
    try {
      const res = await fetch("/api/marketing/video", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({
          style: videoStyle,
          imageName: imageFile.name,
          imageSize: imageFile.size,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        creditsRemaining?: number
        error?: string
        message?: string
      }
      if (res.status === 402 || data.error === "sem_creditos") {
        toast({
          title: "Sem créditos",
          description: data.message || "Recarregue créditos para continuar.",
          variant: "destructive",
        })
        if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
        return
      }
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
      setVideoMockReady(true)
      toast({
        title: "Vídeo IA (Beta · mock)",
        description: data.message || "Job registrado. Player real quando o provedor for integrado.",
      })
    } catch (e) {
      toast({
        title: "Falha no vídeo",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setVideoBusy(false)
    }
  }

  const timelineLabels = [
    "1. Problema",
    "2. Desmontagem",
    "3. Defeito",
    "4. Reparo",
    "5. Teste",
    "6. Sucesso",
  ] as const

  const onTimelineFile = (idx: number, f: File | null) => {
    setTimelineFiles((prev) => prev.map((x, i) => (i === idx ? f : x)))
    setTimelinePreviews((prev) =>
      prev.map((u, i) => {
        if (i !== idx) return u
        if (u) URL.revokeObjectURL(u)
        return f ? URL.createObjectURL(f) : null
      })
    )
  }

  const toggleChannel = (k: keyof typeof channels) => {
    setChannels((c) => ({ ...c, [k]: !c[k] }))
  }

  const handleReviewReply = async () => {
    const t = reviewText.trim()
    if (!t) {
      toast({ title: "Cole a avaliação", description: "Insira o texto do comentário do cliente.", variant: "destructive" })
      return
    }
    setReviewBusy(true)
    setReviewReply("")
    try {
      const r = await fetch("/api/marketing/text", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
        body: JSON.stringify({ kind: "review_reply", brandVoice, reviewText: t }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reply?: string; message?: string; error?: string; creditsRemaining?: number }
      if (r.status === 402 || j.error === "sem_creditos") {
        toast({ title: "Sem créditos", description: j.message || "Recarregue créditos.", variant: "destructive" })
        if (typeof j.creditsRemaining === "number") setCredits(j.creditsRemaining)
        return
      }
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`)
      if (typeof j.creditsRemaining === "number") setCredits(j.creditsRemaining)
      setReviewReply(String(j.reply || "").trim())
      toast({ title: "Resposta gerada", description: "Pronta para colar no Google Maps." })
    } catch (e) {
      toast({ title: "Falha ao responder", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
    } finally {
      setReviewBusy(false)
    }
  }

  const onAvatarPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Envie uma imagem (JPG, PNG, WebP).", variant: "destructive" })
      return
    }
    setAvatarPhotoFile(f)
    setAvatarVideoUrl(null)
    setAvatarPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }

  const handleSyncAvatarWithVoice = async () => {
    const au = (audioUrl || "").trim()
    if (!au) {
      toast({
        title: "Sem locução",
        description: "Gere a locução primeiro para sincronizar o avatar (lip-sync).",
        variant: "destructive",
      })
      return
    }

    let avatarImageUrl = ""
    if (avatarMode === "photo") {
      if (!avatarPhotoPreview) {
        toast({ title: "Foto obrigatória", description: "Envie uma foto do técnico para criar o avatar.", variant: "destructive" })
        return
      }
      // No MVP, usamos preview local (objectURL) como referência client-side; provider real exigirá upload/URL pública.
      avatarImageUrl = avatarPhotoPreview
    }

    setAvatarBusy(true)
    setAvatarStage("Preparando avatar…")
    setAvatarProgress(8)
    try {
      const res = await fetch("/api/marketing/avatar", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({
          avatarImageUrl: avatarMode === "photo" ? avatarImageUrl : undefined,
          avatarPreset: avatarMode === "preset" ? avatarPreset : undefined,
          audioUrl: au,
          format: "9:16",
        }),
      })
      setAvatarStage("Animando boca do avatar…")
      setAvatarProgress(55)
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        videoUrl?: string | null
        creditsRemaining?: number
        error?: string
        message?: string
      }
      if (res.status === 402 || data.error === "sem_creditos") {
        toast({
          title: "Sem créditos",
          description: data.message || "Recarregue créditos para continuar.",
          variant: "destructive",
        })
        if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
        return
      }
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
      if (typeof data.creditsRemaining === "number") setCredits(data.creditsRemaining)
      setAvatarStage("Finalizando render…")
      setAvatarProgress(92)
      setAvatarVideoUrl(typeof data.videoUrl === "string" ? data.videoUrl : null)
      setAvatarProgress(100)
      setAvatarStage("Pronto para Reels/TikTok (9:16).")
      toast({ title: "Avatar sincronizado (mock)", description: "Pipeline pronto — lip-sync real entra na integração do provider." })
    } catch (e) {
      toast({
        title: "Falha no Avatar Mestre",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
      setAvatarStage("Falha ao renderizar.")
      setAvatarProgress(0)
    } finally {
      setAvatarBusy(false)
    }
  }

  const stopRecording = useCallback(async () => {
    const mr = recRef.current
    if (tickRef.current) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (!mr || mr.state === "inactive") {
      setRecording(false)
      return
    }
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve()
      mr.stop()
      mr.stream.getTracks().forEach((t) => t.stop())
    })
    setRecording(false)
    recRef.current = null
    const blob = new Blob(chunksRef.current, { type: "audio/webm" })
    chunksRef.current = []
    if (blob.size > 0) {
      toast({
        title: "Amostra capturada (demo)",
        description: `${(blob.size / 1024).toFixed(1)} KB · envio para clonagem real virá na próxima versão.`,
      })
    }
    setCloneOpen(false)
    setRecordSeconds(0)
  }, [toast])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      recRef.current = mr
      mr.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data)
      }
      mr.start()
      setRecording(true)
      setRecordSeconds(0)
      tickRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1)
      }, 1000)
    } catch {
      toast({
        title: "Microfone",
        description: "Permita o acesso ao microfone para gravar a amostra.",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    if (!recording) return
    if (recordSeconds < 30) return
    void stopRecording()
  }, [recording, recordSeconds, stopRecording])

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [])

  const sectionTitle = cn(
    "text-[10px] font-semibold uppercase tracking-[0.2em]",
    classic ? "text-slate-500" : "text-white/45"
  )

  return (
    <div className="space-y-4">
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(120%);
          }
        }
      `}</style>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3",
          classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.04]"
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className={cn("h-4 w-4", classic ? "text-fuchsia-600" : "text-fuchsia-400")} />
          <span className={cn("text-xs font-semibold", classic ? "text-slate-800" : "text-white/90")}>
            Créditos de Mídia
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-bold tabular-nums",
              classic ? "border-slate-200 bg-white text-slate-900" : "border-white/15 bg-black/50 text-white"
            )}
          >
            {credits === null ? "—" : credits}
          </span>
          <span className={cn("text-[11px]", classic ? "text-slate-600" : "text-white/55")}>
            Base: 1 · Premium: 5
          </span>
        </div>
      </div>

      <Tabs value={studioSection} onValueChange={(v) => setStudioSection(v as any)} className="w-full">
        <TabsList className={cn("grid w-full grid-cols-3", classic ? "" : "bg-black/40 border border-white/10")}>
          <TabsTrigger value="criacao">Criação</TabsTrigger>
          <TabsTrigger value="calendario">Calendário</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="criacao" className="mt-4 space-y-4">
          <MascoteStudio classic={classic} lojaId={lojaId} />

          {/* Diretor Omnicanal (6 passos) */}
          <div
            className={cn(
              "space-y-4 rounded-2xl border p-4",
              classic
                ? "border-slate-200 bg-white shadow-sm"
                : "border-cyan-500/20 bg-white/[0.03] backdrop-blur-md shadow-[0_0_0_1px_rgba(34,211,238,0.18)_inset,0_0_40px_rgba(34,211,238,0.10)]"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={sectionTitle}>Diretor de Conteúdo Omnicanal</p>
                <p className={cn("mt-1 text-xs", classic ? "text-slate-600" : "text-white/55")}>
                  Timeline de 6 passos + seleção de redes (Reels/Stories, TikTok, Facebook, Google Meu Negócio).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant={channels.instagram ? "default" : "outline"} onClick={() => toggleChannel("instagram")}>
                  <Instagram className="mr-2 h-4 w-4" />
                  Instagram
                </Button>
                <Button type="button" size="sm" variant={channels.tiktok ? "default" : "outline"} onClick={() => toggleChannel("tiktok")}>
                  <Video className="mr-2 h-4 w-4" />
                  TikTok
                </Button>
                <Button type="button" size="sm" variant={channels.facebook ? "default" : "outline"} onClick={() => toggleChannel("facebook")}>
                  <Facebook className="mr-2 h-4 w-4" />
                  Facebook
                </Button>
                <Button type="button" size="sm" variant={channels.gmb ? "default" : "outline"} onClick={() => toggleChannel("gmb")}>
                  <Globe2 className="mr-2 h-4 w-4" />
                  Google
                </Button>
              </div>
            </div>

        <div className="flex gap-2 overflow-x-auto rounded-xl border p-2">
          {timelineLabels.map((label, idx) => {
            const active = timelineStep === idx
            const has = !!timelineFiles[idx]
            const Icon = has ? CheckCircle2 : Circle
            return (
              <button
                key={label}
                type="button"
                onClick={() => setTimelineStep(idx as any)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                  active
                    ? classic
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-cyan-400/30 bg-cyan-400/15 text-white"
                    : classic
                      ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      : "border-white/10 bg-black/40 text-white/70 hover:bg-white/5"
                )}
              >
                <Icon className={cn("h-4 w-4", has ? "text-emerald-400" : classic ? "text-slate-400" : "text-white/30")} />
                {label}
              </button>
            )
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>
              Upload do passo: {timelineLabels[timelineStep]}
            </Label>
            <Input
              type="file"
              accept="image/*,video/*"
              onChange={(e) => onTimelineFile(timelineStep, e.target.files?.[0] ?? null)}
              className={cn("cursor-pointer", classic ? "border-slate-200" : "border-white/10 bg-black/40")}
            />
            <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
              Use fotos reais nos passos 2–4 e mascote (ou render) nos passos 1 e 6.
            </p>
          </div>
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border lg:col-span-2",
              classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/50"
            )}
            style={{ aspectRatio: "16 / 9" }}
          >
            {timelinePreviews[timelineStep] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={timelinePreviews[timelineStep] as string} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center gap-2 p-4 text-center">
                <Upload className={cn("h-5 w-5", classic ? "text-slate-400" : "text-white/30")} />
                <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                  Preview do passo selecionado (16:9). O render final será 9:16.
                </p>
              </div>
            )}

            {/* Light sweep (mock) quando alternar para o passo 6 */}
            {timelineStep === 5 ? (
              <div
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent"
                style={{ animation: "shimmer 1.2s infinite" }}
              />
            ) : null}
          </div>
        </div>

        <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-3", classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/40")}>
          <Music className={cn("h-4 w-4", classic ? "text-blue-600" : "text-cyan-300")} />
          <span className={cn("text-xs font-semibold", classic ? "text-slate-800" : "text-white/85")}>
            Próximo: publicar (mock) com adaptação por canal + SEO local
          </span>
        </div>

        <div className={cn("rounded-xl border p-3", classic ? "border-slate-200 bg-white" : "border-white/10 bg-black/40")}>
          <p className={cn("text-xs font-semibold", classic ? "text-slate-800" : "text-white/85")}>Responder Avaliações com IA (Google Maps)</p>
          <p className={cn("mt-1 text-[11px]", classic ? "text-slate-600" : "text-white/55")}>
            Usa o tom de voz da marca + SEO local. Custo: 1 crédito.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2">
              <Textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                rows={4}
                placeholder="Cole aqui a avaliação do cliente…"
                disabled={reviewBusy}
                className={cn(
                  "rounded-2xl border text-sm",
                  classic ? "border-slate-200 bg-white text-slate-800" : "border-white/10 bg-black/50 text-white/90"
                )}
              />
              {reviewReply ? (
                <Textarea
                  readOnly
                  value={reviewReply}
                  rows={5}
                  className={cn(
                    "rounded-2xl border text-sm",
                    classic ? "border-slate-200 bg-slate-50 text-slate-800" : "border-white/10 bg-black/50 text-white/90"
                  )}
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Button type="button" onClick={() => void handleReviewReply()} disabled={reviewBusy} className={cn(!classic && "bg-white/10 text-white hover:bg-white/15")}>
                {reviewBusy ? "Gerando…" : "Responder com IA"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReviewText("")
                  setReviewReply("")
                }}
                disabled={reviewBusy}
              >
                Limpar
              </Button>
            </div>
          </div>
        </div>
          </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Locução */}
        <div
          className={cn(
            "space-y-4 rounded-2xl border p-4",
            classic ? "border-slate-200 bg-white" : "border-white/10 bg-black/30"
          )}
        >
          <div className="flex items-center gap-2">
            <Mic2 className={cn("h-5 w-5", classic ? "text-violet-600" : "text-violet-400")} />
            <div>
              <p className={sectionTitle}>Locução (áudio)</p>
              <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/50")}>Voz IA premium</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Texto do pack</Label>
            <Select value={textSource} onValueChange={(v) => setTextSource(v as MarketingContentTab)}>
              <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">Feed</SelectItem>
                <SelectItem value="reels">Reels</SelectItem>
                <SelectItem value="stories">Stories</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Voz premium</Label>
            <Select value={voiceKind} onValueChange={(v) => setVoiceKind(v as PremiumVoiceKind)}>
              <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="especialista">Especialista</SelectItem>
                <SelectItem value="vendedor">Vendedor</SelectItem>
                <SelectItem value="atendente">Atendente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleGenerateVoice()}
              disabled={voiceBusy}
              className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
            >
              <Volume2 className="mr-2 h-4 w-4" />
              {voiceBusy ? "Gerando…" : "Gerar locução do pack (1 crédito)"}
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setCloneOpen(true)}>
              Clonar minha voz
            </Button>
          </div>

          <MarketingMediaWaveform classic={classic} isPlaying={playing || voiceBusy} />

          {audioUrl ? (
            <audio
              ref={audioRef}
              className="w-full"
              controls
              src={audioUrl}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          ) : (
            <p className={cn("text-center text-[11px]", classic ? "text-slate-500" : "text-white/40")}>
              Gere a locução para ouvir a prévia (mock).
            </p>
          )}
        </div>

        {/* Vídeo */}
        <div
          className={cn(
            "space-y-4 rounded-2xl border p-4",
            classic ? "border-slate-200 bg-white" : "border-white/10 bg-black/30"
          )}
        >
          <div className="flex items-center gap-2">
            <Video className={cn("h-5 w-5", classic ? "text-cyan-600" : "text-cyan-400")} />
            <div>
              <p className={sectionTitle}>Produção de vídeo</p>
              <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/50")}>Vídeo IA · Beta</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Vibe (trilha)</Label>
              <Select value={videoVibe} onValueChange={(v) => setVideoVibe(v as VideoVibeKind)}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tecnico">{vibeLabel("tecnico")}</SelectItem>
                  <SelectItem value="venda">{vibeLabel("venda")}</SelectItem>
                  <SelectItem value="urgencia">{vibeLabel("urgencia")}</SelectItem>
                </SelectContent>
              </Select>
              <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                Mix automático (preview): a trilha “abaixa” quando há voz.
              </p>
            </div>
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Legendas dinâmicas</Label>
              <Select value={captionsEnabled ? "on" : "off"} onValueChange={(v) => setCaptionsEnabled(v === "on")}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">Ativadas (CapCut)</SelectItem>
                  <SelectItem value="off">Desativadas</SelectItem>
                </SelectContent>
              </Select>
              <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                Estilo viral: pulo e troca de cor conforme a fala (mock).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Estilo</Label>
            <Select value={videoStyle} onValueChange={(v) => setVideoStyle(v as VideoStyleKind)}>
              <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cinematic">Cinematográfico</SelectItem>
                <SelectItem value="produto">Animação de produto</SelectItem>
                <SelectItem value="avatar">Avatar falante</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Imagem base</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={onImageChange}
              className={cn("cursor-pointer", classic ? "border-slate-200" : "border-white/10 bg-black/40")}
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleGenerateVideo()}
            disabled={videoBusy}
            variant={classic ? "default" : "secondary"}
            className={cn("w-full rounded-xl", !classic && "bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30")}
          >
            <Clapperboard className="mr-2 h-4 w-4" />
            {videoBusy ? "Enfileirando…" : "Gerar vídeo IA (Premium · 5 créditos)"}
          </Button>

          <div
            className={cn(
              "relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border shadow-inner",
              classic ? "border-slate-200 bg-slate-100" : "border-white/10 bg-black/60"
            )}
            style={{ aspectRatio: "9 / 16" }}
          >
            {imagePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagePreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 p-4 text-center">
                <Clapperboard className={cn("h-10 w-10", classic ? "text-slate-400" : "text-white/30")} />
                <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                  9:16 · envie uma imagem para usar como base
                </p>
              </div>
            )}
            {captionsEnabled && (videoMockReady || videoBusy) ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className={cn(
                    "mx-4 rounded-xl px-3 py-2 text-center text-sm font-black text-white shadow-lg",
                    captionColor,
                    classic ? "shadow-slate-900/10" : "shadow-black/40"
                  )}
                  style={{
                    transform: `translateY(${captionIdx % 2 === 0 ? "-6px" : "0px"}) scale(${captionIdx % 3 === 0 ? 1.04 : 1})`,
                    transition: "transform 160ms ease",
                  }}
                >
                  {captionWords[captionIdx] || "IA"}
                </div>
              </div>
            ) : null}
            {videoMockReady ? (
              <div className="absolute inset-0 flex flex-col bg-black/70">
                <video
                  className="h-full w-full object-cover opacity-90"
                  poster={imagePreview || undefined}
                  controls
                  playsInline
                  aria-label="Prévia vertical 9:16 (mock)"
                />
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-3 text-center">
                  <p className="text-[10px] font-semibold text-white">Beta · mock</p>
                  <p className="text-[9px] text-white/75">Sem arquivo de vídeo ainda — poster = sua imagem base.</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Avatar Mestre */}
      <div
        className={cn(
          "space-y-4 rounded-2xl border p-4",
          classic
            ? "border-slate-200 bg-white shadow-sm"
            : "border-violet-500/25 bg-white/[0.03] backdrop-blur-md shadow-[0_0_0_1px_rgba(217,70,239,0.18)_inset,0_0_36px_rgba(168,85,247,0.14)]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserRound className={cn("h-5 w-5", classic ? "text-blue-600" : "text-violet-300")} />
            <div>
              <p className={sectionTitle}>Criação de Avatar Falante</p>
              <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>
                Humanização digital: lip-sync do avatar com a locução e output vertical 9:16.
              </p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              classic ? "border-slate-200 bg-slate-50 text-slate-700" : "border-violet-500/20 bg-black/40 text-white/80"
            )}
          >
            Avatar Mestre
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Fonte do Avatar</Label>
            <Select value={avatarMode} onValueChange={(v) => setAvatarMode(v as "photo" | "preset")}>
              <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="photo">Upload da foto real do técnico</SelectItem>
                <SelectItem value="preset">Selecionar Avatar gerado por IA</SelectItem>
              </SelectContent>
            </Select>

            {avatarMode === "photo" ? (
              <div className="space-y-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={onAvatarPhotoChange}
                  className={cn("cursor-pointer", classic ? "border-slate-200" : "border-white/10 bg-black/40")}
                />
                <div
                  className={cn(
                    "relative w-full overflow-hidden rounded-2xl border",
                    classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/50"
                  )}
                  style={{ aspectRatio: "16 / 9" }}
                >
                  {avatarPhotoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPhotoPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-center">
                      <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                        Envie uma foto nítida do rosto (boa iluminação) para melhor lip-sync.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Estilo de Avatar</Label>
                <Select value={avatarPreset} onValueChange={(v) => setAvatarPreset(v as "3d" | "realista")}>
                  <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realista">Realista</SelectItem>
                    <SelectItem value="3d">3D</SelectItem>
                  </SelectContent>
                </Select>
                <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                  Em breve: seleção por galeria + geração automática do avatar.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Sincronização</Label>
            <Button
              type="button"
              onClick={() => void handleSyncAvatarWithVoice()}
              disabled={avatarBusy}
              className={cn(
                "w-full rounded-xl text-white",
                classic ? "bg-blue-600 hover:bg-blue-500" : "bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500"
              )}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              {avatarBusy ? "Sincronizando…" : "Sincronizar com Locução"}
            </Button>

            <div className="space-y-2">
              <Progress
                value={avatarProgress}
                className={cn(
                  "h-2",
                  classic ? "bg-slate-200 [&_[data-slot=progress-indicator]]:bg-blue-600" : "bg-white/10 [&_[data-slot=progress-indicator]]:bg-cyan-400"
                )}
              />
              <p className={cn("text-[11px]", classic ? "text-slate-600" : "text-white/55")}>
                {avatarStage || "Use a locução para animar a boca do avatar."}
              </p>
            </div>

            <div
              className={cn(
                "relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border shadow-inner",
                classic ? "border-slate-200 bg-slate-100" : "border-cyan-500/20 bg-black/60"
              )}
              style={{ aspectRatio: "9 / 16" }}
            >
              {avatarVideoUrl ? (
                <video
                  className="h-full w-full object-cover"
                  poster={avatarMode === "photo" ? avatarPhotoPreview || undefined : undefined}
                  controls
                  playsInline
                />
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 p-4 text-center">
                  <UserRound className={cn("h-10 w-10", classic ? "text-slate-400" : "text-white/30")} />
                  <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                    Saída 9:16 · Reels/TikTok\n                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Gerador de Imagens IA */}
      <div
        className={cn(
          "space-y-4 rounded-2xl border p-4",
          classic ? "border-slate-200 bg-white shadow-sm" : "border-fuchsia-500/20 bg-black/30 shadow-[0_0_0_1px_rgba(34,211,238,0.10)_inset,0_0_40px_rgba(217,70,239,0.10)]"
        )}
      >
        <div className="flex items-center gap-2">
          <ImageIcon className={cn("h-5 w-5", classic ? "text-amber-600" : "text-amber-300")} />
          <div>
            <p className={sectionTitle}>Gerador de Imagens IA</p>
            <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/50")}>
              Crie fotos e banners exclusivos da sua assistência (mock pronto para DALL·E 3 / Flux).
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Prompt (descrição da imagem)</Label>
            <Textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Ex.: Foto realista de um técnico trocando tela em bancada limpa, iluminação natural…"
              className={cn(
                "rounded-2xl border text-sm",
                classic ? "border-slate-200 bg-white text-slate-800" : "border-white/10 bg-black/50 text-white/90 placeholder:text-white/30"
              )}
            />
            <div className={cn("flex items-center justify-between text-[10px]", classic ? "text-slate-500" : "text-white/35")}>
              <span>Combine estilo + formato para manter consistência visual.</span>
              <span className="tabular-nums">{Math.min(imagePrompt.length, 4000)}/4000</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Estilos de assistência</Label>
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant={imageAssistStyle === "realismo" ? (classic ? "default" : "secondary") : "outline"}
                  className={cn(!classic && imageAssistStyle === "realismo" && "bg-white/10 text-white hover:bg-white/15")}
                  onClick={() => setImageAssistStyle("realismo")}
                >
                  Realismo de Bancada
                </Button>
                <Button
                  type="button"
                  variant={imageAssistStyle === "banner" ? (classic ? "default" : "secondary") : "outline"}
                  className={cn(!classic && imageAssistStyle === "banner" && "bg-white/10 text-white hover:bg-white/15")}
                  onClick={() => setImageAssistStyle("banner")}
                >
                  Banner de Oferta
                </Button>
                <Button
                  type="button"
                  variant={imageAssistStyle === "personagem3d" ? (classic ? "default" : "secondary") : "outline"}
                  className={cn(!classic && imageAssistStyle === "personagem3d" && "bg-white/10 text-white hover:bg-white/15")}
                  onClick={() => setImageAssistStyle("personagem3d")}
                >
                  3D Personagem
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Formato</Label>
              <Select value={imageFormat} onValueChange={(v) => setImageFormat(v as ImageFormatKind)}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">Quadrado (Feed)</SelectItem>
                  <SelectItem value="vertical">Vertical (Stories)</SelectItem>
                  <SelectItem value="wide">Widescreen (Site)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" onClick={handleGenerateImageFromPost}>
                Gerar imagem do post (auto prompt)
              </Button>
              <Button
                type="button"
                onClick={() => void handleGenerateImage()}
                disabled={imageBusy}
                className={cn(
                  "rounded-xl text-white",
                  classic ? "bg-slate-900 hover:bg-slate-800" : "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-500"
                )}
              >
                <ImageIcon className="mr-2 h-4 w-4" />
                {imageBusy ? "Gerando…" : "Gerar imagem"}
              </Button>
            </div>
          </div>
        </div>

        {generatedImages.length ? (
          <div className="space-y-2">
            <p className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", classic ? "text-slate-500" : "text-white/45")}>
              Galeria
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {generatedImages.map((img) => (
                <div
                  key={img.id}
                  className={cn(
                    "overflow-hidden rounded-2xl border",
                    classic
                      ? "border-slate-200 bg-white shadow-sm"
                      : "border-fuchsia-500/25 bg-black/40 shadow-[0_0_0_1px_rgba(34,211,238,0.12)_inset,0_0_28px_rgba(217,70,239,0.16)]"
                  )}
                >
                  <div
                    className={cn("w-full bg-black/40")}
                    style={{
                      aspectRatio: img.format === "vertical" ? "9 / 16" : img.format === "wide" ? "16 / 9" : "1 / 1",
                    }}
                  >
                    {img.pending ? (
                      <div
                        className={cn(
                          "relative h-full w-full overflow-hidden",
                          classic ? "bg-slate-100" : "bg-black/60"
                        )}
                        aria-label="Gerando imagem…"
                      >
                        <div
                          className={cn(
                            "absolute inset-0 animate-pulse",
                            classic ? "bg-slate-200/60" : "bg-white/5"
                          )}
                        />
                        <div
                          className={cn(
                            "absolute inset-0 -translate-x-full bg-gradient-to-r",
                            classic
                              ? "from-transparent via-slate-300/35 to-transparent"
                              : "from-transparent via-cyan-400/20 to-transparent"
                          )}
                          style={{ animation: "shimmer 1.4s infinite" }}
                        />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="space-y-2 p-3">
                    <p className={cn("text-xs font-semibold", classic ? "text-slate-900" : "text-white")}>
                      {img.style === "realismo" ? "Realismo de Bancada" : img.style === "banner" ? "Banner de Oferta" : "3D Personagem"}
                      <span className={cn("ml-2 text-[10px] font-medium", classic ? "text-slate-500" : "text-white/45")}>
                        {img.format === "vertical" ? "Vertical" : img.format === "wide" ? "Wide" : "Quadrado"}
                      </span>
                    </p>
                    <p className={cn("line-clamp-3 text-[11px]", classic ? "text-slate-600" : "text-white/55")}>{img.prompt}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

        </TabsContent>

        <TabsContent value="calendario" className="mt-4 space-y-4">
          <AutomacaoAgendamento classic={classic} lojaId={lojaId} brandVoice={brandVoice} />
        </TabsContent>

        <TabsContent value="performance" className="mt-4 space-y-4">
          <div
            className={cn(
              "rounded-2xl border p-4",
              classic ? "border-slate-200 bg-white shadow-sm" : "border-white/10 bg-black/40"
            )}
          >
            <p className={cn("text-sm font-semibold", classic ? "text-slate-900" : "text-white")}>Performance</p>
            <p className={cn("mt-1 text-xs", classic ? "text-slate-600" : "text-white/55")}>
              Em breve: métricas por canal, jobs e status de publicação.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={cloneOpen}
        onOpenChange={(open) => {
          if (!open && recording) void stopRecording()
          setCloneOpen(open)
        }}
      >
        <DialogContent className={cn(classic ? "" : "border-white/10 bg-zinc-950 text-white")}>
          <DialogHeader>
            <DialogTitle>Clonar minha voz</DialogTitle>
            <DialogDescription className={classic ? "" : "text-white/60"}>
              Grave uma amostra curta (máx. 30s). Em produção, o áudio será enviado ao provedor de clonagem com
              consentimento explícito.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {recording ? (
              <p className="text-sm font-medium text-red-500">Gravando… {recordSeconds}s</p>
            ) : (
              <p className={cn("text-sm", classic ? "text-slate-600" : "text-white/60")}>
                Ambiente silencioso, fale naturalmente o nome da loja e uma frase de atendimento.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {!recording ? (
              <Button type="button" onClick={() => void startRecording()}>
                Iniciar gravação
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={() => void stopRecording()}>
                Parar e usar amostra
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setCloneOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
