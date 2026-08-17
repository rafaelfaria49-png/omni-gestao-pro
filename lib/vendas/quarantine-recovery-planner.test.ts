import { describe, expect, it } from "vitest"

import {
  QUARANTINE_RECOVERY_BUCKET,
  QUARANTINE_RECOVERY_CLASS,
  bucketForClass,
  classifyQuarantineCandidate,
  isExecutableClass,
  planQuarantineRecovery,
  summarizeQuarantinePlan,
  type QuarantineCandidate,
  type QuarantineServerFacts,
} from "@/lib/vendas/quarantine-recovery-planner"

const STORE = "loja-1"

/** Venda em quarentena bem-formada: 1 item físico, dinheiro, sessão original aberta. */
function candidate(overrides: Partial<QuarantineCandidate> = {}): QuarantineCandidate {
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

function facts(overrides: Partial<QuarantineServerFacts> = {}): QuarantineServerFacts {
  return {
    alreadyRecoveredPedidoId: null,
    alreadyRecoveredVendaId: null,
    occupantExists: true,
    occupantStoreId: STORE,
    originalSessionStatus: "ABERTA",
    unresolvedInventoryIds: [],
    stockShortfalls: [],
    ...overrides,
  }
}

function classify(
  candidateOverrides: Partial<QuarantineCandidate> = {},
  factOverrides: Partial<QuarantineServerFacts> = {},
  storeId = STORE,
) {
  return classifyQuarantineCandidate({
    storeId,
    candidate: candidate(candidateOverrides),
    facts: facts(factOverrides),
  })
}

describe("classifyQuarantineCandidate", () => {
  it("READY quando há conflito real e a sessão original está aberta", () => {
    const item = classify()
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.READY)
    expect(item.bucket).toBe(QUARANTINE_RECOVERY_BUCKET.READY)
    expect(item.conflictingPedidoId).toBe("VDA-2026-0615")
    expect(item.clientSaleId).toBe("cs_attempt_bbbbbb")
    expect(item.valorAVista).toBe(18)
  })

  it("ALREADY_RECOVERED vence qualquer bloqueio — caso idempotente não é erro", () => {
    const item = classify(
      // Payload arruinado E sessão fechada E sem ocupante: ainda assim, se a venda já
      // existe no servidor sob a mesma identidade técnica, nada há a criar.
      { lines: [], total: Number.NaN },
      {
        alreadyRecoveredPedidoId: "VDA-RC02-2026-000099",
        alreadyRecoveredVendaId: "venda-b",
        occupantExists: false,
        originalSessionStatus: "FECHADA",
      },
    )
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.ALREADY_RECOVERED)
    expect(item.bucket).toBe(QUARANTINE_RECOVERY_BUCKET.ALREADY_RECOVERED)
    expect(item.alreadyRecoveredPedidoId).toBe("VDA-RC02-2026-000099")
    expect(isExecutableClass(item.klass)).toBe(false)
  })

  it("NOT_QUARANTINED quando o código local não é conflito de identidade", () => {
    expect(classify({ syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.NOT_QUARANTINED,
    )
    expect(classify({ syncBlockedCode: undefined }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.NOT_QUARANTINED,
    )
  })

  it("MISSING_CLIENT_SALE_ID quando a identidade técnica é ausente ou tem forma de VDA", () => {
    expect(classify({ clientSaleId: undefined }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.MISSING_CLIENT_SALE_ID,
    )
    // Um `pedidoId` NUNCA pode virar identidade técnica.
    expect(classify({ clientSaleId: "VDA-2026-0615" }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.MISSING_CLIENT_SALE_ID,
    )
  })

  it("STORE_MISMATCH quando a cópia local declara outra loja", () => {
    const item = classify({ storeId: "loja-2" })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.STORE_MISMATCH)
    expect(item.reason).toContain("loja-2")
  })

  it("INVALID_PAYLOAD quando os fatos centrais não são comparáveis", () => {
    expect(classify({ lines: [] }).klass).toBe(QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD)
    expect(classify({ total: "18" as unknown as number }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD,
    )
    expect(classify({ id: "   " }).klass).toBe(QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD)
  })

  it("OCCUPANT_NOT_FOUND quando nada ocupa o número antigo", () => {
    const item = classify({}, { occupantExists: false })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.OCCUPANT_NOT_FOUND)
    expect(item.reason).toContain("reenvio normal")
  })

  it("PRODUCT_UNRESOLVED lista o inventoryId sem produto na loja", () => {
    const item = classify({}, { unresolvedInventoryIds: ["p-tvbox"] })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.PRODUCT_UNRESOLVED)
    expect(item.reason).toContain("p-tvbox")
  })

  it("ignora linha virtual (O.S./serviço/avulso) na checagem de produto", () => {
    const item = classify({}, { unresolvedInventoryIds: ["__avulso__abc"] })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.READY)
  })

  it("INSUFFICIENT_STOCK_RISK quando o saldo atual não cobre a baixa", () => {
    const item = classify(
      {},
      {
        stockShortfalls: [
          { produtoId: "prod-1", nome: "CONTROLE TV BOX", disponivel: 0, necessario: 1 },
        ],
      },
    )
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.INSUFFICIENT_STOCK_RISK)
    expect(item.reason).toContain("CONTROLE TV BOX")
  })

  // ── Caixa ─────────────────────────────────────────────────────────────────

  it("REQUIRES_CLOSED_SESSION_CONFIRM quando a sessão original está fechada", () => {
    const item = classify({}, { originalSessionStatus: "FECHADA" })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM)
    expect(item.bucket).toBe(QUARANTINE_RECOVERY_BUCKET.REQUIRES_CONFIRMATION)
    expect(isExecutableClass(item.klass)).toBe(true)
  })

  it("MISSING_ORIGINAL_SESSION sem sessaoId — não joga receita no caixa de hoje", () => {
    const item = classify({ sessaoId: undefined }, { originalSessionStatus: "NO_SESSION_ID" })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION)
    expect(item.reason).toContain("caixa de hoje")
  })

  it("MISSING_ORIGINAL_SESSION quando a sessão informada é inexistente ou de outra loja", () => {
    expect(classify({}, { originalSessionStatus: "NOT_FOUND" }).klass).toBe(
      QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION,
    )
  })

  it("venda 100% à prazo dispensa caixa e fica READY mesmo sem sessão", () => {
    const item = classify(
      { paymentBreakdown: { aPrazo: 18 }, sessaoId: undefined },
      { originalSessionStatus: "NO_SESSION_ID" },
    )
    expect(item.valorAVista).toBe(0)
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.READY)
  })

  it("venda 100% crédito-vale dispensa caixa", () => {
    const item = classify(
      { paymentBreakdown: { creditoVale: 18 }, sessaoId: undefined },
      { originalSessionStatus: "NO_SESSION_ID" },
    )
    expect(item.valorAVista).toBe(0)
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.READY)
  })

  it("breakdown ausente é tratado como receita à vista (conservador)", () => {
    const item = classify(
      { paymentBreakdown: undefined, sessaoId: undefined },
      { originalSessionStatus: "NO_SESSION_ID" },
    )
    expect(item.valorAVista).toBe(18)
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION)
  })

  it("mistura à prazo + dinheiro ainda exige sessão original para a parte à vista", () => {
    const item = classify(
      { total: 100, paymentBreakdown: { aPrazo: 60, dinheiro: 40 } },
      { originalSessionStatus: "FECHADA" },
    )
    expect(item.valorAVista).toBe(40)
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.REQUIRES_CLOSED_SESSION_CONFIRM)
  })

  // ── Precedência ───────────────────────────────────────────────────────────

  it("conflito ausente tem precedência sobre sessão fechada", () => {
    // Espelha o motor: o guard de colisão roda ANTES do gate de caixa, para que a
    // confirmação de lançamento retroativo nunca contorne um conflito.
    const item = classify({}, { occupantExists: false, originalSessionStatus: "FECHADA" })
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.OCCUPANT_NOT_FOUND)
  })

  it("payload inválido tem precedência sobre produto e estoque", () => {
    const item = classify(
      { lines: [] },
      {
        unresolvedInventoryIds: ["p-tvbox"],
        stockShortfalls: [{ produtoId: "p", nome: "x", disponivel: 0, necessario: 1 }],
      },
    )
    expect(item.klass).toBe(QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD)
  })

  it("nenhuma classe bloqueada é executável", () => {
    const blocked = [
      QUARANTINE_RECOVERY_CLASS.NOT_QUARANTINED,
      QUARANTINE_RECOVERY_CLASS.MISSING_CLIENT_SALE_ID,
      QUARANTINE_RECOVERY_CLASS.MISSING_ORIGINAL_SESSION,
      QUARANTINE_RECOVERY_CLASS.OCCUPANT_NOT_FOUND,
      QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD,
      QUARANTINE_RECOVERY_CLASS.STORE_MISMATCH,
      QUARANTINE_RECOVERY_CLASS.PRODUCT_UNRESOLVED,
      QUARANTINE_RECOVERY_CLASS.INSUFFICIENT_STOCK_RISK,
      QUARANTINE_RECOVERY_CLASS.BLOCKED_UNKNOWN,
    ] as const
    for (const klass of blocked) {
      expect(bucketForClass(klass)).toBe(QUARANTINE_RECOVERY_BUCKET.BLOCKED)
      expect(isExecutableClass(klass)).toBe(false)
    }
  })

  it("é puro: não muta a candidata recebida", () => {
    const input = candidate()
    const snapshot = JSON.stringify(input)
    classifyQuarantineCandidate({ storeId: STORE, candidate: input, facts: facts() })
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe("planQuarantineRecovery / summarizeQuarantinePlan", () => {
  it("agrega o lote por bucket e soma os valores", () => {
    const plan = planQuarantineRecovery([
      { storeId: STORE, candidate: candidate({ id: "VDA-2026-0001" }), facts: facts() },
      {
        storeId: STORE,
        candidate: candidate({ id: "VDA-2026-0002", total: 50 }),
        facts: facts({ originalSessionStatus: "FECHADA" }),
      },
      {
        storeId: STORE,
        candidate: candidate({ id: "VDA-2026-0003", total: 7 }),
        facts: facts({
          alreadyRecoveredPedidoId: "VDA-RC02-2026-000010",
          alreadyRecoveredVendaId: "venda-x",
        }),
      },
      {
        storeId: STORE,
        candidate: candidate({ id: "VDA-2026-0004", total: 5, lines: [] }),
        facts: facts(),
      },
    ])

    expect(plan.summary).toMatchObject({
      total: 4,
      ready: 1,
      requiresConfirmation: 1,
      alreadyRecovered: 1,
      blocked: 1,
      valorTotal: 80,
      // Somente READY + REQUIRES_CONFIRMATION são executáveis: 18 + 50.
      valorExecutavel: 68,
    })
    expect(plan.summary.byClass[QUARANTINE_RECOVERY_CLASS.INVALID_PAYLOAD]).toBe(1)
  })

  it("lote vazio produz resumo zerado", () => {
    expect(summarizeQuarantinePlan([])).toMatchObject({
      total: 0,
      ready: 0,
      blocked: 0,
      valorTotal: 0,
      valorExecutavel: 0,
    })
  })

  it("duas quarentenas com o MESMO pedidoId antigo são classificadas independentemente", () => {
    // Cenário real do incidente: dois navegadores escolheram o mesmo `MAX+1`.
    const plan = planQuarantineRecovery([
      {
        storeId: STORE,
        candidate: candidate({ clientSaleId: "cs_attempt_111111" }),
        facts: facts(),
      },
      {
        storeId: STORE,
        candidate: candidate({ clientSaleId: "cs_attempt_222222" }),
        facts: facts(),
      },
    ])
    expect(plan.summary.ready).toBe(2)
    expect(plan.items[0].clientSaleId).not.toBe(plan.items[1].clientSaleId)
    expect(plan.items[0].conflictingPedidoId).toBe(plan.items[1].conflictingPedidoId)
  })
})
