import { describe, expect, it } from "vitest"
import { isServicoDisponivelParaVenda } from "@/lib/servicos/servico-pdv"

const base = {
  nome: "Transferência de Dados",
  categoria: "Software e Dados",
  preco: 80,
  active: true,
  status: "Ativo",
}

describe("catálogo operacional de serviços", () => {
  it("inclui serviço ativo e completo", () => {
    expect(isServicoDisponivelParaVenda(base)).toBe(true)
  })

  it.each([
    [{ ...base, active: false }, "inativo por flag"],
    [{ ...base, active: undefined }, "sem confirmação de ativo"],
    [{ ...base, status: "Inativo" }, "status inativo"],
    [{ ...base, status: "Incompleto" }, "incompleto"],
    [{ ...base, nome: "" }, "sem nome"],
    [{ ...base, categoria: "—" }, "sem categoria"],
    [{ ...base, preco: 0 }, "sem preço"],
  ])("exclui %s (%s)", (row, _reason) => {
    expect(isServicoDisponivelParaVenda(row)).toBe(false)
  })
})
