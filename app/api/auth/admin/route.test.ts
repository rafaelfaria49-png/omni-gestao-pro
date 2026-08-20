/**
 * GOAL PLAT-AUTH-PIN-CONTAINMENT-001A — contenção de `/api/auth/admin`.
 *
 * O que é REAL aqui (não mockado), de propósito, para que os testes exercitem a
 * decisão de segurança e não um duplo:
 *   · `canAccessStore` e a resolução header/query/cookie do `storeId`;
 *   · o motor de rate limit (`lib/contador/auth/rate-limit.ts`);
 *   · a emissão e verificação do token (`lib/auth/pin-authorization.ts`).
 *
 * Mockados: `auth()`, `getSessionEntitlement()`, Prisma e `next/headers`.
 *
 * O valor do PIN bloqueado NUNCA é escrito neste ficheiro — vem da constante
 * exportada. Há um teste explícito de que nem a resposta nem o log o contêm.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { ASSISTEC_ACTIVE_STORE_COOKIE } from "@/lib/store-defaults"
import {
  ADMIN_AUTHORIZATION_COOKIE,
  BLOCKED_LEGACY_SUPERVISOR_PINS,
  PIN_AUTHORIZATION_MAX_AGE_SECONDS,
} from "@/lib/auth/pin-authorization"
import { hashSupervisorPin } from "@/lib/auth/pin-hash"
import { __resetContadorRateLimitForTests } from "@/lib/contador/auth/rate-limit"

const LOJA_A = "loja-A"
const LOJA_B = "loja-B"
const LOJA_C = "loja-C"
const LOJA_D = "loja-D"
const LOJA_E = "loja-E"
const LOJA_F = "loja-F"
/** Unidades que EXISTEM na tabela `stores` deste cenário. */
const LOJAS_REAIS = [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E, LOJA_F]
/** Identificador que o cliente pode enviar mas que não corresponde a linha nenhuma. */
const LOJA_INVENTADA = "loja-que-nao-existe"
const USER_A = "admin-user-a"
const USER_B = "admin-user-b"
const SUPERVISOR_ID = "supervisor-1"
/** PIN fictício deste teste — não corresponde a nenhum valor real nem ao bloqueado. */
const PIN_CORRETO = "908172"
const PIN_ERRADO = "111999"
const PIN_BLOQUEADO = BLOCKED_LEGACY_SUPERVISOR_PINS[0]!

const T0 = Date.UTC(2026, 7, 5, 12, 0, 0)

type SessionUser = {
  id: string
  role?: string
  storeAccess?: string
  allowedStoreIds?: string[]
}

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => null),
  entitlement: vi.fn(async (): Promise<unknown> => ({ ok: true })),
  ensureConnected: vi.fn(async (): Promise<void> => undefined),
  userFindFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
  userFindMany: vi.fn(async (_args: unknown): Promise<unknown[]> => []),
  userUpdate: vi.fn(async (_args: unknown): Promise<unknown> => ({})),
  /** R1-bis: prova canónica de existência da loja. Só `LOJAS_REAIS` têm linha. */
  storeFindUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
  auditCreate: vi.fn(async (_args: unknown): Promise<unknown> => ({})),
  cookieJar: new Map<string, string>(),
  /** Mutável de propósito: os testes de R1 trocam isto entre chamadas para simular
   *  rotação de `x-forwarded-for` pelo cliente, sem tocar no endpoint. */
  clientIp: "203.0.113.7",
}))

vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/auth/session-entitlement", () => ({ getSessionEntitlement: h.entitlement }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: h.userFindFirst, findMany: h.userFindMany, update: h.userUpdate },
    store: { findUnique: h.storeFindUnique },
    logsAuditoria: { create: h.auditCreate },
  },
  prismaEnsureConnected: h.ensureConnected,
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = h.cookieJar.get(name)
      return v === undefined ? undefined : { name, value: v }
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": h.clientIp }),
}))

import { DELETE, GET, POST } from "./route"

// ---------------------------------------------------------------------------

