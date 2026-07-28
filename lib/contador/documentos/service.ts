/**
 * Contador HUB · Documentos — serviço de orquestração (GOAL 010).
 *
 * PURO em relação a IO: depende apenas de duas portas injetadas — `storage`
 * (StorageDocumentosPort) e `repo` (DocumentosRepo). A implementação Prisma da
 * `repo` vive em `repo-prisma.ts`; os testes injetam fakes in-memory. Assim toda a
 * regra (validação, idempotência, versionamento, soft delete, eventos) é testável
 * sem banco nem Supabase reais.
 *
 * Escreve SOMENTE em `ContadorDocumento`, `ContadorCompetencia` (via getOrCreate) e
 * `ContadorEvento`. Nunca toca Financeiro, PDV, Operações ou Fiscal.
 */
import { randomUUID } from "node:crypto"
import {
  formatCompetencia,
  parseCompetencia,
  type Competencia,
} from "@/lib/contador/competencia"
import { estaVencido } from "@/lib/contador/status/vencido"
import { normalizarSha256, sha256HexDeBuffer, hashesIguais } from "./hash"
import {
  DocumentoValidacaoError,
  montarStorageRef,
  sanitizarNomeArquivo,
  storageRefPertence,
  validarConteudoReal,
  validarExtensao,
  validarMimeDeclarado,
  validarTamanho,
} from "./validacao"
import type { StorageDocumentosPort } from "./storage-types"

/* ───────────────────────────── constantes de domínio ───────────────────────────── */

export const EVENTO_DOCUMENTO_ENVIADO = "documento_enviado" as const
export const EVENTO_DOCUMENTO_SUBSTITUIDO = "documento_substituido" as const
export const EVENTO_DOCUMENTO_DOWNLOAD = "documento_download_autorizado" as const
export const EVENTO_DOCUMENTO_EXCLUIDO = "documento_excluido" as const

export const ORIGEM_DOCUMENTOS = "contador.documentos" as const
/** Quem envia pelo HUB interno é sempre parte interna (lojista/equipe). */
export const ENVIADO_POR_TIPO_INTERNO = "interno" as const

export type CategoriaDocumento = "fiscal" | "financeiro" | "folha" | "juridico" | "outro"
const CATEGORIAS = new Set<CategoriaDocumento>(["fiscal", "financeiro", "folha", "juridico", "outro"])

/** Enum name do Prisma para cada categoria canônica. */
export const CATEGORIA_PRISMA: Record<CategoriaDocumento, string> = {
  fiscal: "FISCAL",
  financeiro: "FINANCEIRO",
  folha: "FOLHA",
  juridico: "JURIDICO",
  outro: "OUTRO",
}

const STATUS_COMPETENCIA_FECHADA = "FECHADA"

/* ───────────────────────────── tipos de fronteira ───────────────────────────── */

/** Escopo mínimo consumido pelo serviço (produzido por `requireContadorScope`). */
export type EscopoDocumentos = Readonly<{ storeId: string; userId: string }>

/** Linha de documento retornada pela `repo` (sem PII; `storageRef` é interno). */
export type DocumentoRow = {
  id: string
  competenciaId: string
  storeId: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  storageRef: string
  status: string
  vencimento: Date | null
  enviadoPorTipo: string
  enviadoPorId: string
  versaoDeId: string | null
  excluidoEm: Date | null
  excluidoPorId: string | null
  excluidoMotivo: string | null
  createdAt: Date
  updatedAt: Date
}

export type CompetenciaRef = { id: string; status: string; ano: number; mes: number }

export type FiltrosListagem = Readonly<{
  categoria?: CategoriaDocumento
  status?: string
  titulo?: string
  vencimentoAte?: Date
}>

/** Repositório de persistência — porta injetável (Prisma em produção, fake em teste). */
export interface DocumentosRepo {
  getOrCreateCompetencia(storeId: string, comp: { ano: number; mes: number }): Promise<CompetenciaRef>
  acharCompetencia(storeId: string, comp: { ano: number; mes: number }): Promise<CompetenciaRef | null>
  acharDocumentoPorId(id: string): Promise<DocumentoRow | null>
  acharDocumentoDaLoja(id: string, storeId: string): Promise<DocumentoRow | null>
  listarDocumentos(args: {
    competenciaId: string
    storeId: string
    incluirExcluidos: boolean
    filtros: FiltrosListagem
  }): Promise<DocumentoRow[]>
  criarDocumentoComEvento(args: {
    documento: NovoDocumento
    evento: NovoEvento
  }): Promise<DocumentoRow>
  softDeleteComEvento(args: {
    id: string
    storeId: string
    excluidoPorId: string
    excluidoMotivo: string
    evento: NovoEvento
  }): Promise<DocumentoRow>
  registrarEvento(evento: NovoEvento): Promise<void>
}

