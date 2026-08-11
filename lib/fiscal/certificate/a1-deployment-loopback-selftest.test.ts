import forge from "node-forge"
import { connect as tlsConnect } from "node:tls"
import { afterAll, describe, expect, it, vi } from "vitest"
import { loadA1MtlsMaterial, type A1MtlsMaterial } from "./a1-mtls-material"
import { runA1DeploymentLoopbackSelftest } from "./a1-deployment-loopback-selftest"
import { createTestMtlsPki } from "@/lib/fiscal/provider/sefaz/__fixtures__/mtls-test-pki"
import { canonicalEnvRef } from "@/lib/fiscal/vault/fiscal-secret-vault"
import { scanForSecrets } from "@/lib/fiscal/vault/secret-scan"

const STORE = "loja-selftest"
const PFX_REF = canonicalEnvRef("pfx", STORE)
const SENHA_REF = canonicalEnvRef("senha", STORE)
const pki = createTestMtlsPki()

afterAll(() => {
  pki.clientPfx.fill(0)
  pki.wrongClientPfx.fill(0)
})

function loader(pfx: Buffer, senha: string, onDispose?: () => void) {
  const env = {
    FISCAL_SECRET_PROVIDER: "env",
    [PFX_REF]: pfx.toString("base64"),
    [SENHA_REF]: senha,
  }
  return async (refs: Parameters<typeof loadA1MtlsMaterial>[0]): Promise<A1MtlsMaterial> => {
    const material = await loadA1MtlsMaterial({ ...refs, env })
    return {
      withTlsOptions: (consumer) => material.withTlsOptions(consumer),
      dispose: () => {
        material.dispose()
        onDispose?.()
      },
    }
  }
}

function mismatchedPkcs12(passphrase: string): Buffer {
  const privateKey = forge.pki.privateKeyFromPem(pki.clientPrivateKeyPem) as forge.pki.rsa.PrivateKey
  const otherPrivateKey = forge.pki.privateKeyFromPem(
    pki.wrongServerPrivateKeyPem,
  ) as forge.pki.rsa.PrivateKey
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = forge.pki.setRsaPublicKey(otherPrivateKey.n, otherPrivateKey.e)
  certificate.serialNumber = "01020304"
  certificate.validity.notBefore = new Date(Date.now() - 60_000)
  certificate.validity.notAfter = new Date(Date.now() + 60_000)
  const subject = [{ name: "commonName", value: "MISMATCH-SELFTEST" }]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.sign(otherPrivateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], passphrase, {
    algorithm: "3des",
  })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary")
}

