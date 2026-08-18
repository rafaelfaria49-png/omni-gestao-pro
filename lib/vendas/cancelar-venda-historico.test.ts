import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  blocksConfirmedSaleAction,
  confirmCancelarVendaHistorico,
  type LocalSyncSaleRef,
  type SaleIdentityRef,
} from "./cancelar-venda-historico"

const REPO_ROOT = resolve(__dirname, "../..")
const SALE_ID = "VDA-L01-2026-000256"
const STORE_ID = "loja-1"
const CLIENT_SALE_ID = "cs_stale_recovery01"

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

function remoteRow(id = SALE_ID): SaleIdentityRef {
  return { id, kind: "REMOTE_CONFIRMED", clientSaleId: CLIENT_SALE_ID }
}

function staleLocal(overrides: Partial<LocalSyncSaleRef> = {}): LocalSyncSaleRef {
  return {
    id: SALE_ID,
    clientSaleId: CLIENT_SALE_ID,
    syncPending: true,
    ...overrides,
  }
}

function quarantinedLocal(): LocalSyncSaleRef {
  return staleLocal({
    syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("blocksConfirmedSaleAction", () => {
  it("LOCAL_PENDING verdadeiro: bloqueia ação server-side", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: "PEND-cs_localonly01",
        actionKind: "LOCAL_PENDING",
        remoteRows: [],
        localSales: [{ id: "PEND-cs_localonly01", syncPending: true, clientSaleId: "cs_localonly01" }],
      }),
    ).toBe(true)
  })

  it("LOCAL_QUARANTINED verdadeiro: bloqueia ação server-side", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: "VDA-L01-2026-000099",
        actionKind: "LOCAL_QUARANTINED",
        remoteRows: [],
        localSales: [quarantinedLocal()],
      }),
    ).toBe(true)
  })

  it("LOCAL_QUARANTINED com ocupante remoto no mesmo número: continua bloqueado", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: SALE_ID,
        actionKind: "LOCAL_QUARANTINED",
        remoteRows: [remoteRow()],
        localSales: [quarantinedLocal()],
      }),
    ).toBe(true)
  })

  it("LOCAL_PENDING sem evidência remota (só estado local): bloqueia", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: "PEND-cs_localonly01",
        remoteRows: [],
        localSales: [{ id: "PEND-cs_localonly01", syncPending: true, clientSaleId: "cs_localonly01" }],
      }),
    ).toBe(true)
  })

  it("REMOTE_CONFIRMED normal: não bloqueia", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: SALE_ID,
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
      }),
    ).toBe(false)
  })

  it("REMOTE_CONFIRMED + cópia local stale do mesmo id: não bloqueia", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: SALE_ID,
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [staleLocal()],
      }),
    ).toBe(false)
  })

  it("GET detalhe ok=true vence cópia local stale mesmo fora da página atual", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: SALE_ID,
        serverDetailOk: true,
        remoteRows: [],
        localSales: [staleLocal()],
      }),
    ).toBe(false)
  })

  it("kind persistido REMOTE_CONFIRMED vence pendingSync local mesmo sem a linha na página", () => {
    expect(
      blocksConfirmedSaleAction({
        vendaId: SALE_ID,
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [],
        localSales: [staleLocal()],
      }),
    ).toBe(false)
  })
})

