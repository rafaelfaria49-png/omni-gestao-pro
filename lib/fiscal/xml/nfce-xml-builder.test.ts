/**
 * BL-FISCAL-004 — Gerador de XML NFC-e 4.00 (PURO, dormente).
 *
 * Cobre: venda simples, desconto, múltiplos itens, consumidor sem/com CPF, XML determinístico,
 * imutabilidade do snapshot, snapshot inválido, campos obrigatórios e compatibilidade com o
 * snapshot atual (`buildVendaFiscalSnapshot`). Os impostos vêm de `snapshot.tributacao`
 * (Simples Nacional CSOSN 102 → ICMSSN102 + PIS/COFINS CST 49). Nunca recalcula tributo.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, it, expect } from "vitest"
import { encodeNfceQrV3OfflineUrl, encodeNfceQrV3OnlineUrl, createQrV3OfflinePemSigner } from "@/lib/fiscal/danfce/qr-v3"
import { sanitizeProdutoFiscal, PRODUTO_FISCAL_VAZIO } from "@/lib/produto-fiscal"
import { TEST_KEY_PLAIN_PEM } from "../signing/__fixtures__/test-cert"
import { formatDhEmi } from "./nfce-chave-acesso"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotClienteInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { buildNfceXml, buildNfceXmlResult } from "./nfce-xml-builder"
import { NFCE_VER_PROC, NfceXmlError } from "./nfce-xml.types"
import { validateNfceSnapshot } from "./nfce-xml-validation"

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
      paymentBreakdown: { dinheiro: 50 },
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
    const xml = buildNfceXml(
      snap({ venda: { ...baseInput().venda, total: 40, desconto: 10, paymentBreakdown: { dinheiro: 40 } } }),
    )
    expect(xml).toContain("<vDesc>10.00</vDesc>")
    expect(xml).toContain("<vNF>40.00</vNF>")
    expect(xml).toContain("<vProd>50.00</vProd>")
  })
})

describe("buildNfceXml · múltiplos itens", () => {
  it("gera um det por item com nItem sequencial e soma vProd", () => {
    const xml = buildNfceXml(
      snap({
        venda: { ...baseInput().venda, total: 400, paymentBreakdown: { dinheiro: 400 } },
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

describe("buildNfceXml · pagamento fiscal canônico (GOAL 030)", () => {
  it("dinheiro válido → tPag 01 e vPag do contrato", () => {
    const xml = buildNfceXml(snap({ venda: { ...baseInput().venda, paymentBreakdown: { dinheiro: 50 } } }))
    expect(xml).toMatch(/<detPag>\s*<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<\/detPag>/)
    expect(xml).not.toContain("<card>")
    expect(xml).not.toContain("<vTroco>")
  })

  it("PIX legado sem evidência → bloqueia, nunca cai para dinheiro", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { pix: 50 } } })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_PIX_LEGADO_SEM_EVIDENCIA")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_pix_legado_sem_evidencia" })
      expect(String(e)).not.toMatch(/tPag>01|tPag>99/)
    }
  })

  it("débito legado sem handoff bloqueia XML — não omite card", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { cartaoDebito: 50 } } })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_cartao_legado_sem_evidencia" })
      expect(String(e)).not.toMatch(/tPag>01|tPag>99/)
    }
  })

  it("crédito legado sem handoff bloqueia XML — não omite card", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { cartaoCredito: 50 } } })
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
  })

  it("split legado dinheiro+débito+crédito sem handoff bloqueia o conjunto", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { dinheiro: 10, pix: 0, cartaoDebito: 15, cartaoCredito: 25 },
      },
    })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_CARTAO_LEGADO_SEM_EVIDENCIA")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
  })

  it("forma desconhecida → erro explícito, XML não é gerado, não vira tPag=99 nem 01", () => {
    const act = () => snap({ venda: { ...baseInput().venda, paymentBreakdown: { cripto: 50 } } })
    const s = act()
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_FORMA_DESCONHECIDA")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_forma_desconhecida" })
    }
  })

  it("breakdown ausente → não cai para dinheiro", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: null } })
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_ausente" })
      expect(String(e)).not.toMatch(/tPag>01/)
    }
  })

  it("soma abaixo do total → erro, sem correção para dinheiro", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { dinheiro: 10 } } })
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_soma_divergente" })
    }
  })

  it("soma acima do total → erro", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { dinheiro: 90 } } })
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_soma_divergente" })
    }
  })

  it("valor inválido → erro", () => {
    const s = snap({ venda: { ...baseInput().venda, paymentBreakdown: { dinheiro: Number.NaN } } })
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_valor_invalido" })
    }
  })

  it("snapshot legado sem contrato canônico: não reconstrói de paymentBreakdown nem cai para dinheiro", () => {
    const s = snap()
    const legado = {
      ...s,
      venda: { pedidoId: s.venda.pedidoId, data: s.venda.data, total: s.venda.total, desconto: s.venda.desconto, operador: s.venda.operador, terminal: s.venda.terminal, paymentBreakdown: { dinheiro: 50 } },
    } as VendaFiscalSnapshot
    expect(legado.venda.pagamentoFiscal).toBeUndefined()
    expect(() => buildNfceXml(legado)).toThrow(NfceXmlError)
    try {
      buildNfceXml(legado)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_canonico_ausente" })
    }
  })

  it("XML nunca consulta paymentBreakdown (contrato canônico é a única fonte)", () => {
    const s = snap()
    const trap = {
      ...s,
      venda: {
        ...s.venda,
        paymentBreakdown: { dinheiro: 50 },
        pagamentoFiscal: {
          ...s.venda.pagamentoFiscal!,
          fonte: "venda.payload.fiscalPaymentHandoff",
          det: [{ formaInterna: "pix" as const, tPag: "17", vPag: 50, tpIntegra: "2" }],
          soma: 50,
        },
      },
    } as VendaFiscalSnapshot
    const xml = buildNfceXml(trap)
    expect(xml).toMatch(/<tPag>17<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>01<\/tPag>/)
  })

  it("contrato congelado fonte paymentBreakdown + PIX17 bloqueia XML e não reescreve o JSON", () => {
    const s = snap()
    const frozen = {
      ...s,
      venda: {
        ...s.venda,
        pagamentoFiscal: {
          versao: 1 as const,
          fonte: "venda.payload.paymentBreakdown" as const,
          catalogoTPag: "IT-2024.002-v1.11" as const,
          det: [{ formaInterna: "pix" as const, tPag: "17", vPag: 50 }],
          soma: 50,
          vTroco: null,
        },
        pagamentoFiscalErro: null,
      },
    } as VendaFiscalSnapshot
    expect(frozen.venda.pagamentoFiscal?.fonte).toBe("venda.payload.paymentBreakdown")
    expect(frozen.venda.pagamentoFiscal?.det).toEqual([{ formaInterna: "pix", tPag: "17", vPag: 50 }])
    expect(() => buildNfceXml(frozen)).toThrow(NfceXmlError)
    try {
      buildNfceXml(frozen)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_pix_legado_sem_evidencia" })
      expect(String(e)).not.toMatch(/tPag>01|tPag>99/)
    }
    expect(frozen.venda.pagamentoFiscal?.det[0]?.tPag).toBe("17")
  })
})

describe("nfce-xml-builder · fronteira fail-closed (fonte)", () => {
  it("não contém fallback tPag=01, MAP_TPAG, parse heurístico nem imports vivos", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/fiscal/xml/nfce-xml-builder.ts"), "utf8")
    expect(src).not.toContain("MAP_TPAG")
    expect(src).not.toContain("parsePagamentos")
    expect(src).not.toContain("tPagDe")
    expect(src).not.toMatch(/tPag:\s*"01"/)
    expect(src).not.toMatch(/from ["']@\/lib\/prisma/)
    expect(src).not.toMatch(/from ["']@\/lib\/caixa/)
    expect(src).not.toMatch(/from ["']@\/lib\/financeiro/)
    expect(src).not.toContain("snapshot.venda.paymentBreakdown")
  })
})

describe("buildNfceXml · handoff de origem (GOAL 075)", () => {
  it("snapshot com handoff de dinheiro emite tPag 01 e não consulta breakdown", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" }],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>17<\/tPag>/)
    expect(s.venda.pagamentoFiscal?.fonte).toBe("venda.payload.fiscalPaymentHandoff")
  })

  it("handoff de PIX bloqueia emissão e não cai para tPag=01", () => {
    const act = () =>
      snap({
        venda: {
          ...baseInput().venda,
          paymentBreakdown: { pix: 50 },
          fiscalPaymentHandoff: {
            version: 1,
            catalogoTPag: "IT-2024.002-v1.11",
            linhas: [{ formaOrigem: "pix", valor: 50, capability: "blocked", status: "blocked", motivo: "pix_subtipo_nao_discriminado" }],
          },
        },
      })
    const s = act()
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_forma_sem_capacidade" })
    }
  })

  it("handoff inconsistente não reconstrói do breakdown", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { dinheiro: 50 },
        fiscalPaymentHandoff: { version: 99, linhas: [] },
      },
    })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
  })

  it("handoff de PIX estático emite tPag 20 e nunca cai para 01/99", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "pix",
              valor: 50,
              pixQrKind: "estatico",
              tPag: "20",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<detPag>\s*<tPag>20<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<\/detPag>/)
    expect(xml).not.toMatch(/<tPag>01<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>17<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>99<\/tPag>/)
    expect(xml).not.toContain("<card>")
  })

  it("handoff de PIX dinâmico emite tPag 17 + card/tpIntegra=2", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "pix",
              valor: 50,
              pixQrKind: "dinamico",
              tPag: "17",
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(
      /<detPag>\s*<tPag>17<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>\s*<\/detPag>/,
    )
    expect(xml).not.toContain("<tBand>")
    expect(xml).not.toContain("<cAut>")
    expect(xml).not.toContain("<CNPJReceb>")
    expect(xml).not.toContain("<tpIntegra>1</tpIntegra>")
  })

  it("handoff histórico tPag 17 sem tpIntegra não gera XML sem card", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "pix",
              valor: 50,
              pixQrKind: "dinamico",
              tPag: "17",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_PIX_TPINTEGRA_AUSENTE")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_pix_tpintegra_ausente" })
    }
  })

  it("handoff de PIX automático emite tPag 23", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "pix",
              valor: 50,
              pixQrKind: "automatico",
              tPag: "23",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    expect(buildNfceXml(s)).toMatch(/<tPag>23<\/tPag>/)
    expect(buildNfceXml(s)).not.toContain("<card>")
  })

  it("split PIX + dinheiro no XML não cai para um único tPag=01", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 30, dinheiro: 20 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            { formaOrigem: "dinheiro", valor: 20, tPag: "01", capability: "supported", status: "ok" },
            {
              formaOrigem: "pix",
              valor: 30,
              pixQrKind: "estatico",
              tPag: "20",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>\s*<vPag>20\.00<\/vPag>/)
    expect(xml).toMatch(/<tPag>20<\/tPag>\s*<vPag>30\.00<\/vPag>/)
  })

  it("split PIX dinâmico + dinheiro: 17 com card; 01 sem card", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 30, dinheiro: 20 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            { formaOrigem: "dinheiro", valor: 20, tPag: "01", capability: "supported", status: "ok" },
            {
              formaOrigem: "pix",
              valor: 30,
              pixQrKind: "dinamico",
              tPag: "17",
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>\s*<vPag>20\.00<\/vPag>\s*<\/detPag>/)
    expect(xml).toMatch(
      /<tPag>17<\/tPag>\s*<vPag>30\.00<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/,
    )
  })

  it("handoff de creditoVale emite tPag 21 sem card e sem fallback 01/12/19/99", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { creditoVale: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "creditoVale", valor: 50, tPag: "21", capability: "supported", status: "ok" }],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<detPag>\s*<tPag>21<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<\/detPag>/)
    expect(xml).not.toMatch(/<tPag>01<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>12<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>19<\/tPag>/)
    expect(xml).not.toMatch(/<tPag>99<\/tPag>/)
    expect(xml).not.toContain("<card>")
  })

  it("split creditoVale + dinheiro no XML", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { dinheiro: 20, creditoVale: 30 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            { formaOrigem: "creditoVale", valor: 30, tPag: "21", capability: "supported", status: "ok" },
            { formaOrigem: "dinheiro", valor: 20, tPag: "01", capability: "supported", status: "ok" },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>\s*<vPag>20\.00<\/vPag>/)
    expect(xml).toMatch(/<tPag>21<\/tPag>\s*<vPag>30\.00<\/vPag>/)
    expect(xml).not.toContain("<vTroco>")
  })

  it("dinheiro exato com cashTendered não emite vTroco", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { dinheiro: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" }],
          cashTendered: 50,
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<detPag>\s*<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<\/detPag>/)
    expect(xml).not.toContain("<vTroco>")
    expect(s.venda.pagamentoFiscal?.vTroco).toBeNull()
  })

  it("dinheiro acima do total emite vPag entregue e vTroco (Σ − vTroco = vNF)", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { dinheiro: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "dinheiro", valor: 50, tPag: "01", capability: "supported", status: "ok" }],
          cashTendered: 70,
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>\s*<vPag>70\.00<\/vPag>/)
    expect(xml).toMatch(/<vTroco>20\.00<\/vTroco>/)
    expect(s.venda.pagamentoFiscal?.soma).toBe(70)
    expect(s.venda.pagamentoFiscal?.vTroco).toBe(20)
  })

  it("split PIX + dinheiro com troco: vPag do dinheiro é o entregue", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { pix: 20, dinheiro: 30 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            { formaOrigem: "dinheiro", valor: 30, tPag: "01", capability: "supported", status: "ok" },
            {
              formaOrigem: "pix",
              valor: 20,
              pixQrKind: "estatico",
              tPag: "20",
              capability: "supported",
              status: "ok",
            },
          ],
          cashTendered: 40,
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(/<tPag>01<\/tPag>\s*<vPag>40\.00<\/vPag>/)
    expect(xml).toMatch(/<tPag>20<\/tPag>\s*<vPag>20\.00<\/vPag>/)
    expect(xml).toMatch(/<vTroco>10\.00<\/vTroco>/)
    expect(s.venda.pagamentoFiscal?.soma).toBe(60)
    expect(s.venda.pagamentoFiscal?.vTroco).toBe(10)
  })

  it("handoff legado de creditoVale bloqueado não emite XML", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { creditoVale: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "creditoVale",
              valor: 50,
              capability: "blocked",
              status: "blocked",
              motivo: "credito_vale_tpag_ambiguo",
            },
          ],
        },
      },
    })
    expect(s.venda.pagamentoFiscal).toBeNull()
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_FORMA_SEM_CAPACIDADE_FISCAL")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
  })

  it("crédito novo emite card/tpIntegra=2 e nenhum outro filho YA04", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { cartaoCredito: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "cartaoCredito",
              valor: 50,
              tPag: "03",
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(
      /<detPag>\s*<tPag>03<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>\s*<\/detPag>/,
    )
    expect(xml).not.toContain("<tBand>")
    expect(xml).not.toContain("<cAut>")
    expect(xml).not.toMatch(/<card>[\s\S]*<CNPJ>/)
    expect(xml).not.toContain("<CNPJReceb>")
    expect(xml).not.toContain("<idTermPag>")
    expect(xml).not.toContain("<tpIntegra>1</tpIntegra>")
  })

  it("débito novo emite tPag 04 + card/tpIntegra=2", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { cartaoDebito: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [
            {
              formaOrigem: "cartaoDebito",
              valor: 50,
              tPag: "04",
              tpIntegra: "2",
              capability: "supported",
              status: "ok",
            },
          ],
        },
      },
    })
    const xml = buildNfceXml(s)
    expect(xml).toMatch(
      /<detPag>\s*<tPag>04<\/tPag>\s*<vPag>50\.00<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>\s*<\/detPag>/,
    )
  })

  it("splits: cada 03/04 tem o próprio card; PIX 17 também tem YA04 próprio; 20 sem card", () => {
    const cases: Array<{
      name: string
      breakdown: Record<string, number>
      linhas: Array<Record<string, unknown>>
      cashTendered?: number
      expectTPag: string[]
      expectTroco?: string
    }> = [
      {
        name: "crédito + dinheiro",
        breakdown: { cartaoCredito: 40, dinheiro: 10 },
        linhas: [
          { formaOrigem: "cartaoCredito", valor: 40, tPag: "03", tpIntegra: "2", capability: "supported", status: "ok" },
          { formaOrigem: "dinheiro", valor: 10, tPag: "01", capability: "supported", status: "ok" },
        ],
        expectTPag: ["01", "03"],
      },
      {
        name: "débito + dinheiro",
        breakdown: { cartaoDebito: 40, dinheiro: 10 },
        linhas: [
          { formaOrigem: "cartaoDebito", valor: 40, tPag: "04", tpIntegra: "2", capability: "supported", status: "ok" },
          { formaOrigem: "dinheiro", valor: 10, tPag: "01", capability: "supported", status: "ok" },
        ],
        expectTPag: ["01", "04"],
      },
      {
        name: "crédito + PIX",
        breakdown: { cartaoCredito: 30, pix: 20 },
        linhas: [
          { formaOrigem: "cartaoCredito", valor: 30, tPag: "03", tpIntegra: "2", capability: "supported", status: "ok" },
          {
            formaOrigem: "pix",
            valor: 20,
            pixQrKind: "dinamico",
            tPag: "17",
            tpIntegra: "2",
            capability: "supported",
            status: "ok",
          },
        ],
        expectTPag: ["03", "17"],
      },
      {
        name: "débito + PIX",
        breakdown: { cartaoDebito: 30, pix: 20 },
        linhas: [
          { formaOrigem: "cartaoDebito", valor: 30, tPag: "04", tpIntegra: "2", capability: "supported", status: "ok" },
          {
            formaOrigem: "pix",
            valor: 20,
            pixQrKind: "estatico",
            tPag: "20",
            capability: "supported",
            status: "ok",
          },
        ],
        expectTPag: ["04", "20"],
      },
      {
        name: "crédito + débito",
        breakdown: { cartaoCredito: 20, cartaoDebito: 30 },
        linhas: [
          { formaOrigem: "cartaoCredito", valor: 20, tPag: "03", tpIntegra: "2", capability: "supported", status: "ok" },
          { formaOrigem: "cartaoDebito", valor: 30, tPag: "04", tpIntegra: "2", capability: "supported", status: "ok" },
        ],
        expectTPag: ["03", "04"],
      },
      {
        name: "cartão + dinheiro com vTroco",
        breakdown: { cartaoCredito: 30, dinheiro: 20 },
        linhas: [
          { formaOrigem: "cartaoCredito", valor: 30, tPag: "03", tpIntegra: "2", capability: "supported", status: "ok" },
          { formaOrigem: "dinheiro", valor: 20, tPag: "01", capability: "supported", status: "ok" },
        ],
        cashTendered: 30,
        expectTPag: ["01", "03"],
        expectTroco: "10.00",
      },
    ]
    for (const c of cases) {
      const s = snap({
        venda: {
          ...baseInput().venda,
          paymentBreakdown: c.breakdown,
          fiscalPaymentHandoff: {
            version: 1,
            catalogoTPag: "IT-2024.002-v1.11",
            linhas: c.linhas,
            ...(c.cashTendered != null ? { cashTendered: c.cashTendered } : {}),
          },
        },
      })
      const xml = buildNfceXml(s)
      for (const tPag of c.expectTPag) {
        expect(xml, c.name).toMatch(new RegExp(`<tPag>${tPag}</tPag>`))
      }
      const card03 = xml.match(/<tPag>03<\/tPag>\s*<vPag>[^<]+<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/)
      const card04 = xml.match(/<tPag>04<\/tPag>\s*<vPag>[^<]+<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/)
      if (c.expectTPag.includes("03")) expect(card03, c.name).toBeTruthy()
      if (c.expectTPag.includes("04")) expect(card04, c.name).toBeTruthy()
      if (c.expectTPag.includes("17")) {
        expect(xml, c.name).toMatch(
          /<tPag>17<\/tPag>\s*<vPag>[^<]+<\/vPag>\s*<card>\s*<tpIntegra>2<\/tpIntegra>\s*<\/card>/,
        )
      }
      if (c.expectTPag.includes("20")) {
        expect(xml, c.name).toMatch(/<tPag>20<\/tPag>\s*<vPag>[^<]+<\/vPag>\s*<\/detPag>/)
        expect(xml, c.name).not.toMatch(/<tPag>20<\/tPag>[\s\S]*?<card>/)
      }
      if (c.expectTroco) expect(xml, c.name).toContain(`<vTroco>${c.expectTroco}</vTroco>`)
      expect(xml, c.name).not.toContain("<tBand>")
      expect(xml, c.name).not.toContain("<cAut>")
    }
  })

  it("handoff 03 sem tpIntegra não gera XML sem card", () => {
    const s = snap({
      venda: {
        ...baseInput().venda,
        paymentBreakdown: { cartaoCredito: 50 },
        fiscalPaymentHandoff: {
          version: 1,
          catalogoTPag: "IT-2024.002-v1.11",
          linhas: [{ formaOrigem: "cartaoCredito", valor: 50, tPag: "03", capability: "supported", status: "ok" }],
        },
      },
    })
    expect(s.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_CARTAO_TPINTEGRA_AUSENTE")
    expect(() => buildNfceXml(s)).toThrow(NfceXmlError)
    try {
      buildNfceXml(s)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_cartao_tpintegra_ausente" })
    }
  })

  it("contrato congelado 03/04 sem tpIntegra não reconstruí card e não emite", () => {
    const s = snap()
    const frozen = {
      ...s,
      venda: {
        ...s.venda,
        pagamentoFiscal: {
          versao: 1 as const,
          fonte: "venda.payload.fiscalPaymentHandoff" as const,
          catalogoTPag: "IT-2024.002-v1.11" as const,
          det: [{ formaInterna: "cartaoCredito" as const, tPag: "03", vPag: 50 }],
          soma: 50,
          vTroco: null,
        },
        pagamentoFiscalErro: null,
      },
    } as VendaFiscalSnapshot
    expect(() => buildNfceXml(frozen)).toThrow(NfceXmlError)
    try {
      buildNfceXml(frozen)
    } catch (e) {
      expect(e).toMatchObject({ code: "pagamento_cartao_tpintegra_ausente" })
    }
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

const QR_ONLINE_V3 = {
  qrCodeBaseUrl: "https://qr.example.test/nfce",
  urlChave: "https://qr.example.test/consulta",
} as const

const LEIAUTE_XSD = resolve(
  process.cwd(),
  "lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/leiauteNFe_v4.00.xsd",
)
const TIPOS_XSD = resolve(
  process.cwd(),
  "lib/fiscal/xsd/schemas/PL_010e_v1.02/NFe/tiposBasico_v4.00.xsd",
)

function nfeChildOpenings(xml: string): string[] {
  return [...xml.matchAll(/<(infNFeSupl|infNFe|Signature)(?:\s|>)/g)].map((m) => m[1] ?? "")
}

function extractXsdPattern(source: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = source.match(new RegExp(`<!--${escaped}-->\\s*<xs:pattern value="([^"]+)"`))
  if (!match?.[1]) throw new Error(`pattern XSD ausente: ${marker}`)
  return match[1]
}

const XMLLINT_SCHEMA_ARGS = ["--noout", "--nonet", "--schema"] as const

function localFileSchemaLocation(filePath: string): string {
  return pathToFileURL(filePath).href
}

function infNfeSuplElementDef(leiauteSource: string): string {
  const start = leiauteSource.indexOf('<xs:element name="infNFeSupl" minOccurs="0">')
  const end = leiauteSource.indexOf('<xs:element ref="ds:Signature"/>')
  if (start < 0 || end <= start) throw new Error("recorte infNFeSupl ausente no XSD oficial")
  return leiauteSource.slice(start, end).replace(' minOccurs="0"', "")
}

function writeTempInfNfeSuplSchema(
  dir: string,
  elementDef: string,
  schemaLocation = localFileSchemaLocation(TIPOS_XSD),
): string {
  const xsdPath = join(dir, "infnfesupl.xsd")
  writeFileSync(
    xsdPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns="http://www.portalfiscal.inf.br/nfe" xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://www.portalfiscal.inf.br/nfe" elementFormDefault="qualified" attributeFormDefault="unqualified">
  <xs:include schemaLocation="${schemaLocation}"/>
  ${elementDef}
</xs:schema>`,
  )
  return xsdPath
}

function writeInfNfeSuplInstance(dir: string, name: string, innerXml: string): string {
  const xmlPath = join(dir, name)
  writeFileSync(
    xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<infNFeSupl xmlns="http://www.portalfiscal.inf.br/nfe">${innerXml}</infNFeSupl>\n`,
  )
  return xmlPath
}

type XmllintSchemaResult =
  | { kind: "ok"; stdout: string }
  | { kind: "missing"; bin: string }
  | { kind: "failed"; status: number | null; stdout: string; stderr: string }

function runXmllintSchema(xsdPath: string, xmlPath: string, bin = "xmllint"): XmllintSchemaResult {
  try {
    const stdout = execFileSync(bin, [...XMLLINT_SCHEMA_ARGS, xsdPath, xmlPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { kind: "ok", stdout }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number | null; stdout?: string; stderr?: string }
    if (err.code === "ENOENT") return { kind: "missing", bin }
    return {
      kind: "failed",
      status: typeof err.status === "number" ? err.status : null,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
    }
  }
}

function requireXmllintResult(result: XmllintSchemaResult): Exclude<XmllintSchemaResult, { kind: "missing" }> {
  if (result.kind === "missing") {
    throw new Error(
      `xmllint ausente no PATH (${result.bin}). No Ubuntu instale o pacote oficial libxml2-utils; a validação XSD B2 não pode ser pulada.`,
    )
  }
  return result
}

function assertXmllintAccepts(xsdPath: string, xmlPath: string): void {
  const result = requireXmllintResult(runXmllintSchema(xsdPath, xmlPath))
  expect(result.kind, result.kind === "failed" ? result.stderr : "").toBe("ok")
}

function assertXmllintRejects(xsdPath: string, xmlPath: string): void {
  const result = requireXmllintResult(runXmllintSchema(xsdPath, xmlPath))
  expect(result.kind, "xmllint deve reprovar o artefato sem skip").toBe("failed")
  if (result.kind !== "failed") return
  expect(result.status, "reprovação XSD exige exit code não-zero do xmllint").not.toBe(0)
  expect(result.status).not.toBeNull()
}

function assertInfNfeSuplXmllint(opts: {
  nfeXml: string
  infNFeSupl: { qrCode: string } | undefined
  leiaute: string
}): void {
  const supl = opts.nfeXml.match(/<infNFeSupl>[\s\S]*?<\/infNFeSupl>/)?.[0]
  expect(supl).toBeTruthy()
  const dir = mkdtempSync(join(tmpdir(), "nfce-infnfesupl-"))
  try {
    const xsdPath = writeTempInfNfeSuplSchema(dir, infNfeSuplElementDef(opts.leiaute))
    const xmlPath = join(dir, "infnfesupl.xml")
    writeFileSync(
      xmlPath,
      `<?xml version="1.0" encoding="UTF-8"?>\n${supl!.replace("<infNFeSupl>", '<infNFeSupl xmlns="http://www.portalfiscal.inf.br/nfe">')}\n`,
    )
    assertXmllintAccepts(xsdPath, xmlPath)

    const invalidPath = writeInfNfeSuplInstance(
      dir,
      "infnfesupl-sem-url.xml",
      opts.infNFeSupl ? `<qrCode>${opts.infNFeSupl.qrCode}</qrCode>` : "",
    )
    assertXmllintRejects(xsdPath, invalidPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("buildNfceXml · QR v3 online opt-in (infNFeSupl)", () => {
  const leiaute = readFileSync(LEIAUTE_XSD, "utf8")
  const tipos = readFileSync(TIPOS_XSD, "utf8")
  const xsdV3Online = new RegExp(`^${extractXsdPattern(leiaute, "QRCODE V3 ONLINE")}$`)
  const ctx = { serie: 1, numero: 42, qrOnlineV3: { ...QR_ONLINE_V3 } }

  it("sem qrOnlineV3 o XML permanece byte a byte igual ao caminho legado", () => {
    const s = snap()
    expect(buildNfceXml(s)).toBe(buildNfceXml(s, {}))
    expect(buildNfceXml(s, { serie: 1, numero: 42 })).toBe(
      buildNfceXml(s, { serie: 1, numero: 42, qrOnlineV3: undefined }),
    )
    expect(buildNfceXml(s)).not.toContain("<infNFeSupl>")
    expect(buildNfceXml(s)).not.toContain("<qrCode>")
    expect(buildNfceXml(s)).not.toContain("<urlChave>")
    expect(buildNfceXmlResult(s).infNFeSupl).toBeUndefined()
  })

  it("com configuração online válida emite infNFeSupl após infNFe e antes de qualquer Signature", () => {
    const r = buildNfceXmlResult(snap(), ctx)
    const inf = r.xml.match(/<infNFe[\s\S]*?<\/infNFe>/)?.[0] ?? ""
    expect(inf).toContain("<infNFe")
    expect(inf).not.toContain("infNFeSupl")
    expect(r.xml).not.toContain("<Signature")
    expect(nfeChildOpenings(r.xml)).toEqual(["infNFe", "infNFeSupl"])
    expect(r.xml).toMatch(
      /<infNFeSupl>\s*<qrCode>[^<]+<\/qrCode>\s*<urlChave>[^<]+<\/urlChave>\s*<\/infNFeSupl>/,
    )
    expect(r.infNFeSupl?.urlChave).toBe(QR_ONLINE_V3.urlChave)
  })

  it("deriva chave/tpAmb do XML canônico (homologação) e casa o pattern XSD v3 online", () => {
    const r = buildNfceXmlResult(snap(), ctx)
    expect(r.xml).toContain("<tpAmb>2</tpAmb>")
    const encoded = encodeNfceQrV3OnlineUrl({
      chave: r.chaveAcesso,
      tpAmb: 2,
      baseUrl: QR_ONLINE_V3.qrCodeBaseUrl,
    })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(r.infNFeSupl?.qrCode).toBe(encoded.url)
    expect(r.infNFeSupl?.qrCode).toBe(`${QR_ONLINE_V3.qrCodeBaseUrl}?p=${r.chaveAcesso}|3|2`)
    expect(r.infNFeSupl?.qrCode).toMatch(xsdV3Online)
    expect(r.xml).toContain(`<qrCode>${encoded.url}</qrCode>`)
    expect(r.xml).toContain(`<urlChave>${QR_ONLINE_V3.urlChave}</urlChave>`)
  })

  it("deriva tpAmb=1 em produção sem aceitar tpAmb paralelo", () => {
    const r = buildNfceXmlResult(snap({ loja: { ...LOJA_OK, ambiente: "PRODUCAO" } }), ctx)
    expect(r.xml).toContain("<tpAmb>1</tpAmb>")
    expect(r.infNFeSupl?.qrCode).toBe(`${QR_ONLINE_V3.qrCodeBaseUrl}?p=${r.chaveAcesso}|3|1`)
    expect(r.infNFeSupl?.qrCode).toMatch(xsdV3Online)
    expect(() =>
      buildNfceXml(snap(), {
        ...ctx,
        qrOnlineV3: { ...QR_ONLINE_V3, chave: r.chaveAcesso, tpAmb: 1 } as typeof QR_ONLINE_V3 & {
          chave: string
          tpAmb: number
        },
      }),
    ).toThrow(NfceXmlError)
  })

  it("urlChave obedece TString 21–85 do XSD versionado; URL ausente/curta falha fechado", () => {
    expect(tipos).toContain('pattern value="[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}|[!-ÿ]{1}"')
    expect(leiaute).toMatch(/<xs:element name="urlChave">[\s\S]*?<xs:minLength value="21"\/>[\s\S]*?<xs:maxLength value="85"\/>/)
    expect(QR_ONLINE_V3.urlChave.length).toBeGreaterThanOrEqual(21)
    expect(QR_ONLINE_V3.urlChave.length).toBeLessThanOrEqual(85)

    const missingUrl = () =>
      buildNfceXml(snap(), { serie: 1, numero: 42, qrOnlineV3: { qrCodeBaseUrl: QR_ONLINE_V3.qrCodeBaseUrl, urlChave: "" } })
    const missingBase = () =>
      buildNfceXml(snap(), { serie: 1, numero: 42, qrOnlineV3: { qrCodeBaseUrl: "", urlChave: QR_ONLINE_V3.urlChave } })
    const shortChave = () =>
      buildNfceXml(snap(), {
        serie: 1,
        numero: 42,
        qrOnlineV3: { qrCodeBaseUrl: QR_ONLINE_V3.qrCodeBaseUrl, urlChave: "https://x.test" },
      })
    expect(missingUrl).toThrow(NfceXmlError)
    expect(missingBase).toThrow(NfceXmlError)
    expect(shortChave).toThrow(NfceXmlError)
    try {
      missingUrl()
    } catch (e) {
      expect(e).toMatchObject({ code: "qr_online_invalido", campo: "qrOnlineV3.urlChave" })
    }
  })

  it("recusa tpEmis=9 neste caminho e não torna o QR obrigatório no legado", () => {
    expect(() => buildNfceXml(snap(), { serie: 1, numero: 42, tpEmis: 9, qrOnlineV3: { ...QR_ONLINE_V3 } })).toThrow(
      NfceXmlError,
    )
    const legado = buildNfceXmlResult(snap(), { serie: 1, numero: 42, tpEmis: 9 })
    expect(legado.xml).not.toContain("<infNFeSupl>")
    expect(legado.chaveAcesso[34]).toBe("9")
  })

  it("não emite CSC/idCSC/token e não inventa host SEFAZ-SP", () => {
    const xml = buildNfceXml(snap(), ctx)
    expect(xml).not.toMatch(/csc|idcsc|cidtoken|chashqrcode|cIdToken/i)
    expect(xml).not.toMatch(/fazenda\.sp\.gov|nfce\.fazenda/i)
    expect(xml).toContain("https://qr.example.test/nfce?p=")
    expect(xml).toContain(`<urlChave>${QR_ONLINE_V3.urlChave}</urlChave>`)
  })

  it("o XSD oficial versionado declara infNFe → infNFeSupl (0–1) → Signature, sem CDATA obrigatório", () => {
    const tnfe = leiaute.slice(leiaute.indexOf('<xs:complexType name="TNFe">'), leiaute.indexOf('<xs:complexType name="TProtNFe">'))
    const inf = tnfe.indexOf('<xs:element name="infNFe">')
    const supl = tnfe.indexOf('<xs:element name="infNFeSupl" minOccurs="0">')
    const sig = tnfe.indexOf('<xs:element ref="ds:Signature"/>')
    expect(inf).toBeGreaterThanOrEqual(0)
    expect(supl).toBeGreaterThan(inf)
    expect(sig).toBeGreaterThan(supl)
    expect(leiaute).toContain("QRCODE V3 ONLINE")
    expect(leiaute).toContain('whiteSpace value="preserve"')
    const helper = readFileSync(resolve(process.cwd(), "lib/fiscal/xml/nfce-infnfesupl-online.ts"), "utf8")
    const writer = readFileSync(resolve(process.cwd(), "lib/fiscal/xml/xml-writer.ts"), "utf8")
    expect(helper).not.toMatch(/CDATA/)
    expect(writer).not.toMatch(/CDATA/)
  })

  it("xmllint --nonet valida infNFeSupl extraído contra o recorte oficial do XSD", () => {
    const r = buildNfceXmlResult(snap(), ctx)
    assertInfNfeSuplXmllint({ nfeXml: r.xml, infNFeSupl: r.infNFeSupl, leiaute })
  })
})

const QR_OFFLINE_SIGN = createQrV3OfflinePemSigner(TEST_KEY_PLAIN_PEM)
const QR_OFFLINE_V3 = {
  qrCodeBaseUrl: "https://qr.example.test/nfce",
  urlChave: "https://qr.example.test/consulta",
  sign: QR_OFFLINE_SIGN,
}

function payloadP(qrCode: string): string {
  const p = qrCode.split("?p=")[1]
  if (!p) throw new Error("qrCode sem ?p=")
  return p
}

describe("buildNfceXml · QR v3 offline opt-in (infNFeSupl, tpEmis=9)", () => {
  const leiaute = readFileSync(LEIAUTE_XSD, "utf8")
  const xsdV3Offline = new RegExp(`^${extractXsdPattern(leiaute, "QRCODE V3 OFFLINE")}$`)
  const ctxOff = { serie: 1, numero: 42, tpEmis: 9, qrOfflineV3: { ...QR_OFFLINE_V3 } }

  it("sem QR o XML legado (inclusive tpEmis=9 sem infNFeSupl) permanece byte a byte igual", () => {
    const s = snap()
    expect(buildNfceXml(s)).toBe(buildNfceXml(s, { qrOfflineV3: undefined }))
    const semQr = buildNfceXml(s, { serie: 1, numero: 42, tpEmis: 9 })
    expect(semQr).toBe(buildNfceXml(s, { serie: 1, numero: 42, tpEmis: 9, qrOfflineV3: undefined }))
    expect(semQr).not.toContain("<infNFeSupl>")
    expect(semQr).toContain("<tpEmis>9</tpEmis>")
  })

  it("o caminho online 021B permanece inalterado", () => {
    const s = snap()
    const online = buildNfceXmlResult(s, { serie: 1, numero: 42, qrOnlineV3: { ...QR_ONLINE_V3 } })
    expect(online.xml).toContain("|3|2")
    expect(online.xml).not.toContain("<tpEmis>9</tpEmis>")
    expect(online.infNFeSupl?.qrCode).toBe(`${QR_ONLINE_V3.qrCodeBaseUrl}?p=${online.chaveAcesso}|3|2`)
  })

  it("tpEmis=9 + qrOfflineV3 emite infNFeSupl após infNFe, sem Signature, qrCode v3 offline", () => {
    const r = buildNfceXmlResult(snap(), ctxOff)
    expect(r.chaveAcesso[34]).toBe("9")
    expect(r.xml).toContain("<tpEmis>9</tpEmis>")
    expect(r.xml).not.toContain("<Signature")
    expect(nfeChildOpenings(r.xml)).toEqual(["infNFe", "infNFeSupl"])
    const inf = r.xml.match(/<infNFe[\s\S]*?<\/infNFe>/)?.[0] ?? ""
    expect(inf).not.toContain("infNFeSupl")
    expect(r.infNFeSupl?.qrCode).toMatch(xsdV3Offline)
    expect(r.infNFeSupl?.urlChave).toBe(QR_OFFLINE_V3.urlChave)
    expect(r.xml).toMatch(/<infNFeSupl>\s*<qrCode>[^<]+<\/qrCode>\s*<urlChave>[^<]+<\/urlChave>\s*<\/infNFeSupl>/)
  })

  it("deriva chave/tpAmb/dia/vNF do infNFe; destinatário ausente vira || na concatenação 1–7", () => {
    const r = buildNfceXmlResult(snap(), ctxOff)
    const dhEmi = formatDhEmi("2026-06-18T12:00:00.000Z")
    const encoded = encodeNfceQrV3OfflineUrl({
      chave: r.chaveAcesso,
      tpAmb: 2,
      dhEmi,
      vNF: "50.00",
      destinatario: { kind: "ausente" },
      sign: QR_OFFLINE_SIGN,
      baseUrl: QR_OFFLINE_V3.qrCodeBaseUrl,
    })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(r.infNFeSupl?.qrCode).toBe(encoded.url)
    expect(payloadP(r.infNFeSupl!.qrCode).startsWith(`${r.chaveAcesso}|3|2|${dhEmi.slice(8, 10)}|50.00||`)).toBe(true)
    expect(r.xml).toContain(`<dhEmi>${dhEmi}</dhEmi>`)
    expect(r.xml).toContain("<vNF>50.00</vNF>")
    expect(r.xml).not.toContain("<dest>")
  })

  it("destinatário CPF/CNPJ do XML alimenta tpId/idDest; paralelo recusado", () => {
    const cpfCliente: SnapshotClienteInput = {
      nome: "Maria Consumidora",
      documento: "123.456.789-09",
      kind: "PF",
      telefone: "",
      email: "",
      municipio: "São Paulo",
    }
    const cnpjCliente: SnapshotClienteInput = {
      nome: "Empresa Dest LTDA",
      documento: "33.445.556/0001-77",
      kind: "PJ",
      telefone: "",
      email: "",
      municipio: "São Paulo",
    }
    const cpf = buildNfceXmlResult(snap({ cliente: cpfCliente }), ctxOff)
    const cnpj = buildNfceXmlResult(snap({ cliente: cnpjCliente }), ctxOff)
    expect(cpf.xml).toContain("<CPF>12345678909</CPF>")
    expect(cnpj.xml).toContain("<CNPJ>33445556000177</CNPJ>")
    expect(payloadP(cpf.infNFeSupl!.qrCode).includes("|2|12345678909|")).toBe(true)
    expect(payloadP(cnpj.infNFeSupl!.qrCode).includes("|1|33445556000177|")).toBe(true)
    expect(() =>
      buildNfceXml(snap(), {
        ...ctxOff,
        qrOfflineV3: { ...QR_OFFLINE_V3, dhEmi: "2026-06-18T09:00:00-03:00" } as typeof QR_OFFLINE_V3 & { dhEmi: string },
      }),
    ).toThrow(NfceXmlError)
  })

  it("fail-closed: online+offline juntos, tpEmis incompatível, URL ou assinatura ausente", () => {
    const s = snap()
    const both = () =>
      buildNfceXml(s, {
        serie: 1,
        numero: 42,
        tpEmis: 9,
        qrOnlineV3: { ...QR_ONLINE_V3 },
        qrOfflineV3: { ...QR_OFFLINE_V3 },
      })
    const onlineEm9 = () => buildNfceXml(s, { serie: 1, numero: 42, tpEmis: 9, qrOnlineV3: { ...QR_ONLINE_V3 } })
    const offlineEm1 = () => buildNfceXml(s, { serie: 1, numero: 42, tpEmis: 1, qrOfflineV3: { ...QR_OFFLINE_V3 } })
    const semAssinatura = () =>
      buildNfceXml(s, {
        serie: 1,
        numero: 42,
        tpEmis: 9,
        qrOfflineV3: { qrCodeBaseUrl: QR_OFFLINE_V3.qrCodeBaseUrl, urlChave: QR_OFFLINE_V3.urlChave },
      })
    const semUrl = () =>
      buildNfceXml(s, {
        serie: 1,
        numero: 42,
        tpEmis: 9,
        qrOfflineV3: { qrCodeBaseUrl: QR_OFFLINE_V3.qrCodeBaseUrl, urlChave: "", sign: QR_OFFLINE_SIGN },
      })
    expect(both).toThrow(NfceXmlError)
    expect(onlineEm9).toThrow(NfceXmlError)
    expect(offlineEm1).toThrow(NfceXmlError)
    expect(semAssinatura).toThrow(NfceXmlError)
    expect(semUrl).toThrow(NfceXmlError)
    try {
      both()
    } catch (e) {
      expect(e).toMatchObject({ code: "qr_modo_incompativel" })
    }
    try {
      offlineEm1()
    } catch (e) {
      expect(e).toMatchObject({ code: "qr_modo_incompativel", campo: "qrOfflineV3" })
    }
  })

  it("não emite CSC/idCSC/token e não inventa host SEFAZ-SP", () => {
    const xml = buildNfceXml(snap(), ctxOff)
    expect(xml).not.toMatch(/csc|idcsc|cidtoken|chashqrcode|cIdToken|DigestValue/i)
    expect(xml).not.toMatch(/fazenda\.sp\.gov|nfce\.fazenda/i)
    expect(xml).toContain("https://qr.example.test/nfce?p=")
  })

  it("xmllint --nonet valida infNFeSupl offline contra o recorte oficial", () => {
    const r = buildNfceXmlResult(snap(), ctxOff)
    assertInfNfeSuplXmllint({ nfeXml: r.xml, infNFeSupl: r.infNFeSupl, leiaute })
  })
})

describe("xmllint harness · regressão de infraestrutura (infNFeSupl)", () => {
  const leiaute = readFileSync(LEIAUTE_XSD, "utf8")

  it("schemaLocation local é URI file: cross-platform e --nonet permanece ativo", () => {
    const location = localFileSchemaLocation(TIPOS_XSD)
    expect(XMLLINT_SCHEMA_ARGS).toEqual(["--noout", "--nonet", "--schema"])
    expect(location.startsWith("file:")).toBe(true)
    expect(location).not.toContain("\\")
    expect(location).toContain("tiposBasico_v4.00.xsd")
  })

  it("recorte XSD inválido e schemaLocation quebrado continuam falhando", () => {
    const dir = mkdtempSync(join(tmpdir(), "nfce-infnfesupl-reg-"))
    try {
      const xmlPath = writeInfNfeSuplInstance(
        dir,
        "probe.xml",
        `<qrCode>${"https://qr.example.test/nfce?p=35123456789012345678901234567890123456789012|3|2"}</qrCode><urlChave>https://qr.example.test/consulta</urlChave>`,
      )
      assertXmllintRejects(writeTempInfNfeSuplSchema(dir, "<xs:element name=\"infNFeSupl\"><xs:broken"), xmlPath)

      const brokenLocation = writeTempInfNfeSuplSchema(
        dir,
        infNfeSuplElementDef(leiaute),
        "C:\\not-a-valid-uri\\tiposBasico_v4.00.xsd",
      )
      const brokenXml = writeInfNfeSuplInstance(dir, "broken-location.xml", "<qrCode>x</qrCode><urlChave>https://qr.example.test/consulta</urlChave>")
      assertXmllintRejects(brokenLocation, brokenXml)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("ausência real do validador é ENOENT fail-closed, nunca skip", () => {
    const result = runXmllintSchema("schema.xsd", "doc.xml", "xmllint-ausente-fiscal-b2-095")
    expect(result.kind).toBe("missing")
    expect(() => requireXmllintResult(result)).toThrow(/xmllint ausente no PATH/)
  })
})
