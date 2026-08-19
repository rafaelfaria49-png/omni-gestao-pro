"use client"

/**
 * Contador HUB · central real de avisos (GOAL 017).
 *
 * GET inicial é somente leitura. «Atualizar avisos» chama POST /avaliar.
 * Sem botão Enviar. Rascunho = copiar.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Bell, Check, Copy, FileText, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { Botao, lerErroResposta } from "../contador-ui"

type Severidade = "baixa" | "media" | "alta"

type Aviso = {
  id: string
  regra: string
  origem: string
  severidade: Severidade
  competencia: string
  alvo: string
  titulo: string
  prazo: string | null
  janela: string
  tratado: boolean
  materializado: boolean
}

type Rascunho = {
  estado: "rascunho"
  idioma: "pt-BR"
  acao: "copiar"
  envio: "proibido"
  texto: string
}

const ROTULO_REGRA: Record<string, string> = {
  documento_pendente: "Documento pendente",
  fechamento_proximo: "Fechamento próximo",
  guia_vencendo: "Guia vencendo",
  guia_vencida: "Guia vencida",
  pacote_com_pendencias: "Pacote com pendências",
  alteracao_pos_fechamento: "Alteração após fechamento",
}

const SEV_CLASS: Record<Severidade, string> = {
  alta: "border-rose-500/30 text-rose-500",
  media: "border-amber-500/30 text-amber-600 dark:text-amber-400",
  baixa: "border-sky-500/30 text-sky-500",
}

function rotuloRegra(regra: string): string {
  return ROTULO_REGRA[regra] ?? regra
}

export function ContadorAvisosReal({ competencia }: { competencia: Competencia }) {
  const codigo = formatCompetencia(competencia)
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [rascunhoPorId, setRascunhoPorId] = useState<Record<string, Rascunho>>({})
  const [copiado, setCopiado] = useState<string | null>(null)

  const aplicarLista = (lista: unknown) => {
    setAvisos(Array.isArray(lista) ? (lista as Aviso[]) : [])
  }

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/notificacoes?c=${encodeURIComponent(codigo)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        setAvisos([])
        return
      }
      const j = (await res.json()) as { avisos?: Aviso[] }
      aplicarLista(j.avisos)
    } catch {
      setErro("Não foi possível carregar os avisos desta competência agora.")
      setAvisos([])
    } finally {
      setCarregando(false)
    }
  }, [codigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function atualizarAvisos() {
    setAtualizando(true)
    setErro(null)
    try {
      const res = await fetch("/api/contador/notificacoes/avaliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: codigo }),
      })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        return
      }
      const j = (await res.json()) as { avisos?: Aviso[] }
      aplicarLista(j.avisos)
    } catch {
      setErro("Não foi possível atualizar os avisos agora.")
    } finally {
      setAtualizando(false)
    }
  }

  async function marcarTratado(id: string) {
    setErro(null)
    try {
      const res = await fetch(`/api/contador/notificacoes/${encodeURIComponent(id)}/tratar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: codigo }),
      })
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        return
      }
      setAvisos((prev) => prev.filter((a) => a.id !== id))
      setRascunhoPorId((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch {
      setErro("Não foi possível marcar o aviso como tratado.")
    }
  }

  async function gerarRascunho(id: string) {
    setErro(null)
    try {
      const res = await fetch(
        `/api/contador/notificacoes/${encodeURIComponent(id)}/rascunho?c=${encodeURIComponent(codigo)}`,
        { cache: "no-store" },
      )
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        return
      }
      const j = (await res.json()) as { rascunho?: Rascunho }
      if (j.rascunho) {
        setRascunhoPorId((prev) => ({ ...prev, [id]: j.rascunho as Rascunho }))
      }
    } catch {
      setErro("Não foi possível gerar o rascunho.")
    }
  }

  async function copiarRascunho(id: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(id)
      window.setTimeout(() => setCopiado(null), 1600)
    } catch {
      setErro("Não foi possível copiar o rascunho.")
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell className="h-4 w-4 shrink-0" />
            Avisos da competência
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Alertas internos de <b className="text-foreground">{codigo}</b>. Sem envio externo.
            Vencimentos e dados da guia são informados pelo responsável.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando || atualizando}>
            <RefreshCw className={cn("h-3.5 w-3.5", carregando && "animate-spin")} />
            Recarregar
          </Botao>
          <Botao
            size="sm"
            variant="primary"
            onClick={() => void atualizarAvisos()}
            disabled={carregando || atualizando}
          >
            {atualizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Atualizar avisos
          </Botao>
        </div>
      </div>

      {erro ? (
        <div className="mb-3 flex min-w-0 items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{erro}</span>
        </div>
      ) : null}

      {carregando ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando avisos…
        </div>
      ) : avisos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          Nenhum aviso ativo nesta competência.
        </div>
      ) : (
        <div className="grid min-w-0 gap-2.5">
          {avisos.map((a) => {
            const rascunho = rascunhoPorId[a.id]
            return (
              <div
                key={a.id}
                className={cn("min-w-0 rounded-lg border bg-card p-3", SEV_CLASS[a.severidade])}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="block font-mono text-[9px] font-semibold uppercase tracking-wider">
                      {a.severidade} · {a.origem} · {rotuloRegra(a.regra)}
                    </span>
                    <div className="text-[13px] font-semibold text-foreground">{a.titulo}</div>
                    <div className="text-xs text-muted-foreground">
                      Competência {a.competencia}
                      {a.prazo ? ` · prazo ${a.prazo}` : ""}
                      {a.origem === "agenda" ? " · informado pelo responsável" : ""}
                    </div>
                    <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                      <Botao size="sm" onClick={() => void marcarTratado(a.id)}>
                        <Check className="h-3.5 w-3.5" />
                        Marcar tratado
                      </Botao>
                      <Botao size="sm" onClick={() => void gerarRascunho(a.id)}>
                        <FileText className="h-3.5 w-3.5" />
                        Gerar rascunho
                      </Botao>
                      {rascunho ? (
                        <Botao size="sm" variant="primary" onClick={() => void copiarRascunho(a.id, rascunho.texto)}>
                          <Copy className="h-3.5 w-3.5" />
                          {copiado === a.id ? "Copiado" : "Copiar rascunho"}
                        </Botao>
                      ) : null}
                    </div>
                    {rascunho ? (
                      <pre className="mt-2 max-h-40 min-w-0 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] text-foreground">
                        {rascunho.texto}
                      </pre>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
