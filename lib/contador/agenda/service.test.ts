/**
 * GOAL 016 — serviço da agenda (fake in-memory, sem Prisma).
 *
 * Cobre: idempotência template+competência, lote mensal vs `nenhuma`, 28–31,
 * template inativo, guia inválida, vencido derivado, matriz 011, competência
 * fechada, cross-store, documento/comprovante alheios, guia paga.
 */
import { describe, expect, it } from "vitest"
import { CompetenciaFechadaError } from "@/lib/contador/documentos/service"
import {
  PermissaoTransicaoError,
  TransicaoConcorrenteError,
  TransicaoInvalidaError,
} from "@/lib/contador/status/matriz"
import type { CapacidadesContador } from "@/lib/contador/status/permissoes"
import {
  AgendaValidacaoError,
  DocumentoAgendaInvalidoError,
  GuiaNaoEncontradaError,
  GuiaPagaError,
  ObrigacaoNaoEncontradaError,
  TemplateInativoError,
  TemplateNaoEncontradoError,
} from "./erros"
import {
  alterarStatusObrigacao,
  atualizarGuia,
  atualizarObrigacao,
  carregarResumoGuiasChecklist,
  criarGuia,
  criarObrigacao,
  criarTemplate,
  atualizarTemplate,
  removerTemplate,
  instanciarLoteMensal,
  listarAgenda,
  listarTemplates,
  pagarGuia,
  type AgendaRepo,
  type DepsAgenda,
} from "./service"
import type {
  CompetenciaAgendaRef,
  DocumentoAgendaRef,
  EscopoAgenda,
  GuiaRow,
  NovoEventoAgenda,
  ObrigacaoRow,
  TemplateRow,
} from "./tipos"

const ESCOPO: EscopoAgenda = { storeId: "loja-1", userId: "user-1" }
const ESCOPO_B: EscopoAgenda = { storeId: "loja-2", userId: "user-2" }
const CAP: CapacidadesContador = {
  acessaHub: true,
  podeConferir: true,
  podeGerenciarAcessoExterno: false,
}
const CAP_BAIXO: CapacidadesContador = { ...CAP, podeConferir: false }
const AGORA = new Date("2026-07-16T12:00:00.000Z")
const COMP = "2026-07"

type Fake = AgendaRepo & {
  _eventos: NovoEventoAgenda[]
  _fechar(storeId: string, codigo: string): void
  _semearDoc(doc: DocumentoAgendaRef): void
}

