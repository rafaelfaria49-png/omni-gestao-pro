/**
 * GOAL 020B — reconstrução OFFLINE e assinatura do XML NFC-e em contingência (tpEmis=9).
 *
 * Sem persistência, transmissão, numerador, Prisma ou rede.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { decideNormalToOffline } from "../contingencia/policy"
import {
  CONTINGENCIA_TP_EMIS,
  REBUILD_AND_RESIGN_REQUIRED,
  SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
} from "../contingencia/types"
import { loadCertificateMaterialFromPem, signNfceXmlDetailed, verifyNfceSignature } from "../signing"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "../signing/__fixtures__/test-cert"
import { calcularDigitoVerificadorChave, formatDhEmi, montarChaveAcesso } from "../xml/nfce-chave-acesso"
import { buildNfceXmlAssinavel, buildNfceXmlAssinavelResult } from "../xml/nfce-xml-builder"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
  type VendaFiscalSnapshot,
} from "../venda-fiscal-snapshot"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import {
  CONTINGENCIA_XML_XJUST_MAX,
  CONTINGENCIA_XML_XJUST_MIN,
  ContingenciaXmlError,
  patchSignedNfceXmlInPlace,
  rebuildNfceContingenciaXmlOffline,
  validateNfceXmlXsdOffline,
} from "./index"

const AGORA = new Date("2027-06-01T12:00:00.000Z")
const CERT = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)
const DH_EMI_ISO = "2026-06-18T12:00:00.000Z"
const DH_CONT = "2026-08-16T15:00:00-03:00"
const X_JUST = "Falha de conectividade com a SEFAZ"
const SERIE = 1
const NNF = 55
const CNF = "00000007"

const LOJA_OK: SnapshotLojaInput = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "RafaCell Comércio LTDA",
  nomeFantasia: "RafaCell",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "987654",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua das Flores",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001-000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

function item(over: Partial<SnapshotItemInput> = {}): SnapshotItemInput {
  return {
    itemVendaId: "iv-1",
    produtoId: "prod-1",
    codigoProduto: "SKU-1",
    descricao: "Cabo USB-C",
    gtin: "7891234567890",
    quantidade: 2,
    valorUnitario: 25,
    valorDesconto: 0,
    valorTotal: 50,
    fiscal: sanitizeProdutoFiscal({ ncm: "85176200", cfop: "5102", csosn: "102", origem: "0", unidade: "UN" }),
    ...over,
  }
}

function snapshot(): VendaFiscalSnapshot {
  const input: BuildSnapshotInput = {
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: {
      pedidoId: "VDA-2026-0001",
      data: DH_EMI_ISO,
      total: 50,
      desconto: 0,
      operador: "João Caixa",
      terminal: "PDV1",
      paymentBreakdown: null,
    },
    itens: [item()],
  }
  const r = buildVendaFiscalSnapshot(input)
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return r.snapshot
}

function rebuildInput(over: Partial<Parameters<typeof rebuildNfceContingenciaXmlOffline>[0]> = {}) {
  return {
    snapshot: snapshot(),
    serie: SERIE,
    nNF: NNF,
    cNF: CNF,
    dhEmi: DH_EMI_ISO,
    dhCont: DH_CONT,
    xJust: X_JUST,
    signer: { certificado: CERT, senha: "", agora: AGORA },
    ...over,
  }
}

function xmlNormalAssinado(): string {
  const xml = buildNfceXmlAssinavel(snapshot(), { serie: SERIE, numero: NNF, cNF: CNF, tpEmis: 1, dataEmissao: DH_EMI_ISO })
  return signNfceXmlDetailed(xml, CERT, "", { agora: AGORA }).xml
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

describe("rebuildNfceContingenciaXmlOffline · chave / cDV / Id", () => {
  it("Normal → tpEmis 9 gera nova chave, cDV recalculado e infNFe/@Id consistente", () => {
    const normal = buildNfceXmlAssinavelResult(snapshot(), {
      serie: SERIE,
      numero: NNF,
      cNF: CNF,
      tpEmis: 1,
      dataEmissao: DH_EMI_ISO,
    })
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())

    expect(normal.chaveAcesso).toHaveLength(44)
    expect(offline.chave).toHaveLength(44)
    expect(/^\d{44}$/.test(offline.chave)).toBe(true)
    expect(normal.chaveAcesso).not.toBe(offline.chave)
    expect(normal.chaveAcesso[34]).toBe("1")
    expect(offline.chave[34]).toBe("9")
    expect(offline.tpEmis).toBe(CONTINGENCIA_TP_EMIS)
    expect(offline.cDV).toBe(calcularDigitoVerificadorChave(offline.chave.slice(0, 43)))
    expect(offline.cDV).not.toBe(normal.chaveAcesso.slice(-1))
    expect(offline.infNFeId).toBe(`NFe${offline.chave}`)
    expect(offline.xml).toContain(`Id="${offline.infNFeId}"`)
    expect(offline.xml).toMatch(new RegExp(`<Reference URI="#${offline.infNFeId}">`))
  })

  it("tpEmis=9 entra na composição canônica da chave (mesmos cUF/AAMM/CNPJ/mod/série/nNF/cNF)", () => {
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())
    const esperada = montarChaveAcesso({
      cUF: "35",
      aamm: "2606",
      cnpj: "11222333000181",
      modelo: "65",
      serie: SERIE,
      numero: NNF,
      tpEmis: 9,
      cNF: CNF,
    })
    expect(offline.chave).toBe(esperada)
  })
})

describe("rebuildNfceContingenciaXmlOffline · preservação de numeração e dhEmi", () => {
  it("preserva nNF, série, cNF e dhEmi do input; não aloca número", () => {
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())
    expect(offline.nNF).toBe(NNF)
    expect(offline.serie).toBe(SERIE)
    expect(offline.cNF).toBe(CNF)
    expect(offline.xml).toContain(`<nNF>${NNF}</nNF>`)
    expect(offline.xml).toContain(`<serie>${SERIE}</serie>`)
    expect(offline.xml).toContain(`<cNF>${CNF}</cNF>`)
    expect(offline.dhEmi).toBe(formatDhEmi(DH_EMI_ISO))
    expect(offline.xml).toContain(`<dhEmi>${offline.dhEmi}</dhEmi>`)
    expect(offline.dhEmi).not.toBe(DH_CONT)
  })

  it("recusa cNF ausente ou com tamanho diferente de 8 — não gera cNF", () => {
    expect(() => rebuildNfceContingenciaXmlOffline(rebuildInput({ cNF: "" }))).toThrow(ContingenciaXmlError)
    expect(() => rebuildNfceContingenciaXmlOffline(rebuildInput({ cNF: "1" }))).toThrow(/8 dígitos/)
    expect(() => rebuildNfceContingenciaXmlOffline(rebuildInput({ nNF: 0 }))).toThrow(/não reserva/)
  })
})

describe("rebuildNfceContingenciaXmlOffline · dhCont / xJust", () => {
  it("insere dhCont independente de dhEmi e escapa xJust", () => {
    const xJust = 'Falha SEFAZ: <timeout> & "rede"'
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput({ xJust }))
    expect(offline.dhCont).toBe(DH_CONT)
    expect(offline.xml).toContain(`<dhCont>${DH_CONT}</dhCont>`)
    expect(offline.xml).toContain("<xJust>Falha SEFAZ: &lt;timeout&gt; &amp; \"rede\"</xJust>")
    expect(offline.xml).not.toContain("<timeout>")
  })

  it("aplica limites oficiais de xJust do XSD (15–256)", () => {
    expect(CONTINGENCIA_XML_XJUST_MIN).toBe(15)
    expect(CONTINGENCIA_XML_XJUST_MAX).toBe(256)
    expect(() => rebuildNfceContingenciaXmlOffline(rebuildInput({ xJust: "x".repeat(14) }))).toThrow(
      /15–256/,
    )
    const min = rebuildNfceContingenciaXmlOffline(rebuildInput({ xJust: "x".repeat(15) }))
    expect(min.xJust).toHaveLength(15)
    const max = rebuildNfceContingenciaXmlOffline(rebuildInput({ xJust: "x".repeat(256) }))
    expect(max.xJust).toHaveLength(256)
    expect(() => rebuildNfceContingenciaXmlOffline(rebuildInput({ xJust: "x".repeat(257) }))).toThrow(
      /15–256/,
    )
  })
})

describe("rebuildNfceContingenciaXmlOffline · patch in-place rejeitado", () => {
  it("tentativa de patch de XML assinado é recusada; rebuild parte do snapshot", () => {
    const assinado = xmlNormalAssinado()
    expect(() => patchSignedNfceXmlInPlace(assinado, { tpEmis: "9" })).toThrow(ContingenciaXmlError)
    expect(() => patchSignedNfceXmlInPlace(assinado, { tpEmis: "9" })).toThrowError(
      expect.objectContaining({ code: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN }),
    )
    expect(() =>
      rebuildNfceContingenciaXmlOffline(rebuildInput({ xmlAssinadoParaPatch: assinado })),
    ).toThrowError(expect.objectContaining({ code: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN }))
    expect(assinado).toContain("<tpEmis>1</tpEmis>")
    expect(assinado).not.toContain("<dhCont>")
  })

  it("conversão Normal → off-line exige REBUILD_AND_RESIGN_REQUIRED", () => {
    const decision = decideNormalToOffline({
      tpEmisAtual: 1,
      xmlAssinado: true,
      transmissaoIniciada: false,
      numeroJaTransmitidoComoNormal: false,
    })
    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.xmlMutation).toBe(REBUILD_AND_RESIGN_REQUIRED)
    const offline = rebuildNfceContingenciaXmlOffline(
      rebuildInput({
        conversao: {
          tpEmisAtual: 1,
          xmlAssinado: true,
          transmissaoIniciada: false,
          numeroJaTransmitidoComoNormal: false,
        },
      }),
    )
    expect(offline.tpEmis).toBe(9)
    expect(offline.xml).not.toBe(xmlNormalAssinado())
  })
})

describe("rebuildNfceContingenciaXmlOffline · assinatura sobre o Id novo", () => {
  it("assinatura referencia o novo Id, digest confere e não reutiliza a do XML Normal", () => {
    const normal = xmlNormalAssinado()
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())
    const v = verifyNfceSignature(offline.xml)
    expect(v.valido).toBe(true)
    expect(v.digestConfere).toBe(true)
    expect(v.assinaturaConfere).toBe(true)
    expect(v.referenciaId).toBe(offline.infNFeId)
    expect(offline.xml).toMatch(/<\/infNFe>\s*<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/)
    const digestNormal = normal.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1]
    const digestOffline = offline.xml.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1]
    const sigNormal = normal.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1]
    const sigOffline = offline.xml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1]
    expect(digestOffline).toBeTruthy()
    expect(digestOffline).not.toBe(digestNormal)
    expect(sigOffline).not.toBe(sigNormal)
  })
})

describe("rebuildNfceContingenciaXmlOffline · XSD offline + exactBytes", () => {
  it("XML assinado valida no XSD oficial offline e exactBytes/sha256 batem", () => {
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())
    const xsd = validateNfceXmlXsdOffline(offline.xml)
    expect(xsd).toEqual({ ok: true })
    const encoded = new TextEncoder().encode(offline.xml)
    expect(Buffer.from(offline.exactBytes)).toEqual(Buffer.from(encoded))
    expect(offline.sha256).toBe(sha256Hex(offline.exactBytes))
    expect(offline.sha256).toBe(sha256Hex(encoded))
    expect(offline.frozen).toBe(true)
    expect(offline.rebuildForbidden).toBe(true)
    expect(Object.isFrozen(offline)).toBe(true)
  })

  it("nenhuma reserialização após freeze: mutar a cópia de exactBytes não altera o resultado", () => {
    const offline = rebuildNfceContingenciaXmlOffline(rebuildInput())
    const first = offline.exactBytes
    first[0] = 0
    const second = offline.exactBytes
    expect(second[0]).not.toBe(0)
    expect(sha256Hex(second)).toBe(offline.sha256)
    expect(new TextDecoder().decode(second)).toBe(offline.xml)
  })

  it("input idêntico gera o mesmo resultado estrutural", () => {
    const a = rebuildNfceContingenciaXmlOffline(rebuildInput())
    const b = rebuildNfceContingenciaXmlOffline(rebuildInput())
    expect(a.chave).toBe(b.chave)
    expect(a.infNFeId).toBe(b.infNFeId)
    expect(a.sha256).toBe(b.sha256)
    expect(Buffer.from(a.exactBytes)).toEqual(Buffer.from(b.exactBytes))
    expect(a.xml).toBe(b.xml)
  })
})

describe("rebuildNfceContingenciaXmlOffline · ausência de rede / Prisma / numerador", () => {
  it("não chama fetch durante o rebuild", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    rebuildNfceContingenciaXmlOffline(rebuildInput())
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("fonte 020B não importa Prisma, numerador, provider SEFAZ, queue ou fetch", () => {
    const dir = join(process.cwd(), "lib/fiscal/contingencia-xml")
    const fontes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    expect(fontes.length).toBeGreaterThan(0)
    for (const arquivo of fontes) {
      const src = readFileSync(join(dir, arquivo), "utf8")
      const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']\.\.\/(numbering|provider|queue|emission)\b/)
      expect(semComentarios, arquivo).not.toMatch(/\bfetch\s*\(/)
      expect(semComentarios, arquivo).not.toMatch(/\bDate\.now\s*\(/)
      expect(semComentarios, arquivo).not.toMatch(/\bMath\.random\s*\(/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']node:(http|https|net|tls)["']/)
    }
  })
})
