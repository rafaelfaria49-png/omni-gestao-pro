/**
 * BL-FISCAL-005 — Assinador XMLDSig da NFC-e (PURO/dormente).
 *
 * Cobre (TAREFA 6): assinatura válida, idempotência (determinismo), mesmo XML → mesma assinatura,
 * XML alterado → assinatura inválida, vault falhando, segredo inexistente, fail-closed, e nenhum
 * segredo em logs. Mais validações (TAREFA 5): sem/já assinado, certificado/senha inválidos,
 * digest/signature inválidos, campos obrigatórios. Usa o XML real de BL-FISCAL-004.
 */
import { createHash, createPublicKey } from "node:crypto"
import { describe, it, expect, vi, afterEach } from "vitest"
import { createQrV3OfflinePemSigner, verifyQrV3OfflineSignature } from "@/lib/fiscal/danfce/qr-v3"
import { buildVendaFiscalSnapshot, type BuildSnapshotInput, type SnapshotLojaInput } from "../venda-fiscal-snapshot"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import { buildNfceXml, buildNfceXmlAssinavel } from "../xml"
import {
  signNfceXml,
  signNfceXmlDetailed,
  verifyNfceSignature,
  isNfceSigned,
  loadCertificateMaterialFromPem,
} from "./nfce-signer"
import { NfceSignError, type FiscalCertificateMaterial } from "./signer.types"
import { EnvVault } from "../vault"
import { canonicalEnvRef } from "../vault"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM, TEST_KEY_ENC_PEM, TEST_CERT_PASSPHRASE } from "./__fixtures__/test-cert"

const AGORA = new Date("2027-06-01T12:00:00.000Z") // dentro da validade do cert de teste
const OPTS = { agora: AGORA }

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

function snapshotInput(): BuildSnapshotInput {
  return {
    storeId: "loja-1",
    vendaId: "venda-1",
    loja: LOJA_OK,
    cliente: null,
    venda: {
      pedidoId: "VDA-2026-0001",
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João",
      terminal: "PDV1",
      paymentBreakdown: { dinheiro: 50 },
    },
    itens: [
      {
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
      },
    ],
  }
}

/** XML do caminho de assinatura/transmissão — embutível, sem declaração. */
function nfceXml(): string {
  const r = buildVendaFiscalSnapshot(snapshotInput())
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXmlAssinavel(r.snapshot, { serie: 1, numero: 42 })
}

/** Mesmo snapshot, contrato de DOCUMENTO standalone (com declaração) — o que o signer recusa. */
function nfceXmlStandalone(): string {
  const r = buildVendaFiscalSnapshot(snapshotInput())
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXml(r.snapshot, { serie: 1, numero: 42 })
}

const CERT_PLAIN: FiscalCertificateMaterial = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)
const CERT_ENC: FiscalCertificateMaterial = loadCertificateMaterialFromPem(TEST_KEY_ENC_PEM, TEST_CERT_PEM)

afterEach(() => vi.restoreAllMocks())

describe("signNfceXml · assinatura válida (chave em claro)", () => {
  it("insere <Signature> envelopada e a verificação confere", () => {
    const xml = nfceXml()
    const r = signNfceXmlDetailed(xml, CERT_PLAIN, "", OPTS)
    expect(r.xml).toContain("<Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\">")
    expect(r.xml).toContain("<X509Certificate>")
    expect(r.referenciaId).toMatch(/^NFe\d{44}$/)
    const v = verifyNfceSignature(r.xml)
    expect(v).toMatchObject({ valido: true, assinado: true, digestConfere: true, assinaturaConfere: true })
    expect(v.referenciaId).toBe(r.referenciaId)
  })

  it("aceita chave cifrada com a senha correta", () => {
    const signed = signNfceXml(nfceXml(), CERT_ENC, TEST_CERT_PASSPHRASE, OPTS)
    expect(verifyNfceSignature(signed).valido).toBe(true)
  })
})

