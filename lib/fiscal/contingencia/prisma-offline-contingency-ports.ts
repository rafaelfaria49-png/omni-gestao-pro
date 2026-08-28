/** Adapter Prisma da entrada manual em contingência offline (GOAL 020). */
import { prisma } from "@/lib/prisma"
import type {
  FiscalDocumentLocator,
  FinalizedFiscalDocument,
} from "../emission/uncertain-state.types"
import {
  buildOfflineContingencyDedupeKey,
  fiscalBytesSha256,
  type OfflineContingencyPersistence,
} from "./offline-contingency"

type Row = Record<string, unknown>

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function bytesHash(xml: string | null, payload: unknown): string | null {
  const persisted = stringOrNull(record(record(payload).document).bytesSha256)
  return persisted ?? (xml ? fiscalBytesSha256(new TextEncoder().encode(xml)) : null)
}

export type OfflineContingencyPrismaClient = {
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  fiscalEmissaoJob: {
    findFirst: (args: unknown) => Promise<unknown | null>
    upsert: (args: unknown) => Promise<unknown>
  }
  fiscalLog: { create: (args: unknown) => Promise<unknown> }
}

function documentPayload(document: FinalizedFiscalDocument, bytesSha256: string) {
  return {
    version: 1,
    operation: "CONTINGENCIA_TRANSMISSAO",
    document: {
      notaFiscalId: document.notaFiscalId,
      chaveAcesso: document.chaveAcesso,
      serie: document.serie,
      numero: document.numero,
      modelo: document.modelo,
      ambiente: document.ambiente,
      bytesSha256,
    },
  }
}

export function createPrismaOfflineContingencyPersistence(
  client: OfflineContingencyPrismaClient = prisma as unknown as OfflineContingencyPrismaClient,
): OfflineContingencyPersistence {
  return {
    async loadExisting(locator) {
      const [noteRaw, jobRaw] = await Promise.all([
        client.notaFiscal.findFirst({
          where: {
            id: locator.notaFiscalId,
            storeId: locator.storeId,
            vendaId: locator.vendaId,
            modelo: "NFCE",
            ambiente: "HOMOLOGACAO",
          },
          select: {
            status: true,
            xmlAssinado: true,
            dataContingencia: true,
            justContingencia: true,
          },
        }),
        client.fiscalEmissaoJob.findFirst({
          where: {
            storeId: locator.storeId,
            vendaId: locator.vendaId,
            notaFiscalId: locator.notaFiscalId,
            tipo: "CONTINGENCIA_TRANSMISSAO",
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { payload: true },
        }),
      ])
      const note = record(noteRaw)
      if (!note.status) return null
      return {
        status: String(note.status),
        xmlAssinado: stringOrNull(note.xmlAssinado),
        bytesSha256: bytesHash(stringOrNull(note.xmlAssinado), record(jobRaw).payload),
        dataContingencia:
          note.dataContingencia instanceof Date || typeof note.dataContingencia === "string"
            ? note.dataContingencia
            : null,
        justContingencia: stringOrNull(note.justContingencia),
      }
    },

    async setMetadata({ locator, dhCont, xJust }) {
      const updated = await client.notaFiscal.updateMany({
        where: {
          id: locator.notaFiscalId,
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
          status: { in: ["RASCUNHO", "VALIDANDO", "ASSINADA"] },
          xmlAssinado: null,
        },
        data: {
          tipoEmissao: "CONTINGENCIA_OFFLINE",
          dataContingencia: new Date(dhCont),
          justContingencia: xJust,
        },
      })
      return updated.count === 1
    },

    async persist({ locator, document, dhCont, xJust, deadlineAt, requestedBy, now }) {
      const hash = fiscalBytesSha256(new TextEncoder().encode(document.xmlAssinado))
      const existing = record(await client.notaFiscal.findFirst({
        where: { id: locator.notaFiscalId, storeId: locator.storeId, vendaId: locator.vendaId },
        select: { status: true, xmlAssinado: true },
      }))
      if (String(existing.status ?? "") === "CONTINGENCIA") {
        if (String(existing.xmlAssinado ?? "") === document.xmlAssinado) return { idempotent: true }
        throw new Error("Nota contingenciada já possui XML assinado divergente.")
      }
      const updated = await client.notaFiscal.updateMany({
        where: {
          id: locator.notaFiscalId,
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
          status: { in: ["RASCUNHO", "VALIDANDO", "ASSINADA"] },
          xmlAssinado: null,
        },
        data: {
          tipoEmissao: "CONTINGENCIA_OFFLINE",
          dataContingencia: new Date(dhCont),
          justContingencia: xJust,
          serie: document.serie,
          numero: document.numero,
          chaveAcesso: document.chaveAcesso,
          xmlAssinado: document.xmlAssinado,
          digestValue: document.digestValue ?? null,
          qrCodeData: document.qrCodeData ?? null,
          urlConsulta: document.urlConsulta ?? null,
          status: "CONTINGENCIA",
          ultimoErro: null,
        },
      })
      if (updated.count !== 1) throw new Error("Persistência da contingência recusada por concorrência ou escopo.")
      await client.fiscalLog.create({
        data: {
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          notaFiscalId: locator.notaFiscalId,
          nivel: "INFO",
          acao: "fiscal.contingencia.persisted",
          mensagem: "XML assinado de contingência persistido antes da transmissão posterior.",
          operador: requestedBy,
          detalhe: { bytesSha256: hash, dhCont, deadlineAt: deadlineAt.toISOString(), persistedAt: now.toISOString() },
        },
      })
      return { idempotent: false }
    },

    async enqueue({ locator, document, dhCont, xJust, deadlineAt, now }) {
      const dedupeKey = buildOfflineContingencyDedupeKey(locator.notaFiscalId)
      const existing = record(await client.fiscalEmissaoJob.findFirst({
        where: { storeId: locator.storeId, dedupeKey },
        select: { id: true },
      }))
      const bytesSha256 = fiscalBytesSha256(new TextEncoder().encode(document.xmlAssinado))
      const payload = {
        ...documentPayload(document, bytesSha256),
        requestedAt: now.toISOString(),
        dhCont,
        xJust,
        deadlineAt: deadlineAt.toISOString(),
        warningAt: new Date(deadlineAt.getTime() - 2 * 60 * 60 * 1_000).toISOString(),
        transmission: { external: false, exactBytes: true },
      }
      const job = record(await client.fiscalEmissaoJob.upsert({
        where: { storeId_dedupeKey: { storeId: locator.storeId, dedupeKey } },
        create: {
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          notaFiscalId: locator.notaFiscalId,
          tipo: "CONTINGENCIA_TRANSMISSAO",
          status: "PENDENTE",
          tentativas: 0,
          maxTentativas: 10,
          prioridade: 100,
          proximaTentativaEm: now,
          dedupeKey,
          payload,
        },
        update: { notaFiscalId: locator.notaFiscalId },
        select: { id: true },
      }))
      return { jobId: String(job.id ?? ""), created: !existing.id }
    },

    async audit({ locator, action, level, message, detail }) {
      await client.fiscalLog.create({
        data: {
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          notaFiscalId: locator.notaFiscalId,
          nivel: level,
          acao: action,
          mensagem: message,
          operador: "fiscal-goal-020",
          detalhe: detail ?? {},
        },
      })
    },
  }
}
