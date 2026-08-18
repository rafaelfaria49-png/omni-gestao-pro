/**
 * Suíte do GOAL-013 (ADR-0018) — persistência legal do XML e do protocolo.
 *
 * Cobre os testes obrigatórios do GOAL:
 *  1. persistência do XML assinado antes da transmissão (+ bytes exatos);
 *  2. persistência do XML autorizado, protocolo e demais metadados do schema;
 *  3. idempotência com os mesmos bytes;
 *  4. bloqueio de alteração do XML autorizado;
 *  5. bloqueio de protocolo divergente;
 *  6. leitura devolve os bytes originais (nunca reconstrói);
 *  7. isolamento cross-store;
 *  8. nenhum XML completo em logs;
 *  9. hash SHA-256 válido;
 * 10. divergência coluna × espelho quando o espelho está ativo;
 * 11. compatibilidade com o estado incerto do GOAL-012.
 *
 * Toda a suíte roda contra um Prisma em memória — nenhum banco, nenhuma rede,
 * nenhuma SEFAZ, nenhum bucket.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createPrismaUncertainStatePersistence } from "../emission/prisma-uncertain-state-persistence"
import {
  AuthorizedDivergenceError,
  type FinalizedFiscalDocument,
  type PersistedFiscalDocument,
} from "../emission/uncertain-state.types"
import { noopXmlStorageMirror, resolveXmlStorageMirror } from "./mirror-vault"
import type { XmlStorageMirror } from "./types"
import { FiscalStorageError } from "./types"
import { createFiscalXmlReader, type FiscalXmlReaderClient } from "./xml-storage-reader"

const STORE_A = "store-matriz-rafa-cell-fixture"
const STORE_B = "store-filial-fixture"
const VENDA = "venda-013"
const NOTA = "nota-013"
const CHAVE = "35260712345678000199650010000000421123456789"

const XML_ASSINADO =
  '<?xml version="1.0" encoding="UTF-8"?><NFe Id="NFe35260712345678000199650010000000421123456789"><Signature>ASSINATURA-013</Signature></NFe>'
const XML_AUTORIZADO =
  '<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe Id="NFe35260712345678000199650010000000421123456789"><Signature>ASSINATURA-013</Signature></NFe><protNFe><infProt><nProt>135260000000013</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>'
const XML_AUTORIZADO_ADULTERADO = XML_AUTORIZADO.replace("<cStat>100</cStat>", "<cStat>204</cStat>")

const PROTOCOLO = "135260000000013"
const SHA256_ASSINADO_HEX = /^[0-9a-f]{64}$/

type Row = Record<string, unknown>

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key]
    if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
      const clause = condition as Record<string, unknown>
      if ("in" in clause) return (clause.in as unknown[]).includes(value)
      if ("not" in clause) return value !== clause.not
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

/** Nota fiscal recém-assinada, ainda não transmitida (estado ADR-0017). */
function notaAssinada(overrides: Row = {}): Row {
  return {
    id: NOTA,
    storeId: STORE_A,
    vendaId: VENDA,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    status: "ASSINADA",
    serie: 1,
    numero: 42,
    chaveAcesso: CHAVE,
    xmlAssinado: null,
    xmlAutorizado: null,
    xmlStorageRef: null,
    protocolo: null,
    cStat: null,
    xMotivo: null,
    dataAutorizacao: null,
    digestValue: null,
    qrCodeData: null,
    urlConsulta: null,
    ultimoErro: null,
    tentativas: 0,
    ...overrides,
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

/**
 * As fábricas de produção tipam o client como o `PrismaClient` real. O fake
 * cobre só as operações usadas por este GOAL, então o cast é explícito e local
 * — nada de `any` espalhado pelos testes.
 */
function asPersistenceClient(client: FakePrismaClient) {
  return client as unknown as Parameters<typeof createPrismaUncertainStatePersistence>[0]
}

function asReaderClient(client: FakePrismaClient): FiscalXmlReaderClient {
  return client as unknown as FiscalXmlReaderClient
}

function createFakePrisma(notas: Row[]) {
  const notaFiscal = notas.map((n) => ({ ...n }))
  const fiscalEmissaoJob: Row[] = [
    {
      id: "job-emissao",
      storeId: STORE_A,
      vendaId: VENDA,
      notaFiscalId: NOTA,
      tipo: "EMISSAO",
      status: "PROCESSANDO",
      payload: { version: 2, operation: "EMISSAO" },
      createdAt: new Date("2026-07-23T12:00:00.000Z"),
    },
  ]
  const vendas: Row[] = [{ id: VENDA, storeId: STORE_A, fiscalStatus: "PENDENTE" }]
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

  return { client, notaFiscal, fiscalEmissaoJob, fiscalLogs, vendas }
}

const authorizedResult = {
  outcome: "AUTHORIZED" as const,
  protocolo: PROTOCOLO,
  cStat: "100",
  xMotivo: "Autorizado o uso da NF-e",
  xmlAutorizado: XML_AUTORIZADO,
  digestValue: "gsMEZ0tR3n8oIcT8p1kQoQEXAMPLE=",
  qrCodeData: `https://homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${CHAVE}|2|2|1|HASH`,
  urlConsulta: "https://homologacao.nfce.fazenda.sp.gov.br/consulta",
}

const locator = { storeId: STORE_A, vendaId: VENDA, notaFiscalId: NOTA }

/** Documento finalizado (identidade + bytes assinados), entrada de `persistBeforeTransmission`. */
const finalizedDocument: FinalizedFiscalDocument = {
  ...locator,
  modelo: "NFCE",
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numero: 42,
  chaveAcesso: CHAVE,
  xmlAssinado: XML_ASSINADO,
}

/** Documento já persistido em TRANSMITINDO, entrada de `markAuthorized`. */
const transmittingDocument: PersistedFiscalDocument = {
  ...finalizedDocument,
  status: "TRANSMITINDO",
  xmlBytesSha256: "a".repeat(64),
}

const NOW = new Date("2026-07-23T12:05:00.000Z")

describe("GOAL-013 · persistência do XML assinado (antes da transmissão)", () => {
  it("persiste os bytes assinados exatos e o SHA-256 antes de chamar o provider", async () => {
    const { client, notaFiscal, fiscalEmissaoJob } = createFakePrisma([notaAssinada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    const persisted = await persistence.persistBeforeTransmission({
      document: finalizedDocument,
      bytesSha256: "a".repeat(64),
      now: NOW,
    })

    expect(notaFiscal[0].xmlAssinado).toBe(XML_ASSINADO)
    expect(notaFiscal[0].status).toBe("TRANSMITINDO")
    expect(persisted.xmlAssinado).toBe(XML_ASSINADO)
    const payload = fiscalEmissaoJob[0].payload as Row
    expect((payload.document as Row).bytesSha256).toBe("a".repeat(64))
  })

  it("recusa substituição silenciosa do XML assinado depois de iniciada a transmissão", async () => {
    const { client, notaFiscal } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await expect(
      persistence.persistBeforeTransmission({
        document: { ...finalizedDocument, xmlAssinado: "<NFe>OUTROS-BYTES</NFe>" },
        bytesSha256: "b".repeat(64),
        now: NOW,
      }),
    ).rejects.toThrow(/estado ou escopo da nota mudou/)

    expect(notaFiscal[0].xmlAssinado).toBe(XML_ASSINADO)
  })
})

describe("GOAL-013 · persistência do XML autorizado e do protocolo", () => {
  it("persiste atomicamente XML, protocolo e todos os metadados suportados pelo schema", async () => {
    const { client, notaFiscal, vendas } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "TRANSMISSION",
    })

    const nota = notaFiscal[0]
    expect(nota.status).toBe("AUTORIZADA")
    expect(nota.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(nota.protocolo).toBe(PROTOCOLO)
    expect(nota.cStat).toBe("100")
    expect(nota.xMotivo).toBe("Autorizado o uso da NF-e")
    expect(nota.dataAutorizacao).toEqual(NOW)
    expect(nota.digestValue).toBe(authorizedResult.digestValue)
    expect(nota.qrCodeData).toBe(authorizedResult.qrCodeData)
    expect(nota.urlConsulta).toBe(authorizedResult.urlConsulta)
    expect(nota.ultimoErro).toBeNull()
    // XML assinado (evidência do que foi submetido) permanece intacto.
    expect(nota.xmlAssinado).toBe(XML_ASSINADO)
    expect(vendas[0].fiscalStatus).toBe("AUTORIZADA")
  })

  it("deixa xmlStorageRef nulo enquanto o espelho privado não está provisionado", async () => {
    const { client, notaFiscal, fiscalLogs } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "TRANSMISSION",
    })

    expect(notaFiscal[0].xmlStorageRef).toBeNull()
    expect(fiscalLogs.some((log) => String(log.acao).startsWith("fiscal.storage.mirror"))).toBe(false)
    expect(resolveXmlStorageMirror().active).toBe(false)
    expect(noopXmlStorageMirror.active).toBe(false)
  })
})

describe("GOAL-013 · imutabilidade do XML autorizado e do protocolo", () => {
  function autorizada(overrides: Row = {}): Row {
    return notaAssinada({
      status: "AUTORIZADA",
      xmlAssinado: XML_ASSINADO,
      xmlAutorizado: XML_AUTORIZADO,
      protocolo: PROTOCOLO,
      cStat: "100",
      xMotivo: "Autorizado o uso da NF-e",
      dataAutorizacao: new Date("2026-07-23T12:01:00.000Z"),
      ...overrides,
    })
  }

  it("converge de forma idempotente quando reprocessa com os mesmos bytes", async () => {
    const { client, notaFiscal, fiscalLogs } = createFakePrisma([autorizada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))
    const dataOriginal = notaFiscal[0].dataAutorizacao

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: authorizedResult,
        now: NOW,
        source: "CONSULTATION",
      }),
    ).resolves.toBeUndefined()

    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(notaFiscal[0].protocolo).toBe(PROTOCOLO)
    // Nenhuma escrita: nem sequer a data de autorização é regravada.
    expect(notaFiscal[0].dataAutorizacao).toBe(dataOriginal)
    expect(fiscalLogs.some((log) => log.acao === "fiscal.emission.idempotent_mark")).toBe(true)
  })

  it("bloqueia substituição do XML autorizado por bytes divergentes", async () => {
    const { client, notaFiscal } = createFakePrisma([autorizada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: { ...authorizedResult, xmlAutorizado: XML_AUTORIZADO_ADULTERADO },
        now: NOW,
        source: "CONSULTATION",
      }),
    ).rejects.toThrow(AuthorizedDivergenceError)

    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
  })

  it("bloqueia troca silenciosa do protocolo de autorização", async () => {
    const { client, notaFiscal } = createFakePrisma([autorizada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: { ...authorizedResult, protocolo: "999999999999999" },
        now: NOW,
        source: "CONSULTATION",
      }),
    ).rejects.toMatchObject({ code: "protocolo_imutavel_diverge" })

    expect(notaFiscal[0].protocolo).toBe(PROTOCOLO)
  })

  it("bloqueia alteração parcial de cStat/xMotivo sobre o mesmo XML", async () => {
    const { client, notaFiscal } = createFakePrisma([autorizada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: { ...authorizedResult, xMotivo: "Texto reescrito depois da autorização" },
        now: NOW,
        source: "CONSULTATION",
      }),
    ).rejects.toMatchObject({ code: "metadados_autorizacao_divergem" })

    expect(notaFiscal[0].xMotivo).toBe("Autorizado o uso da NF-e")
  })

  it("compatível com o GOAL-012: completa nota AUTORIZADA degradada sem XML persistido", async () => {
    // Retomada por consulta encontra a nota já marcada AUTORIZADA mas com a
    // coluna incompleta. Completar não é substituir — nada é sobrescrito.
    const { client, notaFiscal } = createFakePrisma([
      autorizada({ xmlAutorizado: null, protocolo: null, cStat: null, xMotivo: null }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "CONSULTATION",
    })

    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(notaFiscal[0].protocolo).toBe(PROTOCOLO)
  })

  it("nunca reconstrói o XML autorizado a partir de dados vivos da venda", async () => {
    const { client, notaFiscal, vendas } = createFakePrisma([autorizada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    // Dados "vivos" mudam (venda corrigida depois da autorização). O XML
    // autorizado é evidência histórica: continua idêntico ao que a SEFAZ
    // autorizou, e o reader devolve esses mesmos bytes.
    await client.venda.updateMany({
      where: { id: VENDA, storeId: STORE_A },
      data: { total: 999, itens: 7 },
    })
    expect(vendas[0].total).toBe(999)

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "CONSULTATION",
    })

    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    const documento = await createFiscalXmlReader(asReaderClient(client)).readAuthorizedDocument(locator)
    expect(documento!.xmlAutorizado).toBe(XML_AUTORIZADO)
  })
})

