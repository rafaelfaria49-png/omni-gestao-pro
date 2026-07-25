/**
 * Leitor seguro de PKCS#12 (.pfx A1) → PEM (GOAL-008 · ADR-0009).
 *
 * Converte os BYTES do `.pfx` (resolvidos do cofre por referência) em material PEM consumível pelo
 * assinador puro (`FiscalCertificateMaterial`), EXCLUSIVAMENTE em memória. Usa `node-forge` apenas
 * para abrir o container PKCS#12 (Node não tem parser nativo); a assinatura/crypto permanece no
 * `node:crypto`, e os METADADOS (validade, serial, fingerprint, CNPJ) saem do `X509Certificate`.
 *
 * Garantias de segurança (GOAL-008):
 *  - ❌ Nunca escreve `.pfx`, senha, PEM ou chave privada em arquivo temporário.
 *  - ❌ Nunca usa OpenSSL CLI nem `child_process`.
 *  - ✅ Zera o Buffer de trabalho do `.pfx` após o parse (best-effort — strings JS são imutáveis e
 *       ficam a cargo do GC; não fingimos zerar o que a runtime não permite).
 *  - ✅ Erros NUNCA contêm o segredo (senha/bytes/PEM/chave) — apenas código + causa genérica.
 */
import forge from "node-forge"
import { X509Certificate } from "node:crypto"

export type Pkcs12ParseCode =
  | "pfx_ausente" // buffer vazio/ausente
  | "formato_invalido" // não é um PKCS#12 legível
  | "senha_invalida" // MAC não confere / senha incorreta
  | "sem_chave_privada" // container sem chave privada
  | "sem_certificado" // container sem certificado do titular
  | "chave_invalida" // chave presente mas ilegível como PEM

/** Erro do leitor PKCS#12 — a mensagem NUNCA contém o segredo (só código/causa). */
export class Pkcs12ParseError extends Error {
  readonly code: Pkcs12ParseCode
  constructor(code: Pkcs12ParseCode, message: string) {
    super(message)
    this.name = "Pkcs12ParseError"
    this.code = code
  }
}

export type Pkcs12Meta = {
  /** CN do titular (subject). */
  titularCn: string
  /** Subject completo (uma linha). */
  subject: string
  /** CNPJ (14 dígitos) do certificado, se identificável; senão `null`. */
  cnpj: string | null
  /** CN do emissor — autoridade certificadora (AC) que emitiu o certificado. */
  issuerCn: string
  /** Issuer completo (uma linha). */
  issuer: string
  /** E-mail do titular quando presente no certificado (subject/SAN); senão `null`. */
  email: string | null
  serialNumber: string
  /** Fingerprint SHA-1 (hex minúsculo, sem `:`) — identidade estável para auditoria/UI. */
  fingerprintSha1: string
  notBefore: Date
  notAfter: Date
  /** Tamanho da chave pública RSA em bits (0 se não-RSA). */
  chavePublicaRsaBits: number
}

export type Pkcs12Material = {
  /** PEM da chave privada (JÁ decifrada pelo container). NUNCA logar/serializar. */
  privateKeyPem: string
  /** PEM do certificado do titular (folha). */
  certificatePem: string
  /** Cadeia disponível no container (titular + intermediários, quando houver). */
  chainPem: string[]
  /** `true` quando ao menos o certificado do titular está presente. */
  cadeiaDisponivel: boolean
  meta: Pkcs12Meta
}

const CNPJ_OTHERNAME_OID = "2.16.76.1.3.3" // ICP-Brasil: CNPJ da pessoa jurídica no subjectAltName

/** Extrai apenas dígitos. */
function onlyDigits(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D+/g, "")
}

/**
 * Identifica o CNPJ do certificado. Ordem: (1) subject CN no padrão ICP `RAZAO:CNPJ`;
 * (2) qualquer sequência isolada de 14 dígitos no subject; (3) SAN (otherName/raw). `null` se nada.
 */
function extractCnpj(cert: X509Certificate): string | null {
  const subject = String(cert.subject ?? "")
  const afterColon = subject.match(/:(\d{14})(?:\D|$)/)
  if (afterColon) return afterColon[1]!
  const standalone = subject.match(/(?:^|\D)(\d{14})(?:\D|$)/)
  if (standalone) return standalone[1]!
  const san = String(cert.subjectAltName ?? "")
  if (san.includes(CNPJ_OTHERNAME_OID) || /\d{14}/.test(san)) {
    const m = san.match(/(\d{14})/)
    if (m) return m[1]!
  }
  return null
}

/**
 * Identifica o e-mail do titular. Ordem: (1) `emailAddress=`/`E=` no subject; (2) `email:` no SAN.
 * `null` quando o certificado não carrega e-mail (comum em A1 de pessoa jurídica).
 */
