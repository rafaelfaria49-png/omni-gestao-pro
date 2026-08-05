import { readTransmissionState } from "../queue/queue-policy"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
} from "../queue/queue.types"
import {
  reconcileUncertainDocument,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import {
  PROVIDER_NOT_INVOKED_PROVENANCE,
  type FinalizedDocumentPreparer,
  type FiscalExecutionProvenance,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
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
 * houvesse transmissão real. Agora ambos derivam da proveniência que o coordenador coletou
 * **naquela execução** (correção 002 · bloqueio 3): o executor não pergunta nada ao provider,
 * justamente para não poder ler resíduo de outra execução da mesma instância.
 *
 *  - `externalTransmissionAttempted` só é `true` se um transporte REALMENTE tentou contato
 *    externo NESTA execução. Bloqueio antes do transporte ⇒ `false`.
 *  - `simulado` reflete o provider que de fato executou. Quando o provider sequer é
 *    invocado (gate, job inválido, tipo não suportado), nenhuma emissão — real ou simulada —
 *    aconteceu, e a execução é reportada como não-real (`true`).
 */
export function auditFlagsFromProvenance(
  provenance: FiscalExecutionProvenance,
): Pick<FiscalQueueExecutionResult, "simulado" | "externalTransmissionAttempted"> {
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
    const naoInvocado = auditFlagsFromProvenance(PROVIDER_NOT_INVOKED_PROVENANCE)
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
      // Proveniência coletada pelo coordenador NESTA consulta.
      const auditoria = auditFlagsFromProvenance(outcome.provenance)
      /**
       * `656` em consulta (D12.2): mesmo desfecho dedicado da transmissão. A consulta **não**
       * reagenda a si mesma — insistir é o que agrava o consumo indevido.
       */
      if (outcome.kind === "throttled") {
        return {
          kind: "throttled",
          code: "consulta_consumo_indevido",
          mensagem: outcome.message,
          ...auditoria,
          detalhe: { consultationOutcome: "THROTTLED", cStat: outcome.cStat },
        }
      }
      /** `103/105` em consulta: mesma consulta do mesmo recibo, jamais nova transmissão. */
      if (outcome.kind === "processing") {
        return {
          kind: "uncertain",
          code: "consulta_lote_em_processamento",
          mensagem: outcome.message,
          ...auditoria,
          detalhe: {
            consultationOutcome: "PROCESSING",
            cStat: outcome.cStat,
            recibo: outcome.recibo,
            consultationJobId: outcome.consultationJobId,
          },
        }
      }
      /** Consulta que não resolveu nada: permanece incerta, sem autorizar retransmissão. */
      if (outcome.kind === "uncertain") {
        return {
          kind: "uncertain",
          code: "consulta_nao_conclusiva",
          mensagem: outcome.message,
          ...auditoria,
          detalhe: { consultationOutcome: "UNCERTAIN", uncertainCode: outcome.code },
        }
      }
      return {
        kind: "success",
        code: `consulta_${outcome.kind}`,
        mensagem:
          outcome.kind === "not_found"
            ? "Consulta não encontrou a nota; uma retransmissão exata foi autorizada."
            : `Consulta resolveu o documento como ${outcome.kind}.`,
        ...auditoria,
        detalhe: {
          consultationOutcome:
            outcome.kind === "not_found"
              ? "NOT_FOUND"
              : outcome.kind === "authorized"
                ? "AUTHORIZED"
                : "REJECTED",
          ...(outcome.kind === "rejected"
            ? { requiresInutilizacao: outcome.requiresInutilizacao }
            : {}),
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
        ...auditFlagsFromProvenance(outcome.provenance),
      }
    }
    /**
     * Proveniência REGISTRADA pelo coordenador durante a execução, não inferida aqui. O
     * atalho idempotente (documento já AUTORIZADA) retorna antes de `markProviderInvoked`,
     * de modo que a trilha o descreve como não invocado sem que este executor precise
     * adivinhar a posição no fluxo.
     */
    const invocado = auditFlagsFromProvenance(outcome.provenance)
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
      // Decisão da matriz (016D-B), não mais o literal `true`: `110` é terminal e consome o
      // número, porém NÃO pede inutilização.
      ...(outcome.kind === "rejected"
        ? { requiresInutilizacao: outcome.requiresInutilizacao }
        : {}),
    }
    /**
     * `cStat 656` (D12.2). ⛔ `kind: "throttled"` — não `terminal` (seria reprocessável),
     * não `uncertain` (esperaria uma consulta proibida), não `transient` (faria retry).
     */
    if (outcome.kind === "throttled") {
      return {
        kind: "throttled",
        code: "consumo_indevido_bloqueado",
        mensagem: outcome.message,
        ...invocado,
        detalhe: { ...detalhe, cStat: outcome.cStat },
      }
    }
    /**
     * `cStat 103/105` (D12.1). Estaciona aguardando a consulta do MESMO recibo; a fila trata
     * `uncertain` como "sem retransmissão até consulta", que é precisamente a regra do lote.
     */
    if (outcome.kind === "processing") {
      return {
        kind: "uncertain",
        code: "lote_em_processamento",
        mensagem: outcome.message,
        ...invocado,
        detalhe: {
          ...detalhe,
          cStat: outcome.cStat,
          recibo: outcome.recibo,
          consultationJobId: outcome.consultationJobId,
        },
      }
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
