/**
 * GOAL 020D — reconciliação fail-closed da NFC-e em contingência.
 *
 * Mock in-memory. Sem SEFAZ, sem worker, sem rede, sem schema.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async () => {
      throw new Error("prisma real não deve ser usado neste teste")
    }),
  },
}))

import { persistNfceContingenciaOutbox } from "../contingencia-outbox"
import { CONTINGENCIA_TP_EMIS } from "../contingencia/types"
import { applyContingenciaEvent, evaluateUnknown } from "../contingencia"
import { parseSefazSoapResponse } from "../provider/sefaz/sefaz-response-parser"
import * as F from "../provider/sefaz/__fixtures__/sefaz-soap-fixtures"
import {
  CONTINGENCIA_EVIDENCE_PRECEDENCE,
  RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND,
  decideContingenciaReconciliation,
  deriveEvidenceKind,
  reconcileNfceContingenciaOffline,
  type ContingenciaConsultaSanitizada,
  type ReconcileNfceContingenciaInput,
} from "./index"
import type { ContingenciaOutboxIssue, PersistNfceContingenciaOutboxInput } from "../contingencia-outbox"

const STORE_A = "loja-1"
const STORE_B = "loja-2"
const VENDA_A = "venda-1"
const CHAVE_A = "35260611222333000181650010000000559000000070"
const CHAVE_B = "35260611222333000181650010000000559000000081"
const DH_EMI = "2026-08-14T10:00:00-03:00"
const DH_CONT = "2026-08-16T15:00:00-03:00"
const X_JUST = "Falha de conectividade com a SEFAZ"
const OBSERVED_AT = "2026-08-16T23:30:00.000Z"

const CONSEQ_INDETERMINADA = {
  terminal: false,
  numeroConsumido: false,
  requiresInutilizacao: false,
  requiresConsultation: true,
} as const

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function xmlIdentidade(input: { chave?: string; nNF?: number; serie?: number; marker?: string }): string {
  const chave = input.chave ?? CHAVE_A
  const nNF = input.nNF ?? 55
  const serie = input.serie ?? 1
  const marker = input.marker ?? "bytes-exatos"
  return `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}"><ide><tpEmis>9</tpEmis><serie>${serie}</serie><nNF>${nNF}</nNF></ide><marker>${marker}</marker></infNFe></NFe>`
}

function issue(over: Partial<ContingenciaOutboxIssue> & { xml?: string } = {}): ContingenciaOutboxIssue {
  const chave = over.chave ?? CHAVE_A
  const nNF = over.nNF ?? 55
  const serie = over.serie ?? 1
  const xml = over.xml ?? xmlIdentidade({ chave, nNF, serie })
  const exactBytes = over.exactBytes ?? Uint8Array.from(Buffer.from(xml, "utf8"))
  return {
    exactBytes,
    sha256: over.sha256 ?? sha256Hex(exactBytes),
    chave,
    tpEmis: over.tpEmis ?? CONTINGENCIA_TP_EMIS,
    dhEmi: over.dhEmi ?? DH_EMI,
    dhCont: over.dhCont ?? DH_CONT,
    xJust: over.xJust ?? X_JUST,
    nNF,
    serie,
  }
}

function persistInput(
  over: Partial<PersistNfceContingenciaOutboxInput> = {},
): PersistNfceContingenciaOutboxInput {
  return { storeId: STORE_A, vendaId: VENDA_A, ambiente: "HOMOLOGACAO", offline: issue(), ...over }
}

function consulta(over: Partial<ContingenciaConsultaSanitizada> = {}): ContingenciaConsultaSanitizada {
  return {
    outcome: "UNCERTAIN",
    reason: "UNKNOWN",
    servico: "NFeConsultaProtocolo4",
    cStat: null,
    xMotivo: null,
    protocolo: null,
    xmlAutorizado: null,
    consequencias: CONSEQ_INDETERMINADA,
    ...over,
  }
}

function consultaNotFound(): ContingenciaConsultaSanitizada {
  return consulta({
    outcome: "NOT_FOUND",
    reason: "NAO_CONSTA",
    cStat: "217",
    xMotivo: "NF-e nao consta na base de dados da SEFAZ",
    consequencias: {
      terminal: false,
      numeroConsumido: false,
      requiresInutilizacao: false,
      requiresConsultation: false,
    },
  })
}

function consultaAuthorized(chave = CHAVE_A): ContingenciaConsultaSanitizada {
  return consulta({
    outcome: "AUTHORIZED",
    reason: "AUTORIZADO",
    cStat: "100",
    xMotivo: "Autorizado o uso da NF-e",
    protocolo: F.PROTOCOLO_SINTETICO,
    xmlAutorizado: `<nfeProc><NFe><infNFe Id="NFe${chave}"></infNFe></NFe><protNFe><infProt><nProt>${F.PROTOCOLO_SINTETICO}</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`,
    consequencias: {
      terminal: true,
      numeroConsumido: true,
      requiresInutilizacao: false,
      requiresConsultation: false,
    },
  })
}

function consultaRejectedFinal(): ContingenciaConsultaSanitizada {
  return consulta({
    outcome: "REJECTED",
    reason: "REJEICAO_TERMINAL",
    cStat: "110",
    xMotivo: "Uso denegado",
    consequencias: {
      terminal: true,
      numeroConsumido: true,
      requiresInutilizacao: false,
      requiresConsultation: false,
    },
  })
}

function reconcileInput(
  over: Partial<ReconcileNfceContingenciaInput> = {},
): ReconcileNfceContingenciaInput {
  return {
    storeId: STORE_A,
    chave: CHAVE_A,
    evidenceKind: "UNKNOWN",
    observedAt: OBSERVED_AT,
    consulta: consulta(),
    ...over,
  }
}

type NotaRow = {
  id: string
  storeId: string
  vendaId: string
  tipoEmissao: string
  status: string
  serie: number
  numero: number
  chaveAcesso: string
  xmlAssinado: string
  protocolo: string | null
  cStat?: string | null
  xMotivo?: string | null
  xmlAutorizado?: string | null
  ultimoErro?: string | null
  localKey?: string
}

type JobRow = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string
  tipo: string
  status: string
  proximaTentativaEm: Date | null
  lockOwner: string | null
  lockedAt: Date | null
  lockExpiresAt: Date | null
  dedupeKey: string
  payload: Record<string, unknown>
  concluidoEm?: Date | null
  ultimoErro?: string | null
}

type LogRow = { id: string; storeId: string; acao: string; detalhe: Record<string, unknown> }
type DbState = { notas: NotaRow[]; jobs: JobRow[]; logs: LogRow[] }

class UniqueConflict extends Error {
  readonly code = "P2002"
  constructor(message: string) {
    super(message)
    this.name = "UniqueConflict"
  }
}

function cloneState(state: DbState): DbState {
  return structuredClone(state)
}

function createMockClient(options: { failOn?: "nota" | "job" | "log" | null } = {}) {
  const committed: DbState = { notas: [], jobs: [], logs: [] }
  let seq = 0
  const flags = { failOn: options.failOn ?? null }
  const writes = { nota: 0, job: 0, log: 0 }

  function api(store: DbState) {
    return {
      notaFiscal: {
        findFirst: vi.fn(async (args: { where: { storeId: string; chaveAcesso: string } }) => {
          return store.notas.find((n) => n.storeId === args.where.storeId && n.chaveAcesso === args.where.chaveAcesso) ?? null
        }),
        create: vi.fn(async (args: { data: Omit<NotaRow, "id"> }) => {
          writes.nota += 1
          if (flags.failOn === "nota") throw new Error("nota write failed")
          if (store.notas.some((n) => n.chaveAcesso === args.data.chaveAcesso)) throw new UniqueConflict("chaveAcesso")
          seq += 1
          const row = { ...args.data, id: `nota-${seq}` } as NotaRow
          if (row.protocolo === undefined) row.protocolo = null
          store.notas.push(row)
          return row
        }),
        updateMany: vi.fn(async (args: { where: { id: string; storeId: string; chaveAcesso?: string }; data: Partial<NotaRow> }) => {
          writes.nota += 1
          if (flags.failOn === "nota") throw new Error("nota write failed")
          let count = 0
          for (const nota of store.notas) {
            if (
              nota.id === args.where.id &&
              nota.storeId === args.where.storeId &&
              (args.where.chaveAcesso == null || nota.chaveAcesso === args.where.chaveAcesso)
            ) {
              Object.assign(nota, args.data)
              count += 1
            }
          }
          return { count }
        }),
      },
      fiscalEmissaoJob: {
        findUnique: vi.fn(async (args: { where: { storeId_dedupeKey: { storeId: string; dedupeKey: string } } }) => {
          const { storeId, dedupeKey } = args.where.storeId_dedupeKey
          return store.jobs.find((j) => j.storeId === storeId && j.dedupeKey === dedupeKey) ?? null
        }),
        findFirst: vi.fn(async (args: { where: { storeId: string; dedupeKey?: string } }) => {
          return store.jobs.find((j) => j.storeId === args.where.storeId && (args.where.dedupeKey == null || j.dedupeKey === args.where.dedupeKey)) ?? null
        }),
        create: vi.fn(async (args: { data: Omit<JobRow, "id"> }) => {
          writes.job += 1
          if (flags.failOn === "job") throw new Error("job write failed")
          if (store.jobs.some((j) => j.storeId === args.data.storeId && j.dedupeKey === args.data.dedupeKey)) {
            throw new UniqueConflict("dedupeKey")
          }
          seq += 1
          const row: JobRow = { id: `job-${seq}`, ...args.data }
          store.jobs.push(row)
          return row
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Partial<JobRow> }) => {
          writes.job += 1
          if (flags.failOn === "job") throw new Error("job write failed")
          const job = store.jobs.find((j) => j.id === args.where.id)
          if (!job) throw new Error("job not found")
          Object.assign(job, args.data)
          return job
        }),
      },
      fiscalLog: {
        create: vi.fn(async (args: { data: Omit<LogRow, "id"> }) => {
          writes.log += 1
          if (flags.failOn === "log") throw new Error("log write failed")
          seq += 1
          const row = { id: `log-${seq}`, ...args.data }
          store.logs.push(row)
          return row
        }),
      },
    }
  }

  const client = {
    ...api(committed),
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof api>) => Promise<unknown>) => {
      const draft = cloneState(committed)
      const tx = api(draft)
      const result = await fn(tx)
      committed.notas = draft.notas
      committed.jobs = draft.jobs
      committed.logs = draft.logs
      return result
    }),
    _state: committed,
    _writes: writes,
    _flags: flags,
  }
  return client
}

function workerEligible(job: JobRow, now = new Date()): boolean {
  if (job.status === "PENDENTE") {
    const due = job.proximaTentativaEm == null || job.proximaTentativaEm.getTime() <= now.getTime()
    const unlocked = job.lockExpiresAt == null || job.lockExpiresAt.getTime() <= now.getTime()
    return due && unlocked
  }
  if (job.status === "AGUARDANDO_RETRY") {
    return Boolean(job.proximaTentativaEm && job.proximaTentativaEm.getTime() <= now.getTime())
  }
  return false
}

async function seedOutbox(client: ReturnType<typeof createMockClient>, over: Partial<PersistNfceContingenciaOutboxInput> = {}) {
  const result = await persistNfceContingenciaOutbox(persistInput(over), { client: client as never })
  expect(result.ok).toBe(true)
  return result
}

describe("classificador oficial · NOT_FOUND explícito", () => {
  it("217 em consulta oficial deriva NOT_FOUND", () => {
    const parsed = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_NAO_CONSTA_217,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(parsed.outcome).toBe("NOT_FOUND")
    expect(parsed.reason).toBe("NAO_CONSTA")
    expect(deriveEvidenceKind(consultaNotFound())).toBe("NOT_FOUND")
  })

  it("timeout, SOAP Fault, malformed e cStat desconhecido NÃO derivam NOT_FOUND", () => {
    expect(
      deriveEvidenceKind(consulta({ outcome: "UNCERTAIN", reason: "UNKNOWN", uncertainCode: "TIMEOUT" })),
    ).toBe("UNKNOWN")
    const soap = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.SOAP_FAULT,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(soap.reason).toBe("SOAP_FAULT")
    expect(deriveEvidenceKind({ ...consulta({ outcome: soap.outcome, reason: soap.reason }), servico: "NFeConsultaProtocolo4" })).toBe(
      "UNKNOWN",
    )
    const malformed = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.XML_TRUNCADO,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(malformed.reason).toBe("MALFORMED_RESPONSE")
    expect(deriveEvidenceKind(consulta({ outcome: malformed.outcome, reason: malformed.reason }))).toBe("UNKNOWN")
    expect(deriveEvidenceKind(consulta({ outcome: "UNCERTAIN", reason: "UNKNOWN", cStat: "999" }))).toBe("UNKNOWN")
  })

  it("AUTHORIZED sem protocolo válido não deriva AUTHORIZED", () => {
    expect(deriveEvidenceKind(consultaAuthorized())).toBe("AUTHORIZED")
    expect(deriveEvidenceKind({ ...consultaAuthorized(), protocolo: null })).toBe("UNKNOWN")
    expect(deriveEvidenceKind({ ...consultaAuthorized(), protocolo: "ABC" })).toBe("UNKNOWN")
    expect(deriveEvidenceKind({ ...consultaAuthorized(), xmlAutorizado: null })).toBe("UNKNOWN")
  })
})

describe("precedência de evidências", () => {
  it("terminais têm o mesmo rank e vencem NOT_FOUND/UNKNOWN", () => {
    expect(CONTINGENCIA_EVIDENCE_PRECEDENCE.AUTHORIZED).toBe(CONTINGENCIA_EVIDENCE_PRECEDENCE.REJECTED_FINAL)
    expect(CONTINGENCIA_EVIDENCE_PRECEDENCE.AUTHORIZED).toBeGreaterThan(CONTINGENCIA_EVIDENCE_PRECEDENCE.NOT_FOUND)
    expect(CONTINGENCIA_EVIDENCE_PRECEDENCE.NOT_FOUND).toBeGreaterThan(CONTINGENCIA_EVIDENCE_PRECEDENCE.UNKNOWN)
  })

  it("UNKNOWN 020A permanece fail-closed e pode CONSULTAR", () => {
    const u = evaluateUnknown()
    expect(u.retryAutomatico).toBe(false)
    expect(u.autorizaNovaEmissaoAutomatica).toBe(false)
    expect(u.podeConsultar).toBe(true)
    expect(u.podeRetomarTxDireto).toBe(false)
    const tx = applyContingenciaEvent("UNKNOWN", "INICIAR_TX")
    expect(tx.ok).toBe(false)
  })
})

describe("reconcileNfceContingenciaOffline · AUTHORIZED", () => {
  it("AUTHORIZED válido → AUTORIZADO_POST, protocolo registrado, exactBytes intactos, job encerrado", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const xmlAntes = client._state.notas[0]!.xmlAssinado
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "AUTHORIZED", consulta: consultaAuthorized() }),
      { client: client as never },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.estadoFinal).toBe("AUTORIZADO_POST")
    expect(result.protocoloRegistrado).toBe(true)
    expect(result.eligibilityCreated).toBe(false)
    expect(result.retryAutomatico).toBe(false)
    expect(client._state.notas[0]!.status).toBe("AUTORIZADA")
    expect(client._state.notas[0]!.protocolo).toBe(F.PROTOCOLO_SINTETICO)
    expect(client._state.notas[0]!.xmlAssinado).toBe(xmlAntes)
    expect(client._state.jobs[0]!.status).toBe("CONCLUIDO")
    expect(client._state.jobs[0]!.proximaTentativaEm).toBeNull()
    expect(workerEligible(client._state.jobs[0]!)).toBe(false)
    expect(client._state.jobs).toHaveLength(1)
  })

  it("AUTHORIZED sem protocolo obrigatório é fail-closed e não grava autorização", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({
        evidenceKind: "AUTHORIZED",
        consulta: { ...consultaAuthorized(), protocolo: null },
      }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("deveria falhar")
    expect(result.code).toBe("autorizacao_sem_protocolo")
    expect(client._state.notas[0]!.status).toBe("CONTINGENCIA")
    expect(client._state.notas[0]!.protocolo).toBeNull()
    expect(client._state.jobs[0]!.status).toBe("AGUARDANDO_RETRY")
  })
})

describe("reconcileNfceContingenciaOffline · REJECTED_FINAL", () => {
  it("REJECTED_FINAL → REJEITADO_DEF, não retransmite, exige intervenção humana", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const xmlAntes = client._state.notas[0]!.xmlAssinado
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "REJECTED_FINAL", consulta: consultaRejectedFinal() }),
      { client: client as never },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.estadoFinal).toBe("REJEITADO_DEF")
    expect(result.requiresHumanIntervention).toBe(true)
    expect(result.eligibilityCreated).toBe(false)
    expect(result.retryAutomatico).toBe(false)
    expect(client._state.notas[0]!.status).toBe("REJEITADA")
    expect(client._state.notas[0]!.xmlAssinado).toBe(xmlAntes)
    expect(client._state.jobs[0]!.status).toBe("FALHA")
    expect(client._state.jobs[0]!.proximaTentativaEm).toBeNull()
    expect(workerEligible(client._state.jobs[0]!)).toBe(false)
    expect(client._state.jobs).toHaveLength(1)
  })
})

describe("reconcileNfceContingenciaOffline · UNKNOWN fail-closed", () => {
  it("UNKNOWN permanece sem retry/transmissão e pode receber nova CONSULTA", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const result = await reconcileNfceContingenciaOffline(reconcileInput({ evidenceKind: "UNKNOWN" }), {
      client: client as never,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.estadoFinal).toBe("PENDENTE_TX")
    expect(result.retryAutomatico).toBe(false)
    expect(result.executeAutomatico).toBe(false)
    expect(result.eligibilityCreated).toBe(false)
    const job = client._state.jobs[0]!
    expect(job.status).toBe("AGUARDANDO_RETRY")
    expect(job.proximaTentativaEm).toBeNull()
    expect(workerEligible(job)).toBe(false)
    const contingencia = (job.payload as { contingencia: Record<string, unknown> }).contingencia
    expect(contingencia.podeConsultar).toBe(true)
    expect(contingencia.lastEvidenceKind).toBe("UNKNOWN")
    expect(applyContingenciaEvent("UNKNOWN", "INICIAR_TX").ok).toBe(false)
  })

  it("timeout ≠ NOT_FOUND", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const claimed = await reconcileNfceContingenciaOffline(
      reconcileInput({
        evidenceKind: "NOT_FOUND",
        consulta: consulta({ outcome: "UNCERTAIN", reason: "UNKNOWN", uncertainCode: "TIMEOUT" }),
      }),
      { client: client as never },
    )
    expect(claimed.ok).toBe(false)
    if (claimed.ok) throw new Error("timeout não pode virar NOT_FOUND")
    expect(claimed.code).toBe("not_found_nao_explicito")
    expect(client._state.jobs[0]!.payload).not.toMatchObject({
      contingencia: { retransmissionEligibility: { kind: RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND } },
    })
  })

  it("SOAP Fault ≠ NOT_FOUND", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const soap = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.SOAP_FAULT,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({
        evidenceKind: "NOT_FOUND",
        consulta: consulta({ outcome: soap.outcome, reason: soap.reason }),
      }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("not_found_nao_explicito")
  })

  it("malformed ≠ NOT_FOUND", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const malformed = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.XML_TRUNCADO,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({
        evidenceKind: "NOT_FOUND",
        consulta: consulta({ outcome: malformed.outcome, reason: malformed.reason }),
      }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("not_found_nao_explicito")
  })

  it("cStat desconhecido ≠ NOT_FOUND", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({
        evidenceKind: "NOT_FOUND",
        consulta: consulta({ outcome: "UNCERTAIN", reason: "UNKNOWN", cStat: "999" }),
      }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("not_found_nao_explicito")
  })
})

describe("reconcileNfceContingenciaOffline · NOT_FOUND elegibilidade dormente", () => {
  it("NOT_FOUND cria apenas elegibilidade single-use, sem acordar worker nem PENDENTE", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const xmlAntes = client._state.notas[0]!.xmlAssinado
    const sha256 = sha256Hex(Uint8Array.from(Buffer.from(xmlAntes, "utf8")))
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.eligibilityCreated).toBe(true)
    expect(result.eligibility?.kind).toBe(RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND)
    expect(result.eligibility?.consumedAt).toBeNull()
    expect(result.eligibility?.singleUse).toBe(true)
    expect(result.eligibility?.executeAutomatico).toBe(false)
    expect(result.eligibility?.storeId).toBe(STORE_A)
    expect(result.eligibility?.chave).toBe(CHAVE_A)
    expect(result.eligibility?.sha256).toBe(sha256)
    expect(result.estadoFinal).toBe("PENDENTE_TX")
    const job = client._state.jobs[0]!
    expect(job.status).toBe("AGUARDANDO_RETRY")
    expect(job.status).not.toBe("PENDENTE")
    expect(job.proximaTentativaEm).toBeNull()
    expect(workerEligible(job)).toBe(false)
    expect((job.payload as { executeAutomatico: boolean }).executeAutomatico).toBe(false)
    expect((job.payload as { transmission: { retryAuthorizedAt?: unknown } }).transmission.retryAuthorizedAt).toBeUndefined()
    expect(client._state.notas[0]!.xmlAssinado).toBe(xmlAntes)
    expect(client._state.notas[0]!.status).toBe("CONTINGENCIA")
    expect(client._state.jobs).toHaveLength(1)
  })

  it("ausência de linha local não fabrica NOT_FOUND", async () => {
    const client = createMockClient()
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("documento_ausente")
    expect(client._state.jobs).toHaveLength(0)
  })
})

describe("reconcileNfceContingenciaOffline · idempotência e conflito", () => {
  it("evidência repetida é idempotente", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const first = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    const logs = client._state.logs.length
    const second = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(first.ok && first.kind).toBe("applied")
    expect(second.ok && second.kind).toBe("idempotent")
    if (!second.ok) throw new Error(second.mensagem)
    expect(second.eligibilityCreated).toBe(false)
    expect(second.eligibility?.consumedAt).toBeNull()
    expect(client._state.jobs).toHaveLength(1)
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.logs.length).toBe(logs)
  })

  it("AUTHORIZED persistido + NOT_FOUND posterior não reabre transmissão", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    const authorized = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "AUTHORIZED", consulta: consultaAuthorized() }),
      { client: client as never },
    )
    expect(authorized.ok).toBe(true)
    const xmlAntes = client._state.notas[0]!.xmlAssinado
    const conflict = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe("estado_terminal_nao_reabre")
    expect(client._state.notas[0]!.status).toBe("AUTORIZADA")
    expect(client._state.notas[0]!.xmlAssinado).toBe(xmlAntes)
    expect(client._state.jobs[0]!.status).toBe("CONCLUIDO")
    expect(workerEligible(client._state.jobs[0]!)).toBe(false)
  })

  it("REJECTED_FINAL + UNKNOWN posterior não apaga rejeição definitiva", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "REJECTED_FINAL", consulta: consultaRejectedFinal() }),
      { client: client as never },
    )
    const conflict = await reconcileNfceContingenciaOffline(reconcileInput({ evidenceKind: "UNKNOWN" }), {
      client: client as never,
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe("estado_terminal_nao_reabre")
    expect(client._state.notas[0]!.status).toBe("REJEITADA")
    expect((client._state.jobs[0]!.payload as { contingencia: { estado: string } }).contingencia.estado).toBe(
      "REJEITADO_DEF",
    )
  })

  it("par exactBytes inconsistente bloqueia e não repara", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    client._state.notas[0]!.xmlAssinado = xmlIdentidade({ marker: "adulterado" })
    const result = await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(["par_inconsistente", "chave_bytes_conflito"]).toContain(result.code)
    expect((client._state.jobs[0]!.payload as { contingencia: { retransmissionEligibility?: unknown } }).contingencia.retransmissionEligibility).toBeUndefined()
  })
})

describe("reconcileNfceContingenciaOffline · multi-loja e atomicidade", () => {
  it("isolamento por storeId", async () => {
    const client = createMockClient()
    await seedOutbox(client, { storeId: STORE_A, offline: issue({ chave: CHAVE_A }) })
    const fromB = await reconcileNfceContingenciaOffline(
      reconcileInput({ storeId: STORE_B, chave: CHAVE_A, evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(fromB.ok).toBe(false)
    if (!fromB.ok) expect(fromB.code).toBe("documento_ausente")
    expect(client._state.notas[0]!.storeId).toBe(STORE_A)
    expect((client._state.jobs[0]!.payload as { contingencia: { retransmissionEligibility?: unknown } }).contingencia.retransmissionEligibility).toBeUndefined()
  })

  it("falha em qualquer write faz rollback e não consome autorização", async () => {
    const client = createMockClient()
    await seedOutbox(client)
    client._flags.failOn = "log"
    await expect(
      reconcileNfceContingenciaOffline(
        reconcileInput({ evidenceKind: "AUTHORIZED", consulta: consultaAuthorized() }),
        { client: client as never },
      ),
    ).rejects.toThrow("log write failed")
    expect(client._state.notas[0]!.status).toBe("CONTINGENCIA")
    expect(client._state.notas[0]!.protocolo).toBeNull()
    expect(client._state.jobs[0]!.status).toBe("AGUARDANDO_RETRY")
    expect(client._state.jobs[0]!.proximaTentativaEm).toBeNull()
    expect(
      (client._state.jobs[0]!.payload as { contingencia: { retransmissionEligibility?: unknown } }).contingencia
        .retransmissionEligibility,
    ).toBeUndefined()
  })
})

describe("reconcileNfceContingenciaOffline · zero rede / schema / worker", () => {
  it("não chama fetch nem persiste SOAP/segredo", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const client = createMockClient()
    await seedOutbox(client)
    await reconcileNfceContingenciaOffline(
      reconcileInput({ evidenceKind: "NOT_FOUND", consulta: consultaNotFound() }),
      { client: client as never },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    const log = JSON.stringify(client._state.logs)
    expect(log).not.toMatch(/<soap|pfx|private[_ -]?key|certificado/i)
  })

  it("fonte não toca schema, H-9/H-10, SOAP de transmissão nem worker", () => {
    const dir = join(process.cwd(), "lib/fiscal/contingencia-reconciliacao")
    for (const file of ["persist.ts", "evidence.ts", "decision.ts", "integrity.ts", "types.ts"]) {
      const src = readFileSync(join(dir, file), "utf8")
      expect(src).not.toMatch(/schema\.prisma|prisma migrate/)
      expect(src).not.toMatch(/wsdl-ephemeral|H-9|H-10/)
      expect(src).not.toMatch(/NFeAutorizacao4|sefaz-soap-transport|sefaz-direto-provider/)
      expect(src).not.toMatch(/drainFiscalQueue|prisma-queue-worker|fetch\(|http\.request|net\.connect/)
      expect(src).not.toMatch(/parseSefazSoapResponse/)
    }
  })
})

describe("decisão pura 020A", () => {
  it("não inventa TX_ANDAMENTO", () => {
    const r = decideContingenciaReconciliation({
      from: "PENDENTE_TX",
      evidenceKind: "NOT_FOUND",
      persistedEvidence: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.to).not.toBe("TX_ANDAMENTO")
      expect(r.retryAutomatico).toBe(false)
      expect(r.eligibilityCreated).toBe(true)
    }
    const unknownTx = decideContingenciaReconciliation({
      from: "TX_ANDAMENTO",
      evidenceKind: "NOT_FOUND",
      persistedEvidence: null,
    })
    expect(unknownTx.ok).toBe(false)
  })
})