describe("GOAL-013 · reader fiscal server-side", () => {
  function autorizadaCompleta(overrides: Row = {}): Row {
    return notaAssinada({
      status: "AUTORIZADA",
      xmlAssinado: XML_ASSINADO,
      xmlAutorizado: XML_AUTORIZADO,
      protocolo: PROTOCOLO,
      cStat: "100",
      xMotivo: "Autorizado o uso da NF-e",
      dataAutorizacao: NOW,
      digestValue: authorizedResult.digestValue,
      qrCodeData: authorizedResult.qrCodeData,
      urlConsulta: authorizedResult.urlConsulta,
      ...overrides,
    })
  }

  it("devolve exatamente os bytes persistidos, com hash SHA-256 válido", async () => {
    const { client } = createFakePrisma([autorizadaCompleta()])
    const reader = createFiscalXmlReader(asReaderClient(client))

    const documento = await reader.readAuthorizedDocument(locator)

    expect(documento).not.toBeNull()
    expect(documento!.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(documento!.xmlAssinado).toBe(XML_ASSINADO)
    expect(documento!.protocolo).toBe(PROTOCOLO)
    expect(documento!.cStat).toBe("100")
    expect(documento!.digestValue).toBe(authorizedResult.digestValue)
    expect(documento!.qrCodeData).toBe(authorizedResult.qrCodeData)
    expect(documento!.urlConsulta).toBe(authorizedResult.urlConsulta)
    expect(documento!.xmlAutorizadoSha256).toMatch(SHA256_ASSINADO_HEX)
    expect(documento!.xmlAssinadoSha256).toMatch(SHA256_ASSINADO_HEX)
  })

  it("hash devolvido corresponde ao SHA-256 real dos bytes", async () => {
    const { createHash } = await import("node:crypto")
    const esperado = createHash("sha256").update(XML_AUTORIZADO, "utf8").digest("hex")
    const { client } = createFakePrisma([autorizadaCompleta()])
    const reader = createFiscalXmlReader(asReaderClient(client))

    const documento = await reader.readAuthorizedDocument(locator)

    expect(documento!.xmlAutorizadoSha256).toBe(esperado)
  })

  it("exige storeId não-vazio antes de tocar o banco", async () => {
    const { client, fiscalLogs } = createFakePrisma([autorizadaCompleta()])
    const findFirst = vi.spyOn(client.notaFiscal, "findFirst")
    const reader = createFiscalXmlReader(asReaderClient(client))

    await expect(
      reader.readAuthorizedDocument({ ...locator, storeId: "   " }),
    ).rejects.toThrow(FiscalStorageError)

    expect(findFirst).not.toHaveBeenCalled()
    expect(fiscalLogs).toHaveLength(0)
  })

  it("isola por loja: loja B não lê o XML autorizado da loja A", async () => {
    const { client } = createFakePrisma([autorizadaCompleta()])
    const reader = createFiscalXmlReader(asReaderClient(client))

    const documento = await reader.readAuthorizedDocument({ ...locator, storeId: STORE_B })

    expect(documento).toBeNull()
  })

  it("não permite alteração: reler duas vezes devolve os mesmos bytes", async () => {
    const { client, notaFiscal } = createFakePrisma([autorizadaCompleta()])
    const reader = createFiscalXmlReader(asReaderClient(client))

    const primeira = await reader.readAuthorizedDocument(locator)
    const segunda = await reader.readAuthorizedDocument(locator)

    expect(primeira!.xmlAutorizado).toBe(segunda!.xmlAutorizado)
    expect(primeira!.xmlAutorizadoSha256).toBe(segunda!.xmlAutorizadoSha256)
    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
  })
})

describe("GOAL-013 · nenhum XML completo em logs", () => {
  it("FiscalLog registra apenas hashes e identificadores, nunca o conteúdo do XML", async () => {
    const { client, fiscalLogs } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))
    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "TRANSMISSION",
    })
    const reader = createFiscalXmlReader(asReaderClient(client))
    await reader.readAuthorizedDocument(locator)

    expect(fiscalLogs.length).toBeGreaterThan(0)
    const serializado = JSON.stringify(fiscalLogs)
    expect(serializado).not.toContain(XML_AUTORIZADO)
    expect(serializado).not.toContain(XML_ASSINADO)
    expect(serializado).not.toContain("<nfeProc>")
    expect(serializado).not.toContain("<NFe ")
    expect(serializado).not.toContain("ASSINATURA-013")
  })
})

