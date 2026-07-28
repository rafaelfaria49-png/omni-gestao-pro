/**
 * GOAL CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012 — snapshot canônico e hash determinístico.
 *
 * Categoria 8 dos testes obrigatórios: sem PII, ordenação determinística, datas e
 * decimais normalizados, mudança real altera o hash, ordem diferente NÃO altera.
 */
import { describe, expect, it } from "vitest"
import {
  canonizar,
  hashCanonico,
  normalizarDecimal,
  ordenarPorChave,
  serializarCanonico,
  sha256Texto,
  ValorNaoCanonicoError,
} from "@/lib/contador/fechamento/canonico"
import {
  contarDocumentos,
  extrairTotais,
  hashSnapshot,
  montarSnapshot,
  serializarSnapshotParaPacote,
  SNAPSHOT_SCHEMA,
  verificarSnapshotDoPacote,
} from "@/lib/contador/fechamento/snapshot"
import { compararTotais } from "@/lib/contador/fechamento/divergencia"
import type { ContadorDadosReais } from "@/lib/contador/readers/tipos"
import type { ChecklistFechamento } from "@/lib/contador/fechamento/tipos"

/* ─────────────────────────── fixtures ─────────────────────────── */

const AGORA = new Date("2026-08-05T12:00:00.000Z")
const COMP = { ano: 2026, mes: 7 }

function metrica(valor: number | null, disp: "real" | "parcial" | "indisponivel" = "real") {
  return { valor, disponibilidade: disp, fonte: "teste" }
}

function dados(over: Partial<Record<string, number>> = {}): ContadorDadosReais {
  return {
    competencia: COMP,
    liquidoCompetencia: metrica(over.liquido ?? 1000),
    vendas: {
      quantidade: metrica(over.vendasQtd ?? 10),
      total: metrica(over.vendasTotal ?? 1200),
      canceladasQuantidade: metrica(0),
      canceladasTotal: metrica(0),
      descontoTotal: metrica(0),
      descontoCoberturaQuantidade: metrica(0),
      formasPagamento: [],
      formaPagamentoDisponibilidade: "real",
      naoIdentificadoQuantidade: metrica(0),
      naoIdentificadoValor: metrica(0),
      divergenciaPagamentoQuantidade: metrica(0),
      reconciliacaoPagamento: null,
    },
    devolucoes: { quantidade: metrica(1), total: metrica(over.devolucoes ?? 200) },
    financeiro: {
      entradasRealizadas: metrica(900),
      saidasRealizadas: metrica(300),
      estornos: metrica(0),
      transferencias: metrica(0),
      transferenciasQuantidade: metrica(0),
      naoClassificados: metrica(0),
      naoClassificadosQuantidade: metrica(0),
      titulosReceberAberto: metrica(50),
      titulosReceberQuantidade: metrica(2),
      titulosPagarAberto: metrica(30),
      titulosPagarQuantidade: metrica(1),
    },
    caixa: {
      sessoes: metrica(3),
      sessoesAbertas: metrica(0),
      sangriasTotal: metrica(0),
      sangriasQuantidade: metrica(0),
      suprimentosTotal: metrica(0),
      suprimentosQuantidade: metrica(0),
      diferencas: metrica(0),
    },
    alertas: [],
    fiscal: metrica(null, "indisponivel"),
  } as unknown as ContadorDadosReais
}

function checklist(itens: { id: string; estado: string }[]): ChecklistFechamento {
  return {
    competencia: COMP,
    itens: itens.map((i) => ({
      id: i.id,
      titulo: i.id,
      estado: i.estado,
      origem: "teste",
      explicacao: "teste",
    })),
    contagem: { ok: 0, atencao: 0, pendente: 0, nao_disponivel: 0, total: itens.length },
    disclaimer: "teste",
    geradoEm: AGORA.toISOString(),
  } as unknown as ChecklistFechamento
}

function montar(over: Partial<Parameters<typeof montarSnapshot>[0]> = {}) {
  return montarSnapshot({
    competencia: COMP,
    versao: 1,
    fechadaEm: AGORA,
    userId: "user-1",
    dados: dados(),
    checklist: checklist([{ id: "vendas", estado: "ok" }]),
    pendenciasAssumidas: [],
    documentos: [],
    ...over,
  })
}

/* ─────────────────────────── forma canônica ─────────────────────────── */

