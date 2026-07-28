/**
 * Contador HUB · implementação Prisma do `TimelineRepo` (GOAL 011).
 *
 * SOMENTE LEITURA — nenhum método escreve. Cliente injetável (default = `prisma`).
 *
 * Isolamento por loja em toda consulta:
 *  - `ContadorEvento` tem `storeId` próprio → filtra por `competenciaId` **e** `storeId`;
 *  - `ContadorComentario` não tem `storeId` → filtra por `competencia: { storeId }`
 *    além de `competenciaId` (defesa em profundidade).
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import type { Competencia } from "@/lib/contador/competencia"
import type { ComentarioTimeline, EventoTimeline } from "./projecao"
import type { CompetenciaRefTimeline, TimelineRepo } from "./service"

export interface TimelineDbClient {
  contadorCompetencia: {
    findUnique(args: {
      where: { storeId_ano_mes: { storeId: string; ano: number; mes: number } }
      select: { id: true; ano: true; mes: true; status: true }
    }): Promise<CompetenciaRefTimeline | null>
  }
  contadorEvento: {
    findMany(args: {
      where: Record<string, unknown>
      select: Record<string, unknown>
      orderBy: { createdAt: "desc" }
      take: number
    }): Promise<EventoTimeline[]>
  }
  contadorComentario: {
    findMany(args: {
      where: Record<string, unknown>
      select: Record<string, unknown>
      orderBy: { createdAt: "desc" }
      take: number
    }): Promise<ComentarioTimeline[]>
  }
}

/** Seleção explícita: `ip`/`userAgent` do evento NÃO são lidos (não vão à UI). */
const EVENTO_SELECT = {
  id: true,
  tipo: true,
  atorTipo: true,
  atorId: true,
  entidade: true,
  entidadeId: true,
  origem: true,
  metadata: true,
  createdAt: true,
} as const

const COMENTARIO_SELECT = {
  id: true,
  documentoId: true,
  autorTipo: true,
  autorId: true,
  visibilidade: true,
  texto: true,
  createdAt: true,
} as const

export function criarRepoTimeline(client?: TimelineDbClient): TimelineRepo {
  const obter = async (): Promise<TimelineDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as TimelineDbClient
  }

  return {
    async acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaRefTimeline | null> {
      const db = await obter()
      return db.contadorCompetencia.findUnique({
        where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
        select: { id: true, ano: true, mes: true, status: true },
      })
    },

    async listarEventos({ competenciaId, storeId, limite }): Promise<EventoTimeline[]> {
      const db = await obter()
      return db.contadorEvento.findMany({
        where: { competenciaId, storeId },
        select: EVENTO_SELECT as unknown as Record<string, unknown>,
        orderBy: { createdAt: "desc" },
        take: limite,
      })
    },

    async listarComentarios({ competenciaId, storeId, visibilidade, limite }): Promise<ComentarioTimeline[]> {
      const db = await obter()
      return db.contadorComentario.findMany({
        where: {
          competenciaId,
          competencia: { storeId },
          ...(visibilidade ? { visibilidade } : {}),
        },
        select: COMENTARIO_SELECT as unknown as Record<string, unknown>,
        orderBy: { createdAt: "desc" },
        take: limite,
      })
    },
  }
}
