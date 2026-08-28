/**
 * Persistência transacional da NFC-e em contingência off-line (GOAL 020C).
 *
 * Grava exactBytes + metadata + job dormente na mesma transação.
 * Não reconstrói XML, não assina, não transmite, não chama worker/cron.
 */
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { CONTINGENCIA_TP_EMIS } from "../contingencia/types"
import { exactBytesRequirement, transmissionDeadlinePolicy } from "../contingencia/policy"
import { applyContingenciaEvent } from "../contingencia/state-machine"
import { buildContingenciaDocumentoLocalKey, buildContingenciaOutboxDedupeKey } from "./identity"
import {
  CONTINGENCIA_OUTBOX_ESTADO,
  CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE,
  CONTINGENCIA_OUTBOX_JOB_TIPO,
  type ContingenciaOutboxClient,
  type ContingenciaOutboxDeadlinePersistido,
  type ContingenciaOutboxIssue,
  type ContingenciaOutboxPersistError,
  type ContingenciaOutboxPersistido,
  type ContingenciaOutboxTx,
  type PersistNfceContingenciaOutboxInput,
  type PersistNfceContingenciaOutboxResult,
} from "./types"

const SHA256_HEX = /^[0-9a-f]{64}$/
const CHAVE_44 = /^\d{44}$/

type UnknownRecord = Record<string, unknown>

type NotaRow = {
  id: string
  storeId: string
  vendaId: string
  chaveAcesso: string | null
  xmlAssinado: string | null
  status: string
  tipoEmissao: string
  localKey: string | null
}

type JobRow = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string | null
  tipo: string
  status: string
  dedupeKey: string | null
  payload: unknown
  proximaTentativaEm: Date | null
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes)
}

function fail(
  code: ContingenciaOutboxPersistError["code"],
  mensagem: string,
  extra: Omit<ContingenciaOutboxPersistError, "ok" | "code" | "mensagem"> = {},
): ContingenciaOutboxPersistError {
  return { ok: false, code, mensagem, ...extra }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === "P2002",
  )
}

function xmlFromExactBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8")
}

function bytesFromXml(xml: string): Uint8Array {
  return Uint8Array.from(Buffer.from(xml, "utf8"))
}

/** Amarração identidade↔bytes sem parse/rebuild: o XML persistido deve conter a chave/nNF/série informados. */
function xmlContainsIssuedIdentity(xml: string, issue: ContingenciaOutboxIssue): boolean {
  return (
    xml.includes(issue.chave) &&
    xml.includes(`Id="NFe${issue.chave}"`) &&
    xml.includes("<tpEmis>9</tpEmis>") &&
    xml.includes(`<nNF>${issue.nNF}</nNF>`) &&
    xml.includes(`<serie>${issue.serie}</serie>`)
  )
}

