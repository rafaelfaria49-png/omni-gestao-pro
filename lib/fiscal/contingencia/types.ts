/**
 * Contratos puros da contingência off-line NFC-e modelo 65 · piloto SP (GOAL 020A).
 *
 * Camada de POLICY apenas. Não gera XML, não assina, não transmite, não persiste,
 * não aloca nNF, não consulta SEFAZ. EPEC, SVC, SAT e ECF ficam fora desta capability.
 *
 * Fontes: Ajuste SINIEF 19/16 cl. 11 · SRE 40/2024 · RC 31961/2025 · XSD PL_010e_v1.02 ·
 * ADR-0017 · plano `FISCAL_020_CONTINGENCIA_NFCE_AUDIT_PLAN_042` (head 4296c225).
 */

// ── Identidade estrutural do piloto ───────────────────────────────────────────

/** Modelo fiscal suportado por esta capability. */
export const CONTINGENCIA_MODELO = "NFCE" as const
/** Código de modelo (NFC-e). */
export const CONTINGENCIA_MODELO_CODIGO = "65" as const
/** UF piloto. */
export const CONTINGENCIA_UF_PILOTO = "SP" as const
/** Única modalidade desta capability. */
export const CONTINGENCIA_MODALIDADE = "OFFLINE" as const
/** tpEmis canônico da contingência off-line da NFC-e (XSD PL_010e). */
export const CONTINGENCIA_TP_EMIS = 9 as const
/** Fuso apontado pelo plano 020 para prazos — calendário de feriados NÃO está aqui (P-DU). */
export const CONTINGENCIA_TZ = "America/Sao_Paulo" as const

export type ContingenciaModelo = typeof CONTINGENCIA_MODELO
export type ContingenciaModeloCodigo = typeof CONTINGENCIA_MODELO_CODIGO
export type ContingenciaUfPiloto = typeof CONTINGENCIA_UF_PILOTO
export type ContingenciaModalidade = typeof CONTINGENCIA_MODALIDADE
export type ContingenciaTpEmis = typeof CONTINGENCIA_TP_EMIS

/**
 * Ambiente fiscal. Independente da policy estrutural: aceitar/recusar off-line
 * não depende de HOMOLOGACAO vs PRODUCAO.
 */
export type ContingenciaAmbiente = "HOMOLOGACAO" | "PRODUCAO"

export const CONTINGENCIA_CAPABILITIES_FORA = ["EPEC", "SVC", "SAT", "ECF"] as const
export type ContingenciaCapabilityFora = (typeof CONTINGENCIA_CAPABILITIES_FORA)[number]

export const CONTINGENCIA_FONTES_NORMATIVAS = {
  modalidadeOffline: "AJUSTE_SINIEF_19_16_CL_11_I",
  spAutorizaOffline: "SRE_40_2024_ART_6",
  spDesde2024_07_10: "RC_31961_2025_ITEM_6",
  dhContXJustAplicacao: "AJUSTE_SINIEF_19_16_CL_11_PAR1_I",
  dhContFormato: "XSD_PL_010E_TDateTimeUTC",
  naoReusarNumeroNormalTransmitido: "AJUSTE_SINIEF_19_16_CL_11_PAR2_I",
  naoInutilizarNumeroContingencia: "AJUSTE_SINIEF_19_16_CL_11_PAR2_II",
  seriesEspeciaisRevogadas: "SINIEF_26_19",
  prazoTxPrimeiroDiaUtil: "AJUSTE_SINIEF_19_16_CL_11_PAR1_II",
  payloadBytesGerados: "AJUSTE_SINIEF_19_16_CL_11_PAR1_II",
  unknownFailClosed: "ADR_0017",
  identidadeIncluiTpEmis: "AJUSTE_SINIEF_19_16_CL_5_PAR3_II",
} as const

export type ContingenciaFonteNormativa =
  (typeof CONTINGENCIA_FONTES_NORMATIVAS)[keyof typeof CONTINGENCIA_FONTES_NORMATIVAS]

// ── Pedido de contingência ────────────────────────────────────────────────────

