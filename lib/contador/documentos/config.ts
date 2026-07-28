/**
 * Contador HUB · Documentos — configuração de storage e limites.
 *
 * Provider oficial: **Cloudflare R2** (S3-compatible, GOAL 012C). O adapter legado
 * Supabase (`storage-supabase.ts`) está marcado `@deprecated` e **nenhum import
 * produtivo** aponta para ele.
 *
 * Variáveis SERVER-SIDE. Qualquer segredo (Account ID, Access Key, Secret Access
 * Key, bucket) NUNCA vai ao navegador, NUNCA é logado e NUNCA aparece em mensagem
 * de erro — o erro tipado carrega apenas quais variáveis faltam (nomes, nunca valores).
 *
 * Server-only: este módulo só deve ser importado por código server (rotas API,
 * services, script de setup). Não importar em client component.
 */

/** Teto de tamanho por documento (decisão aprovada 010B). */
export const MAX_BYTES_DOCUMENTO = 25 * 1024 * 1024 // 25 MB

/** Expiração máxima da URL assinada de download (decisão aprovada 010B). */
export const DOWNLOAD_EXPIRACAO_SEG = 300

/** Expiração da URL assinada de upload (curta; o upload é imediato após o intent). */
export const UPLOAD_EXPIRACAO_SEG = 120

/* ─────────────────────────── provider gate (GOAL 012C) ─────────────────────────── */

/**
 * Seleciona o provider ativo. Default `"r2"` — não há fallback automático para
 * o Supabase Storage descontinuado: valores aceitos são `"r2"` (ou vazio/ausente).
 * Outros valores falham cerrado com `StorageProviderError` (mensagem segura).
 */
export const ENV_KEY_PROVIDER = "CONTADOR_STORAGE_PROVIDER" as const

export type StorageProviderId = "r2" | "supabase"

/** Erro tipado de provider incompatível com a decisão oficial (GOAL 012B). */
export class StorageProviderError extends Error {
  readonly code = "STORAGE_PROVIDER_INDISPONIVEL" as const
  readonly declarado: string
  constructor(declarado: string) {
    super(
      `Provider de storage "${declarado}" não é produtivo. Use "r2" (Cloudflare R2, GOAL 012C). O adapter Supabase está descontinuado e não há fallback automático.`,
    )
    this.name = "StorageProviderError"
    this.declarado = declarado
  }
}

/**
 * Lê e valida o provider declarado. Default `"r2"`. Rejeita `"supabase"` (e
 * qualquer outro valor) sem instanciar o adapter legado — fail-closed explícito.
 */
export function lerStorageProvider(env: Record<string, string | undefined> = process.env): StorageProviderId {
  const bruto = (env[ENV_KEY_PROVIDER] ?? "").trim().toLowerCase()
  if (bruto === "" || bruto === "r2") return "r2"
  // "supabase" (ou qualquer outro): explicamos sem acionar o adapter deprecated.
  throw new StorageProviderError(bruto)
}

/* ─────────────────────────── config Supabase (LEGADO @deprecated) ─────────────────────────── */
//
// Mantido APENAS para o adapter `storage-supabase.ts` existir como caminho de
// rollback manual. Nenhum import produtivo invoca `lerStorageConfig()`. Não
// remover — quebraria o caminho de rollback documentado em GOAL 012B §7.1.

/** Nomes das variáveis de ambiente (para mensagens de diagnóstico — nunca os valores). */
export const ENV_KEYS = {
  url: "SUPABASE_URL",
  serviceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  bucket: "SUPABASE_STORAGE_BUCKET",
} as const

export type StorageConfig = Readonly<{
  url: string
  serviceRoleKey: string
  bucket: string
}>

/* ─────────────────────────── config R2 (provider oficial — GOAL 012C) ─────────────────────────── */

/** Nomes das variáveis R2 (somente nomes — para diagnóstico, nunca valores). */
export const ENV_KEYS_R2 = {
  accountId: "R2_ACCOUNT_ID",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
  bucket: "R2_BUCKET",
  signedUrlTtlSeconds: "R2_SIGNED_URL_TTL_SECONDS",
} as const

export type StorageR2Config = Readonly<{
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  // Override opcional do TTL default (em segundos); sempre capado pelos tetos
  // `UPLOAD_EXPIRACAO_SEG` / `DOWNLOAD_EXPIRACAO_SEG` no adapter.
  signedUrlTtlSeconds: number | null
  /** Endpoint S3 completo derivado de `accountId`. */
  endpoint: string
}>

