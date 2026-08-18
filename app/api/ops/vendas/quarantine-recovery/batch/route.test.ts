import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-1"

const h = vi.hoisted(() => ({
  persist: vi.fn(),
  gate: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  vendaUpdate: vi.fn(),
  vendaUpdateMany: vi.fn(),
  vendaDelete: vi.fn(),
  vendaDeleteMany: vi.fn(),
  vendaUpsert: vi.fn(),
  vendaCreate: vi.fn(),
  sessaoFindFirst: vi.fn(),
  sessaoFindMany: vi.fn(),
  produtoFindFirst: vi.fn(),
  ensureConnected: vi.fn(async () => undefined),
  requireAdmin: vi.fn(),
  canAccessStore: vi.fn(() => true),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    venda: {
      findFirst: h.findFirst,
      findUnique: h.findUnique,
      update: h.vendaUpdate,
      updateMany: h.vendaUpdateMany,
      delete: h.vendaDelete,
      deleteMany: h.vendaDeleteMany,
      upsert: h.vendaUpsert,
      create: h.vendaCreate,
    },
    sessaoCaixa: { findFirst: h.sessaoFindFirst, findMany: h.sessaoFindMany },
    produto: { findFirst: h.produtoFindFirst },
  },
  prismaEnsureConnected: h.ensureConnected,
}))
vi.mock("@/lib/ops-api-gate", () => ({
  opsLojaIdFromRequestForWrite: () => STORE,
}))
vi.mock("@/lib/require-admin", () => ({ requireAdmin: h.requireAdmin }))
vi.mock("@/lib/auth/enterprise-permissions", () => ({ canAccessStore: h.canAccessStore }))
vi.mock("@/lib/auth/session-operator", () => ({ getOperatorLabelFromSession: () => "Admin" }))
vi.mock("@/lib/vendas/sale-writer-v2", () => ({ persistSaleV2: h.persist }))
vi.mock("@/lib/vendas/sale-numbering-runtime-gate", () => ({
  resolveSaleNumberingWriter: h.gate,
}))

import { POST } from "./route"

/** Ocupante do número antigo — nunca deve ser alterada. */
function occupantFor(pedidoId: string) {
  return {
    id: `venda-occ-${pedidoId}`,
    storeId: STORE,
    pedidoId,
    clientSaleId: "cs_occupant_aaaaaa",
    payload: {
      id: pedidoId,
      total: 240,
      at: "2026-06-15T10:00:00.000Z",
      lines: [{ inventoryId: "p1", name: "Outro", quantity: 1, unitPrice: 240 }],
      paymentBreakdown: { pix: 240 },
    },
    total: 240,
    at: new Date("2026-06-15T10:00:00.000Z"),
    clienteNome: "Cliente Ocupante",
    clienteId: null,
    terminalId: null,
    status: "concluida",
  }
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "VDA-2026-0615",
    clientSaleId: "cs_attempt_bbbbbb",
    syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    at: "2026-06-15T18:00:00.000Z",
    total: 18,
    sessaoId: "sess-original-1",
    customerName: "Consumidor",
    lines: [{ inventoryId: "p-tvbox", name: "CONTROLE TV BOX", quantity: 1, unitPrice: 18 }],
    paymentBreakdown: { dinheiro: 18 },
    ...overrides,
  }
}

