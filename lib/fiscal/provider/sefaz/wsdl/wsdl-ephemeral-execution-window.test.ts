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

const NEW_ACTIVATION_ID = "wsdl-h9h10-20260824-1800z-8cd1649df764940e"
const FORBIDDEN_ACTIVATION_IDS = [
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
}

function ledgerClient(shared: SharedLedger): WsdlActivationLedgerClient {
  return {
    $transaction: async (operation) => {
      let insertedKey: string | null = null
      const tx = {
        fiscalEmissaoJob: {
          create: async (args: unknown) => {
            const data = (args as { data: Record<string, unknown> }).data
            const key = String(data.dedupeKey)
            if (shared.keys.has(key)) throw new Error("unique constraint")
            shared.keys.add(key)
            insertedKey = key
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
      }
      try {
        return await operation(tx)
      } catch (error) {
        if (insertedKey) shared.keys.delete(insertedKey)
        throw error
      }
    },
  }
}

function sharedLedger(): SharedLedger {
  return { keys: new Set(), jobs: [], logs: [] }
}

describe("janela efêmera WSDL versionada", () => {
  it("prova dormência com configuração explícita, sem depender da constante versionada", () => {
    expect(evaluateWsdlExecutionWindow(DISABLED_CONFIG, new Date("2026-08-13T12:05:00Z"))).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("materializa a NOVA janela H-9/H-10 sem reutilizar activation histórica", () => {
    expect(WSDL_EPHEMERAL_EXECUTION_WINDOW).toEqual({
      activationId: NEW_ACTIVATION_ID,
      notBeforeUtc: "2026-08-24T18:00:00Z",
      expiresAtUtc: "2026-08-24T18:10:00Z",
    })
    for (const deadId of FORBIDDEN_ACTIVATION_IDS) {
      expect(WSDL_EPHEMERAL_EXECUTION_WINDOW.activationId).not.toBe(deadId)
    }
    expect(
      new Date(WSDL_EPHEMERAL_EXECUTION_WINDOW.expiresAtUtc!).getTime() -
        new Date(WSDL_EPHEMERAL_EXECUTION_WINDOW.notBeforeUtc!).getTime(),
    ).toBe(10 * 60 * 1_000)
  })

  it("gera hash e dedupe próprios da nova activation, distintos da activation morta", () => {
    const newHash = sha256Utf8(NEW_ACTIVATION_ID)
    const deadHash = sha256Utf8("wsdl-h9h10-20260825-1800z-8eb785376e4a4724")
    expect(newHash).toBe("7374cb215fde73e89584adf6a03c2c44872576c0f22d2538fc774d1692bf8650")
    expect(deadHash).toBe("1a61ea4d234c20ce9332f8c43d99ed775601884663e754a4a44ee7e561a8699a")
    expect(newHash).not.toBe(deadHash)
    expect(`fiscal:wsdl:h9-h10:v1:${newHash}`).toBe(
      "fiscal:wsdl:h9-h10:v1:7374cb215fde73e89584adf6a03c2c44872576c0f22d2538fc774d1692bf8650",
    )
    expect(`fiscal:wsdl:h9-h10:v1:${newHash}`).not.toBe(`fiscal:wsdl:h9-h10:v1:${deadHash}`)
  })

  it("avalia a janela materializada: not_started, active, expired em expiresAt e após", () => {
    const config = WSDL_EPHEMERAL_EXECUTION_WINDOW
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T17:59:59Z"))).toEqual({
      active: false,
      reason: "not_started",
    })
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T18:00:00Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T18:05:00Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T18:09:59Z")).active).toBe(true)
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T18:10:00Z"))).toEqual({
      active: false,
      reason: "expired",
    })
    expect(evaluateWsdlExecutionWindow(config, new Date("2026-08-24T18:10:01Z"))).toEqual({
      active: false,
      reason: "expired",
    })
  })

  it("não dispara rede ao avaliar a janela materializada nem ao hashear a activation", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    evaluateWsdlExecutionWindow(WSDL_EPHEMERAL_EXECUTION_WINDOW, new Date("2026-08-24T18:05:00Z"))
    sha256Utf8(NEW_ACTIVATION_ID)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("aceita a constante versionada somente dormente ou integralmente configurada", () => {
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

  it("avalia janela válida somente com relógios fixos", () => {
    expect(evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T11:59:59Z"))).toEqual({
      active: false,
      reason: "not_started",
    })
    expect(evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T12:00:00Z")).active).toBe(
      true,
    )
    expect(evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T12:05:00Z")).active).toBe(
      true,
    )
    expect(evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T12:10:00Z"))).toEqual({
      active: false,
      reason: "expired",
    })
    expect(evaluateWsdlExecutionWindow(ACTIVE_CONFIG, new Date("2026-08-13T12:10:01Z"))).toEqual({
      active: false,
      reason: "expired",
    })
  })
})

describe("ledger persistente global one-shot", () => {
  it("a nova activation persiste hash e dedupe próprios, sem a activation morta", async () => {
    const shared = sharedLedger()
    const gate = createWsdlExecutionGateTestHarness({
      client: ledgerClient(shared),
      config: WSDL_EPHEMERAL_EXECUTION_WINDOW,
      clock: () => new Date("2026-08-24T18:05:00Z"),
    })
    const consumed = await gate.consume({ storeId: "loja-1", operatorId: "admin" })
    expect(consumed.ok).toBe(true)
    expect(shared.jobs).toHaveLength(1)
    expect(shared.jobs[0]).toMatchObject({
      storeId: "loja-1",
      vendaId: "wsdl-h9-h10:7374cb215fde73e89584adf6a03c2c44872576c0f22d2538fc774d1692bf8650",
      dedupeKey:
        "fiscal:wsdl:h9-h10:v1:7374cb215fde73e89584adf6a03c2c44872576c0f22d2538fc774d1692bf8650",
      tipo: "CONSULTA",
      status: "CONCLUIDO",
    })
    expect(shared.jobs[0]?.payload).toMatchObject({
      activationHash: "7374cb215fde73e89584adf6a03c2c44872576c0f22d2538fc774d1692bf8650",
      targetCount: 6,
    })
    expect(JSON.stringify(shared.jobs)).not.toContain("wsdl-h9h10-20260825-1800z-8eb785376e4a4724")
    expect(JSON.stringify(shared.logs)).not.toContain("wsdl-h9h10-20260825-1800z-8eb785376e4a4724")
    expect(JSON.stringify(shared.jobs)).not.toContain(
      "1a61ea4d234c20ce9332f8c43d99ed775601884663e754a4a44ee7e561a8699a",
    )
  })

  it("duas invocations concorrentes consomem exatamente uma vez", async () => {
    const shared = sharedLedger()
    const client = ledgerClient(shared)
    const clock = () => new Date("2026-08-13T12:05:00Z")
    const gateA = createWsdlExecutionGateTestHarness({ client, config: ACTIVE_CONFIG, clock })
    const gateB = createWsdlExecutionGateTestHarness({ client, config: ACTIVE_CONFIG, clock })

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
    const firstProcess = createWsdlExecutionGateTestHarness({ client, config: ACTIVE_CONFIG, clock })
    expect((await firstProcess.consume({ storeId: "loja-1", operatorId: "admin-a" })).ok).toBe(true)

    const coldStart = createWsdlExecutionGateTestHarness({ client, config: ACTIVE_CONFIG, clock })
    expect(await coldStart.consume({ storeId: "loja-1", operatorId: "admin-b" })).toEqual({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
    expect(shared.jobs).toHaveLength(1)
  })

  it("não consome para outra loja nem fora da janela", async () => {
    const shared = sharedLedger()
    const client = ledgerClient(shared)
    const active = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock: () => new Date("2026-08-13T12:05:00Z"),
    })
    expect(await active.consume({ storeId: "loja-2", operatorId: "admin" })).toEqual({
      ok: false,
      code: "store_not_allowed",
    })
    const expired = createWsdlExecutionGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock: () => new Date("2026-08-13T12:10:00Z"),
    })
    expect(await expired.consume({ storeId: "loja-1", operatorId: "admin" })).toEqual({
      ok: false,
      code: "window_unavailable",
    })
    expect(shared.jobs).toHaveLength(0)
  })

  it("capability pós-ledger oferece exatamente seis alvos, uma vez cada, e expira em uso", async () => {
    const shared = sharedLedger()
    let now = new Date("2026-08-13T12:05:00Z")
    const gate = createWsdlExecutionGateTestHarness({
      client: ledgerClient(shared),
      config: ACTIVE_CONFIG,
      clock: () => now,
    })
    const consumed = await gate.consume({ storeId: "loja-1", operatorId: "admin" })
    if (!consumed.ok) throw new Error("fixture deveria consumir")

    expect(SEFAZ_WSDL_ACQUISITION_TARGETS).toHaveLength(WSDL_EXECUTION_EXPECTED_TARGETS)
    for (const target of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(true)
      expect(consumeWsdlTargetExecutionPermit(consumed.activation, target)).toBe(false)
    }

    const secondShared = sharedLedger()
    const expiring = createWsdlExecutionGateTestHarness({
      client: ledgerClient(secondShared),
      config: ACTIVE_CONFIG,
      clock: () => now,
    })
    const second = await expiring.consume({ storeId: "loja-1", operatorId: "admin" })
    if (!second.ok) throw new Error("fixture deveria consumir")
    now = new Date("2026-08-13T12:10:00Z")
    expect(consumeWsdlTargetExecutionPermit(second.activation, SEFAZ_WSDL_ACQUISITION_TARGETS[0]!)).toBe(
      false,
    )
  })
})
