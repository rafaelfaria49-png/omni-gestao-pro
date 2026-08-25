/**
 * Prazo oficial de cancelamento NFC-e modelo 65 em SP.
 *
 * Fonte: Portaria CAT 12/2015 art. 14 (redação CAT-83/18), consolidada em
 * `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md` Q-05 — 30 minutos contados da
 * Autorização de Uso. Cancelamento extemporâneo (SIPET) NÃO é webservice.
 */
export const NFCE_CANCELAMENTO_PRAZO_MS = 30 * 60 * 1000

export type PrazoCancelamentoNfce =
  | { ok: true; restanteMs: number; limiteEm: Date }
  | {
      ok: false
      code: "prazo_vencido" | "autorizacao_sem_data"
      mensagem: string
      limiteEm: Date | null
    }

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Janela de cancelamento fiscal NFC-e SP: 30 minutos a partir de `dataAutorizacao`.
 * Pura — sem Prisma, sem SEFAZ.
 */
export function avaliarPrazoCancelamentoNfce(input: {
  dataAutorizacao: Date | string | null | undefined
  agora?: Date | string | number
}): PrazoCancelamentoNfce {
  const autorizacao = asDate(input.dataAutorizacao)
  if (!autorizacao) {
    return {
      ok: false,
      code: "autorizacao_sem_data",
      mensagem:
        "Cancelamento fiscal bloqueado: a nota autorizada não possui data de Autorização de Uso.",
      limiteEm: null,
    }
  }
  const agora =
    input.agora instanceof Date
      ? input.agora
      : input.agora == null
        ? new Date()
        : new Date(input.agora)
  const limiteEm = new Date(autorizacao.getTime() + NFCE_CANCELAMENTO_PRAZO_MS)
  const restanteMs = limiteEm.getTime() - agora.getTime()
  if (restanteMs <= 0) {
    return {
      ok: false,
      code: "prazo_vencido",
      mensagem:
        "Cancelamento fiscal fora do prazo de 30 minutos da Autorização de Uso (Portaria CAT 12/2015 art. 14). " +
        "Após esse prazo o cancelamento não é webservice — oriente o processo administrativo SIPET.",
      limiteEm,
    }
  }
  return { ok: true, restanteMs, limiteEm }
}
