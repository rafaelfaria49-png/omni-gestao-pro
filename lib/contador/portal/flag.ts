/**
 * Contador HUB · Portal externo read-only — flag de rollout (GOAL 015).
 *
 * Padrão das flags do HUB: função pura sobre `process.env` com default seguro.
 * DEFAULT OFF — o portal v2 só responde quando `CONTADOR_PORTAL_V2=on`.
 */
export const ENV_PORTAL_EXTERNO_V2 = "CONTADOR_PORTAL_V2" as const

/** `true` somente com o valor exato "on" (case-insensitive, trim). Ausente = off. */
export function portalExternoV2Habilitado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[ENV_PORTAL_EXTERNO_V2] ?? "off").trim().toLowerCase() === "on"
}
