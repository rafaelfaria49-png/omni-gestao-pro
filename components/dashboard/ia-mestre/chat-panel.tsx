"use client"

import { useState } from "react"
import { Send, Mic, Paperclip, ChevronDown, Check, Sparkles, Store, Cpu, Atom } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const aiModels = {
  recommended: {
    label: "Recomendado",
    models: [
      {
        id: "auto",
        name: "Auto Mestre",
        subtitle: "Escolha Automática",
        icon: Sparkles,
        color: "from-indigo-500 to-cyan-500",
        badge: "Recomendado",
      },
    ],
  },
  text: {
    label: "Modelos de Texto",
    models: [
      { id: "gpt-4o", name: "GPT-4o", subtitle: "OpenAI", icon: Cpu, color: "from-emerald-500 to-teal-600" },
      { id: "gemini-1.5", name: "Gemini 1.5 Flash", subtitle: "Google", icon: Atom, color: "from-blue-500 to-cyan-600" },
    ],
  },
} as const

interface ChatPanelProps {
  brandVoiceEnabled: boolean
  onBrandVoiceChange: (enabled: boolean) => void
  isLoading?: boolean
  onSendMessage?: (msg: string, opts?: { model?: string }) => Promise<void> | void
}

export function ChatPanel({ brandVoiceEnabled, onBrandVoiceChange, onSendMessage, isLoading }: ChatPanelProps) {
  const [selectedModel, setSelectedModel] = useState("auto")
  const [message, setMessage] = useState("")
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)

  const selectedModelInfo =
    [...aiModels.recommended.models, ...aiModels.text.models].find((m) => m.id === selectedModel) ?? aiModels.recommended.models[0]

  return (
    <div className="flex h-full w-full flex-col border-r border-white/10 bg-card/30 backdrop-blur-xl lg:w-[420px]">
      <div className="border-b border-white/10 p-4">
        <Popover open={isModelSelectorOpen} onOpenChange={setIsModelSelectorOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between rounded-2xl border-white/10 bg-black/60 px-4 py-6 text-foreground backdrop-blur-md hover:bg-black/70"
            >
              <div className="flex items-center gap-3">
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg", selectedModelInfo.color)}>
                  <selectedModelInfo.icon className="h-5 w-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">{selectedModelInfo.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedModelInfo.subtitle}</p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[380px] rounded-2xl border-border bg-popover p-0 text-popover-foreground backdrop-blur-xl" align="start">
            <div className="border-b border-border p-4">
              <h3 className="font-semibold">Cérebro da IA</h3>
            </div>
            <ScrollArea className="h-[280px]">
              <div className="p-2">
                {Object.entries(aiModels).map(([key, category]) => (
                  <div key={key} className="mb-4">
                    <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category.label}</p>
                    <div className="space-y-1">
                      {category.models.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            setSelectedModel(model.id)
                            setIsModelSelectorOpen(false)
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all",
                            selectedModel === model.id
                              ? "border border-blue-500/25 bg-blue-500/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          )}
                        >
                          <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br", model.color)}>
                            <model.icon className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{model.name}</p>
                            <p className="text-xs text-muted-foreground">{model.subtitle}</p>
                          </div>
                          {selectedModel === model.id && <Check className="h-4 w-4 text-cyan-300" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-2xl border border-transparent",
                brandVoiceEnabled ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-300" : "bg-black/40 text-muted-foreground"
              )}
            >
              <Store className="h-5 w-5" />
            </div>
            <div>
              <Label className="text-sm font-semibold text-foreground">Ativar Identidade da Loja</Label>
              <p className="text-xs text-muted-foreground">
                {brandVoiceEnabled ? "Usando dados da assistência" : "Modo genérico ativado"}
              </p>
            </div>
          </div>
          <Switch checked={brandVoiceEnabled} onCheckedChange={onBrandVoiceChange} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-blue-500/15 to-cyan-500/5">
            <Sparkles className="h-8 w-8 text-cyan-300" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-foreground">Comece uma conversa</h3>
        </div>
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="relative rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md">
          <Textarea
            placeholder="Descreva o que você quer criar..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="min-h-[100px] resize-none border-0 bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="flex items-center justify-between border-t border-white/10 px-3 py-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="rounded-xl text-muted-foreground hover:text-foreground" type="button">
                <Paperclip className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" className="rounded-xl text-muted-foreground hover:text-foreground" type="button">
                <Mic className="h-5 w-5" />
              </Button>
            </div>
            <Button
              size="sm"
              className="rounded-2xl bg-blue-600 px-4 text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={!message.trim() || !!isLoading}
              onClick={async () => {
                const text = message.trim()
                if (!text || !onSendMessage) return
                await onSendMessage(text, { model: selectedModel })
                setMessage("")
              }}
            >
              <Send className="mr-2 h-4 w-4" /> {isLoading ? "Gerando..." : "Enviar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

