/**
 * Policy pura da contingência off-line NFC-e 65 / SP (GOAL 020A).
 *
 * Sem I/O, sem XML, sem numerador, sem rede. Toda decisão é tipada e citável.
 */
import {
  CONTINGENCIA_CAPABILITIES_FORA,
  CONTINGENCIA_FONTES_NORMATIVAS,
  CONTINGENCIA_MODALIDADE,
  CONTINGENCIA_MODELO,
  CONTINGENCIA_MODELO_CODIGO,
  CONTINGENCIA_TP_EMIS,
  CONTINGENCIA_TZ,
  CONTINGENCIA_UF_PILOTO,
  NEXT_BUSINESS_DAY,
  REBUILD_AND_RESIGN_REQUIRED,
  SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
  type ContingenciaAmbiente,
  type ContingenciaBusinessDayResolver,
  type ContingenciaDocumentoEstado,
  type ContingenciaRequestInput,
  type ContingenciaRequestValidado,
  type ContingenciaValidationError,
  type ContingenciaValidationResult,
  type ConsumerPresentationDependency,
  type ExactBytesRequirement,
  type NormalToOfflineDecision,
  type NormalToOfflineInput,
  type NumeroInutilizacaoDecision,
  type NumeroReuseDecision,
  type SerieEspecialPolicy,
  type TransmissionDeadlinePolicy,
  type TransmissionDeadlineResult,
  type UnknownEvaluation,
} from "./types"

/**
 * Padrão oficial `TDateTimeUTC` (tiposBasico_v4.00.xsd, PL_010e_v1.02).
 * AAAA-MM-DDThh:mm:ssTZD com TZD = ±hh:00 (minuto de offset sempre 00).
 */
const TDATETIME_UTC_PATTERN =
  /^(((20(([02468][048])|([13579][26]))-02-29))|(20[0-9][0-9])-((((0[1-9])|(1[0-2]))-((0[1-9])|(1\d)|(2[0-8])))|((((0[13578])|(1[02]))-31)|(((0[1,3-9])|(1[0-2]))-(29|30)))))T(20|21|22|23|[0-1]\d):[0-5]\d:[0-5]\d([\-,\+](0[0-9]|10|11):00|([\+](12):00))$/

function norm(value: string | number | null | undefined): string {
  return String(value ?? "").trim().toUpperCase()
}

function error(
  code: ContingenciaValidationError["code"],
  campo: string,
  mensagem: string,
  fonte: ContingenciaValidationError["fonte"],
): ContingenciaValidationError {
  return { code, campo, mensagem, fonte }
}

function detectCapabilityFora(input: ContingenciaRequestInput): ContingenciaValidationError | null {
  const modalidade = norm(input.modalidade)
  const tp = Number(input.tpEmis)
  if (modalidade === "EPEC" || tp === 4) {
    return error(
      "capability_fora_do_escopo",
      tp === 4 ? "tpEmis" : "modalidade",
      "EPEC (tpEmis=4) está fora desta capability.",
      "XSD_PL_010E_TP_EMIS",
    )
  }
  if (modalidade === "SVC" || tp === 6 || tp === 7) {
    return error(
      "capability_fora_do_escopo",
      "tpEmis",
      "SVC-AN/SVC-RS (tpEmis=6/7) não se transportam para NFC-e 65 / SP.",
      "XSD_PL_010E_TP_EMIS",
    )
  }
  if (modalidade === "SAT" || modalidade === "ECF") {
    return error(
      "capability_fora_do_escopo",
      "modalidade",
      `${modalidade} está fora desta capability.`,
      CONTINGENCIA_FONTES_NORMATIVAS.modalidadeOffline,
    )
  }
  if (tp === 2 || tp === 5) {
    return error(
      "capability_fora_do_escopo",
      "tpEmis",
      "FS/FS-DA (tpEmis=2/5) não são modalidade válida deste piloto (CAT 12/2015 revogada).",
      "XSD_PL_010E_TP_EMIS",
    )
  }
  return null
}

