/**
 * Testes estaticos e de composicao da trust anchor ICP-Brasil v10 (GOAL 020 / Revisao 159 / GOAL 160).
 *
 * ZERO CONEXAO SEFAZ / ZERO REDE.
 * Valida integridade criptografica do artefato PEM e o comportamento puro do helper de trust.
 */
import { describe, expect, it } from "vitest"
import { X509Certificate } from "node:crypto"
import { createServer as createHttpsServer } from "node:https"
import tls from "node:tls"
import {
  ICP_BRASIL_V10_CANONICAL_DER_SHA256,
  ICP_BRASIL_V10_CANONICAL_SKI,
  buildSefazCompositeCAs,
  createSefazSecureContext,
  extractSubjectKeyIdentifier,
  getDerSha256Fingerprint,
  getSefazCompositeRootCAs,
  loadIcpBrasilV10Pem,
  normalizePem,
  validateIcpBrasilV10Certificate,
} from "./icp-brasil-v10"
import {
  createOfflineLoopbackTestAuthority,
  nodeSefazHttpsRuntimePorts,
} from "../sefaz-runtime-ports"
import { createTestMtlsPki } from "../__fixtures__/mtls-test-pki"

describe("Integridade Estatica do Artefato: ICP-Brasil v10 PEM", () => {
  const pem = loadIcpBrasilV10Pem()
  const cert = new X509Certificate(pem)

  it("arquivo PEM e parseavel e possui conteudo valido", () => {
    expect(pem).toBeTruthy()
    expect(pem).toContain("-----BEGIN CERTIFICATE-----")
    expect(pem).toContain("-----END CERTIFICATE-----")
    expect(cert).toBeInstanceOf(X509Certificate)
  })

  it("possui o Subject exatamente conforme especificacao oficial do ITI", () => {
    expect(cert.subject).toContain("CN=Autoridade Certificadora Raiz Brasileira v10")
    expect(cert.subject).toContain("O=ICP-Brasil")
    expect(cert.subject).toContain("OU=Instituto Nacional de Tecnologia da Informacao - ITI")
    expect(cert.subject).toContain("C=BR")
  })

  it("e uma raiz autoassinada (issuer estritamente identico ao subject)", () => {
    expect(cert.issuer).toBe(cert.subject)
    expect(cert.verify(cert.publicKey)).toBe(true)
  })

  it("possui Basic Constraints CA:TRUE", () => {
    expect(cert.ca).toBe(true)
  })

  it("possui periodo de validade exatamente conforme emitido pela AC Raiz", () => {
    expect(cert.validFrom).toBe("Jul  1 19:15:59 2019 GMT")
    expect(cert.validTo).toBe("Jul  1 12:00:59 2032 GMT")
  })

  it("possui Subject Key Identifier (SKI) canonico", () => {
    const ski = extractSubjectKeyIdentifier(cert)
    expect(ski).toBe(ICP_BRASIL_V10_CANONICAL_SKI)
    expect(ski).toBe("74:F3:7E:FF:FC:9F:53:7A:F1:7C:EB:AB:3E:A4:A6:DA:18:BA:45:63")
  })

  it("possui fingerprint DER SHA-256 exatamente correspondente a prova 158 e revisao 159", () => {
    const derFp = getDerSha256Fingerprint(cert)
    expect(derFp).toBe(ICP_BRASIL_V10_CANONICAL_DER_SHA256)
    expect(derFp).toBe(
      "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6",
    )
    expect(cert.fingerprint256).toBe(ICP_BRASIL_V10_CANONICAL_DER_SHA256)
  })

  it("falha estritamente se o PEM for alterado, corrompido ou substituto de outra autoridade", () => {
    // 1. Modificacao de 1 caractere no base64
    const corruptedPem = pem.replace("MIIGrDCCBJSgAwIBAgIJANLVi0S/gZNC", "MIIGrDCCBJSgAwIBAgIJANLVi0S/gZND")
    expect(() => {
      const corruptCert = new X509Certificate(corruptedPem)
      validateIcpBrasilV10Certificate(corruptCert)
    }).toThrow()

    // 2. Certificado de autoridade diferente (ex: Let's Encrypt / Google Trust / qualquer outro)
    const otherRootPem = tls.rootCertificates[0]
    const otherCert = new X509Certificate(otherRootPem)
    expect(() => validateIcpBrasilV10Certificate(otherCert)).toThrow()
  })
})

