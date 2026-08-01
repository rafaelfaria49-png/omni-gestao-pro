/**
 * Contador HUB · Identidade externa — rate limit em memória (GOAL 014, §12 R-3).
 *
 * Mesmo shape do util do GOAL 003 (`lib/contador/auth/rate-limit.ts`), ENDURECIDO:
 * a chave é composta e-mail+IP — um atacante distribuindo tentativas entre IPs
 * continua limitado no e-mail alvo, e um IP atrás de NAT não derruba outros e-mails.
 *
 * Proteção local/best-effort: não é distribuída, reinicia a cada deploy/restart e
 * não é compartilhada entre instâncias serverless (limitação documentada na
 * proposta; alerta de pico fica para o GOAL 019). Sem Redis/banco/dependência nova.
 */
import { normalizarEmail } from "./usuarios"

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5

type Bucket = { count: number; windowStart: number }

const buckets = new Map<string, Bucket>()

export type RateLimitExternoResult = { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Chave composta e-mail(normalizado)+IP. O e-mail já chega normalizado na prática,
 * mas normalizar aqui de novo é defesa em profundidade contra chamadores diretos.
 */
export function montarChaveRateLimitExterno(email: string, ip: string): string {
  return `${normalizarEmail(email)}|${ip}`
}

function isWindowExpired(bucket: Bucket, nowMs: number): boolean {
  return nowMs - bucket.windowStart >= WINDOW_MS
}

export function checkRateLimitExterno(key: string, nowMs: number = Date.now()): RateLimitExternoResult {
  const bucket = buckets.get(key)
  if (!bucket || isWindowExpired(bucket, nowMs)) return { limited: false }
  if (bucket.count < MAX_ATTEMPTS) return { limited: false }
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - nowMs) / 1000))
  return { limited: true, retryAfterSeconds }
}

export function registerFalhaExterna(key: string, nowMs: number = Date.now()): void {
  const bucket = buckets.get(key)
  if (!bucket || isWindowExpired(bucket, nowMs)) {
    buckets.set(key, { count: 1, windowStart: nowMs })
    return
  }
  bucket.count += 1
}

/** Tentativa bem-sucedida limpa o estado da chave. */
export function registerSucessoExterno(key: string): void {
  buckets.delete(key)
}

/** Uso exclusivo dos testes — reseta o estado em memória entre casos. */
export function __resetRateLimitExternoForTests(): void {
  buckets.clear()
}