describe("confirmCancelarVendaHistorico — POST /cancelar", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("P0: REMOTE_CONFIRMED + cópia local stale → POST /cancelar exatamente 1 vez", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, pedidoId: SALE_ID }))
    const lock = { current: false }

    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "duplicidade conferida no caixa",
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [staleLocal()],
        inFlight: lock,
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result).toEqual({ status: "cancelled", pedidoId: SALE_ID })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const [url, init] = call
    expect(url).toBe(`/api/vendas/${SALE_ID}/cancelar`)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
    expect((init.headers as Record<string, string>)["x-assistec-loja-id"]).toBe(STORE_ID)
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: "duplicidade conferida no caixa",
      canceladaPor: "Operador",
      forcar: false,
    })
    expect(lock.current).toBe(false)
  })

  it("REMOTE_CONFIRMED normal: POST é enviado", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, pedidoId: SALE_ID }))
    await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "cliente desistiu",
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("LOCAL_PENDING verdadeiro: não envia POST", async () => {
    const fetchMock = vi.fn()
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: "PEND-cs_localonly01",
        storeId: STORE_ID,
        motivo: "teste",
        actionKind: "LOCAL_PENDING",
        remoteRows: [],
        localSales: [{ id: "PEND-cs_localonly01", syncPending: true }],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result.status).toBe("blocked")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("LOCAL_QUARANTINED verdadeiro: não envia POST", async () => {
    const fetchMock = vi.fn()
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "teste",
        actionKind: "LOCAL_QUARANTINED",
        remoteRows: [],
        localSales: [quarantinedLocal()],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result.status).toBe("blocked")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("motivo vazio: POST não é enviado", async () => {
    const fetchMock = vi.fn()
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "   ",
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result.status).toBe("empty_motivo")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("double-click: somente um POST", async () => {
    let release!: () => void
    const first = new Promise<Response>((resolve) => {
      release = () => resolve(jsonResponse(200, { ok: true, pedidoId: SALE_ID }))
    })
    const fetchMock = vi.fn((async () => first) as typeof fetch)
    const lock = { current: false }
    const input = {
      pedidoId: SALE_ID,
      storeId: STORE_ID,
      motivo: "duplicidade",
      actionKind: "REMOTE_CONFIRMED" as const,
      remoteRows: [remoteRow()],
      localSales: [staleLocal()],
      inFlight: lock,
    }

    const p1 = confirmCancelarVendaHistorico(input, { fetch: fetchMock })
    const p2 = confirmCancelarVendaHistorico(input, { fetch: fetchMock })
    release()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual(["cancelled", "in_flight"])
  })

  it("API 409 requireConfirm: nenhum forcar=true automático", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, {
        ok: false,
        requireConfirm: true,
        error: "Esta venda possui devoluções registradas.",
      }),
    )
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "com devolução",
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result.status).toBe("require_confirm")
    const requireCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(requireCall[1].body)).forcar).toBe(false)
  })

  it("segunda confirmação manual: POST com forcar=true", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, pedidoId: SALE_ID }))
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "com devolução",
        forcar: true,
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result.status).toBe("cancelled")
    const forcarCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(forcarCall[1].body)).forcar).toBe(true)
  })

  it("API 500: não marca venda como cancelada", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { ok: false, error: "Falha interna do servidor" }))
    const result = await confirmCancelarVendaHistorico(
      {
        pedidoId: SALE_ID,
        storeId: STORE_ID,
        motivo: "teste",
        actionKind: "REMOTE_CONFIRMED",
        remoteRows: [remoteRow()],
        localSales: [],
        inFlight: { current: false },
      },
      { fetch: fetchMock as unknown as typeof fetch },
    )
    expect(result).toEqual({
      status: "error",
      error: "Falha interna do servidor",
      httpStatus: 500,
    })
  })
})

describe("vendas-arquivo-geral — wiring do cancelamento", () => {
  const source = read("components/dashboard/vendas/vendas-arquivo-geral.tsx")

  it("usa o helper compartilhado e persiste o kind da linha", () => {
    expect(source).toContain("confirmCancelarVendaHistorico")
    expect(source).toContain("blocksConfirmedSaleAction as blocksServerSaleAction")
    expect(source).toContain("cancelandoKind")
    expect(source).toContain("startCancel(v.id, v.kind)")
    expect(source).toContain('startCancel(detalhe.id, "REMOTE_CONFIRMED")')
  })

  it("não reabre o guard só com pendingSyncIds.has no POST", () => {
    expect(source).not.toMatch(
      /if \(blocksConfirmedSaleAction\(cancelandoId\)\) \{\s*toastVendaPendenteBloqueada\("cancelar"\)/,
    )
  })

  it("mostra erro real e não finge sucesso", () => {
    expect(source).toContain("cancelError")
    expect(source).toContain("Cancelando…")
    expect(source).toContain("Confirmar mesmo assim")
  })
})
