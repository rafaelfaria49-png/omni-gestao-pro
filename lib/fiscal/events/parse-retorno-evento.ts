/**
 * Leitura estrutural de `retEnvEvento` / `infEvento` (NFeRecepcaoEvento4).
 * Fail-closed: ambiguidade ou malformação → incerto. Sem busca global de cStat.
 */
import { childElements, parseXml, textOf, type C14nElement } from "@/lib/fiscal/signing/c14n"
import { interpretarCStatCancelamento, type DesfechoCStatCancelamento } from "./cstat-cancelamento"

const NFE_NS = "http://www.portalfiscal.inf.br/nfe"
const SOAP12_NS = "http://www.w3.org/2003/05/soap-envelope"
const SOAP11_NS = "http://schemas.xmlsoap.org/soap/envelope/"

export type RetornoEventoCancelamento = DesfechoCStatCancelamento & {
  protocolo: string | null
  xMotivo: string | null
  chaveAcesso: string | null
  xmlRetorno: string | null
}

function filhosNs(pai: C14nElement, nome: string, ns: string): C14nElement[] {
  return childElements(pai, nome, ns).filter((f) => f.namespaceUri === ns)
}

function filhos(pai: C14nElement, nome: string): C14nElement[] {
  return filhosNs(pai, nome, NFE_NS)
}

function unico(pai: C14nElement, nome: string): C14nElement | null {
  const found = filhos(pai, nome)
  if (found.length !== 1) return null
  return found[0] ?? null
}

function payloadFiscal(raiz: C14nElement): C14nElement {
  if (raiz.name === "retEnvEvento" || raiz.name === "infEvento") return raiz
  const soapNs = raiz.namespaceUri === SOAP11_NS ? SOAP11_NS : SOAP12_NS
  if (raiz.name === "Envelope") {
    const bodies = filhosNs(raiz, "Body", soapNs)
    if (bodies.length !== 1) return raiz
    const body = bodies[0]!
    const result = filhos(body, "nfeResultMsg")
    if (result.length === 1) return result[0]!
    const ret = filhos(body, "retEnvEvento")
    if (ret.length === 1) return ret[0]!
  }
  return raiz
}

function texto(el: C14nElement | null): string | null {
  if (!el) return null
  if (el.children.some((c) => c.type === "element")) return null
  const v = textOf(el).trim()
  return v.length > 0 ? v : null
}

function localizarInfEvento(raiz: C14nElement): C14nElement | null {
  const direto = filhos(raiz, "infEvento")
  if (direto.length === 1) return direto[0] ?? null
  if (direto.length > 1) return null
  const ret = unico(raiz, "retEnvEvento") ?? raiz
  const inner = filhos(ret, "infEvento")
  if (inner.length === 1) return inner[0] ?? null
  const retEvento = filhos(ret, "retEvento")
  if (retEvento.length === 1) {
    const inf = filhos(retEvento[0]!, "infEvento")
    if (inf.length === 1) return inf[0] ?? null
  }
  return null
}

export function parseRetornoEventoCancelamento(input: {
  xml: string
  chaveAcessoEsperada: string
}): RetornoEventoCancelamento {
  const incerto = (xmlRetorno: string | null = null): RetornoEventoCancelamento => ({
    desfecho: "incerto",
    cStat: null,
    protocolo: null,
    xMotivo: null,
    chaveAcesso: null,
    xmlRetorno,
  })

  let doc: C14nElement
  try {
    doc = parseXml(input.xml)
  } catch {
    return incerto()
  }

  const inf = localizarInfEvento(payloadFiscal(doc))
  if (!inf) return incerto(input.xml)

  const cStat = texto(unico(inf, "cStat"))
  const xMotivo = texto(unico(inf, "xMotivo"))
  const protocolo = texto(unico(inf, "nProt"))
  const chave = texto(unico(inf, "chNFe"))
  const esperada = String(input.chaveAcessoEsperada ?? "").trim()
  if (esperada && chave && chave !== esperada) return incerto(input.xml)

  const desfecho = interpretarCStatCancelamento(cStat)
  return {
    ...desfecho,
    protocolo: protocolo && /^\d{1,20}$/.test(protocolo) ? protocolo : null,
    xMotivo: xMotivo ? xMotivo.slice(0, 255) : null,
    chaveAcesso: chave,
    xmlRetorno: input.xml,
  }
}
