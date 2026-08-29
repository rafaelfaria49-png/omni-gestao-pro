/**
 * GOAL 020 — gate efêmero ESPECÍFICO da homologação da contingência.
 *
 * Matriz obrigatória: dormente, parcial, futura (before notBefore), expirada,
 * janela > 15 min, UTC não-estrito, consumo one-shot (replay, concorrência,
 * cold start), capability por execução não reutilizável e resolver de A1
 * fail-closed. Zero rede em todos os cenários.
 */
import { describe, expect, it, vi } from "vitest"

import { NfceSignError } from "@/lib/fiscal/signing"
import {
  CONTINGENCY_HOMOLOGATION_WINDOW,
  contingencyDrillCapability,
  contingencyDrillDedupeKey,
  createContingencyDrillGateTestHarness,
  createContingencyEntryCertificateResolver,
  evaluateContingencyHomologationWindow,
  type ContingencyDrillLedgerClient,
  type ContingencyHomologationWindowConfig,
} from "./contingency-homologation-gate"

type Row = Record<string, unknown>

const NOW = new Date("2026-09-01T12:05:00Z")
const ACTIVE_CONFIG: ContingencyHomologationWindowConfig = {
  activationId: "contingencia-drill-20260901-1200z-abcdef123456",
  notBeforeUtc: "2026-09-01T12:00:00Z",
  expiresAtUtc: "2026-09-01T12:10:00Z",
}

function shiftWindow(expiresAtUtc: string): ContingencyHomologationWindowConfig {
  return { ...ACTIVE_CONFIG, expiresAtUtc }
}

function createLedgerClient() {
  const jobs: Row[] = []
  const logs: Row[] = []
  const client = {
    $transaction: async <T,>(fn: (tx: never) => Promise<T>) => fn(client as never),
    fiscalEmissaoJob: {
      // Cheque+inserção síncronos: modela a @@unique([storeId, dedupeKey]) do banco.
      create: (async ({ data }: { data: Row }) => {
        const exists = jobs.some(
          (j) => j.storeId === data.storeId && j.dedupeKey === data.dedupeKey,
        )
        if (exists) throw new Error("Unique constraint failed: fiscalEmissaoJob")
        const row = { id: `ledger-${jobs.length + 1}`, ...data }
        jobs.push(row)
        return { id: row.id }
      }) as never,
    },
    fiscalLog: {
      create: (async ({ data }: { data: Row }) => {
        logs.push(data)
        return data
      }) as never,
    },
  }
  return { client: client as unknown as ContingencyDrillLedgerClient, jobs, logs }
}

describe("evaluateContingencyHomologationWindow — matriz de janela", () => {
  it("config DEFAULT nasce DORMENTE (três campos null)", async () => {
    expect(CONTINGENCY_HOMOLOGATION_WINDOW).toEqual({
      activationId: null,
      notBeforeUtc: null,
      expiresAtUtc: null,
    })
    expect(evaluateContingencyHomologationWindow(CONTINGENCY_HOMOLOGATION_WINDOW, NOW)).toEqual({
      active: false,
      reason: "disabled",
    })
  })

  it("config parcial (só activationId) é inválida", async () => {
    const partial: ContingencyHomologationWindowConfig = {
      activationId: ACTIVE_CONFIG.activationId,
      notBeforeUtc: null,
      expiresAtUtc: null,
    }
    expect(evaluateContingencyHomologationWindow(partial, NOW)).toEqual({
      active: false,
      reason: "invalid",
    })
  })

  it("antes de notBefore é not_started", async () => {
    const antes = new Date("2026-09-01T11:59:59Z")
    expect(evaluateContingencyHomologationWindow(ACTIVE_CONFIG, antes)).toEqual({
      active: false,
      reason: "not_started",
    })
  })

  it("a partir de expiresAt é expired", async () => {
    const depois = new Date("2026-09-01T12:10:00Z")
    expect(evaluateContingencyHomologationWindow(ACTIVE_CONFIG, depois)).toEqual({
      active: false,
      reason: "expired",
    })
  })

  it("janela maior que 15 minutos é inválida", async () => {
    expect(
      evaluateContingencyHomologationWindow(shiftWindow("2026-09-01T12:15:00.001Z"), NOW),
    ).toEqual({ active: false, reason: "invalid" })
  })

  it("janela de exatamente 15 minutos é válida", async () => {
    expect(
      evaluateContingencyHomologationWindow(shiftWindow("2026-09-01T12:15:00Z"), NOW).active,
    ).toBe(true)
  })

  it("datas fora do UTC estrito (calendário/relógio inventado) são inválidas", async () => {
    const invalida: ContingencyHomologationWindowConfig = {
      activationId: ACTIVE_CONFIG.activationId,
      notBeforeUtc: "2026-02-30T12:00:00Z",
      expiresAtUtc: "2026-09-01T12:15:00Z",
    }
    expect(evaluateContingencyHomologationWindow(invalida, NOW)).toEqual({
      active: false,
      reason: "invalid",
    })
    const horaInexistente: ContingencyHomologationWindowConfig = {
      activationId: ACTIVE_CONFIG.activationId,
      notBeforeUtc: "2026-09-01T12:00:00Z",
      expiresAtUtc: "2026-09-01T24:00:00Z",
    }
    expect(evaluateContingencyHomologationWindow(horaInexistente, NOW)).toEqual({
      active: false,
      reason: "invalid",
    })
    const offset: ContingencyHomologationWindowConfig = {
      activationId: ACTIVE_CONFIG.activationId,
      notBeforeUtc: "2026-09-01T09:00:00-03:00",
      expiresAtUtc: "2026-09-01T12:15:00Z",
    }
    expect(evaluateContingencyHomologationWindow(offset, NOW)).toEqual({
      active: false,
      reason: "invalid",
    })
  })

  it("janela vigente ativa com valores canônicos", async () => {
    const status = evaluateContingencyHomologationWindow(ACTIVE_CONFIG, NOW)
    expect(status.active).toBe(true)
    if (status.active) {
      expect(status.window.activationId).toBe(ACTIVE_CONFIG.activationId)
      expect(status.window.notBefore.toISOString()).toBe("2026-09-01T12:00:00.000Z")
      expect(status.window.expiresAt.toISOString()).toBe("2026-09-01T12:10:00.000Z")
    }
  })
})