function fakeRepo(): Fake {
  const comps = new Map<string, CompetenciaAgendaRef>()
  const tpls = new Map<string, TemplateRow>()
  const obgs = new Map<string, ObrigacaoRow>()
  const guias = new Map<string, GuiaRow>()
  const docs = new Map<string, DocumentoAgendaRef>()
  const eventos: NovoEventoAgenda[] = []
  const agora = () => new Date()
  const ck = (storeId: string, ano: number, mes: number) => `${storeId}:${ano}-${mes}`

  function attachComp(row: { competenciaId: string }) {
    const ref = [...comps.values()].find((x) => x.id === row.competenciaId) ?? {
      id: row.competenciaId,
      status: "ABERTA",
      ano: 2026,
      mes: 7,
    }
    return { competenciaAno: ref.ano, competenciaMes: ref.mes, competenciaStatus: ref.status }
  }

  const repo: Fake = {
    _eventos: eventos,
    _fechar(storeId, codigo) {
      const [ano, mes] = codigo.split("-").map(Number)
      const c = comps.get(ck(storeId, ano, mes))
      if (c) comps.set(ck(storeId, ano, mes), { ...c, status: "FECHADA" })
    },
    _semearDoc(doc) {
      docs.set(`${doc.storeId}:${doc.id}`, doc)
    },

    async getOrCreateCompetencia(storeId, comp) {
      const k = ck(storeId, comp.ano, comp.mes)
      let c = comps.get(k)
      if (!c) {
        c = { id: `comp-${k}`, status: "ABERTA", ano: comp.ano, mes: comp.mes }
        comps.set(k, c)
      }
      return { ...c }
    },
    async acharCompetencia(storeId, comp) {
      const c = comps.get(ck(storeId, comp.ano, comp.mes))
      return c ? { ...c } : null
    },
    async acharCompetenciaPorId(id, storeId) {
      return [...comps.values()].find((c) => c.id === id && comps.get(ck(storeId, c.ano, c.mes))?.id === id) ?? null
    },

    async listarTemplates(storeId) {
      return [...tpls.values()].filter((t) => t.storeId === storeId)
    },
    async acharTemplate(id, storeId) {
      const t = tpls.get(id)
      return t && t.storeId === storeId ? { ...t } : null
    },
    async criarTemplate(row, evento) {
      const full: TemplateRow = { ...row, createdAt: agora(), updatedAt: agora() }
      tpls.set(row.id, full)
      eventos.push(evento)
      return { ...full }
    },
    async atualizarTemplate(id, storeId, data, evento) {
      const t = tpls.get(id)
      if (!t || t.storeId !== storeId) throw new TemplateNaoEncontradoError()
      Object.assign(t, data, { updatedAt: agora() })
      eventos.push(evento)
      return { ...t }
    },
    async contarObrigacoesDoTemplate(templateId, storeId) {
      return [...obgs.values()].filter((o) => o.templateId === templateId && o.storeId === storeId).length
    },
    async excluirTemplate(id, storeId) {
      const t = tpls.get(id)
      if (!t || t.storeId !== storeId) throw new TemplateNaoEncontradoError()
      tpls.delete(id)
    },

    async listarObrigacoes(competenciaId, storeId) {
      return [...obgs.values()]
        .filter((o) => o.competenciaId === competenciaId && o.storeId === storeId)
        .map((o) => ({ ...o, ...attachComp(o) }))
    },
    async acharObrigacao(id, storeId) {
      const o = obgs.get(id)
      return o && o.storeId === storeId ? { ...o, ...attachComp(o) } : null
    },
    async acharObrigacaoPorTemplate(templateId, competenciaId, storeId) {
      const o = [...obgs.values()].find(
        (x) => x.templateId === templateId && x.competenciaId === competenciaId && x.storeId === storeId,
      )
      return o ? { ...o, ...attachComp(o) } : null
    },
    async criarObrigacao(row, evento) {
      if (row.templateId) {
        const dup = [...obgs.values()].find(
          (x) => x.templateId === row.templateId && x.competenciaId === row.competenciaId,
        )
        if (dup) {
          const err = new Error("unique") as Error & { code: string }
          err.code = "P2002"
          throw err
        }
      }
      const full: ObrigacaoRow = {
        ...row,
        createdAt: agora(),
        updatedAt: agora(),
        ...attachComp(row),
      }
      obgs.set(row.id, full)
      eventos.push(evento)
      return { ...full }
    },
    async atualizarObrigacao(id, storeId, data, evento) {
      const o = obgs.get(id)
      if (!o || o.storeId !== storeId) throw new ObrigacaoNaoEncontradaError()
      Object.assign(o, data, { updatedAt: agora() })
      eventos.push(evento)
      return { ...o, ...attachComp(o) }
    },
    async aplicarStatusObrigacao({ id, storeId, de, para, evento }) {
      const o = obgs.get(id)
      if (!o || o.storeId !== storeId) throw new ObrigacaoNaoEncontradaError()
      if (o.status !== de) throw new TransicaoConcorrenteError()
      o.status = para
      o.updatedAt = agora()
      eventos.push(evento)
      return { ...o, ...attachComp(o) }
    },

    async listarGuias(competenciaId, storeId) {
      return [...guias.values()]
        .filter((g) => g.competenciaId === competenciaId && g.storeId === storeId)
        .map((g) => ({ ...g, ...attachComp(g) }))
    },
    async acharGuia(id, storeId) {
      const g = guias.get(id)
      return g && g.storeId === storeId ? { ...g, ...attachComp(g) } : null
    },
    async criarGuia(row, evento) {
      const full: GuiaRow = { ...row, createdAt: agora(), updatedAt: agora(), ...attachComp(row) }
      guias.set(row.id, full)
      eventos.push(evento)
      return { ...full }
    },
    async atualizarGuia(id, storeId, data, evento) {
      const g = guias.get(id)
      if (!g || g.storeId !== storeId) throw new GuiaNaoEncontradaError()
      if (g.pagaEm) throw new GuiaPagaError()
      Object.assign(g, data, { updatedAt: agora() })
      eventos.push(evento)
      return { ...g, ...attachComp(g) }
    },
    async marcarGuiaPaga(id, storeId, pagaEm, comprovanteDocumentoId, evento) {
      const g = guias.get(id)
      if (!g || g.storeId !== storeId) throw new GuiaNaoEncontradaError()
      if (g.pagaEm) throw new GuiaPagaError()
      g.pagaEm = pagaEm
      g.comprovanteDocumentoId = comprovanteDocumentoId
      g.updatedAt = agora()
      eventos.push(evento)
      return { ...g, ...attachComp(g) }
    },
    async acharDocumentoDaLoja(id, storeId) {
      return docs.get(`${storeId}:${id}`) ?? null
    },
  }
  return repo
}

