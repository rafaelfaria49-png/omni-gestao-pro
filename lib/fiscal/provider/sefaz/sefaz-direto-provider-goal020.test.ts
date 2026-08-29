/**
 * GOAL 020 · relatório 127 — P2 REAL de ponta a ponta.
 *
 * Wire oficial de `NFeAutorizacao4` (`enviNFe` com NFe assinada byte-idêntica),
 * resposta classificada pelo parser oficial (autorizada realística, denegação,
 * `103/105`, divergência de chave, timeout) e consulta por chave executável
 * (`consSitNFe`, `217` ⇒ NOT_FOUND, autorizada composta). Nenhum teste fala com
 * a SEFAZ: o transporte é injetado e as respostas são fixtures sintéticas.
 */
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { SefazAdapterBlockedError, SefazDiretoProvider } from "./sefaz-direto-provider"
import type { SefazGuardPorts } from "./sefaz-guards"
import type {
  FiscalDocumentIdentity,
} from "@/lib/fiscal/emission/uncertain-state.types"
import type { SefazTransport } from "./sefaz-transport.types"

const LOJA_PILOTO = "store-piloto-real"
const CHAVE = "3".repeat(44)

const XML_ASSINADO_P2 =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">` +
  `<infNFe Id="NFe${CHAVE}" versao="4.00"><ide><tpAmb>2</tpAmb></ide></infNFe>` +
  `</NFe>`
const BYTES_P2 = new TextEncoder().encode(XML_ASSINADO_P2)
const SHA_P2 = createHash("sha256").update(BYTES_P2).digest("hex")

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

function portasAprovadas(overrides: Partial<SefazGuardPorts> = {}): SefazGuardPorts {
  return {
    resolvePilotStoreId: vi.fn(async () => LOJA_PILOTO),
    loadFiscalConfig: vi.fn(async () => ({ provider: "SEFAZ_DIRETO" })),
    readXsdAttestation: vi.fn(async (i: { bytesSha256: string }) => ({
      outcome: "VALIDACAO_APROVADA",
      xmlSha256: i.bytesSha256,
      schemaVersion: "PL_010e_v1.02/NFe/nfe_v4.00.xsd",
    })),
    resolveActiveCertificate: vi.fn(async () => ({
      ok: true as const,
      storeId: LOJA_PILOTO,
      certificadoId: "cert-1",
      blobRef: "blob-ref",
      senhaRef: "senha-ref",
      provider: "env-piloto",
    })),
    ...overrides,
  }
}

function soap(servico: "NFeAutorizacao4" | "NFeConsultaProtocolo4", payload: string): string {
  return (
    `<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">` +
    `<env:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">` +
    payload +
    `</nfeResultMsg>` +
    `</env:Body></env:Envelope>`
  )
}

function protNFeAutorizada(): string {
  return (
    `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt>` +
    `<chNFe>${CHAVE}</chNFe><cStat>100</cStat>` +
    `<xMotivo>Autorizado o uso da NF-e</xMotivo><nProt>135260000000001</nProt>` +
    `</infProt></protNFe>`
  )
}

function transportOk(body: string): { transport: SefazTransport; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({
    ok: true as const,
    classification: "RESPONSE_RECEIVED" as const,
    httpStatus: 200,
    contentType: "application/soap+xml; charset=utf-8",
    bodyBytes: new TextEncoder().encode(body),
    externalTransmissionAttempted: true as const,
  }))
  const transport: SefazTransport = { permiteRede: true, send }
  return { transport, send }
}