function parseDhCont(dhCont: string): Date | null {
  const parsed = new Date(dhCont)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function payloadSha256(payload: unknown): string | null {
  const root = record(payload)
  const contingencia = record(root.contingencia)
  const hash = str(contingencia.sha256)
  return SHA256_HEX.test(hash) ? hash : null
}

function validateInput(
  input: PersistNfceContingenciaOutboxInput,
): ContingenciaOutboxPersistError | { ok: true; storeId: string; vendaId: string; issue: ContingenciaOutboxIssue; bytes: Uint8Array; xml: string } {
  const storeId = str(input.storeId)
  if (!storeId) {
    return fail("store_id_obrigatorio", "storeId é obrigatório; não há fallback global.")
  }
  const vendaId = str(input.vendaId)
  const ambiente = str(input.ambiente)
  if (!vendaId || (ambiente !== "HOMOLOGACAO" && ambiente !== "PRODUCAO")) {
    return fail("parametros_invalidos", "vendaId e ambiente (HOMOLOGACAO|PRODUCAO) são obrigatórios.", { storeId })
  }
  const issue = input.offline
  if (!issue || issue.tpEmis !== CONTINGENCIA_TP_EMIS) {
    return fail("tp_emis_invalido", "tpEmis persistido deve ser 9 (contingência off-line).", { storeId })
  }
  const chave = str(issue.chave)
  const sha256Informado = str(issue.sha256).toLowerCase()
  const dhEmi = str(issue.dhEmi)
  const dhCont = str(issue.dhCont)
  const xJust = str(issue.xJust)
  if (!CHAVE_44.test(chave) || chave[34] !== "9") {
    return fail("parametros_invalidos", "chave de acesso deve ter 44 dígitos com tpEmis=9.", { storeId, chave })
  }
  if (!SHA256_HEX.test(sha256Informado) || !dhEmi || !dhCont || !xJust) {
    return fail("parametros_invalidos", "sha256, dhEmi, dhCont e xJust são obrigatórios.", {
      storeId,
      chave,
      sha256Informado,
    })
  }
  if (!Number.isInteger(issue.nNF) || issue.nNF <= 0 || !Number.isInteger(issue.serie) || issue.serie < 0) {
    return fail("parametros_invalidos", "nNF/série devem vir do 020B; esta camada não os altera.", {
      storeId,
      chave,
    })
  }
  if (!(issue.exactBytes instanceof Uint8Array) || issue.exactBytes.length === 0) {
    return fail("parametros_invalidos", "exactBytes são obrigatórios e não podem ser vazios.", {
      storeId,
      chave,
      sha256Informado,
    })
  }
  const bytes = copyBytes(issue.exactBytes)
  const calculado = sha256Hex(bytes)
  if (calculado !== sha256Informado) {
    return fail("sha256_divergente", "sha256(exactBytes) diverge do hash informado; gravação recusada.", {
      storeId,
      chave,
      sha256Informado,
      sha256Persistido: calculado,
    })
  }
  const xml = xmlFromExactBytes(bytes)
  if (sha256Hex(bytesFromXml(xml)) !== sha256Informado) {
    return fail("sha256_divergente", "exactBytes não round-tripam em UTF-8 sem alteração; gravação recusada.", {
      storeId,
      chave,
      sha256Informado,
    })
  }
  const issueNormalizado: ContingenciaOutboxIssue = {
    ...issue,
    exactBytes: bytes,
    sha256: sha256Informado,
    chave,
  }
  if (!xmlContainsIssuedIdentity(xml, issueNormalizado)) {
    return fail(
      "bytes_identidade_divergente",
      "exactBytes não contêm a chave/nNF/série/tpEmis informados; gravação recusada.",
      { storeId, chave, sha256Informado },
    )
  }
  if (!parseDhCont(dhCont)) {
    return fail("dh_cont_invalido", "dhCont não é um instante válido; gravação recusada.", {
      storeId,
      chave,
    })
  }
  return { ok: true, storeId, vendaId, issue: issueNormalizado, bytes, xml }
}

function deadlinePersistido(): ContingenciaOutboxDeadlinePersistido {
  return {
    ...transmissionDeadlinePolicy(),
    resolvedDeadline: null,
  }
}

function buildPayload(input: {
  storeId: string
  vendaId: string
  notaFiscalId: string
  issue: ContingenciaOutboxIssue
}): UnknownRecord {
  const deadline = deadlinePersistido()
  const exact = exactBytesRequirement(CONTINGENCIA_OUTBOX_ESTADO)
  return {
    version: 1,
    operation: CONTINGENCIA_OUTBOX_JOB_TIPO,
    executeAutomatico: false,
    storeId: input.storeId,
    vendaId: input.vendaId,
    contingencia: {
      estado: CONTINGENCIA_OUTBOX_ESTADO,
      tpEmis: CONTINGENCIA_TP_EMIS,
      dhEmi: input.issue.dhEmi,
      dhCont: input.issue.dhCont,
      xJust: input.issue.xJust,
      chave: input.issue.chave,
      sha256: input.issue.sha256,
      nNF: input.issue.nNF,
      serie: input.issue.serie,
      exactBytesRef: {
        kind: "NotaFiscal.xmlAssinado",
        notaFiscalId: input.notaFiscalId,
        rebuildForbidden: true,
      },
      deadline,
      exactBytes: exact,
    },
    transmission: { external: false, startedAt: null },
  }
}

function toSuccess(input: {
  kind: "created" | "idempotent"
  storeId: string
  vendaId: string
  nota: NotaRow
  job: JobRow
  issue: ContingenciaOutboxIssue
}): ContingenciaOutboxPersistido {
  return {
    ok: true,
    kind: input.kind,
    storeId: input.storeId,
    vendaId: input.vendaId,
    notaFiscalId: input.nota.id,
    jobId: input.job.id,
    localKey: input.nota.localKey ?? buildContingenciaDocumentoLocalKey(input.storeId, input.issue.chave),
    dedupeKey: input.job.dedupeKey ?? buildContingenciaOutboxDedupeKey(input.issue.chave),
    chave: input.issue.chave,
    sha256: input.issue.sha256,
    tpEmis: CONTINGENCIA_TP_EMIS,
    dhEmi: input.issue.dhEmi,
    dhCont: input.issue.dhCont,
    estado: CONTINGENCIA_OUTBOX_ESTADO,
    documentoStatus: "CONTINGENCIA",
    tipoEmissao: "CONTINGENCIA_OFFLINE",
    jobTipo: CONTINGENCIA_OUTBOX_JOB_TIPO,
    jobStatus: CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE,
    executeAutomatico: false,
    exactBytesRef: {
      kind: "NotaFiscal.xmlAssinado",
      notaFiscalId: input.nota.id,
      rebuildForbidden: true,
    },
    deadline: deadlinePersistido(),
  }
}

function asNota(value: unknown): NotaRow | null {
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
    localKey: str(row.localKey) || null,
  }
}

