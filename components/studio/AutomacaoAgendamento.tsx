"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Radio, CheckCircle2, Clock, Globe2, Instagram, MessageCircle, Send, Sparkles, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { cn } from "@/lib/utils"
import type { BrandVoiceProfile } from "@/lib/marketing-growth-pack"

type Channel = "instagram_feed" | "instagram_stories" | "tiktok" | "facebook" | "gmb" | "whatsapp_status"

type Item = {
  id: string
  createdAt: string
  status: string
  channels: Channel[]
  payload: Record<string, any>
}

type Props = {
  classic: boolean
  lojaId: string
  brandVoice: BrandVoiceProfile
}

export function AutomacaoAgendamento({ classic, lojaId, brandVoice }: Props) {
  const { toast } = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState("")
  const [progress, setProgress] = useState(0)
  const [previewChannel, setPreviewChannel] = useState<Channel>("instagram_feed")

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/marketing/schedule", {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
      })
      const j = (await r.json().catch(() => ({}))) as { items?: Item[] }
      setItems(Array.isArray(j.items) ? j.items : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [lojaId])

  useEffect(() => {
    void fetchQueue()
  }, [fetchQueue])

  const runDaily = async () => {
    setBusy(true)
    setStage("Gerando Bom Dia…")
    setProgress(18)
    try {
      const r = await fetch("/api/marketing/schedule", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
        body: JSON.stringify({ brandVoice, tone: "pro", product: "Assistência técnica" }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; alreadyQueued?: boolean; message?: string; error?: string }
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`)
      setStage(j.alreadyQueued ? "Já havia item enfileirado hoje." : "Item enfileirado.")
      setProgress(100)
      await fetchQueue()
      toast({ title: "Rotina 09:00", description: j.alreadyQueued ? "Já estava na fila." : "Conteúdo do dia enfileirado." })
    } catch (e) {
      toast({ title: "Falha na rotina", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
      setStage("Falha")
      setProgress(0)
    } finally {
      setBusy(false)
    }
  }

  const latest = items[0]

  const adaptedText = useMemo(() => {
    const a = latest?.payload?.adapted
    if (!a) return ""
    const t = a?.[previewChannel]
    return typeof t === "string" ? t : ""
  }, [latest, previewChannel])

  const channelLabel = (c: Channel) => {
    if (c === "instagram_feed") return "Instagram (Feed)"
    if (c === "instagram_stories") return "Instagram (Stories)"
    if (c === "tiktok") return "TikTok"
    if (c === "facebook") return "Facebook"
    if (c === "gmb") return "Google Meu Negócio"
    return "Status WhatsApp"
  }

  const iconFor = (c: Channel) => {
    if (c.startsWith("instagram")) return Instagram
    if (c === "tiktok") return Video
    if (c === "gmb") return Globe2
    if (c === "whatsapp_status") return MessageCircle
    return Radio
  }

  const publishMock = async () => {
    if (!latest) {
      toast({ title: "Fila vazia", description: "Enfileire a rotina de abertura primeiro.", variant: "destructive" })
      return
    }
    setBusy(true)
    setStage("Publicando (mock)…")
    setProgress(35)
    try {
      // Mock: apenas marca localmente como “published” (persistência via job meta já existe).
      setProgress(85)
      toast({ title: "Publicação", description: "Multidifusão mock executada (Instagram/TikTok/Facebook/GMB/WhatsApp)." })
      setStage("Publicado (mock)")
      setProgress(100)
    } catch (e) {
      toast({ title: "Falha ao publicar", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
      setStage("Falha")
      setProgress(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className={cn(
        "border transition-colors duration-300",
        classic
          ? "border-slate-200 bg-white shadow-sm"
          : "border-cyan-500/20 bg-white/[0.03] backdrop-blur-md shadow-[0_0_0_1px_rgba(34,211,238,0.18)_inset,0_0_40px_rgba(34,211,238,0.10)]"
      )}
    >
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className={cn("flex items-center gap-2 text-base", classic ? "text-slate-900" : "text-white")}>
            <Sparkles className={cn("h-4 w-4", classic ? "text-cyan-600" : "text-cyan-300")} />
            Automação Omnicanal · Rotina 09:00
          </CardTitle>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              classic ? "border-slate-200 bg-slate-50 text-slate-700" : "border-cyan-500/20 bg-black/40 text-white/80"
            )}
          >
            Agência IA
          </span>
        </div>
        <p className={cn("text-sm", classic ? "text-slate-600" : "text-white/55")}>
          Gera automaticamente o post de Bom Dia e mantém uma fila pronta para publicação multicanal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void runDaily()} disabled={busy} className={cn(!classic && "bg-cyan-500/20 text-white hover:bg-cyan-500/30")}>
            <Clock className="mr-2 h-4 w-4" />
            {busy ? "Executando…" : "Rodar rotina agora (09:00)"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void fetchQueue()} disabled={busy || loading}>
            Atualizar fila
          </Button>
          <Button type="button" onClick={() => void publishMock()} disabled={busy || !latest} className={cn(classic ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-white/10 text-white hover:bg-white/15")}>
            <Send className="mr-2 h-4 w-4" />
            Publicar (mock)
          </Button>
        </div>

        <div className="space-y-2">
          <Progress
            value={progress}
            className={cn(
              "h-2",
              classic
                ? "bg-slate-200 [&_[data-slot=progress-indicator]]:bg-blue-600"
                : "bg-white/10 [&_[data-slot=progress-indicator]]:bg-cyan-400"
            )}
          />
          <div className={cn("flex items-center justify-between text-[11px]", classic ? "text-slate-600" : "text-white/55")}>
            <span>{stage || (loading ? "Carregando fila…" : "Pronto")}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
        </div>

        <div className={cn("rounded-xl border p-3", classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/40")}>
          <div className="flex items-center justify-between gap-2">
            <p className={cn("text-sm font-semibold", classic ? "text-slate-900" : "text-white")}>Fila</p>
            <span className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>
              {loading ? "…" : `${items.length} item(ns)`}
            </span>
          </div>
          {latest ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                {latest.channels.map((c) => {
                  const Icon = iconFor(c)
                  return (
                    <span
                      key={c}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold",
                        classic ? "border-slate-200 bg-white text-slate-700" : "border-white/10 bg-black/40 text-white/75"
                      )}
                    >
                      <Icon className={cn("h-3.5 w-3.5", classic ? "text-blue-600" : "text-cyan-300")} />
                      {channelLabel(c)}
                    </span>
                  )
                })}
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                <div className="space-y-2 lg:col-span-1">
                  <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Prévia por canal</Label>
                  <Select value={previewChannel} onValueChange={(v) => setPreviewChannel(v as Channel)}>
                    <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instagram_feed">Instagram (Feed)</SelectItem>
                      <SelectItem value="instagram_stories">Instagram (Stories)</SelectItem>
                      <SelectItem value="tiktok">TikTok</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="gmb">Google Meu Negócio</SelectItem>
                      <SelectItem value="whatsapp_status">Status WhatsApp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="lg:col-span-2 space-y-2">
                  <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Texto adaptado</Label>
                  <Textarea
                    readOnly
                    rows={6}
                    value={adaptedText || "Ainda sem texto adaptado — rode a rotina."}
                    className={cn(
                      "rounded-2xl border text-sm",
                      classic ? "border-slate-200 bg-white text-slate-800" : "border-white/10 bg-black/50 text-white/90"
                    )}
                  />
                </div>
              </div>

              <div className={cn("flex items-center gap-2 text-[11px]", classic ? "text-slate-600" : "text-white/55")}>
                <CheckCircle2 className={cn("h-4 w-4", classic ? "text-emerald-600" : "text-emerald-300")} />
                {String(latest.status || "").toUpperCase()}
              </div>
            </div>
          ) : (
            <p className={cn("mt-3 text-sm", classic ? "text-slate-600" : "text-white/55")}>
              Nenhum item na fila. Rode a rotina 09:00 para gerar o Bom Dia.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

