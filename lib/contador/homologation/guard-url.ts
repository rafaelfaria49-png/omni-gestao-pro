/**
 * Contador HUB · homologação fiscal isolada (estratégia B).
 *
 * Recusa qualquer DSN que não seja o Postgres dedicado local.
 * Nunca aceita Production, pooler, host remoto, database de dev ou role genérica.
 *
 * Contrato canônico — manter idêntico em
 * `scripts/contador/provision-fiscal-homolog-db.mjs`.
 */
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

const HOST_PROIBIDO = /supabase|neon\.tech|vercel|amazonaws|azure|googleusercontent|pooler/i

export const ENV_HOMOLOGATION_DATABASE_URL = "CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL"

export const HOMOLOGATION_DATABASE = "omni_contador_fiscal_homolog"
export const HOMOLOGATION_ROLE = "omni_homolog"
export const HOMOLOGATION_PORT_DOCKER = "54329"
export const HOMOLOGATION_PORT_NATIVE = "5432"
export const HOMOLOGATION_PORTS = Object.freeze([
  HOMOLOGATION_PORT_NATIVE,
  HOMOLOGATION_PORT_DOCKER,
] as const)

export const DEFAULT_HOMOLOGATION_DATABASE_URL =
  `postgresql://${HOMOLOGATION_ROLE}:omni_homolog_local_only@127.0.0.1:${HOMOLOGATION_PORT_DOCKER}/${HOMOLOGATION_DATABASE}`

export class HomologationUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HomologationUrlError"
  }
}

function hostnameLocal(parsed: URL): string {
  return parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
}

function portaEfetiva(parsed: URL): string {
  return parsed.port === "" ? HOMOLOGATION_PORT_NATIVE : parsed.port
}

function databaseName(parsed: URL): string {
  const raw = decodeURIComponent(parsed.pathname.replace(/^\//, "")).replace(/\/+$/, "")
  if (!raw || raw.includes("/")) {
    throw new HomologationUrlError(
      `Database de homologação deve ser ${HOMOLOGATION_DATABASE} (recebido: ${raw || "(vazio)"}).`,
    )
  }
  return raw
}

function roleName(parsed: URL): string {
  return decodeURIComponent(parsed.username)
}

export function assertLocalHomologationDatabaseUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HomologationUrlError(`${ENV_HOMOLOGATION_DATABASE_URL} inválida.`)
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new HomologationUrlError("A URL de homologação deve ser postgresql:// em host local.")
  }

  const host = hostnameLocal(parsed)
  if (
    (!HOSTS_LOCAIS.has(host) && !HOSTS_LOCAIS.has(parsed.hostname.toLowerCase())) ||
    HOST_PROIBIDO.test(host) ||
    HOST_PROIBIDO.test(url)
  ) {
    throw new HomologationUrlError(
      `${ENV_HOMOLOGATION_DATABASE_URL} deve apontar para PostgreSQL local (recebido: ${host}).`,
    )
  }

  const port = portaEfetiva(parsed)
  if (port === "6543") {
    throw new HomologationUrlError("Porta 6543 (pooler) é recusada neste provisionamento.")
  }
  if (!(HOMOLOGATION_PORTS as readonly string[]).includes(port)) {
    throw new HomologationUrlError(
      `Porta ${port} não é permitida neste provisionamento (use ${HOMOLOGATION_PORT_DOCKER} Docker ou ${HOMOLOGATION_PORT_NATIVE} nativo).`,
    )
  }

  const role = roleName(parsed)
  if (role !== HOMOLOGATION_ROLE) {
    throw new HomologationUrlError(
      `Role de homologação deve ser ${HOMOLOGATION_ROLE} (recebido: ${role || "(vazio)"}).`,
    )
  }

  const database = databaseName(parsed)
  if (database !== HOMOLOGATION_DATABASE) {
    throw new HomologationUrlError(
      `Database de homologação deve ser ${HOMOLOGATION_DATABASE} (recebido: ${database}).`,
    )
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
