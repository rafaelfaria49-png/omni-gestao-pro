/**
 * Operação NFeInutilizacao4 no adapter SEFAZ (GOAL 019).
 *
 * Monta o XML oficial, envelopa SOAP 1.2 e entrega ao transporte injetado.
 * Sem inventar cStat. Default de transporte continua recusando rede.
 */

import { AmbienteFiscal, FiscalProviderTipo, StatusNotaFiscal } from "@/generated/prisma"
import { buildSefazSoap12Envelope } from "../provider/sefaz/sefaz-envelope"
import { selectSefazEndpoint } from "../provider/sefaz/sefaz-endpoint-catalog"
import type { SefazTransport } from "../provider/sefaz/sefaz-transport.types"
import type {
  FiscalProviderError,
  FiscalProviderInutilizacaoParams,
  FiscalProviderResponse,
} from "../provider/types"
import { buildInutilizacaoXml } from "./xml-builder"
import { parseInutilizacaoResponse } from "./response-parser"
import { INUTILIZACAO_JUSTIFICATIVA_MAX, INUTILIZACAO_JUSTIFICATIVA_MIN } from "./types"

function erro(code: FiscalProviderError["code"], mensagem: string, campo?: string): FiscalProviderError {
  return { code, mensagem, campo: campo ?? null, origem: null }
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
}

function digits(v: string): string {
  return v.replace(/[^0-9A-Z]/gi, "").toUpperCase()
}

export async function executarInutilizacaoSefaz(input: {
  params: FiscalProviderInutilizacaoParams
  transport: SefazTransport
  connectionTimeoutMs: number
  totalDeadlineMs: number
}): Promise<FiscalProviderResponse> {
  const params = input.params
  const ambiente = texto(params.contexto?.ambiente) || AmbienteFiscal.HOMOLOGACAO
  const just = texto(params.justificativa)
  const ini = Number(params.numeroInicial)
  const fim = Number(params.numeroFinal)
  const serie = Number(params.serie)
  const erros: FiscalProviderError[] = []

  if (ambiente !== AmbienteFiscal.HOMOLOGACAO) {
    erros.push(erro("parametros_invalidos", "Inutilização SEFAZ neste GOAL só opera em HOMOLOGACAO.", "ambiente"))
  }
  if (just.length < INUTILIZACAO_JUSTIFICATIVA_MIN || just.length > INUTILIZACAO_JUSTIFICATIVA_MAX) {
    erros.push(
      erro(
        "justificativa_invalida",
        `Justificativa deve ter entre ${INUTILIZACAO_JUSTIFICATIVA_MIN} e ${INUTILIZACAO_JUSTIFICATIVA_MAX} caracteres.`,
        "justificativa",
      ),
    )
  }
  if (!Number.isInteger(serie) || serie < 0) {
    erros.push(erro("parametros_invalidos", "Série inválida.", "serie"))
  }
  if (!Number.isInteger(ini) || !Number.isInteger(fim) || ini <= 0 || fim < ini) {
    erros.push(erro("parametros_invalidos", "Faixa de numeração inválida.", "numeroInicial"))
  }
  if (erros.length > 0) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "rejeitado",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: "Parâmetros de inutilização inválidos.",
      pendencias: [],
      erros,
      eventos: [],
    }
  }

  const endpoint = selectSefazEndpoint({
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeInutilizacao4",
  })
  if (!endpoint.ok) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: endpoint.mensagem,
      pendencias: [],
      erros: [erro("operacao_nao_suportada", endpoint.mensagem)],
      eventos: [],
    }
  }

  const cnpj = digits(texto(params.cnpj))
  const cUF = texto(params.cUF) || "35"
  const ano = texto(params.ano) || String(new Date().getFullYear()).slice(-2)
  const xml = cnpj
    ? buildInutilizacaoXml({
        tpAmb: "2",
        cUF,
        ano,
        cnpj,
        modelo: "65",
        serie: String(serie),
        nNFIni: String(ini),
        nNFFin: String(fim),
        xJust: just,
        anoCalendario: 2000 + Number(ano),
      })
    : null

  let exactBytes = new Uint8Array()
  if (xml?.ok) {
    exactBytes = Uint8Array.from(new TextEncoder().encode(xml.xml))
  } else if (xml && !xml.ok) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "rejeitado",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: xml.issues[0]?.mensagem ?? "Pedido de inutilização inválido.",
      pendencias: [],
      erros: xml.issues.map((issue) =>
        erro(
          issue.code === "justificativa_invalida" ? "justificativa_invalida" : "parametros_invalidos",
          issue.mensagem,
          issue.campo,
        ),
      ),
      eventos: [],
    }
  }

  const envelope = buildSefazSoap12Envelope({
    servico: "NFeInutilizacao4",
    exactBytes,
  })
  if (!envelope.ok) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: envelope.mensagem,
      pendencias: [],
      erros: [erro("erro_interno", envelope.mensagem)],
      eventos: [],
    }
  }

  const outcome = await input.transport.send({
    endpoint: endpoint.endpoint,
    contentType: envelope.envelope.contentType,
    bodyBytes: envelope.envelope.bytes,
    correlationId: `inut:${params.contexto.storeId}:${serie}:${ini}:${fim}`,
    certificate: {
      storeId: params.contexto.storeId,
      blobRef: "inutilizacao",
      senhaRef: "inutilizacao",
    },
    connectionTimeoutMs: input.connectionTimeoutMs,
    totalDeadlineMs: input.totalDeadlineMs,
  })

  if (!outcome.ok) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: outcome.mensagem,
      pendencias: [],
      erros: [erro("erro_interno", outcome.mensagem)],
      eventos: [],
    }
  }

  const xmlRetorno = new TextDecoder("utf-8", { fatal: false }).decode(outcome.bodyBytes)
  const classified = parseInutilizacaoResponse(xmlRetorno)
  const homologada = classified.outcome === "SUCCESS" && classified.protocolo != null
  return {
    ok: homologada,
    operacao: "inutilizar",
    resultado: homologada ? "ok" : classified.outcome === "REJECTED" ? "rejeitado" : "erro",
    simulado: false,
    provider: FiscalProviderTipo.SEFAZ_DIRETO,
    ambiente,
    statusNota: homologada ? StatusNotaFiscal.INUTILIZADA : null,
    dados: {
      placeholder: false,
      protocolo: classified.protocolo,
      cStat: classified.cStat,
      xMotivo: classified.xMotivo,
      serie,
      numeroInicial: ini,
      numeroFinal: fim,
    },
    mensagem: classified.rotulo,
    pendencias: [],
    erros: homologada
      ? []
      : [erro(classified.outcome === "REJECTED" ? "parametros_invalidos" : "erro_interno", classified.rotulo)],
    eventos: [],
  }
}
