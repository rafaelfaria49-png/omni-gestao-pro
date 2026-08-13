import { describe, expect, it } from "vitest"
import { categoriaCriadaSelecionada, categoriasAtivasDeServico } from "@/lib/cadastros/servico-categorias"
import { normalizeServicoRow } from "@/lib/pdv-assistencia-shortcuts"

describe("categorias inline do cadastro de serviço", () => {
  const categorias = [
    { id: "p1", name: "Capas", type: "produto", active: true },
    { id: "s1", name: "Manutenção", type: "servico", active: true },
    { id: "s2", name: "Inativa", type: "servico", active: false },
  ]

  it("lista somente CategoriaCadastro ativa de type=servico", () => {
    expect(categoriasAtivasDeServico(categorias).map((item) => item.name)).toEqual(["Manutenção"])
  })

  it("inclui e seleciona automaticamente a categoria recém-criada", () => {
    const result = categoriaCriadaSelecionada(categorias, {
      id: "s3",
      name: "Software e Dados",
      type: "servico",
      active: true,
    })
    expect(result.selectedName).toBe("Software e Dados")
    expect(result.categorias.map((item) => item.name)).toEqual(["Manutenção", "Software e Dados"])

    const pdvItem = normalizeServicoRow({
      id: "svc-1",
      nome: "Transferência de Dados",
      categoria: result.selectedName,
      custo: 0,
      preco: 80,
      garantia: 0,
      termo: "",
      active: true,
      status: "Ativo",
    })
    expect(pdvItem.serviceCategory).toBe("Software e Dados")
  })
})
