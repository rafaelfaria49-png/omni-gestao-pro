/**
 * Fundação OFFLINE de inutilização NFC-e (GOAL 019).
 * Sem rede SEFAZ. Fixtures sintéticas e determinísticas.
 */
import { describe, expect, it } from "vitest"
import { loadCertificateMaterialFromPem } from "../signing/nfce-signer"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "../signing/__fixtures__/test-cert"
import {
  ID_PEDIDO_CNPJ_ALFA,
  ID_PEDIDO_VALIDO,
  PEDIDO_CNPJ_ALFA,
  PEDIDO_VALIDO,
  PROT_15,
  PROT_17,
  retInutNFe,
} from "./__fixtures__/inutilizacao-fixtures"
import { buildInutilizacaoXml } from "./xml-builder"
import { montarIdInutilizacao } from "./id"
import { parseInutilizacaoResponse } from "./response-parser"
import { inutilizacaoPermiteRetryAutomatico } from "./classifier"
import { signInutilizacaoXml } from "./sign-boundary"
import { validateInutilizacaoPedido } from "./validation"
import { validarInutilizacaoPedidoXsd, validarInutilizacaoRetornoXsd } from "./xsd-validate"
import { INUTILIZACAO_MAX_FAIXA, type InutilizacaoPedidoInput } from "./types"

const CERT = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)
const SIGN_OPTS = { agora: new Date("2027-06-01T12:00:00.000Z") }

function pedido(over: Partial<InutilizacaoPedidoInput> = {}): InutilizacaoPedidoInput {
  return { ...PEDIDO_VALIDO, ...over }
}

describe("validateInutilizacaoPedido", () => {
  it("aceita intervalo válido de um número", () => {
    const r = validateInutilizacaoPedido(pedido())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.pedido.nIni).toBe(1)
      expect(r.pedido.nFin).toBe(1)
      expect(r.pedido.id).toBe(ID_PEDIDO_VALIDO)
    }
  })

  it("rejeita início maior que fim", () => {
    const r = validateInutilizacaoPedido(pedido({ nNFIni: "10", nNFFin: "9" }))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === "intervalo_invalido")).toBe(true)
  })

  it("rejeita faixa acima do limite oficial de 10.000", () => {
    const r = validateInutilizacaoPedido(pedido({ nNFIni: "1", nNFFin: String(INUTILIZACAO_MAX_FAIXA + 1) }))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === "intervalo_excede_limite")).toBe(true)
  })

  it("aceita faixa exatamente no limite de 10.000", () => {
    const r = validateInutilizacaoPedido(pedido({ nNFIni: "1", nNFFin: String(INUTILIZACAO_MAX_FAIXA) }))
    expect(r.ok).toBe(true)
  })

  it("rejeita série inválida", () => {
    const r = validateInutilizacaoPedido(pedido({ serie: "1000" }))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === "serie_invalida")).toBe(true)
  })

  it("rejeita modelo incompatível com NFC-e", () => {
    const r = validateInutilizacaoPedido(pedido({ modelo: "55" }))
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === "modelo_incompativel")).toBe(true)
  })

  it("rejeita ano e UF inválidos", () => {
    expect(validateInutilizacaoPedido(pedido({ ano: "2" })).issues.some((i) => i.code === "ano_invalido")).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ ano: "05", anoCalendario: 2026 })).issues.some((i) => i.code === "ano_inferior_minimo")).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ ano: "27", anoCalendario: 2026 })).issues.some((i) => i.code === "ano_superior_atual")).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ cUF: "99" })).issues.some((i) => i.code === "uf_invalida")).toBe(true)
  })

  it("valida CNPJ conforme TCnpj vigente (numérico e alfanumérico)", () => {
    expect(validateInutilizacaoPedido(pedido({ cnpj: "123" })).issues.some((i) => i.code === "cnpj_invalido")).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ cnpj: "A1B2C3D4E5F60X" })).issues.some((i) => i.code === "cnpj_invalido")).toBe(true)
    expect(validateInutilizacaoPedido(PEDIDO_CNPJ_ALFA).ok).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ cnpj: "11222333000181" })).ok).toBe(true)
  })

  it("valida justificativa mínima e máxima", () => {
    expect(validateInutilizacaoPedido(pedido({ xJust: "curto demais" })).issues.some((i) => i.code === "justificativa_invalida")).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ xJust: "a".repeat(15) })).ok).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ xJust: "a".repeat(255) })).ok).toBe(true)
    expect(validateInutilizacaoPedido(pedido({ xJust: "a".repeat(256) })).issues.some((i) => i.code === "justificativa_invalida")).toBe(true)
  })
})

