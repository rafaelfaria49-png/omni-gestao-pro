/**
 * XMLDSig envelopado de `infEvento` (evento de cancelamento NFC-e).
 * Reusa C14N/SignedInfo do signer fiscal; insere `<Signature>` como último filho de `<evento>`.
 */
import { X509Certificate, createPrivateKey, sign as cryptoSign } from "node:crypto"
import { xmlEmbeddableViolation } from "@/lib/fiscal/xml/xml-writer"
import {
  attrOf,
  canonicalizeElement,
  childElements,
  findAllById,
  parseXml,
  type C14nElement,
} from "@/lib/fiscal/signing/c14n"
import {
  buildSignatureXml,
  buildSignedInfoXml,
  canonicalizeSignedInfo,
  sha1Base64,
} from "@/lib/fiscal/signing/xmldsig-builder"
import {
  DSIG_NS,
  NfceSignError,
  type FiscalCertificateMaterial,
  type SignNfceOptions,
} from "@/lib/fiscal/signing/signer.types"

const NFE_NS = "http://www.portalfiscal.inf.br/nfe"

function wrap64(base64: string): string {
  return base64.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()
}

function loadMaterial(material: FiscalCertificateMaterial, senha: string) {
  if (!material.privateKeyPem?.trim() || !material.certificatePem?.trim()) {
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
  if (!certificate.checkPrivateKey(privateKey)) {
    throw new NfceSignError("chave_incompativel", "A chave privada nao corresponde ao certificado informado.")
  }
  return { privateKey, certificate, certBase64: Buffer.from(certificate.raw).toString("base64") }
}

function locateInfEvento(root: C14nElement): { el: C14nElement; id: string } | null {
  const eventos = childElements(root, "evento", NFE_NS)
  if (eventos.length !== 1) return null
  const infs = childElements(eventos[0]!, "infEvento", NFE_NS)
  if (infs.length !== 1) return null
  const el = infs[0]!
  const id = attrOf(el, "Id")
  if (!id) return null
  return { el, id }
}

function insertSignatureIntoEvento(xml: string, signatureXml: string): string {
  const closing = "</evento>"
  const idx = xml.lastIndexOf(closing)
  if (idx < 0) {
    throw new NfceSignError("xml_invalido", "Documento sem </evento> para envelopar a assinatura.")
  }
  return xml.slice(0, idx) + signatureXml + xml.slice(idx)
}

/**
 * Assina o `infEvento` do `envEvento` (URI `#ID110111…`) e devolve o XML com XMLDSig.
 */
export function signEventoCancelamentoXml(
  xml: string,
  certificado: FiscalCertificateMaterial,
  senha = "",
  options: SignNfceOptions = {},
): string {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new NfceSignError("xml_invalido", "XML de evento vazio ou invalido.")
  }
  if (!options.permitirDocumentoStandalone) {
    const violacao = xmlEmbeddableViolation(xml)
    if (violacao) {
      throw new NfceSignError(
        "xml_nao_embutivel",
        `XML de evento nao satisfaz o contrato embutivel (${violacao}).`,
      )
    }
  }
  let root: C14nElement
  try {
    root = parseXml(xml)
  } catch {
    throw new NfceSignError("xml_invalido", "XML de evento malformado.")
  }
  if (root.name !== "envEvento" || root.namespaceUri !== NFE_NS) {
    throw new NfceSignError("xml_invalido", "Raiz do evento nao e envEvento no namespace fiscal.")
  }
  const located = locateInfEvento(root)
  if (!located) throw new NfceSignError("xml_invalido", "Elemento <infEvento> unico com Id nao encontrado.")
  if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(located.id)) {
    throw new NfceSignError("referencia_invalida", "O Id de <infEvento> nao e uma referencia XML local segura.")
  }
  if (findAllById(root, located.id).length !== 1) {
    throw new NfceSignError("referencia_ambigua", "O Id do infEvento nao e unico no documento.")
  }

  const { privateKey, certificate, certBase64 } = loadMaterial(certificado, senha)
  if (!options.ignorarValidade) {
    const agora = options.agora ?? new Date()
    const inicio = new Date(certificate.validFrom)
    const fim = new Date(certificate.validTo)
    if (Number.isFinite(inicio.getTime()) && agora.getTime() < inicio.getTime()) {
      throw new NfceSignError("certificado_expirado", "Certificado expirado ou ainda nao valido.")
    }
    if (Number.isFinite(fim.getTime()) && agora.getTime() > fim.getTime()) {
      throw new NfceSignError("certificado_expirado", "Certificado expirado.")
    }
  }

  const digestValue = sha1Base64(canonicalizeElement(located.el, NFE_NS))
  const signedInfoXml = buildSignedInfoXml(located.id, digestValue)
  const signedInfoCanon = canonicalizeSignedInfo(signedInfoXml, DSIG_NS)
  let signatureValue: string
  try {
    signatureValue = cryptoSign("sha1", Buffer.from(signedInfoCanon, "utf8"), privateKey).toString("base64")
  } catch {
    throw new NfceSignError("chave_privada_invalida", "Falha ao assinar o evento com a chave privada.")
  }
  const signatureXml = buildSignatureXml({ signedInfoXml, signatureValue, certificadoBase64: certBase64 })
  return insertSignatureIntoEvento(xml, signatureXml)
}
