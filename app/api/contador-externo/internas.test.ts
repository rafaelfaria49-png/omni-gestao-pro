/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — rotas INTERNAS do namespace externo
 * (testes 10, 11, 13, 18 e 21 do §14 na camada HTTP).
 *
 * Mecanismo: `vi.mock` de `@/lib/contador/scope` e `@/auth` (mesmo padrão de
 * `app/api/contador/pacote/route.test.ts` — o gate real NÃO é afrouxado, só
 * isolado) + repo fake in-memory via `__setRepoAuthExternaParaTestes`.
 * Sem banco, sem `vi.mock("@/lib/prisma")`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import type { Session } from "next-auth"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { criarConvite } from "@/lib/contador/auth-externa/convites"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario, type DbFalsoAuthExterna } from "@/lib/contador/auth-externa/fakes"
import { __resetRateLimitExternoForTests } from "@/lib/contador/auth-externa/rate-limit"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import { autenticarECriarSessao, ENV_SEGREDO_SESSAO_EXTERNA, CONTADOR_EXTERNO_COOKIE } from "@/lib/contador/auth-externa/sessao"
import { hashSenhaExterna } from "@/lib/contador/auth-externa/usuarios"
import { __setRepoAuthExternaParaTestes } from "./_shared"
import { GET as convitesGET, POST as convitesPOST } from "./convites/route"
import { POST as revogarConvitePOST } from "./convites/[id]/revogar/route"
import { GET as acessosGET } from "./acessos/route"
import { POST as suspenderAcessoPOST } from "./acessos/[id]/suspender/route"
import { POST as reativarAcessoPOST } from "./acessos/[id]/reativar/route"
import { POST as revogarAcessoPOST } from "./acessos/[id]/revogar/route"
import { POST as suspenderUsuarioPOST } from "./usuarios/[id]/suspender/route"
import { POST as reativarUsuarioPOST } from "./usuarios/[id]/reativar/route"

const SEGREDO = "segredo-teste-rotas-014"
const SENHA = "senha-super-secreta-1"
const EMAIL = "contador@escritorio.com"
const ADMIN = "admin-1"
const T0 = new Date("2026-08-01T12:00:00.000Z")

const SCOPE_LOJA_A = { ok: true, storeId: "loja-A", userId: ADMIN, permissaoContador: true } as const
const SCOPE_LOJA_B = { ok: true, storeId: "loja-B", userId: ADMIN, permissaoContador: true } as const

let db: DbFalsoAuthExterna
let repo: AuthExternaRepo

function sessaoAdmin(role = "ADMIN"): Session {
  return { user: { id: ADMIN, role }, expires: "2999-01-01" } as unknown as Session
}

function usarAdmin(scope: unknown = SCOPE_LOJA_A, role = "ADMIN") {
  vi.mocked(requireContadorScope).mockResolvedValue(scope as never)
  // `auth` do NextAuth v5 tem overload de middleware — o cast isola o mock de teste.
  vi.mocked(auth).mockResolvedValue(sessaoAdmin(role) as never)
}

