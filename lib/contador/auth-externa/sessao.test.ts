/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — sessão externa: cookie HMAC Web Crypto,
 * login anti-enumeração, validação por request, rotação, logout e revogação
 * (§D/D.1 + testes 12-16, 19, 20, 22 e 23 do §14).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import bcrypt from "bcryptjs"
import { createContadorSessionToken } from "@/lib/contador/auth/legacy-session"
import { criarDbFalsoAuthExterna, linhaAcesso, linhaUsuario } from "./fakes"
import { criarRepoAuthExterna } from "./repo-prisma"
import {
  CONTADOR_EXTERNO_COOKIE,
  ENV_SEGREDO_SESSAO_EXTERNA,
  SESSAO_EXTERNA_MAX_AGE_SEGUNDOS,
  SessaoExternaIndisponivelError,
  autenticarECriarSessao,
  buildLogoutSessaoExternaCookieOptions,
  extrairTokenSessaoExterna,
  hashIpExterno,
  logoutSessaoExterna,
  resumirUserAgent,
  revogarSessaoAdministrativa,
  validarSessaoExterna,
} from "./sessao"
import { hashSenhaExterna, suspenderIdentidade } from "./usuarios"

const T0 = new Date("2026-08-01T12:00:00.000Z")
const ENV = { [ENV_SEGREDO_SESSAO_EXTERNA]: "segredo-teste-014-externo" }
const SENHA = "senha-super-secreta-1"
const EMAIL = "contador@escritorio.com"
const IP = "203.0.113.9"

afterEach(() => {
  vi.restoreAllMocks()
})

async function montarComUsuario() {
  const db = criarDbFalsoAuthExterna({
    usuarios: [linhaUsuario({ id: "usr-1", email: EMAIL, senhaHash: await hashSenhaExterna(SENHA) })],
  })
  const repo = criarRepoAuthExterna(db)
  return { db, repo }
}

async function login(repo: ReturnType<typeof criarRepoAuthExterna>, agora: Date = T0) {
  const r = await autenticarECriarSessao(repo, {
    email: EMAIL,
    senha: SENHA,
    ip: IP,
    userAgent: "Mozilla/5.0 Teste",
    env: ENV,
    agora,
  })
  if (!r.ok) throw new Error("login deveria ter sucesso")
  return r
}

