/**
 * Contador HUB · Retenção — API pública do módulo (GOAL 019).
 *
 * `politica`, `limites`, `tipos` e `job` são livres de Prisma e de storage — podem
 * ser importados em qualquer ambiente de teste sem banco. O adapter (`repo-prisma`)
 * é SERVER-ONLY e deve ser importado pelo seu caminho, nunca por este índice, para
 * que importar a política não arraste o cliente Prisma.
 */
export {
  BLOB_SOFT_DELETADO_RETENCAO_DIAS,
  CATEGORIAS_DOCUMENTO,
  FINANCEIRO_RETENCAO_ANOS,
  OUTRO_RETENCAO_ANOS,
  PACOTE_RETENCAO_MESES,
  PURGE_DISABLED,
  RETENCAO_BLOB_SOFT_DELETADO,
  RETENCAO_DOCUMENTOS,
  RETENCAO_PACOTE,
  blobSoftDeletadoElegivel,
  corteBlobSoftDeletado,
  corteDocumento,
  cortePacote,
  documentoElegivelPorIdade,
  limiteDeCorte,
  pacoteElegivel,
  purgaPorIdadeDesabilitada,
  referenciaIdadeDocumento,
  subtrairAnosUtc,
  subtrairDiasUtc,
  subtrairMesesUtc,
} from "./politica"
export type {
  CategoriaDocumentoRetencao,
  PoliticaRetencao,
  UnidadeJanela,
} from "./politica"

export {
  LIMITES_CONTADOR,
  limitePorId,
  limitesSemNumeroCanonico,
} from "./limites"
export type { EscopoLimite, LimiteContador } from "./limites"

export {
  ENV_RETENCAO_APPLY,
  EVENTO_DOCUMENTO_BLOB_DESCARTADO,
  EVENTO_PACOTE_ARTEFATO_DESCARTADO,
  RetencaoApplyBloqueadoError,
  RetencaoEscritaAusenteError,
  applyHabilitado,
  executarJobRetencao,
} from "./job"
export type { DepsJobRetencao, OpcoesJobRetencao } from "./job"

export type {
  AlvoRetencao,
  CandidatoRetencao,
  EventoDescarte,
  FalhaRetencao,
  ModoRetencao,
  RelatorioRetencao,
  ResumoAlvoRetencao,
  RetencaoEscritaPort,
  RetencaoLeituraPort,
} from "./tipos"
