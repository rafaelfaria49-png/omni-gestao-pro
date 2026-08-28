import { describe, expect, it } from "vitest"
import {
  CSTAT_CANCELAMENTO_HOMOLOGADO,
  CSTAT_DUPLICIDADE_EVENTO,
  CSTAT_EVENTO_REGISTRADO,
  interpretarCStatCancelamento,
  isCancelamentoFiscalAutorizado,
  vereditoPersistenciaCancelamento,
} from "./cstat-cancelamento"

describe("cStat cancelamento NFeRecepcaoEvento4", () => {
  it("somente 135 autoriza o evento", () => {
    expect(isCancelamentoFiscalAutorizado("135")).toBe(true)
    expect(isCancelamentoFiscalAutorizado(CSTAT_EVENTO_REGISTRADO)).toBe(true)
    expect(isCancelamentoFiscalAutorizado("101")).toBe(false)
    expect(isCancelamentoFiscalAutorizado(CSTAT_CANCELAMENTO_HOMOLOGADO)).toBe(false)
    expect(interpretarCStatCancelamento("135")).toEqual({ desfecho: "autorizado", cStat: "135" })
    expect(interpretarCStatCancelamento("101")).toEqual({ desfecho: "rejeitado", cStat: "101" })
    expect(interpretarCStatCancelamento("573")).toEqual({
      desfecho: "duplicidade",
      cStat: CSTAT_DUPLICIDADE_EVENTO,
    })
  })

  it("veredito recusa simulado mesmo com cStat 135", () => {
    const r = vereditoPersistenciaCancelamento({
      simulado: true,
      ok: true,
      dados: { cStat: "135" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("resposta_simulada")
  })

  it("veredito persiste somente 135 não simulado", () => {
    expect(
      vereditoPersistenciaCancelamento({ simulado: false, ok: true, dados: { cStat: "135" } }),
    ).toEqual({ ok: true, cStat: "135" })
    const centoUm = vereditoPersistenciaCancelamento({
      simulado: false,
      ok: true,
      dados: { cStat: "101" },
    })
    expect(centoUm.ok).toBe(false)
  })

  it("timeout/incerto e rejeição não autorizam persistência", () => {
    const timeout = vereditoPersistenciaCancelamento({ simulado: false, ok: false, dados: null })
    expect(timeout.ok).toBe(false)
    if (!timeout.ok) expect(timeout.code).toBe("fiscal_cancelamento_incerto")

    const rejeicao = vereditoPersistenciaCancelamento({
      simulado: false,
      ok: false,
      dados: { cStat: "218" },
    })
    expect(rejeicao.ok).toBe(false)
    if (!rejeicao.ok) expect(rejeicao.code).toBe("fiscal_cancelamento_rejeitado")
  })

  it("573 sem autorização local é divergência incerta — não autoriza nem encerra como rejeição", () => {
    const r = vereditoPersistenciaCancelamento({
      simulado: false,
      ok: false,
      dados: { cStat: "573" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("evento_duplicado_sem_autorizacao_local")
      expect(r.mensagem).toMatch(/consulte o protocolo/i)
    }
  })
})
