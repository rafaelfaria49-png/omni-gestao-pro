/**
 * Regra do recebimento multitítulo do PDV — GOAL
 * `PDV-RECEBIMENTO-MULTITITULO-UI-G3-005`.
 *
 * O harness do Vitest roda em `node` e não compila `.tsx`, então toda a decisão
 * financeira do modal (seleção, payload do lote, idempotência, leitura de conflito e
 * as abas) vive em `lib/contas-receber-lote.ts` e é exercitada aqui.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  RECEBIMENTO_LOTE_UI_MAX_ITENS,
  buildItensLote,
  encerrarIdempotencyKey,
  encerrarSubmissao,
  estadoSelecionarTodos,
  iniciarSubmissao,
  interpretarErroLote,
  limparSelecaoAposConflito,
  loteEconomicFingerprint,
  novaTravaSubmissao,
  parseValorBR,
  partitionTitulos,
  resolveIdempotencyKey,
  selecionaveis,
  valorReceberDoTitulo,
  type LoteTitulo,
} from "@/lib/contas-receber-lote"

/** Cinco títulos abertos do mesmo cliente — o cenário base do GOAL. */
const CINCO: LoteTitulo[] = [
  { localKey: "os-2291", tituloId: "t1", saldoAberto: 89.9 },
  { localKey: "venda-10432-1", tituloId: "t2", saldoAberto: 64.5 },
  { localKey: "venda-10432-2", tituloId: "t3", saldoAberto: 64.5 },
  { localKey: "venda-10432-3", tituloId: "t4", saldoAberto: 43.48 },
  { localKey: "venda-10432-4", saldoAberto: 64.48 },
]

describe("seleção e total", () => {
  it("3 de 5 títulos: só os marcados entram e o total é a soma deles", () => {
    const r = buildItensLote(CINCO, ["os-2291", "venda-10432-2", "venda-10432-4"])
    expect(r.itens.map((i) => i.localKey)).toEqual(["os-2291", "venda-10432-2", "venda-10432-4"])
    expect(r.total).toBe(218.88)
    expect(r.invalidos).toEqual([])
  })

  it("selecionar todos cobre exatamente os títulos com saldo > ε", () => {
    const comZerado = [...CINCO, { localKey: "quitado", saldoAberto: 0 }]
    expect(selecionaveis(comZerado)).toEqual(CINCO.map((t) => t.localKey))
    const r = buildItensLote(comZerado, selecionaveis(comZerado))
    expect(r.itens).toHaveLength(5)
    expect(r.total).toBe(326.86)
  })

  it("estado do Selecionar todos reflete nenhum / parcial / todos", () => {
    expect(estadoSelecionarTodos(CINCO, [])).toBe("nenhum")
    expect(estadoSelecionarTodos(CINCO, ["os-2291"])).toBe("parcial")
    expect(estadoSelecionarTodos(CINCO, selecionaveis(CINCO))).toBe("todos")
  })

  it("título sem saldo não vira item nem quando marcado", () => {
    const r = buildItensLote([{ localKey: "zerado", saldoAberto: 0 }], ["zerado"])
    expect(r.itens).toEqual([])
    expect(r.total).toBe(0)
    expect(r.invalidos).toEqual(["zerado"])
  })
})

describe("parcial por título", () => {
  it("aceita valor em pt-BR e nunca ultrapassa o saldo do título", () => {
    expect(parseValorBR("1.234,56")).toBe(1234.56)
    expect(parseValorBR("")).toBe(null)
    expect(parseValorBR("abc")).toBe(null)
    expect(valorReceberDoTitulo({ localKey: "a", saldoAberto: 89.9 }, "50,00")).toBe(50)
    expect(valorReceberDoTitulo({ localKey: "a", saldoAberto: 89.9 }, "999,00")).toBe(89.9)
    expect(valorReceberDoTitulo({ localKey: "a", saldoAberto: 89.9 }, "")).toBe(89.9)
  })

  it("parcial e total convivem no MESMO lote, com valor explícito por item", () => {
    const r = buildItensLote(CINCO, ["os-2291", "venda-10432-1"], { "os-2291": "40,00" })
    expect(r.itens).toEqual([
      { localKey: "os-2291", tituloId: "t1", saldoEsperado: 89.9, valorReceber: 40 },
      { localKey: "venda-10432-1", tituloId: "t2", saldoEsperado: 64.5, valorReceber: 64.5 },
    ])
    expect(r.total).toBe(104.5)
  })

  it("nenhuma distribuição implícita: o valor de um título não vaza para outro", () => {
    const r = buildItensLote(CINCO, ["os-2291", "venda-10432-1"], { "os-2291": "10,00" })
    expect(r.itens.find((i) => i.localKey === "venda-10432-1")?.valorReceber).toBe(64.5)
    expect(r.total).toBe(74.5)
  })
})