function resolveModelo(
  input: ContingenciaRequestInput,
): { ok: true; modelo: typeof CONTINGENCIA_MODELO; modeloCodigo: typeof CONTINGENCIA_MODELO_CODIGO } | { ok: false } {
  const modelo = norm(input.modelo)
  const codigo = String(input.modeloCodigo ?? "").trim()
  const aceitaModelo = modelo === CONTINGENCIA_MODELO || modelo === CONTINGENCIA_MODELO_CODIGO
  const aceitaCodigo =
    codigo === "" || codigo === CONTINGENCIA_MODELO_CODIGO || norm(input.modeloCodigo) === CONTINGENCIA_MODELO
  if (!aceitaModelo && codigo !== CONTINGENCIA_MODELO_CODIGO) return { ok: false }
  if (modelo === "55" || modelo === "NFE" || codigo === "55") return { ok: false }
  if (!aceitaCodigo) return { ok: false }
  return { ok: true, modelo: CONTINGENCIA_MODELO, modeloCodigo: CONTINGENCIA_MODELO_CODIGO }
}

function resolveAmbiente(raw: string | null | undefined): ContingenciaAmbiente | null {
  const v = norm(raw)
  if (v === "HOMOLOGACAO" || v === "PRODUCAO") return v
  return null
}

/**
 * Valida o pedido de entrada em contingência off-line.
 *
 * xJust: presença obrigatória pela aplicação (Ajuste cl. 11 § 1º I). O XSD limita
 * 15–256 quando o grupo existe; essa faixa NÃO é reaplicada aqui (leiaute = 020B).
 * dhCont: presença pela aplicação + formato TDateTimeUTC do XSD oficial.
 */
export function validateContingenciaRequest(input: ContingenciaRequestInput): ContingenciaValidationResult {
  const errors: ContingenciaValidationError[] = []

  const fora = detectCapabilityFora(input)
  if (fora) errors.push(fora)

  const modelo = resolveModelo(input)
  if (!modelo.ok) {
    errors.push(
      error(
        "modelo_nao_suportado",
        "modelo",
        "Somente NFC-e modelo 65 é suportado nesta capability.",
        CONTINGENCIA_FONTES_NORMATIVAS.modalidadeOffline,
      ),
    )
  }

  if (norm(input.uf) !== CONTINGENCIA_UF_PILOTO) {
    errors.push(
      error(
        "uf_nao_suportada",
        "uf",
        "Somente UF piloto SP é suportada nesta capability.",
        CONTINGENCIA_FONTES_NORMATIVAS.spAutorizaOffline,
      ),
    )
  }

  if (norm(input.modalidade) !== CONTINGENCIA_MODALIDADE) {
    const jaFora = errors.some((e) => e.code === "capability_fora_do_escopo" && e.campo === "modalidade")
    if (!jaFora) {
      errors.push(
        error(
          "modalidade_nao_suportada",
          "modalidade",
          "Somente modalidade OFFLINE (tpEmis=9) é suportada nesta capability.",
          CONTINGENCIA_FONTES_NORMATIVAS.modalidadeOffline,
        ),
      )
    }
  }

  const tp = Number(input.tpEmis)
  if (tp !== CONTINGENCIA_TP_EMIS) {
    const jaFora = errors.some((e) => e.code === "capability_fora_do_escopo" && e.campo === "tpEmis")
    if (!jaFora) {
      errors.push(
        error(
          "tp_emis_nao_suportado",
          "tpEmis",
          "Somente tpEmis=9 (contingência off-line da NFC-e) é aceito.",
          "XSD_PL_010E_TP_EMIS",
        ),
      )
    }
  }

  const dhCont = typeof input.dhCont === "string" ? input.dhCont.trim() : ""
  if (!dhCont) {
    errors.push(
      error(
        "dh_cont_ausente",
        "dhCont",
        "dhCont é obrigatório pela aplicação quando tpEmis ≠ 1 (XSD minOccurs=0 não dispensa).",
        CONTINGENCIA_FONTES_NORMATIVAS.dhContXJustAplicacao,
      ),
    )
  } else if (!TDATETIME_UTC_PATTERN.test(dhCont)) {
    errors.push(
      error(
        "dh_cont_invalido",
        "dhCont",
        "dhCont deve seguir TDateTimeUTC (AAAA-MM-DDThh:mm:ssTZD).",
        CONTINGENCIA_FONTES_NORMATIVAS.dhContFormato,
      ),
    )
  }

  const xJust = typeof input.xJust === "string" ? input.xJust.trim() : ""
  if (!xJust) {
    errors.push(
      error(
        "x_just_ausente",
        "xJust",
        "xJust é obrigatório pela aplicação quando tpEmis ≠ 1 (XSD minOccurs=0 não dispensa).",
        CONTINGENCIA_FONTES_NORMATIVAS.dhContXJustAplicacao,
      ),
    )
  }

  if (errors.length > 0) return { ok: false, errors }

  const value: ContingenciaRequestValidado = {
    modelo: CONTINGENCIA_MODELO,
    modeloCodigo: CONTINGENCIA_MODELO_CODIGO,
    uf: CONTINGENCIA_UF_PILOTO,
    modalidade: CONTINGENCIA_MODALIDADE,
    tpEmis: CONTINGENCIA_TP_EMIS,
    ambiente: resolveAmbiente(input.ambiente),
    dhCont,
    xJust,
    fonte: CONTINGENCIA_FONTES_NORMATIVAS.modalidadeOffline,
  }
  return { ok: true, value }
}