describe("GOAL-013 · espelho privado opcional", () => {
  const REF = "fiscal/store-matriz/nota-013.xml"

  function activeMirror(overrides: Partial<XmlStorageMirror> = {}): XmlStorageMirror {
    return {
      active: true,
      storeMirror: vi.fn(async () => ({ xmlStorageRef: REF, divergent: false })),
      readMirror: vi.fn(async () => ({ bytes: XML_AUTORIZADO, bytesSha256: "irrelevante" })),
      verifyAgainstColumn: vi.fn(async () => ({ divergent: false })),
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("preenche xmlStorageRef quando o espelho está ativo, mantendo a coluna primária", async () => {
    const { client, notaFiscal, fiscalLogs } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const mirror = activeMirror()
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client), () => mirror)

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "TRANSMISSION",
    })

    expect(notaFiscal[0].xmlStorageRef).toBe(REF)
    // A coluna continua sendo a fonte primária, com os bytes íntegros.
    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(fiscalLogs.some((log) => log.acao === "fiscal.storage.mirror_written")).toBe(true)
  })

  it("falha do espelho não derruba a autorização já persistida na coluna", async () => {
    const { client, notaFiscal, fiscalLogs } = createFakePrisma([
      notaAssinada({ status: "TRANSMITINDO", xmlAssinado: XML_ASSINADO }),
    ])
    const mirror = activeMirror({
      storeMirror: vi.fn(async () => {
        throw new Error("bucket indisponível")
      }),
    })
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client), () => mirror)

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: authorizedResult,
        now: NOW,
        source: "TRANSMISSION",
      }),
    ).resolves.toBeUndefined()

    expect(notaFiscal[0].status).toBe("AUTORIZADA")
    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(notaFiscal[0].xmlStorageRef).toBeNull()
    expect(fiscalLogs.some((log) => log.acao === "fiscal.storage.mirror_failed")).toBe(true)
  })

  it("leitura detecta divergência coluna × espelho e mantém a coluna como verdade", async () => {
    const { client, fiscalLogs } = createFakePrisma([
      notaAssinada({
        status: "AUTORIZADA",
        xmlAssinado: XML_ASSINADO,
        xmlAutorizado: XML_AUTORIZADO,
        xmlStorageRef: REF,
        protocolo: PROTOCOLO,
        cStat: "100",
        xMotivo: "Autorizado o uso da NF-e",
      }),
    ])
    const mirror = activeMirror({
      verifyAgainstColumn: vi.fn(async () => ({ divergent: true, reason: "hash_mismatch" })),
    })
    const reader = createFiscalXmlReader(asReaderClient(client), () => mirror)

    const documento = await reader.readAuthorizedDocument(locator)

    // A coluna vence: os bytes devolvidos são os da coluna, não os do espelho.
    expect(documento!.xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(
      fiscalLogs.some((log) => log.acao === "fiscal.storage.mirror_divergent"),
    ).toBe(true)
  })

  it("espelho no-op não grava, não lê e nunca reporta divergência", async () => {
    await expect(
      noopXmlStorageMirror.storeMirror({
        storeId: STORE_A,
        notaFiscalId: NOTA,
        xmlAutorizado: XML_AUTORIZADO,
        bytesSha256: "c".repeat(64),
      }),
    ).resolves.toEqual({ xmlStorageRef: null, divergent: false })
    await expect(
      noopXmlStorageMirror.readMirror({ storeId: STORE_A, xmlStorageRef: REF }),
    ).resolves.toBeNull()
  })
})

