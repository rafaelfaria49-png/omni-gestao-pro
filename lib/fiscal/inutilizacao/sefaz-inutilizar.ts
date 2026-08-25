/**
 * Operação NFeInutilizacao4 no adapter SEFAZ (GOAL 019).
 *
 * Monta o XML oficial, envelopa SOAP 1.2 e entrega ao transporte injetado.
 * Sem inventar cStat. Default de transporte continua recusando rede.
 */

import { AmbienteFiscal, FiscalProviderTipo, StatusNotaFiscal } from "@/generated/prisma"
import { buildSefazSoap12Envelope, extractFiscalBytes } from "../provider/sefaz/sefaz-envelope"
import { selectSefazEndpoint } from "../provider/sefaz/sefaz-endpoint-catalog"
import type { SefazTransport } from "../provider/sefaz/sefaz-transport.types"
import type {
  FiscalProviderError,
  FiscalProviderInutilizacaoParams,
  FiscalProviderResponse,
} from "../provider/types"
import { buildInutilizacaoXml } from "./xml-builder"
import { parseInutilizacaoResponse } from "./response-parser"
import {
  INUTILIZACAO_JUSTIFICATIVA_MAX,
  INUTILIZACAO_JUSTIFICATIVA_MIN,
  TCOD_UF_IBGE,
  TSERIE_PATTERN,
} from "./types"
import { signInutilizacaoXml } from "./sign-boundary"
import type { FiscalCertificateMaterial, SignNfceOptions } from "../signing/signer.types"
import { assertInutilizacaoXmlDsig } from "./xmldsig-structure"

/** Assina o `inutNFe` antes do envelope. Sem isto o adapter recusa o envio. */
export type InutilizacaoSignPort = (xml: string) => string | Promise<string>

export function createInutilizacaoXmlSigner(
  certificado: FiscalCertificateMaterial,
  senha = "",
  options: SignNfceOptions = {},
): InutilizacaoSignPort {
  return (xml) => signInutilizacaoXml(xml, certificado, senha, options).xml
}

function bytesIguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

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
  /** Obrigatório para enviar. Sem XMLDSig o pedido é recusado antes do SOAP. */
  signXml?: InutilizacaoSignPort
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
  if (!Number.isInteger(serie) || !TSERIE_PATTERN.test(String(serie))) {
    erros.push(erro("parametros_invalidos", "Série inválida (TSerie: 0 a 999).", "serie"))
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
  const cUF = texto(params.cUF)
  if (!(TCOD_UF_IBGE as readonly string[]).includes(cUF)) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "rejeitado",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: "cUF ausente ou inválido; envio recusado.",
      pendencias: [],
      erros: [erro("parametros_invalidos", "cUF deve ser código IBGE de UF.", "cUF")],
      eventos: [],
    }
  }
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

  if (!xml) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "rejeitado",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: "CNPJ da loja é obrigatório para montar o pedido de inutilização.",
      pendencias: [],
      erros: [erro("parametros_invalidos", "CNPJ da loja é obrigatório.", "cnpj")],
      eventos: [],
    }
  }
  if (!xml.ok) {
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

  if (!input.signXml) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: "Pedido de inutilização sem XMLDSig; envio recusado.",
      pendencias: [],
      erros: [erro("erro_interno", "Assinatura XMLDSig obrigatória antes de NFeInutilizacao4.")],
      eventos: [],
    }
  }

  let xmlAssinado: string
  try {
    xmlAssinado = await input.signXml(xml.xml)
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Falha ao assinar inutNFe."
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem,
      pendencias: [],
      erros: [erro("erro_interno", mensagem)],
      eventos: [],
    }
  }
  const dsig = assertInutilizacaoXmlDsig(xmlAssinado)
  if (!dsig.ok) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: dsig.mensagem,
      pendencias: [],
      erros: [erro("erro_interno", dsig.mensagem)],
      eventos: [],
    }
  }

  const exactBytes = Uint8Array.from(new TextEncoder().encode(xmlAssinado))
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
  const fiscalNoSoap = extractFiscalBytes(envelope.envelope)
  if (!bytesIguais(fiscalNoSoap, exactBytes)) {
    return {
      ok: false,
      operacao: "inutilizar",
      resultado: "erro",
      simulado: false,
      provider: FiscalProviderTipo.SEFAZ_DIRETO,
      ambiente,
      statusNota: null,
      dados: null,
      mensagem: "Bytes assinados divergem do payload fiscal no envelope SOAP.",
      pendencias: [],
      erros: [erro("erro_interno", "Payload SOAP não é o XML assinado.")],
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
