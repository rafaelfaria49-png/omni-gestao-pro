/**
 * PDV-ACESSORIOS-SELECAO-PERSISTENCIA-SERVER-004B
 *
 * Confirma que a Venda em Espera (F7) preserva `accessorySelection` e não
 * inventa persistência de `cartLineKey` além do que o carrinho já grava — o
 * mecanismo real é round-trip JSON via `localStorage` (ver auditoria § fluxo
 * offline). `vitest.config.ts` roda em ambiente `node` (sem jsdom); este teste
 * usa um shim mínimo de `window`/`localStorage` local ao arquivo (sem nova
 * dependência) para exercitar o código real de `pdv-hold.ts`, não uma cópia dele.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getHeldSales, nextHoldLabel, removeHeldSale, saveHeldSale, type HeldSale } from "./pdv-hold"

function installLocalStorageShim() {
  const store = new Map<string, string>()
  const fakeLocalStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = fakeLocalStorage
}

function uninstallLocalStorageShim() {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { localStorage?: unknown }).localStorage
}

const heldSaleWithAccessory: HeldSale = {
  id: "hold-1",
  label: "Venda 1",
  savedAt: new Date().toISOString(),
  pdvType: "classic",
  items: [
    {
      lineId: "line-1",
      inventoryId: "prod-1",
      name: "Capinha — Samsung Galaxy A06 — Preto",
      price: 25,
      quantity: 1,
      accessorySelection: { version: 1, deviceModelKey: "samsung_galaxy_a06", colorKey: "preto", colorLabel: "Preto" },
      cartLineKey: '["prod-1","samsung_galaxy_a06","preto",""]',
    },
    { lineId: "line-2", inventoryId: "prod-2", name: "Produto comum", price: 10, quantity: 2 },
  ],
}

describe("pdv-hold — venda em espera preserva accessorySelection", () => {
  beforeEach(installLocalStorageShim)
  afterEach(uninstallLocalStorageShim)

  it("saveHeldSale + getHeldSales fazem round-trip preservando accessorySelection e cartLineKey do carrinho", () => {
    saveHeldSale("loja-1", "PDV1", heldSaleWithAccessory)
    const [retrieved] = getHeldSales("loja-1", "PDV1")

    expect(retrieved).toEqual(heldSaleWithAccessory)
    expect(retrieved!.items[0]!.accessorySelection).toEqual({
      version: 1,
      deviceModelKey: "samsung_galaxy_a06",
      colorKey: "preto",
      colorLabel: "Preto",
    })
  })

  it("linha sem accessorySelection permanece sem o campo após o round-trip", () => {
    saveHeldSale("loja-1", "PDV1", heldSaleWithAccessory)
    const [retrieved] = getHeldSales("loja-1", "PDV1")
    expect(retrieved!.items[1]!.accessorySelection).toBeUndefined()
  })

  it("removeHeldSale remove só a venda alvo, mantendo a seleção das demais intacta", () => {
    const outra: HeldSale = { ...heldSaleWithAccessory, id: "hold-2", label: "Venda 2" }
    saveHeldSale("loja-1", "PDV1", heldSaleWithAccessory)
    saveHeldSale("loja-1", "PDV1", outra)

    removeHeldSale("loja-1", "PDV1", "hold-1")

    const remaining = getHeldSales("loja-1", "PDV1")
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe("hold-2")
    expect(remaining[0]!.items[0]!.accessorySelection).toEqual(heldSaleWithAccessory.items[0]!.accessorySelection)
  })

  it("mantém múltiplos holds isolados por loja e terminal e filtra por tipo de PDV", () => {
    const supermercado: HeldSale = { ...heldSaleWithAccessory, id: "hold-super", pdvType: "supermercado" }
    saveHeldSale("loja-1", "PDV1", heldSaleWithAccessory)
    saveHeldSale("loja-1", "PDV1", supermercado)
    saveHeldSale("loja-2", "PDV1", { ...heldSaleWithAccessory, id: "hold-other-store" })
    saveHeldSale("loja-1", "PDV2", { ...heldSaleWithAccessory, id: "hold-other-terminal" })

    expect(getHeldSales("loja-1", "PDV1")).toHaveLength(2)
    expect(getHeldSales("loja-1", "PDV1", "classic").map((sale) => sale.id)).toEqual(["hold-1"])
    expect(getHeldSales("loja-1", "PDV1", "supermercado").map((sale) => sale.id)).toEqual(["hold-super"])
    expect(getHeldSales("loja-2", "PDV1").map((sale) => sale.id)).toEqual(["hold-other-store"])
    expect(getHeldSales("loja-1", "PDV2").map((sale) => sale.id)).toEqual(["hold-other-terminal"])
  })

  it("gera rótulo livre sem colidir com holds existentes", () => {
    expect(nextHoldLabel([
      { ...heldSaleWithAccessory, label: "Venda 1" },
      { ...heldSaleWithAccessory, id: "hold-2", label: "Venda 3" },
    ])).toBe("Venda 4")
  })

  it("preserva metadados de serviço e linha no round-trip", () => {
    const sale: HeldSale = {
      ...heldSaleWithAccessory,
      id: "hold-service",
      pdvType: "assistencia",
      items: [{
        ...heldSaleWithAccessory.items[0]!,
        itemType: "servico",
        serviceId: "service-1",
        serviceCategory: "Telas",
        warrantyDays: 90,
        serviceTerms: "Garantia 90 dias",
        complementos: ["Película"],
        lineDetail: "IMEI informado",
      }],
    }
    saveHeldSale("loja-1", "PDV1", sale)
    expect(getHeldSales("loja-1", "PDV1", "assistencia")[0]).toEqual(sale)
  })

  it("sem window (SSR), getHeldSales retorna vazio sem lançar", () => {
    uninstallLocalStorageShim()
    expect(getHeldSales("loja-1", "PDV1")).toEqual([])
  })
})
