/**
 * Contador HUB · homologação fiscal isolada (estratégia B).
 *
 * Recusa qualquer DSN que não seja PostgreSQL local. Nunca aceita Production,
 * pooler Supabase, Preview remoto ou host público.
 */
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

const HOST_PROIBIDO = /supabase|neon\.tech|vercel|amazonaws|azure|googleusercontent|pooler/i

export const ENV_HOMOLOGATION_DATABASE_URL = "CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL"

export const DEFAULT_HOMOLOGATION_DATABASE_URL =
  "postgresql://omni_homolog:omni_homolog_local_only@127.0.0.1:54329/omni_contador_fiscal_homolog"

export class HomologationUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HomologationUrlError"
  }
}

export function assertLocalHomologationDatabaseUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HomologationUrlError("CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL inválida.")
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new HomologationUrlError("A URL de homologação deve ser postgresql:// em host local.")
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (
    (!HOSTS_LOCAIS.has(host) && !HOSTS_LOCAIS.has(parsed.hostname.toLowerCase())) ||
    HOST_PROIBIDO.test(host) ||
    HOST_PROIBIDO.test(url)
  ) {
    throw new HomologationUrlError(
      `CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL deve apontar para PostgreSQL local (recebido: ${host}).`,
    )
  }
  if (parsed.port === "6543") {
    throw new HomologationUrlError("Porta 6543 (pooler) é recusada neste provisionamento.")
  }
  parsed.searchParams.set("connection_limit", "8")
  parsed.searchParams.set("connect_timeout", "15")
  return parsed.toString()
}

export function resolveHomologationDatabaseUrl(
  env: NodeJS.Dict<string> = process.env,
): string {
  const raw = (env[ENV_HOMOLOGATION_DATABASE_URL] ?? DEFAULT_HOMOLOGATION_DATABASE_URL).trim()
  if (!raw) {
    throw new HomologationUrlError(`${ENV_HOMOLOGATION_DATABASE_URL} vazia.`)
  }
  return assertLocalHomologationDatabaseUrl(raw)
}
