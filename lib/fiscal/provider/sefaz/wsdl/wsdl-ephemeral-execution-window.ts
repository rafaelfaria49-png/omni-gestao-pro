/**
 * Janela efêmera versionada para a coleta oficial de WSDL (H-9/H-10).
 *
 * Estado atual (GOAL 020 · 166 · REARM de janela H-9/H-10 inédita):
 * **ARMADA** — activation nova para uma única execução humana controlada em HOMOLOGAÇÃO.
 *
 * A activation `wsdl-h9h10-20260905-1516z-025c3251e20744df` é inédita e válida de
 * 05/09 15:16:00Z a 16:01:00Z (45 minutos). Nenhuma activation morta foi reutilizada.
 * O agente não executa a invocation: POST administrativo, GET WSDL, handshake, SOAP e
 * emissão NFC-e permanecem proibidos nesta etapa; a única execução possível é humana,
 * same-origin e em HOMOLOGAÇÃO.
 *
 * H-9 e H-10 permanecem **ABERTOS**. A trust anchor ICP-Brasil v10 permanece implantada e
 * intacta. As activations de 30/08, 31/08, 02/09, 03/09 (`b3913bea58774deb`), 19:55z e
 * 23:25z seguem históricas/proibidas.
 * Gate 2 permanece humano e separado.
 *
 * A loja-piloto NÃO é literal. Ela é resolvida dinamicamente por `resolveWsdlPilotStore`
 * (ADR-0016 · regra do 132: `fiscalEnabled=false`, provider em {`STUB_HOMOLOGACAO`,
 * `SEFAZ_DIRETO`}) e o consumo exige que a request autenticada pertença EXATAMENTE à candidata
 * resolvida; zero ou múltiplas candidatas bloqueiam (fail-closed).
 *
 * One-shot GLOBAL preservado sem schema novo sobre o primitive existente
 * `FiscalEmissaoJob.@@unique([storeId, dedupeKey])` (que é por-loja): a transação de consumo
 * primeiro toma um advisory lock PostgreSQL (`pg_advisory_xact_lock`) escopado à dedupeKey —
 * serializando consumidores entre lojas, instâncias e cold starts — e depois recusa se QUALQUER
 * loja já tiver consumido a mesma activation (busca por `dedupeKey` sem escopo de loja). A
 * unique por-loja permanece como retaguarda. Nenhuma migration é criada.
 */
import "server-only"

