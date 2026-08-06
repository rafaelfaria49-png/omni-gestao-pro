/**
 * Serializador XML mínimo, PURO e DETERMINÍSTICO (BL-FISCAL-004 — XML NFC-e 4.00).
 *
 * Sem dependências externas, sem efeitos colaterais, sem estado global. Recebe uma árvore
 * de nós e devolve uma string. A ordem dos filhos é EXATAMENTE a ordem do array (o XSD da
 * NFC-e é ordenado por sequência), e a ordem dos atributos é a ordem de inserção do objeto.
 *
 * Por que um serializador próprio (e não uma lib): o builder fiscal precisa de controle total
 * sobre ordenação e escape, saída estável (determinística) e zero dependência de runtime —
 * requisitos da camada fiscal dormente (ADR-0008 P3/P4: documento serializado uma única vez).
 */

export type XmlAttrs = Record<string, string | number | null | undefined>

/**
 * Nó da árvore XML. Um nó é folha (`text`) OU contêiner (`children`), nunca os dois.
 * Filhos podem ser `null`/`undefined`/`false` para permitir grupos opcionais condicionais
 * (são filtrados na serialização).
 */
export type XmlNode = {
  tag: string
  attrs?: XmlAttrs
  children?: Array<XmlNode | null | undefined | false>
  text?: string | number | null
}

/** Escapa texto de elemento (&, <, >). */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Escapa valor de atributo (texto + aspas duplas). */
export function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;")
}

function serializeAttrs(attrs: XmlAttrs | undefined): string {
  if (!attrs) return ""
  const parts: string[] = []
  for (const key of Object.keys(attrs)) {
    const v = attrs[key]
    if (v === null || v === undefined) continue
    parts.push(` ${key}="${escapeXmlAttr(String(v))}"`)
  }
  return parts.join("")
}

function isPresentChild(c: XmlNode | null | undefined | false): c is XmlNode {
  return !!c
}

/**
 * Serializa um nó XML em string com indentação determinística (2 espaços por nível).
 * Folha sem `text` definido vira tag vazia `<tag/>`.
 */
