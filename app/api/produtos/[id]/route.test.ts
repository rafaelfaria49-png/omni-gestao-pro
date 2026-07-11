import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@/generated/prisma"

// ============================================================================
// CADASTROS-PRODUTOS-DUPLICIDADE-002 — aviso claro de "Produto já cadastrado" na EDIÇÃO.
// ----------------------------------------------------------------------------
// Antes, o PATCH /api/produtos/[id] fazia updateMany direto; mudar SKU/EAN para um que
// já pertence a OUTRO produto da loja caía no unique constraint (P2002) e virava um 503
// genérico ("Falha ao atualizar produto"), sem avisar o operador. Agora a duplicidade
// forte (mesmo SKU/código ou barcode/EAN de OUTRO produto da mesma loja — o próprio
// produto é ignorado) é detectada e responde 409 estruturado
// { type: "DUPLICATE_PRODUCT", field, message, produto }.
//
// Exercita o handler PATCH de PRODUÇÃO sobre um Prisma EM MEMÓRIA. Apenas auth/store-id/
// conexão são mockados; a detecção (pré-checagem + ramo P2002) roda sobre o banco fake.
// ============================================================================

const STORE = "loja-2"

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const produtos = new Map<string, Row>()
  let seq = 0
  // Quando true, as consultas de duplicidade (com OR) devolvem null — simula a CORRIDA em
  // que o SKU/EAN foi tomado por outro produto entre a verificação e o update (ramo P2002).
  let suppressDupFindFirst = false

  function p2002(target: string[]): never {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target },
    })
  }

  type WhereId = string | { not?: string } | undefined
  function matchesId(rowId: unknown, whereId: WhereId): boolean {
    if (whereId === undefined) return true
    if (typeof whereId === "string") return rowId === whereId
    if (whereId && typeof whereId === "object" && "not" in whereId) return rowId !== whereId.not
    return true
  }

  const prisma = {
    produto: {
      findFirst: async ({
        where,
      }: {
        where: { id?: WhereId; storeId?: string; OR?: Array<{ sku?: string; barcode?: string }> }
      }) => {
        const hasOr = Array.isArray(where.OR)
        if (hasOr && suppressDupFindFirst) return null
        for (const r of produtos.values()) {
          if (where.storeId && r.storeId !== where.storeId) continue
          if (!matchesId(r.id, where.id)) continue
          if (!where.OR) return r
          for (const c of where.OR) {
            if (c.sku !== undefined && r.sku === c.sku) return r
            if (c.barcode !== undefined && r.barcode === c.barcode) return r
          }
        }
        return null
      },
      updateMany: async ({ where, data }: { where: { id?: string; storeId?: string }; data: Row }) => {
        let target: Row | undefined
        for (const r of produtos.values()) {
          if (where.storeId && r.storeId !== where.storeId) continue
          if (where.id && r.id !== where.id) continue
          target = r
          break
        }
        if (!target) return { count: 0 }
        // Espelha os unique constraints @@unique([storeId, sku]) / [storeId, barcode]:
        // colisão só com OUTRO produto da mesma loja (o próprio alvo é ignorado).
        for (const r of produtos.values()) {
          if (r.id === target.id) continue
          if (r.storeId !== target.storeId) continue
          if (data.sku != null && r.sku === data.sku) p2002(["storeId", "sku"])
          if (data.barcode != null && r.barcode === data.barcode) p2002(["storeId", "barcode"])
        }
        Object.assign(target, data)
        return { count: 1 }
      },
    },
  }

  return {
    prisma,
    produtos,
    seedDireto: (row: Row) => {
      const full: Row = { id: `seed-${++seq}`, stock: 0, sku: null, barcode: null, storeId: STORE, ...row }
      produtos.set(String(full.id), full)
      return full
    },
    setSuppressDupFindFirst: (v: boolean) => {
      suppressDupFindFirst = v
    },
    reset: () => {
      produtos.clear()
      seq = 0
      suppressDupFindFirst = false
    },
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: h.prisma,
  prismaEnsureConnected: vi.fn(async () => undefined),
}))
vi.mock("@/lib/cadastros/hub-api-gate", () => ({
  requireCadastrosHubApi: vi.fn(async () => ({ ok: true as const, storeId: STORE })),
}))

import { PATCH } from "./route"

