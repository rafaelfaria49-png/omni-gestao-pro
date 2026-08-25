/**
 * Integração interna da inutilização NFC-e (GOAL 019).
 * Drive os entrypoints reais: enqueue, execute, admin, reissue, numbering.
 */
import { describe, expect, it } from "vitest"
import { stubHomologacaoProvider } from "../provider/stub-homologacao"
import { allocateFiscalNumber } from "../numbering/allocate-fiscal-number"
import type { FiscalNumberingPorts, NumberingNota } from "../numbering/numbering.types"
import type { FiscalProvider, FiscalProviderInutilizacaoParams, FiscalProviderResponse } from "../provider/types"
import type { FiscalQueueJob } from "../queue/queue.types"
import { INUTILIZACAO_MARK, asInutilizacaoPayload, buildInutilizacaoDedupeKey } from "./mark"
import { JUSTIFICATIVA_REJEICAO_PADRAO, enqueueInutilizacao } from "./enqueue"
import { executeInutilizacaoJob } from "./execute"
import { reemitirVendaAposRejeicao } from "./reissue"
import { solicitarInutilizacaoAdministrativa } from "./admin"
import type {
  InutilizacaoJobRow,
  InutilizacaoNotaRow,
  InutilizacaoPorts,
} from "./ports"

const JUST = JUSTIFICATIVA_REJEICAO_PADRAO

