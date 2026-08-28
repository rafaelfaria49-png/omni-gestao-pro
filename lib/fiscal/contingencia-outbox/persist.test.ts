/**
 * GOAL 020C — persistência transacional e outbox dormente da NFC-e em contingência.
 *
 * Mock in-memory. Sem banco produtivo, sem worker, sem rede, sem rebuild de XML.
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

import { CONTINGENCIA_TP_EMIS, NEXT_BUSINESS_DAY } from "../contingencia/types"
import {
  buildContingenciaDocumentoLocalKey,
  buildContingenciaOutboxDedupeKey,
  persistNfceContingenciaOutbox,
  type ContingenciaOutboxIssue,
  type PersistNfceContingenciaOutboxInput,
} from "./index"

const STORE_A = "loja-1"
const STORE_B = "loja-2"
const VENDA_A = "venda-1"
/** 44 dígitos; posição 35 (índice 34) = tpEmis 9. */
const CHAVE_A = "35260611222333000181650010000000559000000070"
const CHAVE_B = "35260611222333000181650010000000559000000081"
const DH_EMI = "2026-08-14T10:00:00-03:00"
const DH_CONT = "2026-08-16T15:00:00-03:00"
const X_JUST = "Falha de conectividade com a SEFAZ"

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function xmlIdentidade(input: {
  chave?: string
  nNF?: number
  serie?: number
  marker?: string
}): string {
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
  const xml =
    over.xml ??
    xmlIdentidade({ chave, nNF, serie })
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
  return {
    storeId: STORE_A,
    vendaId: VENDA_A,
    ambiente: "HOMOLOGACAO",
    offline: issue(),
    ...over,
  }
}

type NotaRow = {
  id: string
  storeId: string
  vendaId: string
  modelo: string
  ambiente: string
  tipoEmissao: string
  status: string
  vigente: boolean
  serie: number
  numero: number
  chaveAcesso: string
  xmlAssinado: string
  localKey: string
  dataContingencia: Date
  justContingencia: string
}

type JobRow = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string
  tipo: string
  status: string
  tentativas: number
  maxTentativas: number
  prioridade: number
  proximaTentativaEm: Date | null
  lockOwner: string | null
  lockedAt: Date | null
  lockExpiresAt: Date | null
  dedupeKey: string
  payload: Record<string, unknown>
}

type LogRow = {
  id: string
  storeId: string
  vendaId: string
  notaFiscalId: string
  jobId: string
  acao: string
  detalhe: Record<string, unknown>
}