function sessionOf(user: SessionUser | null): unknown {
  return user ? { user } : null
}
function unrestricted(id: string): SessionUser {
  return { id, role: "ADMIN" }
}
function restrictedTo(id: string, ids: string[]): SessionUser {
  return { id, role: "OPERADOR", storeAccess: "restricted", allowedStoreIds: ids }
}

function postReq(pin: string, store: string | null = LOJA_A): Request {
  return new Request("http://local/api/auth/admin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(store ? { [ASSISTEC_LOJA_HEADER]: store } : {}),
    },
    body: JSON.stringify({ pin }),
  })
}
function getReq(store: string | null = LOJA_A): Request {
  return new Request("http://local/api/auth/admin", {
    headers: store ? { [ASSISTEC_LOJA_HEADER]: store } : {},
  })
}

/** Extrai o token emitido no `Set-Cookie` e coloca-o no jar lido pelo GET. */
function adoptIssuedCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? ""
  const m = /assistec_admin_session=([^;]*)/.exec(raw)
  const token = decodeURIComponent(m?.[1] ?? "")
  h.cookieJar.set(ADMIN_AUTHORIZATION_COOKIE, token)
  return token
}

let logSpy: ReturnType<typeof vi.spyOn>
let pinCorretoHash = ""

function hashedSupervisor() {
  return {
    id: SUPERVISOR_ID,
    name: "Supervisora",
    pin: "x:opaque-test-supervisor",
    pinHash: pinCorretoHash,
  }
}

function expectPinCandidatesNotLoaded(): void {
  expect(h.userFindMany).not.toHaveBeenCalled()
}

beforeAll(async () => {
  process.env.AUTH_SECRET = "segredo-de-teste-pin-containment-001a"
  pinCorretoHash = await hashSupervisorPin(PIN_CORRETO)
})

beforeEach(() => {
  vi.clearAllMocks()
  __resetContadorRateLimitForTests()
  h.cookieJar.clear()
  h.clientIp = "203.0.113.7"
  process.env.AUTH_SECRET = "segredo-de-teste-pin-containment-001a"
  h.auth.mockResolvedValue(null)
  h.entitlement.mockResolvedValue({ ok: true })
  h.auditCreate.mockResolvedValue({})
  h.userFindFirst.mockImplementation(async (args: unknown) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {}
    if ("pin" in where) {
      throw new Error("plaintext SQL PIN lookup is forbidden")
    }
    if (where.id === SUPERVISOR_ID) return { id: SUPERVISOR_ID, name: "Supervisora" }
    return null
  })
  h.userFindMany.mockImplementation(async () => [hashedSupervisor()])
  h.userUpdate.mockResolvedValue({ id: SUPERVISOR_ID })
  h.storeFindUnique.mockImplementation(async (args: unknown) => {
    const id = (args as { where?: { id?: string } }).where?.id
    return id && LOJAS_REAIS.includes(id) ? { id } : null
  })
  vi.spyOn(Date, "now").mockReturnValue(T0)
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function allLoggedText(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c.map((v) => String(v)).join(" ")).join("\n")
}

// ---------------------------------------------------------------------------

describe("POST /api/auth/admin — sessão obrigatória", () => {
  it("[1] requisição anónima → 401", async () => {
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(401)
  })

  it("[20] anónimo NÃO consulta PIN — nem conecta ao banco", async () => {
    await POST(postReq(PIN_CORRETO))
    expectPinCandidatesNotLoaded()
    expect(h.ensureConnected).not.toHaveBeenCalled()
    expect(h.entitlement).not.toHaveBeenCalled()
  })

  it("[1b] rejeição anónima não grava em logs_auditoria (sem amplificador de escrita)", async () => {
    await POST(postReq(PIN_CORRETO))
    expect(h.auditCreate).not.toHaveBeenCalled()
  })

  it("[2] sessão sem `user.id` → 401", async () => {
    h.auth.mockResolvedValue({ user: {} })
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(401)
    expectPinCandidatesNotLoaded()
  })

  it("[3] utilizador desativado → 401, sem consultar PIN", async () => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    h.entitlement.mockResolvedValue({ ok: false, reason: "user_inactive" })
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(401)
    expectPinCandidatesNotLoaded()
  })

  it("[3b] utilizador inexistente → 401", async () => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    h.entitlement.mockResolvedValue({ ok: false, reason: "user_not_found" })
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(401)
  })
})

