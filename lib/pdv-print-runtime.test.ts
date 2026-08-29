import { afterEach, describe, expect, it, vi } from "vitest"
import { buildPdvReceiptEscPos, type PdvReceiptInput } from "./escpos"
import { defaultPdvImpressaoConfig } from "./pdv-impressao-config"
import { printPdvSaleReceipt } from "./pdv-print-runtime"

const receipt: PdvReceiptInput = {
  nomeFantasia: "Loja Teste",
  cnpj: "12.345.678/0001-90",
  enderecoLinha: "Rua Teste, 10",
  numeroVenda: "VDA-0001",
  operador: "Caixa 01",
  itens: [{ name: "Café", quantity: 1, unitPrice: 15, lineTotal: 15 }],
  subtotal: 15,
  taxes: 0,
  discount: 0,
  total: 15,
  pagamentos: [{ label: "Dinheiro", valor: 15 }],
  cashTendered: 20,
  troco: 5,
  dataHora: "29/08/2026 10:00:00",
}

function config(overrides: Partial<ReturnType<typeof defaultPdvImpressaoConfig>> = {}) {
  return { ...defaultPdvImpressaoConfig(), ...overrides }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("PDV thermal print runtime", () => {
  it("inclui dinheiro recebido e troco no ESC/POS real", () => {
    const bytes = buildPdvReceiptEscPos(receipt)
    const text = Buffer.from(bytes).toString("latin1")

    expect(text).toContain("Dinheiro recebido")
    expect(text).toContain("Troco")
    expect(text).toContain("VDA-0001")
  })

  it("envia diretamente para a impressora configurada e respeita vias", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await printPdvSaleReceipt({
      config: config({ impressoraHost: "192.168.0.50", impressoraPorta: 9100, viasCupom: 2 }),
      input: receipt,
      allowBrowserFallback: false,
    })

    expect(result).toEqual({ ok: true, via: "proxy" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "")) as {
      host?: string
      port?: number
    }
    expect(firstBody.host).toBe("192.168.0.50")
    expect(firstBody.port).toBe(9100)
  })

  it("falha direta não abre preview automaticamente", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: false,
      statusText: "offline",
      json: async () => ({ ok: false, error: "ECONNREFUSED" }),
    }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await printPdvSaleReceipt({
      config: config({ impressoraHost: "192.168.0.50" }),
      input: receipt,
      allowBrowserFallback: false,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain("ECONNREFUSED")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
