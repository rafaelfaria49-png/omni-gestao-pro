"use client"

/**
 * Contador HUB · comentários reais (GOAL 011).
 *
 * Bloco reaproveitável: lista os comentários de uma competência (ou de um
 * documento específico) e permite criar novos. Substitui a "Conversa com o
 * contador" mockada do preview.
 *
 * A distinção interno × compartilhado é EXPLÍCITA na criação e na leitura — o
 * usuário precisa ver, antes de enviar, se aquele texto ficará visível ao contador
 * externo. Nenhum dado de escopo (loja/autor) é enviado pelo cliente.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Botao,
  VisibilidadeChip,
  formatarDataHora,
  lerErroResposta,
} from "../contador-ui"

export type ComentarioDto = {
  id: string
  competenciaId: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: "interna" | "compartilhada"
  texto: string
  criadoEm: string
}

const ENDPOINT = "/api/contador/comentarios"

export function ContadorComentarios({
  competencia,
  documentoId = null,
  titulo = "Comentários",
  onCriado,
  className,
}: {
  /** Código canônico `AAAA-MM`. */
  competencia: string
  /** Quando informado, o bloco fica restrito ao documento. */
  documentoId?: string | null
  titulo?: string
  onCriado?: () => void
  className?: string
}) {
  const [itens, setItens] = useState<ComentarioDto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState("")
  const [visibilidade, setVisibilidade] = useState<"interna" | "compartilhada">("interna")
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const qs = new URLSearchParams({ c: competencia })
      if (documentoId) qs.set("documentoId", documentoId)
      const res = await fetch(`${ENDPOINT}?${qs.toString()}`, { cache: "no-store" })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        setItens([])
        return
      }
      const j = (await res.json()) as { comentarios: ComentarioDto[] }
      setItens(Array.isArray(j.comentarios) ? j.comentarios : [])
    } catch {
      setErro("Não foi possível carregar os comentários agora.")
      setItens([])
    } finally {
      setCarregando(false)
    }
  }, [competencia, documentoId])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const enviar = async () => {
    const corpo = texto.trim()
    if (!corpo) {
      setErro("Escreva um comentário antes de enviar.")
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competencia, documentoId, texto: corpo, visibilidade }),
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      setTexto("")
      await carregar()
      onCriado?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o comentário.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          {titulo}
        </h3>
        <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} />
          Atualizar
        </Botao>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Carregando comentários…
        </div>
      ) : itens.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-[12.5px] text-muted-foreground">
          Nenhum comentário {documentoId ? "neste documento" : "nesta competência"} ainda.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {itens.map((c) => (
            <li
              key={c.id}
              className={cn(
                "rounded-lg border p-3 text-[12.5px] text-foreground/90",
                c.visibilidade === "compartilhada"
                  ? "border-sky-500/25 bg-sky-500/5"
                  : "border-border/60 bg-muted/40",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <VisibilidadeChip visibilidade={c.visibilidade} />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatarDataHora(c.criadoEm)}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{c.texto}</p>
            </li>
          ))}
        </ul>
      )}

      {erro ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-snug text-rose-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}

      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <label className="mb-1 block text-xs font-semibold text-foreground/80" htmlFor={`cmt-${documentoId ?? competencia}`}>
          Novo comentário
        </label>
        <textarea
          id={`cmt-${documentoId ?? competencia}`}
          rows={2}
          value={texto}
          disabled={enviando}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: extrato do banco principal anexado."
          className="w-full resize-y rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-foreground/80" htmlFor={`vis-${documentoId ?? competencia}`}>
              Visibilidade
            </label>
            <select
              id={`vis-${documentoId ?? competencia}`}
              value={visibilidade}
              disabled={enviando}
              onChange={(e) => setVisibilidade(e.target.value as "interna" | "compartilhada")}
              className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[12.5px] text-foreground outline-none focus:border-primary focus:bg-card"
            >
              <option value="interna">Interno — só a sua equipe</option>
              <option value="compartilhada">Compartilhado — visível ao contador</option>
            </select>
          </div>
          <Botao variant="primary" size="sm" onClick={() => void enviar()} disabled={enviando || !texto.trim()}>
            {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Enviar comentário
          </Botao>
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Comentário <b className="text-foreground">interno</b> nunca sai para o contador externo.
          O <b className="text-foreground">compartilhado</b> aparece para o contador no portal
          externo, para os vínculos ativos desta loja.
        </p>
      </div>
    </div>
  )
}