function deps(repo = fakeRepo()): DepsAgenda & { repo: Fake } {
  return { repo }
}

describe("templates e lote", () => {
  it("lote mensal instancia só templates mensais ativos; nenhuma fica de fora", async () => {
    const d = deps()
    const mensal = await criarTemplate(ESCOPO, { titulo: "DAS", tipo: "pagamento_guia", diaVencimento: 20, recorrencia: "mensal" }, CAP, d)
    await criarTemplate(ESCOPO, { titulo: "Avulsa", tipo: "tarefa", recorrencia: "nenhuma" }, CAP, d)
    const lote = await instanciarLoteMensal(ESCOPO, COMP, CAP, d, AGORA)
    expect(lote.criadas).toBe(1)
    expect(lote.obrigacoes).toHaveLength(1)
    expect(lote.obrigacoes[0].templateId).toBe(mensal.id)
    expect(lote.obrigacoes[0].titulo).toBe("DAS")
  })

  it("nenhuma só gera obrigação por seleção explícita daquele template", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "Balanço", tipo: "declaracao", recorrencia: "nenhuma" }, CAP, d)
    const lote = await instanciarLoteMensal(ESCOPO, COMP, CAP, d, AGORA)
    expect(lote.criadas).toBe(0)
    const ob = await criarObrigacao(ESCOPO, { competencia: COMP, templateId: t.id }, CAP, d, AGORA)
    expect(ob.templateId).toBe(t.id)
    expect(ob.titulo).toBe("Balanço")
  })

  it("idempotência template + competência (segunda chamada não duplica)", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "FGTS", tipo: "pagamento_guia", diaVencimento: 20 }, CAP, d)
    const a = await criarObrigacao(ESCOPO, { competencia: COMP, templateId: t.id }, CAP, d, AGORA)
    const b = await criarObrigacao(ESCOPO, { competencia: COMP, templateId: t.id }, CAP, d, AGORA)
    expect(b.id).toBe(a.id)
    const lote = await instanciarLoteMensal(ESCOPO, COMP, CAP, d, AGORA)
    expect(lote.criadas).toBe(0)
    expect(lote.existentes).toBe(1)
  })

  it("template inativo não entra no lote nem na seleção explícita", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "ISS", tipo: "pagamento_guia", diaVencimento: 10 }, CAP, d)
    await d.repo.atualizarTemplate(t.id, ESCOPO.storeId, { ativo: false }, {
      storeId: ESCOPO.storeId,
      competenciaId: null,
      tipo: "x",
      atorTipo: "interno",
      atorId: "u",
      entidade: "t",
      entidadeId: t.id,
      origem: "t",
      metadata: {},
    })
    const lote = await instanciarLoteMensal(ESCOPO, COMP, CAP, d, AGORA)
    expect(lote.criadas).toBe(0)
    await expect(criarObrigacao(ESCOPO, { competencia: COMP, templateId: t.id }, CAP, d, AGORA)).rejects.toBeInstanceOf(
      TemplateInativoError,
    )
  })

  it("dia 31 clamp 28/29/30/31 no mês da competência", async () => {
    const d = deps()
    await criarTemplate(ESCOPO, { titulo: "Dia 31", tipo: "tarefa", diaVencimento: 31, recorrencia: "mensal" }, CAP, d)
    const fev = await instanciarLoteMensal(ESCOPO, "2025-02", CAP, d, AGORA)
    expect(fev.obrigacoes[0].vencimento?.slice(0, 10)).toBe("2025-02-28")
    const d2 = deps()
    await criarTemplate(ESCOPO, { titulo: "Dia 31b", tipo: "tarefa", diaVencimento: 31, recorrencia: "mensal" }, CAP, d2)
    const leap = await instanciarLoteMensal(ESCOPO, "2024-02", CAP, d2, AGORA)
    expect(leap.obrigacoes[0].vencimento?.slice(0, 10)).toBe("2024-02-29")
    const d3 = deps()
    await criarTemplate(ESCOPO, { titulo: "Dia 31c", tipo: "tarefa", diaVencimento: 31, recorrencia: "mensal" }, CAP, d3)
    const abr = await instanciarLoteMensal(ESCOPO, "2026-04", CAP, d3, AGORA)
    expect(abr.obrigacoes[0].vencimento?.slice(0, 10)).toBe("2026-04-30")
    const d4 = deps()
    await criarTemplate(ESCOPO, { titulo: "Dia 31d", tipo: "tarefa", diaVencimento: 31, recorrencia: "mensal" }, CAP, d4)
    const mai = await instanciarLoteMensal(ESCOPO, "2026-05", CAP, d4, AGORA)
    expect(mai.obrigacoes[0].vencimento?.slice(0, 10)).toBe("2026-05-31")
  })
})

