/**
 * GOAL: PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001
 *
 * `Venda.pedidoId` é `@unique` GLOBAL, mas `VDA-YYYY-NNNN` vem de um contador LOCAL do
 * navegador que reinicia em `0001` por loja. Antes deste guard, o `upsert` por `pedidoId`
 * encontrava a venda de OUTRA loja e a reescrevia — inclusive reatribuindo `storeId` —
 * apagando os `ItemVenda` originais e deixando estoque/financeiro órfãos na loja lesada.
 *
 * Cenário real (auditoria PDV-PENDENCIAS-FANTASMAS-SERVER-PAYLOAD-AUDIT-001): a loja-2
 * tem `VDA-2026-0001..0505` com exatamente 5 buracos — 0046, 0047, 0111, 0221 e 0288 —
 * todos ocupados por vendas íntegras da loja-1. Este arquivo prova que a tentativa da
 * loja-2 de gravar `VDA-2026-0046` é bloqueada fail-closed e que a venda da loja-1
 * permanece intacta em todos os campos críticos.
 *
 * Fake `tx` com estado MULTI-LOJA: `venda.findUnique` respeita o dono real do `pedidoId`
 * e cada tabela registra o `storeId` gravado, permitindo asserções de "nada foi escrito".
 */
import { describe, expect, it } from "vitest"
import {
  upsertVendaInTransaction,
  PedidoIdDeOutraLojaError,
  CaixaOriginalFechadoError,
  type SalePayload,
} from "./ops-upsert-venda"

const LOJA_1 = "loja-1"
const LOJA_2 = "loja-2"

type FakeVenda = {
  id: string
  pedidoId: string
  storeId: string
  payload: unknown
  total: number
  at: Date
}
type FakeSessao = { id: string; storeId: string; status: "ABERTA" | "FECHADA" }