function req(body: unknown) {
  return new Request("http://local/api/ops/vendas/quarantine-recovery/batch?storeId=loja-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Aloca um número server-side novo a cada chamada. */
function persistAllocating() {
  let seq = 0
  return async (input: { storeId: string; clientSaleId: string; sale: { at?: string } }) => {
    seq += 1
    return {
      replayed: false,
      fingerprint: `fp-${seq}`,
      venda: {
        id: `venda-nova-${seq}`,
        storeId: input.storeId,
        pedidoId: `VDA-RC02-2026-${String(seq).padStart(6, "0")}`,
        clientSaleId: input.clientSaleId,
        total: 18,
        at: input.sale.at ?? "2026-06-15T18:00:00.000Z",
        clienteNome: "Consumidor",
        clienteId: null,
        terminalId: null,
        status: "concluida",
      },
    }
  }
}

/** Nenhuma escrita direta em `Venda` fora do motor de persistência. */
function expectOccupantUntouched() {
  expect(h.vendaUpdate).not.toHaveBeenCalled()
  expect(h.vendaUpdateMany).not.toHaveBeenCalled()
  expect(h.vendaDelete).not.toHaveBeenCalled()
  expect(h.vendaDeleteMany).not.toHaveBeenCalled()
  expect(h.vendaUpsert).not.toHaveBeenCalled()
  expect(h.vendaCreate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockReturnValue({ writer: "v2", reason: "enabled" })
  h.requireAdmin.mockResolvedValue({ ok: true, session: { user: { id: "admin-1" } } })
  h.canAccessStore.mockReturnValue(true)
  h.findFirst.mockResolvedValue(null)
  h.findUnique.mockImplementation(async ({ where }: { where: { pedidoId: string } }) =>
    occupantFor(where.pedidoId),
  )
  h.sessaoFindFirst.mockResolvedValue({ id: "sess-original-1", status: "ABERTA" })
  h.sessaoFindMany.mockResolvedValue([])
  h.produtoFindFirst.mockResolvedValue({ id: "prod-tvbox", name: "CONTROLE TV BOX", stock: 50 })
  h.persist.mockImplementation(persistAllocating())
})

describe("POST /api/ops/vendas/quarantine-recovery/batch", () => {
  it("recupera 3 vendas independentes, cada uma com número novo", async () => {
    const res = await POST(
      req({
        motivo: "recuperacao administrada do incidente",
        candidates: [
          candidate({ id: "VDA-2026-0615", clientSaleId: "cs_attempt_111111" }),
          candidate({ id: "VDA-2026-0616", clientSaleId: "cs_attempt_222222" }),
          candidate({ id: "VDA-2026-0617", clientSaleId: "cs_attempt_333333" }),
        ],
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 3, recovered: 3, blocked: 0, failed: 0 })
    expect(h.persist).toHaveBeenCalledTimes(3)

    const novos = json.results.map((r: { venda: { pedidoId: string } }) => r.venda.pedidoId)
    expect(new Set(novos).size).toBe(3)
    for (const pedidoId of novos) {
      expect(pedidoId).toMatch(/^VDA-RC02-2026-\d{6}$/)
    }
    expectOccupantUntouched()
  })

  it("preserva clientSaleId e move o número antigo para a trilha de auditoria", async () => {
    await POST(
      req({
        motivo: "colisao de numero comercial",
        candidates: [candidate()],
      }),
    )
    const call = h.persist.mock.calls[0][0]
    expect(call.clientSaleId).toBe("cs_attempt_bbbbbb")
    expect(call.sale.clientSaleId).toBe("cs_attempt_bbbbbb")
    // O número antigo existe SOMENTE como metadado de recuperação.
    expect(call.sale.recovery).toMatchObject({
      recoveredFromPedidoId: "VDA-2026-0615",
      motivo: "colisao de numero comercial",
      conflictCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
      occupantStoreId: STORE,
      mode: "historical-recovery",
    })
    expect(call.options.enforceStock).toBe(false)
    // Nenhum `pedidoId` é imposto ao motor: quem aloca é o servidor.
    expect(call).not.toHaveProperty("pedidoId")
    expect(call.sale).not.toHaveProperty("pedidoId")
  })

  it("grava occupantStoreId real da loja-B sem alterar a ocupante", async () => {
    h.findUnique.mockImplementation(async ({ where }: { where: { pedidoId: string } }) => ({
      ...occupantFor(where.pedidoId),
      storeId: "loja-B",
    }))
    const res = await POST(
      req({
        motivo: "colisao de numero comercial",
        candidates: [candidate({ syncBlockedCode: "PEDIDO_ID_DE_OUTRA_LOJA" })],
      }),
    )
    expect(res.status).toBe(200)
    const call = h.persist.mock.calls[0][0]
    expect(call.storeId).toBe(STORE)
    expect(call.sale.recovery).toMatchObject({
      recoveredFromPedidoId: "VDA-2026-0615",
      motivo: "colisao de numero comercial",
      conflictCode: "PEDIDO_ID_DE_OUTRA_LOJA",
      occupantStoreId: "loja-B",
    })
    expect(call.sale.recovery.occupantStoreId).not.toBe("other")
    expectOccupantUntouched()
  })

  it("a mesma venda executada duas vezes não cria segunda venda", async () => {
    const body = { motivo: "retry do lote", candidates: [candidate()] }

    const first = await POST(req(body))
    expect((await first.json()).summary).toMatchObject({ recovered: 1 })
    expect(h.persist).toHaveBeenCalledTimes(1)

    // Segunda passada: a venda já existe sob `(storeId, clientSaleId)`.
    h.findFirst.mockResolvedValue({
      id: "venda-nova-1",
      storeId: STORE,
      pedidoId: "VDA-RC02-2026-000001",
      clientSaleId: "cs_attempt_bbbbbb",
      payload: candidate(),
      total: 18,
      at: new Date("2026-06-15T18:00:00.000Z"),
      clienteNome: "Consumidor",
      clienteId: null,
      terminalId: null,
      status: "concluida",
    })
    const second = await POST(req(body))
    const json = await second.json()
    expect(json.summary).toMatchObject({ total: 1, alreadyRecovered: 1, recovered: 0 })
    expect(json.results[0].replayed).toBe(true)
    expect(json.results[0].venda.pedidoId).toBe("VDA-RC02-2026-000001")
    // Nenhuma escrita nova: estoque, caixa, financeiro, CR e vale intocados.
    expect(h.persist).toHaveBeenCalledTimes(1)
    expectOccupantUntouched()
  })

  it("a MESMA venda duplicada DENTRO de um lote cria apenas uma", async () => {
    // Os fatos são relidos por item, então a segunda ocorrência já encontra a venda
    // criada pela primeira e vira replay — sem segunda venda, sem segundo efeito.
    let criada: {
      id: string
      storeId: string
      pedidoId: string
      clientSaleId: string
      payload: unknown
      total: number
      at: Date
      clienteNome: string | null
      clienteId: string | null
      terminalId: string | null
      status: string
    } | null = null
    h.findFirst.mockImplementation(async () => criada)
    h.persist.mockImplementation(async (input: { storeId: string; clientSaleId: string }) => {
      criada = {
        id: "venda-nova-1",
        storeId: input.storeId,
        pedidoId: "VDA-RC02-2026-000001",
        clientSaleId: input.clientSaleId,
        payload: candidate(),
        total: 18,
        at: new Date("2026-06-15T18:00:00.000Z"),
        clienteNome: "Consumidor",
        clienteId: null,
        terminalId: null,
        status: "concluida",
      }
      return { replayed: false, fingerprint: "fp", venda: { ...criada, at: criada.at.toISOString() } }
    })

    const res = await POST(
      req({
        motivo: "lote com entrada duplicada",
        candidates: [candidate(), candidate()],
      }),
    )
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 2, recovered: 1, alreadyRecovered: 1 })
    expect(h.persist).toHaveBeenCalledTimes(1)
    // As duas linhas apontam para a MESMA venda server-side.
    expect(json.results[0].venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expect(json.results[1].venda.pedidoId).toBe("VDA-RC02-2026-000001")
    expectOccupantUntouched()
  })

  it("item bloqueado não impede os demais e o resultado é parcial", async () => {
    const res = await POST(
      req({
        motivo: "recuperacao administrada do incidente",
        candidates: [
          candidate({ id: "VDA-2026-0615", clientSaleId: "cs_attempt_111111" }),
          // Payload corrompido: sem itens.
          candidate({ id: "VDA-2026-0616", clientSaleId: "cs_attempt_222222", lines: [] }),
          candidate({ id: "VDA-2026-0617", clientSaleId: "cs_attempt_333333" }),
        ],
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 3, recovered: 2, blocked: 1 })
    expect(json.results[1]).toMatchObject({ status: "BLOCKED", code: "INVALID_PAYLOAD" })
    expect(json.results[1].reason).toBeTruthy()
    expect(h.persist).toHaveBeenCalledTimes(2)
    expectOccupantUntouched()
  })

  it("falha de infraestrutura em um item é isolada — as demais seguem", async () => {
    let call = 0
    h.persist.mockImplementation(async (input: { storeId: string; clientSaleId: string; sale: { at?: string } }) => {
      call += 1
      if (call === 2) throw new Error("connection reset")
      return persistAllocating()(input)
    })
    const res = await POST(
      req({
        motivo: "recuperacao administrada do incidente",
        candidates: [
          candidate({ id: "VDA-2026-0615", clientSaleId: "cs_attempt_111111" }),
          candidate({ id: "VDA-2026-0616", clientSaleId: "cs_attempt_222222" }),
          candidate({ id: "VDA-2026-0617", clientSaleId: "cs_attempt_333333" }),
        ],
      }),
    )
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 3, recovered: 2, failed: 1 })
    expect(json.results[1]).toMatchObject({ status: "FAILED" })
    expect(json.results[1].reason).toContain("connection reset")
    // O item que falhou permanece recuperável num retry posterior.
    expect(json.results[2].status).toBe("RECOVERED")
  })

  it("sessão original FECHADA fica em REQUIRES_CONFIRMATION sem autorização", async () => {
    h.sessaoFindFirst.mockResolvedValue({ status: "FECHADA" })
    const res = await POST(
      req({ motivo: "recuperacao administrada", candidates: [candidate()] }),
    )
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 1, requiresConfirmation: 1, recovered: 0 })
    expect(json.results[0]).toMatchObject({
      status: "REQUIRES_CONFIRMATION",
      code: "CAIXA_ORIGINAL_FECHADO",
    })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("sessão original FECHADA com autorização lança na PRÓPRIA sessão original", async () => {
    h.sessaoFindFirst.mockResolvedValue({ status: "FECHADA" })
    const res = await POST(
      req({
        motivo: "recuperacao administrada",
        candidates: [candidate()],
        allowClosedOriginalSession: true,
      }),
    )
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 1, recovered: 1 })
    const call = h.persist.mock.calls[0][0]
    expect(call.options).toMatchObject({
      allowClosedOriginalSession: true,
      requireCaixaSession: true,
      enforceStock: false,
    })
    // A sessão original é preservada no payload — nunca trocada pela sessão de hoje.
    expect(call.sale.sessaoId).toBe("sess-original-1")
    expect(call.sale.recovery).toMatchObject({
      mode: "historical-recovery",
      caixaPolicy: "original-session",
    })
  })

  it("venda de outra loja é bloqueada por STORE_MISMATCH", async () => {
    const res = await POST(
      req({
        motivo: "recuperacao administrada",
        candidates: [candidate({ storeId: "loja-2" })],
      }),
    )
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: "BLOCKED", code: "STORE_MISMATCH" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("duas quarentenas com o MESMO número antigo geram dois números novos distintos", async () => {
    const res = await POST(
      req({
        motivo: "duas tentativas colidiram no mesmo numero",
        candidates: [
          candidate({ clientSaleId: "cs_attempt_111111" }),
          candidate({ clientSaleId: "cs_attempt_222222" }),
        ],
      }),
    )
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 2, recovered: 2 })
    expect(json.results[0].venda.pedidoId).not.toBe(json.results[1].venda.pedidoId)
    expect(json.results[0].conflictingPedidoId).toBe(json.results[1].conflictingPedidoId)
    expectOccupantUntouched()
  })

  it("A: estoque atual insuficiente recupera a venda histórica (enforceStock desligado)", async () => {
    h.produtoFindFirst.mockResolvedValue({ id: "prod-tvbox", name: "CONTROLE TV BOX", stock: 0 })
    const res = await POST(
      req({ motivo: "recuperacao administrada historica", candidates: [candidate()] }),
    )
    const json = await res.json()
    expect(json.results[0].status).toBe("RECOVERED")
    const call = h.persist.mock.calls[0][0]
    expect(call.options.enforceStock).toBe(false)
    expect(call.sale.recovery.stockPolicy).toBe("historical-ledger-allows-deficit")
    expect(call.sale.recovery.stockShortfalls[0]).toMatchObject({
      disponivel: 0,
      necessario: 1,
    })
    expectOccupantUntouched()
  })

  it("B: quantidade histórica maior que o saldo atual persiste com déficit no ledger", async () => {
    h.produtoFindFirst.mockResolvedValue({ id: "prod-tvbox", name: "CONTROLE TV BOX", stock: 1 })
    const res = await POST(
      req({
        motivo: "recuperacao administrada historica",
        candidates: [
          candidate({
            lines: [{ inventoryId: "p-tvbox", name: "CONTROLE TV BOX", quantity: 3, unitPrice: 6 }],
            total: 18,
          }),
        ],
      }),
    )
    const json = await res.json()
    expect(json.results[0].status).toBe("RECOVERED")
    const call = h.persist.mock.calls[0][0]
    expect(call.options.enforceStock).toBe(false)
    expect(call.sale.recovery.stockShortfalls[0]).toMatchObject({
      disponivel: 1,
      necessario: 3,
    })
    expect(call.sale.lines[0].quantity).toBe(3)
  })

  it("F: produto sem cadastro atual persiste via snapshot histórico", async () => {
    h.produtoFindFirst.mockResolvedValue(null)
    const res = await POST(
      req({ motivo: "recuperacao administrada historica", candidates: [candidate()] }),
    )
    const json = await res.json()
    expect(json.results[0].status).toBe("RECOVERED")
    const call = h.persist.mock.calls[0][0]
    expect(call.options.enforceStock).toBe(false)
    expect(call.sale.recovery.unresolvedInventoryIds).toEqual(["p-tvbox"])
    expect(call.sale.lines[0]).toMatchObject({
      inventoryId: "p-tvbox",
      name: "CONTROLE TV BOX",
      quantity: 1,
      unitPrice: 18,
    })
  })

  it("H: sem sessão identificável persiste a venda e NÃO usa o caixa atual", async () => {
    const { sessaoId, ...semSessao } = candidate()
    void sessaoId
    const res = await POST(
      req({ motivo: "recuperacao administrada historica", candidates: [semSessao] }),
    )
    const json = await res.json()
    expect(json.results[0].status).toBe("RECOVERED")
    const call = h.persist.mock.calls[0][0]
    expect(call.options).toMatchObject({
      enforceStock: false,
      requireCaixaSession: false,
      allowClosedOriginalSession: false,
    })
    expect(call.sale.sessaoId).toBeNull()
    expect(call.sale.recovery.caixaPolicy).toBe("unidentified-session-no-current-caixa")
  })

  it("usa a única sessão histórica correspondente quando o payload não traz sessaoId", async () => {
    const { sessaoId, ...semSessao } = candidate({ terminalId: "PDV1" })
    void sessaoId
    h.sessaoFindMany.mockResolvedValue([{ id: "sess-hist-1", status: "FECHADA" }])
    const res = await POST(
      req({
        motivo: "recuperacao administrada historica",
        candidates: [semSessao],
        allowClosedOriginalSession: true,
      }),
    )
    const json = await res.json()
    expect(json.results[0].status).toBe("RECOVERED")
    const call = h.persist.mock.calls[0][0]
    expect(call.sale.sessaoId).toBe("sess-hist-1")
    expect(call.options).toMatchObject({
      enforceStock: false,
      requireCaixaSession: true,
      allowClosedOriginalSession: true,
    })
    expect(call.sale.recovery.caixaPolicy).toBe("original-session")
  })

  // ── Gates de entrada ──────────────────────────────────────────────────────

  it("bloqueia o lote inteiro quando o writer V1 está ativo", async () => {
    h.gate.mockReturnValue({ writer: "v1", reason: "flag-absent" })
    const res = await POST(
      req({ motivo: "recuperacao administrada", candidates: [candidate()] }),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: "SALE_WRITER_V1_ACTIVE" })
    expect(h.persist).not.toHaveBeenCalled()
    expectOccupantUntouched()
  })

  it("exige motivo com no mínimo 5 caracteres", async () => {
    const res = await POST(req({ motivo: "abc", candidates: [candidate()] }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "MOTIVO_REQUIRED" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("exige candidates não vazio", async () => {
    const res = await POST(req({ motivo: "recuperacao administrada", candidates: [] }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "CANDIDATES_REQUIRED" })
  })

  it("recusa lote acima do teto", async () => {
    const res = await POST(
      req({
        motivo: "recuperacao administrada",
        candidates: Array.from({ length: 501 }, (_, i) =>
          candidate({ clientSaleId: `cs_attempt_${String(i).padStart(6, "0")}` }),
        ),
      }),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: "TOO_MANY_CANDIDATES" })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it("nega acesso a loja fora do escopo da sessão", async () => {
    h.canAccessStore.mockReturnValue(false)
    const res = await POST(
      req({ motivo: "recuperacao administrada", candidates: [candidate()] }),
    )
    expect(res.status).toBe(403)
    expect(h.persist).not.toHaveBeenCalled()
  })
})
