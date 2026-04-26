"use client"

import { useState } from "react"
import { IaSidebar } from "@/components/dashboard/ia-mestre/ia-sidebar"
import { ChatPanel } from "@/components/dashboard/ia-mestre/chat-panel"
import { DocumentEditor } from "@/components/dashboard/ia-mestre/document-editor"
import { useToast } from "@/hooks/use-toast"

export default function IaMestrePage() {
  const { toast } = useToast()
  const [brandVoiceEnabled, setBrandVoiceEnabled] = useState(false)
  const [generatedContent, setGeneratedContent] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  return (
    <div className="relative flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-black/90">
      {/* Esferas de luz de fundo */}
      <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-indigo-500/12 blur-[120px]" />
      <div className="absolute -bottom-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-blue-500/12 blur-[120px]" />

      <div className="relative z-10 flex h-full w-full overflow-hidden">
        <IaSidebar />
        <ChatPanel
          brandVoiceEnabled={brandVoiceEnabled}
          onBrandVoiceChange={setBrandVoiceEnabled}
          isLoading={isLoading}
          onSendMessage={async (msg, opts) => {
            if (isLoading) return
            try {
              setIsLoading(true)
              const prefix = brandVoiceEnabled
                ? "Use o Brand Voice da empresa (tom premium, claro e direto). Entregue um resultado pronto para colar.\n\n"
                : ""
              const command = `${prefix}${msg}`
              const res = await fetch("/api/ai/orchestrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command, model: opts?.model ?? "auto" }),
              })
              const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
              if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
              setGeneratedContent(String(data.message || "").trim())
            } catch (e) {
              toast({
                title: "Falha ao enviar",
                description: e instanceof Error ? e.message : "Erro inesperado",
                variant: "destructive",
                duration: 6000,
              })
            } finally {
              setIsLoading(false)
            }
          }}
        />
        <DocumentEditor content={generatedContent} setContent={setGeneratedContent} />
      </div>
    </div>
  )
}

