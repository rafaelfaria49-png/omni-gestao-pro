/**
 * XML do evento de cancelamento (tpEvento 110111) para NFeRecepcaoEvento4.
 * Puro: não assina, não transmite, não persiste.
 */
import { serializeXmlEmbeddable, type XmlNode } from "@/lib/fiscal/xml/xml-writer"

export const TP_EVENTO_CANCELAMENTO = "110111"
export const VERSAO_EVENTO_CANCELAMENTO = "1.00"
export const DESC_EVENTO_CANCELAMENTO = "Cancelamento"

export type EventoCancelamentoXmlInput = {
  chaveAcesso: string
  protocolo: string
  justificativa: string
  cnpj: string
  tpAmb: "1" | "2"
  cOrgao?: string
  sequencia?: number
  dhEvento?: Date
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function formatDhEvento(d: Date): string {
  const tz = -d.getTimezoneOffset()
  const sign = tz >= 0 ? "+" : "-"
  const abs = Math.abs(tz)
  const hh = pad2(Math.floor(abs / 60))
  const mm = pad2(abs % 60)
  const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  return `${iso}${sign}${hh}:${mm}`
}

export function idInfEventoCancelamento(chaveAcesso: string, sequencia: number): string {
  return `ID${TP_EVENTO_CANCELAMENTO}${chaveAcesso}${pad2(sequencia)}`
}

/**
 * Monta `envEvento` embutível (sem declaração XML) para o envelope SOAP.
 */
export function buildXmlEventoCancelamento(input: EventoCancelamentoXmlInput): string {
  const chave = String(input.chaveAcesso ?? "").trim()
  const protocolo = String(input.protocolo ?? "").trim()
  const justificativa = String(input.justificativa ?? "").trim()
  const cnpj = String(input.cnpj ?? "").replace(/\D/g, "")
  const sequencia = input.sequencia ?? 1
  const cOrgao = String(input.cOrgao ?? "35").trim() || "35"
  const dh = formatDhEvento(input.dhEvento ?? new Date())
  const id = idInfEventoCancelamento(chave, sequencia)

  const infEvento: XmlNode = {
    tag: "infEvento",
    attrs: { Id: id },
    children: [
      { tag: "cOrgao", text: cOrgao },
      { tag: "tpAmb", text: input.tpAmb },
      { tag: "CNPJ", text: cnpj },
      { tag: "chNFe", text: chave },
      { tag: "dhEvento", text: dh },
      { tag: "tpEvento", text: TP_EVENTO_CANCELAMENTO },
      { tag: "nSeqEvento", text: String(sequencia) },
      { tag: "verEvento", text: VERSAO_EVENTO_CANCELAMENTO },
      {
        tag: "detEvento",
        attrs: { versao: VERSAO_EVENTO_CANCELAMENTO },
        children: [
          { tag: "descEvento", text: DESC_EVENTO_CANCELAMENTO },
          { tag: "nProt", text: protocolo },
          { tag: "xJust", text: justificativa },
        ],
      },
    ],
  }

  const envEvento: XmlNode = {
    tag: "envEvento",
    attrs: { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: VERSAO_EVENTO_CANCELAMENTO },
    children: [
      { tag: "idLote", text: "1" },
      {
        tag: "evento",
        attrs: { versao: VERSAO_EVENTO_CANCELAMENTO },
        children: [infEvento],
      },
    ],
  }

  return serializeXmlEmbeddable(envEvento, { indentUnit: "" })
}
