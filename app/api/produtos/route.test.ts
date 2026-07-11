import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@/generated/prisma"

// ============================================================================
// CADASTROS-PRODUTOS-DUPLICIDADE-001 — aviso claro de "Produto já cadastrado".
// ----------------------------------------------------------------------------
// Antes, o POST /api/produtos criava direto; a colisão de SKU/EAN caía no unique
// constraint (P2002) e virava um 503 genérico ("Falha ao criar produto"), sem
// avisar o operador que o item já existia. Agora a duplicidade forte (mesmo
// SKU/código ou mesmo barcode/EAN na loja) é detectada e responde 409 com um
// payload estruturado { type: "DUPLICATE_PRODUCT", message, field, produto }.
//
// Exercita o handler POST de PRODUÇÃO sobre um Prisma EM MEMÓRIA. Apenas auth/
// store-id/conexão são mockados; a lógica de detecção roda sobre o banco fake.
// ============================================================================

const STORE = "loja-2"

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const produtos = new Map<string, Row>()
  let seq = 0
  // Quando true, findFirst sempre devolve null — simula a CORRIDA em que o item
  // foi criado entre a verificação e o insert (exercita o ramo P2002 do catch).
  let suppressFindFirst = false

  function p2002(target: string[]): never {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target },
    })
  }

  const prisma = {
    produto: {
      findFirst: async ({
        where,
      }: {
        where: { storeId?: string; OR?: Array<{ sku?: string; barcode?: string }> }
      }) => {
        if (suppressFindFirst) return null
        for (const r of produtos.values()) {
          if (where.storeId && r.storeId !== where.storeId) continue
          if (!where.OR) return r
          for (const c of where.OR) {
            if (c.sku !== undefined && r.sku === c.sku) return r
            if (c.barcode !== undefined && r.barcode === c.barcode) return r
          }
        }
        return null
      },
      create: async ({ data }: { data: Row }) => {
        // Espelha os unique constraints @@unique([storeId, sku]) / [storeId, barcode].
        for (const r of produtos.values()) {
          if (r.storeId !== data.storeId) continue
          if (data.sku != null && r.sku === data.sku) p2002(["storeId", "sku"])
          if (data.barcode != null && r.barcode === data.barcode) p2002(["storeId", "barcode"])
        }
        const row: Row = {
          id: `prod-${++seq}`,
          stock: 0,
          sku: null,
          barcode: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        produtos.set(String(row.id), row)
        return row
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
    setSuppressFindFirst: (v: boolean) => {
      suppressFindFirst = v
    },
    reset: () => {
      produtos.clear()
      seq = 0
      suppressFindFirst = false
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

import { POST } from "./route"

function postReq(body: Record<string, unknown>) {
  return new Request("http://local/api/produtos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistec-loja-id": STORE },
    body: JSON.stringify(body),
  })
}

type PostJson = {
  ok?: boolean
  type?: string
  field?: string
  message?: string
  error?: string
  produto?: { id?: string; name?: string; sku?: string | null; barcode?: string | null; stock?: number | null; category?: string | null; metadata?: unknown }
}

beforeEach(() => {
  h.reset()
})

describe("POST /api/produtos — aviso de duplicidade (CADASTROS-PRODUTOS-DUPLICIDADE-001)", () => {
  it("cadastra produto novo (sem colisão) com 201", async () => {
    const acessorios = { modelos: ["Galaxy A55"] }
    const res = await POST(postReq({
      name: "Cabo USB-C",
      stock: 10,
      price: 25,
      sku: "CAB-001",
      category: "  Cabos  ",
      metadata: { acessorios },
    }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(201)
    expect(json.ok).toBe(true)
    expect(json.produto?.name).toBe("Cabo USB-C")
    expect(json.produto?.category).toBe("Cabos")
    expect(json.produto?.metadata).toEqual({ acessorios })
  })

  it("mesmo código de barras/EAN na loja → 409 DUPLICATE_PRODUCT (field barcode)", async () => {
    h.seedDireto({ name: "Fone Bluetooth", barcode: "7891234567890", stock: 3 })
    const res = await POST(postReq({ name: "Fone BT novo", stock: 5, price: 80, barcode: "7891234567890" }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.field).toBe("barcode")
    expect(json.produto?.name).toBe("Fone Bluetooth")
    expect(json.produto?.stock).toBe(3)
    expect(json.message).toMatch(/já cadastrado/i)
  })

  it("mesmo SKU/código na loja → 409 DUPLICATE_PRODUCT (field sku)", async () => {
    h.seedDireto({ name: "Carregador Turbo", sku: "CARR-99", stock: 7 })
    const res = await POST(postReq({ name: "Carregador outro", stock: 1, price: 50, codigo: "CARR-99" }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.field).toBe("sku")
    expect(json.produto?.name).toBe("Carregador Turbo")
  })

  it("erro Prisma P2002 (corrida) vira 409 amigável, nunca 503", async () => {
    h.seedDireto({ name: "Película 3D", barcode: "7890000000001", stock: 2 })
    h.setSuppressFindFirst(true) // pré-checagem não enxerga; só o insert colide
    const res = await POST(postReq({ name: "Película nova", stock: 4, price: 15, barcode: "7890000000001" }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(409)
    expect(json.type).toBe("DUPLICATE_PRODUCT")
    expect(json.message).toMatch(/já cadastrado/i)
  })

  it("mesmo SKU em OUTRA loja não bloqueia (escopo por storeId)", async () => {
    h.seedDireto({ name: "Suporte veicular", sku: "SUP-1", storeId: "loja-9", stock: 5 })
    const res = await POST(postReq({ name: "Suporte veicular", stock: 5, price: 30, sku: "SUP-1" }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(201)
    expect(json.ok).toBe(true)
  })

  it("sem código, nome igual NÃO é bloqueado pela API (regra permite; aviso é client-side)", async () => {
    h.seedDireto({ name: "Caixa de som", stock: 1 })
    const res = await POST(postReq({ name: "Caixa de som", stock: 2, price: 120 }))
    const json = (await res.json()) as PostJson
    expect(res.status).toBe(201)
    expect(json.ok).toBe(true)
  })
})
