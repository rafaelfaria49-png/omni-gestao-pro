/**
 * Contrato multipart da rota REAL do importador avançado (F-06).
 *
 * Estes testes chamam o `POST` exportado com um `Request` e um `FormData` de verdade —
 * a mesma fronteira que o hook usa. Testar só `normalizarSelecaoDominios` não provaria
 * nada: o defeito era justamente a rota ler uma chave (`dominios`) diferente da que o
 * cliente envia (`dominios[]`), e a seleção sumir em silêncio.
 *
 * Só as bordas de I/O são mockadas (auth, parser, Smart, persistência). O roteamento da
 * seleção, o filtro por domínio e a resposta são os do código de produção.
 */

import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Bordas mockadas ─────────────────────────────────────────────────────────
vi.mock("@/auth", () => ({ auth: async () => ({ user: { email: "op@teste.local" } }) }))
vi.mock("@/lib/api-auth", () => ({ getVerifiedSubscriptionFromCookies: async () => null }))
vi.mock("@/lib/trusted-time", () => ({ getTrustedTimeMs: async () => Date.now() }))
vi.mock("@/lib/subscription-seal", () => ({ isVencimentoExpired: () => false }))
vi.mock("@/lib/store-id-from-request", () => ({
  storeIdFromAssistecRequestForWrite: () => "loja-2",
}))
vi.mock("@/lib/prisma", () => ({ prisma: {}, withPrismaSafe: async (_f: unknown, fb: unknown) => fb }))

/** Uma "planilha" por domínio — o parser real não é exercido aqui. */
const planilhasFalsas = [
  { nomeArquivo: "produtos.xlsx", dominio: "produtos", confianca: 0.9, totalLinhas: 2, headers: ["nome"] },
  { nomeArquivo: "fornecedores.xlsx", dominio: "fornecedores", confianca: 0.9, totalLinhas: 1, headers: ["razao"] },
  { nomeArquivo: "clientes.xlsx", dominio: "clientes", confianca: 0.9, totalLinhas: 1, headers: ["nome"] },
]

vi.mock("@/lib/importador-avancado/parser", () => ({
  parsearArquivos: async () => planilhasFalsas,
}))

vi.mock("@/lib/importador-avancado", () => ({
  agruparEMerge: () =>
    new Map<string, unknown[]>([
      ["produtos", [{ chave: "p1" }, { chave: "p2" }]],
      ["fornecedores", [{ chave: "f1" }]],
      ["clientes", [{ chave: "c1" }]],
    ]),
  labelDominio: (d: string) => d,
}))

vi.mock("@/lib/importador-avancado/smart-genius/orquestrar", () => ({
  separarSmart: async () => ({ detectados: [], clientes: [], contas: [], restantes: [] }),
  persistirSmartSeparado: async () => ({}),
}))

/** Registra o que a persistência REALMENTE recebeu — a prova do "não persistido". */
const persistidos: string[][] = []
vi.mock("@/lib/importador-avancado/persistidor", () => ({
  persistirImportacao: async (_s: string, grupos: Map<string, unknown[]>) => {
    persistidos.push([...grupos.keys()])
    return { log: [], totais: {}, resumoProdutos: [] }
  },
  planejarProdutosDoLote: async () => ({ linhas: [], totais: { criar: 0, atualizar: 0 } }),
}))

import { POST } from "./route"

const arquivo = () => new File([Buffer.from("x")], "produtos.xlsx", { type: "application/vnd.ms-excel" })

/** `NextRequest` de verdade — a rota lê `req.nextUrl`, então `Request` cru não serve. */
function requisicao(
  campos: Array<[string, string]>,
  opts: { modo?: "preview" | "importar" } = {},
): NextRequest {
  const fd = new FormData()
  fd.append("arquivos[]", arquivo())
  for (const [k, v] of campos) fd.append(k, v)
  const url = `http://localhost/api/import/advanced${opts.modo ? `?modo=${opts.modo}` : ""}`
  return new NextRequest(url, { method: "POST", body: fd })
}

const post = (req: NextRequest) => POST(req)

beforeEach(() => {
  persistidos.length = 0
})

