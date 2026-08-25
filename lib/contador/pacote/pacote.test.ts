/**
 * Contador HUB · Pacote do Contador (GOAL 008 · 008B) — testes puros (sem banco/ZIP).
 *
 * Carrega fontes DETALHADAS via cliente injetável, deriva o agregado (montarDados) e o
 * checklist, e monta o conteúdo. Verifica estrutura fixa, colunas, RFC 4180 (vírgula),
 * minimização de PII, manifesto v1, estados por fonte, filename saneado e limites.
 */
import { describe, it, expect } from "vitest"
import { resolvePeriodoUtc } from "@/lib/contador/competencia"
import { montarDados } from "@/lib/contador/readers"
import { montarChecklistFechamento } from "@/lib/contador/fechamento"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import {
  carregarFontesPacoteComCliente,
  type PacoteReaderClient,
} from "./carregar-fontes"
import { montarConteudoPacote } from "./builder"
import { montarAvisos } from "./fontes"
import { montarCsv, numero, texto } from "./csv"
import {
  assertRegistrosFonte,
  neutralizarFormula,
  PacoteLimiteExcedidoError,
  sanitizarStoreIdParaArquivo,
  sha256Hex,
} from "./seguranca"

const competencia = { ano: 2026, mes: 6 }
const periodo = resolvePeriodoUtc(competencia)
const agora = new Date("2026-07-16T12:00:00.000Z")
const STORE = "loja-teste-42"
const USER = "user-abc"
const scope = { ok: true, storeId: STORE, userId: USER, permissaoContador: true } as unknown as ContadorScopeInterno

const J = (d: string) => new Date(`2026-06-${d}T12:00:00.000Z`)

const CAMINHOS_ESPERADOS = [
  "00-LEIA-ME/indice.md",
  "00-LEIA-ME/pendencias.md",
  "00-LEIA-ME/resumo.md",
  "01-VENDAS/devolucoes.csv",
  "01-VENDAS/itens.csv",
  "01-VENDAS/vendas.csv",
  "02-FINANCEIRO/contas_pagar.csv",
  "02-FINANCEIRO/contas_receber.csv",
  "02-FINANCEIRO/movimentacoes.csv",
  "03-CAIXA/operacoes.csv",
  "03-CAIXA/sessoes.csv",
  "04-DOCUMENTOS/LEIA-ME.md",
  "05-XML/LEIA-ME.md",
  "manifest.json",
]

// PII sentinelas: presentes nas linhas cruas (campos NÃO selecionados/emitidos) — nunca podem vazar.
const PII = ["João PII Silva", "segredo-do-banco", "OperadorPII", "MotivoPII", "111.222.333-44"]