describe("payload do endpoint G2", () => {
  it("cada item carrega localKey, saldoEsperado e valorReceber; tituloId só quando existe", () => {
    const r = buildItensLote(CINCO, ["os-2291", "venda-10432-4"])
    expect(r.itens[0]).toEqual({
      localKey: "os-2291",
      tituloId: "t1",
      saldoEsperado: 89.9,
      valorReceber: 89.9,
    })
    // Sem `tituloId` conhecido a chave NÃO vai em branco — o schema do servidor
    // recusa string vazia (`z.string().min(1)`).
    expect(r.itens[1]).toEqual({ localKey: "venda-10432-4", saldoEsperado: 64.48, valorReceber: 64.48 })
    expect("tituloId" in r.itens[1]!).toBe(false)
  })

  it("o payload não carrega nome de cliente — chave financeira é localKey", () => {
    const r = buildItensLote(CINCO, ["os-2291"])
    expect(Object.keys(r.itens[0]!).sort()).toEqual(["localKey", "saldoEsperado", "tituloId", "valorReceber"])
  })

  it("o teto de itens da UI é o mesmo do service do lote", () => {
    const src = readFileSync(
      resolve(process.cwd(), "lib/financeiro/services/recebimento-lote-service.ts"),
      "utf8",
    )
    const m = /RECEBIMENTO_LOTE_MAX_ITENS\s*=\s*(\d+)/.exec(src)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(RECEBIMENTO_LOTE_UI_MAX_ITENS)
  })
})

describe("idempotencyKey por tentativa econômica", () => {
  const itens = buildItensLote(CINCO, ["os-2291", "venda-10432-1"]).itens

  it("retry INCERTO da mesma tentativa reusa a chave", () => {
    const store = new Map<string, string>()
    const fp = loteEconomicFingerprint({ sessaoId: "s1", formaPagamento: "dinheiro", itens })
    const k1 = resolveIdempotencyKey(store, fp)
    // Falha de rede: a chave NÃO é encerrada e a segunda tentativa repete a operação.
    const k2 = resolveIdempotencyKey(store, fp)
    expect(k2).toBe(k1)
  })

  it("depois de desfecho definitivo, a próxima operação recebe chave nova", () => {
    const store = new Map<string, string>()
    const fp = loteEconomicFingerprint({ sessaoId: "s1", formaPagamento: "dinheiro", itens })
    const k1 = resolveIdempotencyKey(store, fp)
    encerrarIdempotencyKey(store, fp)
    expect(resolveIdempotencyKey(store, fp)).not.toBe(k1)
  })

  it("mudar valor, forma ou sessão muda a tentativa — e a chave", () => {
    const store = new Map<string, string>()
    const base = { sessaoId: "s1", formaPagamento: "dinheiro", itens }
    const k = resolveIdempotencyKey(store, loteEconomicFingerprint(base))
    const outraForma = resolveIdempotencyKey(store, loteEconomicFingerprint({ ...base, formaPagamento: "pix" }))
    const outraSessao = resolveIdempotencyKey(store, loteEconomicFingerprint({ ...base, sessaoId: "s2" }))
    const outroValor = resolveIdempotencyKey(
      store,
      loteEconomicFingerprint({ ...base, itens: buildItensLote(CINCO, ["os-2291"], { "os-2291": "10,00" }).itens }),
    )
    expect(new Set([k, outraForma, outraSessao, outroValor]).size).toBe(4)
  })

  it("reordenar a tela não inventa uma segunda operação econômica", () => {
    const a = loteEconomicFingerprint({ sessaoId: "s1", formaPagamento: "pix", itens })
    const b = loteEconomicFingerprint({ sessaoId: "s1", formaPagamento: "pix", itens: [...itens].reverse() })
    expect(a).toBe(b)
  })

  it("a chave gerada casa o formato exigido pelo servidor", () => {
    const store = new Map<string, string>()
    const k = resolveIdempotencyKey(store, "fp")
    expect(k).toMatch(/^[A-Za-z0-9._-]{8,120}$/)
  })
})

describe("trava do duplo submit", () => {
  it("o segundo envio no mesmo tick é recusado até a trava ser liberada", () => {
    const trava = novaTravaSubmissao()
    expect(iniciarSubmissao(trava)).toBe(true)
    expect(iniciarSubmissao(trava)).toBe(false)
    expect(iniciarSubmissao(trava)).toBe(false)
    encerrarSubmissao(trava)
    expect(iniciarSubmissao(trava)).toBe(true)
  })
})

