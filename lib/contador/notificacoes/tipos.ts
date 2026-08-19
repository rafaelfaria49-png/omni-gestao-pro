/**
 * Contador HUB · contratos de alertas internos (GOAL 017).
 *
 * Sem schema novo. Sem envio externo. `mensagem_enviada` é tipo reservado e
 * NUNCA é emitido neste GOAL.
 */

export const ORIGEM_NOTIFICACOES = "contador.notificacoes" as const
export const ATOR_TIPO_INTERNO = "interno" as const
export const ATOR_TIPO_SISTEMA = "sistema" as const

export const EVENTO_ALERTA_EMITIDO = "alerta_emitido" as const
export const EVENTO_ALERTA_TRATADO = "alerta_tratado" as const
export const EVENTO_ALERTA_SUPRIMIDO = "alerta_suprimido" as const
/** Reservado — o 017 não emite. */
export const EVENTO_MENSAGEM_ENVIADA = "mensagem_enviada" as const
/** Evento persistido do GOAL 012 — fonte da regra homônima. */
export const EVENTO_ALTERACAO_POS_FECHAMENTO = "alteracao_pos_fechamento" as const

export const EXTERNAL_SEND_ALLOWED = false as const

export const REGRAS = [
  "documento_pendente",
  "fechamento_proximo",
  "guia_vencendo",
  "guia_vencida",
  "pacote_com_pendencias",
  "alteracao_pos_fechamento",
] as const
export type RegraId = (typeof REGRAS)[number]

export const SEVERIDADES = ["baixa", "media", "alta"] as const
export type SeveridadeAlerta = (typeof SEVERIDADES)[number]

/** Itens stale do checklist 007 — NUNCA são fonte de alerta. */
export const CHECKLIST_IDS_STALE = ["documentos", "fechamento_oficial"] as const

export type EscopoNotificacoes = Readonly<{ storeId: string; userId: string }>

export type DedupeKey = Readonly<{
  regra: RegraId
  alvo: string
  storeId: string
  competenciaId: string
  janela: string
}>

export type AlertaCandidato = Readonly<{
  regra: RegraId
  alvo: string
  origem: string
  severidade: SeveridadeAlerta
  titulo: string
  prazo: string | null
  janela: string
  microcopyAgenda?: "informado pelo responsável"
}>

export type AlertaDto = Readonly<{
  id: string
  regra: RegraId
  origem: string
  severidade: SeveridadeAlerta
  competencia: string
  alvo: string
  titulo: string
  prazo: string | null
  janela: string
  tratado: boolean
  materializado: boolean
}>

export type RascunhoDto = Readonly<{
  estado: "rascunho"
  idioma: "pt-BR"
  acao: "copiar"
  envio: "proibido"
  texto: string
}>

export type EventoAlertaRow = Readonly<{
  id: string
  tipo: string
  entidadeId: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
}>

export type DocumentoAlerta = Readonly<{
  id: string
  status: string
  titulo: string
  vencimento: Date | string | null
}>

export type GuiaAlerta = Readonly<{
  id: string
  titulo: string
  vencimento: Date | string
  pagaEm: Date | string | null
}>

export type CompetenciaAlerta = Readonly<{
  id: string
  storeId: string
  ano: number
  mes: number
  status: string
  versao: number
  snapshot: unknown
}>

/**
 * Versão persistida do pacote oficial + `manifesto.pendencias` daquela versão.
 * Alvo/janela da regra usam a versão efetiva (maior `versao`).
 */
export type PacoteAlerta = Readonly<{
  versao: number
  pendencias: readonly string[]
}>

export type FontesAvaliacao = Readonly<{
  competencia: CompetenciaAlerta | null
  documentos: readonly DocumentoAlerta[]
  guias: readonly GuiaAlerta[]
  pacotes: readonly PacoteAlerta[]
  eventosPosFechamento: readonly EventoAlertaRow[]
  eventosAlerta: readonly EventoAlertaRow[]
}>

export type NovoEventoAlerta = Readonly<{
  storeId: string
  competenciaId: string
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string
  entidadeId: string
  origem: string
  metadata: Readonly<Record<string, unknown>>
}>
