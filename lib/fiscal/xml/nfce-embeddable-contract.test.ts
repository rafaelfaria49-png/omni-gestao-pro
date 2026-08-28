/**
 * GOAL-016D-C0 — contrato do XML fiscal EMBUTÍVEL, da produção ao envelope SOAP.
 *
 * Prova, offline e sem segredo, que os bytes destinados a assinatura/transmissão nascem
 * embutíveis (sem declaração, sem BOM, raiz única, sem espaço fora dela), sobrevivem intactos à
 * assinatura XMLDSig e chegam byte-idênticos ao `nfeDadosMsg` do envelope — e que NADA é removido
 * depois de assinado. Também fixa que o contrato de DOCUMENTO standalone não mudou.
 *
 * Todo material é sintético: certificado de teste auto-assinado descartável e snapshot golden do
 * dry-run. Nenhum certificado, CNPJ, IE ou chave real.
 */
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { createQrV3OfflinePemSigner } from "@/lib/fiscal/danfce/qr-v3"
import { childElements, parseXml } from "../signing/c14n"
import { NfceSignError } from "../signing/signer.types"
import { signNfceXmlDetailed, verifyNfceSignature } from "../signing/nfce-signer"
import { DRY_RUN_TEST_CERT, dryRunSnapshot } from "../dry-run"
import type { FiscalDocumentIdentity } from "../emission/uncertain-state.types"
import {
  buildSefazSoap12Envelope,
  extractFiscalBytes,
} from "../provider/sefaz/sefaz-envelope"
import {
  runSefazPreTransportGuards,
  type SefazGuardPorts,
} from "../provider/sefaz/sefaz-guards"
import { buildNfceXml, buildNfceXmlAssinavel, buildNfceXmlAssinavelResult } from "./nfce-xml-builder"
import {
  XmlEmbeddableContractError,
  assertEmbeddableXml,
  serializeXmlDocument,
  serializeXmlEmbeddable,
  xmlEmbeddableViolation,
} from "./xml-writer"

const CTX = { serie: 1, numero: 42 }
const BOM = String.fromCharCode(0xfeff)
const DECLARACAO = '<?xml version="1.0" encoding="UTF-8"?>'

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function sha256Hex(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex")
}

// ── Serializador genérico: contrato standalone PRESERVADO ───────────────────────────────────

describe("serializeXmlDocument · comportamento standalone inalterado", () => {
  it("mantém a declaração por default", () => {
    expect(serializeXmlDocument({ tag: "NFe" })).toBe(`${DECLARACAO}\n<NFe/>`)
  })

  it("mantém `declaration: false` devolvendo só o corpo", () => {
    expect(serializeXmlDocument({ tag: "NFe" }, { declaration: false })).toBe("<NFe/>")
  })

  it("mantém a indentação determinística de 2 espaços", () => {
    const xml = serializeXmlDocument({ tag: "a", children: [{ tag: "b", text: "1" }] })
    expect(xml).toBe(`${DECLARACAO}\n<a>\n  <b>1</b>\n</a>`)
  })
})

// ── Contrato embutível ──────────────────────────────────────────────────────────────────────

describe("serializeXmlEmbeddable · contrato do fragmento", () => {
  it("não emite declaração nem BOM e é determinístico", () => {
    const a = serializeXmlEmbeddable({ tag: "NFe", children: [{ tag: "infNFe", text: "x" }] })
    const b = serializeXmlEmbeddable({ tag: "NFe", children: [{ tag: "infNFe", text: "x" }] })
    expect(a).toBe(b)
    expect(a.includes("<?xml")).toBe(false)
    expect(a.includes(BOM)).toBe(false)
    expect(a).toBe(serializeXmlDocument({ tag: "NFe", children: [{ tag: "infNFe", text: "x" }] }, { declaration: false }))
  })

  it("não deixa espaço fora da raiz", () => {
    const xml = serializeXmlEmbeddable({ tag: "NFe", children: [{ tag: "infNFe", text: "x" }] })
    expect(xml.trim()).toBe(xml)
    expect(xml.startsWith("<NFe")).toBe(true)
    expect(xml.endsWith(">")).toBe(true)
  })

  it("escapa `<?xml` que venha como DADO — texto legítimo não vira violação", () => {
    const xml = serializeXmlEmbeddable({ tag: "NFe", children: [{ tag: "infCpl", text: `<?xml fake?>` }] })
    expect(xml).toContain("&lt;?xml fake?&gt;")
    expect(xml.includes("<?xml")).toBe(false)
  })
})

