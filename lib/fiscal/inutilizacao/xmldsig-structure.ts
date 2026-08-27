/**
 * Validação estrutural XMLDSig do inutNFe. Recusa prova só textual de "<Signature".
 */

import {
  attrOf,
  childElements,
  findAll,
  findAllById,
  parseXml,
} from "../signing/c14n"
import { DSIG_NS } from "../signing/signer.types"
import { INUTILIZACAO_XMLNS } from "./types"

export type InutilizacaoDsigCheck =
  | { ok: true; id: string }
  | { ok: false; mensagem: string }

export function assertInutilizacaoXmlDsig(xml: string): InutilizacaoDsigCheck {
  if (typeof xml !== "string" || !xml.trim()) {
    return { ok: false, mensagem: "XML de inutilização vazio." }
  }
  let root
  try {
    root = parseXml(xml)
  } catch {
    return { ok: false, mensagem: "XML de inutilização malformado." }
  }
  if (root.name !== "inutNFe" || root.namespaceUri !== INUTILIZACAO_XMLNS) {
    return { ok: false, mensagem: "Raiz não é inutNFe no namespace fiscal." }
  }

  const infInutList = childElements(root, "infInut", INUTILIZACAO_XMLNS)
  if (infInutList.length !== 1) {
    return { ok: false, mensagem: "inutNFe deve ter exatamente um infInut direto." }
  }
  const infInut = infInutList[0]!
  const id = attrOf(infInut, "Id")
  if (!id) return { ok: false, mensagem: "infInut sem atributo Id." }
  if (findAllById(root, id).length !== 1) {
    return { ok: false, mensagem: "Id de infInut não é único." }
  }

  const directChildren = childElements(root)
  const last = directChildren[directChildren.length - 1]
  if (!last || last.name !== "Signature" || last.namespaceUri !== DSIG_NS) {
    return { ok: false, mensagem: "Signature XMLDSig deve ser o último filho de inutNFe." }
  }
  const allSignatures = findAll(root, "Signature").filter((el) => el.namespaceUri === DSIG_NS)
  if (allSignatures.length !== 1 || allSignatures[0] !== last) {
    return { ok: false, mensagem: "Signature XMLDSig fora do local esperado." }
  }

  const signedInfo = childElements(last, "SignedInfo", DSIG_NS)[0]
  const references = signedInfo ? childElements(signedInfo, "Reference", DSIG_NS) : []
  if (references.length !== 1) {
    return { ok: false, mensagem: "SignedInfo deve ter exatamente uma Reference (a do infInut)." }
  }
  const uri = attrOf(references[0]!, "URI")
  if (uri !== `#${id}`) {
    return { ok: false, mensagem: "Reference URI não aponta para infInut/@Id." }
  }
  const referenced = findAllById(root, id)
  if (referenced[0] !== infInut) {
    return { ok: false, mensagem: "Reference não resolve para o infInut assinado." }
  }
  return { ok: true, id }
}