function extractEmail(cert: X509Certificate): string | null {
  const subject = String(cert.subject ?? "")
  const fromSubject = subject.match(/(?:emailAddress|^E|\bE)=([^\n,]+)/)
  if (fromSubject?.[1]) return fromSubject[1].trim()
  const san = String(cert.subjectAltName ?? "")
  const fromSan = san.match(/email:([^\s,]+)/i)
  if (fromSan?.[1]) return fromSan[1].trim()
  return null
}

/**
 * Abre um `.pfx` (PKCS#12) e devolve o material PEM + metadados. Consome e ZERA o buffer de entrada.
 * Fail-closed: qualquer inconsistência lança `Pkcs12ParseError` (sem expor segredo).
 */
export function loadPkcs12(pfx: Buffer | null | undefined, senha: string): Pkcs12Material {
  if (!pfx || pfx.length === 0) {
    throw new Pkcs12ParseError("pfx_ausente", "Bytes do certificado (.pfx) ausentes.")
  }

  // `node-forge` trabalha com "binary string"; é um dado efêmero, sem referência retida.
  let binary: string | null = pfx.toString("binary")
  let asn1: forge.asn1.Asn1
  try {
    asn1 = forge.asn1.fromDer(binary)
  } catch {
    binary = null
    zeroBuffer(pfx)
    throw new Pkcs12ParseError("formato_invalido", "Arquivo não é um PKCS#12 (.pfx) legível.")
  } finally {
    binary = null
  }

  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha)
  } catch (e) {
    zeroBuffer(pfx)
    // A causa dominante de falha aqui é o MAC (senha incorreta). Mensagem sem segredo.
    const msg = e instanceof Error ? e.message : ""
    if (/mac|password|invalid password/i.test(msg)) {
      throw new Pkcs12ParseError("senha_invalida", "Senha do certificado incorreta.")
    }
    throw new Pkcs12ParseError("formato_invalido", "PKCS#12 inválido ou corrompido.")
  }

  // Chave privada (cifrada ou não dentro do container).
  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
    ...p12.getBags({ bagType: forge.pki.oids.keyBag }),
  }
  let privateKey: forge.pki.PrivateKey | null = null
  for (const oid of Object.keys(keyBags)) {
    for (const bag of keyBags[oid] ?? []) {
      if (bag.key) {
        privateKey = bag.key
        break
      }
    }
    if (privateKey) break
  }
  if (!privateKey) {
    zeroBuffer(pfx)
    throw new Pkcs12ParseError("sem_chave_privada", "Container PKCS#12 sem chave privada.")
  }

  // Certificados (titular + cadeia).
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c))
  if (certs.length === 0) {
    zeroBuffer(pfx)
    throw new Pkcs12ParseError("sem_certificado", "Container PKCS#12 sem certificado.")
  }

  let privateKeyPem: string
  try {
    privateKeyPem = forge.pki.privateKeyToPem(privateKey)
  } catch {
    zeroBuffer(pfx)
    throw new Pkcs12ParseError("chave_invalida", "Chave privada ilegível no container.")
  }
  const chainPem = certs.map((c) => forge.pki.certificateToPem(c))
  const certificatePem = chainPem[0]!

  let x509: X509Certificate
  try {
    x509 = new X509Certificate(certificatePem)
  } catch {
    zeroBuffer(pfx)
    throw new Pkcs12ParseError("sem_certificado", "Certificado do titular ilegível.")
  }

  const pub = x509.publicKey
  const rsaBits =
    pub.asymmetricKeyType === "rsa" ? (pub.asymmetricKeyDetails?.modulusLength ?? 0) : 0

  const meta: Pkcs12Meta = {
    titularCn: (String(x509.subject ?? "").match(/CN=([^\n]+)/)?.[1] ?? "").trim(),
    subject: String(x509.subject ?? "").replace(/\s*\n\s*/g, ", ").trim(),
    cnpj: extractCnpj(x509),
    issuerCn: (String(x509.issuer ?? "").match(/CN=([^\n]+)/)?.[1] ?? "").trim(),
    issuer: String(x509.issuer ?? "").replace(/\s*\n\s*/g, ", ").trim(),
    email: extractEmail(x509),
    serialNumber: String(x509.serialNumber ?? ""),
    fingerprintSha1: String(x509.fingerprint ?? "").replace(/:/g, "").toLowerCase(),
    notBefore: new Date(x509.validFrom),
    notAfter: new Date(x509.validTo),
    chavePublicaRsaBits: rsaBits,
  }

  zeroBuffer(pfx)
  return { privateKeyPem, certificatePem, chainPem, cadeiaDisponivel: certs.length >= 1, meta }
}

/** Zera um Buffer sensível (best-effort). Strings JS não são zeráveis — ficam a cargo do GC. */
export function zeroBuffer(buf: Buffer | null | undefined): void {
  if (buf && buf.length > 0) {
    try {
      buf.fill(0)
    } catch {
      /* buffer read-only/detached — ignora */
    }
  }
}
