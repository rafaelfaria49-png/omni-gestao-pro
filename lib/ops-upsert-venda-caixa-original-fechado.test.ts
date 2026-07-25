/**
 * GOAL: PDV-VENDA-PENDENTE-SESSAO-FECHADA-RETROATIVA-002
 *
 * Regressão do cenário `VDA-2026-0406`: venda pendente de 30/06 (Pix, R$45,00)
 * falhando o reenvio com HTTP 409 `CAIXA_FECHADO`, mesmo com o caixa de HOJE aberto —
 * porque a venda carrega a `sessaoId` ORIGINAL de 30/06, que já foi fechada pelo
 * fechamento diário (`SessaoCaixa.status = "FECHADA"`).
 *
 * Cobre a distinção introduzida em `upsertVendaInTransaction` (§0):
 *  - sessão referenciada INEXISTENTE ou de OUTRA loja → `CaixaSessaoInvalidaError`
 *    (código `CAIXA_FECHADO`) — igual a antes, nunca contornável por flag;
 *  - sessão referenciada EXISTE e é desta loja mas está `FECHADA` → sem
 *    `allowClosedOriginalSession`, `CaixaOriginalFechadoError` (código
 *    `CAIXA_ORIGINAL_FECHADO`); com o flag, persiste normalmente na PRÓPRIA sessão
 *    original (nunca no caixa atual), carimbando metadados de auditoria no payload.
 *
 * Usa um fake `tx` com estado (mesmo padrão de
 * `ops-upsert-venda-pix-aprazo-resync.test.ts`) para also verificar idempotência do
 * reenvio retroativo.
 */
import { describe, expect, it } from "vitest"
import {
  upsertVendaInTransaction,
  CaixaSessaoInvalidaError,
  CaixaOriginalFechadoError,
  type SalePayload,
} from "./ops-upsert-venda"

const STORE = "loja-1"

type FakeSessao = { id: string; storeId: string; status: "ABERTA" | "FECHADA" }

