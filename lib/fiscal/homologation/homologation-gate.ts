export type WsdlExecutionWindowLite = {
  activationId: string | null
  notBeforeUtc: string | null
  expiresAtUtc: string | null
}

export type HomologacaoCancelamentoGate = {
  disponivel: boolean
  activationId: string | null
  notBeforeUtc: string | null
  expiresAtUtc: string | null
  motivo: string
}

export function avaliarGateHomologacaoCancelamentoFrom(
  w: WsdlExecutionWindowLite,
  agora: Date = new Date(),
): HomologacaoCancelamentoGate {
  const base = {
    activationId: w.activationId,
    notBeforeUtc: w.notBeforeUtc,
    expiresAtUtc: w.expiresAtUtc,
  }
  if (!w.activationId || !w.notBeforeUtc || !w.expiresAtUtc) {
    return {
      ...base,
      disponivel: false,
      motivo: "Janela H-9/H-10 dormente (activationId/notBefore/expiresAt nulos).",
    }
  }
  const ini = new Date(w.notBeforeUtc)
  const fim = new Date(w.expiresAtUtc)
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime()) || agora < ini || agora >= fim) {
    return {
      ...base,
      disponivel: false,
      motivo: `Janela H-9/H-10 inativa (notBefore=${w.notBeforeUtc} expiresAt=${w.expiresAtUtc}).`,
    }
  }
  return { ...base, disponivel: true, motivo: "Janela H-9/H-10 vigente." }
}
