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
  type SefazEnvelopeRejectionCode,
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

describe("contrato do produtor canônico de xmlAssinado (GOAL-016D-C0)", () => {
  it("o serializador STANDALONE continua emitindo declaração — comportamento preservado", async () => {
    /**
     * O bloqueio 016D-A foi corrigido na ORIGEM, não relaxando este adapter. O serializador
     * genérico segue com o mesmo default de antes: quem pede documento standalone recebe
     * documento standalone, com declaração na posição 0.
     */
    const { serializeXmlDocument } = await import("@/lib/fiscal/xml/xml-writer")
    expect(serializeXmlDocument({ tag: "NFe" }).startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(serializeXmlDocument({ tag: "NFe" }, { declaration: false }).startsWith("<?xml")).toBe(false)
  })

  it("o produtor EMBUTÍVEL entrega bytes que este envelope aceita", async () => {
    const { serializeXmlEmbeddable } = await import("@/lib/fiscal/xml/xml-writer")
    const embutivel = serializeXmlEmbeddable({ tag: "NFe" })
    expect(embutivel.startsWith("<?xml")).toBe(false)

    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(embutivel),
    })
    expect(r.ok).toBe(true)
  })

  it("a recusa por declaração NÃO foi enfraquecida pela correção do produtor", () => {
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<?xml version="1.0" encoding="UTF-8"?>${XML_ASSINADO}`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe("bytes_fiscais_com_declaracao_xml")
  })
})

// ── GOAL-016D-C1 — backstop INDEPENDENTE de fronteira da raiz ───────────────────────────────

/** Recusa esperada, devolvendo o código para inspeção. Falha o teste se o payload for ACEITO. */
function recusaDe(payload: string | Uint8Array): SefazEnvelopeRejectionCode {
  const r = buildSefazSoap12Envelope({
    servico: "NFeAutorizacao4",
    exactBytes: typeof payload === "string" ? bytesDoXml(payload) : payload,
  })
  if (r.ok) throw new Error(`payload ACEITO indevidamente: ${JSON.stringify(String(payload))}`)
  return r.codigo
}

describe("conteúdo fora da raiz é recusado pelo PRÓPRIO adapter (GOAL-016D-C1)", () => {
  /**
   * Antes desta correção o adapter aceitava 11 dos 15 payloads abaixo. A causa era mecânica e
   * dupla: `childElements` roda sobre a AST de `c14n.toAst`, que descarta comentário e PI; e o
   * `@xmldom/xmldom` REPARA em silêncio — um fecho órfão (`<NFe/></NFe>`) era simplesmente
   * descartado, produzindo um DOM indistinguível do legítimo, sem erro nem warning.
   *
   * A barreira efetiva era o PRODUTOR (016D-C0). Isto aqui prova a garantia INDEPENDENTE que o
   * GOAL pede: o adapter recusa sozinho, sem confiar em produtor nem em signer.
   */
  const foraDaRaiz: Array<[string, string]> = [
    ["comentário antes da raiz", `<!--x--><NFe/>`],
    ["comentário depois da raiz", `<NFe/><!--x-->`],
    ["comentário depois de raiz com filhos", `<NFe><infNFe/></NFe><!--x-->`],
    ["processing instruction antes da raiz", `<?pi dados?><NFe/>`],
    ["processing instruction depois da raiz", `<NFe/><?pi dados?>`],
    ["texto antes da raiz", `texto<NFe/>`],
    ["texto depois da raiz", `<NFe/>texto`],
    ["whitespace antes da raiz", ` <NFe/>`],
    ["whitespace depois da raiz", `<NFe/>\n`],
    ["CDATA depois da raiz", `<NFe/><![CDATA[oculto]]>`],
    ["segunda raiz", `<NFe/><NFe2/>`],
    ["raiz vazia seguida de fecho órfão", `<NFe/></NFe>`],
    ["fecho órfão com comentário no meio", `<NFe></NFe><!--x--></NFe>`],
    ["DOCTYPE antes da raiz", `<!DOCTYPE NFe><NFe/>`],
    ["ENTITY antes da raiz", `<!DOCTYPE NFe [<!ENTITY e "v">]><NFe/>`],
  ]

  for (const [nome, payload] of foraDaRaiz) {
    it(`recusa: ${nome}`, () => {
      expect(recusaDe(payload)).toMatch(/^(bytes_fiscais_nao_embutiveis|envelope_mal_formado)$/)
    })
  }

  it("recusa aninhamento cruzado que o parser repararia em silêncio", () => {
    // `<NFe><a></NFe></a>` era ACEITO: o xmldom reordena/repara e o DOM final passa em tudo.
    // O varredor é name-aware justamente para isto.
    expect(recusaDe(`<NFe><a></NFe></a>`)).toBe("envelope_mal_formado")
    expect(recusaDe(`<NFe><a></b></NFe>`)).toBe("envelope_mal_formado")
    expect(recusaDe(`<NFe></nfe>`)).toBe("envelope_mal_formado")
  })

  it("recusa atributo em tag de fecho (achado da revisão independente)", () => {
    // `</NFe x=">` é ilegal em XML e o xmldom o repara em silêncio. Não smuggla conteúdo
    // externo — o varredor já barra o resto — mas despacharia marcação quebrada para a SEFAZ.
    expect(recusaDe(`<NFe><infNFe/></NFe x=">`)).toBe("envelope_mal_formado")
    // Depois da raiz o token sequer é lido: a malformação vence a posição, e ambas recusam.
    expect(recusaDe(`<NFe/></NFe a="b">`)).toBe("envelope_mal_formado")
    // O fecho com espaço antes do `>` continua legítimo — a recusa não virou bloqueio cego.
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<NFe><infNFe/></NFe\t\n >`),
    })
    expect(r.ok).toBe(true)
  })

  it("recusa raiz não fechada e markup truncado", () => {
    expect(recusaDe(`<NFe><infNFe/>`)).toBe("envelope_mal_formado")
    expect(recusaDe(`<NFe><!-- sem fim`)).toBe("envelope_mal_formado")
    expect(recusaDe(`<NFe`)).toBe("envelope_mal_formado")
  })

  it("BOM e declaração continuam com seus códigos próprios (ordem dos guards preservada)", () => {
    // O guard de declaração roda ANTES do de fronteira: um payload que viola os dois continua
    // reportando a declaração, que é o diagnóstico mais específico.
    expect(recusaDe(`<NFe/><?xml version="1.0"?>`)).toBe("bytes_fiscais_com_declaracao_xml")
    const semBom = bytesDoXml(`<NFe/><!--x-->`)
    const comBom = new Uint8Array(3 + semBom.length)
    comBom.set([0xef, 0xbb, 0xbf], 0)
    comBom.set(semBom, 3)
    expect(recusaDe(comBom)).toBe("bytes_fiscais_com_bom")
  })
})

describe("chamarizes que NÃO podem mover a fronteira da raiz (GOAL-016D-C1)", () => {
  /** Cada payload é LEGÍTIMO: o material suspeito está dentro da raiz, escapado ou inerte. */
  const legitimos: Array<[string, string]> = [
    ["marcação de comentário escapada em texto", `<NFe><obs>&lt;!--x--&gt;</obs></NFe>`],
    ["fecho da raiz escapado em texto", `<NFe><obs>&lt;/NFe&gt;</obs></NFe>`],
    ["comentário real DENTRO da raiz", `<NFe><!-- nota --><infNFe/></NFe>`],
    ["comentário contendo o fecho da raiz", `<NFe><!-- </NFe><evil/> --><infNFe/></NFe>`],
    ["CDATA contendo o fecho da raiz", `<NFe><obs><![CDATA[</NFe><evil/>]]></obs></NFe>`],
    ["PI real dentro da raiz", `<NFe><?processa isto?><infNFe/></NFe>`],
    ["atributo com `>` e `<` no valor", `<NFe a="/><evil "><infNFe/></NFe>`],
    ["atributo com barra antes do fecho", `<NFe a="x/"><infNFe/></NFe>`],
    ["atributo em aspas simples com aspas duplas dentro", `<NFe a='x">y'><infNFe/></NFe>`],
    ["tag vazia com atributo terminando em barra", `<NFe a="v/"/>`],
    ["fecho com espaço antes do `>`", `<NFe><infNFe/></NFe >`],
    ["elementos internos legítimos em série", `<NFe><a/><b/><c/></NFe>`],
    ["raiz com prefixo de namespace", `<nfe:NFe xmlns:nfe="urn:x"><nfe:infNFe/></nfe:NFe>`],
    ["texto e espaços INTERNOS preservados", `<NFe>  <a/>   <b/>  </NFe>`],
  ]

  for (const [nome, payload] of legitimos) {
    it(`aceita: ${nome}`, () => {
      const r = buildSefazSoap12Envelope({
        servico: "NFeAutorizacao4",
        exactBytes: bytesDoXml(payload),
      })
      if (!r.ok) throw new Error(`payload legítimo recusado: ${r.codigo} — ${r.mensagem}`)
      // E os bytes continuam intactos: aceitar não pode implicar limpar.
      expect(Buffer.from(extractFiscalBytes(r.envelope)).equals(Buffer.from(bytesDoXml(payload)))).toBe(true)
    })
  }

  it("o chamariz dentro de CDATA não vira conteúdo externo no envelope montado", () => {
    // Prova que aceitar o CDATA não introduziu uma segunda raiz de verdade no corpo.
    const payload = `<NFe><obs><![CDATA[</NFe><evil/>]]></obs></NFe>`
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: bytesDoXml(payload) })
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(env.bytes), "text/xml")
    const dados = doc.getElementsByTagName("nfeDadosMsg")[0]!
    expect(Array.from(dados.childNodes).filter((n) => n.nodeType === 1)).toHaveLength(1)
    expect(doc.getElementsByTagName("evil")).toHaveLength(0)
  })
})

describe("o backstop não transforma nem reserializa (GOAL-016D-C1)", () => {
  it("a fixture assinada legítima continua aceita e byte-idêntica", () => {
    const original = bytesDoXml(XML_ASSINADO)
    const env = envelopeOk({ servico: "NFeAutorizacao4", exactBytes: original })
    expect(Buffer.from(extractFiscalBytes(env)).equals(Buffer.from(original))).toBe(true)
  })

  it("nenhuma recusa devolve conteúdo fiscal na mensagem", () => {
    const segredo = "SEGREDO-FISCAL-12345678901234567890"
    const r = buildSefazSoap12Envelope({
      servico: "NFeAutorizacao4",
      exactBytes: bytesDoXml(`<NFe><infNFe>${segredo}</infNFe></NFe><!--x-->`),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.mensagem).not.toContain(segredo)
    expect(r.mensagem).not.toContain("infNFe")
  })
})
