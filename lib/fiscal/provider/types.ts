/**
 * Contrato + tipos canônicos do provider fiscal (GOAL_006 — Fiscal Provider Abstraction).
 *
 * Define a INTERFACE oficial que qualquer emissor (SEFAZ direto, gateways, SAT, ou o
 * STUB de homologação) deverá implementar, e os tipos canônicos de request/response/erro.
 *
 * Princípios desta fase (DORMENTE):
 *  - Nenhum provider faz emissão REAL: `simulado = true` sempre.
 *  - O provider trabalha SOMENTE sobre dados CONGELADOS (snapshot fiscal — GOAL_005) e
 *    sobre a `NotaFiscal`/`NotaFiscalItem` já persistidas. NUNCA relê `Produto` vivo.
 *  - O provider NÃO altera `Venda`, NÃO toca Caixa/Financeiro/Estoque e NÃO persiste —
 *    é uma camada pura de transformação/decisão (a orquestração/persistência é do caller futuro).
 */
import type {
  AmbienteFiscal,
  FiscalProviderTipo,
  ModeloFiscal,
  StatusNotaFiscal,
} from "@/generated/prisma"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"

// ── Operações e resultados ───────────────────────────────────────────────────────────

export type FiscalProviderOperacao =
  | "validarConfiguracao"
  | "validarSnapshot"
  | "prepararEmissao"
  | "emitir"
  | "consultar"
  | "cancelar"
  | "inutilizar"
  | "statusServico"

/**
 * Resultado canônico de uma operação:
 *  - `ok`         operação (simulada) bem-sucedida / validação aprovada
 *  - `pendente`   falta dado (config/snapshot incompleto) — não é falha de infraestrutura
 *  - `rejeitado`  rejeição controlada por regra (ex.: justificativa curta)
 *  - `erro`       erro normalizado (entrada inválida / falha interna)
 */
export type FiscalProviderResultado = "ok" | "pendente" | "rejeitado" | "erro"

// ── Erros normalizados ───────────────────────────────────────────────────────────────

export type FiscalProviderErrorCode =
  | "config_ausente"
  | "config_incompleta"
  | "provider_desconhecido"
  | "provider_nao_implementado"
  | "snapshot_invalido"
  | "snapshot_incompleto"
  | "parametros_invalidos"
  | "justificativa_invalida"
  | "operacao_nao_suportada"
  | "emissao_real_indisponivel"
  | "erro_interno"

/** Erro fiscal canônico — forma única para a qual TODO erro de provider é normalizado. */
export type FiscalProviderError = {
  code: FiscalProviderErrorCode
  mensagem: string
  /** Campo de origem (quando aplicável), p/ feedback de formulário/diagnóstico. */
  campo?: string | null
  /** Código bruto preservado do provider externo (futuro) — telemetria/auditoria. */
  origem?: string | null
}

// ── Evento (trilha conceitual produzida por uma operação) ─────────────────────────────

export type FiscalProviderEventoTipo =
  | "validacao"
  | "preparo"
  | "emissao_simulada"
  | "consulta"
  | "cancelamento_simulado"
  | "inutilizacao_simulada"
  | "status_servico"
  | "erro"

/**
 * Evento produzido por uma operação. NÃO é persistido pelo provider (camada pura) —
 * o caller futuro decide gravar como `FiscalLog`/`EventoFiscal`.
 */
export type FiscalProviderEvento = {
  tipo: FiscalProviderEventoTipo
  em: string
  mensagem: string
  detalhe?: Record<string, unknown> | null
}

// ── Resposta canônica ────────────────────────────────────────────────────────────────

/** Dados controlados devolvidos por uma operação (SIMULADOS nesta fase — nunca de SEFAZ real). */
export type FiscalProviderDados = {
  chaveAcesso?: string | null
  protocolo?: string | null
  cStat?: string | null
  xMotivo?: string | null
  autorizadoEm?: string | null
  /** Marcador explícito: identificadores acima são placeholders simulados, não documentos reais. */
  placeholder?: boolean
  [extra: string]: unknown
}

export type FiscalProviderResponse = {
  ok: boolean
  operacao: FiscalProviderOperacao
  resultado: FiscalProviderResultado
  /** SEMPRE true nesta fase — nenhum provider transmite/assina documento real. */
  simulado: boolean
  provider: FiscalProviderTipo | string
  ambiente: AmbienteFiscal | string
  /** Estado conceitual/simulado do documento após a operação. */
  statusNota: StatusNotaFiscal | string | null
  dados: FiscalProviderDados | null
  mensagem: string
  pendencias: string[]
  erros: FiscalProviderError[]
  eventos: FiscalProviderEvento[]
}