import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { resolveWsdlPilotStore } from "./wsdl-pilot-store-resolver"
import {
  SEFAZ_WSDL_ACQUISITION_TARGETS,
  canonicalSefazWsdlTarget,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"

export const WSDL_EPHEMERAL_EXECUTION_WINDOW = Object.freeze({
  activationId: "wsdl-h9h10-20260905-1516z-025c3251e20744df",
  notBeforeUtc: "2026-09-05T15:16:00.000Z",
  expiresAtUtc: "2026-09-05T16:01:00.000Z",
}) satisfies WsdlExecutionWindowConfig

export const WSDL_EXECUTION_EXPECTED_TARGETS = 6 as const
/** Teto da janela EXTERNA de elegibilidade (arming): checks + build + presença humana. */
export const WSDL_EXECUTION_MAX_WINDOW_MS = 45 * 60 * 1_000
/** Teto absoluto da lease de rede, contado a partir do consumedAt persistido. */
export const WSDL_EXECUTION_NETWORK_LEASE_MS = 10 * 60 * 1_000
/**
 * Tempo mínimo restante até `expiresAtUtc` para iniciar a lease. Abaixo disso o consumo
 * falha fechado antes de qualquer socket (6 GET × 20s de deadline total).
 */
export const WSDL_EXECUTION_MIN_LEASE_MS = 2 * 60 * 1_000

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

export type WsdlExecutionNetworkLease =
  | {
      readonly ok: true
      readonly leaseExpiresAt: Date
      readonly leaseMs: number
    }
  | { readonly ok: false; readonly reason: "invalid" | "too_short" }

/**
 * Lease efetiva de rede: `min(consumedAt + 10min, expiresAtUtc)`. Nunca ultrapassa o
 * deadline externo nem o teto de 10 minutos. Recusa se a fatia restante for menor que
 * `WSDL_EXECUTION_MIN_LEASE_MS`.
 */
export function resolveWsdlExecutionNetworkLease(input: {
  readonly consumedAt: Date
  readonly expiresAt: Date
}): WsdlExecutionNetworkLease {
  const consumedAtMs = input.consumedAt.getTime()
  const expiresAtMs = input.expiresAt.getTime()
  if (Number.isNaN(consumedAtMs) || Number.isNaN(expiresAtMs) || consumedAtMs >= expiresAtMs) {
    return { ok: false, reason: "invalid" }
  }
  const uncappedEndMs = consumedAtMs + WSDL_EXECUTION_NETWORK_LEASE_MS
  const leaseExpiresAtMs = Math.min(uncappedEndMs, expiresAtMs)
  const leaseMs = leaseExpiresAtMs - consumedAtMs
  if (leaseMs > WSDL_EXECUTION_NETWORK_LEASE_MS) return { ok: false, reason: "invalid" }
  if (leaseMs < WSDL_EXECUTION_MIN_LEASE_MS) return { ok: false, reason: "too_short" }
  return {
    ok: true,
    leaseExpiresAt: new Date(leaseExpiresAtMs),
    leaseMs,
  }
}

type WsdlActivationTransaction = {
  fiscalEmissaoJob: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>
    create: (args: unknown) => Promise<{ id: string }>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
  /**
   * Serialização cross-store do consumo de uma activation. Implementação produtiva:
   * `pg_advisory_xact_lock(hashtext(dedupeKey))` — primitive do PostgreSQL, sem schema.
   */
  lockActivationScope: (dedupeKey: string) => Promise<void>
}

/** Runner tipado mínimo do `$queryRaw` de um cliente/transação Prisma. */
export type WsdlActivationQueryRawRunner = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>

/**
 * Advisory lock TRANSACIONAL do consumo one-shot (primitive PostgreSQL, sem schema).
 *
 * GOAL 135: `pg_advisory_xact_lock()` retorna `void` e o `$queryRaw` do Prisma não desserializa
 * colunas void (P2010 — primeira invocação real falhou na execução 134 de 30/08, rollback sem
 * write). O cast `::text AS lock` devolve a MESMA lock function, no MESMO escopo de transação,
 * mudando apenas o tipo da coluna devolvida — semântica de exclusão, ordem da transação e
 * escopo da chave permanecem idênticos. Deve continuar sendo a PRIMEIRA instrução da
 * transação de consumo.
 */
export async function wsdlActivationAdvisoryLock(
  runQuery: WsdlActivationQueryRawRunner,
  dedupeKey: string,
): Promise<void> {
  await runQuery`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))::text AS lock`
}

export type WsdlActivationLedgerClient = {
  $transaction: <T>(operation: (tx: WsdlActivationTransaction) => Promise<T>) => Promise<T>
}

function productiveActivationLedgerClient(): WsdlActivationLedgerClient {
  return {
    $transaction: (operation) =>
      prisma.$transaction(async (tx) => {
        const scoped = tx as unknown as {
          fiscalEmissaoJob: WsdlActivationTransaction["fiscalEmissaoJob"]
          fiscalLog: WsdlActivationTransaction["fiscalLog"]
          $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
        }
        return operation({
          fiscalEmissaoJob: scoped.fiscalEmissaoJob,
          fiscalLog: scoped.fiscalLog,
          lockActivationScope: async (dedupeKey) => {
            await wsdlActivationAdvisoryLock(scoped.$queryRaw.bind(scoped), dedupeKey)
          },
        })
      }),
  }
}

const WSDL_EXECUTION_ACTIVATION = Symbol("wsdl-execution-activation")

export type WsdlExecutionActivation = {
  readonly [WSDL_EXECUTION_ACTIVATION]: true
}

type ActivationBinding = {
  readonly storeId: string
  readonly activationHash: string
  readonly consumedAtMs: number
  readonly leaseExpiresAtMs: number
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
        | "pilot_store_unresolved"
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
  resolvePilotStoreId: () => Promise<string | null>,
  input: { readonly storeId: string; readonly operatorId: string },
  clock: () => Date,
): Promise<ConsumeWsdlExecutionActivationResult> {
  // Loja-piloto resolvida do registro REAL — nunca literal. Zero candidatas, múltiplas
  // candidatas ou falha de leitura devolvem o mesmo código fail-closed.
  const pilotStoreId = await resolvePilotStoreId()
  if (!pilotStoreId) return { ok: false, code: "pilot_store_unresolved" }
  if (input.storeId !== pilotStoreId) {
    return { ok: false, code: "store_not_allowed" }
  }
  const status = evaluateWsdlExecutionWindow(config, clock())
  if (!status.active) return { ok: false, code: "window_unavailable" }
  const availableTargets = canonicalTargetKeys()
  if (!availableTargets) return { ok: false, code: "target_catalog_invalid" }

  const hash = activationHash(status.window.activationId)
  const dedupeKey = `fiscal:wsdl:h9-h10:v1:${hash}`
  const now = clock()
  const lease = resolveWsdlExecutionNetworkLease({
    consumedAt: now,
    expiresAt: status.window.expiresAt,
  })
  if (!lease.ok) return { ok: false, code: "window_unavailable" }
  try {
    await client.$transaction(async (tx) => {
      // Serializa consumidores de QUALQUER loja para a mesma activation antes de checar.
      await tx.lockActivationScope(dedupeKey)
      // Exclusividade GLOBAL: a activation já consumida por qualquer loja recusa.
      const existing = await tx.fiscalEmissaoJob.findFirst({
        where: { dedupeKey },
        select: { id: true },
      })
      if (existing) throw new Error("wsdl_activation_already_consumed")
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
            leaseExpiresAt: lease.leaseExpiresAt.toISOString(),
            networkLeaseMs: WSDL_EXECUTION_NETWORK_LEASE_MS,
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
            leaseExpiresAtUtc: lease.leaseExpiresAt.toISOString(),
          },
          operador: input.operatorId,
        },
      })
    })
  } catch {
    // Colapsa conflito de unicidade, consumo prévio (qualquer loja) e indisponibilidade do
    // banco. Todos bloqueiam antes do A1/rede.
    return { ok: false, code: "already_consumed_or_persistence_unavailable" }
  }

  // A transação pode terminar no limite da lease. Persistimos o consumo, mas não emitimos rede.
  const afterCommitNow = clock()
  if (afterCommitNow.getTime() >= lease.leaseExpiresAt.getTime()) {
    return { ok: false, code: "window_unavailable" }
  }
  const afterCommit = evaluateWsdlExecutionWindow(config, afterCommitNow)
  if (!afterCommit.active || afterCommit.window.activationId !== status.window.activationId) {
    return { ok: false, code: "window_unavailable" }
  }

  const activation = Object.freeze({
    [WSDL_EXECUTION_ACTIVATION]: true as const,
  })
  activationBindings.set(activation, {
    storeId: input.storeId,
    activationHash: hash,
    consumedAtMs: now.getTime(),
    leaseExpiresAtMs: lease.leaseExpiresAt.getTime(),
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
    productiveActivationLedgerClient(),
    WSDL_EPHEMERAL_EXECUTION_WINDOW,
    async () => {
      const resolved = await resolveWsdlPilotStore()
      return resolved.ok ? resolved.storeId : null
    },
    input,
    () => new Date(),
  )
}

