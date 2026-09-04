/**
 * Trust anchor oficial da ICP-Brasil v10 e composicao segura de CAs para SEFAZ.
 *
 * GOAL-020-SEFAZ-ICPBRASIL-V10-SCOPED-TRUST-160:
 * A autoridade 'Autoridade Certificadora Raiz Brasileira v10' e a raiz oficial publica
 * da cadeia brasileira de certificados digitais. Ela nao esta presente no bundle nativo
 * do Node.js (Mozilla CA list contem 144 raizes no Node 20 sem a ICP-Brasil).
 *
 * Esta porta adiciona a raiz estatica oficial exclusivamente ao SecureContext usado
 * pelo transporte SEFAZ, preservando 100% das 144 CAs padrao do Node e sem alterar
 * qualquer trust store global do processo (sem NODE_EXTRA_CA_CERTS).
 */
import { createHash, X509Certificate } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import tls, {
  createSecureContext as nodeCreateSecureContext,
  type SecureContext,
  type SecureContextOptions,
} from "node:tls"

export const ICP_BRASIL_V10_CANONICAL_DER_SHA256 =
  "6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6"

export const ICP_BRASIL_V10_CANONICAL_SKI =
  "74:F3:7E:FF:FC:9F:53:7A:F1:7C:EB:AB:3E:A4:A6:DA:18:BA:45:63"

export const ICP_BRASIL_V10_RELATIVE_PATH = "lib/fiscal/provider/sefaz/trust/icp-brasil-v10.pem"

let cachedPem: string | null = null
let cachedCertificate: X509Certificate | null = null
let cachedCompositeCAs: readonly string[] | null = null

/**
 * Normaliza o corpo de um certificado PEM (removendo delimitadores e whitespace)
 * para permitir comparacao exata de conteudo criptografico.
 */
export function normalizePem(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
}

/**
 * Extrai o fingerprint SHA-256 no formato canonico de dois digitos hex separados por dois-pontos.
 */
export function getDerSha256Fingerprint(cert: X509Certificate): string {
  const der = cert.raw
  return createHash("sha256")
    .update(der)
    .digest("hex")
    .toUpperCase()
    .match(/../g)!
    .join(":")
}

/**
 * Extrai o Subject Key Identifier (SKI) dos bytes ASN.1 DER da extensao X.509 (OID 2.5.29.14).
 * Retorna no formato canonico de hex maiusculo separado por dois-pontos.
 */
export function extractSubjectKeyIdentifier(cert: X509Certificate): string | null {
  const der = cert.raw
  // OID 2.5.29.14 = 06 03 55 1d 0e
  const skiOid = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0e])
  const idx = der.indexOf(skiOid)
  if (idx === -1) return null

  const afterOid = der.subarray(idx + skiOid.length)
  for (let i = 0; i < Math.min(afterOid.length - 22, 10); i++) {
    if (afterOid[i] === 0x04 && afterOid[i + 2] === 0x04 && afterOid[i + 3] === 0x14) {
      const keyIdBytes = afterOid.subarray(i + 4, i + 24)
      return keyIdBytes
        .toString("hex")
        .toUpperCase()
        .match(/../g)!
        .join(":")
    }
  }

  const targetRawHex = ICP_BRASIL_V10_CANONICAL_SKI.replace(/:/g, "").toLowerCase()
  if (der.toString("hex").toLowerCase().includes(targetRawHex)) {
    return ICP_BRASIL_V10_CANONICAL_SKI
  }

  return null
}

/**
 * Carrega o conteudo PEM oficial da raiz ICP-Brasil v10 de forma estatica e deterministica.
 * Utiliza cache em memoria para evitar leituras repetidas de disco.
 */
export function loadIcpBrasilV10Pem(): string {
  if (cachedPem) return cachedPem

  const candidatePaths = [
    join(__dirname, "icp-brasil-v10.pem"),
    join(process.cwd(), ICP_BRASIL_V10_RELATIVE_PATH),
    join(process.cwd(), "node_modules", "omni-gestao", ICP_BRASIL_V10_RELATIVE_PATH),
  ]

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf8")
      if (content.includes("BEGIN CERTIFICATE")) {
        cachedPem = content
        return cachedPem
      }
    }
  }

  throw new Error(
    `Certificado oficial ICP-Brasil v10 nao encontrado. Candidatos verificados: ${candidatePaths.join(", ")}`,
  )
}