describe("POST /api/auth/admin — escopo de loja", () => {
  it("[4] utilizador restrito a outra loja → 403, sem consultar PIN", async () => {
    h.auth.mockResolvedValue(sessionOf(restrictedTo(USER_A, [LOJA_B])))
    const res = await POST(postReq(PIN_CORRETO, LOJA_A))
    expect(res.status).toBe(403)
    expectPinCandidatesNotLoaded()
  })

  it("loja não resolvível (sem header, query nem cookie) → 400, falha fechado", async () => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    const res = await POST(postReq(PIN_CORRETO, null))
    expect(res.status).toBe(400)
    expectPinCandidatesNotLoaded()
  })

  it("loja resolvida por cookie também é validada e aceite", async () => {
    h.auth.mockResolvedValue(sessionOf(restrictedTo(USER_A, [LOJA_A])))
    const req = new Request("http://local/api/auth/admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${ASSISTEC_ACTIVE_STORE_COOKIE}=${encodeURIComponent(LOJA_A)}`,
      },
      body: JSON.stringify({ pin: PIN_CORRETO }),
    })
    expect((await POST(req)).status).toBe(200)
  })
})

describe("POST /api/auth/admin — PIN", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
  })

  it("[5] PIN incorreto → 401", async () => {
    const res = await POST(postReq(PIN_ERRADO))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "invalid_pin" })
  })

  it("[6] PIN padrão legado é SEMPRE recusado — e nunca chega ao banco", async () => {
    const res = await POST(postReq(PIN_BLOQUEADO))
    expect(res.status).toBe(401)
    expectPinCandidatesNotLoaded()
  })

  it("[6b] PIN padrão legado permanece recusado mesmo se existir no banco", async () => {
    h.userFindMany.mockResolvedValue([{ id: SUPERVISOR_ID, name: "Supervisora", pin: PIN_BLOQUEADO, pinHash: null }])
    const res = await POST(postReq(PIN_BLOQUEADO))
    expect(res.status).toBe(401)
    expectPinCandidatesNotLoaded()
  })

  it("PIN vazio → 401 sem consultar o banco", async () => {
    const res = await POST(postReq("   "))
    expect(res.status).toBe(401)
    expectPinCandidatesNotLoaded()
  })

  it("[7] PIN correto + sessão + loja válida → 200 com autorização temporária", async () => {
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      admin: { id: SUPERVISOR_ID, name: "Supervisora" },
    })
    expect(res.headers.get("set-cookie")).toContain(`${ADMIN_AUTHORIZATION_COOKIE}=`)
  })

  it("[8] cookie emitido dura 15 min, é HttpOnly e SameSite=Strict", async () => {
    const res = await POST(postReq(PIN_CORRETO))
    const raw = res.headers.get("set-cookie") ?? ""
    expect(raw).toContain(`Max-Age=${PIN_AUTHORIZATION_MAX_AGE_SECONDS}`)
    expect(raw).toContain("HttpOnly")
    expect(raw.toLowerCase()).toContain("samesite=strict")
    expect(raw).not.toContain(`Max-Age=${60 * 60 * 24 * 7}`)
  })

  it("o valor do cookie não é mais o id cru do supervisor", async () => {
    const res = await POST(postReq(PIN_CORRETO))
    const token = adoptIssuedCookie(res)
    expect(token).not.toBe(SUPERVISOR_ID)
    expect(token.split(".")).toHaveLength(2)
  })

  it("[17] nenhuma resposta contém o PIN — nem no sucesso, nem no erro, nem no bloqueado", async () => {
    const ok = await POST(postReq(PIN_CORRETO))
    const okText = (await ok.text()) + (ok.headers.get("set-cookie") ?? "")
    expect(okText).not.toContain(PIN_CORRETO)

    const bad = await POST(postReq(PIN_ERRADO))
    expect(await bad.text()).not.toContain(PIN_ERRADO)

    const blocked = await POST(postReq(PIN_BLOQUEADO))
    expect(await blocked.text()).not.toContain(PIN_BLOQUEADO)
  })

  it("[18] nenhum log estruturado contém o PIN", async () => {
    await POST(postReq(PIN_CORRETO))
    await POST(postReq(PIN_ERRADO))
    await POST(postReq(PIN_BLOQUEADO))
    const logged = allLoggedText()
    expect(logged).not.toContain(PIN_CORRETO)
    expect(logged).not.toContain(PIN_ERRADO)
    expect(logged).not.toContain(PIN_BLOQUEADO)
  })

  it("a auditoria persistida nunca carrega o PIN", async () => {
    await POST(postReq(PIN_ERRADO))
    await POST(postReq(PIN_CORRETO))
    const written = JSON.stringify(h.auditCreate.mock.calls)
    expect(written).not.toContain(PIN_ERRADO)
    expect(written).not.toContain(PIN_CORRETO)
    expect(written).toContain(USER_A)
    expect(written).toContain(LOJA_A)
  })

  it("pinHash autentica e não usa where: { pin }", async () => {
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(200)
    expect(h.userFindMany).toHaveBeenCalled()
    const firstWhere = (h.userFindFirst.mock.calls[0]?.[0] as { where?: Record<string, unknown> } | undefined)?.where
    expect(firstWhere?.pin).toBeUndefined()
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it("plaintext legado autentica e faz upgrade para pinHash sem alterar pin", async () => {
    h.userFindMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: PIN_CORRETO, pinHash: null },
    ])
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(200)
    expect(h.userUpdate).toHaveBeenCalledTimes(1)
    const args = (h.userUpdate.mock.calls[0] as unknown as [{ data: { pinHash?: string; pin?: string } }])[0]
    expect(args.data.pin).toBeUndefined()
    expect(args.data.pinHash?.startsWith("$2")).toBe(true)
    expect(JSON.stringify(args)).not.toContain(PIN_CORRETO)
  })

  it("PIN inválido não grava upgrade", async () => {
    h.userFindMany.mockResolvedValue([
      { id: SUPERVISOR_ID, name: "Supervisora", pin: PIN_CORRETO, pinHash: null },
    ])
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })
})

