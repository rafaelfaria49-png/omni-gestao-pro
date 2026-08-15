import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { CANONICAL_VERCEL_PROJECT_ID } from "@/lib/deploy/canonical-deployment"

import {
  evaluateWsdlCanonicalProductionSurface,
  isWsdlCanonicalProductionSurface,
  WSDL_CANONICAL_PRODUCTION_HOST,
  WSDL_CANONICAL_PRODUCTION_SURFACE_REASON,
  type WsdlCanonicalProductionSurfaceInput,
} from "./wsdl-canonical-production-surface"

const CANONICAL_URL = `https://${WSDL_CANONICAL_PRODUCTION_HOST}/api/fiscal/wsdl/ephemeral-execution?storeId=loja-1`
const PREVIEW_URL =
  "https://omni-gestao-pro-git-goal-wsdl-preview-team.vercel.app/api/fiscal/wsdl/ephemeral-execution?storeId=loja-1"
const UNIQUE_DEPLOYMENT_URL =
  "https://omni-gestao-pro-8b84c7cad369cf62-team.vercel.app/api/fiscal/wsdl/ephemeral-execution?storeId=loja-1"
const LEGACY_HOST_URL =
  "https://omni-gestao-pi.vercel.app/api/fiscal/wsdl/ephemeral-execution?storeId=loja-1"
const LOCAL_URL = "http://localhost/api/fiscal/wsdl/ephemeral-execution?storeId=loja-1"

const LEGACY_PROJECT_ID = "prj_legacy_test_fixture"
const THIRD_PROJECT_ID = "prj_terceiro_test_fixture"
const here = dirname(fileURLToPath(import.meta.url))

const CANONICAL: WsdlCanonicalProductionSurfaceInput = {
  requestUrl: CANONICAL_URL,
  vercelEnv: "production",
  vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
}

describe("superfície canônica WSDL — Production", () => {
  it("só o Production canônico no host alias é permitido", () => {
    expect(evaluateWsdlCanonicalProductionSurface(CANONICAL)).toEqual({
      allowed: true,
      reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.ALLOWED,
    })
    expect(isWsdlCanonicalProductionSurface(CANONICAL)).toBe(true)
  })

  it("porta 443 explícita no host canônico continua permitida", () => {
    expect(
      isWsdlCanonicalProductionSurface({
        ...CANONICAL,
        requestUrl: `https://${WSDL_CANONICAL_PRODUCTION_HOST}:443/api/fiscal/wsdl/ephemeral-execution`,
      }),
    ).toBe(true)
  })
})

describe("superfície canônica WSDL — Preview e URL única", () => {
  it("Preview é recusado mesmo com projeto canônico e janela hipotética", () => {
    const decision = evaluateWsdlCanonicalProductionSurface({
      requestUrl: PREVIEW_URL,
      vercelEnv: "preview",
      vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_HOST_NOT_CANONICAL)
  })

  it("Preview com Host/URL canônicos forjados ainda cai no runtime preview", () => {
    const decision = evaluateWsdlCanonicalProductionSurface({
      requestUrl: CANONICAL_URL,
      vercelEnv: "preview",
      vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
    })
    expect(decision).toEqual({
      allowed: false,
      reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_NOT_PRODUCTION,
    })
  })

  it("URL única de deployment é recusada mesmo em production do projeto canônico", () => {
    const decision = evaluateWsdlCanonicalProductionSurface({
      requestUrl: UNIQUE_DEPLOYMENT_URL,
      vercelEnv: "production",
      vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
    })
    expect(decision).toEqual({
      allowed: false,
      reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_HOST_NOT_CANONICAL,
    })
  })
})

describe("superfície canônica WSDL — projeto legado e localhost", () => {
  it("host legado é recusado", () => {
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: LEGACY_HOST_URL,
        vercelEnv: "production",
        vercelProjectId: LEGACY_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_HOST_NOT_CANONICAL)
  })

  it("mesmo com URL canônica, projeto legado não passa", () => {
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "production",
        vercelProjectId: LEGACY_PROJECT_ID,
      }),
    ).toEqual({
      allowed: false,
      reason: WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_PROJECT_NOT_CANONICAL,
    })
  })

  it("terceiro projeto é recusado", () => {
    expect(
      evaluateWsdlCanonicalProductionSurface({
        ...CANONICAL,
        vercelProjectId: THIRD_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_PROJECT_NOT_CANONICAL)
  })

  it("localhost e development são recusados", () => {
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: LOCAL_URL,
        vercelEnv: undefined,
        vercelProjectId: undefined,
      }).allowed,
    ).toBe(false)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: LOCAL_URL,
        vercelEnv: "development",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }),
    ).toMatchObject({ allowed: false })
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: `https://${WSDL_CANONICAL_PRODUCTION_HOST}/api/x`,
        vercelEnv: "development",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_NOT_PRODUCTION)
  })
})

