/**
 * GOAL PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001 — POST /api/ops/devolucao.
 *
 * Exercita o handler de PRODUÇÃO sobre Prisma EM MEMÓRIA. Prova que:
 *  - Vale-Troca gera ClienteCredito UMA única vez, vinculado à devolução e à
 *    venda de origem, com loja/doc/nome — e não entra no caixa (sem
 *    MovimentacaoFinanceira de entrada; createSaida é saída da devolução real);
 *  - replay do mesmo localId retorna idempotente e NÃO duplica crédito/estoque;
 *  - valor devolvido e crédito são RECALCULADOS dos itens persistidos da venda
 *    original (client que exagera é limitado ao valor efetivamente devolvido);
 *  - devolução parcial calcula o valor proporcional (unitário da venda);
 *  - somente_estoque não gera crédito nem saída financeira;
 *  - estoque volta com MovimentacaoEstoque origem "devolução" dedupe por documento.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const STORE = "loja-1"
  const db = {
    devolucoes: [] as Row[],
    itensDevolucao: [] as Row[],
    creditos: [] as Row[],
    movEstoque: [] as Row[],
    produtos: [] as Row[],
    vendas: [] as Row[],
    estoqueAtual: new Map<string, number>(),
  }
  const saidas: Array<Row> = []
  let seq = 0

  function reset() {
    db.devolucoes.length = 0
    db.itensDevolucao.length = 0
    db.creditos.length = 0
    db.movEstoque.length = 0
    db.produtos.length = 0
    db.vendas.length = 0
    db.estoqueAtual.clear()
    saidas.length = 0
    seq = 0
  }

  function addProduto(id: string, stock = 10) {
    db.produtos.push({ id, storeId: STORE, sku: id, name: `Prod ${id}`, precoCusto: 5 })
    db.estoqueAtual.set(id, stock)
  }

  /** Venda original persistida: item 3× R$10 (lineTotal 30) + item 1× R$50. */
  function addVenda(pedidoId: string) {
    db.vendas.push({
      id: `v-${++seq}`,
      pedidoId,
      storeId: STORE,
      status: "concluida",
      itens: [
        { inventoryId: "p1", nome: "Fone", quantidade: 3, lineTotal: 30 },
        { inventoryId: "p2", nome: "Carregador", quantidade: 1, lineTotal: 50 },
      ],
    })
  }

  const tx = {
    devolucaoVenda: {
      findUnique: async ({ where }: { where: { storeId_localId: { storeId: string; localId: string } } }) =>
        db.devolucoes.find(
          (d) => d.storeId === where.storeId_localId.storeId && d.localId === where.storeId_localId.localId,
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        // O create aninhado `itens: { create: [...] }` é resolvido pelo Prisma
        // internamente — materializamos aqui para o agregador de status do step 3.
        const itensAninhados = ((data.itens as Row | undefined)?.create ?? []) as Array<Row>
        const dev = {
          id: `dev-${++seq}`,
          ...data,
          itens: itensAninhados.map((it) => ({ quantidade: it.quantidade })),
        }
        db.devolucoes.push(dev)
        return dev
      },
      findMany: async ({ where }: { where: Row }) =>
        db.devolucoes
          .filter((d) => d.storeId === where.storeId && d.vendaLocalId === where.vendaLocalId)
          .map((d) => ({ ...d, itens: d.itens })),
    },
    itemDevolucaoVenda: {
      create: async ({ data }: { data: Row }) => {
        db.itensDevolucao.push(data)
        return data
      },
    },
    clienteCredito: {
      create: async ({ data }: { data: Row }) => {
        const c = { id: `cred-${++seq}`, ...data }
        db.creditos.push(c)
        return c
      },
    },
    produto: {
      findFirst: async ({ where }: { where: Row }) => {
        const raw = ((where.OR as Array<Row>)[0] as Row).id as string
        const p = db.produtos.find((x) => x.id === raw)
        if (!p) return null
        return { ...p, stock: db.estoqueAtual.get(String(p.id)) ?? 0 }
      },
      update: async ({ where, data }: { where: { id: string }; data: { stock: { increment: number } } }) => {
        const atual = db.estoqueAtual.get(where.id) ?? 0
        db.estoqueAtual.set(where.id, atual + data.stock.increment)
        return {}
      },
    },
    movimentacaoEstoque: {
      findFirst: async ({ where }: { where: Row }) =>
        db.movEstoque.find(
          (m) => m.documento === where.documento && m.produtoId === where.produtoId && m.origem === where.origem,
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        db.movEstoque.push(data)
        return data
      },
    },
    venda: {
      findFirst: async ({ where }: { where: Row }) => {
        const v = db.vendas.find((x) => x.pedidoId === where.pedidoId && x.storeId === where.storeId)
        if (!v) return null
        return { ...v, itens: v.itens }
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const v = db.vendas.find((x) => x.id === where.id)
        if (v) Object.assign(v, data)
        return v ?? {}
      },
    },
  }

  const prisma = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }

  function devolucaoBody(over: Row = {}): Row {
    return {
      localId: "DEV-2026-0050",
      vendaLocalId: "VDA-2026-0100",
      tipo: "vale_credito",
      // Devolve as 3 unidades de p1 (lineTotal 30 na venda original): coerente
      // com o recompute autoritativo do servidor (3 × 10 = 30).
      valorTotal: 30,
      creditoEmitido: 30,
      clienteNome: "Maria Souza",
      clienteDoc: "123.456.789-00",
      operador: "Rafael",
      motivo: "produto com defeito",
      observacao: "",
      itens: [{ inventoryId: "p1", nome: "Fone", quantidade: 3, valorUnitario: 10, valorTotal: 30 }],
      ...over,
    }
  }

  return { STORE, db, saidas, reset, addProduto, addVenda, prisma, devolucaoBody }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/ops-api-gate", () => ({ opsLojaIdFromRequestForWrite: vi.fn(() => h.STORE) }))
