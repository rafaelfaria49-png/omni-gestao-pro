/**
 * Serviço de evento de cancelamento fiscal NFC-e (GOAL 018).
 *
 * Orquestra identidade, sequência, motivo, idempotência, persistência, FiscalLog e
 * transições. Não escreve Financeiro/Caixa. Não reconstrói XML autorizado.
 */
import { FiscalStatusVenda, StatusEventoFiscal, StatusNotaFiscal } from "@/generated/prisma"
import type { FiscalProvider } from "@/lib/fiscal/provider/types"
import { avaliarGuardiaCancelamentoFiscal, type GuardiaCancelamentoFiscal } from "./guard-matrix"
import { identidadeEventoCancelamento, SEQUENCIA_CANCELAMENTO_NFCE, TIPO_EVENTO_CANCELAMENTO } from "./evento-identidade"
import { validarJustificativaCancelamento } from "./justificativa"
import { interpretarCStatCancelamento, isCancelamentoFiscalAutorizado } from "./cstat-cancelamento"

export type NotaFiscalCancelamento = {
  id: string
  storeId: string
  vendaId: string
  status: string
  chaveAcesso: string | null
  protocolo: string | null
  dataAutorizacao: Date | string | null
  xmlAutorizado: string | null
  xmlAssinado: string | null
  snapshotEmitente: unknown
  cnpjEmitente?: string | null
  ambiente: string
  modelo: string
}

export type VendaCancelamento = {
  id: string
  storeId: string
  fiscalStatus: string | null
}

export type EventoFiscalCancelamento = {
  id: string
  notaFiscalId: string
  tipo: string
  sequencia: number
  status: string
  protocolo: string | null
  cStat: string | null
  xMotivo: string | null
  justificativa: string | null
  xmlEvento: string | null
  xmlRetorno: string | null
}

export type FiscalLogCancelamento = {
  storeId: string
  vendaId: string | null
  notaFiscalId: string | null
  eventoFiscalId?: string | null
  nivel: string
  acao: string
  cStat?: string | null
  xMotivo?: string | null
  mensagem: string
  detalhe?: Record<string, unknown>
  operador?: string | null
}

/** Portas de escrita financeira — o serviço NUNCA as chama. Existem para a prova de isolamento. */
export type FinanceiroWritePorts = {
  estornar?: (input: unknown) => Promise<unknown>
  baixar?: (input: unknown) => Promise<unknown>
  lancar?: (input: unknown) => Promise<unknown>
  mutarCaixa?: (input: unknown) => Promise<unknown>
}

export type CancelamentoFiscalPorts = {
  now?: () => Date
  loadNota: (input: { storeId: string; notaFiscalId: string }) => Promise<NotaFiscalCancelamento | null>
  loadVenda: (input: { storeId: string; vendaId: string }) => Promise<VendaCancelamento | null>
  findEvento: (identidade: {
    notaFiscalId: string
    tipo: string
    sequencia: number
  }) => Promise<EventoFiscalCancelamento | null>
  upsertEvento: (input: {
    storeId: string
    notaFiscalId: string
    tipo: string
    sequencia: number
    status: string
    justificativa: string
    protocolo?: string | null
    cStat?: string | null
    xMotivo?: string | null
    xmlEvento?: string | null
    xmlRetorno?: string | null
    operador?: string | null
  }) => Promise<EventoFiscalCancelamento>
  markNotaCancelada: (input: {
    notaFiscalId: string
    cStat: string | null
    xMotivo: string | null
    xmlAutorizadoAtual: string | null
    xmlAssinadoAtual: string | null
  }) => Promise<{ xmlAutorizado: string | null; xmlAssinado: string | null; status: string }>
  setVendaFiscalStatus: (input: {
    vendaId: string
    de: string
    para: string
  }) => Promise<void>
  abortarSolicitacao?: (input: {
    storeId: string
    notaFiscalId: string
    vendaId: string
  }) => Promise<void>
  log: (entry: FiscalLogCancelamento) => Promise<void>
  provider: FiscalProvider
  finance?: FinanceiroWritePorts
}

export type CancelamentoFiscalInput = {
  storeId: string
  notaFiscalId: string
  justificativa: string
  operador?: string | null
  incerto?: boolean
}

export type CancelamentoFiscalResultado =
  | "autorizado"
  | "idempotente"
  | "duplicado"
  | "bloqueado"
  | "rejeitado"
  | "incerto"
  | "abortado"
  | "erro"