function jobFromRow(row: InutilizacaoJobRow): FiscalQueueJob {
  const now = new Date("2026-08-25T12:00:00.000Z")
  return {
    id: row.id,
    storeId: row.storeId,
    vendaId: row.vendaId,
    notaFiscalId: row.notaFiscalId,
    tipo: "INUTILIZACAO",
    status: row.status as FiscalQueueJob["status"],
    tentativas: row.tentativas,
    maxTentativas: 5,
    proximaTentativaEm: now,
    prioridade: 5,
    lockOwner: "worker-1",
    lockedAt: now,
    lockExpiresAt: new Date(now.getTime() + 60_000),
    dedupeKey: row.dedupeKey,
    payload: row.payload,
    ultimoErro: null,
    concluidoEm: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createMemory(): InutilizacaoPorts & {
  jobs: Map<string, InutilizacaoJobRow>
  notas: Map<string, InutilizacaoNotaRow>
  logs: Array<{ acao: string; detalhe?: Record<string, unknown> }>
  eventos: Map<string, { id: string; status: string; protocolo: string | null; cStat: string | null }>
  vendaStatus: string
  numbers: number[]
} {
  const jobs = new Map<string, InutilizacaoJobRow>()
  const notas = new Map<string, InutilizacaoNotaRow>()
  const logs: Array<{ acao: string; detalhe?: Record<string, unknown> }> = []
  const eventos = new Map<string, { id: string; status: string; protocolo: string | null; cStat: string | null }>()
  let jobSeq = 0
  let notaSeq = 0
  const state = {
    jobs,
    notas,
    logs,
    eventos,
    vendaStatus: "REJEITADA",
    numbers: [] as number[],
  }
  const ports: InutilizacaoPorts = {
    async findJobByDedupe({ storeId, dedupeKey }) {
      const found = [...jobs.values()].find((j) => j.storeId === storeId && j.dedupeKey === dedupeKey)
      return found ?? null
    },
    async upsertJob({ storeId, vendaId, notaFiscalId, dedupeKey, payload }) {
      const existing = [...jobs.values()].find((j) => j.storeId === storeId && j.dedupeKey === dedupeKey)
      if (existing) return { job: existing, created: false }
      jobSeq += 1
      const job: InutilizacaoJobRow = {
        id: `job-inut-${jobSeq}`,
        storeId,
        vendaId,
        notaFiscalId,
        tipo: "INUTILIZACAO",
        status: "PENDENTE",
        dedupeKey,
        payload,
        tentativas: 0,
      }
      jobs.set(job.id, job)
      return { job, created: true }
    },
    async updateJobPayload({ jobId, expectedMark, payload, status }) {
      const job = jobs.get(jobId)
      if (!job || job.payload.mark !== expectedMark) return false
      job.payload = payload
      if (status) job.status = status
      return true
    },
    async findNota({ notaFiscalId }) {
      return notas.get(notaFiscalId) ?? null
    },
    async findVigente({ vendaId }) {
      return [...notas.values()].find((n) => n.vendaId === vendaId && n.vigente) ?? null
    },
    async findEvento({ notaFiscalId }) {
      const ev = eventos.get(notaFiscalId)
      if (!ev) return null
      return { id: ev.id, notaFiscalId, tipo: "INUTILIZACAO", sequencia: 1, status: ev.status, protocolo: ev.protocolo, cStat: ev.cStat }
    },
    async upsertEvento(input) {
      const existing = eventos.get(input.notaFiscalId)
      if (existing?.status === "AUTORIZADO" && existing.protocolo) {
        return { id: existing.id, created: false, reused: true }
      }
      const row = {
        id: existing?.id ?? `ev-${input.notaFiscalId}`,
        status: input.status,
        protocolo: input.protocolo,
        cStat: input.cStat,
      }
      eventos.set(input.notaFiscalId, row)
      return { id: row.id, created: !existing, reused: false }
    },
    async createLog(input) {
      logs.push({ acao: input.acao, detalhe: input.detalhe })
    },
    async demoteVigente({ notaFiscalId }) {
      const nota = notas.get(notaFiscalId)
      if (!nota || !nota.vigente || nota.status !== "REJEITADA") return false
      nota.vigente = false
      return true
    },
    async swapReissueVigente({ storeId, vendaId, origem, localKey }) {
      const nota = notas.get(origem.id)
      if (!nota || !nota.vigente || nota.status !== "REJEITADA") return null
      nota.vigente = false
      return ports.createReissueNota({ storeId, vendaId, origem, localKey })
    },
    async restoreRejectedVigente({ rejectedNotaId, newNotaId }) {
      const neu = notas.get(newNotaId)
      const old = notas.get(rejectedNotaId)
      if (neu) neu.vigente = false
      if (!old || old.status !== "REJEITADA") return false
      old.vigente = true
      return true
    },
    async createReissueNota({ vendaId, storeId, origem, localKey }) {
      const existing = [...notas.values()].find((n) => n.localKey === localKey)
      if (existing) return { id: existing.id, localKey }
      notaSeq += 1
      const id = `nota-reissue-${notaSeq}`
      notas.set(id, {
        ...origem,
        id,
        storeId,
        vendaId,
        vigente: true,
        status: "RASCUNHO",
        serie: null,
        numero: null,
        localKey,
      })
      return { id, localKey }
    },
    async setVendaFiscalStatus({ to }) {
      state.vendaStatus = to
      return true
    },
    async findConfig() {
      return { cnpj: "11222333000181", uf: "SP", ambiente: "HOMOLOGACAO", modeloFiscal: "NFCE" }
    },
    async upsertEmissionJob({ notaFiscalId }) {
      return { id: `job-em-${notaFiscalId}`, created: true }
    },
  }
  return Object.assign(state, ports)
}

function numberingPorts(notas: Map<string, InutilizacaoNotaRow>, start = 10): FiscalNumberingPorts {
  let next = start
  return {
    async getNota({ notaFiscalId }) {
      const n = notas.get(notaFiscalId)
      if (!n) return null
      return {
        id: n.id,
        storeId: n.storeId,
        vendaId: n.vendaId,
        modelo: n.modelo,
        ambiente: n.ambiente,
        serie: n.serie,
        numero: n.numero,
        serieFiscalId: "serie-1",
        localKey: n.localKey,
      } satisfies NumberingNota
    },
    async findActiveSerie() {
      return { id: "serie-1", storeId: "loja-1", serie: 1, modelo: "NFCE", ambiente: "HOMOLOGACAO", ativo: true, proximoNumero: next }
    },
    async reserveNextNumber() {
      const numero = next
      next += 1
      return { serieFiscalId: "serie-1", serie: 1, numero }
    },
    async bindNotaNumero({ notaFiscalId, serie, numero, serieFiscalId }) {
      const n = notas.get(notaFiscalId)
      if (!n) return { ok: false, conflito: false, mensagem: "nota ausente" }
      if (n.numero != null) return { ok: false, conflito: true, motivo: "nota_ja_numerada", mensagem: "já numerada" }
      n.serie = serie
      n.numero = numero
      void serieFiscalId
      return { ok: true }
    },
  }
}

function failingProvider(cStat = "241"): FiscalProvider {
  const inner = stubHomologacaoProvider
  return {
    tipo: inner.tipo,
    simulado: inner.simulado,
    validarConfiguracao: inner.validarConfiguracao.bind(inner),
    validarSnapshot: inner.validarSnapshot.bind(inner),
    prepararEmissao: inner.prepararEmissao.bind(inner),
    emitir: inner.emitir.bind(inner),
    consultar: inner.consultar.bind(inner),
    cancelar: inner.cancelar.bind(inner),
    statusServico: inner.statusServico.bind(inner),
    async inutilizar(params: FiscalProviderInutilizacaoParams): Promise<FiscalProviderResponse> {
      const base = await inner.inutilizar(params)
      return {
        ...base,
        ok: false,
        resultado: "rejeitado",
        dados: { ...base.dados, cStat, protocolo: null, xMotivo: "Um número da faixa já foi utilizado" },
        mensagem: "Um número da faixa já foi utilizado",
      }
    },
  }
}

describe("enqueueInutilizacao", () => {
  it("cria job único e recusa justificativa curta", async () => {
    const mem = createMemory()
    const bad = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 7,
        numeroFinal: 7,
        justificativa: "curta",
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe("justificativa_invalida")

    const a = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 7,
        numeroFinal: 7,
        justificativa: JUST,
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    const b = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 7,
        numeroFinal: 7,
        justificativa: JUST,
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.created).toBe(true)
      expect(b.created).toBe(false)
      expect(a.jobId).toBe(b.jobId)
      expect(a.dedupeKey).toBe(
        buildInutilizacaoDedupeKey({
          storeId: "loja-1",
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
          serie: 1,
          numeroInicial: 7,
          numeroFinal: 7,
        }),
      )
    }
    expect(mem.jobs.size).toBe(1)
  })

  it("aceita faixa quando inicial < final", async () => {
    const mem = createMemory()
    const r = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 10,
        numeroFinal: 12,
        justificativa: JUST,
        motivo: "lacuna_numeracao",
        operador: "op",
      },
      mem,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      const job = mem.jobs.get(r.jobId)!
      expect(job.payload.numeroInicial).toBe(10)
      expect(job.payload.numeroFinal).toBe(12)
    }
  })
})

