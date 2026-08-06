/**
 * Envelope SOAP 1.2 da SEFAZ (GOAL-016D-A · plano 016D D5 · MOC 7.00 §3.2).
 *
 * Montagem OFFLINE, pura, sem rede. Regras oficiais aplicadas:
 *  - SOAP **1.2**, `Content-Type: application/soap+xml; charset=utf-8`;
 *  - **sem `soap12:Header`** — o leiaute 4.00 eliminou o `nfeCabecMsg` (MOC 7.00: *"foi
 *    eliminado o uso de variáveis no SOAP Header"*);
 *  - corpo `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/<Serviço>">`;
 *  - UTF-8; **zero compressão** (GZip só existe no método `…LoteZip`, fora do piloto).
 *
 * ⚠️ **Byte-exatidão (ADR-0017/0018).** Os bytes fiscais assinados entram no envelope por
 * CONCATENAÇÃO DE BYTES — nunca há parse, re-serialização, normalização, re-indentação ou
 * round-trip de string do XML assinado. O prefixo e o sufixo são gerados separadamente e os
 * `exactBytes` originais são copiados intactos entre eles.
 *
 * ⚠️ **O XML é decodificado para VERIFICAR, nunca para produzir** (correção 002 · bloqueio 1).
 * A validação abaixo decodifica e faz parse de uma CÓPIA para conferir boa-formação; os bytes
 * devolvidos continuam sendo exclusivamente a concatenação dos originais. Nenhuma saída deste
 * módulo passa por serializador.
 *
 * ## Contrato do produtor (bloqueio 016D-A resolvido em 016D-C0)
 *
 * O bloqueio original: o produtor canônico emitia `<?xml version="1.0" encoding="UTF-8"?>` por
 * default e o signer o preservava verbatim, de modo que `xmlAssinado` chegava aqui com uma
 * declaração — legal só na posição 0 de um documento, e portanto capaz de tornar o envelope
 * MAL-FORMADO dentro de `<nfeDadosMsg>`.
 *
 * A correção foi feita NA ORIGEM, não aqui: `buildNfceXmlAssinavel`
 * (`lib/fiscal/xml/nfce-xml-builder.ts`) serializa por `serializeXmlEmbeddable`, que nunca
 * escreve a declaração e prova o contrato embutível antes de devolver; e `signNfceXmlDetailed`
 * RECUSA por default qualquer entrada com declaração ou BOM. `serializeXmlDocument` segue
 * emitindo a declaração para o contrato de documento standalone, que não passa por aqui.
 *
 * Este módulo continua **recusando** bytes com declaração (`bytes_fiscais_com_declaracao_xml`)
 * em vez de removê-la, e essa recusa NÃO enfraquece: remover a declaração aqui mudaria bytes já
 * persistidos e conferidos por hash, violando ADR-0017/0018 e quebrando o XMLDSig. O guard é a
 * última barreira, não a correção.
 *
 * ## Backstop INDEPENDENTE de fronteira da raiz (GOAL-016D-C1)
 *
 * O contrato 016D-C0 protege produtor e signer, mas era a ÚNICA barreira contra conteúdo fora da
 * raiz: aqui, comentário/PI/CDATA/texto externos atravessavam, porque a verificação estrutural
 * roda sobre uma AST que descarta esses nós. `violacaoDeFronteiraDaRaiz` fecha isso sem depender
 * de ninguém a montante — o adapter prova por si que os bytes são exatamente um elemento raiz.
 */
import { childElements, parseXml } from "@/lib/fiscal/signing/c14n"
import { sefazServiceNamespace, type SefazServico } from "./sefaz-endpoint-catalog"

/** Content-Type obrigatório do SOAP 1.2 (MOC 7.00). */
export const SEFAZ_SOAP12_CONTENT_TYPE = "application/soap+xml; charset=utf-8" as const

const SOAP12_ENVELOPE_NS = "http://www.w3.org/2003/05/soap-envelope"

/** Códigos estáveis de recusa do envelope. Nenhum carrega conteúdo fiscal. */
export type SefazEnvelopeRejectionCode =
  | "bytes_fiscais_ausentes"
  | "bytes_fiscais_com_bom"
  | "bytes_fiscais_nao_utf8"
  | "bytes_fiscais_com_declaracao_xml"
  | "bytes_fiscais_nao_embutiveis"
  | "envelope_mal_formado"

