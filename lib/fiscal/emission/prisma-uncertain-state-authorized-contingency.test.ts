/**
 * GOAL 020 — markAuthorized (fonte CONSULTATION) encerra também o job
 * CONTINGENCIA_TRANSMISSAO estacionado.
 *
 * Regressão: o `where` hardcodificava `tipo: "EMISSAO"`, de modo que o job de
 * transmissão posterior de contingência, estacionado por desfecho incerto
 * (`AGUARDANDO_RETRY` + `proximaTentativaEm: null`), nunca era concluído pela
 * consulta que autorizou o documento — permanecendo para sempre na superfície
 * operacional da fila.
 */
import { describe, expect, it } from "vitest"
import { createPrismaUncertainStatePersistence } from "./prisma-uncertain-state-persistence"

type Row = Record<string, unknown>

function inArray(value: unknown): unknown[] | null {
  if (value != null && typeof value === "object" && Array.isArray((value as { in: unknown[] }).in)) {
    return (value as { in: unknown[] }).in
  }
  return null
}

function createClient() {
  const nota: Row = {
    id: "nf-1",
    storeId: "loja-1",
    vendaId: "venda-1",
    status: "TRANSMITINDO",
    xmlAutorizado: null,
    protocolo: null,
    cStat: null,
    xMotivo: null,
    digestValue: null,
    qrCodeData: null,
    urlConsulta: null,
  }
  const venda: Row = { id: "venda-1", storeId: "loja-1", fiscalStatus: "TRANSMITINDO" }
  const jobs: Row[] = [
    {
      id: "job-emissao",
      storeId: "loja-1",
      vendaId: "venda-1",
      notaFiscalId: "nf-1",
      tipo: "EMISSAO",
      status: "AGUARDANDO_RETRY",
      proximaTentativaEm: null,
      lockOwner: null,
      lockedAt: null,
      lockExpiresAt: null,
    },
    {
      id: "job-contingencia",
      storeId: "loja-1",
      vendaId: "venda-1",
      notaFiscalId: "nf-1",
      tipo: "CONTINGENCIA_TRANSMISSAO",
      status: "AGUARDANDO_RETRY",
      proximaTentativaEm: null,
      ultimoErro: "desfecho desconhecido",
      lockOwner: null,
      lockedAt: null,
      lockExpiresAt: null,
    },
  ]
  const logs: Row[] = []

  const tx = {
    notaFiscal: {
      findFirst: async () => ({ ...nota }),
      updateMany: async ({ data }: { data: Row }) => {
        Object.assign(nota, data)
        return { count: 1 }
      },
    },
    venda: {
      updateMany: async ({ data }: { data: Row }) => {
        Object.assign(venda, data)
        return { count: 1 }
      },
    },
    fiscalEmissaoJob: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const job of jobs) {
          if (job.storeId !== where.storeId) continue
          if (job.vendaId !== where.vendaId) continue
          if (job.notaFiscalId !== where.notaFiscalId) continue
          const tipos = inArray(where.tipo)
          if (tipos ? !tipos.includes(job.tipo) : job.tipo !== where.tipo) continue
          const statuses = inArray(where.status)
          if (statuses ? !statuses.includes(job.status) : job.status !== where.status) continue
          Object.assign(job, data)
          count++
        }
        return { count }
      },
    },
    fiscalLog: {
      create: async ({ data }: { data: Row }) => {
        logs.push(data)
        return data
      },
    },
  }

  return {
    client: { $transaction: async <T>(run: (txArg: typeof tx) => Promise<T>) => run(tx) },
    state: { nota, venda, jobs, logs },
  }
}

const document = {
  notaFiscalId: "nf-1",
  storeId: "loja-1",
  vendaId: "venda-1",
  modelo: "NFCE" as const,
  ambiente: "HOMOLOGACAO" as const,
  serie: 7,
  numero: 19,
  chaveAcesso: "3".repeat(44),
  status: "TRANSMITINDO" as const,
  xmlAssinado: "<NFe/>",
  xmlBytesSha256: "abc",
}

describe("createPrismaUncertainStatePersistence.markAuthorized · CONSULTATION", () => {
  it("consulta que autoriza conclui EMISSAO e CONTINGENCIA_TRANSMISSAO estacionados", async () => {
    const { client, state } = createClient()
    const persistence = createPrismaUncertainStatePersistence(client as never)
    await persistence.markAuthorized({
      document,
      result: {
        outcome: "AUTHORIZED",
        protocolo: "p-1",
        cStat: "100",
        xMotivo: "Autorizado",
        xmlAutorizado: "<nfeProc/>",
      },
      now: new Date("2026-08-28T15:00:00.000Z"),
      source: "CONSULTATION",
    })
    const porTipo = Object.fromEntries(state.jobs.map((j) => [j.tipo, j.status]))
    expect(porTipo["EMISSAO"]).toBe("CONCLUIDO")
    expect(porTipo["CONTINGENCIA_TRANSMISSAO"]).toBe("CONCLUIDO")
    const contingencia = state.jobs.find((j) => j.tipo === "CONTINGENCIA_TRANSMISSAO")
    expect(contingencia?.proximaTentativaEm).toBeNull()
    expect(contingencia?.ultimoErro).toBeNull()
    expect(state.nota.status).toBe("AUTORIZADA")
    expect(state.nota.protocolo).toBe("p-1")
    expect(state.venda.fiscalStatus).toBe("AUTORIZADA")
    expect(state.logs.some((l) => l.acao === "fiscal.reconciliation.authorized")).toBe(true)
  })
})