describe("POST /api/auth/admin — rate limit", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
  })

  it("[13][14][15] 5 falhas bloqueiam; a 6ª tentativa é 429 com Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    }
    const res = await POST(postReq(PIN_ERRADO))
    expect(res.status).toBe(429)
    const retry = res.headers.get("Retry-After")
    expect(retry).toBeTruthy()
    expect(Number(retry)).toBeGreaterThan(0)
    expect(Number(retry)).toBeLessThanOrEqual(15 * 60)
    await expect(res.json()).resolves.toEqual({ error: "rate_limited" })
  })

  it("durante o bloqueio nem o PIN correto passa, e o banco não é consultado", async () => {
    for (let i = 0; i < 5; i++) await POST(postReq(PIN_ERRADO))
    h.userFindMany.mockClear()
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(429)
    expectPinCandidatesNotLoaded()
  })

  it("[16] após a janela de 15 min o mesmo contexto volta a poder tentar", async () => {
    for (let i = 0; i < 5; i++) await POST(postReq(PIN_ERRADO))
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(429)
    vi.spyOn(Date, "now").mockReturnValue(T0 + 15 * 60 * 1000 + 1)
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(200)
  })

  it("sucesso limpa o contador daquele contexto", async () => {
    for (let i = 0; i < 4; i++) await POST(postReq(PIN_ERRADO))
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(200)
    for (let i = 0; i < 5; i++) {
      expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    }
  })

  /**
   * R1-bis — INVERSÃO DELIBERADA de política.
   *
   * Até `pin-supervisor:v2` este caso afirmava "uma loja não consome o orçamento de
   * outra". Essa era exatamente a falha: como o `storeId` chega do cliente, orçamento
   * por loja significa orçamento infinito. A política nova é a oposta e é intencional.
   */
  it("R1-bis: o orçamento é do UTILIZADOR — trocar de loja não devolve tentativas", async () => {
    for (let i = 0; i < 5; i++) await POST(postReq(PIN_ERRADO, LOJA_A))
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(429)
    expect((await POST(postReq(PIN_ERRADO, LOJA_B))).status).toBe(429)
  })

  it("um utilizador não consome o orçamento de outro", async () => {
    for (let i = 0; i < 5; i++) await POST(postReq(PIN_ERRADO))
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(429)
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
  })
})

