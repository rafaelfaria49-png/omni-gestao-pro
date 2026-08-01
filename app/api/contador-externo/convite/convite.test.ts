/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — rotas públicas de convite
 * (testes 5-9, 11, 20, 22 e 23 do §14 na camada HTTP).
 *
 * Repo fake in-memory via `__setRepoAuthExternaParaTestes`; sem banco, sem
 * `vi.mock("@/lib/prisma")`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { aceitarConvite as aceitarDominio, criarConvite, revogarConvite as revogarDominio } from "@/lib/contador/auth-externa/convites"
import { criarDbFalsoAuthExterna, type DbFalsoAuthExterna } from "@/lib/contador/auth-externa/fakes"
import { __resetRateLimitExternoForTests } from "@/lib/contador/auth-externa/rate-limit"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import { CONTADOR_EXTERNO_COOKIE, ENV_SEGREDO_SESSAO_EXTERNA } from "@/lib/contador/auth-externa/sessao"
import { __setRepoAuthExternaParaTestes } from "../_shared"
import { POST as consultarPOST } from "./consultar/route"
import { POST as aceitarPOST } from "./aceitar/route"

const SEGREDO = "segredo-teste-rotas-014"
const SENHA = "senha-super-secreta-1"
const EMAIL = "contador@escritorio.com"
const LOJA_A = "loja-A"
const LOJA_B = "loja-B"
const ADMIN = "admin-1"
const T0 = new Date("2026-08-01T12:00:00.000Z")

let db: DbFalsoAuthExterna
let repo: AuthExternaRepo

function reqAceite(body: unknown, query = "") {
  return new Request(`http://localhost/api/contador-externo/convite/aceitar${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body ?? {}),
  })
}

function reqConsulta(token: string, query = "") {
  // Ajuste G3: o token NUNCA vai em path nem query — somente no body do POST.
  return new Request(`http://localhost/api/contador-externo/convite/consultar${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ token }),
  })
}

async function conviteNovo(agora: Date = T0) {
  return criarConvite(repo, { email: EMAIL, storeId: LOJA_A, criadoPorId: ADMIN, agora })
}

