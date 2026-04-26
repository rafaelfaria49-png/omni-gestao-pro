"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BadgeCheck, Dice5, Sparkles, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { cn } from "@/lib/utils"

type MoodPreset = "heroi" | "triste" | "feliz"
type ObjectPreset = "celular" | "bateria" | "ferramentas"
type Provider = "openai" | "replicate"

type Props = {
  classic: boolean
  lojaId: string
}

function moodPrompt(m: MoodPreset): string {
  if (m === "triste") return "expressão triste, quebrado, com arranhões leves, postura abatida"
  if (m === "feliz") return "expressão feliz e confiante, aparência restaurada, brilho premium, postura vitoriosa"
  return "pose heroica, confiante, vibe de super-herói, energia positiva"
}

function objectPrompt(o: ObjectPreset): string {
  if (o === "bateria") return "uma bateria de smartphone antropomórfica"
  if (o === "ferramentas") return "um kit de ferramentas de assistência técnica antropomórfico"
  return "um smartphone antropomórfico"
}

export function MascoteStudio({ classic, lojaId }: Props) {
  const { toast } = useToast()

  const [objectPreset, setObjectPreset] = useState<ObjectPreset>("celular")
  const [mood, setMood] = useState<MoodPreset>("heroi")
  const [seed, setSeed] = useState(() => String(Math.floor(100000 + Math.random() * 900000)))
  const [promptPositive, setPromptPositive] = useState(
    "Render 3D estilo Pixar/Disney, personagem simpático, materiais PBR, iluminação cinematográfica suave, alta definição, sem texto na imagem, sem logos reais."
  )
  const [busy, setBusy] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>("replicate")

  const [fixedSeed, setFixedSeed] = useState<string>("")
  const [fixedPromptBase, setFixedPromptBase] = useState<string>("")
  const [fixedLoaded, setFixedLoaded] = useState(false)
  const fixedEnabled = !!fixedSeed.trim() && !!fixedPromptBase.trim()

  const fullPrompt = useMemo(() => {
    const name = "Juca Celular"
    return [
      `Personagem fixo: ${name}.`,
      promptPositive.trim(),
      `Objeto: ${objectPrompt(objectPreset)}.`,
      `Humor: ${moodPrompt(mood)}.`,
      "Cenário: fundo simples e moderno, cores vibrantes, acabamento premium.",
    ]
      .filter(Boolean)
      .join("\n")
  }, [mood, objectPreset, promptPositive])

  const loadFixed = useCallback(async () => {
    try {
      const r = await fetch(`/api/stores/${encodeURIComponent(lojaId)}/settings`, {
        credentials: "include",
        cache: "no-store",
      })
      const j = (await r.json().catch(() => ({}))) as { settings?: any }
      const s = j?.settings || null
      setFixedSeed(String(s?.mascotCharacterSeed || "").trim())
      setFixedPromptBase(String(s?.mascotPromptBase || "").trim())
    } catch {
      setFixedSeed("")
      setFixedPromptBase("")
    } finally {
      setFixedLoaded(true)
    }
  }, [lojaId])

  useEffect(() => {
    void loadFixed()
  }, [loadFixed])

  const randomizeSeed = () => setSeed(String(Math.floor(100000 + Math.random() * 900000)))

  const generate = async () => {
    setBusy(true)
    try {
      const useMascot = fixedEnabled
      const seedToUse = useMascot ? fixedSeed : seed

      const res = await fetch("/api/marketing/image", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
        body: JSON.stringify({
          prompt: fullPrompt,
          style: "personagem3d",
          format: "square",
          useMascot,
          seed: seedToUse,
          providerPreferred: provider, // hint futuro (ignorado no backend por enquanto)
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        imageUrl?: string
        seed?: string
        message?: string
        error?: string
      }
      if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`)
      const url = String(j.imageUrl || "").trim()
      if (!url) throw new Error("Sem imagem retornada.")
      setImageUrl(url)
      if (j.seed && !useMascot) setSeed(String(j.seed))
      toast({
        title: "Mascote gerado",
        description: useMascot ? "Consistência ativa (mascote fixado)." : "Seed capturada para consistência.",
      })
    } catch (e) {
      toast({ title: "Falha ao gerar mascote", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const fixAsMascot = async () => {
    const seedToFix = seed.trim()
    if (!seedToFix) {
      toast({ title: "Seed vazia", description: "Gere ou informe uma seed válida.", variant: "destructive" })
      return
    }
    const base = fullPrompt.trim()
    if (!base) {
      toast({ title: "Prompt vazio", description: "Informe o prompt base do mascote.", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/stores/${encodeURIComponent(lojaId)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mascotCharacterSeed: seedToFix, mascotPromptBase: base }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      await loadFixed()
      toast({ title: "Mascote da loja fixado", description: "Seed + prompt base salvos no Prisma (StoreSettings)." })
    } catch (e) {
      toast({ title: "Falha ao fixar mascote", description: e instanceof Error ? e.message : "Erro inesperado", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      className={cn(
        "rounded-3xl border p-4 transition-colors duration-300 md:p-5",
        classic
          ? "border-slate-200 bg-white shadow-sm"
          : "border-fuchsia-500/20 bg-white/[0.03] backdrop-blur-md shadow-[0_0_0_1px_rgba(217,70,239,0.18)_inset,0_0_40px_rgba(217,70,239,0.10)]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className={cn("h-5 w-5", classic ? "text-fuchsia-600" : "text-fuchsia-300")} />
          <div>
            <p className={cn("text-sm font-semibold", classic ? "text-slate-900" : "text-white")}>Fábrica de Mascotes 3D</p>
            <p className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>
              Consistência por Seed + Prompt Base (fixável por loja no Prisma).
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold",
            classic ? "border-slate-200 bg-slate-50 text-slate-700" : "border-fuchsia-500/20 bg-black/40 text-white/80"
          )}
        >
          <Wrench className={cn("h-3.5 w-3.5", classic ? "text-blue-600" : "text-cyan-300")} />
          Mascote Studio
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Objeto</Label>
              <Select value={objectPreset} onValueChange={(v) => setObjectPreset(v as ObjectPreset)}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="celular">Celular</SelectItem>
                  <SelectItem value="bateria">Bateria</SelectItem>
                  <SelectItem value="ferramentas">Ferramentas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Humor (preset)</Label>
              <Select value={mood} onValueChange={(v) => setMood(v as MoodPreset)}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="heroi">Mascote Herói</SelectItem>
                  <SelectItem value="triste">Triste (Antes)</SelectItem>
                  <SelectItem value="feliz">Feliz (Depois)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                <SelectTrigger className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replicate">Replicate (Flux)</SelectItem>
                  <SelectItem value="openai">OpenAI (DALL·E 3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Seed (consistência)</Label>
            <div className="flex gap-2">
              <Input value={seed} onChange={(e) => setSeed(e.target.value)} className={cn(classic ? "border-slate-200" : "border-white/10 bg-black/40")} />
              <Button type="button" variant="outline" onClick={randomizeSeed} disabled={busy}>
                <Dice5 className="mr-2 h-4 w-4" />
                Random
              </Button>
            </div>
            <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
              {fixedLoaded && fixedEnabled ? (
                <span className="inline-flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-emerald-500" />
                  Mascote fixado: seed {fixedSeed}
                </span>
              ) : (
                "Dica: Fixe a seed como Mascote da Loja para consistência em todo o conteúdo."
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label className={cn("text-xs", classic ? "text-slate-600" : "text-white/55")}>Prompt positivo (base 3D)</Label>
            <Textarea
              value={promptPositive}
              onChange={(e) => setPromptPositive(e.target.value)}
              rows={4}
              className={cn(
                "rounded-2xl border text-sm",
                classic ? "border-slate-200 bg-white text-slate-800" : "border-white/10 bg-black/50 text-white/90"
              )}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border",
              classic ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/50"
            )}
            style={{ aspectRatio: "1 / 1" }}
          >
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center">
                <p className={cn("text-[11px]", classic ? "text-slate-500" : "text-white/45")}>
                  Gere um mascote para visualizar.\n                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className={cn(
                "rounded-xl text-white",
                classic ? "bg-slate-900 hover:bg-slate-800" : "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-500"
              )}
            >
              {busy ? "Gerando…" : "Gerar mascote 3D"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void fixAsMascot()} disabled={busy}>
              Fixar como Mascote da Loja
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

