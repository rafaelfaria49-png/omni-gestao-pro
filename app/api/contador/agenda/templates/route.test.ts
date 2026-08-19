/**
 * GOAL 016 — contrato HTTP de templates: GET no escopo do HUB;
 * POST exige `podeConferir` (financeiro/admin). Sem vazamento de dados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissaoTransicaoError } from "@/lib/contador/status/matriz"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))
vi.mock("@/lib/contador/status/permissoes", () => ({ resolverCapacidadesContador: vi.fn() }))
vi.mock("@/lib/contador/agenda", () => ({
  criarRepoAgenda: vi.fn(() => ({ tag: "repo" })),
  listarTemplates: vi.fn(),
  criarTemplate: vi.fn(),
}))
vi.mock("@/lib/contador/documentos/http", () => ({
  respostaFalhaEscopo: (escopo: { motivo: string }) =>
    new Response(JSON.stringify({ ok: false, motivo: escopo.motivo }), { status: 401 }),
  logEvento: vi.fn(),
}))

import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarTemplate, listarTemplates } from "@/lib/contador/agenda"
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
  vi.mocked(auth).mockReset().mockResolvedValue({ user: { id: "u1" } } as never)
  vi.mocked(requireContadorScope).mockReset().mockResolvedValue(SCOPE_OK as never)
  vi.mocked(resolverCapacidadesContador).mockReset().mockReturnValue(CAP_ALTO)
  vi.mocked(listarTemplates).mockReset().mockResolvedValue([TPL] as never)
  vi.mocked(criarTemplate).mockReset().mockImplementation(async (_escopo, _entrada, cap) => {
    if (!cap.podeConferir) throw new PermissaoTransicaoError("resolver")
    return TPL as never
  })
})

describe("GET /api/contador/agenda/templates", () => {
  it("escopo HUB basta — não exige podeConferir", async () => {
    vi.mocked(resolverCapacidadesContador).mockReturnValue(CAP_BAIXO)
    const res = await GET(req("GET"))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; templates: unknown[] }
    expect(json.ok).toBe(true)
    expect(json.templates).toHaveLength(1)
    expect(listarTemplates).toHaveBeenCalledTimes(1)
    expect(auth).not.toHaveBeenCalled()
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
    vi.mocked(resolverCapacidadesContador).mockReturnValue(CAP_BAIXO)
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
    expect(vi.mocked(criarTemplate).mock.calls[0][2]).toMatchObject({ podeConferir: true })
  })
})
