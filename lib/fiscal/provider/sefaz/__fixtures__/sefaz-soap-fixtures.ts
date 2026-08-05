/**
 * Fixtures SOAP da SEFAZ — **100% sintéticas** (GOAL-016D-B).
 *
 * ## Nenhum dado real, por construção
 *
 * Nenhuma fixture contém CNPJ, IE, CSC, chave de acesso, certificado, protocolo de produção,
 * nome ou endereço de cliente reais. Os identificadores usam preenchimentos que **não podem**
 * existir na natureza:
 *
 *  - CNPJ `99999999999999` — dígitos verificadores inválidos, jamais emitido;
 *  - chave de acesso construída sobre esse CNPJ, com DV deliberadamente arbitrário;
 *  - `nProt`/`nRec` com prefixo `999`, fora da faixa emitida por SP;
 *  - nenhuma resposta é cópia de tráfego real — todas foram escritas à mão a partir do leiaute.
 *
 * ## O que estas fixtures provam
 *
 * Além do caminho feliz, elas exercitam o parser sob **entrada adversarial**: chamarizes fora
 * do caminho estrutural, `cStat` escondido em comentário e em CDATA, dois `cStat` conflitantes,
 * namespace parecido, wrapper de outro serviço, SOAP Fault, XML truncado, `nRec` ausente num
 * `103` e `nProt` ausente num `100`. Todas devem terminar **fechadas** (`UNCERTAIN`), nunca em
 * `AUTHORIZED` ou `REJECTED`.
 *
 * ⚠️ **Fidelidade de wire limitada (H-9/H-10).** O nome do wrapper (`nfeResultMsg`) e os
 * namespaces vêm do MOC 7.00 já versionado; o `SOAPAction` e o WSDL não estão no repositório e
 * buscá-los seria chamar a SEFAZ, vedado neste GOAL. Isso limita a fidelidade do envelope — não
 * a lógica de classificação, que é independente do wire.
 */
import { sefazServiceNamespace, type SefazServico } from "../sefaz-endpoint-catalog"

const NFE_NS = "http://www.portalfiscal.inf.br/nfe"
const SOAP12_NS = "http://www.w3.org/2003/05/soap-envelope"

/** CNPJ impossível (DV inválido). Nunca corresponde a um contribuinte real. */
export const CNPJ_SINTETICO = "99999999999999"
/** Chave de 44 dígitos montada sobre o CNPJ impossível. Sintética de ponta a ponta. */
export const CHAVE_SINTETICA = "35990199999999999999650999000000001199999999"
/** Protocolo sintético — prefixo `999`, fora de qualquer faixa emitida. */
export const PROTOCOLO_SINTETICO = "999000000000001"
/** Recibo de lote sintético. */
export const RECIBO_SINTETICO = "999000000000042"

