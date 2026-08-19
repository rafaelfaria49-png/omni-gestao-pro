import { describe, expect, it } from "vitest"
import {
  buildLegacySaleFingerprint,
  canonicalizeLegacySaleFacts,
  isLegacySaleFactsComparable,
  LEGACY_SALE_FINGERPRINT_VERSION,
} from "./legacy-sale-fingerprint"

function baseSale() {
  return {
    id: "VDA-2026-0042",
    at: "2026-07-28T13:15:30.000-03:00",
    total: 150,
    customerCpf: "123.456.789-00",
    customerName: "  Maria   da Silva ",
    clienteId: " cliente-1 ",
    sessaoId: " sessao-1 ",
    terminalId: " PDV1 ",
    linkedOsId: " os-42 ",
    lines: [
      {
        inventoryId: "SKU-B",
        name: "Cabo",
        quantity: 1,
        unitPrice: 50,
        lineTotal: 50,
        qtyReturned: 1,
      },
      {
        inventoryId: "SKU-A",
        name: "Capa",
        quantity: 2,
        unitPrice: 50,
        lineTotal: 100,
        cartLineKey: "transporte-local",
        accessorySelection: { version: 1, color: { id: "preto", label: "Preto" } },
      },
    ],
    paymentBreakdown: { pix: 50, cartaoDebito: 100 },
    discountTotal: 10,
    discountReais: 10,
    discountPercent: 6.666666,
    discountAuthorizedByAdminId: " admin-1 ",
    aPrazoConfig: undefined,
  }
}

describe("legacy-sale-fingerprint", () => {
  it("é puro, determinístico, versionado e normaliza ordem/opcionais", () => {
    const sale = baseSale()
    const snapshot = JSON.stringify(sale)
    const reordered = {
      ...sale,
      id: "OUTRO-NUMERO-IGNORADO",
      at: "2026-07-28T16:15:30.000Z",
      customerCpf: "12345678900",
      customerName: "Maria da Silva",
      clienteId: "cliente-1",
      sessaoId: "sessao-1",
      terminalId: "PDV1",
      linkedOsId: "os-42",
      lines: [...sale.lines].reverse().map(({ qtyReturned: _qtyReturned, ...line }) => line),
      paymentBreakdown: {
        dinheiro: 0,
        pix: 50,
        cartaoDebito: 100,
        cartaoCredito: 0,
        carne: 0,
        aPrazo: 0,
        creditoVale: 0,
      },
      syncPending: true,
      syncBlockedCode: "CAIXA_ORIGINAL_FECHADO",
      retroactiveSync: true,
      originalSessionClosed: true,
      syncedAt: "2099-01-01T00:00:00.000Z",
      reason: "metadado-servidor",
      allowClosedOriginalSession: true,
      cashierId: "operador-resolvido-em-outro-servidor",
      operador: "Nome mutável no servidor",
      requestId: "campo-de-transporte",
      idempotencyKey: "chave-de-transporte",
      pixQrKind: "estatico",
      fiscalPaymentHandoff: { version: 1, linhas: [] },
      tPag: "17",
    }

    const first = buildLegacySaleFingerprint(sale)
    const second = buildLegacySaleFingerprint(reordered)

    expect(first).toBe(second)
    expect(first).toMatch(
      new RegExp(`^${LEGACY_SALE_FINGERPRINT_VERSION}:sha256:[a-f0-9]{64}$`),
    )
    expect(buildLegacySaleFingerprint(sale)).toBe(first)
    expect(JSON.stringify(sale)).toBe(snapshot)
  })

  it.each([
    ["data/hora", { at: "2026-07-28T16:15:31.000Z" }],
    ["total", { total: 151 }],
    ["linhas", { lines: [{ inventoryId: "SKU-A", name: "Capa", quantity: 1, unitPrice: 150 }] }],
    ["pagamento", { paymentBreakdown: { dinheiro: 150 } }],
    ["sessão", { sessaoId: "sessao-2" }],
    ["terminal", { terminalId: "PDV2" }],
    ["cliente", { clienteId: "cliente-2" }],
    ["desconto", { discountReais: 11 }],
    ["parcelamento", { paymentBreakdown: { aPrazo: 150 }, aPrazoConfig: { parcelas: 3 } }],
    ["vínculo operacional", { linkedOsId: "os-99" }],
  ])("distingue mudança factual em %s", (_label, change) => {
    expect(buildLegacySaleFingerprint({ ...baseSale(), ...change })).not.toBe(
      buildLegacySaleFingerprint(baseSale()),
    )
  })

  it("saneia acessórios e remove cartLineKey antes de comparar linhas", () => {
    const canonical = canonicalizeLegacySaleFacts(baseSale())
    const serialized = JSON.stringify(canonical)
    expect(serialized).not.toContain("cartLineKey")
    expect(serialized).not.toContain("qtyReturned")
    expect(serialized).toContain("accessorySelection")
  })

  it("trata opcionais de desconto ausentes e explicitamente zerados como equivalentes", () => {
    const absent = {
      ...baseSale(),
      discountTotal: undefined,
      discountReais: undefined,
      discountPercent: undefined,
      discountAuthorizedByAdminId: undefined,
    }
    const explicitZero = {
      ...absent,
      discountTotal: 0,
      discountReais: 0,
      discountPercent: 0,
      discountAuthorizedByAdminId: "admin-ignorado-sem-desconto",
    }
    expect(buildLegacySaleFingerprint(explicitZero)).toBe(buildLegacySaleFingerprint(absent))
  })

  it.each([
    ["data inválida", { at: "não-data" }],
    ["sem linhas", { lines: undefined }],
    ["linha vazia", { lines: [{}] }],
    ["pagamento inválido", { paymentBreakdown: { pix: Number.NaN } }],
    ["pagamento desconhecido", { paymentBreakdown: { cripto: 150 } }],
    ["total inválido", { total: Number.NaN }],
  ])("marca fatos incompletos/inválidos como não comparáveis: %s", (_label, change) => {
    expect(isLegacySaleFactsComparable({ ...baseSale(), ...change })).toBe(false)
  })

  it("aceita fatos completos e acessório complementar inválido descartável", () => {
    const complete = {
      ...baseSale(),
      lines: [
        {
          ...baseSale().lines[0],
          accessorySelection: { corLivre: "legado" },
        },
      ],
    }
    expect(isLegacySaleFactsComparable(complete)).toBe(true)
  })

  it("aceita data e breakdown ausentes porque o contrato os trata como opcionais", () => {
    expect(
      isLegacySaleFactsComparable({
        ...baseSale(),
        at: undefined,
        paymentBreakdown: undefined,
      }),
    ).toBe(true)
  })
})
