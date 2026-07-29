/**
 * Regressão da NF-e 5.380.135 (Martins) — Parte 14 do GOAL.
 *
 * Roda o fluxo real ponta a ponta sem banco: detector → merger → linha canônica →
 * matching → escrita → metadata. O "banco" é um mapa em memória escopado por
 * `storeId`, alimentado pelos mesmos indexadores que o persistidor Prisma usa.
 *
 * Cenário: os 13 produtos JÁ EXISTEM degradados na Loja 2 (SKU `linha-1..13`,
 * barcode vazio, brand = categoria slugada, preço 0, estoque 0) — exatamente o
 * estado deixado pela importação original.
 */

import { describe, expect, it } from "vitest"

import { agruparEMerge } from "@/lib/importador-avancado/merger"
import { detectarDominio } from "@/lib/importador-avancado/detector"
import type { PlanilhaParseada, RegistroMergeado } from "@/lib/importador-avancado/types"
import { mergeProdutoFiscalIntoMetadata, getProdutoFiscal } from "@/lib/produto-fiscal"

import { alertasDaLinha, temBloqueio } from "./alertas"
import { candidatoDoPlano, contextoDeMatch, indexarCandidatos, type ProdutoCandidatoRow } from "./candidatos"
import { resolverNomeCategoria } from "./categoria"
import {
  fiscalInputDaLinha,
  montarAtualizacaoProduto,
  montarCriacaoProduto,
} from "./escrita"
import { extrairLinhaProduto } from "./linha"
import { planejarMatchProduto } from "./matching"
import {
  IMPORTACAO_HISTORICO_MAX,
  construirLoteImportacao,
  getImportacaoMetadata,
  mergeImportacaoIntoMetadata,
} from "./metadata"
import { isSyntheticImportSku } from "./sku"
import type { ProdutoImportLinha } from "./types"
import {
  MARTINS_ARQUIVO,
  MARTINS_CONTEXTO,
  MARTINS_FORNECEDOR,
  MARTINS_HEADERS,
  MARTINS_ITENS,
  categoriaSlugLegado,
  martinsLinhasBrutas,
  martinsProdutosDegradados,
} from "./fixtures/martins-nfe-5380135"

// ── Banco simulado ───────────────────────────────────────────────────────────

type ProdutoFake = ProdutoCandidatoRow & {
  storeId: string
  category: string | null
  stock: number
  precoCusto: number
  warrantyDays: number
  status: string
}

function bancoDegradado(storeId = "loja-2"): ProdutoFake[] {
  return martinsProdutosDegradados(storeId).map((p) => ({
    ...p,
    storeId,
    category: categoriaSlugLegado(
      MARTINS_ITENS.find((i) => i.descricao === p.name)!.categoria,
    ),
    stock: 0,
    precoCusto: 0,
    warrantyDays: 0,
    status: "Ativo",
  }))
}

/** Espelha `carregarCandidatosProdutos`: consulta escopada por loja. */
function candidatosDaLoja(banco: ProdutoFake[], storeId: string, categorias: string[] = []) {
  return indexarCandidatos(
    banco.filter((p) => p.storeId === storeId),
    categorias,
  )
}

// ── Pipeline: fixture → registros mergeados ──────────────────────────────────

function planilhaMartins(): PlanilhaParseada {
  const headers = [...MARTINS_HEADERS]
  const { dominio, confianca, chaveJoin } = detectarDominio(headers, MARTINS_ARQUIVO)
  const linhas = martinsLinhasBrutas()
  return {
    nomeArquivo: MARTINS_ARQUIVO,
    dominio,
    confianca,
    chaveJoin,
    headers,
    linhas,
    totalLinhas: linhas.length,
  }
}

function registrosMartins(): RegistroMergeado[] {
  const grupos = agruparEMerge([planilhaMartins()])
  return grupos.get("produtos") ?? []
}

function linhasMartins(): ProdutoImportLinha[] {
  return registrosMartins().map((reg) =>
    extrairLinhaProduto(reg.campos, {
      linhaOrigem: reg.linhaOrigem ?? 0,
      fornecedorPadrao: MARTINS_CONTEXTO.fornecedor?.nome,
    }),
  )
}

