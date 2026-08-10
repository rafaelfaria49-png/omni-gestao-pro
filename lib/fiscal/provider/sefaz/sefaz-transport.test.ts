/**
 * GOAL-016D-A — transporte injetável e o default que recusa tudo.
 */
import { describe, expect, it } from "vitest"
import { selectSefazEndpoint } from "./sefaz-endpoint-catalog"
import {
  SefazOfflineRefusingTransport,
  sefazOfflineRefusingTransport,
} from "./sefaz-transport.types"

function endpointHomologacao() {
  const r = selectSefazEndpoint({
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeStatusServico4",
  })
  if (!r.ok) throw new Error("catálogo deveria resolver homologação")
  return r.endpoint
}

describe("transporte offline default", () => {
  const request = {
    endpoint: endpointHomologacao(),
    contentType: "application/soap+xml; charset=utf-8",
    bodyBytes: new TextEncoder().encode("<envelope/>"),
    correlationId: "corr-1",
    certificate: {
      storeId: "store-piloto",
      blobRef: "FISCAL_A1_PFX_B64_STORE_PILOTO",
      senhaRef: "FISCAL_A1_SENHA_STORE_PILOTO",
    },
    connectionTimeoutMs: 15_000,
    totalDeadlineMs: 60_000,
  }

  it("declara que não permite rede", () => {
    expect(sefazOfflineRefusingTransport.permiteRede).toBe(false)
    expect(new SefazOfflineRefusingTransport().permiteRede).toBe(false)
  })

  it("recusa QUALQUER chamada, com código estável e sem tentativa externa", async () => {
    const outcome = await sefazOfflineRefusingTransport.send(request)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("transporte offline não pode devolver sucesso")
    expect(outcome.codigo).toBe("transporte_offline_bloqueado")
    expect(outcome.externalTransmissionAttempted).toBe(false)
  })

  it("recusa de forma determinística, inclusive em chamadas repetidas", async () => {
    for (let i = 0; i < 5; i += 1) {
      const outcome = await sefazOfflineRefusingTransport.send(request)
      expect(outcome.ok).toBe(false)
      expect(outcome.externalTransmissionAttempted).toBe(false)
    }
  })

  it("nunca devolve corpo de resposta, cStat ou protocolo", async () => {
    const outcome = await sefazOfflineRefusingTransport.send(request)
    expect(Object.keys(outcome).sort()).toEqual(
      ["classification", "codigo", "externalTransmissionAttempted", "mensagem", "ok"].sort(),
    )
  })
})
