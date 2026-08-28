/**
 * Adapter Prisma das portas de inutilização (GOAL 019). Sem schema novo.
 */

import { prisma } from "@/lib/prisma"
import { asInutilizacaoPayload, INUTILIZACAO_MARK, type InutilizacaoJobPayload } from "./mark"
import type {
  InutilizacaoConfigRow,
  InutilizacaoEventoRow,
  InutilizacaoJobRow,
  InutilizacaoNotaRow,
  InutilizacaoPorts,
} from "./ports"

type UnknownRecord = Record<string, unknown>

type InutilizacaoPrismaClient = {
  $transaction: <T>(fn: (tx: InutilizacaoPrismaClient) => Promise<T>) => Promise<T>
  fiscalEmissaoJob: {
    findUnique: (args: unknown) => Promise<unknown | null>
    findFirst: (args: unknown) => Promise<unknown | null>
    upsert: (args: unknown) => Promise<unknown>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
    create: (args: unknown) => Promise<unknown>
  }
  notaFiscalItem: {
    findMany: (args: unknown) => Promise<unknown[]>
    createMany: (args: unknown) => Promise<unknown>
  }
  eventoFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    create: (args: unknown) => Promise<unknown>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
  venda: {
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  configuracaoFiscalLoja: {
    findUnique: (args: unknown) => Promise<unknown | null>
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function toJob(value: unknown): InutilizacaoJobRow | null {
  const row = record(value)
  if (!row.id) return null
  const payload = asInutilizacaoPayload(row.payload) ?? {
    version: 1 as const,
    operation: "INUTILIZACAO" as const,
    mark: INUTILIZACAO_MARK.A_INUTILIZAR,
    storeId: String(row.storeId ?? ""),
    modelo: "NFCE" as const,
    ambiente: "HOMOLOGACAO" as const,
    serie: 0,
    numeroInicial: 0,
    numeroFinal: 0,
    justificativa: "",
    motivo: "admin" as const,
    notaFiscalId: row.notaFiscalId == null ? null : String(row.notaFiscalId),
    vendaId: String(row.vendaId ?? ""),
    protocolo: null,
    cStat: null,
    xMotivo: null,
    inutilizadoEm: null,
    requestedAt: "",
    requestedBy: "",
  }
  return {
    id: String(row.id),
    storeId: String(row.storeId ?? ""),
    vendaId: String(row.vendaId ?? ""),
    notaFiscalId: row.notaFiscalId == null ? null : String(row.notaFiscalId),
    tipo: "INUTILIZACAO",
    status: String(row.status ?? "PENDENTE"),
    dedupeKey: row.dedupeKey == null ? null : String(row.dedupeKey),
    payload,
    tentativas: Number(row.tentativas ?? 0),
  }
}

function toNota(value: unknown): InutilizacaoNotaRow | null {
  const row = record(value)
  if (!row.id) return null
  return {
    id: String(row.id),
    storeId: String(row.storeId ?? ""),
    vendaId: String(row.vendaId ?? ""),
    status: String(row.status ?? ""),
    vigente: row.vigente === true,
    modelo: String(row.modelo ?? "NFCE"),
    ambiente: String(row.ambiente ?? "HOMOLOGACAO"),
    serie: typeof row.serie === "number" ? row.serie : null,
    numero: typeof row.numero === "number" ? row.numero : null,
    localKey: row.localKey == null ? null : String(row.localKey),
    snapshotEmitente: row.snapshotEmitente,
    snapshotDestinatario: row.snapshotDestinatario,
    snapshotPagamento: row.snapshotPagamento,
    valorTotal: Number(row.valorTotal ?? 0),
    valorDesconto: Number(row.valorDesconto ?? 0),
    valorFrete: Number(row.valorFrete ?? 0),
    valorTotalTributos: Number(row.valorTotalTributos ?? 0),
  }
}

const NOTA_SELECT = {
  id: true,
  storeId: true,
  vendaId: true,
  status: true,
  vigente: true,
  modelo: true,
  ambiente: true,
  serie: true,
  numero: true,
  localKey: true,
  snapshotEmitente: true,
  snapshotDestinatario: true,
  snapshotPagamento: true,
  valorTotal: true,
  valorDesconto: true,
  valorFrete: true,
  valorTotalTributos: true,
} as const

export function createPrismaInutilizacaoPorts(
  client: InutilizacaoPrismaClient = prisma as unknown as InutilizacaoPrismaClient,
): InutilizacaoPorts {
  return {
    async findJobByDedupe({ storeId, dedupeKey }) {
      const row = await client.fiscalEmissaoJob.findUnique({
        where: { storeId_dedupeKey: { storeId, dedupeKey } },
      })
      return toJob(row)
    },
    async upsertJob({ storeId, vendaId, notaFiscalId, dedupeKey, payload, now }) {
      const existing = await client.fiscalEmissaoJob.findUnique({
        where: { storeId_dedupeKey: { storeId, dedupeKey } },
      })
      const existingJob = toJob(existing)
      if (existingJob) {
        return { job: existingJob, created: false }
      }
      const created = await client.fiscalEmissaoJob.upsert({
        where: { storeId_dedupeKey: { storeId, dedupeKey } },
        create: {
          storeId,
          vendaId,
          notaFiscalId,
          tipo: "INUTILIZACAO",
          status: "PENDENTE",
          tentativas: 0,
          maxTentativas: 5,
          prioridade: 5,
          proximaTentativaEm: now,
          dedupeKey,
          payload,
        },
        update: {},
      })
      const job = toJob(created)
      if (!job) throw new Error("Falha ao persistir job INUTILIZACAO.")
      return { job, created: !existingJob }
    },
    async updateJobPayload({ jobId, storeId, expectedMark, payload, status }) {
      const updated = await client.fiscalEmissaoJob.updateMany({
        where: {
          id: jobId,
          storeId,
          tipo: "INUTILIZACAO",
          payload: { path: ["mark"], equals: expectedMark },
        },
        data: {
          payload,
          ...(status ? { status, concluidoEm: status === "CONCLUIDO" ? new Date() : undefined } : {}),
        },
      })
      return updated.count === 1
    },
    async findNota({ storeId, notaFiscalId }) {
      return toNota(
        await client.notaFiscal.findFirst({
          where: { id: notaFiscalId, storeId },
          select: NOTA_SELECT,
        }),
      )
    },
    async findVigente({ storeId, vendaId }) {
      return toNota(
        await client.notaFiscal.findFirst({
          where: { storeId, vendaId, vigente: true },
          select: NOTA_SELECT,
        }),
      )
    },
    async findEvento({ notaFiscalId }) {
      const row = record(
        await client.eventoFiscal.findFirst({
          where: { notaFiscalId, tipo: "INUTILIZACAO", sequencia: 1 },
        }),
      )
      if (!row.id) return null
      return {
        id: String(row.id),
        notaFiscalId,
        tipo: "INUTILIZACAO",
        sequencia: 1,
        status: String(row.status ?? "PENDENTE"),
        protocolo: row.protocolo == null ? null : String(row.protocolo),
        cStat: row.cStat == null ? null : String(row.cStat),
      } satisfies InutilizacaoEventoRow
    },
    async upsertEvento(input) {
      const existing = record(
        await client.eventoFiscal.findFirst({
          where: { notaFiscalId: input.notaFiscalId, tipo: "INUTILIZACAO", sequencia: 1 },
        }),
      )
      if (existing.id) {
        if (existing.status === "AUTORIZADO" && existing.protocolo) {
          return { id: String(existing.id), created: false, reused: true }
        }
        await client.eventoFiscal.updateMany({
          where: { id: String(existing.id) },
          data: {
            status: input.status,
            protocolo: input.protocolo,
            cStat: input.cStat,
            xMotivo: input.xMotivo,
            justificativa: input.justificativa,
            operador: input.operador,
          },
        })
        return { id: String(existing.id), created: false, reused: false }
      }
      const created = record(
        await client.eventoFiscal.create({
          data: {
            storeId: input.storeId,
            notaFiscalId: input.notaFiscalId,
            tipo: "INUTILIZACAO",
            sequencia: 1,
            status: input.status,
            protocolo: input.protocolo,
            cStat: input.cStat,
            xMotivo: input.xMotivo,
            justificativa: input.justificativa,
            operador: input.operador,
          },
        }),
      )
      return { id: String(created.id), created: true, reused: false }
    },
    async createLog(input) {
      await client.fiscalLog.create({
        data: {
          storeId: input.storeId,
          vendaId: input.vendaId,
          notaFiscalId: input.notaFiscalId,
          jobId: input.jobId,
          eventoFiscalId: input.eventoFiscalId,
          nivel: input.nivel,
          acao: input.acao,
          mensagem: input.mensagem,
          cStat: input.cStat ?? null,
          xMotivo: input.xMotivo ?? null,
          operador: input.operador ?? null,
          detalhe: input.detalhe ?? null,
        },
      })
    },
    async demoteVigente({ storeId, vendaId, notaFiscalId }) {
      const updated = await client.notaFiscal.updateMany({
        where: { id: notaFiscalId, storeId, vendaId, vigente: true, status: "REJEITADA" },
        data: { vigente: false },
      })
      return updated.count === 1
    },
    async swapReissueVigente({ storeId, vendaId, origem, localKey }) {
      return client.$transaction(async (tx) => {
        const demoted = await tx.notaFiscal.updateMany({
          where: { id: origem.id, storeId, vendaId, vigente: true, status: "REJEITADA" },
          data: { vigente: false },
        })
        if (demoted.count !== 1) return null
        const ports = createPrismaInutilizacaoPorts(tx)
        return ports.createReissueNota({ storeId, vendaId, origem, localKey })
      })
    },
    async restoreRejectedVigente({ storeId, vendaId, rejectedNotaId, newNotaId }) {
      return client.$transaction(async (tx) => {
        await tx.notaFiscal.updateMany({
          where: { id: newNotaId, storeId, vendaId, vigente: true },
          data: { vigente: false },
        })
        const restored = await tx.notaFiscal.updateMany({
          where: { id: rejectedNotaId, storeId, vendaId, status: "REJEITADA", vigente: false },
          data: { vigente: true },
        })
        return restored.count === 1
      })
    },
    async clearSuccessorNumero({ storeId, notaFiscalId, expectedNumero }) {
      const updated = await client.notaFiscal.updateMany({
        where: { id: notaFiscalId, storeId, numero: expectedNumero, vigente: true },
        data: { numero: null, serieFiscalId: null },
      })
      return updated.count === 1
    },
    async createReissueNota({ storeId, vendaId, origem, localKey }) {
      const existing = toNota(
        await client.notaFiscal.findFirst({
          where: { storeId, localKey },
          select: NOTA_SELECT,
        }),
      )
      if (existing) return { id: existing.id, localKey: existing.localKey ?? localKey }
      const created = record(
        await client.notaFiscal.create({
          data: {
            storeId,
            vendaId,
            modelo: "NFCE",
            ambiente: "HOMOLOGACAO",
            status: "RASCUNHO",
            vigente: true,
            localKey,
            snapshotEmitente: origem.snapshotEmitente ?? undefined,
            snapshotDestinatario: origem.snapshotDestinatario ?? undefined,
            snapshotPagamento: origem.snapshotPagamento ?? undefined,
            valorTotal: origem.valorTotal,
            valorDesconto: origem.valorDesconto,
            valorFrete: origem.valorFrete,
            valorTotalTributos: origem.valorTotalTributos,
          },
        }),
      )
      const itens = await client.notaFiscalItem.findMany({
        where: { notaFiscalId: origem.id },
      })
      if (itens.length > 0) {
        await client.notaFiscalItem.createMany({
          data: itens.map((raw) => {
            const item = record(raw)
            return {
              notaFiscalId: String(created.id),
              itemVendaId: item.itemVendaId ?? null,
              produtoId: item.produtoId ?? null,
              numeroItem: item.numeroItem ?? 1,
              codigoProduto: item.codigoProduto ?? "",
              descricao: item.descricao ?? "",
              gtin: item.gtin ?? null,
              ncm: item.ncm ?? "",
              cest: item.cest ?? null,
              cfop: item.cfop ?? "",
              cst: item.cst ?? null,
              csosn: item.csosn ?? null,
              origemMercadoria: item.origemMercadoria ?? 0,
              unidadeComercial: item.unidadeComercial ?? "UN",
              quantidade: item.quantidade ?? 1,
              valorUnitario: item.valorUnitario ?? 0,
              valorBruto: item.valorBruto ?? 0,
              valorDesconto: item.valorDesconto ?? 0,
              valorTotal: item.valorTotal ?? 0,
              baseCalculoIcms: item.baseCalculoIcms ?? 0,
              aliquotaIcms: item.aliquotaIcms ?? 0,
              valorIcms: item.valorIcms ?? 0,
              valorTributos: item.valorTributos ?? 0,
            }
          }),
        })
      }
      return { id: String(created.id), localKey }
    },
    async setVendaFiscalStatus({ storeId, vendaId, from, to }) {
      const updated = await client.venda.updateMany({
        where: { id: vendaId, storeId, fiscalStatus: { in: from } },
        data: { fiscalStatus: to },
      })
      return updated.count === 1
    },
    async findConfig({ storeId }) {
      const row = record(
        await client.configuracaoFiscalLoja.findUnique({
          where: { storeId },
          select: { cnpj: true, uf: true, ambiente: true, modeloFiscal: true },
        }),
      )
      if (!row.cnpj && !row.uf) return null
      return {
        cnpj: String(row.cnpj ?? ""),
        uf: String(row.uf ?? ""),
        ambiente: String(row.ambiente ?? "HOMOLOGACAO"),
        modeloFiscal: String(row.modeloFiscal ?? "NFCE"),
      } satisfies InutilizacaoConfigRow
    },
    async upsertEmissionJob({ storeId, vendaId, notaFiscalId, dedupeKey, operador, now }) {
      const existing = record(
        await client.fiscalEmissaoJob.findUnique({
          where: { storeId_dedupeKey: { storeId, dedupeKey } },
        }),
      )
      const job = record(
        await client.fiscalEmissaoJob.upsert({
          where: { storeId_dedupeKey: { storeId, dedupeKey } },
          create: {
            storeId,
            vendaId,
            notaFiscalId,
            tipo: "EMISSAO",
            status: "PENDENTE",
            tentativas: 0,
            maxTentativas: 5,
            prioridade: 0,
            proximaTentativaEm: now,
            dedupeKey,
            payload: {
              version: 2,
              operation: "EMISSAO",
              requestedAt: now.toISOString(),
              requestedBy: operador,
              reissue: true,
              transmission: { external: false },
            },
          },
          update: { notaFiscalId },
        }),
      )
      return { id: String(job.id), created: !existing.id }
    },
  }
}

export type { InutilizacaoJobPayload }