/** Fake `tx` multi-loja com estado — reflete o dono real de cada `pedidoId`. */
function makeMultiLojaFakeDb(vendasIniciais: FakeVenda[], sessoes: FakeSessao[]) {
  const vendas = new Map<string, FakeVenda>(vendasIniciais.map((v) => [v.pedidoId, v]))
  const itensPorVenda = new Map<string, Array<{ nome: string; quantidade: number }>>()
  const itensApagados: string[] = []
  const movimentacoesEstoque: Array<{ storeId: string; documento: string }> = []
  const movimentacoesFinanceiras: Array<{ storeId: string; referenciaId: string; valor: number }> = []
  const titulos: Array<{ storeId: string; localKey: string }> = []
  const produtoUpdates: Array<{ id: string; decremento: number }> = []
  let vendaSeq = vendasIniciais.length

  // Itens pré-existentes da loja-1 (para provar que não são apagados no bloqueio).
  for (const v of vendasIniciais) {
    itensPorVenda.set(v.id, [{ nome: "Pelicula 3D vidro", quantidade: 1 }])
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function makeTx(): any {
    return {
      cliente: { findFirst: async () => null },
      venda: {
        findUnique: async ({ where }: any) => {
          const v = vendas.get(where.pedidoId)
          return v ? { id: v.id, storeId: v.storeId, pedidoId: v.pedidoId } : null
        },
        upsert: async ({ where, create, update }: any) => {
          const existing = vendas.get(where.pedidoId)
          if (existing) {
            // Espelha o Prisma: aplica exatamente os campos presentes no `update`.
            if ("storeId" in update) existing.storeId = update.storeId
            if ("payload" in update) existing.payload = update.payload
            if ("total" in update) existing.total = update.total
            if ("at" in update) existing.at = update.at
            return { id: existing.id }
          }
          const id = `venda-${++vendaSeq}`
          vendas.set(where.pedidoId, {
            id,
            pedidoId: where.pedidoId,
            storeId: create.storeId,
            payload: create.payload,
            total: create.total,
            at: create.at,
          })
          return { id }
        },
        update: async () => ({}),
      },
      itemVenda: {
        deleteMany: async ({ where }: any) => {
          itensApagados.push(where.vendaId)
          const antes = itensPorVenda.get(where.vendaId)?.length ?? 0
          itensPorVenda.set(where.vendaId, [])
          return { count: antes }
        },
        create: async ({ data }: any) => {
          const lista = itensPorVenda.get(data.vendaId) ?? []
          lista.push({ nome: data.nome, quantidade: data.quantidade })
          itensPorVenda.set(data.vendaId, lista)
          return data
        },
      },
      produto: {
        findFirst: async () => null,
        findUnique: async () => null,
        updateMany: async ({ where, data }: any) => {
          produtoUpdates.push({ id: where.id, decremento: data.stock?.decrement ?? 0 })
          return { count: 1 }
        },
        update: async () => ({}),
      },
      movimentacaoEstoque: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          movimentacoesEstoque.push({ storeId: data.storeId, documento: data.documento })
          return data
        },
      },
      movimentacaoFinanceira: {
        findFirst: async ({ where }: any) =>
          movimentacoesFinanceiras.find(
            (m) => m.referenciaId === where.referenciaId && m.storeId === where.storeId,
          ) ?? null,
        create: async ({ data }: any) => {
          movimentacoesFinanceiras.push({
            storeId: data.storeId,
            referenciaId: data.referenciaId,
            valor: data.valor,
          })
          return data
        },
      },
      contaReceberTitulo: {
        upsert: async ({ where }: any) => {
          titulos.push({
            storeId: where.storeId_localKey.storeId,
            localKey: where.storeId_localKey.localKey,
          })
          return { id: where.storeId_localKey.localKey }
        },
      },
      sessaoCaixa: {
        findFirst: async ({ where }: any) => {
          const m = sessoes.find((s) => {
            if (where.id !== undefined && s.id !== where.id) return false
            if (where.storeId !== undefined && s.storeId !== where.storeId) return false
            if (where.status !== undefined && s.status !== where.status) return false
            return true
          })
          return m ? { id: m.id, status: m.status } : null
        },
      },
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    makeTx,
    vendas,
    itensPorVenda,
    itensApagados,
    movimentacoesEstoque,
    movimentacoesFinanceiras,
    titulos,
    produtoUpdates,
  }
}

/** `VDA-2026-0046` como está no banco hoje: loja-1, 25/05, R$ 25,00, 1 item. */
function vendaDaLoja1(): FakeVenda {
  return {
    id: "venda-loja1-0046",
    pedidoId: "VDA-2026-0046",
    storeId: LOJA_1,
    payload: { id: "VDA-2026-0046", total: 25, lines: [{ inventoryId: "p-pelicula", quantity: 1 }] },
    total: 25,
    at: new Date("2026-05-25T17:59:00.000Z"),
  }
}

/**
 * `syncPending`/`syncBlockedCode` NÃO fazem parte de `SalePayload` (é justamente o
 * contrato do servidor). O PDV, porém, envia o `SaleRecord` inteiro — este tipo modela
 * exatamente esse envio "sujo" que chega na rota.
 */
type SaleEnviadaPeloPdv = SalePayload & { syncPending?: boolean; syncBlockedCode?: string }

/** Tentativa da loja-2: mesma numeração, venda real de 14/06 por R$ 169,99. */
function vendaDaLoja2(over: Partial<SaleEnviadaPeloPdv> = {}): SaleEnviadaPeloPdv {
  return {
    id: "VDA-2026-0046",
    total: 169.99,
    at: "2026-06-14T14:30:00.000Z",
    sessaoId: "sess-loja2-14-06",
    paymentBreakdown: { dinheiro: 169.99 } as SalePayload["paymentBreakdown"],
    lines: [{ inventoryId: "__avulso__1", name: "Brinquedo", quantity: 1, unitPrice: 169.99, isAvulso: true }],
    ...over,
  }
}

const LIVE = { enforceStock: true, requireCaixaSession: true } as const