// ── Execução simulada de uma importação completa ──────────────────────────────

type ResultadoSimulado = {
  criados: number
  atualizados: number
  conflitos: number
  ignorados: number
  matchPor: Record<string, number>
  alertasPorLinha: string[][]
  bloqueado: boolean
}

function rodarImportacao(
  banco: ProdutoFake[],
  storeId: string,
  batchId: string,
  categoriasDaLoja: string[] = [],
): ResultadoSimulado {
  const linhas = linhasMartins()
  const candidatos = candidatosDaLoja(banco, storeId, categoriasDaLoja)
  const consumidos = new Set<string>()

  const res: ResultadoSimulado = {
    criados: 0,
    atualizados: 0,
    conflitos: 0,
    ignorados: 0,
    matchPor: {},
    alertasPorLinha: [],
    bloqueado: false,
  }

  for (const linha of linhas) {
    const ctx = contextoDeMatch(linha, candidatos, consumidos)
    const plano = planejarMatchProduto(linha, ctx)
    const alertas = alertasDaLinha(linha, plano)
    res.alertasPorLinha.push(alertas.map((a) => a.codigo))
    if (temBloqueio(alertas)) res.bloqueado = true

    const categoria = resolverNomeCategoria(linha.categoria, candidatos.categorias)
    const lote = construirLoteImportacao({
      batchId,
      arquivo: MARTINS_ARQUIVO,
      importadoEm: `2026-07-29T10:00:0${res.criados + res.atualizados}.000Z`,
      acao: plano.acao === "atualizar" ? "atualizado" : "criado",
      matchPor: plano.matchPor,
      linhaOrigem: linha.linhaOrigem,
      contexto: MARTINS_CONTEXTO,
    })

    if (plano.acao === "conflito") {
      res.conflitos++
      continue
    }
    if (plano.acao === "ignorar") {
      res.ignorados++
      continue
    }

    if (plano.acao === "atualizar") {
      const alvo = candidatoDoPlano(ctx, plano.produtoId)!
      const registro = banco.find((p) => p.id === alvo.id)!
      const patch = montarAtualizacaoProduto(linha, alvo, { categoria })

      // Aplica o patch: chave ausente = campo intocado (estoque, active, price).
      registro.name = patch.name
      if ("sku" in patch) registro.sku = patch.sku ?? null
      if (patch.barcode !== undefined) registro.barcode = patch.barcode
      if (patch.category !== undefined) registro.category = patch.category
      if (patch.brand !== undefined) registro.brand = patch.brand
      if (patch.supplierName !== undefined) registro.supplierName = patch.supplierName
      if (patch.precoCusto !== undefined) registro.precoCusto = patch.precoCusto
      if (patch.price !== undefined) registro.price = patch.price
      if (patch.warrantyDays !== undefined) registro.warrantyDays = patch.warrantyDays

      let metadata = mergeProdutoFiscalIntoMetadata(registro.metadata, fiscalInputDaLinha(linha))
      metadata = mergeImportacaoIntoMetadata(metadata, lote)
      registro.metadata = metadata

      consumidos.add(alvo.id)
      res.atualizados++
      if (plano.matchPor) res.matchPor[plano.matchPor] = (res.matchPor[plano.matchPor] ?? 0) + 1
      continue
    }

    // Criação
    const dados = montarCriacaoProduto(linha, {
      categoria,
      politicaEstoque: MARTINS_CONTEXTO.politicaEstoque,
    })
    let metadata = mergeProdutoFiscalIntoMetadata({}, fiscalInputDaLinha(linha))
    metadata = mergeImportacaoIntoMetadata(metadata, lote)
    const novo: ProdutoFake = {
      id: `${storeId}-novo-${banco.length + 1}`,
      storeId,
      name: dados.name,
      sku: dados.sku,
      barcode: dados.barcode,
      brand: dados.brand,
      supplierName: dados.supplierName,
      active: dados.active,
      price: dados.price,
      metadata,
      category: dados.category,
      stock: dados.stock,
      precoCusto: dados.precoCusto,
      warrantyDays: dados.warrantyDays,
      status: dados.status,
    }
    banco.push(novo)
    consumidos.add(novo.id)
    res.criados++
  }

  return res
}