function decodificarPayload(token: string): Record<string, unknown> {
  const [payloadB64] = token.split(".")
  return JSON.parse(Buffer.from(payloadB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
}

describe("login (autenticarECriarSessao)", () => {
  it("cria a linha de sessão (trilha durável) e emite cookie HMAC com os atributos exigidos", async () => {
    const { db, repo } = await montarComUsuario()
    const r = await login(repo)

    expect(r.cookie.name).toBe(CONTADOR_EXTERNO_COOKIE)
    expect(r.cookie.httpOnly).toBe(true)
    expect(r.cookie.sameSite).toBe("lax")
    expect(r.cookie.path).toBe("/")
    expect(r.cookie.maxAge).toBeLessThanOrEqual(SESSAO_EXTERNA_MAX_AGE_SEGUNDOS)
    expect(SESSAO_EXTERNA_MAX_AGE_SEGUNDOS).toBe(12 * 60 * 60)

    const linha = db.estado.sessoes[0]!
    expect(linha.id).toBe(r.sessao.id)
    expect(linha.usuarioId).toBe("usr-1")
    expect(linha.expiraEm.getTime()).toBe(T0.getTime() + SESSAO_EXTERNA_MAX_AGE_SEGUNDOS * 1000)
    // Minimização: IP bruto NUNCA; UA resumido.
    expect(linha.ipHash).toBe(await hashIpExterno(IP))
    expect(JSON.stringify(linha)).not.toContain(IP)
    expect(linha.userAgentResumo).toBe("Mozilla/5.0 Teste")
    expect(db.estado.usuarios[0]!.ultimoLoginEm).toEqual(T0)
  })

  it("payload carrega SOMENTE {v, sid, tv, iat, exp} — nunca e-mail, senha ou loja", async () => {
    const { repo } = await montarComUsuario()
    const r = await login(repo)
    const payload = decodificarPayload(r.cookie.value)
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sid", "tv", "v"])
    expect(payload.v).toBe(1)
    expect(payload.sid).toBe(r.sessao.id)
    expect(payload.tv).toBe(1)
    expect(JSON.stringify(payload)).not.toContain(EMAIL)
  })

  it("anti-enumeração (R-2): bcrypt.compare SEMPRE executado e mensagem idêntica", async () => {
    const espiao = vi.spyOn(bcrypt, "compare")
    const { repo } = await montarComUsuario()

    const inexistente = await autenticarECriarSessao(repo, {
      email: "ninguem@aqui.com",
      senha: SENHA,
      env: ENV,
      agora: T0,
    })
    const senhaErrada = await autenticarECriarSessao(repo, {
      email: EMAIL,
      senha: "senha-errada",
      env: ENV,
      agora: T0,
    })
    // Usuário inexistente TAMBÉM passou pelo compare (hash dummy).
    expect(espiao).toHaveBeenCalledTimes(2)
    expect(inexistente).toEqual({ ok: false, motivo: "credenciais_invalidas" })
    expect(senhaErrada).toEqual({ ok: false, motivo: "credenciais_invalidas" })
  })

  it("identidade suspensa recebe a MESMA recusa genérica (não revela estado da conta)", async () => {
    const db = criarDbFalsoAuthExterna({
      usuarios: [
        linhaUsuario({ id: "usr-1", email: EMAIL, status: "SUSPENSO", senhaHash: await hashSenhaExterna(SENHA) }),
      ],
    })
    const repo = criarRepoAuthExterna(db)
    const r = await autenticarECriarSessao(repo, { email: EMAIL, senha: SENHA, env: ENV, agora: T0 })
    expect(r).toEqual({ ok: false, motivo: "credenciais_invalidas" })
  })

  it("e-mail normalizado no login (trim + lowercase)", async () => {
    const { repo } = await montarComUsuario()
    const r = await autenticarECriarSessao(repo, { email: "  Contador@Escritorio.COM ", senha: SENHA, env: ENV, agora: T0 })
    expect(r.ok).toBe(true)
  })

  it("sem CONTADOR_EXTERNO_SESSION_SECRET → falha fechada (R-9), nunca fallback", async () => {
    const { repo } = await montarComUsuario()
    await expect(
      autenticarECriarSessao(repo, { email: EMAIL, senha: SENHA, env: {}, agora: T0 }),
    ).rejects.toBeInstanceOf(SessaoExternaIndisponivelError)
  })
})

describe("validarSessaoExterna — cadeia completa por request", () => {
  it("cookie válido passa e toca ultimoUsoEm", async () => {
    const { db, repo } = await montarComUsuario()
    const login1 = await login(repo)
    const depois = new Date(T0.getTime() + 60_000)
    const r = await validarSessaoExterna(repo, login1.cookie.value, { env: ENV, agora: depois })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.usuario.id).toBe("usr-1")
      expect(r.sessao.id).toBe(login1.sessao.id)
      expect(r.rotacao).toBeNull() // <50% da vida
    }
    expect(db.estado.sessoes[0]!.ultimoUsoEm).toEqual(depois)
  })

  it("cookie do portal LEGADO é rejeitado (R-4 — verificador e chave distintos)", async () => {
    const { repo } = await montarComUsuario()
    await login(repo)
    const legado = await createContadorSessionToken("segredo-teste-014-externo", T0.getTime())
    const r = await validarSessaoExterna(repo, legado, { env: ENV, agora: T0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe("assinatura")
  })

  it("cookie adulterado é rejeitado", async () => {
    const { repo } = await montarComUsuario()
    const r0 = await login(repo)
    const [payloadB64, sigB64] = r0.cookie.value.split(".")
    const r = await validarSessaoExterna(repo, `${payloadB64}x.${sigB64}`, { env: ENV, agora: T0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBe("assinatura")
  })

  it("formato inválido e cookie ausente são rejeitados", async () => {
    const { repo } = await montarComUsuario()
    const malformado = await validarSessaoExterna(repo, "1", { env: ENV, agora: T0 })
    expect(malformado).toEqual({ ok: false, motivo: "formato" })
    const ausente = await validarSessaoExterna(repo, undefined, { env: ENV, agora: T0 })
    expect(ausente).toEqual({ ok: false, motivo: "cookie_ausente" })
  })

  it("sessão expirada (exp do payload) é rejeitada", async () => {
    const { repo } = await montarComUsuario()
    const r0 = await login(repo)
    const depoisDas12h = new Date(T0.getTime() + (SESSAO_EXTERNA_MAX_AGE_SEGUNDOS + 60) * 1000)
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: depoisDas12h })
    expect(r).toEqual({ ok: false, motivo: "expirado" })
  })

  it("sid desconhecido é rejeitado", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    db.estado.sessoes = [] // linha sumiu (higiene/expurgo)
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: T0 })
    expect(r).toEqual({ ok: false, motivo: "sessao_desconhecida" })
  })

  it("revogação administrativa derruba a request seguinte (teste 14)", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    const ok = await revogarSessaoAdministrativa(repo, {
      sessaoId: r0.sessao.id,
      adminId: "admin-1",
      storeIdOrigem: "loja-1",
      agora: T0,
    })
    expect(ok).toBe(true)
    expect(db.estado.sessoes[0]!.revogadoEm).toEqual(T0)
    expect(db.estado.eventos.some((e) => e.tipo === "sessao_revogada" && e.storeId === "loja-1")).toBe(true)

    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: new Date(T0.getTime() + 1000) })
    expect(r).toEqual({ ok: false, motivo: "sessao_revogada" })
  })

  it("identidade suspensa perde acesso: sessões revogadas + tokenVersion++ (teste 16)", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    await suspenderIdentidade(repo, {
      usuarioId: "usr-1",
      adminId: "admin-1",
      storeIdOrigem: "loja-1",
      agora: T0,
    })
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: new Date(T0.getTime() + 1000) })
    expect(r).toEqual({ ok: false, motivo: "sessao_revogada" })

    // Defesa em profundidade: mesmo se a linha NÃO fosse revogada, o status barra.
    db.estado.sessoes[0]!.revogadoEm = null
    const r2 = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: new Date(T0.getTime() + 1000) })
    expect(r2).toEqual({ ok: false, motivo: "usuario_suspenso" })
  })

  it("tokenVersion divergente (cookie antigo, usuário ativo) é rejeitada", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    db.estado.usuarios[0]!.tokenVersion = 2 // bump fora de banda
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: T0 })
    expect(r).toEqual({ ok: false, motivo: "versao_token" })
  })

  it("sem segredo → motivo 'indisponivel' (fail-closed, teste 23)", async () => {
    const { repo } = await montarComUsuario()
    const r0 = await login(repo)
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: {}, agora: T0 })
    expect(r).toEqual({ ok: false, motivo: "indisponivel" })
  })

  it("rotação após 50% da vida: mesmo sid, novo iat/exp, expiraEm estendida (§D.1)", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    const depoisDe7h = new Date(T0.getTime() + 7 * 60 * 60 * 1000)
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: depoisDe7h })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rotacao).not.toBeNull()
    const payload = decodificarPayload(r.rotacao!.value)
    expect(payload.sid).toBe(r0.sessao.id) // MESMO sid
    expect(payload.iat).toBe(depoisDe7h.getTime())
    expect(payload.exp).toBe(depoisDe7h.getTime() + SESSAO_EXTERNA_MAX_AGE_SEGUNDOS * 1000)
    // Linha estendida (sliding) além das 12h originais.
    expect(db.estado.sessoes[0]!.expiraEm.getTime()).toBe(
      depoisDe7h.getTime() + SESSAO_EXTERNA_MAX_AGE_SEGUNDOS * 1000,
    )
    // O cookie ROTACIONADO valida normalmente.
    const r2 = await validarSessaoExterna(repo, r.rotacao!.value, { env: ENV, agora: depoisDe7h })
    expect(r2.ok).toBe(true)
  })
})

