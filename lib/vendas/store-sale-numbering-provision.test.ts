/**
 * GOAL 002C-0b — serviço canônico de provisionamento de `Store.codigoNumeracaoVenda`
 * sobre um Prisma EM MEMÓRIA que replica a unique global da migration 0016.
 *
 * Prova: escrita válida e releitura, normalização, recusas de formato, duplicidade
 * planejada, corrida decidida pelo banco (P2002), idempotência, loja inexistente,
 * preservação dos demais campos de `Store` e imutabilidade após consumo comprovado
 * da série. Nenhum teste toca allocator, writer ou gate de runtime.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"

type StoreRow = {
  id: string
  name: string
  cnpj: string
  phone: string
  profile: string
  codigoNumeracaoVenda: string | null
}

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const stores: Row[] = []
  const series: Row[] = []
  const vendas: Row[] = []
  const calls: string[] = []
  let beforeUpdate: (() => void) | null = null

  function uniqueViolation() {
    const error = new Error("Unique constraint failed on the fields: (`codigoNumeracaoVenda`)")
    return Object.assign(error, { code: "P2002", meta: { target: ["codigoNumeracaoVenda"] } })
  }

  const client = {
    store: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.push("store.findUnique")
        const row = stores.find((s) => s.id === where.id)
        return row ? { ...row } : null
      },
      findMany: async ({ where }: { where?: Row } = {}) => {
        calls.push("store.findMany")
        let rows = [...stores]
        const codigoFilter = where?.codigoNumeracaoVenda as { not?: null } | undefined
        if (codigoFilter && "not" in codigoFilter) {
          rows = rows.filter((s) => s.codigoNumeracaoVenda !== null)
        }
        const idFilter = where?.id as { in?: string[] } | undefined
        if (idFilter?.in) rows = rows.filter((s) => idFilter.in!.includes(String(s.id)))
        return rows
          .map((r) => ({ ...r }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        calls.push("store.update")
        beforeUpdate?.()
        const row = stores.find((s) => s.id === where.id)
        if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" })
        const codigo = data.codigoNumeracaoVenda
        if (
          typeof codigo === "string" &&
          stores.some((s) => s.id !== row.id && s.codigoNumeracaoVenda === codigo)
        ) {
          throw uniqueViolation()
        }
        Object.assign(row, data)
        return { ...row }
      },
    },
    serieVenda: {
      count: async ({ where }: { where: { storeId: string } }) => {
        calls.push("serieVenda.count")
        return series.filter((s) => s.storeId === where.storeId).length
      },
      findMany: async ({ where }: { where?: { storeId?: { in?: string[] } } } = {}) => {
        calls.push("serieVenda.findMany")
        const ids = where?.storeId?.in
        return series
          .filter((s) => (ids ? ids.includes(String(s.storeId)) : true))
          .map((s) => ({ storeId: String(s.storeId) }))
      },
    },
    venda: {
      count: async ({ where }: { where: { storeId: string } }) => {
        calls.push("venda.count")
        return vendas.filter((v) => v.storeId === where.storeId && v.serieVendaId !== null).length
      },
    },
  }

  const prisma = {
    ...client,
    $transaction: async <T>(fn: (tx: typeof client) => Promise<T>): Promise<T> => {
      calls.push("$transaction")
      return fn(client)
    },
  }

  return {
    prisma,
    stores,
    series,
    vendas,
    calls,
    setBeforeUpdate: (fn: (() => void) | null) => {
      beforeUpdate = fn
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))

import {
  provisionStoreSaleNumberingCode,
  readStoreSaleNumberingStatuses,
} from "./store-sale-numbering-provision"

function seedStore(over: Partial<StoreRow> & { id: string }): StoreRow {
  const row: StoreRow = {
    name: `Unidade ${over.id}`,
    cnpj: "11222333000181",
    phone: "1199999-0000",
    profile: "VARIEDADES",
    codigoNumeracaoVenda: null,
    ...over,
  }
  h.stores.push(row as unknown as Record<string, unknown>)
  return row
}

beforeEach(() => {
  h.stores.length = 0
  h.series.length = 0
  h.vendas.length = 0
  h.calls.length = 0
  h.setBeforeUpdate(null)
})

describe("provisionStoreSaleNumberingCode — escrita válida", () => {
  it("salva o código e a releitura devolve o valor persistido", async () => {
    seedStore({ id: "loja-1" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "RC01" })

    expect(result.status).toBe("SAVED")
    if (result.status !== "SAVED") return
    expect(result.store.codigo).toBe("RC01")
    expect(result.store.configurado).toBe(true)
    expect(result.codigoAnterior).toBeNull()

    const [status] = await readStoreSaleNumberingStatuses(["loja-1"])
    expect(status.codigo).toBe("RC01")
    expect(status.configurado).toBe(true)
    expect(status.imutavel).toBe(false)
  })

  it("normaliza minúsculas e espaços para maiúsculas", async () => {
    seedStore({ id: "loja-1" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "  rc01 " })

    expect(result.status).toBe("SAVED")
    if (result.status !== "SAVED") return
    expect(result.store.codigo).toBe("RC01")
  })

  it("preserva os demais campos da loja", async () => {
    const antes = { ...seedStore({ id: "loja-1", name: "Matriz", cnpj: "99887766000155" }) }

    await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "MTZ" })

    const depois = h.stores[0] as unknown as StoreRow
    expect(depois.name).toBe(antes.name)
    expect(depois.cnpj).toBe(antes.cnpj)
    expect(depois.phone).toBe(antes.phone)
    expect(depois.profile).toBe(antes.profile)
    expect(depois.codigoNumeracaoVenda).toBe("MTZ")
  })

  it("lê os códigos ocupados dentro da mesma transação da escrita", async () => {
    seedStore({ id: "loja-1" })

    await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "RC01" })

    const transacao = h.calls.indexOf("$transaction")
    expect(transacao).toBeGreaterThanOrEqual(0)
    expect(h.calls.indexOf("store.findMany")).toBeGreaterThan(transacao)
    expect(h.calls.indexOf("store.update")).toBeGreaterThan(h.calls.indexOf("store.findMany"))
  })
})

describe("provisionStoreSaleNumberingCode — recusas de formato", () => {
  beforeEach(() => {
    seedStore({ id: "loja-1" })
  })

  const casos: Array<[string, unknown, string]> = [
    ["vazio", "", "EMPTY"],
    ["só espaços", "   ", "EMPTY"],
    ["ausente", undefined, "MISSING"],
    ["não string", 42, "NOT_A_STRING"],
    ["curto demais", "A", "TOO_SHORT"],
    ["longo demais", "ABCDEFGHI", "TOO_LONG"],
    ["com hífen", "RC-1", "INVALID_CHARACTERS"],
    ["com acento", "RÇ01", "INVALID_CHARACTERS"],
    ["com espaço interno", "RC 01", "INVALID_CHARACTERS"],
  ]

  for (const [nome, codigo, reason] of casos) {
    it(`recusa ${nome} com motivo ${reason}`, async () => {
      const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo })
      expect(result.status).toBe("INVALID")
      if (result.status !== "INVALID") return
      expect(result.reason).toBe(reason)
      expect(h.calls).not.toContain("store.update")
      expect((h.stores[0] as unknown as StoreRow).codigoNumeracaoVenda).toBeNull()
    })
  }
})

describe("provisionStoreSaleNumberingCode — unicidade global", () => {
  it("recusa código já usado por outra loja e informa a ocupante", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })
    seedStore({ id: "loja-2" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-2", codigo: "rc01" })

    expect(result.status).toBe("CONFLICT")
    if (result.status !== "CONFLICT") return
    expect(result.conflitoStoreId).toBe("loja-1")
    expect(result.codigo).toBe("RC01")
    expect(h.calls).not.toContain("store.update")
  })

  it("traduz a corrida decidida pelo banco (P2002) em conflito, sem ocupante conhecida", async () => {
    seedStore({ id: "loja-1" })
    const rival = seedStore({ id: "loja-2" })
    // Concorrente vence entre a leitura dos ocupados e o UPDATE desta transação.
    h.setBeforeUpdate(() => {
      rival.codigoNumeracaoVenda = "RC01"
    })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "RC01" })

    expect(result.status).toBe("CONFLICT")
    if (result.status !== "CONFLICT") return
    expect(result.conflitoStoreId).toBeNull()
    expect((h.stores[0] as unknown as StoreRow).codigoNumeracaoVenda).toBeNull()
  })

  it("repetir o mesmo valor na mesma loja é idempotente e não escreve", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "rc01" })

    expect(result.status).toBe("UNCHANGED")
    if (result.status !== "UNCHANGED") return
    expect(result.store.codigo).toBe("RC01")
    expect(h.calls).not.toContain("store.update")
  })
})

describe("provisionStoreSaleNumberingCode — loja resolvida no servidor", () => {
  it("recusa loja inexistente", async () => {
    seedStore({ id: "loja-1" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-999", codigo: "RC01" })

    expect(result.status).toBe("STORE_NOT_FOUND")
    expect(h.calls).not.toContain("store.update")
  })

  it("recusa storeId vazio sem consultar o banco", async () => {
    const result = await provisionStoreSaleNumberingCode({ storeId: "   ", codigo: "RC01" })

    expect(result.status).toBe("STORE_NOT_FOUND")
    expect(h.calls).toHaveLength(0)
  })

  it("escreve somente na loja pedida", async () => {
    seedStore({ id: "loja-1" })
    seedStore({ id: "loja-2" })

    await provisionStoreSaleNumberingCode({ storeId: "loja-2", codigo: "RC02" })

    expect((h.stores[0] as unknown as StoreRow).codigoNumeracaoVenda).toBeNull()
    expect((h.stores[1] as unknown as StoreRow).codigoNumeracaoVenda).toBe("RC02")
  })
})

describe("provisionStoreSaleNumberingCode — imutabilidade após consumo", () => {
  it("bloqueia a troca quando já existe série persistida para a loja", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })
    h.series.push({ storeId: "loja-1", ano: 2026, prefixo: "RC01" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "NOVO" })

    expect(result.status).toBe("IMMUTABLE")
    if (result.status !== "IMMUTABLE") return
    expect(result.store.imutavel).toBe(true)
    expect(result.store.uso.series).toBe(1)
    expect(h.calls).not.toContain("store.update")
    expect((h.stores[0] as unknown as StoreRow).codigoNumeracaoVenda).toBe("RC01")
  })

  it("conta as vendas vinculadas à série apenas como evidência de exibição", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })
    h.series.push({ storeId: "loja-1", ano: 2026, prefixo: "RC01" })
    h.vendas.push({ storeId: "loja-1", serieVendaId: "serie-1" })
    h.vendas.push({ storeId: "loja-1", serieVendaId: null })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "NOVO" })

    expect(result.status).toBe("IMMUTABLE")
    if (result.status !== "IMMUTABLE") return
    expect(result.store.uso.vendas).toBe(1)
  })

  it("reapresentar o mesmo código continua idempotente mesmo com série consumida", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })
    h.series.push({ storeId: "loja-1", ano: 2026, prefixo: "RC01" })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "RC01" })

    expect(result.status).toBe("UNCHANGED")
    expect(h.calls).not.toContain("store.update")
  })

  it("não infere consumo a partir de vendas históricas sem série", async () => {
    seedStore({ id: "loja-1", codigoNumeracaoVenda: "RC01" })
    h.vendas.push({ storeId: "loja-1", serieVendaId: null })

    const result = await provisionStoreSaleNumberingCode({ storeId: "loja-1", codigo: "NOVO" })

    expect(result.status).toBe("SAVED")
  })
})

describe("readStoreSaleNumberingStatuses", () => {
  it("devolve estado por loja e ignora ids vazios ou repetidos", async () => {
    seedStore({ id: "loja-1", name: "Matriz", codigoNumeracaoVenda: "RC01" })
    seedStore({ id: "loja-2", name: "Filial" })
    h.series.push({ storeId: "loja-1", ano: 2026, prefixo: "RC01" })

    const statuses = await readStoreSaleNumberingStatuses(["loja-1", "loja-1", " ", "loja-2"])

    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toMatchObject({
      storeId: "loja-1",
      name: "Matriz",
      codigo: "RC01",
      configurado: true,
      imutavel: true,
    })
    expect(statuses[1]).toMatchObject({
      storeId: "loja-2",
      codigo: null,
      configurado: false,
      imutavel: false,
    })
  })

  it("devolve lista vazia sem consultar o banco quando não há loja acessível", async () => {
    const statuses = await readStoreSaleNumberingStatuses([])
    expect(statuses).toEqual([])
    expect(h.calls).toHaveLength(0)
  })
})

describe("GOAL 002C-0b — contrato estático da superfície de provisionamento", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
  const read = (relative: string) => readFileSync(resolve(repoRoot, relative), "utf8")

  const SUPERFICIE = [
    "lib/vendas/store-sale-numbering-provision.ts",
    "app/api/stores/numeracao-venda/route.ts",
    "components/dashboard/configuracoes/numeracao-venda-lojas.tsx",
  ] as const

  it("não gera código automaticamente", () => {
    for (const path of SUPERFICIE) {
      const source = read(path)
      expect(source, path).not.toMatch(/\bMath\.random\s*\(/)
      expect(source, path).not.toMatch(/\brandomUUID\b/)
      expect(source, path).not.toMatch(/\b_max\b/)
      expect(source, path).not.toMatch(/\baggregate\s*\(/)
    }
    const service = read("lib/vendas/store-sale-numbering-provision.ts")
    // Existe uma única escrita na coluna, e o valor vem do plano do contrato puro.
    const escritas = service.match(/data:\s*\{\s*codigoNumeracaoVenda:\s*[^\s,}]+/g) ?? []
    expect(escritas).toHaveLength(1)
    expect(escritas[0]).toContain("assignment.codigo")
  })

  it("não chama o allocator nem o writer", () => {
    for (const path of SUPERFICIE) {
      const source = read(path)
      expect(source, path).not.toContain("server-sale-numbering")
      expect(source, path).not.toContain("allocateSaleNumber")
      expect(source, path).not.toContain("ensureSerieVenda")
      expect(source, path).not.toContain("finalizeSaleTransaction")
      expect(source, path).not.toContain("ops-upsert-venda")
    }
  })

  it("não toca o gate de runtime nem a flag do writer v2", () => {
    for (const path of SUPERFICIE) {
      const source = read(path)
      expect(source, path).not.toContain("SALE_SERVER_NUMBERING_ENABLED")
      expect(source, path).not.toContain("sale-numbering-runtime-gate")
      expect(source, path).not.toContain("resolveSaleNumberingWriter")
    }
    // O gate segue sem consumidor: só o próprio módulo e seus testes o citam.
    expect(read("lib/vendas/sale-numbering-runtime-gate.ts")).toContain(
      "SALE_SERVER_NUMBERING_ENABLED",
    )
  })

  it("a escrita passa por planStoreSaleNumberingCodes", () => {
    const service = read("lib/vendas/store-sale-numbering-provision.ts")
    expect(service).toContain("planStoreSaleNumberingCodes")
    expect(service).toContain('import "server-only"')
  })

  it("não expõe dados de conexão nem project id", () => {
    for (const path of SUPERFICIE) {
      const source = read(path)
      expect(source, path).not.toMatch(/DATABASE_URL|DIRECT_URL/)
      expect(source, path).not.toMatch(/["']prj_/)
      expect(source, path).not.toMatch(/\bconsole\s*\./)
    }
  })

  it("leitura e escrita da rota passam pelo mesmo gate administrativo", () => {
    const route = read("app/api/stores/numeracao-venda/route.ts")
    // Nenhum handler pode cair no gate de sessão simples: ele aceita qualquer papel.
    expect(route).not.toContain("requireStoresSession")
    for (const handler of ["export async function GET", "export async function PUT"]) {
      const inicio = route.indexOf(handler)
      expect(inicio, handler).toBeGreaterThanOrEqual(0)
      const corpo = route.slice(inicio, inicio + 200)
      expect(corpo, handler).toContain("await requireAdmin()")
    }
  })

  it("a superfície administrativa reusa a gestão de unidades existente", () => {
    const gestao = read("components/dashboard/configuracoes/gestao-unidades-saas.tsx")
    expect(gestao).toContain("NumeracaoVendaLojas")
  })
})
