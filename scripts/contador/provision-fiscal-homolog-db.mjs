#!/usr/bin/env node
/**
 * Provisiona o Postgres local do Contador (estratégia B) e aplica o seed HOMOLOGACAO.
 *
 * - NUNCA usa DATABASE_URL / DIRECT_URL de Production como fonte.
 * - Recusa host remoto, pooler (6543) e nomes supabase/neon/vercel.
 * - Para `prisma db push`, injeta DATABASE_URL=DIRECT_URL=<DSN homolog> no subprocesso.
 * - Não altera prisma/schema.prisma. Não abre GOAL 018. Não chama SEFAZ.
 *
 * Uso:
 *   node scripts/contador/provision-fiscal-homolog-db.mjs
 *   CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL=postgresql://... node scripts/contador/provision-fiscal-homolog-db.mjs
 */
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
process.chdir(root)

const ENV_KEY = "CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL"
const DEFAULT_URL =
  "postgresql://omni_homolog:omni_homolog_local_only@127.0.0.1:54329/omni_contador_fiscal_homolog"
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const HOST_PROIBIDO = /supabase|neon\.tech|vercel|amazonaws|azure|googleusercontent|pooler/i

function fail(message) {
  console.error(`[contador-homolog] ${message}`)
  process.exit(1)
}

function assertLocalHomologationDatabaseUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    fail(`${ENV_KEY} inválida.`)
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("A URL de homologação deve ser postgresql:// em host local.")
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (
    (!HOSTS_LOCAIS.has(host) && !HOSTS_LOCAIS.has(parsed.hostname.toLowerCase())) ||
    HOST_PROIBIDO.test(host) ||
    HOST_PROIBIDO.test(url)
  ) {
    fail(`${ENV_KEY} deve apontar para PostgreSQL local (recebido: ${host}).`)
  }
  if (parsed.port === "6543") {
    fail("Porta 6543 (pooler) é recusada neste provisionamento.")
  }
  return parsed
}

const raw = (process.env[ENV_KEY] ?? DEFAULT_URL).trim()
if (!raw) fail(`${ENV_KEY} vazia.`)
if (process.env.DATABASE_URL && process.env.DATABASE_URL === raw && HOST_PROIBIDO.test(raw)) {
  fail("Recusado: DSN de homologação coincide com DATABASE_URL remoto.")
}

const parsed = assertLocalHomologationDatabaseUrl(raw)
parsed.searchParams.set("connection_limit", "8")
parsed.searchParams.set("connect_timeout", "15")
const homologUrl = parsed.toString()

console.log(
  `[contador-homolog] host=${parsed.hostname} port=${parsed.port || "5432"} db=${parsed.pathname.replace(/^\//, "")}`,
)
console.log("[contador-homolog] Production DATABASE_URL ignorada; prisma db push usa só o DSN local.")

const prismaEnv = {
  ...process.env,
  DATABASE_URL: homologUrl,
  DIRECT_URL: homologUrl,
  [ENV_KEY]: homologUrl,
}

const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  cwd: root,
  env: prismaEnv,
  shell: true,
})
if (push.error) fail(String(push.error))
if (push.status !== 0) process.exit(push.status ?? 1)

const seed = spawnSync(
  "npx",
  ["tsx", "scripts/contador/seed-fiscal-homolog.ts"],
  {
    stdio: "inherit",
    cwd: root,
    env: prismaEnv,
    shell: true,
  },
)
if (seed.error) fail(String(seed.error))
if (seed.status !== 0) process.exit(seed.status ?? 1)

console.log("[contador-homolog] provisionamento concluído. GOAL_018_OPENED=false. SEFAZ não chamado.")
