/**
 * Contador HUB · Identidade externa — sessão externa revogável (GOAL 014, §D/D.1).
 *
 * Cookie `assistec_contador_ext_session` (distinto do NextAuth, do legado
 * `assistec_contador_session` e do admin): `base64url(payload).base64url(assinatura)`,
 * payload `{ v: 1, sid, tv, iat, exp }`, HMAC-SHA256 via Web Crypto (Edge-safe — NÃO
 * usar node:crypto aqui). Chave derivada com separação de domínio (padrão
 * `documentos/intent.ts`): `HMAC(CONTADOR_EXTERNO_SESSION_SECRET,
 * "omni.contador.externo.session/v1")`.
 *
 * Desvio documentado em relação ao §D.1: o payload carrega `tv` (tokenVersion) além
 * de {v, sid, iat, exp}. É a única forma de a checagem "tokenVersion coerente"
 * (§D.1, validação por request) existir de verdade — sem um valor de referência no
 * cookie assinado, a coerência dependeria só da revogação em massa. O campo é
 * protegido pelo HMAC e não vaza nada além de um inteiro.
 *
 * Sem segredo → FALHA FECHADA (R-9): criação lança `SessaoExternaIndisponivelError`
 * e a validação retorna motivo "indisponivel" (rotas respondem 503). NUNCA fallback.
 *
 * A sessão identifica a PESSOA, não autoriza loja alguma: a linha não tem storeId
 * e a validação de loja é por request contra `ContadorAcesso` (escopo-externo.ts).
 */
import { extractClientIp } from "@/lib/contador/auth/legacy-session"
import { logEventoExterno, montarEventoContador } from "./eventos"
import type { AuthExternaRepo, NovaSessaoData } from "./repo-prisma"
import type { SessaoRow, UsuarioRow } from "./tipos"
import { compararSenhaExterna, hashSenhaExterna, normalizarEmail } from "./usuarios"

export const CONTADOR_EXTERNO_COOKIE = "assistec_contador_ext_session"
export const SESSAO_EXTERNA_MAX_AGE_SEGUNDOS = 60 * 60 * 12 // 12h (§D)
export const ENV_SEGREDO_SESSAO_EXTERNA = "CONTADOR_EXTERNO_SESSION_SECRET" as const

/** Separação de domínio da derivação de chave (padrão `intent.ts`). */
const DOMINIO_SESSAO_EXTERNA = "omni.contador.externo.session/v1"

const encoder = new TextEncoder()

export type EnvSessaoExterna = Record<string, string | undefined>

/* ───────────────────────────── base64url / HMAC ───────────────────────────── */

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4))
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Deriva a chave de assinatura com separação de domínio. Sem segredo configurado
 * retorna null — cada chamador decide sua falha fechada (NUNCA fallback, R-9).
 */
async function derivarChaveSessao(env: EnvSessaoExterna): Promise<CryptoKey | null> {
  const segredo = (env[ENV_SEGREDO_SESSAO_EXTERNA] ?? "").trim()
  if (!segredo) return null
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const derivada = await crypto.subtle.sign("HMAC", base, encoder.encode(DOMINIO_SESSAO_EXTERNA))
  return crypto.subtle.importKey("raw", derivada, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])
}

/** Segredo de sessão ausente — rotas de auth externa respondem 503 (R-9). */
export class SessaoExternaIndisponivelError extends Error {
  readonly code = "SESSAO_EXTERNA_INDISPONIVEL" as const
  constructor() {
    super(`Sessão externa indisponível: configure ${ENV_SEGREDO_SESSAO_EXTERNA} no ambiente server-side.`)
    this.name = "SessaoExternaIndisponivelError"
  }
}

/* ───────────────────────────── payload do cookie ───────────────────────────── */

export type PayloadSessaoExterna = Readonly<{
  v: 1
  /** `sid` = id da linha `ContadorSessaoExterna` (revogação por request). */
  sid: string
  /** tokenVersion da identidade na emissão — coerência verificada por request. */
  tv: number
  iat: number
  exp: number
}>

async function assinarCookieSessao(payload: PayloadSessaoExterna, chave: CryptoKey): Promise<string> {
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign("HMAC", chave, encoder.encode(payloadB64))
  return `${payloadB64}.${base64UrlEncode(sig)}`
}

type VerificacaoCookie =
  | { ok: true; payload: PayloadSessaoExterna }
  | { ok: false; motivo: "indisponivel" | "cookie_ausente" | "formato" | "assinatura" | "expirado" }

/**
 * Verifica formato → assinatura (tempo constante, `crypto.subtle.verify`) → `exp`.
 * NÃO consulta banco: a cadeia completa (sid/revogação/expiração/usuário/versão)
 * é `validarSessaoExterna`. `ignorarExp` existe para o logout (revoga até sessão
 * já expirada — idempotente).
 */
