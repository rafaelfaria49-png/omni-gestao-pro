/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — rotas externas de auth (testes 12, 19,
 * 20, 22 e 23 do §14).
 *
 * Sem banco: repo fake in-memory injetado via `__setRepoAuthExternaParaTestes`
 * (mesmo espírito de `lib/contador/auth-externa/fakes.ts`); `@/auth` e
 * `@/lib/contador/scope` mockados só para isolar o import (as rotas externas
 * NUNCA os chamam — o gate delas é o cookie externo). Sem `vi.mock("@/lib/prisma")`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { createContadorSessionToken } from "@/lib/contador/auth/legacy-session"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario, type DbFalsoAuthExterna } from "@/lib/contador/auth-externa/fakes"
import { __resetRateLimitExternoForTests } from "@/lib/contador/auth-externa/rate-limit"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import { CONTADOR_EXTERNO_COOKIE, ENV_SEGREDO_SESSAO_EXTERNA } from "@/lib/contador/auth-externa/sessao"
import { hashSenhaExterna } from "@/lib/contador/auth-externa/usuarios"
import { __setRepoAuthExternaParaTestes } from "../_shared"
import { POST as loginPOST } from "./login/route"
import { POST as logoutPOST } from "./logout/route"
import { GET as sessaoGET } from "./sessao/route"

// Arquivo bcrypt-bound por desenho (cada login = comparação bcrypt, CPU-bound).
// Sob a carga paralela da suíte completa o default de 5s por teste estoura
// (flake de timeout, não de lógica) — o orçamento honesto é por arquivo.
vi.setConfig({ testTimeout: 30000 })

const SEGREDO = "segredo-teste-rotas-014"
const SENHA = "senha-super-secreta-1"
const EMAIL = "contador@escritorio.com"
const IP = "203.0.113.9"

let db: DbFalsoAuthExterna
let repo: AuthExternaRepo

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? IP }
  if (init.body !== undefined) headers["content-type"] = "application/json"
  if (init.cookie) headers.cookie = `${CONTADOR_EXTERNO_COOKIE}=${init.cookie}`
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

async function cookieDeLogin(): Promise<string> {
  const res = await loginPOST(req("/api/contador-externo/auth/login", {
    method: "POST",
    body: { email: EMAIL, senha: SENHA },
  }))
  const valor = res.cookies.get(CONTADOR_EXTERNO_COOKIE)?.value
  if (!valor) throw new Error("login deveria ter setado o cookie")
  return valor
}

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO
  __resetRateLimitExternoForTests()
  db = criarDbFalsoAuthExterna({
    usuarios: [linhaUsuario({ id: "usr-1", email: EMAIL, senhaHash: await hashSenhaExterna(SENHA) })],
    acessos: [linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-1" })],
  })
  repo = criarRepoAuthExterna(db)
  __setRepoAuthExternaParaTestes(repo)
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("POST /auth/login", () => {
  it("sucesso → 200, cookie HMAC setado, linha persistida, resposta sem e-mail", async () => {
    const res = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: `  ${EMAIL.toUpperCase()} `, senha: SENHA },
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    const cookie = res.cookies.get(CONTADOR_EXTERNO_COOKIE)
    expect(cookie?.value).toBeTruthy()
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.path).toBe("/")
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(JSON.stringify(body)).not.toContain(EMAIL)
    expect(db.estado.sessoes).toHaveLength(1)
  })

  it("anti-enumeração (teste 22): usuário inexistente e senha errada → respostas IDÊNTICAS", async () => {
    const inexistente = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: "ninguem@aqui.com", senha: SENHA },
    }))
    const senhaErrada = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: EMAIL, senha: "senha-errada-1" },
    }))
    expect(inexistente.status).toBe(401)
    expect(senhaErrada.status).toBe(401)
    expect(await inexistente.json()).toEqual(await senhaErrada.json())
    expect(inexistente.cookies.get(CONTADOR_EXTERNO_COOKIE)).toBeUndefined()
  })

  it("rate limit (teste 22/R-3): 6ª tentativa → 429 + Retry-After; outro e-mail no mesmo IP passa", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await loginPOST(req("/api/contador-externo/auth/login", {
        method: "POST",
        body: { email: EMAIL, senha: "senha-errada-1" },
      }))
      expect(res.status).toBe(401)
    }
    const sexta = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: EMAIL, senha: SENHA }, // senha CERTA também é barrada
    }))
    expect(sexta.status).toBe(429)
    expect(sexta.headers.get("Retry-After")).toBeTruthy()
    const body = await sexta.json()
    expect(body.retryAfterSeconds).toBeGreaterThan(0)

    const outroEmail = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: "outro@aqui.com", senha: "x-errada-1" },
    }))
    expect(outroEmail.status).toBe(401) // chave e-mail+IP independente
    // Timeout ampliado: 7 logins = 7 avaliações bcrypt (CPU-bound); sob a carga
    // paralela da suíte completa o default de 5s estoura (flake, não lógica).
  }, 30000)

  it("sem CONTADOR_EXTERNO_SESSION_SECRET → 503 fail-closed (teste 23)", async () => {
    delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
    const res = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: EMAIL, senha: SENHA },
    }))
    expect(res.status).toBe(503)
    expect(db.estado.sessoes).toHaveLength(0)
  })

  it("chave proibida no corpo ou na query → 400", async () => {
    const corpo = await loginPOST(req("/api/contador-externo/auth/login", {
      method: "POST",
      body: { email: EMAIL, senha: SENHA, role: "admin" },
    }))
    expect(corpo.status).toBe(400)
    const query = await loginPOST(req("/api/contador-externo/auth/login?storeId=loja-9", {
      method: "POST",
      body: { email: EMAIL, senha: SENHA },
    }))
    expect(query.status).toBe(400)
  })
})

