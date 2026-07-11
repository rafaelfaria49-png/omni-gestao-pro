import { describe, expect, it } from "vitest"
import {
  normalizeProdutoCategory,
  produtoCategoryForRead,
  produtoCategoryPatch,
} from "./produto-category"

describe("contrato canônico de Produto.category", () => {
  it("persiste nome/slug como string aparada", () => {
    expect(normalizeProdutoCategory("  Capinhas  ")).toBe("Capinhas")
    expect(normalizeProdutoCategory(" acessorio ")).toBe("acessorio")
  })

  it("normaliza vazio, null e formatos antigos não-string para sem categoria", () => {
    expect(normalizeProdutoCategory("   ")).toBeNull()
    expect(normalizeProdutoCategory(null)).toBeNull()
    expect(normalizeProdutoCategory({ id: "cat-1", name: "Capinhas" })).toBeNull()
  })

  it("distingue preservar (undefined) de remover (vazio/null)", () => {
    expect(produtoCategoryPatch(undefined)).toEqual({})
    expect(produtoCategoryPatch("")).toEqual({ category: null })
    expect(produtoCategoryPatch(null)).toEqual({ category: null })
    expect(produtoCategoryPatch("  Telas ")).toEqual({ category: "Telas" })
  })

  it("faz read-back compatível de produto antigo sem categoria", () => {
    expect(produtoCategoryForRead(null)).toBe("")
    expect(produtoCategoryForRead("  ", "—")).toBe("—")
    expect(produtoCategoryForRead("  Baterias  ", "—")).toBe("Baterias")
  })
})
