/**
 * Janela efêmera versionada para a futura coleta oficial de WSDL (H-9/H-10).
 *
 * Não existe flag de ambiente. Ativar exige alterar as três constantes abaixo em commit
 * revisado; deployments antigos tornam-se inertes quando `expiresAtUtc` passa. Neste GOAL as
 * três permanecem `null`, portanto nenhuma autoridade real pode ser emitida.
 */
import "server-only"

import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  SEFAZ_WSDL_ACQUISITION_TARGETS,
  canonicalSefazWsdlTarget,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"

export const WSDL_EPHEMERAL_EXECUTION_WINDOW = Object.freeze({
  activationId: null,
  notBeforeUtc: null,
  expiresAtUtc: null,
}) satisfies WsdlExecutionWindowConfig

export const WSDL_EXECUTION_PILOT_STORE_ID = "loja-1" as const
export const WSDL_EXECUTION_EXPECTED_TARGETS = 6 as const
export const WSDL_EXECUTION_MAX_WINDOW_MS = 15 * 60 * 1_000

export type WsdlExecutionWindowConfig = {
  readonly activationId: string | null
  readonly notBeforeUtc: string | null
  readonly expiresAtUtc: string | null
}

export type ActiveWsdlExecutionWindow = {
  readonly activationId: string
  readonly notBefore: Date
  readonly expiresAt: Date
}

export type WsdlExecutionWindowStatus =
  | { readonly active: true; readonly window: ActiveWsdlExecutionWindow }
  | {
      readonly active: false
      readonly reason: "disabled" | "invalid" | "not_started" | "expired"
    }

const ACTIVATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/
const STRICT_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

function parseStrictUtc(value: string): Date | null {
  if (!STRICT_UTC_PATTERN.test(value)) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const canonical = parsed.toISOString()
  const expected = value.includes(".") ? value : value.replace(/Z$/, ".000Z")
  return canonical === expected ? parsed : null
}

export function evaluateWsdlExecutionWindow(
  config: WsdlExecutionWindowConfig,
  now: Date,
): WsdlExecutionWindowStatus {
  const activationId = config.activationId?.trim() ?? ""
  const notBeforeRaw = config.notBeforeUtc?.trim() ?? ""
  const expiresAtRaw = config.expiresAtUtc?.trim() ?? ""
  if (!activationId && !notBeforeRaw && !expiresAtRaw) return { active: false, reason: "disabled" }
  if (
    !ACTIVATION_ID_PATTERN.test(activationId) ||
    !notBeforeRaw ||
    !expiresAtRaw ||
    Number.isNaN(now.getTime())
  ) {
    return { active: false, reason: "invalid" }
  }

  const notBefore = parseStrictUtc(notBeforeRaw)
  const expiresAt = parseStrictUtc(expiresAtRaw)
  if (
    !notBefore ||
    !expiresAt ||
    expiresAt.getTime() <= notBefore.getTime() ||
    expiresAt.getTime() - notBefore.getTime() > WSDL_EXECUTION_MAX_WINDOW_MS
  ) {
    return { active: false, reason: "invalid" }
  }
  if (now.getTime() < notBefore.getTime()) return { active: false, reason: "not_started" }
  if (now.getTime() >= expiresAt.getTime()) return { active: false, reason: "expired" }
  return {
    active: true,
    window: Object.freeze({ activationId, notBefore, expiresAt }),
  }
}

export function configuredWsdlExecutionWindowStatus(): WsdlExecutionWindowStatus {
  return evaluateWsdlExecutionWindow(WSDL_EPHEMERAL_EXECUTION_WINDOW, new Date())
}