type DbState = {
  notas: NotaRow[]
  jobs: JobRow[]
  logs: LogRow[]
}

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
  const failOn = options.failOn ?? null
  const writes = { nota: 0, job: 0, log: 0 }

  function api(store: DbState) {
    return {
      notaFiscal: {
        findFirst: vi.fn(async (args: { where: { storeId: string; chaveAcesso: string } }) => {
          return (
            store.notas.find(
              (n) => n.storeId === args.where.storeId && n.chaveAcesso === args.where.chaveAcesso,
            ) ?? null
          )
        }),
        create: vi.fn(async (args: { data: Omit<NotaRow, "id">; select: unknown }) => {
          writes.nota += 1
          if (failOn === "nota") throw new Error("nota write failed")
          if (store.notas.some((n) => n.chaveAcesso === args.data.chaveAcesso)) {
            throw new UniqueConflict("chaveAcesso")
          }
          if (
            store.notas.some(
              (n) => n.storeId === args.data.storeId && n.localKey === args.data.localKey,
            )
          ) {
            throw new UniqueConflict("localKey")
          }
          seq += 1
          const row: NotaRow = { id: `nota-${seq}`, ...args.data }
          store.notas.push(row)
          return row
        }),
      },
      fiscalEmissaoJob: {
        findUnique: vi.fn(async (args: { where: { storeId_dedupeKey: { storeId: string; dedupeKey: string } } }) => {
          const { storeId, dedupeKey } = args.where.storeId_dedupeKey
          return store.jobs.find((j) => j.storeId === storeId && j.dedupeKey === dedupeKey) ?? null
        }),
        findFirst: vi.fn(async (args: { where: { storeId: string; dedupeKey?: string } }) => {
          return (
            store.jobs.find(
              (j) => j.storeId === args.where.storeId && (args.where.dedupeKey == null || j.dedupeKey === args.where.dedupeKey),
            ) ?? null
          )
        }),
        create: vi.fn(async (args: { data: Omit<JobRow, "id">; select: unknown }) => {
          writes.job += 1
          if (failOn === "job") throw new Error("job write failed")
          if (
            store.jobs.some(
              (j) => j.storeId === args.data.storeId && j.dedupeKey === args.data.dedupeKey,
            )
          ) {
            throw new UniqueConflict("dedupeKey")
          }
          seq += 1
          const row: JobRow = { id: `job-${seq}`, ...args.data }
          store.jobs.push(row)
          return row
        }),
      },
      fiscalLog: {
        create: vi.fn(async (args: { data: Omit<LogRow, "id"> }) => {
          writes.log += 1
          if (failOn === "log") throw new Error("log write failed")
          seq += 1
          const row: LogRow = { id: `log-${seq}`, ...args.data }
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

describe("identidade idempotente", () => {
  it("dedupeKey e localKey incluem loja/chave e não incluem sha256", () => {
    const a = buildContingenciaOutboxDedupeKey(CHAVE_A)
    const b = buildContingenciaDocumentoLocalKey(STORE_A, CHAVE_A)
    expect(a).toBe(`fiscal:contingencia-tx:v1:chave:${CHAVE_A}`)
    expect(b).toBe(`nfce-contingencia:${STORE_A}:${CHAVE_A}`)
    expect(a).not.toContain("sha256")
    expect(b).not.toContain(STORE_B)
    expect(buildContingenciaDocumentoLocalKey(STORE_B, CHAVE_A)).not.toBe(b)
  })
})

describe("persistNfceContingenciaOutbox · exactBytes e hash", () => {
  it("persiste exatamente os bytes recebidos e o sha256 informado", async () => {
    const xml = xmlIdentidade({ marker: `bytes-exatos-${Date.now()}` })
    const offline = issue({ xml })
    const client = createMockClient()
    const result = await persistNfceContingenciaOutbox(persistInput({ offline }), {
      client: client as never,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.kind).toBe("created")
    expect(result.sha256).toBe(offline.sha256)
    expect(result.chave).toBe(CHAVE_A)
    expect(result.tpEmis).toBe(9)
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.notas[0]?.xmlAssinado).toBe(xml)
    expect(sha256Hex(Uint8Array.from(Buffer.from(client._state.notas[0]!.xmlAssinado, "utf8")))).toBe(
      offline.sha256,
    )
    expect(Buffer.from(client._state.notas[0]!.xmlAssinado, "utf8")).toEqual(Buffer.from(offline.exactBytes))
  })

  it("sha256 divergente é recusado antes de qualquer write", async () => {
    const offline = issue({ sha256: "a".repeat(64) })
    const client = createMockClient()
    const result = await persistNfceContingenciaOutbox(persistInput({ offline }), {
      client: client as never,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("deveria falhar")
    expect(result.code).toBe("sha256_divergente")
    expect(client._state.notas).toHaveLength(0)
    expect(client._state.jobs).toHaveLength(0)
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it("exige storeId e recusa tpEmis diferente de 9", async () => {
    const client = createMockClient()
    const semLoja = await persistNfceContingenciaOutbox(persistInput({ storeId: "  " }), {
      client: client as never,
    })
    expect(semLoja.ok).toBe(false)
    if (!semLoja.ok) expect(semLoja.code).toBe("store_id_obrigatorio")

    const tpEmis = await persistNfceContingenciaOutbox(
      persistInput({ offline: issue({ tpEmis: 1 as never }) }),
      { client: client as never },
    )
    expect(tpEmis.ok).toBe(false)
    if (!tpEmis.ok) expect(tpEmis.code).toBe("tp_emis_invalido")
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it("recusa exactBytes cuja identidade (chave/nNF/série) diverge do informado", async () => {
    const client = createMockClient()
    const xmlDeOutraChave = xmlIdentidade({ chave: CHAVE_B, marker: "outro-documento" })
    const result = await persistNfceContingenciaOutbox(
      persistInput({ offline: issue({ chave: CHAVE_A, xml: xmlDeOutraChave }) }),
      { client: client as never },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("deveria falhar")
    expect(result.code).toBe("bytes_identidade_divergente")
    expect(client._state.notas).toHaveLength(0)
    expect(client._state.jobs).toHaveLength(0)
    expect(client.$transaction).not.toHaveBeenCalled()
  })
})

describe("persistNfceContingenciaOutbox · idempotência e conflito", () => {
  it("mesma loja/chave/sha256 é sucesso idempotente sem novo documento/job", async () => {
    const client = createMockClient()
    const first = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    const second = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })

    expect(first.ok && first.kind).toBe("created")
    expect(second.ok && second.kind).toBe("idempotent")
    if (!first.ok || !second.ok) throw new Error("ambos deveriam suceder")
    expect(second.notaFiscalId).toBe(first.notaFiscalId)
    expect(second.jobId).toBe(first.jobId)
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.jobs).toHaveLength(1)
  })

  it("mesma chave com sha256 diferente é conflito crítico e não sobrescreve", async () => {
    const client = createMockClient()
    const original = issue({ xml: xmlIdentidade({ marker: "original" }) })
    const first = await persistNfceContingenciaOutbox(persistInput({ offline: original }), {
      client: client as never,
    })
    expect(first.ok).toBe(true)

    const adulterado = issue({ xml: xmlIdentidade({ marker: "adulterado" }) })
    const second = await persistNfceContingenciaOutbox(persistInput({ offline: adulterado }), {
      client: client as never,
    })

    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("deveria conflitar")
    expect(second.code).toBe("chave_bytes_conflito")
    expect(second.sha256Informado).toBe(adulterado.sha256)
    expect(second.sha256Persistido).toBe(original.sha256)
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.notas[0]?.xmlAssinado).toBe(xmlIdentidade({ marker: "original" }))
    expect(client._state.jobs).toHaveLength(1)
  })

  it("par incompleto (documento sem job) não é reparado — falha fechada", async () => {
    const client = createMockClient()
    const first = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(first.ok).toBe(true)
    client._state.jobs.splice(0, client._state.jobs.length)

    const second = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("não deveria reparar")
    expect(second.code).toBe("identidade_fiscal_conflito")
    expect(client._state.jobs).toHaveLength(0)
    expect(client._state.notas).toHaveLength(1)
  })

  it("não trata como idempotente um par com metadata/job incompatíveis", async () => {
    const client = createMockClient()
    const first = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(first.ok).toBe(true)
    const nota = client._state.notas[0]!
    nota.tipoEmissao = "NORMAL"
    nota.status = "RASCUNHO"
    const job = client._state.jobs[0]!
    job.tipo = "EMISSAO"
    job.status = "PENDENTE"

    const second = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("não deveria aceitar par corrompido")
    expect(second.code).toBe("identidade_fiscal_conflito")
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.jobs).toHaveLength(1)
    expect(client._state.notas[0]?.tipoEmissao).toBe("NORMAL")
    expect(client._state.jobs[0]?.tipo).toBe("EMISSAO")
  })

  it("xmlAssinado ausente no documento existente não é idempotente", async () => {
    const client = createMockClient()
    const first = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(first.ok).toBe(true)
    client._state.notas[0]!.xmlAssinado = ""

    const second = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error("não deveria aceitar bytes ausentes")
    expect(second.code).toBe("identidade_fiscal_conflito")
  })
})

describe("persistNfceContingenciaOutbox · multi-loja", () => {
  it("isolamento por storeId: loja B não vê nem reutiliza o documento da loja A", async () => {
    const client = createMockClient()
    const a = await persistNfceContingenciaOutbox(persistInput({ storeId: STORE_A, offline: issue({ chave: CHAVE_A }) }), {
      client: client as never,
    })
    expect(a.ok).toBe(true)

    const b = await persistNfceContingenciaOutbox(
      persistInput({ storeId: STORE_B, vendaId: "venda-b", offline: issue({ chave: CHAVE_B, xml: xmlIdentidade({ chave: CHAVE_B, marker: "loja-b" }) }) }),
      { client: client as never },
    )
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error("ambas lojas deveriam persistir identidades distintas")
    expect(b.notaFiscalId).not.toBe(a.notaFiscalId)
    expect(b.jobId).not.toBe(a.jobId)
    expect(b.localKey).toContain(STORE_B)
    expect(b.localKey).not.toContain(STORE_A)
    expect(client._state.notas.filter((n) => n.storeId === STORE_A)).toHaveLength(1)
    expect(client._state.notas.filter((n) => n.storeId === STORE_B)).toHaveLength(1)
    expect(client._state.jobs.every((j) => j.storeId === STORE_A || j.storeId === STORE_B)).toBe(true)
  })
})

describe("persistNfceContingenciaOutbox · atomicidade", () => {
  it("documento e outbox nascem juntos", async () => {
    const client = createMockClient()
    const result = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(result.ok).toBe(true)
    expect(client._state.notas).toHaveLength(1)
    expect(client._state.jobs).toHaveLength(1)
    expect(client._state.jobs[0]?.notaFiscalId).toBe(client._state.notas[0]?.id)
    expect(client._state.jobs[0]?.tipo).toBe("CONTINGENCIA_TRANSMISSAO")
    expect(client.$transaction).toHaveBeenCalledTimes(1)
  })

  it("falha no segundo write faz rollback: sem job órfão nem documento parcial", async () => {
    const client = createMockClient({ failOn: "job" })
    await expect(
      persistNfceContingenciaOutbox(persistInput(), { client: client as never }),
    ).rejects.toThrow("job write failed")

    expect(client._state.notas).toHaveLength(0)
    expect(client._state.jobs).toHaveLength(0)
    expect(client._state.logs).toHaveLength(0)
  })

  it("não duplica job na repetição idempotente", async () => {
    const client = createMockClient()
    await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(client._state.jobs).toHaveLength(1)
    expect(client._state.notas).toHaveLength(1)
  })
})

describe("persistNfceContingenciaOutbox · outbox dormente e deadline", () => {
  it("job nasce PENDENTE_TX, dormente, sem execução automática", async () => {
    const client = createMockClient()
    const result = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.estado).toBe("PENDENTE_TX")
    expect(result.documentoStatus).toBe("CONTINGENCIA")
    expect(result.tipoEmissao).toBe("CONTINGENCIA_OFFLINE")
    expect(result.jobTipo).toBe("CONTINGENCIA_TRANSMISSAO")
    expect(result.executeAutomatico).toBe(false)
    expect(result.exactBytesRef).toEqual({
      kind: "NotaFiscal.xmlAssinado",
      notaFiscalId: result.notaFiscalId,
      rebuildForbidden: true,
    })

    const job = client._state.jobs[0]!
    expect(job.status).toBe("AGUARDANDO_RETRY")
    expect(job.proximaTentativaEm).toBeNull()
    expect(workerEligible(job)).toBe(false)
    const payload = job.payload as { contingencia: Record<string, unknown>; executeAutomatico: boolean }
    expect(payload.executeAutomatico).toBe(false)
    expect(payload.contingencia.estado).toBe("PENDENTE_TX")
    expect(payload.contingencia.exactBytesRef).toMatchObject({
      kind: "NotaFiscal.xmlAssinado",
      rebuildForbidden: true,
    })
    expect(JSON.stringify(payload)).not.toMatch(/rebuildNfce|buildNfceXml|snapshot/)
  })

  it("persiste NEXT_BUSINESS_DAY sem converter em +1 dia nem data absoluta", async () => {
    const client = createMockClient()
    const result = await persistNfceContingenciaOutbox(persistInput(), { client: client as never })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.mensagem)
    expect(result.deadline.kind).toBe(NEXT_BUSINESS_DAY)
    expect(result.deadline.countedFrom).toBe("dhEmi")
    expect(result.deadline.calendarEmbedded).toBe(false)
    expect(result.deadline.simplifiedPlusOneDay).toBe(false)
    expect(result.deadline.resolvedDeadline).toBeNull()
    expect(result.deadline.resolvedDeadline).not.toBe("2026-08-15T10:00:00-03:00")

    const job = client._state.jobs[0]!
    expect(job.proximaTentativaEm).toBeNull()
    const plusOne = new Date(Date.parse(DH_EMI) + 86_400_000)
    expect(job.proximaTentativaEm).not.toEqual(plusOne)
    expect(JSON.stringify(job.payload)).not.toContain("2026-08-15")
    expect(JSON.stringify(result.deadline)).not.toContain("2026-08-15")
  })
})

describe("persistNfceContingenciaOutbox · zero worker / rede / rebuild", () => {
  it("não chama worker, fetch, nem reconstrói XML", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const client = createMockClient()
    const drain = vi.fn()
    const rebuild = vi.fn()
    await persistNfceContingenciaOutbox(persistInput(), { client: client as never })

    expect(drain).not.toHaveBeenCalled()
    expect(rebuild).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const persistSrc = readFileSync(join(process.cwd(), "lib/fiscal/contingencia-outbox/persist.ts"), "utf8")
    expect(persistSrc).not.toMatch(/queue-worker|drainFiscalQueue|prisma-queue-worker/)
    expect(persistSrc).not.toMatch(/rebuildNfceContingenciaXmlOffline|buildNfceXmlAssinavel|signNfceXml/)
    expect(persistSrc).not.toMatch(/sefaz-direto|fetch\(|http\.request/)
    expect(persistSrc).not.toMatch(/TX_ANDAMENTO|AUTORIZADO_POST|REJEITADO_DEF/)
  })

  it("fonte não toca schema Prisma nem H-9/H-10", () => {
    const persistSrc = readFileSync(join(process.cwd(), "lib/fiscal/contingencia-outbox/persist.ts"), "utf8")
    const typesSrc = readFileSync(join(process.cwd(), "lib/fiscal/contingencia-outbox/types.ts"), "utf8")
    expect(persistSrc).not.toMatch(/schema\.prisma|prisma migrate/)
    expect(typesSrc).not.toMatch(/wsdl-ephemeral|H-9|H-10/)
  })
})
