"use client"

/**
 * Portal externo read-only — linha de pacote: baixar e confirmar recebimento
 * (GOAL 015).
 *
 * A confirmação é IDEMPOTENTE no servidor (mesma versão → mesmo `confirmadoEm`,
 * um único evento). A UI reflete isso: reconfirmar não duplica nada, então o
 * botão apenas passa a exibir a confirmação já registrada.
 *
 * Confirmar recebimento não exige o papel CONFERENCIA — quem tem LEITURA também
 * confirma que recebeu o pacote (a regra vive no domínio, não aqui).
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"

type Props = Readonly<{
  loja: string
  competencia: string
  versao: number
  geradoEm: string
  tamanho: string
}>

const BASE = "/api/contador-externo/lojas"

export function PacoteItem(props: Props) {
  const [ocupado, setOcupado] = useState<null | "download" | "confirmar">(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmadoEm, setConfirmadoEm] = useState<string | null>(null)

  const raiz = `${BASE}/${encodeURIComponent(props.loja)}/pacotes`
  const corpo = JSON.stringify({ competencia: props.competencia, versao: props.versao })

  async function postar(url: string): Promise<Record<string, unknown> | null> {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: corpo,
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
    const pacote = json?.pacote as { url?: string } | undefined
    if (pacote?.url) window.open(pacote.url, "_blank", "noopener,noreferrer")
  }

  async function confirmar() {
    setOcupado("confirmar")
    setErro(null)
    const json = await postar(`${raiz}/confirmar`)
    setOcupado(null)
    const rec = json?.recebimento as { confirmadoEm?: string } | undefined
    if (rec?.confirmadoEm) {
      setConfirmadoEm(
        new Date(rec.confirmadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      )
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Versão {props.versao}</p>
          <p className="truncate text-xs text-muted-foreground">
            gerado em {props.geradoEm} · {props.tamanho}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={baixar} disabled={ocupado !== null}>
            {ocupado === "download" ? "Abrindo…" : "Baixar"}
          </Button>
          <Button size="sm" onClick={confirmar} disabled={ocupado !== null}>
            {ocupado === "confirmar" ? "Confirmando…" : "Confirmar recebimento"}
          </Button>
        </div>
      </div>
      {confirmadoEm ? (
        <p className="text-xs text-muted-foreground">Recebimento confirmado em {confirmadoEm}.</p>
      ) : null}
      {erro ? <p className="text-xs text-destructive">{erro}</p> : null}
    </li>
  )
}
