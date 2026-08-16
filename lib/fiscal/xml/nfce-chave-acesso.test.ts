/**
 * BL-FISCAL-004 — Chave de acesso NFC-e (PURA/determinística).
 */
import { describe, it, expect } from "vitest"
import {
  aammDe,
  cNfDeterministico,
  calcularDigitoVerificadorChave,
  codigoUf,
  formatDhEmi,
  montarChaveAcesso,
} from "./nfce-chave-acesso"

describe("calcularDigitoVerificadorChave (mod-11, pesos 2..9)", () => {
  it("casos pequenos conhecidos", () => {
    expect(calcularDigitoVerificadorChave("0")).toBe("0") // soma 0 → resto 0 → DV 0
    expect(calcularDigitoVerificadorChave("1")).toBe("9") // 1×2=2 → 11-2=9
    expect(calcularDigitoVerificadorChave("12")).toBe("4") // 2×2 + 1×3 = 7 → 11-7=4
  })
})

describe("montarChaveAcesso", () => {
  const base = {
    cUF: "35",
    aamm: "2606",
    cnpj: "11222333000181",
    modelo: "65",
    serie: 1,
    numero: 123,
    tpEmis: 1,
    cNF: "00000001",
  }

  it("produz 44 dígitos e DV consistente com os 43 primeiros", () => {
    const chave = montarChaveAcesso(base)
    expect(chave).toHaveLength(44)
    expect(/^\d{44}$/.test(chave)).toBe(true)
    const base43 = chave.slice(0, 43)
    expect(chave.slice(-1)).toBe(calcularDigitoVerificadorChave(base43))
  })

  it("os 43 primeiros refletem os componentes (preenchidos com zeros à esquerda)", () => {
    const chave = montarChaveAcesso(base)
    expect(chave.slice(0, 43)).toBe("3526061122233300018165001000000123100000001")
  })

  it("tpEmis entra na composição e muda o cDV quando 1 → 9", () => {
    const normal = montarChaveAcesso(base)
    const offline = montarChaveAcesso({ ...base, tpEmis: 9 })
    expect(normal).toHaveLength(44)
    expect(offline).toHaveLength(44)
    expect(normal).not.toBe(offline)
    expect(normal[34]).toBe("1")
    expect(offline[34]).toBe("9")
    expect(offline.slice(-1)).toBe(calcularDigitoVerificadorChave(offline.slice(0, 43)))
    expect(offline.slice(-1)).not.toBe(normal.slice(-1))
  })

  it("é determinística (mesma entrada → mesma chave)", () => {
    expect(montarChaveAcesso(base)).toBe(montarChaveAcesso(base))
  })
})

describe("codigoUf", () => {
  it("mapeia UFs conhecidas e rejeita inválida", () => {
    expect(codigoUf("SP")).toBe("35")
    expect(codigoUf("rj")).toBe("33")
    expect(codigoUf("DF")).toBe("53")
    expect(codigoUf("ZZ")).toBeNull()
    expect(codigoUf("")).toBeNull()
  })
})

describe("cNfDeterministico", () => {
  it("8 dígitos, determinístico e diferente do número da nota", () => {
    const a = cNfDeterministico("venda-1:1:123", 123)
    const b = cNfDeterministico("venda-1:1:123", 123)
    expect(a).toBe(b)
    expect(/^\d{8}$/.test(a)).toBe(true)
    expect(Number(a)).not.toBe(123)
  })
})

describe("formatDhEmi / aammDe", () => {
  it("formata em -03:00 (Brasília) de forma estável", () => {
    // 2026-06-18T12:00:00Z → 09:00:00 -03:00
    expect(formatDhEmi("2026-06-18T12:00:00.000Z")).toBe("2026-06-18T09:00:00-03:00")
    expect(aammDe("2026-06-18T12:00:00.000Z")).toBe("2606")
  })
})
