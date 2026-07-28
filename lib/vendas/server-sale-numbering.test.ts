import { describe, expect, it } from "vitest"
import {
  SALE_NUMBER_MAX,
  SALE_NUMBERING_TIMEZONE,
  SaleNumberingError,
  allocateSaleNumber,
  ensureSerieVenda,
  formatSalePedidoId,
  isSaleNumberingError,
  isValidSaleNumberingCode,
  isValidSaleNumero,
  normalizeSaleNumberingCode,
  resolveSaleNumberingAno,
  resolveStoreSaleNumberingCode,
  saleNumberingAdvisoryKey,
  type SaleNumberingClient,
} from "./server-sale-numbering"

/** Client mínimo o suficiente para os casos que nem chegam a tocar a série. */
function fakeClient(store: { id: string; codigoNumeracaoVenda: string | null } | null): SaleNumberingClient {
  return {
    store: {
      findUnique: async () => store,
    },
    serieVenda: {
      findUnique: async () => {
        throw new Error("A série não deveria ser consultada neste caso.")
      },
      create: async () => {
        throw new Error("A série não deveria ser criada neste caso.")
      },
      update: async () => {
        throw new Error("O contador não deveria ser incrementado neste caso.")
      },
    },
    $executeRaw: async () => {
      throw new Error("O lock consultivo não deveria ser adquirido neste caso.")
    },
  } as unknown as SaleNumberingClient
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    return isSaleNumberingError(e) ? e.code : `NAO_TIPADO:${String(e)}`
  }
  return "SEM_ERRO"
}

describe("normalizeSaleNumberingCode", () => {
  it.each([
    ["L001", "L001"],
    ["  l001  ", "L001"],
    ["ab", "AB"],
    ["abcdefgh", "ABCDEFGH"],
    ["12", "12"],
  ])("aceita e normaliza %s", (raw, esperado) => {
    expect(normalizeSaleNumberingCode(raw)).toBe(esperado)
    expect(isValidSaleNumberingCode(raw)).toBe(true)
  })

  it.each([
    ["a", "curto demais"],
    ["abcdefghi", "longo demais"],
    ["L-01", "caractere proibido"],
    ["L 01", "espaço interno"],
    ["LÇ01", "acento"],
    ["", "vazio"],
    ["   ", "só espaços"],
  ])("rejeita %s (%s)", (raw) => {
    expect(normalizeSaleNumberingCode(raw)).toBeNull()
    expect(isValidSaleNumberingCode(raw)).toBe(false)
  })

  it("rejeita valores que não são string", () => {
    for (const raw of [null, undefined, 1001, {}, ["L001"]]) {
      expect(normalizeSaleNumberingCode(raw)).toBeNull()
    }
  })
})

describe("formatSalePedidoId", () => {
  it("formata com padding de 6 dígitos", () => {
    expect(formatSalePedidoId({ prefixo: "L001", ano: 2026, numero: 1 })).toBe("VDA-L001-2026-000001")
    expect(formatSalePedidoId({ prefixo: "L001", ano: 2026, numero: 42 })).toBe("VDA-L001-2026-000042")
    expect(formatSalePedidoId({ prefixo: "AB", ano: 2026, numero: SALE_NUMBER_MAX })).toBe("VDA-AB-2026-999999")
  })

  it("normaliza o prefixo mas não inventa formato", () => {
    expect(formatSalePedidoId({ prefixo: " l001 ", ano: 2026, numero: 7 })).toBe("VDA-L001-2026-000007")
  })

  it.each([
    [{ prefixo: "L-1", ano: 2026, numero: 1 }, "prefixo inválido"],
    [{ prefixo: "L001", ano: 26, numero: 1 }, "ano fora da faixa"],
    [{ prefixo: "L001", ano: 2026, numero: 0 }, "número abaixo do mínimo"],
    [{ prefixo: "L001", ano: 2026, numero: SALE_NUMBER_MAX + 1 }, "overflow"],
    [{ prefixo: "L001", ano: 2026, numero: 1.5 }, "número fracionário"],
  ])("falha fechada em %o (%s)", (input) => {
    expect(() => formatSalePedidoId(input)).toThrow(SaleNumberingError)
    try {
      formatSalePedidoId(input)
    } catch (e) {
      expect(isSaleNumberingError(e) && e.code).toBe("SALE_NUMBERING_INVARIANT_BROKEN")
    }
  })
})

describe("isValidSaleNumero", () => {
  it("aceita 1..999999 e recusa o resto", () => {
    expect(isValidSaleNumero(1)).toBe(true)
    expect(isValidSaleNumero(SALE_NUMBER_MAX)).toBe(true)
    expect(isValidSaleNumero(0)).toBe(false)
    expect(isValidSaleNumero(SALE_NUMBER_MAX + 1)).toBe(false)
    expect(isValidSaleNumero("1")).toBe(false)
  })
})