describe("POST /api/auth/admin — R1: rate limit imune a rotação de x-forwarded-for", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
  })

  it("IP A registra a 1ª falha; IP B, mesmo user/loja, registra a 2ª no MESMO bucket", async () => {
    h.clientIp = "198.51.100.1"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    h.clientIp = "198.51.100.2"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    // Só mais 3 falhas (qualquer IP) esgotam o orçamento de 5 — se IP A e IP B tivessem
    // buckets separados, precisaríamos de 5 falhas em CADA um para bloquear.
    h.clientIp = "198.51.100.3"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    h.clientIp = "198.51.100.4"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    h.clientIp = "198.51.100.5"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    h.clientIp = "198.51.100.6"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(429)
  })

  it("cinco IPs alternados esgotam o limite; a 6ª tentativa com um IP NUNCA usado ainda é 429, com Retry-After", async () => {
    const ips = ["203.0.113.11", "203.0.113.12", "203.0.113.13", "203.0.113.14", "203.0.113.15"]
    for (const ip of ips) {
      h.clientIp = ip
      expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    }
    h.clientIp = "203.0.113.99"
    const res = await POST(postReq(PIN_ERRADO))
    expect(res.status).toBe(429)
    const retry = res.headers.get("Retry-After")
    expect(retry).toBeTruthy()
    expect(Number(retry)).toBeGreaterThan(0)
    expect(Number(retry)).toBeLessThanOrEqual(15 * 60)
  })

  it("outro userId, mesmo alternando IP, não herda o bloqueio", async () => {
    const ips = ["203.0.113.21", "203.0.113.22", "203.0.113.23", "203.0.113.24", "203.0.113.25"]
    for (const ip of ips) {
      h.clientIp = ip
      await POST(postReq(PIN_ERRADO))
    }
    h.clientIp = "203.0.113.26"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(429)

    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    h.clientIp = "203.0.113.27"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
  })

  /** R1-bis: mesma inversão deliberada do caso acima, agora combinada com rotação de IP. */
  it("R1-bis: trocar de loja E de IP ao mesmo tempo continua no mesmo bloqueio", async () => {
    const ips = ["203.0.113.31", "203.0.113.32", "203.0.113.33", "203.0.113.34", "203.0.113.35"]
    for (const ip of ips) {
      h.clientIp = ip
      await POST(postReq(PIN_ERRADO, LOJA_A))
    }
    h.clientIp = "203.0.113.36"
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(429)

    h.clientIp = "203.0.113.37"
    expect((await POST(postReq(PIN_ERRADO, LOJA_B))).status).toBe(429)
  })

  it("sucesso limpa o bucket correto mesmo após falhas com IPs variados", async () => {
    h.clientIp = "203.0.113.41"
    await POST(postReq(PIN_ERRADO))
    h.clientIp = "203.0.113.42"
    await POST(postReq(PIN_ERRADO))
    h.clientIp = "203.0.113.43"
    await POST(postReq(PIN_ERRADO))
    h.clientIp = "203.0.113.44"
    expect((await POST(postReq(PIN_CORRETO))).status).toBe(200)

    // Bucket limpo: precisa de 5 falhas NOVAS (IPs ainda variados) para bloquear de novo.
    const ips = ["203.0.113.45", "203.0.113.46", "203.0.113.47", "203.0.113.48", "203.0.113.49"]
    for (const ip of ips) {
      h.clientIp = ip
      expect((await POST(postReq(PIN_ERRADO))).status).toBe(401)
    }
    h.clientIp = "203.0.113.50"
    expect((await POST(postReq(PIN_ERRADO))).status).toBe(429)
  })

  it("ipHash segue nos eventos de auditoria; o IP bruto nunca aparece em log, resposta ou auditoria", async () => {
    h.clientIp = "198.51.100.77"
    const res = await POST(postReq(PIN_ERRADO))
    expect(res.status).toBe(401)

    const auditWritten = JSON.stringify(h.auditCreate.mock.calls)
    expect(auditWritten).toContain("ipHash")
    expect(auditWritten).not.toContain("198.51.100.77")

    expect(allLoggedText()).not.toContain("198.51.100.77")
    expect(await res.text()).not.toContain("198.51.100.77")
    expect(res.headers.get("set-cookie") ?? "").not.toContain("198.51.100.77")
  })
})

