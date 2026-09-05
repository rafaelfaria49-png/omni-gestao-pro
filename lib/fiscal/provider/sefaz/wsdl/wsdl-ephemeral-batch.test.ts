import { createHash } from "node:crypto"
import { createSecureContext } from "node:tls"
import { describe, expect, it, vi } from "vitest"
import { loadA1MtlsMaterial } from "@/lib/fiscal/certificate/a1-mtls-material"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { validTestPfx } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"
import { nfeAutorizacao4MultiOpFixture, wsdlFixture } from "./__fixtures__/wsdl-fixtures"
import {
  SefazWsdlAcquisition,
  type SefazWsdlAcquisitionOutcome,
} from "./wsdl-acquisition"
import { SEFAZ_WSDL_ACQUISITION_TARGETS } from "./wsdl-acquisition-target"
import {
  createWsdlEphemeralBatchTestRunner,
} from "./wsdl-ephemeral-batch"
import {
  consumeWsdlExecutionAuthority,
  createWsdlEphemeralExternalAuthority,
} from "./wsdl-execution-authority"
import {
  createWsdlExecutionGateTestHarness,
  type WsdlActivationLedgerClient,
  type WsdlExecutionActivation,
  type WsdlExecutionWindowConfig,
} from "./wsdl-ephemeral-execution-window"

const ACTIVE_CONFIG: WsdlExecutionWindowConfig = {
  activationId: "FISCAL-017-BATCH-019-TEST",
  notBeforeUtc: "2026-08-13T12:00:00Z",
  expiresAtUtc: "2026-08-13T12:10:00Z",
}

function sharedClient(keys = new Set<string>()): WsdlActivationLedgerClient {
  return {
    $transaction: async (operation) =>
      operation({
        fiscalEmissaoJob: {
          findFirst: async (args: unknown) => {
            const key = (args as { where: { dedupeKey: string } }).where.dedupeKey
            return keys.has(key) ? { id: "existing" } : null
          },
          create: async (args: unknown) => {
            const key = String((args as { data: { dedupeKey: string } }).data.dedupeKey)
            if (keys.has(key)) throw new Error("unique")
            keys.add(key)
            return { id: "job-1" }
          },
        },
        fiscalLog: { create: async () => ({}) },
        lockActivationScope: async () => {},
      }),
  }
}

async function activation(options: {
  client?: WsdlActivationLedgerClient
  clock?: () => Date
  config?: WsdlExecutionWindowConfig
} = {}): Promise<WsdlExecutionActivation> {
  const gate = createWsdlExecutionGateTestHarness({
    client: options.client ?? sharedClient(),
    config: options.config ?? ACTIVE_CONFIG,
    clock: options.clock ?? (() => new Date("2026-08-13T12:05:00Z")),
    resolvePilotStoreId: async () => "loja-1",
  })
  const result = await gate.consume({ storeId: "loja-1", operatorId: "admin" })
  if (!result.ok) throw new Error(`activation fixture falhou: ${result.code}`)
  return result.activation
}

function successOutcome(service: (typeof SEFAZ_WSDL_ACQUISITION_TARGETS)[number]["servico"]): SefazWsdlAcquisitionOutcome {
  const documento =
    service === "NFeAutorizacao4"
      ? nfeAutorizacao4MultiOpFixture()
      : wsdlFixture({ servico: service })
  const bytes = Buffer.from(documento, "utf8")
  return {
    ok: true,
    classification: "RESPONSE_RECEIVED",
    alvo: { uf: "SP", ambiente: "HOMOLOGACAO", servico: service, versao: "4.00" },
    httpStatus: 200,
    contentTypeEvidencia: "text/xml; charset=utf-8",
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    documento,
    externalTransmissionAttempted: true,
  }
}

const certificate = {
  storeId: "loja-1",
  blobRef: "SEGREDO_BLOB_REF_NAO_VAZAR",
  senhaRef: "SEGREDO_SENHA_REF_NAO_VAZAR",
}
const preparedSecureContext = createSecureContext()