describe("Id oficial", () => {
  it("compõe o Id exatamente conforme o padrão vigente", () => {
    expect(montarIdInutilizacao({
      cUF: "35",
      ano: "26",
      cnpj: "11222333000181",
      modelo: "65",
      serie: "1",
      nNFIni: "1",
      nNFFin: "1",
    })).toBe(ID_PEDIDO_VALIDO)
    expect(montarIdInutilizacao({
      cUF: "35",
      ano: "26",
      cnpj: "A1B2C3D4E5F601",
      modelo: "65",
      serie: "1",
      nNFIni: "1",
      nNFFin: "1",
    })).toBe(ID_PEDIDO_CNPJ_ALFA)
    expect(ID_PEDIDO_VALIDO).toHaveLength(43)
    expect(ID_PEDIDO_CNPJ_ALFA).toHaveLength(43)
  })
})

describe("XML determinístico e escaping", () => {
  it("emite XML estável para o mesmo pedido", () => {
    const a = buildInutilizacaoXml(pedido())
    const b = buildInutilizacaoXml(pedido())
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.xml).toBe(b.xml)
      expect(a.id).toBe(ID_PEDIDO_VALIDO)
      expect(a.xml).toContain(`Id="${ID_PEDIDO_VALIDO}"`)
      expect(a.xml).not.toContain("<?xml")
    }
  })

  it("escapa &, < e > na justificativa", () => {
    const r = buildInutilizacaoXml(pedido({ xJust: "Falha A & B <teste> maior" }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.xml).toContain("Falha A &amp; B &lt;teste&gt; maior")
      expect(r.xml).not.toMatch(/<xJust>.*[<>].*<\/xJust>/)
    }
  })
})

