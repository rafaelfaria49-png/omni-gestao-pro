/**
 * GOAL 022 — composição canônica dormente do piloto NFC-e.
 *
 * Prova o wiring único fila → GOAL-012 → preparer → persistência → SefazDiretoProvider
 * com capability negada, A1 lazy não resolvido, transporte offline e zero rede.
 * Não abre certificado real. Não registra cron/rota/worker.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { DRY_RUN_TEST_CERT } from "@/lib/fiscal/dry-run"
import {
  EXTERNAL_EXECUTION_DENIED,
  type UncertainStatePersistence,
} from "@/lib/fiscal/emission/uncertain-state.types"
import { SefazDiretoProvider } from "@/lib/fiscal/provider/sefaz/sefaz-direto-provider"
import type { SefazGuardPorts } from "@/lib/fiscal/provider/sefaz/sefaz-guards"
import type { SefazTransport } from "@/lib/fiscal/provider/sefaz/sefaz-transport.types"
import { createPrismaFiscalQueueWorkerPorts } from "@/lib/fiscal/queue/prisma-queue-worker"
import type { FiscalQueueJob } from "@/lib/fiscal/queue/queue.types"
import {
  createNfceHomologationPilotWiring,
  NFCE_HOMOLOGATION_PILOT_QR_URLS,
  refuseDormantA1CertificateResolution,
} from "./nfce-homologation-pilot-wiring"

const HERE = dirname(fileURLToPath(import.meta.url))

function job(overrides: Partial<FiscalQueueJob> = {}): FiscalQueueJob {
  const now = new Date("2026-08-19T00:00:00.000Z")
  return {
    id: "job-piloto",
    storeId: "store-matriz-fixture",
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    tipo: "EMISSAO",
    status: "PROCESSANDO",
    tentativas: 1,
    maxTentativas: 5,
    proximaTentativaEm: now,
    prioridade: 0,
    lockOwner: "worker-a",
    lockedAt: now,
    lockExpiresAt: new Date(now.getTime() + 60_000),
    dedupeKey: "fiscal:emissao:v1:venda:venda-1",
    payload: { version: 1 },
    ultimoErro: null,
    concluidoEm: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function queueClient(config: Record<string, unknown>) {
  return {
    fiscalEmissaoJob: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    fiscalLog: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
    },
    configuracaoFiscalLoja: {
      findUnique: vi.fn(async () => config),
    },
    notaFiscal: {
      findFirst: vi.fn(async () => ({
        id: "nota-1",
        modelo: "NFCE",
        ambiente: "HOMOLOGACAO",
      })),
    },
  }
}

function persistenceSpies(): UncertainStatePersistence & {
  persistBeforeTransmission: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
} {
  return {
    load: vi.fn(),
    persistBeforeTransmission: vi.fn(),
    recordUncertainAndEnsureConsultation: vi.fn(),
    markAuthorized: vi.fn(),
    markRejected: vi.fn(),
    authorizeExactRetransmission: vi.fn(),
  } as unknown as UncertainStatePersistence & {
    persistBeforeTransmission: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
  }
}

function guardPorts(): SefazGuardPorts {
  return {
    resolvePilotStoreId: vi.fn(async () => null),
    loadFiscalConfig: vi.fn(async () => ({ provider: "SEFAZ_DIRETO" })),
    readXsdAttestation: vi.fn(async () => null),
    resolveActiveCertificate: vi.fn(async () => ({
      ok: false as const,
      codigo: "certificado_ativo_nao_configurado" as const,
      mensagem: "não deveria ser consultado no gate negado",
    })),
  }
}

describe("createNfceHomologationPilotWiring · composição canônica única", () => {
  it("monta um único pipeline GOAL-012 + SefazDiretoProvider com capability negada", () => {
    const wiring = createNfceHomologationPilotWiring({
      client: queueClient({
        provider: "SEFAZ_DIRETO",
        ambiente: "HOMOLOGACAO",
        modeloFiscal: "NFCE",
        fiscalEnabled: true,
      }) as never,
      sefazGuardPorts: guardPorts(),
    })
    expect(wiring.provider).toBeInstanceOf(SefazDiretoProvider)
    expect(wiring.capability).toBe(EXTERNAL_EXECUTION_DENIED)
    expect(wiring.capability.allowExternalProviderExecution).toBe(false)
    expect(wiring.transport.permiteRede).toBe(false)
    expect(NFCE_HOMOLOGATION_PILOT_QR_URLS.qrCodeBaseUrl).toContain("homologacao.nfce.fazenda.sp.gov.br")
  })

  it("SEFAZ_DIRETO + capability default ⇒ EXTERNAL_EXECUTION_NOT_AUTHORIZED e zero efeitos", async () => {
    const resolveCertificate = vi.fn(async () => DRY_RUN_TEST_CERT)
    const persistence = persistenceSpies()
    const transport: SefazTransport = {
      permiteRede: false,
      send: vi.fn(async () => ({
        ok: false as const,
        codigo: "transporte_offline_bloqueado" as const,
        mensagem: "offline",
        classification: "BLOCKED_BEFORE_NETWORK" as const,
        externalTransmissionAttempted: false,
      })),
    }
    const client = queueClient({
      provider: "SEFAZ_DIRETO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const ports = guardPorts()
    const wiring = createNfceHomologationPilotWiring({
      client: client as never,
      persistence,
      resolveCertificate,
      sefazGuardPorts: ports,
      transport,
    })
    const transmitSpy = vi.spyOn(wiring.provider, "transmit")
    const prepareSpy = vi.spyOn(wiring.preparer, "prepare")

    const result = await wiring.ports.execute(job())

    expect(result).toMatchObject({
      kind: "terminal",
      code: "external_execution_not_authorized",
      providerInvoked: false,
      externalTransmissionAttempted: false,
    })
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(resolveCertificate).not.toHaveBeenCalled()
    expect(persistence.load).not.toHaveBeenCalled()
    expect(persistence.persistBeforeTransmission).not.toHaveBeenCalled()
    expect(transport.send).not.toHaveBeenCalled()
    expect(transmitSpy).not.toHaveBeenCalled()
    expect(ports.resolveActiveCertificate).not.toHaveBeenCalled()
  })

  it("env não libera capability; default recusa A1 sem abrir cofre", async () => {
    const previous = process.env.FISCAL_ALLOW_EXTERNAL_EXECUTION
    process.env.FISCAL_ALLOW_EXTERNAL_EXECUTION = "1"
    process.env.FISCAL_SEFAZ_DIRETO_ENABLED = "true"
    try {
      const resolveCertificate = vi.fn(refuseDormantA1CertificateResolution)
      const persistence = persistenceSpies()
      const transport: SefazTransport = {
        permiteRede: false,
        send: vi.fn(async () => {
          throw new Error("send não deveria ser chamado")
        }),
      }
      const wiring = createNfceHomologationPilotWiring({
        client: queueClient({
          provider: "SEFAZ_DIRETO",
          ambiente: "HOMOLOGACAO",
          modeloFiscal: "NFCE",
          fiscalEnabled: true,
        }) as never,
        persistence,
        resolveCertificate,
        sefazGuardPorts: guardPorts(),
        transport,
      })
      const result = await wiring.ports.execute(job())
      expect(result.code).toBe("external_execution_not_authorized")
      expect(wiring.capability.allowExternalProviderExecution).toBe(false)
      expect(resolveCertificate).not.toHaveBeenCalled()
      expect(transport.send).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.FISCAL_ALLOW_EXTERNAL_EXECUTION
      else process.env.FISCAL_ALLOW_EXTERNAL_EXECUTION = previous
      delete process.env.FISCAL_SEFAZ_DIRETO_ENABLED
    }
  })

  it("STUB_HOMOLOGACAO no mesmo worker legado não regressa", async () => {
    const emit = vi.fn(async () => ({
      ok: true,
      resultado: "autorizada",
      simulado: true,
      provider: "STUB_HOMOLOGACAO",
      fiscalStatusAnterior: "PENDENTE",
      fiscalStatusNovo: "AUTORIZADA",
      idempotente: false,
      notaFiscalId: "nota-1",
      dados: null,
      mensagem: "Autorização simulada.",
      pendencias: [],
      erros: [],
      errorCode: null,
      etapas: [],
      durationMs: 1,
    }))
    const client = queueClient({
      provider: "STUB_HOMOLOGACAO",
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
    })
    const ports = createPrismaFiscalQueueWorkerPorts(client as never, emit as never)
    await expect(ports.execute(job())).resolves.toMatchObject({
      kind: "success",
      simulado: true,
      externalTransmissionAttempted: false,
    })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it("não dispara fetch e o módulo não importa transporte HTTP/mTLS nem H-9/H-10", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const wiring = createNfceHomologationPilotWiring({
      client: queueClient({
        provider: "SEFAZ_DIRETO",
        ambiente: "HOMOLOGACAO",
        modeloFiscal: "NFCE",
        fiscalEnabled: true,
      }) as never,
      persistence: persistenceSpies(),
      resolveCertificate: vi.fn(async () => DRY_RUN_TEST_CERT),
      sefazGuardPorts: guardPorts(),
    })
    await wiring.ports.execute(job())
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const src = readFileSync(resolve(HERE, "nfce-homologation-pilot-wiring.ts"), "utf8")
    expect(src).not.toMatch(/from\s+["']node:(http|https|net|tls)["']/)
    expect(src).not.toMatch(/sefaz-soap-transport|a1-mtls-material|wsdl-ephemeral/)
    expect(src).not.toMatch(/H-9|H-10|statusServico/)
    expect(src).not.toMatch(/allowExternalProviderExecution:\s*true/)
    expect(src).not.toMatch(/process\.env/)
    expect(src).toContain("EXTERNAL_EXECUTION_DENIED")
    expect(src).toContain("createPrismaGoal012FiscalQueueWorkerPorts")
    expect(src).toContain("createFinalizedNfcePreparer")
    expect(src).toContain("SefazDiretoProvider")
  })

  it("#73 (H-9/H-10) permanece fora deste GOAL", () => {
    const src = readFileSync(resolve(HERE, "nfce-homologation-pilot-wiring.ts"), "utf8")
    expect(src).not.toMatch(/wsdl-ephemeral-execution|WSDL_EXECUTION_PILOT_STORE_ID/)
    expect(src).not.toMatch(/cursor\/fiscal-017-h9-h10/)
  })
})
