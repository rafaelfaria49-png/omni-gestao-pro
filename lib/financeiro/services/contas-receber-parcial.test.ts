import { describe, it, expect, beforeEach, vi } from "vitest"

// ============================================================================
// GOAL_FIX — Baixa parcial em títulos migrados SmartGenius ("valor_maior_que_aberto").
// ----------------------------------------------------------------------------
// Regressão: a tela "Receber conta" validava/exibia o `valor` BRUTO da coluna
// (que NÃO diminui em baixas parciais via backend — estas só anexam ao
// `payload.historico`). Resultado: após a 1ª parcial, R$ 200 em saldo de
// R$ 165,01 caía em `valor_maior_que_aberto`, e a UI seguia mostrando R$ 365,01.
//
// Estes testes exercitam as funções de PRODUÇÃO do serviço financeiro
// (registrarPagamentoParcial / liquidarContaReceber / buildContaReceberAuditTrail)
// sobre um Prisma EM MEMÓRIA — o único I/O mockado. O `saldoAberto` do audit é
// exatamente o valor que a rota /api/pdv/receber-conta passa ao caixa na quitação.
// ============================================================================

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const titulos = new Map<string, Row>()
  const byId = new Map<string, Row>()
  let seq = 0
  let relogio = Date.parse("2026-09-04T12:00:00.000Z")

  const tick = () => new Date(++relogio)

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
      createdAt: tick(),
      updatedAt: tick(),
    }
  }
  function applyScalars(row: Row, data: Row): Row {
    for (const k of ["descricao", "cliente", "valor", "vencimento", "status", "payload"]) {
      if (data[k] !== undefined) row[k] = data[k]
    }
    row.updatedAt = tick()
    return row
  }
  function snapshot<T extends Row | null | undefined>(row: T): T {
    return (row ? { ...row } : row) as T
  }

  const prisma = {
    contaReceberTitulo: {
      findUnique: async ({ where }: { where: { storeId_localKey: { storeId: string; localKey: string } } }) => {
        const { storeId, localKey } = where.storeId_localKey
        return snapshot(titulos.get(ck(storeId, localKey)) ?? null)
      },
      findFirst: async ({ where }: { where: { id?: string; storeId?: string } }) => {
        if (where?.id) {
          const r = byId.get(where.id)
          if (r && (!where.storeId || r.storeId === where.storeId)) return snapshot(r)
          return null
        }
        for (const r of titulos.values()) if (!where?.storeId || r.storeId === where.storeId) return snapshot(r)
        return null
      },
      findMany: async ({ where }: { where?: { storeId?: string } }) =>
        [...titulos.values()].filter((r) => !where?.storeId || r.storeId === where.storeId).map(snapshot),
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
        if (existing) return snapshot(applyScalars(existing, update))
        return snapshot(put(makeRow(create)))
      },
      update: async ({ where, data }: { where: { id?: string }; data: Row }) => {
        const row = where.id ? byId.get(where.id) : undefined
        if (!row) throw new Error("Record to update not found.")
        return snapshot(applyScalars(row, data))
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string; storeId?: string; updatedAt?: unknown }
        data: Row
      }) => {
        const row = where.id ? byId.get(where.id) : undefined
        if (!row || (where.storeId && row.storeId !== where.storeId)) return { count: 0 }
        const atual = row.updatedAt as Date | undefined
        const token = where.updatedAt as Date | undefined
        if (!atual || !token || atual.getTime() !== token.getTime()) return { count: 0 }
        applyScalars(row, data)
        return { count: 1 }
      },
      create: async ({ data }: { data: Row }) => snapshot(put(makeRow(data))),
    },
  }

  return {
    prisma,
    titulos,
    reset: () => {
      titulos.clear()
      byId.clear()
      seq = 0
      relogio = Date.parse("2026-09-04T12:00:00.000Z")
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
} from "./contas-receber-service"

const STORE = "loja-2"

/** Semeia um título tal como o importador SmartGenius grava: principal na coluna `valor`, sem `historico`/`parcelas`. */
async function seedSmartGenius(valor = 365.01) {
  const localKey = `imp-smart:${STORE}:cr:12345:atraso`
  await upsertContaReceber({
    storeId: STORE,
    localKey,
    descricao: "SALDO MIGRADO SMARTGENIUS - EM ATRASO",
    cliente: "CAROLAINE RAMOS FERNANDES",
    valor,
    vencimento: "2026-01-10",
    status: "vencido",
    payloadPatch: { origem: "importacao", origemSistema: "smart-genius", tipoSaldo: "atraso" },
  })
  return localKey
}

function saldoAbertoDoTitulo(row: Parameters<typeof buildContaReceberAuditTrail>[0][number]): number {
  return buildContaReceberAuditTrail([row])[0]!.saldoAberto
}

beforeEach(() => h.reset())

describe("GOAL_FIX — baixa parcial SmartGenius (valor_maior_que_aberto)", () => {
  it("título migrado SmartGenius sem parcelas: saldo aberto = valor bruto antes de qualquer baixa", async () => {
    const localKey = await seedSmartGenius(365.01)
    const t = await getContaReceberByLocalKey(STORE, localKey)
    expect(t).not.toBeNull()
    expect(saldoAbertoDoTitulo(t!)).toBe(365.01)
  })

  it("título aberto R$ 365,01 PERMITE baixa parcial de R$ 200,00", async () => {
    const localKey = await seedSmartGenius(365.01)
    const res = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    expect(res.data.status).toBe("parcial")
    expect(saldoAbertoDoTitulo(res.data)).toBe(165.01)
  })

  it("título aberto R$ 365,01 BLOQUEIA baixa de R$ 365,02 (acima do saldo)", async () => {
    const localKey = await seedSmartGenius(365.01)
    const res = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 365.02 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("deveria bloquear")
    expect(res.reason).toBe("valor_maior_que_aberto")
  })

  it("baixa parcial ATUALIZA o saldo restante; a 2ª parcial valida contra o saldo já reduzido", async () => {
    const localKey = await seedSmartGenius(365.01)

    const p1 = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    expect(p1.ok).toBe(true)
    if (!p1.ok) throw new Error(p1.reason)
    expect(saldoAbertoDoTitulo(p1.data)).toBe(165.01)

    // Antes do fix, a UI revalidava contra 365,01 e o backend recusava 200 aqui.
    // Agora R$ 165,01 é o teto; uma 2ª parcial de R$ 165,01 quita o título.
    const p2ok = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 165.01 })
    expect(p2ok.ok).toBe(true)
    if (!p2ok.ok) throw new Error(p2ok.reason)
    expect(p2ok.data.status).toBe("pago")
    expect(saldoAbertoDoTitulo(p2ok.data)).toBe(0)
  })

  it("após baixa parcial de R$ 200, uma 2ª de R$ 200 é BLOQUEADA (saldo é só R$ 165,01)", async () => {
    const localKey = await seedSmartGenius(365.01)
    await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    const p2 = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    expect(p2.ok).toBe(false)
    if (p2.ok) throw new Error("deveria bloquear")
    expect(p2.reason).toBe("valor_maior_que_aberto")
  })

  it("baixa TOTAL (liquidar) continua funcionando e quita o título", async () => {
    const localKey = await seedSmartGenius(365.01)
    const res = await liquidarContaReceber({ storeId: STORE, localKey })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    expect(res.data.status).toBe("pago")
    expect(saldoAbertoDoTitulo(res.data)).toBe(0)
  })

  it("caixa recebe apenas o saldo restante: liquidar APÓS parcial lança R$ 165,01 (não R$ 365,01 bruto)", async () => {
    const localKey = await seedSmartGenius(365.01)

    // Saldo aberto que a rota usa como valorMov na quitação = audit.saldoAberto ANTES de liquidar.
    await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    const antes = await getContaReceberByLocalKey(STORE, localKey)
    const valorQueOCaixaRecebe = saldoAbertoDoTitulo(antes!)
    expect(valorQueOCaixaRecebe).toBe(165.01)
    // a coluna bruta segue 365,01 — por isso a rota NÃO pode usar res.data.valor
    expect(antes!.valor).toBe(365.01)

    const liq = await liquidarContaReceber({ storeId: STORE, localKey })
    expect(liq.ok).toBe(true)
    if (!liq.ok) throw new Error(liq.reason)
    expect(liq.data.status).toBe("pago")
  })

  it("status do título permanece coerente: pendente → parcial → pago", async () => {
    const localKey = await seedSmartGenius(300)
    const t0 = await getContaReceberByLocalKey(STORE, localKey)
    expect(["pendente", "vencido"]).toContain(t0!.status) // aberto

    const p = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 100 })
    expect(p.ok && p.data.status).toBe("parcial")

    const q = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 200 })
    expect(q.ok && q.data.status).toBe("pago")

    // título já pago não aceita nova baixa parcial
    const extra = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 1 })
    expect(extra.ok).toBe(false)
    if (extra.ok) throw new Error("não deveria aceitar")
    expect(extra.reason).toBe("ja_pago")
  })

  it("valor parcial inválido (<= 0) é rejeitado antes de qualquer escrita", async () => {
    const localKey = await seedSmartGenius(365.01)
    const res = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 0 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("deveria rejeitar")
    expect(res.reason).toBe("valor_invalido")
    const t = await getContaReceberByLocalKey(STORE, localKey)
    expect(saldoAbertoDoTitulo(t!)).toBe(365.01) // intacto
  })
})

