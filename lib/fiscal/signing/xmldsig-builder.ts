/**
 * Construtor de elementos XMLDSig da NFC-e (BL-FISCAL-005 · TAREFA 1).
 *
 * PURO: monta `SignedInfo`/`Signature` como strings XML e calcula o digest SHA-1 do `infNFe`
 * canonicalizado. Não assina (RSA fica no assinador, que tem a chave privada) e não acessa
 * banco/Prisma/fetch/Next. Usa apenas `node:crypto` (hash) e o canonicalizador local.
 */

import { createHash } from "node:crypto"
import {
  attrOf,
  canonicalizeElement,
  childElements,
  parseXml,
  type C14nElement,
} from "./c14n"
import {
  ALG_C14N,
  ALG_DIGEST_SHA1,
  ALG_ENVELOPED,
  ALG_SIGNATURE_RSA_SHA1,
  DSIG_NS,
} from "./signer.types"

/**
 * Hash SHA-1 → base64. Imposto pelo schema oficial (DigestMethod `fixed` em SHA-1) — ver ADR-0011.
 * Restrito ao digest XMLDSig fiscal. Para qualquer outro uso, SHA-256.
 */
export function sha1Base64(data: string): string {
  return createHash("sha1").update(Buffer.from(data, "utf8")).digest("base64")
}

/** Namespace default em vigor para o `infNFe` (= xmlns do `<NFe>` raiz). */
export function nfeDefaultNs(root: C14nElement): string | null {
  return root.namespaceUri || attrOf(root, "xmlns") || null
}

/** Localiza o `infNFe` e seu `Id`. Lança nada — devolve null quando ausente. */
export function locateInfNFe(root: C14nElement): { el: C14nElement; id: string } | null {
  const namespaceUri = nfeDefaultNs(root)
  const candidates = namespaceUri ? childElements(root, "infNFe", namespaceUri) : []
  if (candidates.length !== 1) return null
  const [el] = candidates
  if (!el) return null
  return { el, id: attrOf(el, "Id") }
}

/** Digest (base64 SHA-1) do `infNFe` canonicalizado (C14N de subset, ns default herdado). */
export function digestInfNFe(root: C14nElement, infNFe: C14nElement): string {
  const canon = canonicalizeElement(infNFe, nfeDefaultNs(root))
  return sha1Base64(canon)
}

/**
 * Monta o `SignedInfo` (sem xmlns próprio — herda o da `Signature`). Ordem fixa exigida pelo XSD:
 * CanonicalizationMethod, SignatureMethod, Reference(Transforms → DigestMethod → DigestValue).
 */
export function buildSignedInfoXml(referenceId: string, digestValue: string): string {
  const uri = referenceId ? `#${referenceId.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}` : ""
  return (
    `<SignedInfo>` +
    `<CanonicalizationMethod Algorithm="${ALG_C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${ALG_SIGNATURE_RSA_SHA1}"></SignatureMethod>` +
    `<Reference URI="${uri}">` +
    `<Transforms>` +
    `<Transform Algorithm="${ALG_ENVELOPED}"></Transform>` +
    `<Transform Algorithm="${ALG_C14N}"></Transform>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="${ALG_DIGEST_SHA1}"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`
  )
}

/**
 * Canonicaliza `SignedInfo` no contexto inclusivo real. Quando o XML da NFe e informado, namespaces
 * ancestrais da raiz tambem entram nos bytes C14N, como exige Canonical XML 1.0.
 */
export function canonicalizeSignedInfo(
  signedInfoXml: string,
  inheritedNs: string = DSIG_NS,
  enclosingNfeXml?: string,
): string {
  const signatureXml = `<Signature xmlns="${inheritedNs}">${signedInfoXml}</Signature>`
  const contextualXml = enclosingNfeXml
    ? insertSignatureAsLastChild(enclosingNfeXml, signatureXml)
    : signatureXml
  const documentRoot = parseXml(contextualXml)
  const signature = enclosingNfeXml
    ? childElements(documentRoot, "Signature", inheritedNs)[0]
    : documentRoot
  if (!signature) throw new Error("Signature ausente para canonicalizacao de SignedInfo.")
  const [signedInfo] = childElements(signature, "SignedInfo", inheritedNs)
  if (!signedInfo) throw new Error("SignedInfo ausente para canonicalizacao.")
  return canonicalizeElement(signedInfo)
}

/**
 * Monta o elemento `<Signature>` completo (com `xmlns` DSIG no ápice), pronto para inserir como
 * último filho de `<NFe>`. `signedInfoXml` deve ser o MESMO texto cujo canônico foi assinado.
 */
export function buildSignatureXml(args: {
  signedInfoXml: string
  signatureValue: string
  certificadoBase64: string
}): string {
  return (
    `<Signature xmlns="${DSIG_NS}">` +
    args.signedInfoXml +
    `<SignatureValue>${args.signatureValue}</SignatureValue>` +
    `<KeyInfo>` +
    `<X509Data>` +
    `<X509Certificate>${args.certificadoBase64}</X509Certificate>` +
    `</X509Data>` +
    `</KeyInfo>` +
    `</Signature>`
  )
}

/** Insere o `<Signature>` como último filho da raiz (envelopada). */
export function insertSignatureAsLastChild(xml: string, signatureXml: string): string {
  const root = parseXml(xml)
  const closingTag = `</${root.qualifiedName}>`
  const idx = xml.lastIndexOf(closingTag)
  if (idx < 0) throw new Error(`Documento sem ${closingTag} para envelopar a assinatura.`)
  return xml.slice(0, idx) + signatureXml + xml.slice(idx)
}

/** Insere o `<Signature>` como último filho de `<NFe>` (envelopada). */
export function insertSignatureIntoNFe(xml: string, signatureXml: string): string {
  const root = parseXml(xml)
  if (root.name !== "NFe") throw new Error("Documento sem raiz NFe para envelopar a assinatura.")
  return insertSignatureAsLastChild(xml, signatureXml)
}