async function verificarCookieSessao(
  token: string | null | undefined,
  env: EnvSessaoExterna,
  nowMs: number,
  opts: { ignorarExp?: boolean } = {},
): Promise<VerificacaoCookie> {
  const chave = await derivarChaveSessao(env)
  if (!chave) return { ok: false, motivo: "indisponivel" }
  if (!token) return { ok: false, motivo: "cookie_ausente" }

  const partes = token.split(".")
  if (partes.length !== 2 || !partes[0] || !partes[1]) return { ok: false, motivo: "formato" }
  const [payloadB64, sigB64] = partes

  let sigBytes: Uint8Array
  try {
    sigBytes = base64UrlDecode(sigB64!)
  } catch {
    return { ok: false, motivo: "formato" }
  }

  const valid = await crypto.subtle.verify("HMAC", chave, sigBytes, encoder.encode(payloadB64!))
  if (!valid) return { ok: false, motivo: "assinatura" }

  let payload: PayloadSessaoExterna
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64!))) as PayloadSessaoExterna
  } catch {
    return { ok: false, motivo: "formato" }
  }
  if (
    payload?.v !== 1 ||
    typeof payload.sid !== "string" ||
    !payload.sid ||
    typeof payload.tv !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, motivo: "formato" }
  }
  if (!opts.ignorarExp && nowMs >= payload.exp) return { ok: false, motivo: "expirado" }

  return { ok: true, payload: Object.freeze(payload) }
}

/* ───────────────────────────── minimização (§15) ───────────────────────────── */

/** Hash não-reversível do IP (sha256 salgado truncado, 16 hex) — IP bruto NUNCA. */
export async function hashIpExterno(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`contador-externo-ip-v1:${ip}`))
  const bytes = new Uint8Array(digest)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex.slice(0, 16)
}

/** UA minimizado: truncado em 200 chars; vazio vira null. */
export function resumirUserAgent(userAgent: string | null | undefined): string | null {
  const valor = (userAgent ?? "").trim().slice(0, 200)
  return valor || null
}

/** Extração defensiva do IP do cliente (espelha o portal legado). */
export function extrairIpClienteExterno(headers: { get(name: string): string | null }): string {
  return extractClientIp(headers)
}

/* ───────────────────────────── cookie options ───────────────────────────── */

export type CookieSessaoExternaOptions = Readonly<{
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "lax"
  path: string
  maxAge: number
}>