// ── Testes ───────────────────────────────────────────────────────────────────

describe("fixture Martins — leitura da planilha", () => {
  it("tem exatamente os 13 itens da nota", () => {
    expect(MARTINS_ITENS).toHaveLength(13)
  })

  it("a planilha é classificada como produtos", () => {
    expect(planilhaMartins().dominio).toBe("produtos")
  })

  it("gera 13 registros mergeados", () => {
    expect(registrosMartins()).toHaveLength(13)
  })

  it("cada linha tem barcode, categoria legível, custo, fornecedor e SKU null", () => {
    const linhas = linhasMartins()
    expect(linhas).toHaveLength(13)
    linhas.forEach((l, i) => {
      const esperado = MARTINS_ITENS[i]!
      expect(l.nome).toBe(esperado.descricao)
      expect(l.barcode).toBe(esperado.ean)
      expect(l.categoria).toBe(esperado.categoria)
      expect(l.custo).toBeCloseTo(Number(esperado.custo.replace(",", ".")), 2)
      expect(l.fornecedorNome).toBe(MARTINS_FORNECEDOR)
      // A planilha não tem coluna de SKU — permanece ausente, nunca `linha-N`.
      expect(l.sku).toBeNull()
      expect(l.preco).toBe(0)
      expect(l.estoque).toBeNull()
      expect(l.marca).toBe("")
    })
  })

  it("NCM e CEST canônicos, com zero à esquerda preservado", () => {
    const linhas = linhasMartins()
    linhas.forEach((l, i) => {
      expect(l.fiscal.ncm).toBe(MARTINS_ITENS[i]!.ncm)
      expect(l.fiscal.cest).toBe(MARTINS_ITENS[i]!.cest)
      expect(l.fiscalInvalido).toEqual([])
    })
    // Item 7 (lâmpada) tem CEST com zero à esquerda; item 9 tem EAN com zero à esquerda.
    expect(linhas[6]!.fiscal.cest).toBe("0900500")
    expect(linhas[8]!.barcode).toBe("041333038865")
  })

  it("gtinComercial espelha o código de barras do item", () => {
    linhasMartins().forEach((l, i) => {
      expect(l.fiscal.gtinComercial).toBe(MARTINS_ITENS[i]!.ean)
      expect(l.fiscal.gtinTributavel).toBe("")
    })
  })
})