describe("templates — permissão elevada (podeConferir)", () => {
  it("HUB sem capacidade elevada é bloqueado em POST/PATCH/DELETE", async () => {
    const d = deps()
    await expect(
      criarTemplate(ESCOPO, { titulo: "Bloqueado", tipo: "tarefa", diaVencimento: 5 }, CAP_BAIXO, d),
    ).rejects.toBeInstanceOf(PermissaoTransicaoError)
    const t = await criarTemplate(ESCOPO, { titulo: "Ok", tipo: "tarefa", diaVencimento: 5 }, CAP, d)
    await expect(atualizarTemplate(ESCOPO, t.id, { titulo: "hack" }, CAP_BAIXO, d)).rejects.toBeInstanceOf(
      PermissaoTransicaoError,
    )
    await expect(removerTemplate(ESCOPO, t.id, CAP_BAIXO, d)).rejects.toBeInstanceOf(PermissaoTransicaoError)
    const ainda = await listarTemplates(ESCOPO, d)
    expect(ainda).toHaveLength(1)
    expect(ainda[0].titulo).toBe("Ok")
  })

  it("financeiro/admin (podeConferir) pode criar, alterar e inativar", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "DAS", tipo: "pagamento_guia", diaVencimento: 20 }, CAP, d)
    const up = await atualizarTemplate(ESCOPO, t.id, { titulo: "DAS-2" }, CAP, d)
    expect(up.titulo).toBe("DAS-2")
    const r = await removerTemplate(ESCOPO, t.id, CAP, d)
    expect(r.inativado).toBe(false)
    expect(await listarTemplates(ESCOPO, d)).toHaveLength(0)
  })

  it("GET/listar continua permitido sem capacidade elevada", async () => {
    const d = deps()
    await criarTemplate(ESCOPO, { titulo: "Visível", tipo: "tarefa", diaVencimento: 8 }, CAP, d)
    const lista = await listarTemplates(ESCOPO, d)
    expect(lista).toHaveLength(1)
    expect(lista[0].titulo).toBe("Visível")
  })

  it("cross-store: escrita elevada na loja B não vê template da loja A (404/fail-closed)", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "Só A", tipo: "tarefa", diaVencimento: 5 }, CAP, d)
    await expect(atualizarTemplate(ESCOPO_B, t.id, { titulo: "hack" }, CAP, d)).rejects.toBeInstanceOf(
      TemplateNaoEncontradoError,
    )
    await expect(removerTemplate(ESCOPO_B, t.id, CAP, d)).rejects.toBeInstanceOf(TemplateNaoEncontradoError)
    expect(await listarTemplates(ESCOPO_B, d)).toEqual([])
    const daA = await listarTemplates(ESCOPO, d)
    expect(daA).toHaveLength(1)
    expect(daA[0].titulo).toBe("Só A")
  })

  it("403 de escrita não vaza storeId nem título", async () => {
    const d = deps()
    try {
      await criarTemplate(ESCOPO, { titulo: "segredo-interno", tipo: "tarefa" }, CAP_BAIXO, d)
      throw new Error("esperava PermissaoTransicaoError")
    } catch (e) {
      expect(e).toBeInstanceOf(PermissaoTransicaoError)
      const msg = e instanceof Error ? e.message : ""
      expect(msg).not.toContain("loja-1")
      expect(msg).not.toContain("segredo-interno")
    }
  })
})

