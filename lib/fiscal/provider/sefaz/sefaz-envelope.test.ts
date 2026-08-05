/**
 * GOAL-016D-A — envelope SOAP 1.2 (D5 · MOC 7.00 §3.2) + correção 002 · bloqueio 1.
 *
 * Dois invariantes disputam espaço aqui e ambos precisam valer:
 *  1. **byte-exatidão** — os bytes assinados entram por concatenação e saem idênticos;
 *     qualquer parse/re-serialização invalidaria a assinatura XMLDSig (ADR-0017/0018);
 *  2. **boa-formação** — o envelope produzido precisa ser XML válido, o que é impossível se
 *     o conteúdo embutido carregar declaração XML ou BOM.
 *
 * A conciliação é **recusar**, nunca consertar: bytes inadequados são bloqueados com código
 * estável e os bytes persistidos jamais são alterados para "fazer funcionar".
 */
import { describe, expect, it } from "vitest"
import { DOMParser } from "@xmldom/xmldom"
import {
  SEFAZ_SOAP12_CONTENT_TYPE,
  buildSefazSoap12Envelope,
  extractFiscalBytes,
  type SefazSoapEnvelope,
} from "./sefaz-envelope"
import type { SefazServico } from "./sefaz-endpoint-catalog"

/**
 * Fixture fiscal VÁLIDA: um elemento embutível, **sem declaração XML**, com particularidades
 * (espaços internos, acentos, assinatura) que um re-serializador destruiria.
 */
const XML_ASSINADO =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35260812345678000199650010000000011000000017" versao="4.00">` +
  `<ide><tpAmb>2</tpAmb></ide>   <espaco   preservado="sim"/>` +
  `<acentos>São Paulo · ção</acentos>` +
  `<Signature><SignatureValue>QUJDRA==</SignatureValue></Signature>` +
  `</infNFe></NFe>`

function bytesDoXml(xml: string): Uint8Array {
  return new TextEncoder().encode(xml)
}

/** Desembrulha o resultado exigindo sucesso — falha o teste com o código real se recusado. */
function envelopeOk(input: { servico: SefazServico; exactBytes: Uint8Array }): SefazSoapEnvelope {
  const r = buildSefazSoap12Envelope(input)
  if (!r.ok) throw new Error(`envelope recusado inesperadamente: ${r.codigo} — ${r.mensagem}`)
  return r.envelope
}

describe("envelope SOAP 1.2", () => {
  it("usa o Content-Type oficial do SOAP 1.2", () => {
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(XML_ASSINADO) })
    expect(env.contentType).toBe("application/soap+xml; charset=utf-8")
    expect(SEFAZ_SOAP12_CONTENT_TYPE).toBe("application/soap+xml; charset=utf-8")
  })

  it("NÃO contém soap12:Header nem nfeCabecMsg (eliminados no leiaute 4.00)", () => {
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(XML_ASSINADO) })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).not.toContain("Header")
    expect(texto).not.toContain("nfeCabecMsg")
    expect(texto).not.toContain("versaoDados")
    expect(texto).not.toContain("cUF")
    expect(texto).toContain("<soap12:Body>")
  })

  it("envolve o conteúdo em nfeDadosMsg com o namespace do serviço", () => {
    const servicos: SefazServico[] = ["NFeAutorizacao4", "NFeStatusServico4", "NFeConsultaProtocolo4"]
    for (const servico of servicos) {
      const env = envelopeOk({ servico, exactBytes: bytesDoXml(XML_ASSINADO) })
      const texto = new TextDecoder().decode(env.bytes)
      expect(texto).toContain(
        `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">`,
      )
      expect(env.namespace).toBe(`http://www.portalfiscal.inf.br/nfe/wsdl/${servico}`)
    }
  })

  it("não comprime: o envelope é UTF-8 legível, sem GZip/base64 do documento", () => {
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(XML_ASSINADO) })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).toContain("<NFe xmlns=")
    expect(texto).toContain("<tpAmb>2</tpAmb>")
  })
})

