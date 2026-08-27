/**
 * Interpretação de cStat do evento de cancelamento (`NFeRecepcaoEvento4`).
 *
 * Sucesso canônico do webservice de eventos (MOC, tabela de processamento):
 * `135` — Evento registrado e vinculado a NF-e.
 *
 * `101` (Cancelamento de NF-e homologado) é status de **documento** na consulta,
 * não o retorno canônico de `NFeRecepcaoEvento4`. Não autoriza persistência de cancelamento
 * a partir deste endpoint.
 */
export const CSTAT_CANCELAMENTO_HOMOLOGADO = "101"
export const CSTAT_EVENTO_REGISTRADO = "135"
export const CSTAT_DUPLICIDADE_EVENTO = "573"

const AUTORIZADOS_EVENTO = new Set([CSTAT_EVENTO_REGISTRADO])

export type DesfechoCStatCancelamento =
  | { desfecho: "autorizado"; cStat: string }
  | { desfecho: "duplicidade"; cStat: string }
  | { desfecho: "rejeitado"; cStat: string }
  | { desfecho: "incerto"; cStat: string | null }

export function isCancelamentoFiscalAutorizado(cStat: string | null | undefined): boolean {
  return AUTORIZADOS_EVENTO.has(String(cStat ?? "").trim())
}

export function interpretarCStatCancelamento(cStat: string | null | undefined): DesfechoCStatCancelamento {
  const code = String(cStat ?? "").trim()
  if (!code) return { desfecho: "incerto", cStat: null }
  if (AUTORIZADOS_EVENTO.has(code)) return { desfecho: "autorizado", cStat: code }
  if (code === CSTAT_DUPLICIDADE_EVENTO) return { desfecho: "duplicidade", cStat: code }
  if (/^\d{3}$/.test(code)) return { desfecho: "rejeitado", cStat: code }
  return { desfecho: "incerto", cStat: code }
}

export type VereditoPersistenciaCancelamento =
  | { ok: true; cStat: string }
  | { ok: false; code: string; mensagem: string }

/**
 * Única porta de persistência: resposta NÃO simulada + cStat 135 (evento registrado).
 * Duplicidade (573) não autoriza mutação nova — só reconvergência se o evento local já é AUTORIZADO.
 */
export function vereditoPersistenciaCancelamento(resposta: {
  simulado: boolean
  ok: boolean
  dados?: { cStat?: string | null } | null
}): VereditoPersistenciaCancelamento {
  if (resposta.simulado) {
    return {
      ok: false,
      code: "resposta_simulada",
      mensagem: "Resposta simulada não autoriza persistência de cancelamento fiscal.",
    }
  }
  const cStat = resposta.dados?.cStat != null ? String(resposta.dados.cStat) : null
  const desfecho = interpretarCStatCancelamento(cStat)
  if (resposta.ok && desfecho.desfecho === "autorizado" && desfecho.cStat === CSTAT_EVENTO_REGISTRADO) {
    return { ok: true, cStat: desfecho.cStat }
  }
  if (desfecho.desfecho === "duplicidade") {
    return {
      ok: false,
      code: "evento_duplicado_sem_autorizacao_local",
      mensagem:
        "Cancelamento incerto: a SEFAZ informou duplicidade de evento sem autorização local " +
        "registrada — consulte o protocolo do evento na SEFAZ antes de reprocessar.",
    }
  }
  if (desfecho.desfecho === "rejeitado") {
    return {
      ok: false,
      code: "fiscal_cancelamento_rejeitado",
      mensagem: "Cancelamento fiscal rejeitado pela SEFAZ; estado persistido inalterado.",
    }
  }
  if (desfecho.desfecho === "incerto" || !resposta.ok) {
    return {
      ok: false,
      code: "fiscal_cancelamento_incerto",
      mensagem: "Cancelamento fiscal incerto ou sem desfecho autorizado; estado persistido inalterado.",
    }
  }
  return {
    ok: false,
    code: "fiscal_cancelamento_rejeitado",
    mensagem: "Cancelamento fiscal não autorizado pela SEFAZ; estado persistido inalterado.",
  }
}