describe("PRIMEIRA importação sobre o banco degradado", () => {
  it("0 criações, 13 atualizações, 0 conflitos, 13 matches por nome exato", () => {
    const banco = bancoDegradado()
    const res = rodarImportacao(banco, "loja-2", "adv-repair-1")

    expect(res.criados).toBe(0)
    expect(res.atualizados).toBe(13)
    expect(res.conflitos).toBe(0)
    expect(res.ignorados).toBe(0)
    expect(res.matchPor).toEqual({ nome_exato: 13 })
    // Nenhuma duplicata: o banco continua com 13 registros.
    expect(banco).toHaveLength(13)
  })

  it("todas as 13 linhas trazem o alerta explícito de match por nome", () => {
    const res = rodarImportacao(bancoDegradado(), "loja-2", "adv-repair-1")
    expect(res.alertasPorLinha).toHaveLength(13)
    for (const codigos of res.alertasPorLinha) {
      expect(codigos).toContain("match_por_nome")
    }
  })

  it("o lote não fica bloqueado (nenhum alerta de severidade erro)", () => {
    expect(rodarImportacao(bancoDegradado(), "loja-2", "adv-repair-1").bloqueado).toBe(false)
  })

  it("limpa os SKUs sintéticos linha-1..13", () => {
    const banco = bancoDegradado()
    expect(banco.every((p) => isSyntheticImportSku(p.sku))).toBe(true)
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    for (const p of banco) {
      expect(p.sku).toBeNull()
    }
  })

  it("grava os 13 códigos de barras", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    const eans = banco.map((p) => p.barcode)
    expect(eans).toEqual(MARTINS_ITENS.map((i) => i.ean))
    expect(new Set(eans).size).toBe(13)
  })

  it("grava o fornecedor Martins", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    for (const p of banco) {
      expect(p.supplierName).toBe(MARTINS_FORNECEDOR)
    }
  })

  it("categoria volta a ser legível e a marca deixa de ser a categoria", () => {
    const banco = bancoDegradado()
    // Estado inicial: slug na categoria e slug na marca.
    expect(banco[8]!.category).toBe("pilhas_e_baterias")
    expect(banco[8]!.brand).toBe("pilhas_e_baterias")

    rodarImportacao(banco, "loja-2", "adv-repair-1")

    banco.forEach((p, i) => {
      expect(p.category).toBe(MARTINS_ITENS[i]!.categoria)
      expect(p.category).not.toContain("_")
      // A planilha não informou marca — a marca fica vazia em vez de repetir a categoria.
      expect(p.brand).toBe("")
    })
    expect(banco[8]!.category).toBe("Pilhas e Baterias")
  })

  it("reaproveita a grafia da CategoriaCadastro quando a loja já tem a categoria", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1", ["PILHAS E BATERIAS"])
    expect(banco[8]!.category).toBe("PILHAS E BATERIAS")
  })

  it("persiste NCM/CEST em metadata.fiscal pelo helper canônico", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    banco.forEach((p, i) => {
      const fiscal = getProdutoFiscal({ metadata: p.metadata })
      expect(fiscal.ncm).toBe(MARTINS_ITENS[i]!.ncm)
      expect(fiscal.cest).toBe(MARTINS_ITENS[i]!.cest)
    })
  })

  it("preserva estoque em zero e preço em zero", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    for (const p of banco) {
      expect(p.stock).toBe(0)
      expect(p.price).toBe(0)
    }
  })

  it("importa o custo de cada item", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    banco.forEach((p, i) => {
      expect(p.precoCusto).toBeCloseTo(Number(MARTINS_ITENS[i]!.custo.replace(",", ".")), 2)
    })
  })

  it("grava proveniência completa do lote com status pendente de revisão", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    banco.forEach((p, i) => {
      const imp = getImportacaoMetadata({ metadata: p.metadata })!
      expect(imp.ultimoLote).toMatchObject({
        batchId: "adv-repair-1",
        origem: "planilha",
        arquivo: MARTINS_ARQUIVO,
        acao: "atualizado",
        matchPor: "nome_exato",
        linhaOrigem: i + 1,
        statusRevisao: "pendente",
        revisadoEm: null,
        revisadoPor: null,
      })
      expect(imp.ultimoLote.fornecedor).toEqual({
        nome: MARTINS_FORNECEDOR,
        documento: "43.214.055/0040-13",
      })
      expect(imp.ultimoLote.documento).toEqual({
        tipo: "nfe",
        numero: "5380135",
        serie: "0",
        chave: "52260143214055004013550000053801351857035145",
        dataEmissao: "2026-01-02",
      })
    })
  })

  it("produto sem preço fica inativo quando criado do zero (loja limpa)", () => {
    const banco: ProdutoFake[] = []
    const res = rodarImportacao(banco, "loja-9", "adv-novo-1")
    expect(res.criados).toBe(13)
    expect(res.atualizados).toBe(0)
    for (const p of banco) {
      expect(p.active).toBe(false)
      expect(p.status).toBe("Inativo")
      expect(p.stock).toBe(0)
      expect(getImportacaoMetadata({ metadata: p.metadata })!.ultimoLote.statusRevisao).toBe("pendente")
    }
  })

  it("produto existente ATIVO não é inativado por planilha sem preço", () => {
    const banco = bancoDegradado()
    expect(banco.every((p) => p.active)).toBe(true)
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    expect(banco.every((p) => p.active)).toBe(true)
  })
})

