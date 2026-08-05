/**
 * GOAL-016D-B — parser estrito de resposta SOAP 1.2.
 *
 * O eixo destes testes é adversarial. Um parser de resposta fiscal que "acha" o `cStat` no
 * documento pode ser dirigido por quem controla a resposta: basta plantar um `100` num
 * comentário, numa CDATA, num namespace parecido ou fora do caminho estrutural. Cada fixture
 * abaixo é um desses ataques, e a asserção é sempre a mesma família de desfecho: **fechado**.
 */
import { describe, expect, it } from "vitest"
import {
  parseSefazSoapResponse,
  toFiscalConsultationResult,
  toFiscalTransmissionResult,
  type SefazResponseClassification,
} from "./sefaz-response-parser"
import { SEFAZ_CSTAT_MATRIX_VERSION } from "./sefaz-cstat-matrix"
import type { SefazServico } from "./sefaz-endpoint-catalog"
import * as F from "./__fixtures__/sefaz-soap-fixtures"

function classificar(
  body: string | Uint8Array,
  servico: SefazServico = "NFeAutorizacao4",
  chaveAcessoEsperada: string = F.CHAVE_SINTETICA,
): SefazResponseClassification {
  return parseSefazSoapResponse({ servico, body, chaveAcessoEsperada })
}