describe("matriz 011 na obrigação", () => {
  it("PENDENTE → ENVIADO permitido; PENDENTE → RESOLVIDO recusado", async () => {
    const d = deps()
    const ob = await criarObrigacao(
      ESCOPO,
      { competencia: COMP, titulo: "Envio XML", tipo: "envio_documento", vencimento: "2026-07-20" },
      CAP,
      d,
      AGORA,
    )
    const env = await alterarStatusObrigacao(ESCOPO, { obrigacaoId: ob.id, para: "ENVIADO" }, CAP, d, AGORA)
    expect(env.status).toBe("ENVIADO")
    await expect(
      alterarStatusObrigacao(ESCOPO, { obrigacaoId: ob.id, para: "RESOLVIDO" }, CAP, d, AGORA),
    ).rejects.toBeInstanceOf(TransicaoInvalidaError)
  })

  it("conferir exige papel elevado", async () => {
    const d = deps()
    const ob = await criarObrigacao(ESCOPO, { competencia: COMP, titulo: "X", tipo: "tarefa" }, CAP, d, AGORA)
    await alterarStatusObrigacao(ESCOPO, { obrigacaoId: ob.id, para: "ENVIADO" }, CAP, d, AGORA)
    await expect(
      alterarStatusObrigacao(ESCOPO, { obrigacaoId: ob.id, para: "CONFERIDO" }, CAP_BAIXO, d, AGORA),
    ).rejects.toBeInstanceOf(PermissaoTransicaoError)
  })
})

