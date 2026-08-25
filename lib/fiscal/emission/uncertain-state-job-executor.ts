import { readTransmissionState, sanitizeFiscalQueueError } from "../queue/queue-policy"
import type {
  FiscalQueueExecutionResult,
  FiscalQueueJob,
} from "../queue/queue.types"
import {
  fiscalConsultationEnsuredOf,
  fiscalExecutionProvenanceOf,
  reconcileUncertainDocument,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import {
  PROVIDER_NOT_INVOKED_PROVENANCE,
  type FinalizedDocumentPreparer,
  type FiscalExecutionProvenance,
  type FiscalExternalExecutionCapability,
  type UncertainStateFiscalProvider,
  type UncertainStatePersistence,
} from "./uncertain-state.types"

export type UncertainStateJobExecutorDependencies = {
  persistence: UncertainStatePersistence
  preparer: FinalizedDocumentPreparer
  provider: UncertainStateFiscalProvider
  now?: () => Date
  /**
   * Capability de execução de provider EXTERNO. Aditiva.
   * Ausência ⇒ o coordenador aplica `EXTERNAL_EXECUTION_DENIED`.
   * Produção do piloto dormente nunca injeta `allow=true`.
   * Nenhum env, banco ou provider pode concedê-la.
   */
  capability?: FiscalExternalExecutionCapability
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
): Pick<
  FiscalQueueExecutionResult,
  "simulado" | "externalTransmissionAttempted" | "providerInvoked"
> {
  return {
    simulado: provenance.providerInvoked ? provenance.providerSimulado : true,
    externalTransmissionAttempted: provenance.externalTransmissionAttempted,
    /**
     * Propagado ao contrato da fila para que o worker possa distinguir uma repetição SEGURA
     * (consulta que já falou com o provider) de uma execução que nem chegou lá — sem precisar
     * inspecionar `detalhe`, que é um saco de chaves não tipado.
     */
    providerInvoked: provenance.providerInvoked,
  }
}

/**
 * Redação extra para mensagens de ERRO (bloqueio 2 da revisão cruzada do PR #44).
 *
 * `sanitizeFiscalQueueError` já remove markup e segredos nomeados, mas uma exceção de runtime
 * pode carregar identificadores nus — chave de acesso (44 dígitos), protocolo/recibo (15). Eles
 * não são segredo, porém não têm por que viajar numa mensagem de falha, e a trilha estruturada
 * já os registra nos campos próprios. Sequências longas de dígitos são substituídas.
 */
function mensagemDeErroSegura(error: unknown): string {
  return sanitizeFiscalQueueError(
    sanitizeFiscalQueueError(error).replace(/\d{12,}/g, "[identificador_removido]"),
  )
}

/**
 * Converte uma exceção do coordenador em desfecho de fila **preservando a proveniência real**
 * (bloqueio 2 da revisão cruzada do PR #44).
 *
 * O defeito corrigido: exceções lançadas por `transmit`/`consult` subiam sem tratamento até o
 * `catch` genérico do `queue-worker`, que fabricava `simulado: true` e
 * `externalTransmissionAttempted: false`. Uma tentativa externa que falhou **depois** de tocar
 * a rede era registrada como execução simulada que nunca saiu da máquina — e caía em
 * `transient`, portanto em **retry com backoff**: retransmissão automática de um documento que
 * pode ter chegado à SEFAZ.
 *
 * O coordenador anexa a proveniência ao erro (`attachProvenance`). Havendo-a **e tendo o
 * provider sido de fato invocado**, as flags de auditoria passam a derivar do que aconteceu.
 *
 * ⚠️ A condição `providerInvoked` não é detalhe: o coordenador anexa proveniência a QUALQUER
 * erro seu, inclusive a uma falha de banco em `load`, anterior a qualquer chamada ao provider.
 * Nesse caso não existe ambiguidade alguma — nada foi enviado —, e estacionar o job à espera de
 * consulta humana transformaria uma indisponibilidade momentânea em intervenção manual. O erro
 * volta a subir e o fallback legado do worker (`transient`, com backoff) trata como sempre
 * tratou, sem inventar tentativa externa.
 *
 * ⚠️ **O `kind` depende do tipo de job**, e a assimetria é deliberada:
 *
 *  - **`EMISSAO`** ⇒ `uncertain`. Repetir uma transmissão cujo desfecho é desconhecido pode
 *    duplicar o documento; o job estaciona e a CONSULTA — garantida pelo coordenador no mesmo
 *    `catch` — é quem resolve.
 *  - **`CONSULTA`** ⇒ `transient`. Consultar é leitura: repetir é seguro e é exatamente o que
 *    se quer. Marcá-la como `uncertain` a mandaria para `waitForConsultation`, ou seja, a
 *    consulta ficaria **esperando por si mesma** com `proximaTentativaEm: null` — o mesmo
 *    defeito do bloqueio 1, e uma regressão frente ao comportamento anterior, que a repetia.
 *    O que a correção muda aqui não é o `kind`, é a **honestidade das flags**.
 */
function desfechoDeExcecaoComProveniencia(
  error: unknown,
  tipo: FiscalQueueJob["tipo"],
): FiscalQueueExecutionResult | null {
  const provenance = fiscalExecutionProvenanceOf(error)
  if (!provenance || !provenance.providerInvoked) return null
  const auditoria = auditFlagsFromProvenance(provenance)
  const mensagem = mensagemDeErroSegura(error)

  if (tipo === "CONSULTA") {
    return {
      kind: "transient",
      code: "consulta_interrompida",
      mensagem,
      ...auditoria,
      detalhe: { providerInvoked: provenance.providerInvoked },
    }
  }

  /**
   * ⚠️ `unresolved` quando a consulta NÃO pôde ser garantida (resíduo 3).
   *
   * `uncertain` afirma — no estado e no log — que se aguarda uma consulta deduplicada. Sem
   * consulta alguma existindo, essa afirmação é o que faz o documento sumir em silêncio: o
   * operador lê "aguardando consulta" e supõe processo em curso. O `kind` dedicado leva ao
   * estacionamento com auditoria `ERROR` explícita.
   */
  const consultaGarantida = fiscalConsultationEnsuredOf(error)
  return {
    kind: consultaGarantida ? "uncertain" : "unresolved",
    code: consultaGarantida
      ? "execucao_fiscal_interrompida"
      : "transmissao_incerta_sem_consulta",
    mensagem,
    ...auditoria,
    detalhe: {
      providerInvoked: provenance.providerInvoked,
      consultationEnsured: consultaGarantida,
    },
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
      let outcome
      try {
        outcome = await reconcileUncertainDocument({
          locator,
          persistence: dependencies.persistence,
          provider: dependencies.provider,
          now: dependencies.now?.(),
          capability: dependencies.capability,
        })
      } catch (error) {
        const comProveniencia = desfechoDeExcecaoComProveniencia(error, job.tipo)
        if (comProveniencia) return comProveniencia
        throw error
      }
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
      /**
       * `103/105` em consulta: **reconsulta** do mesmo recibo, jamais nova transmissão.
       *
       * ⚠️ `kind: "processing"`, não `"uncertain"` (bloqueio 1 da revisão cruzada do PR #44).
       * Como `uncertain`, este job ia para `waitForConsultation` e ficava `AGUARDANDO_RETRY`
       * com `proximaTentativaEm: null` — inelegível para sempre. A consulta passava a esperar
       * por si mesma e o documento morria em `TRANSMITINDO`.
       */
      if (outcome.kind === "processing") {
        return {
          kind: "processing",
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
      /**
       * Consulta que não resolveu nada — SOAP Fault, resposta ilegível, `108/109`, `UNKNOWN`.
       *
       * ⚠️ `kind: "transient"`, não `"uncertain"` (resíduo 2 da revisão cruzada). Como
       * `uncertain`, este job ia para `waitForConsultation` e ficava `AGUARDANDO_RETRY` com
       * `proximaTentativaEm: null` — inelegível para sempre. A consulta voltava a **esperar por
       * si mesma** e a nota morria em `TRANSMITINDO`, agora por serviço fora do ar em vez de
       * por lote em processamento: o mesmo defeito, outra porta de entrada.
       *
       * Repetir uma consulta é LEITURA: não duplica documento, não consome numeração e é a
       * única forma de o desfecho aparecer. E **não** autoriza retransmissão da EMISSAO — só
       * `NOT_FOUND` explícito faz isso, via `authorizeExactRetransmission`.
       */
      if (outcome.kind === "uncertain") {
        return {
          kind: "transient",
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
    let outcome
    try {
      outcome = await transmitWithUncertainStateSafety({
        locator,
        persistence: dependencies.persistence,
        preparer: dependencies.preparer,
        provider: dependencies.provider,
        now: dependencies.now?.(),
        capability: dependencies.capability,
        retryAuthorizedByConsultation:
          transmission.consultationOutcome === "NOT_FOUND" &&
          Boolean(transmission.retryAuthorizedAt) &&
          (
            !transmission.retryAuthorizationConsumedAt ||
            transmission.retryAuthorizationConsumedAt === transmission.lastStartedAt
          ),
      })
    } catch (error) {
      // Exceção APÓS o provider ter sido invocado: a proveniência anexada pelo coordenador diz
      // se houve contato externo. Sem esse tratamento, o `catch` do worker converteria uma
      // transmissão possivelmente entregue em `transient` — ou seja, retry automático.
      const comProveniencia = desfechoDeExcecaoComProveniencia(error, job.tipo)
      if (comProveniencia) return comProveniencia
      throw error
    }
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
        mensagem: "Rejeição definitiva; número permanece consumido e segue para inutilização.",
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
