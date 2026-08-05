import "server-only"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/scripts/migration-authority-guard.mjs"

/**
 * Identidade de deployment compartilhada, server-only (GOAL 002C-0).
 *
 * FONTE ÚNICA do ID canônico: `scripts/migration-authority-guard.mjs`, publicado e
 * validado pelo guard de migrations. Este módulo **reexporta** a constante — não a
 * copia — para que código de aplicação possa reconhecer o projeto canônico sem
 * duplicar o valor e sem alterar o guard.
 *
 * O guard permanece intacto: nenhuma linha dele foi modificada por este GOAL, e a
 * dependência é unidirecional (app → guard). O guard continua sendo a autoridade
 * fail-closed de `prisma migrate deploy`; este módulo não participa dessa decisão.
 *
 * O ID nunca é emitido em log, telemetria, resposta HTTP ou mensagem de erro.
 */

export { CANONICAL_VERCEL_PROJECT_ID }

/** Os únicos valores que a Vercel produz em `VERCEL_ENV`. */
export const KNOWN_VERCEL_ENVIRONMENTS = Object.freeze([
  "production",
  "preview",
  "development",
] as const)

export type KnownVercelEnvironment = (typeof KNOWN_VERCEL_ENVIRONMENTS)[number]

export function isKnownVercelEnvironment(value: unknown): value is KnownVercelEnvironment {
  return (
    typeof value === "string" &&
    (KNOWN_VERCEL_ENVIRONMENTS as readonly string[]).includes(value)
  )
}

/** Comparação exata: nada de `trim`, case-fold ou prefixo. */
export function isProductionVercelEnvironment(value: unknown): boolean {
  return value === "production"
}

/**
 * Comparação exata contra o projeto canônico. Ausência, string vazia, projeto
 * legado e qualquer terceiro projeto devolvem `false`.
 */
export function isCanonicalVercelProject(projectId: unknown): boolean {
  return typeof projectId === "string" && projectId === CANONICAL_VERCEL_PROJECT_ID
}
