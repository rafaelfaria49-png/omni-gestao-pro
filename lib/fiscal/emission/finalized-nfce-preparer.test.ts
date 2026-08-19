/**
 * GOAL 021 — QR v3 no caminho real de finalização local da NFC-e.
 *
 * Prova, offline e só com certificado fixture: o preparer canônico produz
 * FinalizedFiscalDocument completo; persistBeforeTransmission grava os bytes e
 * os metadados QR antes do provider; reload não recalcula; markAuthorized não
 * apaga metadata omitida; exactBytes/SHA-256 sobrevivem; provider externo
 * continua bloqueado. Zero SEFAZ, zero A1 real, zero H-9/H-10.
 */
import { createPublicKey } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

import {
  createQrV3OfflinePemSigner,
  verifyQrV3OfflineSignature,
} from "@/lib/fiscal/danfce/qr-v3"
import { DRY_RUN_TEST_CERT, dryRunSnapshot } from "@/lib/fiscal/dry-run"
import { UncertainStateTestStub } from "@/lib/fiscal/provider/uncertain-state-test-stub"
import { TEST_CERT_PEM } from "@/lib/fiscal/signing/__fixtures__/test-cert"
import { verifyNfceSignature } from "@/lib/fiscal/signing"
import {
  createFinalizedNfcePreparer,
  NfceQrConfigMissingError,
  type NfceFinalizationSource,
  type NfceQrUrlConfig,
} from "./finalized-nfce-preparer"
import { createPrismaUncertainStatePersistence } from "./prisma-uncertain-state-persistence"
import {
  fiscalBytesSha256,
  fiscalXmlBytes,
  transmitWithUncertainStateSafety,
} from "./uncertain-state-coordinator"
import type {
  FinalizedFiscalDocument,
  FiscalDocumentLocator,
  UncertainStateFiscalProvider,
  UncertainStatePersistence,
} from "./uncertain-state.types"

const HERE = dirname(fileURLToPath(import.meta.url))
const LOCATOR: FiscalDocumentLocator = {
  storeId: "loja-1",
  vendaId: "venda-simples",
  notaFiscalId: "nota-021-qr",
}
const QR_URLS: NfceQrUrlConfig = {
  qrCodeBaseUrl: "https://qr.example.test/nfce",
  urlChave: "https://qr.example.test/consulta",
}
const PUBLIC_KEY = createPublicKey(TEST_CERT_PEM)

function source(over: Partial<NfceFinalizationSource> = {}): NfceFinalizationSource {
  return {
    ...LOCATOR,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 42,
    snapshot: dryRunSnapshot("simples"),
    ...over,
  }
}

function preparerDe(over: Partial<Parameters<typeof createFinalizedNfcePreparer>[0]> = {}) {
  return createFinalizedNfcePreparer({
    resolveSource: async () => source(),
    certificado: DRY_RUN_TEST_CERT,
    qrUrls: QR_URLS,
    ...over,
  })
}

function payloadP(qrCode: string): string {
  const marker = "?p="
  const at = qrCode.indexOf(marker)
  if (at < 0) throw new Error("qrCode sem query p=")
  return qrCode.slice(at + marker.length)
}

type Row = Record<string, unknown>
function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
      const clause = condition as Record<string, unknown>
      if ("in" in clause) return (clause.in as unknown[]).includes(value)
      return true
    }
    return value === condition
  })
}
function applyData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && "increment" in (value as Row)) {
      row[key] = Number(row[key] ?? 0) + Number((value as Row).increment)
      continue
    }
    row[key] = value
  }
}

type FakePrismaClient = {
  $transaction: <T>(fn: (tx: FakePrismaClient) => Promise<T>) => Promise<T>
  notaFiscal: {
    findFirst: (args: { where: Row }) => Promise<Row | null>
    updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }>
  }
  venda: {
    updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }>
  }
  fiscalEmissaoJob: {
    findFirst: (args: { where: Row }) => Promise<Row | null>
    update: (args: { where: Row; data: Row }) => Promise<Row | null>
    updateMany: (args: { where: Row; data: Row }) => Promise<{ count: number }>
    upsert: (args: { create: Row }) => Promise<Row>
  }
  fiscalLog: {
    create: (args: { data: Row }) => Promise<Row>
  }
}

