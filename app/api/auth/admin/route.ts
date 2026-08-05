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
 *   2. resolve a loja pelo caminho canónico (header → query → cookie) e exige
 *      `canAccessStore`; sem loja resolvível, falha fechado;
 *   3. rate limit por (userId, storeId, ipHash) no motor único do repositório;
 *   4. recusa sempre os PINs legados bloqueados, sem sequer consultar o banco;
 *   5. emite autorização assinada de 15 min, vinculada ao userId e ao storeId.
 *
 * O que este GOAL NÃO fez (deliberadamente, sem migration): `User.pin` continua em
 * texto puro. A migration `pinHash` é a fase seguinte — o contrato aqui já está
 * preparado para ela, porque a comparação do PIN está isolada em `matchSupervisor`.
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

/** Papel do supervisor no modelo legado `User` — gravado ora maiúsculo, ora minúsculo. */
function supervisorRoleFilter(): { OR: { role: string }[] } {
  return { OR: [{ role: "ADMIN" }, { role: "admin" }] }
}

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
 * Ponto ÚNICO de comparação do PIN. Isolado de propósito: a migration `pinHash` troca
 * só esta função (passa a `bcrypt.compare`) sem tocar no resto do fluxo.
 *
 * O valor recebido nunca é logado, ecoado nem devolvido.
 */
async function matchSupervisor(pin: string): Promise<{ id: string; name: string } | null> {
  await prismaEnsureConnected()
  const found = await prisma.user.findFirst({
    where: { pin, ...supervisorRoleFilter() },
    select: { id: true, name: true },
  })
  return found ? { id: found.id, name: found.name } : null
}

/**
 * Estado da autorização corrente. Fail-closed em toda divergência: sem sessão, sem
 * loja resolvível, token ausente/adulterado/expirado ou vinculado a outro
 * utilizador/loja ⇒ `authenticated: false`, sem detalhe de motivo para o cliente.
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
      where: { id: verification.payload.supervisorId, ...supervisorRoleFilter() },
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

  // (2) LOJA — o cliente SELECIONA a unidade; quem AUTORIZA é `canAccessStore`.
  const storeId = storeIdFromAssistecRequestForRead(request)
  if (!storeId) {
    return deny(400, "store_required", "pin_auth_store_missing", {
      ipHash,
      userId,
      reasonCode: "unresolved_store",
    })
  }
  if (!canAccessStore(session, storeId)) {
    await audit("PIN_SUPERVISOR_LOJA_NEGADA", {
      userId,
      storeId,
      ipHash,
      detail: "Sessão sem acesso à unidade informada.",
    })
    return deny(403, "store_forbidden", "pin_auth_store_denied", { ipHash, userId, storeId })
  }

  const secret = resolvePinAuthorizationSecret()
  if (!secret) {
    return deny(503, "unavailable", "pin_auth_misconfigured", {
      ipHash,
      userId,
      storeId,
      reasonCode: "missing_server_secret",
    })
  }

  // (3) RATE LIMIT — só depois de haver identidade e loja, para que a chave seja
  // específica e ninguém consuma o orçamento de outro.
  const rateKey = buildPinRateLimitKey({ userId, storeId, ipHash })
  const limit = checkContadorRateLimit(rateKey)
  if (limit.limited) {
    await audit("PIN_SUPERVISOR_BLOQUEADO", {
      userId,
      storeId,
      ipHash,
      detail: "Bloqueio por excesso de tentativas incorretas.",
    })
    logPinAuthorizationEvent("pin_auth_rate_limited", { ipHash, userId, storeId })
    const res = NextResponse.json({ error: "rate_limited" }, { status: 429 })
    res.headers.set("Retry-After", String(limit.retryAfterSeconds))
    return res
  }

  let body: { pin?: unknown } = {}
  try {
    body = (await request.json()) as { pin?: unknown }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const pin = typeof body.pin === "string" ? body.pin.trim() : ""

  // (4) PIN LEGADO BLOQUEADO — recusado ANTES de qualquer consulta, para que nem
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

  // (5) SUCESSO — limpa o contador daquele contexto e emite a autorização vinculada.
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