describe("GOAL 020 · wire NFeAutorizacao4 — enviNFe com NFe byte-idêntica", () => {
  it("corpo da requisição é enviNFe (idLote 1, indSinc 1) com os bytes assinados intactos", async () => {
    const { transport, send } = transportOk(soap("NFeAutorizacao4", protNFeAutorizada()))
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    await provider.transmit({ document: documento(), exactBytes: BYTES_P2, bytesSha256: SHA_P2 })
    const req = send.mock.calls[0]?.[0] as unknown as { bodyBytes: Uint8Array }
    const body = new TextDecoder().decode(req.bodyBytes)
    expect(body).toContain(
      `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<idLote>1</idLote><indSinc>1</indSinc>`,
    )
    // Prova de byte-exatidão: a NFe assinada aparece EXATAMENTE uma vez e intacta.
    expect(body.split(XML_ASSINADO_P2)).toHaveLength(2)
    expect(body).toContain(`</enviNFe>`)
  })

  it("raiz que não é NFe é recusada antes do envelope/transporte", async () => {
    const transport: SefazTransport = { permiteRede: false, send: vi.fn() }
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const evento = new TextEncoder().encode(
      `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<infEvento><tpAmb>2</tpAmb></infEvento></envEvento>`,
    )
    const erro = await provider
      .transmit({
        document: documento(),
        exactBytes: evento,
        bytesSha256: createHash("sha256").update(evento).digest("hex"),
      })
      .catch((e: unknown) => e)
    expect((erro as SefazAdapterBlockedError).codigo).toBe("envinfe_raiz_nao_e_nfe")
    expect(transport.send).not.toHaveBeenCalled()
  })
})