describe("executeInutilizacaoJob", () => {
  it("persiste protocolo, baixa a marca e é idempotente na segunda execução", async () => {
    const mem = createMemory()
    const enq = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 3,
        numeroFinal: 3,
        justificativa: JUST,
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    expect(enq.ok).toBe(true)
    if (!enq.ok) return
    const first = await executeInutilizacaoJob(jobFromRow(mem.jobs.get(enq.jobId)!), {
      ports: mem,
      provider: stubHomologacaoProvider,
    })
    expect(first.kind).toBe("success")
    expect(first.code).toBe("inutilizacao_homologada")
    const payload = asInutilizacaoPayload(mem.jobs.get(enq.jobId)!.payload)!
    expect(payload.mark).toBe(INUTILIZACAO_MARK.INUTILIZADO)
    expect(payload.protocolo).toBeTruthy()
    expect(payload.cStat).toBe("102")
    expect(mem.eventos.get("nf-1")?.status).toBe("AUTORIZADO")

    const second = await executeInutilizacaoJob(jobFromRow(mem.jobs.get(enq.jobId)!), {
      ports: mem,
      provider: failingProvider(),
    })
    expect(second.kind).toBe("success")
    expect(second.code).toBe("ja_inutilizada")
    expect(asInutilizacaoPayload(mem.jobs.get(enq.jobId)!.payload)?.mark).toBe(INUTILIZACAO_MARK.INUTILIZADO)
  })

  it("falha do pedido preserva a marca A_INUTILIZAR", async () => {
    const mem = createMemory()
    const enq = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-1",
        serie: 1,
        numeroInicial: 4,
        numeroFinal: 4,
        justificativa: JUST,
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    expect(enq.ok).toBe(true)
    if (!enq.ok) return
    const result = await executeInutilizacaoJob(jobFromRow(mem.jobs.get(enq.jobId)!), {
      ports: mem,
      provider: failingProvider("241"),
    })
    expect(result.kind).toBe("terminal")
    expect(asInutilizacaoPayload(mem.jobs.get(enq.jobId)!.payload)?.mark).toBe(INUTILIZACAO_MARK.A_INUTILIZAR)
    expect(asInutilizacaoPayload(mem.jobs.get(enq.jobId)!.payload)?.protocolo).toBeNull()
  })
})

