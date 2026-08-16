/**
 * BL-FISCAL-004 — Gerador de XML NFC-e 4.00 (PURO, dormente).
 *
 * Cobre: venda simples, desconto, múltiplos itens, consumidor sem/com CPF, XML determinístico,
 * imutabilidade do snapshot, snapshot inválido, campos obrigatórios e compatibilidade com o
 * snapshot atual (`buildVendaFiscalSnapshot`). Os impostos vêm de `snapshot.tributacao`
 * (Simples Nacional CSOSN 102 → ICMSSN102 + PIS/COFINS CST 49). Nunca recalcula tributo.
 */
import { describe, it, expect } from "vitest"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotClienteInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { sanitizeProdutoFiscal, PRODUTO_FISCAL_VAZIO } from "@/lib/produto-fiscal"
import { buildNfceXml, buildNfceXmlResult } from "./nfce-xml-builder"
import { validateNfceSnapshot } from "./nfce-xml-validation"
import { NFCE_VER_PROC, NfceXmlError } from "./nfce-xml.types"

const LOJA_OK: SnapshotLojaInput = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "RafaCell Comércio LTDA",
  nomeFantasia: "RafaCell",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "987654",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua das Flores",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001-000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

function item(over: Partial<SnapshotItemInput> = {}): SnapshotItemInput {
  return {
    itemVendaId: "iv-1",
    produtoId: "prod-1",
    codigoProduto: "SKU-1",
    descricao: "Cabo USB-C",
    gtin: "7891234567890",
    quantidade: 2,
    valorUnitario: 25,
    valorDesconto: 0,
    valorTotal: 50,
    fiscal: sanitizeProdutoFiscal({ ncm: "85176200", cfop: "5102", csosn: "102", origem: "0", unidade: "UN" }),
    ...over,
  }
}

function baseInput(over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: {
      pedidoId: "VDA-2026-0001",
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João Caixa",
      terminal: "PDV1",
      paymentBreakdown: null,
    },
    itens: [item()],
    ...over,
  }
}

function snap(over: Partial<BuildSnapshotInput> = {}): VendaFiscalSnapshot {
  const r = buildVendaFiscalSnapshot(baseInput(over))
  if (!r.ok) throw new Error(`snapshot inesperadamente inválido: ${r.code}`)
  return r.snapshot
}

