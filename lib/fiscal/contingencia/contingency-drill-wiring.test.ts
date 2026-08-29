/**
 * GOAL 020 — caminho EXPLÍCITO do drill de transmissão posterior.
 *
 * Cenários obrigatórios: drain genérico continua offline/denegado; drill
 * recusa dormente, tipo errado, job incoerente, loja fora do piloto, contexto
 * divergente (inclusive PRODUCAO), documento fora de CONTINGENCIA, bytes
 * divergentes, XSD ausente e A1 ausente — todos SEM rede. Caminho vigente
 * completo: um único transporte com os bytes exatos, one-shot consumido antes
 * da rede, capability por execução, zero prepare e zero numeração.
 */
import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createNfceHomologationPilotWiring } from "@/lib/fiscal/homologation/nfce-homologation-pilot-wiring"
import {
  createContingencyHomologationDrillWiring,
  executeContingencyHomologationDrillTransmission,
  type ContingencyDrillWiringDeps,
} from "./contingency-drill-wiring"
import {
  CONTINGENCY_HOMOLOGATION_WINDOW,
  contingencyDrillDedupeKey,
  type ContingencyHomologationWindowConfig,
} from "./contingency-homologation-gate"

type Row = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Cliente Prisma EM MEMÓRIA com avaliador de `where`                  */
/* ------------------------------------------------------------------ */

function ms(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") {
    const parsed = new Date(value).getTime()
    return Number.isNaN(parsed) ? Number.NaN : parsed
  }
  if (typeof value === "number") return value
  return Number.NaN
}

function mesmoValor(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return ms(a) === ms(b)
  return a === b
}

function matchCond(row: Row, cond: Row): boolean {
  for (const [key, expected] of Object.entries(cond)) {
    if (key === "AND") {
      if (!(expected as Row[]).every((c) => matchCond(row, c))) return false
      continue
    }
    if (key === "OR") {
      if (!(expected as Row[]).some((c) => matchCond(row, c))) return false
      continue
    }
    const actual = row[key]
    if (
      expected != null &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      !(expected instanceof Date)
    ) {
      const op = expected as Row
      if ("in" in op) {
        if (!(op.in as unknown[]).some((v) => mesmoValor(actual, v))) return false
      } else if ("notIn" in op) {
        if ((op.notIn as unknown[]).some((v) => mesmoValor(actual, v))) return false
      } else if ("not" in op) {
        if (mesmoValor(actual, op.not)) return false
      } else if ("lte" in op) {
        if (!(ms(actual) <= ms(op.lte))) return false
      } else if ("gte" in op) {
        if (!(ms(actual) >= ms(op.gte))) return false
      } else if ("lt" in op) {
        if (!(ms(actual) < ms(op.lt))) return false
      } else if ("gt" in op) {
        if (!(ms(actual) > ms(op.gt))) return false
      } else {
        return false
      }
      continue
    }
    if (!mesmoValor(actual, expected)) return false
  }
  return true
}

function aplicarData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value != null && typeof value === "object" && "increment" in (value as Row)) {
      row[key] = Number(row[key] ?? 0) + Number((value as Row).increment)
      continue
    }
    row[key] = value
  }
}

const XML_CONTINGENCIA =
  '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><ide><tpAmb>2</tpAmb><tpEmis>9</tpEmis></ide></infNFe></NFe>'
const XML_SHA256 = createHash("sha256").update(XML_CONTINGENCIA).digest("hex")

const LOJA_PILOTO = "loja-piloto-real-0001"
const OUTRA_LOJA = "loja-fora-000000001"

