/** Limite de unidades (multiloja) por plano de assinatura. */
export function maxLojasPermitidas(plano: string): number {
  if (plano === "ouro") return 5
  if (plano === "prata") return 2
  return 1
}