describe("canônico · ordem de chaves não altera o hash", () => {
  it("dois objetos com a MESMA informação em ordens diferentes geram o mesmo hash", () => {
    const a = { b: 1, a: { z: true, y: "x" }, c: [1, 2] }
    const b = { c: [1, 2], a: { y: "x", z: true }, b: 1 }
    expect(serializarCanonico(a)).toBe(serializarCanonico(b))
    expect(hashCanonico(a)).toBe(hashCanonico(b))
  })

  it("ordem de ARRAY importa (é informação, não ordenação incidental)", () => {
    expect(hashCanonico({ x: [1, 2] })).not.toBe(hashCanonico({ x: [2, 1] }))
  })

  it("Date vira ISO e -0 é normalizado para 0", () => {
    expect(canonizar(new Date("2026-07-28T00:00:00.000Z"))).toBe("2026-07-28T00:00:00.000Z")
    expect(serializarCanonico({ n: -0 })).toBe('{"n":0}')
  })

  it("undefined some do objeto mas vira null dentro de array (não desloca índice)", () => {
    expect(serializarCanonico({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(serializarCanonico({ a: [1, undefined, 3] })).toBe('{"a":[1,null,3]}')
  })

  it("valor não canonizável é RECUSADO em vez de virar null silencioso", () => {
    expect(() => serializarCanonico({ n: Number.NaN })).toThrow(ValorNaoCanonicoError)
    expect(() => serializarCanonico({ n: Infinity })).toThrow(ValorNaoCanonicoError)
    expect(() => serializarCanonico({ d: new Date("lixo") })).toThrow(ValorNaoCanonicoError)
  })

  it("normalizarDecimal elimina ruído de ponto flutuante", () => {
    expect(normalizarDecimal(0.1 + 0.2)).toBe(0.3)
    expect(normalizarDecimal(null)).toBeNull()
  })

  it("ordenarPorChave é estável e não muta a entrada", () => {
    const entrada = [{ id: "b" }, { id: "a" }]
    const saida = ordenarPorChave(entrada, (i) => i.id)
    expect(saida.map((i) => i.id)).toEqual(["a", "b"])
    expect(entrada.map((i) => i.id)).toEqual(["b", "a"])
  })
})

/* ─────────────────────────── snapshot ─────────────────────────── */

describe("snapshot · determinismo", () => {
  it("mesma entrada ⇒ mesmo hash", () => {
    expect(hashSnapshot(montar())).toBe(hashSnapshot(montar()))
  })

  it("ordem diferente do MESMO checklist não altera o hash", () => {
    const a = montar({ checklist: checklist([{ id: "a", estado: "ok" }, { id: "b", estado: "ok" }]) })
    const b = montar({ checklist: checklist([{ id: "b", estado: "ok" }, { id: "a", estado: "ok" }]) })
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it("ordem diferente das MESMAS pendências não altera o hash", () => {
    const a = montar({
      checklist: checklist([{ id: "a", estado: "pendente" }, { id: "b", estado: "pendente" }]),
      pendenciasAssumidas: ["a", "b"],
    })
    const b = montar({
      checklist: checklist([{ id: "a", estado: "pendente" }, { id: "b", estado: "pendente" }]),
      pendenciasAssumidas: ["b", "a", "b"],
    })
    expect(a.pendenciasAssumidas).toEqual(["a", "b"])
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it("ordem diferente dos MESMOS documentos não altera o hash", () => {
    const docs = [
      { categoria: "FISCAL", status: "ENVIADO" },
      { categoria: "FOLHA", status: "PENDENTE" },
    ]
    const a = montar({ documentos: docs })
    const b = montar({ documentos: [...docs].reverse() })
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it("mudança REAL de total altera o hash", () => {
    const a = montar()
    const b = montar({ dados: dados({ vendasTotal: 1201 }) })
    expect(hashSnapshot(a)).not.toBe(hashSnapshot(b))
  })

  it("mudança de versão altera o hash", () => {
    expect(hashSnapshot(montar())).not.toBe(hashSnapshot(montar({ versao: 2 })))
  })

  it("SEM CICLO: o snapshot não referencia nada do manifesto/pacote", () => {
    const s = montar()
    const serializado = JSON.stringify(s)
    // Se qualquer um destes aparecesse, o snapshot dependeria do manifesto — que por
    // sua vez lista o hash do snapshot. Nenhum dos dois hashes seria calculável.
    for (const proibido of ["manifestoHash", "pacote", "arquivos", "bytes"]) {
      expect(serializado, proibido).not.toContain(proibido)
    }
  })
})

describe("snapshot · conteúdo seguro (ADR-001 · G2-05)", () => {
  it("responsável é pseudônimo — nunca o userId cru", () => {
    const s = montar({ userId: "usuario-real-123" })
    expect(s.responsavel.id).toMatch(/^u_[0-9a-f]{16}$/)
    expect(JSON.stringify(s)).not.toContain("usuario-real-123")
  })

  it("não carrega storageRef, URL, token, secret nem linha operacional", () => {
    const serializado = JSON.stringify(montar({ documentos: [{ categoria: "FISCAL", status: "ENVIADO" }] }))
    for (const proibido of ["storageRef", "signedUrl", "http", "token", "secret", "cpf", "email"]) {
      expect(serializado.toLowerCase(), proibido).not.toContain(proibido.toLowerCase())
    }
  })

  it("tem schemaVersion v2 e só chaves agregadas de topo", () => {
    const s = montar()
    expect(s.schemaVersion).toBe(SNAPSHOT_SCHEMA)
    expect(SNAPSHOT_SCHEMA).toContain("/v2")
    expect(Object.keys(s).sort()).toEqual([
      "checklist",
      "competencia",
      "documentos",
      "fechadaEm",
      "pendenciasAssumidas",
      "responsavel",
      "schemaVersion",
      "totais",
      "versao",
    ])
  })

  it("não carrega storeId — o pacote só admite storeId no manifest.json", () => {
    const s = montar()
    expect(Object.keys(s.competencia).sort()).toEqual(["ano", "codigo", "mes"])
    expect(JSON.stringify(s)).not.toContain("loja-1")
  })

  it("os bytes gravados no pacote são exatamente o JSON canônico e batem com o hash", () => {
    const s = montar()
    const conteudo = serializarSnapshotParaPacote(s)
    // Sem indentação e sem quebra de linha final: sha256(arquivo) === snapshotHash.
    expect(conteudo).toBe(serializarCanonico(s))
    expect(conteudo.endsWith("\n")).toBe(false)
    expect(sha256Texto(conteudo)).toBe(hashSnapshot(s))
  })

  it("verificarSnapshotDoPacote reconstrói o snapshot e recusa conteúdo adulterado", () => {
    const s = montar()
    const conteudo = serializarSnapshotParaPacote(s)
    const hash = hashSnapshot(s)

    const reconstruido = verificarSnapshotDoPacote(conteudo, hash)
    expect(reconstruido).not.toBeNull()
    expect(reconstruido).toEqual(JSON.parse(conteudo))

    // Um byte alterado quebra a verificação.
    expect(verificarSnapshotDoPacote(conteudo.replace("2026", "2027"), hash)).toBeNull()
    expect(verificarSnapshotDoPacote(conteudo, "0".repeat(64))).toBeNull()
  })

  it("totais guardam valor + disponibilidade, sem texto de fonte/observação", () => {
    const t = extrairTotais(dados())
    expect(t["vendas.total"]).toEqual({ valor: 1200, disponibilidade: "real" })
    expect(JSON.stringify(t)).not.toContain("fonte")
  })

  it("contagem de documentos é por categoria e status, com chaves ordenadas", () => {
    const c = contarDocumentos([
      { categoria: "folha", status: "pendente" },
      { categoria: "FISCAL", status: "ENVIADO" },
      { categoria: "FISCAL", status: "ENVIADO" },
    ])
    expect(c.total).toBe(3)
    expect(c.porCategoria).toEqual({ FISCAL: 2, FOLHA: 1 })
    expect(c.porStatus).toEqual({ ENVIADO: 2, PENDENTE: 1 })
    expect(Object.keys(c.porCategoria)).toEqual(["FISCAL", "FOLHA"])
  })
})

/* ─────────────────────────── divergência ─────────────────────────── */

describe("divergência · comparação snapshot × dados vivos", () => {
  it("dados iguais NÃO geram divergência", () => {
    const d = compararTotais(extrairTotais(dados()), extrairTotais(dados()))
    expect(d.divergente).toBe(false)
    expect(d.itens).toEqual([])
  })

  it("alteração detectada produz item, delta e diffHash estável", () => {
    const a = extrairTotais(dados())
    const b = extrairTotais(dados({ vendasTotal: 1500 }))
    const d1 = compararTotais(a, b)
    const d2 = compararTotais(a, b)

    expect(d1.divergente).toBe(true)
    expect(d1.itens).toHaveLength(1)
    expect(d1.itens[0].chave).toBe("vendas.total")
    expect(d1.itens[0].natureza).toBe("valor")
    expect(d1.itens[0].delta).toBe(300)
    // Mesma divergência ⇒ mesmo hash (é a chave de dedupe do evento).
    expect(d1.diffHash).toBe(d2.diffHash)
  })

  it("divergências diferentes produzem diffHash diferentes", () => {
    const base = extrairTotais(dados())
    const h1 = compararTotais(base, extrairTotais(dados({ vendasTotal: 1300 }))).diffHash
    const h2 = compararTotais(base, extrairTotais(dados({ vendasTotal: 1400 }))).diffHash
    expect(h1).not.toBe(h2)
  })

  it("ruído de centavo abaixo de meio centavo não conta como alteração", () => {
    const a = extrairTotais(dados({ vendasTotal: 1200 }))
    const b = extrairTotais(dados({ vendasTotal: 1200.001 }))
    expect(compararTotais(a, b).divergente).toBe(false)
  })

  it("mudança só de disponibilidade também é divergência", () => {
    const a = extrairTotais(dados())
    const vivo = dados()
    const b = {
      ...extrairTotais(vivo),
      "vendas.total": { valor: 1200, disponibilidade: "parcial" as const },
    }
    const d = compararTotais(a, b)
    expect(d.divergente).toBe(true)
    expect(d.itens[0].natureza).toBe("disponibilidade")
  })

  it("chave que sumiu dos dados vivos é divergência (não é tratada como igual)", () => {
    const a = extrairTotais(dados())
    const b = { ...extrairTotais(dados()) } as Record<string, { valor: number | null; disponibilidade: "real" }>
    delete b["caixa.sessoes"]
    expect(compararTotais(a, b).divergente).toBe(true)
  })
})
