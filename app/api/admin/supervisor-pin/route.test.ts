/**
 * GET/POST /api/admin/supervisor-pin — PIN nunca retornado; rotação só grava pinHash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 20_000 })
import { BLOCKED_LEGACY_SUPERVISOR_PINS } from "@/lib/auth/pin-authorization"
import { hashSupervisorPin } from "@/lib/auth/pin-hash"

const CURRENT = "908172"
const NEXT = "556677"
const BLOCKED = BLOCKED_LEGACY_SUPERVISOR_PINS[0]!
const PEPPER = "pepper-de-teste-supervisor-pin-route-014"

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => null),
  ensureConnected: vi.fn(async (): Promise<void> => undefined),
  findFirst: vi.fn(async (): Promise<unknown> => null),
  update: vi.fn(async (): Promise<unknown> => ({})),
}))

vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: h.findFirst, update: h.update },
  },
  prismaEnsureConnected: h.ensureConnected,
}))

import { GET, POST } from "./route"

function sessionAdmin() {
  return { user: { id: "admin-1", name: "Admin", role: "ADMIN" } }
}

function postReq(body: unknown): Request {
  return new Request("http://local/api/admin/supervisor-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PIN_HASH_PEPPER = PEPPER
  h.auth.mockResolvedValue(sessionAdmin())
  h.update.mockResolvedValue({})
})

afterEach(() => {
  delete process.env.PIN_HASH_PEPPER
})

describe("GET /api/admin/supervisor-pin", () => {
  it("sem sessão → 401 e nunca devolve PIN", async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(CURRENT)
    expect(body.pin).toBeUndefined()
  })

  it("nunca retorna pin/pinHash; isDefault usa o verificador", async () => {
    h.findFirst.mockResolvedValue({
      id: "sup-1",
      name: "Supervisora",
      pin: BLOCKED,
      pinHash: null,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ exists: true, isDefault: true, name: "Supervisora" })
    expect(body.pin).toBeUndefined()
    expect(body.pinHash).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(BLOCKED)
  })

  it("isDefault é false quando o hash não é o legado 1234", async () => {
    const pinHash = await hashSupervisorPin(CURRENT, { PIN_HASH_PEPPER: PEPPER })
    h.findFirst.mockResolvedValue({
      id: "sup-1",
      name: "Supervisora",
      pin: BLOCKED,
      pinHash,
    })
    const body = await (await GET()).json()
    expect(body.isDefault).toBe(false)
    expect(JSON.stringify(body)).not.toContain(CURRENT)
    expect(JSON.stringify(body)).not.toContain(BLOCKED)
  })
})

describe("POST /api/admin/supervisor-pin", () => {
  it("currentPin inválido → 401 e não grava", async () => {
    h.findFirst.mockResolvedValue({
      id: "sup-1",
      pin: CURRENT,
      pinHash: null,
    })
    const res = await POST(postReq({ currentPin: "000000", newPin: NEXT }))
    expect(res.status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })

  it("newPin 1234 permanece proibido", async () => {
    h.findFirst.mockResolvedValue({ id: "sup-1", pin: CURRENT, pinHash: null })
    const res = await POST(postReq({ currentPin: CURRENT, newPin: BLOCKED }))
    expect(res.status).toBe(422)
    expect(h.update).not.toHaveBeenCalled()
    expect(await res.text()).not.toContain(BLOCKED)
  })

  it("rotação grava somente pinHash — nunca o PIN novo em User.pin", async () => {
    h.findFirst.mockResolvedValue({ id: "sup-1", pin: CURRENT, pinHash: null })
    const res = await POST(postReq({ currentPin: CURRENT, newPin: NEXT }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, isDefault: false })
    expect(h.update).toHaveBeenCalledTimes(1)
    const args = (h.update.mock.calls[0] as unknown as [{
      where: { id: string }
      data: { pinHash?: string; pin?: string }
    }])[0]
    expect(args.where.id).toBe("sup-1")
    expect(args.data.pin).toBeUndefined()
    expect(args.data.pinHash?.startsWith("$2")).toBe(true)
    expect(JSON.stringify(args)).not.toContain(NEXT)
    expect(JSON.stringify(args)).not.toContain(CURRENT)
  })

  it("aceita currentPin 1234 legado para permitir a rotação de saída", async () => {
    h.findFirst.mockResolvedValue({ id: "sup-1", pin: BLOCKED, pinHash: null })
    const res = await POST(postReq({ currentPin: BLOCKED, newPin: NEXT }))
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalled()
  })
})
