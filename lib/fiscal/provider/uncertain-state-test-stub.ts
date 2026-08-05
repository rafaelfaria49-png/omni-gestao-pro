import {
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  type FiscalConsultationResult,
  type FiscalTransmissionResult,
  type UncertainStateFiscalProvider,
} from "../emission/uncertain-state.types"

export type UncertainStateStubOptions = {
  transmission: Array<"AUTHORIZED" | "UNCERTAIN" | "REJECTED">
  consultation: "AUTHORIZED" | "NOT_FOUND" | "REJECTED"
}

/**
 * Stub determinístico exclusivo de testes/drills. Não abre socket, não usa
 * certificado e não representa resposta real da SEFAZ.
 */
export class UncertainStateTestStub implements UncertainStateFiscalProvider {
  /** Rótulo de auditoria — não é o que o autoriza a executar. */
  readonly simulado = true as const
  /**
   * Marca ESTRUTURAL que dispensa a capability de execução externa: este stub responde de
   * arrays em memória e não possui transporte algum. É o que o mantém executando depois que
   * a autorização deixou de derivar de `simulado` (correção 002 · bloqueio 2).
   */
  readonly [IN_MEMORY_ONLY_FISCAL_PROVIDER] = true as const
  readonly transmissions: Array<{
    bytesBase64: string
    bytesSha256: string
    chaveAcesso: string
  }> = []
  readonly consultations: string[] = []
  private transmissionIndex = 0

  constructor(private readonly options: UncertainStateStubOptions) {}

  async transmit(
    input: Parameters<UncertainStateFiscalProvider["transmit"]>[0],
  ): Promise<FiscalTransmissionResult> {
    this.transmissions.push({
      bytesBase64: Buffer.from(input.exactBytes).toString("base64"),
      bytesSha256: input.bytesSha256,
      chaveAcesso: input.document.chaveAcesso,
    })
    const mode =
      this.options.transmission[
        Math.min(this.transmissionIndex, this.options.transmission.length - 1)
      ] ?? "UNCERTAIN"
    this.transmissionIndex += 1
    if (mode === "AUTHORIZED") {
      return {
        outcome: "AUTHORIZED",
        protocolo: "PROTOCOLO-SIMULADO-GOAL012",
        cStat: "100",
        xMotivo: "Autorizado em drill simulado.",
        xmlAutorizado: "<nfeProc simulada=\"true\"/>",
      }
    }
    if (mode === "REJECTED") {
      return {
        outcome: "REJECTED",
        cStat: "999",
        xMotivo: "Rejeição simulada do drill.",
      }
    }
    return {
      outcome: "UNCERTAIN",
      code: "TIMEOUT",
      message: "Timeout simulado após envio dos bytes.",
    }
  }

  async consult(
    input: Parameters<UncertainStateFiscalProvider["consult"]>[0],
  ): Promise<FiscalConsultationResult> {
    this.consultations.push(input.document.chaveAcesso)
    if (this.options.consultation === "AUTHORIZED") {
      return {
        outcome: "AUTHORIZED",
        protocolo: "PROTOCOLO-CONSULTA-SIMULADO-GOAL012",
        cStat: "100",
        xMotivo: "Autorizado localizado em consulta simulada.",
        xmlAutorizado: "<nfeProc consulta=\"simulada\"/>",
      }
    }
    if (this.options.consultation === "REJECTED") {
      return {
        outcome: "REJECTED",
        cStat: "999",
        xMotivo: "Rejeição localizada em consulta simulada.",
      }
    }
    return {
      outcome: "NOT_FOUND",
      cStat: "217",
      xMotivo: "NFC-e não encontrada em consulta simulada.",
    }
  }
}
