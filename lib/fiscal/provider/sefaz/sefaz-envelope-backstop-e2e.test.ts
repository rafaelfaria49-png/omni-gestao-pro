/**
 * GOAL-016D-C1 — regressão ponta a ponta OFFLINE do backstop do envelope.
 *
 * Percorre o caminho real, sem rede, sem SEFAZ, sem A1 de produção e sem banco:
 *
 *   snapshot sintético → XML embutível → assinatura de teste → backstop do adapter
 *   → envelope SOAP → extração de `nfeDadosMsg` → comparação byte a byte
 *
 * O ponto da suíte é provar que o endurecimento do backstop (rejeitar conteúdo fora da raiz)
 * NÃO custou nada ao caminho legítimo: os bytes assinados atravessam intactos e a assinatura
 * continua verificável DEPOIS de passar pelo envelope.
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it, vi, afterEach } from "vitest"
import { buildVendaFiscalSnapshot, type BuildSnapshotInput, type SnapshotLojaInput } from "@/lib/fiscal/venda-fiscal-snapshot"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import { buildNfceXmlAssinavel } from "@/lib/fiscal/xml"
import { signNfceXmlDetailed, verifyNfceSignature, loadCertificateMaterialFromPem } from "@/lib/fiscal/signing/nfce-signer"
import { TEST_CERT_PEM, TEST_KEY_PLAIN_PEM } from "@/lib/fiscal/signing/__fixtures__/test-cert"
import { buildSefazSoap12Envelope, extractFiscalBytes } from "./sefaz-envelope"

const AGORA = new Date("2027-06-01T12:00:00.000Z") // dentro da validade do certificado de teste
const CERT = loadCertificateMaterialFromPem(TEST_KEY_PLAIN_PEM, TEST_CERT_PEM)

const LOJA: SnapshotLojaInput = {
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
    vendaId: "venda-c1",
    loja: LOJA,
    cliente: null,
    venda: {
      pedidoId: "VDA-2026-0001",
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João",
      terminal: "PDV1",
      paymentBreakdown: null,
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

/** XML canônico embutível do snapshot sintético — o mesmo produtor do caminho de transmissão. */
function xmlEmbutivel(): string {
  const r = buildVendaFiscalSnapshot(snapshotInput())
  if (!r.ok) throw new Error(`snapshot inválido: ${r.code}`)
  return buildNfceXmlAssinavel(r.snapshot, { serie: 1, numero: 42 })
}

const XML_ASSINADO = signNfceXmlDetailed(xmlEmbutivel(), CERT, "", { agora: AGORA })
const BYTES_ASSINADOS = new TextEncoder().encode(XML_ASSINADO.xml)

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex")
}

/**
 * Recorta o corpo de `nfeDadosMsg` procurando as MARCAS no envelope, sem usar
 * `fiscalBytesOffset`. Assim a comparação byte a byte não se auto-confirma com o offset que o
 * próprio builder registrou.
 */
function corpoDeNfeDadosMsg(envelopeBytes: Uint8Array): Uint8Array {
  const texto = new TextDecoder("utf-8", { fatal: true }).decode(envelopeBytes)
  const abre = texto.indexOf(">", texto.indexOf("<nfeDadosMsg")) + 1
  const fecha = texto.lastIndexOf("</nfeDadosMsg>")
  if (abre <= 0 || fecha < abre) throw new Error("nfeDadosMsg não localizado no envelope")
  // Recorte em BYTES (o prefixo é ASCII puro, mas o corpo tem acentos — recortar por índice de
  // string sobre bytes seria errado; por isso reencodamos as fatias delimitadas).
  const prefixoBytes = new TextEncoder().encode(texto.slice(0, abre)).length
  const corpoBytes = new TextEncoder().encode(texto.slice(abre, fecha)).length
  return envelopeBytes.slice(prefixoBytes, prefixoBytes + corpoBytes)
}

afterEach(() => vi.restoreAllMocks())