function createFakeClient(options: {
  notaStatus?: string
  configOverrides?: Row
  jobOverrides?: Row
} = {}) {
  const configRow: Row = {
    storeId: LOJA_PILOTO,
    provider: "SEFAZ_DIRETO",
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    fiscalEnabled: true,
    uf: "SP",
    ...options.configOverrides,
  }
  const notas: Row[] = [
    {
      id: "nota-drill",
      storeId: LOJA_PILOTO,
      vendaId: "venda-drill",
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      status: options.notaStatus ?? "CONTINGENCIA",
      serie: 1,
      numero: 42,
      chaveAcesso: "3".repeat(44),
      xmlAssinado: XML_CONTINGENCIA,
      xmlAutorizado: null,
      protocolo: null,
      cStat: null,
      xMotivo: null,
      digestValue: null,
      qrCodeData: null,
      urlConsulta: null,
    },
  ]
  const jobs: Row[] = [
    {
      id: "job-drill-1",
      storeId: LOJA_PILOTO,
      vendaId: "venda-drill",
      notaFiscalId: "nota-drill",
      tipo: "CONTINGENCIA_TRANSMISSAO",
      status: "PENDENTE",
      tentativas: 0,
      maxTentativas: 10,
      proximaTentativaEm: null,
      prioridade: 100,
      lockOwner: null,
      lockedAt: null,
      lockExpiresAt: null,
      dedupeKey: "fiscal:contingencia:v1:nota:nota-drill",
      payload: {
        version: 1,
        operation: "CONTINGENCIA_TRANSMISSAO",
        document: {
          notaFiscalId: "nota-drill",
          chaveAcesso: "3".repeat(44),
          serie: 1,
          numero: 42,
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
          bytesSha256: XML_SHA256,
        },
        transmission: { external: false, exactBytes: true },
      },
      ultimoErro: null,
      concluidoEm: null,
      createdAt: new Date("2026-09-01T11:00:00Z"),
      updatedAt: new Date("2026-09-01T11:00:00Z"),
      ...options.jobOverrides,
    },
    {
      id: "job-outro",
      storeId: OUTRA_LOJA,
      vendaId: "venda-outro",
      notaFiscalId: "nota-outro",
      tipo: "EMISSAO",
      status: "PENDENTE",
      tentativas: 0,
      maxTentativas: 5,
      proximaTentativaEm: null,
      prioridade: 0,
      lockOwner: null,
      lockedAt: null,
      lockExpiresAt: null,
      dedupeKey: null,
      payload: { version: 1 },
      ultimoErro: null,
      concluidoEm: null,
      createdAt: new Date("2026-09-01T11:00:00Z"),
      updatedAt: new Date("2026-09-01T11:00:00Z"),
    },
  ]
  const logs: Row[] = []

  const tables = {
    fiscalEmissaoJob: jobs,
    notaFiscal: notas,
    fiscalLog: logs,
    configuracaoFiscalLoja: [configRow],
    venda: [{ id: "venda-drill", storeId: LOJA_PILOTO, fiscalStatus: "EM_CONTINGENCIA" }],
  }

  function tableOf(name: string): Row[] {
    return (tables as Record<string, Row[]>)[name] ?? []
  }

  const client = {
    $transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(client as never),
    fiscalEmissaoJob: {
      findUnique: async ({ where }: { where: Row }) => {
        if (where.id) return jobs.find((j) => j.id === where.id) ?? null
        const composite = where.storeId_dedupeKey as Row | undefined
        if (composite) {
          return (
            jobs.find((j) => j.storeId === composite.storeId && j.dedupeKey === composite.dedupeKey) ??
            null
          )
        }
        return null
      },
      findFirst: async ({ where }: { where: Row }) => jobs.find((j) => matchCond(j, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const row of jobs) {
          if (!matchCond(row, where)) continue
          aplicarData(row, data)
          count++
        }
        return { count }
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: `job-${jobs.length + 1}`, ...data }
        jobs.push(row)
        return { id: row.id }
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = jobs.find((j) => matchCond(j, where))
        if (!row) throw new Error("update: row não encontrada")
        aplicarData(row, data)
        return row
      },
      upsert: async ({ where, create }: { where: Row; create: Row }) => {
        const composite = where.storeId_dedupeKey as Row
        const row = jobs.find(
          (j) => j.storeId === composite.storeId && j.dedupeKey === composite.dedupeKey,
        )
        if (row) return row
        const nova = { id: `job-${jobs.length + 1}`, ...create }
        jobs.push(nova)
        return nova
      },
    },
    fiscalLog: {
      findFirst: async ({ where }: { where: Row }) => logs.find((l) => matchCond(l, where)) ?? null,
      findMany: async ({ where }: { where: Row }) => logs.filter((l) => matchCond(l, where)),
      create: async ({ data }: { data: Row }) => {
        logs.push({ id: `log-${logs.length + 1}`, ...data })
        return data
      },
    },
    configuracaoFiscalLoja: {
      findUnique: async ({ where }: { where: { storeId: string } }) =>
        (tables.configuracaoFiscalLoja as Row[]).find((c) => c.storeId === where.storeId) ?? null,
    },
    notaFiscal: {
      findFirst: async ({ where }: { where: Row }) => notas.find((n) => matchCond(n, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const row of notas) {
          if (!matchCond(row, where)) continue
          aplicarData(row, data)
          count++
        }
        return { count }
      },
    },
    venda: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const row of tables.venda as Row[]) {
          if (!matchCond(row, where)) continue
          aplicarData(row, data)
          count++
        }
        return { count }
      },
    },
  }
  return { client, tables }
}

