/**
 * GOAL FIX-009 — autorização central do Marketplace API gate.
 *
 * Mocka só as fontes de identidade (auth + Prisma adminUser).
 * canAccessStore, getEnterprisePermissions e requireEnterpriseWith são reais.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => null),
  findUnique: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { adminUser: { findUnique: h.findUnique } },
}))

import { MARKETPLACE_FORBIDDEN_MESSAGE, requireMarketplaceApi } from "@/lib/marketplace/api-gate"

function makeSession(opts: {
  role?: string
  storeAccess?: "all" | "restricted"
  allowedStoreIds?: string[]
  id?: string
}): Session {
  return {
    user: {
      id: opts.id ?? "user-1",
      email: "u@x.com",
      name: "U",
      role: opts.role ?? "ADMIN",
      storeAccess: opts.storeAccess ?? "all",
      allowedStoreIds: opts.allowedStoreIds,
    },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Session
}

function req(opts?: { headerStoreId?: string; query?: string }) {
  const url = `https://app.local/api/marketplace/connections${opts?.query ?? ""}`
  const headers = new Headers()
  if (opts?.headerStoreId !== undefined) {
    headers.set(ASSISTEC_LOJA_HEADER, opts.headerStoreId)
  }
  return new Request(url, { headers })
}

async function deny(result: Awaited<ReturnType<typeof requireMarketplaceApi>>) {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error("expected deny")
  const body = (await result.response.json()) as { error?: string }
  return { status: result.response.status, error: body.error }
}

beforeEach(() => {
  h.auth.mockReset()
  h.findUnique.mockReset()
  h.auth.mockResolvedValue(null)
  h.findUnique.mockResolvedValue(null)
})

function sessionAtiva(session: Session, dbRole?: string) {
  h.auth.mockResolvedValue(session)
  h.findUnique.mockResolvedValue({
    active: true,
    planName: "PRATA",
    role: dbRole ?? session.user.role,
  })
}

describe("requireMarketplaceApi — identidade", () => {
  it("T1 — sem sessão: 401 Não autorizado", async () => {
    const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-a" })))
    expect(r).toEqual({ status: 401, error: "Não autorizado" })
  })

  it("T2 — usuário inativo: 401 Não autorizado", async () => {
    h.auth.mockResolvedValue(makeSession({ role: "ADMIN" }))
    h.findUnique.mockResolvedValue({ active: false, planName: "PRATA", role: "ADMIN" })
    const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-a" })))
    expect(r).toEqual({ status: 401, error: "Não autorizado" })
  })

  it("T2b — usuário inexistente: 401 Não autorizado", async () => {
    h.auth.mockResolvedValue(makeSession({ role: "ADMIN" }))
    h.findUnique.mockResolvedValue(null)
    const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-a" })))
    expect(r).toEqual({ status: 401, error: "Não autorizado" })
  })

  it("T3 — storeId ausente: 400 com mensagem atual", async () => {
    sessionAtiva(makeSession({ role: "ADMIN" }))
    const r = await deny(await requireMarketplaceApi(req()))
    expect(r.status).toBe(400)
    expect(r.error).toBe(
      "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId / lojaId.",
    )
  })
})

describe("requireMarketplaceApi — membership + hubs.marketplace", () => {
  it("T4 / A — restricted + loja autorizada + marketplace=true: ALLOW", async () => {
    sessionAtiva(
      makeSession({
        role: "ADMIN",
        storeAccess: "restricted",
        allowedStoreIds: ["loja-a"],
      }),
    )
    const r = await requireMarketplaceApi(req({ headerStoreId: "loja-a" }))
    expect(r).toEqual({ ok: true, storeId: "loja-a" })
  })

  it("T5 / B — restricted + loja não autorizada: 403", async () => {
    sessionAtiva(
      makeSession({
        role: "ADMIN",
        storeAccess: "restricted",
        allowedStoreIds: ["loja-a"],
      }),
    )
    const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-b" })))
    expect(r).toEqual({ status: 403, error: "Sem permissão para esta unidade" })
  })

  it("T6 — acesso à loja com hubs.marketplace=false: 403", async () => {
    sessionAtiva(
      makeSession({
        role: "CAIXA",
        storeAccess: "restricted",
        allowedStoreIds: ["loja-a"],
      }),
    )
    const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-a" })))
    expect(r).toEqual({ status: 403, error: MARKETPLACE_FORBIDDEN_MESSAGE })
  })

  it("T7 — CAIXA / TECNICO / VENDEDOR não obtêm autorização", async () => {
    for (const role of ["CAIXA", "TECNICO", "VENDEDOR"] as const) {
      sessionAtiva(makeSession({ role, storeAccess: "all" }))
      const r = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-a" })))
      expect(r, role).toEqual({ status: 403, error: MARKETPLACE_FORBIDDEN_MESSAGE })
    }
  })

  it("T8 — ADMIN autorizado: contrato de sucesso { ok, storeId }", async () => {
    sessionAtiva(makeSession({ role: "ADMIN", storeAccess: "all" }))
    const r = await requireMarketplaceApi(req({ headerStoreId: "loja-a" }))
    expect(r).toEqual({ ok: true, storeId: "loja-a" })
    expect(r).not.toHaveProperty("response")
  })

  it("T9 — storeId por header passa por membership", async () => {
    sessionAtiva(
      makeSession({
        role: "GERENTE",
        storeAccess: "restricted",
        allowedStoreIds: ["loja-a"],
      }),
    )
    await expect(requireMarketplaceApi(req({ headerStoreId: "loja-a" }))).resolves.toEqual({
      ok: true,
      storeId: "loja-a",
    })
    const denied = await deny(await requireMarketplaceApi(req({ headerStoreId: "loja-b" })))
    expect(denied.status).toBe(403)
  })

  it("T10 — storeId por query storeId e lojaId passa por membership", async () => {
    sessionAtiva(
      makeSession({
        role: "ADMIN",
        storeAccess: "restricted",
        allowedStoreIds: ["loja-a"],
      }),
    )
    await expect(requireMarketplaceApi(req({ query: "?storeId=loja-a" }))).resolves.toEqual({
      ok: true,
      storeId: "loja-a",
    })
    await expect(requireMarketplaceApi(req({ query: "?lojaId=loja-a" }))).resolves.toEqual({
      ok: true,
      storeId: "loja-a",
    })
    const denied = await deny(await requireMarketplaceApi(req({ query: "?storeId=loja-b" })))
    expect(denied).toEqual({ status: 403, error: "Sem permissão para esta unidade" })
  })
})

describe("rotas HTTP Marketplace — 10/10 passam pelo gate", () => {
  it("todo handler exportado chama requireMarketplaceApi; zero bypass", () => {
    const root = join(process.cwd(), "app/api/marketplace")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name === "route.ts") files.push(p)
      }
    }
    walk(root)

    let handlers = 0
    let gateCalls = 0
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      expect(src, file).toContain('from "@/lib/marketplace/api-gate"')
      const exported = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) ?? []
      const calls = src.match(/requireMarketplaceApi\(/g) ?? []
      handlers += exported.length
      gateCalls += calls.length
      expect(calls.length, file).toBe(exported.length)
    }

    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(handlers).toBe(10)
    expect(gateCalls).toBe(10)
  })
})

describe("service layer store scope (fail-closed, estático)", () => {
  it("C — connection lookup/update/delete escopados por id + storeId", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/marketplace/services/marketplace-connections-service.ts"),
      "utf8",
    )
    expect(src).toContain("where: { id: input.id, storeId: input.storeId }")
    expect(src).toContain("deleteMany({ where: { id, storeId } })")
  })

  it("D — export recusa productIds fora da loja", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/marketplace/services/marketplace-products-service.ts"),
      "utf8",
    )
    expect(src).toContain("where: { storeId: input.storeId, id: { in: ids } }")
    expect(src).toContain("Um ou mais produtos não pertencem a esta unidade.")
    expect(src).toContain("where: { id: input.connectionId, storeId: input.storeId }")
  })
})