function clienteCompleto(overrides: Partial<PacoteReaderClient> = {}): PacoteReaderClient {
  const base: PacoteReaderClient = {
    venda: {
      findMany: async () => [
        {
          id: "v1",
          pedidoId: "VDA-1",
          total: 100,
          status: "concluida",
          at: J("10"),
          payload: { paymentBreakdown: { pix: 100 }, discountTotal: 5, segredo: "segredo-do-banco" },
          ...({ clienteNome: "João PII Silva", clienteDoc: "111.222.333-44" } as object),
          itens: [
            { id: "i1", inventoryId: "p1", nome: "Produto A", quantidade: 2, precoUnitario: 30, lineTotal: 55 },
          ],
        },
        {
          id: "v2",
          pedidoId: "VDA-2",
          total: 80,
          status: "cancelada",
          at: J("11"),
          payload: {},
          itens: [{ id: "i2", inventoryId: "p2", nome: "Cancelado", quantidade: 1, precoUnitario: 80, lineTotal: 80 }],
        },
      ],
    },
    produto: { findMany: async () => [{ id: "p1", sku: "SKU-A", barcode: "789" }] },
    devolucaoVenda: {
      findMany: async () => [
        { id: "d1", localId: "DEV-1", vendaLocalId: "VDA-1", tipo: "vale_credito", valorTotal: 10, at: J("12"), ...({ operador: "OperadorPII" } as object) },
      ],
    },
    movimentacaoFinanceira: {
      findMany: async () => [
        { id: "m1", tipo: "entrada", origem: "venda", valor: 100, createdAt: J("10") },
        { id: "m2", tipo: "saida", origem: "pagar", valor: 20, createdAt: J("11") },
        { id: "m3", tipo: "entrada", origem: "transferencia", valor: 50, createdAt: J("12") },
        { id: "m4", tipo: "entrada", origem: "origem_futura", valor: 9, createdAt: J("13") },
      ],
    },
    contaReceberTitulo: {
      findMany: async () => [
        { id: "r1", valor: 30, status: "pendente", vencimento: "2026-06-10" },
        { id: "r2", valor: 99, status: "pendente", vencimento: "data-invalida" },
      ],
    },
    contaPagarTitulo: {
      findMany: async () => [{ id: "pg1", valor: 15, status: "pendente", vencimento: "20/06/2026" }],
    },
    sessaoCaixa: {
      findMany: async () => [
        { id: "s1", status: "FECHADA", saldoInicial: 100, saldoFinal: 100, saldoContado: 101, abertaEm: J("10"), fechadaEm: J("10"), ...({ operador: "OperadorPII" } as object) },
        { id: "s2", status: "FECHADA", saldoInicial: 50, saldoFinal: 60, saldoContado: null, abertaEm: J("11"), fechadaEm: J("11") },
      ],
    },
    caixaOperacao: {
      findMany: async () => [
        { id: "o1", sessaoId: "s1", tipo: "sangria", valor: 5, at: J("10"), ...({ motivo: "MotivoPII" } as object) },
        { id: "o2", sessaoId: "s1", tipo: "desconhecido", valor: 3, at: J("11") },
      ],
    },
  }
  return { ...base, ...overrides }
}

async function montar(cliente: PacoteReaderClient = clienteCompleto()) {
  const detalhadas = await carregarFontesPacoteComCliente(scope, periodo, competencia, cliente)
  const dados = montarDados(detalhadas.agregado, competencia)
  const checklist = montarChecklistFechamento({ dados, competencia, agora })
  return { detalhadas, conteudo: montarConteudoPacote({ detalhadas, dados, checklist, competencia, agora, storeId: STORE, userId: USER }) }
}

function arq(conteudo: Awaited<ReturnType<typeof montar>>["conteudo"], caminho: string): string {
  const a = conteudo.arquivos.find((x) => x.caminho === caminho)
  if (!a) throw new Error(`ausente: ${caminho}`)
  return a.conteudo
}

describe("Pacote 008B — estrutura fixa de 14 arquivos", () => {
  it("tem exatamente os 14 caminhos obrigatórios (sem os caminhos antigos)", async () => {
    const { conteudo } = await montar()
    const caminhos = conteudo.arquivos.map((a) => a.caminho).sort()
    expect(caminhos).toEqual([...CAMINHOS_ESPERADOS].sort())
    for (const antigo of ["RESUMO.md", "AVISOS-E-PENDENCIAS.md", "csv/vendas.csv", "documentos/LEIA-ME.md", "notas-fiscais-xml/LEIA-ME.md"]) {
      expect(caminhos).not.toContain(antigo)
    }
  })

  it("filename com storeId saneado + competência", async () => {
    const { conteudo } = await montar()
    expect(conteudo.nomeArquivo).toBe("pacote-contador-loja-teste-42-2026-06.zip")
  })
})

