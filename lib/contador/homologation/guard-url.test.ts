import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  DEFAULT_HOMOLOGATION_DATABASE_URL,
  ENV_HOMOLOGATION_DATABASE_URL,
  HOMOLOGATION_DATABASE,
  HOMOLOGATION_PORT_DOCKER,
  HOMOLOGATION_PORT_NATIVE,
  HOMOLOGATION_ROLE,
  HomologationUrlError,
  assertLocalHomologationDatabaseUrl,
  resolveHomologationDatabaseUrl,
} from "./guard-url"

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DIR, "../../..")

const DSN_DOCKER = `postgresql://${HOMOLOGATION_ROLE}:omni_homolog_local_only@127.0.0.1:${HOMOLOGATION_PORT_DOCKER}/${HOMOLOGATION_DATABASE}`
const DSN_NATIVE = `postgresql://${HOMOLOGATION_ROLE}:omni_homolog_local_only@127.0.0.1:${HOMOLOGATION_PORT_NATIVE}/${HOMOLOGATION_DATABASE}`

describe("assertLocalHomologationDatabaseUrl", () => {
  it("DSN Docker correto → aceita", () => {
    const url = assertLocalHomologationDatabaseUrl(DSN_DOCKER)
    expect(url).toContain("127.0.0.1")
    expect(url).toContain(HOMOLOGATION_PORT_DOCKER)
    expect(url).toContain(HOMOLOGATION_DATABASE)
    expect(url).toContain(HOMOLOGATION_ROLE)
  })

  it("DSN native correto → aceita", () => {
    const url = assertLocalHomologationDatabaseUrl(DSN_NATIVE)
    expect(url).toContain(HOMOLOGATION_PORT_NATIVE)
    expect(url).toContain(HOMOLOGATION_DATABASE)
    expect(url).not.toContain("6543")
  })

  it("aceita o default Docker e localhost/::1 com db e role dedicados", () => {
    expect(assertLocalHomologationDatabaseUrl(DEFAULT_HOMOLOGATION_DATABASE_URL)).toContain(
      HOMOLOGATION_PORT_DOCKER,
    )
    expect(
      assertLocalHomologationDatabaseUrl(
        `postgresql://${HOMOLOGATION_ROLE}:x@localhost:${HOMOLOGATION_PORT_NATIVE}/${HOMOLOGATION_DATABASE}`,
      ),
    ).toContain("localhost")
    expect(
      assertLocalHomologationDatabaseUrl(
        `postgresql://${HOMOLOGATION_ROLE}:x@[::1]:${HOMOLOGATION_PORT_NATIVE}/${HOMOLOGATION_DATABASE}`,
      ),
    ).toMatch(/::1|%3A%3A1/)
  })

  it("localhost com database errado → rejeita", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl(
        `postgresql://${HOMOLOGATION_ROLE}:x@localhost:${HOMOLOGATION_PORT_NATIVE}/postgres`,
      ),
    ).toThrow(/omni_contador_fiscal_homolog/)
  })

  it("localhost com role postgres → rejeita", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl(
        `postgresql://postgres:x@localhost:${HOMOLOGATION_PORT_NATIVE}/${HOMOLOGATION_DATABASE}`,
      ),
    ).toThrow(/omni_homolog/)
  })

  it("localhost apontando para database de dev → rejeita", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl(
        `postgresql://${HOMOLOGATION_ROLE}:x@127.0.0.1:${HOMOLOGATION_PORT_NATIVE}/omni_gestao_pro`,
      ),
    ).toThrow(/omni_contador_fiscal_homolog/)
  })

  it("127.0.0.1:6543 → rejeita", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl(
        `postgresql://${HOMOLOGATION_ROLE}:x@127.0.0.1:6543/${HOMOLOGATION_DATABASE}`,
      ),
    ).toThrow(/6543/)
  })

  it("Supabase/Neon/remoto → rejeita", () => {
    const remotos = [
      "postgresql://postgres:x@db.abcdefgh.supabase.co:6543/postgres",
      "postgresql://postgres:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
      "postgresql://x:y@ep-foo.neon.tech/neondb",
      "postgresql://x:y@host.vercel-storage.com:5432/db",
      "postgresql://x:y@example.com:5432/omni_contador_fiscal_homolog",
    ]
    for (const url of remotos) {
      expect(() => assertLocalHomologationDatabaseUrl(url)).toThrow(HomologationUrlError)
    }
  })

  it("protocolo não-Postgres → rejeita", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl("mysql://127.0.0.1:3306/omni_contador_fiscal_homolog"),
    ).toThrow(HomologationUrlError)
  })
})

describe("resolveHomologationDatabaseUrl", () => {
  it("não lê DATABASE_URL de Production — usa o default local", () => {
    const url = resolveHomologationDatabaseUrl({
      DATABASE_URL: "postgresql://postgres:x@db.prod.supabase.co:6543/postgres",
      DIRECT_URL: "postgresql://postgres:x@db.prod.supabase.co:5432/postgres",
    })
    expect(url).toContain("127.0.0.1")
    expect(url).toContain(HOMOLOGATION_PORT_DOCKER)
    expect(url).toContain(HOMOLOGATION_DATABASE)
  })

  it("honra CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL quando o DSN dedicado é nativo", () => {
    const url = resolveHomologationDatabaseUrl({
      [ENV_HOMOLOGATION_DATABASE_URL]: DSN_NATIVE,
    })
    expect(url).toContain(HOMOLOGATION_PORT_NATIVE)
    expect(url).not.toContain("6543")
  })

  it("recusa homolog env apontando para remoto", () => {
    expect(() =>
      resolveHomologationDatabaseUrl({
        [ENV_HOMOLOGATION_DATABASE_URL]:
          "postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres",
      }),
    ).toThrow(HomologationUrlError)
  })
})

describe("contrato compartilhado TS × mjs", () => {
  it("provision.mjs declara o mesmo database, role, portas e mensagens", () => {
    const ts = readFileSync(join(DIR, "guard-url.ts"), "utf8")
    const mjs = readFileSync(
      join(ROOT, "scripts/contador/provision-fiscal-homolog-db.mjs"),
      "utf8",
    )
    const tokens = [
      "omni_contador_fiscal_homolog",
      "omni_homolog",
      '"54329"',
      '"5432"',
      "Porta 6543 (pooler) é recusada neste provisionamento.",
      "Role de homologação deve ser",
      "Database de homologação deve ser",
      "HOMOLOGATION_PORT_DOCKER} Docker ou ${HOMOLOGATION_PORT_NATIVE} nativo",
    ]
    for (const token of tokens) {
      expect(ts, `guard-url.ts deve conter ${token}`).toContain(token)
      expect(mjs, `provision.mjs deve conter ${token}`).toContain(token)
    }
  })
})