function req(path: string, init: { method?: string; body?: unknown; cookieExterno?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": "198.51.100.4" }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (init.cookieExterno) headers.cookie = `${CONTADOR_EXTERNO_COOKIE}=${init.cookieExterno}`
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

function ctxId(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO
  __resetRateLimitExternoForTests()
  db = criarDbFalsoAuthExterna({
    usuarios: [linhaUsuario({ id: "usr-1", email: EMAIL, senhaHash: await hashSenhaExterna(SENHA) })],
    acessos: [
      linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-A" }),
      linhaAcesso({ id: "acs-2", usuarioId: "usr-1", storeId: "loja-B" }),
    ],
  })
  repo = criarRepoAuthExterna(db)
  __setRepoAuthExternaParaTestes(repo)
  vi.mocked(requireContadorScope).mockReset()
  vi.mocked(auth).mockReset()
  usarAdmin()
  vi.useFakeTimers({ now: T0, toFake: ["Date"] })
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("guard interno — permissão e isolamento de gates (testes 10 e 13)", () => {
  it("interno sem podeGerenciarAcessoExterno → 403 ao convidar (teste 10)", async () => {
    usarAdmin(SCOPE_LOJA_A, "CAIXA")
    const res = await convitesPOST(req("/api/contador-externo/convites", {
      method: "POST",
      body: { email: "novo@escritorio.com" },
    }))
    expect(res.status).toBe(403)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    expect(db.estado.convites).toHaveLength(0)
  })

  it("gerente pode via contador.manageExternalAccess (TESTE 26 — não é financeiro.edit)", async () => {
    usarAdmin(SCOPE_LOJA_A, "GERENTE")
    const res = await convitesPOST(req("/api/contador-externo/convites", {
      method: "POST",
      body: { email: "gerente-ok@escritorio.com" },
    }))
    expect(res.status).toBe(201)
    expect(db.estado.convites).toHaveLength(1)
  })

  it("sessão EXTERNA não autentica rotas internas — requireContadorScope intacto (teste 13)", async () => {
    // Cookie externo válido presente, mas o gate interno não enxerga sessão NextAuth.
    const login = await autenticarECriarSessao(repo, { email: EMAIL, senha: SENHA, env: process.env })
    if (!login.ok) throw new Error("login deveria ter sucesso")
    vi.mocked(requireContadorScope).mockResolvedValue({ ok: false, motivo: "nao_autenticado" } as never)

    const res = await convitesGET(req(`/api/contador-externo/convites`, { cookieExterno: login.cookie.value }))
    expect(res.status).toBe(401)
    // O gate interno é chamado sem nada derivado do request/cookie externo.
    expect(vi.mocked(requireContadorScope).mock.calls[0]!.length).toBe(0)
  })
})

describe("convites (interno)", () => {
  it("POST cria com loja do escopo INTERNO e retorna URL+token UMA vez (sem tokenHash)", async () => {
    const res = await convitesPOST(req("/api/contador-externo/convites", {
      method: "POST",
      body: { email: `  Novo@Escritorio.COM ` },
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body.url).toBe(`http://localhost/contador-externo/convite#token=${body.token}`)
    expect(JSON.stringify(body.convite)).not.toContain("tokenHash")
    const row = db.estado.convites[0]!
    expect(row.storeId).toBe("loja-A") // loja ativa da sessão INTERNA
    expect(row.email).toBe("novo@escritorio.com") // normalizado
    expect(row.criadoPorId).toBe(ADMIN)
    expect(row.papel).toBe("LEITURA")
  })

  it("POST com papel explícito válido honra D-5; papel inválido → 422", async () => {
    const res = await convitesPOST(req("/api/contador-externo/convites", {
      method: "POST",
      body: { email: "a@b.com", papel: "conferencia" },
    }))
    expect(res.status).toBe(201)
    expect(db.estado.convites[0]!.papel).toBe("CONFERENCIA")

    const ruim = await convitesPOST(req("/api/contador-externo/convites", {
      method: "POST",
      body: { email: "b@b.com", papel: "admin" },
    }))
    expect(ruim.status).toBe(422)
  })

  it("storeId/lojaId/userId forjados em body ou query → 400 (teste 11)", async () => {
    for (const extra of [{ storeId: "loja-B" }, { lojaId: "loja-B" }, { userId: "usr-x" }]) {
      const res = await convitesPOST(req("/api/contador-externo/convites", {
        method: "POST",
        body: { email: "a@b.com", ...extra },
      }))
      expect(res.status).toBe(400)
    }
    const query = await convitesPOST(req("/api/contador-externo/convites?storeId=loja-B", {
      method: "POST",
      body: { email: "a@b.com" },
    }))
    expect(query.status).toBe(400)
    expect(db.estado.convites).toHaveLength(0)
  })

  it("GET lista só da loja ativa, sem tokenHash (teste 21 — cross-store interno)", async () => {
    await criarConvite(repo, { email: "a@b.com", storeId: "loja-A", criadoPorId: ADMIN, agora: T0 })
    await criarConvite(repo, { email: "c@d.com", storeId: "loja-B", criadoPorId: ADMIN, agora: T0 })

    const res = await convitesGET(req("/api/contador-externo/convites"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.convites).toHaveLength(1)
    expect(body.convites[0].email).toBe("a@b.com")
    expect(JSON.stringify(body)).not.toContain("tokenHash")
  })

  it("revogar: ok na própria loja; convite de OUTRA loja → 404 genérico (cross-store)", async () => {
    const { convite } = await criarConvite(repo, { email: "a@b.com", storeId: "loja-A", criadoPorId: ADMIN, agora: T0 })

    usarAdmin(SCOPE_LOJA_B)
    const crossStore = await revogarConvitePOST(
      req(`/api/contador-externo/convites/${convite.id}/revogar`, { method: "POST" }),
      ctxId(convite.id),
    )
    expect(crossStore.status).toBe(404)
    expect(db.estado.convites[0]!.revogadoEm).toBeNull()

    usarAdmin(SCOPE_LOJA_A)
    const res = await revogarConvitePOST(
      req(`/api/contador-externo/convites/${convite.id}/revogar`, { method: "POST" }),
      ctxId(convite.id),
    )
    expect(res.status).toBe(200)
    expect(db.estado.convites[0]!.revogadoEm).not.toBeNull()
  })
})

describe("acessos (interno)", () => {
  it("GET lista só os vínculos da loja ativa, com identificação do usuário", async () => {
    const res = await acessosGET(req("/api/contador-externo/acessos"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.acessos).toHaveLength(1)
    expect(body.acessos[0].id).toBe("acs-1")
    expect(body.acessos[0].usuario.email).toBe(EMAIL) // visão admin
  })

  it("suspender/reativar/revogar com escopo duplo; outra loja → 404; transição inválida → 409", async () => {
    // Suspender vínculo que é da loja-B usando a loja-A ativa → 404 (cross-store).
    const cross = await suspenderAcessoPOST(
      req("/api/contador-externo/acessos/acs-2/suspender", { method: "POST" }),
      ctxId("acs-2"),
    )
    expect(cross.status).toBe(404)

    const susp = await suspenderAcessoPOST(
      req("/api/contador-externo/acessos/acs-1/suspender", { method: "POST" }),
      ctxId("acs-1"),
    )
    expect(susp.status).toBe(200)
    expect(db.estado.acessos.find((a) => a.id === "acs-1")!.status).toBe("SUSPENSO")

    const reat = await reativarAcessoPOST(
      req("/api/contador-externo/acessos/acs-1/reativar", { method: "POST" }),
      ctxId("acs-1"),
    )
    expect(reat.status).toBe(200)

    const rev = await revogarAcessoPOST(
      req("/api/contador-externo/acessos/acs-1/revogar", { method: "POST" }),
      ctxId("acs-1"),
    )
    expect(rev.status).toBe(200)
    expect(db.estado.acessos.find((a) => a.id === "acs-1")!.status).toBe("REVOGADO")

    // Revogação é terminal: reativar → 409.
    const terminal = await reativarAcessoPOST(
      req("/api/contador-externo/acessos/acs-1/reativar", { method: "POST" }),
      ctxId("acs-1"),
    )
    expect(terminal.status).toBe(409)
  })
})

describe("usuarios (interno) — ação elevada com storeId de origem", () => {
  it("suspender → 200 com tokenVersion++ e evento na loja de origem; reativar → 200", async () => {
    // Sessão externa ativa do usr-1 para provar a revogação em massa.
    const login = await autenticarECriarSessao(repo, { email: EMAIL, senha: SENHA, env: process.env })
    if (!login.ok) throw new Error("login deveria ter sucesso")

    const res = await suspenderUsuarioPOST(
      req("/api/contador-externo/usuarios/usr-1/suspender", { method: "POST" }),
      ctxId("usr-1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usuario).toEqual({ id: "usr-1", status: "SUSPENSO", tokenVersion: 2 })
    expect(db.estado.sessoes[0]!.revogadoEm).not.toBeNull()
    const evento = db.estado.eventos.find((e) => e.tipo === "usuario_suspenso")!
    expect(evento.storeId).toBe("loja-A") // storeId de ORIGEM da ação (R-7)
    expect(evento.atorId).toBe(ADMIN)

    const reat = await reativarUsuarioPOST(
      req("/api/contador-externo/usuarios/usr-1/reativar", { method: "POST" }),
      ctxId("usr-1"),
    )
    expect(reat.status).toBe(200)
    expect(db.estado.usuarios[0]!.status).toBe("ATIVO")
  })

  it("identidade inexistente → 404", async () => {
    const res = await suspenderUsuarioPOST(
      req("/api/contador-externo/usuarios/usr-x/suspender", { method: "POST" }),
      ctxId("usr-x"),
    )
    expect(res.status).toBe(404)
  })
})
