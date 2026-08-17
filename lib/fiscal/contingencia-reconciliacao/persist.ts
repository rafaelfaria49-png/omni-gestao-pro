/**
 * Persistência transacional da reconciliação 020D.
 *
 * Atualiza NotaFiscal + job + log na mesma transação. Não transmite, não
 * consulta SEFAZ, não acorda worker, não altera exactBytes.
 */
import { prisma } from "@/lib/prisma"
import { CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE } from "../contingencia-outbox/types"
import { buildContingenciaOutboxDedupeKey } from "../contingencia-outbox/identity"
import { decideContingenciaReconciliation } from "./decision"
import {
  deriveEvidenceKind,
  isCanonicalEvidenceKind,
  isValidFiscalProtocolo,
} from "./evidence"
import {
  isDormantContingenciaOutbox,
  verifyContingenciaExactBytesPair,
  type ContingenciaPairJob,
  type ContingenciaPairNota,
} from "./integrity"
import {
  RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
  type ContingenciaReconciliationClient,
  type ContingenciaReconciliationError,
  type ContingenciaReconciliationOk,
  type ContingenciaReconciliationTx,
  type ContingenciaRetransmissionEligibility,
  type ReconcileNfceContingenciaInput,
  type ReconcileNfceContingenciaResult,
} from "./types"

const CHAVE_44 = /^\d{44}$/

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
}

function fail(
  code: ContingenciaReconciliationError["code"],
  mensagem: string,
  extra: Omit<
    ContingenciaReconciliationError,
    "ok" | "code" | "mensagem" | "retryAutomatico" | "executeAutomatico" | "eligibilityCreated"
  > = {},
): ContingenciaReconciliationError {
  return {
    ok: false,
    code,
    mensagem,
    retryAutomatico: false,
    executeAutomatico: false,
    eligibilityCreated: false,
    ...extra,
  }
}

function asNota(value: unknown): ContingenciaPairNota | null {
  const row = record(value)
  const id = str(row.id)
  if (!id) return null
  return {
    id,
    storeId: str(row.storeId),
    vendaId: str(row.vendaId),
    chaveAcesso: str(row.chaveAcesso) || null,
    xmlAssinado: typeof row.xmlAssinado === "string" ? row.xmlAssinado : null,
    status: str(row.status),
    tipoEmissao: str(row.tipoEmissao),
    serie: Number.isInteger(row.serie) ? Number(row.serie) : row.serie == null ? null : Number(row.serie),
    numero: Number.isInteger(row.numero) ? Number(row.numero) : row.numero == null ? null : Number(row.numero),
    protocolo: str(row.protocolo) || null,
  }
}

function asJob(value: unknown): ContingenciaPairJob | null {
  const row = record(value)
  const id = str(row.id)
  if (!id) return null
  return {
    id,
    storeId: str(row.storeId),
    vendaId: str(row.vendaId),
    notaFiscalId: str(row.notaFiscalId) || null,
    tipo: str(row.tipo),
    status: str(row.status),
    dedupeKey: str(row.dedupeKey) || null,
    payload: row.payload,
    proximaTentativaEm:
      row.proximaTentativaEm instanceof Date
        ? row.proximaTentativaEm
        : row.proximaTentativaEm
          ? new Date(String(row.proximaTentativaEm))
          : null,
  }
}