describe("guias", () => {
  it("guia inválida (valor negativo / data inexistente / título vazio)", async () => {
    const d = deps()
    await expect(
      criarGuia(ESCOPO, { competencia: COMP, titulo: "DAS", valorCentavos: -1, vencimento: "2026-07-20" }, d, AGORA),
    ).rejects.toBeInstanceOf(AgendaValidacaoError)
    await expect(
      criarGuia(ESCOPO, { competencia: COMP, titulo: "DAS", valorCentavos: 100, vencimento: "2026-02-31" }, d, AGORA),
    ).rejects.toBeInstanceOf(AgendaValidacaoError)
    await expect(
      criarGuia(ESCOPO, { competencia: COMP, titulo: "  ", valorCentavos: 0, vencimento: "2026-07-20" }, d, AGORA),
    ).rejects.toBeInstanceOf(AgendaValidacaoError)
  })

  it("vencido derivado; pago não vence", async () => {
    const d = deps()
    const g = await criarGuia(
      ESCOPO,
      { competencia: COMP, titulo: "ISS", valorCentavos: 0, vencimento: "2026-07-10" },
      d,
      AGORA,
    )
    expect(g.vencido).toBe(true)
    expect(g.paga).toBe(false)
    const paga = await pagarGuia(ESCOPO, g.id, {}, CAP, d, AGORA)
    expect(paga.paga).toBe(true)
    expect(paga.vencido).toBe(false)
    expect(paga.comprovanteAusente).toBe(true)
    await expect(atualizarGuia(ESCOPO, g.id, { titulo: "x" }, d, AGORA)).rejects.toBeInstanceOf(GuiaPagaError)
    await expect(pagarGuia(ESCOPO, g.id, {}, CAP, d, AGORA)).rejects.toBeInstanceOf(GuiaPagaError)
  })

  it("pagar exige podeConferir", async () => {
    const d = deps()
    const g = await criarGuia(
      ESCOPO,
      { competencia: COMP, titulo: "FGTS", valorCentavos: 10, vencimento: "2026-07-20" },
      d,
      AGORA,
    )
    await expect(pagarGuia(ESCOPO, g.id, {}, CAP_BAIXO, d, AGORA)).rejects.toBeInstanceOf(PermissaoTransicaoError)
  })

  it("documento de outra loja → 404; de outra competência → inválido; PDF não-pdf recusado", async () => {
    const d = deps()
    d.repo._semearDoc({
      id: "doc-b",
      storeId: "loja-2",
      competenciaId: "outro",
      mime: "application/pdf",
      excluidoEm: null,
    })
    await expect(
      criarGuia(
        ESCOPO,
        { competencia: COMP, titulo: "G", valorCentavos: 1, vencimento: "2026-07-20", pdfDocumentoId: "doc-b" },
        d,
        AGORA,
      ),
    ).rejects.toBeInstanceOf(DocumentoAgendaInvalidoError)

    const agenda = await listarAgenda(ESCOPO, COMP, CAP, d, AGORA)
    // cria competência
    await criarObrigacao(ESCOPO, { competencia: COMP, titulo: "o", tipo: "tarefa" }, CAP, d, AGORA)
    const ref = await d.repo.acharCompetencia(ESCOPO.storeId, { ano: 2026, mes: 7 })
    d.repo._semearDoc({
      id: "doc-outra-comp",
      storeId: ESCOPO.storeId,
      competenciaId: "comp-alheia",
      mime: "application/pdf",
      excluidoEm: null,
    })
    await expect(
      criarGuia(
        ESCOPO,
        {
          competencia: COMP,
          titulo: "G2",
          valorCentavos: 1,
          vencimento: "2026-07-20",
          pdfDocumentoId: "doc-outra-comp",
        },
        d,
        AGORA,
      ),
    ).rejects.toBeInstanceOf(DocumentoAgendaInvalidoError)

    d.repo._semearDoc({
      id: "doc-png",
      storeId: ESCOPO.storeId,
      competenciaId: ref!.id,
      mime: "image/png",
      excluidoEm: null,
    })
    await expect(
      criarGuia(
        ESCOPO,
        { competencia: COMP, titulo: "G3", valorCentavos: 1, vencimento: "2026-07-20", pdfDocumentoId: "doc-png" },
        d,
        AGORA,
      ),
    ).rejects.toBeInstanceOf(AgendaValidacaoError)
    void agenda
  })
})