export type SefazSoapEnvelope = {
  readonly contentType: typeof SEFAZ_SOAP12_CONTENT_TYPE
  /** Envelope completo em bytes — os bytes fiscais aparecem intactos no meio. */
  readonly bytes: Uint8Array
  /** Offset onde os bytes fiscais começam dentro de `bytes` (prova de byte-exatidão). */
  readonly fiscalBytesOffset: number
  readonly fiscalBytesLength: number
  readonly namespace: string
}

export type SefazEnvelopeResult =
  | { readonly ok: true; readonly envelope: SefazSoapEnvelope }
  | {
      readonly ok: false
      readonly codigo: SefazEnvelopeRejectionCode
      readonly mensagem: string
    }

function recusa(
  codigo: SefazEnvelopeRejectionCode,
  mensagem: string,
): Extract<SefazEnvelopeResult, { ok: false }> {
  return { ok: false, codigo, mensagem }
}

/** BOM UTF-8. Ilegal dentro de um elemento embutido e invisível numa inspeção textual. */
function comecaComBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/**
 * Decodificação ESTRITA. `fatal: true` recusa sequências UTF-8 inválidas em vez de substituí-las
 * por U+FFFD — substituição silenciosa mudaria o documento sem que ninguém percebesse.
 */
function decodificarUtf8Estrito(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

// ── Backstop de fronteira da raiz (GOAL-016D-C1) ────────────────────────────────────────────

/**
 * Violações de fronteira. São DIAGNÓSTICO interno — nunca carregam conteúdo fiscal e não
 * ampliam `SefazEnvelopeRejectionCode`, que é o contrato público consumido pelo provider.
 */
type FronteiraRaizViolacao =
  | "conteudo_antes_da_raiz"
  | "conteudo_depois_da_raiz"
  | "sem_raiz"
  | "raiz_nao_fechada"
  | "markup_malformado"

type MarcacaoKind =
  | "elemento_abre"
  | "elemento_fecha"
  | "elemento_vazio"
  | "texto"
  | "comentario"
  | "pi"
  | "cdata"
  | "declaracao"

type Marcacao = { kind: MarcacaoKind; fim: number; nome: string }

/** Fim de um nome de tag: espaço XML 1.0 §2.3, `/` de tag vazia ou `>` de fecho. */
const FIM_DE_NOME = new Set([" ", "\t", "\n", "\r", "/", ">"])

/** Whitespace XML 1.0 §2.3 (`S`). Único separador legal entre nome e atributos. */
const ESPACO_XML = new Set([" ", "\t", "\n", "\r"])

function nomeDaTag(s: string, inicio: number): string {
  let fim = inicio
  while (fim < s.length && !FIM_DE_NOME.has(s[fim]!)) fim += 1
  return s.slice(inicio, fim)
}

/**
 * `NCName` — `Name` de XML 1.0 §2.3 sem `:`, que aqui é tratado como separador de QName.
 * As faixas são as da produção oficial (NameStartChar / NameChar), inclusive o plano astral.
 */
const INICIO_DE_NOME =
  "A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF" +
  "\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF" +
  "\uFDF0-\uFFFD\u{10000}-\u{EFFFF}"
const CORPO_DE_NOME =
  "-.0-9A-Z_a-z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF" +
  "\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF" +
  "\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}"
const NCNAME = new RegExp(`^[${INICIO_DE_NOME}][${CORPO_DE_NOME}]*$`, "u")

/** QName (Namespaces in XML §4): `NCName` ou `prefixo:local`, nenhuma parte vazia. */
function ehQName(nome: string): boolean {
  const partes = nome.split(":")
  return partes.length <= 2 && partes.every((parte) => NCNAME.test(parte))
}

/**
 * Tokeniza UMA start-tag ou empty-element tag exigindo a estrutura léxica mínima de XML 1.0
 * §3.1 — `'<' QName (S Attribute)* S? ('>' | '/>')`, com
 * `Attribute ::= QName S? '=' S? AttValue` e `AttValue` entre aspas, sem `<` cru.
 *
 * ⚠️ Por que o varredor precisa disto (correção 002 · matriz adversarial sobre 399d0e4).
 * A versão anterior só rastreava aspas para achar o `>` de fecho, e o `<` era ignorado enquanto
 * houvesse aspas abertas. Consequência medida: `<NFe a="x<y"/>`, `<NFe a='x<y'/>`,
 * `<NFe a="<NFe"/>` e `<NFe//>` eram **ACEITOS** pelo backstop inteiro — e o
 * `@xmldom/xmldom` os REPARA sem emitir erro nem warning, então `parseXml` também não pegava.
 * Outros treze casos (atributo sem aspas, sem `=`, duplicado, sem separador, QName inválido…)
 * só eram recusados PELO PARSER a jusante, isto é, o backstop não era independente ali —
 * exatamente o que este GOAL existe para fechar.
 *
 * Escopo deliberadamente léxico: não valida entidades no valor, não resolve namespace e não
 * substitui o XSD. `&` solto num valor segue para as camadas seguintes porque não é capaz de
 * mover a fronteira da tag, que é o risco tratado aqui.
 */
function lerTagDeAbertura(s: string, i: number): Marcacao | null {
  let j = i + 1
  const nome = nomeDaTag(s, j)
  if (!ehQName(nome)) return null
  j += nome.length

  const nomesVistos = new Set<string>()
  for (;;) {
    let houveEspaco = false
    while (j < s.length && ESPACO_XML.has(s[j]!)) {
      j += 1
      houveEspaco = true
    }
    if (j >= s.length) return null // tag truncada

    if (s[j] === ">") return { kind: "elemento_abre", fim: j + 1, nome }
    if (s[j] === "/") {
      // `/` só é legal colado no `>`. `<NFe//>` e `<NFe a="1"/ >` caem aqui.
      if (s[j + 1] !== ">") return null
      return { kind: "elemento_vazio", fim: j + 2, nome }
    }
    // Sobrou atributo — e XML exige whitespace ANTES dele (`<NFe a="1"b="2"/>` é ilegal).
    if (!houveEspaco) return null

    const inicioAtributo = j
    while (j < s.length && !FIM_DE_NOME.has(s[j]!) && s[j] !== "=") j += 1
    const atributo = s.slice(inicioAtributo, j)
    if (!ehQName(atributo)) return null
    // "Unique Att Spec" (XML 1.0 §3.1): duplicidade é comparada no nome qualificado literal.
    if (nomesVistos.has(atributo)) return null
    nomesVistos.add(atributo)

    while (j < s.length && ESPACO_XML.has(s[j]!)) j += 1
    if (s[j] !== "=") return null
    j += 1
    while (j < s.length && ESPACO_XML.has(s[j]!)) j += 1

    const aspas = s[j]
    if (aspas !== '"' && aspas !== "'") return null // valor sem aspas é ilegal
    j += 1
    const inicioValor = j
    while (j < s.length && s[j] !== aspas) j += 1
    if (j >= s.length) return null // aspas não fechada
    // `AttValue ::= '"' ([^<&"] | Reference)* '"'` — `<` cru é proibido; `&lt;` passa intacto.
    if (s.slice(inicioValor, j).includes("<")) return null
    j += 1
  }
}

/**
 * Lê UMA marcação a partir de `i`. Devolve `null` quando o token não termina — entrada
 * truncada é malformação, não conteúdo aceitável.
 *
 * Comentário, PI e CDATA são lidos como um token ÚNICO, do abre ao fecha. É isso que impede
 * chamariz: `<![CDATA[</NFe><evil/>]]>` e `<!-- </NFe> -->` não movem a fronteira da raiz,
 * porque o varredor nunca olha dentro deles.
 */
function lerMarcacao(s: string, i: number): Marcacao | null {
  if (s[i] !== "<") {
    const proximo = s.indexOf("<", i)
    return { kind: "texto", fim: proximo === -1 ? s.length : proximo, nome: "" }
  }
  if (s.startsWith("<!--", i)) {
    const fim = s.indexOf("-->", i + 4)
    return fim === -1 ? null : { kind: "comentario", fim: fim + 3, nome: "" }
  }
  if (s.startsWith("<![CDATA[", i)) {
    const fim = s.indexOf("]]>", i + 9)
    return fim === -1 ? null : { kind: "cdata", fim: fim + 3, nome: "" }
  }
  if (s.startsWith("<!", i)) {
    // DOCTYPE e demais declarações de markup. O conteúdo é irrelevante: a declaração é ilegal
    // em qualquer posição deste contrato, e o subset interno de um DTD faria esta busca de `>`
    // parar cedo — o que só antecipa a recusa.
    const fim = s.indexOf(">", i + 2)
    return fim === -1 ? null : { kind: "declaracao", fim: fim + 1, nome: "" }
  }
  if (s.startsWith("<?", i)) {
    const fim = s.indexOf("?>", i + 2)
    return fim === -1 ? null : { kind: "pi", fim: fim + 2, nome: "" }
  }
  if (s.startsWith("</", i)) {
    const fim = s.indexOf(">", i + 2)
    if (fim === -1) return null
    // Uma tag de fecho é `</Nome>` com, no máximo, espaço antes do `>`. Atributo em tag de fecho
    // (`</NFe x=">`) é ilegal e o xmldom o repara em silêncio — recusar aqui evita despachar
    // marcação quebrada para o parser estrito da SEFAZ. (Revisão independente 016D-C1.)
    const nome = nomeDaTag(s, i + 2)
    if (s.slice(i + 2 + nome.length, fim).trim() !== "") return null
    return { kind: "elemento_fecha", fim: fim + 1, nome }
  }

  // Tag de abertura / tag vazia: tokenização léxica estrita. `>` e `/` DENTRO de um valor entre
  // aspas continuam não sendo delimitadores — `<NFe a="/>&lt;evil ">` é uma tag só, e um
  // varredor ingênuo a partiria —, mas a estrutura da tag agora é conferida de fato.
  return lerTagDeAbertura(s, i)
}

/**
 * PROVA, sem parser e sem transformar nada, que o conteúdo é EXATAMENTE um elemento raiz e
 * termina no fecho dessa raiz — nenhum byte antes, nenhum byte depois.
 *
 * ⚠️ Por que isto não pode ser delegado ao parser (causa mecânica do defeito 016D-C1).
 * O `@xmldom/xmldom` REPARA em vez de validar, e o AST de `c14n.toAst` só materializa elemento
 * e texto. As duas coisas juntas abrem três famílias que atravessavam o backstop inteiro:
 *  1. comentário/PI/CDATA fora da raiz — o parser os cria, `childElements` não os conta, e
 *     "exatamente um elemento filho" seguia verdadeiro;
 *  2. fecho órfão após raiz vazia (`<NFe/></NFe>`) — o parser DESCARTA a tag extra em silêncio,
 *     sem erro nem warning, e o DOM resultante é indistinguível do legítimo;
 *  3. aninhamento cruzado (`<NFe><a></NFe></a>`) — reparado em silêncio pelo mesmo mecanismo.
 * Medido no adapter antes desta correção: 11 de 15 payloads adversariais eram ACEITOS.
 *
 * O varredor é deliberadamente name-aware: casar o nome de cada fecho com o abre correspondente
 * é o que fecha (2) e (3), porque a fronteira da raiz deixa de depender de contagem de `<`/`>`.
 *
 * Só LÊ. Não corrige, não normaliza, não reserializa — os bytes seguem para o envelope
 * exatamente como chegaram (ADR-0017/0018).
 */
function violacaoDeFronteiraDaRaiz(s: string): FronteiraRaizViolacao | null {
  const pilha: string[] = []
  let raizFechada = false
  let i = 0

  while (i < s.length) {
    const token = lerMarcacao(s, i)
    if (!token || token.fim <= i) return "markup_malformado"

    if (pilha.length === 0) {
      // Nível de documento: só o start-tag da raiz é admissível, e uma única vez.
      if (raizFechada) return "conteudo_depois_da_raiz"
      if (token.kind === "elemento_vazio") raizFechada = true
      else if (token.kind === "elemento_abre") pilha.push(token.nome)
      else return "conteudo_antes_da_raiz"
    } else if (token.kind === "elemento_abre") {
      pilha.push(token.nome)
    } else if (token.kind === "elemento_fecha") {
      if (pilha.pop() !== token.nome) return "markup_malformado"
      if (pilha.length === 0) raizFechada = true
    } else if (token.kind === "declaracao") {
      return "markup_malformado" // DOCTYPE/ENTITY não é conteúdo legítimo em lugar nenhum
    }
    // texto, comentário, PI, CDATA e tag vazia são legítimos DENTRO da raiz.

    i = token.fim
  }

  if (pilha.length > 0) return "raiz_nao_fechada"
  if (!raizFechada) return "sem_raiz"
  return null
}

/**
 * Mapeia a violação para o código público. Conteúdo fora da raiz é "não embutível"; markup
 * quebrado é "mal-formado". A separação preserva o significado que o provider já consome.
 */
function recusaDeFronteira(
  violacao: FronteiraRaizViolacao,
): Extract<SefazEnvelopeResult, { ok: false }> {
  if (violacao === "raiz_nao_fechada" || violacao === "markup_malformado") {
    return recusa(
      "envelope_mal_formado",
      `Bytes fiscais com marcação inconsistente (${violacao}); transporte bloqueado sem transformação.`,
    )
  }
  return recusa(
    "bytes_fiscais_nao_embutiveis",
    `Bytes fiscais carregam conteúdo fora do elemento raiz (${violacao}); o conteúdo embutido ` +
      "precisa ser exatamente um elemento e terminar no fecho dele.",
  )
}

/**
 * Monta o envelope SOAP 1.2 preservando os bytes fiscais byte a byte, ou RECUSA de forma
 * fail-closed com um código estável.
 *
 * `exactBytes` deve ser exatamente o que foi persistido e conferido por hash pelo coordenador
 * (ADR-0017) — este módulo não gera, altera, assina, normaliza nem repara XML.
 */
export function buildSefazSoap12Envelope(input: {
  servico: SefazServico
  exactBytes: Uint8Array
}): SefazEnvelopeResult {
  const { exactBytes } = input

  if (exactBytes.length === 0) {
    return recusa("bytes_fiscais_ausentes", "Sem bytes fiscais para envelopar.")
  }
  if (comecaComBom(exactBytes)) {
    return recusa(
      "bytes_fiscais_com_bom",
      "Bytes fiscais iniciam com BOM UTF-8; conteúdo embutido não pode carregar BOM.",
    )
  }

  const conteudo = decodificarUtf8Estrito(exactBytes)
  if (conteudo === null) {
    return recusa(
      "bytes_fiscais_nao_utf8",
      "Bytes fiscais não são UTF-8 válido; envelope recusado sem transformação.",
    )
  }
  /**
   * Declaração XML / PI de alvo reservado `xml`, em QUALQUER posição.
   *
   * ⚠️ A busca é deliberadamente **não ancorada**. Uma versão anterior usava `/^\s*<\?xml/i` e
   * falhava ABERTA sob entrada adversarial: bastava um decoy antes da declaração
   * (`<!--x--><?xml …?><NFe/>`) ou aninhá-la dentro do elemento raiz
   * (`<NFe><?xml …?><infNFe/></NFe>`) para atravessar o guard. As duas outras defesas também
   * não pegavam — o `@xmldom/xmldom` aceita a PI em silêncio, e `childElements` não conta PI
   * nem comentário, então "exatamente um elemento filho" continuava verdadeiro.
   *
   * XML 1.0 §2.6 reserva o alvo `xml` para PIs e §2.8 só admite a declaração na posição 0;
   * portanto qualquer ocorrência da marcação `<?xml` no conteúdo embutido é ilegal. Dados que
   * legitimamente contivessem esse texto apareceriam escapados (`&lt;?xml`) e não casam aqui.
   * Falso-positivo, se houvesse, apenas BLOQUEIA — o lado seguro da assimetria.
   */
  if (/<\?xml/i.test(conteudo)) {
    return recusa(
      "bytes_fiscais_com_declaracao_xml",
      "Bytes fiscais carregam declaração XML (ou PI de alvo reservado `xml`); embuti-la em " +
        "nfeDadosMsg produziria envelope mal-formado, e removê-la alteraria os bytes " +
        "persistidos (ADR-0017/0018).",
    )
  }

  const fronteira = violacaoDeFronteiraDaRaiz(conteudo)
  if (fronteira) return recusaDeFronteira(fronteira)

  const namespace = sefazServiceNamespace(input.servico)
  const encoder = new TextEncoder()

  // Sem `soap12:Header` — o leiaute 4.00 eliminou o nfeCabecMsg. A declaração XML abaixo é a
  // do ENVELOPE (posição 0 do documento produzido), legal e distinta da declaração proibida
  // dentro do conteúdo fiscal.
  const prefixo = encoder.encode(
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<soap12:Envelope xmlns:soap12="${SOAP12_ENVELOPE_NS}">` +
      `<soap12:Body>` +
      `<nfeDadosMsg xmlns="${namespace}">`,
  )
  const sufixo = encoder.encode(`</nfeDadosMsg></soap12:Body></soap12:Envelope>`)

  const bytes = new Uint8Array(prefixo.length + exactBytes.length + sufixo.length)
  bytes.set(prefixo, 0)
  bytes.set(exactBytes, prefixo.length)
  bytes.set(sufixo, prefixo.length + exactBytes.length)

  // Verificação sobre uma CÓPIA decodificada. O resultado devolvido continua sendo `bytes`,
  // a concatenação — nada aqui realimenta a saída.
  const verificacao = verificarEnvelope(new TextDecoder().decode(bytes))
  if (!verificacao.ok) return verificacao

  return {
    ok: true,
    envelope: {
      contentType: SEFAZ_SOAP12_CONTENT_TYPE,
      bytes,
      fiscalBytesOffset: prefixo.length,
      fiscalBytesLength: exactBytes.length,
      namespace,
    },
  }
}

/**
 * Prova que o envelope montado é XML bem-formado e que o conteúdo fiscal é UM único elemento
 * embutível. `parseXml` recusa DTD e declarações de entidade antes do parser, de modo que um
 * payload com XXE não atravessa esta verificação.
 *
 * ⚠️ Esta verificação **não substitui** o guard de declaração XML acima, e a ordem importa.
 * O `@xmldom/xmldom` (0.8.x) aceita silenciosamente um `<?xml ... ?>` embutido — sem erro nem
 * warning — transformando-o numa processing instruction de alvo `xml`, que XML 1.0 §2.6
 * reserva e §2.8 só permite na posição 0. Como PI não é elemento, a contagem de filhos abaixo
 * também continuaria vendo exatamente um `<NFe>`. Sem o guard textual, portanto, esses bytes
 * passariam por ambas as checagens e só quebrariam no parser estrito da SEFAZ. Há teste
 * dedicado fixando esse comportamento do parser.
 *
 * ✅ **Lacuna FECHADA em 016D-C1.** Esta contagem seguia cega para lixo fora da raiz — comentário,
 * PI, CDATA e texto não são elementos, e um fecho órfão (`<NFe/></NFe>`) o parser descartava em
 * silêncio. Quem fecha isso agora é `violacaoDeFronteiraDaRaiz`, varredura parser-free que roda
 * ANTES da montagem e não depende de `toAst`: o núcleo de canonicalização do XMLDSig permaneceu
 * intocado. A contagem abaixo continua como segunda camada, não como a barreira.
 */
function verificarEnvelope(
  envelopeXml: string,
): { ok: true } | Extract<SefazEnvelopeResult, { ok: false }> {
  let raiz
  try {
    raiz = parseXml(envelopeXml)
  } catch {
    return recusa(
      "envelope_mal_formado",
      "Envelope SOAP montado não é XML bem-formado; transporte bloqueado.",
    )
  }
  if (raiz.name !== "Envelope" || raiz.namespaceUri !== SOAP12_ENVELOPE_NS) {
    return recusa("envelope_mal_formado", "Raiz do envelope não é soap12:Envelope.")
  }
  const body = childElements(raiz, "Body", SOAP12_ENVELOPE_NS)
  if (body.length !== 1) {
    return recusa("envelope_mal_formado", "Envelope sem um único soap12:Body.")
  }
  const dados = childElements(body[0]!, "nfeDadosMsg")
  if (dados.length !== 1) {
    return recusa("envelope_mal_formado", "Body sem um único nfeDadosMsg.")
  }
  const fiscais = childElements(dados[0]!)
  if (fiscais.length !== 1) {
    return recusa(
      "bytes_fiscais_nao_embutiveis",
      "Conteúdo fiscal precisa ser exatamente um elemento XML embutível.",
    )
  }
  return { ok: true }
}

/**
 * Extrai de volta os bytes fiscais do envelope. Existe para PROVA (teste de byte-exatidão)
 * e diagnóstico — não faz parse de XML, apenas recorta pelo offset registrado na montagem.
 */
export function extractFiscalBytes(envelope: SefazSoapEnvelope): Uint8Array {
  return envelope.bytes.slice(
    envelope.fiscalBytesOffset,
    envelope.fiscalBytesOffset + envelope.fiscalBytesLength,
  )
}
