import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { FiscalProviderTipo } from "@/generated/prisma"
import { SefazDiretoProvider } from "@/lib/fiscal/provider/sefaz/sefaz-direto-provider"
import { SefazSoapTransport } from "@/lib/fiscal/provider/sefaz/sefaz-soap-transport"
import { resolveFiscalProvider } from "@/lib/fiscal/provider/resolver"
import { loadCertificateMaterialFromPem } from "@/lib/fiscal/signing/nfce-signer"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "@/lib/fiscal/signing/__fixtures__/test-cert"
import { createSefazDiretoCancelamentoRuntime } from "./cancelamento-sefaz-runtime"

const STORE = "loja-1"
const signingMaterial = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)

function clientCom(provider: string | null) {
  return {
    configuracaoFiscalLoja: {
      findUnique: vi.fn(async () =>
        provider
          ? {
              provider,
              ambiente: "HOMOLOGACAO",
              modeloFiscal: "NFCE",
              fiscalEnabled: true,
              cnpj: "11222333000165",
              razaoSocial: "Loja",
              uf: "SP",
              providerConfig: null,
              providerTokenRef: null,
              cscId: "1",
              cscTokenRef: null,
              storeId: STORE,
            }
          : null,
      ),
    },
  }
}

const certOk = {
  ok: true as const,
  storeId: STORE,
  certificadoId: "cert-1",
  blobRef: "FISCAL_A1_PFX_B64_LOJA1",
  senhaRef: "FISCAL_A1_SENHA_LOJA1",
  provider: "env-piloto",
}

describe("createSefazDiretoCancelamentoRuntime", () => {
  it("recusa config ausente", async () => {
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(null),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("config_ausente")
  })

  it("recusa STUB_HOMOLOGACAO — sem persistência simulada", async () => {
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(FiscalProviderTipo.STUB_HOMOLOGACAO),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("provider_incompativel")
  })

  it("recusa provider não implementado (sem registrar no REGISTRY P1)", async () => {
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(FiscalProviderTipo.GATEWAY_FOCUS),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("provider_nao_implementado")
    const resolved = resolveFiscalProvider({
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente: "HOMOLOGACAO",
      modeloFiscal: "NFCE",
      fiscalEnabled: true,
      cnpj: "1",
      razaoSocial: "x",
      uf: "SP",
    })
    expect(resolved.ok).toBe(false)
  })

  it("recusa A1 ausente", async () => {
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(FiscalProviderTipo.SEFAZ_DIRETO),
      resolveCertificate: async () => ({
        ok: false,
        codigo: "certificado_ativo_nao_configurado",
        mensagem: "Certificado A1 ativo não configurado.",
      }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("certificado_indisponivel")
  })

  it("compõe SefazDiretoProvider + SefazSoapTransport com A1 injetado", async () => {
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(FiscalProviderTipo.SEFAZ_DIRETO),
      resolveCertificate: async () => certOk,
      signingMaterial,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.provider).toBeInstanceOf(SefazDiretoProvider)
    expect(r.provider.tipo).toBe(FiscalProviderTipo.SEFAZ_DIRETO)
    expect(r.provider.simulado).toBe(false)
  })

  it("transporte default é SefazSoapTransport (não stub, não REGISTRY)", async () => {
    const transport = new SefazSoapTransport()
    const r = await createSefazDiretoCancelamentoRuntime({
      storeId: STORE,
      client: clientCom(FiscalProviderTipo.SEFAZ_DIRETO),
      resolveCertificate: async () => certOk,
      signingMaterial,
      transport,
    })
    expect(r.ok).toBe(true)
    expect(transport).toBeInstanceOf(SefazSoapTransport)
  })

  it("não importa refuseDormantA1CertificateResolution", () => {
    const src = readFileSync(resolve(__dirname, "cancelamento-sefaz-runtime.ts"), "utf8")
    expect(src).not.toMatch(/refuseDormantA1CertificateResolution/)
    expect(src).toContain("SefazDiretoProvider")
    expect(src).toContain("SefazSoapTransport")
    expect(src).toContain("resolveActiveCertificate")
  })

  it("persistido não tem fallback stub", () => {
    const src = readFileSync(resolve(__dirname, "cancelamento-prisma.ts"), "utf8")
    expect(src).not.toMatch(/stubHomologacaoProvider/)
    expect(src).toContain("createSefazDiretoCancelamentoRuntime")
  })
})
