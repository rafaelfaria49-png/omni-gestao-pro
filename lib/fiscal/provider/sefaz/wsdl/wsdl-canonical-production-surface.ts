/**
 * Superfície canônica permanente da aquisição WSDL externa.
 *
 * A execução real só é possível no Production do projeto omni-gestao-pro, no host
 * `omni-gestao-pro.vercel.app`. Duas provas independentes, ambas obrigatórias:
 *
 * 1. Identidade do request: hostname de `request.url` === host canônico, HTTPS, sem
 *    userinfo e só na porta 443. Query, header e body do caller não entram aqui.
 * 2. Identidade do runtime Vercel já usada no repositório: `VERCEL_ENV === "production"`
 *    e `VERCEL_PROJECT_ID` igual ao projeto canônico.
 *
 * Nenhuma prova sozinha basta. Ausência, Preview, URL única, projeto legado,
 * localhost e qualquer identidade incompleta recusam. Não existe flag operacional
 * fiscal para ligar ou desligar esta barreira.
 */
import {
  isCanonicalVercelProject,
  isKnownVercelEnvironment,
  isProductionVercelEnvironment,
} from "@/lib/deploy/canonical-deployment"

export const WSDL_CANONICAL_PRODUCTION_HOST = "omni-gestao-pro.vercel.app" as const

export type WsdlCanonicalProductionSurfaceInput = {
  readonly requestUrl: string
  readonly vercelEnv: unknown
  readonly vercelProjectId: unknown
}

export const WSDL_CANONICAL_PRODUCTION_SURFACE_REASON = Object.freeze({
  REQUEST_IDENTITY_UNPROVEN: "request-identity-unproven",
  REQUEST_HOST_NOT_CANONICAL: "request-host-not-canonical",
  RUNTIME_IDENTITY_UNPROVEN: "runtime-identity-unproven",
  RUNTIME_NOT_PRODUCTION: "runtime-not-production",
  RUNTIME_PROJECT_NOT_CANONICAL: "runtime-project-not-canonical",
  ALLOWED: "allowed",
} as const)

export type WsdlCanonicalProductionSurfaceReason =
  (typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON)[keyof typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON]

export type WsdlCanonicalProductionSurfaceDecision =
  | { readonly allowed: true; readonly reason: typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED }
  | {
      readonly allowed: false
      readonly reason: Exclude<
        WsdlCanonicalProductionSurfaceReason,
        typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED
      >
    }

function decision(
  allowed: true,
  reason: typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED,
): WsdlCanonicalProductionSurfaceDecision
function decision(
  allowed: false,
  reason: Exclude<
    WsdlCanonicalProductionSurfaceReason,
    typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED
  >,
): WsdlCanonicalProductionSurfaceDecision
function decision(
  allowed: boolean,
  reason: WsdlCanonicalProductionSurfaceReason,
): WsdlCanonicalProductionSurfaceDecision {
  return Object.freeze({ allowed, reason }) as WsdlCanonicalProductionSurfaceDecision
}

function inspectRequestIdentity(
  requestUrl: string,
):
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN
        | typeof WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_HOST_NOT_CANONICAL
    } {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return { ok: false, reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN }
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.port !== "" && parsed.port !== "443")
  ) {
    return { ok: false, reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN }
  }
  if (parsed.hostname !== WSDL_CANONICAL_PRODUCTION_HOST) {
    return { ok: false, reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_HOST_NOT_CANONICAL }
  }
  return { ok: true }
}

/**
 * Avalia somente identidade de request + runtime. Função total: qualquer entrada
 * devolve uma decisão. Não consulta o ambiente do processo, header, query nem body.
 */
export function evaluateWsdlCanonicalProductionSurface(
  input: WsdlCanonicalProductionSurfaceInput,
): WsdlCanonicalProductionSurfaceDecision {
  const requestIdentity = inspectRequestIdentity(input.requestUrl)
  if (!requestIdentity.ok) return decision(false, requestIdentity.reason)

  const vercelEnv = input.vercelEnv
  const projectId = input.vercelProjectId
  if (vercelEnv === undefined || vercelEnv === null || vercelEnv === "") {
    return decision(false, WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
  }
  if (!isKnownVercelEnvironment(vercelEnv) || !isProductionVercelEnvironment(vercelEnv)) {
    return decision(false, WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_NOT_PRODUCTION)
  }
  if (projectId === undefined || projectId === null || projectId === "") {
    return decision(false, WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
  }
  if (!isCanonicalVercelProject(projectId)) {
    return decision(false, WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_PROJECT_NOT_CANONICAL)
  }

  return decision(true, WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED)
}

export function isWsdlCanonicalProductionSurface(
  input: WsdlCanonicalProductionSurfaceInput,
): boolean {
  return evaluateWsdlCanonicalProductionSurface(input).allowed
}