describe("número jamais retorna ao pool", () => {
  it("alocação após inutilização avança o contador e NUMBER_REUSE_COUNT=0", async () => {
    const mem = createMemory()
    mem.notas.set("nf-old", {
      id: "nf-old",
      storeId: "loja-1",
      vendaId: "venda-1",
      status: "REJEITADA",
      vigente: true,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 1,
      numero: 8,
      localKey: "nfce-snapshot:loja-1:venda-1",
      snapshotEmitente: {},
      snapshotDestinatario: {},
      snapshotPagamento: {},
      valorTotal: 10,
      valorDesconto: 0,
      valorFrete: 0,
      valorTotalTributos: 0,
    })
    const numbering = numberingPorts(mem.notas, 9)
    const enq = await enqueueInutilizacao(
      {
        storeId: "loja-1",
        vendaId: "venda-1",
        notaFiscalId: "nf-old",
        serie: 1,
        numeroInicial: 8,
        numeroFinal: 8,
        justificativa: JUST,
        motivo: "rejeicao_definitiva",
        operador: "op",
      },
      mem,
    )
    expect(enq.ok).toBe(true)
    if (!enq.ok) return
    await executeInutilizacaoJob(jobFromRow(mem.jobs.get(enq.jobId)!), {
      ports: mem,
      provider: stubHomologacaoProvider,
    })

    mem.notas.set("nf-new", {
      ...mem.notas.get("nf-old")!,
      id: "nf-new",
      vigente: true,
      status: "RASCUNHO",
      serie: null,
      numero: null,
      localKey: "nfce-snapshot:loja-1:venda-1:reissue:nf-old",
    })
    const alloc = await allocateFiscalNumber({ storeId: "loja-1", notaFiscalId: "nf-new" }, numbering)
    expect(alloc.ok).toBe(true)
    if (!alloc.ok) return
    expect(alloc.numero).not.toBe(8)
    expect(alloc.numero).toBe(9)
    const reuseCount = alloc.numero === 8 ? 1 : 0
    expect(reuseCount).toBe(0)
  })
})

describe("rejeição → inutilização → reemissão", () => {
  it("preserva histórico, aloca número novo e torna a nova nota vigente", async () => {
    const mem = createMemory()
    mem.notas.set("nf-old", {
      id: "nf-old",
      storeId: "loja-1",
      vendaId: "venda-1",
      status: "REJEITADA",
      vigente: true,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 1,
      numero: 5,
      localKey: "nfce-snapshot:loja-1:venda-1",
      snapshotEmitente: { cnpj: "11222333000181" },
      snapshotDestinatario: {},
      snapshotPagamento: { hash: "abc" },
      valorTotal: 42,
      valorDesconto: 0,
      valorFrete: 0,
      valorTotalTributos: 1,
    })
    const numbering = numberingPorts(mem.notas, 6)
    const result = await reemitirVendaAposRejeicao(
      { storeId: "loja-1", vendaId: "venda-1", operador: "op", justificativa: JUST },
      mem,
      numbering,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.oldNumero).toBe(5)
    expect(result.newNumero).toBe(6)
    expect(result.newNumero).not.toBe(result.oldNumero)
    const old = mem.notas.get("nf-old")!
    const neu = mem.notas.get(result.newNotaId)!
    expect(old.vigente).toBe(false)
    expect(old.status).toBe("REJEITADA")
    expect(old.numero).toBe(5)
    expect(neu.vigente).toBe(true)
    expect(neu.numero).toBe(6)
    expect(neu.localKey).not.toBe(old.localKey)
    expect(mem.vendaStatus).toBe("PENDENTE")
    expect(mem.jobs.size).toBeGreaterThanOrEqual(1)
  })
})

describe("admin + concorrência", () => {
  it("ação administrativa devolve status auditável e upsert concorrente não duplica job", async () => {
    const mem = createMemory()
    const input = {
      storeId: "loja-1",
      vendaId: "venda-1",
      notaFiscalId: "nf-1",
      serie: 1,
      numeroInicial: 11,
      numeroFinal: 11,
      justificativa: JUST,
      actor: "admin@loja",
    }
    const [a, b] = await Promise.all([
      solicitarInutilizacaoAdministrativa(input, mem),
      solicitarInutilizacaoAdministrativa(input, mem),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(mem.jobs.size).toBe(1)
    if (a.ok) {
      expect(a.status).toBe("PENDENTE")
      expect(a.mark).toBe(INUTILIZACAO_MARK.A_INUTILIZAR)
    }
  })
})
