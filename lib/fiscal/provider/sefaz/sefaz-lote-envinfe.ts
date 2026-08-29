/**
 * Compositor do corpo oficial de requisição de `NFeAutorizacao4` (GOAL 020 · live
 * readiness interna · leiaute PL_010e_v1.02, `TEnviNFe`).
 *
 * O leiaute 4.00 exige que o corpo de `NFeAutorizacao4` seja
 * `<enviNFe versao="4.00"><idLote/><indSinc/><NFe>…</NFe></enviNFe>`. O drill
 * transmite EXCLUSIVAMENTE bytes já persistidos e conferidos por hash
 * (ADR-0017/0018): a NFe assinada permanece **byte-idêntica** no interior desta
 * composição — ela é scaffolding de REQUISIÇÃO, exatamente como o envelope SOAP,
 * e nunca realimenta os bytes persistidos, o hash nem o documento.
 *
 * Regras:
 *  - **Concatenação de bytes** — sem parse, re-serialização, normalização ou
 *    re-indentação do conteúdo fiscal; o recorte entra intacto entre prefixo e
 *    sufixo gerados aqui.
 *  - `indSinc` fixo `1` (B-2 do relatório 127): a modalidade efetiva do piloto
 *    NFC-e SP é SÍNCRONA — a resposta traz `protNFe` diretamente e `103/105`
 *    não ocorre no modo usado; o parser continua cobrindo o assíncrono por
 *    defesa em profundidade.
 *  - `idLote` fixo `1`: controle de REQUISIÇÃO do lote (1–15 dígitos no
 *    leiaute), nunca numeração de documento — `nNF` não é tocado e nenhuma
 *    numeração é criada ou reutilizada.
 *  - A entrada é verificada sobre uma CÓPIA decodificada (raiz única `NFe` no
 *    namespace oficial); a saída devolvida é a concatenação, nada realimenta.
 */
import { parseXml } from "@/lib/fiscal/signing/c14n"
import { SEFAZ_LAYOUT_VERSAO } from "./sefaz-endpoint-catalog"

export const SEFAZ_NFE_NS = "http://www.portalfiscal.inf.br/nfe"

/** Controle de requisição do lote — fixo; NUNCA numeração de documento. */
export const SEFAZ_ENVI_NFE_ID_LOTE = "1" as const
/** Modalidade efetiva do piloto NFC-e SP: processamento SÍNCRONO. */
export const SEFAZ_ENVI_NFE_IND_SINC = "1" as const

export type SefazEnviNFeRejectionCode =
  | "envinfe_bytes_ausentes"
  | "envinfe_bytes_com_bom"
  | "envinfe_bytes_nao_utf8"
  | "envinfe_raiz_nao_e_nfe"
  | "envinfe_mal_formado"

export type SefazEnviNFeComposition = {
  readonly ok: true
  /** `enviNFe` completo em bytes — os bytes fiscais aparecem intactos no meio. */
  readonly bytes: Uint8Array
  /** Offset onde os bytes fiscais começam dentro de `bytes`. */
  readonly fiscalBytesOffset: number
  readonly fiscalBytesLength: number
}

export type SefazEnviNFeResult =
  | SefazEnviNFeComposition
  | { readonly ok: false; readonly codigo: SefazEnviNFeRejectionCode; readonly mensagem: string }

function recusa(
  codigo: SefazEnviNFeRejectionCode,
  mensagem: string,
): Extract<SefazEnviNFeResult, { ok: false }> {
  return { ok: false, codigo, mensagem }
}

function comecaComBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function decodificarUtf8Estrito(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Componha o `enviNFe` de requisição preservando os bytes fiscais byte a byte,
 * ou RECUSE de forma fail-closed com código estável.
 *
 * `exactBytes` deve ser exatamente o documento NFe assinado persistido — este
 * módulo não gera, altera, assina ou repara XML.
 */
export function composeEnviNFeRequest(input: { exactBytes: Uint8Array }): SefazEnviNFeResult {
  const { exactBytes } = input

  if (exactBytes.length === 0) {
    return recusa("envinfe_bytes_ausentes", "Sem bytes fiscais para compor a requisição.")
  }
  if (comecaComBom(exactBytes)) {
    return recusa("envinfe_bytes_com_bom", "Bytes fiscais iniciam com BOM; composição recusada.")
  }
  const conteudo = decodificarUtf8Estrito(exactBytes)
  if (conteudo === null) {
    return recusa("envinfe_bytes_nao_utf8", "Bytes fiscais não são UTF-8 válido; recusado.")
  }

  // A CÓPIA decodificada serve apenas para VERIFICAR a raiz; a saída é a
  // concatenação dos bytes originais — nada aqui realimenta o resultado.
  let raiz
  try {
    raiz = parseXml(conteudo)
  } catch {
    return recusa("envinfe_mal_formado", "Bytes fiscais não são XML bem-formado; recusados.")
  }
  /**
   * Exige raiz única `NFe`; havendo namespace, ele precisa ser o oficial. A validade
   * FISCAL do documento (leiaute, namespace obrigatório, assinatura) é autoridade do
   * XSD oficial (guard 8 / pre-flight) — este módulo só impede compor scaffolding em
   * torno de conteúdo que não é uma NFe.
   */
  if (raiz.name !== "NFe" || (raiz.namespaceUri !== null && raiz.namespaceUri !== SEFAZ_NFE_NS)) {
    return recusa(
      "envinfe_raiz_nao_e_nfe",
      "A requisição NFeAutorizacao4 exige exatamente uma raiz NFe.",
    )
  }

  const encoder = new TextEncoder()
  const prefixo = encoder.encode(
    `<enviNFe xmlns="${SEFAZ_NFE_NS}" versao="${SEFAZ_LAYOUT_VERSAO}">` +
      `<idLote>${SEFAZ_ENVI_NFE_ID_LOTE}</idLote>` +
      `<indSinc>${SEFAZ_ENVI_NFE_IND_SINC}</indSinc>`,
  )
  const sufixo = encoder.encode(`</enviNFe>`)

  const bytes = new Uint8Array(prefixo.length + exactBytes.length + sufixo.length)
  bytes.set(prefixo, 0)
  bytes.set(exactBytes, prefixo.length)
  bytes.set(sufixo, prefixo.length + exactBytes.length)

  // Verificação sobre uma CÓPIA do produto: o composto precisa ser XML
  // bem-formado com raiz enviNFe. O devolvido continua sendo `bytes`.
  const verificacao = (() => {
    try {
      return parseXml(new TextDecoder().decode(bytes)).name === "enviNFe"
    } catch {
      return false
    }
  })()
  if (!verificacao) {
    return recusa("envinfe_mal_formado", "enviNFe composto não é XML bem-formado; recusado.")
  }

  return {
    ok: true,
    bytes,
    fiscalBytesOffset: prefixo.length,
    fiscalBytesLength: exactBytes.length,
  }
}
