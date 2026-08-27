import { test, expect } from "@playwright/test"
import { dismissFirstAccessWizardIfPresent, ensureCaixaAberto } from "../helpers"

test.describe("PDV — Fase 2 (caixa + histórico)", () => {
  test("abre caixa, confirma aberto e navega para histórico de vendas", async ({ page }) => {
    await page.goto("/dashboard/vendas")
    await dismissFirstAccessWizardIfPresent(page)

    await expect(
      page.getByPlaceholder(/Código \/ Bipe|Buscar produto|Digite produto|código/i),
    ).toBeVisible({ timeout: 45_000 })

    await ensureCaixaAberto(page)
    await expect(page.getByText("Caixa Aberto", { exact: false }).first()).toBeVisible({ timeout: 15_000 })

    await page.goto("/dashboard/historico-vendas")
    await dismissFirstAccessWizardIfPresent(page)

    await expect(page.getByRole("heading", { name: /Histórico de Vendas/i })).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByPlaceholder(/Buscar por cupom, cliente, produto\/SKU ou ID da venda/i),
    ).toBeVisible({ timeout: 15_000 })
  })
})
