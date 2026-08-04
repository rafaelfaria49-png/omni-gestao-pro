import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSubscriptionCookieValue } from "@/lib/subscription-seal"

// ============================================================================
// GOAL PLAT-SEC-SEAL-003B — resolução do segredo e leitura do selo.
// ----------------------------------------------------------------------------
// `getVerifiedSubscriptionFromCookies` é o gate legado reutilizado por dezenas de
// rotas. Prova-se aqui que ele falha fechado sem segredo e que não aceita selo
// assinado pelo antigo fallback publicado.
// ============================================================================

const TEST_SECRET = "segredo-de-teste-nao-produtivo"

/** Antigo fallback publicado, montado por partes — o literal não pode existir na árvore. */
const FALLBACK_ANTIGO = ["assistec", "dev", "secret", "change", "in", "production"].join("-")

const h = vi.hoisted(() => ({ cookieValue: undefined as string | undefined }))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "assistec_sub_v1" && h.cookieValue !== undefined
        ? { value: h.cookieValue }
        : undefined,
  }),
}))

import { getSubscriptionSecret, getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"

let secretOriginal: string | undefined

beforeEach(() => {
  secretOriginal = process.env.ASSISTEC_SUBSCRIPTION_SECRET
  process.env.ASSISTEC_SUBSCRIPTION_SECRET = TEST_SECRET
  h.cookieValue = undefined
})

afterEach(() => {
  if (secretOriginal === undefined) delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
  else process.env.ASSISTEC_SUBSCRIPTION_SECRET = secretOriginal
  h.cookieValue = undefined
  vi.clearAllMocks()
})

describe("getSubscriptionSecret", () => {
  it("devolve o valor configurado", () => {
    expect(getSubscriptionSecret()).toBe(TEST_SECRET)
  })

  it("variável ausente devolve string vazia — sem fallback", () => {
    delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
    expect(getSubscriptionSecret()).toBe("")
  })

  it.each(["", "   ", "\t\n"])("valor vazio/branco (%j) conta como ausente", (valor) => {
    process.env.ASSISTEC_SUBSCRIPTION_SECRET = valor
    expect(getSubscriptionSecret()).toBe("")
  })

  it("nunca devolve o antigo fallback publicado", () => {
    delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
    expect(getSubscriptionSecret()).not.toBe(FALLBACK_ANTIGO)
  })

  it("lê o ambiente a cada chamada (não congela no import)", () => {
    process.env.ASSISTEC_SUBSCRIPTION_SECRET = "outro-valor-de-teste"
    expect(getSubscriptionSecret()).toBe("outro-valor-de-teste")
  })
})

describe("getVerifiedSubscriptionFromCookies", () => {
  it("sem cookie: não autorizado", async () => {
    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("selo válido: devolve o entitlement", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2026-09-10",
      "prata",
      "ativa",
      TEST_SECRET,
    )

    const r = await getVerifiedSubscriptionFromCookies()

    expect(r).toEqual({ ok: true, vencimento: "2026-09-10", plano: "prata", status: "ativa" })
  })

  it("segredo ausente: falha fechada mesmo com selo bem assinado", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "ouro",
      "ativa",
      TEST_SECRET,
    )
    delete process.env.ASSISTEC_SUBSCRIPTION_SECRET

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("selo forjado com o antigo fallback publicado: recusado", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "diamante",
      "ativa",
      FALLBACK_ANTIGO,
    )

    expect(await getVerifiedSubscriptionFromCookies()).toEqual({ ok: false })
  })

  it("selo malformado: recusado sem exceção não tratada", async () => {
    h.cookieValue = "!!!.@@@"

    await expect(getVerifiedSubscriptionFromCookies()).resolves.toEqual({ ok: false })
  })
})