describe("conflito 409", () => {
  it("saldo_divergente: recarrega, tira os títulos apontados e avisa para reconferir", () => {
    const c = interpretarErroLote(409, {
      code: "saldo_divergente",
      detalhes: [{ localKey: "venda-10432-1", motivo: "saldo_esperado_divergente", saldoReal: 20 }],
    })
    expect(c.code).toBe("saldo_divergente")
    expect(c.recarregar).toBe(true)
    expect(c.definitivo).toBe(true)
    expect(c.caixaFechado).toBe(false)
    expect(c.localKeysAfetadas).toEqual(["venda-10432-1"])
    expect(c.mensagem).toBe("Os valores foram atualizados. Confira novamente antes de receber.")
    expect(limparSelecaoAposConflito(["os-2291", "venda-10432-1"], c)).toEqual(["os-2291"])
  })

  it("titulo_alterado: mesmo tratamento — nada de assumir sucesso", () => {
    const c = interpretarErroLote(409, {
      code: "titulo_alterado",
      detalhes: [{ localKey: "os-2291", motivo: "titulo_pago" }],
    })
    expect(c.recarregar).toBe(true)
    expect(c.definitivo).toBe(true)
    expect(c.localKeysAfetadas).toEqual(["os-2291"])
    expect(limparSelecaoAposConflito(["os-2291", "venda-10432-1"], c)).toEqual(["venda-10432-1"])
  })

  it("idempotency_conflict: chave morre, lista recarrega e a seleção stale NÃO é reaproveitada", () => {
    const c = interpretarErroLote(409, { code: "idempotency_conflict" })
    expect(c.definitivo).toBe(true)
    expect(c.recarregar).toBe(true)
    expect(c.localKeysAfetadas).toEqual([])
    expect(limparSelecaoAposConflito(["os-2291", "venda-10432-1"], c)).toEqual([])
  })

  it("caixa_fechado: sem recarregar, mas o fluxo de gravação sai de cena", () => {
    const c = interpretarErroLote(409, { code: "caixa_fechado" })
    expect(c.caixaFechado).toBe(true)
    expect(c.recarregar).toBe(false)
    expect(c.definitivo).toBe(true)
  })

  it("409 sem código conhecido continua sendo conflito de estado", () => {
    const c = interpretarErroLote(409, { error: "boom" })
    expect(c.recarregar).toBe(true)
    expect(c.definitivo).toBe(true)
  })

  it("5xx não encerra a tentativa — a chave sobrevive para o retry incerto", () => {
    const c = interpretarErroLote(503, { error: "indisponível" })
    expect(c.definitivo).toBe(false)
    expect(c.recarregar).toBe(false)
    expect(limparSelecaoAposConflito(["os-2291"], c)).toEqual(["os-2291"])
  })
})

describe("abas Em aberto / Recebidos", () => {
  it("título quitado sai da cobrança e aparece em Recebidos, sem sumir da memória", () => {
    const { abertos, recebidos, descartados } = partitionTitulos([
      { localKey: "a", saldoAberto: 89.9, status: "pendente" },
      { localKey: "b", saldoAberto: 0, status: "pago" },
      // Snapshot do payload ainda diz "pendente", mas o saldo canônico é 0.
      { localKey: "c", saldoAberto: 0, status: "pendente" },
      { localKey: "d", saldoAberto: 0.004, status: "parcial" },
    ])
    expect(abertos.map((t) => t.localKey)).toEqual(["a"])
    expect(recebidos.map((t) => t.localKey)).toEqual(["b", "c", "d"])
    expect(descartados).toEqual([])
  })

  it("cancelado e estornado não entram em nenhuma das duas abas", () => {
    const { abertos, recebidos, descartados } = partitionTitulos([
      { localKey: "a", saldoAberto: 10, status: "pendente" },
      { localKey: "x", saldoAberto: 0, status: "cancelado" },
      { localKey: "y", saldoAberto: 30, status: "estornado" },
    ])
    expect(abertos.map((t) => t.localKey)).toEqual(["a"])
    expect(recebidos).toEqual([])
    expect(descartados.map((t) => t.localKey)).toEqual(["x", "y"])
  })

  it("a aba Recebidos não interfere na seleção dos abertos", () => {
    const rows = [
      { localKey: "a", saldoAberto: 89.9, status: "pendente" },
      { localKey: "b", saldoAberto: 0, status: "pago" },
    ]
    const { abertos } = partitionTitulos(rows)
    const r = buildItensLote(abertos, ["a", "b"])
    expect(r.itens.map((i) => i.localKey)).toEqual(["a"])
  })
})

/**
 * Fiação do modal. O harness `node` não compila `.tsx`, então estas asserções olham a
 * fonte — o alvo é o contrato de integração (qual endpoint cada ação chama), não a
 * prosa do componente.
 */
describe("fiação do PdvRecebimentoModal", () => {
  const src = readFileSync(
    resolve(process.cwd(), "components/dashboard/vendas/pdv-recebimento-modal.tsx"),
    "utf8",
  )

  it("a seleção múltipla grava pelo endpoint de LOTE do G2", () => {
    expect(src).toContain('"/api/pdv/receber-conta-lote"')
  })

  it('"Quitar este título" continua no endpoint SINGULAR', () => {
    expect(src).toContain('"/api/pdv/receber-conta"')
  })

  it("o casamento por substring bidirecional do cliente foi removido", () => {
    expect(src).not.toMatch(/keyTitulo\.includes|includes\(keyTitulo\)/)
    expect(src).toContain("tituloPertenceAoCliente")
  })
})
