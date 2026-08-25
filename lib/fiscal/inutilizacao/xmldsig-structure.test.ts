import { describe, expect, it } from "vitest"
import { buildSefazSoap12Envelope, extractFiscalBytes } from "../provider/sefaz/sefaz-envelope"
import { loadCertificateMaterialFromPem } from "../signing/nfce-signer"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "../signing/__fixtures__/test-cert"
import { createInutilizacaoXmlSigner } from "./sefaz-inutilizar"
import { buildInutilizacaoXml } from "./xml-builder"
import { assertInutilizacaoXmlDsig } from "./xmldsig-structure"

const sign = createInutilizacaoXmlSigner(
  loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM),
  "",
  { agora: new Date("2027-06-01T12:00:00.000Z") },
)

function pedidoXml(): string {
  const built = buildInutilizacaoXml({
    tpAmb: "2",
    cUF: "35",
    ano: "26",
    cnpj: "11222333000181",
    modelo: "65",
    serie: "1",
    nNFIni: "1",
    nNFFin: "1",
    xJust: "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar.",
  })
  if (!built.ok || !built.xml) throw new Error("pedido XML inválido no teste")
  return built.xml
}

describe("XMLDSig estrutural do inutNFe", () => {
  it("aceita Signature no último filho com Reference no Id único de infInut", () => {
    const signed = sign(pedidoXml())
    const check = assertInutilizacaoXmlDsig(signed)
    expect(check.ok).toBe(true)
    if (check.ok) {
      expect(signed).toContain(`URI="#${check.id}"`)
      expect(signed.indexOf("<infInut")).toBeLessThan(signed.lastIndexOf("<Signature"))
    }
  })

  it("recusa Signature deslocada, Reference errada e prova só textual", () => {
    const signed = sign(pedidoXml())
    const displaced = signed.replace(
      /(<inutNFe[^>]*>)([\s\S]*?)(<Signature[\s\S]*<\/Signature>)(<\/inutNFe>)/,
      "$1$3$2$4",
    )
    expect(assertInutilizacaoXmlDsig(displaced).ok).toBe(false)
    expect(assertInutilizacaoXmlDsig(signed.replace(/URI="#ID/, 'URI="#XX')).ok).toBe(false)
    const textual = pedidoXml().replace(
      "</inutNFe>",
      `<!-- <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">fake</Signature> --></inutNFe>`,
    )
    expect(assertInutilizacaoXmlDsig(textual).ok).toBe(false)
  })

  it("bytes no SOAP são exatamente o XML assinado", () => {
    const signed = sign(pedidoXml())
    const exactBytes = Uint8Array.from(new TextEncoder().encode(signed))
    const envelope = buildSefazSoap12Envelope({ servico: "NFeInutilizacao4", exactBytes })
    expect(envelope.ok).toBe(true)
    if (!envelope.ok) return
    const fiscal = extractFiscalBytes(envelope.envelope)
    expect(Buffer.from(fiscal).equals(Buffer.from(exactBytes))).toBe(true)
    expect(assertInutilizacaoXmlDsig(new TextDecoder().decode(fiscal)).ok).toBe(true)
  })
})
