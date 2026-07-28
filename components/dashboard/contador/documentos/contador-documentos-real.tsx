"use client"

/**
 * Contador HUB · seção Documentos REAL (GOAL 010 · Etapa 11 + GOAL 011).
 *
 * Substitui o preview estático da aba Documentos por fluxo real:
 *  - listagem por competência (GET /api/contador/documentos);
 *  - upload DIRETO ao storage (intent → PUT assinado → complete), com SHA-256
 *    calculado no navegador e progresso real;
 *  - download autenticado (URL assinada curta), substituição versionada e
 *    exclusão soft com motivo;
 *  - GOAL 011: máquina de status real (só as transições que o papel autenticado
 *    pode executar), rejeição com motivo obrigatório em modal, `vencido` como flag
 *    derivada e comentários por documento.
 *
 * Quando o storage/env está indisponível o componente NÃO finge upload: mostra
 * estado de configuração indisponível. Tokens semânticos apenas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Replace,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import {
  normalizarStatus,
  transicoesDisponiveis,
  type StatusItem,
  type Transicao,
} from "@/lib/contador/status/matriz"
import {
  Botao,
  Overlay,
  StatusChip,
  VencidoChip,
  formatarDataHora,
  lerErroResposta,
} from "../contador-ui"
import { ContadorComentarios } from "../timeline/contador-comentarios"

/* ─────────────────────────── contratos de UI ─────────────────────────── */

type DocumentoDto = {
  id: string
  competenciaId: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  status: string
  /** Derivado no servidor (GOAL 011) — nunca é um status gravado. */
  vencido: boolean
  vencimento: string | null
  enviadoPorTipo: string
  enviadoPorId: string
  versaoDeId: string | null
  createdAt: string
  updatedAt: string
}

/** Capacidades do papel autenticado (GET /api/contador/status). Fail-closed. */
type Capacidades = { podeConferir: boolean }

type CategoriaId = "fiscal" | "financeiro" | "folha" | "juridico" | "outro"

const CATEGORIAS: { id: CategoriaId; label: string }[] = [
  { id: "fiscal", label: "Fiscal" },
  { id: "financeiro", label: "Financeiro" },
  { id: "folha", label: "Folha" },
  { id: "juridico", label: "Jurídico" },
  { id: "outro", label: "Outro" },
]

const ACCEPT = ".pdf,.xml,.csv,.xlsx,.png,.jpg,.jpeg,.ofx,.txt,.zip"
const MAX_BYTES = 25 * 1024 * 1024

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  ofx: "application/x-ofx",
  txt: "text/plain",
  zip: "application/zip",
}