describe("seleção de domínios — chave canônica dominios[]", () => {
  it("preview: dominios[]=produtos limita a produtos", async () => {
    const res = await post(requisicao([["dominios[]", "produtos"]], { modo: "preview" }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.dominiosParaImportar).toEqual(["produtos"])
    expect(j.grupos).toEqual({ produtos: 2 })
  })

  it("importar: dominios[]=produtos persiste SOMENTE produtos", async () => {
    const res = await post(requisicao([["dominios[]", "produtos"]], { modo: "importar" }))
    expect(res.status).toBe(200)
    // A prova de que o domínio não selecionado não é persistido.
    expect(persistidos).toEqual([["produtos"]])
  })

  it("produtos + fornecedores mantém os dois e descarta clientes", async () => {
    const res = await post(
      requisicao(
        [
          ["dominios[]", "produtos"],
          ["dominios[]", "fornecedores"],
        ],
        { modo: "importar" },
      ),
    )
    expect(res.status).toBe(200)
    expect(persistidos[0]).toEqual(["produtos", "fornecedores"])
    expect(persistidos[0]).not.toContain("clientes")
  })

  it("domínio duplicado é deduplicado e não altera o resultado", async () => {
    const res = await post(
      requisicao(
        [
          ["dominios[]", "produtos"],
          ["dominios[]", "produtos"],
          ["dominios[]", " produtos "],
        ],
        { modo: "importar" },
      ),
    )
    expect(res.status).toBe(200)
    expect(persistidos).toEqual([["produtos"]])
  })
})

describe("seleção de domínios — chave legada dominios", () => {
  it("preview: `dominios` continua aceita por compatibilidade", async () => {
    const res = await post(requisicao([["dominios", "produtos"]], { modo: "preview" }))
    expect(res.status).toBe(200)
    expect((await res.json()).dominiosParaImportar).toEqual(["produtos"])
  })

  it("importar: `dominios` limita a persistência igual à canônica", async () => {
    const res = await post(requisicao([["dominios", "produtos"]], { modo: "importar" }))
    expect(res.status).toBe(200)
    expect(persistidos).toEqual([["produtos"]])
  })

  it("canônica e legada produzem exatamente a MESMA seleção", async () => {
    await post(requisicao([["dominios[]", "fornecedores"]], { modo: "importar" }))
    await post(requisicao([["dominios", "fornecedores"]], { modo: "importar" }))
    expect(persistidos[0]).toEqual(persistidos[1])
  })
})

describe("ausência de filtro", () => {
  it("preview sem seleção mantém todos os domínios detectados", async () => {
    const res = await post(requisicao([], { modo: "preview" }))
    const j = await res.json()
    expect(j.dominiosParaImportar).toEqual(["produtos", "fornecedores", "clientes"])
  })

  it("importar sem seleção persiste todos os detectados", async () => {
    await post(requisicao([], { modo: "importar" }))
    expect(persistidos[0]).toEqual(["produtos", "fornecedores", "clientes"])
  })

  it("valor vazio não é tratado como filtro", async () => {
    await post(requisicao([["dominios[]", "   "]], { modo: "importar" }))
    expect(persistidos[0]).toEqual(["produtos", "fornecedores", "clientes"])
  })
})

describe("domínio inválido é rejeitado, nunca ignorado", () => {
  it("preview devolve 400 e não segue", async () => {
    const res = await post(requisicao([["dominios[]", "planilha_maluca"]], { modo: "preview" }))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toContain("desconhecido")
    expect(j.dominios).toEqual(["planilha_maluca"])
  })

  it("importar devolve 400 e NÃO persiste nada", async () => {
    const res = await post(requisicao([["dominios[]", "planilha_maluca"]], { modo: "importar" }))
    expect(res.status).toBe(400)
    expect(persistidos).toEqual([])
  })

  it("um inválido junto de um válido invalida a requisição inteira", async () => {
    const res = await post(
      requisicao(
        [
          ["dominios[]", "produtos"],
          ["dominios[]", "nao_existe"],
        ],
        { modo: "importar" },
      ),
    )
    expect(res.status).toBe(400)
    expect(persistidos).toEqual([])
  })

  it("`desconhecido` (detecção falhada) não é seleção válida", async () => {
    const res = await post(requisicao([["dominios[]", "desconhecido"]], { modo: "importar" }))
    expect(res.status).toBe(400)
    expect(persistidos).toEqual([])
  })
})