type FakeClient = ReturnType<typeof createFakeClient>["client"]

/* ------------------------------------------------------------------ */
/* Fixtures de janela/transporte                                       */
/* ------------------------------------------------------------------ */

const AGORA = new Date("2026-09-01T12:05:00Z")
const JANELA_ATIVA: ContingencyHomologationWindowConfig = {
  activationId: "contingencia-drill-20260901-1200z-abcdef123456",
  notBeforeUtc: "2026-09-01T12:00:00Z",
  expiresAtUtc: "2026-09-01T12:10:00Z",
}

function captureTransport() {
  return {
    permiteRede: true as const,
    send: vi.fn(async (_request: unknown) => ({
      ok: false as const,
      codigo: "transporte_offline_bloqueado",
      mensagem: "Transporte de teste recusou após captura.",
      classification: "BLOCKED_BEFORE_NETWORK" as const,
      externalTransmissionAttempted: false as const,
    })),
  }
}

function drillDeps(fake: FakeClient, overrides: Row = {}): ContingencyDrillWiringDeps {
  return {
    client: fake as never,
    ledgerClient: fake as never,
    window: JANELA_ATIVA,
    clock: () => AGORA,
    readXsdAttestation: async () => ({
      outcome: "VALIDACAO_APROVADA",
      xmlSha256: XML_SHA256,
      schemaVersion: "PL_010e_v1.02/NFe/nfe_v4.00.xsd",
    }),
    resolveCertificate: async () => ({
      ok: true as const,
      storeId: LOJA_PILOTO,
      certificadoId: "cert-1",
      blobRef: "blob-ref",
      senhaRef: "senha-ref",
      provider: "env-piloto-teste",
    }),
    transport: captureTransport() as never,
    ...overrides,
  }
}

const JOB_OK = {
  id: "job-drill-1",
  storeId: LOJA_PILOTO,
  vendaId: "venda-drill",
  notaFiscalId: "nota-drill",
  tipo: "CONTINGENCIA_TRANSMISSAO" as const,
  status: "PENDENTE" as const,
  tentativas: 1,
  maxTentativas: 10,
  proximaTentativaEm: null,
  prioridade: 100,
  lockOwner: "worker-drill",
  lockedAt: AGORA,
  lockExpiresAt: new Date(AGORA.getTime() + 30_000),
  dedupeKey: "fiscal:contingencia:v1:nota:nota-drill",
  payload: {
    version: 1,
    operation: "CONTINGENCIA_TRANSMISSAO",
    document: { bytesSha256: XML_SHA256 },
  },
  ultimoErro: null,
  concluidoEm: null,
  createdAt: new Date("2026-09-01T11:00:00Z"),
  updatedAt: AGORA,
}