export type CancelamentoFiscalOutcome = {
  ok: boolean
  resultado: CancelamentoFiscalResultado
  code: string
  mensagem: string
  statusHttp: number
  idempotente: boolean
  sequencia: number
  notaStatus: string | null
  vendaFiscalStatus: string | null
  eventoId: string | null
  protocolo: string | null
  cStat: string | null
  xmlAutorizado: string | null
  xmlAssinado: string | null
  xmlAutorizadoAlterado: boolean
  financeWriteCount: number
  guardia: GuardiaCancelamentoFiscal | null
}

function fail(
  partial: Partial<CancelamentoFiscalOutcome> & Pick<CancelamentoFiscalOutcome, "resultado" | "code" | "mensagem" | "statusHttp">,
): CancelamentoFiscalOutcome {
  return {
    ok: false,
    idempotente: false,
    sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
    notaStatus: null,
    vendaFiscalStatus: null,
    eventoId: null,
    protocolo: null,
    cStat: null,
    xmlAutorizado: null,
    xmlAssinado: null,
    xmlAutorizadoAlterado: false,
    financeWriteCount: 0,
    guardia: null,
    ...partial,
  }
}

function financeWriteCountOf(ports: CancelamentoFiscalPorts): number {
  return Number((ports.finance as { __writeCount?: number } | undefined)?.__writeCount ?? 0)
}

/**
 * Cancela fiscamente uma NFC-e autorizada. Idempotente por (notaFiscalId, CANCELAMENTO, 1).
 * Zero escritas em Financeiro/Caixa.
 */
