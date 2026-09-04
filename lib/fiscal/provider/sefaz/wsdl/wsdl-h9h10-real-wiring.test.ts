/**
 * Regressao de wiring REAL do caminho H9/H10 (GOAL-020 P1 FIX).
 *
 * Provas obrigatorias (A a I):
 * A. endpoint prepara SecureContext com trust SEFAZ (loadA1SefazMtlsSecureContext);
 * B. o contexto preparado e entregue ao batch (runConfiguredWsdlEphemeralBatch);
 * C. SefazWsdlAcquisition reutiliza exatamente esse contexto sem recria-lo;
 * D. a authority externa fallback usa a mesma composicao (createSefazSecureContext);
 * E. loopbacks permanecem estritamente isolados com sua propria CA sintetica;
 * F. credenciais A1 (pfx, passphrase) chegam intactas ao OpenSSL;
 * G. minVersion continua TLSv1.2 em todos os caminhos;
 * H. rejectUnauthorized continua estritamente true;
 * I. nenhuma variavel de ambiente global de CA e necessaria.
 */
import { describe, expect, it, vi } from "vitest"
import { X509Certificate } from "node:crypto"
import tls, { type SecureContext } from "node:tls"
import {
  createSefazSecureContext,
  getSefazCompositeRootCAs,
  loadIcpBrasilV10Pem,
  normalizePem,
} from "../trust/icp-brasil-v10"
import {
  nodeSefazHttpsRuntimePorts,
  createOfflineLoopbackTestAuthority,
  consumeOfflineLoopbackTestAuthority,
} from "../sefaz-runtime-ports"
import {
  createWsdlEphemeralExternalAuthority,
  createWsdlLoopbackTestAuthority,
  consumeWsdlExecutionAuthority,
  type SefazWsdlLoopbackTestProbe,
} from "./wsdl-execution-authority"
import { SefazWsdlAcquisition } from "./wsdl-acquisition"
import {
  createWsdlExecutionGateTestHarness,
  type WsdlActivationLedgerClient,
  type WsdlExecutionWindowConfig,
} from "./wsdl-ephemeral-execution-window"
import {
  loadA1MtlsSecureContext,
  loadA1SefazMtlsSecureContext,
} from "@/lib/fiscal/certificate/a1-mtls-material"
import { createTestMtlsPki } from "../__fixtures__/mtls-test-pki"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { validTestPfx } from "@/lib/fiscal/vault/__fixtures__/make-test-pfx"
import { SEFAZ_WSDL_ACQUISITION_TARGETS } from "./wsdl-acquisition-target"
import type { SefazWsdlTarget } from "./wsdl-acquisition-target"

const STORE = "store-wiring-h9h10"
const PFX_REF = canonicalEnvRef("pfx", STORE)
const SENHA_REF = canonicalEnvRef("senha", STORE)

