"use client"

import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { BrandVoiceProfile, GrowthPackV2, MarketingContentTab, MarketingPackMainTab } from "@/lib/marketing-growth-pack"
import { MarketingMediaStudio } from "@/components/studio/MarketingMediaStudio"

type Props = {
  pack: GrowthPackV2 | null
  tab: MarketingPackMainTab
  onTabChange: (t: MarketingPackMainTab) => void
  classic: boolean
  lojaId: string
  /** Última aba de texto (Feed/Reels/Stories) antes de abrir o Estúdio de Mídia — fonte inicial da locução. */
  initialLocutionSource: MarketingContentTab
  brandVoice: BrandVoiceProfile
}

export function MarketingPackTabs({ pack, tab, onTabChange, classic, lojaId, initialLocutionSource, brandVoice }: Props) {
  const safe = pack ?? { feed: "", reels: "", stories: "" }

  const area = cn(
    "min-h-[240px] w-full resize-y rounded-2xl border px-4 py-3 text-sm leading-relaxed outline-none",
    classic
      ? "border-slate-200 bg-white text-slate-800 placeholder:text-slate-400"
      : "border-white/10 bg-black/50 text-white/90 placeholder:text-white/30"
  )

  return (
    <div className="space-y-3">
      <p
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.2em]",
          classic ? "text-slate-500" : "text-white/45"
        )}
      >
        Resultado · Pack de Crescimento
      </p>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as MarketingPackMainTab)} className="w-full">
        <TabsList
          className={cn(
            "grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4",
            classic ? "bg-slate-100" : "bg-white/5"
          )}
        >
          <TabsTrigger
            value="feed"
            className={cn(
              "text-xs sm:text-sm",
              classic ? "data-[state=active]:bg-white" : "data-[state=active]:bg-white/10 data-[state=active]:text-white"
            )}
          >
            Feed
          </TabsTrigger>
          <TabsTrigger
            value="reels"
            className={cn(
              "text-xs sm:text-sm",
              classic ? "data-[state=active]:bg-white" : "data-[state=active]:bg-white/10 data-[state=active]:text-white"
            )}
          >
            Reels
          </TabsTrigger>
          <TabsTrigger
            value="stories"
            className={cn(
              "text-xs sm:text-sm",
              classic ? "data-[state=active]:bg-white" : "data-[state=active]:bg-white/10 data-[state=active]:text-white"
            )}
          >
            Stories
          </TabsTrigger>
          <TabsTrigger
            value="media"
            className={cn(
              "col-span-2 text-xs sm:col-span-1 sm:text-sm",
              classic ? "data-[state=active]:bg-white" : "data-[state=active]:bg-white/10 data-[state=active]:text-white"
            )}
          >
            Estúdio de Mídia
          </TabsTrigger>
        </TabsList>
        <TabsContent value="feed" className="mt-3">
          <Textarea readOnly className={area} value={safe.feed} aria-label="Legenda para o Feed" />
        </TabsContent>
        <TabsContent value="reels" className="mt-3">
          <Textarea readOnly className={area} value={safe.reels} aria-label="Roteiro de Reels" />
        </TabsContent>
        <TabsContent value="stories" className="mt-3">
          <Textarea readOnly className={area} value={safe.stories} aria-label="Sugestões de Stories" />
        </TabsContent>
        <TabsContent value="media" className="mt-3">
          <MarketingMediaStudio
            key={`${initialLocutionSource}-${tab}`}
            pack={safe}
            classic={classic}
            lojaId={lojaId}
            initialTextSource={initialLocutionSource}
            brandVoice={brandVoice}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
