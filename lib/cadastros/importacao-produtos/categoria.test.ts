import { describe, expect, it } from "vitest"

import { chaveCategoria, legibilizarCategoria, normalizarNomeCategoria, resolverNomeCategoria } from "./categoria"

describe("normalizarNomeCategoria", () => {
  it("preserva o nome legível — nunca sluga", () => {
    expect(normalizarNomeCategoria("Pilhas e Baterias")).toBe("Pilhas e Baterias")
    expect(normalizarNomeCategoria("  Utilidades  de   Cozinha ")).toBe("Utilidades de Cozinha")
    expect(normalizarNomeCategoria("Eletroportáteis")).toBe("Eletroportáteis")
  })
})

describe("legibilizarCategoria", () => {
  it("reconverte slug legado em nome legível", () => {
    expect(legibilizarCategoria("pilhas_e_baterias")).toBe("Pilhas e Baterias")
    expect(legibilizarCategoria("fitas_e_adesivos")).toBe("Fitas e Adesivos")
    expect(legibilizarCategoria("utilidades_de_cozinha")).toBe("Utilidades de Cozinha")
    expect(legibilizarCategoria("garrafas_e_termicos")).toBe("Garrafas e Termicos")
  })

  it("não mexe em nome que já é legível", () => {
    expect(legibilizarCategoria("Pilhas e Baterias")).toBe("Pilhas e Baterias")
    expect(legibilizarCategoria("Mercearia")).toBe("Mercearia")
    expect(legibilizarCategoria("Eletroportáteis")).toBe("Eletroportáteis")
  })

  it("não estraga nomes com hífen intencional e maiúsculas", () => {
    expect(legibilizarCategoria("Peças 3-em-1")).toBe("Peças 3-em-1")
  })
})

describe("chaveCategoria", () => {
  it("iguala slug e nome legível", () => {
    expect(chaveCategoria("pilhas_e_baterias")).toBe(chaveCategoria("Pilhas e Baterias"))
    expect(chaveCategoria("eletroportateis")).toBe(chaveCategoria("Eletroportáteis"))
  })
})

describe("resolverNomeCategoria", () => {
  it("reaproveita a grafia da CategoriaCadastro já existente na loja", () => {
    const existentes = ["Pilhas e Baterias", "Mercearia"]
    expect(resolverNomeCategoria("pilhas_e_baterias", existentes)).toBe("Pilhas e Baterias")
    expect(resolverNomeCategoria("PILHAS E BATERIAS", existentes)).toBe("Pilhas e Baterias")
  })

  it("usa o nome legível da planilha quando a loja não tem a categoria", () => {
    expect(resolverNomeCategoria("Garrafas e Térmicos", ["Mercearia"])).toBe("Garrafas e Térmicos")
  })

  it("categoria ausente devolve string vazia (não inventa 'geral')", () => {
    expect(resolverNomeCategoria("", ["Mercearia"])).toBe("")
    expect(resolverNomeCategoria(null, [])).toBe("")
  })
})