/** Erro tipado de configuração ausente/incompleta. Mensagem é SEGURA (sem segredos). */
export class StorageConfigError extends Error {
  readonly code = "STORAGE_CONFIG_INDISPONIVEL" as const
  /** Nomes das variáveis faltantes (nunca os valores). */
  readonly faltando: readonly string[]
  constructor(faltando: readonly string[]) {
    super(
      `Storage de documentos indisponível: configure ${faltando.join(", ")} no ambiente server-side.`,
    )
    this.name = "StorageConfigError"
    this.faltando = faltando
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Hard guard de segurança: rejeita se qualquer var com prefixo `NEXT_PUBLIC_`
 * casa com termos típicos de segredo de storage (service role, secret, access
 * key, private key, token). Aplica tanto ao adapter Supabase (legado) quanto ao R2.
 */
const SEGREDO_PUBLICO_RE = /SERVICE_ROLE|SECRET|ACCESS_KEY|PRIVATE_KEY|TOKEN/i

function rejeitarSegredoPublico(env: EnvLike): void {
  for (const chave of Object.keys(env)) {
    if (chave.startsWith("NEXT_PUBLIC_") && SEGREDO_PUBLICO_RE.test(chave)) {
      throw new StorageConfigError([
        `${chave} (segredo de storage NUNCA pode ter prefixo NEXT_PUBLIC)`,
      ])
    }
  }
}

/* ─────────── Supabase legado ─────────── */

function faltantesSupabase(env: EnvLike): string[] {
  const faltando: string[] = []
  if (!env[ENV_KEYS.url]?.trim()) faltando.push(ENV_KEYS.url)
  if (!env[ENV_KEYS.serviceRoleKey]?.trim()) faltando.push(ENV_KEYS.serviceRoleKey)
  if (!env[ENV_KEYS.bucket]?.trim()) faltando.push(ENV_KEYS.bucket)
  return faltando
}

/** `true` quando todas as variáveis obrigatórias (provider Supabase legado) estão presentes. */
export function storageConfigDisponivel(env: EnvLike = process.env): boolean {
  return faltantesSupabase(env).length === 0
}

/**
 * Lê a configuração completa do adapter Supabase (LEGADO). Lança `StorageConfigError`
 * (mensagem segura) quando qualquer variável obrigatória está ausente. Rejeita
 * `service_role` exposta em `NEXT_PUBLIC_*` como erro de segurança explícito.
 */
export function lerStorageConfig(env: EnvLike = process.env): StorageConfig {
  rejeitarSegredoPublico(env)

  const faltando = faltantesSupabase(env)
  if (faltando.length > 0) throw new StorageConfigError(faltando)

  return Object.freeze({
    url: env[ENV_KEYS.url]!.trim(),
    serviceRoleKey: env[ENV_KEYS.serviceRoleKey]!.trim(),
    bucket: env[ENV_KEYS.bucket]!.trim(),
  })
}

/* ─────────── R2 (provider oficial) ─────────── */

function faltantesR2(env: EnvLike): string[] {
  const faltando: string[] = []
  if (!env[ENV_KEYS_R2.accountId]?.trim()) faltando.push(ENV_KEYS_R2.accountId)
  if (!env[ENV_KEYS_R2.accessKeyId]?.trim()) faltando.push(ENV_KEYS_R2.accessKeyId)
  if (!env[ENV_KEYS_R2.secretAccessKey]?.trim()) faltando.push(ENV_KEYS_R2.secretAccessKey)
  if (!env[ENV_KEYS_R2.bucket]?.trim()) faltando.push(ENV_KEYS_R2.bucket)
  return faltando
}

/** `true` quando todas as variáveis R2 obrigatórias estão presentes (sem revelar valores). */
export function storageR2ConfigDisponivel(env: EnvLike = process.env): boolean {
  return faltantesR2(env).length === 0
}

/**
 * Lê a configuração R2 completa. Lança `StorageConfigError` (mensagem segura) quando
 * qualquer variável obrigatória está ausente. Hard guard: rejeita segredo R2 exposto
 * em `NEXT_PUBLIC_*`. `R2_SIGNED_URL_TTL_SECONDS` é OPCIONAL e (se presente) deve ser
 * inteiro positivo; o adapter ainda capará no teto de upload/download.
 */
export function lerStorageR2Config(env: EnvLike = process.env): StorageR2Config {
  rejeitarSegredoPublico(env)

  const faltando = faltantesR2(env)
  if (faltando.length > 0) throw new StorageConfigError(faltando)

  const ttlRaw = (env[ENV_KEYS_R2.signedUrlTtlSeconds] ?? "").trim()
  let signedUrlTtlSeconds: number | null = null
  if (ttlRaw !== "") {
    const n = Number(ttlRaw)
    if (!Number.isInteger(n) || n <= 0) {
      throw new StorageConfigError([
        `${ENV_KEYS_R2.signedUrlTtlSeconds} (deve ser inteiro positivo quando definido)`,
      ])
    }
    signedUrlTtlSeconds = n
  }

  const accountId = env[ENV_KEYS_R2.accountId]!.trim()
  return Object.freeze({
    accountId,
    accessKeyId: env[ENV_KEYS_R2.accessKeyId]!.trim(),
    secretAccessKey: env[ENV_KEYS_R2.secretAccessKey]!.trim(),
    bucket: env[ENV_KEYS_R2.bucket]!.trim(),
    signedUrlTtlSeconds,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  })
}