/**
 * Os algoritmos NÃO são preferência nossa: `xmldsig-core-schema_v1.01.xsd` (pacote oficial
 * PL_010e_v1.02, sha256 f56744a5…e1ac) declara `Algorithm` como `fixed` — CanonicalizationMethod
 * (L29), SignatureMethod (L34) e DigestMethod (L52) — e `Transform` com minOccurs=maxOccurs=2 (L69).
 * Qualquer outro valor é XSD-inválido e a SEFAZ rejeita. Ver ADR-0011.
 */
describe("signNfceXml · algoritmos fixados pelo schema oficial (ADR-0011)", () => {
  it("emite exatamente os 4 algoritmos que o schema fixa", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    expect(signed).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">')
    expect(signed).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1">')
    expect(signed).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1">')
    expect(signed).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature">')
    expect(signed).toContain('<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315">')
    // O schema exige EXATAMENTE dois Transform (minOccurs=2 maxOccurs=2).
    expect(signed.match(/<Transform Algorithm=/g)).toHaveLength(2)
  })

  it("o DigestValue é SHA-1 de fato (20 bytes), não SHA-256 (32)", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const digest = signed.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] ?? ""
    expect(Buffer.from(digest, "base64")).toHaveLength(20)
    expect(verifyNfceSignature(signed).digestConfere).toBe(true)
  })

  it("NEGATIVO: não emite os URIs de SHA-256 (o schema os proíbe)", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    expect(signed).not.toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256")
    expect(signed).not.toContain("http://www.w3.org/2001/04/xmlenc#sha256")
  })

  it("NEGATIVO: digest trocado por SHA-256 do mesmo conteúdo não confere", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const sha1Digest = signed.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] ?? ""
    const sha256Digest = createHash("sha256").update(Buffer.from(sha1Digest, "base64")).digest("base64")
    const adulterado = signed.replace(`<DigestValue>${sha1Digest}</DigestValue>`, `<DigestValue>${sha256Digest}</DigestValue>`)
    const v = verifyNfceSignature(adulterado)
    expect(v.digestConfere).toBe(false)
    expect(v.valido).toBe(false)
  })
})

describe("signNfceXml · idempotência / determinismo", () => {
  it("mesmo XML + mesmo certificado → MESMA assinatura (byte-idêntico)", () => {
    const xml = nfceXml()
    const a = signNfceXml(xml, CERT_PLAIN, "", OPTS)
    const b = signNfceXml(xml, CERT_PLAIN, "", OPTS)
    expect(a).toBe(b)
  })

  it("não muta a entrada", () => {
    const xml = nfceXml()
    const copia = String(xml)
    signNfceXml(xml, CERT_PLAIN, "", OPTS)
    expect(xml).toBe(copia)
  })
})

