/**
 * Contratos da reconciliação fail-closed da NFC-e em contingência (GOAL 020D).
 *
 * Recebe uma observação de consulta JÁ classificada. Não consulta SEFAZ, não
 * transmite, não acorda worker, não altera schema.
 *
 * Doutrina: ADR-0017 · primitivos UNKNOWN/NOT_FOUND do GOAL-012 · matriz 016D-B.
 */
import type { ContingenciaDocumentoEstado } from "../contingencia/types"
import type { SefazFiscalConsequences, SefazResponseReason } from "../provider/sefaz/sefaz-cstat-matrix"
import type { SefazResponseOutcome } from "../provider/sefaz/sefaz-response-parser"

export const CONTINGENCIA_RECONCILIATION_EVIDENCE_KINDS = [
  "AUTHORIZED",
  "NOT_FOUND",
  "REJECTED_FINAL",
  "UNKNOWN",
] as const

export type ContingenciaReconciliationEvidenceKind =
  (typeof CONTINGENCIA_RECONCILIATION_EVIDENCE_KINDS)[number]

/**
 * Precedência explícita. Rank maior vence. Empate entre terminais distintos
 * é conflito (não há “o último write ganha”).
 *
 * AUTHORIZED e REJECTED_FINAL são terminais de mesmo rank: um não apaga o outro.
 * NOT_FOUND não reabre terminal. UNKNOWN não promove nem apaga nada mais forte.
 */
export const CONTINGENCIA_EVIDENCE_PRECEDENCE = {
  UNKNOWN: 10,
  NOT_FOUND: 20,
  REJECTED_FINAL: 30,
  AUTHORIZED: 30,
} as const satisfies Record<ContingenciaReconciliationEvidenceKind, number>

export const RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND =
  "RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND" as const

export type RetransmissionEligibilityKind = typeof RETRANSMISSION_ELIGIBLE_AFTER_NOT_FOUND

export const CONTINGENCIA_CONSULTA_SERVICO = "NFeConsultaProtocolo4" as const

/**
 * Resultado sanitizado de consulta — equivalente ao classificador oficial
 * (`SefazResponseClassification`) sem corpo SOAP. Decisão fiscal NÃO é string livre.
 */
export type ContingenciaConsultaSanitizada = {
  readonly outcome: SefazResponseOutcome
  readonly reason: SefazResponseReason
  readonly servico: typeof CONTINGENCIA_CONSULTA_SERVICO
  readonly cStat: string | null
  readonly xMotivo: string | null
  readonly protocolo: string | null
  readonly xmlAutorizado: string | null
  readonly consequencias: SefazFiscalConsequences
  /**
   * Código incerto do coordenador GOAL-012, quando a observação não veio da
   * matriz (`TIMEOUT` / `CONNECTION_LOST`). Nunca autoriza NOT_FOUND.
   */
  readonly uncertainCode?: "TIMEOUT" | "CONNECTION_LOST" | "UNKNOWN"
}

export type ReconcileNfceContingenciaInput = {
  storeId: string
  chave: string
  notaFiscalId?: string | null
  jobId?: string | null
  evidenceKind: ContingenciaReconciliationEvidenceKind
  observedAt: string
  consulta: ContingenciaConsultaSanitizada
}

export type ContingenciaRetransmissionEligibility = {
  kind: RetransmissionEligibilityKind
  storeId: string
  chave: string
  sha256: string
  grantedAt: string
  consumedAt: null
  singleUse: true
  executeAutomatico: false
  evidenceKind: "NOT_FOUND"
  cStat: string | null
  reason: Extract<SefazResponseReason, "NAO_CONSTA">
}

export type ContingenciaReconciliationOk = {
  ok: true
  kind: "applied" | "idempotent"
  storeId: string
  chave: string
  notaFiscalId: string
  jobId: string
  sha256: string
  evidenceKind: ContingenciaReconciliationEvidenceKind
  estadoAnterior: ContingenciaDocumentoEstado
  estadoFinal: ContingenciaDocumentoEstado
  retryAutomatico: false
  executeAutomatico: false
  eligibilityCreated: boolean
  eligibility: ContingenciaRetransmissionEligibility | null
  jobStatus: string
  proximaTentativaEm: null
  protocoloRegistrado: boolean
  requiresHumanIntervention: boolean
}

export type ContingenciaReconciliationErrorCode =
  | "store_id_obrigatorio"
  | "parametros_invalidos"
  | "evidencia_nao_canonica"
  | "evidencia_inconsistente_com_classificador"
  | "autorizacao_sem_protocolo"
  | "not_found_nao_explicito"
  | "par_inconsistente"
  | "identidade_fiscal_conflito"
  | "chave_bytes_conflito"
  | "documento_ausente"
  | "evidencia_conflitante"
  | "estado_terminal_nao_reabre"
  | "transicao_invalida"

export type ContingenciaReconciliationError = {
  ok: false
  code: ContingenciaReconciliationErrorCode
  mensagem: string
  storeId?: string
  chave?: string
  notaFiscalId?: string | null
  jobId?: string | null
  evidenceKind?: ContingenciaReconciliationEvidenceKind
  estadoAnterior?: ContingenciaDocumentoEstado
  retryAutomatico: false
  executeAutomatico: false
  eligibilityCreated: false
}

export type ReconcileNfceContingenciaResult =
  | ContingenciaReconciliationOk
  | ContingenciaReconciliationError

export type ContingenciaReconciliationTx = {
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    updateMany: (args: unknown) => Promise<{ count: number }>
  }
  fiscalEmissaoJob: {
    findUnique: (args: unknown) => Promise<unknown | null>
    findFirst: (args: unknown) => Promise<unknown | null>
    update: (args: unknown) => Promise<unknown>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
}

export type ContingenciaReconciliationClient = ContingenciaReconciliationTx & {
  $transaction: <T>(fn: (tx: ContingenciaReconciliationTx) => Promise<T>) => Promise<T>
}
