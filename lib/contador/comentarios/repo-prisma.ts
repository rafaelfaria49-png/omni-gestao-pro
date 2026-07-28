/**
 * Contador HUB · implementação Prisma do `ComentariosRepo` (GOAL 011).
 *
 * Cliente INJETÁVEL (default = singleton `prisma`), como em `db/competencia.ts` —
 * os testes exercitam este mesmo código com um fake transacional.
 *
 * Isolamento por loja: `ContadorComentario` não tem coluna `storeId` (o escopo vem
 * da competência). Toda consulta filtra por `competencia: { storeId }` ALÉM de
 * `competenciaId` — defesa em profundidade contra um `competenciaId` de outra loja.
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getOrCreateCompetencia } from "@/lib/contador/db/competencia"
import type { Competencia } from "@/lib/contador/competencia"
import type {
  ComentarioRow,
  ComentariosRepo,
  CompetenciaRefComentario,
  NovoComentario,
  NovoEventoComentario,
} from "./service"

/* ───────────────────────────── porta mínima do Prisma ───────────────────────────── */

export interface ComentariosTxClient {
  contadorComentario: {
    create(args: {
      data: {
        id: string
        competenciaId: string
        documentoId: string | null
        autorTipo: string
        autorId: string
        visibilidade: string
        texto: string
      }
    }): Promise<ComentarioRow>
    findMany(args: {
      where: Record<string, unknown>
      orderBy: { createdAt: "asc" | "desc" }
      take: number
    }): Promise<ComentarioRow[]>
  }
  contadorDocumento: {
    findFirst(args: {
      where: { id: string; competenciaId: string; storeId: string; excluidoEm: null }
      select: { id: true }
    }): Promise<{ id: string } | null>
  }
  contadorCompetencia: {
    findUnique(args: {
      where: { storeId_ano_mes: { storeId: string; ano: number; mes: number } }
      select: { id: true; ano: true; mes: true; status: true }
    }): Promise<CompetenciaRefComentario | null>
  }
  contadorEvento: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
}

export interface ComentariosDbClient extends ComentariosTxClient {
  $transaction<T>(fn: (tx: ComentariosTxClient) => Promise<T>): Promise<T>
}

function eventoData(evento: NovoEventoComentario): Record<string, unknown> {
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

function comentarioData(c: NovoComentario) {
  return {
    id: c.id,
    competenciaId: c.competenciaId,
    documentoId: c.documentoId,
    autorTipo: c.autorTipo,
    autorId: c.autorId,
    visibilidade: c.visibilidade,
    texto: c.texto,
  }
}

/* ───────────────────────────── repositório ───────────────────────────── */

export function criarRepoComentarios(client?: ComentariosDbClient): ComentariosRepo {
  const obter = async (): Promise<ComentariosDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as ComentariosDbClient
  }

  return {
    async getOrCreateCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaRefComentario> {
      // Reusa o serviço idempotente do GOAL 009 — não duplica criação/evento.
      const { competencia } = await getOrCreateCompetencia(storeId, { ano: comp.ano, mes: comp.mes })
      return {
        id: competencia.id,
        ano: competencia.ano,
        mes: competencia.mes,
        status: competencia.status,
      }
    },

    async acharCompetencia(storeId, comp): Promise<CompetenciaRefComentario | null> {
      const db = await obter()
      return db.contadorCompetencia.findUnique({
        where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
        select: { id: true, ano: true, mes: true, status: true },
      })
    },

    async documentoPertence({ documentoId, competenciaId, storeId }): Promise<boolean> {
      const db = await obter()
      const d = await db.contadorDocumento.findFirst({
        where: { id: documentoId, competenciaId, storeId, excluidoEm: null },
        select: { id: true },
      })
      return !!d
    },

    async criarComentarioComEvento({ comentario, evento }): Promise<ComentarioRow> {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const row = await tx.contadorComentario.create({ data: comentarioData(comentario) })
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return row
      })
    },

    async listarComentarios({ competenciaId, storeId, documentoId, visibilidade, limite }) {
      const db = await obter()
      return db.contadorComentario.findMany({
        where: {
          competenciaId,
          // Escopo redundante e proposital: a competência precisa ser DESTA loja.
          competencia: { storeId },
          ...(documentoId ? { documentoId } : {}),
          ...(visibilidade ? { visibilidade } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limite,
      })
    },
  }
}