describe("GET /auth/sessao", () => {
  it("cookie interno/legado NÃO autentica rotas externas (teste 12)", async () => {
    const legado = await createContadorSessionToken(SEGREDO)
    const res = await sessaoGET(req("/api/contador-externo/auth/sessao", { cookie: legado }))
    expect(res.status).toBe(401)
    expect((await res.json()).motivo).toBe("sessao_invalida")
  })

  it("sem cookie → 401 nao_autenticado; com cookie válido → 200 com identificação mínima e lojas", async () => {
    expect((await sessaoGET(req("/api/contador-externo/auth/sessao"))).status).toBe(401)

    const token = await cookieDeLogin()
    const res = await sessaoGET(req("/api/contador-externo/auth/sessao", { cookie: token }))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    const body = await res.json()
    expect(body.usuario.id).toBe("usr-1")
    expect(body.lojas).toEqual([{ storeId: "loja-1", papel: "LEITURA" }])
    // Nenhum dado contábil no payload da sessão.
    expect(JSON.stringify(body)).not.toMatch(/competencia|documento|pacote/i)
  })

  it("rotação após 50% da vida regrava o cookie na resposta (§D.1)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-01T12:00:00.000Z"), toFake: ["Date"] })
    const token = await cookieDeLogin()
    vi.setSystemTime(new Date("2026-08-01T19:00:00.000Z")) // +7h de 12h

    const res = await sessaoGET(req("/api/contador-externo/auth/sessao", { cookie: token }))
    expect(res.status).toBe(200)
    const novo = res.cookies.get(CONTADOR_EXTERNO_COOKIE)?.value
    expect(novo).toBeTruthy()
    expect(novo).not.toBe(token)
  })

  it("sem segredo → 503 indisponivel (fail-closed)", async () => {
    const token = await cookieDeLogin()
    delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
    const res = await sessaoGET(req("/api/contador-externo/auth/sessao", { cookie: token }))
    expect(res.status).toBe(503)
  })
})

describe("POST /auth/logout", () => {
  it("revoga a linha e limpa o cookie; a request seguinte cai (testes 14/15)", async () => {
    const token = await cookieDeLogin()
    const res = await logoutPOST(req("/api/contador-externo/auth/logout", { method: "POST", cookie: token }))
    expect(res.status).toBe(200)
    const limpo = res.cookies.get(CONTADOR_EXTERNO_COOKIE)
    expect(limpo?.value).toBe("")
    expect(limpo?.maxAge).toBe(0)
    expect(db.estado.sessoes[0]!.revogadoEm).not.toBeNull()

    const depois = await sessaoGET(req("/api/contador-externo/auth/sessao", { cookie: token }))
    expect(depois.status).toBe(401)
  })

  it("sem cookie também responde 200 e limpa (não revela nada)", async () => {
    const res = await logoutPOST(req("/api/contador-externo/auth/logout", { method: "POST" }))
    expect(res.status).toBe(200)
    expect(res.cookies.get(CONTADOR_EXTERNO_COOKIE)?.value).toBe("")
  })
})
