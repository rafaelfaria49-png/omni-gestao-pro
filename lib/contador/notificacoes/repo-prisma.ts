/**
 * Contador HUB · Prisma dos alertas (GOAL 017).
 *
 * Dedupe forte copia o padrão 012A: `SELECT … FOR UPDATE` na competência
 * (id + storeId) dentro de `$transaction`. Sem índice único novo (schema fora).
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import type { Competencia } from "@/lib/contador/competencia"
import type { DedupeAlerta, NotificacoesRepo, NotificacoesRepoLeitura } from "./repo"
import type {
  CompetenciaAlerta,
  DocumentoAlerta,
  EventoAlertaRow,
  GuiaAlerta,
  NovoEventoAlerta,
  PacoteAlerta,
} from "./tipos"

type TxClient = {
  contadorCompetencia: {
    findUnique(args: { where: Record<string, unknown>; select: Record<string, unknown> }): Promise<CompetenciaAlerta | null>
  }
  contadorDocumento: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, unknown> }): Promise<DocumentoAlerta[]>
  }
  contadorGuia: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, unknown> }): Promise<GuiaAlerta[]>
  }
  contadorPacote: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, unknown> }): Promise<PacoteAlerta[]>
  }
  contadorEvento: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, unknown>; orderBy: Record<string, unknown> }): Promise<EventoAlertaRow[]>
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

type DbClient = TxClient & {
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>
}

const COMP_SELECT = {
  id: true,
  storeId: true,
  ano: true,
  mes: true,
  status: true,
  versao: true,
  snapshot: true,
} as const

function eventoData(e: NovoEventoAlerta): Record<string, unknown> {
  return {
    storeId: e.storeId,
    competenciaId: e.competenciaId,
    tipo: e.tipo,
    atorTipo: e.atorTipo,
    atorId: e.atorId,
    entidade: e.entidade,
    entidadeId: e.entidadeId,
    origem: e.origem,
    metadata: e.metadata,
  }
}

export function criarRepoNotificacoes(client?: DbClient): NotificacoesRepo {
  const obter = async (): Promise<DbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as DbClient
  }

  const leitura: NotificacoesRepoLeitura = {
    async acharCompetencia(storeId, comp: Competencia): Promise<CompetenciaAlerta | null> {
      const db = await obter()
      return db.contadorCompetencia.findUnique({
        where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
        select: COMP_SELECT as unknown as Record<string, unknown>,
      })
    },

    async listarDocumentos(competenciaId, storeId): Promise<DocumentoAlerta[]> {
      const db = await obter()
      return db.contadorDocumento.findMany({
        where: { competenciaId, storeId, excluidoEm: null },
        select: { id: true, status: true, titulo: true, vencimento: true },
      })
    },

    async listarGuias(competenciaId, storeId): Promise<GuiaAlerta[]> {
      const db = await obter()
      return db.contadorGuia.findMany({
        where: { competenciaId, storeId },
        select: { id: true, titulo: true, vencimento: true, pagaEm: true },
      })
    },

    async listarPacotes(competenciaId): Promise<PacoteAlerta[]> {
      const db = await obter()
      return db.contadorPacote.findMany({
        where: { competenciaId },
        select: { versao: true },
      })
    },

    async listarEventos(competenciaId, storeId, tipos): Promise<EventoAlertaRow[]> {
      const db = await obter()
      return db.contadorEvento.findMany({
        where: { competenciaId, storeId, tipo: { in: [...tipos] } },
        select: { id: true, tipo: true, entidadeId: true, metadata: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    },
  }

  return {
    ...leitura,
    async registrarEventoUnico(evento: NovoEventoAlerta, dedupe: DedupeAlerta): Promise<{ criado: boolean }> {
      const db = await obter()
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM contador_competencias
          WHERE id = ${dedupe.competenciaId} AND "storeId" = ${evento.storeId}
          FOR UPDATE
        `

        const existente = await tx.contadorEvento.findFirst({
          where: {
            competenciaId: dedupe.competenciaId,
            storeId: evento.storeId,
            tipo: dedupe.tipo,
            AND: [
              { metadata: { path: ["regra"], equals: dedupe.regra } },
              { metadata: { path: ["alvo"], equals: dedupe.alvo } },
              { metadata: { path: ["janela"], equals: dedupe.janela } },
            ],
          },
        })
        if (existente) return { criado: false }
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return { criado: true }
      })
    },
  }
}