function createFakePrisma(note: Row) {
  const notaFiscal = [{ ...note }]
  const fiscalEmissaoJob: Row[] = [
    {
      id: "job-emissao-021",
      storeId: LOCATOR.storeId,
      vendaId: LOCATOR.vendaId,
      notaFiscalId: LOCATOR.notaFiscalId,
      tipo: "EMISSAO",
      status: "PROCESSANDO",
      payload: { version: 2, operation: "EMISSAO" },
      createdAt: new Date("2026-08-18T12:00:00.000Z"),
    },
  ]
  const vendas: Row[] = [{ id: LOCATOR.vendaId, storeId: LOCATOR.storeId, fiscalStatus: "PENDENTE" }]
  const fiscalLogs: Row[] = []
  const client: FakePrismaClient = {
    $transaction: async <T>(fn: (tx: FakePrismaClient) => Promise<T>): Promise<T> => fn(client),
    notaFiscal: {
      findFirst: async ({ where }: { where: Row }) =>
        notaFiscal.find((row) => matchesWhere(row, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hits = notaFiscal.filter((row) => matchesWhere(row, where))
        hits.forEach((row) => applyData(row, data))
        return { count: hits.length }
      },
    },
    venda: {
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hits = vendas.filter((row) => matchesWhere(row, where))
        hits.forEach((row) => applyData(row, data))
        return { count: hits.length }
      },
    },
    fiscalEmissaoJob: {
      findFirst: async ({ where }: { where: Row }) =>
        [...fiscalEmissaoJob].reverse().find((row) => matchesWhere(row, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = fiscalEmissaoJob.find((job) => job.id === where.id)
        if (row) applyData(row, data)
        return row ?? null
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hits = fiscalEmissaoJob.filter((row) => matchesWhere(row, where))
        hits.forEach((row) => applyData(row, data))
        return { count: hits.length }
      },
      upsert: async ({ create }: { create: Row }) => {
        const row = { id: `job-${fiscalEmissaoJob.length + 1}`, ...create }
        fiscalEmissaoJob.push(row)
        return row
      },
    },
    fiscalLog: {
      create: async ({ data }: { data: Row }) => {
        fiscalLogs.push(data)
        return data
      },
    },
  }
  return { client, notaFiscal, fiscalLogs }
}

function notaAssinada(over: Row = {}): Row {
  return {
    id: LOCATOR.notaFiscalId,
    storeId: LOCATOR.storeId,
    vendaId: LOCATOR.vendaId,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    status: "ASSINADA",
    serie: 1,
    numero: 42,
    chaveAcesso: "",
    xmlAssinado: null,
    xmlAutorizado: null,
    protocolo: null,
    cStat: null,
    xMotivo: null,
    digestValue: null,
    qrCodeData: null,
    urlConsulta: null,
    ultimoErro: null,
    tentativas: 0,
    ...over,
  }
}

describe("createFinalizedNfcePreparer · QR v3 online", () => {
  it("produz FinalizedFiscalDocument com identidade, xmlAssinado e metadados estruturais", async () => {
    const doc = await preparerDe().prepare(LOCATOR)
    expect(doc.storeId).toBe(LOCATOR.storeId)
    expect(doc.vendaId).toBe(LOCATOR.vendaId)
    expect(doc.notaFiscalId).toBe(LOCATOR.notaFiscalId)
    expect(doc.modelo).toBe("NFCE")
    expect(doc.ambiente).toBe("HOMOLOGACAO")
    expect(doc.serie).toBe(1)
    expect(doc.numero).toBe(42)
    expect(doc.chaveAcesso).toMatch(/^\d{44}$/)
    expect(doc.xmlAssinado).toContain("<NFe")
    expect(doc.xmlAssinado.includes("<?xml")).toBe(false)
    expect(doc.digestValue).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(doc.qrCodeData).toBe(`${QR_URLS.qrCodeBaseUrl}?p=${doc.chaveAcesso}|3|2`)
    expect(doc.urlConsulta).toBe(QR_URLS.urlChave)
  })

  it("qrCodeData e urlConsulta correspondem exatamente a <qrCode> e <urlChave> no XML", async () => {
    const doc = await preparerDe().prepare(LOCATOR)
    expect(doc.xmlAssinado).toContain(`<qrCode>${doc.qrCodeData}</qrCode>`)
    expect(doc.xmlAssinado).toContain(`<urlChave>${doc.urlConsulta}</urlChave>`)
    expect(doc.xmlAssinado).toContain(`<DigestValue>${doc.digestValue}</DigestValue>`)
    expect(verifyNfceSignature(doc.xmlAssinado).valido).toBe(true)
  })
})

describe("createFinalizedNfcePreparer · QR v3 offline tpEmis=9", () => {
  it("usa qrOfflineV3, persiste metadados estruturais e mantém duas assinaturas independentes", async () => {
    const doc = await createFinalizedNfcePreparer({
      resolveSource: async () => source({ tpEmis: 9 }),
      certificado: DRY_RUN_TEST_CERT,
      qrUrls: QR_URLS,
    }).prepare(LOCATOR)

    expect(doc.xmlAssinado).toContain("<tpEmis>9</tpEmis>")
    expect(doc.xmlAssinado).toContain(`<qrCode>${doc.qrCodeData}</qrCode>`)
    expect(doc.xmlAssinado).toContain(`<urlChave>${doc.urlConsulta}</urlChave>`)
    expect(doc.urlConsulta).toBe(QR_URLS.urlChave)
    expect(doc.qrCodeData!.startsWith(`${QR_URLS.qrCodeBaseUrl}?p=`)).toBe(true)

    const p = payloadP(doc.qrCodeData!)
    const parts = p.split("|")
    const assinaturaQr = parts[parts.length - 1] ?? ""
    const canonical = parts.slice(0, 7).join("|")
    expect(assinaturaQr).not.toBe(doc.digestValue)
    expect(verifyQrV3OfflineSignature(canonical, assinaturaQr, PUBLIC_KEY)).toBe(true)
    expect(verifyNfceSignature(doc.xmlAssinado)).toMatchObject({
      valido: true,
      digestConfere: true,
      assinaturaConfere: true,
    })

    const qrAdulterado = doc.xmlAssinado.replace(
      `<qrCode>${doc.qrCodeData}</qrCode>`,
      `<qrCode>${doc.qrCodeData}x</qrCode>`,
    )
    expect(verifyNfceSignature(qrAdulterado).valido).toBe(true)

    const infAdulterado = doc.xmlAssinado.replace("<natOp>", "<natOp>X")
    expect(verifyNfceSignature(infAdulterado).valido).toBe(false)

    const mesmoMaterial = createQrV3OfflinePemSigner(DRY_RUN_TEST_CERT.privateKeyPem)
    expect(mesmoMaterial(canonical)).toBe(assinaturaQr)
  })
})

describe("createFinalizedNfcePreparer · fail closed sem QR", () => {
  it("caminho SEFAZ-ready sem URLs injetadas recusa antes de persistir/transmitir", async () => {
    const persistBeforeTransmission = vi.fn()
    const stub = new UncertainStateTestStub({
      transmission: ["AUTHORIZED"],
      consultation: "AUTHORIZED",
    })
    await expect(
      transmitWithUncertainStateSafety({
        locator: LOCATOR,
        preparer: createFinalizedNfcePreparer({
          resolveSource: async () => source(),
          certificado: DRY_RUN_TEST_CERT,
          qrUrls: null,
        }),
        persistence: {
          load: async () => null,
          persistBeforeTransmission,
          recordUncertainAndEnsureConsultation: vi.fn(),
          markAuthorized: vi.fn(),
          markRejected: vi.fn(),
          authorizeExactRetransmission: vi.fn(),
        } as unknown as UncertainStatePersistence,
        provider: stub,
      }),
    ).rejects.toBeInstanceOf(NfceQrConfigMissingError)

    expect(persistBeforeTransmission).not.toHaveBeenCalled()
    expect(stub.transmissions).toHaveLength(0)
  })
})

describe("fronteira prepare → persistBeforeTransmission → provider.transmit", () => {
  async function emitir(docPreparer = preparerDe()) {
    const order: string[] = []
    const { client, notaFiscal } = createFakePrisma(notaAssinada())
    const persistence = createPrismaUncertainStatePersistence(
      client as unknown as Parameters<typeof createPrismaUncertainStatePersistence>[0],
    )
    const persist = persistence.persistBeforeTransmission.bind(persistence)
    persistence.persistBeforeTransmission = async (input) => {
      order.push("persist")
      return persist(input)
    }
    const stub = new UncertainStateTestStub({
      transmission: ["AUTHORIZED"],
      consultation: "AUTHORIZED",
    })
    const transmitOrig = stub.transmit.bind(stub)
    stub.transmit = async (input) => {
      order.push("transmit")
      return transmitOrig(input)
    }

    const outcome = await transmitWithUncertainStateSafety({
      locator: LOCATOR,
      persistence,
      preparer: docPreparer,
      provider: stub,
    })
    return { outcome, order, stub, persistence, notaFiscal }
  }

  it("persiste identidade, xmlAssinado, hash e QR antes do provider, e reload preserva exactBytes", async () => {
    const { outcome, order, stub, persistence, notaFiscal } = await emitir()
    expect(order).toEqual(["persist", "transmit"])
    expect(outcome.kind).toBe("authorized")
    if (outcome.kind !== "authorized") return

    expect(stub.transmissions).toHaveLength(1)
    const enviados = Buffer.from(stub.transmissions[0]!.bytesBase64, "base64")
    expect(notaFiscal[0].status).toBe("AUTORIZADA")
    expect(notaFiscal[0].xmlAssinado).toBeTruthy()
    const xml = String(notaFiscal[0].xmlAssinado)
    const bytes = fiscalXmlBytes(xml)
    expect(Buffer.from(enviados).equals(Buffer.from(bytes))).toBe(true)
    expect(fiscalBytesSha256(bytes)).toBe(outcome.bytesSha256)
    expect(fiscalBytesSha256(bytes)).toBe(stub.transmissions[0]!.bytesSha256)

    const reloaded = await persistence.load(LOCATOR)
    expect(reloaded?.xmlAssinado).toBe(xml)
    expect(reloaded?.digestValue).toBe(notaFiscal[0].digestValue)
    expect(reloaded?.qrCodeData).toBe(notaFiscal[0].qrCodeData)
    expect(reloaded?.urlConsulta).toBe(notaFiscal[0].urlConsulta)
    expect(reloaded?.qrCodeData).toBeTruthy()
    expect(xml).toContain(`<qrCode>${reloaded?.qrCodeData}</qrCode>`)
    expect(xml).toContain(`<urlChave>${reloaded?.urlConsulta}</urlChave>`)
    expect(xml).toContain(`<DigestValue>${reloaded?.digestValue}</DigestValue>`)
    expect(fiscalBytesSha256(fiscalXmlBytes(reloaded!.xmlAssinado!))).toBe(outcome.bytesSha256)
    expect(xml.includes("<?xml")).toBe(false)
    expect(xml.trim()).toBe(xml)
  })

  it("AUTHORIZED do stub (sem metadata QR) não apaga digest/qr/url persistidos", async () => {
    const { persistence, notaFiscal } = await emitir()
    expect(notaFiscal[0].digestValue).toBeTruthy()
    expect(notaFiscal[0].qrCodeData).toBeTruthy()
    expect(notaFiscal[0].urlConsulta).toBe(QR_URLS.urlChave)
    const reloaded = await persistence.load(LOCATOR)
    expect(reloaded?.qrCodeData).toBe(notaFiscal[0].qrCodeData)
    expect(reloaded?.urlConsulta).toBe(QR_URLS.urlChave)
  })
})

describe("exactBytes · UTF-8 → SHA-256 → persist → reload", () => {
  it("nenhuma etapa trim/reserializa/altera infNFeSupl ou Signature", async () => {
    const prepared = await preparerDe().prepare(LOCATOR)
    const bytes1 = fiscalXmlBytes(prepared.xmlAssinado)
    const hash1 = fiscalBytesSha256(bytes1)
    expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes1)).toBe(prepared.xmlAssinado)

    const { client } = createFakePrisma(notaAssinada())
    const persistence = createPrismaUncertainStatePersistence(
      client as unknown as Parameters<typeof createPrismaUncertainStatePersistence>[0],
    )
    const persisted = await persistence.persistBeforeTransmission({
      document: prepared,
      bytesSha256: hash1,
      now: new Date("2026-08-18T12:00:00.000Z"),
    })
    expect(persisted.xmlAssinado).toBe(prepared.xmlAssinado)
    expect(persisted.xmlBytesSha256).toBe(hash1)
    expect(persisted.digestValue).toBe(prepared.digestValue)
    expect(persisted.qrCodeData).toBe(prepared.qrCodeData)
    expect(persisted.urlConsulta).toBe(prepared.urlConsulta)

    const reloaded = await persistence.load(LOCATOR)
    expect(reloaded?.xmlAssinado).toBe(prepared.xmlAssinado)
    const bytes2 = fiscalXmlBytes(reloaded!.xmlAssinado!)
    expect(Buffer.from(bytes2).equals(Buffer.from(bytes1))).toBe(true)
    expect(fiscalBytesSha256(bytes2)).toBe(hash1)
    expect(reloaded?.xmlAssinado).toContain("<infNFeSupl>")
    expect(reloaded?.xmlAssinado).toContain("<Signature")
    expect(reloaded?.xmlAssinado).toContain(`<qrCode>${prepared.qrCodeData}</qrCode>`)
  })
})

