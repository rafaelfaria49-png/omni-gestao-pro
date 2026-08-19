/**
 * Autorização de supervisor do PDV por PIN — GOAL PLAT-AUTH-PIN-CONTAINMENT-001A.
 *
 * ANTES (P0 #1 da auditoria PLAT-STAFF-AUTH-PDV-CASH-HANDOVER-AUDIT-001): rota
 * pública (`isPublicPath("/api/…")`), sem sessão, sem rate limit, sem escopo de loja;
 * o POST comparava o PIN em texto puro e emitia um cookie de 7 dias cujo valor era o
 * id cru do supervisor. Era o único achado explorável por quem NÃO tinha conta.
 *
 * AGORA: o PIN deixou de ser credencial de acesso e passou a ser CO-ASSINATURA.
 *   1. exige sessão NextAuth válida (utilizador existente e ativo) — anónimo nunca
 *      chega a consultar PIN nenhum;
 *   2. resolve a loja pelo caminho canónico (header → query → cookie); sem loja
 *      resolvível, falha fechado;
 *   3. rate limit pelo `userId` autenticado no motor único do repositório;
 *   4. exige `canAccessStore` E prova no banco que a loja EXISTE (R1-bis);
 *   5. recusa sempre os PINs legados bloqueados, sem sequer consultar o banco;
 *   6. emite autorização assinada de 15 min, vinculada ao userId e ao storeId canónico.
 *
 * Hash: a comparação do PIN vive em `authenticateSupervisorPin` (HMAC + bcrypt).
 * `User.pin` permanece para rollback; a rota nunca faz `WHERE pin = candidato`.
 *
 * Nenhuma resposta, log ou registo de auditoria desta rota contém o PIN, o token ou
 * o cookie.
 */

import { NextResponse } from "next/server"
import { cookies, headers } from "next/headers"
import { auth } from "@/auth"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { getSessionEntitlement } from "@/lib/auth/session-entitlement"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { extractClientIp } from "@/lib/contador/auth/legacy-session"
import {
  ADMIN_AUTHORIZATION_COOKIE,
  buildPinAuthorizationClearCookieOptions,
  buildPinAuthorizationCookieOptions,
  buildPinRateLimitKey,
  createPinAuthorizationToken,
  hashClientIp,
  isBlockedLegacySupervisorPin,
  logPinAuthorizationEvent,
  resolvePinAuthorizationSecret,
  verifyPinAuthorizationToken,
  type PinAuthorizationEvent,
} from "@/lib/auth/pin-authorization"
import {
  authenticateSupervisorPin,
  SUPERVISOR_ROLE_FILTER,
} from "@/lib/auth/verify-supervisor-pin"
// Motor ÚNICO de rate limit do repositório (em memória, por instância). O nome é
// histórico — nasceu no portal do contador —, mas a chave é namespacada por
// `buildPinRateLimitKey`, então os orçamentos não se cruzam. Duplicar o motor era
// explicitamente indesejado pelo GOAL.
import {
  checkContadorRateLimit,
  registerContadorAuthFailure,
  registerContadorAuthSuccess,
} from "@/lib/contador/auth/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function currentIpHash(): Promise<string> {
  const h = await headers()
  return hashClientIp(extractClientIp(h))
}

/**
 * Trilha de auditoria no mecanismo já existente (`logs_auditoria`) — sem schema novo.
 *
 * Limitação assumida: a tabela não tem colunas `userId`/`storeId`; ambos vão em
 * `metadata` (JSON) e `userLabel` recebe o `userId`, não o e-mail. Falha de escrita
 * de auditoria nunca derruba a decisão de autorização — mas é logada.
 */
async function audit(
  action: string,
  input: { userId?: string; storeId?: string; ipHash: string; detail: string },
): Promise<void> {
  try {
    await prisma.logsAuditoria.create({
      data: {
        action,
        userLabel: input.userId ?? "anonimo",
        detail: input.detail,
        metadata: JSON.stringify({
          userId: input.userId ?? null,
          storeId: input.storeId ?? null,
          ipHash: input.ipHash,
        }),
        source: "api/auth/admin",
      },
    })
  } catch (e) {
    console.error("[auth/admin:audit]", e instanceof Error ? e.message : String(e))
  }
}

function deny(
  status: number,
  error: string,
  event: PinAuthorizationEvent,
  fields: { ipHash: string; userId?: string; storeId?: string; reasonCode?: string },
): NextResponse {
  logPinAuthorizationEvent(event, fields)
  return NextResponse.json({ error }, { status })
}

/**
 * Ponto ÚNICO de comparação do PIN nesta rota. Delega ao verificador central
 * (hash bcrypt / legado plaintext com upgrade). O valor nunca é logado.
 */
async function matchSupervisor(pin: string): Promise<{ id: string; name: string } | null> {
  return authenticateSupervisorPin(pin)
}