describe("consumeContingencyDrillActivation — one-shot persistente", () => {
  const drillInput = {
    jobId: "job-drill-1",
    storeId: "loja-piloto",
    notaFiscalId: "nota-1",
    operatorId: "drill-test",
  }

  it("janela dormente não consome nada", async () => {
    const { client, jobs, logs } = createLedgerClient()
    const harness = createContingencyDrillGateTestHarness({
      client,
      config: CONTINGENCY_HOMOLOGATION_WINDOW,
      clock: () => NOW,
    })
    expect(await harness.consume(drillInput)).toMatchObject({
      ok: false,
      code: "window_unavailable",
    })
    expect(jobs).toHaveLength(0)
    expect(logs).toHaveLength(0)
  })

  it("janela vigente consome UMA vez com dedupe de ativação + operação + job", async () => {
    const { client, jobs, logs } = createLedgerClient()
    const harness = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    const result = await harness.consume(drillInput)
    expect(result.ok).toBe(true)
    expect(jobs).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(jobs[0]?.dedupeKey).toBe(
      contingencyDrillDedupeKey(ACTIVE_CONFIG.activationId ?? "", drillInput.jobId),
    )
    expect(jobs[0]?.dedupeKey).toContain("fiscal:contingencia:drill:v1:")
    expect(jobs[0]?.tipo).toBe("CONSULTA")
    expect(jobs[0]?.status).toBe("CONCLUIDO")
  })

  it("replay da MESMA ativação + job é bloqueado pelo ledger", async () => {
    const { client } = createLedgerClient()
    const harness = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    expect((await harness.consume(drillInput)).ok).toBe(true)
    expect(await harness.consume(drillInput)).toMatchObject({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
  })

  it("concorrência: exatamente um consumo vence", async () => {
    const { client } = createLedgerClient()
    const harness = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    const [a, b] = await Promise.all([harness.consume(drillInput), harness.consume(drillInput)])
    const vitorias = [a, b].filter((r) => r.ok)
    expect(vitorias).toHaveLength(1)
  })

  it("cold start: ledger persistido bloqueia novo consumo após 'reinício'", async () => {
    // Mesmo ledger (banco), nova instância de harness — sem memória de processo.
    const { client, jobs } = createLedgerClient()
    const primeiro = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    expect((await primeiro.consume(drillInput)).ok).toBe(true)
    const reiniciado = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    expect(await reiniciado.consume(drillInput)).toMatchObject({
      ok: false,
      code: "already_consumed_or_persistence_unavailable",
    })
    expect(jobs).toHaveLength(1)
  })

  it("janela expirada no meio (pós-commit) consome o ledger mas não ativa", async () => {
    const { client } = createLedgerClient()
    let clock = NOW
    const harness = createContingencyDrillGateTestHarness({
      client,
      config: ACTIVE_CONFIG,
      clock: () => clock,
    })
    clock = new Date("2026-09-01T12:10:00Z")
    expect(await harness.consume(drillInput)).toMatchObject({ ok: false, code: "window_unavailable" })
  })
})

describe("contingencyDrillCapability — por execução, não reutilizável", () => {
  const consumir = async () => {
    const { client } = createLedgerClient()
    const harness = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => NOW })
    const consumed = await harness.consume({
      jobId: "job-a",
      storeId: "loja-piloto",
      notaFiscalId: "nota-1",
      operatorId: "t",
    })
    if (!consumed.ok) throw new Error("setup falhou")
    return consumed.activation
  }

  it("capability nasce do binding pós-commit", async () => {
    const activation = await consumir()
    const capability = contingencyDrillCapability(activation, {
      jobId: "job-a",
      storeId: "loja-piloto",
    })
    expect(capability).not.toBeNull()
    expect(capability?.allowExternalProviderExecution).toBe(true)
    expect(capability?.concedidaPor).toContain("contingencia-drill")
  })

  it("objeto forjado fora do módulo nunca gera capability", async () => {
    const forjado = Object.freeze({ [Symbol("contingency-drill-activation")]: true })
    expect(
      contingencyDrillCapability(forjado as never, { jobId: "job-a", storeId: "loja-piloto" }),
    ).toBeNull()
  })

  it("capability é presa ao job e à loja consumidos", async () => {
    const activation = await consumir()
    expect(
      contingencyDrillCapability(activation, { jobId: "job-b", storeId: "loja-piloto" }),
    ).toBeNull()
    expect(
      contingencyDrillCapability(activation, { jobId: "job-a", storeId: "outra-loja" }),
    ).toBeNull()
  })

  it("capability após a janela é null", async () => {
    const { client } = createLedgerClient()
    let clock = NOW
    const harness = createContingencyDrillGateTestHarness({ client, config: ACTIVE_CONFIG, clock: () => clock })
    const consumed = await harness.consume({
      jobId: "job-a",
      storeId: "loja-piloto",
      notaFiscalId: "nota-1",
      operatorId: "t",
    })
    if (!consumed.ok) throw new Error("setup falhou")
    clock = new Date("2026-09-01T12:10:00Z")
    expect(
      contingencyDrillCapability(consumed.activation, { jobId: "job-a", storeId: "loja-piloto" }),
    ).toBeNull()
  })
})

