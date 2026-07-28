/**
 * Contador HUB · implementação Prisma do `FechamentoRepo` (GOAL 012).
 *
 * SERVER-ONLY em produção (default = singleton `prisma`), mas o cliente é INJETÁVEL —
 * mesmo padrão de `status/repo-prisma.ts`. Os testes passam um fake com semântica real
 * de `$transaction` (commit/rollback) e exercitam ESTE código.
 *
 * Atomicidade do fechamento: competência + pacote + itens + evento num único
 * `$transaction`. A escrita da competência usa `updateMany` com o estado E a versão
 * esperados no `where` — se outra sessão fechou/reabriu no meio, o `count` é 0, a
 * transação aborta e nenhum pacote/evento sobra.
 */
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { getOrCreateCompetencia, type CompetenciaDbClient } from "@/lib/contador/db/competencia"
import type { Competencia } from "@/lib/contador/competencia"
import type { DocumentoParaSnapshot } from "./snapshot"
import {
  FechamentoConcorrenteError,
  type AplicarFechamentoArgs,
  type AplicarReaberturaArgs,
  type CompetenciaFechamentoRow,
  type FechamentoRepo,
  type NovoEventoFechamento,
  type PacoteItemRow,
  type PacoteRow,
} from "./service"

/* ───────────────────────────── porta mínima do Prisma ───────────────────────────── */

export interface FechamentoTxClient {
  contadorCompetencia: {
    findUnique(args: {
      where: { storeId_ano_mes: { storeId: string; ano: number; mes: number } }
      select?: Record<string, unknown>
    }): Promise<CompetenciaFechamentoRow | null>
    updateMany(args: {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }): Promise<{ count: number }>
    findFirst(args: {
      where: Record<string, unknown>
      select?: Record<string, unknown>
    }): Promise<CompetenciaFechamentoRow | null>
  }
  contadorDocumento: {
    findMany(args: {
      where: Record<string, unknown>
      select: Record<string, unknown>
      orderBy?: unknown
    }): Promise<DocumentoParaSnapshot[]>
  }
  contadorPacote: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findMany(args: {
      where: Record<string, unknown>
      orderBy?: unknown
    }): Promise<PacoteRow[]>
    findFirst(args: { where: Record<string, unknown> }): Promise<PacoteRow | null>
  }
  contadorPacoteItem: {
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>
    findMany(args: {
      where: Record<string, unknown>
      select: Record<string, unknown>
      orderBy?: unknown
    }): Promise<PacoteItemRow[]>
  }
  contadorComentario: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
  contadorEvento: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>
  }
  /**
   * GOAL 012A — usado SOMENTE para o lock de linha do dedupe (`SELECT … FOR UPDATE`).
   * Tagged template: cada `${}` vira placeholder do driver, nunca concatenação.
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

export interface FechamentoDbClient extends FechamentoTxClient {
  $transaction<T>(fn: (tx: FechamentoTxClient) => Promise<T>): Promise<T>
}

const COMPETENCIA_SELECT = {
  id: true,
  storeId: true,
  ano: true,
  mes: true,
  status: true,
  versao: true,
  snapshot: true,
  snapshotHash: true,
  fechadaEm: true,
  fechadaPorId: true,
  reabertaEm: true,
  updatedAt: true,
} as const

function eventoData(e: NovoEventoFechamento): Record<string, unknown> {
  return {
    storeId: e.storeId,
    competenciaId: e.competenciaId,
    tipo: e.tipo,
    atorTipo: e.atorTipo,
    atorId: e.atorId,
    entidade: e.entidade,
    entidadeId: e.entidadeId,
    origem: e.origem,
    metadata: e.metadata as Record<string, unknown>,
  }
}

/* ───────────────────────────── repositório ───────────────────────────── */

