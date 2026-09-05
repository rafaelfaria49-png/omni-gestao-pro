/**
 * Casamento cliente × título — GOAL `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005` e
 * `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005-P1-HOMONYM-FIX`.
 *
 * Garante:
 * 1. Proibição absoluta de substring (achado H);
 * 2. Escada determinística: clienteId → documento → telefone → nome exato único;
 * 3. Proteção fail-closed diante de homônimos reais sem clienteId na mesma loja;
 * 4. Título legado com nome comprovadamente único continua operável.
 */
import { describe, expect, it } from "vitest"
import {
  criarResolvedorNomeUnico,
  mapearNomesAmbiguos,
  matchTituloCliente,
  normalizeDocumento,
  normalizeNomeCliente,
  normalizeTelefone,
  tituloPertenceAoCliente,
  verificarNomeUnico,
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

describe("proibição do casamento por substring (Critério 1)", () => {
  const ana = { id: "c-ana", name: "Ana" }
  const matchAnaUnica = { isNomeUnico: (n: string) => n === "ana" }

  it('1. "Ana" NÃO casa com "Mariana" nem com "Joana"', () => {
    expect(tituloPertenceAoCliente({ cliente: "Mariana" }, ana, matchAnaUnica)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Joana" }, ana, matchAnaUnica)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Ana Paula" }, ana, matchAnaUnica)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "Mariana Souza" }, ana, matchAnaUnica)).toBe(false)
  })

  it('"Ana" casa com "Ana" (e com "ANA"/"Aná") quando comprovadamente único na loja', () => {
    expect(matchTituloCliente({ cliente: "Ana" }, ana, matchAnaUnica)).toBe("nome")
    expect(matchTituloCliente({ cliente: "ANA" }, ana, matchAnaUnica)).toBe("nome")
    expect(matchTituloCliente({ cliente: " Aná " }, ana, matchAnaUnica)).toBe("nome")
  })

  it("documento/telefone do cliente não são comparados contra o NOME do título", () => {
    const cliente = { id: "c-1", name: "Ana", document: "12345678900", phone: "11988887777" }
    expect(tituloPertenceAoCliente({ cliente: "12345678900" }, cliente, matchAnaUnica)).toBe(false)
    expect(tituloPertenceAoCliente({ cliente: "11988887777" }, cliente, matchAnaUnica)).toBe(false)
  })
})

