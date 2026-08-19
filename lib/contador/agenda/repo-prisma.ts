/**
 * Contador HUB · Prisma `AgendaRepo` (GOAL 016).
 *
 * SERVER-ONLY. Escrita de linha + evento na mesma transação. Escopo sempre por
 * `storeId`. Não toca Financeiro, PDV, Operações ou Fiscal.
 *
 * Freeze (GOAL 012): mutações da agenda travam a competência com `updateMany`
 * `where: { id, storeId, status: { not: "FECHADA" } }` na mesma `$transaction`
 * da linha-filha + `ContadorEvento`. É a mesma trava de linha do fechamento —
 * não uma segunda semântica. Fecha concorrente → count 0 → aborta; zero evento.
 *
 * Guia paga: o UPDATE final é `updateMany` com `storeId` + `pagaEm: null`.
 * Perdeu a corrida → classifica 404 / GUIA_PAGA 409; zero evento.
 */
import type {
  ContadorGuiaOrigem,
  ContadorItemStatus,
  ContadorObrigacaoRecorrencia,
  ContadorObrigacaoTipo,
  Prisma,
} from "@/generated/prisma"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getOrCreateCompetencia } from "@/lib/contador/db/competencia"
import { CompetenciaFechadaError } from "@/lib/contador/documentos/service"
import { TransicaoConcorrenteError } from "@/lib/contador/status/matriz"
import {
  GuiaNaoEncontradaError,
  GuiaPagaError,
  ObrigacaoNaoEncontradaError,
  TemplateNaoEncontradoError,
} from "./erros"
import type { AgendaRepo, GuiaCreateInput, ObrigacaoCreateInput } from "./service"
import type {
  DocumentoAgendaRef,
  GuiaRow,
  NovoEventoAgenda,
  ObrigacaoRow,
  TemplateRow,
} from "./tipos"
import type { StatusItem } from "@/lib/contador/status/matriz"

/** Mesmo predicado do `assertAberta` do serviço: gravável <=> não FECHADA. */
export const STATUS_COMPETENCIA_FECHADA = "FECHADA" as const

