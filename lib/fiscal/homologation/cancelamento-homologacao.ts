/**
 * Caminho de homologação real do cancelamento fiscal (GOAL 018).
 *
 * NFC-e autorizada em HOMOLOGACAO → evento NFeRecepcaoEvento4 → protocolo → persistência
 * → consulta confirmando CANCELADA.
 *
 * Se o gate efêmero H-9/H-10 não estiver vigente, devolve indisponível — não fabrica SEFAZ.
 */
import { WSDL_EPHEMERAL_EXECUTION_WINDOW } from "@/lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window"
import { cancelarNfceAutorizadaPersistido } from "@/lib/fiscal/events/cancelamento-prisma"
import type { CancelamentoFiscalOutcome } from "@/lib/fiscal/events/cancelamento-service"
import {
  avaliarGateHomologacaoCancelamentoFrom,
  type HomologacaoCancelamentoGate,
} from "./homologation-gate"

export type { HomologacaoCancelamentoGate }

export function avaliarGateHomologacaoCancelamento(
  agora: Date = new Date(),
): HomologacaoCancelamentoGate {
  return avaliarGateHomologacaoCancelamentoFrom(WSDL_EPHEMERAL_EXECUTION_WINDOW, agora)
}

export async function executarHomologacaoCancelamento(input: {
  storeId: string
  notaFiscalId: string
  justificativa: string
  operador?: string
  agora?: Date
}): Promise<{ gate: HomologacaoCancelamentoGate; outcome: CancelamentoFiscalOutcome | null }> {
  const gate = avaliarGateHomologacaoCancelamento(input.agora)
  if (!gate.disponivel) {
    return { gate, outcome: null }
  }
  const outcome = await cancelarNfceAutorizadaPersistido({
    storeId: input.storeId,
    notaFiscalId: input.notaFiscalId,
    justificativa: input.justificativa,
    operador: input.operador ?? "homologacao",
  })
  return { gate, outcome }
}
