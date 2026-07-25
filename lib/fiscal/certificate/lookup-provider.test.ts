/**
 * GOAL-016B — contrato de enriquecimento cadastral (item 4).
 *
 * Prova: enquanto não houver fonte aprovada por ADR, o provider default declara
 * "consulta externa ainda não configurada", NÃO faz rede e NÃO inventa campo algum.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  LOOKUP_NAO_CONFIGURADO_MENSAGEM,
  NaoConfiguradoLookupProvider,
  resolveFiscalIdentityLookupProvider,
} from "./lookup-provider"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("resolveFiscalIdentityLookupProvider", () => {
  it("devolve o provider 'não configurado' enquanto não houver fonte aprovada", () => {
    expect(resolveFiscalIdentityLookupProvider()).toBeInstanceOf(NaoConfiguradoLookupProvider)
  })
})

describe("NaoConfiguradoLookupProvider", () => {
  it("responde nao_configurado com mensagem honesta e sem campos", async () => {
    const r = await new NaoConfiguradoLookupProvider().consultar({ cnpj: "11222333000181", uf: "SP" })
    expect(r).toEqual({ status: "nao_configurado", mensagem: LOOKUP_NAO_CONFIGURADO_MENSAGEM })
    expect(r).not.toHaveProperty("campos")
  })

  it("não faz nenhuma chamada de rede (sem scraping improvisado)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await new NaoConfiguradoLookupProvider().consultar({ cnpj: "11222333000181", uf: "SP" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("responde igual mesmo sem CNPJ/UF (não falha e não infere nada)", async () => {
    const r = await new NaoConfiguradoLookupProvider().consultar({ cnpj: "", uf: "" })
    expect(r.status).toBe("nao_configurado")
  })
})