export function serializeXml(
  node: XmlNode,
  opts: { indentUnit?: string; level?: number } = {},
): string {
  const indentUnit = opts.indentUnit ?? "  "
  const level = opts.level ?? 0
  const pad = indentUnit.repeat(level)
  const open = `<${node.tag}${serializeAttrs(node.attrs)}`

  const children = (node.children ?? []).filter(isPresentChild)

  // Folha (com texto) — inclusive texto vazio explícito ("") vira <tag></tag>.
  if (children.length === 0) {
    if (node.text === null || node.text === undefined) {
      return `${pad}${open}/>`
    }
    return `${pad}${open}>${escapeXmlText(String(node.text))}</${node.tag}>`
  }

  // Contêiner — filhos em linhas próprias, ordenados conforme o array.
  const inner = children
    .map((child) => serializeXml(child, { indentUnit, level: level + 1 }))
    .join("\n")
  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`
}

/**
 * Documento XML STANDALONE (com declaração por default).
 *
 * Este é o contrato de DOCUMENTO: os bytes são um arquivo XML completo, legal na posição 0 de
 * um stream. NÃO serve para conteúdo embutido em outro XML (ex.: `nfeDadosMsg` do envelope
 * SOAP da SEFAZ) — para isso existe `serializeXmlEmbeddable`, que carrega contrato próprio.
 */
export function serializeXmlDocument(
  root: XmlNode,
  opts: { declaration?: boolean; indentUnit?: string } = {},
): string {
  const body = serializeXml(root, { indentUnit: opts.indentUnit })
  if (opts.declaration === false) return body
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
}

// ── Contrato do XML EMBUTÍVEL (GOAL-016D-C0) ────────────────────────────────────────────────

/** Violações possíveis do contrato embutível. Nenhuma carrega conteúdo do documento. */
export type XmlEmbeddableViolation =
  | "vazio"
  | "bom_presente"
  | "utf8_invalido"
  | "declaracao_xml"
  | "espaco_fora_da_raiz"
  | "raiz_ausente"
  | "conteudo_fora_da_raiz"

/** Erro de contrato do XML embutível — lançado ANTES de qualquer assinatura ou persistência. */
export class XmlEmbeddableContractError extends Error {
  readonly code: XmlEmbeddableViolation
  constructor(code: XmlEmbeddableViolation, message: string) {
    super(message)
    this.name = "XmlEmbeddableContractError"
    this.code = code
  }
}

/** NameStartChar de XML 1.0 §2.3, restrito ao que este serializador pode emitir. */
const NAME_START = /^<[A-Za-z_:]/

/** Captura o QName da raiz (inclui prefixo — `nfe:NFe` é uma raiz legítima). */
const ROOT_QNAME = /^<([A-Za-z_:][A-Za-z0-9_.:-]*)/

/** Documento que é UMA única tag vazia, sem filhos: `<NFe/>`, `<NFe a="1"/>`. */
const TAG_VAZIA_UNICA = /^<[^<>]*\/>$/

/**
 * U+FEFF. Declarado por code point de propósito: como literal no fonte ele é INVISÍVEL, e um
 * guard de BOM que ninguém consegue ler numa revisão não é um guard.
 */
const BOM = String.fromCharCode(0xfeff)

/**
 * Uma string JS pode conter surrogate solto, que `TextEncoder` substitui em silêncio por U+FFFD —
 * mudando os bytes sem que ninguém perceba. Recusar aqui garante que a codificação UTF-8 dos
 * bytes assinados é total e reversível.
 */
function temSurrogateSolto(s: string): boolean {
  for (const codePoint of s) {
    const code = codePoint.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) return true
  }
  return false
}

/**
 * Verifica o contrato embutível SEM transformar nada. Devolve a violação ou `null`.
 *
 * O contrato é byte-a-byte e deliberadamente conservador — ele existe para ser avaliado ANTES da
 * assinatura, quando corrigir ainda é legítimo. Depois de assinado, qualquer alteração de bytes
 * quebra o XMLDSig e diverge do hash persistido (ADR-0017/0018), então lá só cabe RECUSAR.
 *
 * Checagens (todas parser-free — este módulo não tem dependência):
 *  1. conteúdo presente;
 *  2. zero BOM/U+FEFF (invisível numa inspeção textual e ilegal dentro de um elemento);
 *  3. UTF-8 válido (sem surrogate solto);
 *  4. zero `<?xml` em QUALQUER posição — declaração XML só é legal na posição 0 de um documento
 *     (XML 1.0 §2.8) e o alvo `xml` é reservado para PI (§2.6). A busca é NÃO ancorada pelo mesmo
 *     motivo do guard do envelope: decoy antes ou aninhamento dentro da raiz atravessariam
 *     `/^\s*<\?xml/`. Texto legítimo apareceria escapado (`&lt;?xml`) e não casa aqui;
 *  5. nenhum espaço fora da raiz (as bordas são exatamente `<` … `>`);
 *  6. o documento abre num elemento — não em comentário, PI ou DOCTYPE;
 *  7. o documento TERMINA no fecho da própria raiz.
 *
 * ⚠️ A checagem 7 existe porque as outras seis falhavam ABERTAS para lixo colado DEPOIS da raiz:
 * `<NFe>…</NFe><!--x-->` e `<NFe/><NFe2/>` começam em elemento, terminam em `>`, não têm BOM nem
 * `<?xml` e não deixam espaço nas bordas. Pior, o backstop em que se poderia confiar não pega o
 * caso: `childElements` (envelope SOAP) roda sobre uma AST que descarta comentário e PI, então
 * "exatamente um elemento filho" seguia verdadeiro. Bytes assim atravessariam o signer — que
 * insere a assinatura por `lastIndexOf("</NFe>")` e preservaria o lixo — e chegariam intactos ao
 * `nfeDadosMsg`. Comparar o fecho com o QName da raiz é parser-free e fecha as três famílias
 * (comentário, PI e segunda raiz) de uma vez.
 *
 * ⚠️ Esta é uma condição NECESSÁRIA, não uma prova de boa-formação: `<NFe></NFe><!--x--></NFe>`
 * termina no fecho certo e passa aqui. Quem prova boa-formação é o parser a jusante (`parseXml`
 * no signer, `verificarEnvelope` no adapter). O par condição-necessária + parser é que é
 * suficiente; nenhuma das duas metades é afirmada como suficiente sozinha.
 */
export function xmlEmbeddableViolation(xml: string): XmlEmbeddableViolation | null {
  if (typeof xml !== "string" || xml.length === 0) return "vazio"
  if (xml.includes(BOM)) return "bom_presente"
  if (temSurrogateSolto(xml)) return "utf8_invalido"
  if (/<\?xml/i.test(xml)) return "declaracao_xml"
  if (xml.trim().length === 0) return "vazio"
  if (xml.trim() !== xml) return "espaco_fora_da_raiz"
  if (!NAME_START.test(xml) || !xml.endsWith(">")) return "raiz_ausente"

  const raiz = ROOT_QNAME.exec(xml)?.[1]
  if (!raiz) return "raiz_ausente"
  if (!TAG_VAZIA_UNICA.test(xml) && !xml.endsWith(`</${raiz}>`)) return "conteudo_fora_da_raiz"
  return null
}

/** Igual a `xmlEmbeddableViolation`, mas falha fechada. Nunca altera os bytes recebidos. */
export function assertEmbeddableXml(xml: string): void {
  const violacao = xmlEmbeddableViolation(xml)
  if (violacao) {
    throw new XmlEmbeddableContractError(
      violacao,
      `XML não satisfaz o contrato embutível (${violacao}); conteúdo destinado a assinatura/transmissão recusado na origem.`,
    )
  }
}

/**
 * Fragmento XML EMBUTÍVEL — o contrato de conteúdo que entra dentro de outro XML.
 *
 * Produz exatamente o corpo serializado, sem declaração e sem BOM, e PROVA o contrato antes de
 * devolver. É o produtor destinado a assinatura/transmissão fiscal: os bytes daqui são os mesmos
 * que serão assinados, hasheados, persistidos e concatenados no `nfeDadosMsg` do envelope SOAP.
 */
export function serializeXmlEmbeddable(
  root: XmlNode,
  opts: { indentUnit?: string } = {},
): string {
  const xml = serializeXml(root, { indentUnit: opts.indentUnit })
  assertEmbeddableXml(xml)
  return xml
}

/** Helper de folha: cria um nó-texto, ou `null` quando o valor é vazio/ausente. */
export function leaf(tag: string, value: string | number | null | undefined): XmlNode | null {
  if (value === null || value === undefined) return null
  const s = typeof value === "number" ? String(value) : value
  if (s === "") return null
  return { tag, text: s }
}

/** Helper de folha obrigatória: sempre emite a tag (mesmo com valor vazio). */
export function leafRequired(tag: string, value: string | number): XmlNode {
  return { tag, text: value }
}

/** Helper de contêiner: cria um nó com filhos (já filtra nulos na serialização). */
export function group(
  tag: string,
  children: Array<XmlNode | null | undefined | false>,
  attrs?: XmlAttrs,
): XmlNode {
  return { tag, attrs, children }
}