describe("parser e classificador fail-closed", () => {
  it("classifica sucesso definitivo 102 com protocolo TProt", () => {
    const r = parseInutilizacaoResponse(retInutNFe({
      cStat: "102",
      xMotivo: "Inutilizacao de numero homologado",
      nProt: PROT_15,
    }))
    expect(r.outcome).toBe("SUCCESS")
    expect(r.cStat).toBe("102")
    expect(r.protocolo).toBe(PROT_15)
    expect(r.retryAutomatico).toBe(false)
  })

  it("aceita protocolo de 17 dígitos do TProt vigente", () => {
    const r = parseInutilizacaoResponse(retInutNFe({
      cStat: "102",
      xMotivo: "Inutilizacao de numero homologado",
      nProt: PROT_17,
    }))
    expect(r.outcome).toBe("SUCCESS")
    expect(r.protocolo).toBe(PROT_17)
  })

  it("classifica rejeição definitiva", () => {
    const r = parseInutilizacaoResponse(retInutNFe({
      cStat: "224",
      xMotivo: "A faixa inicial e maior que a faixa final",
    }))
    expect(r.outcome).toBe("REJECTED")
    expect(r.reason).toBe("REJEICAO_DEFINITIVA")
    expect(r.retryAutomatico).toBe(false)
  })

  it("classifica malformed", () => {
    const r = parseInutilizacaoResponse("<nao-e-xml")
    expect(r.outcome).toBe("MALFORMED")
    expect(r.retryAutomatico).toBe(false)
  })

  it("classifica UNKNOWN e prova que não produz retry", () => {
    const r = parseInutilizacaoResponse(retInutNFe({
      cStat: "999",
      xMotivo: "codigo nao catalogado",
    }))
    expect(r.outcome).toBe("UNKNOWN")
    expect(r.reason).toBe("UNKNOWN")
    expect(r.retryAutomatico).toBe(false)
    expect(inutilizacaoPermiteRetryAutomatico(r)).toBe(false)
  })

  it("não trata 103/104/105 como intermediário — permanece UNKNOWN sem retry", () => {
    for (const cStat of ["103", "104", "105"] as const) {
      const r = parseInutilizacaoResponse(retInutNFe({
        cStat,
        xMotivo: "status de lote de outro servico",
      }))
      expect(r.outcome, cStat).toBe("UNKNOWN")
      expect(r.retryAutomatico, cStat).toBe(false)
      expect(inutilizacaoPermiteRetryAutomatico(r)).toBe(false)
    }
  })

  it("reprova SOAP 1.1 como malformed", () => {
    const xml = (
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">` +
      retInutNFe({ cStat: "102", xMotivo: "Inutilizacao de numero homologado", nProt: PROT_15 }) +
      `</nfeResultMsg></soap:Body></soap:Envelope>`
    )
    const r = parseInutilizacaoResponse(xml)
    expect(r.outcome).toBe("MALFORMED")
    expect(r.retryAutomatico).toBe(false)
  })

  it("extrai retInutNFe de SOAP 1.2 / nfeResultMsg", () => {
    const xml = (
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">` +
      retInutNFe({ cStat: "102", xMotivo: "Inutilizacao de numero homologado", nProt: PROT_15 }) +
      `</nfeResultMsg></soap:Body></soap:Envelope>`
    )
    const r = parseInutilizacaoResponse(xml)
    expect(r.outcome).toBe("SUCCESS")
    expect(r.cStat).toBe("102")
    expect(r.retryAutomatico).toBe(false)
  })

  it("102 sem protocolo não é sucesso", () => {
    const r = parseInutilizacaoResponse(retInutNFe({
      cStat: "102",
      xMotivo: "Inutilizacao de numero homologado",
    }))
    expect(r.outcome).toBe("UNKNOWN")
    expect(r.reason).toBe("INCOMPLETE_SUCCESS")
    expect(r.retryAutomatico).toBe(false)
  })
})

describe("XSD oficial offline", () => {
  it("valida pedido assinado contra inutNFe_v4.00.xsd", () => {
    const built = buildInutilizacaoXml(pedido())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const signed = signInutilizacaoXml(built.xml, CERT, "", SIGN_OPTS)
    const xsd = validarInutilizacaoPedidoXsd(signed.xml)
    expect(xsd.valid, xsd.output).toBe(true)
  })

  it("valida pedido com CNPJ alfanumérico contra o XSD vigente", () => {
    const built = buildInutilizacaoXml(PEDIDO_CNPJ_ALFA)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.id).toBe(ID_PEDIDO_CNPJ_ALFA)
    const signed = signInutilizacaoXml(built.xml, CERT, "", SIGN_OPTS)
    const xsd = validarInutilizacaoPedidoXsd(signed.xml)
    expect(xsd.valid, xsd.output).toBe(true)
  })

  it("reprova pedido com Id divergente no XSD", () => {
    const built = buildInutilizacaoXml(pedido())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const signed = signInutilizacaoXml(built.xml, CERT, "", SIGN_OPTS)
    const mutado = signed.xml.replaceAll(ID_PEDIDO_VALIDO, "IDcurto")
    const xsd = validarInutilizacaoPedidoXsd(mutado)
    expect(xsd.valid).toBe(false)
  })

  it("valida retorno sintético 102 contra retInutNFe_v4.00.xsd", () => {
    const xml = retInutNFe({
      cStat: "102",
      xMotivo: "Inutilizacao de numero homologado",
      nProt: PROT_15,
    })
    const xsd = validarInutilizacaoRetornoXsd(xml)
    expect(xsd.valid, xsd.output).toBe(true)
  })
})
