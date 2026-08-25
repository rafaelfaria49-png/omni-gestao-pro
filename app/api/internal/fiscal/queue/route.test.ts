import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  createPorts: vi.fn(() => ({ ports: { marker: "ports" } })),
  drain: vi.fn(async () => ({ acquired: 1, completed: 1 })),
  metrics: vi.fn(async () => ({ depth: 0 })),
  pause: vi.fn(async () => ({ globalPaused: true })),
  reprocess: vi.fn(async () => ({ status: "PENDENTE" })),
  cancel: vi.fn(async () => ({ status: "CANCELADO" })),
}))

vi.mock("@/lib/fiscal/queue", () => {
  class FiscalQueueAdminError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    cancelFiscalQueueJob: h.cancel,
    drainFiscalQueue: h.drain,
    FiscalQueueAdminError,
    readFiscalQueueMetrics: h.metrics,
    reprocessFailedFiscalJob: h.reprocess,
    sanitizeFiscalQueueError: (value: unknown) => String(value),
    setFiscalQueuePause: h.pause,
  }
})

vi.mock("@/lib/fiscal/homologation/nfce-homologation-pilot-wiring", () => ({
  createNfceHomologationPilotWiring: h.createPorts,
}))

import { GET, POST } from "./route"

const originalSecret = process.env.FISCAL_QUEUE_INTERNAL_SECRET

function request(
  method: "GET" | "POST",
  options: { secret?: string; body?: unknown; contentLength?: string } = {},
) {
  const headers = new Headers()
  if (options.secret) headers.set("authorization", `Bearer ${options.secret}`)
  if (options.body !== undefined) headers.set("content-type", "application/json")
  if (options.contentLength) headers.set("content-length", options.contentLength)
  return new Request("http://localhost/api/internal/fiscal/queue?storeId=store-a", {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FISCAL_QUEUE_INTERNAL_SECRET = "segredo-interno-fixture"
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.FISCAL_QUEUE_INTERNAL_SECRET
  else process.env.FISCAL_QUEUE_INTERNAL_SECRET = originalSecret
})

describe("endpoint interno protegido da fila fiscal", () => {
  it("falha fechado quando o segredo interno não está configurado", async () => {
    delete process.env.FISCAL_QUEUE_INTERNAL_SECRET
    const response = await GET(request("GET"))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: "fila_interna_indisponivel",
    })
    expect(h.metrics).not.toHaveBeenCalled()
  })

  it("rejeita credencial ausente ou incorreta sem tocar a fila", async () => {
    const missing = await POST(request("POST", { body: { action: "drain" } }))
    const wrong = await POST(
      request("POST", {
        secret: "incorreto",
        body: { action: "drain" },
      }),
    )

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(h.drain).not.toHaveBeenCalled()
  })

  it("drena lote autenticado por endpoint Node server-side", async () => {
    const response = await POST(
      request("POST", {
        secret: "segredo-interno-fixture",
        body: {
          action: "drain",
          workerId: "worker fixture !!",
          batchSize: 4,
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(h.createPorts).toHaveBeenCalledTimes(1)
    expect(h.drain).toHaveBeenCalledWith(
      {
        workerId: "workerfixture",
        batchSize: 4,
      },
      { marker: "ports" },
    )
  })

  it("expõe métricas somente com autenticação interna", async () => {
    const response = await GET(
      request("GET", { secret: "segredo-interno-fixture" }),
    )

    expect(response.status).toBe(200)
    expect(h.metrics).toHaveBeenCalledWith({ storeId: "store-a" })
    expect(await response.json()).toEqual({
      ok: true,
      metrics: { depth: 0 },
    })
  })

  it("recusa corpo declarado acima do limite", async () => {
    const response = await POST(
      request("POST", {
        secret: "segredo-interno-fixture",
        contentLength: "32769",
        body: { action: "drain" },
      }),
    )

    expect(response.status).toBe(413)
    expect(h.drain).not.toHaveBeenCalled()
  })

  it("recusa corpo real acima do limite mesmo sem content-length confiável", async () => {
    const response = await POST(
      request("POST", {
        secret: "segredo-interno-fixture",
        body: { action: "drain", padding: "x".repeat(33_000) },
      }),
    )

    expect(response.status).toBe(413)
    expect(h.drain).not.toHaveBeenCalled()
  })

  it("valida estritamente escopo e valor de pausa antes da operação", async () => {
    const response = await POST(
      request("POST", {
        secret: "segredo-interno-fixture",
        body: {
          action: "pause",
          scope: "qualquer",
          paused: "false",
          storeId: "store-a",
          actor: "admin",
          reason: "fixture",
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(h.pause).not.toHaveBeenCalled()
  })
})