describe("provider externo continua não autorizado", () => {
  it("bloqueia antes de prepare/persist/transmit", async () => {
    const prepare = vi.fn(async (): Promise<FinalizedFiscalDocument> => {
      throw new Error("preparer não deveria ser chamado")
    })
    const persistBeforeTransmission = vi.fn()
    const transmit = vi.fn()
    const provider: UncertainStateFiscalProvider = {
      simulado: false,
      transmit,
      consult: vi.fn(),
    }

    const outcome = await transmitWithUncertainStateSafety({
      locator: LOCATOR,
      preparer: { prepare },
      persistence: {
        load: vi.fn(),
        persistBeforeTransmission,
        recordUncertainAndEnsureConsultation: vi.fn(),
        markAuthorized: vi.fn(),
        markRejected: vi.fn(),
        authorizeExactRetransmission: vi.fn(),
      } as unknown as UncertainStatePersistence,
      provider,
    })

    expect(outcome).toMatchObject({ kind: "blocked", code: "EXTERNAL_EXECUTION_NOT_AUTHORIZED" })
    expect(prepare).not.toHaveBeenCalled()
    expect(persistBeforeTransmission).not.toHaveBeenCalled()
    expect(transmit).not.toHaveBeenCalled()
  })
})

describe("zero rede / zero SEFAZ / fontes do GOAL", () => {
  it("não dispara fetch e os fontes novos não importam http/sefaz/wsdl", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await preparerDe().prepare(LOCATOR)
    await createFinalizedNfcePreparer({
      resolveSource: async () => source({ tpEmis: 9 }),
      certificado: DRY_RUN_TEST_CERT,
      qrUrls: QR_URLS,
    }).prepare(LOCATOR)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    const files = [
      "finalized-nfce-preparer.ts",
      "uncertain-state-coordinator.ts",
      "prisma-uncertain-state-persistence.ts",
      "uncertain-state.types.ts",
    ]
    for (const file of files) {
      const src = readFileSync(resolve(HERE, file), "utf8")
      expect(src, file).not.toMatch(/from\s+["']node:(http|https|net|tls|dgram)["']/)
      expect(src, file).not.toMatch(/from\s+["'](undici|axios|node-fetch|got)["']/)
      expect(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), file).not.toMatch(
        /\bfetch\s*\(/,
      )
      expect(src, file).not.toMatch(/wsdl-ephemeral|H-9|H-10|nfce\.fazenda\.sp\.gov/)
    }
  })
})

describe("createFinalizedNfcePreparer · certificado lazy", () => {
  it("contrato atual com material estático não chama o resolver", async () => {
    const resolveCertificate = vi.fn(async () => {
      throw new Error("resolver lazy não deveria ser chamado")
    })
    const doc = await createFinalizedNfcePreparer({
      resolveSource: async () => source(),
      certificado: DRY_RUN_TEST_CERT,
      resolveCertificate,
      qrUrls: QR_URLS,
    }).prepare(LOCATOR)
    expect(doc.xmlAssinado).toContain("<Signature")
    expect(resolveCertificate).not.toHaveBeenCalled()
  })

  it("resolver lazy só corre dentro de prepare e aceita fixture", async () => {
    const resolveCertificate = vi.fn(async () => DRY_RUN_TEST_CERT)
    const preparer = createFinalizedNfcePreparer({
      resolveSource: async () => source(),
      resolveCertificate,
      qrUrls: QR_URLS,
    })
    expect(resolveCertificate).not.toHaveBeenCalled()
    const doc = await preparer.prepare(LOCATOR)
    expect(resolveCertificate).toHaveBeenCalledTimes(1)
    expect(doc.xmlAssinado).toContain("<Signature")
  })

  it("gate de capability negada não resolve certificado lazy", async () => {
    const resolveCertificate = vi.fn(async () => DRY_RUN_TEST_CERT)
    const persistBeforeTransmission = vi.fn()
    const transmit = vi.fn()
    const outcome = await transmitWithUncertainStateSafety({
      locator: LOCATOR,
      preparer: createFinalizedNfcePreparer({
        resolveSource: async () => source(),
        resolveCertificate,
        qrUrls: QR_URLS,
      }),
      persistence: {
        load: vi.fn(),
        persistBeforeTransmission,
        recordUncertainAndEnsureConsultation: vi.fn(),
        markAuthorized: vi.fn(),
        markRejected: vi.fn(),
        authorizeExactRetransmission: vi.fn(),
      } as unknown as UncertainStatePersistence,
      provider: {
        simulado: false,
        transmit,
        consult: vi.fn(),
      },
    })
    expect(outcome).toMatchObject({ kind: "blocked", code: "EXTERNAL_EXECUTION_NOT_AUTHORIZED" })
    expect(resolveCertificate).not.toHaveBeenCalled()
    expect(persistBeforeTransmission).not.toHaveBeenCalled()
    expect(transmit).not.toHaveBeenCalled()
  })
})

describe("tipos aditivos não quebram persistência legado", () => {
  it("documento sem QR ainda persiste xmlAssinado (colunas QR nulas)", async () => {
    const { client, notaFiscal } = createFakePrisma(notaAssinada())
    const persistence = createPrismaUncertainStatePersistence(
      client as unknown as Parameters<typeof createPrismaUncertainStatePersistence>[0],
    )
    const legado: FinalizedFiscalDocument = {
      ...LOCATOR,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 1,
      numero: 42,
      chaveAcesso: "35260711222333000181650010000000421123456780",
      xmlAssinado: "<NFe>bytes-legado</NFe>",
    }
    const persisted = await persistence.persistBeforeTransmission({
      document: legado,
      bytesSha256: fiscalBytesSha256(fiscalXmlBytes(legado.xmlAssinado)),
      now: new Date("2026-08-18T12:00:00.000Z"),
    })
    expect(notaFiscal[0].xmlAssinado).toBe("<NFe>bytes-legado</NFe>")
    expect(persisted.digestValue).toBeNull()
    expect(persisted.qrCodeData).toBeNull()
    expect(persisted.urlConsulta).toBeNull()
  })
})
