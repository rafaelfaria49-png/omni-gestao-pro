import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { SEFAZ_WSDL_ACQUISITION_TARGETS } from "./wsdl-acquisition-target"
import {
  WSDL_EPHEMERAL_EXECUTION_WINDOW,
  WSDL_EXECUTION_EXPECTED_TARGETS,
  WSDL_EXECUTION_MAX_WINDOW_MS,
  consumeWsdlTargetExecutionPermit,
  createWsdlExecutionGateTestHarness,
  evaluateWsdlExecutionWindow,
  type WsdlActivationLedgerClient,
  type WsdlExecutionWindowConfig,
} from "./wsdl-ephemeral-execution-window"

/** Evidência HISTÓRICA — nenhuma delas pode voltar a ser a constante executável. */
const HISTORICAL_ACTIVATION_IDS = [
  "wsdl-h9h10-20260824-1800z-8cd1649df764940e",
  "wsdl-h9h10-20260825-1800z-8eb785376e4a4724",
  "wsdl-h9h10-20260820-1800z-a7a5d306e59b2fca",
  "wsdl-h9h10-20260818-1800z-0152a8c5b96f3ffc",
  "wsdl-h9h10-20260817-1200z-aacb10409a3a805b",
  "wsdl-h9h10-20260815-1200z-a27b95ada93a0451",
  "wsdl-h9h10-20260814-2000z-8b84c7cad369cf62",
] as const

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

const DISABLED_CONFIG: WsdlExecutionWindowConfig = Object.freeze({
  activationId: null,
  notBeforeUtc: null,
  expiresAtUtc: null,
})

const ACTIVE_CONFIG: WsdlExecutionWindowConfig = Object.freeze({
  activationId: "FISCAL-017-GATE-019-TEST",
  notBeforeUtc: "2026-08-13T12:00:00Z",
  expiresAtUtc: "2026-08-13T12:10:00Z",
})