beforeEach(() => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO
  __resetRateLimitExternoForTests()
  db = criarDbFalsoAuthExterna()
  repo = criarRepoAuthExterna(db)
  __setRepoAuthExternaParaTestes(repo)
  vi.useFakeTimers({ now: T0, toFake: ["Date"] })
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("POST /convite/consultar (token SOMENTE no body — ajuste G3)", () => {
  it("válido → 200 com e-mail mascarado e SEM vazar e-mail real/token/tokenHash", async () => {
    const { token } = await conviteNovo()
    const res = await consultarPOST(reqConsulta(token))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    const body = await res.json()
    expect(body.estado).toBe("valido")
    expect(body.emailMascarado).toBe("c***@escritorio.com")
    const bruto = JSON.stringify(body)
    expect(bruto).not.toContain(EMAIL)
    expect(bruto).not.toContain(token)
    expect(bruto).not.toContain("tokenHash")
  })

  it("estados honestos: expirado, revogado, utilizado; desconhecido → invalido genérico", async () => {
    const expirado = await criarConvite(repo, {
      email: "a@b.com",
      storeId: LOJA_A,
      criadoPorId: ADMIN,
      agora: new Date(T0.getTime() - 73 * 60 * 60 * 1000),
    })
    expect((await (await consultarPOST(reqConsulta(expirado.token))).json()).estado).toBe("expirado")

    const revogado = await criarConvite(repo, { email: "r@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    await revogarDominio(repo, { conviteId: revogado.convite.id, storeId: LOJA_A, adminId: ADMIN, agora: T0 })
    expect((await (await consultarPOST(reqConsulta(revogado.token))).json()).estado).toBe("revogado")

    const usado = await criarConvite(repo, { email: "u@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    await aceitarDominio(repo, { token: usado.token, nome: "Ana", senha: SENHA, agora: T0 })
    expect((await (await consultarPOST(reqConsulta(usado.token))).json()).estado).toBe("utilizado")

    const res = await consultarPOST(reqConsulta("token-inexistente"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.estado).toBe("invalido")
    expect(body.emailMascarado).toBeUndefined()
  })

  it("storeId na query ou no corpo → 400 (teste 11)", async () => {
    const { token } = await conviteNovo()
    const res = await consultarPOST(reqConsulta(token, "?storeId=loja-B"))
    expect(res.status).toBe(400)
    const corpo = new Request("http://localhost/api/contador-externo/convite/consultar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, storeId: LOJA_B }),
    })
    expect((await consultarPOST(corpo)).status).toBe(400)
  })
})

describe("POST /convite/aceitar", () => {
  it("sucesso → 201 + cookie de sessão; vínculo com o storeId DA LINHA (teste 9)", async () => {
    const { token } = await conviteNovo()
    const res = await aceitarPOST(reqAceite({ token, nome: "Ana Contadora", senha: SENHA }))
    expect(res.status).toBe(201)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.sessaoCriada).toBe(true)
    expect(JSON.stringify(body)).not.toContain(EMAIL) // e-mail não volta na resposta
    expect(res.cookies.get(CONTADOR_EXTERNO_COOKIE)?.value).toBeTruthy()

    // Convite da loja A NUNCA cria vínculo com a loja B (§9).
    expect(db.estado.acessos).toHaveLength(1)
    expect(db.estado.acessos[0]!.storeId).toBe(LOJA_A)
    expect(db.estado.acessos.some((a) => a.storeId === LOJA_B)).toBe(false)
    expect(db.estado.usuarios[0]!.email).toBe(EMAIL) // e-mail DA LINHA
  })

  it("chaves de escopo forjadas no corpo ou na query → 400 (teste 11)", async () => {
    const { token } = await conviteNovo()
    for (const extra of [{ storeId: LOJA_B }, { papel: "CONFERENCIA" }, { usuarioId: "usr-x" }]) {
      const res = await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA, ...extra }))
      expect(res.status).toBe(400)
    }
    const query = await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA }, "?lojaId=loja-B"))
    expect(query.status).toBe(400)
    expect(db.estado.acessos).toHaveLength(0)
  })

  it("anti-enumeração (teste 22): expirado, revogado, utilizado e inexistente → respostas IDÊNTICAS", async () => {
    const expirado = await criarConvite(repo, {
      email: "e@b.com",
      storeId: LOJA_A,
      criadoPorId: ADMIN,
      agora: new Date(T0.getTime() - 73 * 60 * 60 * 1000),
    })
    const revogado = await criarConvite(repo, { email: "r@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    await revogarDominio(repo, { conviteId: revogado.convite.id, storeId: LOJA_A, adminId: ADMIN, agora: T0 })
    const usado = await criarConvite(repo, { email: "u@b.com", storeId: LOJA_A, criadoPorId: ADMIN, agora: T0 })
    await aceitarDominio(repo, { token: usado.token, nome: "Ana", senha: SENHA, agora: T0 })

    const respostas = await Promise.all(
      [expirado.token, revogado.token, usado.token, "token-inexistente"].map(async (token) => {
        const res = await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA }))
        return { status: res.status, body: await res.json() }
      }),
    )
    for (const r of respostas) {
      expect(r.status).toBe(400)
      expect(r.body).toEqual(respostas[0]!.body)
    }
  })

  it("rate limit (R-3): 6ª tentativa de aceite → 429 + Retry-After", async () => {
    // Tokens inválidos compartilham a chave "desconhecido|IP".
    for (let i = 0; i < 5; i++) {
      const res = await aceitarPOST(reqAceite({ token: `token-ruim-${i}`, nome: "Ana", senha: SENHA }))
      expect(res.status).toBe(400)
    }
    const sexta = await aceitarPOST(reqAceite({ token: "token-ruim-6", nome: "Ana", senha: SENHA }))
    expect(sexta.status).toBe(429)
    expect(sexta.headers.get("Retry-After")).toBeTruthy()
  })

  it("sem CONTADOR_EXTERNO_SESSION_SECRET → 503 ANTES de gravar (teste 23, fail-closed)", async () => {
    const { token } = await conviteNovo()
    delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
    const res = await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA }))
    expect(res.status).toBe(503)
    // Nada foi consumido/criado: o convite continua aberto e não há usuário.
    expect(db.estado.convites[0]!.usadoEm).toBeNull()
    expect(db.estado.usuarios).toHaveLength(0)
    expect(db.estado.acessos).toHaveLength(0)
  })

  it("o token NUNCA aparece em logs durante o aceite (teste 20)", async () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {})
    const { token } = await conviteNovo()
    await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA }))
    await aceitarPOST(reqAceite({ token, nome: "Ana", senha: SENHA }))
    for (const chamada of espiao.mock.calls) {
      const linha = JSON.stringify(chamada)
      expect(linha).not.toContain(token)
      expect(linha).not.toContain(SENHA)
      expect(linha).not.toContain(EMAIL)
    }
  })
})
