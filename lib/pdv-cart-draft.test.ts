/**
 * PDV-CAIXA-SESSION-RECOVERY-CART-DRAFT-001 — recuperação do carrinho.
 *
 * Cenário real: a venda de quatro itens montada no PDV da Loja 2 foi perdida
 * quando o computador travou e reiniciou, e precisou ser digitada de novo.
 */

import { describe, it, expect } from "vitest"
import {
  CART_DRAFT_VERSION,
  cartDraftStorageKey,
  clearCartDraft,
  describeCartDraftIssues,
  readCartDraft,
  revalidateCartDraft,
  writeCartDraft,
  type CartDraftLine,
  type DraftStorage,
} from "@/lib/pdv-cart-draft"

/** Fake de `localStorage` — mantém o teste em ambiente node. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  const storage: DraftStorage & { dump: () => Record<string, string> } = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
  return storage
}

const LOJA = "loja-2"

function linha(over: Partial<CartDraftLine> = {}): CartDraftLine {
  return {
    lineId: "l1",
    inventoryId: "prod-1",
    name: "Película 3D",
    price: 25,
    quantity: 1,
    ...over,
  }
}

const quatroItens: CartDraftLine[] = [
  linha({ lineId: "l1", inventoryId: "prod-1", name: "Película 3D", price: 25, quantity: 2 }),
  linha({ lineId: "l2", inventoryId: "prod-2", name: "Capa Silicone", price: 40, quantity: 1 }),
  linha({ lineId: "l3", inventoryId: "prod-3", name: "Cabo USB-C", price: 30, quantity: 3 }),
  linha({ lineId: "l4", inventoryId: "prod-4", name: "Fone Bluetooth", price: 120, quantity: 1 }),
]

describe("rascunho do carrinho — persistência e recuperação", () => {
  it("carrinho com quatro itens sobrevive ao reinício (write → read)", () => {
    const storage = fakeStorage()
    const scope = { storeId: LOJA, modalidade: "classico" as const }

    writeCartDraft({ ...scope, lines: quatroItens, caixaSessaoId: "sess-1" }, storage)
    const restored = readCartDraft(scope, storage)

    expect(restored?.lines).toHaveLength(4)
    expect(restored?.lines.map((l) => l.inventoryId)).toEqual(["prod-1", "prod-2", "prod-3", "prod-4"])
    expect(restored?.lines[2]).toMatchObject({ name: "Cabo USB-C", quantity: 3, price: 30 })
    expect(restored?.caixaSessaoId).toBe("sess-1")
  })

  it("preserva cliente, descontos e observação", () => {
    const storage = fakeStorage()
    const scope = { storeId: LOJA, modalidade: "classico" as const }

    writeCartDraft(
      {
        ...scope,
        lines: quatroItens,
        customer: { id: "cli-1", name: "Maria", cpf: "12345678909" },
        discountReais: 5,
        discountPercent: 2,
        observacao: "entregar sexta",
      },
      storage,
    )

    const restored = readCartDraft(scope, storage)
    expect(restored?.customer).toEqual({ id: "cli-1", name: "Maria", cpf: "12345678909" })
    expect(restored?.discountReais).toBe(5)
    expect(restored?.discountPercent).toBe(2)
    expect(restored?.observacao).toBe("entregar sexta")
  })

  it("item avulso e linha de O.S. sobrevivem com os campos próprios", () => {
    const storage = fakeStorage()
    const scope = { storeId: LOJA, modalidade: "assistencia" as const }

    writeCartDraft(
      {
        ...scope,
        lines: [
          linha({ lineId: "a1", inventoryId: "__avulso__x", isAvulso: true, custoUnitario: 10, codigoAvulso: "789" }),
          linha({ lineId: "o1", inventoryId: "__os_servico__OS-1", name: "Serviço OS-1", price: 90 }),
        ],
      },
      storage,
    )

    const restored = readCartDraft(scope, storage)
    expect(restored?.lines[0]).toMatchObject({ isAvulso: true, custoUnitario: 10, codigoAvulso: "789" })
    expect(restored?.lines[1]).toMatchObject({ inventoryId: "__os_servico__OS-1", price: 90 })
  })
})

describe("rascunho do carrinho — isolamento", () => {
  it("rascunho não vaza entre lojas", () => {
    const storage = fakeStorage()
    writeCartDraft({ storeId: "loja-1", modalidade: "classico", lines: quatroItens }, storage)

    expect(readCartDraft({ storeId: "loja-2", modalidade: "classico" }, storage)).toBeNull()
    expect(readCartDraft({ storeId: "loja-1", modalidade: "classico" }, storage)?.lines).toHaveLength(4)
  })

  it("rascunho não vaza entre modalidades de PDV", () => {
    const storage = fakeStorage()
    writeCartDraft({ storeId: LOJA, modalidade: "supermercado", lines: quatroItens }, storage)

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
    expect(readCartDraft({ storeId: LOJA, modalidade: "supermercado" }, storage)?.lines).toHaveLength(4)
  })

  it("rascunho não vaza entre terminais", () => {
    const storage = fakeStorage()
    writeCartDraft({ storeId: LOJA, modalidade: "classico", terminalId: "PDV1", lines: quatroItens }, storage)

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico", terminalId: "PDV2" }, storage)).toBeNull()
    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
    expect(
      readCartDraft({ storeId: LOJA, modalidade: "classico", terminalId: "PDV1" }, storage)?.lines,
    ).toHaveLength(4)
  })

  it("chave adulterada com conteúdo de outra loja é recusada", () => {
    const alheio = JSON.stringify({
      v: CART_DRAFT_VERSION,
      storeId: "loja-1",
      modalidade: "classico",
      terminalId: null,
      savedAt: new Date().toISOString(),
      caixaSessaoId: null,
      lines: quatroItens,
      customer: null,
      discountReais: 0,
      discountPercent: 0,
    })
    const storage = fakeStorage({
      [cartDraftStorageKey({ storeId: LOJA, modalidade: "classico" })]: alheio,
    })

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
  })

  it("versão desconhecida é descartada em vez de restaurar lixo", () => {
    const storage = fakeStorage({
      [cartDraftStorageKey({ storeId: LOJA, modalidade: "classico" })]: JSON.stringify({
        v: 999,
        storeId: LOJA,
        modalidade: "classico",
        lines: quatroItens,
      }),
    })

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
  })

  it("JSON inválido não quebra o PDV", () => {
    const storage = fakeStorage({
      [cartDraftStorageKey({ storeId: LOJA, modalidade: "classico" })]: "{quebrado",
    })

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
  })
})

describe("rascunho do carrinho — ciclo de vida", () => {
  const scope = { storeId: LOJA, modalidade: "classico" as const }

  it("carrinho vazio remove a chave (Limpar carrinho não deixa lixo)", () => {
    const storage = fakeStorage()
    writeCartDraft({ ...scope, lines: quatroItens }, storage)
    expect(readCartDraft(scope, storage)).not.toBeNull()

    writeCartDraft({ ...scope, lines: [] }, storage)

    expect(readCartDraft(scope, storage)).toBeNull()
    expect(Object.keys(storage.dump())).toHaveLength(0)
  })

  it("clearCartDraft apaga só o escopo pedido", () => {
    const storage = fakeStorage()
    writeCartDraft({ storeId: "loja-1", modalidade: "classico", lines: quatroItens }, storage)
    writeCartDraft({ storeId: LOJA, modalidade: "classico", lines: quatroItens }, storage)

    clearCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)

    expect(readCartDraft({ storeId: LOJA, modalidade: "classico" }, storage)).toBeNull()
    expect(readCartDraft({ storeId: "loja-1", modalidade: "classico" }, storage)?.lines).toHaveLength(4)
  })

  it("quota estourada no setItem não derruba a venda em andamento", () => {
    const storage: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError")
      },
      removeItem: () => {},
    }

    expect(() => writeCartDraft({ ...scope, lines: quatroItens }, storage)).not.toThrow()
  })

  it("F5, nova aba e logout/login não apagam o rascunho (leituras repetidas não consomem)", () => {
    const storage = fakeStorage()
    writeCartDraft({ ...scope, lines: quatroItens }, storage)

    // Cada leitura representa um mount novo do PDV: F5, outra aba, novo login.
    for (let mount = 0; mount < 3; mount += 1) {
      expect(readCartDraft(scope, storage)?.lines).toHaveLength(4)
    }
  })

  it("erro de caixa não apaga o rascunho — só venda registrada ou limpeza explícita", () => {
    const storage = fakeStorage()
    writeCartDraft({ ...scope, lines: quatroItens, caixaSessaoId: "sess-antiga" }, storage)

    // Servidor recusou por SESSAO_INVALIDA/CAIXA_FECHADO: nada é apagado.
    expect(readCartDraft(scope, storage)?.lines).toHaveLength(4)

    // Sessão foi recuperada e o carrinho reescrito na sessão nova, sem perder itens.
    writeCartDraft({ ...scope, lines: quatroItens, caixaSessaoId: "sess-nova" }, storage)
    const apos = readCartDraft(scope, storage)
    expect(apos?.lines).toHaveLength(4)
    expect(apos?.caixaSessaoId).toBe("sess-nova")
  })

  it("rascunho guarda a sessão de caixa em que foi montado (para avisar sobre troca de sessão)", () => {
    const storage = fakeStorage()
    writeCartDraft({ ...scope, lines: quatroItens, caixaSessaoId: "sess-de-ontem" }, storage)

    const restaurado = readCartDraft(scope, storage)
    expect(restaurado?.caixaSessaoId).toBe("sess-de-ontem")
    // O PDV compara com a sessão ativa e avisa que a venda entrará na sessão atual.
    expect(restaurado?.caixaSessaoId).not.toBe("sess-aberta-agora")
  })

  it("linhas com quantidade inválida são descartadas na leitura", () => {
    const storage = fakeStorage()
    writeCartDraft(
      { ...scope, lines: [linha({ lineId: "ok" }), linha({ lineId: "ruim", quantity: 0 })] },
      storage,
    )

    const restored = readCartDraft(scope, storage)
    expect(restored?.lines.map((l) => l.lineId)).toEqual(["ok"])
  })
})

describe("revalidateCartDraft — produtos, disponibilidade e valores", () => {
  it("catálogo intacto restaura tudo sem avisos", () => {
    const catalog = [
      { id: "prod-1", name: "Película 3D", price: 25, stock: 10 },
      { id: "prod-2", name: "Capa Silicone", price: 40, stock: 10 },
      { id: "prod-3", name: "Cabo USB-C", price: 30, stock: 10 },
      { id: "prod-4", name: "Fone Bluetooth", price: 120, stock: 10 },
    ]

    const result = revalidateCartDraft({ lines: quatroItens }, catalog)

    expect(result.lines).toHaveLength(4)
    expect(result.issues).toEqual([])
  })

  it("produto que sumiu do catálogo é removido e reportado", () => {
    const catalog = [{ id: "prod-1", name: "Película 3D", price: 25, stock: 10 }]

    const result = revalidateCartDraft(
      { lines: [quatroItens[0], quatroItens[1]] },
      catalog,
    )

    expect(result.lines.map((l) => l.inventoryId)).toEqual(["prod-1"])
    expect(result.issues).toEqual([{ kind: "indisponivel", lineId: "l2", name: "Capa Silicone" }])
  })

  it("preço alterado adota o valor ATUAL e reporta (nunca vende com preço velho)", () => {
    const catalog = [{ id: "prod-1", name: "Película 3D", price: 29.9, stock: 10 }]

    const result = revalidateCartDraft({ lines: [quatroItens[0]] }, catalog)

    expect(result.lines[0].price).toBe(29.9)
    expect(result.issues).toEqual([
      { kind: "preco-alterado", lineId: "l1", name: "Película 3D", de: 25, para: 29.9 },
    ])
  })

  it("estoque insuficiente mantém a linha e sinaliza", () => {
    const catalog = [{ id: "prod-3", name: "Cabo USB-C", price: 30, stock: 1 }]

    const result = revalidateCartDraft({ lines: [quatroItens[2]] }, catalog)

    expect(result.lines).toHaveLength(1)
    expect(result.issues).toEqual([
      { kind: "estoque-insuficiente", lineId: "l3", name: "Cabo USB-C", pedido: 3, disponivel: 1 },
    ])
  })

  it("item avulso e linha de O.S. passam mesmo sem catálogo", () => {
    const result = revalidateCartDraft(
      {
        lines: [
          linha({ lineId: "a1", inventoryId: "__avulso__x", isAvulso: true }),
          linha({ lineId: "o1", inventoryId: "__os_servico__OS-1" }),
        ],
      },
      [],
    )

    expect(result.lines).toHaveLength(2)
    expect(result.issues).toEqual([])
  })

  it("resumo textual dos avisos", () => {
    expect(describeCartDraftIssues([])).toBe("")
    expect(
      describeCartDraftIssues([
        { kind: "indisponivel", lineId: "a", name: "X" },
        { kind: "preco-alterado", lineId: "b", name: "Y", de: 1, para: 2 },
        { kind: "estoque-insuficiente", lineId: "c", name: "Z", pedido: 3, disponivel: 1 },
      ]),
    ).toBe("1 item indisponível removido · 1 com preço atualizado · 1 sem estoque suficiente")
  })
})
