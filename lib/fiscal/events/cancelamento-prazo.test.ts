import { describe, expect, it } from "vitest"
import {
  NFCE_CANCELAMENTO_PRAZO_MS,
  avaliarPrazoCancelamentoNfce,
} from "./cancelamento-prazo"

describe("prazo cancelamento NFC-e SP (30 min)", () => {
  it("permite dentro de 30 minutos da Autorização de Uso", () => {
    const autorizacao = new Date("2026-08-25T12:00:00.000Z")
    const r = avaliarPrazoCancelamentoNfce({
      dataAutorizacao: autorizacao,
      agora: new Date("2026-08-25T12:29:59.000Z"),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.restanteMs).toBeGreaterThan(0)
      expect(r.limiteEm.getTime()).toBe(autorizacao.getTime() + NFCE_CANCELAMENTO_PRAZO_MS)
    }
  })

  it("bloqueia após 30 minutos com mensagem oficial", () => {
    const r = avaliarPrazoCancelamentoNfce({
      dataAutorizacao: "2026-08-25T12:00:00.000Z",
      agora: "2026-08-25T12:30:00.000Z",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("prazo_vencido")
      expect(r.mensagem).toMatch(/30 minutos/i)
      expect(r.mensagem).toMatch(/SIPET/)
      expect(r.mensagem).not.toMatch(/CAT 12\/2015/)
    }
  })

  it("bloqueia sem data de autorização", () => {
    const r = avaliarPrazoCancelamentoNfce({ dataAutorizacao: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("autorizacao_sem_data")
  })
})
