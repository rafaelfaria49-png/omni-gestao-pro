"use client"

/**
 * Portal externo read-only — linha de documento com as ações do contador (GOAL 015).
 *
 * Chama as rotas `/api/contador-externo/**` (mesmo caminho autorizado das APIs, já
 * coberto por teste): a loja vai no PATH, o corpo é vazio e o cookie externo é o
 * único credenciamento. A URL assinada nunca é persistida — abre e é descartada.
 *
 * `podeConferir` vem do PAPEL resolvido no servidor: com LEITURA o botão sequer é
 * renderizado (e a rota recusaria de qualquer forma — a UI não é o gate).
 */
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Props = Readonly<{
  loja: string
  documentoId: string
  titulo: string
  nomeArquivo: string
  categoria: string
  status: string
  vencido: boolean
  tamanho: string
  podeConferir: boolean
}>

const BASE = "/api/contador-externo/lojas"

export function DocumentoItem(props: Props) {
  const [ocupado, setOcupado] = useState<null | "download" | "conferir">(null)
  const [erro, setErro] = useState<string | null>(null)
  const [conferido, setConferido] = useState(props.status === "CONFERIDO")

  const raiz = `${BASE}/${encodeURIComponent(props.loja)}/documentos/${encodeURIComponent(props.documentoId)}`

  async function postar(url: string): Promise<Record<string, unknown> | null> {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    })
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (!r.ok || !json?.ok) {
      setErro(
        typeof json?.mensagem === "string"
          ? json.mensagem
          : "Não foi possível concluir agora. Tente novamente.",
      )
      return null
    }
    return json
  }

  async function baixar() {
    setOcupado("download")
    setErro(null)
    const json = await postar(`${raiz}/download`)
    setOcupado(null)
    const download = json?.download as { signedUrl?: string } | undefined
    if (download?.signedUrl) window.open(download.signedUrl, "_blank", "noopener,noreferrer")
  }

  async function conferir() {
    setOcupado("conferir")
    setErro(null)
    const json = await postar(`${raiz}/conferir`)
    setOcupado(null)
    if (json) setConferido(true)
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{props.titulo}</p>
          <p className="truncate text-xs text-muted-foreground">
            {props.nomeArquivo} · {props.categoria} · {props.tamanho}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {conferido ? <Badge variant="secondary">conferido</Badge> : null}
          {props.vencido ? <Badge variant="destructive">vencido</Badge> : null}
          <Button size="sm" variant="outline" onClick={baixar} disabled={ocupado !== null}>
            {ocupado === "download" ? "Abrindo…" : "Baixar"}
          </Button>
          {props.podeConferir && !conferido ? (
            <Button size="sm" onClick={conferir} disabled={ocupado !== null}>
              {ocupado === "conferir" ? "Marcando…" : "Marcar conferido"}
            </Button>
          ) : null}
        </div>
      </div>
      {erro ? <p className="text-xs text-destructive">{erro}</p> : null}
    </li>
  )
}