describe("signNfceXml · adulteração detectada", () => {
  it("alterar valor do infNFe após assinar invalida o digest", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const tampered = signed.replace("<vNF>50.00</vNF>", "<vNF>5000.00</vNF>")
    expect(tampered).not.toBe(signed)
    const v = verifyNfceSignature(tampered)
    expect(v.valido).toBe(false)
    expect(v.digestConfere).toBe(false)
    expect(v.problemas).toContain("digest_invalido")
  })

  it("corromper o SignatureValue invalida a assinatura (digest ainda ok)", () => {
    const r = signNfceXmlDetailed(nfceXml(), CERT_PLAIN, "", OPTS)
    const badSig = r.signatureValue.slice(0, -4) + (r.signatureValue.endsWith("AAAA") ? "BBBB" : "AAAA")
    const tampered = r.xml.replace(r.signatureValue, badSig)
    const v = verifyNfceSignature(tampered)
    expect(v.assinaturaConfere).toBe(false)
    expect(v.valido).toBe(false)
  })

  it("rejeita raiz fora do namespace fiscal", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const tampered = signed.replace(
      '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
      '<NFe xmlns="urn:nao-fiscal" xmlns:nfe="http://www.portalfiscal.inf.br/nfe">',
    ).replace("<infNFe ", "<nfe:infNFe ").replace("</infNFe>", "</nfe:infNFe>")
    expect(verifyNfceSignature(tampered)).toMatchObject({ valido: false, problemas: ["xml_invalido"] })
  })

  it("rejeita elementos extras em Transforms e KeyInfo", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const extraTransform = signed.replace(
      "</Transforms>",
      '<extra:Transform xmlns:extra="urn:extra" Algorithm="urn:extra"></extra:Transform></Transforms>',
    )
    expect(verifyNfceSignature(extraTransform).problemas).toContain("estrutura_assinatura_invalida")

    const extraKeyInfo = signed.replace(
      "</KeyInfo>",
      '<extra:KeyValue xmlns:extra="urn:extra"></extra:KeyValue></KeyInfo>',
    )
    expect(verifyNfceSignature(extraKeyInfo).problemas).toContain("estrutura_assinatura_invalida")
  })

  it("rejeita segundo infNFe fiscal mesmo com Id diferente", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    const duplicate = signed.replace(
      "</NFe>",
      '<infNFe Id="NFeSINTETICO-SECUNDARIO"><ide></ide></infNFe></NFe>',
    )
    expect(verifyNfceSignature(duplicate).problemas).toContain("referencia_ambigua")
  })

  it("assina e verifica NFe com prefixo fiscal na raiz", () => {
    const prefixed = nfceXml()
      .replace(
        '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">',
        '<nfe:NFe xmlns:nfe="http://www.portalfiscal.inf.br/nfe" xmlns="http://www.portalfiscal.inf.br/nfe">',
      )
      .replace("</NFe>", "</nfe:NFe>")
    const signed = signNfceXml(prefixed, CERT_PLAIN, "", OPTS)
    expect(signed).toContain("</nfe:NFe>")
    expect(verifyNfceSignature(signed).valido).toBe(true)
  })
})

