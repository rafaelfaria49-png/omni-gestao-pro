/**
 * BL-FISCAL-003 — Serviço do Snapshot Fiscal com Tax Engine (Prisma MOCKADO).
 *
 * Verifica que `createVendaFiscalSnapshot`:
 *  - é idempotente (nota vigente existente → não recria, não recalcula);
 *  - no caminho feliz grava os tributos calculados nos campos do schema (ICMS por item +
 *    valorTotalTributos na nota) e congela o bloco `tributacao` no JSONB snapshotPagamento.
 * Não toca SEFAZ/XML; não altera Venda.fiscalStatus.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  notaFindFirst: vi.fn(),
  notaCreate: vi.fn(),
  vendaFindFirst: vi.fn(),
  configFindUnique: vi.fn(),
  produtoFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notaFiscal: { findFirst: db.notaFindFirst, create: db.notaCreate },
    venda: { findFirst: db.vendaFindFirst },
    configuracaoFiscalLoja: { findUnique: db.configFindUnique },
    produto: { findMany: db.produtoFindMany },
  },
}))

import { createVendaFiscalSnapshot } from "./venda-fiscal-snapshot-service"

const CONFIG_SIMPLES = {
  cnpj: "11222333000181",
  razaoSocial: "RafaCell Comércio LTDA",
  nomeFantasia: "RafaCell",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua A",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

const VENDA = {
  id: "venda-1",
  pedidoId: "VDA-1",
  at: new Date("2026-06-18T12:00:00.000Z"),
  total: 50,
  operador: "João",
  terminalId: "PDV1",
  payload: {},
  cliente: null,
  itens: [{ id: "iv-1", inventoryId: "prod-1", nome: "Cabo USB-C", quantidade: 2, precoUnitario: 25, lineTotal: 50 }],
}

const PRODUTOS = [
  {
    id: "prod-1",
    sku: "SKU-1",
    barcode: "7891234567890",
    name: "Cabo USB-C",
    metadata: { fiscal: { ncm: "85176200", cfop: "5102", csosn: "102", origemMercadoria: "0", unidadeComercial: "UN" } },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createVendaFiscalSnapshot · idempotência", () => {
  it("nota vigente já existe → retorna sem recriar nem recalcular", async () => {
    db.notaFindFirst.mockResolvedValueOnce({ id: "nf-existente", localKey: "nfce-snapshot:loja-1:venda-1" })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.created).toBe(false)
      expect(r.notaFiscalId).toBe("nf-existente")
    }
    expect(db.notaCreate).not.toHaveBeenCalled()
    expect(db.vendaFindFirst).not.toHaveBeenCalled()
  })

  it("nota vigente com PIX 17 inferido não é reescrita nem recalculada", async () => {
    db.notaFindFirst.mockResolvedValueOnce({
      id: "nf-pix-legado",
      localKey: "nfce-snapshot:loja-1:venda-1",
      snapshotPagamento: {
        hash: "hash-congelado",
        hashContratoVersao: 1,
        venda: {
          pagamentoFiscal: {
            fonte: "venda.payload.paymentBreakdown",
            det: [{ formaInterna: "pix", tPag: "17", vPag: 50 }],
          },
        },
      },
    })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.created).toBe(false)
      expect(r.notaFiscalId).toBe("nf-pix-legado")
      expect(r.snapshotHash).toBe("hash-congelado")
    }
    expect(db.notaCreate).not.toHaveBeenCalled()
    expect(db.vendaFindFirst).not.toHaveBeenCalled()
  })
})

describe("createVendaFiscalSnapshot · caminho feliz grava tributos congelados", () => {
  it("persiste ICMS por item + valorTotalTributos + bloco tributacao no JSONB", async () => {
    db.notaFindFirst.mockResolvedValueOnce(null) // não existe vigente
    db.vendaFindFirst.mockResolvedValueOnce(VENDA)
    db.configFindUnique.mockResolvedValueOnce(CONFIG_SIMPLES)
    db.produtoFindMany.mockResolvedValueOnce(PRODUTOS)
    db.notaCreate.mockResolvedValueOnce({ id: "nf-1" })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.created).toBe(true)
      expect(r.notaFiscalId).toBe("nf-1")
    }
    expect(db.notaCreate).toHaveBeenCalledTimes(1)

    const data = db.notaCreate.mock.calls[0][0].data
    // Total de tributos (Lei da Transparência) — Simples 102 sem IBPT = 0, mas agora é calculado.
    expect(data.valorTotalTributos).toBe(0)

    // Item: ICMS não destacado no Simples (valores 0), preenchidos pelo motor (não ausentes).
    const itemData = data.itens.create[0]
    expect(itemData.baseCalculoIcms).toBe(0)
    expect(itemData.aliquotaIcms).toBe(0)
    expect(itemData.valorIcms).toBe(0)
    expect(itemData.valorTributos).toBe(0)

    // Bloco tributacao CONGELADO no JSONB (com situação/regime/versões).
    const trib = data.snapshotPagamento.tributacao
    expect(trib.ok).toBe(true)
    expect(trib.semDestaque).toBe(true)
    expect(trib.regime).toBe("SIMPLES_NACIONAL")
    expect(trib.engineVersion).toBe("1.0.0")
    expect(trib.itens[0].icms.situacao).toBe("nao_destacado")
    expect(trib.itens[0].icms.codigo).toBe("102")
  })
})

describe("createVendaFiscalSnapshot · hash determinístico + contrato (GOAL-005)", () => {
  it("persiste hash SHA-256 + versão do contrato de hash no JSONB snapshotPagamento", async () => {
    db.notaFindFirst.mockResolvedValueOnce(null)
    db.vendaFindFirst.mockResolvedValueOnce(VENDA)
    db.configFindUnique.mockResolvedValueOnce(CONFIG_SIMPLES)
    db.produtoFindMany.mockResolvedValueOnce(PRODUTOS)
    db.notaCreate.mockResolvedValueOnce({ id: "nf-1" })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
      expect(r.hashContratoVersao).toBe(1)
    }

    const data = db.notaCreate.mock.calls[0][0].data
    // Hash + algoritmo + versão do contrato persistidos no JSONB (sem schema novo).
    expect(data.snapshotPagamento.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.snapshotPagamento.hashAlgoritmo).toBe("sha256")
    expect(data.snapshotPagamento.hashContratoVersao).toBe(1)
    // Versão do snapshot (contrato do snapshot) também no JSONB.
    expect(data.snapshotPagamento.versao).toBe(1)
  })

  it("nota vigente já existe → retorna hash persistido (não recomputa)", async () => {
    const hashPersistido = "c".repeat(64)
    db.notaFindFirst.mockResolvedValueOnce({
      id: "nf-existente",
      localKey: "nfce-snapshot:loja-1:venda-1",
      snapshotPagamento: { hash: hashPersistido, hashContratoVersao: 1, versao: 1 },
    })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.created).toBe(false)
      expect(r.snapshotHash).toBe(hashPersistido)
      expect(r.hashContratoVersao).toBe(1)
    }
    expect(db.notaCreate).not.toHaveBeenCalled()
  })

  it("nota vigente sem hash histórico (snapshot pré-GOAL-005) → retorna hash null", async () => {
    db.notaFindFirst.mockResolvedValueOnce({
      id: "nf-antiga",
      localKey: "nfce-snapshot:loja-1:venda-1",
      snapshotPagamento: { versao: 1 }, // sem hash (pré-GOAL-005)
    })

    const r = await createVendaFiscalSnapshot({ storeId: "loja-1", vendaId: "venda-1" })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.created).toBe(false)
      expect(r.snapshotHash).toBe(null)
      expect(r.hashContratoVersao).toBe(null)
    }
  })
})