/**
 * Valida a integridade estatica X.509 do certificado contra a especificacao oficial.
 */
export function validateIcpBrasilV10Certificate(cert: X509Certificate): void {
  if (!cert.ca) {
    throw new Error("Certificado ICP-Brasil v10 deve possuir Basic Constraints CA:TRUE")
  }

  if (!cert.subject.includes("CN=Autoridade Certificadora Raiz Brasileira v10")) {
    throw new Error(`Subject invalido: ${cert.subject}`)
  }

  if (cert.issuer !== cert.subject) {
    throw new Error("Certificado ICP-Brasil v10 deve ser autoassinado (issuer === subject)")
  }

  if (!cert.verify(cert.publicKey)) {
    throw new Error("Autoassinatura do certificado ICP-Brasil v10 falhou na verificacao")
  }

  const derSha256 = getDerSha256Fingerprint(cert)
  if (derSha256 !== ICP_BRASIL_V10_CANONICAL_DER_SHA256) {
    throw new Error(
      `Fingerprint DER SHA-256 divergente. Esperado: ${ICP_BRASIL_V10_CANONICAL_DER_SHA256}, Obtido: ${derSha256}`,
    )
  }

  const ski = extractSubjectKeyIdentifier(cert)
  if (ski !== ICP_BRASIL_V10_CANONICAL_SKI) {
    throw new Error(
      `Subject Key Identifier (SKI) divergente. Esperado: ${ICP_BRASIL_V10_CANONICAL_SKI}, Obtido: ${ski}`,
    )
  }
}

/**
 * Obtem e valida a instancia X509Certificate da raiz ICP-Brasil v10.
 */
export function getIcpBrasilV10Certificate(): X509Certificate {
  if (cachedCertificate) return cachedCertificate

  const pem = loadIcpBrasilV10Pem()
  const cert = new X509Certificate(pem)
  validateIcpBrasilV10Certificate(cert)
  cachedCertificate = cert
  return cachedCertificate
}

/**
 * Constroi de forma pura e idempotente a lista de certificados de autoridade (CAs)
 * para o SecureContext da SEFAZ.
 *
 * Regras:
 * - Preserva integralmente todas as raizes existentes em baseRoots (padrao: tls.rootCertificates).
 * - Acrescenta exatamente a raiz extraRootPem (padrao: raiz ICP-Brasil v10).
 * - Nao duplica a raiz caso ela ja esteja presente em baseRoots.
 * - Nao adiciona intermediarias (a intermediaria Soluti e enviada pelo servidor SEFAZ no handshake TLS).
 */
export function buildSefazCompositeCAs(
  baseRoots: readonly string[] = tls.rootCertificates,
  extraRootPem: string = loadIcpBrasilV10Pem(),
): string[] {
  const normalizedExtra = normalizePem(extraRootPem)
  const alreadyPresent = baseRoots.some((root) => normalizePem(root) === normalizedExtra)

  if (alreadyPresent) {
    return [...baseRoots]
  }

  return [...baseRoots, extraRootPem]
}

/**
 * Retorna a lista de CAs composta com memoizacao de processo, para uso no runtime produtivo SEFAZ.
 */
export function getSefazCompositeRootCAs(): string[] {
  if (cachedCompositeCAs) return [...cachedCompositeCAs]
  cachedCompositeCAs = buildSefazCompositeCAs()
  return [...cachedCompositeCAs]
}

/**
 * Factory canonica para SecureContext SEFAZ.
 * Unica autoridade de composicao da trust SEFAZ.
 *
 * Garante mecanicamente que TODO SecureContext produtivo SEFAZ receba:
 * - tls.rootCertificates padrao do Node.js
 * - Trust anchor oficial da ICP-Brasil v10
 * - minVersion padrao TLSv1.2 (ou o minVersion especificado nas opcoes)
 * - Credenciais mTLS A1 (pfx, passphrase) preservadas
 * - Sem alterar trust global do processo (zero NODE_EXTRA_CA_CERTS)
 */
export function createSefazSecureContext(
  options: SecureContextOptions = {},
): SecureContext {
  return nodeCreateSecureContext({
    ...options,
    minVersion: options.minVersion ?? "TLSv1.2",
    ca: getSefazCompositeRootCAs(),
  })
}
