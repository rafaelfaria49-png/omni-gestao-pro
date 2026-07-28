/**
 * Contador HUB · Documentos — implementação Prisma do `DocumentosRepo` (GOAL 010).
 *
 * SERVER-ONLY. Encapsula todo o acesso a `ContadorDocumento`/`ContadorCompetencia`/
 * `ContadorEvento`. Escrita de documento + evento sempre em transação. Reusa o
 * serviço idempotente `getOrCreateCompetencia` (GOAL 009). Nenhuma outra tabela é tocada.
 */
import type { ContadorDocumentoCategoria, ContadorItemStatus, Prisma } from "@/generated/prisma"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getOrCreateCompetencia } from "@/lib/contador/db/competencia"
import {
  CATEGORIA_PRISMA,
  type CompetenciaRef,
  type DocumentoRow,
  type DocumentosRepo,
  type FiltrosListagem,
  type NovoEvento,
} from "./service"

const DOC_SELECT = {
  id: true,
  competenciaId: true,
  storeId: true,
  categoria: true,
  titulo: true,
  nomeArquivo: true,
  mime: true,
  bytes: true,
  sha256: true,
  storageRef: true,
  status: true,
  vencimento: true,
  enviadoPorTipo: true,
  enviadoPorId: true,
  versaoDeId: true,
  excluidoEm: true,
  excluidoPorId: true,
  excluidoMotivo: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContadorDocumentoSelect

type DocSelecionado = Prisma.ContadorDocumentoGetPayload<{ select: typeof DOC_SELECT }>

function mapRow(d: DocSelecionado): DocumentoRow {
  return {
    id: d.id,
    competenciaId: d.competenciaId,
    storeId: d.storeId,
    categoria: d.categoria,
    titulo: d.titulo,
    nomeArquivo: d.nomeArquivo,
    mime: d.mime,
    bytes: d.bytes,
    sha256: d.sha256,
    storageRef: d.storageRef,
    status: d.status,
    vencimento: d.vencimento,
    enviadoPorTipo: d.enviadoPorTipo,
    enviadoPorId: d.enviadoPorId,
    versaoDeId: d.versaoDeId,
    excluidoEm: d.excluidoEm,
    excluidoPorId: d.excluidoPorId,
    excluidoMotivo: d.excluidoMotivo,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

function eventoData(evento: NovoEvento): Prisma.ContadorEventoUncheckedCreateInput {
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

export function criarRepoPrisma(): DocumentosRepo {
  return {
    async getOrCreateCompetencia(storeId, comp): Promise<CompetenciaRef> {
      const { competencia } = await getOrCreateCompetencia(storeId, comp)
      return { id: competencia.id, status: competencia.status, ano: competencia.ano, mes: competencia.mes }
    },

    async acharCompetencia(storeId, comp): Promise<CompetenciaRef | null> {
      await prismaEnsureConnected()
      const c = await prisma.contadorCompetencia.findUnique({
        where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
        select: { id: true, status: true, ano: true, mes: true },
      })
      return c ? { id: c.id, status: c.status, ano: c.ano, mes: c.mes } : null
    },

    // GOAL 012: o congelamento da exclusão precisa do status da competência DONA do
    // documento, e ali só existe `competenciaId` (sem ano/mês). Leitura pura.
    async acharCompetenciaPorId(competenciaId, storeId): Promise<CompetenciaRef | null> {
      await prismaEnsureConnected()
      const c = await prisma.contadorCompetencia.findFirst({
        where: { id: competenciaId, storeId },
        select: { id: true, status: true, ano: true, mes: true },
      })
      return c ? { id: c.id, status: c.status, ano: c.ano, mes: c.mes } : null
    },

    async acharDocumentoPorId(id): Promise<DocumentoRow | null> {
      await prismaEnsureConnected()
      const d = await prisma.contadorDocumento.findUnique({ where: { id }, select: DOC_SELECT })
      return d ? mapRow(d) : null
    },

    async acharDocumentoDaLoja(id, storeId): Promise<DocumentoRow | null> {
      await prismaEnsureConnected()
      const d = await prisma.contadorDocumento.findFirst({
        where: { id, storeId },
        select: DOC_SELECT,
      })
      return d ? mapRow(d) : null
    },

    async listarDocumentos(args): Promise<DocumentoRow[]> {
      await prismaEnsureConnected()
      const where = montarWhereListagem(args)
      const rows = await prisma.contadorDocumento.findMany({
        where,
        select: DOC_SELECT,
        orderBy: [{ createdAt: "desc" }],
      })
      return rows.map(mapRow)
    },

    async criarDocumentoComEvento({ documento, evento }): Promise<DocumentoRow> {
      await prismaEnsureConnected()
      const criado = await prisma.$transaction(async (tx) => {
        const doc = await tx.contadorDocumento.create({
          data: {
            id: documento.id,
            competenciaId: documento.competenciaId,
            storeId: documento.storeId,
            categoria: documento.categoria as ContadorDocumentoCategoria,
            titulo: documento.titulo,
            nomeArquivo: documento.nomeArquivo,
            mime: documento.mime,
            bytes: documento.bytes,
            sha256: documento.sha256,
            storageRef: documento.storageRef,
            status: documento.status as ContadorItemStatus,
            vencimento: documento.vencimento,
            enviadoPorTipo: documento.enviadoPorTipo,
            enviadoPorId: documento.enviadoPorId,
            versaoDeId: documento.versaoDeId,
          },
          select: DOC_SELECT,
        })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return doc
      })
      return mapRow(criado)
    },

    async softDeleteComEvento({ id, storeId, excluidoPorId, excluidoMotivo, evento }): Promise<DocumentoRow> {
      await prismaEnsureConnected()
      const atualizado = await prisma.$transaction(async (tx) => {
        // Só marca se ainda não estava excluído (idempotência defensiva).
        const res = await tx.contadorDocumento.updateMany({
          where: { id, storeId, excluidoEm: null },
          data: { excluidoEm: new Date(), excluidoPorId, excluidoMotivo },
        })
        if (res.count === 1) {
          await tx.contadorEvento.create({ data: eventoData(evento) })
        }
        return tx.contadorDocumento.findFirstOrThrow({ where: { id, storeId }, select: DOC_SELECT })
      })
      return mapRow(atualizado)
    },

    async registrarEvento(evento): Promise<void> {
      await prismaEnsureConnected()
      await prisma.contadorEvento.create({ data: eventoData(evento) })
    },
  }
}

function montarWhereListagem(args: {
  competenciaId: string
  storeId: string
  incluirExcluidos: boolean
  filtros: FiltrosListagem
}): Prisma.ContadorDocumentoWhereInput {
  const { competenciaId, storeId, incluirExcluidos, filtros } = args
  const where: Prisma.ContadorDocumentoWhereInput = { competenciaId, storeId }
  if (!incluirExcluidos) where.excluidoEm = null
  if (filtros.categoria) where.categoria = CATEGORIA_PRISMA[filtros.categoria] as ContadorDocumentoCategoria
  if (filtros.status) where.status = filtros.status as ContadorItemStatus
  if (filtros.titulo) where.titulo = { contains: filtros.titulo, mode: "insensitive" }
  if (filtros.vencimentoAte) where.vencimento = { lte: filtros.vencimentoAte }
  return where
}
