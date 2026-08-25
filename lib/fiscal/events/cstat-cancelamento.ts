/**
 * Interpretação de cStat do evento de cancelamento (NFeRecepcaoEvento4).
 *
 * `101` é o código oficial de sucesso no dossiê Q-05 (Cancelamento de NF-e homologado).
 * `135` (Evento registrado e vinculado à NF-e) também autoriza o evento — resposta
 * habitual do webservice de eventos. Não são códigos de autorização de uso (`100`).
 */
export const CSTAT_CANCELAMENTO_HOMOLOGADO = "101"
export const CSTAT_EVENTO_REGISTRADO = "135"
export const CSTAT_DUPLICIDADE_EVENTO = "573"

const AUTORIZADOS = new Set([CSTAT_CANCELAMENTO_HOMOLOGADO, CSTAT_EVENTO_REGISTRADO])

export type DesfechoCStatCancelamento =
  | { desfecho: "autorizado"; cStat: string }
  | { desfecho: "duplicidade"; cStat: string }
  | { desfecho: "rejeitado"; cStat: string }
  | { desfecho: "incerto"; cStat: string | null }

export function isCancelamentoFiscalAutorizado(cStat: string | null | undefined): boolean {
  return AUTORIZADOS.has(String(cStat ?? "").trim())
}

export function interpretarCStatCancelamento(cStat: string | null | undefined): DesfechoCStatCancelamento {
  const code = String(cStat ?? "").trim()
  if (!code) return { desfecho: "incerto", cStat: null }
  if (AUTORIZADOS.has(code)) return { desfecho: "autorizado", cStat: code }
  if (code === CSTAT_DUPLICIDADE_EVENTO) return { desfecho: "duplicidade", cStat: code }
  if (/^\d{3}$/.test(code)) return { desfecho: "rejeitado", cStat: code }
  return { desfecho: "incerto", cStat: code }
}
