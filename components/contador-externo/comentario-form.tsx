"use client"

/**
 * Portal externo read-only — novo comentário do contador (GOAL 015).
 *
 * O comentário criado por aqui grava `atorTipo: "externo"` no servidor; a UI não
 * escolhe autor nem visibilidade. Validação de texto é do domínio (422 com
 * `campo`), então o formulário só evita o envio obviamente vazio e mostra a
 * mensagem que voltou — sem regra duplicada no cliente.
 */
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Props = Readonly<{ loja: string; competencia: string }>

export function ComentarioForm({ loja, competencia }: Props) {
  const router = useRouter()
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setEnviando(true)
    setErro(null)
    const r = await fetch(`/api/contador-externo/lojas/${encodeURIComponent(loja)}/comentarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ competencia, texto }),
      cache: "no-store",
    })
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null
    setEnviando(false)
    if (!r.ok || !json?.ok) {
      setErro(
        typeof json?.mensagem === "string"
          ? json.mensagem
          : "Não foi possível enviar o comentário agora. Tente novamente.",
      )
      return
    }
    setTexto("")
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escreva um comentário para a empresa…"
        rows={3}
        disabled={enviando}
      />
      <div className="flex items-center justify-between gap-3">
        {erro ? <p className="text-xs text-destructive">{erro}</p> : <span />}
        <Button size="sm" onClick={enviar} disabled={enviando || texto.trim().length === 0}>
          {enviando ? "Enviando…" : "Comentar"}
        </Button>
      </div>
    </div>
  )
}