const TPL_SELECT = {
  id: true,
  storeId: true,
  titulo: true,
  descricao: true,
  tipo: true,
  diaVencimento: true,
  recorrencia: true,
  ativo: true,
  criadoPorTipo: true,
  criadoPorId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContadorObrigacaoTemplateSelect

const OBG_SELECT = {
  id: true,
  storeId: true,
  competenciaId: true,
  templateId: true,
  titulo: true,
  descricao: true,
  tipo: true,
  vencimento: true,
  status: true,
  criadoPorTipo: true,
  criadoPorId: true,
  createdAt: true,
  updatedAt: true,
  competencia: { select: { ano: true, mes: true, status: true } },
} satisfies Prisma.ContadorObrigacaoSelect

const GUIA_SELECT = {
  id: true,
  storeId: true,
  competenciaId: true,
  obrigacaoId: true,
  titulo: true,
  valorCentavos: true,
  vencimento: true,
  origem: true,
  pdfDocumentoId: true,
  comprovanteDocumentoId: true,
  pagaEm: true,
  criadoPorTipo: true,
  criadoPorId: true,
  createdAt: true,
  updatedAt: true,
  competencia: { select: { ano: true, mes: true, status: true } },
} satisfies Prisma.ContadorGuiaSelect

type TplSel = Prisma.ContadorObrigacaoTemplateGetPayload<{ select: typeof TPL_SELECT }>
type ObgSel = Prisma.ContadorObrigacaoGetPayload<{ select: typeof OBG_SELECT }>
type GuiaSel = Prisma.ContadorGuiaGetPayload<{ select: typeof GUIA_SELECT }>

/* ───────────────────────────── porta mínima do Prisma ───────────────────────────── */

export interface AgendaTxClient {
  contadorCompetencia: {
    findFirst(args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
    }): Promise<{ id: string; status: string; ano: number; mes: number; storeId: string } | null>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  contadorObrigacaoTemplate: {
    findMany(args: Record<string, unknown>): Promise<TplSel[]>
    findFirst(args: Record<string, unknown>): Promise<TplSel | null>
    create(args: Record<string, unknown>): Promise<TplSel>
    update(args: Record<string, unknown>): Promise<TplSel>
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>
    count(args: Record<string, unknown>): Promise<number>
  }
  contadorObrigacao: {
    findMany(args: Record<string, unknown>): Promise<ObgSel[]>
    findFirst(args: Record<string, unknown>): Promise<ObgSel | null>
    create(args: Record<string, unknown>): Promise<ObgSel>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
    count(args: Record<string, unknown>): Promise<number>
  }
  contadorGuia: {
    findMany(args: Record<string, unknown>): Promise<GuiaSel[]>
    findFirst(args: Record<string, unknown>): Promise<GuiaSel | null>
    create(args: Record<string, unknown>): Promise<GuiaSel>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  contadorDocumento: {
    findFirst(args: Record<string, unknown>): Promise<DocumentoAgendaRef | null>
  }
  contadorEvento: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
}

export interface AgendaDbClient extends AgendaTxClient {
  $transaction<T>(fn: (tx: AgendaTxClient) => Promise<T>): Promise<T>
}

function mapTpl(t: TplSel): TemplateRow {
  return { ...t }
}

function mapObg(o: ObgSel): ObrigacaoRow {
  return {
    id: o.id,
    storeId: o.storeId,
    competenciaId: o.competenciaId,
    templateId: o.templateId,
    titulo: o.titulo,
    descricao: o.descricao,
    tipo: o.tipo,
    vencimento: o.vencimento,
    status: o.status,
    criadoPorTipo: o.criadoPorTipo,
    criadoPorId: o.criadoPorId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    competenciaAno: o.competencia.ano,
    competenciaMes: o.competencia.mes,
    competenciaStatus: o.competencia.status,
  }
}

function mapGuia(g: GuiaSel): GuiaRow {
  return {
    id: g.id,
    storeId: g.storeId,
    competenciaId: g.competenciaId,
    obrigacaoId: g.obrigacaoId,
    titulo: g.titulo,
    valorCentavos: g.valorCentavos,
    vencimento: g.vencimento,
    origem: g.origem,
    pdfDocumentoId: g.pdfDocumentoId,
    comprovanteDocumentoId: g.comprovanteDocumentoId,
    pagaEm: g.pagaEm,
    criadoPorTipo: g.criadoPorTipo,
    criadoPorId: g.criadoPorId,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    competenciaAno: g.competencia.ano,
    competenciaMes: g.competencia.mes,
    competenciaStatus: g.competencia.status,
  }
}

function eventoData(evento: NovoEventoAgenda): Record<string, unknown> {
  return {
    storeId: evento.storeId,
    competenciaId: evento.competenciaId,
    tipo: evento.tipo,
    atorTipo: evento.atorTipo,
    atorId: evento.atorId,
    entidade: evento.entidade,
    entidadeId: evento.entidadeId,
    origem: evento.origem,
    metadata: evento.metadata,
  }
}

function asTipo(v: string): ContadorObrigacaoTipo {
  return v as ContadorObrigacaoTipo
}
function asRec(v: string): ContadorObrigacaoRecorrencia {
  return v as ContadorObrigacaoRecorrencia
}
function asOrigem(v: string): ContadorGuiaOrigem {
  return v as ContadorGuiaOrigem
}
function asStatus(v: string): ContadorItemStatus {
  return v as ContadorItemStatus
}

function codigoP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && String((e as { code: unknown }).code) === "P2002"
}

/**
 * Trava de linha da competência — mesmo primitive do fechamento (GOAL 012):
 * `updateMany` com o estado esperado no `where`. Serializa com
 * `aplicarFechamento`. `data.storeId` é identidade (não muda a loja); o UPDATE
 * só existe para obter o row lock sem alterar o status.
 */
export async function travarCompetenciaNaoFechada(
  tx: AgendaTxClient,
  storeId: string,
  competenciaId: string,
): Promise<void> {
  const res = await tx.contadorCompetencia.updateMany({
    where: {
      id: competenciaId,
      storeId,
      status: { not: STATUS_COMPETENCIA_FECHADA },
    },
    data: { storeId },
  })
  if (res.count !== 1) throw new CompetenciaFechadaError()
}

async function classificarFalhaGuia(tx: AgendaTxClient, id: string, storeId: string): Promise<never> {
  const any = await tx.contadorGuia.findFirst({
    where: { id, storeId },
    select: { id: true, pagaEm: true, competencia: { select: { status: true } } },
  })
  if (!any) throw new GuiaNaoEncontradaError()
  if (any.pagaEm) throw new GuiaPagaError()
  throw new CompetenciaFechadaError()
}

async function criarObrigacaoNaTx(
  tx: AgendaTxClient,
  row: ObrigacaoCreateInput,
  evento: NovoEventoAgenda,
): Promise<ObgSel> {
  const o = await tx.contadorObrigacao.create({
    data: {
      id: row.id,
      storeId: row.storeId,
      competenciaId: row.competenciaId,
      templateId: row.templateId,
      titulo: row.titulo,
      descricao: row.descricao,
      tipo: asTipo(row.tipo),
      vencimento: row.vencimento,
      status: asStatus(row.status),
      criadoPorTipo: row.criadoPorTipo,
      criadoPorId: row.criadoPorId,
    },
    select: OBG_SELECT,
  })
  await tx.contadorEvento.create({ data: eventoData(evento) })
  return o
}

export function criarRepoAgenda(client?: AgendaDbClient): AgendaRepo {
  const obter = async (): Promise<AgendaDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as AgendaDbClient
  }

  return {
    async getOrCreateCompetencia(storeId, comp) {
      const { competencia } = await getOrCreateCompetencia(storeId, comp)
      return { id: competencia.id, status: competencia.status, ano: competencia.ano, mes: competencia.mes }
    },

    async acharCompetencia(storeId, comp) {
      const db = await obter()
      const c = await db.contadorCompetencia.findFirst({
        where: { storeId, ano: comp.ano, mes: comp.mes },
        select: { id: true, status: true, ano: true, mes: true, storeId: true },
      })
      return c ? { id: c.id, status: c.status, ano: c.ano, mes: c.mes } : null
    },

    async acharCompetenciaPorId(id, storeId) {
      const db = await obter()
      const c = await db.contadorCompetencia.findFirst({
        where: { id, storeId },
        select: { id: true, status: true, ano: true, mes: true, storeId: true },
      })
      return c ? { id: c.id, status: c.status, ano: c.ano, mes: c.mes } : null
    },

    async listarTemplates(storeId) {
      const db = await obter()
      const rows = await db.contadorObrigacaoTemplate.findMany({
        where: { storeId },
        select: TPL_SELECT,
        orderBy: [{ ativo: "desc" }, { titulo: "asc" }],
      })
      return rows.map(mapTpl)
    },

    async acharTemplate(id, storeId) {
      const db = await obter()
      const t = await db.contadorObrigacaoTemplate.findFirst({
        where: { id, storeId },
        select: TPL_SELECT,
      })
      return t ? mapTpl(t) : null
    },

    async criarTemplate(row, evento) {
      const db = await obter()
      const created = await db.$transaction(async (tx) => {
        const t = await tx.contadorObrigacaoTemplate.create({
          data: {
            id: row.id,
            storeId: row.storeId,
            titulo: row.titulo,
            descricao: row.descricao,
            tipo: asTipo(row.tipo),
            diaVencimento: row.diaVencimento,
            recorrencia: asRec(row.recorrencia),
            ativo: row.ativo,
            criadoPorTipo: row.criadoPorTipo,
            criadoPorId: row.criadoPorId,
          },
          select: TPL_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return t
      })
      return mapTpl(created)
    },

    async atualizarTemplate(id, storeId, data, evento) {
      const db = await obter()
      const updated = await db.$transaction(async (tx) => {
        const exists = await tx.contadorObrigacaoTemplate.findFirst({
          where: { id, storeId },
          select: { id: true },
        })
        if (!exists) throw new TemplateNaoEncontradoError()
        const t = await tx.contadorObrigacaoTemplate.update({
          where: { id },
          data: {
            ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
            ...(data.descricao !== undefined ? { descricao: data.descricao } : {}),
            ...(data.tipo !== undefined ? { tipo: asTipo(data.tipo) } : {}),
            ...(data.diaVencimento !== undefined ? { diaVencimento: data.diaVencimento } : {}),
            ...(data.recorrencia !== undefined ? { recorrencia: asRec(data.recorrencia) } : {}),
            ...(data.ativo !== undefined ? { ativo: data.ativo } : {}),
          },
          select: TPL_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return t
      })
      return mapTpl(updated)
    },

    async contarObrigacoesDoTemplate(templateId, storeId) {
      const db = await obter()
      return db.contadorObrigacao.count({ where: { templateId, storeId } })
    },

    async excluirTemplate(id, storeId) {
      const db = await obter()
      const r = await db.contadorObrigacaoTemplate.deleteMany({ where: { id, storeId } })
      if (r.count === 0) throw new TemplateNaoEncontradoError()
    },

    async listarObrigacoes(competenciaId, storeId) {
      const db = await obter()
      const rows = await db.contadorObrigacao.findMany({
        where: { competenciaId, storeId },
        select: OBG_SELECT,
        orderBy: [{ vencimento: "asc" }, { titulo: "asc" }],
      })
      return rows.map(mapObg)
    },

    async acharObrigacao(id, storeId) {
      const db = await obter()
      const o = await db.contadorObrigacao.findFirst({
        where: { id, storeId },
        select: OBG_SELECT,
      })
      return o ? mapObg(o) : null
    },

    async acharObrigacaoPorTemplate(templateId, competenciaId, storeId) {
      const db = await obter()
      const o = await db.contadorObrigacao.findFirst({
        where: { templateId, competenciaId, storeId },
        select: OBG_SELECT,
      })
      return o ? mapObg(o) : null
    },

    async criarObrigacao(row, evento) {
      const db = await obter()
      const created = await db.$transaction(async (tx) => {
        await travarCompetenciaNaoFechada(tx, row.storeId, row.competenciaId)
        return criarObrigacaoNaTx(tx, row, evento)
      })
      return mapObg(created)
    },

    async criarObrigacoesEmLote(itens) {
      if (itens.length === 0) return []
      const db = await obter()
      return db.$transaction(async (tx) => {
        const primeiro = itens[0]!
        await travarCompetenciaNaoFechada(tx, primeiro.row.storeId, primeiro.row.competenciaId)
        const out: ObrigacaoRow[] = []
        for (const item of itens) {
          try {
            const o = await criarObrigacaoNaTx(tx, item.row, item.evento)
            out.push(mapObg(o))
          } catch (e) {
            if (!codigoP2002(e) || !item.row.templateId) throw e
            const deNovo = await tx.contadorObrigacao.findFirst({
              where: {
                templateId: item.row.templateId,
                competenciaId: item.row.competenciaId,
                storeId: item.row.storeId,
              },
              select: OBG_SELECT,
            })
            if (!deNovo) throw e
            out.push(mapObg(deNovo))
          }
        }
        return out
      })
    },

    async atualizarObrigacao(id, storeId, data, evento) {
      const db = await obter()
      const updated = await db.$transaction(async (tx) => {
        const exists = await tx.contadorObrigacao.findFirst({
          where: { id, storeId },
          select: { id: true, competenciaId: true },
        })
        if (!exists) throw new ObrigacaoNaoEncontradaError()
        await travarCompetenciaNaoFechada(tx, storeId, exists.competenciaId)
        const upd = await tx.contadorObrigacao.updateMany({
          where: { id, storeId },
          data: {
            ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
            ...(data.descricao !== undefined ? { descricao: data.descricao } : {}),
            ...(data.tipo !== undefined ? { tipo: asTipo(data.tipo) } : {}),
            ...(data.vencimento !== undefined ? { vencimento: data.vencimento } : {}),
          },
        })
        if (upd.count !== 1) throw new ObrigacaoNaoEncontradaError()
        await tx.contadorEvento.create({ data: eventoData(evento) })
        const o = await tx.contadorObrigacao.findFirst({ where: { id, storeId }, select: OBG_SELECT })
        if (!o) throw new ObrigacaoNaoEncontradaError()
        return o
      })
      return mapObg(updated)
    },

    async aplicarStatusObrigacao(args: {
      id: string
      storeId: string
      de: StatusItem
      para: StatusItem
      evento: NovoEventoAgenda
    }) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const atual = await tx.contadorObrigacao.findFirst({
          where: { id: args.id, storeId: args.storeId },
          select: { id: true, competenciaId: true },
        })
        if (!atual) throw new ObrigacaoNaoEncontradaError()
        await travarCompetenciaNaoFechada(tx, args.storeId, atual.competenciaId)
        const upd = await tx.contadorObrigacao.updateMany({
          where: { id: args.id, storeId: args.storeId, status: asStatus(args.de) },
          data: { status: asStatus(args.para) },
        })
        if (upd.count === 0) throw new TransicaoConcorrenteError()
        await tx.contadorEvento.create({ data: eventoData(args.evento) })
        const o = await tx.contadorObrigacao.findFirst({
          where: { id: args.id, storeId: args.storeId },
          select: OBG_SELECT,
        })
        if (!o) throw new ObrigacaoNaoEncontradaError()
        return mapObg(o)
      })
    },

    async listarGuias(competenciaId, storeId) {
      const db = await obter()
      const rows = await db.contadorGuia.findMany({
        where: { competenciaId, storeId },
        select: GUIA_SELECT,
        orderBy: [{ vencimento: "asc" }, { titulo: "asc" }],
      })
      return rows.map(mapGuia)
    },

    async acharGuia(id, storeId) {
      const db = await obter()
      const g = await db.contadorGuia.findFirst({
        where: { id, storeId },
        select: GUIA_SELECT,
      })
      return g ? mapGuia(g) : null
    },

    async criarGuia(row: GuiaCreateInput, evento) {
      const db = await obter()
      const created = await db.$transaction(async (tx) => {
        await travarCompetenciaNaoFechada(tx, row.storeId, row.competenciaId)
        const g = await tx.contadorGuia.create({
          data: {
            id: row.id,
            storeId: row.storeId,
            competenciaId: row.competenciaId,
            obrigacaoId: row.obrigacaoId,
            titulo: row.titulo,
            valorCentavos: row.valorCentavos,
            vencimento: row.vencimento,
            origem: asOrigem(row.origem),
            pdfDocumentoId: row.pdfDocumentoId,
            comprovanteDocumentoId: row.comprovanteDocumentoId,
            pagaEm: row.pagaEm,
            criadoPorTipo: row.criadoPorTipo,
            criadoPorId: row.criadoPorId,
          },
          select: GUIA_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return g
      })
      return mapGuia(created)
    },

    async atualizarGuia(id, storeId, data, evento) {
      const db = await obter()
      const updated = await db.$transaction(async (tx) => {
        const exists = await tx.contadorGuia.findFirst({
          where: { id, storeId },
          select: { id: true, competenciaId: true, pagaEm: true },
        })
        if (!exists) throw new GuiaNaoEncontradaError()
        await travarCompetenciaNaoFechada(tx, storeId, exists.competenciaId)
        const upd = await tx.contadorGuia.updateMany({
          where: { id, storeId, pagaEm: null },
          data: {
            ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
            ...(data.valorCentavos !== undefined ? { valorCentavos: data.valorCentavos } : {}),
            ...(data.vencimento !== undefined ? { vencimento: data.vencimento } : {}),
            ...(data.origem !== undefined ? { origem: asOrigem(data.origem) } : {}),
            ...(data.obrigacaoId !== undefined ? { obrigacaoId: data.obrigacaoId } : {}),
            ...(data.pdfDocumentoId !== undefined ? { pdfDocumentoId: data.pdfDocumentoId } : {}),
            ...(data.comprovanteDocumentoId !== undefined
              ? { comprovanteDocumentoId: data.comprovanteDocumentoId }
              : {}),
          },
        })
        if (upd.count !== 1) await classificarFalhaGuia(tx, id, storeId)
        await tx.contadorEvento.create({ data: eventoData(evento) })
        const g = await tx.contadorGuia.findFirst({ where: { id, storeId }, select: GUIA_SELECT })
        if (!g) throw new GuiaNaoEncontradaError()
        return g
      })
      return mapGuia(updated)
    },

    async marcarGuiaPaga(id, storeId, pagaEm, comprovanteDocumentoId, evento) {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const exists = await tx.contadorGuia.findFirst({
          where: { id, storeId },
          select: { id: true, competenciaId: true },
        })
        if (!exists) throw new GuiaNaoEncontradaError()
        await travarCompetenciaNaoFechada(tx, storeId, exists.competenciaId)
        const upd = await tx.contadorGuia.updateMany({
          where: { id, storeId, pagaEm: null },
          data: { pagaEm, comprovanteDocumentoId },
        })
        if (upd.count !== 1) await classificarFalhaGuia(tx, id, storeId)
        await tx.contadorEvento.create({ data: eventoData(evento) })
        const g = await tx.contadorGuia.findFirst({ where: { id, storeId }, select: GUIA_SELECT })
        if (!g) throw new GuiaNaoEncontradaError()
        return mapGuia(g)
      })
    },

    async acharDocumentoDaLoja(id, storeId): Promise<DocumentoAgendaRef | null> {
      const db = await obter()
      const d = await db.contadorDocumento.findFirst({
        where: { id, storeId },
        select: { id: true, competenciaId: true, storeId: true, mime: true, excluidoEm: true },
      })
      return d
    },
  }
}
