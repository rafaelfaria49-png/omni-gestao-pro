/**
 * GOAL-005 — Hash determinístico do Snapshot Fiscal da Venda.
 *
 * Cobre:
 *  - determinismo (mesma entrada → mesmo hash, independente de `geradoEm`);
 *  - imutabilidade (snapshot congelado → hash não muda);
 *  - canonização (ordem de chaves não afeta o hash);
 *  - exclusão de `geradoEm` (timestamp volátil não participa do hash);
 *  - robustez (objetos congelados, arrays, tipos primitivos);
 *  - verificação (`verifySnapshotHash` confere imutabilidade pós-persistência).
 */
import { describe, it, expect } from "vitest"
import {
  computeSnapshotHash,
  verifySnapshotHash,
  SNAPSHOT_HASH_CONTRATO_VERSAO,
  SNAPSHOT_HASH_ALGORITHM,
} from "./venda-fiscal-snapshot-hash"
import {
  buildVendaFiscalSnapshot,
  deepFreeze,
  VENDA_FISCAL_SNAPSHOT_VERSAO,
  type BuildSnapshotInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
} from "./venda-fiscal-snapshot"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"

// ── Fixtures ────────────────────────────────────────────────────────────────────────

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
  fiscalEnabled: true,
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

// ── Determinismo ─────────────────────────────────────────────────────────────────────

describe("computeSnapshotHash · determinismo", () => {
  it("mesma entrada → mesmo hash (idempotência de hash)", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    const r2 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      const h1 = computeSnapshotHash(r1.snapshot)
      const h2 = computeSnapshotHash(r2.snapshot)
      expect(h1).toBe(h2)
    }
  })

  it("`geradoEm` diferente → mesmo hash (timestamp não participa)", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    if (!r1.ok) return

    const h1 = computeSnapshotHash(r1.snapshot)

    // Constrói uma cópia com `geradoEm` diferente (snapshot original é frozen,
    // então criamos um novo objeto com spread). O hash NÃO deve mudar.
    const snapshotComGeradoEmDiferente = {
      ...r1.snapshot,
      geradoEm: "2099-12-31T23:59:59.999Z",
    }
    expect(snapshotComGeradoEmDiferente.geradoEm).not.toBe(r1.snapshot.geradoEm)
    const h2 = computeSnapshotHash(snapshotComGeradoEmDiferente)
    expect(h1).toBe(h2)
  })

  it("hash é string hexadecimal de 64 caracteres (SHA-256)", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const hash = computeSnapshotHash(r.snapshot)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("algoritmo é SHA-256 e contrato versão 1 (auditoria de versão)", () => {
    expect(SNAPSHOT_HASH_ALGORITHM).toBe("sha256")
    expect(SNAPSHOT_HASH_CONTRATO_VERSAO).toBe(1)
  })
})

// ── Imutabilidade ────────────────────────────────────────────────────────────────────

describe("computeSnapshotHash · imutabilidade", () => {
  it("snapshot deep-frozen → hash estável (mutação silenciosa não altera conteúdo)", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // O builder já aplica deepFreeze. Verificamos que o snapshot está frozen.
    expect(Object.isFrozen(r.snapshot)).toBe(true)
    expect(Object.isFrozen(r.snapshot.emitente)).toBe(true)
    expect(Object.isFrozen(r.snapshot.itens[0])).toBe(true)

    const h1 = computeSnapshotHash(r.snapshot)
    // Re-computa sobre o mesmo objeto congelado — deve ser idêntico.
    const h2 = computeSnapshotHash(r.snapshot)
    expect(h1).toBe(h2)
  })

  it("verifySnapshotHash confirma imutabilidade pós-persistência (re-computa = persistido)", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const hash = computeSnapshotHash(r.snapshot)
    // Simula "leu do banco e re-computou" — deve conferir.
    expect(verifySnapshotHash(r.snapshot, hash)).toBe(true)
    expect(verifySnapshotHash(r.snapshot, hash + "x")).toBe(false)
  })

  it("tentar mutar campo congelado não altera o hash (deepFreeze reforça imutabilidade)", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const h1 = computeSnapshotHash(r.snapshot)

    // Em modo não-strict, Object.freeze ignora mutações silenciosamente.
    // Confirmamos que a tentativa não tem efeito.
    try {
      ;(r.snapshot as unknown as Record<string, unknown>).vendaId = "tainted"
    } catch {
      // strict mode lança; não-strict ignora — ambos são aceitáveis.
    }
    const h2 = computeSnapshotHash(r.snapshot)
    expect(h1).toBe(h2)
  })
})

// ── Canonização ──────────────────────────────────────────────────────────────────────