describe("upsertVendaInTransaction — guard de colisão de pedidoId entre lojas", () => {
  it("1. pedidoId inexistente → cria a venda normalmente", async () => {
    const db = makeMultiLojaFakeDb([], [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "ABERTA" }])
    await expect(
      upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, LIVE),
    ).resolves.toBeUndefined()
    expect(db.vendas.get("VDA-2026-0046")?.storeId).toBe(LOJA_2)
    expect(db.movimentacoesFinanceiras).toHaveLength(1)
  })

  it("2. pedidoId existente na MESMA loja → caminho idempotente preservado", async () => {
    const db = makeMultiLojaFakeDb([], [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "ABERTA" }])
    const sale = vendaDaLoja2()
    await upsertVendaInTransaction(db.makeTx(), LOJA_2, sale, undefined, LIVE)
    await upsertVendaInTransaction(db.makeTx(), LOJA_2, sale, undefined, LIVE)
    expect(db.vendas.size).toBe(1)
    expect(db.movimentacoesFinanceiras).toHaveLength(1) // sem duplicar financeiro
    expect(db.vendas.get("VDA-2026-0046")?.storeId).toBe(LOJA_2)
  })

  it("3. pedidoId existente em OUTRA loja → PedidoIdDeOutraLojaError (PEDIDO_ID_DE_OUTRA_LOJA)", async () => {
    const db = makeMultiLojaFakeDb(
      [vendaDaLoja1()],
      [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "ABERTA" }],
    )
    const err = await upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, LIVE).catch(
      (e) => e,
    )
    expect(err).toBeInstanceOf(PedidoIdDeOutraLojaError)
    expect(err.code).toBe("PEDIDO_ID_DE_OUTRA_LOJA")
    expect(err.ownerStoreId).toBe(LOJA_1)
    expect(err.pedidoId).toBe("VDA-2026-0046")
  })

  it("4. no conflito entre lojas NADA é escrito e a venda da loja-1 fica intacta", async () => {
    const original = vendaDaLoja1()
    const snapshot = { ...original, payload: JSON.stringify(original.payload) }
    const db = makeMultiLojaFakeDb(
      [original],
      [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "ABERTA" }],
    )

    await expect(
      upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, LIVE),
    ).rejects.toBeInstanceOf(PedidoIdDeOutraLojaError)

    const depois = db.vendas.get("VDA-2026-0046")!
    // Venda da loja-1: campos críticos byte-a-byte iguais.
    expect(depois.storeId).toBe(snapshot.storeId)
    expect(depois.total).toBe(snapshot.total)
    expect(depois.at).toBe(snapshot.at)
    expect(JSON.stringify(depois.payload)).toBe(snapshot.payload)
    expect(db.vendas.size).toBe(1) // nenhuma venda nova da loja-2
    // Itens da loja-1 preservados: nenhum deleteMany, nenhum create.
    expect(db.itensApagados).toHaveLength(0)
    expect(db.itensPorVenda.get(original.id)).toHaveLength(1)
    // Zero efeito colateral em qualquer loja.
    expect(db.movimentacoesEstoque).toHaveLength(0)
    expect(db.movimentacoesFinanceiras).toHaveLength(0)
    expect(db.titulos).toHaveLength(0)
    expect(db.produtoUpdates).toHaveLength(0)
  })

  it("5. allowClosedOriginalSession NÃO contorna o guard (colisão tem precedência)", async () => {
    // Sessão original da loja-2 FECHADA: sem colisão isto daria CAIXA_ORIGINAL_FECHADO e,
    // com o flag manual, gravaria. Com colisão, o bloqueio vem antes e é definitivo.
    const db = makeMultiLojaFakeDb(
      [vendaDaLoja1()],
      [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "FECHADA" }],
    )
    const err = await upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PedidoIdDeOutraLojaError)
    expect(err).not.toBeInstanceOf(CaixaOriginalFechadoError)
    expect(db.vendas.get("VDA-2026-0046")!.storeId).toBe(LOJA_1)
    expect(db.movimentacoesFinanceiras).toHaveLength(0)
  })

  it("5b. sem colisão, CAIXA_ORIGINAL_FECHADO legítimo same-store segue igual", async () => {
    const db = makeMultiLojaFakeDb([], [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "FECHADA" }])
    await expect(
      upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaOriginalFechadoError)
    // E a ação manual continua sendo o único caminho que persiste.
    await upsertVendaInTransaction(db.makeTx(), LOJA_2, vendaDaLoja2(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    expect(db.vendas.get("VDA-2026-0046")?.storeId).toBe(LOJA_2)
  })

  it("12. isolamento: a mesma venda numa terceira loja também é bloqueada", async () => {
    const db = makeMultiLojaFakeDb(
      [vendaDaLoja1()],
      [{ id: "sess-loja3", storeId: "loja-3", status: "ABERTA" }],
    )
    const err = await upsertVendaInTransaction(
      db.makeTx(),
      "loja-3",
      vendaDaLoja2({ sessaoId: "sess-loja3" }),
      undefined,
      LIVE,
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PedidoIdDeOutraLojaError)
    expect(db.vendas.get("VDA-2026-0046")!.storeId).toBe(LOJA_1)
  })
})