function validateInput(
  input: ReconcileNfceContingenciaInput,
): ContingenciaReconciliationError | { ok: true; storeId: string; chave: string; observedAt: string } {
  const storeId = str(input.storeId)
  if (!storeId) {
    return fail("store_id_obrigatorio", "storeId é obrigatório; não há fallback global.")
  }
  const chave = str(input.chave)
  if (!CHAVE_44.test(chave) || chave[34] !== "9") {
    return fail("parametros_invalidos", "chave de acesso deve ter 44 dígitos com tpEmis=9.", { storeId, chave })
  }
  if (!isCanonicalEvidenceKind(input.evidenceKind)) {
    return fail("evidencia_nao_canonica", "Decisão fiscal não aceita string livre.", { storeId, chave })
  }
  const observedAt = str(input.observedAt)
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
    return fail("parametros_invalidos", "timestamp da observação é obrigatório e deve ser ISO-8601.", {
      storeId,
      chave,
      evidenceKind: input.evidenceKind,
    })
  }
  const consulta = input.consulta
  if (!consulta || typeof consulta !== "object") {
    return fail("parametros_invalidos", "resultado sanitizado da consulta é obrigatório.", {
      storeId,
      chave,
      evidenceKind: input.evidenceKind,
    })
  }
  const derived = deriveEvidenceKind(consulta)
  if (input.evidenceKind === "AUTHORIZED" && derived !== "AUTHORIZED") {
    return fail(
      "autorizacao_sem_protocolo",
      "AUTHORIZED exige protocolo válido no formato do contrato vigente e classificação oficial.",
      { storeId, chave, evidenceKind: input.evidenceKind },
    )
  }
  if (input.evidenceKind === "NOT_FOUND" && derived !== "NOT_FOUND") {
    return fail(
      "not_found_nao_explicito",
      "NOT_FOUND só vale com classificação oficial NAO_CONSTA em consulta; timeout/SOAP/malformed/cStat desconhecido não qualificam.",
      { storeId, chave, evidenceKind: input.evidenceKind },
    )
  }
  if (derived !== input.evidenceKind) {
    return fail(
      "evidencia_inconsistente_com_classificador",
      "O tipo de evidência declarado diverge do classificador oficial da consulta.",
      { storeId, chave, evidenceKind: input.evidenceKind },
    )
  }
  if (
    derived === "AUTHORIZED" &&
    consulta.xmlAutorizado &&
    (!consulta.xmlAutorizado.includes(chave) || !consulta.xmlAutorizado.includes(`Id="NFe${chave}"`))
  ) {
    return fail(
      "evidencia_inconsistente_com_classificador",
      "xmlAutorizado sanitizado não pertence à chave informada.",
      { storeId, chave, evidenceKind: input.evidenceKind },
    )
  }
  return { ok: true, storeId, chave, observedAt }
}

const NOTA_SELECT = {
  id: true,
  storeId: true,
  vendaId: true,
  chaveAcesso: true,
  xmlAssinado: true,
  status: true,
  tipoEmissao: true,
  serie: true,
  numero: true,
  protocolo: true,
} as const

const JOB_SELECT = {
  id: true,
  storeId: true,
  vendaId: true,
  notaFiscalId: true,
  tipo: true,
  status: true,
  dedupeKey: true,
  payload: true,
  proximaTentativaEm: true,
} as const

async function loadPair(
  tx: ContingenciaReconciliationTx,
  storeId: string,
  chave: string,
): Promise<{ nota: ContingenciaPairNota | null; job: ContingenciaPairJob | null }> {
  const nota = asNota(
    await tx.notaFiscal.findFirst({
      where: { storeId, chaveAcesso: chave },
      select: NOTA_SELECT,
    }),
  )
  const job = asJob(
    await tx.fiscalEmissaoJob.findUnique({
      where: { storeId_dedupeKey: { storeId, dedupeKey: buildContingenciaOutboxDedupeKey(chave) } },
      select: JOB_SELECT,
    }),
  )
  return { nota, job }
}

function buildEligibility(input: {
  storeId: string
  chave: string
  sha256: string
  observedAt: string
  cStat: string | null
}): ContingenciaRetransmissionEligibility {
  return {
    kind: RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
    storeId: input.storeId,
    chave: input.chave,
    sha256: input.sha256,
    grantedAt: input.observedAt,
    consumedAt: null,
    singleUse: true,
    executeAutomatico: false,
    evidenceKind: "NOT_FOUND",
    cStat: input.cStat,
    reason: "NAO_CONSTA",
  }
}