describe("gate de homônimos e matching fail-closed", () => {
  const joaoA = { id: "cli-A", name: "JOAO SILVA", document: "111.111.111-11" }
  const joaoB = { id: "cli-B", name: "JOAO SILVA", document: "222.222.222-22" }
  const mariaUnica = { id: "cli-M", name: "Maria Oliveira" }

  // Simula clientes cadastrados na loja: dois João Silva e uma Maria Oliveira
  const clientesLoja = [
    { id: "cli-A", name: "JOAO SILVA" },
    { id: "cli-B", name: "JOAO SILVA" },
    { id: "cli-M", name: "Maria Oliveira" },
  ]

  const ambiguos = mapearNomesAmbiguos(clientesLoja)
  const resolverLoja = criarResolvedorNomeUnico(clientesLoja)
  const matchOpts = { isNomeUnico: resolverLoja, nomesAmbiguos: ambiguos }

  it("mapearNomesAmbiguos detecta homônimos exatos normalizados na loja", () => {
    expect(ambiguos.has("joao silva")).toBe(true)
    expect(ambiguos.has("maria oliveira")).toBe(false)
  })

  it("2. dois JOAO SILVA + título name-only => nenhum recebe o título (fail-closed)", () => {
    const tituloNameOnly = { cliente: "JOAO SILVA" }

    // Nem João A nem João B recebem o título sem identificação estável
    expect(matchTituloCliente(tituloNameOnly, joaoA, matchOpts)).toBe(null)
    expect(matchTituloCliente(tituloNameOnly, joaoB, matchOpts)).toBe(null)
    expect(tituloPertenceAoCliente(tituloNameOnly, joaoA, matchOpts)).toBe(false)
    expect(tituloPertenceAoCliente(tituloNameOnly, joaoB, matchOpts)).toBe(false)
  })

  it("3. cliente A/B homônimos + clienteId do título = A => somente A recebe", () => {
    const tituloDeA = { clienteId: "cli-A", cliente: "JOAO SILVA" }

    // João A casa com clienteId mesmo havendo homônimo
    expect(matchTituloCliente(tituloDeA, joaoA, matchOpts)).toBe("clienteId")
    expect(tituloPertenceAoCliente(tituloDeA, joaoA, matchOpts)).toBe(true)

    // João B tem clienteId divergente e NÃO recebe
    expect(matchTituloCliente(tituloDeA, joaoB, matchOpts)).toBe(null)
    expect(tituloPertenceAoCliente(tituloDeA, joaoB, matchOpts)).toBe(false)
  })

  it("4. clienteId divergente não cai para nome", () => {
    const titulo = { clienteId: "cli-A", cliente: "JOAO SILVA" }
    const clienteDiferente = { id: "cli-Z", name: "JOAO SILVA" }
    expect(matchTituloCliente(titulo, clienteDiferente, { isNomeUnico: () => true })).toBe(null)
    expect(tituloPertenceAoCliente(titulo, clienteDiferente, { isNomeUnico: () => true })).toBe(false)
  })

  it("5. documento divergente não cai para nome", () => {
    const titulo = { clienteDocumento: "99999999999", cliente: "JOAO SILVA" }
    const cliente = { id: "", name: "JOAO SILVA", document: "111.111.111-11" }
    expect(matchTituloCliente(titulo, cliente, { isNomeUnico: () => true })).toBe(null)
  })

  it("6. telefone divergente não cai para nome", () => {
    const titulo = { clienteTelefone: "11988887777", cliente: "JOAO SILVA" }
    const cliente = { id: "", name: "JOAO SILVA", phone: "11955554444" }
    expect(matchTituloCliente(titulo, cliente, { isNomeUnico: () => true })).toBe(null)
  })

  it("7. nome único legado continua funcionando", () => {
    const tituloLegado = { cliente: "Maria Oliveira" }
    expect(matchTituloCliente(tituloLegado, mariaUnica, matchOpts)).toBe("nome")
    expect(tituloPertenceAoCliente(tituloLegado, mariaUnica, matchOpts)).toBe(true)
  })

  it("8. erro na resolução de ambiguidade => name-only fail-closed", () => {
    const titulo = { cliente: "Maria Oliveira" }
    const errOpts = {
      isNomeUnico: () => {
        throw new Error("Falha na consulta de clientes")
      },
    }
    expect(matchTituloCliente(titulo, mariaUnica, errOpts)).toBe(null)
    expect(tituloPertenceAoCliente(titulo, mariaUnica, errOpts)).toBe(false)
  })

  it("8b. ausência de opções de resolução de ambiguidade => name-only fail-closed", () => {
    const titulo = { cliente: "Maria Oliveira" }
    // Sem opts passadas: por segurança o nome sozinho não pode vincular sem prova de unicidade
    expect(matchTituloCliente(titulo, mariaUnica)).toBe(null)
    expect(tituloPertenceAoCliente(titulo, mariaUnica)).toBe(false)
  })

  it("verificarNomeUnico valida com predicado, Set e Array", () => {
    expect(verificarNomeUnico("ana", () => true)).toBe(true)
    expect(verificarNomeUnico("ana", () => false)).toBe(false)
    expect(verificarNomeUnico("ana", { nomesUnicos: new Set(["ana"]) })).toBe(true)
    expect(verificarNomeUnico("ana", { nomesUnicos: ["ana"] })).toBe(true)
    expect(verificarNomeUnico("ana", { nomesAmbiguos: ["ana"] })).toBe(false)
    expect(verificarNomeUnico("ana", { nomesAmbiguos: ["outra"] })).toBe(true)
  })
})

describe("escada de prioridade com forte identidade", () => {
  it("identificador estável vence documento, telefone e nome", () => {
    const titulo = {
      clienteId: "c-10",
      clienteDocumento: "111",
      clienteTelefone: "222",
      cliente: "Nome Titulo",
    }
    const cliente = {
      id: "c-10",
      name: "Outro Nome",
      document: "333",
      phone: "444",
    }
    expect(matchTituloCliente(titulo, cliente)).toBe("clienteId")
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