function networkLeaseStillOpen(binding: ActivationBinding): boolean {
  const now = binding.clock().getTime()
  return now >= binding.consumedAtMs && now < binding.leaseExpiresAtMs
}

/**
 * Consome a permissão de UM alvo. O prazo da LEASE INTERNA é revalidado aqui, imediatamente
 * antes da emissão da authority real. O relógio e os alvos vêm do binding privado, nunca do
 * request nem da janela externa de arming.
 */
export function consumeWsdlTargetExecutionPermit(
  activation: WsdlExecutionActivation,
  candidate: SefazWsdlTarget,
): boolean {
  const binding = activationBindings.get(activation)
  const canonical = canonicalSefazWsdlTarget(candidate)
  if (!binding || !canonical) return false
  if (!networkLeaseStillOpen(binding)) return false
  const key = targetKey(canonical)
  if (!binding.availableTargets.delete(key)) return false
  return true
}

/** Revalidação final da lease interna, imediatamente antes de criar o request Node. */
export function wsdlExecutionActivationStillActive(
  activation: WsdlExecutionActivation,
): boolean {
  const binding = activationBindings.get(activation)
  if (!binding) return false
  return networkLeaseStillOpen(binding)
}

/** Seam somente de teste: mesma transação/ledger, com config, relógio e piloto controlados. */
export function createWsdlExecutionGateTestHarness(options: {
  readonly client: WsdlActivationLedgerClient
  readonly config: WsdlExecutionWindowConfig
  readonly clock: () => Date
  readonly resolvePilotStoreId: () => Promise<string | null>
}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Harness de janela WSDL disponível somente em testes.")
  }
  return {
    status: () => evaluateWsdlExecutionWindow(options.config, options.clock()),
    consume: (input: { readonly storeId: string; readonly operatorId: string }) =>
      consumeActivation(
        options.client,
        options.config,
        options.resolvePilotStoreId,
        input,
        options.clock,
      ),
  }
}