describe("signNfceXml · validações (TAREFA 5)", () => {
  it("XML sem assinatura → verify retorna nao_assinado; isNfceSigned=false", () => {
    const xml = nfceXml()
    expect(isNfceSigned(xml)).toBe(false)
    expect(verifyNfceSignature(xml)).toMatchObject({ valido: false, assinado: false, problemas: ["nao_assinado"] })
  })

  it("XML já assinado → ja_assinado (a menos de permitirReassinatura)", () => {
    const signed = signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    expect(isNfceSigned(signed)).toBe(true)
    expect(() => signNfceXml(signed, CERT_PLAIN, "", OPTS)).toThrowError(NfceSignError)
    try {
      signNfceXml(signed, CERT_PLAIN, "", OPTS)
    } catch (e) {
      expect((e as NfceSignError).code).toBe("ja_assinado")
    }
    // reassinatura permitida → 1 única assinatura e válida
    const resigned = signNfceXml(signed, CERT_PLAIN, "", { ...OPTS, permitirReassinatura: true })
    expect((resigned.match(/<Signature /g) ?? []).length).toBe(1)
    expect(verifyNfceSignature(resigned).valido).toBe(true)
  })

  it("certificado inválido → certificado_invalido", () => {
    const ruim = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, "-----BEGIN CERTIFICATE-----\nLIXO\n-----END CERTIFICATE-----")
    expect(() => signNfceXml(nfceXml(), ruim, "", OPTS)).toThrowError(/certificado/i)
  })

  it("senha inválida (chave cifrada) → senha_invalida", () => {
    try {
      signNfceXml(nfceXml(), CERT_ENC, "senha-errada", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("senha_invalida")
    }
  })

  it("material ausente → material_ausente", () => {
    const vazio = { privateKeyPem: "", certificatePem: "" }
    try {
      signNfceXml(nfceXml(), vazio, "", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("material_ausente")
    }
  })

  it("XML sem <infNFe> → sem_infnfe; sem Id → infnfe_sem_id", () => {
    try {
      signNfceXml(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><x>1</x></NFe>`, CERT_PLAIN, "", OPTS)
    } catch (e) {
      expect((e as NfceSignError).code).toBe("sem_infnfe")
    }
    try {
      signNfceXml(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><x>1</x></infNFe></NFe>`, CERT_PLAIN, "", OPTS)
    } catch (e) {
      expect((e as NfceSignError).code).toBe("infnfe_sem_id")
    }
  })

  it("certificado fora de validade → certificado_expirado (e ignorarValidade contorna)", () => {
    const noPassado = { agora: new Date("2000-01-01T00:00:00.000Z") }
    expect(() => signNfceXml(nfceXml(), CERT_PLAIN, "", noPassado)).toThrowError(/expirad|válid/i)
    expect(() => signNfceXml(nfceXml(), CERT_PLAIN, "", { ignorarValidade: true })).not.toThrow()
  })
})

/**
 * GOAL-016D-C0 — o contrato embutível é conferido ANTES de assinar.
 *
 * Depois de assinado não há correção possível: mexer nos bytes quebra o XMLDSig e diverge do hash
 * persistido (ADR-0017/0018). Por isso o signer é a última porta em que recusar ainda é barato.
 */
describe("signNfceXml · contrato embutível pré-assinatura (GOAL-016D-C0)", () => {
  it("recusa XML de documento standalone (com declaração) → xml_nao_embutivel", () => {
    const standalone = nfceXmlStandalone()
    expect(standalone.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    try {
      signNfceXml(standalone, CERT_PLAIN, "", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("xml_nao_embutivel")
    }
  })

  it.each([
    ["declaração na posição 0", `<?xml version="1.0"?>`, ""],
    ["declaração aninhada na raiz", "", `<?xml version="1.0"?>`],
  ])("recusa %s", (_nome, prefixo, dentro) => {
    const xml = `${prefixo}<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${dentro}<infNFe Id="NFeX"><x>1</x></infNFe></NFe>`
    try {
      signNfceXml(xml, CERT_PLAIN, "", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("xml_nao_embutivel")
    }
  })

  it("recusa BOM — que `parseXml` descartaria só na cópia e sobreviveria nos bytes assinados", () => {
    const comBom = `${String.fromCharCode(0xfeff)}${nfceXml()}`
    try {
      signNfceXml(comBom, CERT_PLAIN, "", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("xml_nao_embutivel")
    }
  })

  it("recusa espaço fora da raiz", () => {
    try {
      signNfceXml(`\n  ${nfceXml()}\n`, CERT_PLAIN, "", OPTS)
      throw new Error("deveria ter lançado")
    } catch (e) {
      expect((e as NfceSignError).code).toBe("xml_nao_embutivel")
    }
  })

  it("permitirDocumentoStandalone libera a prova standalone sem alterar os bytes recebidos", () => {
    const standalone = nfceXmlStandalone()
    const signed = signNfceXml(standalone, CERT_PLAIN, "", { ...OPTS, permitirDocumentoStandalone: true })
    // A declaração continua exatamente onde estava: o signer não remove nada.
    expect(signed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(signed.slice(0, standalone.indexOf("</NFe>"))).toBe(standalone.slice(0, standalone.indexOf("</NFe>")))
    expect(verifyNfceSignature(signed).valido).toBe(true)
  })
})

describe("assinatura via cofre (EnvVault) — fail-closed e vault falhando", () => {
  const STORE = "loja-1"
  const PFX_REF = canonicalEnvRef("pfx", STORE)
  const SENHA_REF = canonicalEnvRef("senha", STORE)

  it("segredo inexistente no cofre → resolve null → caller NÃO assina (fail-closed)", async () => {
    const vault = new EnvVault({ env: {} })
    const pfx = await vault.getCertificadoPfx(STORE, PFX_REF)
    const senha = await vault.getCertificadoSenha(STORE, SENHA_REF)
    expect(pfx).toBeNull()
    expect(senha).toBeNull()
    // Sem material → o assinador recusa (não emite).
    expect(() => signNfceXml(nfceXml(), { privateKeyPem: "", certificatePem: "" }, "", OPTS)).toThrowError(NfceSignError)
  })

  it("vault falhando (escrita não suportada no piloto) → operacao_nao_suportada", async () => {
    const vault = new EnvVault({ env: {} })
    await expect(vault.putCertificadoPfx(STORE, Buffer.from("x"), "p")).rejects.toMatchObject({
      code: "operacao_nao_suportada",
    })
  })
})

describe("nenhum segredo em logs", () => {
  it("não escreve senha nem chave privada em console; erros não vazam segredo", () => {
    const sink: string[] = []
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        sink.push(args.map(String).join(" "))
      })
    }
    // caminho feliz + caminho de erro com senha errada
    signNfceXml(nfceXml(), CERT_PLAIN, "", OPTS)
    let errMsg = ""
    try {
      signNfceXml(nfceXml(), CERT_ENC, TEST_CERT_PASSPHRASE + "-x", OPTS)
    } catch (e) {
      errMsg = (e as Error).message
    }
    const all = sink.join("\n")
    expect(all).not.toContain(TEST_CERT_PASSPHRASE)
    expect(all).not.toContain("PRIVATE KEY")
    expect(errMsg).not.toContain(TEST_CERT_PASSPHRASE)
    expect(errMsg).not.toContain("PRIVATE KEY")
  })
})

const QR_ONLINE_V3 = {
  qrCodeBaseUrl: "https://qr.example.test/nfce",
  urlChave: "https://qr.example.test/consulta",
} as const

function nfceXmlQrOnline(): string {
  const r = buildVendaFiscalSnapshot(snapshotInput())
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXmlAssinavel(r.snapshot, { serie: 1, numero: 42, qrOnlineV3: { ...QR_ONLINE_V3 } })
}

function nfeChildOpenings(xml: string): string[] {
  return [...xml.matchAll(/<(infNFeSupl|infNFe|Signature)(?:\s|>)/g)].map((m) => m[1] ?? "")
}

describe("signNfceXml · infNFeSupl QR v3 online não entra no digest", () => {
  it("infNFe continua o único alvo; DigestValue ignora infNFeSupl; Signature vem depois", () => {
    const xmlSemQr = nfceXml()
    const xmlComQr = nfceXmlQrOnline()
    expect(xmlComQr).toContain("<infNFeSupl>")
    expect(xmlComQr).not.toContain("<Signature")
    expect(nfeChildOpenings(xmlComQr)).toEqual(["infNFe", "infNFeSupl"])

    const infSem = xmlSemQr.match(/<infNFe[\s\S]*?<\/infNFe>/)?.[0]
    const infCom = xmlComQr.match(/<infNFe[\s\S]*?<\/infNFe>/)?.[0]
    expect(infSem).toBe(infCom)

    const signedSem = signNfceXmlDetailed(xmlSemQr, CERT_PLAIN, "", OPTS)
    const signedCom = signNfceXmlDetailed(xmlComQr, CERT_PLAIN, "", OPTS)
    expect(signedCom.digestValue).toBe(signedSem.digestValue)
    expect(signedCom.referenciaId).toBe(signedSem.referenciaId)
    expect(signedCom.xml).toContain(`<Reference URI="#${signedCom.referenciaId}">`)
    expect(nfeChildOpenings(signedCom.xml)).toEqual(["infNFe", "infNFeSupl", "Signature"])
    expect(signedCom.xml.indexOf("<infNFeSupl>")).toBeGreaterThan(signedCom.xml.indexOf("</infNFe>"))
    expect(signedCom.xml.indexOf("<Signature")).toBeGreaterThan(signedCom.xml.indexOf("</infNFeSupl>"))

    const v = verifyNfceSignature(signedCom.xml)
    expect(v).toMatchObject({ valido: true, assinado: true, digestConfere: true, assinaturaConfere: true })
    expect(v.referenciaId).toBe(signedCom.referenciaId)
  })

  it("adulterar infNFeSupl não invalida a assinatura; adulterar infNFe invalida o digest", () => {
    const signed = signNfceXml(nfceXmlQrOnline(), CERT_PLAIN, "", OPTS)
    const suplTocado = signed.replace(`<urlChave>${QR_ONLINE_V3.urlChave}</urlChave>`, "<urlChave>https://qr.example.test/outra-consulta</urlChave>")
    expect(suplTocado).not.toBe(signed)
    expect(verifyNfceSignature(suplTocado)).toMatchObject({
      valido: true,
      digestConfere: true,
      assinaturaConfere: true,
    })

    const infTocado = signed.replace("<vNF>50.00</vNF>", "<vNF>5000.00</vNF>")
    const v = verifyNfceSignature(infTocado)
    expect(v.valido).toBe(false)
    expect(v.digestConfere).toBe(false)
  })
})

const QR_OFFLINE_SIGN = createQrV3OfflinePemSigner(TEST_KEY_PLAIN_PEM)
const QR_OFFLINE_V3 = {
  qrCodeBaseUrl: "https://qr.example.test/nfce",
  urlChave: "https://qr.example.test/consulta",
  sign: QR_OFFLINE_SIGN,
} as const

function nfceXmlQrOffline(): string {
  const r = buildVendaFiscalSnapshot(snapshotInput())
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXmlAssinavel(r.snapshot, { serie: 1, numero: 42, tpEmis: 9, qrOfflineV3: { ...QR_OFFLINE_V3 } })
}

describe("signNfceXml · infNFeSupl QR v3 offline não entra no digest", () => {
  const qrPublicKey = createPublicKey(TEST_CERT_PEM)

  it("QR offline e XMLDSig são assinaturas distintas; Signature vem depois de infNFeSupl", () => {
    const xml = nfceXmlQrOffline()
    expect(xml).toContain("<infNFeSupl>")
    expect(xml).not.toContain("<Signature")
    expect(nfeChildOpenings(xml)).toEqual(["infNFe", "infNFeSupl"])

    const qrCode = xml.match(/<qrCode>([^<]+)<\/qrCode>/)?.[1] ?? ""
    const p = qrCode.split("?p=")[1] ?? ""
    const segs = p.split("|")
    expect(segs.length).toBeGreaterThanOrEqual(8)
    const canonical = segs.slice(0, 7).join("|")
    const assinaturaQr = segs.slice(7).join("|")
    expect(verifyQrV3OfflineSignature(canonical, assinaturaQr, qrPublicKey)).toBe(true)

    const signed = signNfceXmlDetailed(xml, CERT_PLAIN, "", OPTS)
    expect(nfeChildOpenings(signed.xml)).toEqual(["infNFe", "infNFeSupl", "Signature"])
    expect(signed.xml).toContain(`<Reference URI="#${signed.referenciaId}">`)
    const v = verifyNfceSignature(signed.xml)
    expect(v).toMatchObject({ valido: true, digestConfere: true, assinaturaConfere: true })
    expect(signed.xml.indexOf("<Signature")).toBeGreaterThan(signed.xml.indexOf("</infNFeSupl>"))
  })

  it("DigestValue é só infNFe: adulterar infNFeSupl não invalida XMLDSig", () => {
    const signed = signNfceXml(nfceXmlQrOffline(), CERT_PLAIN, "", OPTS)
    const tocado = signed.replace(`<urlChave>${QR_OFFLINE_V3.urlChave}</urlChave>`, "<urlChave>https://qr.example.test/outra-consulta</urlChave>")
    expect(tocado).not.toBe(signed)
    expect(verifyNfceSignature(tocado)).toMatchObject({ valido: true, digestConfere: true, assinaturaConfere: true })
    const infTocado = signed.replace("<vNF>50.00</vNF>", "<vNF>5000.00</vNF>")
    expect(verifyNfceSignature(infTocado).digestConfere).toBe(false)
  })
})