describe("drain genérico — segue dormente e negado", () => {
  it("createNfceHomologationPilotWiring continua EXTERNAL_EXECUTION_DENIED para contingência", async () => {
    const { client } = createFakeClient()
    const wiring = createNfceHomologationPilotWiring({ client: client as never })
    const result = await wiring.ports.execute(JOB_OK as never)
    expect(result).toMatchObject({
      kind: "terminal",
      code: "external_execution_not_authorized",
      providerInvoked: false,
    })
  })
})

describe("createContingencyHomologationDrillWiring — guards por execução", () => {
  it("recusa job de outro tipo sem tocar nada", async () => {
    const { client } = createFakeClient()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client),
    })
    const result = await wiring.execute({ ...JOB_OK, tipo: "EMISSAO" } as never)
    expect(result).toMatchObject({ kind: "terminal", code: "drill_tipo_nao_suportado" })
  })

  it("recusa job incoerente (id ou loja diferentes do autorizado)", async () => {
    const { client } = createFakeClient()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client),
    })
    await expect(
      wiring.execute({ ...JOB_OK, id: "job-outro" } as never),
    ).resolves.toMatchObject({ kind: "terminal", code: "drill_job_incoerente" })
    await expect(
      wiring.execute({ ...JOB_OK, storeId: OUTRA_LOJA } as never),
    ).resolves.toMatchObject({ kind: "terminal", code: "drill_job_incoerente" })
  })

  it("recusa loja fora do piloto resolvido", async () => {
    const { client } = createFakeClient()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: OUTRA_LOJA,
      deps: drillDeps(client),
    })
    const result = await wiring.execute({ ...JOB_OK, storeId: OUTRA_LOJA } as never)
    expect(result).toMatchObject({ kind: "terminal", code: "loja_fora_do_piloto" })
  })

  it("recusa contexto divergente — inclusive PRODUCAO", async () => {
    const casos: Array<{ overrides: Row; code: string }> = [
      // provider fora do piloto derruba primeiro a resolução da loja-piloto.
      { overrides: { provider: "STUB_HOMOLOGACAO" }, code: "loja_fora_do_piloto" },
      { overrides: { modeloFiscal: "NFE" }, code: "contexto_piloto_invalido" },
      { overrides: { ambiente: "PRODUCAO" }, code: "contexto_piloto_invalido" },
      { overrides: { fiscalEnabled: false }, code: "contexto_piloto_invalido" },
    ]
    for (const caso of casos) {
      const { client } = createFakeClient({ configOverrides: caso.overrides })
      const wiring = createContingencyHomologationDrillWiring({
        jobId: "job-drill-1",
        storeId: LOJA_PILOTO,
        deps: drillDeps(client),
      })
      await expect(wiring.execute(JOB_OK as never)).resolves.toMatchObject({
        kind: "terminal",
        code: caso.code,
      })
    }
  })

  it("gate DORMENTE bloqueia antes de A1, ledger e rede", async () => {
    const { client, tables } = createFakeClient()
    const transport = captureTransport()
    const resolveCertificate = vi.fn()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: {
        client: client as never,
        ledgerClient: client as never,
        window: CONTINGENCY_HOMOLOGATION_WINDOW,
        clock: () => AGORA,
        transport: transport as never,
        resolveCertificate: resolveCertificate as never,
      },
    })
    const result = await wiring.execute(JOB_OK as never)
    expect(result).toMatchObject({ kind: "terminal", code: "drill_gate_disabled" })
    expect((tables.fiscalEmissaoJob as Row[]).filter((j) => j.tipo === "CONSULTA")).toHaveLength(0)
    expect(transport.send).not.toHaveBeenCalled()
    expect(resolveCertificate).not.toHaveBeenCalled()
  })

  it("gate expirado bloqueia", async () => {
    const { client } = createFakeClient()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client, { clock: () => new Date("2026-09-01T12:10:00Z") }),
    })
    await expect(wiring.execute(JOB_OK as never)).resolves.toMatchObject({
      kind: "terminal",
      code: "drill_gate_expired",
    })
  })

  it("documento fora de CONTINGENCIA é recusado", async () => {
    const { client } = createFakeClient({ notaStatus: "ASSINADA" })
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client),
    })
    await expect(wiring.execute(JOB_OK as never)).resolves.toMatchObject({
      kind: "terminal",
      code: "drill_documento_nao_contingencia",
    })
  })

  it("bytes divergentes (payload vs persistido) são recusados antes da rede", async () => {
    const { client } = createFakeClient()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client),
    })
    const adulterado = {
      ...JOB_OK,
      payload: { ...JOB_OK.payload, document: { bytesSha256: "0".repeat(64) } },
    }
    const result = await wiring.execute(adulterado as never)
    expect(result).toMatchObject({ kind: "terminal", code: "drill_bytes_divergentes" })
    expect((wiring as unknown as { ports: { execute: unknown } }).ports).toBeTruthy()
  })

  it("XSD ausente: guard 8 bloqueia SEM transporte (consumo one-shot já ocorreu)", async () => {
    const { client, tables } = createFakeClient()
    const transport = captureTransport()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client, { transport: transport as never, readXsdAttestation: undefined }),
    })
    const result = await wiring.execute(JOB_OK as never)
    // O provider foi invocado e lançou antes do transporte: desfecho incerto
    // conservador (consulta 019 é a única autoridade), com a mensagem do guard.
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "execucao_fiscal_interrompida",
      externalTransmissionAttempted: false,
      mensagem: expect.stringContaining("validação XSD"),
    })
    expect(transport.send).not.toHaveBeenCalled()
    const ledger = (tables.fiscalEmissaoJob as Row[]).filter(
      (j) => typeof j.dedupeKey === "string" && j.dedupeKey.startsWith("fiscal:contingencia:drill:v1:"),
    )
    expect(ledger).toHaveLength(1)
  })

  it("A1 ausente: guard 10 bloqueia SEM transporte", async () => {
    const { client } = createFakeClient()
    const transport = captureTransport()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client, {
        transport: transport as never,
        resolveCertificate: async () => ({ ok: false as const, codigo: "x", mensagem: "sem A1" }),
      }),
    })
    const result = await wiring.execute(JOB_OK as never)
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "execucao_fiscal_interrompida",
      mensagem: expect.stringContaining("Certificado A1 ativo indisponível"),
    })
    expect(transport.send).not.toHaveBeenCalled()
  })
})