describe("Pacote 008B — colunas dos CSVs (cabeçalhos congelados)", () => {
  it("vendas/itens/devolucoes/movimentacoes/titulos/sessoes/operacoes", async () => {
    const { conteudo } = await montar()
    const head = (p: string) => arq(conteudo, p).replace(/^﻿/, "").split("\r\n")[0]
    expect(head("01-VENDAS/vendas.csv")).toBe("venda_id,numero,data,status,total_bruto,desconto_informativo,devolucoes,total_liquido,forma_pagamento_status")
    expect(head("01-VENDAS/itens.csv")).toBe("venda_id,item_id,produto_codigo,produto_descricao,quantidade,valor_unitario,desconto,total_item")
    expect(head("01-VENDAS/devolucoes.csv")).toBe("devolucao_id,venda_id,data_devolucao,valor,status")
    expect(head("02-FINANCEIRO/movimentacoes.csv")).toBe("movimentacao_id,data,tipo,classificacao,valor,origem")
    expect(head("02-FINANCEIRO/contas_receber.csv")).toBe("titulo_id,vencimento,status,valor_original,valor_aberto,disponibilidade")
    expect(head("02-FINANCEIRO/contas_pagar.csv")).toBe("titulo_id,vencimento,status,valor_original,valor_aberto,disponibilidade")
    expect(head("03-CAIXA/sessoes.csv")).toBe("sessao_id,abertura,fechamento,status,saldo_inicial,saldo_final,saldo_contado,diferenca_disponivel,diferenca")
    expect(head("03-CAIXA/operacoes.csv")).toBe("operacao_id,sessao_id,data,tipo,classificacao,valor")
  })

  it("BOM UTF-8 e CRLF em todos os CSVs", async () => {
    const { conteudo } = await montar()
    for (const a of conteudo.arquivos.filter((x) => x.caminho.endsWith(".csv"))) {
      expect(a.conteudo.startsWith("﻿")).toBe(true)
      expect(a.conteudo).toContain("\r\n")
    }
  })
})

describe("Pacote 008B — semântica das linhas", () => {
  it("canceladas (008D): FORA de vendas.csv e itens.csv; faturamento e agregado preservam o informativo", async () => {
    const { detalhadas, conteudo } = await montar()
    const vendas = arq(conteudo, "01-VENDAS/vendas.csv")
    expect(vendas).not.toContain("VDA-2") // cancelada não entra no CSV detalhado (nem zerada)
    expect(vendas).not.toContain("cancelada")
    expect(vendas).toContain("VDA-1") // a concluída permanece
    const itens = arq(conteudo, "01-VENDAS/itens.csv")
    expect(itens).not.toContain("i2") // item da venda cancelada não entra
    expect(itens).toContain("i1")
    // vendas detalhadas contêm somente a concluída:
    expect(detalhadas.vendas.linhas.map((l) => l.numero)).toEqual(["VDA-1"])
    // faturamento autoritativo exclui cancelada (total = 100, não 180):
    const resumo = arq(conteudo, "00-LEIA-ME/resumo.md")
    expect(resumo).toContain("100,00")
    expect(resumo).not.toContain("180,00")
  })

  it("diferença de caixa sem saldo contado → diferenca_disponivel=nao e célula vazia", async () => {
    const { conteudo } = await montar()
    const linhas = arq(conteudo, "03-CAIXA/sessoes.csv").split("\r\n")
    const s2 = linhas.find((l) => l.startsWith("s2,"))!
    expect(s2.endsWith(",nao,")).toBe(true)
  })

  it("classificação de movimentação: entrada/saida/transferencia/nao_classificado", async () => {
    const { conteudo } = await montar()
    const mv = arq(conteudo, "02-FINANCEIRO/movimentacoes.csv")
    expect(mv).toContain(",entrada,")
    expect(mv).toContain(",saida,")
    expect(mv).toContain("transferencia")
    expect(mv).toContain("nao_classificado")
  })

  it("operação de tipo desconhecido → nao_classificado (não silenciado)", async () => {
    const { conteudo } = await montar()
    expect(arq(conteudo, "03-CAIXA/operacoes.csv")).toContain("nao_classificado")
  })

  it("títulos (GOAL 008C): aberto na competência entra como real; inválido fica fora e torna a fonte parcial", async () => {
    const { conteudo } = await montar()
    const cr = arq(conteudo, "02-FINANCEIRO/contas_receber.csv")
    // r1 (2026-06-10, pendente) é aberto e da competência → entra como `real`.
    expect(cr).toContain("r1,2026-06-10,pendente,30,30,real")
    // r2 (vencimento inválido) NÃO entra mais no CSV (nem com valor_aberto=0).
    expect(cr).not.toContain("r2")
    expect(cr).not.toContain("data-invalida")
    // A ausência é honesta: a fonte fica parcial e a observação chega ao manifesto.
    const man = JSON.parse(arq(conteudo, "manifest.json"))
    const fonteCR = man.fontes.find((f: { nome: string }) => f.nome === "contas_receber")
    expect(fonteCR.estado).toBe("parcial")
    expect(fonteCR.observacao).toContain("sem vencimento reconhecível")
  })
})