describe("superfície canônica WSDL — identidade incompleta e caller", () => {
  it("ausência de VERCEL_ENV ou de projeto é recusa, não permissão", () => {
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: undefined,
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "production",
        vercelProjectId: undefined,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "production",
        vercelProjectId: "",
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.RUNTIME_IDENTITY_UNPROVEN)
  })

  it("PRODUCTION, production com espaço e ambiente desconhecido não passam", () => {
    for (const ambiente of ["PRODUCTION", "production ", "prod", "staging"]) {
      expect(
        evaluateWsdlCanonicalProductionSurface({
          ...CANONICAL,
          vercelEnv: ambiente,
        }).allowed,
        ambiente,
      ).toBe(false)
    }
  })

  it("query, userinfo, http e porta não padrão não concedem o host canônico", () => {
    expect(
      isWsdlCanonicalProductionSurface({
        ...CANONICAL,
        requestUrl: `${PREVIEW_URL}&host=${WSDL_CANONICAL_PRODUCTION_HOST}`,
      }),
    ).toBe(false)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        ...CANONICAL,
        requestUrl: `https://attacker@${WSDL_CANONICAL_PRODUCTION_HOST}/api/fiscal/wsdl/ephemeral-execution`,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        ...CANONICAL,
        requestUrl: `http://${WSDL_CANONICAL_PRODUCTION_HOST}/api/fiscal/wsdl/ephemeral-execution`,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        ...CANONICAL,
        requestUrl: `https://${WSDL_CANONICAL_PRODUCTION_HOST}:8443/api/fiscal/wsdl/ephemeral-execution`,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN)
    expect(
      evaluateWsdlCanonicalProductionSurface({
        requestUrl: "not-a-url",
        vercelEnv: "production",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }).reason,
    ).toBe(WSDL_CANONICAL_PRODUCTION_SURFACE_REASON.REQUEST_IDENTITY_UNPROVEN)
  })

  it("uma prova sozinha nunca basta", () => {
    expect(
      isWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "preview",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }),
    ).toBe(false)
    expect(
      isWsdlCanonicalProductionSurface({
        requestUrl: PREVIEW_URL,
        vercelEnv: "production",
        vercelProjectId: CANONICAL_VERCEL_PROJECT_ID,
      }),
    ).toBe(false)
    expect(
      isWsdlCanonicalProductionSurface({
        requestUrl: CANONICAL_URL,
        vercelEnv: "production",
        vercelProjectId: LEGACY_PROJECT_ID,
      }),
    ).toBe(false)
  })
})

describe("superfície canônica WSDL — contrato estático", () => {
  it("não introduz flag operacional fiscal nem lê header/query do caller", () => {
    const helper = readFileSync(resolve(here, "wsdl-canonical-production-surface.ts"), "utf8")
    const route = readFileSync(
      resolve(here, "../../../../../app/api/fiscal/wsdl/ephemeral-execution/route.ts"),
      "utf8",
    )
    for (const source of [helper, route]) {
      expect(source).not.toMatch(/FISCAL_[A-Z0-9_]*ENABLE/)
      expect(source).not.toMatch(/WSDL_[A-Z0-9_]*ALLOW/)
      expect(source).not.toContain("x-forwarded-host")
      expect(source).not.toContain("x-canonical-host")
    }
    expect(helper).not.toMatch(/process\.env/)
    expect(route).toContain("request.url")
    expect(route).toContain("process.env.VERCEL_ENV")
    expect(route).toContain("process.env.VERCEL_PROJECT_ID")
  })
})
