/**
 * GOAL 016 — calendário civil da agenda (sem cálculo fiscal).
 */
import { describe, expect, it } from "vitest"
import { estaVencido } from "@/lib/contador/status/vencido"
import { estaVencendo, resolverDiaVencimento, statusEfetivoGuia, ultimoDiaDoMes } from "./vencimento"

describe("resolverDiaVencimento", () => {
  it("31 em abril → 30", () => {
    expect(resolverDiaVencimento(2026, 4, 31)).toBe("2026-04-30")
  })
  it("31 em fevereiro não-bissexto → 28", () => {
    expect(resolverDiaVencimento(2025, 2, 31)).toBe("2025-02-28")
  })
  it("31 em fevereiro bissexto → 29", () => {
    expect(resolverDiaVencimento(2024, 2, 31)).toBe("2024-02-29")
  })
  it("último dia real (30, 31) permanece", () => {
    expect(resolverDiaVencimento(2026, 4, 30)).toBe("2026-04-30")
    expect(resolverDiaVencimento(2026, 1, 31)).toBe("2026-01-31")
    expect(resolverDiaVencimento(2026, 6, 20)).toBe("2026-06-20")
  })
  it("28/29/30/31 cobertos contra o mês", () => {
    expect(ultimoDiaDoMes(2026, 2)).toBe(28)
    expect(ultimoDiaDoMes(2024, 2)).toBe(29)
    expect(ultimoDiaDoMes(2026, 4)).toBe(30)
    expect(ultimoDiaDoMes(2026, 5)).toBe(31)
  })
})

describe("estaVencendo / vencido derivado", () => {
  const agora = new Date("2026-07-16T12:00:00.000Z") // 09:00 BRT → 16/07

  it("hoje não está vencido; vence hoje → vencendo", () => {
    const item = { status: "PENDENTE", vencimento: new Date("2026-07-16T00:00:00.000Z") }
    expect(estaVencido(item, agora)).toBe(false)
    expect(estaVencendo(item, agora)).toBe(true)
  })

  it("vence em 7 dias → vencendo; em 8 → nem vencendo nem vencido", () => {
    const d7 = { status: "PENDENTE", vencimento: new Date("2026-07-23T00:00:00.000Z") }
    const d8 = { status: "PENDENTE", vencimento: new Date("2026-07-24T00:00:00.000Z") }
    expect(estaVencendo(d7, agora)).toBe(true)
    expect(estaVencendo(d8, agora)).toBe(false)
    expect(estaVencido(d8, agora)).toBe(false)
  })

  it("venceu ontem e não resolvido → vencido, não vencendo", () => {
    const item = { status: "PENDENTE", vencimento: new Date("2026-07-15T00:00:00.000Z") }
    expect(estaVencido(item, agora)).toBe(true)
    expect(estaVencendo(item, agora)).toBe(false)
  })

  it("RESOLVIDO / pago nunca vencido nem vencendo", () => {
    const res = { status: "RESOLVIDO", vencimento: new Date("2026-07-10T00:00:00.000Z") }
    expect(estaVencido(res, agora)).toBe(false)
    expect(estaVencendo(res, agora)).toBe(false)
    const paga = {
      status: statusEfetivoGuia(new Date("2026-07-01Z")),
      vencimento: new Date("2026-07-10T00:00:00.000Z"),
      pagaEm: new Date("2026-07-01Z"),
    }
    expect(estaVencido(paga, agora)).toBe(false)
    expect(estaVencendo(paga, agora)).toBe(false)
  })
})
