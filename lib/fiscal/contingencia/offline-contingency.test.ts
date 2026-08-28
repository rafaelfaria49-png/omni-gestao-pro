import { describe, expect, it, vi } from "vitest"
import { dryRunSnapshot } from "../dry-run"
import { buildNfceXmlAssinavelResult } from "../xml"
import {
  IN_MEMORY_ONLY_FISCAL_PROVIDER,
  transmitWithUncertainStateSafety,
  type PersistedFiscalDocument,
} from "../emission"
import {
  AUTO_CONTINGENCY_ENABLED,
  calculateOfflineTransmissionDeadline,
  enterManualOfflineContingency,
  fiscalBytesSha256,
  offlineContingencyAlarm,
  type OfflineContingencyPersistence,
} from "./offline-contingency"

const locator = { storeId: "loja-a", vendaId: "venda-a", notaFiscalId: "nota-a" }
const XML = "<NFe><infNFe><ide><tpEmis>9</tpEmis><dhCont>2026-08-28T10:00:00-03:00</dhCont><xJust>Falha de comunicação com a SEFAZ</xJust></ide></infNFe></NFe>"

function persistence(existing: Awaited<ReturnType<OfflineContingencyPersistence["loadExisting"]>> = null) {
  const state = { existing }
  const out: OfflineContingencyPersistence = {
    loadExisting: vi.fn(async () => state.existing),
    setMetadata: vi.fn(async () => true),
    persist: vi.fn(async ({ document }) => {
      state.existing = {
        status: "CONTINGENCIA",
        xmlAssinado: document.xmlAssinado,
        bytesSha256: fiscalBytesSha256(new TextEncoder().encode(document.xmlAssinado)),
        dataContingencia: "2026-08-28T13:00:00.000Z",
        justContingencia: "Falha de comunicação com a SEFAZ",
      }
      return { idempotent: false }
    }),
    enqueue: vi.fn(async () => ({ jobId: "job-contingencia", created: true })),
    audit: vi.fn(async () => undefined),
  }
  return out
}

const preparer = { prepare: vi.fn(async () => ({
  ...locator,
  modelo: "NFCE" as const,
  ambiente: "HOMOLOGACAO" as const,
  serie: 1,
  numero: 42,
  chaveAcesso: "1".repeat(44),
  xmlAssinado: XML,
})) }

