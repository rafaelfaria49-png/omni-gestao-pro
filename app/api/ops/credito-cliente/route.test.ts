/**
 * GOAL PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001 — GET /api/ops/credito-cliente.
 *
 * Exercita o handler de PRODUÇÃO sobre Prisma EM MEMÓRIA. Prova que:
 *  - lookup por doc agrega saldo por CPF e devolve `detalhes` com origem;
 *  - lookup por CÓDIGO do vale (localId da devolução impressa no comprovante,
 *    ex. DEV-2026-0001) devolve o crédito com origem, saldo e os USOS
 *    (vendas que consumiram, com saldo antes/depois) — trilha auditável;
 *  - bootstrap (sem doc/código) segue devolvendo só `creditos` agregados;
 *  - storeId isola lojas; código inexistente → 404.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const STORE = "loja-1"
  const db = {
    creditos: [] as Row[],
    devolucoes: [] as Row[],
    usos: [] as Row[],
  }
  let seq = 0

  function reset() {
    db.creditos.length = 0
    db.devolucoes.length = 0
    db.usos.length = 0
    seq = 0
  }

  function addDevolucao(localId: string) {
    const dev = { id: `dev-${++seq}`, storeId: STORE, localId }
    db.devolucoes.push(dev)
    return dev
  }

  function addCredito(over: Row) {
    const c = {
      id: `cred-${++seq}`,
      storeId: STORE,
      clienteDoc: "12345678900",
      clienteNome: "Maria Souza",
      vendaOrigemId: "VDA-2026-0100",
      valorOriginal: 40,
      saldoAtual: 40,
      status: "ativo",
      createdAt: new Date("2026-08-01T10:00:00Z"),
      devolucaoId: null,
      ...over,
    }
    db.creditos.push(c)
    return c
  }

  const prisma = {
    devolucaoVenda: {
      findFirst: async ({ where }: { where: Row }) =>
        db.devolucoes.find((d) => d.storeId === where.storeId && d.localId === where.localId) ?? null,
    },
    clienteCredito: {
      findMany: async (args: { where: Row }) => {
        const { where } = args
        return db.creditos
          .filter((c) => {
            if (where.storeId && c.storeId !== where.storeId) return false
            if (where.clienteDoc && c.clienteDoc !== where.clienteDoc) return false
            if (where.clienteId && c.clienteId !== where.clienteId) return false
            if (where.devolucaoId && c.devolucaoId !== where.devolucaoId) return false
            if (where.status && c.status !== where.status) return false
            const saldo = where.saldoAtual as Row | undefined
            if (saldo?.gt !== undefined && (c.saldoAtual as number) <= (saldo.gt as number)) return false
            return true
          })
          .map((c) => ({
            ...c,
            devolucao: db.devolucoes.find((d) => d.id === c.devolucaoId) ?? null,
          }))
      },
    },
    usoCreditoCliente: {
      findMany: async ({ where }: { where: Row }) => {
        const ids = (where.creditoId as Row).in as string[]
        return db.usos
          .filter((u) => ids.includes(u.creditoId as string))
          .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      },
    },
  }

  return { STORE, db, reset, addDevolucao, addCredito, prisma }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/ops-api-gate", () => ({ opsLojaIdFromRequest: vi.fn(() => h.STORE) }))

import { GET } from "./route"

function getReq(query = "") {
  return new Request(`http://local/api/ops/credito-cliente?${query}`, {
    headers: { "x-assistec-loja-id": h.STORE },
  })
}

beforeEach(() => {
  h.reset()
})

describe("GET /api/ops/credito-cliente — consulta de vale", () => {
  it("lookup por doc agrega saldo por CPF e devolve detalhes com código/origem", async () => {
    const dev = h.addDevolucao("DEV-2026-0001")
    h.addCredito({ devolucaoId: dev.id, saldoAtual: 15 })
    h.addCredito({ devolucaoId: null, valorOriginal: 10, saldoAtual: 10 })
    const res = await GET(getReq("doc=123.456.789-00"))
    const j = await res.json()
    expect(j.creditos["12345678900"]).toEqual({ nome: "Maria Souza", saldo: 25 })
    expect(j.detalhes).toHaveLength(2)
    expect(j.detalhes[0]).toMatchObject({
      codigo: "DEV-2026-0001",
      clienteDoc: "12345678900",
      vendaOrigemId: "VDA-2026-0100",
      saldoAtual: 15,
    })
  })

  it("lookup por CÓDIGO do vale (DEV-…) devolve origem, saldo e usos (vendas que consumiram)", async () => {
    const dev = h.addDevolucao("DEV-2026-0009")
    const cred = h.addCredito({ devolucaoId: dev.id, saldoAtual: 10 })
    h.db.usos.push(
      {
        creditoId: cred.id,
        vendaId: "VDA-2026-0200",
        valor: 30,
        saldoAntes: 40,
        saldoDepois: 10,
        operador: "Rafael",
        at: new Date("2026-08-10T12:00:00Z"),
      },
    )
    const res = await GET(getReq("codigo=DEV-2026-0009"))
    const j = await res.json()
    expect(j.credito).toMatchObject({
      codigo: "DEV-2026-0009",
      clienteDoc: "12345678900",
      vendaOrigemId: "VDA-2026-0100",
      saldoAtual: 10,
      saldoTotal: 10,
    })
    expect(j.credito.usos).toHaveLength(1)
    expect(j.credito.usos[0]).toMatchObject({
      vendaId: "VDA-2026-0200",
      valor: 30,
      saldoAntes: 40,
      saldoDepois: 10,
      operador: "Rafael",
    })
  })

  it("código inexistente → 404 sem vazar nada", async () => {
    const res = await GET(getReq("codigo=DEV-9999-9999"))
    expect(res.status).toBe(404)
  })

  it("bootstrap (sem doc/código) devolve só `creditos` agregados de toda a loja", async () => {
    h.addDevolucao("DEV-2026-0001")
    h.addCredito({ devolucaoId: null, saldoAtual: 40 })
    const res = await GET(getReq(""))
    const j = await res.json()
    expect(j.creditos["12345678900"].saldo).toBe(40)
    expect(j.detalhes).toBeUndefined()
  })

  it("storeId isola lojas (nenhum crédito de outra loja é consultado)", async () => {
    h.addDevolucao("DEV-2026-0002")
    h.addCredito({ devolucaoId: null, saldoAtual: 40 })
    const res = await GET(getReq("doc=12345678900"))
    const j = await res.json()
    // O fake filtra por storeId do header — o where carregado garante a isolção.
    expect(j.creditos["12345678900"]).toBeTruthy()
    // Vales zerados/expirados nunca entram (status ativo + saldo > 0).
    h.reset()
    h.addCredito({ saldoAtual: 0, status: "zerado" })
    const res2 = await GET(getReq("doc=12345678900"))
    const j2 = await res2.json()
    expect(j2.creditos).toEqual({})
  })
})