/** Fake tx com estado persistente entre chamadas — permite testar reenvio/idempotência. */
function makeStatefulFakeDb(sessoes: FakeSessao[]) {
  const vendas = new Map<string, { id: string; payload: unknown }>()
  const movimentacoesFinanceiras: Array<{ referenciaId: string; valor: number }> = []
  let vendaSeq = 0

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function makeTx(): any {
    return {
      cliente: { findFirst: async () => null },
      venda: {
        // Guard de colisão entre lojas (PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001):
        // fake single-store, então toda venda existente pertence a `STORE`.
        findUnique: async ({ where }: any) => {
          const existing = vendas.get(where.pedidoId)
          return existing ? { id: existing.id, storeId: STORE, pedidoId: where.pedidoId } : null
        },
        upsert: async ({ where, create }: any) => {
          const existing = vendas.get(where.pedidoId)
          if (existing) {
            existing.payload = create.payload
            return { id: existing.id }
          }
          const id = `venda-${++vendaSeq}`
          vendas.set(where.pedidoId, { id, payload: create.payload })
          return { id }
        },
        update: async () => ({}),
      },
      itemVenda: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
      produto: { findFirst: async () => null, findUnique: async () => null, updateMany: async () => ({ count: 1 }) },
      movimentacaoEstoque: { findFirst: async () => null, create: async () => ({}) },
      movimentacaoFinanceira: {
        findFirst: async ({ where }: any) =>
          movimentacoesFinanceiras.find((m) => m.referenciaId === where.referenciaId) ?? null,
        create: async ({ data }: any) => {
          movimentacoesFinanceiras.push({ referenciaId: data.referenciaId, valor: data.valor })
          return data
        },
      },
      contaReceberTitulo: { upsert: async ({ where }: any) => ({ id: where.storeId_localKey.localKey }) },
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

  return { makeTx, vendas, movimentacoesFinanceiras }
}

/** Venda VDA-2026-0406: Pix R$45, sessaoId de 30/06 no payload local. */
function vendaPixAntiga(over: Partial<SalePayload> = {}): SalePayload {
  return {
    id: "VDA-2026-0406",
    total: 45,
    at: "2026-06-30T13:30:00.000Z",
    sessaoId: "sess-30-06",
    paymentBreakdown: { pix: 45 } as SalePayload["paymentBreakdown"],
    lines: [{ inventoryId: "__avulso__1", name: "Item", quantity: 1, unitPrice: 45, isAvulso: true }],
    ...over,
  }
}

const LIVE = { enforceStock: true, requireCaixaSession: true } as const

describe("upsertVendaInTransaction — CAIXA_ORIGINAL_FECHADO (VDA-2026-0406)", () => {
  it("1. sessaoId presente e sessão ABERTA → comportamento normal (sem erro)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "ABERTA" }])
    await expect(
      upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, LIVE),
    ).resolves.toBeUndefined()
    expect(db.movimentacoesFinanceiras).toHaveLength(1)
  })

  it("2. sessaoId presente e sessão FECHADA sem flag → CaixaOriginalFechadoError (CAIXA_ORIGINAL_FECHADO)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    const err = await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, LIVE).catch((e) => e)
    expect(err).toBeInstanceOf(CaixaOriginalFechadoError)
    expect(err.code).toBe("CAIXA_ORIGINAL_FECHADO")
    // Nada gravado — a venda não deve existir no "banco" fake.
    expect(db.vendas.size).toBe(0)
    expect(db.movimentacoesFinanceiras).toHaveLength(0)
  })

  it("3. sessaoId presente e sessão FECHADA com flag → persiste venda na sessão original", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    expect(db.vendas.size).toBe(1)
    expect(db.movimentacoesFinanceiras).toHaveLength(1)
    expect(db.movimentacoesFinanceiras[0]!.valor).toBeCloseTo(45, 2)
  })

  it("4. sessão inexistente com flag → continua bloqueado (CaixaSessaoInvalidaError, flag não ajuda)", async () => {
    const db = makeStatefulFakeDb([]) // nenhuma sessão cadastrada
    const err = await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CaixaSessaoInvalidaError)
    expect(db.vendas.size).toBe(0)
  })

  it("4b. sessão de OUTRA loja com flag → continua bloqueado (CaixaSessaoInvalidaError)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: "loja-2", status: "FECHADA" }])
    const err = await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(CaixaSessaoInvalidaError)
  })

  it("5. venda retroativa mantém a data original (Venda.at = sale.at, não `agora`)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    let capturedAt: Date | undefined
    const tx = db.makeTx()
    const originalUpsert = tx.venda.upsert
    tx.venda.upsert = async (args: any) => {
      capturedAt = args.create.at
      return originalUpsert(args)
    }
    await upsertVendaInTransaction(tx, STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    expect(capturedAt?.toISOString()).toBe("2026-06-30T13:30:00.000Z")
  })

  it("6. venda retroativa carimba metadados de auditoria no payload (sessão original, não a atual)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    const stored = [...db.vendas.values()][0]!.payload as SalePayload
    expect(stored.retroactiveSync).toBe(true)
    expect(stored.originalSessionClosed).toBe(true)
    expect(stored.reason).toBe("pending_sale_closed_original_session")
    expect(typeof stored.syncedAt).toBe("string")
    // sessaoId do payload continua sendo o original — nunca reescrito para a sessão atual.
    expect(stored.sessaoId).toBe("sess-30-06")
  })

  it("7. reenvio retroativo é idempotente (2x com flag não duplica venda nem financeiro)", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    const sale = vendaPixAntiga()
    await upsertVendaInTransaction(db.makeTx(), STORE, sale, undefined, { ...LIVE, allowClosedOriginalSession: true })
    await upsertVendaInTransaction(db.makeTx(), STORE, sale, undefined, { ...LIVE, allowClosedOriginalSession: true })
    expect(db.vendas.size).toBe(1)
    expect(db.movimentacoesFinanceiras).toHaveLength(1)
  })

  it("8/9. sem flag (equivalente ao retry automático) permanece bloqueado — não força retroativo", async () => {
    // Simula o comportamento do retry automático (`flushPendingSales`), que NUNCA envia
    // `allowClosedOriginalSession`. Deve continuar falhando com o mesmo código específico,
    // preservando a venda pendente local (o caller não marca syncPending=false).
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    const err = await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, LIVE).catch((e) => e)
    expect(err).toBeInstanceOf(CaixaOriginalFechadoError)
    expect(db.vendas.size).toBe(0)
  })

  it("10. ação manual (com flag) é o único caminho que persiste a venda de sessão fechada", async () => {
    const db = makeStatefulFakeDb([{ id: "sess-30-06", storeId: STORE, status: "FECHADA" }])
    // 1ª tentativa sem flag falha.
    await expect(
      upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, LIVE),
    ).rejects.toBeInstanceOf(CaixaOriginalFechadoError)
    expect(db.vendas.size).toBe(0)
    // Ação manual explícita com flag persiste.
    await upsertVendaInTransaction(db.makeTx(), STORE, vendaPixAntiga(), undefined, {
      ...LIVE,
      allowClosedOriginalSession: true,
    })
    expect(db.vendas.size).toBe(1)
  })
})
