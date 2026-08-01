/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — GET /lojas (testes 17, 18 e 21 do §14
 * na camada HTTP): só vínculos ATIVOS, cross-store, vínculo revogado some da lista.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/contador/scope", () => ({ requireContadorScope: vi.fn() }))

import { revogarVinculo } from "@/lib/contador/auth-externa/acessos"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario, type DbFalsoAuthExterna } from "@/lib/contador/auth-externa/fakes"
import { __resetRateLimitExternoForTests } from "@/lib/contador/auth-externa/rate-limit"
import { criarRepoAuthExterna, type AuthExternaRepo } from "@/lib/contador/auth-externa/repo-prisma"
import { autenticarECriarSessao, ENV_SEGREDO_SESSAO_EXTERNA, CONTADOR_EXTERNO_COOKIE } from "@/lib/contador/auth-externa/sessao"
import { hashSenhaExterna } from "@/lib/contador/auth-externa/usuarios"
import { __setRepoAuthExternaParaTestes } from "../_shared"
import { GET as lojasGET } from "./route"

const SEGREDO = "segredo-teste-rotas-014"
const SENHA = "senha-super-secreta-1"
const EMAIL = "contador@escritorio.com"

let db: DbFalsoAuthExterna
let repo: AuthExternaRepo

function req(cookie?: string, query = "") {
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9" }
  if (cookie) headers.cookie = `${CONTADOR_EXTERNO_COOKIE}=${cookie}`
  return new Request(`http://localhost/api/contador-externo/lojas${query}`, { headers })
}

async function login(): Promise<string> {
  const r = await autenticarECriarSessao(repo, { email: EMAIL, senha: SENHA, env: process.env })
  if (!r.ok) throw new Error("login deveria ter sucesso")
  return r.cookie.value
}

beforeEach(async () => {
  process.env[ENV_SEGREDO_SESSAO_EXTERNA] = SEGREDO
  __resetRateLimitExternoForTests()
  db = criarDbFalsoAuthExterna({
    usuarios: [
      linhaUsuario({ id: "usr-1", email: EMAIL, senhaHash: await hashSenhaExterna(SENHA) }),
      linhaUsuario({ id: "usr-2", email: "outro@escritorio.com" }),
    ],
    acessos: [
      linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-A", papel: "LEITURA" }),
      linhaAcesso({ id: "acs-2", usuarioId: "usr-1", storeId: "loja-B", papel: "CONFERENCIA" }),
      linhaAcesso({ id: "acs-3", usuarioId: "usr-2", storeId: "loja-C" }),
    ],
  })
  repo = criarRepoAuthExterna(db)
  __setRepoAuthExternaParaTestes(repo)
})

afterEach(() => {
  __setRepoAuthExternaParaTestes(null)
  delete process.env[ENV_SEGREDO_SESSAO_EXTERNA]
  vi.restoreAllMocks()
})

describe("GET /lojas — escopo por vínculo ATIVO (nenhum dado contábil)", () => {
  it("sem cookie → 401; com sessão → só as lojas DO CONTADOR (cross-store, teste 21)", async () => {
    expect((await lojasGET(req())).status).toBe(401)

    const token = await login()
    const res = await lojasGET(req(token))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    const body = await res.json()
    // loja-C é de OUTRO contador — nunca aparece.
    expect(body.lojas).toEqual([
      { storeId: "loja-A", papel: "LEITURA" },
      { storeId: "loja-B", papel: "CONFERENCIA" },
    ])
    expect(JSON.stringify(body)).not.toMatch(/competencia|documento|pacote|dashboard/i)
  })

  it("vínculo revogado: loja some da lista (teste 18); demais intactas (teste 17)", async () => {
    const token = await login()
    await revogarVinculo(repo, { acessoId: "acs-1", storeId: "loja-A", adminId: "admin-1" })

    const res = await lojasGET(req(token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lojas).toEqual([{ storeId: "loja-B", papel: "CONFERENCIA" }])
  })

  it("storeId na query → 400 (a loja nunca vem do cliente)", async () => {
    const token = await login()
    expect((await lojasGET(req(token, "?storeId=loja-C"))).status).toBe(400)
  })
})
