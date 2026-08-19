/**
 * GOAL 016 — PATCH/DELETE de template exigem `podeConferir`.
 * Cross-store continua 404/fail-closed. Sem vazamento.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissaoTransicaoError } from "@/lib/contador/status/matriz"
import { TemplateNaoEncontradoError } from "@/lib/contador/agenda/erros"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))
vi.mock("@/lib/contador/status/permissoes", () => ({ resolverCapacidadesContador: vi.fn() }))
vi.mock("@/lib/contador/agenda", () => ({
  criarRepoAgenda: vi.fn(() => ({ tag: "repo" })),
  atualizarTemplate: vi.fn(),
  removerTemplate: vi.fn(),
}))
vi.mock("@/lib/contador/documentos/http", () => ({
  respostaFalhaEscopo: (escopo: { motivo: string }) =>
    new Response(JSON.stringify({ ok: false, motivo: escopo.motivo }), { status: 401 }),
  logEvento: vi.fn(),
}))

import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { atualizarTemplate, removerTemplate } from "@/lib/contador/agenda"
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
  vi.mocked(auth).mockReset().mockResolvedValue({ user: { id: "u1" } } as never)
  vi.mocked(requireContadorScope).mockReset().mockResolvedValue(SCOPE_OK as never)
  vi.mocked(resolverCapacidadesContador).mockReset().mockReturnValue(CAP_ALTO)
  vi.mocked(atualizarTemplate).mockReset().mockImplementation(async (_escopo, _id, _entrada, cap) => {
    if (!cap.podeConferir) throw new PermissaoTransicaoError("resolver")
    return TPL as never
  })
  vi.mocked(removerTemplate).mockReset().mockImplementation(async (_escopo, _id, cap) => {
    if (!cap.podeConferir) throw new PermissaoTransicaoError("resolver")
    return { inativado: false }
  })
})

describe("PATCH /api/contador/agenda/templates/:id", () => {
  it("HUB sem podeConferir → 403", async () => {
    vi.mocked(resolverCapacidadesContador).mockReturnValue(CAP_BAIXO)
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
    expect(vi.mocked(atualizarTemplate).mock.calls[0][3]).toMatchObject({ podeConferir: true })
  })

  it("cross-store fail-closed → 404", async () => {
    vi.mocked(atualizarTemplate).mockRejectedValue(new TemplateNaoEncontradoError())
    const res = await PATCH(req("PATCH", { titulo: "hack" }), CTX)
    expect(res.status).toBe(404)
    const json = (await res.json()) as { ok: boolean; mensagem: string }
    expect(json.ok).toBe(false)
    expect(json.mensagem).not.toContain("loja-2")
  })
})

describe("DELETE /api/contador/agenda/templates/:id", () => {
  it("HUB sem podeConferir → 403", async () => {
    vi.mocked(resolverCapacidadesContador).mockReturnValue(CAP_BAIXO)
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(403)
  })

  it("financeiro/admin → 200", async () => {
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(200)
    expect(vi.mocked(removerTemplate).mock.calls[0][2]).toMatchObject({ podeConferir: true })
  })

  it("cross-store fail-closed → 404", async () => {
    vi.mocked(removerTemplate).mockRejectedValue(new TemplateNaoEncontradoError())
    const res = await DELETE(req("DELETE"), CTX)
    expect(res.status).toBe(404)
  })
})