describe("parser SOAP — caminho feliz e suas lacunas", () => {
  it("104 + 100 com protocolo e nfeProc ⇒ AUTHORIZED", () => {
    const c = classificar(F.AUTORIZACAO_AUTORIZADA)
    expect(c.outcome).toBe("AUTHORIZED")
    expect(c.cStat).toBe("100")
    expect(c.protocolo).toBe(F.PROTOCOLO_SINTETICO)
    expect(c.xmlAutorizado).toContain("<nfeProc")
    expect(c.matrixVersion).toBe(SEFAZ_CSTAT_MATRIX_VERSION)
  })

  it("o XML autorizado sai VERBATIM da resposta, sem reserialização", () => {
    const c = classificar(F.AUTORIZACAO_AUTORIZADA)
    expect(c.xmlAutorizado).not.toBeNull()
    // Comparação por substring exata: o recorte precisa existir tal e qual na resposta.
    expect(F.AUTORIZACAO_AUTORIZADA).toContain(c.xmlAutorizado!)
  })

  it("100 SEM protocolo ⇒ INCOMPLETE_AUTHORIZATION, jamais AUTHORIZED", () => {
    const c = classificar(F.AUTORIZACAO_SEM_PROTOCOLO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("INCOMPLETE_AUTHORIZATION")
  })

  it("100 SEM XML autorizado ⇒ INCOMPLETE_AUTHORIZATION (o parser não inventa nfeProc)", () => {
    const c = classificar(F.AUTORIZACAO_SEM_XML_AUTORIZADO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("INCOMPLETE_AUTHORIZATION")
    expect(c.xmlAutorizado).toBeNull()
  })

  it("104 sem protNFe ⇒ desfecho do documento desconhecido", () => {
    const c = classificar(F.AUTORIZACAO_LOTE_SEM_PROTOCOLO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("MISSING_CSTAT")
  })

  it("100 em consulta converge para AUTHORIZED com protocolo e XML válidos", () => {
    const c = classificar(F.CONSULTA_AUTORIZADA_100, "NFeConsultaProtocolo4")
    expect(c.outcome).toBe("AUTHORIZED")
    expect(c.protocolo).toBe(F.PROTOCOLO_SINTETICO)
    expect(c.xmlAutorizado).toContain("<nfeProc")
  })
})

describe("parser SOAP — PROCESSING", () => {
  it("103 com nRec ⇒ PROCESSING com recibo", () => {
    const c = classificar(F.AUTORIZACAO_LOTE_RECEBIDO_103)
    expect(c.outcome).toBe("PROCESSING")
    expect(c.recibo).toBe(F.RECIBO_SINTETICO)
    expect(c.consequencias.requiresConsultation).toBe(true)
  })

  it("105 em NFeRetAutorizacao4 lê o nRec no caminho próprio daquele serviço", () => {
    const c = classificar(F.RET_AUTORIZACAO_EM_PROCESSAMENTO_105, "NFeRetAutorizacao4")
    expect(c.outcome).toBe("PROCESSING")
    expect(c.recibo).toBe(F.RECIBO_SINTETICO)
  })

  it("103 SEM nRec falha fechado — sem recibo não há lote a consultar", () => {
    const c = classificar(F.AUTORIZACAO_LOTE_RECEBIDO_SEM_RECIBO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("PROCESSING_SEM_RECIBO")
    expect(c.recibo).toBeNull()
  })
})

describe("parser SOAP — rejeição, duplicidade, não-consta e consumo indevido", () => {
  it("110 ⇒ REJECTED terminal, número consumido, SEM inutilização", () => {
    const c = classificar(F.AUTORIZACAO_DENEGADA_110)
    expect(c.outcome).toBe("REJECTED")
    expect(c.consequencias).toMatchObject({
      terminal: true,
      numeroConsumido: true,
      requiresInutilizacao: false,
    })
  })

  it("204 ⇒ incerto que EXIGE consulta, nunca autorização de retransmissão", () => {
    const c = classificar(F.AUTORIZACAO_DUPLICIDADE_204)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("DUPLICATE_REQUIRES_CONSULTATION")
    expect(c.consequencias.requiresConsultation).toBe(true)
  })

  it("217 em consulta ⇒ NOT_FOUND", () => {
    const c = classificar(F.CONSULTA_NAO_CONSTA_217, "NFeConsultaProtocolo4")
    expect(c.outcome).toBe("NOT_FOUND")
    expect(c.cStat).toBe("217")
  })

  it("217 numa resposta de AUTORIZAÇÃO não vira NOT_FOUND", () => {
    const c = classificar(F.AUTORIZACAO_NAO_CONSTA_217)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("SERVICE_MISMATCH")
  })

  it("108 e 109 ⇒ serviço indisponível", () => {
    for (const fixture of [
      F.AUTORIZACAO_SERVICO_PARALISADO_108,
      F.AUTORIZACAO_SERVICO_PARALISADO_109,
    ]) {
      const c = classificar(fixture)
      expect(c.outcome).toBe("UNCERTAIN")
      expect(c.reason).toBe("SERVICE_UNAVAILABLE")
    }
  })

  it("656 ⇒ THROTTLED na transmissão e na consulta", () => {
    const transmissao = classificar(F.AUTORIZACAO_CONSUMO_INDEVIDO_656)
    expect(transmissao.outcome).toBe("THROTTLED")
    expect(transmissao.consequencias.requiresConsultation).toBe(false)

    const consulta = classificar(F.CONSULTA_CONSUMO_INDEVIDO_656, "NFeConsultaProtocolo4")
    expect(consulta.outcome).toBe("THROTTLED")
    expect(consulta.consequencias.requiresConsultation).toBe(false)
  })

  it("cStat desconhecido ⇒ UNCERTAIN/UNKNOWN, jamais REJECTED", () => {
    const c = classificar(F.AUTORIZACAO_CSTAT_DESCONHECIDO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("UNKNOWN")
  })
})

describe("parser SOAP — fixtures adversariais falham FECHADAS", () => {
  const adversariais: Array<[string, string | Uint8Array, string]> = [
    ["SOAP Fault", F.SOAP_FAULT, "SOAP_FAULT"],
    ["SOAP Fault com chamariz autorizado", F.SOAP_FAULT_COM_CHAMARIZ_AUTORIZADO, "SOAP_FAULT"],
    ["resposta sem cStat", F.RESPOSTA_SEM_CSTAT, "MISSING_CSTAT"],
    ["cStat em comentário", F.CSTAT_EM_COMENTARIO, "MISSING_CSTAT"],
    ["cStat em CDATA", F.CSTAT_EM_CDATA, "MALFORMED_RESPONSE"],
    ["dois cStat conflitantes", F.DOIS_CSTAT_CONFLITANTES, "AMBIGUOUS_RESPONSE"],
    ["cStat em namespace falso", F.CSTAT_EM_NAMESPACE_FALSO, "MISSING_CSTAT"],
    ["namespace parecido", F.PAYLOAD_NAMESPACE_PARECIDO, "SERVICE_MISMATCH"],
    ["wrapper de outro serviço", F.WRAPPER_DE_OUTRO_SERVICO, "SERVICE_MISMATCH"],
    ["payload de outro serviço", F.PAYLOAD_DE_OUTRO_SERVICO, "SERVICE_MISMATCH"],
    ["XML truncado", F.XML_TRUNCADO, "MALFORMED_RESPONSE"],
    ["dois Body", F.DOIS_BODIES, "AMBIGUOUS_RESPONSE"],
    ["envelope SOAP 1.1", F.ENVELOPE_SOAP_11, "MALFORMED_RESPONSE"],
    ["DTD/entidade", F.RESPOSTA_COM_DTD, "MALFORMED_RESPONSE"],
    ["BOM inesperado", F.bytesComBom(), "MALFORMED_RESPONSE"],
    ["bytes não UTF-8", F.bytesNaoUtf8(), "MALFORMED_RESPONSE"],
  ]

  it.each(adversariais)("%s ⇒ UNCERTAIN/%s", (_nome, body, reason) => {
    const c = classificar(body)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe(reason)
  })

  it("nenhuma fixture adversarial produz AUTHORIZED ou REJECTED", () => {
    for (const [nome, body] of adversariais) {
      const c = classificar(body)
      expect(["AUTHORIZED", "REJECTED"], `${nome} escapou fechado`).not.toContain(c.outcome)
    }
  })

  it("chamariz FORA do caminho estrutural não altera a classificação", () => {
    // `<observacao><cStat>100</cStat></observacao>` convive com o `cStat` real `656`.
    const c = classificar(F.CHAMARIZ_CSTAT_FORA_DO_CAMINHO)
    expect(c.outcome).toBe("THROTTLED")
    expect(c.cStat).toBe("656")
    expect(c.protocolo).toBeNull()
  })

  it("corpo vazio e string vazia falham fechados", () => {
    expect(classificar(new Uint8Array()).reason).toBe("MALFORMED_RESPONSE")
    expect(classificar("   ").reason).toBe("MALFORMED_RESPONSE")
  })

  it("serviço sem contrato de resposta é recusado antes de qualquer leitura", () => {
    const c = classificar(F.AUTORIZACAO_AUTORIZADA, "NFeStatusServico4")
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("SERVICE_MISMATCH")
    expect(c.cStat).toBeNull()
  })
})

describe("parser SOAP — o XML autorizado precisa ser DO MESMO documento", () => {
  // Achado BLOQUEANTE da revisão independente: a extração do `nfeProc` era uma varredura
  // global e não conferia a quem o XML pertencia. `markAuthorized` persiste esse XML de forma
  // IMUTÁVEL — autorizar a nota A com o documento B é irreversível.
  it("nfeProc de OUTRA chave não autoriza", () => {
    const c = classificar(
      F.CONSULTA_AUTORIZADA_COM_NFEPROC_DE_OUTRO_DOCUMENTO,
      "NFeConsultaProtocolo4",
    )
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("INCOMPLETE_AUTHORIZATION")
    expect(c.xmlAutorizado).toBeNull()
  })

  it("nfeProc com protocolo divergente não autoriza", () => {
    const c = classificar(F.CONSULTA_AUTORIZADA_COM_PROTOCOLO_DIVERGENTE, "NFeConsultaProtocolo4")
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("INCOMPLETE_AUTHORIZATION")
    expect(c.xmlAutorizado).toBeNull()
  })

  it("resposta com duas chaves de acesso é ambígua", () => {
    const c = classificar(F.CONSULTA_COM_DUAS_CHAVES, "NFeConsultaProtocolo4")
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("AMBIGUOUS_RESPONSE")
  })

  it("resposta de OUTRO documento é recusada quando o chamador informa a chave esperada", () => {
    const c = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_AUTORIZADA_100,
      chaveAcessoEsperada: F.OUTRA_CHAVE_SINTETICA,
    })
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("DOCUMENT_MISMATCH")
    expect(c.xmlAutorizado).toBeNull()
  })

  it("a chave esperada correta não atrapalha o caminho feliz", () => {
    const c = parseSefazSoapResponse({
      servico: "NFeConsultaProtocolo4",
      body: F.CONSULTA_AUTORIZADA_100,
      chaveAcessoEsperada: F.CHAVE_SINTETICA,
    })
    expect(c.outcome).toBe("AUTHORIZED")
  })
})

describe("parser SOAP — identificadores fiscais são numéricos", () => {
  // Segundo achado da revisão: `nProt`/`nRec` não passavam por validação. Entidades XML
  // decodificam ANTES do parser vê-los, então `999&lt;x&gt;1` vira `999<x>1` e seria gravado
  // em `NotaFiscal.protocolo` — coluna imutável — e nos logs de auditoria.
  it("nProt com markup decodificado não vira protocolo", () => {
    const c = classificar(F.AUTORIZACAO_PROTOCOLO_NAO_NUMERICO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("INCOMPLETE_AUTHORIZATION")
    expect(c.protocolo).toBeNull()
  })

  it("nRec com markup decodificado não vira recibo", () => {
    const c = classificar(F.AUTORIZACAO_RECIBO_NAO_NUMERICO)
    expect(c.outcome).toBe("UNCERTAIN")
    expect(c.reason).toBe("PROCESSING_SEM_RECIBO")
    expect(c.recibo).toBeNull()
  })

  it("nenhum protocolo ou recibo devolvido carrega markup", () => {
    for (const [body, servico] of [
      [F.AUTORIZACAO_AUTORIZADA, "NFeAutorizacao4"],
      [F.AUTORIZACAO_LOTE_RECEBIDO_103, "NFeAutorizacao4"],
      [F.AUTORIZACAO_PROTOCOLO_NAO_NUMERICO, "NFeAutorizacao4"],
      [F.AUTORIZACAO_RECIBO_NAO_NUMERICO, "NFeAutorizacao4"],
      [F.CONSULTA_AUTORIZADA_100, "NFeConsultaProtocolo4"],
    ] as Array<[string, SefazServico]>) {
      const c = classificar(body, servico)
      expect(c.protocolo ?? "").not.toMatch(/[^0-9]/)
      expect(c.recibo ?? "").not.toMatch(/[^0-9]/)
    }
  })
})

describe("parser SOAP — nada de XML nem segredo na saída", () => {
  it("nenhuma classificação devolve markup em mensagem, xMotivo ou motivo", () => {
    const todas = [
      F.AUTORIZACAO_AUTORIZADA,
      F.AUTORIZACAO_SEM_PROTOCOLO,
      F.AUTORIZACAO_SEM_XML_AUTORIZADO,
      F.AUTORIZACAO_LOTE_SEM_PROTOCOLO,
      F.AUTORIZACAO_LOTE_RECEBIDO_103,
      F.AUTORIZACAO_LOTE_RECEBIDO_SEM_RECIBO,
      F.AUTORIZACAO_DENEGADA_110,
      F.AUTORIZACAO_DUPLICIDADE_204,
      F.AUTORIZACAO_NAO_CONSTA_217,
      F.AUTORIZACAO_SERVICO_PARALISADO_108,
      F.AUTORIZACAO_CONSUMO_INDEVIDO_656,
      F.AUTORIZACAO_CSTAT_DESCONHECIDO,
      F.SOAP_FAULT,
      F.SOAP_FAULT_COM_CHAMARIZ_AUTORIZADO,
      F.RESPOSTA_SEM_CSTAT,
      F.CSTAT_EM_COMENTARIO,
      F.CSTAT_EM_CDATA,
      F.DOIS_CSTAT_CONFLITANTES,
      F.CHAMARIZ_CSTAT_FORA_DO_CAMINHO,
      F.CSTAT_EM_NAMESPACE_FALSO,
      F.PAYLOAD_NAMESPACE_PARECIDO,
      F.WRAPPER_DE_OUTRO_SERVICO,
      F.PAYLOAD_DE_OUTRO_SERVICO,
      F.XML_TRUNCADO,
      F.DOIS_BODIES,
      F.ENVELOPE_SOAP_11,
      F.RESPOSTA_COM_DTD,
    ]
    for (const body of todas) {
      const c = classificar(body)
      expect(c.mensagem).not.toMatch(/[<>]/)
      expect(c.xMotivo ?? "").not.toMatch(/[<>]/)
      // O único campo que pode conter XML é o autorizado, e só quando o desfecho é AUTHORIZED.
      if (c.outcome !== "AUTHORIZED") expect(c.xmlAutorizado).toBeNull()
    }
  })

  it("xMotivo com markup injetado é sanitizado, não propagado", () => {
    const injetado = F.AUTORIZACAO_CSTAT_DESCONHECIDO.replace(
      "Codigo inexistente na matriz",
      "Motivo &lt;script&gt;alert(1)&lt;/script&gt; sintetico",
    )
    const c = classificar(injetado)
    expect(c.xMotivo).not.toMatch(/[<>]/)
    expect(c.xMotivo).toContain("sintetico")
  })

  it("erros nunca carregam o corpo da resposta", () => {
    const c = classificar(F.XML_TRUNCADO)
    expect(c.mensagem).not.toContain("retEnviNFe")
    expect(c.mensagem).not.toContain("soap12")
    expect(c.mensagem).not.toContain(F.CHAVE_SINTETICA)
  })
})

describe("parser SOAP — tradução para os desfechos do coordenador", () => {
  it("PROCESSING vira UNCERTAIN/PROCESSING com recibo e consulta obrigatória", () => {
    const r = toFiscalTransmissionResult(classificar(F.AUTORIZACAO_LOTE_RECEBIDO_103))
    expect(r).toMatchObject({
      outcome: "UNCERTAIN",
      code: "PROCESSING",
      recibo: F.RECIBO_SINTETICO,
      requiresConsultation: true,
    })
  })

  it("THROTTLED vira UNCERTAIN/THROTTLED", () => {
    const r = toFiscalTransmissionResult(classificar(F.AUTORIZACAO_CONSUMO_INDEVIDO_656))
    expect(r).toMatchObject({ outcome: "UNCERTAIN", code: "THROTTLED", cStat: "656" })
  })

  it("REJECTED leva as consequências EXPLÍCITAS da matriz", () => {
    const r = toFiscalTransmissionResult(classificar(F.AUTORIZACAO_DENEGADA_110))
    expect(r).toMatchObject({
      outcome: "REJECTED",
      cStat: "110",
      consequences: { terminal: true, numeroConsumido: true, requiresInutilizacao: false },
    })
  })

  it("NOT_FOUND só existe no desfecho de CONSULTA", () => {
    const consulta = toFiscalConsultationResult(
      classificar(F.CONSULTA_NAO_CONSTA_217, "NFeConsultaProtocolo4"),
    )
    expect(consulta.outcome).toBe("NOT_FOUND")

    // O mesmo `217` chegando por transmissão não pode virar NOT_FOUND (nem via matriz, nem via
    // tradutor): seria autorizar retransmissão sem consulta alguma.
    const transmissao = toFiscalTransmissionResult(classificar(F.AUTORIZACAO_NAO_CONSTA_217))
    expect(transmissao).toMatchObject({ outcome: "UNCERTAIN", code: "UNKNOWN" })
  })

  it("toda classificação incerta chega ao coordenador como UNCERTAIN", () => {
    for (const body of [F.SOAP_FAULT, F.RESPOSTA_SEM_CSTAT, F.XML_TRUNCADO, F.DOIS_BODIES]) {
      expect(toFiscalTransmissionResult(classificar(body)).outcome).toBe("UNCERTAIN")
      expect(toFiscalConsultationResult(classificar(body)).outcome).toBe("UNCERTAIN")
    }
  })
})

describe("fixtures — anonimização", () => {
  it("nenhuma fixture carrega CNPJ, chave, protocolo ou recibo com aparência real", () => {
    const corpus = Object.values(F)
      .filter((valor): valor is string => typeof valor === "string")
      .join("\n")
    // Os únicos identificadores presentes são os sintéticos declarados no módulo.
    const chavesPermitidas = [F.CHAVE_SINTETICA, F.OUTRA_CHAVE_SINTETICA]
    for (const chave of corpus.match(/\d{44}/g) ?? []) {
      expect(chavesPermitidas).toContain(chave)
    }
    for (const chave of chavesPermitidas) expect(chave).toContain(F.CNPJ_SINTETICO)
    expect(F.PROTOCOLO_SINTETICO.startsWith("999")).toBe(true)
    expect(F.RECIBO_SINTETICO.startsWith("999")).toBe(true)
    // Homologação apenas: nenhuma fixture declara ambiente de produção.
    expect(corpus).not.toContain("<tpAmb>1</tpAmb>")
    // Nenhum vestígio de material sensível.
    expect(corpus.toLowerCase()).not.toMatch(/csc|idcsc|-----begin|pfx|senha=/)
  })
})
