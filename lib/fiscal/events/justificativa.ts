/**
 * Justificativa de evento de cancelamento — regra SEFAZ 15..255 caracteres.
 * Pura: sem I/O.
 */
export const JUSTIFICATIVA_CANCELAMENTO_MIN = 15
export const JUSTIFICATIVA_CANCELAMENTO_MAX = 255

export type JustificativaCancelamento =
  | { ok: true; texto: string }
  | { ok: false; code: "justificativa_invalida"; mensagem: string }

export function validarJustificativaCancelamento(
  raw: string | null | undefined,
): JustificativaCancelamento {
  const texto = String(raw ?? "").trim()
  if (texto.length < JUSTIFICATIVA_CANCELAMENTO_MIN || texto.length > JUSTIFICATIVA_CANCELAMENTO_MAX) {
    return {
      ok: false,
      code: "justificativa_invalida",
      mensagem: `Justificativa de cancelamento deve ter entre ${JUSTIFICATIVA_CANCELAMENTO_MIN} e ${JUSTIFICATIVA_CANCELAMENTO_MAX} caracteres.`,
    }
  }
  return { ok: true, texto }
}
