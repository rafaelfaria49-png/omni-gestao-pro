import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 (G1) — canonicalidade do payload.
// ----------------------------------------------------------------------------
// O `payload` JSONB acumula DOIS papéis: snapshot de apresentação do painel legado
// (localStorage / import / sync) E livro-razão do servidor (`payload.historico`, única
// fonte de `saldoAberto`). O caminho `replacePayload: true` reescrevia o payload inteiro
// com o snapshot do cliente e APAGAVA o histórico — ressuscitando dívida já recebida.
//
// Estes testes exercitam as funções de PRODUÇÃO sobre um Prisma EM MEMÓRIA (único I/O
// mockado), no mesmo padrão de `contas-receber-parcial.test.ts`.
// ============================================================================

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const titulos = new Map<string, Row>()
  const byId = new Map<string, Row>()
  let seq = 0

  const ck = (storeId: string, localKey: string) => `${storeId}::${localKey}`

  function put(row: Row): Row {
    titulos.set(ck(String(row.storeId), String(row.localKey)), row)
    byId.set(String(row.id), row)
    return row
  }
  function makeRow(data: Row): Row {
    return {
      id: `cr-${++seq}`,
      storeId: data.storeId,
      localKey: data.localKey,
      descricao: data.descricao ?? "",
      cliente: data.cliente ?? "",
      valor: data.valor ?? 0,
      vencimento: data.vencimento ?? "",
      status: data.status ?? "pendente",
      payload: data.payload ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
  function applyScalars(row: Row, data: Row): Row {
    for (const k of ["descricao", "cliente", "valor", "vencimento", "status", "payload"]) {
      if (data[k] !== undefined) row[k] = data[k]
    }
    row.updatedAt = new Date()
    return row
  }

  const prisma = {
    contaReceberTitulo: {
      findUnique: async ({ where }: { where: { storeId_localKey: { storeId: string; localKey: string } } }) => {
        const { storeId, localKey } = where.storeId_localKey
        return titulos.get(ck(storeId, localKey)) ?? null
      },
      findFirst: async ({ where }: { where: { id?: string; storeId?: string } }) => {
        if (where?.id) {
          const r = byId.get(where.id)
          if (r && (!where.storeId || r.storeId === where.storeId)) return r
          return null
        }
        for (const r of titulos.values()) if (!where?.storeId || r.storeId === where.storeId) return r
        return null
      },
      findMany: async ({ where }: { where?: { storeId?: string } }) =>
        [...titulos.values()].filter((r) => !where?.storeId || r.storeId === where.storeId),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { storeId_localKey: { storeId: string; localKey: string } }
        create: Row
        update: Row
      }) => {
        const { storeId, localKey } = where.storeId_localKey
        const existing = titulos.get(ck(storeId, localKey))
        if (existing) return applyScalars(existing, update)
        return put(makeRow(create))
      },
      update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
        const row = where.id ? byId.get(where.id) : undefined
        if (!row) throw new Error("Record to update not found.")
        return applyScalars(row, data)
      },
      create: async ({ data }: { data: Row }) => put(makeRow(data)),
    },
  }

  return {
    prisma,
    reset: () => {
      titulos.clear()
      byId.clear()
      seq = 0
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))

import {
  upsertContaReceber,
  registrarPagamentoParcial,
  liquidarContaReceber,
  buildContaReceberAuditTrail,
  getContaReceberByLocalKey,
  sumPagamentosFromHistoricoPayload,
  CONTA_RECEBER_SERVER_OWNED_PAYLOAD_KEYS,
} from "./contas-receber-service"

const STORE = "loja-1"
const LK = "cr-legado-77"

/** Snapshot que o painel legado envia: a linha INTEIRA do localStorage, sem `historico`. */
function snapshotLegado(over: Record<string, unknown> = {}) {
  return {
    id: LK,
    descricao: "Crediário — Ana",
    cliente: "Ana Souza",
    valor: 100,
    vencimento: "2026-08-10",
    status: "pendente",
    tipo: "Manual",
    ...over,
  }
}

async function persistirSnapshotLegado(over: Record<string, unknown> = {}, storeId = STORE) {
  const snap = snapshotLegado(over)
  return upsertContaReceber({
    storeId,
    localKey: String(snap.id),
    descricao: String(snap.descricao),
    cliente: String(snap.cliente),
    valor: Number(snap.valor),
    vencimento: String(snap.vencimento),
    status: String(snap.status),
    payloadPatch: snap as unknown as Record<string, unknown>,
    replacePayload: true,
  })
}

function saldo(row: Parameters<typeof buildContaReceberAuditTrail>[0][number]): number {
  return buildContaReceberAuditTrail([row])[0]!.saldoAberto
}

/**
 * Escrita do importador avançado (`lib/importador-avancado/persistidor.ts`): `replacePayload`
 * com a chave `historico` SEMPRE presente — mesmo vazia — e entradas carimbadas com
 * `importadoEm`, nunca com `at`.
 */
