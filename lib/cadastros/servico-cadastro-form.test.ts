import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(
  resolve(process.cwd(), "components/cadastros/lovable/components/cadastros/CadastrosHub.tsx"),
  "utf8",
)
const start = source.indexOf("function ServicosPanel")
const end = source.indexOf("function Stat", start)
const servicosPanel = source.slice(start, end)

describe("formulário real de Serviço no Cadastros HUB", () => {
  it("cria CategoriaCadastro type=servico inline e controla a seleção", () => {
    expect(servicosPanel).toContain('type: "servico"')
    expect(servicosPanel).toContain("value={selectedCategoria}")
    expect(servicosPanel).toContain("setSelectedCategoria(next.selectedName)")
    expect(servicosPanel).toContain("Nenhuma categoria de serviço cadastrada")
  })

  it("não exibe como editáveis campos sem contrato de persistência", () => {
    expect(servicosPanel).not.toContain("Peças sugeridas")
    expect(servicosPanel).not.toContain("Checklist padrão")
    expect(servicosPanel).not.toContain("Template de legenda")
    expect(servicosPanel).not.toContain("Hashtags padrão")
    expect(servicosPanel).not.toContain("Usar em conteúdo automático")
  })
})