/**
 * R1-bis — o ATAQUE que a revisão independente encontrou, escrito como teste.
 *
 * Vetor: a chave `pin-supervisor:v2:{userId}:{storeId}` era derivada de um `storeId` que
 * chega em header/query/cookie, e `canAccessStore` é *default-allow* para sessões não
 * restritas — aceita qualquer string sem provar que a loja existe. Logo, um utilizador
 * autenticado ganhava um balde novo de 5 tentativas por identificador que inventasse: o
 * teto de 5 nunca chegava a ser atingido.
 *
 * Estes casos FALHAM na implementação anterior (v2) e só passam com a chave `v3`
 * ancorada apenas no `userId` + a prova canónica de existência da loja.
 */
describe("POST /api/auth/admin — R1-bis: evasão do rate limit por loja (ataque)", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
  })

  it("ATAQUE: 5 falhas em 5 lojas REAIS distintas esgotam o orçamento global do utilizador", async () => {
    // Com a chave v2 isto criava 5 baldes de count=1 e NADA bloqueava.
    for (const loja of [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E]) {
      expect((await POST(postReq(PIN_ERRADO, loja))).status).toBe(401)
    }
    const res = await POST(postReq(PIN_ERRADO, LOJA_F))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
  })

  it("ATAQUE: consumido o orçamento, um storeId INVENTADO não abre balde novo", async () => {
    for (const loja of [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E]) {
      await POST(postReq(PIN_ERRADO, loja))
    }
    // A tentativa seguinte inventa a unidade — sob v2 caía num balde virgem e devolvia 401.
    const res = await POST(postReq(PIN_ERRADO, LOJA_INVENTADA))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
  })

  it("ATAQUE: nem uma sequência de identificadores inventados devolve tentativas", async () => {
    for (const loja of [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E]) {
      await POST(postReq(PIN_ERRADO, loja))
    }
    for (let i = 0; i < 6; i++) {
      expect((await POST(postReq(PIN_ERRADO, `${LOJA_INVENTADA}-${i}`))).status).toBe(429)
    }
  })

  it("ATAQUE: durante o bloqueio nem o PIN CORRETO com loja inventada passa", async () => {
    for (const loja of [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E]) {
      await POST(postReq(PIN_ERRADO, loja))
    }
    h.userFindMany.mockClear()
    expect((await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))).status).toBe(429)
    expectPinCandidatesNotLoaded()
  })

  it("alternar lojas reais e inventadas dá exatamente 5 tentativas no total", async () => {
    const sequencia = [LOJA_A, LOJA_INVENTADA, LOJA_B, `${LOJA_INVENTADA}-x`, LOJA_C]
    let consumidas = 0
    for (const loja of sequencia) {
      const res = await POST(postReq(PIN_ERRADO, loja))
      // Loja inventada é recusada (403) SEM gastar tentativa; loja real gasta (401).
      expect([401, 403]).toContain(res.status)
      if (res.status === 401) consumidas++
    }
    expect(consumidas).toBe(3)
    // Restam 2 tentativas reais; a 6ª falha real bloqueia.
    expect((await POST(postReq(PIN_ERRADO, LOJA_D))).status).toBe(401)
    expect((await POST(postReq(PIN_ERRADO, LOJA_E))).status).toBe(401)
    expect((await POST(postReq(PIN_ERRADO, LOJA_F))).status).toBe(429)
  })

  it("o bloqueio é do utilizador: outro utilizador segue livre em qualquer loja", async () => {
    for (const loja of [LOJA_A, LOJA_B, LOJA_C, LOJA_D, LOJA_E]) {
      await POST(postReq(PIN_ERRADO, loja))
    }
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(429)

    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(401)
    expect((await POST(postReq(PIN_ERRADO, LOJA_E))).status).toBe(401)
  })

  it("sucesso limpa SÓ o balde do utilizador autenticado", async () => {
    // USER_B queima 5 tentativas e fica bloqueado.
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    for (let i = 0; i < 5; i++) await POST(postReq(PIN_ERRADO, LOJA_A))
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(429)

    // USER_A falha 4 vezes e depois acerta — limpa o SEU balde.
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    for (let i = 0; i < 4; i++) await POST(postReq(PIN_ERRADO, LOJA_B))
    expect((await POST(postReq(PIN_CORRETO, LOJA_B))).status).toBe(200)
    for (let i = 0; i < 5; i++) {
      expect((await POST(postReq(PIN_ERRADO, LOJA_B))).status).toBe(401)
    }

    // O bloqueio de USER_B continua intacto.
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    expect((await POST(postReq(PIN_ERRADO, LOJA_A))).status).toBe(429)
  })
})

