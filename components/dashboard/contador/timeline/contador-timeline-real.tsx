"use client"

/**
 * Contador HUB · seção Timeline REAL (GOAL 011).
 *
 * Substitui a lista estática `TIMELINE_ITEMS` e a "conversa" mockada do preview
 * pela projeção real de `ContadorEvento` + `ContadorComentario` da competência
 * (GET /api/contador/timeline), ao lado da caixa de comentários real.
 *
 * O componente é SOMENTE LEITURA sobre a trilha: eventos não são editáveis nem
 * apagáveis. Quando não há atividade, mostra estado vazio honesto — nunca preenche
 * a tela com exemplo fictício.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Clock, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { Botao, VisibilidadeChip, formatarDataHora, lerErroResposta } from "../contador-ui"
import { ContadorComentarios } from "./contador-comentarios"

type TimelineItem = {
  id: string
  origem: "evento" | "comentario"
  tipo: string
  em: string
  atorTipo: string
  atorId: string
  entidade: string | null
  entidadeId: string | null
  visibilidade: "interna" | "compartilhada" | null
  texto: string | null
  detalhes: Record<string, string | number | boolean>
}

/** Rótulo humano por tipo de evento. Tipo desconhecido cai no próprio tipo (honesto). */
const ROTULO_EVENTO: Record<string, string> = {
  competencia_criada: "Competência aberta",
  documento_enviado: "Documento enviado",
  documento_substituido: "Documento substituído",
  documento_download_autorizado: "Download autorizado",
  documento_excluido: "Documento excluído",
  status_alterado: "Status alterado",
  comentario_criado: "Comentário registrado",
}

const ATOR_ROTULO: Record<string, string> = {
  sistema: "Sistema",
  interno: "Equipe da loja",
  externo: "Contador",
}

function rotuloDe(item: TimelineItem): string {
  if (item.origem === "comentario") return "Comentário"
  return ROTULO_EVENTO[item.tipo] ?? item.tipo
}

/** Detalhe legível derivado só de campos já saneados pelo DTO. */
function descricaoDe(item: TimelineItem): string | null {
  if (item.origem === "comentario") return item.texto
  const d = item.detalhes
  if (item.tipo === "status_alterado") {
    const de = String(d.statusAnterior ?? "").toLowerCase()
    const para = String(d.statusNovo ?? "").toLowerCase()
    const motivo = typeof d.motivoLen === "number" ? " · motivo registrado como comentário interno" : ""
    return de && para ? `${de} → ${para}${motivo}` : null
  }
  if (item.tipo === "documento_enviado" || item.tipo === "documento_substituido") {
    const cat = d.categoria ? String(d.categoria) : null
    return cat ? `categoria ${cat}` : null
  }
  if (item.tipo === "comentario_criado") {
    return d.visibilidade === "compartilhada" ? "compartilhado com o contador" : "interno"
  }
  return null
}

export function ContadorTimelineReal({ competencia }: { competencia: Competencia }) {
  const compCodigo = formatCompetencia(competencia)
  const [itens, setItens] = useState<TimelineItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/timeline?c=${encodeURIComponent(compCodigo)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        setItens([])
        return
      }
      const j = (await res.json()) as { itens: TimelineItem[] }
      setItens(Array.isArray(j.itens) ? j.itens : [])
    } catch {
      setErro("Não foi possível carregar a atividade desta competência agora.")
      setItens([])
    } finally {
      setCarregando(false)
    }
  }, [compCodigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Timeline / atividade</h2>
          <p className="mt-1 max-w-[64ch] text-[13px] text-muted-foreground">
            Trilha real de <b className="text-foreground">{compCodigo}</b>: envios, downloads,
            substituições, exclusões, mudanças de status e comentários. Registros são
            append-only — não podem ser editados nem apagados.
          </p>
        </div>
        <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
          Atualizar
        </Botao>
      </div>

      {erro ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Atividade indisponível.</b> {erro}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
          {carregando ? (
            <div className="grid place-items-center gap-2 px-4 py-10 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="text-[13px] text-muted-foreground">Carregando atividade…</div>
            </div>
          ) : itens.length === 0 && !erro ? (
            <div className="grid place-items-center gap-2 px-4 py-10 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Clock className="h-5 w-5" />
              </div>
              <div className="text-[15px] font-semibold text-foreground">Nenhuma atividade nesta competência</div>
              <p className="max-w-[44ch] text-[13px] text-muted-foreground">
                Envie um documento ou registre um comentário: cada ação aparece aqui com data,
                autor e detalhe.
              </p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {itens.map((t, i) => {
                const descricao = descricaoDe(t)
                return (
                  <li key={t.id} className="relative pb-4 pl-7 last:pb-0">
                    {i < itens.length - 1 ? (
                      <span className="absolute bottom-0 left-[7px] top-4 w-0.5 bg-border" />
                    ) : null}
                    <span
                      className={cn(
                        "absolute left-0 top-1 grid h-4 w-4 place-items-center rounded-full border-2 bg-card",
                        t.origem === "comentario" ? "border-sky-500" : "border-primary",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1 w-1 rounded-full",
                          t.origem === "comentario" ? "bg-sky-500" : "bg-primary",
                        )}
                      />
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{rotuloDe(t)}</span>
                      {t.visibilidade ? <VisibilidadeChip visibilidade={t.visibilidade} /> : null}
                    </div>
                    {descricao ? (
                      <div className="whitespace-pre-wrap break-words text-[13px] text-foreground/80">
                        {descricao}
                      </div>
                    ) : null}
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {formatarDataHora(t.em)} · {ATOR_ROTULO[t.atorTipo] ?? t.atorTipo}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
          <ContadorComentarios
            competencia={compCodigo}
            titulo="Comentários da competência"
            onCriado={() => void carregar()}
          />
        </div>
      </div>
    </>
  )
}