/**
 * Prova CANÓNICA de que a unidade existe — R1-bis.
 *
 * `canAccessStore` sozinho não serve como validação de loja: para sessões não
 * restritas ele é *default-allow* (`lib/auth/enterprise-permissions.ts`) e devolve
 * `true` para qualquer string, incluindo identificadores inventados. Ele responde
 * "esta sessão pode operar esta unidade?", não "esta unidade existe?" — e o `storeId`
 * chega de header/query/cookie, ou seja, é escolhido pelo cliente.
 *
 * Sem esta prova, um utilizador autenticado emitia autorização para uma loja que não
 * existe e a vinculava no token e na auditoria.
 *
 * Devolve o id EXATO da linha do banco (nunca a string do cliente) ou `null`. O
 * `findUnique` é por chave primária — barato e sem varredura.
 */
async function resolveCanonicalStoreId(storeId: string): Promise<string | null> {
  await prismaEnsureConnected()
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } })
  return store?.id ?? null
}

/**
 * Estado da autorização corrente. Fail-closed em toda divergência: sem sessão, sem
 * loja resolvível, token ausente/adulterado/expirado ou vinculado a outro
 * utilizador/loja ⇒ `authenticated: false`, sem detalhe de motivo para o cliente.
 *
 * Sem validação canónica de loja aqui, de propósito: o GET não emite nada e não compara
 * PIN. O `storeId` do token já foi provado no banco na EMISSÃO, e a comparação contra o
 * valor pedido é exata — um identificador inventado nunca coincide com o do token e cai
 * em `store_mismatch`. Consultar o banco a cada sondagem só somaria custo, sem fechar
 * vetor nenhum.
 */
export async function GET(request: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ authenticated: false })

  const storeId = storeIdFromAssistecRequestForRead(request)
  if (!storeId) return NextResponse.json({ authenticated: false })

  const jar = await cookies()
  const verification = await verifyPinAuthorizationToken(
    jar.get(ADMIN_AUTHORIZATION_COOKIE)?.value,
    resolvePinAuthorizationSecret(),
    { userId, storeId },
  )
  if (!verification.ok) return NextResponse.json({ authenticated: false })

  try {
    await prismaEnsureConnected()
    const supervisor = await prisma.user.findFirst({
      where: { id: verification.payload.supervisorId, ...SUPERVISOR_ROLE_FILTER },
      select: { id: true, name: true },
    })
    if (!supervisor) return NextResponse.json({ authenticated: false })
    return NextResponse.json({
      authenticated: true,
      admin: { id: supervisor.id, name: supervisor.name },
    })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}

