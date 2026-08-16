/**
 * GOAL 020A — máquina de estados pura da contingência off-line NFC-e.
 */
import { describe, expect, it } from "vitest"
import { applyContingenciaEvent, evaluateUnknown } from "./state-machine"
import type { ContingenciaDocumentoEstado, ContingenciaEvento } from "./types"

const VALIDAS: Array<[ContingenciaDocumentoEstado, ContingenciaEvento, ContingenciaDocumentoEstado]> = [
  ["PREPARADO", "EMITIR_LOCAL", "EMITIDO_LOCAL"],
  ["PREPARADO", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["EMITIDO_LOCAL", "ENFILEIRAR_TX", "PENDENTE_TX"],
  ["EMITIDO_LOCAL", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["PENDENTE_TX", "INICIAR_TX", "TX_ANDAMENTO"],
  ["PENDENTE_TX", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["TX_ANDAMENTO", "AUTORIZAR", "AUTORIZADO_POST"],
  ["TX_ANDAMENTO", "REJEITAR", "REJEITADO_DEF"],
  ["TX_ANDAMENTO", "PERDER_RESPOSTA", "UNKNOWN"],
  ["TX_ANDAMENTO", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["AUTORIZADO_POST", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["REJEITADO_DEF", "INTERVIR", "INTERVENCAO_MANUAL"],
  ["UNKNOWN", "CONSULTAR", "UNKNOWN"],
  ["UNKNOWN", "DECIDIR_RECONCILIACAO", "INTERVENCAO_MANUAL"],
]

describe("transições válidas", () => {
  it.each(VALIDAS)("%s + %s → %s", (from, event, to) => {
    const r = applyContingenciaEvent(from, event)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.to).toBe(to)
    expect(r.retryAutomatico).toBe(false)
  })

  it("EMITIDO_LOCAL congela exactBytes e proíbe rebuild", () => {
    const r = applyContingenciaEvent("PREPARADO", "EMITIR_LOCAL")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exactBytes.required).toBe(true)
    if (r.exactBytes.required) {
      expect(r.exactBytes.rebuildForbidden).toBe(true)
      expect(r.exactBytes.kind).toBe("EXACT_BYTES")
    }
  })

  it("intervenção antes de emitir localmente não congela exactBytes", () => {
    const r = applyContingenciaEvent("PREPARADO", "INTERVIR")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exactBytes.required).toBe(false)
  })

  it("intervenção depois de EMITIDO_LOCAL preserva exactBytes", () => {
    const r = applyContingenciaEvent("EMITIDO_LOCAL", "INTERVIR")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.exactBytes.required).toBe(true)
    if (r.exactBytes.required) expect(r.exactBytes.rebuildForbidden).toBe(true)
  })
})

describe("transições inválidas", () => {
  it("PREPARADO não inicia transmissão", () => {
    const r = applyContingenciaEvent("PREPARADO", "INICIAR_TX")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("transicao_invalida")
  })

  it("EMITIDO_LOCAL não vai direto a TX_ANDAMENTO", () => {
    const r = applyContingenciaEvent("EMITIDO_LOCAL", "INICIAR_TX")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("transicao_invalida")
  })

  it("PENDENTE_TX não autoriza (ainda não enviou)", () => {
    const r = applyContingenciaEvent("PENDENTE_TX", "AUTORIZAR")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("transicao_invalida")
  })

  it("AUTORIZADO_POST não reabre transmissão", () => {
    const r = applyContingenciaEvent("AUTORIZADO_POST", "INICIAR_TX")
    expect(r.ok).toBe(false)
  })

  it("INTERVENCAO_MANUAL é terminal", () => {
    for (const event of ["EMITIR_LOCAL", "INICIAR_TX", "CONSULTAR", "INTERVIR"] as const) {
      const r = applyContingenciaEvent("INTERVENCAO_MANUAL", event)
      expect(r.ok, event).toBe(false)
    }
  })

  it("REJEITADO_DEF não reemite automaticamente", () => {
    const r = applyContingenciaEvent("REJEITADO_DEF", "EMITIR_LOCAL")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAutomatico).toBe(false)
  })
})

describe("UNKNOWN fail-closed", () => {
  it("não retorna retryAutomatico=true", () => {
    const u = evaluateUnknown()
    expect(u.retryAutomatico).toBe(false)
    const consulta = applyContingenciaEvent("UNKNOWN", "CONSULTAR")
    expect(consulta.ok).toBe(true)
    if (consulta.ok) expect(consulta.retryAutomatico).toBe(false)
  })

  it("não volta diretamente para TX_ANDAMENTO", () => {
    // Mutation probe (UNKNOWN → TX_ANDAMENTO no grafo + guard removido): este teste falhou
    // com `expected true to be false`; probe revertido antes do commit.
    const r = applyContingenciaEvent("UNKNOWN", "INICIAR_TX")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("unknown_nao_retorna_tx_andamento")
      expect(r.retryAutomatico).toBe(false)
      expect(r.autorizaNovaEmissaoAutomatica).toBe(false)
      expect(r.reconcilicao?.kind).toBe("RECONCILIATION_REQUIRED")
    }
  })

  it("não autoriza nova emissão automática", () => {
    const r = applyContingenciaEvent("UNKNOWN", "EMITIR_LOCAL")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("unknown_nao_autoriza_emissao")
      expect(r.retryAutomatico).toBe(false)
    }
  })

  it("só sai por decisão explícita de reconciliação (INTERVENCAO_MANUAL / 020D)", () => {
    const r = applyContingenciaEvent("UNKNOWN", "DECIDIR_RECONCILIACAO")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.to).toBe("INTERVENCAO_MANUAL")
      expect(r.retryAutomatico).toBe(false)
    }
  })

  it("INTERVIR não é atalho de saída de UNKNOWN — exige reconciliação explícita", () => {
    const r = applyContingenciaEvent("UNKNOWN", "INTERVIR")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("unknown_requer_reconciliacao")
      expect(r.retryAutomatico).toBe(false)
      expect(r.reconcilicao?.kind).toBe("RECONCILIATION_REQUIRED")
    }
  })
})
