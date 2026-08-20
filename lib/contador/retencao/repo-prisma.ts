/**
 * Contador HUB · Retenção — adapters Prisma e storage (GOAL 019). SERVER-ONLY.
 *
 * Duas implementações, na mesma fronteira do resto do HUB:
 *  · `criarLeituraRetencaoPrisma()` — SELECTs escopados por `storeId`, sem um único
 *    `create`/`update`/`delete`. É o que o dry-run enxerga.
 *  · `criarEscritaRetencao()` — remoção do BLOB no storage + UM evento append-only.
 *    Nenhuma linha é apagada aqui, em nenhuma tabela.
 *
 * Corte de documento por idade: exige `createdAt < corte` **e** competência em mês
 * estritamente anterior ao mês do corte. É a tradução SQL de
 * `referenciaIdadeDocumento` (o máximo entre fim de competência e `createdAt`), com
 * arredondamento a favor da RETENÇÃO — na dúvida o item fica.
 */
import type { ContadorDocumentoCategoria, Prisma } from "@/generated/prisma"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { resolverStorageDocumentos } from "@/lib/contador/documentos/storage"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import type { CategoriaDocumentoRetencao } from "./politica"
import type {
  CandidatoRetencao,
  EventoDescarte,
  RetencaoEscritaPort,
  RetencaoLeituraPort,
} from "./tipos"

/** Ator técnico do job. ID técnico constante — nunca usuário, nome ou e-mail. */
export const ATOR_RETENCAO = "sistema:retencao" as const
const ATOR_TIPO_SISTEMA = "sistema" as const
const ORIGEM_RETENCAO = "job_retencao" as const

const CANDIDATO_SELECT = {
  id: true,
  storeId: true,
  competenciaId: true,
  storageRef: true,
  bytes: true,
  categoria: true,
} satisfies Prisma.ContadorDocumentoSelect

/**
 * Competência estritamente anterior ao mês de `corte`. Um documento cuja competência
 * é o próprio mês do corte NUNCA entra — o mês corrente do corte ainda está dentro da
 * janela pela leitura conservadora.
 */
function competenciaAnteriorAoCorte(corte: Date): Prisma.ContadorCompetenciaWhereInput {
  const ano = corte.getUTCFullYear()
  const mes = corte.getUTCMonth() + 1 // ContadorCompetencia.mes é 1-12
  return { OR: [{ ano: { lt: ano } }, { ano, mes: { lt: mes } }] }
}

function mapCandidatoDocumento(d: {
  id: string
  storeId: string
  competenciaId: string
  storageRef: string
  bytes: number
  categoria: ContadorDocumentoCategoria
}): CandidatoRetencao {
  return Object.freeze({
    id: d.id,
    storeId: d.storeId,
    competenciaId: d.competenciaId,
    storageRef: d.storageRef,
    bytes: d.bytes,
    categoria: d.categoria as CategoriaDocumentoRetencao,
  })
}

