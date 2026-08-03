/**
 * GOAL CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — flag `CONTADOR_PORTAL_V2`.
 * Default OFF; só "on" habilita. Sem depender da ordem/estado do env do ambiente:
 * cada teste força e limpa `process.env`.
 */
import { afterEach, describe, expect, it } from "vitest"
import { ENV_PORTAL_EXTERNO_V2, portalExternoV2Habilitado } from "../flag"

const GUARDADO = process.env[ENV_PORTAL_EXTERNO_V2]

afterEach(() => {
  if (GUARDADO === undefined) delete process.env[ENV_PORTAL_EXTERNO_V2]
  else process.env[ENV_PORTAL_EXTERNO_V2] = GUARDADO
})

describe("portalExternoV2Habilitado", () => {
  it("default OFF: variável ausente desabilita", () => {
    delete process.env[ENV_PORTAL_EXTERNO_V2]
    expect(portalExternoV2Habilitado()).toBe(false)
    expect(portalExternoV2Habilitado({})).toBe(false)
  })

  it('"on" habilita (case-insensitive, com trim)', () => {
    process.env[ENV_PORTAL_EXTERNO_V2] = "on"
    expect(portalExternoV2Habilitado()).toBe(true)
    expect(portalExternoV2Habilitado({ [ENV_PORTAL_EXTERNO_V2]: " ON " })).toBe(true)
  })

  it('qualquer outro valor ("off", "1", "true") desabilita', () => {
    for (const valor of ["off", "1", "true", "yes", ""]) {
      expect(portalExternoV2Habilitado({ [ENV_PORTAL_EXTERNO_V2]: valor })).toBe(false)
    }
  })
})