export async function POST(request: Request) {
  const ipHash = await currentIpHash()

  // (1) SESSÃO — antes de tudo. Requisição anónima nunca chega a ler o corpo nem a
  // consultar PIN: o endpoint deixou de ser um oráculo de PIN para quem não tem conta.
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    // Só log estruturado: gravar em `logs_auditoria` a partir de um pedido anónimo
    // transformaria a rota num amplificador de escrita em banco. A rejeição fica
    // registada no log do servidor, com `ipHash` (nunca o IP bruto).
    return deny(401, "auth_required", "pin_auth_no_session", { ipHash, reasonCode: "no_session" })
  }

  // Utilizador desativado ou removido depois da emissão do JWT não passa (o token
  // sozinho não prova que a conta ainda existe).
  const entitlement = await getSessionEntitlement()
  if (!entitlement.ok) {
    await audit("PIN_SUPERVISOR_SEM_SESSAO", {
      userId,
      ipHash,
      detail: `Sessão recusada: ${entitlement.reason}.`,
    })
    return deny(401, "auth_required", "pin_auth_no_session", {
      ipHash,
      userId,
      reasonCode: entitlement.reason,
    })
  }

  // (2) LOJA SOLICITADA — ainda é só a ESCOLHA do cliente (header → query → cookie).
  // Nada aqui a trata como verdadeira; a validação vem no passo (4).
  const requestedStoreId = storeIdFromAssistecRequestForRead(request)
  if (!requestedStoreId) {
    return deny(400, "store_required", "pin_auth_store_missing", {
      ipHash,
      userId,
      reasonCode: "unresolved_store",
    })
  }

  const secret = resolvePinAuthorizationSecret()
  if (!secret) {
    return deny(503, "unavailable", "pin_auth_misconfigured", {
      ipHash,
      userId,
      storeId: requestedStoreId,
      reasonCode: "missing_server_secret",
    })
  }

  // (3) RATE LIMIT — ANTES da validação da loja, de propósito.
  //
  // A chave é só o `userId` (R1-bis), portanto já não depende do `storeId` e pode
  // correr mais cedo. Correr antes da validação da loja é o que fecha o vetor: quem já
  // esgotou o orçamento recebe 429 mesmo enviando um `storeId` inventado, em vez de
  // receber uma resposta diferente que revelasse um balde novo — e não paga consulta ao
  // banco nenhuma enquanto está bloqueado.
  const rateKey = buildPinRateLimitKey({ userId, storeId: requestedStoreId, ipHash })
  const limit = checkContadorRateLimit(rateKey)
  if (limit.limited) {
    await audit("PIN_SUPERVISOR_BLOQUEADO", {
      userId,
      storeId: requestedStoreId,
      ipHash,
      detail: "Bloqueio por excesso de tentativas incorretas.",
    })
    logPinAuthorizationEvent("pin_auth_rate_limited", {
      ipHash,
      userId,
      storeId: requestedStoreId,
    })
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 })
    res.headers.set("Retry-After", String(limit.retryAfterSeconds))
    return res
  }

  // (4) LOJA VALIDADA — política de acesso E existência real, nesta ordem (a política é
  // em memória; só se ela passar vale ir ao banco).
  //
  // As duas recusas devolvem o MESMO `store_forbidden`/403: distinguir "não é sua" de
  // "não existe" transformaria a rota num oráculo de enumeração de unidades para
  // qualquer utilizador autenticado. Os motivos ficam separados no log e na auditoria,
  // que são internos.
  if (!canAccessStore(session, requestedStoreId)) {
    await audit("PIN_SUPERVISOR_LOJA_NEGADA", {
      userId,
      storeId: requestedStoreId,
      ipHash,
      detail: "Sessão sem acesso à unidade informada.",
    })
    return deny(403, "store_forbidden", "pin_auth_store_denied", {
      ipHash,
      userId,
      storeId: requestedStoreId,
      reasonCode: "store_not_allowed",
    })
  }

  let storeId: string | null
  try {
    storeId = await resolveCanonicalStoreId(requestedStoreId)
  } catch (e) {
    console.error("[auth/admin:store]", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }
  if (!storeId) {
    await audit("PIN_SUPERVISOR_LOJA_NEGADA", {
      userId,
      storeId: requestedStoreId,
      ipHash,
      detail: "Unidade informada não existe.",
    })
    return deny(403, "store_forbidden", "pin_auth_store_denied", {
      ipHash,
      userId,
      storeId: requestedStoreId,
      reasonCode: "store_not_found",
    })
  }

  let body: { pin?: unknown } = {}
  try {
    body = (await request.json()) as { pin?: unknown }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const pin = typeof body.pin === "string" ? body.pin.trim() : ""

  // (5) PIN LEGADO BLOQUEADO — recusado ANTES de qualquer consulta, para que nem
  // exista caminho em que ele possa autenticar. Conta como tentativa incorreta.
  if (pin.length === 0 || isBlockedLegacySupervisorPin(pin)) {
    registerContadorAuthFailure(rateKey)
    const blocked = pin.length > 0
    await audit("PIN_SUPERVISOR_INCORRETO", {
      userId,
      storeId,
      ipHash,
      detail: blocked ? "PIN padrão legado — sempre recusado." : "PIN vazio.",
    })
    return deny(
      401,
      "invalid_pin",
      blocked ? "pin_auth_default_blocked" : "pin_auth_failed",
      { ipHash, userId, storeId, reasonCode: blocked ? "blocked_default_pin" : "empty_pin" },
    )
  }

  let supervisor: { id: string; name: string } | null
  try {
    supervisor = await matchSupervisor(pin)
  } catch (e) {
    console.error("[auth/admin:POST]", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }

  if (!supervisor) {
    registerContadorAuthFailure(rateKey)
    await audit("PIN_SUPERVISOR_INCORRETO", {
      userId,
      storeId,
      ipHash,
      detail: "PIN de supervisor incorreto.",
    })
    return deny(401, "invalid_pin", "pin_auth_failed", {
      ipHash,
      userId,
      storeId,
      reasonCode: "no_match",
    })
  }

  // (6) SUCESSO — limpa o orçamento DAQUELE utilizador (a chave é só o `userId`, logo
  // nenhum outro utilizador é afetado) e emite a autorização vinculada ao `storeId`
  // canónico devolvido pelo banco, nunca à string que o cliente enviou.
  registerContadorAuthSuccess(rateKey)
  const token = await createPinAuthorizationToken(
    { userId, storeId, supervisorId: supervisor.id },
    secret,
  )
  await audit("PIN_SUPERVISOR_AUTORIZADO", {
    userId,
    storeId,
    ipHash,
    detail: `Autorização de supervisor concedida por ${supervisor.id}.`,
  })
  logPinAuthorizationEvent("pin_auth_success", { ipHash, userId, storeId })

  const res = NextResponse.json({ ok: true, admin: { id: supervisor.id, name: supervisor.name } })
  res.cookies.set(buildPinAuthorizationCookieOptions(token))
  return res
}

/** Revogação explícita — sempre permitida, mesmo sem sessão (só apaga o cookie). */
export async function DELETE() {
  logPinAuthorizationEvent("pin_auth_revoked", { ipHash: await currentIpHash() })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(buildPinAuthorizationClearCookieOptions())
  return res
}
