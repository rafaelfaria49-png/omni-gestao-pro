import { createHash } from "node:crypto"

import { prisma } from "@/lib/prisma"

import { resolveXmlStorageMirror } from "../storage/mirror-vault"
import type { XmlStorageMirror } from "../storage/types"
import {
  AuthorizedDivergenceError,
  type FiscalDocumentLocator,
  type PersistedFiscalDocument,
  type UncertainStatePersistence,
} from "./uncertain-state.types"

type UnknownRecord = Record<string, unknown>

type UncertainPrismaClient = {
  $transaction: <T>(fn: (tx: UncertainPrismaClient) => Promise<T>) => Promise<T>
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  venda: {
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  fiscalEmissaoJob: {
    findFirst: (args: unknown) => Promise<unknown | null>
    update: (args: unknown) => Promise<unknown>
    updateMany: (args: unknown) => Promise<{ count: number }>
    upsert: (args: unknown) => Promise<unknown>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** SHA-256 hex dos bytes UTF-8 — mesma convenção do `bytesSha256` da ADR-0017. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function documentMetadata(document: {
  notaFiscalId: string
  chaveAcesso: string
  serie: number
  numero: number
  modelo: string
  ambiente: string
}, bytesSha256: string): UnknownRecord {
  return {
    notaFiscalId: document.notaFiscalId,
    chaveAcesso: document.chaveAcesso,
    serie: document.serie,
    numero: document.numero,
    modelo: document.modelo,
    ambiente: document.ambiente,
    bytesSha256,
  }
}

async function findEmissionJob(
  client: UncertainPrismaClient,
  locator: FiscalDocumentLocator,
): Promise<UnknownRecord> {
  return record(await client.fiscalEmissaoJob.findFirst({
    where: {
      storeId: locator.storeId,
      vendaId: locator.vendaId,
      notaFiscalId: locator.notaFiscalId,
      tipo: "EMISSAO",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, payload: true },
  }))
}

async function loadDocument(
  client: UncertainPrismaClient,
  locator: FiscalDocumentLocator,
): Promise<PersistedFiscalDocument | null> {
  const [rawNote, job] = await Promise.all([
    client.notaFiscal.findFirst({
      where: {
        id: locator.notaFiscalId,
        storeId: locator.storeId,
        vendaId: locator.vendaId,
      },
      select: {
        id: true,
        storeId: true,
        vendaId: true,
        modelo: true,
        ambiente: true,
        status: true,
        serie: true,
        numero: true,
        chaveAcesso: true,
        xmlAssinado: true,
        xmlAutorizado: true,
        protocolo: true,
        cStat: true,
        xMotivo: true,
        digestValue: true,
        qrCodeData: true,
        urlConsulta: true,
      },
    }),
    findEmissionJob(client, locator),
  ])
  const note = record(rawNote)
  if (!note.id) return null
  const payload = record(job.payload)
  const metadata = record(payload.document)
  return {
    notaFiscalId: String(note.id),
    storeId: String(note.storeId),
    vendaId: String(note.vendaId),
    modelo: String(note.modelo) as "NFCE",
    ambiente: String(note.ambiente) as "HOMOLOGACAO",
    status: String(note.status) as PersistedFiscalDocument["status"],
    serie: Number(note.serie),
    numero: Number(note.numero),
    chaveAcesso: String(note.chaveAcesso ?? ""),
    xmlAssinado: stringOrNull(note.xmlAssinado),
    xmlBytesSha256: stringOrNull(metadata.bytesSha256),
    xmlAutorizado: stringOrNull(note.xmlAutorizado),
    protocolo: stringOrNull(note.protocolo),
    cStat: stringOrNull(note.cStat),
    xMotivo: stringOrNull(note.xMotivo),
    digestValue: stringOrNull(note.digestValue),
    qrCodeData: stringOrNull(note.qrCodeData),
    urlConsulta: stringOrNull(note.urlConsulta),
  }
}

function mergePayload(
  payloadValue: unknown,
  updates: UnknownRecord,
): UnknownRecord {
  return { ...record(payloadValue), ...updates }
}

/**
 * Campo opcional do resultado AUTHORIZED: ausente/vazio não apaga o persistido;
 * igual converge; diferente falha fechado. Nunca recalcula QR.
 */
function incomingOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || value.length === 0) return undefined
  return value
}

function assertQrMetadataImmutable(
  existing: UnknownRecord,
  result: { digestValue?: string | null; qrCodeData?: string | null; urlConsulta?: string | null },
): void {
  const campos = [
    ["digestValue", existing.digestValue, result.digestValue],
    ["qrCodeData", existing.qrCodeData, result.qrCodeData],
    ["urlConsulta", existing.urlConsulta, result.urlConsulta],
  ] as const
  for (const [campo, persisted, incoming] of campos) {
    const prev = stringOrNull(persisted)
    const next = incomingOptionalString(incoming)
    if (next === undefined || prev === null || prev === next) continue
    throw new AuthorizedDivergenceError(
      "metadados_qr_imutavel_diverge",
      `Tentativa de substituir ${campo} persistido por valor divergente; operação bloqueada.`,
    )
  }
}

function preserveOrFillQrField(existing: unknown, incoming: unknown): string | null {
  const next = incomingOptionalString(incoming)
  if (next === undefined) return stringOrNull(existing)
  return next
}

export function createPrismaUncertainStatePersistence(
  client: UncertainPrismaClient = prisma as unknown as UncertainPrismaClient,
  /**
   * Espelho privado opcional (ADR-0018 §2.4). Injetável só para teste; em
   * produção resolve para o no-op inativo enquanto não houver bucket fiscal
   * provisionado — este GOAL não provisiona nenhum recurso externo.
   */
  resolveMirror: () => XmlStorageMirror = resolveXmlStorageMirror,
): UncertainStatePersistence {
  return {
    load: (locator) => loadDocument(client, locator),

    persistBeforeTransmission: async ({ document, bytesSha256, now }) => {
      await client.$transaction(async (tx) => {
        const updated = await tx.notaFiscal.updateMany({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
            modelo: "NFCE",
            ambiente: "HOMOLOGACAO",
            status: { in: ["RASCUNHO", "VALIDANDO", "ASSINADA"] },
          },
          data: {
            serie: document.serie,
            numero: document.numero,
            chaveAcesso: document.chaveAcesso,
            xmlAssinado: document.xmlAssinado,
            digestValue: document.digestValue ?? null,
            qrCodeData: document.qrCodeData ?? null,
            urlConsulta: document.urlConsulta ?? null,
            status: "TRANSMITINDO",
            ultimoErro: null,
          },
        })
        if (updated.count !== 1) {
          throw new Error(
            "Persistência pré-transmissão recusada: estado ou escopo da nota mudou.",
          )
        }
        const job = await findEmissionJob(tx, document)
        if (!job.id) {
          throw new Error("Job EMISSAO não encontrado para registrar os bytes exatos.")
        }
        await tx.fiscalEmissaoJob.update({
          where: { id: String(job.id) },
          data: {
            notaFiscalId: document.notaFiscalId,
            payload: mergePayload(job.payload, {
              document: documentMetadata(document, bytesSha256),
            }),
          },
        })
        await tx.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            jobId: String(job.id),
            nivel: "INFO",
            acao: "fiscal.emission.persisted_before_transmission",
            mensagem: "Identidade e bytes assinados persistidos antes do provider.",
            operador: "fiscal-goal-012",
            detalhe: {
              bytesSha256,
              serie: document.serie,
              numero: document.numero,
              ambiente: document.ambiente,
              modelo: document.modelo,
              persistedAt: now.toISOString(),
              digestValuePersistido: Boolean(document.digestValue),
              qrCodeDataPersistido: Boolean(document.qrCodeData),
              urlConsultaPersistido: Boolean(document.urlConsulta),
            },
          },
        })
      })
      const persisted = await loadDocument(client, document)
      if (!persisted) throw new Error("Nota desapareceu após persistência pré-transmissão.")
      return persisted
    },

    recordUncertainAndEnsureConsultation: async ({
      document,
      code,
      message,
      now,
      recibo,
    }) =>
      client.$transaction(async (tx) => {
        const emissionJob = await findEmissionJob(tx, document)
        if (!emissionJob.id) {
          throw new Error("Job EMISSAO ausente ao registrar resultado incerto.")
        }
        const dedupeKey = `fiscal:consulta:v1:nota:${document.notaFiscalId}`
        const existing = record(await tx.fiscalEmissaoJob.findFirst({
          where: { storeId: document.storeId, dedupeKey },
          select: { id: true, status: true, payload: true },
        }))
        const reactivatingTerminalQuery = [
          "CONCLUIDO",
          "FALHA",
          "CANCELADO",
        ].includes(String(existing.status ?? ""))
        /**
         * `recibo` (GOAL-016D-B · D12.1): `nRec` do lote quando o desfecho foi `PROCESSING`.
         * Vai para o payload EXISTENTE — nenhuma coluna, nenhum schema, nenhuma migration.
         */
        const reciboLote = stringOrNull(recibo)
        const queryPayload = {
          version: 2,
          operation: "CONSULTA",
          requestedAt: now.toISOString(),
          document: documentMetadata(document, document.xmlBytesSha256 ?? ""),
          ...(reciboLote ? { recibo: reciboLote } : {}),
        }
        const queryJob = record(await tx.fiscalEmissaoJob.upsert({
          where: {
            storeId_dedupeKey: { storeId: document.storeId, dedupeKey },
          },
          create: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            tipo: "CONSULTA",
            status: "PENDENTE",
            tentativas: 0,
            maxTentativas: 10,
            prioridade: 100,
            proximaTentativaEm: now,
            dedupeKey,
            payload: queryPayload,
          },
          update: reactivatingTerminalQuery
            ? {
                notaFiscalId: document.notaFiscalId,
                status: "PENDENTE",
                tentativas: 0,
                proximaTentativaEm: now,
                concluidoEm: null,
                ultimoErro: null,
                lockOwner: null,
                lockedAt: null,
                lockExpiresAt: null,
                payload: queryPayload,
              }
            : { notaFiscalId: document.notaFiscalId },
          select: { id: true },
        }))
        const payload = record(emissionJob.payload)
        await tx.fiscalEmissaoJob.update({
          where: { id: String(emissionJob.id) },
          data: {
            payload: mergePayload(payload, {
              document: documentMetadata(document, document.xmlBytesSha256 ?? ""),
              transmission: {
                ...record(payload.transmission),
                uncertainAt: now.toISOString(),
                uncertainCode: code,
                consultationJobId: String(queryJob.id),
                // Preserva o recibo já conhecido quando esta passagem não trouxe um novo:
                // `103` seguido de um incerto genérico não pode apagar o `nRec` do lote.
                ...(reciboLote ? { recibo: reciboLote } : {}),
              },
            }),
          },
        })
        await tx.notaFiscal.updateMany({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
            status: "TRANSMITINDO",
          },
          data: { ultimoErro: message, tentativas: { increment: 1 } },
        })
        await tx.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            jobId: String(emissionJob.id),
            nivel: "WARN",
            acao: "fiscal.emission.uncertain",
            mensagem: "Resultado incerto; consulta deduplicada é a única autoridade.",
            operador: "fiscal-goal-012",
            detalhe: {
              code,
              consultationJobId: String(queryJob.id),
              bytesSha256: document.xmlBytesSha256,
              reciboRegistrado: Boolean(reciboLote),
            },
          },
        })
        return {
          consultationJobId: String(queryJob.id),
          created: !existing.id,
        }
      }),

    markAuthorized: async ({ document, result, now, source }) => {
      const persisted = await client.$transaction(async (tx) => {
        // ADR-0018 §2.3 — imutabilidade. A checagem roda ANTES de qualquer
        // escrita e é independente do `status`: o que protege o documento é a
        // presença dos bytes/protocolo já persistidos, não a transição. Assim a
        // retomada do GOAL-012 (nota `AUTORIZADA` com coluna incompleta) segue
        // podendo completar o que falta, sem jamais sobrescrever o que existe.
        const existing = record(await tx.notaFiscal.findFirst({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
          },
          select: {
            id: true,
            status: true,
            xmlAutorizado: true,
            protocolo: true,
            cStat: true,
            xMotivo: true,
            digestValue: true,
            qrCodeData: true,
            urlConsulta: true,
          },
        }))
        if (!existing.id) {
          throw new Error(
            "markAuthorized abortado: nota não encontrada no escopo fiscal informado.",
          )
        }
        const existingXml = stringOrNull(existing.xmlAutorizado)
        const existingProtocolo = stringOrNull(existing.protocolo)
        if (existingXml !== null && existingXml !== result.xmlAutorizado) {
          throw new AuthorizedDivergenceError(
            "xml_autorizado_imutavel_diverge",
            "Tentativa de substituir XML autorizado com bytes divergentes; operação bloqueada.",
          )
        }
        if (existingProtocolo !== null && existingProtocolo !== result.protocolo) {
          throw new AuthorizedDivergenceError(
            "protocolo_imutavel_diverge",
            "Tentativa de trocar o protocolo de autorização; operação bloqueada.",
          )
        }
        assertQrMetadataImmutable(existing, result)
        const digestValue = preserveOrFillQrField(existing.digestValue, result.digestValue)
        const qrCodeData = preserveOrFillQrField(existing.qrCodeData, result.qrCodeData)
        const urlConsulta = preserveOrFillQrField(existing.urlConsulta, result.urlConsulta)
        // Autorização completa já persistida: reprocessamento com os mesmos
        // bytes converge sem escrever nada (idempotência — ADR-0018 §2.3.1).
        // Metadata QR omitida no resultado é preservada (não chega a esta
        // escrita); metadata divergente já falhou fechado acima.
        if (existingXml !== null && existingProtocolo !== null) {
          if (
            stringOrNull(existing.cStat) !== stringOrNull(result.cStat) ||
            stringOrNull(existing.xMotivo) !== stringOrNull(result.xMotivo)
          ) {
            throw new AuthorizedDivergenceError(
              "metadados_autorizacao_divergem",
              "Tentativa de alterar metadados da autorização (cStat/xMotivo) com mesmo XML; operação bloqueada.",
            )
          }
          await tx.fiscalLog.create({
            data: {
              storeId: document.storeId,
              vendaId: document.vendaId,
              notaFiscalId: document.notaFiscalId,
              nivel: "INFO",
              acao: "fiscal.emission.idempotent_mark",
              mensagem:
                "markAuthorized idempotente: XML/protocolo/metadados já persistidos e idênticos; nenhuma escrita.",
              operador: "fiscal-goal-013",
              detalhe: { source },
            },
          })
          return false
        }
        const updated = await tx.notaFiscal.updateMany({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
            status: { in: ["TRANSMITINDO", "AUTORIZADA"] },
          },
          data: {
            status: "AUTORIZADA",
            protocolo: result.protocolo,
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            dataAutorizacao: now,
            xmlAutorizado: result.xmlAutorizado,
            digestValue,
            qrCodeData,
            urlConsulta,
            ultimoErro: null,
          },
        })
        if (updated.count !== 1) throw new Error("Nota autorizada fora do escopo esperado.")
        await tx.venda.updateMany({
          where: { id: document.vendaId, storeId: document.storeId },
          data: { fiscalStatus: "AUTORIZADA" },
        })
        if (source === "CONSULTATION") {
          await tx.fiscalEmissaoJob.updateMany({
            where: {
              storeId: document.storeId,
              vendaId: document.vendaId,
              notaFiscalId: document.notaFiscalId,
              tipo: "EMISSAO",
              status: { in: ["PROCESSANDO", "AGUARDANDO_RETRY", "PENDENTE"] },
            },
            data: {
              status: "CONCLUIDO",
              concluidoEm: now,
              proximaTentativaEm: null,
              ultimoErro: null,
              lockOwner: null,
              lockedAt: null,
              lockExpiresAt: null,
            },
          })
        }
        await tx.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            nivel: "INFO",
            acao:
              source === "CONSULTATION"
                ? "fiscal.reconciliation.authorized"
                : "fiscal.emission.authorized",
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            mensagem: "Autorização persistida com XML/protocolo imutáveis.",
            operador: "fiscal-goal-013",
            detalhe: {
              source,
              protocoloPersistido: true,
              xmlAutorizadoPersistido: true,
              digestValuePersistido: Boolean(digestValue),
              qrCodeDataPersistido: Boolean(qrCodeData),
              urlConsultaPersistido: Boolean(urlConsulta),
            },
          },
        })
        return true
      })
      // ADR-0018 §2.4 — espelho privado OPCIONAL. Roda FORA da transação (é
      // I/O externo) e **nunca** derruba uma autorização já persistida: a
      // coluna é a fonte primária e já está commitada neste ponto. Com o
      // espelho inativo (estado atual do projeto) nada acontece.
      if (!persisted) return
      const mirror = resolveMirror()
      if (!mirror.active) return
      const bytesSha256 = sha256Hex(result.xmlAutorizado)
      try {
        const stored = await mirror.storeMirror({
          storeId: document.storeId,
          notaFiscalId: document.notaFiscalId,
          xmlAutorizado: result.xmlAutorizado,
          bytesSha256,
        })
        if (stored.divergent || !stored.xmlStorageRef) {
          await client.fiscalLog.create({
            data: {
              storeId: document.storeId,
              vendaId: document.vendaId,
              notaFiscalId: document.notaFiscalId,
              nivel: "WARN",
              acao: "fiscal.storage.mirror_write_skipped",
              mensagem:
                "Espelho privado não confirmou a cópia; coluna permanece a fonte primária.",
              operador: "fiscal-goal-013",
              detalhe: { bytesSha256, reason: stored.reason ?? null },
            },
          })
          return
        }
        // `xmlStorageRef: null` no WHERE mantém o ponteiro imutável: uma
        // referência já gravada nunca é trocada por outra.
        await client.notaFiscal.updateMany({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
            xmlStorageRef: null,
          },
          data: { xmlStorageRef: stored.xmlStorageRef },
        })
        await client.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            nivel: "INFO",
            acao: "fiscal.storage.mirror_written",
            mensagem: "Cópia imutável do XML autorizado registrada no espelho privado.",
            operador: "fiscal-goal-013",
            detalhe: { bytesSha256, xmlStorageRef: stored.xmlStorageRef },
          },
        })
      } catch {
        await client.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            nivel: "WARN",
            acao: "fiscal.storage.mirror_failed",
            mensagem:
              "Falha ao gravar espelho privado; autorização permanece válida na coluna.",
            operador: "fiscal-goal-013",
            detalhe: { bytesSha256 },
          },
        })
      }
    },

    markRejected: async ({ document, result, now, source, requiresInutilizacao }) => {
      await client.$transaction(async (tx) => {
        const updated = await tx.notaFiscal.updateMany({
          where: {
            id: document.notaFiscalId,
            storeId: document.storeId,
            vendaId: document.vendaId,
            status: { in: ["TRANSMITINDO", "REJEITADA"] },
          },
          data: {
            status: "REJEITADA",
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            ultimoErro: result.xMotivo,
          },
        })
        if (updated.count !== 1) throw new Error("Rejeição fora do escopo esperado.")
        await tx.venda.updateMany({
          where: { id: document.vendaId, storeId: document.storeId },
          data: { fiscalStatus: "REJEITADA" },
        })
        if (source === "CONSULTATION") {
          const emissionJob = await findEmissionJob(tx, document)
          if (emissionJob.id) {
            await tx.fiscalEmissaoJob.update({
              where: { id: String(emissionJob.id) },
              data: {
                status: "FALHA",
                proximaTentativaEm: null,
                ultimoErro: result.xMotivo,
                lockOwner: null,
                lockedAt: null,
                lockExpiresAt: null,
                payload: mergePayload(emissionJob.payload, {
                  requiresInutilizacao,
                  rejectedAt: now.toISOString(),
                }),
              },
            })
          }
        }
        await tx.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            nivel: "WARN",
            acao: "fiscal.reconciliation.rejected_requires_inutilizacao",
            cStat: result.cStat,
            xMotivo: result.xMotivo,
            // A mensagem acompanha a decisão da matriz: uma denegação (`110`) consome o número
            // mas NÃO pede inutilização, e afirmar o contrário no log contradiria o próprio
            // `detalhe.requiresInutilizacao` do mesmo evento.
            mensagem: requiresInutilizacao
              ? "Número consumido; não reutilizar. Inutilização futura no GOAL-019."
              : "Número consumido; não reutilizar. Inutilização NÃO se aplica a esta rejeição.",
            operador: "fiscal-goal-012",
            detalhe: {
              source,
              requiresInutilizacao,
              serie: document.serie,
              numero: document.numero,
            },
          },
        })
      })
    },

    authorizeExactRetransmission: async ({ document, now }) => {
      await client.$transaction(async (tx) => {
        const emissionJob = await findEmissionJob(tx, document)
        if (!emissionJob.id) throw new Error("Job EMISSAO ausente para autorizar retomada.")
        const payload = record(emissionJob.payload)
        const transmission = record(payload.transmission)
        await tx.fiscalEmissaoJob.update({
          where: { id: String(emissionJob.id) },
          data: {
            status: "PENDENTE",
            proximaTentativaEm: now,
            ultimoErro: null,
            lockOwner: null,
            lockedAt: null,
            lockExpiresAt: null,
            payload: mergePayload(payload, {
              transmission: {
                ...transmission,
                consultationOutcome: "NOT_FOUND",
                consultationCompletedAt: now.toISOString(),
                retryAuthorizedAt: now.toISOString(),
                retryAuthorizationConsumedAt: null,
              },
            }),
          },
        })
        await tx.fiscalLog.create({
          data: {
            storeId: document.storeId,
            vendaId: document.vendaId,
            notaFiscalId: document.notaFiscalId,
            jobId: String(emissionJob.id),
            nivel: "INFO",
            acao: "fiscal.reconciliation.not_found_retry_authorized",
            mensagem: "Consulta não encontrou a nota; uma retomada dos bytes exatos foi autorizada.",
            operador: "fiscal-goal-012",
            detalhe: {
              bytesSha256: document.xmlBytesSha256,
              chaveAcesso: document.chaveAcesso,
              authorizedAt: now.toISOString(),
            },
          },
        })
      })
    },
  }
}