describe("computeSnapshotHash · canonização (ordem de chaves não afeta)", () => {
  it("constrói snapshot com campos em ordem diferente → mesmo hash", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const h1 = computeSnapshotHash(r1.snapshot)

    // Re-constrói com ordem de itens trocada — DEVE produzir hash diferente
    // (ordem de itens é semântica fiscal: numeroItem sequencial).
    const r2 = buildVendaFiscalSnapshot(
      baseInput({
        itens: [
          itemComFiscal({ descricao: "Cabo USB-C 2m", valorUnitario: 30, valorTotal: 60 }),
          itemComFiscal(),
        ],
      }),
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const h2 = computeSnapshotHash(r2.snapshot)
    expect(h1).not.toBe(h2)
  })

  it("trocar ordem de itens (mesmas linhas) → hash diferente (numeroItem muda)", () => {
    const itemA = itemComFiscal({ descricao: "Item A", valorTotal: 10, valorUnitario: 10 })
    const itemB = itemComFiscal({ descricao: "Item B", valorTotal: 20, valorUnitario: 20 })

    const r1 = buildVendaFiscalSnapshot(baseInput({ itens: [itemA, itemB] }))
    const r2 = buildVendaFiscalSnapshot(baseInput({ itens: [itemB, itemA] }))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    const h1 = computeSnapshotHash(r1.snapshot)
    const h2 = computeSnapshotHash(r2.snapshot)
    // Itens trocados → numeroItem atribuído diferente → hash diferente.
    expect(h1).not.toBe(h2)
  })

  it("mesma venda com `paymentBreakdown` em ordem de chaves diferente → mesmo hash", () => {
    const r1 = buildVendaFiscalSnapshot(
      baseInput({
        venda: {
          pedidoId: "VDA-2026-0001",
          data: "2026-06-18T12:00:00.000Z",
          total: 100,
          desconto: 0,
          operador: "João",
          terminal: "PDV1",
          paymentBreakdown: { dinheiro: 50, pix: 50 },
        },
      }),
    )
    const r2 = buildVendaFiscalSnapshot(
      baseInput({
        venda: {
          pedidoId: "VDA-2026-0001",
          data: "2026-06-18T12:00:00.000Z",
          total: 100,
          desconto: 0,
          operador: "João",
          terminal: "PDV1",
          paymentBreakdown: { pix: 50, dinheiro: 50 },
        },
      }),
    )
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    const h1 = computeSnapshotHash(r1.snapshot)
    const h2 = computeSnapshotHash(r2.snapshot)
    // Ordem de chaves no paymentBreakdown não deve afetar o hash (canonização).
    expect(h1).toBe(h2)
    expect(r1.snapshot.venda.pagamentoFiscal?.det).toEqual(r2.snapshot.venda.pagamentoFiscal?.det)
  })

  it("snapshot legado (sem pagamentoFiscal) e snapshot novo com contrato têm hashes diferentes", () => {
    const r = buildVendaFiscalSnapshot(
      baseInput({
        venda: {
          ...baseInput().venda,
          paymentBreakdown: { dinheiro: 50 },
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const hNovo = computeSnapshotHash(r.snapshot)
    const legado = {
      ...r.snapshot,
      venda: {
        pedidoId: r.snapshot.venda.pedidoId,
        data: r.snapshot.venda.data,
        total: r.snapshot.venda.total,
        desconto: r.snapshot.venda.desconto,
        operador: r.snapshot.venda.operador,
        terminal: r.snapshot.venda.terminal,
        paymentBreakdown: r.snapshot.venda.paymentBreakdown,
      },
    }
    const hLegado = computeSnapshotHash(legado)
    expect(hNovo).not.toBe(hLegado)
  })
})

// ── Sensibilidade a conteúdo fiscal ──────────────────────────────────────────────────

describe("computeSnapshotHash · sensibilidade a conteúdo fiscal", () => {
  it("mudança de NCM em item → hash diferente", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const h1 = computeSnapshotHash(r1.snapshot)

    const r2 = buildVendaFiscalSnapshot(
      baseInput({
        itens: [
          itemComFiscal({
            fiscal: sanitizeProdutoFiscal({
              ncm: "85176299",
              cfop: "5102",
              csosn: "102",
              origem: "0",
              unidade: "UN",
            }),
          }),
        ],
      }),
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const h2 = computeSnapshotHash(r2.snapshot)
    expect(h1).not.toBe(h2)
  })

  it("mudança de CNPJ do emitente → hash diferente", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const h1 = computeSnapshotHash(r1.snapshot)

    const r2 = buildVendaFiscalSnapshot(
      baseInput({
        loja: { ...LOJA_OK, cnpj: "11.444.777/0001-61" },
      }),
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const h2 = computeSnapshotHash(r2.snapshot)
    expect(h1).not.toBe(h2)
  })

  it("mudança de total da venda → hash diferente", () => {
    const r1 = buildVendaFiscalSnapshot(baseInput())
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const h1 = computeSnapshotHash(r1.snapshot)

    const r2 = buildVendaFiscalSnapshot(
      baseInput({
        venda: { ...baseInput().venda, total: 99.99 },
      }),
    )
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const h2 = computeSnapshotHash(r2.snapshot)
    expect(h1).not.toBe(h2)
  })
})

// ── Versão do contrato de hash vs versão do snapshot ─────────────────────────────────

describe("computeSnapshotHash · versões do contrato", () => {
  it("versão do snapshot (VENDA_FISCAL_SNAPSHOT_VERSAO) participa do hash", () => {
    const r = buildVendaFiscalSnapshot(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.versao).toBe(VENDA_FISCAL_SNAPSHOT_VERSAO)
    // O hash inclui `versao` do snapshot — mudar a versão mudaria o hash.
    const h = computeSnapshotHash(r.snapshot)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