export type NovoDocumento = Readonly<{
  id: string
  competenciaId: string
  storeId: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  storageRef: string
  status: string
  vencimento: Date | null
  enviadoPorTipo: string
  enviadoPorId: string
  versaoDeId: string | null
}>

export type NovoEvento = Readonly<{
  storeId: string
  competenciaId: string | null
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string | null
  entidadeId: string | null
  origem: string
  metadata: Record<string, unknown>
}>

export type Deps = Readonly<{ storage: StorageDocumentosPort; repo: DocumentosRepo }>

/** Erros de fluxo (mapeados a HTTP nas rotas). */
export class CompetenciaFechadaError extends Error {
  readonly code = "COMPETENCIA_FECHADA" as const
  constructor() {
    super("A competência está fechada; não aceita novos documentos.")
    this.name = "CompetenciaFechadaError"
  }
}
export class DocumentoConflitoError extends Error {
  readonly code = "DOCUMENTO_CONFLITO" as const
  constructor(message: string) {
    super(message)
    this.name = "DocumentoConflitoError"
  }
}
export class DocumentoNaoEncontradoError extends Error {
  readonly code = "DOCUMENTO_NAO_ENCONTRADO" as const
  constructor() {
    super("Documento não encontrado nesta unidade.")
    this.name = "DocumentoNaoEncontradoError"
  }
}

/* ───────────────────────────── helpers puros ───────────────────────────── */

function competenciaOuErro(codigo: unknown): Competencia {
  const c = parseCompetencia(codigo)
  if (!c) throw new DocumentoValidacaoError("competencia", "Competência inválida. Use AAAA-MM.")
  return c
}

function categoriaOuErro(valor: unknown): CategoriaDocumento {
  const v = typeof valor === "string" ? (valor.trim().toLowerCase() as CategoriaDocumento) : ""
  if (!CATEGORIAS.has(v as CategoriaDocumento)) {
    throw new DocumentoValidacaoError("categoria", "Categoria inválida.")
  }
  return v as CategoriaDocumento
}

function tituloOuErro(valor: unknown): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  if (!t) throw new DocumentoValidacaoError("titulo", "Título é obrigatório.")
  if (t.length > 200) throw new DocumentoValidacaoError("titulo", "Título muito longo.")
  return t
}

function vencimentoOpcional(valor: unknown): Date | null {
  if (valor == null || valor === "") return null
  const d = valor instanceof Date ? valor : new Date(String(valor))
  if (Number.isNaN(d.getTime())) throw new DocumentoValidacaoError("vencimento", "Vencimento inválido.")
  return d
}

/** Gera um id de documento seguro para path e único. */
export function gerarDocumentoId(): string {
  return `doc-${randomUUID()}`
}

/* ───────────────────────────── ETAPA 5 — upload intent ───────────────────────────── */

export type UploadIntentEntrada = Readonly<{
  competencia: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  vencimento?: unknown
  versaoDeId?: string | null
}>

export type UploadIntentResultado = Readonly<{
  documentoId: string
  competenciaId: string
  competencia: string
  storageRef: string
  nomeSanitizado: string
  signedUrl: string
  token: string
  expiresInSec: number
}>

/**
 * Valida a intenção de upload e devolve a autorização assinada. NÃO cria
 * `ContadorDocumento` — a linha só nasce em `completarUpload` após a validação real.
 */