describe("GOAL 020 · transmit classifica a resposta pelo parser oficial", () => {
  it("resposta síncrona realística (104 + protNFe 100) ⇒ AUTHORIZED com nfeProc composto", async () => {
    const resposta = soap(
      "NFeAutorizacao4",
      `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
        protNFeAutorizada() +
        `</retEnviNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.transmit({
      document: documento(),
      exactBytes: BYTES_P2,
      bytesSha256: SHA_P2,
    })
    expect(resultado.outcome).toBe("AUTHORIZED")
    if (resultado.outcome !== "AUTHORIZED") return
    expect(resultado.protocolo).toBe("135260000000001")
    expect(resultado.cStat).toBe("100")
    // XML autorizado: nfeProc canônico contendo a NFe assinada BYTE-IDÊNTICA.
    expect(
      resultado.xmlAutorizado.startsWith(
        `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`,
      ),
    ).toBe(true)
    expect(resultado.xmlAutorizado.includes(XML_ASSINADO_P2)).toBe(true)
    expect(resultado.xmlAutorizado.endsWith(`</nfeProc>`)).toBe(true)
  })

  it("denegação (110) ⇒ REJECTED terminal, sem XML autorizado fabricado", async () => {
    const resposta = soap(
      "NFeAutorizacao4",
      `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
        `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt>` +
        `<chNFe>${CHAVE}</chNFe><cStat>110</cStat>` +
        `<xMotivo>Uso denegado</xMotivo></infProt></protNFe>` +
        `</retEnviNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.transmit({
      document: documento(),
      exactBytes: BYTES_P2,
      bytesSha256: SHA_P2,
    })
    expect(resultado.outcome).toBe("REJECTED")
    if (resultado.outcome !== "REJECTED") return
    expect(resultado.cStat).toBe("110")
    expect(resultado.consequences?.requiresInutilizacao).toBe(false)
  })

  it("103 assíncrono com nRec ⇒ UNCERTAIN PROCESSING com recibo (reconsulta do mesmo lote)", async () => {
    const resposta = soap(
      "NFeAutorizacao4",
      `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo>` +
        `<infRec><nRec>123456789012345</nRec><tMed>3</tMed></infRec>` +
        `</retEnviNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.transmit({
      document: documento(),
      exactBytes: BYTES_P2,
      bytesSha256: SHA_P2,
    })
    expect(resultado).toMatchObject({
      outcome: "UNCERTAIN",
      code: "PROCESSING",
      recibo: "123456789012345",
      requiresConsultation: true,
    })
  })

  it("resposta de OUTRA chave nunca autoriza (DOCUMENT_MISMATCH ⇒ UNCERTAIN)", async () => {
    const outraChave = "4".repeat(44)
    const resposta = soap(
      "NFeAutorizacao4",
      `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo>` +
        `<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt>` +
        `<chNFe>${outraChave}</chNFe><cStat>100</cStat><xMotivo>Autorizado</xMotivo>` +
        `<nProt>135260000000002</nProt></infProt></protNFe>` +
        `</retEnviNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.transmit({
      document: documento(),
      exactBytes: BYTES_P2,
      bytesSha256: SHA_P2,
    })
    expect(resultado).toMatchObject({ outcome: "UNCERTAIN", code: "UNKNOWN" })
  })

  it("timeout DEPOIS do envio ⇒ bloqueio com tentativa externa registrada (nunca rejeição)", async () => {
    const transport: SefazTransport = {
      permiteRede: true as const,
      send: vi.fn(async () => ({
        ok: false as const,
        codigo: "transporte_timeout_conexao" as const,
        mensagem: "Conexão excedeu o relógio.",
        classification: "UNKNOWN_UNCERTAIN" as const,
        externalTransmissionAttempted: true,
      })),
    }
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const erro = await provider
      .transmit({ document: documento(), exactBytes: BYTES_P2, bytesSha256: SHA_P2 })
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(SefazAdapterBlockedError)
    expect((erro as SefazAdapterBlockedError).codigo).toBe("transporte_timeout_conexao")
    expect((erro as SefazAdapterBlockedError).externalTransmissionAttempted).toBe(true)
  })
})

describe("GOAL 020 · consult por chave — requisição e resposta classificadas", () => {
  it("requisição carrega consSitNFe com a chave; resposta 217 ⇒ NOT_FOUND", async () => {
    const resposta = soap(
      "NFeConsultaProtocolo4",
      `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><cStat>217</cStat>` +
        `<xMotivo>NF-e não consta na base de dados da SEFAZ</xMotivo>` +
        `</retConsSitNFe>`,
    )
    const { transport, send } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.consult({ document: documento() })
    const req = send.mock.calls[0]?.[0] as unknown as {
      endpoint: { servico: string; ambiente: string }
      bodyBytes: Uint8Array
    }
    expect(req.endpoint).toMatchObject({ servico: "NFeConsultaProtocolo4", ambiente: "HOMOLOGACAO" })
    const body = new TextDecoder().decode(req.bodyBytes)
    expect(body).toContain(`<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`)
    expect(body).toContain(`<tpAmb>2</tpAmb>`)
    expect(body).toContain(`<xServ>CONSULTAR</xServ>`)
    expect(body).toContain(`<chNFe>${CHAVE}</chNFe>`)
    expect(resultado).toMatchObject({ outcome: "NOT_FOUND", cStat: "217" })
  })

  it("consulta de documento autorizado (100 + protNFe) ⇒ AUTHORIZED com nfeProc composto", async () => {
    const resposta = soap(
      "NFeConsultaProtocolo4",
      `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><xServ>CONSULTAR</xServ>` +
        `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>` +
        protNFeAutorizada() +
        `</retConsSitNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.consult({
      document: documento(),
      xmlAssinado: XML_ASSINADO_P2,
    })
    expect(resultado.outcome).toBe("AUTHORIZED")
    if (resultado.outcome !== "AUTHORIZED") return
    expect(resultado.protocolo).toBe("135260000000001")
    expect(resultado.xmlAutorizado.includes(XML_ASSINADO_P2)).toBe(true)
  })

  it("consulta sem xmlAssinado e com resposta sem nfeProc permanece UNCERTAIN (sem fabricação)", async () => {
    const resposta = soap(
      "NFeConsultaProtocolo4",
      `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
        `<tpAmb>2</tpAmb><xServ>CONSULTAR</xServ>` +
        `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>` +
        protNFeAutorizada() +
        `</retConsSitNFe>`,
    )
    const { transport } = transportOk(resposta)
    const provider = new SefazDiretoProvider({ ports: portasAprovadas(), transport })
    const resultado = await provider.consult({ document: documento() })
    expect(resultado).toMatchObject({ outcome: "UNCERTAIN" })
  })
})
