/**
 * Contador HUB · Portal externo read-only — marcar documento conferido (GOAL 015).
 *
 * ÚNICA transição de status que o portal conhece: `ENVIADO → CONFERIDO`, e só
 * para o papel CONFERENCIA. Não há parâmetro `para` — as demais transições são
 * proibidas ESTRUTURALMENTE (não existe caminho de código que as expresse).
 *
 * NÃO reusa `alterarStatusDocumento` do domínio (GOAL 011): lá o gate é
 * `CapacidadesContador` derivada de NextAuth e o evento sai com atorTipo
 * "interno" hardcoded. Aqui:
 *  - o gate é o PAPEL EXTERNO do vínculo (`LEITURA` → 403 de domínio);
 *  - a transição é validada contra a MESMA matriz canônica (`resolverTransicao`)
 *    — par fora da matriz (ex.: `CONFERIDO → CONFERIDO`) é erro tipado, zero escrita;
 *  - a escrita usa a MESMA porta transacional `aplicarTransicao` (trava otimista
 *    por estado esperado + evento na mesma transação), com atorTipo "externo";
 *  - competência FECHADA congela a transição (mesma regra do domínio).
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { formatCompetencia } from "@/lib/contador/competencia"
import {
  CompetenciaFechadaError,
  DocumentoNaoEncontradoError,
} from "@/lib/contador/documentos/service"
import { normalizarStatus, resolverTransicao } from "@/lib/contador/status/matriz"
import type { DepsStatus } from "@/lib/contador/status/service"
import { exigirPapelConferencia } from "./escopo"
import { ATOR_TIPO_EXTERNO, EVENTO_PORTAL_STATUS, ORIGEM_PORTAL } from "./eventos"

export type EntradaConferenciaPortal = Readonly<{ documentoId: unknown }>

export type ResultadoConferenciaPortal = Readonly<{
  id: string
  competenciaId: string
  competencia: string
  status: "CONFERIDO"
  atualizadoEm: string
}>

/**
 * Marca um documento ENVIADO como CONFERIDO, em nome do contador externo.
 * Toda recusa acontece ANTES da primeira escrita.
 */
export async function marcarDocumentoConferidoPortal(
  escopo: ContadorScopeExterno,
  entrada: EntradaConferenciaPortal,
  deps: DepsStatus,
): Promise<ResultadoConferenciaPortal> {
  exigirPapelConferencia(escopo)

  const documentoId = String(entrada.documentoId ?? "").trim()
  if (!documentoId) throw new DocumentoNaoEncontradoError()

  // Escopo por loja no lookup: documento de outra loja é o mesmo 404 de um id
  // inexistente — a existência alheia nunca é confirmada.
  const doc = await deps.repo.acharDocumentoParaTransicao(documentoId, escopo.storeId)
  if (!doc || doc.excluidoEm) throw new DocumentoNaoEncontradoError()
  if (doc.competenciaStatus === "FECHADA") throw new CompetenciaFechadaError()

  const de = normalizarStatus(doc.status)
  // Validação contra a MATRIZ: só ENVIADO → CONFERIDO existe neste fluxo;
  // qualquer outro estado de origem é TransicaoInvalidaError (409).
  resolverTransicao(de, "CONFERIDO")

  const competencia = formatCompetencia({ ano: doc.competenciaAno, mes: doc.competenciaMes })
  const atualizado = await deps.repo.aplicarTransicao({
    documentoId,
    storeId: escopo.storeId,
    de,
    para: "CONFERIDO",
    comentario: null,
    evento: {
      storeId: escopo.storeId,
      competenciaId: doc.competenciaId,
      tipo: EVENTO_PORTAL_STATUS,
      atorTipo: ATOR_TIPO_EXTERNO,
      atorId: escopo.usuario.id,
      entidade: "documento",
      entidadeId: documentoId,
      origem: ORIGEM_PORTAL,
      metadata: {
        statusAnterior: de,
        statusNovo: "CONFERIDO",
        acao: "conferir",
        competencia,
      },
    },
  })

  return Object.freeze({
    id: atualizado.id,
    competenciaId: atualizado.competenciaId,
    competencia,
    status: "CONFERIDO" as const,
    atualizadoEm: atualizado.updatedAt.toISOString(),
  })
}