describe("batch efêmero fechado H-9/H-10", () => {
  it("authority externa recusa alvo forjado e opções retargetadas antes de node:https", async () => {
    const token = await activation()
    const target = SEFAZ_WSDL_ACQUISITION_TARGETS[0]!
    const forged = {
      ...target,
      host: "attacker.invalid",
      url: `https://attacker.invalid${target.path}?wsdl`,
    }
    expect(createWsdlEphemeralExternalAuthority({ activation: token, target: forged })).toBeNull()

    const authority = createWsdlEphemeralExternalAuthority({ activation: token, target })
    expect(authority).not.toBeNull()
    if (!authority) throw new Error("authority fixture ausente")
    const runtime = consumeWsdlExecutionAuthority(authority, {
      alvo: target,
      correlationId: "correlation-test",
    })
    expect(runtime).not.toBeNull()
    if (!runtime) throw new Error("runtime fixture ausente")

    expect(() =>
      runtime.request(
        {
          protocol: "https:",
          hostname: "attacker.invalid",
          port: 443,
          path: `${target.path}?wsdl`,
          method: "GET",
          servername: target.host,
          secureContext: createSecureContext(),
        },
        () => undefined,
      ),
    ).toThrow("opções divergentes do alvo canônico")
  })

  it("se o relógio expira durante o carregamento A1, o runtime bloqueia antes de node:https", async () => {
    let now = new Date("2026-08-13T12:08:00Z")
    const token = await activation({ clock: () => now })
    const target = SEFAZ_WSDL_ACQUISITION_TARGETS[0]!
    const authority = createWsdlEphemeralExternalAuthority({ activation: token, target })
    if (!authority) throw new Error("authority fixture ausente")

    const fixture = validTestPfx({ senha: "senha-expiry-test" })
    const pfxRef = canonicalEnvRef("pfx", "loja-1")
    const senhaRef = canonicalEnvRef("senha", "loja-1")
    const env = {
      FISCAL_SECRET_PROVIDER: "env",
      [pfxRef]: fixture.pfx.toString("base64"),
      [senhaRef]: fixture.senha,
    }
    const loadMaterial = vi.fn(async (refs: Parameters<typeof loadA1MtlsMaterial>[0]) => {
      const material = await loadA1MtlsMaterial({ ...refs, env })
      now = new Date("2026-08-13T12:10:00Z")
      return material
    })
    const acquisition = new SefazWsdlAcquisition({ executionAuthority: authority, loadMaterial })

    const outcome = await acquisition.acquire({
      uf: target.uf,
      ambiente: target.ambiente,
      servico: target.servico,
      versao: target.versao,
      certificate: { storeId: "loja-1", blobRef: pfxRef, senhaRef },
      correlationId: "expiry-before-node-request",
    })

    expect(loadMaterial).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({
      ok: false,
      codigo: "wsdl_rede_incerta",
      externalTransmissionAttempted: false,
    })
    fixture.pfx.fill(0)
  })

  it("enumera exatamente os seis alvos canônicos, uma authority/GET por serviço e nenhum sétimo", async () => {
    const token = await activation()
    const createAuthority = vi.fn(createWsdlEphemeralExternalAuthority)
    const acquire = vi.fn(async ({ target }) => successOutcome(target.servico))
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority,
      acquire,
      correlationId: () => "correlation-test",
    })

    const result = await runner({ activation: token, certificate, preparedSecureContext })

    expect(result.ok).toBe(true)
    expect(result.services).toHaveLength(6)
    expect(new Set(result.services.map((item) => item.service)).size).toBe(6)
    expect(createAuthority).toHaveBeenCalledTimes(6)
    expect(acquire).toHaveBeenCalledTimes(6)
    for (const target of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      const calls = acquire.mock.calls.filter(([call]) => call.target.servico === target.servico)
      expect(calls).toHaveLength(1)
      expect(calls[0]![0].preparedSecureContext).toBe(preparedSecureContext)
    }
    const nfeAut = result.services.find((item) => item.service === "NFeAutorizacao4")
    expect(nfeAut).toMatchObject({
      service: "NFeAutorizacao4",
      h9: true,
      h10: true,
      operation: "nfeAutorizacaoLote",
      inputWrapper: "nfeDadosMsg",
      outputWrapper: "nfeResultMsg",
    })
  })

  it("uma falha é terminal para o serviço: não há retry e os demais continuam no máximo uma vez", async () => {
    const token = await activation()
    const calls = new Map<string, number>()
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority: createWsdlEphemeralExternalAuthority,
      acquire: async ({ target }) => {
        calls.set(target.servico, (calls.get(target.servico) ?? 0) + 1)
        if (target.servico === "NFeStatusServico4") {
          return {
            ok: false,
            codigo: "wsdl_rede_incerta",
            mensagem: "sanitizada",
            classification: "UNKNOWN_UNCERTAIN",
            externalTransmissionAttempted: true,
            transportPhase: "BEFORE_SECURE_CONNECT",
            transportClass: "DNS",
            transportCode: "ENOTFOUND",
          }
        }
        return successOutcome(target.servico)
      },
      correlationId: () => "correlation-test",
    })

    const result = await runner({ activation: token, certificate, preparedSecureContext })

    expect(result.ok).toBe(false)
    expect([...calls.values()]).toEqual([1, 1, 1, 1, 1, 1])
    expect(result.services.find((item) => item.service === "NFeStatusServico4")).toMatchObject({
      failureClass: "acquisition:wsdl_rede_incerta",
      h9: false,
      h10: false,
      // Cada serviço carrega a SUA própria evidência sanitizada de transporte.
      transportPhase: "BEFORE_SECURE_CONNECT",
      transportClass: "DNS",
      transportCode: "ENOTFOUND",
    })
    // Os demais serviços não herdam telemetria alheia.
    for (const service of result.services.filter((item) => item.service !== "NFeStatusServico4")) {
      expect(service.transportPhase).toBeNull()
      expect(service.transportClass).toBeNull()
      expect(service.transportCode).toBeNull()
    }
  })

  it("falha de aquisição sem telemetria serializa campos nulos — nunca ausentes/objeto cru", async () => {
    const token = await activation()
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority: createWsdlEphemeralExternalAuthority,
      acquire: async () => ({
        ok: false,
        codigo: "wsdl_tentativa_nao_autorizada",
        mensagem: "sanitizada",
        classification: "BLOCKED_BEFORE_NETWORK",
        externalTransmissionAttempted: false,
        transportPhase: null,
        transportClass: null,
        transportCode: null,
      }),
      correlationId: () => "correlation-test",
    })

    const result = await runner({ activation: token, certificate, preparedSecureContext })
    expect(result.ok).toBe(false)
    for (const service of result.services) {
      expect(service.failureClass).toBe("acquisition:wsdl_tentativa_nao_autorizada")
      expect(service.transportPhase).toBeNull()
      expect(service.transportClass).toBeNull()
      expect(service.transportCode).toBeNull()
    }
    const serialized = JSON.stringify(result)
    expect(serialized).toContain('"transportClass":null')
    expect(serialized).not.toContain("mensagem")
  })

  it("revalida expiresAt antes de cada authority e não inicia novos GETs após expirar", async () => {
    let now = new Date("2026-08-13T12:05:00Z")
    const token = await activation({ clock: () => now })
    const acquire = vi.fn(async ({ target }) => {
      now = new Date("2026-08-13T12:10:00Z")
      return successOutcome(target.servico)
    })
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority: createWsdlEphemeralExternalAuthority,
      acquire,
      correlationId: () => "correlation-test",
    })

    const result = await runner({ activation: token, certificate, preparedSecureContext })

    expect(acquire).toHaveBeenCalledOnce()
    expect(result.services).toHaveLength(6)
    expect(result.services.filter((item) => item.failureClass === "authority_unavailable")).toHaveLength(5)
  })

  it("duas invocations/cold starts no mesmo ledger deixam somente uma alcançar os seis GETs", async () => {
    const keys = new Set<string>()
    const client = sharedClient(keys)
    const clock = () => new Date("2026-08-13T12:05:00Z")
    const gates = [
      createWsdlExecutionGateTestHarness({
        client,
        config: ACTIVE_CONFIG,
        clock,
        resolvePilotStoreId: async () => "loja-1",
      }),
      createWsdlExecutionGateTestHarness({
        client,
        config: ACTIVE_CONFIG,
        clock,
        resolvePilotStoreId: async () => "loja-1",
      }),
    ]
    const acquire = vi.fn(async ({ target }) => successOutcome(target.servico))
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority: createWsdlEphemeralExternalAuthority,
      acquire,
      correlationId: () => "correlation-test",
    })

    const results = await Promise.all(
      gates.map(async (gate, index) => {
        const consumed = await gate.consume({ storeId: "loja-1", operatorId: `admin-${index}` })
        return consumed.ok
          ? runner({ activation: consumed.activation, certificate, preparedSecureContext })
          : consumed
      }),
    )

    expect(results.filter((result) => "services" in result)).toHaveLength(1)
    expect(acquire).toHaveBeenCalledTimes(6)
  })

  it("saída contém apenas evidência sanitizada, nunca documento, PFX, senha ou refs", async () => {
    const token = await activation()
    const rawMarker = "RAW_WSDL_BODY_MARCADOR_NAO_VAZAR"
    const runner = createWsdlEphemeralBatchTestRunner({
      createAuthority: createWsdlEphemeralExternalAuthority,
      acquire: async ({ target }) => {
        const outcome = successOutcome(target.servico)
        if (!outcome.ok) return outcome
        return { ...outcome, documento: outcome.documento.replace("</wsdl:definitions>", `<!--${rawMarker}--></wsdl:definitions>`) }
      },
      correlationId: () => "correlation-test",
    })

    const result = await runner({ activation: token, certificate, preparedSecureContext })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain(rawMarker)
    expect(serialized).not.toContain(certificate.blobRef)
    expect(serialized).not.toContain(certificate.senhaRef)
    expect(
      scanForSecrets(serialized, {
        extras: [rawMarker, certificate.blobRef, certificate.senhaRef],
      }).vazou,
    ).toBe(false)
  })
})
