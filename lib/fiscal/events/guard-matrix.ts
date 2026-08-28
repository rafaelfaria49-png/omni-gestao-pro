/**
 * Matriz canônica de estado fiscal para cancelamento (GOAL 018).
 *
 * Combina `Venda.fiscalStatus`, `NotaFiscal.status` e o contrato de estado incerto.
 * Pura — sem Prisma, sem SEFAZ, sem Financeiro.
 */
import { FiscalStatusVenda, StatusNotaFiscal } from "@/generated/prisma"
import { avaliarPrazoCancelamentoNfce, type PrazoCancelamentoNfce } from "./cancelamento-prazo"

const VS = FiscalStatusVenda
const NS = StatusNotaFiscal

export type AcaoGuardiaCancelamento =
  | "permitir_comercial"
  | "abortar_solicitacao"
  | "bloquear_incerto"
  | "cancelar_fiscal"
  | "bloquear_prazo"
  | "permitir_correcao_comercial"
  | "imutavel_terminal"
  | "bloquear"

export type GuardiaCancelamentoFiscal = {
  acao: AcaoGuardiaCancelamento
  ok: boolean
  statusHttp: number
  code: string
  mensagem: string
  prazo: PrazoCancelamentoNfce | null
}

export type EntradaGuardiaCancelamento = {
  vendaFiscalStatus?: string | null
  notaStatus?: string | null
  /** Contrato de estado incerto (consulta por chave ainda não concluiu). */
  incerto?: boolean
  dataAutorizacao?: Date | string | null
  agora?: Date | string | number
}

const TERMINAIS_NOTA = new Set<string>([NS.CANCELADA, NS.DENEGADA, NS.INUTILIZADA])
const RASCUNHO_NOTA = new Set<string>([NS.RASCUNHO, NS.VALIDANDO, NS.ASSINADA])
const INCERTOS_NOTA = new Set<string>([NS.TRANSMITINDO])
const INCERTOS_VENDA = new Set<string>([VS.EMITINDO, VS.EM_CONTINGENCIA])

function texto(v: unknown): string {
  return String(v ?? "").trim().toUpperCase()
}

function resultado(
  acao: AcaoGuardiaCancelamento,
  ok: boolean,
  statusHttp: number,
  code: string,
  mensagem: string,
  prazo: PrazoCancelamentoNfce | null = null,
): GuardiaCancelamentoFiscal {
  return { acao, ok, statusHttp, code, mensagem, prazo }
}

/**
 * Decide o que o cancelamento (comercial ou fiscal) pode fazer neste estado.
 */
export function avaliarGuardiaCancelamentoFiscal(
  input: EntradaGuardiaCancelamento,
): GuardiaCancelamentoFiscal {
  const venda = texto(input.vendaFiscalStatus) || VS.NAO_FISCAL
  const nota = texto(input.notaStatus)
  const incerto = input.incerto === true || INCERTOS_NOTA.has(nota) || INCERTOS_VENDA.has(venda)

  if (venda === VS.NAO_FISCAL && !nota) {
    return resultado(
      "permitir_comercial",
      true,
      200,
      "nao_fiscal",
      "Venda não fiscal — aplicam-se as regras comerciais normais.",
    )
  }

  if (TERMINAIS_NOTA.has(nota) || venda === VS.CANCELADA_FISCAL || venda === VS.BLOQUEADA_FISCAL) {
    return resultado(
      "imutavel_terminal",
      false,
      409,
      "fiscal_documento_terminal",
      "Documento fiscal terminal (CANCELADA/DENEGADA/INUTILIZADA). Histórico imutável — sem cancelamento, correção ou rewrite de XML.",
    )
  }

  if (incerto) {
    return resultado(
      "bloquear_incerto",
      false,
      409,
      "fiscal_bloqueio_incerto",
      "Operação destrutiva bloqueada: documento em TRANSMITINDO/INCERTO. Consulte por chave antes de qualquer cancelamento.",
    )
  }

  if (venda === VS.REJEITADA || nota === NS.REJEITADA) {
    return resultado(
      "permitir_correcao_comercial",
      true,
      200,
      "rejeitada_correcao_comercial",
      "Nota rejeitada: correção comercial permitida. O número consumido permanece reservado para inutilização (GOAL 019).",
    )
  }

  if (
    venda === VS.PENDENTE ||
    RASCUNHO_NOTA.has(nota) ||
    nota === NS.ERRO ||
    nota === NS.CONTINGENCIA
  ) {
    return resultado(
      "abortar_solicitacao",
      true,
      200,
      "abortar_solicitacao_fiscal",
      "Cancelamento da solicitação fiscal conforme o estado real (ainda não há NFC-e autorizada).",
    )
  }

  if (venda === VS.AUTORIZADA || nota === NS.AUTORIZADA) {
    const prazo = avaliarPrazoCancelamentoNfce({
      dataAutorizacao: input.dataAutorizacao,
      agora: input.agora,
    })
    if (!prazo.ok) {
      return resultado(
        "bloquear_prazo",
        false,
        409,
        prazo.code === "prazo_vencido" ? "fiscal_prazo_vencido" : "fiscal_autorizacao_sem_data",
        prazo.mensagem,
        prazo,
      )
    }
    return resultado(
      "cancelar_fiscal",
      true,
      200,
      "cancelamento_fiscal_permitido",
      "NFC-e autorizada: cancelamento comercial somente via evento fiscal, ainda dentro do prazo de 30 minutos.",
      prazo,
    )
  }

  if (venda === VS.NAO_FISCAL) {
    return resultado(
      "permitir_comercial",
      true,
      200,
      "nao_fiscal",
      "Venda não fiscal — aplicam-se as regras comerciais normais.",
    )
  }

  return resultado(
    "bloquear",
    false,
    409,
    "fiscal_bloqueio_estado",
    "Estado fiscal não permite cancelamento nesta operação.",
  )
}