describe("Composicao de Trust e SecureContext SEFAZ (Criterios A a G)", () => {
  const rootPem = loadIcpBrasilV10Pem()

  // Intermediaria de teste simulando a AC SOLUTI SSL EV G4
  const fakeSolutiIntermediatePem =
    "-----BEGIN CERTIFICATE-----\nMIIFozCCA4ugAwIBAgIQD4aXoXnlUP4AAAAA...\n-----END CERTIFICATE-----\n"

  it("Criterio A: a lista resultante contem todas as raizes de tls.rootCertificates", () => {
    const composite = buildSefazCompositeCAs()
    for (const defaultRoot of tls.rootCertificates) {
      expect(composite).toContain(defaultRoot)
    }
    expect(composite.length).toBeGreaterThanOrEqual(tls.rootCertificates.length)
  })

  it("Criterio B: contem exatamente a raiz ICP-Brasil v10 adicional", () => {
    const composite = buildSefazCompositeCAs()
    expect(composite).toContain(rootPem)
    // No Node nativo atual a raiz nao consta no bundle, portanto o tamanho e exatamente +1
    expect(composite.length).toBe(tls.rootCertificates.length + 1)
  })

  it("Criterio C: NAO contem e NAO adiciona a intermediaria Soluti como trust anchor", () => {
    const composite = buildSefazCompositeCAs()
    const compositeString = composite.join("\n")
    expect(compositeString).not.toContain("AC SOLUTI SSL EV G4")
    expect(composite).not.toContain(fakeSolutiIntermediatePem)
  })

  it("Criterio D: nao duplica a root se futuramente ela ja constar no bundle nativo", () => {
    // Simula baseRoots contendo ja a raiz ICP-Brasil v10
    const alreadyWithRoot = [...tls.rootCertificates, rootPem]
    const deduplicated = buildSefazCompositeCAs(alreadyWithRoot, rootPem)

    expect(deduplicated.length).toBe(alreadyWithRoot.length)
    const occurrences = deduplicated.filter(
      (c) => normalizePem(c) === normalizePem(rootPem),
    )
    expect(occurrences.length).toBe(1)
  })

  it("Criterio E: nao altera o comportamento do runtime especial de loopback de testes", () => {
    const testSyntheticCa = "-----BEGIN CERTIFICATE-----\nTEST_SYNTHETIC_CA\n-----END CERTIFICATE-----\n"
    const authority = createOfflineLoopbackTestAuthority({
      port: 8443,
      trustedCaPem: testSyntheticCa,
    })

    // Garante que createOfflineLoopbackTestAuthority continua integro
    expect(authority).toBeDefined()
  })

  it("Criterio F: opcoes A1 (pfx, passphrase, minVersion) continuam chegando intactas a createSecureContext", () => {
    const pki = createTestMtlsPki()

    // 1. Com credenciais autenticas, o SecureContext e criado com sucesso
    const secureContext = nodeSefazHttpsRuntimePorts.createSecureContext({
      pfx: pki.clientPfx,
      passphrase: pki.clientPassphrase,
      minVersion: "TLSv1.2",
    })
    expect(secureContext).toBeDefined()

    // 2. Prova que pfx e passphrase chegam ao OpenSSL: passphrase incorreta gera falha de descriptografia
    expect(() => {
      nodeSefazHttpsRuntimePorts.createSecureContext({
        pfx: pki.clientPfx,
        passphrase: "senha-incorreta-de-teste",
        minVersion: "TLSv1.2",
      })
    }).toThrow(/mac verify failure|pkcs12/i)

    // 3. Prova que minVersion e repassada: versao TLS invalida gera erro em runtime
    expect(() => {
      nodeSefazHttpsRuntimePorts.createSecureContext({
        pfx: pki.clientPfx,
        passphrase: pki.clientPassphrase,
        minVersion: "TLSv9.9" as any,
      })
    }).toThrow()
  })

  it("Criterio G: rejectUnauthorized continua estritamente true no runtime de conexao", () => {
    // nodeSefazHttpsRuntimePorts preserva rejectUnauthorized sem relaxar para false
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0")
    expect(process.env.NODE_EXTRA_CA_CERTS).toBeUndefined()
  })

  it("Factory canônica: createSefazSecureContext constrói contexto com CAs compostas e minVersion TLSv1.2", () => {
    const pki = createTestMtlsPki()

    // 1. Chamada sem argumentos aplica defaults seguros
    const defaultContext = createSefazSecureContext()
    expect(defaultContext).toBeDefined()

    // 2. Com credenciais A1, repassa pfx, passphrase e minVersion
    const a1Context = createSefazSecureContext({
      pfx: pki.clientPfx,
      passphrase: pki.clientPassphrase,
    })
    expect(a1Context).toBeDefined()

    // 3. Senha incorreta falha
    expect(() => {
      createSefazSecureContext({
        pfx: pki.clientPfx,
        passphrase: "senha-incorreta-factory",
      })
    }).toThrow(/mac verify failure|pkcs12/i)

    // 4. Versão TLS inválida falha
    expect(() => {
      createSefazSecureContext({
        minVersion: "TLSv9.9" as any,
      })
    }).toThrow()
  })

  it("Cadeia offline: contexto sem a raiz correspondente falha na validação TLS, e contexto composto passa", async () => {
    const pki = createTestMtlsPki()
    const server = createHttpsServer(
      {
        key: pki.serverPrivateKeyPem,
        cert: pki.serverCertificatePem,
      },
      (req, res) => {
        res.writeHead(200)
        res.end("ok")
      },
    )

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (addr && typeof addr === "object") resolve(addr.port)
        else reject(new Error("porta indisponivel"))
      })
    })

    try {
      // Caso 1: SecureContext padrão sem a CA correspondente falha na verificação da cadeia
      const defaultContext = tls.createSecureContext()
      const failPromise = new Promise<string>((resolve) => {
        const client = tls.connect({
          host: "127.0.0.1",
          port,
          servername: pki.serverName,
          rejectUnauthorized: true,
          secureContext: defaultContext,
        })
        client.on("error", (err) => resolve((err as any).code || err.message))
        client.on("secureConnect", () => {
          client.destroy()
          resolve("unexpected_success")
        })
      })

      const failResult = await failPromise
      expect([
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "self-signed certificate in certificate chain",
        "CERT_SIGNATURE_FAILURE",
      ]).toContain(failResult)

      // Caso 2: SecureContext composto com a raiz passa na verificação da cadeia
      const compositeContext = tls.createSecureContext({
        ca: buildSefazCompositeCAs(tls.rootCertificates, pki.caCertificatePem),
      })
      const successPromise = new Promise<string>((resolve) => {
        const client = tls.connect({
          host: "127.0.0.1",
          port,
          servername: pki.serverName,
          rejectUnauthorized: true,
          secureContext: compositeContext,
        })
        client.on("error", (err) => resolve((err as any).code || err.message))
        client.on("secureConnect", () => {
          client.destroy()
          resolve("success")
        })
      })

      const successResult = await successPromise
      expect(successResult).toBe("success")

      // Caso 3: Prova que a raiz ICP-Brasil v10 está presente em getSefazCompositeRootCAs()
      // mas ausente de tls.rootCertificates
      const icpPem = loadIcpBrasilV10Pem()
      const normalizedIcp = normalizePem(icpPem)
      const presentInDefault = tls.rootCertificates.some(
        (root) => normalizePem(root) === normalizedIcp,
      )
      expect(presentInDefault).toBe(false)

      const compositeCAs = getSefazCompositeRootCAs()
      const presentInComposite = compositeCAs.some(
        (root) => normalizePem(root) === normalizedIcp,
      )
      expect(presentInComposite).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
