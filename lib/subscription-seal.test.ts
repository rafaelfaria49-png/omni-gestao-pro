import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getSubscriptionSecret } from "@/lib/subscription-seal"

// ============================================================================
// GOAL PLAT-SEC-SEAL-003B (003D-lite: helper movido para cá).
// ----------------------------------------------------------------------------
// A resolução do segredo vive em `lib/subscription-seal.ts` para que ler o
// segredo não arraste `next-auth`. Sem fallback: ausente ⇒ "" ⇒ falha fechada.
// ============================================================================

const TEST_SECRET = "segredo-de-teste-nao-produtivo"

/** Antigo fallback publicado, montado por partes — o literal não pode existir na árvore. */
const FALLBACK_ANTIGO = ["assistec", "dev", "secret", "change", "in", "production"].join("-")

let secretOriginal: string | undefined

beforeEach(() => {
  secretOriginal = process.env.ASSISTEC_SUBSCRIPTION_SECRET
  process.env.ASSISTEC_SUBSCRIPTION_SECRET = TEST_SECRET
})

afterEach(() => {
  if (secretOriginal === undefined) delete process.env.ASSISTEC_SUBSCRIPTION_SECRET
  else process.env.ASSISTEC_SUBSCRIPTION_SECRET = secretOriginal
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