function envelope(corpo: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="${SOAP12_NS}"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`
  )
}

function wrapper(servico: SefazServico, payload: string): string {
  return `<nfeResultMsg xmlns="${sefazServiceNamespace(servico)}">${payload}</nfeResultMsg>`
}

function cabecalhoLote(cStat: string, xMotivo: string): string {
  return (
    `<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic>` +
    `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF>` +
    `<dhRecbto>2026-01-01T10:00:00-03:00</dhRecbto>`
  )
}

function infProt(input: { cStat: string; xMotivo: string; nProt?: string }): string {
  return (
    `<protNFe versao="4.00"><infProt>` +
    `<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic>` +
    `<chNFe>${CHAVE_SINTETICA}</chNFe>` +
    `<dhRecbto>2026-01-01T10:00:05-03:00</dhRecbto>` +
    (input.nProt ? `<nProt>${input.nProt}</nProt>` : "") +
    `<cStat>${input.cStat}</cStat><xMotivo>${input.xMotivo}</xMotivo>` +
    `</infProt></protNFe>`
  )
}

/** `nfeProc` sintético — o único ponto em que o parser aceita XML autorizado, e verbatim. */
function nfeProcSintetico(): string {
  return (
    `<nfeProc xmlns="${NFE_NS}" versao="4.00">` +
    `<NFe><infNFe Id="NFe${CHAVE_SINTETICA}" versao="4.00"><ide><tpAmb>2</tpAmb></ide></infNFe></NFe>` +
    infProt({ cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO_SINTETICO }) +
    `</nfeProc>`
  )
}

function retEnviNFe(conteudo: string): string {
  return `<retEnviNFe xmlns="${NFE_NS}" versao="4.00">${conteudo}</retEnviNFe>`
}

function retConsSitNFe(conteudo: string): string {
  return `<retConsSitNFe xmlns="${NFE_NS}" versao="4.00">${conteudo}</retConsSitNFe>`
}

function retConsReciNFe(conteudo: string): string {
  return `<retConsReciNFe xmlns="${NFE_NS}" versao="4.00">${conteudo}</retConsReciNFe>`
}

// ── Caminho feliz e suas lacunas ────────────────────────────────────────────────────────────

/** `104` (lote processado) → `100` no protocolo, com `nProt` e `nfeProc`. Único AUTHORIZED. */
export const AUTORIZACAO_AUTORIZADA = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("104", "Lote processado") +
        infProt({ cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO_SINTETICO }) +
        nfeProcSintetico(),
    ),
  ),
)

/** `100` **sem `nProt`** — protocolo ausente ⇒ INCOMPLETE_AUTHORIZATION. */
export const AUTORIZACAO_SEM_PROTOCOLO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("104", "Lote processado") +
        infProt({ cStat: "100", xMotivo: "Autorizado o uso da NF-e" }) +
        nfeProcSintetico(),
    ),
  ),
)

/** `100` com protocolo, **sem `nfeProc`** — é a forma REAL da resposta SEFAZ hoje. */
export const AUTORIZACAO_SEM_XML_AUTORIZADO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("104", "Lote processado") +
        infProt({ cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO_SINTETICO }),
    ),
  ),
)

/** `104` sem `protNFe` algum — lote processado que não diz o que houve com o documento. */
export const AUTORIZACAO_LOTE_SEM_PROTOCOLO = envelope(
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("104", "Lote processado"))),
)

// ── PROCESSING ─────────────────────────────────────────────────────────────────────────────

/** `103` com recibo → PROCESSING. */
export const AUTORIZACAO_LOTE_RECEBIDO_103 = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("103", "Lote recebido com sucesso") +
        `<infRec><nRec>${RECIBO_SINTETICO}</nRec><tMed>1</tMed></infRec>`,
    ),
  ),
)

/** `103` **sem `nRec`** — sem recibo não há lote a consultar ⇒ fail-closed. */
export const AUTORIZACAO_LOTE_RECEBIDO_SEM_RECIBO = envelope(
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("103", "Lote recebido com sucesso"))),
)

/** `105` em `NFeRetAutorizacao4`, com `nRec` no caminho próprio daquele serviço. */
export const RET_AUTORIZACAO_EM_PROCESSAMENTO_105 = envelope(
  wrapper(
    "NFeRetAutorizacao4",
    retConsReciNFe(
      `<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic><nRec>${RECIBO_SINTETICO}</nRec>` +
        `<cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>35</cUF>`,
    ),
  ),
)

// ── Rejeição, duplicidade, não-consta, indisponibilidade e consumo indevido ────────────────

/** `110` (denegação) no protocolo do lote → REJECTED terminal, número consumido. */
export const AUTORIZACAO_DENEGADA_110 = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("104", "Lote processado") + infProt({ cStat: "110", xMotivo: "Uso Denegado" }),
    ),
  ),
)

/** `204` (duplicidade) → consultar e convergir; jamais retransmitir por conta própria. */
export const AUTORIZACAO_DUPLICIDADE_204 = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      cabecalhoLote("104", "Lote processado") +
        infProt({ cStat: "204", xMotivo: "Duplicidade de NF-e" }),
    ),
  ),
)

/** `217` em CONSULTA → NOT_FOUND (único serviço em que o código é legítimo). */
export const CONSULTA_NAO_CONSTA_217 = envelope(
  wrapper(
    "NFeConsultaProtocolo4",
    retConsSitNFe(
      `<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic>` +
        `<cStat>217</cStat><xMotivo>NF-e nao consta na base de dados da SEFAZ</xMotivo>` +
        `<cUF>35</cUF><chNFe>${CHAVE_SINTETICA}</chNFe>`,
    ),
  ),
)

/** `217` numa resposta de AUTORIZAÇÃO — impossível no leiaute ⇒ SERVICE_MISMATCH. */
export const AUTORIZACAO_NAO_CONSTA_217 = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(cabecalhoLote("217", "NF-e nao consta na base de dados da SEFAZ")),
  ),
)

/** `100` em consulta com protocolo e `nfeProc` → AUTHORIZED pelo caminho da consulta. */
export const CONSULTA_AUTORIZADA_100 = envelope(
  wrapper(
    "NFeConsultaProtocolo4",
    retConsSitNFe(
      `<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic>` +
        `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>` +
        `<cUF>35</cUF><chNFe>${CHAVE_SINTETICA}</chNFe>` +
        infProt({ cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO_SINTETICO }) +
        nfeProcSintetico(),
    ),
  ),
)

/** `108` — serviço paralisado momentaneamente. */
export const AUTORIZACAO_SERVICO_PARALISADO_108 = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(cabecalhoLote("108", "Servico Paralisado Momentaneamente")),
  ),
)

/** `109` — serviço paralisado sem previsão. */
export const AUTORIZACAO_SERVICO_PARALISADO_109 = envelope(
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("109", "Servico Paralisado sem Previsao"))),
)

/** `656` na transmissão → THROTTLED. */
export const AUTORIZACAO_CONSUMO_INDEVIDO_656 = envelope(
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("656", "Rejeicao: Consumo Indevido"))),
)

/** `656` na consulta → THROTTLED também ali; a consulta não se reagenda. */
export const CONSULTA_CONSUMO_INDEVIDO_656 = envelope(
  wrapper(
    "NFeConsultaProtocolo4",
    retConsSitNFe(
      `<tpAmb>2</tpAmb><cStat>656</cStat><xMotivo>Rejeicao: Consumo Indevido</xMotivo>` +
        `<cUF>35</cUF><chNFe>${CHAVE_SINTETICA}</chNFe>`,
    ),
  ),
)

/** `cStat` fora da matriz → UNCERTAIN/UNKNOWN. Jamais REJECTED. */
export const AUTORIZACAO_CSTAT_DESCONHECIDO = envelope(
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("999", "Codigo inexistente na matriz"))),
)

// ── Fixtures adversariais ──────────────────────────────────────────────────────────────────

/** SOAP Fault legítimo do SOAP 1.2. */
export const SOAP_FAULT = envelope(
  `<soap12:Fault><soap12:Code><soap12:Value>soap12:Receiver</soap12:Value></soap12:Code>` +
    `<soap12:Reason><soap12:Text xml:lang="pt">Falha interna sintetica</soap12:Text></soap12:Reason>` +
    `</soap12:Fault>`,
)

/**
 * SOAP Fault **acompanhado** de um `nfeResultMsg` com `cStat 100`.
 *
 * Se o parser procurasse o wrapper primeiro, autorizaria um documento a partir de uma resposta
 * que se declarou falha. O Fault vence.
 */
export const SOAP_FAULT_COM_CHAMARIZ_AUTORIZADO = envelope(
  `<soap12:Fault><soap12:Code><soap12:Value>soap12:Receiver</soap12:Value></soap12:Code></soap12:Fault>` +
    wrapper(
      "NFeAutorizacao4",
      retEnviNFe(
        cabecalhoLote("104", "Lote processado") +
          infProt({ cStat: "100", xMotivo: "Autorizado", nProt: PROTOCOLO_SINTETICO }) +
          nfeProcSintetico(),
      ),
    ),
)

/** Resposta bem-formada, porém sem `cStat` no caminho esperado. */
export const RESPOSTA_SEM_CSTAT = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(`<tpAmb>2</tpAmb><verAplic>SP_TESTE_SINTETICO</verAplic><cUF>35</cUF>`),
  ),
)

/**
 * `cStat 100` **dentro de um comentário XML**, sem `cStat` real.
 *
 * Comentários não são nós de elemento; o parser sequer os enxerga. O desfecho tem de ser
 * "sem `cStat`", não "autorizado".
 */
export const CSTAT_EM_COMENTARIO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(`<tpAmb>2</tpAmb><!-- <cStat>100</cStat><xMotivo>Autorizado</xMotivo> --><cUF>35</cUF>`),
  ),
)

/** `cStat` entregue via CDATA. A seção é recusada por completo — ambiguidade não se lê. */
export const CSTAT_EM_CDATA = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(`<tpAmb>2</tpAmb><cStat><![CDATA[100]]></cStat><xMotivo>Autorizado</xMotivo>`),
  ),
)

/** Dois `cStat` conflitantes no MESMO caminho: `100` e `110`. Ambiguidade, não "o primeiro". */
export const DOIS_CSTAT_CONFLITANTES = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      `<tpAmb>2</tpAmb><cStat>100</cStat><cStat>110</cStat><xMotivo>Conflito sintetico</xMotivo>`,
    ),
  ),
)

/**
 * `cStat 100` plantado FORA do caminho estrutural (aninhado sob um elemento decorativo),
 * enquanto o `cStat` verdadeiro do caminho é `656`.
 *
 * Uma busca global pegaria o `100`. O desfecho correto é THROTTLED.
 */
export const CHAMARIZ_CSTAT_FORA_DO_CAMINHO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      `<tpAmb>2</tpAmb>` +
        `<observacao><cStat>100</cStat><nProt>${PROTOCOLO_SINTETICO}</nProt></observacao>` +
        `<cStat>656</cStat><xMotivo>Rejeicao: Consumo Indevido</xMotivo>`,
    ),
  ),
)

/**
 * `cStat 100` em um `cStat` de **namespace falso**, com o verdadeiro ausente.
 *
 * O elemento tem o nome certo e a posição certa; só o namespace é outro. Sem exigência de
 * namespace, autorizaria.
 */
export const CSTAT_EM_NAMESPACE_FALSO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retEnviNFe(
      `<tpAmb>2</tpAmb><cStat xmlns="http://www.portalfiscal.inf.br/nfe-falso">100</cStat>`,
    ),
  ),
)

/** Payload num namespace **parecido** com o oficial (sufixo extra). Igualdade exata barra. */
export const PAYLOAD_NAMESPACE_PARECIDO = envelope(
  wrapper(
    "NFeAutorizacao4",
    `<retEnviNFe xmlns="${NFE_NS}/" versao="4.00">${cabecalhoLote("104", "Lote processado")}` +
      infProt({ cStat: "100", xMotivo: "Autorizado", nProt: PROTOCOLO_SINTETICO }) +
      `</retEnviNFe>`,
  ),
)

/** Wrapper com namespace WSDL **de outro serviço** (consulta) numa chamada de autorização. */
export const WRAPPER_DE_OUTRO_SERVICO = envelope(
  wrapper(
    "NFeConsultaProtocolo4",
    retConsSitNFe(`<tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado</xMotivo>`),
  ),
)

/** Payload de outro serviço dentro do wrapper CORRETO — divergência interna. */
export const PAYLOAD_DE_OUTRO_SERVICO = envelope(
  wrapper(
    "NFeAutorizacao4",
    retConsSitNFe(`<tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado</xMotivo>`),
  ),
)

/** XML truncado no meio — o parser não pode "consertar" e seguir. */
export const XML_TRUNCADO =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap12:Envelope xmlns:soap12="${SOAP12_NS}"><soap12:Body>` +
  wrapper("NFeAutorizacao4", `<retEnviNFe xmlns="${NFE_NS}"><cStat>100</cStat>`)

/** Dois `soap12:Body` no mesmo envelope. */
export const DOIS_BODIES =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap12:Envelope xmlns:soap12="${SOAP12_NS}">` +
  `<soap12:Body>${wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("656", "Consumo Indevido")))}</soap12:Body>` +
  `<soap12:Body>${wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("104", "Lote processado") + infProt({ cStat: "100", xMotivo: "Autorizado", nProt: PROTOCOLO_SINTETICO })))}</soap12:Body>` +
  `</soap12:Envelope>`

/** Envelope SOAP 1.1 — o piloto exige 1.2. */
export const ENVELOPE_SOAP_11 =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("104", "Lote processado"))) +
  `</soap:Body></soap:Envelope>`

/** DTD com entidade — vetor clássico de XXE. Recusado antes do parser. */
export const RESPOSTA_COM_DTD =
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<!DOCTYPE soap12:Envelope [<!ENTITY xxe "100">]>` +
  `<soap12:Envelope xmlns:soap12="${SOAP12_NS}"><soap12:Body>` +
  wrapper("NFeAutorizacao4", retEnviNFe(cabecalhoLote("104", "Lote processado"))) +
  `</soap12:Body></soap12:Envelope>`