describe("xmlEmbeddableViolation · o contrato é só leitura, nunca transformação", () => {
  it("recusa entrada vazia ou só com espaço", () => {
    expect(xmlEmbeddableViolation("")).toBe("vazio")
    expect(xmlEmbeddableViolation("   ")).toBe("vazio")
  })

  it.each([
    ["declaração na posição 0", `${DECLARACAO}<NFe/>`, "declaracao_xml"],
    ["decoy antes da declaração", `<!--x--><?xml version="1.0"?><NFe/>`, "declaracao_xml"],
    ["declaração aninhada na raiz", `<NFe><?xml version="1.0"?><infNFe/></NFe>`, "declaracao_xml"],
    ["declaração no fim", `<NFe/><?xml version="1.0"?>`, "declaracao_xml"],
    ["BOM", `${BOM}<NFe/>`, "bom_presente"],
    ["espaço antes da raiz", "\n  <NFe/>", "espaco_fora_da_raiz"],
    ["espaço depois da raiz", "<NFe/>\n", "espaco_fora_da_raiz"],
    ["abre em comentário", "<!--x-->", "raiz_ausente"],
    ["surrogate solto", `<NFe>${String.fromCharCode(0xd800)}</NFe>`, "utf8_invalido"],
    // Família que atravessava o contrato: lixo DEPOIS da raiz, sem `<?xml`, começando em `<` e
    // terminando em `>`. O backstop do envelope não pega — `childElements` ignora comentário e PI.
    ["comentário depois da raiz", `<NFe><infNFe Id="X"/></NFe><!--x-->`, "conteudo_fora_da_raiz"],
    ["PI de alvo não reservado depois da raiz", `<NFe><infNFe Id="X"/></NFe><?evil d?>`, "conteudo_fora_da_raiz"],
    ["segunda raiz", `<NFe/><NFe2/>`, "conteudo_fora_da_raiz"],
    ["segunda raiz com conteúdo", `<NFe><a/></NFe><Outra><b/></Outra>`, "conteudo_fora_da_raiz"],
  ])("recusa %s", (_nome, entrada, codigo) => {
    expect(xmlEmbeddableViolation(entrada)).toBe(codigo)
    expect(() => assertEmbeddableXml(entrada)).toThrow(XmlEmbeddableContractError)
  })

  it("aceita fragmento legítimo e devolve os MESMOS bytes (nenhuma normalização)", () => {
    const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFeX"/></NFe>`
    expect(xmlEmbeddableViolation(xml)).toBeNull()
    expect(() => assertEmbeddableXml(xml)).not.toThrow()
  })

  it.each([
    ["tag vazia única", `<NFe/>`],
    ["tag vazia com atributos", `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"/>`],
    ["raiz com prefixo", `<nfe:NFe xmlns:nfe="urn:x"><infNFe Id="X"/></nfe:NFe>`],
    ["comentário DENTRO da raiz", `<NFe><!--legítimo--><infNFe Id="X"/></NFe>`],
  ])("não vira falso positivo: %s", (_nome, entrada) => {
    expect(xmlEmbeddableViolation(entrada)).toBeNull()
  })
})

/**
 * O guard do signer herda o contrato — inclusive a checagem de conteúdo fora da raiz. Sem ela,
 * `insertSignatureIntoNFe` (que insere por `lastIndexOf("</NFe>")`) preservaria o lixo, ele seria
 * hasheado, persistido e chegaria intacto ao `nfeDadosMsg`.
 */