describe("GOAL 020 — contingência offline manual", () => {
  it("calcula o fim do primeiro dia útil seguinte, respeitando calendário injetado", () => {
    const deadline = calculateOfflineTransmissionDeadline(
      "2026-08-28T10:00:00Z",
      (date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && date.getUTCDate() !== 31,
    )
    expect(deadline.toISOString()).toBe("2026-09-01T23:59:59.999Z")
  })

  it("mantém fallback automático desligado e classifica alarmes por prazo", () => {
    expect(AUTO_CONTINGENCY_ENABLED).toBe(false)
    const deadline = new Date("2026-08-31T23:59:59.999Z")
    expect(offlineContingencyAlarm(new Date("2026-08-28T10:00:00Z"), deadline)).toBe("SAFE")
    expect(offlineContingencyAlarm(new Date("2026-08-31T22:30:00Z"), deadline)).toBe("APPROACHING")
    expect(offlineContingencyAlarm(new Date("2026-09-01T00:00:00Z"), deadline)).toBe("EXPIRED")
  })

  it("serializa dhCont/xJust no ide oficial quando o contexto é tpEmis=9", () => {
    const built = buildNfceXmlAssinavelResult(dryRunSnapshot("simples"), {
      serie: 1,
      numero: 42,
      tpEmis: 9,
      dhCont: "2026-08-28T13:00:00Z",
      xJust: "Falha de comunicação com a SEFAZ",
    })
    expect(built.xml).toMatch(/<tpEmis>9<\/tpEmis>[\s\S]*<dhCont>[^<]+<\/dhCont>[\s\S]*<xJust>Falha de comunicação com a SEFAZ<\/xJust>/)
  })

  it("exige entrada manual, loja habilitada, SEFAZ_DIRETO e HOMOLOGACAO", async () => {
    const base = {
      ...locator,
      operador: "admin@teste",
      manualConfirmation: false,
      fiscalEnabled: true,
      ambiente: "HOMOLOGACAO",
      provider: "SEFAZ_DIRETO",
      xJust: "Falha de comunicação com a SEFAZ",
    }
    const result = await enterManualOfflineContingency(base, { preparer, persistence: persistence() })
    expect(result).toMatchObject({ ok: false, code: "entrada_invalida" })
    expect(preparer.prepare).not.toHaveBeenCalled()
  })

  it("persiste o XML assinado uma vez e enfileira por dedupe sem recriação", async () => {
    const store = persistence()
    const result = await enterManualOfflineContingency(
      {
        ...locator,
        operador: "admin@teste",
        manualConfirmation: true,
        fiscalEnabled: true,
        ambiente: "HOMOLOGACAO",
        provider: "SEFAZ_DIRETO",
        dhCont: "2026-08-28T13:00:00Z",
        emissaoAt: "2026-08-28T12:00:00Z",
        xJust: "Falha de comunicação com a SEFAZ",
        now: new Date("2026-08-28T13:00:00Z"),
      },
      { preparer, persistence: store },
    )
    expect(result).toMatchObject({ ok: true, tpEmis: 9, jobId: "job-contingencia", idempotent: false })
    expect(store.persist).toHaveBeenCalledTimes(1)
    expect(store.enqueue).toHaveBeenCalledTimes(1)
    expect(store.audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ autoContingency: false, bytesSha256: fiscalBytesSha256(new TextEncoder().encode(XML)) }),
    }))
    expect((store.persist as ReturnType<typeof vi.fn>).mock.calls[0][0].document.xmlAssinado).toBe(XML)
  })

  it("recusa produção e justificativa fora do intervalo", async () => {
    const result = await enterManualOfflineContingency(
      {
        ...locator,
        operador: "admin",
        manualConfirmation: true,
        fiscalEnabled: true,
        ambiente: "PRODUCAO",
        provider: "SEFAZ_DIRETO",
        xJust: "curta",
      },
      { preparer, persistence: persistence() },
    )
    expect(result).toMatchObject({ ok: false, code: "entrada_invalida" })
  })

  it("transmite posteriormente os mesmos bytes persistidos, sem chamar o preparer", async () => {
    const bytes = new TextEncoder().encode(XML)
    let current: PersistedFiscalDocument = {
      ...locator,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 1,
      numero: 42,
      chaveAcesso: "1".repeat(44),
      status: "CONTINGENCIA",
      xmlAssinado: XML,
      xmlBytesSha256: fiscalBytesSha256(bytes),
    }
    const transmitted: Uint8Array[] = []
    const prepare = vi.fn()
    const provider = {
      simulado: false,
      [IN_MEMORY_ONLY_FISCAL_PROVIDER]: true as const,
      transmit: vi.fn(async ({ exactBytes }: { exactBytes: Uint8Array }) => {
        transmitted.push(exactBytes)
        return { outcome: "AUTHORIZED" as const, protocolo: "p-1", cStat: "100", xMotivo: "ok", xmlAutorizado: "<nfeProc/>" }
      }),
      consult: vi.fn(),
    }
    const persistence = {
      load: vi.fn(async () => current),
      persistBeforeTransmission: vi.fn(),
      beginTransmission: vi.fn(async ({ document }: { document: PersistedFiscalDocument }) => {
        current = { ...document, status: "TRANSMITINDO" }
        return current
      }),
      markAuthorized: vi.fn(async () => undefined),
      markRejected: vi.fn(async () => undefined),
      recordUncertainAndEnsureConsultation: vi.fn(),
      authorizeExactRetransmission: vi.fn(),
    }
    const result = await transmitWithUncertainStateSafety({
      locator,
      persistence,
      preparer: { prepare },
      provider,
      now: new Date("2026-08-28T14:00:00Z"),
    })
    expect(result.kind).toBe("authorized")
    expect(Buffer.from(transmitted[0])).toEqual(Buffer.from(bytes))
    expect(persistence.beginTransmission).toHaveBeenCalledTimes(1)
    expect(prepare).not.toHaveBeenCalled()
  })
})
