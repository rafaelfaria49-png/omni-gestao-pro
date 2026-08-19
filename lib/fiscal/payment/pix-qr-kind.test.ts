import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  PIX_QR_KINDS,
  PIX_QR_KIND_OPCOES_OPERADOR,
  PIX_QR_KIND_TO_TPAG,
  isPixQrKind,
  tPagFromPixQrKind,
} from "./pix-qr-kind"

describe("pixQrKind · catálogo oficial IT 2024.002 v1.11", () => {
  it("mapeia somente os três códigos oficiais de PIX", () => {
    expect(PIX_QR_KINDS).toEqual(["dinamico", "estatico", "automatico"])
    expect(tPagFromPixQrKind("dinamico")).toBe("17")
    expect(tPagFromPixQrKind("estatico")).toBe("20")
    expect(tPagFromPixQrKind("automatico")).toBe("23")
    expect(PIX_QR_KIND_TO_TPAG.dinamico).toBe("17")
    expect(PIX_QR_KIND_TO_TPAG.estatico).toBe("20")
    expect(PIX_QR_KIND_TO_TPAG.automatico).toBe("23")
  })

  it("rejeita valor ausente, vazio e desconhecido — sem default", () => {
    expect(isPixQrKind(undefined)).toBe(false)
    expect(isPixQrKind(null)).toBe(false)
    expect(isPixQrKind("")).toBe(false)
    expect(isPixQrKind("17")).toBe(false)
    expect(isPixQrKind("pix")).toBe(false)
    expect(isPixQrKind("dinamico ")).toBe(false)
    expect(isPixQrKind("DINAMICO")).toBe(false)
  })

  it("rótulos do operador cobrem só os subtipos observáveis no caixa (17/20), sem 23", () => {
    expect(PIX_QR_KIND_OPCOES_OPERADOR.map((o) => o.kind).sort()).toEqual(["dinamico", "estatico"])
    expect(PIX_QR_KIND_OPCOES_OPERADOR.some((o) => o.kind === "automatico")).toBe(false)
    for (const opcao of PIX_QR_KIND_OPCOES_OPERADOR) {
      expect(opcao.titulo).not.toMatch(/^\s*(17|20|23)\s*$/)
      expect(opcao.titulo.length).toBeGreaterThan(8)
      expect(opcao.descricao.length).toBeGreaterThan(20)
    }
  })

  it("módulo não consulta Caixa/Financeiro/PDV vivo/SEFAZ e não inventa tPag 01/99", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/fiscal/payment/pix-qr-kind.ts"), "utf8")
    expect(src).not.toMatch(/from ["']@\/lib\/prisma/)
    expect(src).not.toMatch(/from ["']@\/lib\/caixa/)
    expect(src).not.toMatch(/from ["']@\/lib\/financeiro/)
    expect(src).not.toMatch(/from ["'].*payment-modal/)
    expect(src).not.toMatch(/from ["'].*sefaz/i)
    expect(src).not.toMatch(/tPag:\s*"01"|tPag:\s*"99"/)
  })
})
