/**
 * GOAL-016D-A — os dez guards D4, a ordem canônica e o fail-closed de cada porta.
 *
 * Toda porta ausente/indisponível bloqueia. Em especial, validação XSD **nunca é presumida**:
 * sem atestado vinculado ao mesmo `bytesSha256`, o guard 8 barra o transporte.
 */
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import type { FiscalDocumentIdentity } from "@/lib/fiscal/emission/uncertain-state.types"
import {
  SEFAZ_GUARD_ORDER,
  readTpAmbFromSignedXml,
  runSefazPreTransportGuards,
  type SefazGuardPorts,
} from "./sefaz-guards"

const LOJA_PILOTO = "store-piloto-real"
const CHAVE = "3".repeat(44)

function xmlComTpAmb(tpAmb: string): Uint8Array {
  return new TextEncoder().encode(
    `<NFe><infNFe versao="4.00"><ide><tpAmb>${tpAmb}</tpAmb></ide></infNFe></NFe>`,
  )
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function documento(overrides: Partial<FiscalDocumentIdentity> = {}): FiscalDocumentIdentity {
  return {
    storeId: LOJA_PILOTO,
    vendaId: "venda-1",
    notaFiscalId: "nota-1",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 1,
    chaveAcesso: CHAVE,
    uf: "SP",
    correlationId: "corr-1",
    ...overrides,
  }
}

function portas(overrides: Partial<SefazGuardPorts> = {}): SefazGuardPorts {
  return {
    resolvePilotStoreId: vi.fn(async () => LOJA_PILOTO),
    loadFiscalConfig: vi.fn(async () => ({ provider: "SEFAZ_DIRETO" })),
    readXsdAttestation: vi.fn(async (input: { bytesSha256: string }) => ({
      outcome: "VALIDACAO_APROVADA",
      xmlSha256: input.bytesSha256,
      schemaVersion: "PL_010e_v1.02/NFe/nfe_v4.00.xsd",
    })),
    resolveActiveCertificate: vi.fn(async () => ({
      ok: true as const,
      storeId: LOJA_PILOTO,
      certificadoId: "cert-1",
      blobRef: "FISCAL_A1_PFX_B64_PILOTO",
      senhaRef: "FISCAL_A1_SENHA_PILOTO",
      provider: "env-piloto",
    })),
    ...overrides,
  }
}

async function run(input: {
  document?: FiscalDocumentIdentity
  exactBytes?: Uint8Array
  bytesSha256?: string
  ports?: SefazGuardPorts
}) {
  const bytes = input.exactBytes ?? xmlComTpAmb("2")
  return runSefazPreTransportGuards({
    document: input.document ?? documento(),
    exactBytes: bytes,
    bytesSha256: input.bytesSha256 ?? sha256(bytes),
    servico: "NFeAutorizacao4",
    ports: input.ports ?? portas(),
  })
}

describe("caminho aprovado (todas as dez condições satisfeitas)", () => {
  it("devolve endpoint de homologação e SOMENTE referências opacas do certificado", async () => {
    const r = await run({})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.endpoint.url).toBe(
      "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
    )
    expect(r.certificado).toEqual({
      certificadoId: "cert-1",
      blobRef: "FISCAL_A1_PFX_B64_PILOTO",
      senhaRef: "FISCAL_A1_SENHA_PILOTO",
    })
    expect(r.correlationId).toBe("corr-1")
  })
})