describe("POST /api/auth/admin — R1-bis: validação canónica da loja", () => {
  beforeEach(() => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
  })

  it("storeId inexistente → 403 ANTES de qualquer consulta de PIN", async () => {
    const res = await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))
    expect(res.status).toBe(403)
    expectPinCandidatesNotLoaded()
  })

  it("storeId inexistente NUNCA emite token, mesmo com o PIN correto", async () => {
    const res = await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))
    expect(res.status).toBe(403)
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("a existência é provada no banco, não deduzida de canAccessStore", async () => {
    // Sessão não restrita: `canAccessStore` devolve true para QUALQUER string. Só a
    // consulta canónica distingue a unidade real da inventada.
    await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))
    expect(h.storeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LOJA_INVENTADA } }),
    )
  })

  it("recusa por inexistência e por falta de permissão são indistinguíveis para o cliente", async () => {
    const inexistente = await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))
    h.auth.mockResolvedValue(sessionOf(restrictedTo(USER_A, [LOJA_B])))
    const semPermissao = await POST(postReq(PIN_CORRETO, LOJA_A))

    expect(inexistente.status).toBe(semPermissao.status)
    await expect(inexistente.json()).resolves.toEqual(await semPermissao.json())
  })

  it("loja sem permissão nem chega a consultar a existência no banco", async () => {
    h.auth.mockResolvedValue(sessionOf(restrictedTo(USER_A, [LOJA_B])))
    expect((await POST(postReq(PIN_CORRETO, LOJA_A))).status).toBe(403)
    expect(h.storeFindUnique).not.toHaveBeenCalled()
  })

  it("banco indisponível na prova da loja → 503, fail-closed e sem emitir token", async () => {
    h.storeFindUnique.mockRejectedValue(new Error("connection refused"))
    const res = await POST(postReq(PIN_CORRETO, LOJA_A))
    expect(res.status).toBe(503)
    expect(res.headers.get("set-cookie")).toBeNull()
    expectPinCandidatesNotLoaded()
  })

  it("a auditoria da recusa distingue o motivo, mesmo a resposta não distinguindo", async () => {
    await POST(postReq(PIN_CORRETO, LOJA_INVENTADA))
    const written = JSON.stringify(h.auditCreate.mock.calls)
    expect(written).toContain("PIN_SUPERVISOR_LOJA_NEGADA")
    expect(allLoggedText()).toContain("store_not_found")
  })

  it("o token guarda o storeId CANÓNICO devolvido pelo banco", async () => {
    h.storeFindUnique.mockResolvedValue({ id: LOJA_A })
    const res = await POST(postReq(PIN_CORRETO, LOJA_A))
    expect(res.status).toBe(200)
    adoptIssuedCookie(res)
    // Vale na loja canónica…
    await expect((await GET(getReq(LOJA_A))).json()).resolves.toMatchObject({
      authenticated: true,
    })
    // …e em nenhuma outra, real ou inventada.
    await expect((await GET(getReq(LOJA_B))).json()).resolves.toEqual({ authenticated: false })
    await expect((await GET(getReq(LOJA_INVENTADA))).json()).resolves.toEqual({
      authenticated: false,
    })
  })
})