describe("logout (teste 15)", () => {
  it("revoga a linha e devolve cookie limpo com o mesmo nome/path", async () => {
    const { db, repo } = await montarComUsuario()
    const r0 = await login(repo)
    const r = await logoutSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: T0, ip: IP })

    expect(r.revogou).toBe(true)
    expect(db.estado.sessoes[0]!.revogadoEm).toEqual(T0)
    expect(r.cookieLimpo.maxAge).toBe(0)
    expect(r.cookieLimpo.value).toBe("")
    expect(r.cookieLimpo.name).toBe(r0.cookie.name)
    expect(r.cookieLimpo.path).toBe(r0.cookie.path)

    const depois = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: new Date(T0.getTime() + 1000) })
    expect(depois).toEqual({ ok: false, motivo: "sessao_revogada" })
  })

  it("cookie adulterado também limpa o cookie, sem revelar nada", async () => {
    const { repo } = await montarComUsuario()
    const r = await logoutSessaoExterna(repo, "lixo.adulterado", { env: ENV, agora: T0 })
    expect(r.revogou).toBe(false)
    expect(r.cookieLimpo.maxAge).toBe(0)
  })

  it("buildLogoutSessaoExternaCookieOptions tem os mesmos atributos de segurança", () => {
    const c = buildLogoutSessaoExternaCookieOptions()
    expect(c.httpOnly).toBe(true)
    expect(c.sameSite).toBe("lax")
  })
})