export type ContingenciaRequestInput = {
  modelo?: string | number | null
  modeloCodigo?: string | number | null
  uf?: string | null
  modalidade?: string | null
  tpEmis?: string | number | null
  /**
   * Não participa da decisão estrutural. Pode estar ausente.
   */
  ambiente?: string | null
  dhCont?: string | null
  xJust?: string | null
}

export type ContingenciaRequestValidado = {
  modelo: ContingenciaModelo
  modeloCodigo: ContingenciaModeloCodigo
  uf: ContingenciaUfPiloto
  modalidade: ContingenciaModalidade
  tpEmis: ContingenciaTpEmis
  /** Eco do input; a policy estrutural não o interpreta. */
  ambiente: ContingenciaAmbiente | null
  dhCont: string
  xJust: string
  fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.modalidadeOffline
}

export type ContingenciaValidationCode =
  | "modelo_nao_suportado"
  | "uf_nao_suportada"
  | "modalidade_nao_suportada"
  | "tp_emis_nao_suportado"
  | "dh_cont_ausente"
  | "dh_cont_invalido"
  | "x_just_ausente"
  | "capability_fora_do_escopo"

export type ContingenciaValidationError = {
  code: ContingenciaValidationCode
  campo: string
  mensagem: string
  fonte: ContingenciaFonteNormativa | "XSD_PL_010E_TP_EMIS"
}

export type ContingenciaValidationResult =
  | { ok: true; value: ContingenciaRequestValidado }
  | { ok: false; errors: ContingenciaValidationError[] }

// ── Normal → off-line ─────────────────────────────────────────────────────────

/** Única consequência permitida ao mudar tpEmis para 9. Rebuild NÃO é executado aqui. */
export const REBUILD_AND_RESIGN_REQUIRED = "REBUILD_AND_RESIGN_REQUIRED" as const
export type XmlMutationConsequence = typeof REBUILD_AND_RESIGN_REQUIRED

export const SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN = "SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN" as const
export type SignedXmlPatchPolicy = typeof SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN

export type NormalToOfflineInput = {
  /** tpEmis atual do documento Normal (tipicamente 1). */
  tpEmisAtual: number
  xmlAssinado: boolean
  transmissaoIniciada: boolean
  numeroJaTransmitidoComoNormal: boolean
  /** Documento em estado incerto (ADR-0017). */
  estadoIncerto?: boolean
}

export type NormalToOfflineDecision =
  | {
      ok: true
      xmlMutation: XmlMutationConsequence
      signedXmlInPlacePatch: SignedXmlPatchPolicy
      alteraChaveAcesso: true
      alteraCDV: true
      alteraInfNFeId: true
      exigeReconstrucaoXml: true
      exigeNovaAssinatura: true
      executaRebuildNesteGoal: false
      acopladoAoBuilderXml: false
    }
  | {
      ok: false
      code:
        | "numero_normal_transmitido_nao_reutilizavel"
        | "conversao_proibida_transmissao_iniciada"
        | "conversao_proibida_estado_incerto"
        | "origem_nao_e_emissao_normal"
      signedXmlInPlacePatch: SignedXmlPatchPolicy
      fonte: ContingenciaFonteNormativa
    }

// ── Numeração (guards puros — numerador intocado) ─────────────────────────────

export type NumeroReuseDecision =
  | { allowed: true }
  | {
      allowed: false
      code: "numero_normal_transmitido_nao_reutilizavel"
      fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.naoReusarNumeroNormalTransmitido
    }

export type NumeroInutilizacaoDecision =
  | {
      allowed: false
      code: "numero_contingencia_nao_inutilizavel"
      fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.naoInutilizarNumeroContingencia
    }
  | { governedByThisPolicy: false }

export type SerieEspecialPolicy = {
  exigida: false
  faixasRevogadas: readonly ["890-989", "501-999"]
  reusaSerieNormal: true
  fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.seriesEspeciaisRevogadas
}

// ── Prazo de transmissão posterior (P-DU pendente) ────────────────────────────

export const NEXT_BUSINESS_DAY = "NEXT_BUSINESS_DAY" as const
export type TransmissionDeadlineKind = typeof NEXT_BUSINESS_DAY

/**
 * Contrato do prazo legal. Não calcula data.
 * P-DU: calendário de dias úteis NÃO implementado neste GOAL.
 */