export async function criarUploadIntent(
  escopo: EscopoDocumentos,
  entrada: UploadIntentEntrada,
  deps: Deps,
): Promise<UploadIntentResultado> {
  const comp = competenciaOuErro(entrada.competencia)
  const categoria = categoriaOuErro(entrada.categoria)
  tituloOuErro(entrada.titulo)
  vencimentoOpcional(entrada.vencimento)

  const nomeSanitizado = sanitizarNomeArquivo(entrada.nomeArquivo)
  const ext = validarExtensao(nomeSanitizado)
  validarMimeDeclarado(ext, entrada.mime)
  validarTamanho(entrada.bytes)
  if (!normalizarSha256(entrada.sha256)) {
    throw new DocumentoValidacaoError("sha256", "SHA-256 declarado inválido.")
  }

  const competencia = await deps.repo.getOrCreateCompetencia(escopo.storeId, comp)
  if (competencia.status === STATUS_COMPETENCIA_FECHADA) throw new CompetenciaFechadaError()

  await validarPredecessor(entrada.versaoDeId, competencia.id, escopo.storeId, deps)

  const documentoId = gerarDocumentoId()
  const storageRef = montarStorageRef({
    storeId: escopo.storeId,
    aaaaMm: formatCompetencia(comp),
    documentoId,
    nomeSanitizado,
  })

  const upload = await deps.storage.criarUploadAssinado(storageRef)

  return Object.freeze({
    documentoId,
    competenciaId: competencia.id,
    competencia: formatCompetencia(comp),
    storageRef,
    nomeSanitizado,
    signedUrl: upload.signedUrl,
    token: upload.token,
    expiresInSec: upload.expiresInSec,
  })
}

/* ───────────────────────────── ETAPA 5 — complete ───────────────────────────── */

export type CompleteEntrada = Readonly<{
  documentoId: string
  competencia: string
  storageRef: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  vencimento?: unknown
  versaoDeId?: string | null
}>

/**
 * Confirma o upload: LÊ o objeto, valida conteúdo/tamanho/hash real, compara com o
 * intent e só então cria `ContadorDocumento` + evento em transação. Idempotente pelo
 * `documentoId`. Em falha de validação, remove o objeto órfão.
 */
export async function completarUpload(
  escopo: EscopoDocumentos,
  entrada: CompleteEntrada,
  deps: Deps,
): Promise<{ documento: DocumentoRow; criado: boolean }> {
  const comp = competenciaOuErro(entrada.competencia)
  const categoria = categoriaOuErro(entrada.categoria)
  const titulo = tituloOuErro(entrada.titulo)
  const vencimento = vencimentoOpcional(entrada.vencimento)
  const nomeSanitizado = sanitizarNomeArquivo(entrada.nomeArquivo)
  const ext = validarExtensao(nomeSanitizado)
  const mime = validarMimeDeclarado(ext, entrada.mime)
  const bytesDeclarados = validarTamanho(entrada.bytes)
  const shaDeclarado = normalizarSha256(entrada.sha256)
  if (!shaDeclarado) throw new DocumentoValidacaoError("sha256", "SHA-256 declarado inválido.")

  const documentoId = String(entrada.documentoId ?? "").trim()
  if (!documentoId) throw new DocumentoValidacaoError("documentoId", "documentoId ausente.")

  const storageRef = String(entrada.storageRef ?? "").trim()
  if (!storageRefPertence(storageRef, escopo.storeId, documentoId)) {
    throw new DocumentoValidacaoError("storageRef", "Caminho de storage não pertence a esta unidade/documento.")
  }

  // Idempotência: se já existe, confere e retorna sem duplicar.
  const existente = await deps.repo.acharDocumentoPorId(documentoId)
  if (existente) {
    if (
      existente.storeId === escopo.storeId &&
      existente.storageRef === storageRef &&
      hashesIguais(existente.sha256, shaDeclarado)
    ) {
      return { documento: existente, criado: false }
    }
    throw new DocumentoConflitoError("Documento já confirmado com dados divergentes.")
  }

  const competencia = await deps.repo.getOrCreateCompetencia(escopo.storeId, comp)
  if (competencia.status === STATUS_COMPETENCIA_FECHADA) throw new CompetenciaFechadaError()
  const versaoDeId = await validarPredecessor(entrada.versaoDeId, competencia.id, escopo.storeId, deps)

  // Lê e valida o CONTEÚDO real; qualquer falha remove o objeto órfão.
  let sha256Servidor: string
  let bytesServidor: number
  try {
    const buf = await deps.storage.abrirConteudoPrivado(storageRef)
    bytesServidor = validarTamanho(buf.length, "conteudo")
    validarConteudoReal(ext, buf)
    sha256Servidor = sha256HexDeBuffer(buf)
    if (bytesServidor !== bytesDeclarados) {
      throw new DocumentoValidacaoError("bytes", "Tamanho real diverge do informado.")
    }
    if (!hashesIguais(sha256Servidor, shaDeclarado)) {
      throw new DocumentoValidacaoError("sha256", "Hash real diverge do informado.")
    }
  } catch (e) {
    await removerSilencioso(storageRef, deps)
    throw e
  }

  try {
    const documento = await deps.repo.criarDocumentoComEvento({
      documento: {
        id: documentoId,
        competenciaId: competencia.id,
        storeId: escopo.storeId,
        categoria: CATEGORIA_PRISMA[categoria],
        titulo,
        nomeArquivo: nomeSanitizado,
        mime,
        // Fonte da verdade: valores calculados pelo servidor.
        bytes: bytesServidor,
        sha256: sha256Servidor,
        storageRef,
        status: "ENVIADO",
        vencimento,
        enviadoPorTipo: ENVIADO_POR_TIPO_INTERNO,
        enviadoPorId: escopo.userId,
        versaoDeId,
      },
      evento: {
        storeId: escopo.storeId,
        competenciaId: competencia.id,
        tipo: versaoDeId ? EVENTO_DOCUMENTO_SUBSTITUIDO : EVENTO_DOCUMENTO_ENVIADO,
        atorTipo: ENVIADO_POR_TIPO_INTERNO,
        atorId: escopo.userId,
        entidade: "documento",
        entidadeId: documentoId,
        origem: ORIGEM_DOCUMENTOS,
        metadata: sanitizarMetadata({
          categoria,
          bytes: bytesServidor,
          mime,
          competencia: formatCompetencia(comp),
          substituiu: versaoDeId ?? undefined,
        }),
      },
    })
    return { documento, criado: true }
  } catch (e) {
    // Corrida: outra chamada criou primeiro entre o find e o create.
    const apos = await deps.repo.acharDocumentoPorId(documentoId)
    if (
      apos &&
      apos.storeId === escopo.storeId &&
      apos.storageRef === storageRef &&
      hashesIguais(apos.sha256, shaDeclarado)
    ) {
      return { documento: apos, criado: false }
    }
    throw e
  }
}