describe("Pacote 008B — minimização de PII", () => {
  it("nenhum arquivo contém nome/documento/segredo/operador/motivo", async () => {
    const { conteudo } = await montar()
    const tudo = conteudo.arquivos.map((a) => a.conteudo).join("\n")
    for (const p of PII) expect(tudo, `vazou: ${p}`).not.toContain(p)
  })

  it("storeId só aparece no manifest.json (competencia.storeId)", async () => {
    const { conteudo } = await montar()
    for (const a of conteudo.arquivos) {
      if (a.caminho === "manifest.json") continue
      expect(a.conteudo, `storeId vazou em ${a.caminho}`).not.toContain(STORE)
    }
    const man = JSON.parse(arq(conteudo, "manifest.json"))
    expect(man.competencia.storeId).toBe(STORE)
  })
})

describe("Pacote 008B — manifesto v1 canônico", () => {
  it("schema, versão, período UTC, geradoPor interno e integridade", async () => {
    const { conteudo } = await montar()
    const man = JSON.parse(arq(conteudo, "manifest.json"))
    expect(man.schema).toBe("omni.contador.pacote.manifest/v1")
    expect(man.pacoteVersao).toBe(1)
    expect(man.competencia).toMatchObject({ storeId: STORE, ano: 2026, mes: 6, timezone: "America/Sao_Paulo" })
    expect(man.competencia.periodoUtc.inicio).toBe(periodo.inicio.toISOString())
    expect(man.competencia.periodoUtc.fimExclusivo).toBe(periodo.fimExclusivo.toISOString())
    expect(man.geradoPor.tipo).toBe("interno")
    expect(man.geradoPor.id).toMatch(/^u_[0-9a-f]{16}$/)
    expect(man.geradoPor.id).not.toContain(USER) // pseudônimo, não o id cru
    expect(man.fontes.map((f: { nome: string }) => f.nome)).toEqual([
      "vendas", "itens", "devolucoes", "movimentacoes", "contas_receber", "contas_pagar", "sessoes", "operacoes", "xml",
    ])
    expect(man.fontes.find((f: { nome: string }) => f.nome === "xml").estado).toBe("indisponivel")
    expect(man.fontes.find((f: { nome: string }) => f.nome === "vendas").registros).toBe(1) // v2 cancelada fora (008D)
    const listados = man.arquivos.map((a: { caminho: string }) => a.caminho)
    expect(listados).not.toContain("manifest.json")
    expect(listados).toContain("00-LEIA-ME/indice.md")
    for (const entrada of man.arquivos) {
      expect(sha256Hex(arq(conteudo, entrada.caminho))).toBe(entrada.sha256)
    }
    expect(Array.isArray(man.pendencias)).toBe(true)
    expect(Array.isArray(man.itensNaoDisponiveis)).toBe(true)
    expect(man.avisos.join(" ")).toContain("CONTADOR_FISCAL_READER")
  })
})

describe("Pacote 025 — copy de documentos e determinismo", () => {
  it("README limita a ausência a este pacote e continua no manifesto", async () => {
    const { conteudo } = await montar()
    const readme = arq(conteudo, "04-DOCUMENTOS/LEIA-ME.md")

    expect(readme).toContain("nenhum documento foi incluído neste pacote")
    expect(readme).toContain("ausência de anexos no ZIP")
    expect(readme).toContain("domínio Documentos")
    const staleDomainClaim = ["domínio real de documentos", "ainda não existe"].join(" ")
    const staleGoalsReference = ["GOALs", "009/010"].join(" ")
    expect(readme).not.toContain(staleDomainClaim)
    expect(readme).not.toContain(staleGoalsReference)
    expect(readme).not.toMatch(/\bzero documentos\b/i)
    expect(readme).not.toMatch(/loja não possu[ai] documentos/i)

    const manifesto = JSON.parse(arq(conteudo, "manifest.json")) as {
      arquivos: { caminho: string; sha256: string }[]
    }
    const item = manifesto.arquivos.find((arquivo) => arquivo.caminho === "04-DOCUMENTOS/LEIA-ME.md")
    expect(item).toBeDefined()
    expect(item?.sha256).toBe(sha256Hex(readme))

    const avisos = montarAvisos().join("\n")
    expect(avisos).not.toMatch(/GOALs 009\/010/i)
    expect(avisos).not.toMatch(/domínio real.*não (existe|têm)/i)
  })

  it("montagem permanece determinística para a mesma entrada", async () => {
    const primeiro = await montar()
    const segundo = await montar()
    expect(segundo.conteudo).toEqual(primeiro.conteudo)
  })
})