describe("drill vigente de ponta a ponta — um transporte, bytes exatos, one-shot", () => {
  it("transmite UMA vez os bytes persistidos, sem prepare e sem numeração", async () => {
    const { client, tables } = createFakeClient()
    const transport = captureTransport()
    const wiring = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client, { transport: transport as never }),
    })
    const result = await wiring.execute(JOB_OK as never)
    // Transporte de captura recusa após receber o request: o provider lançou
    // depois de invocado → desfecho incerto conservador com consulta 019.
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "execucao_fiscal_interrompida",
      mensagem: expect.stringContaining("Transporte de teste recusou"),
    })
    expect(transport.send).toHaveBeenCalledTimes(1)

    const request = transport.send.mock.calls[0]?.[0] as Row
    expect(request.endpoint).toMatchObject({ uf: "SP", ambiente: "HOMOLOGACAO" })
    const body = new TextDecoder().decode(request.bodyBytes as Uint8Array)
    expect(body).toContain(XML_CONTINGENCIA)
    expect((request.certificate as Row)).toMatchObject({
      storeId: LOJA_PILOTO,
      blobRef: "blob-ref",
      senhaRef: "senha-ref",
    })
    expect(request.correlationId).toBe(`contingencia-drill:job-drill-1`)

    // one-shot consumido ANTES da rede, com dedupe de ativação + job.
    const ledger = (tables.fiscalEmissaoJob as Row[]).find(
      (j) => typeof j.dedupeKey === "string" && j.dedupeKey.startsWith("fiscal:contingencia:drill:v1:"),
    )
    expect(ledger?.dedupeKey).toBe(
      contingencyDrillDedupeKey(JANELA_ATIVA.activationId ?? "", "job-drill-1"),
    )
    // nota promovida a TRANSMITINDO pelo coordenador (bytes intactos).
    expect((tables.notaFiscal as Row[])[0]?.status).toBe("TRANSMITINDO")
    expect((tables.notaFiscal as Row[])[0]?.xmlAssinado).toBe(XML_CONTINGENCIA)
  })

  it("replay da mesma ativação + job não gera segundo transporte (cold start incluso)", async () => {
    const { client, tables } = createFakeClient()
    const transport = captureTransport()
    const deps = drillDeps(client, { transport: transport as never })
    const primeira = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps,
    })
    await primeira.execute(JOB_OK as never)
    expect(transport.send).toHaveBeenCalledTimes(1)

    // Nova instância (processo "reiniciado"), mesmo ledger: one-shot persistente.
    const segunda = createContingencyHomologationDrillWiring({
      jobId: "job-drill-1",
      storeId: LOJA_PILOTO,
      deps: drillDeps(client, { transport: transport as never }),
    })
    const result = await segunda.execute({ ...JOB_OK, status: "PENDENTE" } as never)
    expect(result).toMatchObject({ kind: "terminal", code: expect.stringMatching(/drill_(documento_nao_contingencia|activation_ja_consumida)/) })
    expect(transport.send).toHaveBeenCalledTimes(1)
    const ledger = (tables.fiscalEmissaoJob as Row[]).filter(
      (j) => typeof j.dedupeKey === "string" && j.dedupeKey.startsWith("fiscal:contingencia:drill:v1:"),
    )
    expect(ledger).toHaveLength(1)
  })
})

