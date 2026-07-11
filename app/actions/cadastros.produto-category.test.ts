import { beforeEach, describe, expect, it, vi } from "vitest"

const STORE = "loja-categoria"

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const produtos = new Map<string, Row>()
  let seq = 0

  const prisma = {
    produto: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string | { not?: string }
          storeId?: string
          OR?: Array<{ sku?: string | null; barcode?: string | null }>
        }
      }) => {
        for (const row of produtos.values()) {
          if (where.storeId && row.storeId !== where.storeId) continue
          if (typeof where.id === "string" && row.id !== where.id) continue
          if (where.id && typeof where.id === "object" && row.id === where.id.not) continue
          if (!where.OR) return row
          if (where.OR.some((part) =>
            (part.sku !== undefined && row.sku === part.sku)
            || (part.barcode !== undefined && row.barcode === part.barcode))) return row
        }
        return null
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `produto-${++seq}`, ...data }
        produtos.set(String(row.id), row)
        return row
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = produtos.get(where.id)
        if (!row) throw new Error("Produto não encontrado")
        Object.assign(row, data)
        return row
      },
    },
  }

  return {
    prisma,
    produtos,
    seed: (row: Row) => {
      const full = { id: `produto-${++seq}`, storeId: STORE, sku: null, barcode: null, ...row }
      produtos.set(String(full.id), full)
      return full
    },
    reset: () => {
      produtos.clear()
      seq = 0
    },
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: h.prisma,
  withPrismaSafe: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { upsertProduto } from "./cadastros"

beforeEach(() => h.reset())

describe("upsertProduto — persistência de categoria", () => {
  it("cria produto com categoria canônica e metadata.acessorios intacto", async () => {
    const acessorios = { modelos: ["iPhone 15"], cores: ["Preto"] }
    const result = await upsertProduto(STORE, {
      nome: "Capa MagSafe",
      categoria: "  Capinhas  ",
      metadata: { acessorios },
    })

    expect(result.ok).toBe(true)
    const saved = Array.from(h.produtos.values())[0]
    expect(saved.category).toBe("Capinhas")
    expect(saved.metadata).toEqual({ acessorios })
  })

  it("preserva categoria ao editar outro campo sem enviar categoria", async () => {
    const current = h.seed({ name: "Cabo", category: "Cabos", metadata: { acessorios: { tipo: "usb-c" } } })
    await upsertProduto(STORE, { id: String(current.id), nome: "Cabo reforçado" })

    expect(h.produtos.get(String(current.id))?.category).toBe("Cabos")
    expect(h.produtos.get(String(current.id))?.metadata).toEqual({ acessorios: { tipo: "usb-c" } })
  })

  it("altera e remove categoria explicitamente", async () => {
    const current = h.seed({ name: "Película", category: "Acessórios" })

    await upsertProduto(STORE, { id: String(current.id), nome: "Película", categoria: " Películas " })
    expect(h.produtos.get(String(current.id))?.category).toBe("Películas")

    await upsertProduto(STORE, { id: String(current.id), nome: "Película", categoria: "" })
    expect(h.produtos.get(String(current.id))?.category).toBeNull()
  })

  it("mantém produto antigo sem categoria compatível e faz merge aditivo de metadata", async () => {
    const current = h.seed({
      name: "Produto legado",
      category: null,
      metadata: { acessorios: { familia: "capas" }, fiscal: { ncm: "39269090" } },
    })

    await upsertProduto(STORE, {
      id: String(current.id),
      nome: "Produto legado revisado",
      metadata: { cadastroIa: { source: "manual" } },
    })

    const saved = h.produtos.get(String(current.id))
    expect(saved?.category).toBeNull()
    expect(saved?.metadata).toEqual({
      acessorios: { familia: "capas" },
      fiscal: { ncm: "39269090" },
      cadastroIa: { source: "manual" },
    })
  })
})