/** Porta de leitura sobre Prisma. Nenhum método escreve — por construção. */
export function criarLeituraRetencaoPrisma(): RetencaoLeituraPort {
  return {
    async documentosAlemDaRetencao({ storeId, categoria, corte }) {
      await prismaEnsureConnected()
      const linhas = await prisma.contadorDocumento.findMany({
        where: {
          storeId,
          categoria: categoria as ContadorDocumentoCategoria,
          // Só documentos VIVOS: o soft-deletado é do alvo 2, com outra janela.
          excluidoEm: null,
          createdAt: { lt: corte },
          competencia: competenciaAnteriorAoCorte(corte),
        },
        select: CANDIDATO_SELECT,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      return linhas.map(mapCandidatoDocumento)
    },

    async contarDocumentosProtegidos({ storeId, categoria, corte }) {
      await prismaEnsureConnected()
      const base: Prisma.ContadorDocumentoWhereInput = {
        storeId,
        categoria: categoria as ContadorDocumentoCategoria,
        excluidoEm: null,
      }
      // PURGE_DISABLED: todo documento vivo da categoria está protegido.
      if (corte === null) return prisma.contadorDocumento.count({ where: base })
      return prisma.contadorDocumento.count({
        where: {
          ...base,
          NOT: { AND: [{ createdAt: { lt: corte } }, { competencia: competenciaAnteriorAoCorte(corte) }] },
        },
      })
    },

    async blobsSoftDeletadosAlemDaRetencao({ storeId, corte }) {
      await prismaEnsureConnected()
      const linhas = await prisma.contadorDocumento.findMany({
        // Borda INCLUSIVA (`lte`): decisão aprovada é `excluidoEm + 90d <= agora`.
        where: { storeId, excluidoEm: { not: null, lte: corte } },
        select: CANDIDATO_SELECT,
        orderBy: [{ excluidoEm: "asc" }, { id: "asc" }],
      })
      return linhas.map(mapCandidatoDocumento)
    },

    async contarBlobsSoftDeletadosProtegidos({ storeId, corte }) {
      await prismaEnsureConnected()
      return prisma.contadorDocumento.count({
        where: { storeId, excluidoEm: { not: null, gt: corte } },
      })
    },

    async pacotesAlemDaRetencao({ storeId, corte }) {
      await prismaEnsureConnected()
      const linhas = await prisma.contadorPacote.findMany({
        // `ContadorPacote` não tem `storeId` próprio: o escopo vem da competência.
        where: { geradoEm: { lt: corte }, competencia: { storeId } },
        select: {
          id: true,
          competenciaId: true,
          storageRef: true,
          bytes: true,
          versao: true,
          competencia: { select: { storeId: true } },
        },
        orderBy: [{ geradoEm: "asc" }, { id: "asc" }],
      })
      return linhas.map((p) =>
        Object.freeze({
          id: p.id,
          storeId: p.competencia.storeId,
          competenciaId: p.competenciaId,
          storageRef: p.storageRef,
          bytes: p.bytes,
          versao: p.versao,
        }),
      )
    },

    async contarPacotesProtegidos({ storeId, corte }) {
      await prismaEnsureConnected()
      return prisma.contadorPacote.count({
        where: { geradoEm: { gte: corte }, competencia: { storeId } },
      })
    },
  }
}

/**
 * Porta de escrita. `removerBlob` é a ÚNICA operação destrutiva do GOAL 019, e ela
 * atinge o storage — nunca o banco. O evento é anexado por `create`, jamais por
 * `update`/`delete`.
 */
export function criarEscritaRetencao(
  storage: StorageDocumentosPort = resolverStorageDocumentos(),
): RetencaoEscritaPort {
  return {
    async blobExiste(storageRef) {
      return storage.verificarExistencia(storageRef)
    },

    async removerBlob(storageRef) {
      await storage.removerObjeto(storageRef)
    },

    async registrarEventoDescarte(evento: EventoDescarte) {
      await prismaEnsureConnected()
      await prisma.contadorEvento.create({
        data: {
          storeId: evento.storeId,
          competenciaId: evento.competenciaId,
          tipo: evento.tipo,
          atorTipo: ATOR_TIPO_SISTEMA,
          atorId: ATOR_RETENCAO,
          entidade: evento.entidade,
          entidadeId: evento.entidadeId,
          origem: ORIGEM_RETENCAO,
          // Metadata já saneada na origem: categoria, bytes, política e versão.
          // Nunca storageRef, nome de arquivo, motivo de exclusão ou URL.
          metadata: evento.metadata as Prisma.InputJsonValue,
        },
      })
    },
  }
}

/** Lojas com dados do Contador — escopo explícito para o job varrer. */
export async function listarLojasComDadosContador(): Promise<readonly string[]> {
  await prismaEnsureConnected()
  const linhas = await prisma.contadorCompetencia.findMany({
    select: { storeId: true },
    distinct: ["storeId"],
    orderBy: { storeId: "asc" },
  })
  return linhas.map((l) => l.storeId)
}