describe("minimização e helpers", () => {
  it("hashIpExterno é determinístico, salgado e nunca contém o IP", async () => {
    const h1 = await hashIpExterno(IP)
    const h2 = await hashIpExterno(IP)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
    expect(h1).not.toContain(IP)
  })

  it("resumirUserAgent trunca em 200 e vazio vira null", () => {
    expect(resumirUserAgent("x".repeat(300))).toHaveLength(200)
    expect(resumirUserAgent("   ")).toBeNull()
    expect(resumirUserAgent(null)).toBeNull()
  })

  it("extrairTokenSessaoExterna lê só o cookie externo do header", () => {
    const header = `assistec_session=abc; ${CONTADOR_EXTERNO_COOKIE}=tok.ext.1; outro=z`
    expect(extrairTokenSessaoExterna(header)).toBe("tok.ext.1")
    expect(extrairTokenSessaoExterna("assistec_session=abc")).toBeNull()
    expect(extrairTokenSessaoExterna(null)).toBeNull()
  })

  it("logs de login/logout NUNCA contêm senha, e-mail, cookie ou IP bruto (teste 20)", async () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {})
    const { repo } = await montarComUsuario()
    const r0 = await login(repo)
    await autenticarECriarSessao(repo, { email: EMAIL, senha: "errada-123", ip: IP, env: ENV, agora: T0 })
    await logoutSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: T0, ip: IP })

    expect(espiao.mock.calls.length).toBeGreaterThan(0)
    for (const chamada of espiao.mock.calls) {
      const linha = JSON.stringify(chamada)
      expect(linha).not.toContain(SENHA)
      expect(linha).not.toContain(EMAIL)
      expect(linha).not.toContain(IP)
      expect(linha).not.toContain(r0.cookie.value)
    }
  })
})

describe("isolamento de vínculos via sessão (base dos testes 17/18 — escopo em escopo-externo.test.ts)", () => {
  it("fixture de vínculo suspensivo não interfere na sessão em si", async () => {
    const db = criarDbFalsoAuthExterna({
      usuarios: [linhaUsuario({ id: "usr-1", email: EMAIL, senhaHash: await hashSenhaExterna(SENHA) })],
      acessos: [linhaAcesso({ id: "acs-1", usuarioId: "usr-1", storeId: "loja-1", status: "SUSPENSO" })],
    })
    const repo = criarRepoAuthExterna(db)
    const r0 = await login(repo)
    const r = await validarSessaoExterna(repo, r0.cookie.value, { env: ENV, agora: T0 })
    expect(r.ok).toBe(true) // a sessão é da PESSOA; loja é checada no escopo, por request
  })
})
