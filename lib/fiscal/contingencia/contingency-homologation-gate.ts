/**
 * Gate efêmero ESPECÍFICO da homologação da contingência offline (GOAL 020).
 *
 * Reutiliza o PADRÃO de segurança provado no gate H-9/H-10
 * (`docs/fiscal/FISCAL_017_H9_H10_EPHEMERAL_EXECUTION_GATE_019.md`) — NÃO a sua
 * semântica: a janela H-9/H-10 autoriza aquisição WSDL/GET e jamais a
 * contingência. Este gate nasce DORMENTE e separado:
 *
 *   CONTINGENCY_HOMOLOGATION_WINDOW = { activationId: null, notBeforeUtc: null, expiresAtUtc: null }
 *
 * Ativar exige commit revisado preenchendo os três valores (UTC estrito,
 * `notBefore < expiresAt`, janela ≤ 15 minutos). Nenhuma env/feature flag é
 * chave de ativação. Config ausente, parcial, inválida, futura ou expirada
 * falha FECHADA antes de cofre, A1 e rede.
 *
 * Dois consumos, ambos one-shot pelo primitive `@@unique([storeId, dedupeKey])`
 * de `FiscalEmissaoJob` (sem schema/migration):
 *
 *  1. ENTRADA OFFLINE — `createContingencyEntryCertificateResolver` controla a
 *     resolução do A1 da loja-piloto na rota de contingência. Dormente ⇒ 503
 *     `EXTERNAL_HOMOLOGATION_PENDING` sem numeração, sem A1, sem persistência.
 *     Ativo ⇒ só resolve o material da loja; a entrada continua NÃO
 *     transmitindo (gera/assina/persiste tpEmis=9).
 *
 *  2. DRILL DE TRANSMISSÃO — `consumeContingencyDrillActivation` consome a
 *     ativação (activationId + job autorizado + loja) numa transação única
 *     ANTES de qualquer transporte. A capability positiva nasce por EXECUÇÃO,
 *     do binding opaco pós-commit — nunca global, nunca reutilizável.
 */
import { createHash } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { resolveActiveCertificate } from "@/lib/fiscal/certificate/resolve-active-certificate"
import type { ResolveActiveCertificateResult } from "@/lib/fiscal/certificate/resolve-active-certificate"
import { NfceSignError } from "@/lib/fiscal/signing"
import type { FiscalCertificateMaterial } from "@/lib/fiscal/signing/signer.types"
import { EnvVault, type EnvLike } from "@/lib/fiscal/vault/env-vault"
import type { FiscalSecretVault } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { loadPkcs12 } from "@/lib/fiscal/vault/pkcs12-loader"
import type { FiscalExternalExecutionCapability } from "@/lib/fiscal/emission/uncertain-state.types"

/** Configuração versionada — DORMENTE por nascimento. Preencher só em commit de ativação revisado. */
export const CONTINGENCY_HOMOLOGATION_WINDOW = Object.freeze({
  activationId: null,
  notBeforeUtc: null,
  expiresAtUtc: null,
}) satisfies ContingencyHomologationWindowConfig

export type ContingencyHomologationWindowConfig = {
  readonly activationId: string | null
  readonly notBeforeUtc: string | null
  readonly expiresAtUtc: string | null
}

export const CONTINGENCY_DRILL_MAX_WINDOW_MS = 15 * 60 * 1_000

export type ActiveContingencyWindow = {
  readonly activationId: string
  readonly notBefore: Date
  readonly expiresAt: Date
}

export type ContingencyWindowStatus =
  | { readonly active: true; readonly window: ActiveContingencyWindow }
  | {
      readonly active: false
      readonly reason: "disabled" | "invalid" | "not_started" | "expired"
    }

const ACTIVATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/
const STRICT_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

/** Parse UTC ESTRICTO: `2026-02-30` e `24:00` são inválidos (nunca normalizados por Date). */
function parseStrictUtc(value: string): Date | null {
  if (!STRICT_UTC_PATTERN.test(value)) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const canonical = parsed.toISOString()
  const expected = value.includes(".") ? value : value.replace(/Z$/, ".000Z")
  return canonical === expected ? parsed : null
}