describe("A1 deployment loopback self-test", () => {
  it("PFX/senha válidos constroem SecureContext e apresentam o cliente no mTLS local", async () => {
    const disposed = vi.fn()
    const result = await runA1DeploymentLoopbackSelftest({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      loadMaterial: loader(pki.clientPfx, pki.clientPassphrase, disposed),
    })

    expect(result).toEqual({
      ok: true,
      codigo: "ok",
      materialResolvido: true,
      secureContextOk: true,
      clientCertificatePresented: true,
      mtlsLoopbackOk: true,
      destination: "loopback",
      externalNetworkAttempted: false,
      listenerClosed: true,
      materialDisposed: true,
    })
    expect(disposed).toHaveBeenCalledOnce()
  })

  it("senha incorreta falha fechado, fecha listener e descarta material", async () => {
    const disposed = vi.fn()
    const senhaIncorreta = "senha-incorreta-selftest"
    const result = await runA1DeploymentLoopbackSelftest({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      loadMaterial: loader(pki.clientPfx, senhaIncorreta, disposed),
    })

    expect(result).toMatchObject({
      ok: false,
      codigo: "material_ou_tls_invalido",
      materialResolvido: true,
      secureContextOk: false,
      clientCertificatePresented: false,
      mtlsLoopbackOk: false,
      destination: "loopback",
      externalNetworkAttempted: false,
      listenerClosed: true,
      materialDisposed: true,
    })
    expect(disposed).toHaveBeenCalledOnce()
    expect(scanForSecrets(result, { senha: senhaIncorreta, pfxBytes: pki.clientPfx }).vazou).toBe(false)
  })

  it("chave e certificado incompatíveis são recusados antes do handshake", async () => {
    const passphrase = "mismatch-passphrase-selftest"
    const pfx = mismatchedPkcs12(passphrase)
    try {
      const result = await runA1DeploymentLoopbackSelftest({
        storeId: STORE,
        blobRef: PFX_REF,
        senhaRef: SENHA_REF,
        loadMaterial: loader(pfx, passphrase),
      })
      expect(result).toMatchObject({
        ok: false,
        codigo: "material_ou_tls_invalido",
        secureContextOk: false,
        clientCertificatePresented: false,
        mtlsLoopbackOk: false,
        listenerClosed: true,
        materialDisposed: true,
      })
      expect(scanForSecrets(result, { senha: passphrase, pfxBytes: pfx }).vazou).toBe(false)
    } finally {
      pfx.fill(0)
    }
  })

  it("falha do provider não abre contexto/handshake e retorna somente código sanitizado", async () => {
    const segredoSentinela = "segredo-que-nao-pode-vazar-selftest"
    const result = await runA1DeploymentLoopbackSelftest({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      loadMaterial: async () => {
        throw new Error(segredoSentinela)
      },
    })

    expect(result).toMatchObject({
      ok: false,
      codigo: "material_indisponivel",
      materialResolvido: false,
      secureContextOk: false,
      clientCertificatePresented: false,
      mtlsLoopbackOk: false,
      listenerClosed: true,
      materialDisposed: false,
    })
    expect(JSON.stringify(result)).not.toContain(segredoSentinela)
  })

  it("correlaciona o certificado ao socket do proprio cliente sob corrida loopback", async () => {
    const result = await runA1DeploymentLoopbackSelftest({
      storeId: STORE,
      blobRef: PFX_REF,
      senhaRef: SENHA_REF,
      loadMaterial: loader(pki.clientPfx, pki.clientPassphrase),
      beforeClientConnectForTest: async (port) => {
        await new Promise<void>((resolve, reject) => {
          const competingPeer = tlsConnect({
            host: "127.0.0.1",
            port,
            pfx: pki.wrongClientPfx,
            passphrase: pki.wrongClientPassphrase,
            rejectUnauthorized: false,
            minVersion: "TLSv1.2",
          })
          competingPeer.once("secureConnect", () => competingPeer.end())
          competingPeer.once("close", () => resolve())
          competingPeer.once("error", reject)
        })
      },
    })

    expect(result).toMatchObject({
      ok: true,
      codigo: "ok",
      clientCertificatePresented: true,
      mtlsLoopbackOk: true,
      listenerClosed: true,
      materialDisposed: true,
    })
  })

  it("expira loader pendente sem listener e descarta material que resolver tarde", async () => {
    vi.useFakeTimers()
    const dispose = vi.fn()
    let resolveMaterial!: (material: A1MtlsMaterial) => void
    const pending = new Promise<A1MtlsMaterial>((resolve) => {
      resolveMaterial = resolve
    })
    try {
      const run = runA1DeploymentLoopbackSelftest({
        storeId: STORE,
        blobRef: PFX_REF,
        senhaRef: SENHA_REF,
        loadMaterial: async () => pending,
      })
      await vi.advanceTimersByTimeAsync(5_001)

      expect(await run).toMatchObject({
        ok: false,
        codigo: "material_indisponivel",
        materialResolvido: false,
        secureContextOk: false,
        listenerClosed: true,
        materialDisposed: false,
      })

      resolveMaterial({ withTlsOptions: () => undefined, dispose })
      await Promise.resolve()
      await Promise.resolve()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
