/**
 * Contador HUB · Prisma `AgendaRepo` (GOAL 016).
 *
 * SERVER-ONLY. Escrita de linha + evento na mesma transação. Escopo sempre por
 * `storeId`. Não toca Financeiro, PDV, Operações ou Fiscal.
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
import { TransicaoConcorrenteError } from "@/lib/contador/status/matriz"
import {
  GuiaNaoEncontradaError,
  GuiaPagaError,
  ObrigacaoNaoEncontradaError,
  TemplateNaoEncontradoError,
} from "./erros"
import type { AgendaRepo } from "./service"
import type {
  DocumentoAgendaRef,
  GuiaRow,
  NovoEventoAgenda,
  ObrigacaoRow,
  TemplateRow,
} from "./tipos"
import type { StatusItem } from "@/lib/contador/status/matriz"

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

function eventoData(evento: NovoEventoAgenda): Prisma.ContadorEventoUncheckedCreateInput {
  return {
    storeId: evento.storeId,
    competenciaId: evento.competenciaId,
    tipo: evento.tipo,
    atorTipo: evento.atorTipo,
    atorId: evento.atorId,
    entidade: evento.entidade,
    entidadeId: evento.entidadeId,
    origem: evento.origem,
    metadata: evento.metadata as Prisma.InputJsonValue,
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

export function criarRepoAgenda(): AgendaRepo {
  return {
    async getOrCreateCompetencia(storeId, comp) {
      const { competencia } = await getOrCreateCompetencia(storeId, comp)
      return { id: competencia.id, status: competencia.status, ano: competencia.ano, mes: competencia.mes }
    },

    async acharCompetencia(storeId, comp) {
      await prismaEnsureConnected()
      const c = await prisma.contadorCompetencia.findUnique({
        where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
        select: { id: true, status: true, ano: true, mes: true },
      })
      return c
    },

    async acharCompetenciaPorId(id, storeId) {
      await prismaEnsureConnected()
      const c = await prisma.contadorCompetencia.findFirst({
        where: { id, storeId },
        select: { id: true, status: true, ano: true, mes: true },
      })
      return c
    },

    async listarTemplates(storeId) {
      await prismaEnsureConnected()
      const rows = await prisma.contadorObrigacaoTemplate.findMany({
        where: { storeId },
        select: TPL_SELECT,
        orderBy: [{ ativo: "desc" }, { titulo: "asc" }],
      })
      return rows.map(mapTpl)
    },

    async acharTemplate(id, storeId) {
      await prismaEnsureConnected()
      const t = await prisma.contadorObrigacaoTemplate.findFirst({
        where: { id, storeId },
        select: TPL_SELECT,
      })
      return t ? mapTpl(t) : null
    },

    async criarTemplate(row, evento) {
      await prismaEnsureConnected()
      const created = await prisma.$transaction(async (tx) => {
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
      await prismaEnsureConnected()
      const updated = await prisma.$transaction(async (tx) => {
        const exists = await tx.contadorObrigacaoTemplate.findFirst({ where: { id, storeId }, select: { id: true } })
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
      await prismaEnsureConnected()
      return prisma.contadorObrigacao.count({ where: { templateId, storeId } })
    },

    async excluirTemplate(id, storeId) {
      await prismaEnsureConnected()
      const r = await prisma.contadorObrigacaoTemplate.deleteMany({ where: { id, storeId } })
      if (r.count === 0) throw new TemplateNaoEncontradoError()
    },

    async listarObrigacoes(competenciaId, storeId) {
      await prismaEnsureConnected()
      const rows = await prisma.contadorObrigacao.findMany({
        where: { competenciaId, storeId },
        select: OBG_SELECT,
        orderBy: [{ vencimento: "asc" }, { titulo: "asc" }],
      })
      return rows.map(mapObg)
    },

    async acharObrigacao(id, storeId) {
      await prismaEnsureConnected()
      const o = await prisma.contadorObrigacao.findFirst({
        where: { id, storeId },
        select: OBG_SELECT,
      })
      return o ? mapObg(o) : null
    },

    async acharObrigacaoPorTemplate(templateId, competenciaId, storeId) {
      await prismaEnsureConnected()
      const o = await prisma.contadorObrigacao.findFirst({
        where: { templateId, competenciaId, storeId },
        select: OBG_SELECT,
      })
      return o ? mapObg(o) : null
    },

    async criarObrigacao(row, evento) {
      await prismaEnsureConnected()
      const created = await prisma.$transaction(async (tx) => {
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
      })
      return mapObg(created)
    },

    async atualizarObrigacao(id, storeId, data, evento) {
      await prismaEnsureConnected()
      const updated = await prisma.$transaction(async (tx) => {
        const exists = await tx.contadorObrigacao.findFirst({ where: { id, storeId }, select: { id: true } })
        if (!exists) throw new ObrigacaoNaoEncontradaError()
        const o = await tx.contadorObrigacao.update({
          where: { id },
          data: {
            ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
            ...(data.descricao !== undefined ? { descricao: data.descricao } : {}),
            ...(data.tipo !== undefined ? { tipo: asTipo(data.tipo) } : {}),
            ...(data.vencimento !== undefined ? { vencimento: data.vencimento } : {}),
          },
          select: OBG_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
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
      await prismaEnsureConnected()
      return prisma.$transaction(async (tx) => {
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
      await prismaEnsureConnected()
      const rows = await prisma.contadorGuia.findMany({
        where: { competenciaId, storeId },
        select: GUIA_SELECT,
        orderBy: [{ vencimento: "asc" }, { titulo: "asc" }],
      })
      return rows.map(mapGuia)
    },

    async acharGuia(id, storeId) {
      await prismaEnsureConnected()
      const g = await prisma.contadorGuia.findFirst({
        where: { id, storeId },
        select: GUIA_SELECT,
      })
      return g ? mapGuia(g) : null
    },

    async criarGuia(row, evento) {
      await prismaEnsureConnected()
      const created = await prisma.$transaction(async (tx) => {
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
      await prismaEnsureConnected()
      const updated = await prisma.$transaction(async (tx) => {
        const exists = await tx.contadorGuia.findFirst({
          where: { id, storeId, pagaEm: null },
          select: { id: true },
        })
        if (!exists) {
          const any = await tx.contadorGuia.findFirst({ where: { id, storeId }, select: { id: true, pagaEm: true } })
          if (!any) throw new GuiaNaoEncontradaError()
          throw new GuiaPagaError()
        }
        const g = await tx.contadorGuia.update({
          where: { id },
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
          select: GUIA_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return g
      })
      return mapGuia(updated)
    },

    async marcarGuiaPaga(id, storeId, pagaEm, comprovanteDocumentoId, evento) {
      await prismaEnsureConnected()
      return prisma.$transaction(async (tx) => {
        const upd = await tx.contadorGuia.updateMany({
          where: { id, storeId, pagaEm: null },
          data: { pagaEm, comprovanteDocumentoId },
        })
        if (upd.count === 0) {
          const any = await tx.contadorGuia.findFirst({ where: { id, storeId }, select: { id: true } })
          if (!any) throw new GuiaNaoEncontradaError()
          throw new GuiaPagaError()
        }
        await tx.contadorEvento.create({ data: eventoData(evento) })
        const g = await tx.contadorGuia.findFirst({ where: { id, storeId }, select: GUIA_SELECT })
        if (!g) throw new GuiaNaoEncontradaError()
        return mapGuia(g)
      })
    },

    async acharDocumentoDaLoja(id, storeId): Promise<DocumentoAgendaRef | null> {
      await prismaEnsureConnected()
      const d = await prisma.contadorDocumento.findFirst({
        where: { id, storeId },
        select: { id: true, competenciaId: true, storeId: true, mime: true, excluidoEm: true },
      })
      return d
    },
  }
}
