/**
 * Assinador XMLDSig da NFC-e — puro e dormente.
 *
 * Assina somente `infNFe` por Reference local e valida de forma fail-closed a estrutura, os
 * algoritmos fixados pelo schema, a unicidade do Id, o digest e o SignatureValue. Nao transmite,
 * nao chama SEFAZ, nao acessa banco e nunca registra chave ou senha.
 *
 * O XML de entrada precisa satisfazer o contrato EMBUTIVEL (GOAL-016D-C0) — sem declaracao XML,
 * sem BOM, sem espaco fora da raiz. Fora disso a assinatura e recusada ANTES de assinar. Os bytes
 * recebidos sao preservados verbatim: a unica alteracao e a insercao do `<Signature>` como ultimo
 * filho de `<NFe>` (splice de string, sem re-serializacao).
 */

import { X509Certificate, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto"
import { xmlEmbeddableViolation } from "../xml/xml-writer"
import {
  attrOf,
  canonicalizeElement,
  childElements,
  findAll,
  findAllById,
  parseXml,
  textOf,
  type C14nElement,
} from "./c14n"
import {
  buildSignatureXml,
  buildSignedInfoXml,
  canonicalizeSignedInfo,
  digestInfNFe,
  insertSignatureIntoNFe,
  locateInfNFe,
  sha1Base64,
} from "./xmldsig-builder"
import {
  ALG_C14N,
  ALG_DIGEST_SHA1,
  ALG_ENVELOPED,
  ALG_SIGNATURE_RSA_SHA1,
  DSIG_NS,
  NfceSignError,
  type FiscalCertificateMaterial,
  type SignNfceOptions,
  type SignNfceResult,
  type VerifyNfceResult,
} from "./signer.types"

const NFE_NS = "http://www.portalfiscal.inf.br/nfe"

type LoadedMaterial = {
  privateKey: ReturnType<typeof createPrivateKey>
  certificate: X509Certificate
  certBase64: string
}

function wrap64(base64: string): string {
  return base64.replace(/\s+/g, "").replace(/(.{64})/g, "$1\n").trim()
}

function certPemFromBase64(base64: string): string {
  return `-----BEGIN CERTIFICATE-----\n${wrap64(base64)}\n-----END CERTIFICATE-----\n`
}

function loadMaterial(material: FiscalCertificateMaterial | null | undefined, senha: string): LoadedMaterial {
  if (!material?.privateKeyPem?.trim() || !material.certificatePem?.trim()) {
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

/** Remove a assinatura sem prefixo produzida por este signer para reassinatura explicita. */
function stripSignature(xml: string): string {
  const start = xml.indexOf("<Signature")
  const endTag = "</Signature>"
  const end = xml.indexOf(endTag, start)
  if (start < 0 || end < 0) return xml
  return xml.slice(0, start) + xml.slice(end + endTag.length)
}

export function isNfceSigned(xml: string): boolean {
  try {
    return findAll(parseXml(xml), "Signature").some((element) => element.namespaceUri === DSIG_NS)
  } catch {
    return false
  }
}

export function signNfceXmlDetailed(
  xml: string,
  certificado: FiscalCertificateMaterial,
  senha = "",
  options: SignNfceOptions = {},
): SignNfceResult {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new NfceSignError("xml_invalido", "XML vazio ou invalido.")
  }

  /**
   * Contrato embutível conferido ANTES da assinatura (GOAL-016D-C0).
   *
   * Este e o unico momento em que corrigir declaracao/BOM ainda e legitimo: depois de assinado,
   * qualquer alteracao de bytes quebra o XMLDSig e diverge do hash persistido, e o adapter SOAP
   * so pode RECUSAR. Guardar aqui fecha a janela do "caller esquecido" — nenhum XML com `<?xml`
   * ou BOM chega a virar `xmlAssinado`. O guard so LE e RECUSA; nunca transforma.
   *
   * `parseXml` nao substitui esta checagem: ele descarta o BOM numa COPIA (o BOM sobreviveria em
   * `working`, que e o que vai para `insertSignatureIntoNFe`) e o `@xmldom/xmldom` aceita um
   * `<?xml ?>` embutido em silencio, virando PI de alvo reservado.
   */
  if (!options.permitirDocumentoStandalone) {
    const violacao = xmlEmbeddableViolation(xml)
    if (violacao) {
      throw new NfceSignError(
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
    throw new NfceSignError("xml_invalido", "XML malformado ou recusado pela politica segura.")
  }

  const existingSignatures = findAll(root, "Signature")
  if (existingSignatures.length > 0) {
    const generatedSignatureIsDirect =
      existingSignatures.length === 1 &&
      existingSignatures[0]!.namespaceUri === DSIG_NS &&
      existingSignatures[0]!.qualifiedName === "Signature" &&
      childElements(root, "Signature", DSIG_NS).length === 1
    if (!generatedSignatureIsDirect) {
      throw new NfceSignError(
        "estrutura_assinatura_invalida",
        "Documento contem Signature fora da estrutura produzida por este signer.",
      )
    }
    if (!options.permitirReassinatura) {
      throw new NfceSignError("ja_assinado", "XML ja contem assinatura (use permitirReassinatura para reassinar).")
    }
    working = stripSignature(working)
    if (working === xml) {
      throw new NfceSignError("ja_assinado", "Reassinatura aceita somente para assinatura gerada por este signer.")
    }
    root = parseXml(working)
  }

  if (root.name !== "NFe" || root.namespaceUri !== NFE_NS) {
    throw new NfceSignError("xml_invalido", "Documento nao e uma NFe no namespace fiscal esperado.")
  }

  const infNFeCandidates = findAll(root, "infNFe").filter((element) => element.namespaceUri === NFE_NS)
  if (infNFeCandidates.length > 1) {
    throw new NfceSignError("referencia_ambigua", "Documento contem mais de um <infNFe> fiscal.")
  }
  const located = locateInfNFe(root)
  if (!located) throw new NfceSignError("sem_infnfe", "Elemento <infNFe> nao encontrado.")
  if (!located.id) throw new NfceSignError("infnfe_sem_id", "<infNFe> sem atributo Id.")
  if (!/^[A-Za-z_][A-Za-z0-9._:-]*$/.test(located.id)) {
    throw new NfceSignError("referencia_invalida", "O Id de <infNFe> nao e uma referencia XML local segura.")
  }
  if (findAllById(root, located.id).length !== 1) {
    throw new NfceSignError("referencia_ambigua", "O Id referenciado nao e unico no documento.")
  }

  const { privateKey, certificate, certBase64 } = loadMaterial(certificado, senha)
  if (!options.ignorarValidade) assertValidade(certificate, options.agora ?? new Date())
  if (!certificate.checkPrivateKey(privateKey)) {
    throw new NfceSignError("chave_incompativel", "A chave privada nao corresponde ao certificado informado.")
  }

  const digestValue = digestInfNFe(root, located.el)
  const signedInfoXml = buildSignedInfoXml(located.id, digestValue)
  const signedInfoCanon = canonicalizeSignedInfo(signedInfoXml, DSIG_NS, working)

  let signatureValue: string
  try {
    signatureValue = cryptoSign("sha1", Buffer.from(signedInfoCanon, "utf8"), privateKey).toString("base64")
  } catch {
    throw new NfceSignError("chave_privada_invalida", "Falha ao assinar com a chave privada.")
  }

  const signatureXml = buildSignatureXml({ signedInfoXml, signatureValue, certificadoBase64: certBase64 })
  const signedXml = insertSignatureIntoNFe(working, signatureXml)
  return { xml: signedXml, referenciaId: located.id, digestValue, signatureValue, certificadoBase64: certBase64 }
}

export function signNfceXml(
  xml: string,
  certificado: FiscalCertificateMaterial,
  senha = "",
  options: SignNfceOptions = {},
): string {
  return signNfceXmlDetailed(xml, certificado, senha, options).xml
}

function failedVerification(
  assinado: boolean,
  referenciaId: string | null,
  problemas: string[],
): VerifyNfceResult {
  return {
    valido: false,
    assinado,
    digestConfere: false,
    assinaturaConfere: false,
    referenciaId,
    problemas,
  }
}

function hasExactChildren(element: C14nElement, names: string[]): boolean {
  const children = childElements(element)
  return children.length === names.length && children.every((child, index) => child.name === names[index])
}

function oneChild(element: C14nElement, name: string, namespaceUri: string): C14nElement | null {
  const matches = childElements(element, name, namespaceUri)
  return matches.length === 1 ? matches[0]! : null
}

/**
 * Verifica integridade XMLDSig. Nao valida cadeia ICP-Brasil, politica de confianca ou SEFAZ;
 * somente estrutura estrita, Reference local unica, digest e assinatura com o X509 embutido.
 */
export function verifyNfceSignature(xml: string): VerifyNfceResult {
  let root: C14nElement
  try {
    root = parseXml(xml)
  } catch {
    return failedVerification(false, null, ["xml_invalido"])
  }

  const allSignatures = findAll(root, "Signature")
  if (allSignatures.length === 0) return failedVerification(false, null, ["nao_assinado"])
  if (root.name !== "NFe" || root.namespaceUri !== NFE_NS) {
    return failedVerification(true, null, ["xml_invalido"])
  }
  const fiscalInfNFe = findAll(root, "infNFe").filter((element) => element.namespaceUri === NFE_NS)
  const directFiscalInfNFe = childElements(root, "infNFe", NFE_NS)
  if (fiscalInfNFe.length !== 1 || directFiscalInfNFe.length !== 1 || fiscalInfNFe[0] !== directFiscalInfNFe[0]) {
    return failedVerification(true, null, [fiscalInfNFe.length > 1 ? "referencia_ambigua" : "referencia_invalida"])
  }

  const directSignatures = childElements(root, "Signature", DSIG_NS)
  if (allSignatures.length !== 1 || directSignatures.length !== 1) {
    return failedVerification(true, null, ["estrutura_assinatura_invalida"])
  }
  const signature = directSignatures[0]!
  if (!hasExactChildren(signature, ["SignedInfo", "SignatureValue", "KeyInfo"])) {
    return failedVerification(true, null, ["estrutura_assinatura_invalida"])
  }

  const signedInfo = oneChild(signature, "SignedInfo", DSIG_NS)
  const signatureValueElement = oneChild(signature, "SignatureValue", DSIG_NS)
  const keyInfo = oneChild(signature, "KeyInfo", DSIG_NS)
  if (!signedInfo || !signatureValueElement || !keyInfo) {
    return failedVerification(true, null, ["assinatura_incompleta"])
  }
  if (!hasExactChildren(signedInfo, ["CanonicalizationMethod", "SignatureMethod", "Reference"])) {
    return failedVerification(true, null, ["estrutura_assinatura_invalida"])
  }

  const canonicalizationMethod = oneChild(signedInfo, "CanonicalizationMethod", DSIG_NS)
  const signatureMethod = oneChild(signedInfo, "SignatureMethod", DSIG_NS)
  const reference = oneChild(signedInfo, "Reference", DSIG_NS)
  if (!canonicalizationMethod || !signatureMethod || !reference) {
    return failedVerification(true, null, ["assinatura_incompleta"])
  }
  if (!hasExactChildren(reference, ["Transforms", "DigestMethod", "DigestValue"])) {
    return failedVerification(true, null, ["estrutura_assinatura_invalida"])
  }

  const transforms = oneChild(reference, "Transforms", DSIG_NS)
  const digestMethod = oneChild(reference, "DigestMethod", DSIG_NS)
  const digestValueElement = oneChild(reference, "DigestValue", DSIG_NS)
  const transformList = transforms ? childElements(transforms, "Transform", DSIG_NS) : []
  if (
    !transforms ||
    !digestMethod ||
    !digestValueElement ||
    transformList.length !== 2
  ) {
    return failedVerification(true, null, ["assinatura_incompleta"])
  }
  if (!hasExactChildren(transforms, ["Transform", "Transform"])) {
    return failedVerification(true, null, ["estrutura_assinatura_invalida"])
  }

  const algorithmsAreExact =
    attrOf(canonicalizationMethod, "Algorithm") === ALG_C14N &&
    attrOf(signatureMethod, "Algorithm") === ALG_SIGNATURE_RSA_SHA1 &&
    attrOf(digestMethod, "Algorithm") === ALG_DIGEST_SHA1 &&
    attrOf(transformList[0]!, "Algorithm") === ALG_ENVELOPED &&
    attrOf(transformList[1]!, "Algorithm") === ALG_C14N
  if (!algorithmsAreExact) {
    return failedVerification(true, null, ["algoritmo_nao_permitido"])
  }

  const uri = attrOf(reference, "URI")
  const referenciaId = /^#[^#\s]+$/.test(uri) ? uri.slice(1) : null
  if (!referenciaId) return failedVerification(true, null, ["referencia_invalida"])
  const referenced = findAllById(root, referenciaId)
  if (referenced.length === 0) return failedVerification(true, referenciaId, ["referencia_invalida"])
  if (referenced.length !== 1) return failedVerification(true, referenciaId, ["referencia_ambigua"])
  const target = referenced[0]!
  if (target !== fiscalInfNFe[0] || target.name !== "infNFe" || target.namespaceUri !== NFE_NS) {
    return failedVerification(true, referenciaId, ["referencia_invalida"])
  }

  const x509Data = oneChild(keyInfo, "X509Data", DSIG_NS)
  const x509Certificate = x509Data ? oneChild(x509Data, "X509Certificate", DSIG_NS) : null
  const digestValue = textOf(digestValueElement)
  const signatureValue = textOf(signatureValueElement)
  const certBase64 = textOf(x509Certificate)
  if (!x509Data || !x509Certificate || !digestValue || !signatureValue || !certBase64) {
    return failedVerification(true, referenciaId, ["assinatura_incompleta"])
  }
  if (
    !hasExactChildren(keyInfo, ["X509Data"]) ||
    !hasExactChildren(x509Data, ["X509Certificate"]) ||
    childElements(x509Certificate).length !== 0
  ) {
    return failedVerification(true, referenciaId, ["estrutura_assinatura_invalida"])
  }

  let digestConfere = false
  try {
    digestConfere = sha1Base64(canonicalizeElement(target)) === digestValue
  } catch {
    digestConfere = false
  }

  let assinaturaConfere = false
  try {
    const canonicalSignedInfo = canonicalizeElement(signedInfo)
    const publicKey = new X509Certificate(certPemFromBase64(certBase64)).publicKey
    if (
      publicKey.asymmetricKeyType !== "rsa" ||
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new Error("Certificado XMLDSig nao possui chave RSA de no minimo 2048 bits.")
    }
    assinaturaConfere = cryptoVerify(
      "sha1",
      Buffer.from(canonicalSignedInfo, "utf8"),
      publicKey,
      Buffer.from(signatureValue, "base64"),
    )
  } catch {
    assinaturaConfere = false
  }

  const problemas: string[] = []
  if (!digestConfere) problemas.push("digest_invalido")
  if (!assinaturaConfere) problemas.push("assinatura_invalida")
  return {
    valido: digestConfere && assinaturaConfere,
    assinado: true,
    digestConfere,
    assinaturaConfere,
    referenciaId,
    problemas,
  }
}

export function loadCertificateMaterialFromPem(
  privateKeyPem: string,
  certificatePem: string,
): FiscalCertificateMaterial {
  return { privateKeyPem, certificatePem }
}