function asJob(value: unknown): JobRow | null {
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

async function findNotaByStoreChave(
  client: ContingenciaOutboxTx,
  storeId: string,
  chave: string,
): Promise<NotaRow | null> {
  return asNota(
    await client.notaFiscal.findFirst({
      where: { storeId, chaveAcesso: chave },
      select: {
        id: true,
        storeId: true,
        vendaId: true,
        chaveAcesso: true,
        xmlAssinado: true,
        status: true,
        tipoEmissao: true,
        localKey: true,
      },
    }),
  )
}

async function findJobByDedupe(
  client: ContingenciaOutboxTx,
  storeId: string,
  dedupeKey: string,
): Promise<JobRow | null> {
  return asJob(
    await client.fiscalEmissaoJob.findUnique({
      where: { storeId_dedupeKey: { storeId, dedupeKey } },
      select: {
        id: true,
        storeId: true,
        vendaId: true,
        notaFiscalId: true,
        tipo: true,
        status: true,
        dedupeKey: true,
        payload: true,
        proximaTentativaEm: true,
      },
    }),
  )
}

function conflictSameChave(
  storeId: string,
  chave: string,
  sha256Informado: string,
  sha256Persistido: string | null,
  notaFiscalId: string | null,
  jobId: string | null,
): ContingenciaOutboxPersistError {
  return fail(
    "chave_bytes_conflito",
    "Mesma chave com exactBytes/sha256 diferentes. Não sobrescreve.",
    { storeId, chave, sha256Informado, sha256Persistido, notaFiscalId, jobId },
  )
}

function inconsistente(
  storeId: string,
  chave: string,
  mensagem: string,
  extra: Pick<ContingenciaOutboxPersistError, "notaFiscalId" | "jobId" | "sha256Informado" | "sha256Persistido"> = {},
): ContingenciaOutboxPersistError {
  return fail("identidade_fiscal_conflito", mensagem, { storeId, chave, ...extra })
}

function pairIsDormantContingencia(input: {
  storeId: string
  vendaId: string
  issue: ContingenciaOutboxIssue
  nota: NotaRow
  job: JobRow
}): ContingenciaOutboxPersistError | null {
  const { storeId, vendaId, issue, nota, job } = input
  if (nota.storeId !== storeId || job.storeId !== storeId) {
    return inconsistente(storeId, issue.chave, "Documento/job não pertence à loja solicitada.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  if (nota.vendaId !== vendaId || job.vendaId !== vendaId) {
    return inconsistente(storeId, issue.chave, "vendaId do par persistido diverge do pedido.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  if (nota.chaveAcesso !== issue.chave) {
    return inconsistente(storeId, issue.chave, "chaveAcesso persistida diverge da informada.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  if (nota.tipoEmissao !== "CONTINGENCIA_OFFLINE" || nota.status !== "CONTINGENCIA") {
    return inconsistente(storeId, issue.chave, "Documento persistido não está em contingência off-line.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  if (!nota.xmlAssinado) {
    return inconsistente(storeId, issue.chave, "exactBytes persistidos ausentes; recusado.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  if (!xmlContainsIssuedIdentity(nota.xmlAssinado, issue)) {
    return inconsistente(storeId, issue.chave, "Bytes persistidos não conferem com a identidade informada.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  const hashNota = sha256Hex(bytesFromXml(nota.xmlAssinado))
  const hashJob = payloadSha256(job.payload)
  if (hashNota !== issue.sha256) {
    return conflictSameChave(storeId, issue.chave, issue.sha256, hashNota, nota.id, job.id)
  }
  if (hashJob != null && hashJob !== hashNota) {
    return conflictSameChave(storeId, issue.chave, issue.sha256, hashNota, nota.id, job.id)
  }
  if (
    job.tipo !== CONTINGENCIA_OUTBOX_JOB_TIPO ||
    job.status !== CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE ||
    job.proximaTentativaEm != null ||
    job.notaFiscalId !== nota.id ||
    job.dedupeKey !== buildContingenciaOutboxDedupeKey(issue.chave)
  ) {
    return inconsistente(storeId, issue.chave, "Job persistido não é a outbox dormente desta contingência.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  const payload = record(job.payload)
  const contingencia = record(payload.contingencia)
  const exactRef = record(contingencia.exactBytesRef)
  if (
    payload.executeAutomatico !== false ||
    str(contingencia.estado) !== CONTINGENCIA_OUTBOX_ESTADO ||
    str(contingencia.chave) !== issue.chave ||
    str(contingencia.sha256) !== issue.sha256 ||
    Number(contingencia.tpEmis) !== CONTINGENCIA_TP_EMIS ||
    str(exactRef.kind) !== "NotaFiscal.xmlAssinado" ||
    str(exactRef.notaFiscalId) !== nota.id ||
    exactRef.rebuildForbidden !== true
  ) {
    return inconsistente(storeId, issue.chave, "Metadata da outbox persistida está incompleta ou divergente.", {
      notaFiscalId: nota.id,
      jobId: job.id,
    })
  }
  return null
}

function interpretExisting(input: {
  storeId: string
  vendaId: string
  issue: ContingenciaOutboxIssue
  nota: NotaRow | null
  job: JobRow | null
}): PersistNfceContingenciaOutboxResult | { kind: "missing" } {
  const { storeId, vendaId, issue, nota, job } = input
  if (!nota && !job) return { kind: "missing" }

  if (!nota || !job) {
    return inconsistente(
      storeId,
      issue.chave,
      "Par documento+outbox incompleto; recusado para não completar parcialmente.",
      { notaFiscalId: nota?.id ?? null, jobId: job?.id ?? null },
    )
  }

  const broken = pairIsDormantContingencia({ storeId, vendaId, issue, nota, job })
  if (broken) return broken
  return toSuccess({ kind: "idempotent", storeId, vendaId, nota, job, issue })
}

async function createPair(
  tx: ContingenciaOutboxTx,
  input: {
    storeId: string
    vendaId: string
    ambiente: PersistNfceContingenciaOutboxInput["ambiente"]
    issue: ContingenciaOutboxIssue
    xml: string
  },
): Promise<{ nota: NotaRow; job: JobRow }> {
  const localKey = buildContingenciaDocumentoLocalKey(input.storeId, input.issue.chave)
  const dedupeKey = buildContingenciaOutboxDedupeKey(input.issue.chave)
  const dhContDate = parseDhCont(input.issue.dhCont)
  if (!dhContDate) {
    throw new Error("dhCont inválido após validação.")
  }

  const nota = asNota(
    await tx.notaFiscal.create({
      data: {
        storeId: input.storeId,
        vendaId: input.vendaId,
        modelo: "NFCE",
        ambiente: input.ambiente,
        tipoEmissao: "CONTINGENCIA_OFFLINE",
        status: "CONTINGENCIA",
        vigente: true,
        serie: input.issue.serie,
        numero: input.issue.nNF,
        chaveAcesso: input.issue.chave,
        xmlAssinado: input.xml,
        localKey,
        dataContingencia: dhContDate,
        justContingencia: input.issue.xJust,
      },
      select: {
        id: true,
        storeId: true,
        vendaId: true,
        chaveAcesso: true,
        xmlAssinado: true,
        status: true,
        tipoEmissao: true,
        localKey: true,
      },
    }),
  )
  if (!nota) {
    throw new Error("Falha ao persistir NotaFiscal de contingência.")
  }

  const payload = buildPayload({
    storeId: input.storeId,
    vendaId: input.vendaId,
    notaFiscalId: nota.id,
    issue: input.issue,
  })

  const job = asJob(
    await tx.fiscalEmissaoJob.create({
      data: {
        storeId: input.storeId,
        vendaId: input.vendaId,
        notaFiscalId: nota.id,
        tipo: CONTINGENCIA_OUTBOX_JOB_TIPO,
        status: CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE,
        tentativas: 0,
        maxTentativas: 5,
        prioridade: 0,
        proximaTentativaEm: null,
        lockOwner: null,
        lockedAt: null,
        lockExpiresAt: null,
        dedupeKey,
        payload,
      },
      select: {
        id: true,
        storeId: true,
        vendaId: true,
        notaFiscalId: true,
        tipo: true,
        status: true,
        dedupeKey: true,
        payload: true,
        proximaTentativaEm: true,
      },
    }),
  )
  if (!job) {
    throw new Error("Falha ao persistir job dormente de contingência.")
  }

  await tx.fiscalLog.create({
    data: {
      storeId: input.storeId,
      vendaId: input.vendaId,
      notaFiscalId: nota.id,
      jobId: job.id,
      nivel: "INFO",
      acao: "fiscal.contingencia.outbox.persistido",
      mensagem: "NFC-e de contingência persistida com outbox dormente.",
      detalhe: {
        chave: input.issue.chave,
        sha256: input.issue.sha256,
        estado: CONTINGENCIA_OUTBOX_ESTADO,
        jobTipo: CONTINGENCIA_OUTBOX_JOB_TIPO,
        executeAutomatico: false,
        deadlineKind: deadlinePersistido().kind,
      },
    },
  })

  return { nota, job }
}

async function persistInTransaction(
  tx: ContingenciaOutboxTx,
  input: {
    storeId: string
    vendaId: string
    ambiente: PersistNfceContingenciaOutboxInput["ambiente"]
    issue: ContingenciaOutboxIssue
    xml: string
  },
): Promise<PersistNfceContingenciaOutboxResult> {
  const queued = applyContingenciaEvent("EMITIDO_LOCAL", "ENFILEIRAR_TX")
  if (!queued.ok || queued.to !== CONTINGENCIA_OUTBOX_ESTADO) {
    return fail("transicao_invalida", "A máquina 020A não autoriza EMITIDO_LOCAL → PENDENTE_TX.", {
      storeId: input.storeId,
      chave: input.issue.chave,
    })
  }

  const dedupeKey = buildContingenciaOutboxDedupeKey(input.issue.chave)
  const existingNota = await findNotaByStoreChave(tx, input.storeId, input.issue.chave)
  const existingJob = await findJobByDedupe(tx, input.storeId, dedupeKey)
  const interpreted = interpretExisting({
    storeId: input.storeId,
    vendaId: input.vendaId,
    issue: input.issue,
    nota: existingNota,
    job: existingJob,
  })
  if ("ok" in interpreted) return interpreted

  const created = await createPair(tx, input)
  return toSuccess({
    kind: "created",
    storeId: input.storeId,
    vendaId: input.vendaId,
    nota: created.nota,
    job: created.job,
    issue: input.issue,
  })
}

/**
 * Persiste exactBytes da NFC-e em contingência e cria o job dormente de transmissão.
 * Operação atômica. Não chama worker, não transmite, não reconstrói XML.
 */
export async function persistNfceContingenciaOutbox(
  input: PersistNfceContingenciaOutboxInput,
  dependencies: { client?: ContingenciaOutboxClient } = {},
): Promise<PersistNfceContingenciaOutboxResult> {
  const validated = validateInput(input)
  if (!validated.ok) return validated

  const { storeId, vendaId, issue, xml } = validated
  const client = dependencies.client ?? (prisma as unknown as ContingenciaOutboxClient)

  try {
    return await client.$transaction((tx) =>
      persistInTransaction(tx, {
        storeId,
        vendaId,
        ambiente: input.ambiente,
        issue,
        xml,
      }),
    )
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error
    }
    const nota = await findNotaByStoreChave(client, storeId, issue.chave)
    const job = await findJobByDedupe(client, storeId, buildContingenciaOutboxDedupeKey(issue.chave))
    const interpreted = interpretExisting({ storeId, vendaId, issue, nota, job })
    if ("ok" in interpreted) return interpreted
    return fail(
      "identidade_fiscal_conflito",
      "Identidade fiscal colidiu e não pôde ser reconciliada sem sobrescrever.",
      { storeId, chave: issue.chave, sha256Informado: issue.sha256 },
    )
  }
}