/* ─────────────────────────── helpers ─────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function extDe(nome: string): string {
  const i = nome.lastIndexOf(".")
  return i > 0 ? nome.slice(i + 1).toLowerCase() : ""
}

function mimeDe(file: File): string {
  if (file.type) return file.type
  return EXT_MIME[extDe(file.name)] ?? "application/octet-stream"
}

async function sha256File(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** PUT direto ao storage com progresso real via XHR. */
function putComProgresso(
  url: string,
  file: File,
  mime: string,
  headersObrigatorios: Record<string, string>,
  onProgress: (frac: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("content-type", mime)
    // Headers que fazem parte da ASSINATURA da URL (ex.: `If-None-Match: *`, que dá
    // criação exclusiva). Omitir qualquer um deles quebra a SigV4 e o storage responde
    // 403 — por isso são repassados verbatim, sem o cliente reinterpretar.
    for (const [nome, valor] of Object.entries(headersObrigatorios ?? {})) {
      xhr.setRequestHeader(nome, valor)
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      // 412 = o objeto já existe. A URL assinada é de criação exclusiva, então este
      // é o caso "reenvio do mesmo intent", não uma falha de rede genérica.
      if (xhr.status === 412) {
        return reject(
          new Error("Este arquivo já foi enviado para esta autorização. Reinicie o envio."),
        )
      }
      reject(new Error(`Falha no envio ao storage (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error("Falha de rede no envio ao storage."))
    xhr.send(file)
  })
}

/** Alias local mantido para não reescrever os call sites do GOAL 010. */
const lerErro = lerErroResposta

/* ─────────────────────────── componente principal ─────────────────────────── */

export function ContadorDocumentosReal({ competencia }: { competencia: Competencia }) {
  const compCodigo = formatCompetencia(competencia)

  const [docs, setDocs] = useState<DocumentoDto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [substituirDe, setSubstituirDe] = useState<DocumentoDto | null>(null)
  const [detalhe, setDetalhe] = useState<DocumentoDto | null>(null)
  // Fail-closed: até o servidor responder, nenhuma transição elevada é oferecida.
  const [capacidades, setCapacidades] = useState<Capacidades>({ podeConferir: false })

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const res = await fetch("/api/contador/status", { cache: "no-store" })
        if (!res.ok) return
        const j = (await res.json()) as { capacidades?: Capacidades }
        if (vivo && j.capacidades) setCapacidades({ podeConferir: !!j.capacidades.podeConferir })
      } catch {
        // Sem capacidades → só transições básicas. O servidor decide de qualquer forma.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/documentos?c=${encodeURIComponent(compCodigo)}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        setErro(await lerErro(res))
        setDocs([])
        return
      }
      const j = (await res.json()) as { documentos: DocumentoDto[] }
      setDocs(Array.isArray(j.documentos) ? j.documentos : [])
    } catch {
      setErro("Não foi possível carregar os documentos agora.")
      setDocs([])
    } finally {
      setCarregando(false)
    }
  }, [compCodigo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const abrirNovo = () => {
    setSubstituirDe(null)
    setUploadOpen(true)
  }
  const abrirSubstituir = (doc: DocumentoDto) => {
    setSubstituirDe(doc)
    setUploadOpen(true)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Documentos</h2>
          <p className="mt-1 max-w-[64ch] text-[13px] text-muted-foreground">
            Arquivos trocados com o contador na competência de{" "}
            <b className="text-foreground">{compCodigo}</b>. Envio, download e exclusão são reais e
            registrados em auditoria.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Botao size="sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
            Atualizar
          </Botao>
          <Botao variant="primary" onClick={abrirNovo}>
            <Plus className="h-4 w-4" />
            Enviar documento
          </Botao>
        </div>
      </div>

      {erro ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-foreground">
          <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <b className="text-amber-600 dark:text-amber-400">Documentos indisponíveis.</b> {erro}
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {carregando ? (
          <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-[13px] text-muted-foreground">Carregando documentos…</div>
          </div>
        ) : docs.length === 0 && !erro ? (
          <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="text-[15px] font-semibold text-foreground">Nenhum documento nesta competência</div>
            <p className="max-w-[48ch] text-[13px] text-muted-foreground">
              Envie o primeiro arquivo (PDF, XML, CSV, XLSX, imagem, OFX, TXT ou ZIP) para começar.
            </p>
            <Botao variant="primary" className="mt-1" onClick={abrirNovo}>
              <Plus className="h-4 w-4" />
              Enviar documento
            </Botao>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Documento</th>
                  <th className="px-4 py-2.5 font-semibold">Categoria</th>
                  <th className="px-4 py-2.5 font-semibold">Tamanho</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileText className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                            {d.titulo}
                            {d.versaoDeId ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                                nova versão
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">{d.nomeArquivo}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize">{d.categoria.toLowerCase()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatBytes(d.bytes)}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusChip status={d.status} />
                        {d.vencido ? <VencidoChip /> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Botao size="sm" onClick={() => setDetalhe(d)}>
                          Detalhes
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

      {uploadOpen ? (
        <UploadModal
          competencia={compCodigo}
          substituirDe={substituirDe}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false)
            void carregar()
          }}
        />
      ) : null}

      {detalhe ? (
        <DetalheDrawer
          doc={detalhe}
          competencia={compCodigo}
          capacidades={capacidades}
          onClose={() => setDetalhe(null)}
          onSubstituir={(d) => {
            setDetalhe(null)
            abrirSubstituir(d)
          }}
          onExcluido={() => {
            setDetalhe(null)
            void carregar()
          }}
          onStatusAlterado={(atualizado) => {
            setDetalhe((atual) => (atual && atual.id === atualizado.id ? atualizado : atual))
            void carregar()
          }}
        />
      ) : null}
    </>
  )
}

/* ─────────────────────────── modal de upload ─────────────────────────── */

type FaseUpload = "form" | "hash" | "enviando" | "confirmando" | "erro"

function UploadModal({
  competencia,
  substituirDe,
  onClose,
  onDone,
}: {
  competencia: string
  substituirDe: DocumentoDto | null
  onClose: () => void
  onDone: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [titulo, setTitulo] = useState(substituirDe?.titulo ?? "")
  const [categoria, setCategoria] = useState<CategoriaId>(
    (substituirDe?.categoria.toLowerCase() as CategoriaId) || "fiscal",
  )
  const [vencimento, setVencimento] = useState("")
  const [fase, setFase] = useState<FaseUpload>("form")
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ocupado = fase === "hash" || fase === "enviando" || fase === "confirmando"

  const escolher = (f: File | null) => {
    setErro(null)
    if (f && f.size > MAX_BYTES) {
      setErro("Arquivo excede o limite de 25 MB.")
      return
    }
    if (f && !ACCEPT.includes(`.${extDe(f.name)}`)) {
      setErro("Extensão não permitida.")
      return
    }
    setFile(f)
    if (f && !titulo) setTitulo(f.name.replace(/\.[^.]+$/, ""))
  }

  const enviar = useCallback(async () => {
    if (!file) {
      setErro("Selecione um arquivo.")
      return
    }
    if (!titulo.trim()) {
      setErro("Informe um título.")
      return
    }
    setErro(null)
    const mime = mimeDe(file)
    try {
      setFase("hash")
      setProgresso(0)
      const sha256 = await sha256File(file)

      const corpoIntent = {
        competencia,
        categoria,
        titulo: titulo.trim(),
        nomeArquivo: file.name,
        mime,
        bytes: file.size,
        sha256,
        vencimento: vencimento || null,
        versaoDeId: substituirDe?.id ?? null,
      }
      const intentRes = await fetch("/api/contador/documentos/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpoIntent),
      })
      if (!intentRes.ok) throw new Error(await lerErro(intentRes))
      const intent = (await intentRes.json()) as {
        documentoId: string
        storageRef: string
        signedUrl: string
        uploadIntent: string
        headersObrigatorios?: Record<string, string>
        nomeSanitizado: string
      }

      setFase("enviando")
      await putComProgresso(
        intent.signedUrl,
        file,
        mime,
        intent.headersObrigatorios ?? {},
        setProgresso,
      )

      setFase("confirmando")
      const completeRes = await fetch("/api/contador/documentos/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // A autorização assinada é o que o servidor usa; os campos vinculados vão
          // junto só para serem CONFERIDOS contra ela. `titulo`/`vencimento` seguem
          // editáveis até a confirmação.
          uploadIntent: intent.uploadIntent,
          titulo: corpoIntent.titulo,
          vencimento: corpoIntent.vencimento,
          documentoId: intent.documentoId,
          storageRef: intent.storageRef,
          competencia: corpoIntent.competencia,
          categoria: corpoIntent.categoria,
          nomeArquivo: intent.nomeSanitizado,
          mime: corpoIntent.mime,
          bytes: corpoIntent.bytes,
          sha256: corpoIntent.sha256,
          versaoDeId: corpoIntent.versaoDeId,
        }),
      })
      if (!completeRes.ok) throw new Error(await lerErro(completeRes))
      onDone()
    } catch (e) {
      setFase("erro")
      setErro(e instanceof Error ? e.message : "Falha no envio.")
    }
  }, [file, titulo, categoria, vencimento, competencia, substituirDe, onDone])

  return (
    <Overlay onClose={ocupado ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-bold text-foreground">
            {substituirDe ? "Substituir documento" : "Enviar documento"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={ocupado}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {substituirDe ? (
          <p className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[12px] text-muted-foreground">
            Substituindo <b className="text-foreground">{substituirDe.titulo}</b>. O documento anterior é
            preservado como versão anterior.
          </p>
        ) : null}

        <div className="grid gap-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground/80">Arquivo</label>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              disabled={ocupado}
              onChange={(e) => escolher(e.target.files?.[0] ?? null)}
              className="block w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted/60 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-foreground"
            />
            {file ? (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {file.name} · {formatBytes(file.size)}
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground/80">Título</label>
            <input
              type="text"
              value={titulo}
              disabled={ocupado}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: DAS Junho, extrato bancário…"
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground/80">Categoria</label>
              <select
                value={categoria}
                disabled={ocupado}
                onChange={(e) => setCategoria(e.target.value as CategoriaId)}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground/80">Vencimento (opcional)</label>
              <input
                type="date"
                value={vencimento}
                disabled={ocupado}
                onChange={(e) => setVencimento(e.target.value)}
                className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary focus:bg-card"
              />
            </div>
          </div>

          {ocupado ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
                <span>
                  {fase === "hash"
                    ? "Calculando hash…"
                    : fase === "enviando"
                      ? "Enviando ao storage…"
                      : "Validando no servidor…"}
                </span>
                {fase === "enviando" ? <span>{Math.round(progresso * 100)}%</span> : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: fase === "enviando" ? `${Math.round(progresso * 100)}%` : "100%" }}
                />
              </div>
            </div>
          ) : null}

          {erro ? (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-rose-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-2.5">
            <Botao onClick={onClose} disabled={ocupado}>
              Cancelar
            </Botao>
            <Botao variant="primary" onClick={() => void enviar()} disabled={ocupado || !file}>
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {substituirDe ? "Substituir" : "Enviar"}
            </Botao>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

/* ─────────────────────────── drawer de detalhes ─────────────────────────── */

function DetalheDrawer({
  doc,
  competencia,
  capacidades,
  onClose,
  onSubstituir,
  onExcluido,
  onStatusAlterado,
}: {
  doc: DocumentoDto
  competencia: string
  capacidades: Capacidades
  onClose: () => void
  onSubstituir: (d: DocumentoDto) => void
  onExcluido: () => void
  onStatusAlterado: (d: DocumentoDto) => void
}) {
  const [baixando, setBaixando] = useState(false)
  const [confirmarExcluir, setConfirmarExcluir] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [transicionando, setTransicionando] = useState<string | null>(null)
  const [rejeitarAberto, setRejeitarAberto] = useState<Transicao | null>(null)
  const [recarregarComentarios, setRecarregarComentarios] = useState(0)

  /**
   * A UI só oferece o que o servidor aceitaria: matriz + capacidade do papel.
   * Status desconhecido (dado legado) → nenhuma transição, em vez de adivinhar.
   */
  const transicoes = useMemo<readonly Transicao[]>(() => {
    let status: StatusItem
    try {
      status = normalizarStatus(doc.status)
    } catch {
      return []
    }
    return transicoesDisponiveis(status, capacidades)
  }, [doc.status, capacidades])

  const aplicarTransicao = async (t: Transicao, motivoTexto?: string) => {
    setTransicionando(t.para)
    setErro(null)
    try {
      const res = await fetch("/api/contador/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentoId: doc.id,
          para: t.para,
          ...(t.exigeMotivo ? { motivo: motivoTexto ?? "" } : {}),
        }),
      })
      if (!res.ok) throw new Error(await lerErro(res))
      const j = (await res.json()) as { documento: { status: string; vencido: boolean; atualizadoEm: string } }
      setRejeitarAberto(null)
      // Rejeição grava o motivo como comentário interno — recarrega a lista.
      if (t.exigeMotivo) setRecarregarComentarios((n) => n + 1)
      onStatusAlterado({
        ...doc,
        status: j.documento.status,
        vencido: j.documento.vencido,
        updatedAt: j.documento.atualizadoEm,
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao alterar o status.")
    } finally {
      setTransicionando(null)
    }
  }

  const baixar = async () => {
    setBaixando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/documentos/${encodeURIComponent(doc.id)}/download`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(await lerErro(res))
      const j = (await res.json()) as { url: string }
      const a = document.createElement("a")
      a.href = j.url
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar o download.")
    } finally {
      setBaixando(false)
    }
  }

  const excluir = async () => {
    if (!motivo.trim()) {
      setErro("Informe o motivo da exclusão.")
      return
    }
    setExcluindo(true)
    setErro(null)
    try {
      const res = await fetch(`/api/contador/documentos/${encodeURIComponent(doc.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      })
      if (!res.ok) throw new Error(await lerErro(res))
      onExcluido()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao excluir.")
      setExcluindo(false)
    }
  }

  return (
    <Overlay onClose={onClose} alinhar="right">
      <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="min-w-0 truncate text-[15px] font-bold text-foreground">{doc.titulo}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── status atual + transições permitidas a ESTE papel (GOAL 011) ── */}
          <section className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Status atual</span>
              <StatusChip status={doc.status} />
              {doc.vencido ? <VencidoChip /> : null}
            </div>
            {transicoes.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {doc.status.toUpperCase() === "RESOLVIDO"
                  ? "Estado final — não há próxima transição."
                  : "Nenhuma transição disponível para o seu papel neste status."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transicoes.map((t) => (
                  <Botao
                    key={`${t.de}-${t.para}`}
                    size="sm"
                    variant={t.acao === "rejeitar" ? "danger" : "primary"}
                    disabled={transicionando !== null}
                    onClick={() =>
                      t.exigeMotivo ? setRejeitarAberto(t) : void aplicarTransicao(t)
                    }
                  >
                    {transicionando === t.para ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t.rotulo}
                  </Botao>
                ))}
              </div>
            )}
            {!capacidades.podeConferir ? (
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Conferir e resolver exigem papel financeiro ou administrador.
              </p>
            ) : null}
          </section>

          <dl className="grid gap-3 text-[13px]">
            <Kv label="Arquivo" value={doc.nomeArquivo} />
            <Kv label="Categoria" value={doc.categoria.toLowerCase()} capitalize />
            <Kv label="Tamanho" value={formatBytes(doc.bytes)} mono />
            <Kv label="Tipo (MIME)" value={doc.mime} mono />
            <Kv label="Vencimento" value={doc.vencimento ? doc.vencimento.slice(0, 10) : "—"} mono />
            <Kv label="Enviado em" value={formatarDataHora(doc.createdAt)} mono />
            {doc.versaoDeId ? <Kv label="Substitui" value={doc.versaoDeId} mono /> : null}
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">SHA-256</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-foreground">{doc.sha256}</dd>
            </div>
          </dl>

          {erro ? (
            <p className="mt-4 flex items-start gap-2 text-[12px] text-rose-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}

          {confirmarExcluir ? (
            <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <label className="mb-1 block text-xs font-semibold text-foreground/80">
                Motivo da exclusão (obrigatório)
              </label>
              <textarea
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: arquivo enviado por engano"
                className="w-full resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-rose-500 focus:bg-card"
              />
            </div>
          ) : null}

          <div className="mt-5 border-t border-border pt-4">
            <ContadorComentarios
              key={recarregarComentarios}
              competencia={competencia}
              documentoId={doc.id}
              titulo="Comentários deste documento"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4">
          <Botao onClick={() => void baixar()} disabled={baixando}>
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Baixar
          </Botao>
          <Botao onClick={() => onSubstituir(doc)}>
            <Replace className="h-4 w-4" />
            Substituir
          </Botao>
          {confirmarExcluir ? (
            <Botao variant="danger" onClick={() => void excluir()} disabled={excluindo}>
              {excluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Confirmar exclusão
            </Botao>
          ) : (
            <Botao variant="danger" className="ml-auto" onClick={() => setConfirmarExcluir(true)}>
              <Trash2 className="h-4 w-4" />
              Excluir
            </Botao>
          )}
        </div>
      </div>

      {rejeitarAberto ? (
        <RejeitarModal
          transicao={rejeitarAberto}
          ocupado={transicionando !== null}
          onCancelar={() => setRejeitarAberto(null)}
          onConfirmar={(texto) => void aplicarTransicao(rejeitarAberto, texto)}
        />
      ) : null}
    </Overlay>
  )
}

/* ─────────────────────────── modal de rejeição ─────────────────────────── */

/**
 * Rejeição SEMPRE passa por aqui: o motivo é obrigatório e vira um comentário
 * interno imutável, referenciado pelo evento `status_alterado`. O botão só habilita
 * com texto — e o servidor recusa de novo se vier vazio (422).
 */
function RejeitarModal({
  transicao,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  transicao: Transicao
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: (motivo: string) => void
}) {
  const [texto, setTexto] = useState("")
  const vazio = !texto.trim()

  return (
    <Overlay onClose={ocupado ? undefined : onCancelar}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h3 className="mb-1 text-[16px] font-bold text-foreground">Rejeitar documento</h3>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          O documento volta para <b className="text-foreground">pendente</b>. O motivo é obrigatório
          e fica registrado como comentário interno na trilha da competência.
        </p>
        <label className="mb-1 block text-xs font-semibold text-foreground/80" htmlFor="motivo-rejeicao">
          Motivo da rejeição (obrigatório)
        </label>
        <textarea
          id="motivo-rejeicao"
          rows={3}
          value={texto}
          disabled={ocupado}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: extrato incompleto — faltam os dias 20 a 30."
          className="w-full resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none focus:border-rose-500 focus:bg-card"
        />
        <div className="mt-3 flex justify-end gap-2.5">
          <Botao onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao
            variant="danger"
            disabled={ocupado || vazio}
            title={vazio ? "Informe o motivo para rejeitar." : undefined}
            onClick={() => onConfirmar(texto.trim())}
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            {transicao.rotulo}
          </Botao>
        </div>
      </div>
    </Overlay>
  )
}

function Kv({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string
  value: string
  mono?: boolean
  capitalize?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-right text-[13px] text-foreground",
          mono && "font-mono text-[12px]",
          capitalize && "capitalize",
        )}
      >
        {value}
      </dd>
    </div>
  )
}
