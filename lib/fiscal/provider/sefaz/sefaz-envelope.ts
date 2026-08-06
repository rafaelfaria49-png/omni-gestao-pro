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
 * 🟥 **Lacuna conhecida e NÃO corrigida aqui (fora do escopo de 016D-C0).** Pela mesma razão —
 * `childElements` conta só elementos, e a AST de `c14n.toAst` descarta comentário e PI — este
 * módulo ACEITA lixo colado depois da raiz que não contenha `<?xml`: `<NFe/>…</NFe><!--x-->` ou
 * `<NFe/></NFe><?pi d?>`. Não é XML inválido dentro de `nfeDadosMsg`, mas contraria "exatamente
 * um elemento embutível" e deixa passar conteúdo não declarado. Em 016D-C0 a barreira efetiva
 * passou a ser o PRODUTOR (`xmlEmbeddableViolation` → `conteudo_fora_da_raiz`, checado antes da
 * assinatura), de modo que nenhum byte assim é produzível. Fechar o backstop exige contar
 * comentário/PI em `toAst` — mudança no núcleo de canonicalização do XMLDSig, que pede GOAL e
 * autorização próprios.
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
