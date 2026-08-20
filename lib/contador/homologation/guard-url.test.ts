import { describe, expect, it } from "vitest"

import {
  DEFAULT_HOMOLOGATION_DATABASE_URL,
  ENV_HOMOLOGATION_DATABASE_URL,
  HomologationUrlError,
  assertLocalHomologationDatabaseUrl,
  resolveHomologationDatabaseUrl,
} from "./guard-url"

describe("assertLocalHomologationDatabaseUrl", () => {
  it("aceita o DSN local padrão (127.0.0.1:54329)", () => {
    const url = assertLocalHomologationDatabaseUrl(DEFAULT_HOMOLOGATION_DATABASE_URL)
    expect(url).toContain("127.0.0.1")
    expect(url).toContain("54329")
    expect(url).toContain("omni_contador_fiscal_homolog")
  })

  it("aceita localhost e ::1", () => {
    expect(
      assertLocalHomologationDatabaseUrl(
        "postgresql://omni_homolog:x@localhost:5432/omni_contador_fiscal_homolog",
      ),
    ).toContain("localhost")
    expect(
      assertLocalHomologationDatabaseUrl(
        "postgresql://omni_homolog:x@[::1]:5432/omni_contador_fiscal_homolog",
      ),
    ).toMatch(/::1|%3A%3A1/)
  })

  it("recusa Production / pooler / hosts remotos", () => {
    const remotos = [
      "postgresql://postgres:x@db.abcdefgh.supabase.co:6543/postgres",
      "postgresql://postgres:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
      "postgresql://x:y@ep-foo.neon.tech/neondb",
      "postgresql://x:y@host.vercel-storage.com:5432/db",
      "postgresql://x:y@example.com:5432/db",
    ]
    for (const url of remotos) {
      expect(() => assertLocalHomologationDatabaseUrl(url)).toThrow(HomologationUrlError)
    }
  })

  it("recusa porta 6543 mesmo em localhost", () => {
    expect(() =>
      assertLocalHomologationDatabaseUrl("postgresql://omni:x@127.0.0.1:6543/omni"),
    ).toThrow(/6543/)
  })

  it("recusa protocolo não-postgres", () => {
    expect(() => assertLocalHomologationDatabaseUrl("mysql://127.0.0.1:3306/omni")).toThrow(
      HomologationUrlError,
    )
  })
})

describe("resolveHomologationDatabaseUrl", () => {
  it("não lê DATABASE_URL de Production — usa o default local", () => {
    const url = resolveHomologationDatabaseUrl({
      DATABASE_URL: "postgresql://postgres:x@db.prod.supabase.co:6543/postgres",
      DIRECT_URL: "postgresql://postgres:x@db.prod.supabase.co:5432/postgres",
    })
    expect(url).toContain("127.0.0.1")
    expect(url).toContain("54329")
  })

  it("honra CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL quando local", () => {
    const url = resolveHomologationDatabaseUrl({
      [ENV_HOMOLOGATION_DATABASE_URL]:
        "postgresql://omni_homolog:omni_homolog_local_only@127.0.0.1:5432/omni_contador_fiscal_homolog",
    })
    expect(url).toContain("5432")
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