describe("resolveSaleNumberingAno", () => {
  it("usa o ano civil de America/Sao_Paulo, não o UTC", () => {
    // 01/01/2027 00:30 UTC ainda é 31/12/2026 21:30 em São Paulo (UTC-3).
    expect(resolveSaleNumberingAno(new Date("2027-01-01T00:30:00.000Z"))).toBe(2026)
    // 01/01/2027 03:30 UTC já virou o ano no fuso oficial.
    expect(resolveSaleNumberingAno(new Date("2027-01-01T03:30:00.000Z"))).toBe(2027)
  })

  it("mantém o ano em datas comuns", () => {
    expect(resolveSaleNumberingAno(new Date("2026-07-28T12:00:00.000Z"))).toBe(2026)
    expect(SALE_NUMBERING_TIMEZONE).toBe("America/Sao_Paulo")
  })

  it("falha fechada com data inválida", () => {
    expect(() => resolveSaleNumberingAno(new Date("data-invalida"))).toThrow(SaleNumberingError)
  })
})

describe("ausência de fallback de loja", () => {
  it.each([
    ["", "string vazia"],
    ["   ", "só espaços"],
  ])("recusa storeId %s (%s) sem cair em loja-1", async (storeId) => {
    const client = fakeClient(null)
    expect(await codeOf(resolveStoreSaleNumberingCode(client, storeId))).toBe("SALE_NUMBERING_NOT_CONFIGURED")
    expect(await codeOf(allocateSaleNumber(client, { storeId, ano: 2026 }))).toBe(
      "SALE_NUMBERING_NOT_CONFIGURED",
    )
  })
})

describe("loja sem configuração", () => {
  it("falha fechada quando a loja não existe", async () => {
    const client = fakeClient(null)
    expect(await codeOf(allocateSaleNumber(client, { storeId: "loja-inexistente", ano: 2026 }))).toBe(
      "SALE_NUMBERING_NOT_CONFIGURED",
    )
  })

  it("falha fechada quando a loja não tem código configurado", async () => {
    const client = fakeClient({ id: "loja-x", codigoNumeracaoVenda: null })
    expect(await codeOf(allocateSaleNumber(client, { storeId: "loja-x", ano: 2026 }))).toBe(
      "SALE_NUMBERING_NOT_CONFIGURED",
    )
  })

  it("falha fechada quando o código persistido está fora do formato (não conserta o dado)", async () => {
    const client = fakeClient({ id: "loja-x", codigoNumeracaoVenda: "L 01" })
    expect(await codeOf(allocateSaleNumber(client, { storeId: "loja-x", ano: 2026 }))).toBe(
      "SALE_NUMBERING_NOT_CONFIGURED",
    )
  })

  it("recusa prefixo inválido antes de criar a série", async () => {
    const client = fakeClient({ id: "loja-x", codigoNumeracaoVenda: "L001" })
    expect(await codeOf(ensureSerieVenda(client, { storeId: "loja-x", ano: 2026, prefixo: "??" }))).toBe(
      "SALE_NUMBERING_NOT_CONFIGURED",
    )
  })

  it("recusa ano fora da faixa antes de tocar a série", async () => {
    const client = fakeClient({ id: "loja-x", codigoNumeracaoVenda: "L001" })
    expect(await codeOf(allocateSaleNumber(client, { storeId: "loja-x", ano: 1999 }))).toBe(
      "SALE_NUMBERING_INVARIANT_BROKEN",
    )
  })
})

describe("saleNumberingAdvisoryKey", () => {
  it("é determinística, cabe em int4 e separa lojas diferentes", () => {
    const a = saleNumberingAdvisoryKey("loja-1")
    const b = saleNumberingAdvisoryKey("loja-2")
    expect(a).toBe(saleNumberingAdvisoryKey("loja-1"))
    expect(a).not.toBe(b)
    for (const chave of [a, b, saleNumberingAdvisoryKey("")]) {
      expect(Number.isInteger(chave)).toBe(true)
      expect(chave).toBeGreaterThanOrEqual(-2_147_483_648)
      expect(chave).toBeLessThanOrEqual(2_147_483_647)
    }
  })
})

describe("SaleNumberingError", () => {
  it("carrega código e contexto para log/alerta", () => {
    const e = new SaleNumberingError("SALE_SEQUENCE_EXHAUSTED", "esgotada", {
      storeId: "loja-x",
      ano: 2026,
      serieVendaId: "serie-1",
    })
    expect(e.code).toBe("SALE_SEQUENCE_EXHAUSTED")
    expect(e.storeId).toBe("loja-x")
    expect(e.ano).toBe(2026)
    expect(e.serieVendaId).toBe("serie-1")
    expect(isSaleNumberingError(e)).toBe(true)
    expect(isSaleNumberingError(new Error("x"))).toBe(false)
  })
})