describe("upsertVendaInTransaction — campos client-only fora de Venda.payload", () => {
  const sessaoAberta: FakeSessao[] = [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "ABERTA" }]

  it("6. venda enviada com syncPending: true é gravada SEM o campo", async () => {
    const db = makeMultiLojaFakeDb([], sessaoAberta)
    await upsertVendaInTransaction(
      db.makeTx(),
      LOJA_2,
      vendaDaLoja2({ syncPending: true }),
      undefined,
      LIVE,
    )
    const payload = db.vendas.get("VDA-2026-0046")!.payload as Record<string, unknown>
    expect("syncPending" in payload).toBe(false)
    // Campos legítimos continuam (blacklist, não whitelist).
    expect(payload.total).toBe(169.99)
    expect(payload.sessaoId).toBe("sess-loja2-14-06")
    expect(Array.isArray(payload.lines)).toBe(true)
  })

  it("7. venda enviada com syncBlockedCode é gravada SEM o campo", async () => {
    const db = makeMultiLojaFakeDb([], sessaoAberta)
    await upsertVendaInTransaction(
      db.makeTx(),
      LOJA_2,
      vendaDaLoja2({ syncPending: true, syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }),
      undefined,
      LIVE,
    )
    const payload = db.vendas.get("VDA-2026-0046")!.payload as Record<string, unknown>
    expect("syncBlockedCode" in payload).toBe(false)
    expect("syncPending" in payload).toBe(false)
  })

  it("7b. o objeto `sale` do caller não é mutado pelo saneamento", async () => {
    const db = makeMultiLojaFakeDb([], sessaoAberta)
    const sale = vendaDaLoja2({ syncPending: true })
    await upsertVendaInTransaction(db.makeTx(), LOJA_2, sale, undefined, LIVE)
    expect(sale.syncPending).toBe(true)
  })

  it("7c. caminho retroativo: sem marcadores locais, com metadados oficiais do servidor", async () => {
    const db = makeMultiLojaFakeDb([], [{ id: "sess-loja2-14-06", storeId: LOJA_2, status: "FECHADA" }])
    await upsertVendaInTransaction(
      db.makeTx(),
      LOJA_2,
      vendaDaLoja2({ syncPending: true, syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }),
      undefined,
      { ...LIVE, allowClosedOriginalSession: true },
    )
    const payload = db.vendas.get("VDA-2026-0046")!.payload as Record<string, unknown>
    expect("syncPending" in payload).toBe(false)
    expect("syncBlockedCode" in payload).toBe(false)
    expect(payload.retroactiveSync).toBe(true)
    expect(payload.originalSessionClosed).toBe(true)
    expect(payload.reason).toBe("pending_sale_closed_original_session")
    expect(typeof payload.syncedAt).toBe("string")
  })
})