export function criarRepoFechamento(client?: FechamentoDbClient): FechamentoRepo {
  const obter = async (): Promise<FechamentoDbClient> => {
    if (client) return client
    await prismaEnsureConnected()
    return prisma as unknown as FechamentoDbClient
  }

  const lerCompetencia = async (
    db: FechamentoTxClient,
    storeId: string,
    comp: Competencia,
  ): Promise<CompetenciaFechamentoRow | null> =>
    db.contadorCompetencia.findUnique({
      where: { storeId_ano_mes: { storeId, ano: comp.ano, mes: comp.mes } },
      select: COMPETENCIA_SELECT as unknown as Record<string, unknown>,
    })

  return {
    async getOrCreateCompetencia(storeId, comp): Promise<CompetenciaFechamentoRow> {
      const db = await obter()
      // Reusa o serviço idempotente do GOAL 009 (não duplica criação nem evento).
      // O cliente injetado é REPASSADO: sem isso os testes cairiam no singleton real.
      await getOrCreateCompetencia(
        storeId,
        { ano: comp.ano, mes: comp.mes },
        client ? { client: client as unknown as CompetenciaDbClient } : {},
      )
      // …e relê com o select completo que o fechamento precisa.
      const row = await lerCompetencia(db, storeId, comp)
      if (!row) throw new FechamentoConcorrenteError()
      return row
    },

    async acharCompetencia(storeId, comp): Promise<CompetenciaFechamentoRow | null> {
      const db = await obter()
      return lerCompetencia(db, storeId, comp)
    },

    async listarDocumentosParaSnapshot(competenciaId, storeId): Promise<DocumentoParaSnapshot[]> {
      const db = await obter()
      return db.contadorDocumento.findMany({
        // Escopo duplo (competência + loja) e sem excluídos: o snapshot conta o
        // acervo VIGENTE no fechamento, não o histórico de versões apagadas.
        where: { competenciaId, storeId, excluidoEm: null },
        select: { categoria: true, status: true },
        orderBy: { id: "asc" },
      })
    },

    async aplicarFechamento(args: AplicarFechamentoArgs): Promise<CompetenciaFechamentoRow> {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const res = await tx.contadorCompetencia.updateMany({
          // Trava otimista dupla: estado permitido E versão esperada.
          where: {
            id: args.competenciaId,
            storeId: args.storeId,
            status: { in: args.statusEsperados },
            versao: args.versaoEsperada,
          },
          data: {
            status: "FECHADA",
            snapshot: args.snapshot as unknown as Record<string, unknown>,
            snapshotHash: args.snapshotHash,
            fechadaEm: args.fechadaEm,
            fechadaPorId: args.fechadaPorId,
          },
        })
        if (res.count !== 1) throw new FechamentoConcorrenteError()

        const pacote = await tx.contadorPacote.create({
          data: {
            competenciaId: args.competenciaId,
            versao: args.pacote.versao,
            manifestoHash: args.pacote.manifestoHash,
            storageRef: args.pacote.storageRef,
            bytes: args.pacote.bytes,
            geradoPorTipo: args.pacote.geradoPorTipo,
            geradoPorId: args.pacote.geradoPorId,
            geradoEm: args.pacote.geradoEm,
          },
        })

        if (args.itens.length > 0) {
          await tx.contadorPacoteItem.createMany({
            data: args.itens.map((i) => ({
              pacoteId: pacote.id,
              caminho: i.caminho,
              bytes: i.bytes,
              sha256: i.sha256,
              fonte: i.fonte,
            })),
          })
        }

        await tx.contadorEvento.create({ data: eventoData(args.evento) })

        const depois = await tx.contadorCompetencia.findFirst({
          where: { id: args.competenciaId, storeId: args.storeId },
          select: COMPETENCIA_SELECT as unknown as Record<string, unknown>,
        })
        if (!depois) throw new FechamentoConcorrenteError()
        return depois
      })
    },

    async aplicarReabertura(args: AplicarReaberturaArgs): Promise<CompetenciaFechamentoRow> {
      const db = await obter()
      return db.$transaction(async (tx) => {
        const res = await tx.contadorCompetencia.updateMany({
          where: {
            id: args.competenciaId,
            storeId: args.storeId,
            status: "FECHADA",
            versao: args.versaoEsperada,
          },
          data: {
            status: "ABERTA",
            versao: args.novaVersao,
            reabertaEm: args.reabertaEm,
            reabertaPorId: args.reabertaPorId,
            reabertaMotivo: args.reabertaMotivo,
          },
        })
        if (res.count !== 1) throw new FechamentoConcorrenteError()

        await tx.contadorComentario.create({
          data: {
            id: args.comentario.id,
            competenciaId: args.comentario.competenciaId,
            documentoId: args.comentario.documentoId,
            autorTipo: args.comentario.autorTipo,
            autorId: args.comentario.autorId,
            visibilidade: args.comentario.visibilidade,
            texto: args.comentario.texto,
          },
        })
        await tx.contadorEvento.create({ data: eventoData(args.evento) })

        const depois = await tx.contadorCompetencia.findFirst({
          where: { id: args.competenciaId, storeId: args.storeId },
          select: COMPETENCIA_SELECT as unknown as Record<string, unknown>,
        })
        if (!depois) throw new FechamentoConcorrenteError()
        return depois
      })
    },

    async listarPacotes(competenciaId): Promise<PacoteRow[]> {
      const db = await obter()
      return db.contadorPacote.findMany({
        where: { competenciaId },
        orderBy: { versao: "asc" },
      })
    },

    async acharPacote(competenciaId, versao): Promise<PacoteRow | null> {
      const db = await obter()
      return db.contadorPacote.findFirst({ where: { competenciaId, versao } })
    },

    async listarItensPacote(pacoteId): Promise<PacoteItemRow[]> {
      const db = await obter()
      return db.contadorPacoteItem.findMany({
        where: { pacoteId },
        select: { caminho: true, bytes: true, sha256: true, fonte: true },
        orderBy: { caminho: "asc" },
      })
    },

    async registrarEventoUnico(evento, dedupe): Promise<{ criado: boolean }> {
      const db = await obter()
      return db.$transaction(async (tx) => {
        // GOAL 012A — DEDUPE FORTE.
        //
        // "Consultar e depois criar" não basta: em READ COMMITTED, dois POSTs
        // simultâneos leem "não existe" ao mesmo tempo e ambos criam. Sem poder
        // adicionar índice único (schema fora do escopo), a serialização vem de um
        // LOCK DE LINHA na competência: a segunda transação bloqueia no `FOR UPDATE`
        // até a primeira commitar, e só então enxerga o evento já criado.
        //
        // O lock é escopado por (id, storeId) — competência de outra loja nunca é
        // travada — e os valores viajam como parâmetros do driver (tagged template),
        // jamais concatenados na string SQL.
        await tx.$queryRaw`
          SELECT id FROM contador_competencias
          WHERE id = ${dedupe.competenciaId} AND "storeId" = ${evento.storeId}
          FOR UPDATE
        `

        const existente = await tx.contadorEvento.findFirst({
          where: {
            competenciaId: dedupe.competenciaId,
            tipo: dedupe.tipo,
            AND: [
              { metadata: { path: ["versao"], equals: dedupe.versao } },
              { metadata: { path: ["diffHash"], equals: dedupe.diffHash } },
            ],
          },
        })
        if (existente) return { criado: false }
        await tx.contadorEvento.create({ data: eventoData(evento) })
        return { criado: true }
      })
    },

    async registrarEvento(evento): Promise<void> {
      const db = await obter()
      await db.contadorEvento.create({ data: eventoData(evento) })
    },
  }
}