describe("signer · lixo depois da raiz não vira xmlAssinado", () => {
  it.each([
    ["comentário", "<!--carga-injetada-->"],
    ["PI de alvo não reservado", "<?carga d?>"],
    ["segunda raiz", "<Outra/>"],
  ])("recusa %s colado após </NFe>", (_nome, sufixo) => {
    const sujo = `${buildNfceXmlAssinavel(dryRunSnapshot("simples"), CTX)}${sufixo}`
    expect(xmlEmbeddableViolation(sujo)).toBe("conteudo_fora_da_raiz")
    expect(() => signNfceXmlDetailed(sujo, DRY_RUN_TEST_CERT, "", { ignorarValidade: true }))
      .toThrow(NfceSignError)
  })
})

// ── Produtor canônico da NFC-e ──────────────────────────────────────────────────────────────

describe("buildNfceXmlAssinavel · produtor do caminho de assinatura/transmissão", () => {
  const assinavel = () => buildNfceXmlAssinavel(dryRunSnapshot("simples"), CTX)

  it("não gera declaração e não gera BOM", () => {
    const xml = assinavel()
    expect(xml.includes("<?xml")).toBe(false)
    expect(xml.includes(BOM)).toBe(false)
    expect(xmlEmbeddableViolation(xml)).toBeNull()
  })

  it("gera exatamente uma raiz `<NFe>` com um único `<infNFe>` (verificado com parser real)", () => {
    const raiz = parseXml(assinavel())
    expect(raiz.name).toBe("NFe")
    expect(childElements(raiz).length).toBe(1)
    expect(childElements(raiz, "infNFe", "http://www.portalfiscal.inf.br/nfe").length).toBe(1)
  })

  it("QR online v3 opt-in permanece embutível com infNFeSupl irmão de infNFe", () => {
    const xml = buildNfceXmlAssinavel(dryRunSnapshot("simples"), {
      ...CTX,
      qrOnlineV3: {
        qrCodeBaseUrl: "https://qr.example.test/nfce",
        urlChave: "https://qr.example.test/consulta",
      },
    })
    expect(xmlEmbeddableViolation(xml)).toBeNull()
    expect(xml.includes("<?xml")).toBe(false)
    const raiz = parseXml(xml)
    const filhos = childElements(raiz).map((el) => el.name)
    expect(filhos).toEqual(["infNFe", "infNFeSupl"])
    expect(xml).not.toContain("<Signature")
  })

  it("QR offline v3 opt-in permanece embutível com infNFeSupl já presente antes da XMLDSig", () => {
    const xml = buildNfceXmlAssinavel(dryRunSnapshot("simples"), {
      ...CTX,
      tpEmis: 9,
      dhCont: "2026-08-28T13:00:00Z",
      xJust: "Falha de comunicação com a SEFAZ",
      qrOfflineV3: {
        qrCodeBaseUrl: "https://qr.example.test/nfce",
        urlChave: "https://qr.example.test/consulta",
        sign: createQrV3OfflinePemSigner(DRY_RUN_TEST_CERT.privateKeyPem),
      },
    })
    expect(xmlEmbeddableViolation(xml)).toBeNull()
    expect(xml.includes("<?xml")).toBe(false)
    const filhos = childElements(parseXml(xml)).map((el) => el.name)
    expect(filhos).toEqual(["infNFe", "infNFeSupl"])
    expect(xml).toContain("<tpEmis>9</tpEmis>")
    expect(xml).not.toContain("<Signature")
  })

  it("é determinístico e bytewise estável", () => {
    expect(assinavel()).toBe(assinavel())
    expect(sha256Hex(bytes(assinavel()))).toBe(sha256Hex(bytes(assinavel())))
  })

  it("difere do standalone SOMENTE pela declaração — o conteúdo fiscal é idêntico", () => {
    const standalone = buildNfceXml(dryRunSnapshot("simples"), CTX)
    expect(standalone).toBe(`${DECLARACAO}\n${assinavel()}`)
  })

  it("devolve o mesmo diagnóstico rico que o builder standalone", () => {
    const r = buildNfceXmlAssinavelResult(dryRunSnapshot("simples"), CTX)
    expect(r.chaveAcesso).toHaveLength(44)
    expect(r.numeracaoPlaceholder).toBe(false)
    expect(r.validacao.ok).toBe(true)
  })

  it("`omitDeclaration` no builder standalone cai no MESMO produtor provado", () => {
    const viaFlag = buildNfceXml(dryRunSnapshot("simples"), { ...CTX, omitDeclaration: true })
    expect(viaFlag).toBe(buildNfceXmlAssinavel(dryRunSnapshot("simples"), CTX))
  })

  it("não muta o snapshot congelado", () => {
    const snapshot = dryRunSnapshot("simples")
    const copia = JSON.parse(JSON.stringify(snapshot))
    buildNfceXmlAssinavel(snapshot, CTX)
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(copia)
  })
})

