/**
 * Boundary de assinatura XMLDSig do pedido de inutilização.
 *
 * Reusa C14N 1.0, SignedInfo, Digest SHA-1 e RSA-SHA1 já existentes.
 * Alvo: `infInut/@Id` (não `infNFe`). Sem rede, sem cofre, sem A1 operacional.
 */

import { X509Certificate, createPrivateKey, sign as cryptoSign } from "node:crypto"
import { xmlEmbeddableViolation } from "../xml/xml-writer"
import {
  attrOf,
  canonicalizeElement,
  childElements,
  findAll,
  findAllById,
  parseXml,
  type C14nElement,
} from "../signing/c14n"
import {
  buildSignatureXml,
  buildSignedInfoXml,
  canonicalizeSignedInfo,
  insertSignatureAsLastChild,
  sha1Base64,
} from "../signing/xmldsig-builder"
import {
  DSIG_NS,
  NfceSignError,
  type FiscalCertificateMaterial,
  type SignNfceOptions,
  type SignNfceResult,
} from "../signing/signer.types"
import { INUTILIZACAO_XMLNS, InutilizacaoError } from "./types"

type LoadedMaterial = {
  privateKey: ReturnType<typeof createPrivateKey>
  certificate: X509Certificate
  certBase64: string
}

function wrap64(base64: string): string {
  return base64.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()
}

function loadMaterial(material: FiscalCertificateMaterial | null | undefined, senha: string): LoadedMaterial {
  if (!material?.privateKeyPem?.trim() || !material?.certificatePem?.trim()) {
    throw new NfceSignError("material_ausente", "Material do certificado ausente (chave privada/certificado).")
  }
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(material.certificatePem)
  } catch {
    throw new NfceSignError("certificado_invalido", "Certificado X.509 invalido ou ilegivel.")
  }
  const encrypted = /ENCRYPTED/i.test(material.privateKeyPem)
  let privateKey: ReturnType<typeof createPrivateKey>
  try {
    privateKey = encrypted
      ? createPrivateKey({ key: material.privateKeyPem, passphrase: senha })
      : createPrivateKey({ key: material.privateKeyPem })
  } catch {
    if (encrypted) throw new NfceSignError("senha_invalida", "Senha do certificado incorreta ou ausente.")
    throw new NfceSignError("chave_privada_invalida", "Chave privada invalida ou ilegivel.")
  }
  const publicKey = certificate.publicKey
  if (
    publicKey.asymmetricKeyType !== "rsa" ||
    (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
    privateKey.asymmetricKeyType !== "rsa"
  ) {
    throw new NfceSignError(
      "certificado_invalido",
      "XMLDSig fiscal exige certificado e chave RSA de no minimo 2048 bits.",
    )
  }
  return { privateKey, certificate, certBase64: Buffer.from(certificate.raw).toString("base64") }
}

function assertValidade(certificado: X509Certificate, agora: Date): void {
  const inicio = new Date(certificado.validFrom)
  const fim = new Date(certificado.validTo)
  if (Number.isFinite(inicio.getTime()) && agora.getTime() < inicio.getTime()) {
    throw new NfceSignError("certificado_expirado", "Certificado expirado ou ainda nao valido (validFrom no futuro).")
  }
  if (Number.isFinite(fim.getTime()) && agora.getTime() > fim.getTime()) {
    throw new NfceSignError("certificado_expirado", "Certificado expirado (validTo no passado).")
  }
}

function nfeDefaultNs(root: C14nElement): string | null {
  return root.namespaceUri || attrOf(root, "xmlns") || null
}

function locateInfInut(root: C14nElement): { el: C14nElement; id: string } | null {
  const namespaceUri = nfeDefaultNs(root)
  const candidates = namespaceUri ? childElements(root, "infInut", namespaceUri) : []
  if (candidates.length !== 1) return null
  const el = candidates[0]
  if (!el) return null
  return { el, id: attrOf(el, "Id") }
}

/**
 * Assina o `inutNFe` envelopando `infInut`. Recusa XML que não seja o pedido de inutilização.
 */
export function signInutilizacaoXml(
  xml: string,
  certificado: FiscalCertificateMaterial,
  senha = "",
  options: SignNfceOptions = {},
): SignNfceResult {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new InutilizacaoError("xml_invalido", "XML vazio ou invalido.")
  }
  if (!options.permitirDocumentoStandalone) {
    const violacao = xmlEmbeddableViolation(xml)
    if (violacao) {
      throw new InutilizacaoError(
        "xml_nao_embutivel",
        `XML nao satisfaz o contrato embutivel (${violacao}); assinatura recusada na origem.`,
      )
    }
  }

  let working = xml
  let root: C14nElement
  try {
    root = parseXml(working)
  } catch {
    throw new InutilizacaoError("xml_invalido", "XML malformado ou recusado pela politica segura.")
  }

  if (findAll(root, "Signature").length > 0) {
    throw new InutilizacaoError("ja_assinado", "XML ja contem assinatura.")
  }
  if (root.name !== "inutNFe" || root.namespaceUri !== INUTILIZACAO_XMLNS) {
    throw new InutilizacaoError("xml_invalido", "Documento nao e um inutNFe no namespace fiscal esperado.")
  }

  const located = locateInfInut(root)
  if (!located) throw new InutilizacaoError("sem_infinut", "Elemento <infInut> nao encontrado.")
  if (!located.id) throw new InutilizacaoError("infinut_sem_id", "<infInut> sem atributo Id.")
  if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(located.id)) {
    throw new InutilizacaoError("referencia_invalida", "O Id de <infInut> nao e uma referencia XML local segura.")
  }
  if (findAllById(root, located.id).length !== 1) {
    throw new InutilizacaoError("referencia_ambigua", "O Id referenciado nao e unico no documento.")
  }

  const { privateKey, certificate, certBase64 } = loadMaterial(certificado, senha || options.senha || "")
  if (!options.ignorarValidade) assertValidade(certificate, options.agora ?? new Date())
  if (!certificate.checkPrivateKey(privateKey)) {
    throw new NfceSignError("chave_incompativel", "A chave privada nao corresponde ao certificado informado.")
  }

  const digestValue = sha1Base64(canonicalizeElement(located.el, nfeDefaultNs(root)))
  const signedInfoXml = buildSignedInfoXml(located.id, digestValue)
  const signedInfoCanon = canonicalizeSignedInfo(signedInfoXml, DSIG_NS, working)

  let signatureValue: string
  try {
    signatureValue = cryptoSign("sha1", Buffer.from(signedInfoCanon, "utf8"), privateKey).toString("base64")
  } catch {
    throw new NfceSignError("chave_privada_invalida", "Falha ao assinar com a chave privada.")
  }

  const signatureXml = buildSignatureXml({ signedInfoXml, signatureValue, certificadoBase64: certBase64 })
  const signedXml = insertSignatureAsLastChild(working, signatureXml)
  return { xml: signedXml, referenciaId: located.id, digestValue, signatureValue, certificadoBase64: certBase64 }
}
