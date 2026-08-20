/**
 * GOAL 019 (gate G4) — classificação das rotas do portal legado.
 *
 * O risco real aqui é o redirect capturar demais: `/contador-externo` começa com
 * `/contador`, e um `startsWith` ingênuo criaria um laço de redirect no PRÓPRIO
 * portal v2. Os casos negativos abaixo são o coração do teste.
 */
import { describe, expect, it } from "vitest"
import {
  PORTAL_V2_LOGIN,
  PORTAL_V2_RAIZ,
  destinoLegadoContador,
  isRotaLegadaContador,
  isSegmentoPortalV2,
} from "./rota-legada"

describe("alvo do redirect", () => {
  it("aponta para a rota real do portal v2 encontrada no repositório", () => {
    expect(PORTAL_V2_LOGIN).toBe("/contador-externo/login")
    expect(PORTAL_V2_RAIZ).toBe("/contador-externo")
  })
})

describe("rotas legadas — o que é capturado", () => {
  const LEGADAS = [
    "/contador",
    "/contador/",
    "/contador/relatorios",
    "/contador/competencias/2026-08",
    "/login-contador",
    "/login-contador/",
    "/login-contador/qualquer",
  ]

  for (const rota of LEGADAS) {
    it(`${rota} é legado e redireciona para o portal v2`, () => {
      expect(isRotaLegadaContador(rota)).toBe(true)
      expect(destinoLegadoContador(rota)).toBe(PORTAL_V2_LOGIN)
    })
  }
})

describe("portal v2 — nunca capturado (anti-laço)", () => {
  const V2 = [
    "/contador-externo",
    "/contador-externo/login",
    "/contador-externo/convite",
    "/contador-externo/sessao-expirada",
    "/contador-externo/lojas/loja-1",
    "/contador-externo/lojas/loja-1/competencias/2026-08",
  ]

  for (const rota of V2) {
    it(`${rota} NÃO é legado`, () => {
      expect(isSegmentoPortalV2(rota)).toBe(true)
      expect(isRotaLegadaContador(rota)).toBe(false)
      expect(destinoLegadoContador(rota)).toBeNull()
    })
  }

  it("o destino do redirect não é, ele próprio, uma rota legada", () => {
    expect(isRotaLegadaContador(PORTAL_V2_LOGIN)).toBe(false)
  })
})

describe("rotas vizinhas — intactas", () => {
  const VIZINHAS = [
    "/",
    "/login",
    "/login-admin",
    "/dashboard",
    "/dashboard/contador",
    "/dashboard/financeiro-v2",
    "/api/contador/pacote",
    "/api/contador-externo/lojas",
    "/api/auth/contador",
    "/portal",
    "/contadores",
    "/contador-teste",
    "/meu-plano",
    "/logs-sistema",
  ]

  for (const rota of VIZINHAS) {
    it(`${rota} não é tocada pelo G4`, () => {
      expect(isRotaLegadaContador(rota)).toBe(false)
      expect(destinoLegadoContador(rota)).toBeNull()
    })
  }

  it("`/dashboard/contador` (HUB interno) segue fora do redirect", () => {
    // O HUB interno vive sob /dashboard e é protegido pela sessão NextAuth.
    // Capturá-lo aqui expulsaria o lojista do próprio ERP.
    expect(isRotaLegadaContador("/dashboard/contador")).toBe(false)
  })

  it("prefixo parecido não conta como segmento (`/contadores`, `/contador-teste`)", () => {
    expect(isRotaLegadaContador("/contadores")).toBe(false)
    expect(isRotaLegadaContador("/contador-teste")).toBe(false)
    expect(isRotaLegadaContador("/login-contador-antigo")).toBe(false)
  })
})
