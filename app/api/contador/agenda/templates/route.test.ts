/**
 * GOAL 016 — contrato HTTP de templates: GET no escopo do HUB;
 * POST exige `podeConferir` (financeiro/admin). Sem vazamento de dados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissaoTransicaoError } from "@/lib/contador/status/matriz"

const authMock = vi.fn()
const requireContadorScope = vi.fn()
const resolverCapacidadesContador = vi.fn()
const listarTemplates = vi.fn()
const criarTemplate = vi.fn()
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
  listarTemplates: (...args: unknown[]) => listarTemplates(...args),
  criarTemplate: (...args: unknown[]) => criarTemplate(...args),
}))
vi.mock("@/lib/contador/documentos/http", () => ({
  respostaFalhaEscopo: (escopo: { motivo: string }) =>
    new Response(JSON.stringify({ ok: false, motivo: escopo.motivo }), { status: 401 }),
  logEvento: vi.fn(),
}))

import { GET, POST } from "./route"

const SCOPE_OK = { ok: true as const, storeId: "loja-1", userId: "u1" }
const TPL = Object.freeze({ id: "tpl-1", storeId: "loja-1", titulo: "DAS", ativo: true })
const CAP_ALTO = { acessaHub: true, podeConferir: true, podeGerenciarAcessoExterno: false }
const CAP_BAIXO = { acessaHub: true, podeConferir: false, podeGerenciarAcessoExterno: false }

function req(method: string, body?: unknown, query = "") {
  return new Request(`http://localhost/api/contador/agenda/templates${query}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "u1" } })
  requireContadorScope.mockReset().mockResolvedValue(SCOPE_OK)
  resolverCapacidadesContador.mockReset().mockReturnValue(CAP_ALTO)
  listarTemplates.mockReset().mockResolvedValue([TPL])
    criarTemplate.mockReset().mockImplementation(async (_escopo, _entrada, cap: { podeConferir?: boolean }) => {
      if (!cap?.podeConferir) throw new PermissaoTransicaoError("resolver")
      return TPL
    })
  criarRepoAgenda.mockClear()
})

describe("GET /api/contador/agenda/templates", () => {
  it("escopo HUB basta — não exige podeConferir", async () => {
    resolverCapacidadesContador.mockReturnValue(CAP_BAIXO)
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; templates: unknown[] }
    expect(json.ok).toBe(true)
    expect(json.templates).toHaveLength(1)
    expect(listarTemplates).toHaveBeenCalledTimes(1)
    expect(authMock).not.toHaveBeenCalled()
    expect(criarTemplate).not.toHaveBeenCalled()
  })

  it("storeId na query → 400", async () => {
    const res = await GET(req("GET", undefined, "?storeId=loja-9"))
    expect(res.status).toBe(400)
    expect(listarTemplates).not.toHaveBeenCalled()
  })
})

describe("POST /api/contador/agenda/templates", () => {
  it("HUB sem podeConferir → 403 sem vazar título/loja", async () => {
    resolverCapacidadesContador.mockReturnValue(CAP_BAIXO)
    const res = await POST(req("POST", { titulo: "segredo-interno", tipo: "tarefa" }))
    expect(res.status).toBe(403)
    const json = (await res.json()) as { ok: boolean; mensagem: string }
    expect(json.ok).toBe(false)
    expect(json.mensagem).not.toContain("segredo-interno")
    expect(json.mensagem).not.toContain("loja-1")
    expect(json.mensagem).not.toContain("loja-9")
  })

  it("financeiro/admin (podeConferir) → 200", async () => {
    const res = await POST(req("POST", { titulo: "DAS", tipo: "pagamento_guia", diaVencimento: 20 }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; template: { id: string } }
    expect(json.ok).toBe(true)
    expect(json.template.id).toBe("tpl-1")
    expect(criarTemplate.mock.calls[0][2]).toMatchObject({ podeConferir: true })
  })
})