function versionedConfigHasAllowedStructure(config: WsdlExecutionWindowConfig): boolean {
  const values = [config.activationId, config.notBeforeUtc, config.expiresAtUtc]
  if (values.every((value) => value === null)) {
    const status = evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:05:00Z"))
    return !status.active && status.reason === "disabled"
  }
  if (!values.every((value) => typeof value === "string" && value.trim().length > 0)) return false

  const notBefore = new Date(config.notBeforeUtc!)
  const expiresAt = new Date(config.expiresAtUtc!)
  const durationMs = expiresAt.getTime() - notBefore.getTime()
  if (
    Number.isNaN(notBefore.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    durationMs <= 0 ||
    durationMs > WSDL_EXECUTION_MAX_WINDOW_MS
  ) {
    return false
  }

  const startStatus = evaluateWsdlExecutionWindow(config, notBefore)
  const expiryStatus = evaluateWsdlExecutionWindow(config, expiresAt)
  return startStatus.active && !expiryStatus.active && expiryStatus.reason === "expired"
}

type SharedLedger = {
  keys: Set<string>
  jobs: Array<Record<string, unknown>>
  logs: Array<Record<string, unknown>>
  lock: Promise<void>
}

/**
 * Emula o ledger real: advisory lock serializado (fila por promessa), busca global por
 * dedupeKey (qualquer loja) e a unique (storeId, dedupeKey) como retaguarda.
 */
function ledgerClient(shared: SharedLedger): WsdlActivationLedgerClient {
  return {
    $transaction: async (operation) => {
      const run = shared.lock.then(() =>
        operation({
          fiscalEmissaoJob: {
            findFirst: async (args: unknown) => {
              const where = (args as { where: { dedupeKey: string } }).where
              return shared.keys.has(where.dedupeKey) ? { id: "existing" } : null
            },
            create: async (args: unknown) => {
              const data = (args as { data: Record<string, unknown> }).data
              const key = String(data.dedupeKey)
              if (shared.keys.has(key)) throw new Error("unique constraint")
              shared.keys.add(key)
              shared.jobs.push(data)
              return { id: `job-${shared.jobs.length}` }
            },
          },
          fiscalLog: {
            create: async (args: unknown) => {
              shared.logs.push((args as { data: Record<string, unknown> }).data)
              return {}
            },
          },
          lockActivationScope: async () => {
            // A serialização já é garantida pela fila `shared.lock`.
          },
        }),
      )
      shared.lock = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

function sharedLedger(): SharedLedger {
  return { keys: new Set(), jobs: [], logs: [], lock: Promise.resolve() }
}

function gate(
  shared: SharedLedger,
  options: {
    config?: WsdlExecutionWindowConfig
    clock?: () => Date
    pilot?: string | null
  } = {},
) {
  return createWsdlExecutionGateTestHarness({
    client: ledgerClient(shared),
    config: options.config ?? ACTIVE_CONFIG,
    clock: options.clock ?? (() => new Date("2026-08-13T12:05:00Z")),
    resolvePilotStoreId: async () => (options.pilot === undefined ? "loja-1" : options.pilot),
  })
}

describe("janela efêmera WSDL versionada", () => {
  it("prova dormência com configuração explícita, sem depender da constante versionada", () => {
    expect(evaluateWsdlExecutionWindow(DISABLED_CONFIG, new Date("2026-08-13T12:05:00Z"))).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("constante versionada está e permanece DORMENTE (null/null/null) após o containment OFF do diagnóstico de 31/08", () => {
    expect(WSDL_EPHEMERAL_EXECUTION_WINDOW).toEqual({
      activationId: null,
      notBeforeUtc: null,
      expiresAtUtc: null,
    })
    expect(evaluateWsdlExecutionWindow(WSDL_EPHEMERAL_EXECUTION_WINDOW, new Date())).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("nenhuma activation — históricas, as duas de 30/08 e a de 31/08 expirada sem consumo — é configurável", () => {
    for (const deadId of [
      ...HISTORICAL_ACTIVATION_IDS,
      "wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d",
      "wsdl-h9h10-20260830-2005z-513540884b814ac1",
      "wsdl-h9h10-20260831-0300z-0c42c4389f65469d",
    ]) {
      expect(WSDL_EPHEMERAL_EXECUTION_WINDOW.activationId).not.toBe(deadId)
    }
  })

  it("derivação de dedupeKey permanece estável (v1 + SHA-256 da activation)", () => {
    const fixture = "FISCAL-017-GATE-019-TEST"
    for (const deadId of [
      ...HISTORICAL_ACTIVATION_IDS,
      "wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d",
      "wsdl-h9h10-20260830-2005z-513540884b814ac1",
      "wsdl-h9h10-20260831-0300z-0c42c4389f65469d",
    ]) {
      expect(`fiscal:wsdl:h9-h10:v1:${sha256Utf8(fixture)}`).not.toBe(
        `fiscal:wsdl:h9-h10:v1:${sha256Utf8(deadId)}`,
      )
    }
  })

  it("avalia janela fixture: not_started, active, expired em expiresAt e após", () => {
    const config = ACTIVE_CONFIG
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T11:59:59Z"))).toEqual({
      active: false,
      reason: "not_started",
    })
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:00:00Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:05:00Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:09:59Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:10:00Z"))).toEqual({
      active: false,
      reason: "expired",
    })
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-13T12:10:01Z"))).toEqual({
      active: false,
      reason: "expired",
    })
  })

  it("não dispara rede ao avaliar janelas nem ao hashear activations", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T12:05:00Z"))
    sha256Utf8(ACTIVE_CONFIG.activationId!)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("aceita configuração somente dormente ou integralmente configurada", () => {
    expect(versionedConfigHasAllowedStructure(WSDL_EPHEMERAL_EXECUTION_WINDOW)).toBe(true)
    expect(versionedConfigHasAllowedStructure(DISABLED_CONFIG)).toBe(true)
    expect(versionedConfigHasAllowedStructure(ACTIVE_CONFIG)).toBe(true)

    expect(
      versionedConfigHasAllowedStructure({
        activationId: ACTIVE_CONFIG.activationId,
        notBeforeUtc: null,
        expiresAtUtc: null,
      }),
    ).toBe(false)
    expect(versionedConfigHasAllowedStructure({ ...ACTIVE_CONFIG, notBeforeUtc: null })).toBe(false)
    expect(versionedConfigHasAllowedStructure({ ...ACTIVE_CONFIG, expiresAtUtc: null })).toBe(false)
    expect(versionedConfigHasAllowedStructure({ ...ACTIVE_CONFIG, activationId: null })).toBe(false)
  })

  it("recusa configuração parcial, id inválido, UTC não estrito e janela acima de 15 min", () => {
    const now = new Date("2026-08-13T12:05:00Z")
    expect(evaluateWsdlExecutionWindow({ ...ACTIVE_CONFIG, expiresAtUtc: null }, now)).toEqual({
      active: false,
      reason: "invalid",
    })
    expect(evaluateWsdlExecutionWindow({ ...ACTIVE_CONFIG, activationId: "curto" }, now)).toEqual({
      active: false,
      reason: "invalid",
    })
    expect(
      evaluateWsdlExecutionWindow({ ...ACTIVE_CONFIG, notBeforeUtc: "2026-08-13 12:00:00" }, now),
    ).toEqual({ active: false, reason: "invalid" })
    expect(
      evaluateWsdlExecutionWindow(
        { ...ACTIVE_CONFIG, expiresAtUtc: "2026-08-13T12:16:00Z" },
        now,
      ),
    ).toEqual({ active: false, reason: "invalid" })
    expect(
      evaluateWsdlExecutionWindow(
        { ...ACTIVE_CONFIG, notBeforeUtc: "2026-02-30T12:00:00Z" },
        now,
      ),
    ).toEqual({ active: false, reason: "invalid" })
    expect(
      evaluateWsdlExecutionWindow(
        { ...ACTIVE_CONFIG, notBeforeUtc: "2026-08-13T24:00:00Z" },
        now,
      ),
    ).toEqual({ active: false, reason: "invalid" })
  })

  it("janela parcial e janela expirada bloqueiam consumo fail-closed", async () => {
    const parcial = sharedLedger()
    expect(
      await gate(parcial, {
        config: { ...ACTIVE_CONFIG, expiresAtUtc: null },
        pilot: "loja-1",
      }).consume({ storeId: "loja-1", operatorId: "admin" }),
    ).toEqual({ ok: false, code: "window_unavailable" })

    const expirada = sharedLedger()
    expect(
      await gate(expirada, {
        clock: () => new Date("2026-08-13T12:10:00Z"),
        pilot: "loja-1",
      }).consume({ storeId: "loja-1", operatorId: "admin" }),
    ).toEqual({ ok: false, code: "window_unavailable" })
    expect(parcial.jobs).toHaveLength(0)
    expect(expirada.jobs).toHaveLength(0)
  })
})

describe("ledger persistente global one-shot", () => {
  it("a piloto RESOLVIDA consome uma vez, com hash e dedupe próprios", async () => {
    const shared = sharedLedger()
    const consumed = await gate(shared, { pilot: "loja-piloto-real" }).consume({
      storeId: "loja-piloto-real",
      operatorId: "admin",
    })
    expect(consumed.ok).toBe(true)
    expect(shared.jobs).toHaveLength(1)
    expect(shared.jobs[0]).toMatchObject({
      storeId: "loja-piloto-real",
      vendaId: `wsdl-h9-h10:${sha256Utf8(ACTIVE_CONFIG.activationId!)}`,
      dedupeKey: `fiscal:wsdl:h9-h10:v1:${sha256Utf8(ACTIVE_CONFIG.activationId!)}`,
      tipo: "CONSULTA",
      status: "CONCLUIDO",
    })
    expect(shared.jobs[0]?.payload).toMatchObject({
      activationHash: sha256Utf8(ACTIVE_CONFIG.activationId!),
      targetCount: 6,
    })
  })

  it("resolução sem piloto (zero candidatas, ambígua ou erro de leitura) bloqueia fail-closed", async () => {
    const shared = sharedLedger()
    expect(
      await gate(shared, { pilot: null }).consume({ storeId: "loja-1", operatorId: "admin" }),
    ).toEqual({ ok: false, code: "pilot_store_unresolved" })
    expect(shared.jobs).toHaveLength(0)
  })

  it("não consome para loja diferente da piloto resolvida", async () => {
    const shared = sharedLedger()
    expect(await gate(shared).consume({ storeId: "loja-2", operatorId: "admin" })).toEqual({
      ok: false,
      code: "store_not_allowed",
    })
    expect(shared.jobs).toHaveLength(0)
  })

  it("one-shot GLOBAL entre lojas: loja que vier a ser a piloto não reconsome a activation", async () => {
    const shared = sharedLedger()
    expect(
      await gate(shared, { pilot: "loja-a" }).consume({ storeId: "loja-a", operatorId: "a" }),
    ).toEqual({ ok: true, activation: expect.anything() })

    // A candidatura muda para outra loja dentro da mesma janela: a activation já foi
    // consumida GLOBALMENTE (qualquer loja) — não há uma segunda ativação.
    expect(
      await gate(shared, { pilot: "loja-b" }).consume({ storeId: "loja-b", operatorId: "b" }),
    ).toEqual({ ok: false, code: "already_consumed_or_persistence_unavailable" })
    expect(shared.jobs).toHaveLength(1)
    expect(shared.logs).toHaveLength(1)
  })

  it("duas invocations concorrentes consomem exatamente uma vez", async () => {
    const shared = sharedLedger()
    const client = ledgerClient(shared)
    const clock = () => new Date("2026-08-13T12:05:00Z")
    const resolvePilot = async () => "loja-1"
    const gateA = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock,
      resolvePilotStoreId: resolvePilot,
    })
    const gateB = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock,
      resolvePilotStoreId: resolvePilot,
    })

    const results = await Promise.all([
      gateA.consume({ storeId: "loja-1", operatorId: "admin-a" }),
      gateB.consume({ storeId: "loja-1", operatorId: "admin-b" }),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "already_consumed_or_persistence_unavailable" },
    ])
    expect(shared.jobs).toHaveLength(1)
    expect(shared.logs).toHaveLength(1)
    expect(shared.jobs[0]).toMatchObject({
      storeId: "loja-1",
      tipo: "CONSULTA",
      status: "CONCLUIDO",
      tentativas: 1,
      maxTentativas: 1,
      proximaTentativaEm: null,
    })
  })

  it("cold start não restaura a capacidade: novo gate no mesmo ledger continua bloqueado", async () => {
    const shared = sharedLedger()
    const client = ledgerClient(shared)
    const clock = () => new Date("2026-08-13T12:05:00Z")
    const resolvePilot = async () => "loja-1"
    const firstProcess = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock,
      resolvePilotStoreId: resolvePilot,
    })
    expect((await firstProcess.consume({ storeId: "loja-1", operatorId: "admin-a" })).ok).toBe(true)

    const coldStart = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock,
      resolvePilotStoreId: resolvePilot,
    })
    expect(await coldStart.consume({ storeId: "loja-1", operatorId: "admin-b" })).toEqual({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
    expect(shared.jobs).toHaveLength(1)
  })

  it("capability pós-ledger oferece exatamente seis alvos, uma vez cada, e expira em uso", async () => {
    const shared = sharedLedger()
    let now = new Date("2026-08-13T12:05:00Z")
    const consumed = await gate(shared, { clock: () => now }).consume({
      storeId: "loja-1",
      operatorId: "admin",
    })
    if (!consumed.ok) throw new Error("fixture deveria consumir")

    expect(SEFAZ_WSDL_ACQUISITION_TARGETS).toHaveLength(WSDL_EXECUTION_EXPECTED_TARGETS)
    for (const target of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(true)
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(false)
    }

    const secondShared = sharedLedger()
    const second = await gate(secondShared, { clock: () => now }).consume({
      storeId: "loja-1",
      operatorId: "admin",
    })
    if (!second.ok) throw new Error("fixture deveria consumir")
    now = new Date("2026-08-13T12:10:00Z")
    expect(
      consumeWsdlTargetExecutionPermit(second.activation, SEFAZ_WSDL_ACQUISITION_TARGETS[0]!),
    ).toBe(false)
  })
})
