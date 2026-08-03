/**
 * Contador HUB · Portal externo read-only — comentários (GOAL 015).
 *
 * Listagem REUSA `listarComentarios` do domínio (GOAL 011) com contexto
 * `compartilhado` — o corte dos comentários `interna` acontece NA CONSULTA, com
 * defesa em profundidade na projeção. Na fronteira do portal, `autorId` de autor
 * INTERNO é pseudonimizado (P2-2); autor externo permanece identificável.
 *
 * A criação NÃO reusa `criarComentario` do domínio (atorTipo "interno" hardcoded):
 * fluxo próprio sobre a MESMA porta transacional `criarComentarioComEvento`
 * (comentário + evento na mesma transação), com:
 *  - visibilidade SEMPRE `compartilhada` — o portal não consegue criar comentário
 *    interno nem por acidente (o campo simplesmente não existe na entrada);
 *  - `autorTipo: "externo"`, autor = usuário externo do escopo;
 *  - bloqueio em competência FECHADA (mesma regra do domínio — escrita congela);
 *  - TEXTO_MAX 4000 via `textoOuErro` reutilizado;
 *  - evento com metadata saneada pela allowlist do portal — só `textoLen`,
 *    NUNCA o texto;
 *  - competência inexistente → 404 (o portal NÃO cria competência como efeito
 *    colateral de um comentário).
 */
import { randomUUID } from "node:crypto"
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { formatCompetencia } from "@/lib/contador/competencia"
import {
  competenciaOuErro,
  listarComentarios,
  textoOuErro,
  toComentarioDto,
  type ComentarioDto,
  type ComentariosRepo,
} from "@/lib/contador/comentarios/service"
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"
import { CompetenciaNaoEncontradaError } from "@/lib/contador/fechamento/service"
import { pseudonimoAtor } from "@/lib/contador/fechamento/canonico"
import { escopoEstruturalPortal } from "./escopo"
import {
  ATOR_TIPO_EXTERNO,
  EVENTO_PORTAL_COMENTARIO,
  ORIGEM_PORTAL,
  sanearMetadataPortal,
} from "./eventos"

export type DepsComentariosPortal = Readonly<{ repo: ComentariosRepo }>

export type FiltroComentariosPortal = Readonly<{
  competencia: unknown
  documentoId?: unknown
  limite?: number
}>

export type EntradaComentarioPortal = Readonly<{
  competencia: unknown
  documentoId?: unknown
  texto: unknown
}>

/** Pseudonimiza o autor INTERNO (P2-2); autor externo permanece identificável. */
function pseudonimizarAutor(dto: ComentarioDto): ComentarioDto {
  if (dto.autorTipo !== "interno") return dto
  return Object.freeze({ ...dto, autorId: pseudonimoAtor(dto.autorId) })
}

/** Lista comentários COMPARTILHADOS da competência. Read-only. */
export async function listarComentariosPortal(
  escopo: ContadorScopeExterno,
  filtro: FiltroComentariosPortal,
  deps: DepsComentariosPortal,
): Promise<ComentarioDto[]> {
  const lista = await listarComentarios(
    escopoEstruturalPortal(escopo),
    {
      competencia: filtro.competencia,
      ...(filtro.documentoId !== undefined ? { documentoId: filtro.documentoId } : {}),
      // Contexto FIXO: comentário interno nem sai do banco no caminho do portal.
      contexto: "compartilhado",
      ...(filtro.limite !== undefined ? { limite: filtro.limite } : {}),
    },
    deps,
  )
  return lista.map(pseudonimizarAutor)
}

/**
 * Cria um comentário COMPARTILHADO como ator externo. Comentário + evento nascem
 * na MESMA transação (porta do domínio) — nunca comentário sem trilha.
 */
export async function comentarPortal(
  escopo: ContadorScopeExterno,
  entrada: EntradaComentarioPortal,
  deps: DepsComentariosPortal,
): Promise<ComentarioDto> {
  const comp = competenciaOuErro(entrada.competencia)
  const texto = textoOuErro(entrada.texto)

  // Sem getOrCreate: comentar não materializa competência (efeito colateral do
  // caminho interno que o portal não reproduz). Inexistente → 404.
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()
  if (competencia.status === "FECHADA") throw new CompetenciaFechadaError()

  const documentoIdBruto = typeof entrada.documentoId === "string" ? entrada.documentoId.trim() : ""
  const documentoId = documentoIdBruto || null
  if (documentoId) {
    const pertence = await deps.repo.documentoPertence({
      documentoId,
      competenciaId: competencia.id,
      storeId: escopo.storeId,
    })
    if (!pertence) throw new DocumentoNaoEncontradoError()
  }

  const comentarioId = `cmt-${randomUUID()}`
  const row = await deps.repo.criarComentarioComEvento({
    comentario: {
      id: comentarioId,
      competenciaId: competencia.id,
      documentoId,
      autorTipo: ATOR_TIPO_EXTERNO,
      autorId: escopo.usuario.id,
      // FIXO: o portal só fala na visibilidade compartilhada.
      visibilidade: "compartilhada",
      texto,
    },
    evento: {
      storeId: escopo.storeId,
      competenciaId: competencia.id,
      tipo: EVENTO_PORTAL_COMENTARIO,
      atorTipo: ATOR_TIPO_EXTERNO,
      atorId: escopo.usuario.id,
      entidade: "comentario",
      entidadeId: comentarioId,
      origem: ORIGEM_PORTAL,
      // Metadata SANEADA: só tamanho e ponteiros técnicos — NUNCA o texto.
      metadata: sanearMetadataPortal({
        visibilidade: "compartilhada",
        textoLen: texto.length,
        competencia: formatCompetencia(comp),
      }) ?? {},
    },
  })

  return toComentarioDto(row)
}
