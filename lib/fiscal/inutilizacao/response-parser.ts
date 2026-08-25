/**
 * Parser puro da resposta de inutilização (`retInutNFe`).
 *
 * Caminho estrutural, namespace-qualificado, fail-closed. Não abre socket.
 * Aceita `retInutNFe` na raiz ou envelopado em SOAP 1.2 / `nfeResultMsg` (MOC 7.0,
 * já versionado no repositório). Não inventa SOAPAction (H-9 permanece aberto).
 */

import { childElements, parseXml, textOf, XmlParseError, type C14nElement } from "../signing/c14n"
import { classifyInutilizacaoRetorno } from "./classifier"
import { INUTILIZACAO_XMLNS, type InutilizacaoClassification } from "./types"

const SOAP12_NS = "http://www.w3.org/2003/05/soap-envelope"
const SOAP11_NS = "http://schemas.xmlsoap.org/soap/envelope/"
const WRAPPER_RESPOSTA = "nfeResultMsg"
const MAX_XMOTIVO = 255
const MAX_BYTES = 2 * 1024 * 1024

function textoSeguro(valor: string): string {
  return valor.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_XMOTIVO)
}

function oneChild(el: C14nElement, name: string, ns: string): C14nElement | null {
  const matches = childElements(el, name, ns)
  return matches.length === 1 ? matches[0]! : null
}

function collectRetInut(root: C14nElement): C14nElement[] {
  const found: C14nElement[] = []
  const visit = (el: C14nElement) => {
    if (el.name === "retInutNFe" && el.namespaceUri === INUTILIZACAO_XMLNS) found.push(el)
    for (const child of el.children) {
      if (child.type === "element") visit(child)
    }
  }
  visit(root)
  return found
}

function payloadFromSoap(root: C14nElement): C14nElement | "ambiguous" | "malformed" {
  if (root.namespaceUri === SOAP11_NS) return "malformed"
  if (root.name !== "Envelope" || root.namespaceUri !== SOAP12_NS) return "malformed"
  const bodies = childElements(root, "Body", SOAP12_NS)
  if (bodies.length !== 1) return bodies.length > 1 ? "ambiguous" : "malformed"
  const wrappers = childElements(bodies[0]!, WRAPPER_RESPOSTA)
  if (wrappers.length !== 1) return wrappers.length > 1 ? "ambiguous" : "malformed"
  const payloads = childElements(wrappers[0]!, "retInutNFe", INUTILIZACAO_XMLNS)
  if (payloads.length !== 1) return payloads.length > 1 ? "ambiguous" : "malformed"
  return payloads[0]!
}

export function parseInutilizacaoResponse(xml: string): InutilizacaoClassification {
  if (typeof xml !== "string" || xml.length === 0) {
    return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
  }
  if (xml.length > MAX_BYTES || Buffer.byteLength(xml, "utf8") > MAX_BYTES) {
    return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
  }

  let root: C14nElement
  try {
    root = parseXml(xml)
  } catch (error) {
    if (error instanceof XmlParseError) {
      return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
    }
    return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
  }

  let payload: C14nElement
  if (root.name === "retInutNFe" && root.namespaceUri === INUTILIZACAO_XMLNS) {
    const all = collectRetInut(root)
    if (all.length !== 1) {
      return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, ambiguous: true })
    }
    payload = root
  } else if (root.name === "Envelope") {
    const extracted = payloadFromSoap(root)
    if (extracted === "ambiguous") {
      return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, ambiguous: true })
    }
    if (extracted === "malformed") {
      return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
    }
    payload = extracted
  } else {
    return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, malformed: true })
  }

  const infs = childElements(payload, "infInut", INUTILIZACAO_XMLNS)
  if (infs.length !== 1) {
    return classifyInutilizacaoRetorno({
      cStat: null,
      xMotivo: null,
      nProt: null,
      ambiguous: infs.length > 1,
      malformed: infs.length === 0,
    })
  }
  const inf = infs[0]!
  const cStatEl = oneChild(inf, "cStat", INUTILIZACAO_XMLNS)
  const xMotivoEl = oneChild(inf, "xMotivo", INUTILIZACAO_XMLNS)
  const nProtEl = oneChild(inf, "nProt", INUTILIZACAO_XMLNS)
  if (childElements(inf, "cStat", INUTILIZACAO_XMLNS).length > 1) {
    return classifyInutilizacaoRetorno({ cStat: null, xMotivo: null, nProt: null, ambiguous: true })
  }

  return classifyInutilizacaoRetorno({
    cStat: cStatEl ? textOf(cStatEl).trim() || null : null,
    xMotivo: xMotivoEl ? textoSeguro(textOf(xMotivoEl)) || null : null,
    nProt: nProtEl ? textOf(nProtEl).trim() || null : null,
  })
}
