import { describe, expect, it } from "vitest"
import { loadCertificateMaterialFromPem } from "@/lib/fiscal/signing/nfce-signer"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "@/lib/fiscal/signing/__fixtures__/test-cert"
import { buildXmlEventoCancelamento } from "./evento-xml"
import { signEventoCancelamentoXml } from "./evento-sign"

describe("signEventoCancelamentoXml", () => {
  it("insere Signature envelopada no evento, referenciando o Id do infEvento", () => {
    const unsigned = buildXmlEventoCancelamento({
      chaveAcesso: "35250811222333000165550010000000011000000010",
      protocolo: "135250000000001",
      justificativa: "Cancelamento de teste em homologação",
      cnpj: "11222333000165",
      tpAmb: "2",
      cOrgao: "35",
      sequencia: 1,
    })
    expect(unsigned).not.toContain("<Signature")
    const material = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)
    const signed = signEventoCancelamentoXml(unsigned, material, "", { ignorarValidade: true })
    expect(signed).toContain("<Signature")
    expect(signed).toContain("http://www.w3.org/2000/09/xmldsig#")
    expect(signed).toContain("ID1101113525081122233300016555001000000001100000001001")
    expect(signed.indexOf("<Signature")).toBeGreaterThan(signed.indexOf("<infEvento"))
    expect(signed.indexOf("<Signature")).toBeLessThan(signed.lastIndexOf("</evento>"))
  })
})