// ── Status do serviço (SEFAZ/gateway) ─────────────────────────────────────────────────

export type FiscalProviderStatus = {
  provider: FiscalProviderTipo | string
  online: boolean
  ambiente: AmbienteFiscal | string
  /** SEMPRE true nesta fase. */
  simulado: boolean
  mensagem: string
  /** cStat do web service de status (ex.: "107" = Serviço em Operação) — simulado no stub. */
  cStat: string | null
  verificadoEm: string
}

// ── Entradas das operações ───────────────────────────────────────────────────────────

/**
 * Subconjunto da `ConfiguracaoFiscalLoja` relevante ao provider. Segredos (CSC/token de
 * gateway) entram SÓ por referência (`*Ref`) — o provider nunca recebe o segredo em claro.
 */
export type FiscalProviderConfigInput = {
  provider: FiscalProviderTipo | string
  ambiente: AmbienteFiscal | string
  modeloFiscal: ModeloFiscal | string
  fiscalEnabled: boolean
  cnpj: string
  razaoSocial: string
  uf: string
  providerConfig?: Record<string, unknown> | null
  providerTokenRef?: string | null
  cscId?: string
  cscTokenRef?: string | null
} | null

/** Contexto comum a operações sobre um documento. Tudo congelado — sem leitura viva. */
export type FiscalProviderContexto = {
  storeId: string
  /** Pode ser null em `prepararEmissao` antes da persistência da NotaFiscal. */
  notaFiscalId: string | null
  modelo: ModeloFiscal | string
  ambiente: AmbienteFiscal | string
  /** Numeração fiscal alocada (GOAL_008): presente a partir de `emitir`; null/ausente antes. */
  serie?: number | null
  numero?: number | null
}

/** Requisição canônica das operações que dependem do snapshot congelado da venda. */
export type FiscalProviderRequest = {
  contexto: FiscalProviderContexto
  /** Snapshot fiscal CONGELADO (GOAL_005). Fonte única — o provider não relê Produto/Venda. */
  snapshot: VendaFiscalSnapshot
}

export type FiscalProviderConsultaParams = {
  contexto: FiscalProviderContexto
  chaveAcesso?: string | null
  protocolo?: string | null
}

export type FiscalProviderCancelamentoParams = {
  contexto: FiscalProviderContexto
  chaveAcesso?: string | null
  protocolo?: string | null
  justificativa: string
}

export type FiscalProviderInutilizacaoParams = {
  contexto: FiscalProviderContexto
  serie: number
  numeroInicial: number
  numeroFinal: number
  justificativa: string
  /** Identidade da loja para o pedido `inutNFe` (adapter SEFAZ). */
  cnpj?: string | null
  cUF?: string | null
  /** Ano com 2 dígitos (Tano). */
  ano?: string | null
}

export type FiscalProviderStatusParams = {
  provider: FiscalProviderTipo | string
  ambiente: AmbienteFiscal | string
  uf?: string
}

// ── Contrato ─────────────────────────────────────────────────────────────────────────

/**
 * Contrato oficial do provider fiscal do OmniGestão Pro.
 *
 * Validações são SÍNCRONAS (puras, locais). Operações com semântica de transmissão
 * (emitir/consultar/cancelar/inutilizar/statusServico) são assíncronas para já refletir
 * a forma de I/O dos providers reais (SEFAZ/gateway), mesmo que o stub resolva na hora.
 */
export interface FiscalProvider {
  readonly tipo: FiscalProviderTipo
  /** true nesta fase — o provider não faz emissão real. */
  readonly simulado: boolean

  validarConfiguracao(config: FiscalProviderConfigInput): FiscalProviderResponse
  validarSnapshot(snapshot: VendaFiscalSnapshot | null | undefined): FiscalProviderResponse
  prepararEmissao(request: FiscalProviderRequest): FiscalProviderResponse

  emitir(request: FiscalProviderRequest): Promise<FiscalProviderResponse>
  consultar(params: FiscalProviderConsultaParams): Promise<FiscalProviderResponse>
  cancelar(params: FiscalProviderCancelamentoParams): Promise<FiscalProviderResponse>
  inutilizar(params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse>
  statusServico(params: FiscalProviderStatusParams): Promise<FiscalProviderStatus>
}
