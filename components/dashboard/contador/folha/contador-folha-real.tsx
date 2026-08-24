"use client"

/**
 * Contador HUB · seção Folha & DP REAL (GOAL 023).
 *
 * Substitui o preview com funcionários fictícios por uma
 * visão do domínio que JÁ existe: os documentos reais de categoria `folha` da
 * competência (GOAL 010), lidos por `GET /api/contador/documentos?c=…&categoria=folha`.
 *
 * Fora do escopo — e o texto da tela diz isso, não o esconde: cálculo de folha,
 * geração de holerite, encargos, eSocial, ponto e cadastro de colaboradores. Não
 * existe schema de Pessoas/RH e este GOAL não cria nenhum.
 *
 * O envio de arquivo continua morando na aba Documentos (fluxo real, com intent
 * assinado). Aqui não há upload próprio — apenas o atalho para lá.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Download, FileText, Loader2, RefreshCw, Upload } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { Botao, StatusChip, VencidoChip, formatarDataHora, lerErroResposta } from "../contador-ui"

/** Subconjunto do DTO de documentos consumido por esta aba (mesmo contrato do GOAL 010). */
type DocumentoFolhaDto = {
  id: string
  categoria: string
  titulo: string
  nomeArquivo: string
  bytes: number
  status: string
  vencido: boolean
  createdAt: string
}

/** Categoria canônica do domínio de documentos (`lib/contador/documentos/service.ts`). */
const CATEGORIA_FOLHA = "folha"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function ContadorFolhaReal({
  competencia,
  onIrParaDocumentos,
}: {
  competencia: Competencia
  /** Atalho para a aba Documentos, onde o envio real acontece. */
  onIrParaDocumentos: () => void
}) {
  const compCodigo = formatCompetencia(competencia)

  const [docs, setDocs] = useState<DocumentoFolhaDto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [baixandoId, setBaixandoId] = useState<string | null>(null)
  const [erroDownload, setErroDownload] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(
        `/api/contador/documentos?c=${encodeURIComponent(compCodigo)}&categoria=${CATEGORIA_FOLHA}`,
        { cache: "no-store" },
      )
      if (!res.ok) {
        setErro(await lerErroResposta(res))
        setDocs([])
        return
      }
      const j = (await res.json()) as { documentos: DocumentoFolhaDto[] }
      setDocs(Array.isArray(j.documentos) ? j.documentos : [])
    } catch {
      setErro("Não foi possível carregar os documentos de folha agora.")
      setDocs([])
    } finally {
      setCarregando(false)
    }
  }, [compCodigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Mesmo fluxo da aba Documentos: POST autoriza e devolve URL assinada curta. */
  const baixar = async (doc: DocumentoFolhaDto) => {
    setBaixandoId(doc.id)
    setErroDownload(null)
    try {
      const res = await fetch(`/api/contador/documentos/${encodeURIComponent(doc.id)}/download`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(await lerErroResposta(res))
      const j = (await res.json()) as { url: string }
      const a = document.createElement("a")
      a.href = j.url
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setErroDownload(e instanceof Error ? e.message : "Falha ao gerar o download.")
    } finally {
      setBaixandoId(null)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Folha &amp; DP</h2>
          <p className="mt-1 max-w-[64ch] text-[13px] text-muted-foreground">
            Documentos de folha da competência de <b className="text-foreground">{compCodigo}</b> —
            os mesmos arquivos reais da aba Documentos, filtrados pela categoria{" "}
            <b className="text-foreground">Folha</b>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
            Atualizar
          </Botao>
          <Botao variant="primary" onClick={onIrParaDocumentos}>
            <Upload className="h-4 w-4" />
            Enviar em Documentos
          </Botao>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-[12.5px] leading-relaxed text-foreground/85">
        <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted-foreground" />
        <div>
          <b className="text-foreground">O que esta aba não faz.</b> O OmniGestão não calcula folha,
          não gera holerite, não apura encargos, não transmite eSocial/FGTS, não controla ponto e não
          mantém cadastro de colaboradores. Ela existe para guardar e entregar ao contador os
          arquivos de folha da competência.
        </div>
      </div>

      {erro ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Documentos de folha indisponíveis.</b>{" "}
            {erro}
          </div>
        </div>
      ) : null}

      {erroDownload ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Download não autorizado.</b>{" "}
            {erroDownload}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {carregando ? (
          <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-[13px] text-muted-foreground">Carregando documentos de folha…</div>
          </div>
        ) : docs.length === 0 && !erro ? (
          <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="text-[15px] font-semibold text-foreground">
              Nenhum documento de folha em {compCodigo}
            </div>
            <p className="max-w-[52ch] text-[13px] text-muted-foreground">
              Os documentos de folha enviados na aba Documentos com a categoria{" "}
              <b className="text-foreground">Folha</b> — holerites recebidos do contador, guias de
              FGTS/INSS, resumo da folha, recibos — aparecem aqui automaticamente.
            </p>
            <Botao variant="primary" className="mt-1" onClick={onIrParaDocumentos}>
              <Upload className="h-4 w-4" />
              Enviar em Documentos
            </Botao>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Documento</th>
                  <th className="px-4 py-2.5 font-semibold">Competência</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Enviado em</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileText className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="font-semibold text-foreground">{d.titulo}</span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {d.nomeArquivo} · {formatBytes(d.bytes)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{compCodigo}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip status={d.status} />
                        {d.vencido ? <VencidoChip /> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{formatarDataHora(d.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Botao size="sm" onClick={() => void baixar(d)} disabled={baixandoId === d.id}>
                          {baixandoId === d.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          Baixar
                        </Botao>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
