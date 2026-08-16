/**
 * Contratos da persistência transacional da NFC-e emitida localmente em
 * contingência (GOAL 020C).
 *
 * Sem transmissão, worker, cron, rebuild, numerador ou mudança de schema.
 */
import type { CONTINGENCIA_TP_EMIS } from "../contingencia/types"
import type { TransmissionDeadlinePolicy } from "../contingencia/types"

export const CONTINGENCIA_OUTBOX_DEDUPE_VERSION = 1
export const CONTINGENCIA_OUTBOX_JOB_TIPO = "CONTINGENCIA_TRANSMISSAO" as const
export const CONTINGENCIA_OUTBOX_ESTADO = "PENDENTE_TX" as const

/**
 * Status Prisma do job dormente.
 *
 * `PENDENTE` com `proximaTentativaEm` nulo é elegível pelo worker atual, que
 * então marca `CONTINGENCIA_TRANSMISSAO` como `FALHA` (`tipo_nao_suportado`).
 * `AGUARDANDO_RETRY` + `proximaTentativaEm: null` é o estacionamento canônico
 * já existente (inelegível até 020D iniciar a TX). Não é retry — é outbox
 * dormente. O estado de domínio permanece `PENDENTE_TX`.
 */
export const CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE = "AGUARDANDO_RETRY" as const

export type ContingenciaOutboxAmbiente = "HOMOLOGACAO" | "PRODUCAO"

/**
 * Resultado do 020B (ou equivalente estrutural) a persistir.
 * Bytes e hash entram como recebidos — esta camada não reconstrói XML.
 */
export type ContingenciaOutboxIssue = {
  readonly exactBytes: Uint8Array
  readonly sha256: string
  readonly chave: string
  readonly tpEmis: typeof CONTINGENCIA_TP_EMIS
  readonly dhEmi: string
  readonly dhCont: string
  readonly xJust: string
  readonly nNF: number
  readonly serie: number
}

export type PersistNfceContingenciaOutboxInput = {
  storeId: string
  vendaId: string
  ambiente: ContingenciaOutboxAmbiente
  offline: ContingenciaOutboxIssue
}

export type ContingenciaOutboxExactBytesRef = {
  kind: "NotaFiscal.xmlAssinado"
  notaFiscalId: string
  rebuildForbidden: true
}

export type ContingenciaOutboxDeadlinePersistido = TransmissionDeadlinePolicy & {
  resolvedDeadline: null
}

export type ContingenciaOutboxPersistido = {
  ok: true
  kind: "created" | "idempotent"
  storeId: string
  vendaId: string
  notaFiscalId: string
  jobId: string
  localKey: string
  dedupeKey: string
  chave: string
  sha256: string
  tpEmis: typeof CONTINGENCIA_TP_EMIS
  dhEmi: string
  dhCont: string
  estado: typeof CONTINGENCIA_OUTBOX_ESTADO
  documentoStatus: "CONTINGENCIA"
  tipoEmissao: "CONTINGENCIA_OFFLINE"
  jobTipo: typeof CONTINGENCIA_OUTBOX_JOB_TIPO
  jobStatus: typeof CONTINGENCIA_OUTBOX_JOB_STATUS_DORMENTE
  executeAutomatico: false
  exactBytesRef: ContingenciaOutboxExactBytesRef
  deadline: ContingenciaOutboxDeadlinePersistido
}

export type ContingenciaOutboxPersistErrorCode =
  | "store_id_obrigatorio"
  | "parametros_invalidos"
  | "sha256_divergente"
  | "tp_emis_invalido"
  | "bytes_identidade_divergente"
  | "chave_bytes_conflito"
  | "identidade_fiscal_conflito"
  | "transicao_invalida"
  | "dh_cont_invalido"

export type ContingenciaOutboxPersistError = {
  ok: false
  code: ContingenciaOutboxPersistErrorCode
  mensagem: string
  storeId?: string
  chave?: string
  sha256Informado?: string
  sha256Persistido?: string | null
  notaFiscalId?: string | null
  jobId?: string | null
}

export type PersistNfceContingenciaOutboxResult =
  | ContingenciaOutboxPersistido
  | ContingenciaOutboxPersistError

export type ContingenciaOutboxTx = {
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
    create: (args: unknown) => Promise<unknown>
  }
  fiscalEmissaoJob: {
    findUnique: (args: unknown) => Promise<unknown | null>
    findFirst: (args: unknown) => Promise<unknown | null>
    create: (args: unknown) => Promise<unknown>
  }
  fiscalLog: {
    create: (args: unknown) => Promise<unknown>
  }
}

export type ContingenciaOutboxClient = ContingenciaOutboxTx & {
  $transaction: <T>(fn: (tx: ContingenciaOutboxTx) => Promise<T>) => Promise<T>
}