const CONSEQUENCIA_REBUILD = {
  ok: true as const,
  xmlMutation: REBUILD_AND_RESIGN_REQUIRED,
  signedXmlInPlacePatch: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
  alteraChaveAcesso: true as const,
  alteraCDV: true as const,
  alteraInfNFeId: true as const,
  exigeReconstrucaoXml: true as const,
  exigeNovaAssinatura: true as const,
  executaRebuildNesteGoal: false as const,
  acopladoAoBuilderXml: false as const,
}

/**
 * Decisão explícita Normal (tpEmis=1) → off-line (tpEmis=9).
 * Mudar tpEmis altera chave, cDV e infNFe/@Id — patch in-place de XML assinado é proibido.
 */
export function decideNormalToOffline(input: NormalToOfflineInput): NormalToOfflineDecision {
  if (input.estadoIncerto) {
    return {
      ok: false,
      code: "conversao_proibida_estado_incerto",
      signedXmlInPlacePatch: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.unknownFailClosed,
    }
  }
  if (input.transmissaoIniciada) {
    return {
      ok: false,
      code: "conversao_proibida_transmissao_iniciada",
      signedXmlInPlacePatch: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.unknownFailClosed,
    }
  }
  if (input.tpEmisAtual !== 1) {
    return {
      ok: false,
      code: "origem_nao_e_emissao_normal",
      signedXmlInPlacePatch: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.identidadeIncluiTpEmis,
    }
  }
  if (input.numeroJaTransmitidoComoNormal) {
    return {
      ok: false,
      code: "numero_normal_transmitido_nao_reutilizavel",
      signedXmlInPlacePatch: SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.naoReusarNumeroNormalTransmitido,
    }
  }
  return CONSEQUENCIA_REBUILD
}

/** Nenhuma policy desta camada autoriza patch in-place de XML já assinado. */
export function signedXmlInPlacePatchPolicy(): typeof SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN {
  return SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN
}

export function canReuseNumeroForContingencia(input: {
  numeroJaTransmitidoComoNormal: boolean
}): NumeroReuseDecision {
  if (input.numeroJaTransmitidoComoNormal) {
    return {
      allowed: false,
      code: "numero_normal_transmitido_nao_reutilizavel",
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.naoReusarNumeroNormalTransmitido,
    }
  }
  return { allowed: true }
}

