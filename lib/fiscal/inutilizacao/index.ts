export {
  buildInutilizacaoXml,
} from "./xml-builder"
export {
  validateInutilizacaoPedido,
  normalizarJustificativa,
} from "./validation"
export {
  montarIdInutilizacao,
  idConferePedido,
} from "./id"
export {
  signInutilizacaoXml,
} from "./sign-boundary"
export {
  parseInutilizacaoResponse,
} from "./response-parser"
export {
  classifyInutilizacaoRetorno,
  inutilizacaoPermiteRetryAutomatico,
} from "./classifier"
export {
  lookupInutilizacaoCStat,
  INUTILIZACAO_CSTAT_MATRIX_VERSION,
  INUTILIZACAO_CSTAT_CONHECIDOS,
} from "./cstat-matrix"
export {
  validarInutilizacaoPedidoXsd,
  validarInutilizacaoRetornoXsd,
} from "./xsd-validate"
export {
  INUTILIZACAO_XMLNS,
  INUTILIZACAO_VERSAO,
  INUTILIZACAO_XSERV,
  INUTILIZACAO_MODELO_NFCE,
  INUTILIZACAO_MAX_FAIXA,
  INUTILIZACAO_ANO_MINIMO,
  INUTILIZACAO_JUSTIFICATIVA_MIN,
  INUTILIZACAO_JUSTIFICATIVA_MAX,
  InutilizacaoError,
} from "./types"
export type {
  InutilizacaoPedidoInput,
  InutilizacaoPedidoNormalizado,
  InutilizacaoValidationResult,
  InutilizacaoBuildResult,
  InutilizacaoClassification,
  InutilizacaoOutcome,
  InutilizacaoReason,
  InutilizacaoIssue,
} from "./types"
export {
  INUTILIZACAO_DEDUPE_VERSION,
  INUTILIZACAO_MARK,
  buildInutilizacaoDedupeKey,
  asInutilizacaoPayload,
  podeBaixarMarcacao,
  protocoloInutilizacaoValido,
} from "./mark"
export type { InutilizacaoJobPayload, InutilizacaoMark, InutilizacaoMotivo } from "./mark"
export { enqueueInutilizacao, JUSTIFICATIVA_REJEICAO_PADRAO, JUSTIFICATIVA_LACUNA_PADRAO } from "./enqueue"
export { executeInutilizacaoJob } from "./execute"
export {
  reemitirVendaAposRejeicao,
  resolveReissueSnapshotLocalKey,
  buildFiscalReissueDedupeKey,
} from "./reissue"
export { solicitarInutilizacaoAdministrativa } from "./admin"
export { createPrismaInutilizacaoPorts } from "./prisma-ports"
export { executarInutilizacaoSefaz } from "./sefaz-inutilizar"
export type { InutilizacaoPorts, EnqueueInutilizacaoInput } from "./ports"