/** Segunda chave sintética — existe só para provar recusa de resposta de OUTRO documento. */
export const OUTRA_CHAVE_SINTETICA = "35990199999999999999650999000000002199999999"

/**
 * `cStat 100` do documento A, com `nfeProc` do documento **B**.
 *
 * Achado BLOQUEANTE da revisão independente do 016D-B: sem conferir o vínculo, o parser
 * devolvia `AUTHORIZED` com o XML de outro documento — que `markAuthorized` grava de forma
 * imutável na nota errada.
 */
export const CONSULTA_AUTORIZADA_COM_NFEPROC_DE_OUTRO_DOCUMENTO = CONSULTA_AUTORIZADA_100.replace(
  `<nfeProc xmlns="${NFE_NS}" versao="4.00"><NFe><infNFe Id="NFe${CHAVE_SINTETICA}"`,
  `<nfeProc xmlns="${NFE_NS}" versao="4.00"><NFe><infNFe Id="NFe${OUTRA_CHAVE_SINTETICA}"`,
)

/** Mesmo ataque pelo protocolo: o `nProt` interno ao `nfeProc` é de outra autorização. */
export const CONSULTA_AUTORIZADA_COM_PROTOCOLO_DIVERGENTE = CONSULTA_AUTORIZADA_100.replace(
  `<nProt>${PROTOCOLO_SINTETICO}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`,
  `<nProt>999000000000002</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`,
)