async function reimportar(historico: Array<Record<string, unknown>>, status = "pendente") {
  return upsertContaReceber({
    storeId: STORE,
    localKey: LK,
    descricao: "Crediário — Ana",
    cliente: "Ana Souza",
    valor: 100,
    vencimento: "2026-08-10",
    status,
    payloadPatch: { id: LK, origem: "importacao", valorOriginal: 100, historico },
    replacePayload: true,
  })
}

beforeEach(() => h.reset())

describe("G1 §1 — snapshot legado não apaga o livro-razão do servidor", () => {
  it("[CRIT-1] título 100 → parcial 40 → snapshot legado reenviado: saldo continua 60 e o histórico sobrevive", async () => {
    await persistirSnapshotLegado()

    const p = await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })
    expect(p.ok).toBe(true)
    if (!p.ok) throw new Error(p.reason)
    expect(saldo(p.data)).toBe(60)

    // O painel legado reenvia a lista INTEIRA do localStorage — snapshot pré-pagamento.
    await persistirSnapshotLegado()

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois).not.toBeNull()
    expect(sumPagamentosFromHistoricoPayload(depois!.payload)).toBe(40)
    expect(saldo(depois!)).toBe(60)
    const hist = (depois!.payload as { historico?: unknown[] }).historico
    expect(Array.isArray(hist) && hist.length).toBe(1)
  })

  it("[CRIT-2] título quitado + snapshot antigo status=pendente NÃO ressuscita como dívida aberta", async () => {
    await persistirSnapshotLegado()
    const liq = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(liq.ok).toBe(true)

    await persistirSnapshotLegado({ status: "pendente" })

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois!.status).toBe("pago")
    expect(saldo(depois!)).toBe(0)
  })

  it("status nunca contradiz o ledger preservado: pago parcial + snapshot 'pendente' vira 'parcial'", async () => {
    await persistirSnapshotLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })

    await persistirSnapshotLegado({ status: "pendente" })

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois!.status).toBe("parcial")
  })

  it("snapshot legado não reabre título cancelado", async () => {
    await persistirSnapshotLegado({ status: "cancelado" })
    // grava o estado terminal pela via canônica (upsert direto, sem ledger)
    const t0 = await getContaReceberByLocalKey(STORE, LK)
    expect(t0!.status).toBe("cancelado")

    await persistirSnapshotLegado({ status: "pendente" })
    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois!.status).toBe("cancelado")
  })

  it("campos de apresentação do snapshot continuam substituíveis (não é congelamento)", async () => {
    await persistirSnapshotLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })

    await persistirSnapshotLegado({ descricao: "Crediário — Ana (renegociado)", vencimento: "2026-09-30" })

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois!.descricao).toBe("Crediário — Ana (renegociado)")
    expect(depois!.vencimento).toBe("2026-09-30")
    // …e o ledger segue intacto
    expect(sumPagamentosFromHistoricoPayload(depois!.payload)).toBe(40)
  })

  it("importador reimportando um título SEM ledger do servidor continua reescrevendo o próprio histórico", async () => {
    // Título nasceu da planilha, com o pagamento que a planilha conhecia.
    await reimportar([{ tipo: "pagamento", valor: 30, data: null, importadoEm: "2026-08-01T00:00:00.000Z" }])
    expect(sumPagamentosFromHistoricoPayload((await getContaReceberByLocalKey(STORE, LK))!.payload)).toBe(30)

    // Re-importação da mesma planilha NÃO acumula pagamento duplicado.
    await reimportar([{ tipo: "pagamento", valor: 30, data: null, importadoEm: "2026-08-02T00:00:00.000Z" }])

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(sumPagamentosFromHistoricoPayload(depois!.payload)).toBe(30)
    const hist = (depois!.payload as { historico?: unknown[] }).historico
    expect(Array.isArray(hist) && hist.length).toBe(1)
  })

  it("[P1-REVISÃO] título importado, PAGO no PDV e depois reimportado: o pagamento do servidor NÃO some", async () => {
    // 1. Chega da planilha, em aberto.
    await reimportar([])
    // 2. É recebido no PDV/Financeiro — o servidor carimba o ledger (`at`).
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })
    expect(saldo((await getContaReceberByLocalKey(STORE, LK))!)).toBe(60)

    // 3. A planilha de origem, que não sabe do pagamento, é reimportada.
    await reimportar([], "pendente")

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(sumPagamentosFromHistoricoPayload(depois!.payload)).toBe(40)
    expect(saldo(depois!)).toBe(60)
    expect(depois!.status).toBe("parcial")
  })

  it("[P1-REVISÃO] título importado, QUITADO no PDV e reimportado como pendente não ressuscita", async () => {
    await reimportar([])
    await liquidarContaReceber({ storeId: STORE, localKey: LK })

    await reimportar([], "pendente")

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(depois!.status).toBe("pago")
    expect(saldo(depois!)).toBe(0)
  })

  it("[P1-REVISÃO] o ledger do servidor sobrevive mesmo quando o importador manda `historico` NÃO vazio", async () => {
    await reimportar([])
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })

    // A planilha traz um pagamento próprio de R$ 25; ele não pode apagar os R$ 40 do PDV.
    await reimportar([{ tipo: "pagamento", valor: 25, data: null, importadoEm: "2026-08-05T00:00:00.000Z" }])

    const depois = await getContaReceberByLocalKey(STORE, LK)
    expect(sumPagamentosFromHistoricoPayload(depois!.payload)).toBe(40)
    expect(saldo(depois!)).toBe(60)
  })

  it("a lista de chaves server-owned inclui `historico`", () => {
    expect(CONTA_RECEBER_SERVER_OWNED_PAYLOAD_KEYS).toContain("historico")
  })
})

