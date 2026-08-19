/**
 * Contador HUB · contratos da agenda (GOAL 016).
 *
 * Obrigações e guias são 100% manuais/informadas. Sem cálculo fiscal, sem cron,
 * sem `vencido` persistido. Valor, vencimento e tipo vêm do responsável.
 */

import type { StatusItem } from "@/lib/contador/status/matriz"

export const MICROCOPY_INFORMADO = "informado pelo responsável" as const
export const GUIAS_VENCENDO_DIAS = 7 as const

export const ORIGEM_AGENDA = "contador.agenda" as const
export const ATOR_TIPO_INTERNO = "interno" as const
export const ENTIDADE_OBRIGACAO = "obrigacao" as const
export const ENTIDADE_GUIA = "guia" as const
export const ENTIDADE_TEMPLATE = "obrigacao_template" as const

export const EVENTO_OBRIGACAO_CRIADA = "obrigacao_criada" as const
export const EVENTO_OBRIGACAO_ATUALIZADA = "obrigacao_atualizada" as const
export const EVENTO_OBRIGACAO_STATUS = "obrigacao_status_alterado" as const
export const EVENTO_GUIA_INFORMADA = "guia_informada" as const
export const EVENTO_GUIA_ATUALIZADA = "guia_atualizada" as const
export const EVENTO_GUIA_PAGA = "guia_paga" as const
export const EVENTO_TEMPLATE_CRIADO = "template_criado" as const
export const EVENTO_TEMPLATE_ATUALIZADO = "template_atualizado" as const

export const OBRIGACAO_TIPOS = [
  "envio_documento",
  "pagamento_guia",
  "conferencia",
  "declaracao",
  "entrega_arquivo",
  "fechamento",
  "tarefa",
] as const
export type ObrigacaoTipo = (typeof OBRIGACAO_TIPOS)[number]

export const RECORRENCIAS = ["mensal", "nenhuma"] as const
export type Recorrencia = (typeof RECORRENCIAS)[number]

export const GUIAS_ORIGEM = ["manual", "contador"] as const
export type GuiaOrigem = (typeof GUIAS_ORIGEM)[number]

export const MIME_PDF = "application/pdf"
export const MIMES_COMPROVANTE = ["application/pdf", "image/png", "image/jpeg", "image/jpg"] as const

export type EscopoAgenda = Readonly<{ storeId: string; userId: string }>

export type CompetenciaAgendaRef = Readonly<{
  id: string
  status: string
  ano: number
  mes: number
}>

export type TemplateRow = {
  id: string
  storeId: string
  titulo: string
  descricao: string | null
  tipo: string
  diaVencimento: number | null
  recorrencia: string
  ativo: boolean
  criadoPorTipo: string
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
}

export type ObrigacaoRow = {
  id: string
  storeId: string
  competenciaId: string
  templateId: string | null
  titulo: string
  descricao: string | null
  tipo: string
  vencimento: Date | null
  status: string
  criadoPorTipo: string
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
  competenciaAno: number
  competenciaMes: number
  competenciaStatus: string
}

export type GuiaRow = {
  id: string
  storeId: string
  competenciaId: string
  obrigacaoId: string | null
  titulo: string
  valorCentavos: number
  vencimento: Date
  origem: string
  pdfDocumentoId: string | null
  comprovanteDocumentoId: string | null
  pagaEm: Date | null
  criadoPorTipo: string
  criadoPorId: string
  createdAt: Date
  updatedAt: Date
  competenciaAno: number
  competenciaMes: number
  competenciaStatus: string
}

export type DocumentoAgendaRef = Readonly<{
  id: string
  competenciaId: string
  storeId: string
  mime: string
  excluidoEm: Date | null
}>

export type NovoEventoAgenda = Readonly<{
  storeId: string
  competenciaId: string | null
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string | null
  entidadeId: string | null
  origem: string
  metadata: Record<string, string | number | boolean | null>
}>

export type TemplateDto = Readonly<{
  id: string
  titulo: string
  descricao: string | null
  tipo: ObrigacaoTipo
  diaVencimento: number | null
  recorrencia: Recorrencia
  ativo: boolean
  atualizadoEm: string
  microcopy: typeof MICROCOPY_INFORMADO
}>

export type TransicaoDto = Readonly<{
  para: StatusItem
  acao: string
  rotulo: string
  exigeMotivo: boolean
}>

export type ObrigacaoDto = Readonly<{
  id: string
  competenciaId: string
  competencia: string
  templateId: string | null
  titulo: string
  descricao: string | null
  tipo: ObrigacaoTipo
  status: StatusItem
  vencimento: string | null
  vencido: boolean
  vencendo: boolean
  transicoes: readonly TransicaoDto[]
  atualizadoEm: string
  microcopy: typeof MICROCOPY_INFORMADO
}>

export type GuiaDto = Readonly<{
  id: string
  competenciaId: string
  competencia: string
  obrigacaoId: string | null
  titulo: string
  valorCentavos: number
  vencimento: string
  origem: GuiaOrigem
  pdfDocumentoId: string | null
  pdfAusente: boolean
  comprovanteDocumentoId: string | null
  comprovanteAusente: boolean
  paga: boolean
  pagaEm: string | null
  vencido: boolean
  vencendo: boolean
  atualizadoEm: string
  microcopy: typeof MICROCOPY_INFORMADO
}>

export type ResumoGuiasChecklist = Readonly<{
  leituraOk: boolean
  total: number
  vencidas: number
  vencendo: number
  pagas: number
}>

export type AgendaDto = Readonly<{
  competencia: string
  obrigacoes: readonly ObrigacaoDto[]
  guias: readonly GuiaDto[]
  microcopy: typeof MICROCOPY_INFORMADO
}>