/* ───────────────────────────── ETAPA 7 — listagem ───────────────────────────── */

/** DTO seguro para a UI — SEM `storageRef`, token, service role ou URL assinada. */
export type DocumentoDto = Readonly<{
  id: string
  competenciaId: string
  categoria: string
  titulo: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  status: string
  /**
   * Flag DERIVADA (GOAL 011 · ADR-005) — nunca persistida, nunca um status.
   * Calculada no servidor para que a UI não precise inferir fuso/regra.
   */
  vencido: boolean
  vencimento: string | null
  enviadoPorTipo: string
  enviadoPorId: string
  versaoDeId: string | null
  createdAt: string
  updatedAt: string
}>

export function toDto(row: DocumentoRow, agora: Date = new Date()): DocumentoDto {
  return Object.freeze({
    id: row.id,
    competenciaId: row.competenciaId,
    categoria: row.categoria,
    titulo: row.titulo,
    nomeArquivo: row.nomeArquivo,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    status: row.status,
    vencido: estaVencido({ status: row.status, vencimento: row.vencimento }, agora),
    vencimento: row.vencimento ? row.vencimento.toISOString() : null,
    enviadoPorTipo: row.enviadoPorTipo,
    enviadoPorId: row.enviadoPorId,
    versaoDeId: row.versaoDeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** Lista documentos não-excluídos da competência (não cria competência). */
export async function listarDocumentos(
  escopo: EscopoDocumentos,
  competenciaCodigo: string,
  filtros: FiltrosListagem,
  deps: Pick<Deps, "repo">,
  agora: Date = new Date(),
): Promise<DocumentoDto[]> {
  const comp = competenciaOuErro(competenciaCodigo)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) return []
  const rows = await deps.repo.listarDocumentos({
    competenciaId: competencia.id,
    storeId: escopo.storeId,
    incluirExcluidos: false,
    filtros,
  })
  return rows.map((r) => toDto(r, agora))
}

/* ───────────────────────────── ETAPA 8 — download ───────────────────────────── */

export type DownloadAutorizado = Readonly<{ signedUrl: string; expiresInSec: number }>

/**
 * Autoriza o download: valida propriedade, existência e gera URL assinada curta.
 * Registra `documento_download_autorizado` (autorização — não afirma que baixou).
 */
export async function autorizarDownload(
  escopo: EscopoDocumentos,
  id: string,
  deps: Deps,
): Promise<DownloadAutorizado> {
  const docId = String(id ?? "").trim()
  if (!docId) throw new DocumentoNaoEncontradoError()
  const doc = await deps.repo.acharDocumentoDaLoja(docId, escopo.storeId)
  if (!doc || doc.excluidoEm) throw new DocumentoNaoEncontradoError()

  const existe = await deps.storage.verificarExistencia(doc.storageRef)
  if (!existe) throw new DocumentoNaoEncontradoError()

  const assinado = await deps.storage.criarDownloadAssinado(doc.storageRef, doc.nomeArquivo)

  await deps.repo.registrarEvento({
    storeId: escopo.storeId,
    competenciaId: doc.competenciaId,
    tipo: EVENTO_DOCUMENTO_DOWNLOAD,
    atorTipo: ENVIADO_POR_TIPO_INTERNO,
    atorId: escopo.userId,
    entidade: "documento",
    entidadeId: doc.id,
    origem: ORIGEM_DOCUMENTOS,
    metadata: sanitizarMetadata({ expiresInSec: assinado.expiresInSec }),
  })

  return Object.freeze({ signedUrl: assinado.signedUrl, expiresInSec: assinado.expiresInSec })
}

/* ───────────────────────────── ETAPA 10 — soft delete ───────────────────────────── */

/** Exclusão SOFT com motivo obrigatório. NÃO remove o blob (retenção = GOAL 019). */
export async function excluirDocumento(
  escopo: EscopoDocumentos,
  id: string,
  motivoBruto: unknown,
  deps: Pick<Deps, "repo">,
): Promise<DocumentoDto> {
  const docId = String(id ?? "").trim()
  if (!docId) throw new DocumentoNaoEncontradoError()
  const motivo = typeof motivoBruto === "string" ? motivoBruto.trim() : ""
  if (!motivo) throw new DocumentoValidacaoError("motivo", "Motivo da exclusão é obrigatório.")

  const doc = await deps.repo.acharDocumentoDaLoja(docId, escopo.storeId)
  if (!doc || doc.excluidoEm) throw new DocumentoNaoEncontradoError()

  const atualizado = await deps.repo.softDeleteComEvento({
    id: docId,
    storeId: escopo.storeId,
    excluidoPorId: escopo.userId,
    excluidoMotivo: motivo,
    evento: {
      storeId: escopo.storeId,
      competenciaId: doc.competenciaId,
      tipo: EVENTO_DOCUMENTO_EXCLUIDO,
      atorTipo: ENVIADO_POR_TIPO_INTERNO,
      atorId: escopo.userId,
      entidade: "documento",
      entidadeId: docId,
      origem: ORIGEM_DOCUMENTOS,
      metadata: sanitizarMetadata({ motivoLen: motivo.length }),
    },
  })
  return toDto(atualizado)
}

/* ───────────────────────────── internos ───────────────────────────── */

/** Valida o predecessor de uma substituição (mesma competência+loja, não excluído). */
async function validarPredecessor(
  versaoDeId: string | null | undefined,
  competenciaId: string,
  storeId: string,
  deps: Deps,
): Promise<string | null> {
  const alvo = typeof versaoDeId === "string" ? versaoDeId.trim() : ""
  if (!alvo) return null
  const anterior = await deps.repo.acharDocumentoDaLoja(alvo, storeId)
  if (!anterior || anterior.competenciaId !== competenciaId || anterior.excluidoEm) {
    throw new DocumentoValidacaoError("versaoDeId", "Documento a substituir inválido para esta competência.")
  }
  return alvo
}

async function removerSilencioso(storageRef: string, deps: Deps): Promise<void> {
  try {
    await deps.storage.removerObjeto(storageRef)
  } catch {
    // Limpeza best-effort: não mascara o erro de validação original.
  }
}

/**
 * Garante metadados de evento SANEADOS: sem PII, sem payload bruto, sem segredo.
 * Só primitivos simples; descarta `undefined` e chaves com objeto/segredo.
 */
function sanitizarMetadata(entrada: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(entrada)) {
    if (v === undefined || v === null) continue
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      saida[k] = v
    }
  }
  return saida
}