function mergePayload(
  existing: unknown,
  patch: {
    estado: string
    lastEvidenceKind: string
    observedAt: string
    decision: string
    eligibility: ContingenciaRetransmissionEligibility | null
    requiresHumanIntervention: boolean
    podeConsultar: boolean
  },
): UnknownRecord {
  const root = record(existing)
  const contingencia = record(root.contingencia)
  const transmission = record(root.transmission)
  return {
    ...root,
    executeAutomatico: false,
    contingencia: {
      ...contingencia,
      estado: patch.estado,
      lastEvidenceKind: patch.lastEvidenceKind,
      lastEvidenceAt: patch.observedAt,
      lastDecision: patch.decision,
      retryAutomatico: false,
      executeAutomatico: false,
      requiresHumanIntervention: patch.requiresHumanIntervention,
      podeConsultar: patch.podeConsultar,
      retransmissionEligibility: patch.eligibility,
    },
    transmission: {
      ...transmission,
      external: false,
      consultationOutcome:
        patch.lastEvidenceKind === "NOT_FOUND"
          ? "NOT_FOUND"
          : patch.lastEvidenceKind === "AUTHORIZED"
            ? "AUTHORIZED"
            : patch.lastEvidenceKind === "REJECTED_FINAL"
              ? "REJECTED"
              : "UNCERTAIN",
    },
  }
}

function jobStatusFor(decisionTo: string, currentStatus: string): string {
  if (decisionTo === "AUTORIZADO_POST") return "CONCLUIDO"
  if (decisionTo === "REJEITADO_DEF") return "FALHA"
  return currentStatus === CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE
    ? CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE
    : currentStatus
}

function toSuccess(input: {
  kind: "applied" | "idempotent"
  storeId: string
  chave: string
  nota: ContingenciaPairNota
  job: ContingenciaPairJob
  sha256: string
  evidenceKind: ReconcileNfceContingenciaInput["evidenceKind"]
  estadoAnterior: ContingenciaReconciliationOk["estadoAnterior"]
  estadoFinal: ContingenciaReconciliationOk["estadoFinal"]
  eligibility: ContingenciaRetransmissionEligibility | null
  eligibilityCreated: boolean
  requiresHumanIntervention: boolean
}): ContingenciaReconciliationOk {
  return {
    ok: true,
    kind: input.kind,
    storeId: input.storeId,
    chave: input.chave,
    notaFiscalId: input.nota.id,
    jobId: input.job.id,
    sha256: input.sha256,
    evidenceKind: input.evidenceKind,
    estadoAnterior: input.estadoAnterior,
    estadoFinal: input.estadoFinal,
    retryAutomatico: false,
    executeAutomatico: false,
    eligibilityCreated: input.eligibilityCreated,
    eligibility: input.eligibility,
    jobStatus: input.job.status,
    proximaTentativaEm: null,
    protocoloRegistrado: Boolean(input.nota.protocolo),
    requiresHumanIntervention: input.requiresHumanIntervention,
  }
}

