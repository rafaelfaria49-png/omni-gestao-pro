/**
 * GOAL_005 — Snapshot Fiscal da Venda (camada PURA).
 *
 * Cobre o builder `buildVendaFiscalSnapshot` (congelamento dos dados fiscais no ato),
 * incluindo: produto fiscal completo, produto sem fiscal (pendência, sem inventar),
 * loja sem identidade fiscal (erro controlado), cliente CPF, consumidor final,
 * múltiplos itens, desconto, paymentBreakdown, idempotência (localKey determinística),
 * imutabilidade conceitual (deep freeze) e leitura via getProdutoFiscal.
 */
import { describe, it, expect } from "vitest"
import {
  buildVendaFiscalSnapshot,
  resolveSnapshotLocalKey,
  lojaTemIdentidadeFiscalMinima,
  deepFreeze,
  type BuildSnapshotInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
} from "./venda-fiscal-snapshot"
import { getProdutoFiscal, sanitizeProdutoFiscal, PRODUTO_FISCAL_VAZIO } from "@/lib/produto-fiscal"

// ── Fixtures ────────────────────────────────────────────────────────────────────────

// CNPJ válido (dígitos verificadores corretos): 11.222.333/0001-81
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
  complemento: "Sala 2",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001-000",
  codigoPais: "1058",
  fone: "1133334444",
  email: "fiscal@rafacell.com.br",
}

function itemComFiscal(over: Partial<SnapshotItemInput> = {}): SnapshotItemInput {
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
    fiscal: sanitizeProdutoFiscal({
      ncm: "85176200",
      cest: "2106400",
      cfop: "5102",
      csosn: "102",
      origem: "0",
      unidade: "UN",
    }),
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
    itens: [itemComFiscal()],
    ...over,
  }
}

// ── Loja sem identidade fiscal ────────────────────────────────────────────────────────

describe("lojaTemIdentidadeFiscalMinima / loja sem configuração fiscal", () => {
  it("loja null → false e build retorna erro controlado (não cria snapshot)", () => {
    expect(lojaTemIdentidadeFiscalMinima(null)).toBe(false)
    const r = buildVendaFiscalSnapshot(baseInput({ loja: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("loja_sem_identidade_fiscal")
      expect(r.pendencias).toContain("CNPJ")
    }
  })

  it("loja com CNPJ inválido → erro (não cria snapshot inválido)", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ loja: { ...LOJA_OK, cnpj: "00000000000000" } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("loja_sem_identidade_fiscal")
  })

  it("loja sem UF válida → erro", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ loja: { ...LOJA_OK, uf: "ZZ" } }))
    expect(r.ok).toBe(false)
  })

  it("loja com identidade mínima → ok", () => {
    expect(lojaTemIdentidadeFiscalMinima(LOJA_OK)).toBe(true)
    expect(buildVendaFiscalSnapshot(baseInput()).ok).toBe(true)
  })
})

// ── Snapshot com produto fiscal completo ──────────────────────────────────────────────

describe("snapshot com produto fiscal completo", () => {
  it("congela emitente + item fiscal e fica pronto para emissão", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const snap = r.snapshot
    expect(snap.emitente.cnpj).toBe("11222333000181")
    expect(snap.emitente.razaoSocial).toBe("RafaCell Comércio LTDA")
    expect(snap.emitente.endereco.codigoMunicipioIbge).toBe("3550308")
    expect(snap.emitente.endereco.uf).toBe("SP")
    expect(snap.itens).toHaveLength(1)
    const item = snap.itens[0]
    expect(item.ncm).toBe("85176200")
    expect(item.cfop).toBe("5102")
    expect(item.csosn).toBe("102")
    expect(item.origemMercadoria).toBe("0")
    expect(item.unidadeComercial).toBe("UN")
    expect(item.unidadeTributavel).toBe("UN") // deriva da uCom
    expect(item.fiscalCompleto).toBe(true)
    expect(item.pendencias).toEqual([])
    expect(snap.diagnostico.prontoParaEmissao).toBe(true)
    expect(snap.diagnostico.itensSemFiscal).toEqual([])
  })
})

