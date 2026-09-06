import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  snapshot: vi.fn(async ({ storeId }: { storeId: string }) => ({
    observedAt: "2026-09-06T12:00:00.000Z",
    storeId,
    queue: { depth: 0 },
    uncertain: { transmittingUncertain: 0 },
    contingency: { contingencyNotesCount: 0, pendingDrainJobsCount: 0 },
    throttling: { isPaused: false, pausedScope: "none" },
  })),
}))

vi.mock("@/lib/fiscal/observability", () => ({
  readFiscalObservabilitySnapshot: h.snapshot,
}))

vi.mock("@/lib/fiscal/queue", () => ({
  sanitizeFiscalQueueError: (value: unknown) => String(value),
}))

import * as routeModule from "./route"
const { GET } = routeModule

const originalSecret = process.env.FISCAL_QUEUE_INTERNAL_SECRET

function makeRequest(options: {
  storeId?: string | null
  secret?: string
  authHeader?: string
  customHeader?: string
} = {}) {
  const headers = new Headers()
  if (options.secret) {
    headers.set("authorization", `Bearer ${options.secret}`)
  } else if (options.authHeader) {
    headers.set("authorization", options.authHeader)
  } else if (options.customHeader) {
    headers.set("x-fiscal-queue-secret", options.customHeader)
  }

  let url = "http://localhost/api/internal/fiscal/observability"
  if (options.storeId !== null && options.storeId !== undefined) {
    url += `?storeId=${encodeURIComponent(options.storeId)}`
  }

  return new Request(url, {
    method: "GET",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FISCAL_QUEUE_INTERNAL_SECRET = "segredo-observabilidade-fixture-021"
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.FISCAL_QUEUE_INTERNAL_SECRET
  else process.env.FISCAL_QUEUE_INTERNAL_SECRET = originalSecret
})

describe("GET /api/internal/fiscal/observability", () => {
  it("falha fechado com status 503 quando segredo interno não está configurado", async () => {
    delete process.env.FISCAL_QUEUE_INTERNAL_SECRET
    const response = await GET(makeRequest({ storeId: "loja-1", secret: "qualquer" }))

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("observabilidade_interna_indisponivel")
  })

  it("rejeita com status 401 credencial ausente", async () => {
    const response = await GET(makeRequest({ storeId: "loja-1" }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("nao_autorizado")
  })

  it("rejeita com status 401 credencial incorreta", async () => {
    const response = await GET(makeRequest({ storeId: "loja-1", secret: "segredo-errado" }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("nao_autorizado")
  })

  it("rejeita com status 400 se storeId estiver ausente", async () => {
    const response = await GET(
      makeRequest({ storeId: null, secret: "segredo-observabilidade-fixture-021" }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("store_id_obrigatorio")
  })

  it("rejeita com status 400 se storeId for apenas espaços em branco", async () => {
    const response = await GET(
      makeRequest({ storeId: "   ", secret: "segredo-observabilidade-fixture-021" }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("store_id_obrigatorio")
  })

  it("retorna snapshot consolidado com status 200 via Bearer token", async () => {
    const response = await GET(
      makeRequest({ storeId: "loja-sp-01", secret: "segredo-observabilidade-fixture-021" }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.snapshot.storeId).toBe("loja-sp-01")
    expect(h.snapshot).toHaveBeenCalledWith({ storeId: "loja-sp-01" })
  })

  it("retorna snapshot consolidado com status 200 via x-fiscal-queue-secret header", async () => {
    const response = await GET(
      makeRequest({
        storeId: "loja-sp-02",
        customHeader: "segredo-observabilidade-fixture-021",
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.snapshot.storeId).toBe("loja-sp-02")
  })

  it("retorna 503 fail-closed se o serviço de snapshot lançar erro", async () => {
    h.snapshot.mockRejectedValueOnce(new Error("falha de conexão ao banco"))
    const response = await GET(
      makeRequest({ storeId: "loja-sp-01", secret: "segredo-observabilidade-fixture-021" }),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe("observabilidade_falhou")
  })

  it("garante que apenas o método GET está exposto na rota", () => {
    expect(typeof (routeModule as Record<string, unknown>).GET).toBe("function")
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined()
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined()
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined()
  })
})
