/**
 * Portas Prisma do cancelamento fiscal. Nenhuma escrita em Financeiro/Caixa.
 * XML autorizado/assinado e snapshots NÃO são atualizados.
 */
import { prisma } from "@/lib/prisma"
import {
  FiscalJobStatus,
  FiscalStatusVenda,
  StatusNotaFiscal,
  TipoEventoFiscal,
} from "@/generated/prisma"
import type { Prisma } from "@/generated/prisma"
import { stubHomologacaoProvider } from "@/lib/fiscal/provider/stub-homologacao"
import { resolveFiscalProvider } from "@/lib/fiscal/provider/resolver"
import { recordFiscalEmissionLog } from "@/lib/fiscal/emission/emission-log"
import {
  cancelarNfceAutorizada,
  type CancelamentoFiscalInput,
  type CancelamentoFiscalOutcome,
  type CancelamentoFiscalPorts,
  type EventoFiscalCancelamento,
  type NotaFiscalCancelamento,
} from "./cancelamento-service"

type PrismaLike = {
  notaFiscal: {
    findFirst: (args: unknown) => Promise<NotaFiscalCancelamento | null>
    update: (args: unknown) => Promise<{ xmlAutorizado: string | null; xmlAssinado: string | null; status: string }>
  }
  venda: {
    findFirst: (args: unknown) => Promise<{ id: string; storeId: string; fiscalStatus: string | null } | null>
    update: (args: unknown) => Promise<unknown>
  }
  eventoFiscal: {
    findUnique: (args: unknown) => Promise<EventoFiscalCancelamento | null>
    upsert: (args: unknown) => Promise<EventoFiscalCancelamento>
  }
  fiscalEmissaoJob: {
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  configuracaoFiscalLoja: {
    findUnique: (args: unknown) => Promise<{ provider: string; ambiente: string; modeloFiscal: string; fiscalEnabled: boolean; cnpj: string; razaoSocial: string; uf: string; providerConfig: unknown; providerTokenRef: string | null; cscId: string; cscTokenRef: string | null } | null>
  }
}

function mapNota(row: {
  id: string
  storeId: string
  vendaId: string
  status: string
  chaveAcesso: string | null
  protocolo: string | null
  dataAutorizacao: Date | null
  xmlAutorizado: string | null
  xmlAssinado: string | null
  snapshotEmitente: unknown
  ambiente: string
  modelo: string
}): NotaFiscalCancelamento {
  const snap = row.snapshotEmitente && typeof row.snapshotEmitente === "object"
    ? (row.snapshotEmitente as { cnpj?: string })
    : null
  return { ...row, cnpjEmitente: snap?.cnpj ?? null }
}

export function createPrismaCancelamentoPorts(input: {
  provider?: CancelamentoFiscalPorts["provider"]
  client?: PrismaLike
}): CancelamentoFiscalPorts {
  const db = input.client ?? (prisma as unknown as PrismaLike)
  return {
    provider: input.provider ?? stubHomologacaoProvider,
    async loadNota({ storeId, notaFiscalId }) {
      const row = await db.notaFiscal.findFirst({
        where: { id: notaFiscalId, storeId },
      })
      return row ? mapNota(row as never) : null
    },
    async loadVenda({ storeId, vendaId }) {
      return db.venda.findFirst({
        where: { id: vendaId, storeId },
        select: { id: true, storeId: true, fiscalStatus: true },
      })
    },
    async findEvento(identidade) {
      return db.eventoFiscal.findUnique({
        where: {
          notaFiscalId_tipo_sequencia: {
            notaFiscalId: identidade.notaFiscalId,
            tipo: identidade.tipo as TipoEventoFiscal,
            sequencia: identidade.sequencia,
          },
        },
      })
    },
    async upsertEvento(data) {
      return db.eventoFiscal.upsert({
        where: {
          notaFiscalId_tipo_sequencia: {
            notaFiscalId: data.notaFiscalId,
            tipo: data.tipo as TipoEventoFiscal,
            sequencia: data.sequencia,
          },
        },
        create: {
          storeId: data.storeId,
          notaFiscalId: data.notaFiscalId,
          tipo: data.tipo as TipoEventoFiscal,
          sequencia: data.sequencia,
          status: data.status as never,
          justificativa: data.justificativa,
          protocolo: data.protocolo ?? null,
          cStat: data.cStat ?? null,
          xMotivo: data.xMotivo ?? null,
          xmlEvento: data.xmlEvento ?? null,
          xmlRetorno: data.xmlRetorno ?? null,
          operador: data.operador ?? null,
        },
        update: {
          status: data.status as never,
          justificativa: data.justificativa,
          protocolo: data.protocolo ?? undefined,
          cStat: data.cStat ?? undefined,
          xMotivo: data.xMotivo ?? undefined,
          xmlEvento: data.xmlEvento ?? undefined,
          xmlRetorno: data.xmlRetorno ?? undefined,
          operador: data.operador ?? undefined,
        },
      })
    },
    async markNotaCancelada({ notaFiscalId, cStat, xMotivo, xmlAutorizadoAtual, xmlAssinadoAtual }) {
      const updated = await db.notaFiscal.update({
        where: { id: notaFiscalId },
        data: {
          status: StatusNotaFiscal.CANCELADA,
          cStat,
          xMotivo,
          // XML autorizado/assinado e snapshots propositalmente omitidos.
        },
        select: { xmlAutorizado: true, xmlAssinado: true, status: true },
      })
      return {
        xmlAutorizado: updated.xmlAutorizado ?? xmlAutorizadoAtual,
        xmlAssinado: updated.xmlAssinado ?? xmlAssinadoAtual,
        status: updated.status,
      }
    },
    async setVendaFiscalStatus({ vendaId, para }) {
      await db.venda.update({
        where: { id: vendaId },
        data: { fiscalStatus: para as FiscalStatusVenda },
      })
    },
    async abortarSolicitacao({ notaFiscalId, vendaId }) {
      await db.fiscalEmissaoJob.updateMany({
        where: {
          notaFiscalId,
          status: { in: [FiscalJobStatus.PENDENTE, FiscalJobStatus.AGUARDANDO_RETRY] },
        },
        data: { status: FiscalJobStatus.CANCELADO },
      })
      await db.venda.update({
        where: { id: vendaId },
        data: { fiscalStatus: FiscalStatusVenda.NAO_FISCAL },
      })
    },
    async log(entry) {
      await recordFiscalEmissionLog({
        storeId: entry.storeId,
        vendaId: entry.vendaId,
        notaFiscalId: entry.notaFiscalId,
        nivel: entry.nivel as never,
        acao: entry.acao,
        cStat: entry.cStat,
        xMotivo: entry.xMotivo,
        mensagem: entry.mensagem,
        detalhe: {
          ...(entry.detalhe ?? {}),
          eventoFiscalId: entry.eventoFiscalId ?? null,
          financeWriteCount: 0,
        },
        operador: entry.operador,
      })
    },
  }
}

export async function cancelarNfceAutorizadaPersistido(
  input: CancelamentoFiscalInput & { provider?: CancelamentoFiscalPorts["provider"] },
  client: PrismaLike = prisma as unknown as PrismaLike,
): Promise<CancelamentoFiscalOutcome> {
  let provider = input.provider
  if (!provider) {
    const config = await client.configuracaoFiscalLoja.findUnique({
      where: { storeId: input.storeId },
    })
    const resolved = resolveFiscalProvider(
      config
        ? {
            provider: config.provider,
            ambiente: config.ambiente,
            modeloFiscal: config.modeloFiscal,
            fiscalEnabled: config.fiscalEnabled,
            cnpj: config.cnpj,
            razaoSocial: config.razaoSocial,
            uf: config.uf,
            providerConfig: (config.providerConfig as Prisma.JsonObject | null) ?? null,
            providerTokenRef: config.providerTokenRef,
            cscId: config.cscId,
            cscTokenRef: config.cscTokenRef,
          }
        : null,
    )
    provider = resolved.ok ? resolved.provider : stubHomologacaoProvider
  }
  return cancelarNfceAutorizada(input, createPrismaCancelamentoPorts({ provider, client }))
}