describe("createContingencyEntryCertificateResolver — entrada offline", () => {
  it("dormente: EXTERNAL_HOMOLOGATION_PENDING sem tocar cofre ou resolver", async () => {
    const resolveCertificate = vi.fn()
    const resolver = createContingencyEntryCertificateResolver({
      storeId: "loja-1",
      resolveCertificate: resolveCertificate as never,
    })
    await expect(resolver()).rejects.toMatchObject({
      name: "NfceSignError",
      message: expect.stringContaining("EXTERNAL_HOMOLOGATION_PENDING"),
    })
    expect(resolveCertificate).not.toHaveBeenCalled()
  })

  it("config parcial/futura/expirada: mesmo bloqueio", async () => {
    const casos: ContingencyHomologationWindowConfig[] = [
      { activationId: ACTIVE_CONFIG.activationId, notBeforeUtc: null, expiresAtUtc: null },
      { ...ACTIVE_CONFIG, notBeforeUtc: "2026-09-01T23:59:00Z", expiresAtUtc: "2026-09-01T23:59:59Z" },
      { ...ACTIVE_CONFIG, notBeforeUtc: "2026-08-01T12:00:00Z", expiresAtUtc: "2026-08-01T12:05:00Z" },
    ]
    for (const window of casos) {
      const resolver = createContingencyEntryCertificateResolver({
        storeId: "loja-1",
        window,
        now: () => NOW,
        resolveCertificate: vi.fn(),
      })
      await expect(resolver()).rejects.toBeInstanceOf(NfceSignError)
    }
  })

  it("janela vigente com certificado indisponível falha fechado", async () => {
    const resolver = createContingencyEntryCertificateResolver({
      storeId: "loja-1",
      window: ACTIVE_CONFIG,
      now: () => NOW,
      resolveCertificate: (async () => ({
        ok: false as const,
        codigo: "sem_certificado",
        mensagem: "nada",
      })) as never,
      vault: {
        getCertificadoPfx: vi.fn(),
        getCertificadoSenha: vi.fn(),
      } as never,
    })
    await expect(resolver()).rejects.toMatchObject({
      message: expect.stringContaining("indisponível na janela"),
    })
  })

  it("janela vigente com cofre vazio falha fechado sem material", async () => {
    const resolver = createContingencyEntryCertificateResolver({
      storeId: "loja-1",
      window: ACTIVE_CONFIG,
      now: () => NOW,
      resolveCertificate: async () => ({
        ok: true as const,
        storeId: "loja-1",
        certificadoId: "c1",
        blobRef: "blob",
        senhaRef: "senha",
        provider: "env-piloto-teste",
      }),
      vault: {
        getCertificadoPfx: async () => null,
        getCertificadoSenha: async () => null,
      } as never,
    })
    await expect(resolver()).rejects.toMatchObject({
      message: expect.stringContaining("indisponível no cofre"),
    })
  })
})