export function canInutilizarNumeroContingencia(input: {
  emitidoEmContingencia: boolean
}): NumeroInutilizacaoDecision {
  if (input.emitidoEmContingencia) {
    return {
      allowed: false,
      code: "numero_contingencia_nao_inutilizavel",
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.naoInutilizarNumeroContingencia,
    }
  }
  return { governedByThisPolicy: false }
}

export function serieEspecialPolicy(): SerieEspecialPolicy {
  return {
    exigida: false,
    faixasRevogadas: ["890-989", "501-999"],
    reusaSerieNormal: true,
    fonte: CONTINGENCIA_FONTES_NORMATIVAS.seriesEspeciaisRevogadas,
  }
}

export function transmissionDeadlinePolicy(): TransmissionDeadlinePolicy {
  return {
    kind: NEXT_BUSINESS_DAY,
    countedFrom: "dhEmi",
    timeZone: CONTINGENCIA_TZ,
    calendarEmbedded: false,
    simplifiedPlusOneDay: false,
    fonte: CONTINGENCIA_FONTES_NORMATIVAS.prazoTxPrimeiroDiaUtil,
  }
}

/**
 * Prazo de transmissão posterior. Sem calendário embutido.
 * Se `resolver` não for injetado, devolve só o contrato NEXT_BUSINESS_DAY.
 */
export function resolveContingenciaTransmissionDeadline(input: {
  dhEmi: string
  resolver?: ContingenciaBusinessDayResolver
}): TransmissionDeadlineResult {
  const policy = transmissionDeadlinePolicy()
  const resolvedDeadline =
    input.resolver && input.resolver.calendarEmbedded === false
      ? input.resolver.nextBusinessDayAfter({ dhEmi: input.dhEmi, timeZone: CONTINGENCIA_TZ })
      : null
  return {
    policy,
    documentoPendenteDeTransmissao: true,
    transmissionUsesExactBytes: true,
    resolvedDeadline,
  }
}

export function exactBytesRequirement(
  estado: ContingenciaDocumentoEstado,
  origem?: ContingenciaDocumentoEstado,
): ExactBytesRequirement {
  const jaEmitidoLocal = new Set<ContingenciaDocumentoEstado>([
    "EMITIDO_LOCAL",
    "PENDENTE_TX",
    "TX_ANDAMENTO",
    "AUTORIZADO_POST",
    "REJEITADO_DEF",
    "UNKNOWN",
  ])
  if (jaEmitidoLocal.has(estado) || (origem != null && jaEmitidoLocal.has(origem))) {
    return {
      kind: "EXACT_BYTES",
      identity: "xmlAssinado",
      required: true,
      frozen: true,
      rebuildForbidden: true,
      transmissionUsesIssuedBytes: true,
      fonte: CONTINGENCIA_FONTES_NORMATIVAS.payloadBytesGerados,
    }
  }
  return { required: false, frozen: false, rebuildForbidden: false }
}

export function evaluateUnknown(): UnknownEvaluation {
  return {
    estado: "UNKNOWN",
    retryAutomatico: false,
    autorizaNovaEmissaoAutomatica: false,
    podeConsultar: true,
    podeRetomarTxDireto: false,
    reconcilicao: {
      kind: "RECONCILIATION_REQUIRED",
      retryAutomatico: false,
      autorizaNovaEmissaoAutomatica: false,
      retornoDiretoTxAndamento: false,
      implementacao: "020D",
    },
    fonte: CONTINGENCIA_FONTES_NORMATIVAS.unknownFailClosed,
  }
}

export function consumerPresentationDependency(): ConsumerPresentationDependency {
  return {
    goal: "021",
    requiredForConsumerPresentation: true,
    blocksOfflinePolicy: false,
  }
}

export { CONTINGENCIA_CAPABILITIES_FORA }