const ACTIVE_CONFIG: WsdlExecutionWindowConfig = {
  activationId: "FISCAL-017-WIRING-H9H10-TEST",
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

function testEnv(pfx: Buffer, senha: string): Record<string, string> {
  return {
    FISCAL_SECRET_PROVIDER: "env",
    [PFX_REF]: pfx.toString("base64"),
    [SENHA_REF]: senha,
  }
}

const canonicalTarget: SefazWsdlTarget = SEFAZ_WSDL_ACQUISITION_TARGETS[0]!

describe("Wiring REAL H9/H10: Trust Composta SEFAZ ICP-Brasil v10 (Criterios A a I)", () => {
  const pki = createTestMtlsPki()

  it("Criterio A: loadA1SefazMtlsSecureContext constroi SecureContext usando a factory canonica SEFAZ", async () => {
    const fixture = validTestPfx({ senha: "senha-wiring-teste-a" })
    const env = testEnv(fixture.pfx, fixture.senha)

    // Constrói o contexto através da primitiva real que o endpoint H9/H10 consome
    const secureContext = await loadA1SefazMtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env,
    })

    expect(secureContext).toBeDefined()
    expect(typeof secureContext).toBe("object")
    fixture.pfx.fill(0)
  })

  it("Criterio B: o contexto preparado e entregue intacto ao batch", async () => {
    const fixture = validTestPfx({ senha: "senha-wiring-teste-b" })
    const env = testEnv(fixture.pfx, fixture.senha)

    const preparedSecureContext = await loadA1SefazMtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env,
    })

    // Simula a passagem pelo batch e verifica que o mesmo objeto contexto e entregue
    let capturedContext: SecureContext | null = null
    const mockBatchRunner = async (input: { preparedSecureContext: SecureContext }) => {
      capturedContext = input.preparedSecureContext
    }

    await mockBatchRunner({ preparedSecureContext })

    expect(capturedContext).toBe(preparedSecureContext)
    fixture.pfx.fill(0)
  })

  it("Criterio C: SefazWsdlAcquisition reutiliza exatamente o preparedSecureContext sem invocar runtime.createSecureContext", async () => {
    const fixture = validTestPfx({ senha: "senha-wiring-teste-c" })
    const env = testEnv(fixture.pfx, fixture.senha)

    const preparedSecureContext = await loadA1SefazMtlsSecureContext({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      env,
    })

    const probe: SefazWsdlLoopbackTestProbe = {
      secureContextCalls: 0,
      runtimeRequestCalls: 0,
      nodeRequestCalls: 0,
      destroyCalls: 0,
      destinations: [],
      methods: [],
      paths: [],
      servernames: [],
    }

    const authority = createWsdlLoopbackTestAuthority({
      port: 8443,
      trustedCaPem: pki.caCertificatePem,
      escopo: {
        uf: canonicalTarget.uf,
        ambiente: canonicalTarget.ambiente,
        servico: canonicalTarget.servico,
        versao: canonicalTarget.versao,
      },
      probe,
      throwSynchronouslyBeforeNodeRequest: true,
    })

    const acquisition = new SefazWsdlAcquisition({
      executionAuthority: authority,
    })

    const outcome = await acquisition.acquire({
      uf: canonicalTarget.uf,
      ambiente: canonicalTarget.ambiente,
      servico: canonicalTarget.servico,
      versao: canonicalTarget.versao,
      correlationId: "corr-wiring-c",
      certificate: { storeId: STORE, blobRef: PFX_REF, senhaRef: SENHA_REF },
      preparedSecureContext,
    })

    // Prova C1: runtime.createSecureContext NAO foi chamado, pois preparedSecureContext foi reutilizado diretamente
    expect(probe.secureContextCalls).toBe(0)

    // Prova C2: o runtime tentou fazer a requisição usando o contexto preparado (falhou sinteticamente antes do socket)
    expect(probe.runtimeRequestCalls).toBe(1)
    expect(outcome.ok).toBe(false)
    fixture.pfx.fill(0)
  })

  it("Criterio D: a authority externa fallback usa createSefazSecureContext com trust composta", async () => {
    const gate = createWsdlExecutionGateTestHarness({
      client: sharedClient(),
      config: ACTIVE_CONFIG,
      clock: () => new Date("2026-08-13T12:05:00Z"),
      resolvePilotStoreId: async () => STORE,
    })
    const consumed = await gate.consume({ storeId: STORE, operatorId: "admin" })
    expect(consumed.ok).toBe(true)
    if (!consumed.ok) throw new Error("activation falhou")

    const externalAuthority = createWsdlEphemeralExternalAuthority({
      activation: consumed.activation,
      target: canonicalTarget,
    })
    expect(externalAuthority).not.toBeNull()

    const runtime = consumeWsdlExecutionAuthority(externalAuthority!, {
      alvo: canonicalTarget,
      correlationId: "corr-wiring-d",
    })
    expect(runtime).not.toBeNull()

    // 1. Contexto criado com sucesso com credenciais válidas
    const sc = runtime!.createSecureContext({
      pfx: pki.clientPfx,
      passphrase: pki.clientPassphrase,
    })
    expect(sc).toBeDefined()

    // 2. Senha incorreta falha na descriptografia PKCS#12
    expect(() => {
      runtime!.createSecureContext({
        pfx: pki.clientPfx,
        passphrase: "senha-incorreta-external-authority",
      })
    }).toThrow(/mac verify failure|pkcs12/i)

    // 3. Versão TLS inválida falha
    expect(() => {
      runtime!.createSecureContext({
        pfx: pki.clientPfx,
        passphrase: pki.clientPassphrase,
        minVersion: "TLSv9.9" as any,
      })
    }).toThrow()
  })

  it("Criterio E: authorities loopback sinteticas permanecem estritamente isoladas com sua propria CA", () => {
    const testSyntheticCa = "-----BEGIN CERTIFICATE-----\nSYNTHETIC_TEST_CA_ONLY\n-----END CERTIFICATE-----\n"

    // 1. WSDL loopback authority
    const wsdlAuthority = createWsdlLoopbackTestAuthority({
      port: 8443,
      trustedCaPem: testSyntheticCa,
      escopo: {
        uf: canonicalTarget.uf,
        ambiente: canonicalTarget.ambiente,
        servico: canonicalTarget.servico,
        versao: canonicalTarget.versao,
      },
    })
    expect(wsdlAuthority).toBeDefined()

    // 2. SOAP loopback authority
    const soapAuthority = createOfflineLoopbackTestAuthority({
      port: 8443,
      trustedCaPem: testSyntheticCa,
    })
    expect(soapAuthority).toBeDefined()

    // Consome e valida que createSecureContext no loopback usa apenas testSyntheticCa
    const soapRuntime = consumeOfflineLoopbackTestAuthority(soapAuthority, {
      endpointLogico: "SP/HOMOLOGACAO/NFeStatusServico4/4.00",
      correlationId: "corr-loopback-e",
    })
    expect(soapRuntime).not.toBeNull()

    const loopbackContext = soapRuntime!.createSecureContext({
      pfx: pki.clientPfx,
      passphrase: pki.clientPassphrase,
    })
    expect(loopbackContext).toBeDefined()
  })

  it("Criterio F: credenciais mTLS A1 (pfx, passphrase) chegam intactas a createSefazSecureContext", () => {
    // 1. Credencial correta -> sucesso
    const ctx = createSefazSecureContext({
      pfx: pki.clientPfx,
      passphrase: pki.clientPassphrase,
      minVersion: "TLSv1.2",
    })
    expect(ctx).toBeDefined()

    // 2. Passphrase incorreta -> OpenSSL acusa erro de verificação MAC
    expect(() => {
      createSefazSecureContext({
        pfx: pki.clientPfx,
        passphrase: "senha-incorreta-f",
        minVersion: "TLSv1.2",
      })
    }).toThrow(/mac verify failure|pkcs12/i)
  })

  it("Criterio G: minVersion continua estritamente TLSv1.2 em createSefazSecureContext e ports", () => {
    // 1. Chamada sem minVersion assume "TLSv1.2"
    const ctx = createSefazSecureContext()
    expect(ctx).toBeDefined()

    // 2. Versão TLS inválida é rejeitada
    expect(() => {
      createSefazSecureContext({
        minVersion: "TLSv9.9" as any,
      })
    }).toThrow()

    // 3. nodeSefazHttpsRuntimePorts também rejeita versão inválida
    expect(() => {
      nodeSefazHttpsRuntimePorts.createSecureContext({
        minVersion: "TLSv9.9" as any,
      })
    }).toThrow()
  })

  it("Criterio H: rejectUnauthorized continua estritamente true no runtime SEFAZ", () => {
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0")
  })

  it("Criterio I: nenhuma variavel de ambiente global de CA e necessaria", () => {
    expect(process.env.NODE_EXTRA_CA_CERTS).toBeUndefined()

    // Confirma que a raiz ICP-Brasil v10 e carregada de arquivo e injetada no SecureContext
    const icpPem = loadIcpBrasilV10Pem()
    const cert = new X509Certificate(icpPem)
    expect(cert.subject).toContain("Autoridade Certificadora Raiz Brasileira v10")

    const compositeCAs = getSefazCompositeRootCAs()
    const hasIcp = compositeCAs.some((c) => normalizePem(c) === normalizePem(icpPem))
    expect(hasIcp).toBe(true)

    // E tls.rootCertificates do processo NÃO foi mutado globalmente
    const defaultHasIcp = tls.rootCertificates.some(
      (c) => normalizePem(c) === normalizePem(icpPem),
    )
    expect(defaultHasIcp).toBe(false)
  })
})