export type TransmissionDeadlinePolicy = {
  kind: TransmissionDeadlineKind
  countedFrom: "dhEmi"
  timeZone: typeof CONTINGENCIA_TZ
  calendarEmbedded: false
  /** Proibido usar “+1 dia” como substituto. */
  simplifiedPlusOneDay: false
  fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.prazoTxPrimeiroDiaUtil
}

/**
 * Porta injetável de dia útil. Sem calendário embutido nesta camada.
 * Quem injeta (GOAL 020C+) é dono do calendário; 020A só chama se receber a porta.
 */
export type ContingenciaBusinessDayResolver = {
  readonly calendarEmbedded: false
  nextBusinessDayAfter(input: {
    dhEmi: string
    timeZone: typeof CONTINGENCIA_TZ
  }): string
}

export type TransmissionDeadlineResult = {
  policy: TransmissionDeadlinePolicy
  documentoPendenteDeTransmissao: true
  transmissionUsesExactBytes: true
  /** Presente SOMENTE se um resolver foi injetado. Nunca derivado por +1 dia. */
  resolvedDeadline: string | null
}

export type ExactBytesContract = {
  kind: "EXACT_BYTES"
  /** Identidade conceitual — nenhum blob é gerado ou armazenado neste GOAL. */
  identity: "xmlAssinado"
  required: true
  frozen: true
  rebuildForbidden: true
  transmissionUsesIssuedBytes: true
  fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.payloadBytesGerados
}

export type ExactBytesRequirement =
  | { required: false; frozen: false; rebuildForbidden: false }
  | ExactBytesContract

// ── Apresentação ao consumidor (GOAL 021 — não bloqueia a policy) ─────────────

export type ConsumerPresentationDependency = {
  goal: "021"
  requiredForConsumerPresentation: true
  blocksOfflinePolicy: false
}

// ── Máquina de estados ────────────────────────────────────────────────────────

export const CONTINGENCIA_ESTADOS = [
  "PREPARADO",
  "EMITIDO_LOCAL",
  "PENDENTE_TX",
  "TX_ANDAMENTO",
  "AUTORIZADO_POST",
  "REJEITADO_DEF",
  "UNKNOWN",
  "INTERVENCAO_MANUAL",
] as const

export type ContingenciaDocumentoEstado = (typeof CONTINGENCIA_ESTADOS)[number]

export const CONTINGENCIA_EVENTOS = [
  "EMITIR_LOCAL",
  "ENFILEIRAR_TX",
  "INICIAR_TX",
  "AUTORIZAR",
  "REJEITAR",
  "PERDER_RESPOSTA",
  "CONSULTAR",
  "DECIDIR_RECONCILIACAO",
  "INTERVIR",
] as const

export type ContingenciaEvento = (typeof CONTINGENCIA_EVENTOS)[number]

export type ContingenciaTransitionOk = {
  ok: true
  from: ContingenciaDocumentoEstado
  event: ContingenciaEvento
  to: ContingenciaDocumentoEstado
  retryAutomatico: false
  exactBytes: ExactBytesRequirement
  reconcilicao?: never
}

export type ReconciliacaoNecessaria = {
  kind: "RECONCILIATION_REQUIRED"
  retryAutomatico: false
  autorizaNovaEmissaoAutomatica: false
  retornoDiretoTxAndamento: false
  implementacao: "020D"
}

export type ContingenciaTransitionError = {
  ok: false
  code:
    | "transicao_invalida"
    | "unknown_nao_retorna_tx_andamento"
    | "unknown_nao_autoriza_emissao"
    | "unknown_requer_reconciliacao"
  from: ContingenciaDocumentoEstado
  event: ContingenciaEvento
  retryAutomatico: false
  autorizaNovaEmissaoAutomatica: false
  reconcilicao?: ReconciliacaoNecessaria
}

export type ContingenciaTransitionResult = ContingenciaTransitionOk | ContingenciaTransitionError

export type UnknownEvaluation = {
  estado: "UNKNOWN"
  retryAutomatico: false
  autorizaNovaEmissaoAutomatica: false
  podeConsultar: true
  podeRetomarTxDireto: false
  reconcilicao: ReconciliacaoNecessaria
  fonte: typeof CONTINGENCIA_FONTES_NORMATIVAS.unknownFailClosed
}