describe("ponta a ponta offline: snapshot → XML → assinatura → backstop → envelope", () => {
  it("o XML assinado do caminho canônico atravessa o backstop endurecido", () => {
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: BYTES_ASSINADOS })
    if (!r.ok) throw new Error(`caminho legítimo recusado: ${r.codigo} — ${r.mensagem}`)
    expect(r.envelope.contentType).toBe("application/soap+xml; charset=utf-8")
  })

  it("os bytes extraídos de nfeDadosMsg são IDÊNTICOS aos bytes assinados", () => {
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: BYTES_ASSINADOS })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const doCorpo = corpoDeNfeDadosMsg(r.envelope.bytes)
    const doOffset = extractFiscalBytes(r.envelope)

    expect(Buffer.from(doCorpo).equals(Buffer.from(BYTES_ASSINADOS))).toBe(true)
    expect(Buffer.from(doOffset).equals(Buffer.from(BYTES_ASSINADOS))).toBe(true)
    expect(sha256(doCorpo)).toBe(sha256(BYTES_ASSINADOS))
    for (let i = 0; i < BYTES_ASSINADOS.length; i += 1) expect(doCorpo[i]).toBe(BYTES_ASSINADOS[i])
  })

  it("digest e SignatureValue continuam verificáveis nos bytes que saem do envelope", () => {
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: BYTES_ASSINADOS })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const devolvido = new TextDecoder("utf-8", { fatal: true }).decode(corpoDeNfeDadosMsg(r.envelope.bytes))
    const v = verifyNfceSignature(devolvido)
    expect(v).toMatchObject({ valido: true, assinado: true, digestConfere: true, assinaturaConfere: true })
    expect(devolvido).toContain(`<DigestValue>${XML_ASSINADO.digestValue}</DigestValue>`)
    expect(devolvido).toContain(`<SignatureValue>${XML_ASSINADO.signatureValue}</SignatureValue>`)
  })

  it("adulterar o XML assinado com conteúdo externo é RECUSADO antes do transporte", () => {
    /**
     * O cenário que o GOAL fecha: alguém anexa material fora da raiz DEPOIS da assinatura.
     * O XMLDSig não protege contra isso (o digest cobre `infNFe`, não as bordas do documento),
     * então quem precisa recusar é o adapter — e agora recusa sozinho.
     */
    const anexos = [
      `${XML_ASSINADO.xml}<!--carga oculta-->`,
      `${XML_ASSINADO.xml}<?pi carga?>`,
      `${XML_ASSINADO.xml} `,
      `<!--antes-->${XML_ASSINADO.xml}`,
      `${XML_ASSINADO.xml}<NFe/>`,
    ]
    for (const adulterado of anexos) {
      const r = buildSefazSoap12Envelope({
        servico: "NFeAutorizacao4",
        exactBytes: new TextEncoder().encode(adulterado),
      })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.codigo).toBe("bytes_fiscais_nao_embutiveis")
    }

    // …e a assinatura do documento adulterado continuaria "válida" — prova de que o XMLDSig
    // sozinho NÃO cobre este risco e o backstop é mesmo necessário.
    expect(verifyNfceSignature(`${XML_ASSINADO.xml}<!--carga oculta-->`).valido).toBe(true)
  })
})

describe("o caminho offline não toca a rede (GOAL-016D-C1)", () => {
  it("nenhuma chamada de rede acontece na montagem do envelope", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("rede acionada no caminho offline")
    })
    vi.stubGlobal("fetch", fetchSpy)
    try {
      const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: BYTES_ASSINADOS })
      expect(r.ok).toBe(true)
      buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: new TextEncoder().encode(`<NFe/><!--x-->`) })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("o módulo do envelope não importa transporte, rede nem segredo", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/fiscal/provider/sefaz/sefaz-envelope.ts"), "utf8")
    for (const proibido of ["node:https", "node:http", "undici", "fetch(", "XMLHttpRequest", "@/lib/prisma", "vault"]) {
      expect(fonte).not.toContain(proibido)
    }
  })
})

describe("nenhum caller produtivo novo (GOAL-016D-C1)", () => {
  /** Varre `lib/` e `app/` atrás de quem importa o módulo do envelope. */
  function importadores(): string[] {
    const encontrados: string[] = []
    const visitar = (dir: string): void => {
      for (const entrada of readdirSync(dir)) {
        if (entrada === "node_modules" || entrada.startsWith(".")) continue
        const caminho = join(dir, entrada)
        if (statSync(caminho).isDirectory()) {
          visitar(caminho)
          continue
        }
        if (!/\.tsx?$/.test(entrada) || /\.test\.tsx?$/.test(entrada)) continue
        if (readFileSync(caminho, "utf8").includes("sefaz-envelope")) {
          encontrados.push(relative(process.cwd(), caminho).split(sep).join("/"))
        }
      }
    }
    for (const raiz of ["lib", "app"]) visitar(join(process.cwd(), raiz))
    return encontrados.sort()
  }

  it("os únicos importadores produtivos continuam sendo o barril e o provider direto", () => {
    expect(importadores()).toEqual([
      "lib/fiscal/provider/sefaz/index.ts",
      "lib/fiscal/provider/sefaz/sefaz-direto-provider.ts",
    ])
  })
})