describe("FINANCEIRO-RECEBER-CLIENTE-UX-004 — formaPagamento persistida na baixa", () => {
  function ultimaEntradaHistorico(payload: unknown): Record<string, unknown> {
    const hist = (payload as { historico?: Record<string, unknown>[] })?.historico ?? []
    expect(hist.length).toBeGreaterThan(0)
    return hist[hist.length - 1]!
  }

  it("registrarPagamentoParcial grava formaPagamento na entrada do historico", async () => {
    const localKey = await seedSmartGenius(300)
    const res = await registrarPagamentoParcial({
      storeId: STORE,
      localKey,
      valorPago: 100,
      observacao: "Recebimento avulso por cliente",
      formaPagamento: "PIX",
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    const entrada = ultimaEntradaHistorico(res.data.payload)
    expect(entrada.tipo).toBe("pagamento")
    expect(entrada.formaPagamento).toBe("PIX")
    expect(entrada.observacao).toBe("Recebimento avulso por cliente")
  })

  it("liquidarContaReceber grava formaPagamento na entrada do historico", async () => {
    const localKey = await seedSmartGenius(300)
    const res = await liquidarContaReceber({ storeId: STORE, localKey, formaPagamento: "Dinheiro" })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    const entrada = ultimaEntradaHistorico(res.data.payload)
    expect(entrada.tipo).toBe("liquidacao")
    expect(entrada.formaPagamento).toBe("Dinheiro")
  })

  it("sem formaPagamento a entrada do historico não ganha o campo (compat com baixas antigas)", async () => {
    const localKey = await seedSmartGenius(300)
    const res = await registrarPagamentoParcial({ storeId: STORE, localKey, valorPago: 50 })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    const entrada = ultimaEntradaHistorico(res.data.payload)
    expect(entrada.formaPagamento).toBeUndefined()
  })

  it("formaPagamento vazia/whitespace é normalizada para ausente", async () => {
    const localKey = await seedSmartGenius(300)
    const res = await liquidarContaReceber({ storeId: STORE, localKey, formaPagamento: "   " })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.reason)
    const entrada = ultimaEntradaHistorico(res.data.payload)
    expect(entrada.formaPagamento).toBeUndefined()
  })
})

describe("GOAL_FIX — idempotência da movimentação de caixa (não duplica em retry)", () => {
  it("parcial de R$ 200 repetido com mesma referência soma apenas uma vez (skipped_idempotent)", async () => {
    // Mock pontual de movimentacaoFinanceira sobre o mesmo Prisma em memória.
    const movs: Array<Record<string, unknown>> = []
    ;(h.prisma as Record<string, unknown>).movimentacaoFinanceira = {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        movs.find(
          (m) =>
            m.storeId === where.storeId &&
            m.referenciaId === where.referenciaId &&
            m.tipo === where.tipo &&
            m.origem === where.origem,
        ) ?? null,
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const origem = where.origem as { startsWith?: string } | string | undefined
        const total = movs
          .filter((m) => {
            if (m.storeId !== where.storeId || m.referenciaId !== where.referenciaId || m.tipo !== where.tipo)
              return false
            if (origem && typeof origem === "object" && origem.startsWith)
              return String(m.origem).startsWith(origem.startsWith)
            return true
          })
          .reduce((s, m) => s + Number(m.valor ?? 0), 0)
        return { _sum: { valor: total } }
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${movs.length + 1}`, ...data }
        movs.push(row)
        return row
      },
    }

    const { createMovimentacaoEntradaFromReceber } = await import("./movimentacoes-service")
    const titulo = { id: "cr-x", storeId: STORE, descricao: "Título", cliente: "Cliente" }

    const r1 = await createMovimentacaoEntradaFromReceber(titulo, 200, { parcial: true, carteiraId: null })
    expect(r1.ok && r1.action).toBe("created")

    // Retry do mesmo valor — não deve criar 2ª movimentação.
    const r2 = await createMovimentacaoEntradaFromReceber(titulo, 200, { parcial: true, carteiraId: null })
    expect(r2.ok && r2.action).toBe("skipped_idempotent")

    expect(movs).toHaveLength(1)
    expect(movs[0]!.valor).toBe(200)
  })
})
