/**
 * Contador HUB · comentários da competência/documento (GOAL 011).
 *
 * PURO em relação a IO: depende de uma única porta injetada (`ComentariosRepo`).
 *
 * Regras não negociáveis:
 *  - `competenciaId` sempre resolvido no SERVIDOR a partir de `AAAA-MM` + loja ativa;
 *  - `documentoId` é opcional, mas quando informado precisa pertencer à MESMA loja e
 *    à MESMA competência (senão 404 — não confirma existência alheia);
 *  - autor e loja vêm do escopo, nunca do corpo da requisição;
 *  - `interna` NUNCA sai em consulta com contexto `compartilhado`;
 *  - append-only: este GOAL não expõe edição nem exclusão de comentário.
 *
 * Escreve SOMENTE em `ContadorComentario`, `ContadorCompetencia` (via getOrCreate) e
 * `ContadorEvento`.
 */
import { randomUUID } from "node:crypto"
import {
  formatCompetencia,
  parseCompetencia,
  type Competencia,
} from "@/lib/contador/competencia"
import { DocumentoNaoEncontradoError } from "@/lib/contador/documentos/service"

/* ───────────────────────────── constantes de domínio ───────────────────────────── */

export const EVENTO_COMENTARIO_CRIADO = "comentario_criado" as const
export const ORIGEM_COMENTARIOS = "contador.comentarios" as const
export const AUTOR_TIPO_INTERNO = "interno" as const

export const VISIBILIDADES = ["interna", "compartilhada"] as const
export type Visibilidade = (typeof VISIBILIDADES)[number]

/** Contexto de leitura: o portal externo (GOAL 015) só enxerga `compartilhado`. */
export const CONTEXTOS = ["interno", "compartilhado"] as const
export type ContextoLeitura = (typeof CONTEXTOS)[number]

export const TEXTO_MAX = 4000

/* ───────────────────────────── erros tipados ───────────────────────────── */

export class ComentarioValidacaoError extends Error {
  readonly code = "COMENTARIO_INVALIDO" as const
  constructor(
    readonly campo: string,
    message: string,
  ) {
    super(message)
    this.name = "ComentarioValidacaoError"
  }
}

/* ───────────────────────────── tipos de fronteira ───────────────────────────── */

export type EscopoComentarios = Readonly<{ storeId: string; userId: string }>

export type ComentarioRow = {
  id: string
  competenciaId: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: string
  texto: string
  createdAt: Date
}

export type CompetenciaRefComentario = { id: string; ano: number; mes: number; status: string }

export type NovoComentario = Readonly<{
  id: string
  competenciaId: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: Visibilidade
  texto: string
}>

export type NovoEventoComentario = Readonly<{
  storeId: string
  competenciaId: string
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string
  entidadeId: string
  origem: string
  metadata: Record<string, string | number | boolean>
}>

export interface ComentariosRepo {
  getOrCreateCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaRefComentario>
  acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaRefComentario | null>
  /** `true` somente se o documento existe, é da loja, da competência e não foi excluído. */
  documentoPertence(args: {
    documentoId: string
    competenciaId: string
    storeId: string
  }): Promise<boolean>
  /** Atômico: comentário + evento na MESMA transação. */
  criarComentarioComEvento(args: {
    comentario: NovoComentario
    evento: NovoEventoComentario
  }): Promise<ComentarioRow>
  listarComentarios(args: {
    competenciaId: string
    storeId: string
    documentoId?: string
    /** Quando informado, só devolve comentários dessa visibilidade. */
    visibilidade?: Visibilidade
    limite: number
  }): Promise<ComentarioRow[]>
}

export type DepsComentarios = Readonly<{ repo: ComentariosRepo }>

/** DTO seguro para UI/portal — sem storage, sem URL, sem campo interno supérfluo. */
export type ComentarioDto = Readonly<{
  id: string
  competenciaId: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: Visibilidade
  texto: string
  criadoEm: string
}>

export function toComentarioDto(row: ComentarioRow): ComentarioDto {
  return Object.freeze({
    id: row.id,
    competenciaId: row.competenciaId,
    documentoId: row.documentoId,
    autorTipo: row.autorTipo,
    autorId: row.autorId,
    visibilidade: normalizarVisibilidade(row.visibilidade),
    texto: row.texto,
    criadoEm: row.createdAt.toISOString(),
  })
}

/* ───────────────────────────── casos de uso ───────────────────────────── */

export type EntradaComentario = Readonly<{
  competencia: unknown
  documentoId?: unknown
  texto: unknown
  visibilidade: unknown
}>