describe("boa-formação do envelope completo (correção 002 · bloqueio 1)", () => {
  /**
   * Parser independente do usado na validação — prova externa, não auto-confirmação.
   *
   * ⚠️ `@xmldom/xmldom` é um parser que **repara**, não que valida: tags desbalanceadas saem
   * como `warning` e o documento é reescrito silenciosamente (`<infNFe></NFe>` vira
   * `<infNFe/>`). Por isso QUALQUER evento do errorHandler — inclusive `warning` — conta como
   * recusa aqui. Um envelope bem-formado não gera evento nenhum.
   */
  function parseEstrito(xml: string): { ok: boolean; erro: string | null } {
    let erro: string | null = null
    const doc = new DOMParser({
      errorHandler: (nivel: string, msg: string) => {
        erro = erro ?? `${nivel}: ${msg}`
      },
    }).parseFromString(xml, "text/xml")
    const temParserError = doc.getElementsByTagName("parsererror").length > 0
    return { ok: !erro && !temParserError, erro }
  }

  it("o envelope produzido é XML bem-formado segundo um parser independente", () => {
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(XML_ASSINADO) })
    const resultado = parseEstrito(new TextDecoder().decode(env.bytes))
    expect(resultado.erro).toBeNull()
    expect(resultado.ok).toBe(true)
  })

  it("o envelope tem exatamente um Body, um nfeDadosMsg e um elemento fiscal", () => {
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(XML_ASSINADO) })
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(env.bytes), "text/xml")
    const dados = doc.getElementsByTagName("nfeDadosMsg")
    expect(dados.length).toBe(1)
    const filhosElemento = Array.from(dados[0]!.childNodes).filter((n) => n.nodeType === 1)
    expect(filhosElemento.length).toBe(1)
    expect((filhosElemento[0] as Element).nodeName).toBe("NFe")
  })

  it("tags desbalanceadas no conteúdo são detectadas pelo parser", () => {
    const malFormado =
      `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
      `<nfeDadosMsg><NFe><infNFe></NFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`
    expect(parseEstrito(malFormado).ok).toBe(false)
  })

  it("uma declaração embutida vira PI de alvo reservado — e o PARSER não acusa", () => {
    /**
     * Achado que justifica o guard explícito de declaração.
     *
     * XML 1.0 §2.6 reserva o alvo `xml` para processing instructions, e §2.8 permite a
     * declaração apenas na posição 0 do documento. Um `<?xml ... ?>` embutido é, portanto,
     * inválido — mas o `@xmldom/xmldom` (0.8.x) **aceita silenciosamente**: nenhum erro,
     * nenhum warning, e o nó vira uma PI de alvo `xml` dentro de `nfeDadosMsg`.
     *
     * Consequências para o desenho:
     *  1. não dá para delegar esta recusa ao parser — daí o teste de regex explícito no
     *     builder, que é o que de fato bloqueia;
     *  2. a contagem de elementos filhos TAMBÉM não pegaria, porque uma PI não é elemento:
     *     `childElements` continuaria vendo exatamente um `<NFe>`.
     *
     * Ou seja: sem o guard de declaração, estes bytes atravessariam as duas outras
     * verificações e só quebrariam no parser estrito da SEFAZ.
     */
    const comDeclaracaoEmbutida =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
      `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
      `<?xml version="1.0" encoding="UTF-8"?><NFe/>` +
      `</nfeDadosMsg></soap12:Body></soap12:Envelope>`

    // O parser não reclama…
    expect(parseEstrito(comDeclaracaoEmbutida).ok).toBe(true)

    // …mas o nó ilegal está lá: PI (nodeType 7) de alvo reservado `xml`.
    const doc = new DOMParser().parseFromString(comDeclaracaoEmbutida, "text/xml")
    const filhos = Array.from(doc.getElementsByTagName("nfeDadosMsg")[0]!.childNodes)
    expect(filhos.map((n) => n.nodeType)).toContain(7)
    expect(filhos.find((n) => n.nodeType === 7)?.nodeName).toBe("xml")

    // E o builder recusa esses bytes de qualquer forma — pelo guard, não pelo parser.
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<?xml version="1.0" encoding="UTF-8"?><NFe/>`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
  })
})

describe("regras fail-closed dos bytes fiscais (correção 002 · bloqueio 1)", () => {
  it("declaração XML embutida é BLOQUEADA — não removida", () => {
    const comDeclaracao = `<?xml version="1.0" encoding="UTF-8"?>${XML_ASSINADO}`
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(comDeclaracao),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
  })

  it("declaração precedida de espaços em branco também é bloqueada", () => {
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`\n  <?xml version="1.0"?>${XML_ASSINADO}`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
  })

  describe("chamarizes que derrotavam o guard ancorado (revisão cruzada · BLOCKER)", () => {
    /**
     * O guard nasceu como `/^\s*<\?xml/i` — ancorado no início. Bastava colocar qualquer coisa
     * que não fosse espaço em branco antes da declaração para atravessá-lo, e as outras duas
     * defesas não compensavam: o parser aceita a PI em silêncio e a contagem de filhos ignora
     * PI e comentário. Mesma família do chamariz de `tpAmb`: verificação que PARECE fail-closed
     * mas falha ABERTA na entrada adversarial.
     */
    const chamarizes: Array<[string, string]> = [
      ["comentário antes da declaração", `<!--x--><?xml version="1.0"?><NFe/>`],
      ["declaração aninhada no elemento raiz", `<NFe><?xml version="1.0"?><infNFe/></NFe>`],
      ["declaração no fim do documento", `<NFe/><?xml version="1.0"?>`],
      ["PI de alvo reservado em caixa alta", `<NFe><?XML foo?></NFe>`],
      [
        "declaração no fundo da árvore",
        `<NFe><infNFe><ide><?xml version="1.0"?></ide></infNFe></NFe>`,
      ],
    ]

    for (const [nome, payload] of chamarizes) {
      it(`bloqueia: ${nome}`, () => {
        const r = buildSefazSoap12Envelope({
          servico: "NFeAutorizacao4",
          exactBytes: bytesDoXml(payload),
        })
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
      })
    }

    it("a fixture fiscal legítima continua aceita (o guard não é um bloqueio cego)", () => {
      const r = buildSefazSoap12Envelope({
        servico: "NFeAutorizacao4",
        exactBytes: bytesDoXml(XML_ASSINADO),
      })
      expect(r.ok).toBe(true)
    })
  })

  it("BOM UTF-8 é bloqueado", () => {
    const semBom = bytesDoXml(XML_ASSINADO)
    const comBom = new Uint8Array(3 + semBom.length)
    comBom.set([0xef, 0xbb, 0xbf], 0)
    comBom.set(semBom, 3)

    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: comBom })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_bom")
  })

  it("bytes que NÃO são UTF-8 válido são bloqueados (nunca substituídos por U+FFFD)", () => {
    // 0xFF/0xFE não formam sequência UTF-8 válida. Antes da correção, estes bytes eram
    // aceitos e atravessavam o envelope intactos — produzindo corpo indecodificável.
    const brutos = new Uint8Array([0x3c, 0x61, 0x2f, 0x3e, 0xff, 0xfe, 0x00, 0x41])
    const r = buildSefazSoap12Envelope({ servico: "NFeAutorizacao4", exactBytes: brutos })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_nao_utf8")
  })

  it("bytes vazios são bloqueados", () => {
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: new Uint8Array(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_ausentes")
  })

  it("conteúdo com mais de um elemento raiz não é embutível", () => {
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<NFe/><NFe/>`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_nao_embutiveis")
  })

  it("conteúdo mal-formado é bloqueado antes de qualquer transporte", () => {
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<NFe><infNFe></NFe>`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("envelope_mal_formado")
  })

  it("DTD/entidade externa no conteúdo é recusada (política do parser seguro)", () => {
    const comDtd = `<!DOCTYPE NFe [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFe>&xxe;</NFe>`
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(comDtd),
    })
    expect(r.ok).toBe(false)
  })
})

describe("byte-exatidão dos bytes fiscais", () => {
  it("os bytes assinados saem do envelope IDÊNTICOS aos que entraram", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: original })
    const extraidos = extractFiscalBytes(env)

    expect(extraidos.length).toBe(original.length)
    expect(Buffer.from(extraidos).equals(Buffer.from(original))).toBe(true)
    // byte a byte, sem depender de comparação de string
    for (let i = 0; i < original.length; i += 1) expect(extraidos[i]).toBe(original[i])
  })

  it("espaços, acentos e a assinatura sobrevivem sem normalização", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: original })
    const texto = new TextDecoder().decode(env.bytes)
    expect(texto).toContain("   <espaco   preservado=\"sim\"/>")
    expect(texto).toContain("São Paulo · ção")
    expect(texto).toContain("<SignatureValue>QUJDRA==</SignatureValue>")
  })

  it("a VALIDAÇÃO não realimenta a saída: bytes = prefixo + originais + sufixo, exatamente", () => {
    /**
     * O builder decodifica e faz parse para VERIFICAR boa-formação. Este teste garante que
     * nada dessa verificação vaza para o resultado: o envelope é reconstruído aqui por
     * concatenação pura e comparado byte a byte com o produzido.
     */
    const original = bytesDoXml(XML_ASSINADO)
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: original })

    const prefixo = env.bytes.slice(0, env.fiscalBytesOffset)
    const sufixo = env.bytes.slice(env.fiscalBytesOffset + env.fiscalBytesLength)
    const reconstruido = Buffer.concat([
      Buffer.from(prefixo),
      Buffer.from(original),
      Buffer.from(sufixo),
    ])
    expect(reconstruido.equals(Buffer.from(env.bytes))).toBe(true)
  })

  it("o offset registrado aponta exatamente para o início do conteúdo fiscal", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: original })
    const prefixo = new TextDecoder().decode(env.bytes.slice(0, env.fiscalBytesOffset))
    expect(prefixo.endsWith(">")).toBe(true)
    expect(prefixo).toContain("<nfeDadosMsg")
    expect(env.fiscalBytesLength).toBe(original.length)
  })
})

describe("diagnóstico do produtor canônico de xmlAssinado", () => {
  it("o builder NFC-e emite declaração XML por default — bloqueio de contrato documentado", async () => {
    /**
     * Fixa a razão pela qual o adapter recusa em vez de remover: hoje o produtor canônico
     * (`serializeXmlDocument`, consumido por `buildNfceXmlResult` e preservado verbatim pelo
     * signer) emite `<?xml ... ?>` por default, e `omitDeclaration` não tem nenhum caller.
     *
     * Se este teste passar a falhar, o produtor mudou — e a recusa
     * `bytes_fiscais_com_declaracao_xml` deve ser reavaliada em GOAL próprio, com autorização.
     */
    const { serializeXmlDocument } = await import("@/lib/fiscal/xml/xml-writer")
    const comDefault = serializeXmlDocument({ tag: "NFe" })
    expect(comDefault.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)

    // O produtor SABE omitir — mas nenhum caller de produção pede isso hoje.
    const semDeclaracao = serializeXmlDocument({ tag: "NFe" }, { declaration: false })
    expect(semDeclaracao.startsWith("<?xml")).toBe(false)

    // E, omitida a declaração, os bytes passam a ser envelopáveis.
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(semDeclaracao),
    })
    expect(r.ok).toBe(true)
  })
})