/** Resposta que declara duas chaves de acesso diferentes nos dois caminhos estruturais. */
export const CONSULTA_COM_DUAS_CHAVES = CONSULTA_AUTORIZADA_100.replace(
  `<cUF>35</cUF><chNFe>${CHAVE_SINTETICA}</chNFe>`,
  `<cUF>35</cUF><chNFe>${OUTRA_CHAVE_SINTETICA}</chNFe>`,
)

/** `nProt` com markup escapado — decodifica para `<x>` e vazaria para coluna imutável e log. */
export const AUTORIZACAO_PROTOCOLO_NAO_NUMERICO = AUTORIZACAO_AUTORIZADA.replace(
  `<nProt>${PROTOCOLO_SINTETICO}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe><nfeProc`,
  `<nProt>999&lt;x&gt;000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe><nfeProc`,
)

/** `nRec` com markup escapado. Mesmo vetor, no caminho do recibo. */
export const AUTORIZACAO_RECIBO_NAO_NUMERICO = AUTORIZACAO_LOTE_RECEBIDO_103.replace(
  `<nRec>${RECIBO_SINTETICO}</nRec>`,
  `<nRec>999&lt;x&gt;000042</nRec>`,
)

/** Bytes com BOM UTF-8 antes da declaração. */
export function bytesComBom(): Uint8Array {
  const corpo = new TextEncoder().encode(AUTORIZACAO_AUTORIZADA)
  const comBom = new Uint8Array(corpo.length + 3)
  comBom.set([0xef, 0xbb, 0xbf], 0)
  comBom.set(corpo, 3)
  return comBom
}

/** Bytes que não formam UTF-8 válido — decodificação estrita recusa em vez de substituir. */
export function bytesNaoUtf8(): Uint8Array {
  const corpo = new TextEncoder().encode(AUTORIZACAO_AUTORIZADA)
  const invalido = new Uint8Array(corpo.length + 2)
  invalido.set(corpo, 0)
  // 0xC3 inicia uma sequência de 2 bytes; 0x28 não é continuação válida.
  invalido.set([0xc3, 0x28], corpo.length)
  return invalido
}

/** Utilitário dos testes: bytes UTF-8 de uma fixture textual. */
export function bytesDaFixture(xml: string): Uint8Array {
  return new TextEncoder().encode(xml)
}