const QR_V3_DATA = `https://qr.example.test/nfce?p=${CHAVE}|3|2`
const QR_V3_URL_CHAVE = "https://qr.example.test/consulta"
const QR_V3_DIGEST = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/=="

describe("GOAL-021 · metadados QR persistidos antes da transmissão", () => {
  const finalizedWithQr: FinalizedFiscalDocument = {
    ...finalizedDocument,
    digestValue: QR_V3_DIGEST,
    qrCodeData: QR_V3_DATA,
    urlConsulta: QR_V3_URL_CHAVE,
  }

  it("persistBeforeTransmission grava identidade, xmlAssinado, hash e metadados QR na mesma fronteira", async () => {
    const { client, notaFiscal } = createFakePrisma([notaAssinada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    const persisted = await persistence.persistBeforeTransmission({
      document: finalizedWithQr,
      bytesSha256: "a".repeat(64),
      now: NOW,
    })

    expect(notaFiscal[0].xmlAssinado).toBe(XML_ASSINADO)
    expect(notaFiscal[0].digestValue).toBe(QR_V3_DIGEST)
    expect(notaFiscal[0].qrCodeData).toBe(QR_V3_DATA)
    expect(notaFiscal[0].urlConsulta).toBe(QR_V3_URL_CHAVE)
    expect(notaFiscal[0].status).toBe("TRANSMITINDO")
    expect(persisted.digestValue).toBe(QR_V3_DIGEST)
    expect(persisted.qrCodeData).toBe(QR_V3_DATA)
    expect(persisted.urlConsulta).toBe(QR_V3_URL_CHAVE)
    expect(persisted.xmlAssinado).toBe(XML_ASSINADO)
  })

  it("load() relê os metadados QR sem recalcular", async () => {
    const { client } = createFakePrisma([notaAssinada()])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))
    await persistence.persistBeforeTransmission({
      document: finalizedWithQr,
      bytesSha256: "a".repeat(64),
      now: NOW,
    })

    const reloaded = await persistence.load(locator)
    expect(reloaded?.xmlAssinado).toBe(XML_ASSINADO)
    expect(reloaded?.digestValue).toBe(QR_V3_DIGEST)
    expect(reloaded?.qrCodeData).toBe(QR_V3_DATA)
    expect(reloaded?.urlConsulta).toBe(QR_V3_URL_CHAVE)
    expect(reloaded?.xmlBytesSha256).toBe("a".repeat(64))
  })

  it("AUTHORIZED que omite metadata QR não apaga os valores persistidos", async () => {
    const { client, notaFiscal } = createFakePrisma([
      notaAssinada({
        status: "TRANSMITINDO",
        xmlAssinado: XML_ASSINADO,
        digestValue: QR_V3_DIGEST,
        qrCodeData: QR_V3_DATA,
        urlConsulta: QR_V3_URL_CHAVE,
      }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))
    const { digestValue: _d, qrCodeData: _q, urlConsulta: _u, ...semQr } = authorizedResult

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: semQr,
      now: NOW,
      source: "TRANSMISSION",
    })

    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(notaFiscal[0].protocolo).toBe(PROTOCOLO)
    expect(notaFiscal[0].digestValue).toBe(QR_V3_DIGEST)
    expect(notaFiscal[0].qrCodeData).toBe(QR_V3_DATA)
    expect(notaFiscal[0].urlConsulta).toBe(QR_V3_URL_CHAVE)
  })

  it("AUTHORIZED com metadata QR igual converge", async () => {
    const { client, notaFiscal } = createFakePrisma([
      notaAssinada({
        status: "TRANSMITINDO",
        xmlAssinado: XML_ASSINADO,
        digestValue: authorizedResult.digestValue,
        qrCodeData: authorizedResult.qrCodeData,
        urlConsulta: authorizedResult.urlConsulta,
      }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: authorizedResult,
      now: NOW,
      source: "TRANSMISSION",
    })

    expect(notaFiscal[0].digestValue).toBe(authorizedResult.digestValue)
    expect(notaFiscal[0].qrCodeData).toBe(authorizedResult.qrCodeData)
    expect(notaFiscal[0].urlConsulta).toBe(authorizedResult.urlConsulta)
  })

  it("AUTHORIZED com metadata QR divergente falha fechado e não substitui", async () => {
    const { client, notaFiscal } = createFakePrisma([
      notaAssinada({
        status: "TRANSMITINDO",
        xmlAssinado: XML_ASSINADO,
        digestValue: QR_V3_DIGEST,
        qrCodeData: QR_V3_DATA,
        urlConsulta: QR_V3_URL_CHAVE,
      }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))

    await expect(
      persistence.markAuthorized({
        document: transmittingDocument,
        result: authorizedResult,
        now: NOW,
        source: "TRANSMISSION",
      }),
    ).rejects.toMatchObject({ code: "metadados_qr_imutavel_diverge" })

    expect(notaFiscal[0].digestValue).toBe(QR_V3_DIGEST)
    expect(notaFiscal[0].qrCodeData).toBe(QR_V3_DATA)
    expect(notaFiscal[0].urlConsulta).toBe(QR_V3_URL_CHAVE)
    expect(notaFiscal[0].status).toBe("TRANSMITINDO")
    expect(notaFiscal[0].xmlAutorizado).toBeNull()
  })

  it("replay idêntico de AUTHORIZED com metadata QR persistida é idempotente", async () => {
    const { client, notaFiscal, fiscalLogs } = createFakePrisma([
      notaAssinada({
        status: "AUTORIZADA",
        xmlAssinado: XML_ASSINADO,
        xmlAutorizado: XML_AUTORIZADO,
        protocolo: PROTOCOLO,
        cStat: "100",
        xMotivo: "Autorizado o uso da NF-e",
        digestValue: QR_V3_DIGEST,
        qrCodeData: QR_V3_DATA,
        urlConsulta: QR_V3_URL_CHAVE,
      }),
    ])
    const persistence = createPrismaUncertainStatePersistence(asPersistenceClient(client))
    const { digestValue: _d, qrCodeData: _q, urlConsulta: _u, ...semQr } = authorizedResult

    await persistence.markAuthorized({
      document: transmittingDocument,
      result: semQr,
      now: NOW,
      source: "CONSULTATION",
    })
    await persistence.markAuthorized({
      document: transmittingDocument,
      result: semQr,
      now: NOW,
      source: "CONSULTATION",
    })

    expect(notaFiscal[0].digestValue).toBe(QR_V3_DIGEST)
    expect(notaFiscal[0].qrCodeData).toBe(QR_V3_DATA)
    expect(notaFiscal[0].urlConsulta).toBe(QR_V3_URL_CHAVE)
    expect(notaFiscal[0].xmlAutorizado).toBe(XML_AUTORIZADO)
    expect(fiscalLogs.filter((log) => log.acao === "fiscal.emission.idempotent_mark").length).toBe(2)
  })
})
