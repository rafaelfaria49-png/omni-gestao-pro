"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageSquareReply, Sparkles } from "lucide-react"
import { BrandHeader } from "@/components/studio/BrandHeader"
import { CreationPanel } from "@/components/studio/CreationPanel"
import { PhonePreview } from "@/components/studio/PhonePreview"
import { EditorialCalendar } from "@/components/studio/EditorialCalendar"
import { MarketingPackTabs } from "@/components/studio/MarketingPackTabs"
import { GlassCard } from "@/components/studio/ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"
import {
  marketingPostsToCalendarItems,
  type MarketingPostRow,
} from "@/lib/marketing-editorial-map"
import {
  type BrandVoiceProfile,
  type GrowthPackV2,
  type MarketingContentTab,
  type MarketingPackMainTab,
  brandVoiceLabel,
  buildGoogleReviewReplyCommand,
  buildGrowthPackCommand,
  dailyPostingSuggestion,
  parseGrowthPackFromAiMessage,
  readBrandVoiceFromStorage,
  serializePackForDb,
  tryDeserializePackFromDb,
  legacyCaptionAsPack,
  writeBrandVoiceToStorage,
} from "@/lib/marketing-growth-pack"

export default function MarketingStudioPage() {
  const { toast } = useToast()
  const { mode } = useStudioTheme()
  const classic = mode === "classic"
  const { lojaAtivaId } = useLojaAtiva()
  const [growthPack, setGrowthPack] = useState<GrowthPackV2>({ feed: "", reels: "", stories: "" })
  const [packMainTab, setPackMainTab] = useState<MarketingPackMainTab>("feed")
  const [lastCopyTab, setLastCopyTab] = useState<MarketingContentTab>("feed")
  const [brandVoice, setBrandVoice] = useState<BrandVoiceProfile>("varejo")
  const [brandVoiceHydrated, setBrandVoiceHydrated] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<string | undefined>("Smartwatch Aurora Pro")
  const [marketingDbStatus, setMarketingDbStatus] = useState<"unknown" | "connected" | "fallback">("unknown")
  const [palette, setPalette] = useState<{ a: string; b: string; c: string }>({
    a: "#d946ef",
    b: "#22d3ee",
    c: "#34d399",
  })
  const [marketingPosts, setMarketingPosts] = useState<MarketingPostRow[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [googleReviewInput, setGoogleReviewInput] = useState("")
  const [googleReply, setGoogleReply] = useState("")
  const [googleReplyBusy, setGoogleReplyBusy] = useState(false)
  const [dailyTip] = useState(() => dailyPostingSuggestion())

  const lojaId = useMemo(
    () => (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID,
    [lojaAtivaId]
  )

  useEffect(() => {
    setBrandVoice(readBrandVoiceFromStorage())
    setBrandVoiceHydrated(true)
  }, [])

  useEffect(() => {
    if (!brandVoiceHydrated) return
    writeBrandVoiceToStorage(brandVoice)
  }, [brandVoice, brandVoiceHydrated])

  const activeTabText = useMemo(() => {
    const key = packMainTab === "media" ? lastCopyTab : packMainTab
    return (growthPack[key] || "").trim()
  }, [growthPack, packMainTab, lastCopyTab])

  const handlePackMainTab = useCallback((t: MarketingPackMainTab) => {
    setPackMainTab(t)
    if (t !== "media") setLastCopyTab(t)
  }, [])

  const fetchMarketingPosts = useCallback(async () => {
    setPostsLoading(true)
    try {
      const res = await fetch("/api/marketing/posts", {
        credentials: "include",
        cache: "no-store",
        headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
      })
      const data = (await res.json().catch(() => ({}))) as {
        posts?: MarketingPostRow[]
        lastCaption?: string | null
        error?: string
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const posts = Array.isArray(data.posts) ? data.posts : []
      setMarketingPosts(posts)
      const last = typeof data.lastCaption === "string" ? data.lastCaption.trim() : ""
      if (last) {
        const parsed = tryDeserializePackFromDb(last)
        setGrowthPack(parsed ?? legacyCaptionAsPack(last))
      } else {
        setGrowthPack({ feed: "", reels: "", stories: "" })
      }
    } catch {
      setMarketingPosts([])
    } finally {
      setPostsLoading(false)
    }
  }, [lojaId])

  useEffect(() => {
    void fetchMarketingPosts()
  }, [fetchMarketingPosts])

  const persistCaption = useCallback(
    async (serialized: string, meta: { tone: string; product?: string }) => {
      const body = {
        caption: serialized,
        productName: meta.product?.trim() || "",
        tone: meta.tone || "",
        status: "GENERATED",
      }
      const res = await fetch("/api/marketing/posts", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      await fetchMarketingPosts()
    },
    [fetchMarketingPosts, lojaId]
  )

  const handleGenerate = async ({ tone, product, prompt }: { prompt: string; tone: string; product?: string }) => {
    const productTag = product?.trim() ? product.trim() : ""
    const brief = (prompt || "").trim()

    const command = buildGrowthPackCommand({
      brandVoice,
      toneEmotional: tone,
      product: productTag,
      brief,
    })

    setGenerating(true)
    try {
      const res = await fetch("/api/ai/orchestrate", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({ command, model: "auto", lojaId }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const msg = String(data.message || "").trim()
      if (!msg) throw new Error("Sem resposta da IA.")
      const pack = parseGrowthPackFromAiMessage(msg)
      setGrowthPack(pack)
      setPackMainTab("feed")
      setLastCopyTab("feed")
      const serialized = serializePackForDb(pack)
      try {
        await persistCaption(serialized, { tone, product: productTag })
        toast({
          title: "Pack de Crescimento gerado",
          description: "Feed, Reels e Stories salvos na unidade — alterne pelas abas e envie ao WhatsApp.",
        })
      } catch (e) {
        toast({
          title: "Pack gerado (sem salvar no servidor)",
          description:
            e instanceof Error
              ? `${e.message}. Verifique o banco ou rode a migração Prisma (marketing_ia_posts).`
              : "Não foi possível gravar no banco.",
          variant: "destructive",
        })
      }
    } catch (e) {
      toast({
        title: "Falha ao gerar pela IA",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateGoogleReply = async () => {
    const review = googleReviewInput.trim()
    if (!review) {
      toast({ title: "Cole a avaliação", description: "Insira o texto do comentário do cliente.", variant: "destructive" })
      return
    }
    const command = buildGoogleReviewReplyCommand({ brandVoice, reviewText: review })
    setGoogleReplyBusy(true)
    setGoogleReply("")
    try {
      const res = await fetch("/api/ai/orchestrate", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({ command, model: "auto", lojaId }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const msg = String(data.message || "").trim()
      if (!msg) throw new Error("Sem resposta da IA.")
      setGoogleReply(msg)
      toast({
        title: "Resposta para o Google",
        description: "Texto pronto para colar no Google Meu Negócio.",
      })
    } catch (e) {
      toast({
        title: "Falha ao gerar resposta",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setGoogleReplyBusy(false)
    }
  }

  const calendarItems = useMemo(() => marketingPostsToCalendarItems(marketingPosts), [marketingPosts])

  const handleSchedulePost = async () => {
    const text = activeTabText
    if (!text) {
      toast({
        title: "Sem conteúdo na aba",
        description: "Gere um pack ou escolha uma aba com texto antes de agendar.",
        variant: "destructive",
      })
      return
    }
    try {
      const res = await fetch("/api/marketing/posts", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaId,
        },
        body: JSON.stringify({
          caption: text,
          productName: (selectedProduct || "").trim(),
          tone: "",
          status: "SCHEDULED",
        }),
      })
      if (!res.ok) throw new Error("Falha ao agendar")
      await fetchMarketingPosts()
      toast({
        title: "Post agendado",
        description: "Registro salvo no calendário editorial (amanhã às 18h, se não informada outra data).",
      })
    } catch {
      toast({ title: "Erro ao agendar", description: "Tente novamente.", variant: "destructive" })
    }
  }

  const handleWhatsAppFallback = () => {
    toast({
      title: "Sem texto nesta aba",
      description: "Gere um pack e selecione uma aba com conteúdo antes de enviar ao WhatsApp.",
      variant: "destructive",
    })
  }

  const tipCard = cn(
    "flex gap-3 rounded-2xl border p-4 transition-colors duration-300",
    classic ? "border-slate-200 bg-slate-50/90" : "border-white/10 bg-white/[0.04]"
  )

  const voiceRow = cn(
    "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-end sm:justify-between transition-colors duration-300",
    classic ? "border-slate-200 bg-white" : "border-white/10 bg-black/40"
  )

  return (
    <main
      className={cn(
        "relative min-h-[calc(100vh-4rem)] w-full px-4 py-6 transition-colors duration-300 md:px-8 md:py-8",
        classic ? "bg-white text-slate-900" : "bg-black text-white"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] opacity-20 transition-opacity duration-300",
          classic
            ? "bg-[radial-gradient(ellipse_at_top,oklch(0.82_0.1_280/0.55),transparent_60%)]"
            : "bg-[radial-gradient(ellipse_at_top,oklch(0.55_0.2_300/0.35),transparent_60%)]"
        )}
      />

      {!classic && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-[15%] -top-[25%] h-[60%] w-[55%] rounded-full bg-fuchsia-600/12 blur-[140px]" />
          <div className="absolute -right-[10%] -top-[20%] h-[55%] w-[45%] rounded-full bg-cyan-500/10 blur-[140px]" />
          <div className="absolute -bottom-[25%] left-[20%] h-[60%] w-[60%] rounded-full bg-indigo-600/10 blur-[160px]" />
        </div>
      )}

      <div className="relative mx-auto flex max-w-7xl flex-col gap-6">
        <BrandHeader
          palette={palette}
          onPaletteChange={setPalette}
          onSync={() => {
            setPalette((p) => ({ ...p }))
            toast({ title: "Paleta sincronizada", description: "A paleta foi aplicada aos detalhes do preview." })
          }}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={tipCard}>
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                classic ? "border-slate-200 bg-white" : "border-white/10 bg-white/5"
              )}
            >
              <Sparkles className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />
            </div>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.2em]",
                  classic ? "text-slate-500" : "text-white/45"
                )}
              >
                Sugestão de postagem do dia
              </p>
              <p className={cn("mt-1 text-sm leading-snug", classic ? "text-slate-800" : "text-white/90")}>
                {dailyTip}
              </p>
            </div>
          </div>

          <div className={voiceRow}>
            <div className="min-w-0 flex-1 space-y-2">
              <Label
                htmlFor="brand-voice"
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.2em]",
                  classic ? "text-slate-500" : "text-white/45"
                )}
              >
                Tom de voz da marca
              </Label>
              <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/50")}>
                A IA ajusta vocabulário no Pack de Crescimento e nas respostas do Google.
              </p>
            </div>
            <Select
              value={brandVoice}
              onValueChange={(v) => setBrandVoice(v as BrandVoiceProfile)}
              disabled={generating || googleReplyBusy}
            >
              <SelectTrigger
                id="brand-voice"
                className={cn(
                  "h-11 w-full min-w-[200px] rounded-xl sm:w-[260px]",
                  classic ? "border-slate-200 bg-white" : "border-white/10 bg-black/50"
                )}
              >
                <SelectValue placeholder="Tom de voz" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tecnico">{brandVoiceLabel("tecnico")}</SelectItem>
                <SelectItem value="amigavel">{brandVoiceLabel("amigavel")}</SelectItem>
                <SelectItem value="luxo">{brandVoiceLabel("luxo")}</SelectItem>
                <SelectItem value="varejo">{brandVoiceLabel("varejo")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
          <div className="space-y-6 lg:col-span-7">
            <CreationPanel
              onGenerate={handleGenerate}
              generating={generating}
              selectedProduct={selectedProduct}
              onSelectProduct={setSelectedProduct}
              onDbStatus={setMarketingDbStatus}
            />

            <GlassCard className="rounded-3xl p-5 shadow-sm dark:shadow-none">
              <MarketingPackTabs
                pack={growthPack}
                tab={packMainTab}
                onTabChange={handlePackMainTab}
                classic={classic}
                lojaId={lojaId}
                initialLocutionSource={lastCopyTab}
                brandVoice={brandVoice}
              />
            </GlassCard>

            <GlassCard className="rounded-3xl p-5 shadow-sm dark:shadow-none">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                    classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5"
                  )}
                >
                  <MessageSquareReply className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <h3 className={cn("text-sm font-semibold", classic ? "text-slate-900" : "text-white")}>
                      Google Meu Negócio
                    </h3>
                    <p className={cn("mt-1 text-xs", classic ? "text-slate-600" : "text-white/50")}>
                      Cole o comentário da avaliação; a IA gera uma resposta cordial com termos úteis para SEO local.
                    </p>
                  </div>
                  <Textarea
                    value={googleReviewInput}
                    onChange={(e) => setGoogleReviewInput(e.target.value)}
                    rows={4}
                    placeholder="Ex.: Ótimo atendimento, recomendo a loja…"
                    disabled={googleReplyBusy}
                    className={cn(
                      "rounded-2xl border text-sm",
                      classic
                        ? "border-slate-200 bg-white text-slate-800"
                        : "border-white/10 bg-black/50 text-white/90 placeholder:text-white/30"
                    )}
                  />
                  <Button
                    type="button"
                    onClick={() => void handleGenerateGoogleReply()}
                    disabled={googleReplyBusy}
                    variant={classic ? "default" : "secondary"}
                    className={cn(!classic && "bg-white/10 text-white hover:bg-white/15")}
                  >
                    {googleReplyBusy ? "Gerando…" : "Gerar resposta para avaliação"}
                  </Button>
                  {googleReply ? (
                    <div className="space-y-2">
                      <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/50")}>
                        Resposta sugerida
                      </Label>
                      <Textarea
                        readOnly
                        value={googleReply}
                        rows={8}
                        className={cn(
                          "rounded-2xl border text-sm",
                          classic
                            ? "border-slate-200 bg-slate-50 text-slate-800"
                            : "border-white/10 bg-black/40 text-white/90"
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </GlassCard>
          </div>

          <aside className="flex flex-col gap-6 lg:col-span-3">
            <GlassCard className="rounded-3xl p-5 shadow-sm dark:shadow-none">
              <PhonePreview
                brand="aurorastore"
                product={selectedProduct}
                caption={growthPack.feed}
                palette={palette}
              />
            </GlassCard>

            <EditorialCalendar
              items={calendarItems}
              loading={postsLoading}
              getWhatsAppText={() => activeTabText}
              captionForWhatsApp={growthPack.feed}
              onSchedule={handleSchedulePost}
              onWhatsApp={handleWhatsAppFallback}
            />
          </aside>
        </div>

        <footer
          className={cn(
            "pt-2 text-center text-[10px] uppercase tracking-[0.28em] transition-colors duration-300",
            classic ? "text-slate-600" : "text-white/55"
          )}
        >
          Estúdio de Marketing IA · {classic ? "Classic Elegance" : "Black Edition"} · Banco:{" "}
          {marketingDbStatus === "connected" ? "LIGADO" : marketingDbStatus === "fallback" ? "DESLIGADO" : "—"}
        </footer>
      </div>
    </main>
  )
}
