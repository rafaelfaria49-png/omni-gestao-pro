/**
 * Contrato multipart da seleção de domínios (F-06).
 *
 * O hook envia `dominios[]`; a rota lia `dominios`. A seleção era descartada em
 * silêncio. Aqui fixamos: as duas chaves são aceitas, a normalização é única, e
 * valor desconhecido é REJEITADO em vez de ignorado.
 */

import { describe, expect, it } from "vitest"
import {
  CHAVE_DOMINIOS_CANONICA,
  CHAVE_DOMINIOS_LEGADA,
  DOMINIOS_IMPORT_SELECIONAVEIS,
  lerSelecaoDominiosDoFormData,
  normalizarSelecaoDominios,
} from "./dominios-multipart"

describe("normalizarSelecaoDominios", () => {
  it("ausência de filtro devolve lista vazia (importar todos os detectados)", () => {
    const r = normalizarSelecaoDominios([])
    expect(r).toEqual({ ok: true, dominios: [] })
  })

  it("aceita somente produtos", () => {
    expect(normalizarSelecaoDominios(["produtos"])).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("aceita produtos + fornecedores preservando a ordem informada", () => {
    expect(normalizarSelecaoDominios(["produtos", "fornecedores"])).toEqual({
      ok: true,
      dominios: ["produtos", "fornecedores"],
    })
  })

  it("faz trim", () => {
    expect(normalizarSelecaoDominios(["  produtos  "])).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("deduplica mantendo a primeira ocorrência", () => {
    expect(normalizarSelecaoDominios(["produtos", "produtos", " produtos "])).toEqual({
      ok: true,
      dominios: ["produtos"],
    })
  })

  it("descarta strings vazias sem virar erro", () => {
    expect(normalizarSelecaoDominios(["", "   ", "produtos"])).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("REJEITA domínio desconhecido em vez de ignorar", () => {
    const r = normalizarSelecaoDominios(["produtos", "planilha_maluca"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.invalidos).toEqual(["planilha_maluca"])
  })

  it("REJEITA `desconhecido` — resultado de detecção falhada não é escolha válida", () => {
    const r = normalizarSelecaoDominios(["desconhecido"])
    expect(r.ok).toBe(false)
  })

  it("é case-sensitive: `Produtos` não é aceito por engano", () => {
    expect(normalizarSelecaoDominios(["Produtos"]).ok).toBe(false)
  })

  it("trunca valor inválido gigante no relato de erro", () => {
    const r = normalizarSelecaoDominios(["x".repeat(500)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.invalidos[0]!.length).toBe(60)
  })

  it("`produtos` está na allowlist e `desconhecido` não", () => {
    expect(DOMINIOS_IMPORT_SELECIONAVEIS).toContain("produtos")
    expect(DOMINIOS_IMPORT_SELECIONAVEIS as readonly string[]).not.toContain("desconhecido")
  })
})

/** FormData mínimo — o mesmo shape que a rota consome. */
function fdFake(entradas: Record<string, string[]>) {
  return { getAll: (name: string) => entradas[name] ?? [] }
}

describe("lerSelecaoDominiosDoFormData", () => {
  it("lê a chave canônica `dominios[]`", () => {
    const r = lerSelecaoDominiosDoFormData(fdFake({ [CHAVE_DOMINIOS_CANONICA]: ["produtos"] }))
    expect(r).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("lê a chave legada `dominios`", () => {
    const r = lerSelecaoDominiosDoFormData(fdFake({ [CHAVE_DOMINIOS_LEGADA]: ["produtos"] }))
    expect(r).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("as duas chaves juntas não duplicam", () => {
    const r = lerSelecaoDominiosDoFormData(
      fdFake({ [CHAVE_DOMINIOS_CANONICA]: ["produtos"], [CHAVE_DOMINIOS_LEGADA]: ["produtos"] }),
    )
    expect(r).toEqual({ ok: true, dominios: ["produtos"] })
  })

  it("canônica e legada com valores diferentes são unidas", () => {
    const r = lerSelecaoDominiosDoFormData(
      fdFake({ [CHAVE_DOMINIOS_CANONICA]: ["produtos"], [CHAVE_DOMINIOS_LEGADA]: ["fornecedores"] }),
    )
    expect(r).toEqual({ ok: true, dominios: ["produtos", "fornecedores"] })
  })

  it("nenhuma das chaves = sem filtro", () => {
    expect(lerSelecaoDominiosDoFormData(fdFake({}))).toEqual({ ok: true, dominios: [] })
  })

  it("valor inválido na chave canônica é rejeitado", () => {
    expect(lerSelecaoDominiosDoFormData(fdFake({ [CHAVE_DOMINIOS_CANONICA]: ["nao_existe"] })).ok).toBe(false)
  })
})