describe("buildNfceXml · contrato standalone histórico preservado", () => {
  it("continua emitindo a declaração na posição 0", () => {
    expect(buildNfceXml(dryRunSnapshot("simples"), CTX).startsWith(DECLARACAO)).toBe(true)
  })
})

// ── Regressão ponta a ponta, offline ────────────────────────────────────────────────────────

const LOJA_PILOTO = "store-piloto-sintetica"

function documento(chaveAcesso: string): FiscalDocumentIdentity {
  return {
    storeId: LOJA_PILOTO,
    vendaId: "venda-embeddable-c0",
    notaFiscalId: "nota-embeddable-c0",
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: CTX.serie,
    numero: CTX.numero,
    chaveAcesso,
    uf: "SP",
    correlationId: "corr-embeddable-c0",
  }
}

function portas(): SefazGuardPorts {
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
      certificadoId: "cert-sintetico",
      blobRef: "FISCAL_A1_PFX_B64_SINTETICO",
      senhaRef: "FISCAL_A1_SENHA_SINTETICO",
      provider: "env-sintetico",
    })),
  }
}

/**
 * Cadeia completa: snapshot sintético → XML embutível → assinatura com material de teste →
 * hash dos bytes → guards pré-transporte → envelope SOAP → prova de byte-exatidão.
 */
