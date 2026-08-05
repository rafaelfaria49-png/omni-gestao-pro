/**
 * GOAL 002C-0b — camada HTTP do provisionamento de `Store.codigoNumeracaoVenda`.
 *
 * Exercita a autorização real (`requireAdmin` + ACL de loja da sessão), o recorte da
 * leitura por permissão, a tradução dos resultados do serviço em status HTTP, a
 * política de divulgação da loja ocupante em conflito e a auditoria do módulo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  provision: vi.fn(),
  readStatuses: vi.fn(),
  recordAudit: vi.fn(async () => 1),
  storeFindMany: vi.fn(async () => [{ id: "loja-1" }, { id: "loja-2" }]),
}))

vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { store: { findMany: h.storeFindMany } } }))
vi.mock("@/lib/config-audit/record", () => ({ recordConfigAuditFromSession: h.recordAudit }))
vi.mock("@/lib/vendas/store-sale-numbering-provision", () => ({
  provisionStoreSaleNumberingCode: h.provision,
  readStoreSaleNumberingStatuses: h.readStatuses,
}))

import { GET, PUT } from "./route"

function sessao(over: Record<string, unknown> = {}) {
  return { user: { id: "usr-1", name: "Admin", email: "admin@omni.test", role: "ADMIN", ...over } }
}

function put(body: unknown) {
  return new Request("http://localhost/api/stores/numeracao-venda", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function status(over: Record<string, unknown> = {}) {
  return {
    storeId: "loja-1",
    name: "Matriz",
    codigo: "RC01",
    configurado: true,
    imutavel: false,
    uso: { series: 0, vendas: 0, consumido: false },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.storeFindMany.mockResolvedValue([{ id: "loja-1" }, { id: "loja-2" }])
  h.readStatuses.mockResolvedValue([status()])
})

describe("GET /api/stores/numeracao-venda", () => {
  it("exige sessão", async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.readStatuses).not.toHaveBeenCalled()
  })

  it("recorta as lojas pela permissão da sessão", async () => {
    h.auth.mockResolvedValue(
      sessao({ role: "OPERADOR", storeAccess: "restricted", allowedStoreIds: ["loja-2"] }),
    )

    const res = await GET()

    expect(res.status).toBe(200)
    expect(h.readStatuses).toHaveBeenCalledWith(["loja-2"])
  })

  it("devolve erro de leitura sem vazar detalhe de infraestrutura", async () => {
    h.auth.mockResolvedValue(sessao())
    h.storeFindMany.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:6543"))

    const res = await GET()
    const body = (await res.json()) as { stores: unknown[]; error: string }

    expect(res.status).toBe(500)
    expect(body.stores).toEqual([])
    expect(body.error).not.toMatch(/6543|ECONNREFUSED/)
  })
})

describe("PUT /api/stores/numeracao-venda — autorização", () => {
  it("recusa sem sessão", async () => {
    h.auth.mockResolvedValue(null)
    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    expect(res.status).toBe(401)
    expect(h.provision).not.toHaveBeenCalled()
  })

  it("recusa papel sem permissão administrativa", async () => {
    h.auth.mockResolvedValue(sessao({ role: "OPERADOR" }))
    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    expect(res.status).toBe(403)
    expect(h.provision).not.toHaveBeenCalled()
  })

  it("recusa alteração de loja fora do escopo do operador", async () => {
    h.auth.mockResolvedValue(
      sessao({ storeAccess: "restricted", allowedStoreIds: ["loja-2"] }),
    )
    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    expect(res.status).toBe(403)
    expect(h.provision).not.toHaveBeenCalled()
  })

  it("exige storeId explícito, sem loja padrão", async () => {
    h.auth.mockResolvedValue(sessao())
    const res = await PUT(put({ codigo: "RC01" }))
    expect(res.status).toBe(400)
    expect(h.provision).not.toHaveBeenCalled()
  })
})

describe("PUT /api/stores/numeracao-venda — resultados", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessao())
  })

  it("salva e registra auditoria da alteração", async () => {
    h.provision.mockResolvedValue({
      status: "SAVED",
      store: status(),
      codigoAnterior: null,
    })

    const res = await PUT(put({ storeId: "loja-1", codigo: "rc01" }))
    const body = (await res.json()) as { ok: boolean; unchanged: boolean }

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, unchanged: false })
    expect(h.provision).toHaveBeenCalledWith({ storeId: "loja-1", codigo: "rc01" })
    expect(h.recordAudit).toHaveBeenCalledTimes(1)
    const [, , params] = h.recordAudit.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { storeId: string; changes: Array<{ field: string; newValue: unknown }> },
    ]
    expect(params.storeId).toBe("loja-1")
    expect(params.changes[0].field).toBe("store.codigoNumeracaoVenda")
    expect(params.changes[0].newValue).toBe("RC01")
  })

  it("não audita quando nada mudou", async () => {
    h.provision.mockResolvedValue({ status: "UNCHANGED", store: status() })

    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    const body = (await res.json()) as { ok: boolean; unchanged: boolean }

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, unchanged: true })
    expect(h.recordAudit).not.toHaveBeenCalled()
  })

  it("traduz recusa de formato em 400 com motivo", async () => {
    h.provision.mockResolvedValue({ status: "INVALID", reason: "TOO_SHORT" })

    const res = await PUT(put({ storeId: "loja-1", codigo: "A" }))
    const body = (await res.json()) as { ok: boolean; reason: string; error: string }

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.reason).toBe("TOO_SHORT")
    expect(body.error).toContain("2 caracteres")
  })

  it("revela a loja ocupante apenas quando o operador tem acesso a ela", async () => {
    h.provision.mockResolvedValue({
      status: "CONFLICT",
      codigo: "RC01",
      conflitoStoreId: "loja-9",
    })
    h.auth.mockResolvedValue(
      sessao({ storeAccess: "restricted", allowedStoreIds: ["loja-1"] }),
    )

    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    const body = (await res.json()) as { conflitoStoreId: string | null; error: string }

    expect(res.status).toBe(409)
    expect(body.conflitoStoreId).toBeNull()
    expect(body.error).not.toContain("loja-9")
  })

  it("informa a loja ocupante quando ela está no escopo do operador", async () => {
    h.provision.mockResolvedValue({
      status: "CONFLICT",
      codigo: "RC01",
      conflitoStoreId: "loja-2",
    })

    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    const body = (await res.json()) as { conflitoStoreId: string | null; error: string }

    expect(res.status).toBe(409)
    expect(body.conflitoStoreId).toBe("loja-2")
    expect(body.error).toContain("loja-2")
  })

  it("traduz série já consumida em 409 imutável", async () => {
    h.provision.mockResolvedValue({
      status: "IMMUTABLE",
      store: status({ imutavel: true, uso: { series: 1, vendas: 3, consumido: true } }),
    })

    const res = await PUT(put({ storeId: "loja-1", codigo: "NOVO" }))
    const body = (await res.json()) as { ok: boolean; code: string }

    expect(res.status).toBe(409)
    expect(body.ok).toBe(false)
    expect(body.code).toBe("IMMUTABLE")
    expect(h.recordAudit).not.toHaveBeenCalled()
  })

  it("traduz loja inexistente em 404", async () => {
    h.provision.mockResolvedValue({ status: "STORE_NOT_FOUND", storeId: "loja-1" })

    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))

    expect(res.status).toBe(404)
  })

  it("não vaza detalhe de infraestrutura em falha inesperada", async () => {
    h.provision.mockRejectedValue(new Error("db.prisma.io:5432 senha inválida"))

    const res = await PUT(put({ storeId: "loja-1", codigo: "RC01" }))
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(500)
    expect(body.error).not.toMatch(/5432|senha/)
  })
})
