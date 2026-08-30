import { describe, expect, it, vi } from "vitest"
import {
  candidataAquisicaoWsdl,
  resolveWsdlPilotStoreFrom,
  type WsdlPilotStoreClient,
} from "./wsdl-pilot-store-resolver"

function candidata(storeId: string, overrides: Record<string, unknown> = {}) {
  return {
    storeId,
    ambiente: "HOMOLOGACAO",
    modeloFiscal: "NFCE",
    provider: "SEFAZ_DIRETO",
    fiscalEnabled: false,
    certificadoAtivoId: `cert-${storeId}`,
    ...overrides,
  }
}

function client(rows: Array<Record<string, unknown>> | Error): WsdlPilotStoreClient {
  return {
    configuracaoFiscalLoja: {
      findMany: vi.fn(async () => {
        if (rows instanceof Error) throw rows
        return rows
      }),
    },
  }
}

describe("resolução dinâmica da loja-piloto WSDL (fail-closed)", () => {
  it("zero candidatas bloqueia", async () => {
    expect(await resolveWsdlPilotStoreFrom(client([]))).toEqual({
      ok: false,
      code: "no_candidate",
    })
  })

  it.each(["STUB_HOMOLOGACAO", "SEFAZ_DIRETO"])(
    "provider %s + fiscalEnabled=false + A1 referenciado é candidata válida",
    async (provider) => {
      const resolved = await resolveWsdlPilotStoreFrom(
        client([candidata("loja-real-7", { provider })]),
      )
      expect(resolved).toEqual({ ok: true, storeId: "loja-real-7" })
    },
  )

  it("duas candidatas bloqueiam e exigem decisão humana — nunca 'a primeira'", async () => {
    const resolved = await resolveWsdlPilotStoreFrom(
      client([candidata("loja-a"), candidata("loja-b", { provider: "STUB_HOMOLOGACAO" })]),
    )
    expect(resolved).toEqual({ ok: false, code: "ambiguous" })
  })

  it.each([
    ["provider fora do par permitido", candidata("loja-a", { provider: "GATEWAY_FOCUS" })],
    ["provider ausente", candidata("loja-a", { provider: null })],
    ["fiscalEnabled=true (emissão ligada não é aquisição)", candidata("loja-a", { fiscalEnabled: true })],
    ["fiscalEnabled ausente", candidata("loja-a", { fiscalEnabled: null })],
    ["ambiente divergente", candidata("loja-a", { ambiente: "PRODUCAO" })],
    ["modelo divergente", candidata("loja-a", { modeloFiscal: "NFE" })],
    ["certificado ausente", candidata("loja-a", { certificadoAtivoId: null })],
    ["certificado vazio", candidata("loja-a", { certificadoAtivoId: "   " })],
    ["storeId ausente", candidata("loja-a", { storeId: "" })],
  ])("candidatura recusada por %s não conta como piloto", async (_label, row) => {
    const soRecusada = await resolveWsdlPilotStoreFrom(client([row]))
    expect(soRecusada).toEqual({ ok: false, code: "no_candidate" })

    // Uma recusada + uma elegível: resolve a elegível, sem ambiguidade.
    const mista = await resolveWsdlPilotStoreFrom(
      client([row, candidata("loja-elegivel")]),
    )
    expect(mista).toEqual({ ok: true, storeId: "loja-elegivel" })
  })

  it("falha de leitura do banco bloqueia (unavailable)", async () => {
    expect(await resolveWsdlPilotStoreFrom(client(new Error("db down")))).toEqual({
      ok: false,
      code: "unavailable",
    })
  })

  it("não consulta rede na resolução", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await resolveWsdlPilotStoreFrom(client([candidata("loja-a")]))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("candidata fiscalmente HABILITADA (SEFAZ_DIRETO + fiscalEnabled=true) é recusada mesmo com A1 válido", () => {
    expect(candidataAquisicaoWsdl(candidata("loja-a", { fiscalEnabled: true }))).toBe(false)
  })
})