type WsdlActivationTransaction = {
  fiscalEmissaoJob: {
    create: (args: unknown) => Promise<{ id: string }>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
}

export type WsdlActivationLedgerClient = {
  $transaction: <T>(operation: (tx: WsdlActivationTransaction) => Promise<T>) => Promise<T>
}

const WSDL_EXECUTION_ACTIVATION = Symbol("wsdl-execution-activation")

export type WsdlExecutionActivation = {
  readonly [WSDL_EXECUTION_ACTIVATION]: true
}

type ActivationBinding = {
  readonly storeId: string
  readonly activationHash: string
  readonly notBeforeMs: number
  readonly expiresAtMs: number
  readonly clock: () => Date
  readonly availableTargets: Set<string>
}

const activationBindings = new WeakMap<object, ActivationBinding>()

export type ConsumeWsdlExecutionActivationResult =
  | { readonly ok: true; readonly activation: WsdlExecutionActivation }
  | {
      readonly ok: false
      readonly code:
        | "window_unavailable"
        | "store_not_allowed"
        | "target_catalog_invalid"
        | "already_consumed_or_persistence_unavailable"
    }

function targetKey(target: SefazWsdlTarget): string {
  return `${target.uf}|${target.ambiente}|${target.servico}|${target.versao}`
}

function canonicalTargetKeys(): Set<string> | null {
  if (SEFAZ_WSDL_ACQUISITION_TARGETS.length !== WSDL_EXECUTION_EXPECTED_TARGETS) return null
  const keys = new Set<string>()
  for (const candidate of SEFAZ_WSDL_ACQUISITION_TARGETS) {
    const canonical = canonicalSefazWsdlTarget(candidate)
    if (!canonical) return null
    keys.add(targetKey(canonical))
  }
  return keys.size === WSDL_EXECUTION_EXPECTED_TARGETS ? keys : null
}

function activationHash(activationId: string): string {
  return createHash("sha256").update(activationId, "utf8").digest("hex")
}

async function consumeActivation(
  client: WsdlActivationLedgerClient,
  config: WsdlExecutionWindowConfig,
  input: { readonly storeId: string; readonly operatorId: string },
  clock: () => Date,
): Promise<ConsumeWsdlExecutionActivationResult> {
  if (input.storeId !== WSDL_EXECUTION_PILOT_STORE_ID) {
    return { ok: false, code: "store_not_allowed" }
  }
  const status = evaluateWsdlExecutionWindow(config, clock())
  if (!status.active) return { ok: false, code: "window_unavailable" }
  const availableTargets = canonicalTargetKeys()
  if (!availableTargets) return { ok: false, code: "target_catalog_invalid" }

  const hash = activationHash(status.window.activationId)
  const dedupeKey = `fiscal:wsdl:h9-h10:v1:${hash}`
  const now = clock()
  try {
    await client.$transaction(async (tx) => {
      const job = await tx.fiscalEmissaoJob.create({
        data: {
          storeId: input.storeId,
          vendaId: `wsdl-h9-h10:${hash}`,
          notaFiscalId: null,
          tipo: "CONSULTA",
          status: "CONCLUIDO",
          tentativas: 1,
          maxTentativas: 1,
          proximaTentativaEm: null,
          prioridade: 0,
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
          dedupeKey,
          payload: {
            version: 1,
            operation: "WSDL_H9_H10_EPHEMERAL_ACQUISITION",
            activationHash: hash,
            targetCount: WSDL_EXECUTION_EXPECTED_TARGETS,
            consumedAt: now.toISOString(),
            transmission: { method: "GET", environment: "HOMOLOGACAO" },
          },
          ultimoErro: null,
          concluidoEm: now,
        },
        select: { id: true },
      })
      await tx.fiscalLog.create({
        data: {
          storeId: input.storeId,
          vendaId: `wsdl-h9-h10:${hash}`,
          notaFiscalId: null,
          eventoFiscalId: null,
          jobId: job.id,
          nivel: "INFO",
          acao: "fiscal.wsdl.h9_h10.activation_consumed",
          cStat: null,
          xMotivo: null,
          mensagem: "Janela efêmera WSDL consumida de forma global e one-shot.",
          detalhe: {
            activationHash: hash,
            targetCount: WSDL_EXECUTION_EXPECTED_TARGETS,
            notBeforeUtc: status.window.notBefore.toISOString(),
            expiresAtUtc: status.window.expiresAt.toISOString(),
          },
          operador: input.operatorId,
        },
      })
    })
  } catch {
    // Colapsa conflito de unicidade e indisponibilidade do banco. Ambos bloqueiam antes do A1/rede.
    return { ok: false, code: "already_consumed_or_persistence_unavailable" }
  }

  // A transação pode terminar no limite da janela. Persistimos o consumo, mas não emitimos rede.
  const afterCommit = evaluateWsdlExecutionWindow(config, clock())
  if (!afterCommit.active || afterCommit.window.activationId !== status.window.activationId) {
    return { ok: false, code: "window_unavailable" }
  }

  const activation = Object.freeze({
    [WSDL_EXECUTION_ACTIVATION]: true as const,
  })
  activationBindings.set(activation, {
    storeId: input.storeId,
    activationHash: hash,
    notBeforeMs: afterCommit.window.notBefore.getTime(),
    expiresAtMs: afterCommit.window.expiresAt.getTime(),
    clock,
    availableTargets,
  })
  return { ok: true, activation }
}

export async function consumeConfiguredWsdlExecutionActivation(input: {
  readonly storeId: string
  readonly operatorId: string
}): Promise<ConsumeWsdlExecutionActivationResult> {
  return consumeActivation(
    prisma as unknown as WsdlActivationLedgerClient,
    WSDL_EPHEMERAL_EXECUTION_WINDOW,
    input,
    () => new Date(),
  )
}

/**
 * Consome a permissão de UM alvo. O prazo é revalidado aqui, imediatamente antes da emissão da
 * authority real. O relógio e os alvos vêm do binding privado, nunca do request.
 */
export function consumeWsdlTargetExecutionPermit(
  activation: WsdlExecutionActivation,
  candidate: SefazWsdlTarget,
): boolean {
  const binding = activationBindings.get(activation)
  const canonical = canonicalSefazWsdlTarget(candidate)
  if (!binding || !canonical || binding.storeId !== WSDL_EXECUTION_PILOT_STORE_ID) return false
  const now = binding.clock().getTime()
  if (now < binding.notBeforeMs || now >= binding.expiresAtMs) return false
  const key = targetKey(canonical)
  if (!binding.availableTargets.delete(key)) return false
  return true
}

/** Revalidação final usada pelo runtime imediatamente antes de criar o request Node. */
export function wsdlExecutionActivationStillActive(
  activation: WsdlExecutionActivation,
): boolean {
  const binding = activationBindings.get(activation)
  if (!binding || binding.storeId !== WSDL_EXECUTION_PILOT_STORE_ID) return false
  const now = binding.clock().getTime()
  return now >= binding.notBeforeMs && now < binding.expiresAtMs
}

/** Seam somente de teste: mesma transação/ledger, com config e relógio controlados. */
export function createWsdlExecutionGateTestHarness(options: {
  readonly client: WsdlActivationLedgerClient
  readonly config: WsdlExecutionWindowConfig
  readonly clock: () => Date
}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Harness de janela WSDL disponível somente em testes.")
  }
  return {
    status: () => evaluateWsdlExecutionWindow(options.config, options.clock()),
    consume: (input: { readonly storeId: string; readonly operatorId: string }) =>
      consumeActivation(options.client, options.config, input, options.clock),
  }
}