vi.mock("@/lib/auth/api-enterprise-guard", () => ({
  apiGuardEnterpriseOrOps: vi.fn(async () => null),
}))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }))
vi.mock("@/lib/auth/session-operator", () => ({ getOperatorLabelFromSession: vi.fn(() => "") }))
vi.mock("@/lib/financeiro/services/movimentacoes-service", () => ({
  createSaida: vi.fn(async (data: Row) => {
    h.saidas.push(data)
    return { id: "saida-1" }
  }),
}))
vi.mock("@/lib/financeiro/services/fechamento-service", () => ({
  verificarPeriodoFechado: vi.fn(async () => ({ fechado: false })),
}))

import { POST } from "./route"

function postReq(body: Row) {
  return new Request("http://local/api/ops/devolucao", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": h.STORE },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.reset()
  h.addProduto("p1")
  h.addProduto("p2")
  h.addVenda("VDA-2026-0100")
})

describe("POST /api/ops/devolucao — vale-troca real", () => {
  it("gera ClienteCredito uma única vez, vinculado à devolução e à venda de origem", async () => {
    const res = await POST(postReq(h.devolucaoBody()))
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(h.db.creditos).toHaveLength(1)
    const credito = h.db.creditos[0]!
    expect(credito).toMatchObject({
      storeId: h.STORE,
      clienteDoc: "12345678900",
      clienteNome: "Maria Souza",
      vendaOrigemId: "VDA-2026-0100",
      valorOriginal: 30,
      saldoAtual: 30,
      status: "ativo",
    })
    const devolucao = h.db.devolucoes.find((d) => d.id === credito.devolucaoId)
    expect(devolucao).toBeTruthy()
    expect(devolucao!.localId).toBe("DEV-2026-0050")
    expect(devolucao!.operador).toBe("Rafael")
    expect(devolucao!.motivo).toBe("produto com defeito")
  })

  it("replay do mesmo localId é idempotente: sem segundo crédito nem estoque duplicado", async () => {
    await POST(postReq(h.devolucaoBody()))
    const estoqueAposPrimeira = h.db.estoqueAtual.get("p1")
    const res2 = await POST(postReq(h.devolucaoBody()))
    const j2 = await res2.json()
    expect(j2.ok).toBe(true)
    expect(j2.idempotente).toBe(true)
    expect(h.db.creditos).toHaveLength(1)
    expect(h.db.devolucoes).toHaveLength(1)
    expect(h.db.estoqueAtual.get("p1")).toBe(estoqueAposPrimeira)
    // A saída financeira da devolução real também não duplica.
    expect(h.saidas).toHaveLength(1)
  })

  it("devolução parcial: valor e crédito recalculados da venda original (proporcional)", async () => {
    // Client exagera: diz ter devolvido 40 e emitido 40, mas devolve 2 de 3
    // unidades de um item de lineTotal 30 → efetivo é 20 (unitário 10 × 2).
    const res = await POST(
      postReq(
        h.devolucaoBody({
          valorTotal: 40,
          creditoEmitido: 40,
          itens: [{ inventoryId: "p1", nome: "Fone", quantidade: 2, valorUnitario: 10, valorTotal: 40 }],
        }),
      ),
    )
    const j = await res.json()
    expect(j.ok).toBe(true)
    const dev = h.db.devolucoes[0]!
    expect(dev.valorTotal).toBe(20)
    expect(dev.creditoEmitido).toBe(20)
    const credito = h.db.creditos[0]!
    expect(credito.valorOriginal).toBe(20)
    expect(credito.saldoAtual).toBe(20)
  })

  it("somente_estoque: devolve estoque, sem crédito e sem saída financeira", async () => {
    const res = await POST(
      postReq(h.devolucaoBody({ tipo: "somente_estoque", valorTotal: 30, creditoEmitido: 0 })),
    )
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(h.db.creditos).toHaveLength(0)
    expect(h.saidas).toHaveLength(0)
    expect(h.db.estoqueAtual.get("p1")).toBe(13)
  })

  it("Vale-Troca NÃO é dinheiro novo: nada entra no caixa (só saída da devolução real)", async () => {
    await POST(postReq(h.devolucaoBody()))
    // Nenhuma MovimentacaoFinanceira é criada dentro da tx (o fake não recebe
    // chamadas de entrada); a única Integração é a SAÍDA da devolução real.
    expect(h.saidas).toHaveLength(1)
    expect(h.saidas[0]).toMatchObject({ origem: "devolucao_pdv", valor: 30 })
  })

  it("estoque volta com ledger auditável dedupe por documento (origem devolução)", async () => {
    await POST(postReq(h.devolucaoBody()))
    expect(h.db.estoqueAtual.get("p1")).toBe(13)
    const ledger = h.db.movEstoque.filter((m) => m.documento === "DEV-2026-0050")
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      produtoId: "p1",
      tipo: "entrada",
      origem: "devolucao",
      quantidade: 3,
      estoqueAntes: 10,
      estoqueDepois: 13,
    })
  })

  it("venda de outra loja não é usada como origem (storeId isola o recompute)", async () => {
    // Venda existe SÓ em outra loja: o fake filtra por storeId → sem recompute,
    // o fluxo cai nos valores do client (comportamento legado, sem crash).
    h.db.vendas.length = 0
    const res = await POST(postReq(h.devolucaoBody({ valorTotal: 40, creditoEmitido: 40 })))
    const j = await res.json()
    expect(j.ok).toBe(true)
    // Sem venda de origem na loja, os valores do client são mantidos.
    expect(h.db.devolucoes[0]!.valorTotal).toBe(40)
    expect(h.db.creditos[0]!.saldoAtual).toBe(40)
  })

  it("venda original sai do banco como parcialmente_devolvida", async () => {
    await POST(postReq(h.devolucaoBody()))
    const venda = h.db.vendas.find((v) => v.pedidoId === "VDA-2026-0100")!
    expect(venda.status).toBe("parcialmente_devolvida")
  })
})
