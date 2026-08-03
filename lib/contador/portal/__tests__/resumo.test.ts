/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — resumo da competência.
 *
 * Prova as duas origens honestas: FECHADA → snapshot oficial com selo `oficial vN`
 * (sem tocar nos dados vivos); aberta → dados vivos com o escopo nominal do
 * portal + checklist; falha da leitura → `dados: null` + checklist
 * `nao_disponivel`, nunca zero silencioso.
 */
import { describe, expect, it } from "vitest"
import type { CompetenciaFechamentoRow, FechamentoRepo } from "@/lib/contador/fechamento/service"
import { SNAPSHOT_SCHEMA, type SnapshotFechamentoV2 } from "@/lib/contador/fechamento/snapshot"
import {
  monetarioIndisponivel,
  monetarioReal,
  numericoReal,
  type ContadorDadosReais,
} from "@/lib/contador/readers/tipos"
import { carregarResumoPortal } from "../resumo"
import { escopoExternoFake } from "./helpers"

const AGORA = new Date("2026-08-01T12:00:00.000Z")
const COMP = Object.freeze({ ano: 2026, mes: 7 })

function linhaCompetencia(over: Partial<CompetenciaFechamentoRow> = {}): CompetenciaFechamentoRow {
  return {
    id: "comp-1",
    storeId: "loja-1",
    ano: 2026,
    mes: 7,
    status: "ABERTA",
    versao: 1,
    snapshot: null,
    snapshotHash: null,
    fechadaEm: null,
    fechadaPorId: null,
    reabertaEm: null,
    updatedAt: AGORA,
    ...over,
  }
}

function snapshotV2(): SnapshotFechamentoV2 {
  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA,
    competencia: Object.freeze({ ano: 2026, mes: 7, codigo: "2026-07" }),
    versao: 2,
    fechadaEm: AGORA.toISOString(),
    responsavel: Object.freeze({ tipo: "interno" as const, id: "u_pseudonimo" }),
    totais: Object.freeze({
      "vendas.total": Object.freeze({ valor: 1234.56, disponibilidade: "real" as const }),
    }),
    checklist: Object.freeze({
      contagem: Object.freeze({ ok: 10, atencao: 0, pendente: 1, nao_disponivel: 2, total: 13 }),
      itens: Object.freeze([Object.freeze({ id: "vendas", estado: "ok" })]),
    }),
    pendenciasAssumidas: Object.freeze(["sessoes_caixa"]),
    documentos: Object.freeze({
      total: 3,
      porCategoria: Object.freeze({ FISCAL: 3 }),
      porStatus: Object.freeze({ ENVIADO: 3 }),
    }),
  })
}

function repoFalso(rows: CompetenciaFechamentoRow[]): Pick<FechamentoRepo, "acharCompetencia" | "listarPacotes"> {
  return {
    acharCompetencia: async (storeId, comp) =>
      rows.find((c) => c.storeId === storeId && c.ano === comp.ano && c.mes === comp.mes) ?? null,
    listarPacotes: async () => [],
  }
}

function dadosVivosFake(): ContadorDadosReais {
  return Object.freeze({
    competencia: Object.freeze({ ano: 2026, mes: 7 }),
    liquidoCompetencia: monetarioReal(900, "Venda.total − DevolucaoVenda.valorTotal"),
    vendas: Object.freeze({
      quantidade: numericoReal(4, "Venda"),
      total: monetarioReal(1000, "Venda.total"),
      canceladasQuantidade: numericoReal(0, "Venda"),
      canceladasTotal: monetarioReal(0, "Venda.total"),
      descontoTotal: monetarioIndisponivel("Venda.payload.discountTotal", "parcial"),
      descontoCoberturaQuantidade: numericoReal(0, "Venda.payload.discountTotal"),
      formasPagamento: Object.freeze([]),
      formaPagamentoDisponibilidade: "indisponivel" as const,
      naoIdentificadoQuantidade: numericoReal(0, "Venda"),
      naoIdentificadoValor: monetarioReal(0, "Venda"),
      divergenciaPagamentoQuantidade: numericoReal(0, "Venda"),
      reconciliacaoPagamento: null,
    }),
    devolucoes: Object.freeze({
      quantidade: numericoReal(1, "DevolucaoVenda"),
      total: monetarioReal(100, "DevolucaoVenda.valorTotal"),
    }),
    financeiro: Object.freeze({
      entradasRealizadas: monetarioReal(800, "MovimentacaoFinanceira"),
      saidasRealizadas: monetarioReal(50, "MovimentacaoFinanceira"),
      estornos: monetarioReal(0, "MovimentacaoFinanceira"),
      transferencias: monetarioReal(0, "MovimentacaoFinanceira"),
      transferenciasQuantidade: numericoReal(0, "MovimentacaoFinanceira"),
      naoClassificados: monetarioReal(0, "MovimentacaoFinanceira"),
      naoClassificadosQuantidade: numericoReal(0, "MovimentacaoFinanceira"),
      titulosReceberAberto: monetarioReal(0, "ContaReceberTitulo"),
      titulosReceberQuantidade: numericoReal(0, "ContaReceberTitulo"),
      titulosPagarAberto: monetarioReal(0, "ContaPagarTitulo"),
      titulosPagarQuantidade: numericoReal(0, "ContaPagarTitulo"),
    }),
    caixa: Object.freeze({
      sessoes: numericoReal(2, "SessaoCaixa"),
      sessoesAbertas: numericoReal(0, "SessaoCaixa"),
      sangriasTotal: monetarioReal(0, "CaixaOperacao"),
      sangriasQuantidade: numericoReal(0, "CaixaOperacao"),
      suprimentosTotal: monetarioReal(0, "CaixaOperacao"),
      suprimentosQuantidade: numericoReal(0, "CaixaOperacao"),
      diferencas: monetarioReal(0, "SessaoCaixa"),
    }),
    alertas: Object.freeze([]),
    fiscal: monetarioIndisponivel("NotaFiscal (CONTADOR_FISCAL_READER)", "fora de escopo"),
  })
}