describe("os dez guards D4", () => {
  it("1 · ambiente ≠ HOMOLOGACAO ⇒ ambiente_nao_permitido", async () => {
    const r = await run({
      document: documento({ ambiente: "PRODUCAO" as unknown as "HOMOLOGACAO" }),
    })
    expect(r).toMatchObject({ ok: false, codigo: "ambiente_nao_permitido" })
  })

  it("2 · tpAmb do XML ≠ 2 ⇒ tpamb_nao_permitido (lido do XML, não da config)", async () => {
    const bytes = xmlComTpAmb("1")
    const r = await run({ exactBytes: bytes, bytesSha256: sha256(bytes) })
    expect(r).toMatchObject({ ok: false, codigo: "tpamb_nao_permitido" })
  })

  it("2b · tpAmb ausente/ilegível ⇒ bloqueia (nunca presume 2)", async () => {
    const bytes = new TextEncoder().encode("<NFe><infNFe/></NFe>")
    const r = await run({ exactBytes: bytes, bytesSha256: sha256(bytes) })
    expect(r).toMatchObject({ ok: false, codigo: "tpamb_nao_permitido" })
  })

  it("3 · modelo ≠ NFCE ⇒ modelo_nao_permitido", async () => {
    const r = await run({ document: documento({ modelo: "NFE" as unknown as "NFCE" }) })
    expect(r).toMatchObject({ ok: false, codigo: "modelo_nao_permitido" })
  })

  it("4 · UF ≠ SP, e UF ausente, ⇒ uf_nao_permitida", async () => {
    expect(await run({ document: documento({ uf: "RJ" }) })).toMatchObject({
      ok: false,
      codigo: "uf_nao_permitida",
    })
    expect(await run({ document: documento({ uf: undefined }) })).toMatchObject({
      ok: false,
      codigo: "uf_nao_permitida",
    })
  })

  it("4b · correlationId ausente ⇒ correlacao_ausente (precondição de contrato)", async () => {
    expect(await run({ document: documento({ correlationId: undefined }) })).toMatchObject({
      ok: false,
      codigo: "correlacao_ausente",
    })
    expect(await run({ document: documento({ correlationId: "   " }) })).toMatchObject({
      ok: false,
      codigo: "correlacao_ausente",
    })
  })

  it("5 · loja ≠ loja-piloto resolvida ⇒ loja_fora_do_piloto", async () => {
    const r = await run({ document: documento({ storeId: "outra-loja" }) })
    expect(r).toMatchObject({ ok: false, codigo: "loja_fora_do_piloto" })
  })

  it("5b · piloto não resolvido (porta devolve null) ⇒ bloqueia, sem literal de fallback", async () => {
    const r = await run({ ports: portas({ resolvePilotStoreId: vi.fn(async () => null) }) })
    expect(r).toMatchObject({ ok: false, codigo: "loja_fora_do_piloto" })
  })

  it("6 · provider da configuração ≠ SEFAZ_DIRETO (e config ausente) ⇒ provider_divergente", async () => {
    expect(
      await run({
        ports: portas({ loadFiscalConfig: vi.fn(async () => ({ provider: "STUB_HOMOLOGACAO" })) }),
      }),
    ).toMatchObject({ ok: false, codigo: "provider_divergente" })
    expect(
      await run({ ports: portas({ loadFiscalConfig: vi.fn(async () => null) }) }),
    ).toMatchObject({ ok: false, codigo: "provider_divergente" })
  })

  it("7 · hash divergente, bytes vazios ou hash ausente ⇒ bytes_nao_verificados", async () => {
    const bytes = xmlComTpAmb("2")
    expect(await run({ exactBytes: bytes, bytesSha256: "f".repeat(64) })).toMatchObject({
      ok: false,
      codigo: "bytes_nao_verificados",
    })
    expect(await run({ exactBytes: bytes, bytesSha256: "" })).toMatchObject({
      ok: false,
      codigo: "bytes_nao_verificados",
    })
  })

  it("8 · atestado XSD ausente, reprovado ou de OUTRO documento ⇒ xsd_nao_validado", async () => {
    expect(
      await run({ ports: portas({ readXsdAttestation: vi.fn(async () => null) }) }),
    ).toMatchObject({ ok: false, codigo: "xsd_nao_validado" })

    expect(
      await run({
        ports: portas({
          readXsdAttestation: vi.fn(async (i: { bytesSha256: string }) => ({
            outcome: "XML_INVALIDO",
            xmlSha256: i.bytesSha256,
            schemaVersion: "x",
          })),
        }),
      }),
    ).toMatchObject({ ok: false, codigo: "xsd_nao_validado" })

    // Atestado válido, porém vinculado a OUTROS bytes — não vale.
    expect(
      await run({
        ports: portas({
          readXsdAttestation: vi.fn(async () => ({
            outcome: "VALIDACAO_APROVADA",
            xmlSha256: "a".repeat(64),
            schemaVersion: "x",
          })),
        }),
      }),
    ).toMatchObject({ ok: false, codigo: "xsd_nao_validado" })
  })

  it("9 · serviço fora do catálogo ⇒ endpoint_nao_permitido", async () => {
    const bytes = xmlComTpAmb("2")
    const r = await runSefazPreTransportGuards({
      document: documento(),
      exactBytes: bytes,
      bytesSha256: sha256(bytes),
      servico: "NFeDistribuicaoDFe" as never,
      ports: portas(),
    })
    expect(r).toMatchObject({ ok: false, codigo: "endpoint_nao_permitido" })
  })

  it("10 · resolver A0 falha ⇒ certificado_indisponivel, sem vazar a causa interna", async () => {
    const r = await run({
      ports: portas({
        resolveActiveCertificate: vi.fn(async () => ({
          ok: false as const,
          codigo: "certificado_revogado" as const,
          mensagem: "Certificado revogado — estado terminal, não pode ser usado.",
        })),
      }),
    })
    expect(r).toMatchObject({ ok: false, codigo: "certificado_indisponivel" })
  })
})

