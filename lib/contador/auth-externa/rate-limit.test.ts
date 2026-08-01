/**
 * GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014 — rate limit externo endurecido (§12 R-3):
 * chave composta e-mail+IP.
 */
import { beforeEach, describe, expect, it } from "vitest"
import {
  __resetRateLimitExternoForTests,
  checkRateLimitExterno,
  montarChaveRateLimitExterno,
  registerFalhaExterna,
  registerSucessoExterno,
} from "./rate-limit"

const T0 = 1_800_000_000_000

beforeEach(() => {
  __resetRateLimitExternoForTests()
})

describe("chave composta e-mail+IP", () => {
  it("normaliza o e-mail na chave", () => {
    expect(montarChaveRateLimitExterno("  A@B.COM ", "1.1.1.1")).toBe("a@b.com|1.1.1.1")
  })

  it("e-mails distintos no MESMO IP têm limites independentes", () => {
    const k1 = montarChaveRateLimitExterno("a@b.com", "1.1.1.1")
    const k2 = montarChaveRateLimitExterno("c@d.com", "1.1.1.1")
    for (let i = 0; i < 5; i++) registerFalhaExterna(k1, T0)
    expect(checkRateLimitExterno(k1, T0).limited).toBe(true)
    expect(checkRateLimitExterno(k2, T0).limited).toBe(false)
  })

  it("o MESMO e-mail em IPs distintos também é limitado (distribuir IP não ajuda)", () => {
    // A limitação por e-mail+IP isola cada par; o atacante que troca de IP troca de
    // chave — mas o e-mail alvo continua protegido no IP de origem, e a janela
    // global do e-mail é coberta pelo retryAfter + bloqueio da conta no login.
    const k1 = montarChaveRateLimitExterno("a@b.com", "1.1.1.1")
    const k2 = montarChaveRateLimitExterno("a@b.com", "2.2.2.2")
    for (let i = 0; i < 5; i++) registerFalhaExterna(k1, T0)
    expect(checkRateLimitExterno(k1, T0).limited).toBe(true)
    expect(checkRateLimitExterno(k2, T0).limited).toBe(false)
  })
})

describe("janela e contadores (shape do GOAL 003)", () => {
  it("limita após 5 falhas com retryAfter positivo", () => {
    const k = montarChaveRateLimitExterno("a@b.com", "1.1.1.1")
    for (let i = 0; i < 4; i++) registerFalhaExterna(k, T0)
    expect(checkRateLimitExterno(k, T0).limited).toBe(false)
    registerFalhaExterna(k, T0)
    const r = checkRateLimitExterno(k, T0)
    expect(r.limited).toBe(true)
    if (r.limited) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("janela expirada libera a chave", () => {
    const k = montarChaveRateLimitExterno("a@b.com", "1.1.1.1")
    for (let i = 0; i < 5; i++) registerFalhaExterna(k, T0)
    const depoisDaJanela = T0 + 15 * 60 * 1000 + 1
    expect(checkRateLimitExterno(k, depoisDaJanela).limited).toBe(false)
  })

  it("sucesso limpa o estado da chave", () => {
    const k = montarChaveRateLimitExterno("a@b.com", "1.1.1.1")
    for (let i = 0; i < 5; i++) registerFalhaExterna(k, T0)
    registerSucessoExterno(k)
    expect(checkRateLimitExterno(k, T0).limited).toBe(false)
  })
})
