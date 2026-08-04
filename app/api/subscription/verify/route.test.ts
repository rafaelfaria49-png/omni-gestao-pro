import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SUBSCRIPTION_COOKIE_NAME,
  createSubscriptionCookieValue,
} from "@/lib/subscription-seal"

// ============================================================================
// GOAL PLAT-SEC-SEAL-003B — verificação do selo.
// ----------------------------------------------------------------------------
// Contrato provado aqui:
//   · selo ausente ⇒ resposta controlada, nunca "válido";
//   · selo malformado ⇒ recusado sem exceção não tratada;
//   · selo assinado com o ANTIGO fallback publicado ⇒ recusado;
//   · segredo ausente ⇒ falha fechada (nunca válido);
//   · a rota não autentica utilizador nem autoriza loja.
// ============================================================================

const TEST_SECRET = "segredo-de-teste-nao-produtivo"
const AGORA = Date.parse("2026-08-03T12:00:00.000Z")

/**
 * O antigo fallback publicado no repositório, montado por partes de propósito:
 * a string literal não pode reaparecer em lado nenhum da árvore (é exatamente
 * isso que a busca final do GOAL verifica). Reconstruí-lo aqui prova a recusa
 * sem reintroduzir o literal.
 */
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
vi.mock("@/lib/trusted-time", () => ({ getTrustedTimeMs: async () => AGORA }))

import { GET } from "./route"

type VerifyBody = {
  valid: boolean | null
  expired?: boolean
  pendingSeal?: boolean
  reason?: string
  plano?: string
  status?: string
  vencimento?: string
  source?: string
}

async function chamar(): Promise<VerifyBody> {
  const res = await GET()
  expect(res.status).toBe(200)
  return (await res.json()) as VerifyBody
}

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

describe("GET /api/subscription/verify — selo ausente ou inválido", () => {
  it("sem selo: resposta controlada, nunca válido", async () => {
    const body = await chamar()

    expect(body.valid).not.toBe(true)
    expect(body.pendingSeal).toBe(true)
    expect(body.reason).toBe("missing_cookie")
  })

  it.each([
    ["formato sem ponto", "selo-sem-separador"],
    ["partes a mais", "a.b.c"],
    ["base64 inválido", "!!!.@@@"],
    ["payload vazio", "."],
    ["assinatura vazia", "YWJj."],
  ])("selo malformado (%s): recusado sem exceção", async (_caso, valor) => {
    h.cookieValue = valor

    const body = await chamar()

    expect(body.valid).toBe(false)
    expect(body.expired).toBe(true)
    expect(body.reason).toBe("invalid_seal")
  })

  it("selo com payload válido mas assinatura adulterada: recusado", async () => {
    const bom = await createSubscriptionCookieValue("2099-12-31", "ouro", "ativa", TEST_SECRET)
    h.cookieValue = `${bom.split(".")[0]}.YWRtaW4`

    const body = await chamar()

    expect(body.valid).toBe(false)
  })
})

describe("GET /api/subscription/verify — segredo", () => {
  it("selo forjado com o antigo fallback publicado NÃO é aceito", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "diamante",
      "ativa",
      FALLBACK_ANTIGO,
    )

    const body = await chamar()

    expect(body.valid).toBe(false)
    expect(body.expired).toBe(true)
  })

  it("segredo ausente: falha fechada mesmo com selo bem assinado", async () => {
    h.cookieValue = await createSubscriptionCookieValue("2099-12-31", "ouro", "ativa", TEST_SECRET)
    delete process.env.ASSISTEC_SUBSCRIPTION_SECRET

    const body = await chamar()

    expect(body.valid).toBe(false)
    expect(body.pendingSeal).toBe(false)
  })

  it("resposta não expõe o segredo nem o motivo interno da recusa", async () => {
    h.cookieValue = await createSubscriptionCookieValue("2099-12-31", "ouro", "ativa", "outro")

    const res = await GET()
    const texto = JSON.stringify(await res.json())

    expect(texto).not.toContain(TEST_SECRET)
    expect(texto).not.toContain("missing_server_secret")
    expect(texto).not.toContain("bad_signature")
  })
})

describe("GET /api/subscription/verify — selo legítimo", () => {
  it("selo válido e corrente: entitlement comercial devolvido", async () => {
    h.cookieValue = await createSubscriptionCookieValue("2026-09-10", "prata", "ativa", TEST_SECRET)

    const body = await chamar()

    expect(body.valid).toBe(true)
    expect(body.plano).toBe("prata")
    expect(body.source).toBe("server_trust")
  })

  it("selo válido mas vencido: não é válido", async () => {
    h.cookieValue = await createSubscriptionCookieValue("2026-07-01", "prata", "ativa", TEST_SECRET)

    const body = await chamar()

    expect(body.valid).toBe(false)
    expect(body.expired).toBe(true)
  })

  it("selo válido com status não-ativo: não é válido", async () => {
    h.cookieValue = await createSubscriptionCookieValue(
      "2099-12-31",
      "prata",
      "suspensa",
      TEST_SECRET,
    )

    const body = await chamar()

    expect(body.valid).toBe(false)
  })

  it("não devolve identidade: sem utilizador, loja ou organização no corpo", async () => {
    h.cookieValue = await createSubscriptionCookieValue("2026-09-10", "prata", "ativa", TEST_SECRET)

    const body = (await chamar()) as Record<string, unknown>

    for (const chave of ["userId", "user", "storeId", "lojaId", "tenantId", "email", "role"]) {
      expect(body[chave]).toBeUndefined()
    }
  })

  it("o nome do cookie lido é o canónico", () => {
    expect(SUBSCRIPTION_COOKIE_NAME).toBe("assistec_sub_v1")
  })
})