describe("executeContingencyHomologationDrillTransmission — runner + aquisição restrita", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("runner recusa job inexistente, tipo errado e loja incoerente", async () => {
    const { client } = createFakeClient()
    const base = { client: client as never, ledgerClient: client as never, window: JANELA_ATIVA, clock: () => AGORA }
    await expect(
      executeContingencyHomologationDrillTransmission(
        { jobId: "nao-existe", storeId: LOJA_PILOTO },
        base,
      ),
    ).resolves.toMatchObject({ ok: false, code: "job_nao_encontrado" })
    await expect(
      executeContingencyHomologationDrillTransmission({ jobId: "job-outro", storeId: OUTRA_LOJA }, base),
    ).resolves.toMatchObject({ ok: false, code: "drill_tipo_nao_suportado" })
    await expect(
      executeContingencyHomologationDrillTransmission({ jobId: "job-drill-1", storeId: OUTRA_LOJA }, base),
    ).resolves.toMatchObject({ ok: false, code: "drill_job_incoerente" })
    expect(consoleErrorSpy).toBeTruthy()
  })

  it("runner drena EXATAMENTE o job autorizado; nenhum outro job é tocado", async () => {
    const { client, tables } = createFakeClient()
    const transport = captureTransport()
    const report = await executeContingencyHomologationDrillTransmission(
      { jobId: "job-drill-1", storeId: LOJA_PILOTO },
      drillDeps(client, { transport: transport as never }),
    )
    expect(transport.send).toHaveBeenCalledTimes(1)
    expect(report.outcome?.status).toBe("falha")
    const outros = (tables.fiscalEmissaoJob as Row[]).find((j) => j.id === "job-outro")
    expect(outros?.status).toBe("PENDENTE")
    expect(outros?.lockOwner).toBeNull()
    expect(outros?.tentativas).toBe(0)
  })
})
