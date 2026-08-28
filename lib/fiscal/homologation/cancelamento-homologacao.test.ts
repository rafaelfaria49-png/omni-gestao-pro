import { describe, expect, it } from "vitest"
import { avaliarGateHomologacaoCancelamentoFrom } from "./homologation-gate"

describe("gate de homologação do cancelamento fiscal", () => {
  it("janela vigente autoriza o caminho interno", () => {
    const r = avaliarGateHomologacaoCancelamentoFrom(
      {
        activationId: "wsdl-test",
        notBeforeUtc: "2026-08-25T00:00:00Z",
        expiresAtUtc: "2026-08-25T00:10:00Z",
      },
      new Date("2026-08-25T00:05:00Z"),
    )
    expect(r.disponivel).toBe(true)
  })

  it("janela expirada ou nula não fabrica execução SEFAZ", () => {
    const nula = avaliarGateHomologacaoCancelamentoFrom({
      activationId: null,
      notBeforeUtc: null,
      expiresAtUtc: null,
    })
    expect(nula.disponivel).toBe(false)

    const expirada = avaliarGateHomologacaoCancelamentoFrom(
      {
        activationId: "wsdl-h9h10-20260824-1800z-8cd1649df764940e",
        notBeforeUtc: "2026-08-24T18:00:00Z",
        expiresAtUtc: "2026-08-24T18:10:00Z",
      },
      new Date("2026-08-25T12:00:00Z"),
    )
    expect(expirada.disponivel).toBe(false)
    expect(expirada.motivo).toMatch(/inativa|dormente/i)
  })
})
