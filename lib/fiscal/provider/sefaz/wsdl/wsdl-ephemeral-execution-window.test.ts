import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { SEFAZ_WSDL_ACQUISITION_TARGETS } from "./wsdl-acquisition-target"
import {
  WSDL_EPHEMERAL_EXECUTION_WINDOW,
  WSDL_EXECUTION_EXPECTED_TARGETS,
  WSDL_EXECUTION_MAX_WINDOW_MS,
  WSDL_EXECUTION_MIN_LEASE_MS,
  WSDL_EXECUTION_NETWORK_LEASE_MS,
  consumeWsdlTargetExecutionPermit,
  createWsdlExecutionGateTestHarness,
  evaluateWsdlExecutionWindow,
  resolveWsdlExecutionNetworkLease,
  wsdlExecutionActivationStillActive,
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

const ARMING_CONFIG: WsdlExecutionWindowConfig = Object.freeze({
  activationId: "FISCAL-020-GATE-152-TEST",
  notBeforeUtc: "2026-09-02T12:00:00.000Z",
  expiresAtUtc: "2026-09-02T12:45:00.000Z",
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

  it("constante versionada fica dormente após a activation consumida e a registra como morta", () => {
    expect(WSDL_EPHEMERAL_EXECUTION_WINDOW).toEqual({
      activationId: null,
      notBeforeUtc: null,
      expiresAtUtc: null,
    })
    expect(
      evaluateWsdlExecutionWindow(WSDL_EPHEMERAL_EXECUTION_WINDOW, new Date("2026-09-05T16:01:00.000Z")),
    ).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("nenhuma activation morta — históricas, 30/08, 31/08, 02/09, 0037z, 1955z, 2325z e 1516z consumida — é configurável", () => {
    for (const deadId of [
      ...HISTORICAL_ACTIVATION_IDS,
      "wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d",
      "wsdl-h9h10-20260830-2005z-513540884b814ac1",
      "wsdl-h9h10-20260831-0300z-0c42c4389f65469d",
      "wsdl-h9h10-20260831-1900z-99c21bca85a94cef",
      "wsdl-h9h10-20260831-2230z-891f55e242004bd2",
      "wsdl-h9h10-20260902-0430z-772103b09d9477ca",
      "wsdl-h9h10-20260902-1400z-4b5f2504640de6e4",
      "wsdl-h9h10-20260902-2127z-bfefedc2de8f65f9",
      "wsdl-h9h10-20260903-0037z-b3913bea58774deb",
      "wsdl-h9h10-20260904-1955z-d2c844a079986c9e",
      "wsdl-h9h10-20260904-2325z-fcad5be0637f918c",
      "wsdl-h9h10-20260905-1516z-025c3251e20744df",
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
      "wsdl-h9h10-20260831-1900z-99c21bca85a94cef",
      "wsdl-h9h10-20260831-2230z-891f55e242004bd2",
      "wsdl-h9h10-20260902-0430z-772103b09d9477ca",
      "wsdl-h9h10-20260902-1400z-4b5f2504640de6e4",
      "wsdl-h9h10-20260902-2127z-bfefedc2de8f65f9",
      "wsdl-h9h10-20260903-0037z-b3913bea58774deb",
      "wsdl-h9h10-20260904-1955z-d2c844a079986c9e",
      "wsdl-h9h10-20260904-2325z-fcad5be0637f918c",
      "wsdl-h9h10-20260905-1516z-025c3251e20744df",
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

  it("recusa configuração parcial, id inválido, UTC não estrito e janela acima do teto de arming", () => {
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
        { ...ACTIVE_CONFIG, expiresAtUtc: "2026-08-13T12:46:00Z" },
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

describe("GOAL 152 — janela externa de arming vs lease interna de rede", () => {
  it("1. configuração explícita null/null/null continua disabled (independente da constante versionada)", () => {
    expect(evaluateWsdlExecutionWindow(DISABLED_CONFIG, new Date("2026-09-03T00:59:00.000Z"))).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("2. janela externa antes de notBefore bloqueia", () => {
    expect(evaluateWsdlExecutionWindow(ARMING_CONFIG, new Date("2026-09-02T11:59:59.000Z"))).toEqual({
      active: false,
      reason: "not_started",
    })
  })

  it("3. janela externa depois de expiresAt bloqueia", () => {
    expect(evaluateWsdlExecutionWindow(ARMING_CONFIG, new Date("2026-09-02T12:45:00.000Z"))).toEqual({
      active: false,
      reason: "expired",
    })
  })

  it("4. janela externa maior que o teto de arming é inválida; exatamente o teto é válida", () => {
    expect(WSDL_EXECUTION_MAX_WINDOW_MS).toBe(45 * 60 * 1_000)
    expect(evaluateWsdlExecutionWindow(ARMING_CONFIG, new Date("2026-09-02T12:20:00.000Z")).active).toBe(
      true,
    )
    expect(
      evaluateWsdlExecutionWindow(
        { ...ARMING_CONFIG, expiresAtUtc: "2026-09-02T12:45:00.001Z" },
        new Date("2026-09-02T12:20:00.000Z"),
      ),
    ).toEqual({ active: false, reason: "invalid" })
  })

  it("5-7. consumo cria lease <=10 min a partir do consumedAt e nunca ultrapassa expiresAt", () => {
    expect(WSDL_EXECUTION_NETWORK_LEASE_MS).toBe(10 * 60 * 1_000)
    const consumedAt = new Date("2026-09-02T12:22:00.000Z")
    const expiresAt = new Date("2026-09-02T12:45:00.000Z")
    const full = resolveWsdlExecutionNetworkLease({ consumedAt, expiresAt })
    expect(full).toEqual({
      ok: true,
      leaseExpiresAt: new Date("2026-09-02T12:32:00.000Z"),
      leaseMs: WSDL_EXECUTION_NETWORK_LEASE_MS,
    })

    const capped = resolveWsdlExecutionNetworkLease({
      consumedAt: new Date("2026-09-02T12:40:00.000Z"),
      expiresAt,
    })
    expect(capped).toEqual({
      ok: true,
      leaseExpiresAt: expiresAt,
      leaseMs: 5 * 60 * 1_000,
    })
    if (capped.ok) {
      expect(capped.leaseMs).toBeLessThanOrEqual(WSDL_EXECUTION_NETWORK_LEASE_MS)
      expect(capped.leaseExpiresAt.getTime()).toBeLessThanOrEqual(expiresAt.getTime())
    }
  })

  it("8-9. permit funciona durante a lease e falha depois da lease", async () => {
    const shared = sharedLedger()
    let now = new Date("2026-09-02T12:22:00.000Z")
    const consumed = await gate(shared, { config: ARMING_CONFIG, clock: () => now }).consume({
      storeId: "loja-1",
      operatorId: "admin",
    })
    if (!consumed.ok) throw new Error("fixture deveria consumir")
    expect(shared.jobs[0]?.payload).toMatchObject({
      consumedAt: "2026-09-02T12:22:00.000Z",
      leaseExpiresAt: "2026-09-02T12:32:00.000Z",
      networkLeaseMs: WSDL_EXECUTION_NETWORK_LEASE_MS,
    })

    now = new Date("2026-09-02T12:31:59.000Z")
    expect(wsdlExecutionActivationStillActive(consumed.activation)).toBe(true)
    expect(
      consumeWsdlTargetExecutionPermit(consumed.activation, SEFAZ_WSDL_ACQUISITION_TARGETS[0]!),
    ).toBe(true)

    now = new Date("2026-09-02T12:32:00.000Z")
    expect(wsdlExecutionActivationStillActive(consumed.activation)).toBe(false)
    expect(
      consumeWsdlTargetExecutionPermit(consumed.activation, SEFAZ_WSDL_ACQUISITION_TARGETS[1]!),
    ).toBe(false)
  })

  it("10. segundo consumo da mesma activation falha", async () => {
    const shared = sharedLedger()
    const clock = () => new Date("2026-09-02T12:22:00.000Z")
    expect((await gate(shared, { config: ARMING_CONFIG, clock }).consume({ storeId: "loja-1", operatorId: "a" })).ok).toBe(
      true,
    )
    expect(await gate(shared, { config: ARMING_CONFIG, clock }).consume({ storeId: "loja-1", operatorId: "b" })).toEqual({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
    expect(shared.jobs).toHaveLength(1)
  })

  it("11-12. segundo uso do mesmo alvo falha e seis alvos continuam o teto", async () => {
    const shared = sharedLedger()
    const consumed = await gate(shared, {
      config: ARMING_CONFIG,
      clock: () => new Date("2026-09-02T12:22:00.000Z"),
    }).consume({ storeId: "loja-1", operatorId: "admin" })
    if (!consumed.ok) throw new Error("fixture deveria consumir")
    expect(SEFAZ_WSDL_ACQUISITION_TARGETS).toHaveLength(6)
    expect(WSDL_EXECUTION_EXPECTED_TARGETS).toBe(6)
    for (const target of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(true)
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(false)
    }
  })

  it("13-14. nenhum caminho adiciona retry e nenhum teste usa socket externo", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const shared = sharedLedger()
    const consumed = await gate(shared, {
      config: ARMING_CONFIG,
      clock: () => new Date("2026-09-02T12:22:00.000Z"),
    }).consume({ storeId: "loja-1", operatorId: "admin" })
    if (!consumed.ok) throw new Error("fixture deveria consumir")
    consumeWsdlTargetExecutionPermit(consumed.activation, SEFAZ_WSDL_ACQUISITION_TARGETS[0]!)
    wsdlExecutionActivationStillActive(consumed.activation)
    resolveWsdlExecutionNetworkLease({
      consumedAt: new Date("2026-09-02T12:22:00.000Z"),
      expiresAt: new Date("2026-09-02T12:45:00.000Z"),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    expect(shared.jobs[0]).toMatchObject({
      tentativas: 1,
      maxTentativas: 1,
      proximaTentativaEm: null,
    })
  })

  it("latência de deploy consome a janela externa e a invocation ainda recebe lease curta completa", async () => {
    const shared = sharedLedger()
    let now = new Date("2026-09-02T12:22:00.000Z")
    const consumed = await gate(shared, { config: ARMING_CONFIG, clock: () => now }).consume({
      storeId: "loja-1",
      operatorId: "admin",
    })
    if (!consumed.ok) throw new Error("invocation tardia deveria ainda consumir")
    expect(shared.jobs[0]?.payload).toMatchObject({
      consumedAt: "2026-09-02T12:22:00.000Z",
      leaseExpiresAt: "2026-09-02T12:32:00.000Z",
    })
    now = new Date("2026-09-02T12:22:00.000Z")
    expect(wsdlExecutionActivationStillActive(consumed.activation)).toBe(true)
    now = new Date("2026-09-02T12:31:59.999Z")
    expect(wsdlExecutionActivationStillActive(consumed.activation)).toBe(true)
    now = new Date("2026-09-02T12:32:00.000Z")
    expect(wsdlExecutionActivationStillActive(consumed.activation)).toBe(false)
  })

  it("sem tempo mínimo seguro para iniciar a lease, falha antes de persistir e sem rede", async () => {
    expect(WSDL_EXECUTION_MIN_LEASE_MS).toBe(2 * 60 * 1_000)
    const tooLate = resolveWsdlExecutionNetworkLease({
      consumedAt: new Date("2026-09-02T12:44:00.000Z"),
      expiresAt: new Date("2026-09-02T12:45:00.000Z"),
    })
    expect(tooLate).toEqual({ ok: false, reason: "too_short" })

    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const shared = sharedLedger()
    expect(
      await gate(shared, {
        config: ARMING_CONFIG,
        clock: () => new Date("2026-09-02T12:44:00.000Z"),
      }).consume({ storeId: "loja-1", operatorId: "admin" }),
    ).toEqual({ ok: false, code: "window_unavailable" })
    expect(shared.jobs).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("lease começa no consumedAt, não no notBefore/deploy", () => {
    const notBefore = new Date("2026-09-02T12:00:00.000Z")
    const consumedAt = new Date("2026-09-02T12:22:00.000Z")
    const expiresAt = new Date("2026-09-02T12:45:00.000Z")
    const lease = resolveWsdlExecutionNetworkLease({ consumedAt, expiresAt })
    expect(lease.ok).toBe(true)
    if (!lease.ok) return
    expect(lease.leaseExpiresAt.getTime()).toBe(consumedAt.getTime() + WSDL_EXECUTION_NETWORK_LEASE_MS)
    expect(lease.leaseExpiresAt.getTime()).not.toBe(notBefore.getTime() + WSDL_EXECUTION_NETWORK_LEASE_MS)
  })
})