describe("e2e offline · produzir → assinar → hashear → envelopar sem alterar um byte", () => {
  const built = buildNfceXmlAssinavelResult(dryRunSnapshot("simples"), CTX)
  const assinado = signNfceXmlDetailed(built.xml, DRY_RUN_TEST_CERT, "", { ignorarValidade: true })
  const bytesAssinados = bytes(assinado.xml)
  const bytesSha256 = sha256Hex(bytesAssinados)

  it("a assinatura preserva o prefixo do XML produzido e só insere `<Signature>`", () => {
    const corte = built.xml.lastIndexOf("</NFe>")
    expect(assinado.xml.slice(0, corte)).toBe(built.xml.slice(0, corte))
    expect(assinado.xml.endsWith("</NFe>")).toBe(true)
    // Nada foi removido: o assinado é o produzido com a Signature enxertada antes do fecho.
    expect(assinado.xml.replace(/<Signature[\s\S]*<\/Signature>/, "")).toBe(built.xml)
  })

  it("o XML assinado continua satisfazendo o contrato embutível", () => {
    expect(xmlEmbeddableViolation(assinado.xml)).toBeNull()
    expect(assinado.xml.includes("<?xml")).toBe(false)
  })

  it("digest e SignatureValue continuam verificáveis sobre os bytes assinados", () => {
    const v = verifyNfceSignature(assinado.xml)
    expect(v).toMatchObject({ valido: true, assinado: true, digestConfere: true, assinaturaConfere: true })
    expect(v.referenciaId).toBe(`NFe${built.chaveAcesso}`)
    expect(assinado.digestValue).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it("o hash conferido corresponde exatamente aos bytes assinados", () => {
    expect(sha256Hex(bytes(assinado.xml))).toBe(bytesSha256)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytesAssinados)).toBe(assinado.xml)
  })

  it("os guards pré-transporte aprovam os mesmos bytes", async () => {
    const r = await runSefazPreTransportGuards({
      document: documento(built.chaveAcesso),
      exactBytes: bytesAssinados,
      bytesSha256,
      servico: "NFeAutorizacao4",
      ports: portas(),
    })
    expect(r.ok).toBe(true)
  })

  it("o envelope SOAP aceita os bytes e os devolve BYTE-IDÊNTICOS", () => {
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: bytesAssinados })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const devolvidos = extractFiscalBytes(r.envelope)
    expect(Buffer.from(devolvidos).equals(Buffer.from(bytesAssinados))).toBe(true)
    expect(sha256Hex(devolvidos)).toBe(bytesSha256)
  })

  it("o mesmo documento produzido como standalone seria RECUSADO — a origem é que corrige", () => {
    const standalone = buildNfceXml(dryRunSnapshot("simples"), CTX)
    // 1) o signer barra antes de assinar;
    expect(() => signNfceXmlDetailed(standalone, DRY_RUN_TEST_CERT, "", { ignorarValidade: true }))
      .toThrow(NfceSignError)
    // 2) e, se alguém contornasse o signer, o envelope ainda recusaria — sem remover nada.
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: bytes(standalone) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
  })
})

describe("e2e QR offline v3 · infNFeSupl presente → XMLDSig → bytes finais estáveis", () => {
  const ctxOff = {
    ...CTX,
    tpEmis: 9,
    dhCont: "2026-08-28T13:00:00Z",
    xJust: "Falha de comunicação com a SEFAZ",
    qrOfflineV3: {
      qrCodeBaseUrl: "https://qr.example.test/nfce",
      urlChave: "https://qr.example.test/consulta",
      sign: createQrV3OfflinePemSigner(DRY_RUN_TEST_CERT.privateKeyPem),
    },
  }
  const built = buildNfceXmlAssinavelResult(dryRunSnapshot("simples"), ctxOff)
  const assinado = signNfceXmlDetailed(built.xml, DRY_RUN_TEST_CERT, "", { ignorarValidade: true })
  const bytesAssinados = bytes(assinado.xml)
  const bytesSha256 = sha256Hex(bytesAssinados)

  it("infNFeSupl já está no XML embutível antes de assinar", () => {
    expect(built.xml).toContain("<infNFeSupl>")
    expect(built.xml).not.toContain("<Signature")
    expect(xmlEmbeddableViolation(built.xml)).toBeNull()
  })

  it("a assinatura XMLDSig só insere Signature; o prefixo com infNFeSupl não é reserializado", () => {
    const corte = built.xml.lastIndexOf("</NFe>")
    expect(assinado.xml.slice(0, corte)).toBe(built.xml.slice(0, corte))
    expect(assinado.xml.replace(/<Signature[\s\S]*<\/Signature>/, "")).toBe(built.xml)
    expect(childElements(parseXml(assinado.xml)).map((el) => el.name)).toEqual(["infNFe", "infNFeSupl", "Signature"])
  })

  it("os bytes assinados são o contrato final: hash estável e envelope devolve os mesmos bytes", () => {
    expect(verifyNfceSignature(assinado.xml).valido).toBe(true)
    expect(sha256Hex(bytes(assinado.xml))).toBe(bytesSha256)
    const env = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: bytesAssinados })
    expect(env.ok).toBe(true)
    if (!env.ok) return
    expect(Buffer.from(extractFiscalBytes(env.envelope)).equals(Buffer.from(bytesAssinados))).toBe(true)
  })
})