export function buildSessaoExternaCookieOptions(token: string): CookieSessaoExternaOptions {
  return Object.freeze({
    name: CONTADOR_EXTERNO_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Desvio documentado e inevitável (§D.1): handlers em /api/contador-externo/**,
    // páginas em /contador-externo/** — o único prefixo comum é "/". O nome exclusivo
    // isola o escopo; handlers internos nunca leem este cookie e vice-versa (R-8).
    path: "/",
    maxAge: SESSAO_EXTERNA_MAX_AGE_SEGUNDOS,
  })
}

export function buildLogoutSessaoExternaCookieOptions(): CookieSessaoExternaOptions {
  return Object.freeze({
    name: CONTADOR_EXTERNO_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

/** Extrai o valor do cookie externo de um header `Cookie` bruto (parse tolerante). */
export function extrairTokenSessaoExterna(cabecalhoCookie: string | null | undefined): string | null {
  if (!cabecalhoCookie) return null
  for (const par of cabecalhoCookie.split(";")) {
    const [nome, ...resto] = par.trim().split("=")
    if (nome === CONTADOR_EXTERNO_COOKIE) {
      const valor = resto.join("=").trim()
      return valor || null
    }
  }
  return null
}

/* ───────────────────────────── login (criar sessão) ───────────────────────────── */

export type UsuarioSessao = Readonly<{ id: string; email: string; nome: string; tokenVersion: number }>

export type SessaoExternaResumo = Readonly<{ id: string; expiraEm: Date; criadoEm: Date }>

export type LoginExternoArgs = Readonly<{
  email: string
  senha: string
  ip?: string | null
  userAgent?: string | null
  env?: EnvSessaoExterna
  agora?: Date
}>

export type LoginExternoResult =
  | Readonly<{
      ok: true
      cookie: CookieSessaoExternaOptions
      sessao: SessaoExternaResumo
      usuario: UsuarioSessao
    }>
  | Readonly<{ ok: false; motivo: "credenciais_invalidas" }>

/**
 * Hash dummy cacheado: usuário inexistente TAMBÉM passa por `bcrypt.compare`
 * (anti-enumeração, R-2 — toda tentativa custa exatamente uma avaliação bcrypt).
 */
let hashDummyPromessa: Promise<string> | null = null
function hashDummyAntiEnumeracao(): Promise<string> {
  hashDummyPromessa ??= hashSenhaExterna("senha-dummy-anti-enumeracao-014")
  return hashDummyPromessa
}

function paraUsuarioSessao(u: UsuarioRow): UsuarioSessao {
  return Object.freeze({ id: u.id, email: u.email, nome: u.nome, tokenVersion: u.tokenVersion })
}

function paraSessaoResumo(s: SessaoRow): SessaoExternaResumo {
  return Object.freeze({ id: s.id, expiraEm: s.expiraEm, criadoEm: s.createdAt })
}

/**
 * Login: cria a linha `ContadorSessaoExterna` (trilha durável — createdAt, ipHash,
 * UA resumido) e emite o cookie HMAC com `sid`. Falhas são SEMPRE genéricas
 * ("credenciais_invalidas") — usuário inexistente, senha errada e identidade
 * suspensa são indistinguíveis (R-2), e `bcrypt.compare` roda em todos os caminhos.
 */
export async function autenticarECriarSessao(
  repo: AuthExternaRepo,
  args: LoginExternoArgs,
): Promise<LoginExternoResult> {
  const env = args.env ?? process.env
  const agora = args.agora ?? new Date()
  const chave = await derivarChaveSessao(env)
  if (!chave) throw new SessaoExternaIndisponivelError()

  const email = normalizarEmail(args.email)
  const ipHash = args.ip ? await hashIpExterno(args.ip) : null
  const userAgentResumo = resumirUserAgent(args.userAgent)

  const usuario = await repo.buscarUsuarioPorEmail(email)
  const senhaHash = usuario?.senhaHash ?? (await hashDummyAntiEnumeracao())
  const confere = await compararSenhaExterna(args.senha, senhaHash)

  // Mensagem/timing idênticos: existência da conta NUNCA é revelada (R-2).
  if (!usuario || !confere || usuario.status !== "ATIVO") {
    logEventoExterno("login_externo_falha", { ipHash })
    return Object.freeze({ ok: false as const, motivo: "credenciais_invalidas" as const })
  }

  const expiraEm = new Date(agora.getTime() + SESSAO_EXTERNA_MAX_AGE_SEGUNDOS * 1000)
  await repo.registrarUltimoLogin(usuario.id, agora)
  const sessao = await repo.criarSessao({
    usuarioId: usuario.id,
    expiraEm,
    ipHash,
    userAgentResumo,
  } satisfies NovaSessaoData)

  const token = await assinarCookieSessao(
    { v: 1, sid: sessao.id, tv: usuario.tokenVersion, iat: agora.getTime(), exp: expiraEm.getTime() },
    chave,
  )
  logEventoExterno("login_externo_sucesso", { ipHash })

  return Object.freeze({
    ok: true as const,
    cookie: buildSessaoExternaCookieOptions(token),
    sessao: paraSessaoResumo(sessao),
    usuario: paraUsuarioSessao(usuario),
  })
}

/* ───────────────────────────── validação por request ───────────────────────────── */

export type MotivoSessaoInvalida =
  | "indisponivel"
  | "cookie_ausente"
  | "formato"
  | "assinatura"
  | "expirado"
  | "sessao_desconhecida"
  | "sessao_revogada"
  | "sessao_expirada"
  | "usuario_suspenso"
  | "versao_token"

export type SessaoExternaValidada = Readonly<{
  ok: true
  usuario: UsuarioSessao
  sessao: SessaoExternaResumo
  /** Rotação após 50% da vida (§D.1): novo cookie com o MESMO sid; null = sem rotação. */
  rotacao: CookieSessaoExternaOptions | null
}>

export type SessaoExternaInvalida = Readonly<{ ok: false; motivo: MotivoSessaoInvalida }>

export type ValidarSessaoResult = SessaoExternaValidada | SessaoExternaInvalida

/**
 * Validação por request — falha fechada em QUALQUER etapa (§D.1):
 * formato → assinatura (tempo constante) → exp do payload → lookup por sid →
 * revogadoEm null → expiraEm > now → usuário ATIVO + tokenVersion coerente.
 *
 * Efeitos colaterais: `ultimoUsoEm` best-effort e rotação após 50% da vida
 * (mesmo sid, novo iat/exp no cookie + expiraEm estendida na linha).
 */
export async function validarSessaoExterna(
  repo: AuthExternaRepo,
  token: string | null | undefined,
  opts: { env?: EnvSessaoExterna; agora?: Date } = {},
): Promise<ValidarSessaoResult> {
  const env = opts.env ?? process.env
  const agora = opts.agora ?? new Date()
  const nowMs = agora.getTime()

  const verificacao = await verificarCookieSessao(token, env, nowMs)
  if (!verificacao.ok) {
    if (verificacao.motivo === "expirado") logEventoExterno("sessao_externa_expirada", {})
    return Object.freeze({ ok: false as const, motivo: verificacao.motivo })
  }
  const { payload } = verificacao
  const chave = await derivarChaveSessao(env)
  if (!chave) return Object.freeze({ ok: false as const, motivo: "indisponivel" as const })

  const sessao = await repo.buscarSessaoPorId(payload.sid)
  if (!sessao) return Object.freeze({ ok: false as const, motivo: "sessao_desconhecida" as const })
  if (sessao.revogadoEm) return Object.freeze({ ok: false as const, motivo: "sessao_revogada" as const })
  if (sessao.expiraEm.getTime() <= nowMs) {
    logEventoExterno("sessao_externa_expirada", {})
    return Object.freeze({ ok: false as const, motivo: "sessao_expirada" as const })
  }

  const usuario = await repo.buscarUsuarioPorId(sessao.usuarioId)
  if (!usuario || usuario.status !== "ATIVO") {
    return Object.freeze({ ok: false as const, motivo: "usuario_suspenso" as const })
  }
  if (usuario.tokenVersion !== payload.tv) {
    return Object.freeze({ ok: false as const, motivo: "versao_token" as const })
  }

  // Rotação após 50% da vida do cookie (§D.1): mesmo sid, novo iat/exp + linha estendida.
  const vidaMs = payload.exp - payload.iat
  let rotacao: CookieSessaoExternaOptions | null = null
  if (vidaMs > 0 && (nowMs - payload.iat) * 2 >= vidaMs) {
    const novaExpiraEm = new Date(nowMs + SESSAO_EXTERNA_MAX_AGE_SEGUNDOS * 1000)
    await repo.estenderSessao(sessao.id, novaExpiraEm, agora)
    const novoToken = await assinarCookieSessao(
      { v: 1, sid: sessao.id, tv: usuario.tokenVersion, iat: nowMs, exp: novaExpiraEm.getTime() },
      chave,
    )
    rotacao = buildSessaoExternaCookieOptions(novoToken)
  } else {
    // Best-effort: a falha do toque NUNCA derruba uma request autenticada.
    try {
      await repo.tocarUltimoUsoSessao(sessao.id, agora)
    } catch {
      /* intencional */
    }
  }

  return Object.freeze({
    ok: true as const,
    usuario: paraUsuarioSessao(usuario),
    sessao: paraSessaoResumo(sessao),
    rotacao,
  })
}

/* ───────────────────────────── logout / revogação ───────────────────────────── */

export type LogoutExternoResult = Readonly<{
  cookieLimpo: CookieSessaoExternaOptions
  /** true quando uma linha de sessão foi efetivamente revogada. */
  revogou: boolean
}>

/**
 * Logout: revoga a linha da sessão (idempotente — até sessão expirada é revogada)
 * e devolve o cookie limpo. Cookie adulterado/ausente também limpa o cookie,
 * sem revelar nada.
 */
export async function logoutSessaoExterna(
  repo: AuthExternaRepo,
  token: string | null | undefined,
  opts: { env?: EnvSessaoExterna; agora?: Date; ip?: string | null } = {},
): Promise<LogoutExternoResult> {
  const env = opts.env ?? process.env
  const agora = opts.agora ?? new Date()
  const ipHash = opts.ip ? await hashIpExterno(opts.ip) : null

  const verificacao = await verificarCookieSessao(token, env, agora.getTime(), { ignorarExp: true })
  let revogou = false
  if (verificacao.ok) {
    const sessao = await repo.buscarSessaoPorId(verificacao.payload.sid)
    if (sessao && !sessao.revogadoEm) {
      await repo.revogarSessao(sessao.id, agora)
      revogou = true
    }
  }
  logEventoExterno("logout_externo", { ipHash })
  return Object.freeze({ cookieLimpo: buildLogoutSessaoExternaCookieOptions(), revogou })
}

/**
 * Revogação administrativa de UMA sessão, vinculada a uma loja de origem (§E.1,
 * `sessao_revogada`). Retorna false quando a sessão não existe ou já estava revogada.
 */
export async function revogarSessaoAdministrativa(
  repo: AuthExternaRepo,
  args: Readonly<{
    sessaoId: string
    adminId: string
    storeIdOrigem: string
    ipHash?: string | null
    agora?: Date
  }>,
): Promise<boolean> {
  return repo.revogarSessaoComEvento({
    sessaoId: args.sessaoId,
    agora: args.agora ?? new Date(),
    montarEvento: (sessao) =>
      montarEventoContador({
        storeId: args.storeIdOrigem,
        tipo: "sessao_revogada",
        atorTipo: "interno",
        atorId: args.adminId,
        entidade: "contador_sessao_externa",
        entidadeId: sessao.id,
        metadata: { motivo: "revogacao_administrativa" },
        ipHash: args.ipHash ?? null,
      }),
  })
}
