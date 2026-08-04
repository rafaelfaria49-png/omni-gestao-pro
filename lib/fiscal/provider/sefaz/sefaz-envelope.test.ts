/**
 * GOAL-016D-A — envelope SOAP 1.2 (D5 · MOC 7.00 §3.2).
 *
 * O ponto crítico é a **byte-exatidão**: os bytes assinados entram por concatenação e saem
 * idênticos. Qualquer parse/re-serialização invalidaria a assinatura XMLDSig (ADR-0017/0018).
 */
import { describe, expect, it } from "vitest"
import {
  SEFAZ_SOAP12_CONTENT_TYPE,
  buildSefazSoap12Envelope,
  extractFiscalBytes,
} from "./sefaz-envelope"
import type { SefazServico } from "./sefaz-endpoint-catalog"

/** XML assinado sintético com particularidades que um re-serializador destruiria. */
const XML_ASSINADO =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35260812345678000199650010000000011000000017" versao="4.00">` +
  `<ide><tpAmb>2</tpAmb></ide>   <espaco   preservado="sim"/>` +
  `<acentos>São Paulo · ção</acentos>` +
  `<Signature><SignatureValue>QUJDRA==</SignatureValue></Signature>` +
  `</infNFe></NFe>`

function bytesDoXml(xml: string): Uint8Array {
  return new TextEncoder().encode(xml)
}

describe("envelope SOAP 1.2", () => {
  it("usa o Content-Type oficial do SOAP 1.2", () => {
    const env = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(XML_ASSINADO),
    })
    expect(env.contentType).toBe("application/soap+xml; charset=utf-8")
    expect(SEFAZ_SOAP12_CONTENT_TYPE).toBe("application/soap+xml; charset=utf-8")
  })

  it("NÃO contém soap12:Header nem nfeCabecMsg (eliminados no leiaute 4.00)", () => {
    const env = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(XML_ASSINADO),
    })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).not.toContain("Header")
    expect(texto).not.toContain("nfeCabecMsg")
    expect(texto).not.toContain("versaoDados")
    expect(texto).not.toContain("cUF")
    expect(texto).toContain("<soap12:Body>")
  })

  it("envolve o conteúdo em nfeDadosMsg com o namespace do serviço", () => {
    const servicos: SefazServico[] = ["NFeAutorizacao4", "NFeStatusServico4", "NFeConsultaProtocolo4"]
    for (const servico of servicos) {
      const env = buildSefazSoap12Envelope({ servico, exactBytes: bytesDoXml(XML_ASSINADO) })
      const texto = new TextDecoder().decode(env.bytes)
      expect(texto).toContain(
        `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">`,
      )
      expect(env.namespace).toBe(`http://www.portalfiscal.inf.br/nfe/wsdl/${servico}`)
    }
  })

  it("não comprime: o envelope é UTF-8 legível, sem GZip/base64 do documento", () => {
    const env = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(XML_ASSINADO),
    })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).toContain("<NFe xmlns=")
    expect(texto).toContain("<tpAmb>2</tpAmb>")
  })
})

describe("byte-exatidão dos bytes fiscais", () => {
  it("os bytes assinados saem do envelope IDÊNTICOS aos que entraram", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: original })
    const extraidos = extractFiscalBytes(env)

    expect(extraidos.length).toBe(original.length)
    expect(Buffer.from(extraidos).equals(Buffer.from(original))).toBe(true)
    // byte a byte, sem depender de comparação de string
    for (let i = 0; i < original.length; i += 1) expect(extraidos[i]).toBe(original[i])
  })

  it("espaços, acentos e a assinatura sobrevivem sem normalização", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: original })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).toContain("   <espaco   preservado=\"sim\"/>")
    expect(texto).toContain("São Paulo · ção")
    expect(texto).toContain("<SignatureValue>QUJDRA==</SignatureValue>")
  })

  it("bytes arbitrários (não-UTF8 válidos) também atravessam intactos", () => {
    const brutos = new Uint8Array([0x3c, 0x61, 0x2f, 0x3e, 0xff, 0xfe, 0x00, 0x41])
    const env = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: brutos })
    const extraidos = extractFiscalBytes(env)
    expect(Buffer.from(extraidos).equals(Buffer.from(brutos))).toBe(true)
  })

  it("o offset registrado aponta exatamente para o início do conteúdo fiscal", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: original })
    const prefixo = new TextDecoder().decode(env.bytes.slice(0, env.fiscalBytesOffset))
    expect(prefixo.endsWith(">")).toBe(true)
    expect(prefixo).toContain("<nfeDadosMsg")
    expect(env.fiscalBytesLength).toBe(original.length)
  })
})