describe("POST /api/auth/admin — configuração", () => {
  it("sem segredo de assinatura o endpoint falha fechado (503) e não consulta PIN", async () => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    delete process.env.AUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.PIN_AUTHORIZATION_SECRET
    const res = await POST(postReq(PIN_CORRETO))
    expect(res.status).toBe(503)
    expectPinCandidatesNotLoaded()
  })
})

describe("GET /api/auth/admin — consumo da autorização", () => {
  async function autorizar(user = USER_A, store = LOJA_A): Promise<void> {
    h.auth.mockResolvedValue(sessionOf(unrestricted(user)))
    const res = await POST(postReq(PIN_CORRETO, store))
    expect(res.status).toBe(200)
    adoptIssuedCookie(res)
  }

  it("[19] fluxo legítimo: quem autorizou vê a autorização ativa na mesma loja", async () => {
    await autorizar()
    const res = await GET(getReq(LOJA_A))
    await expect(res.json()).resolves.toEqual({
      authenticated: true,
      admin: { id: SUPERVISOR_ID, name: "Supervisora" },
    })
  })

  it("[9][11] autorização de outro utilizador não vale", async () => {
    await autorizar(USER_A, LOJA_A)
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_B)))
    await expect((await GET(getReq(LOJA_A))).json()).resolves.toEqual({ authenticated: false })
  })

  it("[10][12] autorização não vale em outra loja", async () => {
    await autorizar(USER_A, LOJA_A)
    await expect((await GET(getReq(LOJA_B))).json()).resolves.toEqual({ authenticated: false })
  })

  it("expira: passados 15 min a mesma autorização deixa de valer", async () => {
    await autorizar()
    vi.spyOn(Date, "now").mockReturnValue(T0 + PIN_AUTHORIZATION_MAX_AGE_SECONDS * 1000)
    await expect((await GET(getReq(LOJA_A))).json()).resolves.toEqual({ authenticated: false })
  })

  it("cookie forjado com o id do supervisor (formato legado) não autentica", async () => {
    h.auth.mockResolvedValue(sessionOf(unrestricted(USER_A)))
    h.cookieJar.set(ADMIN_AUTHORIZATION_COOKIE, SUPERVISOR_ID)
    await expect((await GET(getReq(LOJA_A))).json()).resolves.toEqual({ authenticated: false })
  })

  it("sem sessão → authenticated:false, sem consultar o banco", async () => {
    h.auth.mockResolvedValue(null)
    h.cookieJar.set(ADMIN_AUTHORIZATION_COOKIE, "qualquer.coisa")
    await expect((await GET(getReq(LOJA_A))).json()).resolves.toEqual({ authenticated: false })
    expect(h.userFindFirst).not.toHaveBeenCalled()
  })

  it("sem loja resolvível → authenticated:false (falha fechado)", async () => {
    await autorizar()
    await expect((await GET(getReq(null))).json()).resolves.toEqual({ authenticated: false })
  })
})

describe("DELETE /api/auth/admin", () => {
  it("revoga limpando o cookie com maxAge 0", async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    const raw = res.headers.get("set-cookie") ?? ""
    expect(raw).toContain(`${ADMIN_AUTHORIZATION_COOKIE}=`)
    expect(raw).toContain("Max-Age=0")
  })
})
