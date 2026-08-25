/**
 * Execução do job INUTILIZACAO: provider → protocolo → EventoFiscal → baixa da marca.
 *
 * Sem retry automático. Número jamais retorna ao pool.
 */

import type { FiscalProvider } from "../provider/types"
import type { FiscalQueueExecutionResult, FiscalQueueJob } from "../queue/queue.types"
import { codigoUf } from "../xml/nfce-chave-acesso"
import { TPROT_PATTERN } from "./types"
import { INUTILIZACAO_MARK, asInutilizacaoPayload, podeBaixarMarcacao } from "./mark"
import type { InutilizacaoPorts } from "./ports"
import { normalizarJustificativa, serieInutilizacaoValida } from "./validation"

export type ExecuteInutilizacaoDependencies = {
  ports: InutilizacaoPorts
  provider: FiscalProvider
  now?: () => Date
}

export async function executeInutilizacaoJob(
  job: FiscalQueueJob,
  dependencies: ExecuteInutilizacaoDependencies,
): Promise<FiscalQueueExecutionResult> {
  const naoInvocado = {
    simulado: dependencies.provider.simulado,
    externalTransmissionAttempted: false,
  }
  if (job.tipo !== "INUTILIZACAO") {
    return {
      kind: "terminal",
      code: "tipo_nao_suportado",
      mensagem: `Executor de inutilização recebeu ${job.tipo}.`,
      ...naoInvocado,
    }
  }
  const payload = asInutilizacaoPayload(job.payload)
  if (!payload) {
    return {
      kind: "terminal",
      code: "payload_invalido",
      mensagem: "Payload de inutilização ausente ou ilegível.",
      ...naoInvocado,
    }
  }

  // Baixa local já definitiva: não revalida TProt contra o provider atual e não reenvia.
  if (payload.mark === INUTILIZACAO_MARK.INUTILIZADO) {
    return {
      kind: "success",
      code: "ja_inutilizada",
      mensagem: "Faixa já inutilizada com protocolo persistido.",
      ...naoInvocado,
      detalhe: {
        protocolo: payload.protocolo,
        cStat: payload.cStat,
        mark: payload.mark,
        idempotent: true,
      },
    }
  }

  const existingEvento = payload.notaFiscalId
    ? await dependencies.ports.findEvento({ notaFiscalId: payload.notaFiscalId })
    : null
  if (
    existingEvento?.status === "AUTORIZADO" &&
    TPROT_PATTERN.test(String(existingEvento.protocolo ?? "").trim())
  ) {
    const now = dependencies.now?.() ?? new Date()
    const baixado: typeof payload = {
      ...payload,
      mark: INUTILIZACAO_MARK.INUTILIZADO,
      protocolo: existingEvento.protocolo,
      cStat: existingEvento.cStat,
      inutilizadoEm: now.toISOString(),
    }
    await dependencies.ports.updateJobPayload({
      jobId: job.id,
      storeId: job.storeId,
      expectedMark: payload.mark,
      payload: baixado,
      status: "CONCLUIDO",
    })
    return {
      kind: "success",
      code: "ja_inutilizada",
      mensagem: "EventoFiscal de inutilização já autorizado; marca baixada.",
      ...naoInvocado,
      detalhe: {
        protocolo: existingEvento.protocolo,
        cStat: existingEvento.cStat,
        mark: INUTILIZACAO_MARK.INUTILIZADO,
        idempotent: true,
      },
    }
  }

  if (!serieInutilizacaoValida(payload.serie)) {
    return {
      kind: "terminal",
      code: "parametros_invalidos",
      mensagem: "Série fiscal inválida (TSerie: 0 a 999).",
      ...naoInvocado,
    }
  }

  const justificativa = normalizarJustificativa(payload.justificativa)
  const config = await dependencies.ports.findConfig({ storeId: payload.storeId })
  const cUF = codigoUf(config?.uf)
  if (!cUF) {
    return {
      kind: "terminal",
      code: "uf_invalida",
      mensagem: "UF da loja ausente ou não mapeável para cUF IBGE; envio recusado.",
      ...naoInvocado,
    }
  }
  const ano = String((dependencies.now?.() ?? new Date()).getFullYear()).slice(-2)
  const resposta = await dependencies.provider.inutilizar({
    contexto: {
      storeId: payload.storeId,
      notaFiscalId: payload.notaFiscalId,
      modelo: payload.modelo,
      ambiente: payload.ambiente,
      serie: payload.serie,
      numero: payload.numeroInicial,
    },
    serie: payload.serie,
    numeroInicial: payload.numeroInicial,
    numeroFinal: payload.numeroFinal,
    justificativa,
    cnpj: config?.cnpj ?? null,
    cUF,
    ano,
  })

  const cStat = resposta.dados?.cStat != null ? String(resposta.dados.cStat) : null
  const protocolo = resposta.dados?.protocolo != null ? String(resposta.dados.protocolo) : null
  const xMotivo = resposta.dados?.xMotivo != null ? String(resposta.dados.xMotivo) : resposta.mensagem
  const now = dependencies.now?.() ?? new Date()
  const baixar = podeBaixarMarcacao({
    cStat,
    protocolo,
    simulado: resposta.simulado,
  })

  if (payload.notaFiscalId) {
    await dependencies.ports.upsertEvento({
      storeId: payload.storeId,
      notaFiscalId: payload.notaFiscalId,
      justificativa,
      operador: payload.requestedBy,
      status: baixar ? "AUTORIZADO" : resposta.resultado === "rejeitado" ? "REJEITADO" : "PENDENTE",
      protocolo: baixar ? protocolo : null,
      cStat,
      xMotivo,
    })
  }

  if (resposta.simulado) {
    await dependencies.ports.createLog({
      storeId: payload.storeId,
      vendaId: payload.vendaId,
      notaFiscalId: payload.notaFiscalId,
      jobId: job.id,
      eventoFiscalId: null,
      nivel: "WARN",
      acao: "fiscal.inutilizacao.simulada_nao_autoritativa",
      mensagem: "Resposta simulada não autoriza inutilização; marca A_INUTILIZAR preservada.",
      cStat,
      xMotivo,
      operador: payload.requestedBy,
      detalhe: {
        protocolo,
        mark: INUTILIZACAO_MARK.A_INUTILIZAR,
        simulado: true,
        serie: payload.serie,
        numeroInicial: payload.numeroInicial,
        numeroFinal: payload.numeroFinal,
      },
    })
    return {
      kind: "terminal",
      code: "inutilizacao_simulada_nao_autoritativa",
      mensagem: "Resposta simulada não autoriza inutilização; número permanece fora do pool.",
      simulado: true,
      externalTransmissionAttempted: false,
      detalhe: {
        mark: INUTILIZACAO_MARK.A_INUTILIZAR,
        cStat,
        protocolo,
        numeroInicial: payload.numeroInicial,
        numeroFinal: payload.numeroFinal,
      },
    }
  }

  if (baixar) {
    const baixado = {
      ...payload,
      mark: INUTILIZACAO_MARK.INUTILIZADO,
      protocolo,
      cStat,
      xMotivo,
      inutilizadoEm: now.toISOString(),
    }
    const persistiu = await dependencies.ports.updateJobPayload({
      jobId: job.id,
      storeId: job.storeId,
      expectedMark: INUTILIZACAO_MARK.A_INUTILIZAR,
      payload: baixado,
      status: "CONCLUIDO",
    })
    if (!persistiu) {
      const atual = asInutilizacaoPayload(
        (await dependencies.ports.findJobByDedupe({
          storeId: job.storeId,
          dedupeKey: job.dedupeKey ?? "",
        }))?.payload,
      )
      if (atual?.mark === INUTILIZACAO_MARK.INUTILIZADO) {
        return {
          kind: "success",
          code: "ja_inutilizada",
          mensagem: "Concorrência: marca já baixada com protocolo.",
          simulado: resposta.simulado,
          externalTransmissionAttempted: !resposta.simulado,
          detalhe: { protocolo: atual.protocolo, cStat: atual.cStat, mark: atual.mark, idempotent: true },
        }
      }
      return {
        kind: "terminal",
        code: "marca_nao_baixada",
        mensagem: "Protocolo recebido, mas a marca A_INUTILIZAR não pôde ser baixada.",
        simulado: resposta.simulado,
        externalTransmissionAttempted: !resposta.simulado,
        detalhe: { protocolo, cStat, mark: atual?.mark ?? INUTILIZACAO_MARK.A_INUTILIZAR },
      }
    }
    await dependencies.ports.createLog({
      storeId: payload.storeId,
      vendaId: payload.vendaId,
      notaFiscalId: payload.notaFiscalId,
      jobId: job.id,
      eventoFiscalId: null,
      nivel: "INFO",
      acao: "fiscal.inutilizacao.homologada",
      mensagem: "Inutilização homologada; marca a inutilizar baixada.",
      cStat,
      xMotivo,
      operador: payload.requestedBy,
      detalhe: {
        protocolo,
        serie: payload.serie,
        numeroInicial: payload.numeroInicial,
        numeroFinal: payload.numeroFinal,
        mark: INUTILIZACAO_MARK.INUTILIZADO,
      },
    })
    return {
      kind: "success",
      code: "inutilizacao_homologada",
      mensagem: "Inutilização homologada com protocolo válido.",
      simulado: resposta.simulado,
      externalTransmissionAttempted: !resposta.simulado,
      detalhe: {
        protocolo,
        cStat,
        mark: INUTILIZACAO_MARK.INUTILIZADO,
        numeroInicial: payload.numeroInicial,
        numeroFinal: payload.numeroFinal,
      },
    }
  }

  await dependencies.ports.createLog({
    storeId: payload.storeId,
    vendaId: payload.vendaId,
    notaFiscalId: payload.notaFiscalId,
    jobId: job.id,
    eventoFiscalId: null,
    nivel: "ERROR",
    acao: "fiscal.inutilizacao.pedido_falhou",
    mensagem: "Pedido de inutilização sem protocolo válido; marca a inutilizar preservada.",
    cStat,
    xMotivo,
    operador: payload.requestedBy,
    detalhe: {
      protocolo,
      mark: INUTILIZACAO_MARK.A_INUTILIZAR,
      resultado: resposta.resultado,
      serie: payload.serie,
      numeroInicial: payload.numeroInicial,
      numeroFinal: payload.numeroFinal,
    },
  })
  return {
    kind: "terminal",
    code: resposta.erros[0]?.code ?? "inutilizacao_nao_homologada",
    mensagem: xMotivo || "Inutilização não homologada; número permanece fora do pool.",
    simulado: resposta.simulado,
    externalTransmissionAttempted: !resposta.simulado,
    detalhe: {
      mark: INUTILIZACAO_MARK.A_INUTILIZAR,
      cStat,
      protocolo,
      numeroInicial: payload.numeroInicial,
      numeroFinal: payload.numeroFinal,
    },
  }
}
