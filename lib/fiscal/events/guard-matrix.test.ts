import { describe, expect, it } from "vitest"
import { FiscalStatusVenda, StatusNotaFiscal } from "@/generated/prisma"
import { avaliarGuardiaCancelamentoFiscal } from "./guard-matrix"

describe("matriz canônica de cancelamento fiscal", () => {
  it("NAO_FISCAL → regras comerciais normais", () => {
    const r = avaliarGuardiaCancelamentoFiscal({ vendaFiscalStatus: FiscalStatusVenda.NAO_FISCAL })
    expect(r.acao).toBe("permitir_comercial")
    expect(r.ok).toBe(true)
  })

  it("PENDENTE/RASCUNHO/VALIDANDO → abortar solicitação fiscal", () => {
    expect(
      avaliarGuardiaCancelamentoFiscal({ vendaFiscalStatus: FiscalStatusVenda.PENDENTE }).acao,
    ).toBe("abortar_solicitacao")
    expect(
      avaliarGuardiaCancelamentoFiscal({ notaStatus: StatusNotaFiscal.RASCUNHO }).acao,
    ).toBe("abortar_solicitacao")
    expect(
      avaliarGuardiaCancelamentoFiscal({ notaStatus: StatusNotaFiscal.VALIDANDO }).acao,
    ).toBe("abortar_solicitacao")
  })

  it("TRANSMITINDO/INCERTO/EMITINDO bloqueiam até consulta", () => {
    for (const input of [
      { notaStatus: StatusNotaFiscal.TRANSMITINDO },
      { vendaFiscalStatus: FiscalStatusVenda.EMITINDO },
      { vendaFiscalStatus: FiscalStatusVenda.AUTORIZADA, notaStatus: StatusNotaFiscal.AUTORIZADA, incerto: true },
    ]) {
      const r = avaliarGuardiaCancelamentoFiscal(input)
      expect(r.acao).toBe("bloquear_incerto")
      expect(r.ok).toBe(false)
      expect(r.code).toBe("fiscal_bloqueio_incerto")
    }
  })

  it("AUTORIZADA dentro do prazo → cancelar_fiscal", () => {
    const r = avaliarGuardiaCancelamentoFiscal({
      vendaFiscalStatus: FiscalStatusVenda.AUTORIZADA,
      notaStatus: StatusNotaFiscal.AUTORIZADA,
      dataAutorizacao: new Date(),
      agora: new Date(),
    })
    expect(r.acao).toBe("cancelar_fiscal")
    expect(r.ok).toBe(true)
  })

  it("AUTORIZADA fora do prazo → bloqueio explicado", () => {
    const r = avaliarGuardiaCancelamentoFiscal({
      vendaFiscalStatus: FiscalStatusVenda.AUTORIZADA,
      notaStatus: StatusNotaFiscal.AUTORIZADA,
      dataAutorizacao: new Date("2026-01-01T00:00:00Z"),
      agora: new Date("2026-01-01T01:00:00Z"),
    })
    expect(r.acao).toBe("bloquear_prazo")
    expect(r.code).toBe("fiscal_prazo_vencido")
    expect(r.mensagem).toMatch(/30 minutos/)
  })

  it("REJEITADA → correção comercial; número reservado para inutilização", () => {
    const r = avaliarGuardiaCancelamentoFiscal({
      vendaFiscalStatus: FiscalStatusVenda.REJEITADA,
      notaStatus: StatusNotaFiscal.REJEITADA,
    })
    expect(r.acao).toBe("permitir_correcao_comercial")
    expect(r.ok).toBe(true)
    expect(r.mensagem).toMatch(/inutiliza/i)
  })

  it("CANCELADA/DENEGADA/INUTILIZADA são terminais imutáveis", () => {
    for (const notaStatus of [
      StatusNotaFiscal.CANCELADA,
      StatusNotaFiscal.DENEGADA,
      StatusNotaFiscal.INUTILIZADA,
    ]) {
      const r = avaliarGuardiaCancelamentoFiscal({ notaStatus })
      expect(r.acao).toBe("imutavel_terminal")
      expect(r.ok).toBe(false)
    }
  })
})