describe("escopo e competência fechada", () => {
  it("cross-store: obrigação/guia/template da loja A não existem na loja B", async () => {
    const d = deps()
    const t = await criarTemplate(ESCOPO, { titulo: "T", tipo: "tarefa", diaVencimento: 5 }, CAP, d)
    const ob = await criarObrigacao(ESCOPO, { competencia: COMP, templateId: t.id }, CAP, d, AGORA)
    const g = await criarGuia(
      ESCOPO,
      { competencia: COMP, titulo: "Guia", valorCentavos: 0, vencimento: "2026-07-20" },
      d,
      AGORA,
    )
    await expect(atualizarObrigacao(ESCOPO_B, ob.id, { titulo: "hack" }, CAP, d, AGORA)).rejects.toBeInstanceOf(
      ObrigacaoNaoEncontradaError,
    )
    await expect(atualizarGuia(ESCOPO_B, g.id, { titulo: "hack" }, d, AGORA)).rejects.toBeInstanceOf(GuiaNaoEncontradaError)
    await expect(atualizarTemplate(ESCOPO_B, t.id, { titulo: "hack" }, CAP, d)).rejects.toBeInstanceOf(
      TemplateNaoEncontradoError,
    )
    expect(await listarTemplates(ESCOPO_B, d)).toEqual([])
    const listaB = await listarAgenda(ESCOPO_B, COMP, CAP, d, AGORA)
    expect(listaB.obrigacoes).toEqual([])
    expect(listaB.guias).toEqual([])
  })

  it("competência FECHADA recusa escrita", async () => {
    const d = deps()
    await criarObrigacao(ESCOPO, { competencia: COMP, titulo: "antes", tipo: "tarefa" }, CAP, d, AGORA)
    d.repo._fechar(ESCOPO.storeId, COMP)
    await expect(
      criarObrigacao(ESCOPO, { competencia: COMP, titulo: "depois", tipo: "tarefa" }, CAP, d, AGORA),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    await expect(
      criarGuia(ESCOPO, { competencia: COMP, titulo: "g", valorCentavos: 0, vencimento: "2026-07-20" }, d, AGORA),
    ).rejects.toBeInstanceOf(CompetenciaFechadaError)
    await expect(instanciarLoteMensal(ESCOPO, COMP, CAP, d, AGORA)).rejects.toBeInstanceOf(CompetenciaFechadaError)
  })
})

describe("resumo checklist e eventos", () => {
  it("0 guias → leituraOk com total 0", async () => {
    const d = deps()
    const r = await carregarResumoGuiasChecklist(ESCOPO, COMP, d, AGORA)
    expect(r).toEqual({ leituraOk: true, total: 0, vencidas: 0, vencendo: 0, pagas: 0 })
  })

  it("grava eventos de criação/status/guia paga", async () => {
    const d = deps()
    const ob = await criarObrigacao(ESCOPO, { competencia: COMP, titulo: "E", tipo: "tarefa" }, CAP, d, AGORA)
    await alterarStatusObrigacao(ESCOPO, { obrigacaoId: ob.id, para: "ENVIADO" }, CAP, d, AGORA)
    const g = await criarGuia(
      ESCOPO,
      { competencia: COMP, titulo: "G", valorCentavos: 0, vencimento: "2026-07-20" },
      d,
      AGORA,
    )
    await pagarGuia(ESCOPO, g.id, {}, CAP, d, AGORA)
    const tipos = d.repo._eventos.map((e) => e.tipo)
    expect(tipos).toContain("obrigacao_criada")
    expect(tipos).toContain("obrigacao_status_alterado")
    expect(tipos).toContain("guia_informada")
    expect(tipos).toContain("guia_paga")
    expect(d.repo._eventos.every((e) => e.origem === "contador.agenda")).toBe(true)
  })
})
