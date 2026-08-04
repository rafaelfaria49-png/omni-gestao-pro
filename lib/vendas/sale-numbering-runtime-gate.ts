import "server-only"

import {
  isCanonicalVercelProject,
  isKnownVercelEnvironment,
  isProductionVercelEnvironment,
} from "@/lib/deploy/canonical-deployment"

import { SALE_WRITER_FLOW, type SaleWriterFlow } from "./sale-identity-contracts"

/**
 * Gate de runtime do writer server-side de numeração (GOAL 002C-0).
 *
 * Decisão canônica: `docs/decisions/ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md`.
 *
 * POLARIDADE — deliberadamente inversa à do guard de migrations:
 * lá, fail-closed protege o banco; aqui, fail-closed impediria VENDER. Toda
 * ausência, divergência, ambiente desconhecido ou erro de configuração devolve
 * **writer v1**, o comportamento conhecido. O gate nunca lança e nunca impede uma
 * venda do fluxo v1.
 *
 * Condições cumulativas para v2 — todas exatas, sem `trim` e sem case-fold:
 * 1. `VERCEL_ENV === "production"`;
 * 2. `VERCEL_PROJECT_ID` igual ao projeto canônico;
 * 3. `SALE_SERVER_NUMBERING_ENABLED === "true"`.
 *
 * O projeto legado nunca ativa v2, mesmo com a flag configurada por engano — ele
 * falha na condição 2, avaliada ANTES da flag.
 *
 * Este módulo é independente de `scripts/migration-authority-guard.mjs` como
 * decisão: `MIGRATION_AUTHORITY_ENABLED` não influencia o writer, e
 * `SALE_SERVER_NUMBERING_ENABLED` não influencia migrations. O único elo é a
 * constante do projeto canônico, reexportada por `@/lib/deploy/canonical-deployment`.
 *
 * Neste GOAL o gate NÃO tem call site: nenhum writer, rota ou PDV o consome, e a
 * flag não foi configurada em ambiente algum.
 */

/** Nome da variável de ambiente. O valor nunca é logado. */
export const SALE_SERVER_NUMBERING_FLAG = "SALE_SERVER_NUMBERING_ENABLED"

/** Único literal que ativa o writer v2. */
export const SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE = "true"

export const SALE_NUMBERING_GATE_REASON = Object.freeze({
  /** Sem `VERCEL_ENV` (local) ou ambiente diferente de production. */
  NON_PRODUCTION: "non-production",
  /** `VERCEL_ENV` fora de production/preview/development. */
  UNKNOWN_ENVIRONMENT: "unknown-environment",
  /** Production sem `VERCEL_PROJECT_ID`. */
  MISSING_PROJECT_ID: "missing-project-id",
  /** Production em projeto legado ou em qualquer terceiro projeto. */
  NON_CANONICAL_PROJECT: "non-canonical-project",
  /** Projeto canônico, flag ausente ou vazia. */
  FLAG_ABSENT: "flag-absent",
  /** Projeto canônico, flag presente mas diferente de `"true"` exato. */
  FLAG_NOT_EXACTLY_TRUE: "flag-not-exactly-true",
  /** Todas as condições satisfeitas. */
  ENABLED: "enabled",
} as const)

export type SaleNumberingGateReason =
  (typeof SALE_NUMBERING_GATE_REASON)[keyof typeof SALE_NUMBERING_GATE_REASON]

export type SaleNumberingGateEnv = {
  readonly VERCEL_ENV?: string | undefined
  readonly VERCEL_PROJECT_ID?: string | undefined
  readonly SALE_SERVER_NUMBERING_ENABLED?: string | undefined
}

export type SaleNumberingGateDecision = {
  readonly writer: SaleWriterFlow
  readonly reason: SaleNumberingGateReason
}

function decision(
  writer: SaleWriterFlow,
  reason: SaleNumberingGateReason,
): SaleNumberingGateDecision {
  return Object.freeze({ writer, reason })
}

/**
 * Avalia apenas metadados de deployment. Não lê banco, domínio, nome de projeto,
 * cabeçalho nem relógio. Função total: qualquer entrada devolve uma decisão.
 */
export function evaluateSaleNumberingWriter(
  env: SaleNumberingGateEnv = {},
): SaleNumberingGateDecision {
  const vercelEnvironment = env.VERCEL_ENV
  const projectId = env.VERCEL_PROJECT_ID
  const flag = env.SALE_SERVER_NUMBERING_ENABLED

  if (vercelEnvironment === undefined || vercelEnvironment === null || vercelEnvironment === "") {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.NON_PRODUCTION)
  }
  if (!isKnownVercelEnvironment(vercelEnvironment)) {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.UNKNOWN_ENVIRONMENT)
  }
  if (!isProductionVercelEnvironment(vercelEnvironment)) {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.NON_PRODUCTION)
  }

  if (projectId === undefined || projectId === null || projectId === "") {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.MISSING_PROJECT_ID)
  }
  if (!isCanonicalVercelProject(projectId)) {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.NON_CANONICAL_PROJECT)
  }

  if (flag === undefined || flag === null || flag === "") {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.FLAG_ABSENT)
  }
  if (flag !== SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE) {
    return decision(SALE_WRITER_FLOW.V1, SALE_NUMBERING_GATE_REASON.FLAG_NOT_EXACTLY_TRUE)
  }

  return decision(SALE_WRITER_FLOW.V2, SALE_NUMBERING_GATE_REASON.ENABLED)
}

/** Leitura do ambiente do processo. Server-only por construção. */
export function resolveSaleNumberingWriter(): SaleNumberingGateDecision {
  return evaluateSaleNumberingWriter({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    SALE_SERVER_NUMBERING_ENABLED: process.env.SALE_SERVER_NUMBERING_ENABLED,
  })
}

export function isServerSaleNumberingEnabled(env?: SaleNumberingGateEnv): boolean {
  const resolved = env ? evaluateSaleNumberingWriter(env) : resolveSaleNumberingWriter()
  return resolved.writer === SALE_WRITER_FLOW.V2
}
