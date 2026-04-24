"use client"

import { useState } from "react"
import { Copy, Download, FileText, Sparkles, Check, Undo, Bold, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export function DocumentEditor({ content, setContent }: any) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if(!content) return;
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-card/30 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 bg-card/30 px-4 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:text-foreground" type="button">
            <Undo className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-6 bg-border" />
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:text-foreground" type="button">
            <Bold className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="rounded-2xl border-white/10 bg-black/50 text-xs text-foreground backdrop-blur-md hover:bg-black/60"
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            Copiar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-2xl border-white/10 bg-black/50 text-xs text-foreground backdrop-blur-md hover:bg-black/60"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-2xl border-blue-500/30 bg-blue-500/10 text-xs text-cyan-100 shadow-md shadow-blue-950/30 hover:bg-blue-500/15"
          >
            <Rocket className="mr-1.5 h-3.5 w-3.5" /> Postar / Agendar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-12">
        <div className="mx-auto max-w-3xl">
          {content ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[500px] w-full resize-none bg-transparent text-base text-foreground outline-none"
            />
          ) : (
            <div className="flex h-full min-h-[500px] flex-col items-center justify-center text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-black/50 shadow-xl backdrop-blur-md">
                <FileText className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="mb-3 text-2xl font-bold text-foreground">Editor de Documentos</h2>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm text-muted-foreground backdrop-blur-md">
                <Sparkles className="h-4 w-4 text-cyan-300" /> Edição em tempo real
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

