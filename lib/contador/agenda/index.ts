/** Contador HUB · agenda de obrigações e guias manuais (GOAL 016). */

export {
  MICROCOPY_INFORMADO,
  GUIAS_VENCENDO_DIAS,
  OBRIGACAO_TIPOS,
  RECORRENCIAS,
  GUIAS_ORIGEM,
} from "./tipos"
export type {
  AgendaDto,
  EscopoAgenda,
  GuiaDto,
  ObrigacaoDto,
  ResumoGuiasChecklist,
  TemplateDto,
} from "./tipos"
export { criarRepoAgenda } from "./repo-prisma"
export {
  listarTemplates,
  criarTemplate,
  atualizarTemplate,
  removerTemplate,
  listarAgenda,
  carregarResumoGuiasChecklist,
  instanciarLoteMensal,
  criarObrigacao,
  atualizarObrigacao,
  alterarStatusObrigacao,
  criarGuia,
  atualizarGuia,
  pagarGuia,
  montarResumoGuias,
} from "./service"
export { resolverDiaVencimento, estaVencendo, statusEfetivoGuia } from "./vencimento"
