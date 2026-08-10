/**
 * PKI descartável gerada em memória para os testes mTLS locais do GOAL-016D-C-003.
 * Nenhuma chave/certificado fica persistido em fixture, arquivo temporário ou artefato.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto"
import forge from "node-forge"

const OFFICIAL_TEST_SERVER_NAME = "homologacao.nfce.fazenda.sp.gov.br"

type ForgeKeyPair = {
  privateKey: forge.pki.rsa.PrivateKey
  publicKey: forge.pki.rsa.PublicKey
}
function keyPair(): ForgeKeyPair {
  const generated = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const privatePem = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const privateKey = forge.pki.privateKeyFromPem(privatePem) as forge.pki.rsa.PrivateKey
  return {
    privateKey,
    publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e),
  }
}

function serial(): string {
  const value = randomBytes(16).toString("hex").replace(/^0+/, "")
  return value.length % 2 === 0 ? value : `0${value}`
}

function certificate(input: {
  commonName: string
  keys: ForgeKeyPair
  issuerCertificate?: forge.pki.Certificate
  issuerPrivateKey?: forge.pki.rsa.PrivateKey
  ca?: boolean
  server?: boolean
  client?: boolean
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate()
  cert.publicKey = input.keys.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const subject = [{ name: "commonName", value: input.commonName }]
  cert.setSubject(subject)
  cert.setIssuer(input.issuerCertificate?.subject.attributes ?? subject)
  cert.setExtensions([
    { name: "basicConstraints", cA: input.ca === true },
    input.ca
      ? { name: "keyUsage", keyCertSign: true, cRLSign: true }
      : { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    ...(input.server
      ? [
          { name: "extKeyUsage", serverAuth: true },
          {
            name: "subjectAltName",
            altNames: [{ type: 2, value: OFFICIAL_TEST_SERVER_NAME }],
          },
        ]
      : []),
    ...(input.client ? [{ name: "extKeyUsage", clientAuth: true }] : []),
  ])
  cert.sign(input.issuerPrivateKey ?? input.keys.privateKey, forge.md.sha256.create())
  return cert
}

function toPfx(
  keys: ForgeKeyPair,
  leaf: forge.pki.Certificate,
  ca: forge.pki.Certificate,
  passphrase: string,
): Buffer {
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [leaf, ca], passphrase, {
    algorithm: "3des",
  })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary")
}

export type TestMtlsPki = {
  serverName: string
  caCertificatePem: string
  serverCertificatePem: string
  serverPrivateKeyPem: string
  clientPfx: Buffer
  clientPassphrase: string
  clientPrivateKeyPem: string
  wrongServerCertificatePem: string
  wrongServerPrivateKeyPem: string
  wrongClientPfx: Buffer
  wrongClientPassphrase: string
}

export function createTestMtlsPki(): TestMtlsPki {
  const caKeys = keyPair()
  const leafKeys = keyPair()
  const wrongCaKeys = keyPair()
  const wrongLeafKeys = keyPair()

  const ca = certificate({ commonName: "OMNI-MTLS-TEST-CA", keys: caKeys, ca: true })
  const server = certificate({
    commonName: OFFICIAL_TEST_SERVER_NAME,
    keys: leafKeys,
    issuerCertificate: ca,
    issuerPrivateKey: caKeys.privateKey,
    server: true,
  })
  const client = certificate({
    commonName: "OMNI-MTLS-CLIENT-TEST-ONLY",
    keys: leafKeys,
    issuerCertificate: ca,
    issuerPrivateKey: caKeys.privateKey,
    client: true,
  })

  const wrongCa = certificate({ commonName: "OMNI-MTLS-WRONG-CA", keys: wrongCaKeys, ca: true })
  const wrongServer = certificate({
    commonName: OFFICIAL_TEST_SERVER_NAME,
    keys: wrongLeafKeys,
    issuerCertificate: wrongCa,
    issuerPrivateKey: wrongCaKeys.privateKey,
    server: true,
  })
  const wrongClient = certificate({
    commonName: "OMNI-MTLS-WRONG-CLIENT",
    keys: wrongLeafKeys,
    issuerCertificate: wrongCa,
    issuerPrivateKey: wrongCaKeys.privateKey,
    client: true,
  })

  const clientPassphrase = "mtls-client-test-only-passphrase"
  const wrongClientPassphrase = "mtls-wrong-client-test-only-passphrase"
  return {
    serverName: OFFICIAL_TEST_SERVER_NAME,
    caCertificatePem: forge.pki.certificateToPem(ca),
    serverCertificatePem: forge.pki.certificateToPem(server),
    serverPrivateKeyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
    clientPfx: toPfx(leafKeys, client, ca, clientPassphrase),
    clientPassphrase,
    clientPrivateKeyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
    wrongServerCertificatePem: forge.pki.certificateToPem(wrongServer),
    wrongServerPrivateKeyPem: forge.pki.privateKeyToPem(wrongLeafKeys.privateKey),
    wrongClientPfx: toPfx(wrongLeafKeys, wrongClient, wrongCa, wrongClientPassphrase),
    wrongClientPassphrase,
  }
}