describe("SEGUNDA importação — idempotência", () => {
  it("0 novas criações e 13 matches por barcode", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    const segunda = rodarImportacao(banco, "loja-2", "adv-repair-2")

    expect(segunda.criados).toBe(0)
    expect(segunda.atualizados).toBe(13)
    expect(segunda.conflitos).toBe(0)
    // Agora o barcode existe no banco — a chave forte assume o matching.
    expect(segunda.matchPor).toEqual({ barcode: 13 })
    expect(banco).toHaveLength(13)
  })

  it("nenhuma duplicação de barcode após duas rodadas", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    rodarImportacao(banco, "loja-2", "adv-repair-2")
    const eans = banco.map((p) => p.barcode)
    expect(new Set(eans).size).toBe(13)
  })

  it("metadata fiscal preservado e histórico do lote anterior registrado", () => {
    const banco = bancoDegradado()
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    rodarImportacao(banco, "loja-2", "adv-repair-2")

    banco.forEach((p, i) => {
      expect(getProdutoFiscal({ metadata: p.metadata }).ncm).toBe(MARTINS_ITENS[i]!.ncm)
      const imp = getImportacaoMetadata({ metadata: p.metadata })!
      expect(imp.ultimoLote.batchId).toBe("adv-repair-2")
      expect(imp.ultimoLote.matchPor).toBe("barcode")
      expect(imp.historico.map((h) => h.batchId)).toEqual(["adv-repair-1"])
    })
  })

  it("reimportar muitas vezes mantém o histórico limitado", () => {
    const banco = bancoDegradado()
    for (let i = 1; i <= IMPORTACAO_HISTORICO_MAX + 4; i++) {
      rodarImportacao(banco, "loja-2", `adv-repeat-${i}`)
    }
    expect(banco).toHaveLength(13)
    for (const p of banco) {
      const imp = getImportacaoMetadata({ metadata: p.metadata })!
      expect(imp.historico.length).toBeLessThanOrEqual(IMPORTACAO_HISTORICO_MAX)
    }
  })

  it("outros namespaces de metadata sobrevivem às reimportações", () => {
    const banco = bancoDegradado()
    banco[0]!.metadata = { atributos: { tags: ["promo"] }, acessorios: { habilitado: true } }
    rodarImportacao(banco, "loja-2", "adv-repair-1")
    rodarImportacao(banco, "loja-2", "adv-repair-2")

    const meta = banco[0]!.metadata as Record<string, unknown>
    expect(meta.atributos).toEqual({ tags: ["promo"] })
    expect(meta.acessorios).toEqual({ habilitado: true })
    expect(getProdutoFiscal({ metadata: meta }).ncm).toBe(MARTINS_ITENS[0]!.ncm)
  })
})

describe("isolamento multi-loja com os mesmos EANs", () => {
  it("o mesmo EAN em duas lojas gera dois cadastros independentes", () => {
    const banco = [...bancoDegradado("loja-2")]
    rodarImportacao(banco, "loja-2", "adv-l2")
    expect(banco.filter((p) => p.storeId === "loja-2")).toHaveLength(13)

    // A loja 3 não tem nada: a mesma planilha cria 13 produtos novos lá.
    const res3 = rodarImportacao(banco, "loja-3", "adv-l3")
    expect(res3.criados).toBe(13)
    expect(banco.filter((p) => p.storeId === "loja-3")).toHaveLength(13)
    expect(banco.filter((p) => p.storeId === "loja-2")).toHaveLength(13)

    // O EAN do item 1 existe nas duas lojas, em produtos distintos.
    const comEan = banco.filter((p) => p.barcode === MARTINS_ITENS[0]!.ean)
    expect(comEan).toHaveLength(2)
    expect(new Set(comEan.map((p) => p.storeId))).toEqual(new Set(["loja-2", "loja-3"]))
  })

  it("reimportar na loja 3 é idempotente e não toca na loja 2", () => {
    const banco = [...bancoDegradado("loja-2")]
    rodarImportacao(banco, "loja-3", "adv-l3-a")
    const antesLoja2 = JSON.stringify(banco.filter((p) => p.storeId === "loja-2"))
    const segunda = rodarImportacao(banco, "loja-3", "adv-l3-b")

    expect(segunda.criados).toBe(0)
    expect(segunda.matchPor).toEqual({ barcode: 13 })
    expect(JSON.stringify(banco.filter((p) => p.storeId === "loja-2"))).toBe(antesLoja2)
  })
})
