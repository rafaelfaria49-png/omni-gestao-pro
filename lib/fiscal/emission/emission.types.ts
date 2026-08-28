/**
 * Tipos do Pipeline Oficial de Emissão Fiscal (GOAL_007).
 *
 * O pipeline ORQUESTRA o provider (GOAL_006) sobre o snapshot congelado (GOAL_005) e
 * decide o próximo `Venda.fiscalStatus`. DORMENTE: usa só o STUB_HOMOLOGACAO, não gera
 * XML/DANFE/QRCode, não acessa a internet, não toca PDV/Caixa/Financeiro/Produto.
 * A ÚNICA escrita de negócio é `Venda.fiscalStatus`; a trilha vai para `FiscalLog`.
 */
import type { FiscalStatusVenda } from "@/generated/prisma"
import type {
  FiscalProvider,
  FiscalProviderConfigInput,
  FiscalProviderDados,
  FiscalProviderError,
  FiscalProviderResultado,
} from "../provider/types"
import type { VendaFiscalSnapshot } from "../venda-fiscal-snapshot"
import type {
  FiscalNumberAllocationOutcome,
  FiscalNumberingGap,
} from "../numbering/numbering.types"

export type EmissionInput = {
  storeId: string
  vendaId: string
  operador?: string | null
}

/** Resultado de alto nível de uma execução do pipeline. */
export type EmissionResultado =
  | "autorizada"
  | "rejeitada"
  | "pendente"
  | "contingencia"
  | "ja_autorizada" // idempotente — já estava AUTORIZADA
  | "em_andamento" // idempotente — já estava EMITINDO
  | "bloqueada" // estado fiscal não permite emitir (cancelada/bloqueada)
  | "erro" // pré-condição falhou (provider/snapshot/config)

export type EmissionErrorCode =
  | "venda_nao_encontrada"
  | "snapshot_inexistente" // não há NotaFiscal vigente para a venda
  | "snapshot_invalido" // snapshot malformado / sem itens
  | "loja_invalida" // identidade fiscal da loja insuficiente
  | "config_ausente"
  | "provider_ausente" // resolver não encontrou provider (desconhecido/não implementado)
  | "estado_bloqueado"
  | "numeracao_indisponivel" // sem série fiscal ativa / falha de numeração (GOAL_008)
  | "erro_interno"

export type EmissionEtapaNome = "validarConfiguracao" | "validarSnapshot" | "prepararEmissao" | "emitir"

/** Resumo de uma etapa do provider (para o relatório e o log). */
export type EmissionEtapaResumo = {
  etapa: EmissionEtapaNome
  resultado: FiscalProviderResultado
  ok: boolean
  mensagem: string
  pendencias: string[]
  erros: string[]
}

export type EmissionOutcome = {
  ok: boolean
  resultado: EmissionResultado
  /** SEMPRE true nesta fase — nenhuma emissão real. */
  simulado: boolean
  provider: string
  fiscalStatusAnterior: FiscalStatusVenda
  fiscalStatusNovo: FiscalStatusVenda
  /** True quando o pipeline NÃO transmitiu (idempotência ou pré-condição). */
  idempotente: boolean
  notaFiscalId: string | null
  /** Identificadores SIMULADOS (placeholder) devolvidos pelo provider, quando houver. */
  dados: FiscalProviderDados | null
  mensagem: string
  pendencias: string[]
  erros: FiscalProviderError[]
  errorCode: EmissionErrorCode | null
  etapas: EmissionEtapaResumo[]
  durationMs: number
}

// ── Log de emissão (gravado em FiscalLog) ────────────────────────────────────────────

export type FiscalEmissionLogNivel = "INFO" | "WARN" | "ERROR"

/** Entrada de log produzida pelo pipeline e entregue à porta `log`. */
export type FiscalEmissionLogEntry = {
  acao: string
  nivel: FiscalEmissionLogNivel
  mensagem: string
  cStat?: string | null
  xMotivo?: string | null
  /** Detalhe estruturado: provider, simulado, etapas, request/response resumidos, status, erro, tempo. */
  detalhe: Record<string, unknown>
}

// ── Portas (dependency injection) ─────────────────────────────────────────────────────

/**
 * Efeitos colaterais do pipeline, injetados pelo serviço. Mantém o pipeline livre de
 * Prisma (testável com portas falsas). A única escrita de estado é `setFiscalStatus`.
 */
export type EmissionPorts = {
  /** Persiste o novo `Venda.fiscalStatus` (único efeito de negócio permitido). */
  setFiscalStatus: (status: FiscalStatusVenda) => Promise<void>
  /** Grava uma entrada de trilha fiscal (best-effort; nunca deve derrubar a emissão). */
  log: (entry: FiscalEmissionLogEntry) => Promise<void>
  /**
   * Aloca/garante o número fiscal da NotaFiscal vigente ANTES de emitir (GOAL_008).
   * Opcional: ausente = numeração pulada (compatível com os testes do pipeline puro).
   * Quando presente e falha (ex.: série inativa), a emissão é abortada SEM mutar fiscalStatus.
   */
  allocateNumero?: (ctx: {
    storeId: string
    notaFiscalId: string | null
    modelo: string
    ambiente: string
  }) => Promise<FiscalNumberAllocationOutcome>
  /** Persiste lacunas de numeração como jobs INUTILIZACAO (GOAL 019). */
  recordLacunasParaInutilizacao?: (lacunas: FiscalNumberingGap[]) => Promise<void>
  /** Relógio injetável (testes determinísticos). */
  now?: () => number
}

/** Entrada do pipeline puro (tudo já carregado/resolvido pelo serviço). */
export type EmissionPipelineInput = {
  /** Provider resolvido (GOAL_006) ou null quando o resolver falhou. */
  provider: FiscalProvider | null
  /** Tipo do provider (para log mesmo quando `provider` é null). */
  providerTipo: string
  config: FiscalProviderConfigInput
  /** Snapshot congelado reconstruído da NotaFiscal vigente, ou null se inexistente. */
  snapshot: VendaFiscalSnapshot | null
  currentFiscalStatus: FiscalStatusVenda | string
  notaFiscalId: string | null
  /** Erro do resolver, quando `provider` é null. */
  resolveError?: FiscalProviderError | null
  operador?: string | null
}
