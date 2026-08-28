/**
 * Identidade idempotente do evento fiscal: (notaFiscalId, tipo, sequencia).
 *
 * Cancelamento de NFC-e autorizada reusa SEMPRE a sequência 1. Duplicata do
 * mesmo evento não inventa sequência nova.
 */
export const TIPO_EVENTO_CANCELAMENTO = "CANCELAMENTO" as const
export const SEQUENCIA_CANCELAMENTO_NFCE = 1 as const

export type IdentidadeEventoCancelamento = {
  notaFiscalId: string
  tipo: typeof TIPO_EVENTO_CANCELAMENTO
  sequencia: typeof SEQUENCIA_CANCELAMENTO_NFCE
}

export function identidadeEventoCancelamento(notaFiscalId: string): IdentidadeEventoCancelamento {
  const id = String(notaFiscalId ?? "").trim()
  if (!id) {
    throw new Error("notaFiscalId obrigatório para identidade do evento de cancelamento.")
  }
  return {
    notaFiscalId: id,
    tipo: TIPO_EVENTO_CANCELAMENTO,
    sequencia: SEQUENCIA_CANCELAMENTO_NFCE,
  }
}

export function mesmaIdentidadeEvento(
  a: { notaFiscalId: string; tipo: string; sequencia: number },
  b: { notaFiscalId: string; tipo: string; sequencia: number },
): boolean {
  return a.notaFiscalId === b.notaFiscalId && a.tipo === b.tipo && a.sequencia === b.sequencia
}
