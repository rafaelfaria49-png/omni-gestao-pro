import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  claimSaleFinalizeLock,
  isSaleFinalizeBusy,
  releaseSaleFinalizeLock,
} from "./sale-finalize-busy"

const REPO_ROOT = resolve(__dirname, "../..")

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

describe("sale-finalize-busy — mutex de finalização", () => {
  it("bloqueia a segunda tentativa enquanto o lock está ativo", () => {
    const lock = { current: false }
    expect(isSaleFinalizeBusy(lock)).toBe(false)
    expect(claimSaleFinalizeLock(lock)).toBe(true)
    expect(isSaleFinalizeBusy(lock)).toBe(true)
    expect(claimSaleFinalizeLock(lock)).toBe(false)
    expect(isSaleFinalizeBusy(lock)).toBe(true)
  })

  it("após sucesso o lock libera e o fluxo normal pode seguir", () => {
    const lock = { current: false }
    expect(claimSaleFinalizeLock(lock)).toBe(true)
    releaseSaleFinalizeLock(lock)
    expect(isSaleFinalizeBusy(lock)).toBe(false)
    expect(claimSaleFinalizeLock(lock)).toBe(true)
  })

  it("após erro o lock libera sem criar uma segunda venda", () => {
    const lock = { current: false }
    expect(claimSaleFinalizeLock(lock)).toBe(true)
    try {
      throw new Error("persist failed")
    } catch {
      releaseSaleFinalizeLock(lock)
    }
    expect(isSaleFinalizeBusy(lock)).toBe(false)
    expect(claimSaleFinalizeLock(lock)).toBe(true)
    expect(claimSaleFinalizeLock(lock)).toBe(false)
  })
})

describe("venda-completa-enterprise — wiring da Promise e do mutex", () => {
  const source = read("components/dashboard/vendas/venda-completa-enterprise.tsx")
  const modal = read("components/dashboard/vendas/payment-modal.tsx")

  it("onConfirm propaga/aguarda a Promise real de handleConfirmPayment", () => {
    expect(source).toContain("onConfirm={handleConfirmPayment}")
    expect(source).not.toMatch(/void\s+handleConfirmPayment/)
    expect(source).not.toMatch(/onConfirm=\{\(payments\)\s*=>\s*\{/)
    expect(modal).toMatch(/const success = await onConfirm\?/)
  })

  it("F1, botão Finalizar e confirmação compartilham o lock de processamento", () => {
    expect(source).toContain("claimSaleFinalizeLock(isProcessingRef)")
    expect(source).toContain("releaseSaleFinalizeLock(isProcessingRef)")
    expect(source).toContain("isSaleFinalizeBusy(isProcessingRef)")
    expect(source).toMatch(/case "F1":[\s\S]*isSaleFinalizeBusy\(isProcessingRef\)[\s\S]*handleClickFinalize/)
    expect(source).toMatch(
      /function handleClickFinalize\(\) \{[\s\S]*isSaleFinalizeBusy\(isProcessingRef\)[\s\S]*setIsPaymentOpen\(true\)/,
    )
    expect(source).toMatch(
      /async function handleConfirmPayment\([\s\S]*claimSaleFinalizeLock\(isProcessingRef\)[\s\S]*await finalizeSaleTransaction/,
    )
    expect(source).toMatch(/disabled=\{\!canFinalize \|\| isProcessing\}/)
  })

  it("erro de persistência devolve false e libera o processamento no finally", () => {
    expect(source).toMatch(/if \(!result\.ok\) \{[\s\S]*return false/)
    expect(source).toMatch(/\} finally \{[\s\S]*releaseSaleFinalizeLock\(isProcessingRef\)[\s\S]*setIsProcessing\(false\)/)
    expect(source).toMatch(/return true/)
  })
})