// ── Snapshot com produto SEM fiscal (não inventa, marca pendência) ────────────────────

describe("snapshot com produto sem fiscal", () => {
  it("cria snapshot COM pendência clara (não inventa dado)", () => {
    const semFiscal = itemComFiscal({ fiscal: { ...PRODUTO_FISCAL_VAZIO } })
    const r = buildVendaFiscalSnapshot(baseInput({ itens: [semFiscal] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.snapshot.itens[0]
    expect(item.ncm).toBe("")
    expect(item.cfop).toBe("")
    expect(item.fiscalCompleto).toBe(false)
    expect(item.pendencias).toContain("NCM")
    expect(item.pendencias).toContain("CFOP")
    expect(r.snapshot.diagnostico.prontoParaEmissao).toBe(false)
    expect(r.snapshot.diagnostico.itensSemFiscal).toEqual([1])
  })
})

// ── Destinatário: CPF / CNPJ / consumidor final ───────────────────────────────────────

describe("destinatário", () => {
  it("cliente com CPF → tipo cpf, documento normalizado", () => {
    const r = buildVendaFiscalSnapshot(
      baseInput({
        cliente: {
          nome: "Maria Cliente",
          documento: "529.982.247-25",
          kind: "PF",
          telefone: "11999990000",
          email: "maria@x.com",
          municipio: "São Paulo/SP",
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.destinatario.tipo).toBe("cpf")
    expect(r.snapshot.destinatario.documentoTipo).toBe("CPF")
    expect(r.snapshot.destinatario.documento).toBe("52998224725")
    expect(r.snapshot.destinatario.nome).toBe("Maria Cliente")
  })

  it("cliente com CNPJ → tipo cnpj", () => {
    const r = buildVendaFiscalSnapshot(
      baseInput({
        cliente: {
          nome: "Empresa X LTDA",
          documento: "11.222.333/0001-81",
          kind: "PJ",
          telefone: "",
          email: "",
          municipio: "",
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.destinatario.tipo).toBe("cnpj")
    expect(r.snapshot.destinatario.documentoTipo).toBe("CNPJ")
    expect(r.snapshot.destinatario.documento).toBe("11222333000181")
  })

  it("consumidor final (cliente null) → tipo consumidor_final, sem documento", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ cliente: null }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.destinatario.tipo).toBe("consumidor_final")
    expect(r.snapshot.destinatario.documento).toBeNull()
    expect(r.snapshot.destinatario.nome).toBeNull()
  })
})

// ── Múltiplos itens / desconto / paymentBreakdown ─────────────────────────────────────

describe("venda com múltiplos itens, desconto e paymentBreakdown", () => {
  it("congela N itens com numeração sequencial", () => {
    const r = buildVendaFiscalSnapshot(
      baseInput({
        itens: [
          itemComFiscal({ itemVendaId: "a", descricao: "Item A" }),
          itemComFiscal({ itemVendaId: "b", descricao: "Item B", fiscal: { ...PRODUTO_FISCAL_VAZIO } }),
          itemComFiscal({ itemVendaId: "c", descricao: "Item C" }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.itens.map((i) => i.numeroItem)).toEqual([1, 2, 3])
    expect(r.snapshot.totais.quantidadeItens).toBe(3)
    // só o item 2 está sem fiscal
    expect(r.snapshot.diagnostico.itensSemFiscal).toEqual([2])
  })

  it("congela desconto da venda", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ venda: { ...baseInput().venda, desconto: 7.5 } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.venda.desconto).toBe(7.5)
    expect(r.snapshot.totais.valorDesconto).toBe(7.5)
  })

  it("congela paymentBreakdown como veio", () => {
    const pb = { dinheiro: 30, pix: 20, cartaoCredito: 0 }
    const r = buildVendaFiscalSnapshot(baseInput({ venda: { ...baseInput().venda, paymentBreakdown: pb } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.venda.paymentBreakdown).toEqual(pb)
    expect(r.snapshot.venda.pagamentoFiscal?.det.map((d) => d.tPag).sort()).toEqual(["01", "17"])
    expect(r.snapshot.venda.pagamentoFiscalErro).toBeNull()
  })

  it("breakdown nulo congela erro canônico e não inventa forma", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ venda: { ...baseInput().venda, paymentBreakdown: null } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.venda.pagamentoFiscal).toBeNull()
    expect(r.snapshot.venda.pagamentoFiscalErro?.code).toBe("PAGAMENTO_AUSENTE")
  })

  it("venda sem itens → erro controlado", () => {
    const r = buildVendaFiscalSnapshot(baseInput({ itens: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("venda_sem_itens")
  })
})

// ── Idempotência (localKey determinística) ────────────────────────────────────────────

describe("idempotência — localKey determinística por (loja, venda)", () => {
  it("mesma venda → mesma localKey; vendas distintas → keys distintas", () => {
    expect(resolveSnapshotLocalKey("loja-1", "venda-1")).toBe("nfce-snapshot:loja-1:venda-1")
    expect(resolveSnapshotLocalKey("loja-1", "venda-1")).toBe(resolveSnapshotLocalKey("loja-1", "venda-1"))
    expect(resolveSnapshotLocalKey("loja-1", "venda-1")).not.toBe(resolveSnapshotLocalKey("loja-1", "venda-2"))
    const r = buildVendaFiscalSnapshot(baseInput())
    if (r.ok) expect(r.localKey).toBe("nfce-snapshot:loja-1:venda-1")
  })
})

// ── Imutabilidade conceitual ──────────────────────────────────────────────────────────

describe("imutabilidade conceitual — snapshot é deep-frozen", () => {
  it("não permite mutação dos campos congelados", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.isFrozen(r.snapshot)).toBe(true)
    expect(Object.isFrozen(r.snapshot.emitente)).toBe(true)
    expect(Object.isFrozen(r.snapshot.itens)).toBe(true)
    expect(Object.isFrozen(r.snapshot.itens[0])).toBe(true)
    expect(() => {
      // Mutação proibida em runtime (objeto congelado). TS permite o tipo string;
      // a proteção é o Object.freeze — por isso lança TypeError em modo estrito.
      ;(r.snapshot.emitente as { cnpj: string }).cnpj = "00000000000000"
    }).toThrow()
  })

  it("deepFreeze congela objetos aninhados", () => {
    const o = deepFreeze({ a: { b: { c: 1 } } })
    expect(Object.isFrozen(o.a.b)).toBe(true)
  })
})

// ── Leitura via getProdutoFiscal (pipeline GOAL_004 → GOAL_005) ───────────────────────

describe("leitura via getProdutoFiscal", () => {
  it("item construído a partir do metadata.fiscal do produto reflete o cadastro", () => {
    const produto = {
      id: "prod-x",
      sku: "SKU-X",
      barcode: "7890000000000",
      name: "Fone Bluetooth",
      metadata: { fiscal: { ncm: "85183000", cfop: "5102", origemMercadoria: "0", csosn: "102" } },
    }
    const fiscal = getProdutoFiscal(produto)
    const r = buildVendaFiscalSnapshot(
      baseInput({ itens: [itemComFiscal({ descricao: "Fone Bluetooth", fiscal })] }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = r.snapshot.itens[0]
    expect(item.ncm).toBe("85183000")
    expect(item.cfop).toBe("5102")
    expect(item.fiscalCompleto).toBe(true)
  })

  it("produto legado (metadata.ncm no topo) também é lido via getProdutoFiscal", () => {
    const fiscal = getProdutoFiscal({ metadata: { ncm: "85176200", cest: "2106400" } })
    const r = buildVendaFiscalSnapshot(baseInput({ itens: [itemComFiscal({ fiscal })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.itens[0].ncm).toBe("85176200")
    expect(r.snapshot.itens[0].cest).toBe("2106400")
  })
})
