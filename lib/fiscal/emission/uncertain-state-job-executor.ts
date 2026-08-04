import { readTransmissionState } from "../queue/queue-policy"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
} from "../queue/queue.types"
import {
  reconcileUncertainDocument,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import type {
  FinalizedDocumentPreparer,
  FiscalExecutionProvenance,
  UncertainStateFiscalProvider,
  UncertainStatePersistence,
} from "./uncertain-state.types"

export type UncertainStateJobExecutorDependencies = {
  persistence: UncertainStatePersistence
  preparer: FinalizedDocumentPreparer
  provider: UncertainStateFiscalProvider
  now?: () => Date
}

/**
 * Flags de auditoria DERIVADAS da proveniência real da execução (GOAL-016D-A · F-2).
 *
 * Antes, os sete retornos deste executor traziam `simulado: true` e
 * `externalTransmissionAttempted: false` como LITERAIS — o que passaria a mentir assim que
 * houvesse transmissão real. Agora:
 *
 *  - `externalTransmissionAttempted` só é `true` se um transporte REALMENTE tentou contato
 *    externo. Bloqueio antes do transporte ⇒ `false`, sempre (nenhum caminho deste slice
 *    produz `true`: o único transporte existente é o offline que recusa).
 *  - `simulado` reflete o provider que de fato executou. Quando o provider sequer é
 *    invocado (bloqueio do coordenador, job inválido, tipo não suportado), nenhuma emissão
 *    — real ou simulada — aconteceu, e a execução é reportada como não-real (`true`).
 */
export function deriveExecutionAuditFlags(input: {
  provider: UncertainStateFiscalProvider
  providerInvoked: boolean
}): Pick<FiscalQueueExecutionResult, "simulado" | "externalTransmissionAttempted"> {
  const provenance: FiscalExecutionProvenance = {
    providerInvoked: input.providerInvoked,
    providerSimulado: input.provider.simulado,
    externalTransmissionAttempted: input.providerInvoked
      ? (input.provider.reportExternalTransmissionAttempted?.() ?? false)
      : false,
  }
  return {
    simulado: provenance.providerInvoked ? provenance.providerSimulado : true,
    externalTransmissionAttempted: provenance.externalTransmissionAttempted,
  }
}

export function createUncertainStateJobExecutor(
  dependencies: UncertainStateJobExecutorDependencies,
): (job: FiscalQueueJob) => Promise<FiscalQueueExecutionResult> {
  return async (job) => {
    /** Proveniência: o provider NÃO foi invocado até que uma chamada real aconteça. */
    const naoInvocado = deriveExecutionAuditFlags({
      provider: dependencies.provider,
      providerInvoked: false,
    })
    if (!job.notaFiscalId) {
      return {
        kind: "terminal",
        code: "nota_fiscal_ausente",
        mensagem: "Job sem notaFiscalId; operação fail-closed.",
        ...naoInvocado,
      }
    }
    const locator = {
      storeId: job.storeId,
      vendaId: job.vendaId,
      notaFiscalId: job.notaFiscalId,
    }
    if (job.tipo === "CONSULTA") {
      const outcome = await reconcileUncertainDocument({
        locator,
        persistence: dependencies.persistence,
        provider: dependencies.provider,
        now: dependencies.now?.(),
      })
      // A consulta só retorna se `provider.consult` foi de fato chamado.
      return {
        kind: "success",
        code: `consulta_${outcome.kind}`,
        mensagem:
          outcome.kind === "not_found"
            ? "Consulta não encontrou a nota; uma retransmissão exata foi autorizada."
            : `Consulta resolveu o documento como ${outcome.kind}.`,
        ...deriveExecutionAuditFlags({ provider: dependencies.provider, providerInvoked: true }),
        detalhe: {
          consultationOutcome:
            outcome.kind === "not_found"
              ? "NOT_FOUND"
              : outcome.kind === "authorized"
                ? "AUTHORIZED"
                : "REJECTED",
        },
      }
    }
    if (job.tipo !== "EMISSAO") {
      return {
        kind: "terminal",
        code: "tipo_nao_suportado_goal012",
        mensagem: `GOAL-012 não executa ${job.tipo}.`,
        ...naoInvocado,
      }
    }

    const transmission = readTransmissionState(job.payload)
    const outcome = await transmitWithUncertainStateSafety({
      locator,
      persistence: dependencies.persistence,
      preparer: dependencies.preparer,
      provider: dependencies.provider,
      now: dependencies.now?.(),
      retryAuthorizedByConsultation:
        transmission.consultationOutcome === "NOT_FOUND" &&
        Boolean(transmission.retryAuthorizedAt) &&
        (
          !transmission.retryAuthorizationConsumedAt ||
          transmission.retryAuthorizationConsumedAt === transmission.lastStartedAt
        ),
    })
    if (outcome.kind === "blocked") {
      // Bloqueio ANTES do transporte: nenhum contato externo — `false` derivado, não literal.
      return {
        kind: "terminal",
        code: outcome.code.toLowerCase(),
        mensagem: outcome.message,
        ...naoInvocado,
      }
    }
    /**
     * Proveniência derivada do DESFECHO, não da posição no fluxo: o coordenador devolve
     * `authorized` com `idempotent: true` num atalho que retorna ANTES de chamar
     * `provider.transmit` (documento já AUTORIZADA). Tratar esse caso como invocado
     * reintroduziria exatamente a mentira de trilha que F-2 existe para eliminar.
     */
    const providerInvoked = !(outcome.kind === "authorized" && outcome.idempotent)
    const invocado = deriveExecutionAuditFlags({
      provider: dependencies.provider,
      providerInvoked,
    })
    const detalhe = {
      document: {
        notaFiscalId: outcome.document.notaFiscalId,
        chaveAcesso: outcome.document.chaveAcesso,
        serie: outcome.document.serie,
        numero: outcome.document.numero,
        modelo: outcome.document.modelo,
        ambiente: outcome.document.ambiente,
        bytesSha256: outcome.bytesSha256,
      },
      ...(outcome.kind === "rejected" ? { requiresInutilizacao: true } : {}),
    }
    if (outcome.kind === "uncertain") {
      return {
        kind: "uncertain",
        code: "resultado_transmissao_incerto",
        mensagem: outcome.message,
        ...invocado,
        detalhe: {
          ...detalhe,
          consultationJobId: outcome.consultationJobId,
        },
      }
    }
    if (outcome.kind === "rejected") {
      return {
        kind: "terminal",
        code: "rejeitada_numero_consumido",
        mensagem: "Rejeição simulada; número permanece consumido e aguarda GOAL-019.",
        ...invocado,
        detalhe,
      }
    }
    return {
      kind: "success",
      code: outcome.idempotent ? "ja_autorizada" : "autorizada",
      mensagem: outcome.idempotent
        ? "Documento já autorizado."
        : "Autorização simulada concluída.",
      ...invocado,
      detalhe,
    }
  }
}