export async function cancelarNfceAutorizada(
  input: CancelamentoFiscalInput,
  ports: CancelamentoFiscalPorts,
): Promise<CancelamentoFiscalOutcome> {
  const storeId = String(input.storeId ?? "").trim()
  const notaFiscalId = String(input.notaFiscalId ?? "").trim()
  const operador = input.operador ?? "admin"
  if (!storeId || !notaFiscalId) {
    return fail({
      resultado: "erro",
      code: "parametros_invalidos",
      mensagem: "storeId e notaFiscalId são obrigatórios.",
      statusHttp: 400,
    })
  }

  const just = validarJustificativaCancelamento(input.justificativa)
  if (!just.ok) {
    return fail({
      resultado: "rejeitado",
      code: just.code,
      mensagem: just.mensagem,
      statusHttp: 400,
    })
  }

  const nota = await ports.loadNota({ storeId, notaFiscalId })
  if (!nota || nota.storeId !== storeId) {
    return fail({
      resultado: "erro",
      code: "nota_nao_encontrada",
      mensagem: "Nota fiscal não encontrada nesta loja.",
      statusHttp: 404,
    })
  }

  const venda = await ports.loadVenda({ storeId, vendaId: nota.vendaId })
  if (!venda) {
    return fail({
      resultado: "erro",
      code: "venda_nao_encontrada",
      mensagem: "Venda da nota fiscal não encontrada.",
      statusHttp: 404,
    })
  }

  const agora = ports.now ? ports.now() : new Date()
  const identidade = identidadeEventoCancelamento(nota.id)
  const existente = await ports.findEvento(identidade)

  if (existente && existente.status === StatusEventoFiscal.AUTORIZADO) {
    let xmlAutorizado = nota.xmlAutorizado
    let xmlAssinado = nota.xmlAssinado
    if (nota.status !== StatusNotaFiscal.CANCELADA) {
      const persistido = await ports.markNotaCancelada({
        notaFiscalId: nota.id,
        cStat: existente.cStat,
        xMotivo: existente.xMotivo,
        xmlAutorizadoAtual: nota.xmlAutorizado,
        xmlAssinadoAtual: nota.xmlAssinado,
      })
      xmlAutorizado = persistido.xmlAutorizado
      xmlAssinado = persistido.xmlAssinado
    }
    if (venda.fiscalStatus !== FiscalStatusVenda.CANCELADA_FISCAL) {
      await ports.setVendaFiscalStatus({
        vendaId: nota.vendaId,
        de: String(venda.fiscalStatus ?? ""),
        para: FiscalStatusVenda.CANCELADA_FISCAL,
      })
    }
    await ports.log({
      storeId,
      vendaId: nota.vendaId,
      notaFiscalId,
      eventoFiscalId: existente.id,
      nivel: "INFO",
      acao: "evento.cancelamento.idempotente",
      cStat: existente.cStat,
      xMotivo: existente.xMotivo,
      mensagem: "Evento de cancelamento já autorizado — identidade reutilizada, sem nova transmissão.",
      detalhe: { ...identidade },
      operador,
    })
    return {
      ok: true,
      resultado: "idempotente",
      code: "evento_ja_autorizado",
      mensagem: "Cancelamento fiscal já autorizado para esta identidade (notaFiscalId, tipo, sequencia).",
      statusHttp: 200,
      idempotente: true,
      sequencia: identidade.sequencia,
      notaStatus: StatusNotaFiscal.CANCELADA,
      vendaFiscalStatus: FiscalStatusVenda.CANCELADA_FISCAL,
      eventoId: existente.id,
      protocolo: existente.protocolo,
      cStat: existente.cStat,
      xmlAutorizado,
      xmlAssinado,
      xmlAutorizadoAlterado: xmlAutorizado !== nota.xmlAutorizado,
      financeWriteCount: financeWriteCountOf(ports),
      guardia: null,
    }
  }

  const guardia = avaliarGuardiaCancelamentoFiscal({
    vendaFiscalStatus: venda.fiscalStatus,
    notaStatus: nota.status,
    incerto: input.incerto,
    dataAutorizacao: nota.dataAutorizacao,
    agora,
  })

  if (guardia.acao === "abortar_solicitacao") {
    await ports.abortarSolicitacao?.({ storeId, notaFiscalId, vendaId: nota.vendaId })
    await ports.log({
      storeId,
      vendaId: nota.vendaId,
      notaFiscalId,
      nivel: "INFO",
      acao: "evento.cancelamento.solicitacao_abortada",
      mensagem: guardia.mensagem,
      operador,
    })
    return {
      ok: true,
      resultado: "abortado",
      code: guardia.code,
      mensagem: guardia.mensagem,
      statusHttp: 200,
      idempotente: false,
      sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
      notaStatus: nota.status,
      vendaFiscalStatus: venda.fiscalStatus,
      eventoId: null,
      protocolo: null,
      cStat: null,
      xmlAutorizado: nota.xmlAutorizado,
      xmlAssinado: nota.xmlAssinado,
      xmlAutorizadoAlterado: false,
      financeWriteCount: financeWriteCountOf(ports),
      guardia,
    }
  }

  if (guardia.acao !== "cancelar_fiscal") {
    await ports.log({
      storeId,
      vendaId: nota.vendaId,
      notaFiscalId,
      nivel: "WARN",
      acao: "evento.cancelamento.bloqueado",
      mensagem: guardia.mensagem,
      detalhe: { code: guardia.code, acao: guardia.acao },
      operador,
    })
    return fail({
      resultado: "bloqueado",
      code: guardia.code,
      mensagem: guardia.mensagem,
      statusHttp: guardia.statusHttp,
      notaStatus: nota.status,
      vendaFiscalStatus: venda.fiscalStatus,
      xmlAutorizado: nota.xmlAutorizado,
      xmlAssinado: nota.xmlAssinado,
      financeWriteCount: financeWriteCountOf(ports),
      guardia,
    })
  }

  const xmlAutorizadoAntes = nota.xmlAutorizado
  const xmlAssinadoAntes = nota.xmlAssinado

  const eventoPendente = await ports.upsertEvento({
    storeId,
    notaFiscalId: nota.id,
    tipo: TIPO_EVENTO_CANCELAMENTO,
    sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
    status: StatusEventoFiscal.PENDENTE,
    justificativa: just.texto,
    operador,
  })

  const resposta = await ports.provider.cancelar({
    contexto: {
      storeId,
      notaFiscalId: nota.id,
      modelo: nota.modelo,
      ambiente: nota.ambiente,
    },
    chaveAcesso: nota.chaveAcesso,
    protocolo: nota.protocolo,
    justificativa: just.texto,
  })

  const cStat = resposta.dados?.cStat != null ? String(resposta.dados.cStat) : null
  const xMotivo = resposta.dados?.xMotivo != null ? String(resposta.dados.xMotivo) : resposta.mensagem
  const protocoloEvento = resposta.dados?.protocolo != null ? String(resposta.dados.protocolo) : null
  const desfecho = interpretarCStatCancelamento(cStat)

  if (desfecho.desfecho === "duplicidade" && existente?.status === StatusEventoFiscal.AUTORIZADO) {
    return {
      ok: true,
      resultado: "duplicado",
      code: "evento_duplicado",
      mensagem: "SEFAZ informou duplicidade do mesmo evento — identidade preservada, sem nova mutação.",
      statusHttp: 200,
      idempotente: true,
      sequencia: identidade.sequencia,
      notaStatus: StatusNotaFiscal.CANCELADA,
      vendaFiscalStatus: FiscalStatusVenda.CANCELADA_FISCAL,
      eventoId: existente.id,
      protocolo: existente.protocolo,
      cStat: existente.cStat,
      xmlAutorizado: xmlAutorizadoAntes,
      xmlAssinado: xmlAssinadoAntes,
      xmlAutorizadoAlterado: false,
      financeWriteCount: financeWriteCountOf(ports),
      guardia,
    }
  }

  const autorizado =
    resposta.ok &&
    (isCancelamentoFiscalAutorizado(cStat) || desfecho.desfecho === "autorizado" || desfecho.desfecho === "duplicidade")

  if (!autorizado) {
    const eventoRej = await ports.upsertEvento({
      storeId,
      notaFiscalId: nota.id,
      tipo: TIPO_EVENTO_CANCELAMENTO,
      sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
      status: StatusEventoFiscal.REJEITADO,
      justificativa: just.texto,
      protocolo: protocoloEvento,
      cStat,
      xMotivo,
      operador,
    })
    await ports.log({
      storeId,
      vendaId: nota.vendaId,
      notaFiscalId,
      eventoFiscalId: eventoRej.id,
      nivel: "WARN",
      acao: "evento.cancelamento.rejeitado",
      cStat,
      xMotivo,
      mensagem: resposta.mensagem || "Cancelamento fiscal não autorizado pela SEFAZ.",
      detalhe: { ...identidade, resultado: resposta.resultado },
      operador,
    })
    const resultado: CancelamentoFiscalResultado =
      desfecho.desfecho === "incerto" || resposta.resultado === "erro" ? "incerto" : "rejeitado"
    return fail({
      resultado,
      code: resultado === "incerto" ? "fiscal_cancelamento_incerto" : "fiscal_cancelamento_rejeitado",
      mensagem: resposta.mensagem || "Cancelamento fiscal não autorizado.",
      statusHttp: resultado === "incerto" ? 409 : 422,
      notaStatus: nota.status,
      vendaFiscalStatus: venda.fiscalStatus,
      eventoId: eventoRej.id,
      protocolo: protocoloEvento,
      cStat,
      xmlAutorizado: xmlAutorizadoAntes,
      xmlAssinado: xmlAssinadoAntes,
      financeWriteCount: financeWriteCountOf(ports),
      guardia,
    })
  }

  const eventoOk = await ports.upsertEvento({
    storeId,
    notaFiscalId: nota.id,
    tipo: TIPO_EVENTO_CANCELAMENTO,
    sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
    status: StatusEventoFiscal.AUTORIZADO,
    justificativa: just.texto,
    protocolo: protocoloEvento,
    cStat,
    xMotivo,
    operador,
  })

  const persistido = await ports.markNotaCancelada({
    notaFiscalId: nota.id,
    cStat,
    xMotivo,
    xmlAutorizadoAtual: xmlAutorizadoAntes,
    xmlAssinadoAtual: xmlAssinadoAntes,
  })

  await ports.setVendaFiscalStatus({
    vendaId: nota.vendaId,
    de: String(venda.fiscalStatus ?? ""),
    para: FiscalStatusVenda.CANCELADA_FISCAL,
  })

  await ports.log({
    storeId,
    vendaId: nota.vendaId,
    notaFiscalId,
    eventoFiscalId: eventoOk.id,
    nivel: "INFO",
    acao: "evento.cancelamento.autorizado",
    cStat,
    xMotivo,
    mensagem: "Cancelamento fiscal autorizado. Nota CANCELADA; venda CANCELADA_FISCAL. Sem escrita financeira.",
    detalhe: {
      ...identidade,
      protocolo: protocoloEvento,
      xmlAutorizadoAlterado: persistido.xmlAutorizado !== xmlAutorizadoAntes,
    },
    operador,
  })

  void eventoPendente

  return {
    ok: true,
    resultado: "autorizado",
    code: "cancelamento_fiscal_autorizado",
    mensagem: "Cancelamento fiscal autorizado pela SEFAZ.",
    statusHttp: 200,
    idempotente: false,
    sequencia: identidade.sequencia,
    notaStatus: persistido.status,
    vendaFiscalStatus: FiscalStatusVenda.CANCELADA_FISCAL,
    eventoId: eventoOk.id,
    protocolo: protocoloEvento,
    cStat,
    xmlAutorizado: persistido.xmlAutorizado,
    xmlAssinado: persistido.xmlAssinado,
    xmlAutorizadoAlterado: persistido.xmlAutorizado !== xmlAutorizadoAntes,
    financeWriteCount: financeWriteCountOf(ports),
    guardia,
  }
}
