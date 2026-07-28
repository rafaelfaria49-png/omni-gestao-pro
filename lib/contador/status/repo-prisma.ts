/**
 * Contador HUB · implementação Prisma do `StatusRepo` (GOAL 011).
 *
 * SERVER-ONLY em produção (default = singleton `prisma`), mas o cliente é
 * INJETÁVEL — mesmo padrão de `lib/contador/db/competencia.ts`. Os testes passam um
 * cliente fake com semântica real de `$transaction` (commit/rollback) e exercitam
 * ESTE código, não uma reimplementação.
 *
 * Atomicidade: a transição inteira (status + comentário do motivo + evento) roda
 * dentro de um único `$transaction`. A escrita de status usa `updateMany` com o
 * estado esperado no `where` — se o documento saiu daquele estado (corrida), o
 * `count` é 0, a transação aborta e NENHUM evento é criado.
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { DocumentoNaoEncontradoError } from "@/lib/contador/documentos/service"
import { TransicaoConcorrenteError } from "./matriz"
import type {
  AplicarTransicaoArgs,
  DocumentoStatusRow,
  NovoEventoStatus,
  StatusRepo,
} from "./service"

/* ───────────────────────────── porta mínima do Prisma ───────────────────────────── */

/** Linha crua do documento com a competência dona embutida. */
export type DocumentoComCompetencia = {
  id: string
  competenciaId: string
  storeId: string
  titulo: string
  categoria: string
  status: string
  vencimento: Date | null
  excluidoEm: Date | null
  updatedAt: Date
  competencia: { status: string; ano: number; mes: number }
}

export interface StatusTxClient {
  contadorDocumento: {
    findFirst(args: {
      where: { id: string; storeId: string }
      select: Record<string, unknown>
    }): Promise<DocumentoComCompetencia | null>
    updateMany(args: {
      where: { id: string; storeId: string; status: string; excluidoEm: null }
      data: { status: string }
    }): Promise<{ count: number }>
  }
  contadorComentario: {
    create(args: {
      data: {
        id: string
        competenciaId: string
        documentoId: string
        autorTipo: string
        autorId: string
        visibilidade: string
        texto: string
      }
    }): Promise<{ id: string }>
  }
  contadorEvento: {
    create(args: {
      data: {
        storeId: string
        competenciaId: string
        tipo: string
        atorTipo: string
        atorId: string
        entidade: string
        entidadeId: string
        origem: string
        metadata: Record<string, unknown>
      }
    }): Promise<{ id: string }>
  }
}

export interface StatusDbClient extends StatusTxClient {
  $transaction<T>(fn: (tx: StatusTxClient) => Promise<T>): Promise<T>
}

/** Select único reaproveitado nas duas leituras (antes e depois da escrita). */
export const DOC_STATUS_SELECT = {
  id: true,
  competenciaId: true,
  storeId: true,
  titulo: true,
  categoria: true,
  status: true,
  vencimento: true,
  excluidoEm: true,
  updatedAt: true,
  competencia: { select: { status: true, ano: true, mes: true } },
} as const

export function mapDocumentoStatus(d: DocumentoComCompetencia): DocumentoStatusRow {
  return {
    id: d.id,
    competenciaId: d.competenciaId,
    storeId: d.storeId,
    titulo: d.titulo,
    categoria: d.categoria,
    status: d.status,
    vencimento: d.vencimento,
    excluidoEm: d.excluidoEm,
    updatedAt: d.updatedAt,
    competenciaStatus: d.competencia.status,
    competenciaAno: d.competencia.ano,
    competenciaMes: d.competencia.mes,
  }
}

function eventoData(evento: NovoEventoStatus) {
  return {
    storeId: evento.storeId,
    competenciaId: evento.competenciaId,
    tipo: evento.tipo,
    atorTipo: evento.atorTipo,
    atorId: evento.atorId,
    entidade: evento.entidade,
    entidadeId: evento.entidadeId,
    origem: evento.origem,
    metadata: evento.metadata as Record<string, unknown>,
  }
}

/* ───────────────────────────── repositório ───────────────────────────── */

export function criarRepoStatus(client?: StatusDbClient): StatusRepo {
  const obter = async (): Promise<StatusDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as StatusDbClient
  }

  return {
    async acharDocumentoParaTransicao(id, storeId): Promise<DocumentoStatusRow | null> {
      const db = await obter()
      // Escopo por loja NO WHERE: documento de outra loja nunca é lido.
      const d = await db.contadorDocumento.findFirst({
        where: { id, storeId },
        select: DOC_STATUS_SELECT as unknown as Record<string, unknown>,
      })
      return d ? mapDocumentoStatus(d) : null
    },

    async aplicarTransicao(args: AplicarTransicaoArgs): Promise<DocumentoStatusRow> {
      const db = await obter()
      const atualizado = await db.$transaction(async (tx) => {
        const res = await tx.contadorDocumento.updateMany({
          // `status: args.de` = trava otimista. Perdeu a corrida → count 0 → aborta.
          where: { id: args.documentoId, storeId: args.storeId, status: args.de, excluidoEm: null },
          data: { status: args.para },
        })
        if (res.count !== 1) throw new TransicaoConcorrenteError()

        if (args.comentario) {
          await tx.contadorComentario.create({ data: { ...args.comentario } })
        }
        await tx.contadorEvento.create({ data: eventoData(args.evento) })

        const depois = await tx.contadorDocumento.findFirst({
          where: { id: args.documentoId, storeId: args.storeId },
          select: DOC_STATUS_SELECT as unknown as Record<string, unknown>,
        })
        if (!depois) throw new DocumentoNaoEncontradoError()
        return depois
      })
      return mapDocumentoStatus(atualizado)
    },
  }
}