describe("Pacote 008B — fonte indisponível e competência vazia", () => {
  it("uma fonte que falha vira indisponível, CSV mantém cabeçalho e ZIP segue válido (14 arquivos)", async () => {
    const cliente = clienteCompleto({
      devolucaoVenda: { findMany: async () => { throw new Error("boom") } },
    })
    const { conteudo } = await montar(cliente)
    expect(conteudo.arquivos.length).toBe(14)
    const dev = arq(conteudo, "01-VENDAS/devolucoes.csv")
    expect(dev.replace(/^﻿/, "").split("\r\n")[0]).toBe("devolucao_id,venda_id,data_devolucao,valor,status")
    const man = JSON.parse(arq(conteudo, "manifest.json"))
    expect(man.fontes.find((f: { nome: string }) => f.nome === "devolucoes").estado).toBe("indisponivel")
  })

  it("competência sem dados gera 14 arquivos válidos com CSVs só de cabeçalho", async () => {
    const vazio: PacoteReaderClient = {
      venda: { findMany: async () => [] },
      produto: { findMany: async () => [] },
      devolucaoVenda: { findMany: async () => [] },
      movimentacaoFinanceira: { findMany: async () => [] },
      contaReceberTitulo: { findMany: async () => [] },
      contaPagarTitulo: { findMany: async () => [] },
      sessaoCaixa: { findMany: async () => [] },
      caixaOperacao: { findMany: async () => [] },
    }
    const { conteudo } = await montar(vazio)
    expect(conteudo.arquivos.length).toBe(14)
    const vendas = arq(conteudo, "01-VENDAS/vendas.csv").replace(/^﻿/, "").split("\r\n").filter(Boolean)
    expect(vendas.length).toBe(1) // só cabeçalho
  })
})

describe("Pacote 008B — CSV RFC 4180 e limites", () => {
  it("separador vírgula, injeção de fórmula neutralizada, negativos preservados, nulo vazio", () => {
    const csv = montarCsv(["a", "b", "c"], [[texto("=CMD()"), numero(-5.5), numero(null)]])
    expect(csv).toContain("a,b,c")
    expect(csv).toContain("'=CMD()")
    expect(csv).toContain("-5.5")
    expect(csv).not.toContain("'-5.5")
  })

  it("campo com vírgula é citado (aspas)", () => {
    const csv = montarCsv(["x"], [[texto("a,b")]])
    expect(csv).toContain('"a,b"')
  })

  it("neutralizarFormula cobre = + - @ e ignora texto comum", () => {
    for (const s of ["=1", "+1", "-1", "@x"]) expect(neutralizarFormula(s)).toBe(`'${s}`)
    expect(neutralizarFormula("ok")).toBe("ok")
  })

  it("assertRegistrosFonte lança PacoteLimiteExcedidoError acima do teto", () => {
    expect(() => assertRegistrosFonte("vendas", 999_999)).toThrow(PacoteLimiteExcedidoError)
    expect(() => assertRegistrosFonte("vendas", 10)).not.toThrow()
  })

  it("sanitizarStoreIdParaArquivo remove barra/dois-pontos/.. e limita", () => {
    expect(sanitizarStoreIdParaArquivo("loja/../:evil path")).toBe("loja-evil-path")
    expect(sanitizarStoreIdParaArquivo("")).toBe("loja")
    expect(sanitizarStoreIdParaArquivo("../../etc")).toBe("etc")
  })
})
