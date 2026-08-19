/**
 * GOAL 016 — PATCH/DELETE de template exigem `podeConferir`.
 * Cross-store continua 404/fail-closed. Sem vazamento.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissaoTransicaoError } from "@/lib/contador/status/matriz"
import { TemplateNaoEncontradoError } from "@/lib/contador/agenda/erros"

const authMock = vi.fn()
const requireContadorScope = vi.fn()
const resolverCapacidadesContador = vi.fn()
const atualizarTemplate = vi.fn()
const removerTemplate = vi.fn()
const criarRepoAgenda = vi.fn(() => ({ tag: "repo" }))

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock("@/lib/contador/scope", () => ({
  requireContadorScope: (...args: unknown[]) => requireContadorScope(...args),
}))
vi.mock("@/lib/contador/status/permissoes", () => ({
  resolverCapacidadesContador: (...args: unknown[]) => resolverCapacidadesContador(...args),
}))
vi.mock("@/lib/contador/agenda", () => ({
  criarRepoAgenda: (...args: unknown[]) => criarRepoAgenda(...args),
  atualizarTemplate: (...args: unknown[]) => atualizarTemplate(...args),
  removerTemplate: (...args: unknown[]) => removerTemplate(...args),
}))
vi.mock("@/lib/contador/documentos/http", () => ({
  respostaFalhaEscopo: (escopo: { motivo: string }) =>
    new Response(JSON.stringify({ ok: false, motivo: escopo.motivo }), { status: 401 }),
  logEvento: vi.fn(),
}))

import { DELETE, PATCH } from "./route"

const SCOPE_OK = { ok: true as const, storeId: "loja-1", userId: "u1" }
const TPL = Object.freeze({ id: "tpl-1", storeId: "loja-1", titulo: "DAS", ativo: true })
const CAP_ALTO = { acessaHub: true, podeConferir: true, podeGerenciarAcessoExterno: false }
const CAP_BAIXO = { acessaHub: true, podeConferir: false, podeGerenciarAcessoExterno: false }
const CTX = { params: Promise.resolve({ id: "tpl-1" }) }

function req(method: string, body?: unknown, query = "") {
  return new Request(`http://localhost/api/contador/agenda/templates/tpl-1${query}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } })
  requireContadorScope.mockReset().mockResolvedValue(SCOPE_OK)
  resolverCapacidadesContador.mockReset().mockReturnValue(CAP_ALTO)
  atualizarTemplate.mockReset().mockImplementation(async (_escopo, _id, _entrada, cap: { podeConferir?: boolean }) => {
    if (!cap?.podeConferir) throw new PermissaoTransicaoError("resolver")
    return TPL
  })
  removerTemplate.mockReset().mockImplementation(async (_escopo, _id, cap: { podeConferir?: boolean }) => {
    if (!cap?.podeConferir) throw new PermissaoTransicaoError("resolver")
    return { inativado: false }
  })
})

describe("PATCH /api/contador/agenda/templates/:id", () => {
  it("HUB sem podeConferir → 403", async () => {
    resolverCapacidadesContador.mockReturnValue(CAP_BAIXO)
    const res = await PATCH(req("PATCH", { titulo: "hack" }), CTX)
    expect(res.status).toBe(403)
    const json = (await res.json()) as { ok: boolean; mensagem: string }
    expect(json.ok).toBe(false)
    expect(json.mensagem).not.toContain("tpl-1")
    expect(json.mensagem).not.toContain("loja-1")
  })

  it("financeiro/admin → 200", async () => {
    const res = await PATCH(req("PATCH", { titulo: "DAS-2" }), CTX)
    expect(res.status).toBe(200)
    expect(atualizarTemplate.mock.calls[0][3]).toMatchObject({ podeConferir: true })
  })

  it("cross-store fail-closed → 404", async () => {
    atualizarTemplate.mockRejectedValue(new TemplateNaoEncontradoError())
    const res = await PATCH(req("PATCH", { titulo: "hack" }), CTX)
    expect(res.status).toBe(404)
    const json = (await res.json()) as { ok: boolean; mensagem: string }
    expect(json.ok).toBe(false)
    expect(json.mensagem).not.toContain("loja-2")
  })
})

describe("DELETE /api/contador/agenda/templates/:id", () => {
  it("HUB sem podeConferir → 403", async () => {
    resolverCapacidadesContador.mockReturnValue(CAP_BAIXO)
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(403)
  })

  it("financeiro/admin → 200", async () => {
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(200)
    expect(removerTemplate.mock.calls[0][2]).toMatchObject({ podeConferir: true })
  })

  it("cross-store fail-closed → 404", async () => {
    removerTemplate.mockRejectedValue(new TemplateNaoEncontradoError())
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(404)
  })
})