describe("buildNfceXml · venda simples (Simples Nacional, sem destaque)", () => {
  it("monta infNFe 4.00 com ide/emit/det/imposto/total/transp/pag", () => {
    const xml = buildNfceXml(snap())
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`)
    expect(xml).toMatch(/<infNFe versao="4\.00" Id="NFe\d{44}">/)
    // ide
    expect(xml).toContain("<mod>65</mod>")
    expect(xml).toContain("<tpAmb>2</tpAmb>") // homologação
    expect(xml).toContain("<tpImp>4</tpImp>")
    expect(xml).toContain("<indFinal>1</indFinal>")
    expect(NFCE_VER_PROC).toHaveLength(20)
    expect(xml).toContain(`<verProc>${NFCE_VER_PROC}</verProc>`)
    // emit
    expect(xml).toContain("<CNPJ>11222333000181</CNPJ>")
    expect(xml).toContain("<CRT>1</CRT>")
    expect(xml).toContain("<UF>SP</UF>")
    // det + imposto Simples
    expect(xml).toContain('<det nItem="1">')
    expect(xml).toContain("<ICMSSN102>")
    expect(xml).toContain("<CSOSN>102</CSOSN>")
    expect(xml).toContain("<PISOutr>")
    expect(xml).toContain("<COFINSOutr>")
    expect(xml).toMatch(/<PISOutr>\s*<CST>49<\/CST>/)
    // total / transp / pag
    expect(xml).toContain("<vNF>50.00</vNF>")
    expect(xml).toContain("<vICMS>0.00</vICMS>")
    expect(xml).toContain("<modFrete>9</modFrete>")
    expect(xml).toMatch(/<detPag>\s*<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<\/detPag>/)
    // consumidor final sem documento → sem grupo dest
    expect(xml).not.toContain("<dest>")
  })
})

describe("buildNfceXml · desconto do cabeçalho", () => {
  it("reflete vDesc total e vNF líquido; desconto rateado vira vDesc do item", () => {
    const xml = buildNfceXml(snap({ venda: { ...baseInput().venda, desconto: 10 } }))
    expect(xml).toContain("<vDesc>10.00</vDesc>")
    expect(xml).toContain("<vNF>40.00</vNF>")
    expect(xml).toContain("<vProd>50.00</vProd>")
  })
})

describe("buildNfceXml · múltiplos itens", () => {
  it("gera um det por item com nItem sequencial e soma vProd", () => {
    const xml = buildNfceXml(
      snap({
        venda: { ...baseInput().venda, total: 400 },
        itens: [
          item({ itemVendaId: "a", quantidade: 1, valorUnitario: 100, valorTotal: 100 }),
          item({ itemVendaId: "b", quantidade: 1, valorUnitario: 300, valorTotal: 300 }),
        ],
      }),
    )
    expect(xml).toContain('<det nItem="1">')
    expect(xml).toContain('<det nItem="2">')
    expect(xml).toContain("<vNF>400.00</vNF>")
  })
})

describe("buildNfceXml · destinatário", () => {
  it("consumidor sem CPF → sem grupo dest", () => {
    const xml = buildNfceXml(snap({ cliente: null }))
    expect(xml).not.toContain("<dest>")
  })

  it("consumidor com CPF → grupo dest com CPF e indIEDest 9", () => {
    const cliente: SnapshotClienteInput = {
      nome: "Maria Consumidora",
      documento: "123.456.789-09",
      kind: "PF",
      telefone: "",
      email: "",
      municipio: "São Paulo",
    }
    const xml = buildNfceXml(snap({ cliente }))
    expect(xml).toContain("<dest>")
    expect(xml).toContain("<CPF>12345678909</CPF>")
    expect(xml).toContain("<indIEDest>9</indIEDest>")
  })
})

describe("buildNfceXml · determinismo e imutabilidade", () => {
  it("mesmo snapshot → XML idêntico", () => {
    const s = snap()
    expect(buildNfceXml(s)).toBe(buildNfceXml(s))
  })

  it("não muta o snapshot", () => {
    const s = snap()
    const copia = JSON.parse(JSON.stringify(s))
    buildNfceXml(s)
    expect(JSON.parse(JSON.stringify(s))).toEqual(copia)
  })
})

describe("buildNfceXml · snapshot inválido / campos obrigatórios", () => {
  it("emitente sem CNPJ → lança NfceXmlError(emitente_invalido)", () => {
    const s = snap()
    const ruim = { ...s, emitente: { ...s.emitente, cnpj: "" } } as VendaFiscalSnapshot
    expect(() => buildNfceXml(ruim)).toThrow(NfceXmlError)
    expect(validateNfceSnapshot(ruim).ok).toBe(false)
  })

  it("item sem NCM → erro item_sem_ncm e builder bloqueia", () => {
    const s = snap({ itens: [item({ fiscal: { ...PRODUTO_FISCAL_VAZIO } })] })
    const v = validateNfceSnapshot(s)
    expect(v.ok).toBe(false)
    expect(v.erros.some((e) => e.code === "item_sem_ncm")).toBe(true)
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
  })

  it("snapshot vazio → lança NfceXmlError", () => {
    expect(() => buildNfceXml({} as VendaFiscalSnapshot)).toThrow(NfceXmlError)
  })
})

describe("buildNfceXmlResult · compatibilidade com o snapshot atual + numeração por contexto", () => {
  it("sem contexto → chave 44 dígitos e numeração placeholder", () => {
    const r = buildNfceXmlResult(snap())
    expect(r.chaveAcesso).toHaveLength(44)
    expect(r.validacao.ok).toBe(true)
    expect(r.numeracaoPlaceholder).toBe(true)
    expect(r.numero).toBe(0)
    expect(r.validacao.pendencias.some((p) => p.includes("Numeração"))).toBe(true)
  })

  it("com contexto série/número → reflete no XML e deixa de ser placeholder", () => {
    const r = buildNfceXmlResult(snap(), { serie: 1, numero: 55 })
    expect(r.numeracaoPlaceholder).toBe(false)
    expect(r.numero).toBe(55)
    expect(r.xml).toContain("<serie>1</serie>")
    expect(r.xml).toContain("<nNF>55</nNF>")
    expect(r.chaveAcesso).toHaveLength(44)
  })

  it("tpEmis=9 + dhCont/xJust emite o grupo de contingência sem alterar nNF/série/cNF", () => {
    const r = buildNfceXmlResult(snap(), {
      serie: 1,
      numero: 55,
      cNF: "00000007",
      tpEmis: 9,
      dhCont: "2026-08-16T15:00:00-03:00",
      xJust: "Falha de conectividade com a SEFAZ",
    })
    expect(r.xml).toContain("<tpEmis>9</tpEmis>")
    expect(r.xml).toContain("<dhCont>2026-08-16T15:00:00-03:00</dhCont>")
    expect(r.xml).toContain("<xJust>Falha de conectividade com a SEFAZ</xJust>")
    expect(r.xml).toContain("<nNF>55</nNF>")
    expect(r.xml).toContain("<serie>1</serie>")
    expect(r.xml).toContain("<cNF>00000007</cNF>")
    expect(r.chaveAcesso[34]).toBe("9")
    expect(r.xml).toContain(`Id="NFe${r.chaveAcesso}"`)
  })

  it("tpEmis=1 omite dhCont/xJust mesmo se o contexto os trouxer", () => {
    const xml = buildNfceXml(snap(), {
      serie: 1,
      numero: 55,
      tpEmis: 1,
      dhCont: "2026-08-16T15:00:00-03:00",
      xJust: "Falha de conectividade com a SEFAZ",
    })
    expect(xml).toContain("<tpEmis>1</tpEmis>")
    expect(xml).not.toContain("<dhCont>")
    expect(xml).not.toContain("<xJust>")
  })
})

describe("buildNfceXml · CSOSN 500 (ST substituído) → grupo ICMSSN500 (GOAL-006)", () => {
  it("item com CSOSN 500 na tributação congelada emite ICMSSN500, não ICMSSN102", () => {
    // O mapeamento venda→snapshot ainda não transporta a ST (GOAL de fiação end-to-end); aqui
    // forçamos a tributação congelada para CSOSN 500 para exercitar o ramo do builder.
    const clone = JSON.parse(JSON.stringify(snap())) as VendaFiscalSnapshot
    clone.tributacao!.itens[0].csosn = "500"
    clone.tributacao!.itens[0].icms.codigo = "500"
    clone.tributacao!.itens[0].icms.situacao = "st"
    const xml = buildNfceXml(clone)
    expect(xml).toContain("<ICMSSN500>")
    expect(xml).toContain("<CSOSN>500</CSOSN>")
    expect(xml).not.toContain("<ICMSSN102>")
    // ICMS próprio segue não destacado no substituído
    expect(xml).toContain("<vICMS>0.00</vICMS>")
  })
})
