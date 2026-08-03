import { describe, expect, it } from "vitest"
import {
  escolherEscopoVendas,
  financeiroDasVendasWhere,
  somarVendasAtivas,
  type VendaDaSessao,
} from "@/lib/caixa/sessao-vendas-escopo"

const LOJA = "loja-2"

/** Caso real do incidente: sessão aberta 09:26:55; duas vendas legítimas às 09:25:46 e 09:26:17. */
const VENDAS_DA_SESSAO: VendaDaSessao[] = [
  { pedidoId: "VDA-2026-0590", total: 7.98, status: "concluida" }, // ANTES da abertura
  { pedidoId: "VDA-2026-0591", total: 15, status: "concluida" }, // ANTES da abertura
  { pedidoId: "VDA-2026-0592", total: 8.9, status: "concluida" },
  { pedidoId: "VDA-2026-0593", total: 54, status: "concluida" },
  { pedidoId: "VDA-2026-0594", total: 5, status: "concluida" },
  { pedidoId: "VDA-2026-0595", total: 72, status: "concluida" },
  { pedidoId: "VDA-2026-0596", total: 30, status: "concluida" },
]

/** As 10 recuperadas em PDV-PENDENCIAS-SYNC-LOSS-RECOVERY-001. */
const RECUPERADAS: VendaDaSessao[] = [
  { pedidoId: "VDA-2026-0597", total: 42.9, status: "concluida" },
  { pedidoId: "VDA-2026-0598", total: 9.9, status: "concluida" },
  { pedidoId: "VDA-2026-0599", total: 21, status: "concluida" },
  { pedidoId: "VDA-2026-0600", total: 56, status: "concluida" },
  { pedidoId: "VDA-2026-0601", total: 10, status: "concluida" },
  { pedidoId: "VDA-2026-0602", total: 2, status: "concluida" },
  { pedidoId: "VDA-2026-0603", total: 100, status: "concluida" },
  { pedidoId: "VDA-2026-0604", total: 18, status: "concluida" },
  { pedidoId: "VDA-2026-0605", total: 287.8, status: "concluida" },
  { pedidoId: "VDA-2026-0606", total: 80, status: "concluida" },
]

describe("escolherEscopoVendas — vínculo vence janela", () => {
  it("usa o vínculo quando existe pelo menos uma venda ligada à sessão", () => {
    const r = escolherEscopoVendas(VENDAS_DA_SESSAO, [{ pedidoId: "X", total: 1, status: "concluida" }])
    expect(r.modo).toBe("vinculo")
    expect(r.vendas).toHaveLength(7)
  })

  it("cai para a janela apenas quando NENHUMA venda referencia a sessão (legado)", () => {
    const r = escolherEscopoVendas([], VENDAS_DA_SESSAO)
    expect(r.modo).toBe("janela")
    expect(r.vendas).toHaveLength(7)
  })

  it("sem vendas em nenhum dos dois lados ⇒ conjunto vazio, modo janela", () => {
    const r = escolherEscopoVendas([], [])
    expect(r).toEqual({ vendas: [], modo: "janela" })
  })

  it("não devolve a mesma referência de array (evita mutação acidental do resultado do Prisma)", () => {
    const r = escolherEscopoVendas(VENDAS_DA_SESSAO, [])
    expect(r.vendas).not.toBe(VENDAS_DA_SESSAO)
    expect(r.vendas).toEqual(VENDAS_DA_SESSAO)
  })
})

describe("somarVendasAtivas — o total do fechamento", () => {
  it("REGRESSÃO: venda anterior à abertura da sessão entra no total (R$ 22,98 do incidente)", () => {
    const r = somarVendasAtivas(VENDAS_DA_SESSAO)
    expect(r.total).toBe(192.88)
    expect(r.count).toBe(7)
    // Antes da correção o filtro por janela devolvia 169,90 em 5 vendas.
    expect(r.total - 169.9).toBeCloseTo(22.98, 2)
  })

  it("sessão completa após a recuperação soma 820,48 em 17 vendas", () => {
    const r = somarVendasAtivas([...VENDAS_DA_SESSAO, ...RECUPERADAS])
    expect(r.total).toBe(820.48)
    expect(r.count).toBe(17)
  })

  it("venda cancelada não conta no total nem no financeiro", () => {
    const r = somarVendasAtivas([
      ...VENDAS_DA_SESSAO,
      { pedidoId: "VDA-2026-9999", total: 500, status: "cancelada" },
    ])
    expect(r.total).toBe(192.88)
    expect(r.count).toBe(7)
    expect(r.pedidoIds).not.toContain("VDA-2026-9999")
  })

  it("arredonda para centavos (sem resíduo de ponto flutuante)", () => {
    const r = somarVendasAtivas([
      { pedidoId: "A", total: 0.1, status: "concluida" },
      { pedidoId: "B", total: 0.2, status: "concluida" },
    ])
    expect(r.total).toBe(0.3)
  })

  it("conjunto vazio ⇒ zero, sem NaN", () => {
    expect(somarVendasAtivas([])).toEqual({ total: 0, count: 0, pedidoIds: [] })
  })
})

describe("financeiroDasVendasWhere — vínculo por pedidoId, não por janela", () => {
  it("monta o filtro do ledger pelas vendas da sessão", () => {
    const { pedidoIds } = somarVendasAtivas(VENDAS_DA_SESSAO)
    expect(financeiroDasVendasWhere(LOJA, pedidoIds)).toEqual({
      storeId: LOJA,
      origem: "venda",
      tipo: "entrada",
      referenciaId: { in: pedidoIds },
    })
  })

  it("lista vazia ⇒ null (o chamador trata como zero, sem ir ao banco)", () => {
    expect(financeiroDasVendasWhere(LOJA, [])).toBeNull()
  })

  it("não usa `createdAt` — é exatamente isso que excluía a venda da janela", () => {
    const where = financeiroDasVendasWhere(LOJA, ["VDA-2026-0590"])
    expect(where).not.toBeNull()
    expect(Object.keys(where!)).not.toContain("createdAt")
  })
})
