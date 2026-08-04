import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ============================================================================
// GOAL 003D-lite — identidade server-side.
// ----------------------------------------------------------------------------
// Prova que a identidade vem da sessão + confirmação no servidor, que nenhum
// papel administrativo é concedido aqui, e que o entitlement comercial está
// explicitamente marcado como NÃO verificado (contenção temporária).
// ============================================================================

const h = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<unknown> => null),
  findUnique: vi.fn(async (): Promise<unknown> => null),
}))

vi.mock("@/auth", () => ({ auth: h.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { adminUser: { findUnique: h.findUnique } } }))

import {
  ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO,
  getSessionEntitlement,
} from "@/lib/auth/session-entitlement"

function sessao(role: string, id = "user-1") {
  return { user: { id, role } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue(null)
  h.findUnique.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("identidade", () => {
  it("sem sessão: recusado e sem consultar o banco", async () => {
    const r = await getSessionEntitlement()

    expect(r).toEqual({ ok: false, reason: "no_session" })
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it("sessão sem id de utilizador: recusado", async () => {
    h.auth.mockResolvedValue({ user: {} })

    expect(await getSessionEntitlement()).toEqual({ ok: false, reason: "no_session" })
  })

  it("utilizador inexistente: recusado", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue(null)

    expect(await getSessionEntitlement()).toEqual({ ok: false, reason: "user_not_found" })
  })

  it("utilizador desativado: recusado mesmo com JWT ainda válido", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue({ active: false, planName: "OURO", role: "CAIXA" })

    expect(await getSessionEntitlement()).toEqual({ ok: false, reason: "user_inactive" })
  })

  it("consulta o utilizador da sessão — não outro qualquer", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA", "user-42"))
    h.findUnique.mockResolvedValue({ active: true, planName: null, role: "CAIXA" })

    await getSessionEntitlement()

    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-42" } }),
    )
  })
})

describe("funcionários entram sem selo e sem ganhar privilégio", () => {
  it.each(["CAIXA", "VENDEDOR", "TECNICO", "GERENTE", "OPERADOR"])(
    "%s de empresa ativa é aceite",
    async (role) => {
      h.auth.mockResolvedValue(sessao(role))
      h.findUnique.mockResolvedValue({ active: true, planName: "PRATA", role })

      const r = await getSessionEntitlement()

      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.role).toBe(role)
      expect(r.source).toBe("session")
    },
  )

  it("o papel devolvido é o da sessão — nunca promovido a ADMIN", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue({ active: true, planName: "OURO", role: "CAIXA" })

    const r = await getSessionEntitlement()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.role).toBe("CAIXA")
    expect(r.role).not.toBe("ADMIN")
    expect(r.role).not.toBe("SUPER_ADMIN")
  })

  it("não devolve lojas nem permissões — autorização fica nos gates existentes", async () => {
    h.auth.mockResolvedValue(sessao("CAIXA"))
    h.findUnique.mockResolvedValue({ active: true, planName: "OURO", role: "CAIXA" })

    const r = (await getSessionEntitlement()) as Record<string, unknown>

    for (const chave of ["allowedStoreIds", "storeAccess", "permissions", "lojaId"]) {
      expect(r[chave]).toBeUndefined()
    }
  })
})

describe("entitlement comercial explicitamente não verificado (contenção)", () => {
  it("usa o marcador documentado, não uma data comercial real", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue({ active: true, planName: "DIAMANTE", role: "ADMIN" })

    const r = await getSessionEntitlement()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.vencimento).toBe(ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO)
    expect(r.status).toBe("ativa")
  })

  it("ADMIN e funcionário recebem o MESMO tratamento de entrada", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue({ active: true, planName: "OURO", role: "ADMIN" })
    const admin = await getSessionEntitlement()

    h.auth.mockResolvedValue(sessao("CAIXA", "user-2"))
    h.findUnique.mockResolvedValue({ active: true, planName: "OURO", role: "CAIXA" })
    const caixa = await getSessionEntitlement()

    expect(admin.ok).toBe(true)
    expect(caixa.ok).toBe(true)
    if (!admin.ok || !caixa.ok) return
    // Sem isto, um funcionário contornaria uma assinatura bloqueada que barra o ADMIN.
    expect(caixa.status).toBe(admin.status)
    expect(caixa.vencimento).toBe(admin.vencimento)
  })

  it("plano vem do registo real quando existe; vazio quando desconhecido", async () => {
    h.auth.mockResolvedValue(sessao("ADMIN"))
    h.findUnique.mockResolvedValue({ active: true, planName: null, role: "ADMIN" })

    const r = await getSessionEntitlement()

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plano).toBe("")
  })
})