describe("carregarResumoPortal — competência FECHADA", () => {
  it("origem snapshot oficial, selo `oficial v2`, SEM chamar a leitura viva", async () => {
    const row = linhaCompetencia({
      status: "FECHADA",
      versao: 2,
      snapshot: snapshotV2(),
      snapshotHash: "f".repeat(64),
      fechadaEm: AGORA,
    })
    let vivosChamados = 0
    const resumo = await carregarResumoPortal(
      escopoExternoFake(),
      COMP,
      {
        repo: repoFalso([row]),
        carregarDados: async () => {
          vivosChamados += 1
          return dadosVivosFake()
        },
      },
      AGORA,
    )
    expect(vivosChamados).toBe(0)
    expect(resumo.origem).toBe("snapshot")
    expect(resumo.fechada).toBe(true)
    expect(resumo.selo).toBe("oficial v2")
    expect(resumo.dados).toBeNull()
    expect(resumo.checklist).toBeNull()
    expect(resumo.snapshot).toMatchObject({
      versao: 2,
      documentos: { total: 3 },
      pendenciasAssumidas: ["sessoes_caixa"],
    })
    expect(resumo.snapshot!.totais["vendas.total"]).toMatchObject({ valor: 1234.56 })
    // Sem campos internos: o responsável cru do snapshot não sai no DTO? O recorte
    // do portal simplesmente não o carrega.
    expect(resumo.snapshot).not.toHaveProperty("responsavel")
  })
})

describe("carregarResumoPortal — competência aberta", () => {
  it("origem viva: dados + checklist, com o escopo NOMINAL do portal na leitura", async () => {
    let scopeVisto: unknown = null
    const resumo = await carregarResumoPortal(
      escopoExternoFake({ storeId: "loja-1", usuarioId: "usr-ext-1" }),
      COMP,
      {
        repo: repoFalso([linhaCompetencia()]),
        carregarDados: async (scope) => {
          scopeVisto = scope
          return dadosVivosFake()
        },
      },
      AGORA,
    )
    expect(resumo.origem).toBe("vivo")
    expect(resumo.fechada).toBe(false)
    expect(resumo.selo).toBeNull()
    expect(resumo.snapshot).toBeNull()
    expect(resumo.dados?.liquidoCompetencia.valor).toBe(900)
    expect(resumo.checklist!.itens.length).toBeGreaterThan(0)
    // A leitura viva recebeu o escopo nominal derivado do ContadorScopeExterno —
    // loja do vínculo, usuário externo, papel preservado.
    expect(scopeVisto).toMatchObject({ ok: true, storeId: "loja-1", userId: "usr-ext-1", papel: "LEITURA" })
  })

  it("falha da leitura viva → dados null + checklist nao_disponivel (nunca zero mudo, nunca 500)", async () => {
    const resumo = await carregarResumoPortal(
      escopoExternoFake(),
      COMP,
      {
        repo: repoFalso([linhaCompetencia()]),
        carregarDados: async () => {
          throw new Error("banco fora")
        },
      },
      AGORA,
    )
    expect(resumo.origem).toBe("vivo")
    expect(resumo.dados).toBeNull()
    expect(resumo.checklist!.contagem.nao_disponivel).toBeGreaterThan(0)
    const derivados = resumo.checklist!.itens.filter((i) => i.id === "vendas")
    expect(derivados[0]!.estado).toBe("nao_disponivel")
    expect(derivados[0]!.explicacao).toContain("Nenhum valor foi substituído por zero")
  })
})
