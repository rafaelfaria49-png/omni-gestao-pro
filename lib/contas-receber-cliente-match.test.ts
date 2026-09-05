/**
 * Casamento cliente × título — GOAL `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005`.
 *
 * O defeito que estes testes fecham (achado H da
 * `AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`) era substring bidirecional:
 * `titulo.includes(cliente) || cliente.includes(titulo)`. Com ele, selecionar "Ana"
 * trazia os títulos de "Mariana" e "Joana" para a tela de recebimento do PDV — e o
 * operador podia receber, e dar baixa, na conta de outra pessoa.
 */
import { describe, expect, it } from "vitest"
import {
  matchTituloCliente,
  normalizeDocumento,
  normalizeNomeCliente,
  normalizeTelefone,
  tituloPertenceAoCliente,
} from "@/lib/contas-receber-cliente-match"

describe("normalização", () => {
  it("nome ignora acento, caixa e espaço redundante", () => {
    expect(normalizeNomeCliente("  JOÃO   da Silva ")).toBe("joao da silva")
    expect(normalizeNomeCliente("Ána")).toBe(normalizeNomeCliente("ana"))
  })

  it("documento e telefone reduzem a dígitos; telefone perde o +55", () => {
    expect(normalizeDocumento("123.456.789-00")).toBe("12345678900")
    expect(normalizeTelefone("+55 (11) 98888-7777")).toBe("11988887777")
    expect(normalizeTelefone("11988887777")).toBe("11988887777")
  })
})

describe("proibição do casamento por substring", () => {
  const ana = { id: "", name: "Ana" }

  it('"Ana" NÃO casa com "Mariana" nem com "Joana"', () => {
    expect(tituloPertenceAoCliente({ cliente: "Mariana" }, ana)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Joana" }, ana)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Ana Paula" }, ana)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Mariana Souza" }, ana)).toBe(false)
  })

  it('"Ana" casa com "Ana" (e com "ANA"/"Aná") — o nome exato continua valendo', () => {
    expect(matchTituloCliente({ cliente: "Ana" }, ana)).toBe("nome")
    expect(matchTituloCliente({ cliente: "ANA" }, ana)).toBe("nome")
    expect(matchTituloCliente({ cliente: " Aná " }, ana)).toBe("nome")
  })

  it("documento/telefone do cliente não são comparados contra o NOME do título", () => {
    const cliente = { id: "", name: "Ana", document: "12345678900", phone: "11988887777" }
    expect(tituloPertenceAoCliente({ cliente: "12345678900" }, cliente)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "11988887777" }, cliente)).toBe(false)
  })
})

describe("escada de prioridade", () => {
  it("identificador estável vence e é decisivo — homônimo com id diferente NÃO casa", () => {
    const joao1 = { id: "cli-1", name: "João Silva" }
    const joao2 = { id: "cli-2", name: "João Silva" }
    const titulo = { clienteId: "cli-1", cliente: "João Silva" }

    expect(matchTituloCliente(titulo, joao1)).toBe("clienteId")
    // Mesmo nome, id diferente: não pode cair para o degrau do nome.
    expect(matchTituloCliente(titulo, joao2)).toBe(null)
  })

  it("id em branco não é chave — cai para o degrau seguinte", () => {
    expect(matchTituloCliente({ clienteId: "   ", cliente: "Ana" }, { id: "cli-9", name: "Ana" })).toBe("nome")
    expect(matchTituloCliente({ clienteId: "cli-9", cliente: "Ana" }, { id: "", name: "Ana" })).toBe("nome")
  })

  it("documento decide antes do telefone e do nome", () => {
    const cliente = { id: "", name: "Ana", document: "123.456.789-00", phone: "11988887777" }
    expect(
      matchTituloCliente({ clienteDocumento: "12345678900", cliente: "Outro Nome" }, cliente),
    ).toBe("documento")
    expect(
      matchTituloCliente(
        { clienteDocumento: "99999999999", clienteTelefone: "11988887777", cliente: "Ana" },
        cliente,
      ),
    ).toBe(null)
  })

  it("telefone decide antes do nome", () => {
    const cliente = { id: "", name: "Ana", phone: "+55 11 98888-7777" }
    expect(matchTituloCliente({ clienteTelefone: "11988887777", cliente: "Outro" }, cliente)).toBe("telefone")
    expect(matchTituloCliente({ clienteTelefone: "11955554444", cliente: "Ana" }, cliente)).toBe(null)
  })

  it("sem nenhum identificador dos dois lados, não atribui (falso-negativo)", () => {
    expect(matchTituloCliente({ cliente: "" }, { id: "", name: "Ana" })).toBe(null)
    expect(matchTituloCliente({ cliente: "Ana" }, { id: "", name: "" })).toBe(null)
    expect(matchTituloCliente({}, {})).toBe(null)
  })
})