export function evaluateContingencyHomologationWindow(
  config: ContingencyHomologationWindowConfig,
  now: Date,
): ContingencyWindowStatus {
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
    expiresAt.getTime() - notBefore.getTime() > CONTINGENCY_DRILL_MAX_WINDOW_MS
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

export function configuredContingencyWindowStatus(): ContingencyWindowStatus {
  return evaluateContingencyHomologationWindow(CONTINGENCY_HOMOLOGATION_WINDOW, new Date())
}

/* ========================================================================== *
 * ENTRADA OFFLINE — resolver de A1 controlado pelo gate
 * ========================================================================== */

export type ContingencyEntryResolverOptions = {
  /** Loja-piloto cujo A1 pode ser resolvido APENAS com a janela vigente. */
  readonly storeId: string
  readonly window?: ContingencyHomologationWindowConfig
  readonly now?: () => Date
  readonly resolveCertificate?: (params: {
    storeId: string
  }) => Promise<ResolveActiveCertificateResult>
  readonly vault?: FiscalSecretVault
  readonly env?: EnvLike
}

/**
 * Resolver do A1 da ENTRADA em contingência.
 *
 * Dormente/parcial/futura/expirada ⇒ NfceSignError `EXTERNAL_HOMOLOGATION_PENDING`
 * exatamente como o hardcode anterior — a rota continua 503 sem reservar
 * número, sem abrir cofre e sem persistir nada.
 *
 * Vigente ⇒ resolve SOMENTE o material A1 da loja informada (cofre → PKCS#12).
 * A entrada permanece sem transmissão: nada aqui fala com SEFAZ.
 */
export function createContingencyEntryCertificateResolver(
  options: ContingencyEntryResolverOptions,
): () => Promise<FiscalCertificateMaterial> {
  const windowConfig = options.window ?? CONTINGENCY_HOMOLOGATION_WINDOW
  const clock = options.now ?? (() => new Date())
  return async (): Promise<FiscalCertificateMaterial> => {
    const status = evaluateContingencyHomologationWindow(windowConfig, clock())
    if (!status.active) {
      throw new NfceSignError(
        "material_ausente",
        "EXTERNAL_HOMOLOGATION_PENDING: material A1 não liberado para este piloto.",
      )
    }
    const storeId = options.storeId.trim()
    if (!storeId) {
      throw new NfceSignError(
        "material_ausente",
        "Loja ausente para resolução do A1 da contingência.",
      )
    }
    const resolveCertificate = options.resolveCertificate ?? resolveActiveCertificate
    const resolved = await resolveCertificate({ storeId })
    if (!resolved.ok) {
      throw new NfceSignError(
        "material_ausente",
        "Material A1 indisponível na janela de homologação da contingência.",
      )
    }
    const vault = options.vault ?? new EnvVault({ env: options.env })
    let material: FiscalCertificateMaterial | null = null
    try {
      const pfx = await vault.getCertificadoPfx(storeId, resolved.blobRef)
      const senha = await vault.getCertificadoSenha(storeId, resolved.senhaRef)
      if (pfx && pfx.length > 0 && senha) {
        const loaded = loadPkcs12(pfx, senha)
        material = { privateKeyPem: loaded.privateKeyPem, certificatePem: loaded.certificatePem }
      }
    } catch {
      material = null
    }
    if (!material) {
      throw new NfceSignError(
        "material_ausente",
        "Material A1 indisponível no cofre na janela de homologação da contingência.",
      )
    }
    return material
  }
}

/* ========================================================================== *
 * DRILL DE TRANSMISSÃO — consumo one-shot persistente + capability por execução
 * ========================================================================== */

type DrillLedgerTransaction = {
  fiscalEmissaoJob: {
    create: (args: unknown) => Promise<{ id: string }>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
}

export type ContingencyDrillLedgerClient = {
  $transaction: <T>(operation: (tx: DrillLedgerTransaction) => Promise<T>) => Promise<T>
}

const CONTINGENCY_DRILL_ACTIVATION = Symbol("contingency-drill-activation")

/** Ativação opaca: incapaz de ser forjada fora deste módulo. */
export type ContingencyDrillActivation = {
  readonly [CONTINGENCY_DRILL_ACTIVATION]: true
}

type ActivationBinding = {
  readonly storeId: string
  readonly jobIdHash: string
  readonly notBeforeMs: number
  readonly expiresAtMs: number
  readonly clock: () => Date
}

const activationBindings = new WeakMap<object, ActivationBinding>()

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/** dedupeKey = operação + activationId + job autorizado (loja entra na @@unique). */
export function contingencyDrillDedupeKey(activationId: string, jobId: string): string {
  return `fiscal:contingencia:drill:v1:${sha256Hex(activationId)}:${sha256Hex(jobId)}`
}

export type ConsumeContingencyDrillActivationResult =
  | { readonly ok: true; readonly activation: ContingencyDrillActivation }
  | {
      readonly ok: false
      readonly code: "window_unavailable" | "already_consumed_or_persistence_unavailable"
    }

/**
 * Consumo GLOBAL one-shot da ativação PARA ESTE job — transação única
 * (ledger FiscalEmissaoJob + FiscalLog) executada ANTES de qualquer rede.
 * Conflito de unicidade (replay/cold start/concorrência) ou falha de
 * persistência colapsa no mesmo bloqueio: nenhum segundo transporte nasce.
 */
export async function consumeContingencyDrillActivation(
  client: ContingencyDrillLedgerClient,
  config: ContingencyHomologationWindowConfig,
  input: {
    readonly jobId: string
    readonly storeId: string
    readonly notaFiscalId: string | null
    readonly operatorId: string
  },
  clock: () => Date = () => new Date(),
): Promise<ConsumeContingencyDrillActivationResult> {
  const status = evaluateContingencyHomologationWindow(config, clock())
  if (!status.active) return { ok: false, code: "window_unavailable" }

  const activationId = status.window.activationId
  const hash = sha256Hex(activationId)
  const jobIdHash = sha256Hex(input.jobId)
  const dedupeKey = contingencyDrillDedupeKey(activationId, input.jobId)
  const now = clock()
  try {
    await client.$transaction(async (tx) => {
      const ledgerJob = await tx.fiscalEmissaoJob.create({
        data: {
          storeId: input.storeId,
          vendaId: `contingencia-drill:${jobIdHash}`,
          notaFiscalId: input.notaFiscalId,
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
            operation: "CONTINGENCIA_HOMOLOGATION_DRILL",
            activationHash: hash,
            drillJobHash: jobIdHash,
            consumedAt: now.toISOString(),
            transmission: { environment: "HOMOLOGACAO", exactBytes: true },
          },
          ultimoErro: null,
          concluidoEm: now,
        },
        select: { id: true },
      })
      await tx.fiscalLog.create({
        data: {
          storeId: input.storeId,
          vendaId: `contingencia-drill:${jobIdHash}`,
          notaFiscalId: input.notaFiscalId,
          jobId: ledgerJob.id,
          nivel: "INFO",
          acao: "fiscal.contingencia.drill.activation_consumed",
          cStat: null,
          xMotivo: null,
          mensagem: "Ativação do drill de contingência consumida de forma global e one-shot.",
          detalhe: {
            activationHash: hash,
            drillJobHash: jobIdHash,
            notBeforeUtc: status.window.notBefore.toISOString(),
            expiresAtUtc: status.window.expiresAt.toISOString(),
          },
          operador: input.operatorId,
        },
      })
    })
  } catch {
    // Conflito de unicidade e indisponibilidade de persistência bloqueiam igual:
    // nenhum dos dois pode nascer segunda tentativa de transporte.
    return { ok: false, code: "already_consumed_or_persistence_unavailable" }
  }

  // A transação pode terminar no limite da janela: consumo persistido, rede não.
  const afterCommit = evaluateContingencyHomologationWindow(config, clock())
  if (!afterCommit.active || afterCommit.window.activationId !== activationId) {
    return { ok: false, code: "window_unavailable" }
  }

  const activation: ContingencyDrillActivation = Object.freeze({
    [CONTINGENCY_DRILL_ACTIVATION]: true as const,
  })
  activationBindings.set(activation, {
    storeId: input.storeId,
    jobIdHash,
    notBeforeMs: afterCommit.window.notBefore.getTime(),
    expiresAtMs: afterCommit.window.expiresAt.getTime(),
    clock,
  })
  return { ok: true, activation }
}

/** Revalidação final — a última barreira antes do transporte. */
export function contingencyDrillActivationStillActive(
  activation: ContingencyDrillActivation,
): boolean {
  const binding = activationBindings.get(activation)
  if (!binding) return false
  const now = binding.clock().getTime()
  return now >= binding.notBeforeMs && now < binding.expiresAtMs
}

/**
 * Capability POSITIVA por EXECUÇÃO — nasce somente do binding opaco pós-commit,
 * para o par (loja, job) consumido, e somente dentro da janela. Objeto novo a
 * cada chamada: não há fábrica global, não há reuso entre jobs.
 */
export function contingencyDrillCapability(
  activation: ContingencyDrillActivation,
  input: { readonly jobId: string; readonly storeId: string },
): FiscalExternalExecutionCapability | null {
  const binding = activationBindings.get(activation)
  if (!binding) return null
  if (binding.storeId !== input.storeId) return null
  if (binding.jobIdHash !== sha256Hex(input.jobId)) return null
  if (!contingencyDrillActivationStillActive(activation)) return null
  return {
    allowExternalProviderExecution: true,
    concedidaPor: `contingencia-drill:v1:${sha256Hex(binding.jobIdHash).slice(0, 12)}:execucao-unica`,
  }
}

/**
 * Capability de CONSULTA do drill (GOAL 020 · relatório 127 · B-4) — LEITURA only.
 *
 * Diferente da capability de transmissão em dois pontos deliberados:
 *  - NÃO consome o one-shot: consulta por chave não transmite, não consome
 *    numeração e é a autoridade de reconciliação da máquina 017 — cobrar a
 *    ativação tornaria o pós-drill incerto irrecuperável;
 *  - nasce da JANELA vigente por execução (dormente ⇒ null), escopada ao
 *    (job do drill, loja, notaFiscalId do documento) — nunca global.
 *
 * A operação que ela autoriza continua presa aos guards D4 (modo consulta), ao
 * transporte injetado e ao freio GOAL-011 — consulta autorizada só atravessa
 * com a prova tipada do executor.
 */
export function contingencyDrillConsultationCapability(
  config: ContingencyHomologationWindowConfig,
  input: {
    readonly jobId: string
    readonly storeId: string
    readonly notaFiscalId: string
  },
  clock: () => Date = () => new Date(),
): FiscalExternalExecutionCapability | null {
  const status = evaluateContingencyHomologationWindow(config, clock())
  if (!status.active) return null
  const jobId = input.jobId.trim()
  const storeId = input.storeId.trim()
  const notaFiscalId = input.notaFiscalId.trim()
  if (!jobId || !storeId || !notaFiscalId) return null
  return {
    allowExternalProviderExecution: true,
    concedidaPor:
      `contingencia-drill:v1:consulta:` +
      sha256Hex(`${status.window.activationId}:${jobId}:${notaFiscalId}`).slice(0, 12),
  }
}

/** Seam somente de teste: config e relógio controlados, mesmo ledger. */
export function createContingencyDrillGateTestHarness(options: {
  readonly client: ContingencyDrillLedgerClient
  readonly config: ContingencyHomologationWindowConfig
  readonly clock: () => Date
}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Harness do gate de contingência disponível somente em testes.")
  }
  return {
    status: () => evaluateContingencyHomologationWindow(options.config, options.clock()),
    consume: (input: {
      readonly jobId: string
      readonly storeId: string
      readonly notaFiscalId: string | null
      readonly operatorId: string
    }) =>
      consumeContingencyDrillActivation(options.client, options.config, input, options.clock),
  }
}

/** Cliente padrão do ledger one-shot. */
export function defaultContingencyDrillLedgerClient(): ContingencyDrillLedgerClient {
  return prisma as unknown as ContingencyDrillLedgerClient
}