function patchReq(id: string, body: Record<string, unknown>) {
  return {
    req: new Request(`http://local/api/produtos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-assistec-loja-id": STORE },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ id }) },
  }
}

type PatchJson = {
  ok?: boolean
  type?: string
  field?: string
  message?: string
  error?: string
  produto?: { id?: string; name?: string; sku?: string | null; barcode?: string | null; stock?: number | null; category?: string | null; metadata?: unknown }
}

async function runPatch(id: string, body: Record<string, unknown>) {
  const { req, context } = patchReq(id, body)
  const res = await PATCH(req, context)
  return { res, json: (await res.json()) as PatchJson }
}

beforeEach(() => {
  h.reset()
})

describe("PATCH /api/produtos/[id] — aviso de duplicidade na edição (CADASTROS-PRODUTOS-DUPLICIDADE-002)", () => {
  it("editar SKU para um SKU já usado por OUTRO produto da loja → 409 DUPLICATE_PRODUCT (field sku)", async () => {
    const existente = h.seedDireto({ name: "Carregador Turbo", sku: "CARR-99", stock: 7 })
    const alvo = h.seedDireto({ name: "Carregador comum", sku: "CARR-10", stock: 2 })
    const { res, json } = await runPatch(String(alvo.id), { codigo: "CARR-99" })
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.field).toBe("sku")
    expect(json.produto?.id).toBe(existente.id)
    expect(json.produto?.name).toBe("Carregador Turbo")
    expect(json.produto?.stock).toBe(7)
    expect(json.message).toMatch(/já cadastrado/i)
  })

  it("editar barcode/EAN para um EAN já usado por OUTRO produto da loja → 409 DUPLICATE_PRODUCT (field barcode)", async () => {
    h.seedDireto({ name: "Fone Bluetooth", barcode: "7891234567890", stock: 3 })
    const alvo = h.seedDireto({ name: "Fone comum", barcode: "7890000000002", stock: 1 })
    const { res, json } = await runPatch(String(alvo.id), { barcode: "7891234567890" })
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.field).toBe("barcode")
    expect(json.produto?.name).toBe("Fone Bluetooth")
    expect(json.message).toMatch(/já cadastrado/i)
  })

  it("manter o PRÓPRIO SKU/EAN do produto (editando outros campos) funciona — não bloqueia", async () => {
    const alvo = h.seedDireto({ name: "Película 3D", sku: "PEL-1", barcode: "7890000000001", stock: 4 })
    const { res, json } = await runPatch(String(alvo.id), {
      name: "Película 3D Premium",
      price: 29.9,
      sku: "PEL-1",
      barcode: "7890000000001",
    })
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.produto?.name).toBe("Película 3D Premium")
  })

  it("mesmo SKU em OUTRA loja não bloqueia a edição (escopo por storeId)", async () => {
    h.seedDireto({ name: "Suporte veicular", sku: "SUP-1", storeId: "loja-9", stock: 5 })
    const alvo = h.seedDireto({ name: "Suporte novo", sku: "SUP-X", stock: 2 })
    const { res, json } = await runPatch(String(alvo.id), { sku: "SUP-1" })
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.produto?.sku).toBe("SUP-1")
  })

  it("erro Prisma P2002 (corrida) vira 409 amigável, nunca 503", async () => {
    h.seedDireto({ name: "Cabo USB-C", sku: "CAB-1", stock: 9 })
    const alvo = h.seedDireto({ name: "Cabo novo", sku: "CAB-9", stock: 1 })
    h.setSuppressDupFindFirst(true) // pré-checagem não enxerga; só o update colide
    const { res, json } = await runPatch(String(alvo.id), { sku: "CAB-1" })
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.message).toMatch(/já cadastrado/i)
  })

  it("editar apenas nome/preço/estoque (sem mexer em SKU/EAN) funciona", async () => {
    const acessorios = { modelos: ["universal"] }
    const alvo = h.seedDireto({ name: "Caixa de som", sku: "SOM-1", stock: 3, category: "Áudio", metadata: { acessorios } })
    const { res, json } = await runPatch(String(alvo.id), { name: "Caixa de som JBL", price: 199, stock: 8 })
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.produto?.name).toBe("Caixa de som JBL")
    expect(json.produto?.stock).toBe(8)
    expect(json.produto?.category).toBe("Áudio")
    expect(json.produto?.metadata).toEqual({ acessorios })
  })

  it("altera categoria e preserva metadata.acessorios", async () => {
    const acessorios = { modelos: ["iPhone 15"] }
    const alvo = h.seedDireto({ name: "Capa", category: "Acessórios", metadata: { acessorios } })
    const { res, json } = await runPatch(String(alvo.id), { category: "  Capinhas  " })

    expect(res.status).toBe(200)
    expect(json.produto?.category).toBe("Capinhas")
    expect(json.produto?.metadata).toEqual({ acessorios })
  })

  it("remove categoria com string vazia e mantém produto antigo sem categoria compatível", async () => {
    const categorizado = h.seedDireto({ name: "Capa", category: "Capinhas" })
    const removido = await runPatch(String(categorizado.id), { category: "" })
    expect(removido.res.status).toBe(200)
    expect(removido.json.produto?.category).toBeNull()

    const legado = h.seedDireto({ name: "Legado", category: null })
    const preservado = await runPatch(String(legado.id), { name: "Legado revisado" })
    expect(preservado.res.status).toBe(200)
    expect(preservado.json.produto?.category).toBeNull()
  })

  it("limpar o SKU (string vazia → null) não dispara duplicidade", async () => {
    const alvo = h.seedDireto({ name: "Item sem código", sku: "TMP-1", stock: 1 })
    const { res, json } = await runPatch(String(alvo.id), { sku: "" })
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.produto?.sku).toBeNull()
  })
})