/** Cria um comentário da loja ativa. Autor e loja vêm do escopo (servidor). */
export async function criarComentario(
  escopo: EscopoComentarios,
  entrada: EntradaComentario,
  deps: DepsComentarios,
): Promise<ComentarioDto> {
  const comp = competenciaOuErro(entrada.competencia)
  const texto = textoOuErro(entrada.texto)
  const visibilidade = visibilidadeOuErro(entrada.visibilidade)

  const competencia = await deps.repo.getOrCreateCompetencia(escopo.storeId, comp)

  const documentoId = idOpcional(entrada.documentoId)
  if (documentoId) {
    const pertence = await deps.repo.documentoPertence({
      documentoId,
      competenciaId: competencia.id,
      storeId: escopo.storeId,
    })
    if (!pertence) throw new DocumentoNaoEncontradoError()
  }

  const comentario: NovoComentario = Object.freeze({
    id: `cmt-${randomUUID()}`,
    competenciaId: competencia.id,
    documentoId,
    autorTipo: AUTOR_TIPO_INTERNO,
    autorId: escopo.userId,
    visibilidade,
    texto,
  })

  const row = await deps.repo.criarComentarioComEvento({
    comentario,
    evento: {
      storeId: escopo.storeId,
      competenciaId: competencia.id,
      tipo: EVENTO_COMENTARIO_CRIADO,
      atorTipo: AUTOR_TIPO_INTERNO,
      atorId: escopo.userId,
      entidade: "comentario",
      entidadeId: comentario.id,
      origem: ORIGEM_COMENTARIOS,
      // Metadata SANEADA (ajuste G2-05): NUNCA o texto — só tamanho e ponteiros técnicos.
      metadata: {
        visibilidade,
        textoLen: texto.length,
        competencia: formatCompetencia(comp),
        ...(documentoId ? { documentoId } : {}),
      },
    },
  })

  return toComentarioDto(row)
}

export type FiltroListagemComentarios = Readonly<{
  competencia: unknown
  documentoId?: unknown
  contexto?: unknown
  limite?: number
}>

/**
 * Lista comentários da competência. Em contexto `compartilhado` os comentários
 * `interna` são filtrados NA CONSULTA — não chegam nem a ser projetados.
 */
export async function listarComentarios(
  escopo: EscopoComentarios,
  filtro: FiltroListagemComentarios,
  deps: DepsComentarios,
): Promise<ComentarioDto[]> {
  const comp = competenciaOuErro(filtro.competencia)
  const contexto = contextoOuErro(filtro.contexto)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) return []

  const documentoId = idOpcional(filtro.documentoId)
  const rows = await deps.repo.listarComentarios({
    competenciaId: competencia.id,
    storeId: escopo.storeId,
    ...(documentoId ? { documentoId } : {}),
    ...(contexto === "compartilhado" ? { visibilidade: "compartilhada" as const } : {}),
    limite: normalizarLimite(filtro.limite),
  })

  // Defesa em profundidade: mesmo que a consulta mudasse, `interna` não sai daqui.
  const permitidos = contexto === "compartilhado"
    ? rows.filter((r) => normalizarVisibilidade(r.visibilidade) === "compartilhada")
    : rows

  return permitidos.map(toComentarioDto)
}

/* ───────────────────────────── validações puras ───────────────────────────── */

export function competenciaOuErro(valor: unknown): Competencia {
  const c = parseCompetencia(valor)
  if (!c) throw new ComentarioValidacaoError("competencia", "Competência inválida. Use AAAA-MM.")
  return c
}

export function textoOuErro(valor: unknown): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  if (!t) throw new ComentarioValidacaoError("texto", "O comentário não pode ficar vazio.")
  if (t.length > TEXTO_MAX) {
    throw new ComentarioValidacaoError("texto", `O comentário excede ${TEXTO_MAX} caracteres.`)
  }
  return t
}

export function visibilidadeOuErro(valor: unknown): Visibilidade {
  const v = typeof valor === "string" ? valor.trim().toLowerCase() : ""
  if (!(VISIBILIDADES as readonly string[]).includes(v)) {
    throw new ComentarioValidacaoError(
      "visibilidade",
      "Visibilidade inválida. Use interna ou compartilhada.",
    )
  }
  return v as Visibilidade
}

/** Contexto ausente = `interno` (caminho do HUB). Valor desconhecido é recusado. */
export function contextoOuErro(valor: unknown): ContextoLeitura {
  if (valor == null || valor === "") return "interno"
  const v = typeof valor === "string" ? valor.trim().toLowerCase() : ""
  if (!(CONTEXTOS as readonly string[]).includes(v)) {
    throw new ComentarioValidacaoError("contexto", "Contexto inválido. Use interno ou compartilhado.")
  }
  return v as ContextoLeitura
}

function normalizarVisibilidade(valor: string): Visibilidade {
  // Linha legada/desconhecida é tratada como INTERNA (fail-closed: nunca vaza).
  return valor === "compartilhada" ? "compartilhada" : "interna"
}

function idOpcional(valor: unknown): string | null {
  const v = typeof valor === "string" ? valor.trim() : ""
  return v || null
}

function normalizarLimite(valor: number | undefined): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return 200
  return Math.min(Math.max(1, Math.trunc(valor)), 500)
}