async function reconcileInTransaction(
  tx: ContingenciaReconciliationTx,
  input: ReconcileNfceContingenciaInput,
  storeId: string,
  chave: string,
  observedAt: string,
): Promise<ReconcileNfceContingenciaResult> {
  const loaded = await loadPair(tx, storeId, chave)
  const integrity = verifyContingenciaExactBytesPair({
    storeId,
    chave,
    nota: loaded.nota,
    job: loaded.job,
    notaFiscalId: input.notaFiscalId,
    jobId: input.jobId,
  })
  if (!integrity.ok) {
    return fail(integrity.code, integrity.mensagem, {
      storeId,
      chave,
      notaFiscalId: loaded.nota?.id ?? null,
      jobId: loaded.job?.id ?? null,
      evidenceKind: input.evidenceKind,
    })
  }
  const nota = loaded.nota!
  const job = loaded.job!

  const decision = decideContingenciaReconciliation({
    from: integrity.estado,
    evidenceKind: input.evidenceKind,
    persistedEvidence: integrity.persistedEvidence,
  })
  if (!decision.ok) {
    return fail(decision.code, "Evidência recusada pela precedência fail-closed.", {
      storeId,
      chave,
      notaFiscalId: nota.id,
      jobId: job.id,
      evidenceKind: input.evidenceKind,
      estadoAnterior: integrity.estado,
    })
  }

  if (decision.eligibilityCreated && (!isDormantContingenciaOutbox(job) || nota.status !== "CONTINGENCIA")) {
    return fail(
      "par_inconsistente",
      "NOT_FOUND só cria elegibilidade sobre o par dormente íntegro; recusado.",
      { storeId, chave, notaFiscalId: nota.id, jobId: job.id, evidenceKind: input.evidenceKind },
    )
  }

  const existingEligibility = record(record(record(job.payload).contingencia).retransmissionEligibility)
  const existingKind = str(existingEligibility.kind)
  let eligibility: ContingenciaRetransmissionEligibility | null = null
  if (decision.eligibilityCreated) {
    if (
      existingKind === RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND &&
      str(existingEligibility.sha256) === integrity.sha256 &&
      str(existingEligibility.storeId) === storeId &&
      str(existingEligibility.chave) === chave &&
      existingEligibility.consumedAt == null
    ) {
      eligibility = {
        kind: RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
        storeId,
        chave,
        sha256: integrity.sha256,
        grantedAt: str(existingEligibility.grantedAt) || observedAt,
        consumedAt: null,
        singleUse: true,
        executeAutomatico: false,
        evidenceKind: "NOT_FOUND",
        cStat: str(existingEligibility.cStat) || input.consulta.cStat,
        reason: "NAO_CONSTA",
      }
    } else {
      eligibility = buildEligibility({
        storeId,
        chave,
        sha256: integrity.sha256,
        observedAt,
        cStat: input.consulta.cStat,
      })
    }
  } else if (
    decision.to !== "AUTORIZADO_POST" &&
    decision.to !== "REJEITADO_DEF" &&
    existingKind === RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND &&
    existingEligibility.consumedAt == null
  ) {
    eligibility = {
      kind: RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
      storeId,
      chave,
      sha256: integrity.sha256,
      grantedAt: str(existingEligibility.grantedAt) || observedAt,
      consumedAt: null,
      singleUse: true,
      executeAutomatico: false,
      evidenceKind: "NOT_FOUND",
      cStat: str(existingEligibility.cStat) || null,
      reason: "NAO_CONSTA",
    }
  }

  if (decision.action === "idempotent") {
    return toSuccess({
      kind: "idempotent",
      storeId,
      chave,
      nota,
      job,
      sha256: integrity.sha256,
      evidenceKind: input.evidenceKind,
      estadoAnterior: integrity.estado,
      estadoFinal: decision.to,
      eligibility,
      eligibilityCreated: false,
      requiresHumanIntervention: decision.requiresHumanIntervention,
    })
  }

  const nextJobStatus = jobStatusFor(decision.to, job.status)
  const protocolo =
    input.evidenceKind === "AUTHORIZED" && isValidFiscalProtocolo(input.consulta.protocolo)
      ? input.consulta.protocolo
      : null

  const notaData: UnknownRecord = {}
  if (decision.to === "AUTORIZADO_POST") {
    notaData.status = "AUTORIZADA"
    notaData.protocolo = protocolo
    notaData.cStat = input.consulta.cStat
    notaData.xMotivo = input.consulta.xMotivo
    if (input.consulta.xmlAutorizado) notaData.xmlAutorizado = input.consulta.xmlAutorizado
    notaData.ultimoErro = null
  } else if (decision.to === "REJEITADO_DEF") {
    notaData.status = "REJEITADA"
    notaData.cStat = input.consulta.cStat
    notaData.xMotivo = input.consulta.xMotivo
    notaData.ultimoErro = input.consulta.xMotivo
  }

  if (Object.keys(notaData).length > 0) {
    const updated = await tx.notaFiscal.updateMany({
      where: { id: nota.id, storeId, chaveAcesso: chave },
      data: notaData,
    })
    if (updated.count !== 1) {
      throw new Error("Atualização da NotaFiscal fora do escopo; transação abortada.")
    }
  }

  const payload = mergePayload(job.payload, {
    estado: decision.to,
    lastEvidenceKind: input.evidenceKind,
    observedAt,
    decision: decision.to,
    eligibility,
    requiresHumanIntervention: decision.requiresHumanIntervention,
    podeConsultar: decision.podeConsultar,
  })

  const jobData: UnknownRecord = {
    status: nextJobStatus,
    proximaTentativaEm: null,
    lockOwner: null,
    lockedAt: null,
    lockExpiresAt: null,
    payload,
  }
  if (decision.to === "AUTORIZADO_POST") jobData.concluidoEm = new Date(observedAt)
  if (decision.to === "REJEITADO_DEF") jobData.ultimoErro = input.consulta.xMotivo

  await tx.fiscalEmissaoJob.update({
    where: { id: job.id },
    data: jobData,
  })

  if (Object.prototype.hasOwnProperty.call(notaData, "xmlAssinado")) {
    throw new Error("exactBytes não podem ser alterados; transação abortada.")
  }

  await tx.fiscalLog.create({
    data: {
      storeId,
      vendaId: nota.vendaId,
      notaFiscalId: nota.id,
      jobId: job.id,
      nivel: decision.to === "REJEITADO_DEF" ? "WARN" : "INFO",
      acao: "fiscal.contingencia.reconciliacao.020d",
      cStat: input.consulta.cStat,
      xMotivo: input.consulta.xMotivo,
      mensagem: "Reconciliação offline fail-closed aplicada.",
      detalhe: {
        estadoAnterior: integrity.estado,
        evidencias: {
          kind: input.evidenceKind,
          reason: input.consulta.reason,
          outcome: input.consulta.outcome,
          cStat: input.consulta.cStat,
          observedAt,
          uncertainCode: input.consulta.uncertainCode ?? null,
        },
        decisao: decision.to,
        estadoFinal: decision.to,
        eligibilityCreated: decision.eligibilityCreated,
        eligibilityKind: eligibility?.kind ?? null,
        failClosed: false,
        retryAutomatico: false,
        executeAutomatico: false,
        workerEligible: false,
        protocoloRegistrado: Boolean(protocolo),
        exactBytesPreservados: true,
      },
    },
  })

  const jobAfter: ContingenciaPairJob = {
    ...job,
    status: nextJobStatus,
    proximaTentativaEm: null,
    payload,
  }
  const notaAfter: ContingenciaPairNota = {
    ...nota,
    status:
      decision.to === "AUTORIZADO_POST"
        ? "AUTORIZADA"
        : decision.to === "REJEITADO_DEF"
          ? "REJEITADA"
          : nota.status,
    protocolo: protocolo ?? nota.protocolo,
  }

  return toSuccess({
    kind: "applied",
    storeId,
    chave,
    nota: notaAfter,
    job: jobAfter,
    sha256: integrity.sha256,
    evidenceKind: input.evidenceKind,
    estadoAnterior: integrity.estado,
    estadoFinal: decision.to,
    eligibility,
    eligibilityCreated: decision.eligibilityCreated,
    requiresHumanIntervention: decision.requiresHumanIntervention,
  })
}

/**
 * Aplica evidência de consulta já classificada à NFC-e em contingência.
 * Operação atômica. Sem rede, sem worker, sem rebuild.
 */
export async function reconcileNfceContingenciaOffline(
  input: ReconcileNfceContingenciaInput,
  dependencies: { client?: ContingenciaReconciliationClient } = {},
): Promise<ReconcileNfceContingenciaResult> {
  const validated = validateInput(input)
  if (!validated.ok) return validated

  const { storeId, chave, observedAt } = validated
  const client = dependencies.client ?? (prisma as unknown as ContingenciaReconciliationClient)
  return client.$transaction((tx) => reconcileInTransaction(tx, input, storeId, chave, observedAt))
}