describe("G1 §4 — re-liquidação de título já pago", () => {
  it("[CRIT-5] liquidar título PAGO devolve `ja_pago` (ok:false) — nunca sucesso silencioso", async () => {
    await persistirSnapshotLegado()
    const primeira = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(primeira.ok).toBe(true)

    const segunda = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(segunda.ok).toBe(false)
    if (segunda.ok) throw new Error("título pago não pode aceitar nova liquidação")
    expect(segunda.reason).toBe("ja_pago")
  })

  it("título sem saldo (parciais somam o total) devolve `ja_pago`, não um valor bruto", async () => {
    await persistirSnapshotLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 100 })

    const res = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("não deveria liquidar")
    expect(res.reason).toBe("ja_pago")
  })
})

describe("G1 — regressões: o caminho normal continua funcionando", () => {
  it("[CRIT-11] liquidação normal quita o título e zera o saldo", async () => {
    await persistirSnapshotLegado()
    const res = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    expect(res.data.status).toBe("pago")
    expect(saldo(res.data)).toBe(0)
    expect(sumPagamentosFromHistoricoPayload(res.data.payload)).toBe(100)
  })

  it("[CRIT-10] baixa parcial normal abate exatamente o valor pago", async () => {
    await persistirSnapshotLegado()
    const res = await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 30 })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    expect(res.data.status).toBe("parcial")
    expect(saldo(res.data)).toBe(70)
  })

  it("liquidar APÓS parcial quita o restante (não o bruto)", async () => {
    await persistirSnapshotLegado()
    await registrarPagamentoParcial({ storeId: STORE, localKey: LK, valorPago: 40 })
    const antes = await getContaReceberByLocalKey(STORE, LK)
    expect(saldo(antes!)).toBe(60)

    const liq = await liquidarContaReceber({ storeId: STORE, localKey: LK })
    expect(liq.ok).toBe(true)
    if (!liq.ok) throw new Error(liq.reason)
    expect(sumPagamentosFromHistoricoPayload(liq.data.payload)).toBe(100)
  })
})

describe("G1 §8 — isolamento multi-loja", () => {
  const LOJA_A = "loja-a"
  const LOJA_B = "loja-b"

  it("[CRIT-9] mesmo localKey em duas lojas: quitar na A não toca no título da B", async () => {
    await persistirSnapshotLegado({}, LOJA_A)
    await persistirSnapshotLegado({}, LOJA_B)

    const liq = await liquidarContaReceber({ storeId: LOJA_A, localKey: LK })
    expect(liq.ok).toBe(true)

    const a = await getContaReceberByLocalKey(LOJA_A, LK)
    const b = await getContaReceberByLocalKey(LOJA_B, LK)
    expect(a!.status).toBe("pago")
    expect(b!.status).toBe("pendente")
    expect(saldo(b!)).toBe(100)
    expect(a!.id).not.toBe(b!.id)
  })

  it("snapshot legado da loja B não altera o ledger da loja A", async () => {
    await persistirSnapshotLegado({}, LOJA_A)
    await persistirSnapshotLegado({}, LOJA_B)
    await registrarPagamentoParcial({ storeId: LOJA_A, localKey: LK, valorPago: 40 })

    await persistirSnapshotLegado({ status: "pendente" }, LOJA_B)

    const a = await getContaReceberByLocalKey(LOJA_A, LK)
    expect(sumPagamentosFromHistoricoPayload(a!.payload)).toBe(40)
    expect(saldo(a!)).toBe(60)
  })

  it("liquidar com storeId errado não encontra o título", async () => {
    await persistirSnapshotLegado({}, LOJA_A)
    const res = await liquidarContaReceber({ storeId: LOJA_B, localKey: LK })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("não deveria achar título de outra loja")
    expect(res.reason).toBe("not_found")
  })
})