describe("ordem canônica e curto-circuito", () => {
  it("a ordem declarada tem os dez códigos D4 mais a precondição de correlação", () => {
    expect([...SEFAZ_GUARD_ORDER]).toEqual([
      "ambiente_nao_permitido",
      "tpamb_nao_permitido",
      "modelo_nao_permitido",
      "uf_nao_permitida",
      "correlacao_ausente",
      "loja_fora_do_piloto",
      "provider_divergente",
      "bytes_nao_verificados",
      "xsd_nao_validado",
      "endpoint_nao_permitido",
      "certificado_indisponivel",
    ])
  })

  it("com TODAS as condições violadas, reporta o PRIMEIRO guard da ordem", async () => {
    const bytes = xmlComTpAmb("1")
    const r = await runSefazPreTransportGuards({
      document: documento({
        ambiente: "PRODUCAO" as unknown as "HOMOLOGACAO",
        modelo: "NFE" as unknown as "NFCE",
        uf: "RJ",
        correlationId: undefined,
        storeId: "outra",
      }),
      exactBytes: bytes,
      bytesSha256: "zzz",
      servico: "NFeAutorizacao4",
      ports: portas({
        resolvePilotStoreId: vi.fn(async () => null),
        loadFiscalConfig: vi.fn(async () => null),
        readXsdAttestation: vi.fn(async () => null),
        resolveActiveCertificate: vi.fn(async () => ({
          ok: false as const,
          codigo: "configuracao_fiscal_ausente" as const,
          mensagem: "x",
        })),
      }),
    })
    expect(r).toMatchObject({ ok: false, codigo: "ambiente_nao_permitido" })
  })

  it("um bloqueio precoce NÃO consulta as portas seguintes (zero efeito colateral)", async () => {
    const ports = portas()
    await run({ document: documento({ ambiente: "PRODUCAO" as unknown as "HOMOLOGACAO" }), ports })
    expect(ports.resolvePilotStoreId).not.toHaveBeenCalled()
    expect(ports.loadFiscalConfig).not.toHaveBeenCalled()
    expect(ports.readXsdAttestation).not.toHaveBeenCalled()
    expect(ports.resolveActiveCertificate).not.toHaveBeenCalled()
  })

  it("o certificado só é resolvido DEPOIS de todos os guards anteriores passarem", async () => {
    const ports = portas({ readXsdAttestation: vi.fn(async () => null) })
    await run({ ports })
    expect(ports.readXsdAttestation).toHaveBeenCalled()
    expect(ports.resolveActiveCertificate).not.toHaveBeenCalled()
  })
})

describe("leitura de tpAmb — read-only sobre os bytes", () => {
  it("extrai o tpAmb sem alterar o array de bytes original", () => {
    const bytes = xmlComTpAmb("2")
    const copia = Uint8Array.from(bytes)
    expect(readTpAmbFromSignedXml(bytes)).toBe("2")
    expect(Buffer.from(bytes).equals(Buffer.from(copia))).toBe(true)
  })

  it("XML sem tpAmb devolve null (fail-closed no caller)", () => {
    expect(readTpAmbFromSignedXml(new TextEncoder().encode("<NFe/>"))).toBeNull()
  })

  it("chamariz em COMENTÁRIO não mascara o tpAmb real de produção", async () => {
    // Sem remoção de comentários, uma busca pela PRIMEIRA ocorrência leria "2" e liberaria
    // um documento cujo tpAmb real — o que a SEFAZ lê — é "1" (produção).
    const bytes = new TextEncoder().encode(
      "<NFe><!--<tpAmb>2</tpAmb>--><infNFe><ide><tpAmb>1</tpAmb></ide></infNFe></NFe>",
    )
    expect(readTpAmbFromSignedXml(bytes)).toBe("1")

    const ports = portas()
    const r = await runSefazPreTransportGuards({
      document: documento(),
      exactBytes: bytes,
      bytesSha256: sha256(bytes),
      servico: "NFeAutorizacao4",
      ports,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("tpamb_nao_permitido")
  })

  it("chamariz em CDATA também é descartado antes da leitura", () => {
    const bytes = new TextEncoder().encode(
      "<NFe><x><![CDATA[<tpAmb>2</tpAmb>]]></x><ide><tpAmb>1</tpAmb></ide></NFe>",
    )
    expect(readTpAmbFromSignedXml(bytes)).toBe("1")
  })

  it("tpAmb AMBÍGUO (duas ocorrências reais) devolve null — ambiguidade nunca aprova", () => {
    const bytes = new TextEncoder().encode(
      "<NFe><ide><tpAmb>2</tpAmb></ide><outro><tpAmb>1</tpAmb></outro></NFe>",
    )
    expect(readTpAmbFromSignedXml(bytes)).toBeNull()
  })
})

describe("modo consulta", () => {
  it("não exige bytes/XSD (não há documento transmitido), mas mantém os demais guards", async () => {
    const ports = portas()
    const r = await runSefazPreTransportGuards({
      document: documento(),
      servico: "NFeConsultaProtocolo4",
      ports,
      modo: "consulta",
    })
    expect(r.ok).toBe(true)
    expect(ports.readXsdAttestation).not.toHaveBeenCalled()
    // isolamento por loja e certificado continuam valendo
    expect(ports.resolvePilotStoreId).toHaveBeenCalled()
    expect(ports.resolveActiveCertificate).toHaveBeenCalled()
  })

  it("consulta de loja fora do piloto continua bloqueada", async () => {
    const r = await runSefazPreTransportGuards({
      document: documento({ storeId: "outra-loja" }),
      servico: "NFeConsultaProtocolo4",
      ports: portas(),
      modo: "consulta",
    })
    expect(r).toMatchObject({ ok: false, codigo: "loja_fora_do_piloto" })
  })
})
