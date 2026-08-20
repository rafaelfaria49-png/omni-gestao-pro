/**
 * Contador HUB · GOAL 018 — matriz do reader fiscal (Opção A).
 * Sem Prisma real, sem FiscalLog, sem SEFAZ.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { resolvePeriodoUtc } from "@/lib/contador/competencia"
import {
  STATUS_NOTA_FISCAL,
  avaliarEntregavel,
  classificarNotasFiscais,
  extractDhEmiFromXml,
  fiscalReaderHabilitado,
  lerNotasFiscais,
  parseDhEmiInstant,
  parseStoreAllowlist,
  resolverAcessoFiscal,
  storeAllowlisted,
  type FiscalReaderClient,
  type NotaFiscalRow,
} from "@/lib/contador/readers/fiscal"
import {
  DHEMI_COMPETENCIA,
  DHEMI_COMPETENCIA_Z,
  DHEMI_SEM_OFFSET,
  DHEMI_SO_DATA,
  STORE_A,
  STORE_B,
  XML_AUTORIZADA_COMPETENCIA,
  XML_AUTORIZADA_DHEMI_INVALIDO,
  XML_AUTORIZADA_DHEMI_Z,
  XML_AUTORIZADA_FORA,
  XML_AUTORIZADA_SEM_OFFSET,
  XML_AUTORIZADA_SO_DATA,
  XML_DHEMI_DUPLICADO,
  XML_DHEMI_VAZIO,
  XML_SEM_DHEMI,
} from "@/lib/contador/homologation"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"

const COMPETENCIA = { ano: 2026, mes: 7 }
const PERIODO = resolvePeriodoUtc(COMPETENCIA)
const PERIODO_JUNHO = resolvePeriodoUtc({ ano: 2026, mes: 6 })
const PERIODO_AGOSTO = resolvePeriodoUtc({ ano: 2026, mes: 8 })
const CHAVE_OK = "35260700000000000000000000000000000000000001"

const ENV_ON = {
  CONTADOR_FISCAL_READER: "on",
  CONTADOR_FISCAL_READER_STORE_ALLOWLIST: STORE_A,
} as const

const scopeA = {
  ok: true,
  storeId: STORE_A,
  userId: "u-test",
  permissaoContador: true,
} as unknown as ContadorScopeInterno

function nota(partial: Partial<NotaFiscalRow> = {}): NotaFiscalRow {
  return {
    id: partial.id ?? "nota-ok",
    storeId: STORE_A,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000001",
    chaveAcesso: CHAVE_OK,
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
    cStat: "100",
    ...partial,
  }
}

function cliente(rows: NotaFiscalRow[], fail = false): FiscalReaderClient {
  return {
    notaFiscal: {
      findMany: async (args) => {
        if (fail) throw new Error("boom")
        const storeId = (args.where as { storeId: string }).storeId
        return rows.filter((r) => r.storeId === storeId)
      },
    },
  }
}

describe("CONTADOR_FISCAL_READER flag e allowlist", () => {
  it("default off — ausência não é on", () => {
    expect(fiscalReaderHabilitado({})).toBe(false)
    expect(fiscalReaderHabilitado({ CONTADOR_FISCAL_READER: "off" })).toBe(false)
    expect(fiscalReaderHabilitado({ CONTADOR_FISCAL_READER: "ON" })).toBe(false)
    expect(fiscalReaderHabilitado({ CONTADOR_FISCAL_READER: " on " })).toBe(false)
    expect(fiscalReaderHabilitado({ CONTADOR_FISCAL_READER: "true" })).toBe(false)
  })

  it("liga somente com valor exato on", () => {
    expect(fiscalReaderHabilitado({ CONTADOR_FISCAL_READER: "on" })).toBe(true)
  })

  it("allowlist ausente/vazia é inválida (não lista vazia de lojas)", () => {
    expect(parseStoreAllowlist({})).toBeNull()
    expect(parseStoreAllowlist({ CONTADOR_FISCAL_READER_STORE_ALLOWLIST: "" })).toBeNull()
    expect(parseStoreAllowlist({ CONTADOR_FISCAL_READER_STORE_ALLOWLIST: "  ,  " })).toBeNull()
  })

  it("allowlist CSV env-only", () => {
    expect(parseStoreAllowlist({ CONTADOR_FISCAL_READER_STORE_ALLOWLIST: `${STORE_A}, ${STORE_B}` })).toEqual([
      STORE_A,
      STORE_B,
    ])
    expect(storeAllowlisted(STORE_A, ENV_ON)).toBe(true)
    expect(storeAllowlisted(STORE_B, ENV_ON)).toBe(false)
  })

  it("flag off → nao_disponivel (não consulta)", async () => {
    const acesso = resolverAcessoFiscal(STORE_A, { CONTADOR_FISCAL_READER: "off" })
    expect(acesso).toEqual({ ok: false, motivo: "flag_off" })
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: { CONTADOR_FISCAL_READER: "off" },
      cliente: cliente([nota()]),
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.motivo).toBe("flag_off")
    expect(leitura.entregaveis).toHaveLength(0)
  })

  it("store fora da allowlist → nao_disponivel", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: { CONTADOR_FISCAL_READER: "on", CONTADOR_FISCAL_READER_STORE_ALLOWLIST: STORE_B },
      cliente: cliente([nota()]),
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.motivo).toBe("store_nao_allowlisted")
    expect(leitura.entregaveis).toHaveLength(0)
  })

  it("flag on sem allowlist → config_invalida", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: { CONTADOR_FISCAL_READER: "on" },
      cliente: cliente([nota()]),
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.motivo).toBe("config_invalida")
  })

  it("falha de reader ≠ zero", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: ENV_ON,
      cliente: cliente([], true),
    })
    expect(leitura.disponivel).toBe(false)
    expect(leitura.leituraOk).toBe(false)
    expect(leitura.motivo).toBe("leitura_falhou")
    expect(leitura.entregaveis).toHaveLength(0)
  })
})

describe("predicado entregável ADR-007", () => {
  it("AUTORIZADA válida entra", () => {
    expect(avaliarEntregavel(nota(), STORE_A, PERIODO).entregavel).toBe(true)
  })

  it("AUTORIZADA sem protocolo não entra", () => {
    expect(avaliarEntregavel(nota({ protocolo: null }), STORE_A, PERIODO).entregavel).toBe(false)
    expect(avaliarEntregavel(nota({ protocolo: "   " }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("AUTORIZADA sem chave não entra", () => {
    expect(avaliarEntregavel(nota({ chaveAcesso: null }), STORE_A, PERIODO).entregavel).toBe(false)
    expect(avaliarEntregavel(nota({ chaveAcesso: "" }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("AUTORIZADA sem XML não entra", () => {
    expect(avaliarEntregavel(nota({ xmlAutorizado: null }), STORE_A, PERIODO).entregavel).toBe(false)
    expect(avaliarEntregavel(nota({ xmlAutorizado: "" }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("dhEmi com offset -03:00 entra", () => {
    expect(extractDhEmiFromXml(XML_AUTORIZADA_COMPETENCIA)).toBe(DHEMI_COMPETENCIA)
    expect(parseDhEmiInstant(DHEMI_COMPETENCIA)).not.toBeNull()
    expect(avaliarEntregavel(nota(), STORE_A, PERIODO).entregavel).toBe(true)
  })

  it("dhEmi com Z entra", () => {
    expect(extractDhEmiFromXml(XML_AUTORIZADA_DHEMI_Z)).toBe(DHEMI_COMPETENCIA_Z)
    expect(parseDhEmiInstant(DHEMI_COMPETENCIA_Z)).not.toBeNull()
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_AUTORIZADA_DHEMI_Z }), STORE_A, PERIODO).entregavel).toBe(true)
  })

  it("dhEmi sem offset é rejeitado (não completa timezone)", () => {
    expect(extractDhEmiFromXml(XML_AUTORIZADA_SEM_OFFSET)).toBe(DHEMI_SEM_OFFSET)
    expect(parseDhEmiInstant(DHEMI_SEM_OFFSET)).toBeNull()
    expect(parseDhEmiInstant(DHEMI_SO_DATA)).toBeNull()
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_AUTORIZADA_SEM_OFFSET }), STORE_A, PERIODO).entregavel).toBe(false)
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_AUTORIZADA_SO_DATA }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("dhEmi duplicado é rejeitado (não usa primeiro match)", () => {
    expect(extractDhEmiFromXml(XML_DHEMI_DUPLICADO)).toBeNull()
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_DHEMI_DUPLICADO }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("dhEmi vazio é rejeitado", () => {
    expect(extractDhEmiFromXml(XML_DHEMI_VAZIO)).toBeNull()
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_DHEMI_VAZIO }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("dhEmi ausente/inválido não entra", () => {
    expect(extractDhEmiFromXml(XML_SEM_DHEMI)).toBeNull()
    expect(parseDhEmiInstant("nao-e-instante")).toBeNull()
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_SEM_DHEMI }), STORE_A, PERIODO).entregavel).toBe(false)
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_AUTORIZADA_DHEMI_INVALIDO }), STORE_A, PERIODO).entregavel).toBe(
      false,
    )
  })

  it("dhEmi fora da competência não entra", () => {
    expect(avaliarEntregavel(nota({ xmlAutorizado: XML_AUTORIZADA_FORA }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("namespace XML prefixado continua extraível quando há exatamente 1 dhEmi", () => {
    const xmlNs = XML_AUTORIZADA_COMPETENCIA.replaceAll("<dhEmi>", "<nfe:dhEmi>").replaceAll("</dhEmi>", "</nfe:dhEmi>")
    expect(extractDhEmiFromXml(xmlNs)).toBe(DHEMI_COMPETENCIA)
    expect(avaliarEntregavel(nota({ xmlAutorizado: xmlNs }), STORE_A, PERIODO).entregavel).toBe(true)
  })

  it("REJEITADA não entra", () => {
    expect(avaliarEntregavel(nota({ status: "REJEITADA", xmlAutorizado: null, protocolo: null }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("cStat 110 persistido REJEITADA não entra", () => {
    const row = nota({
      status: "REJEITADA",
      cStat: "110",
      xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
      protocolo: "x",
    })
    expect(avaliarEntregavel(row, STORE_A, PERIODO).entregavel).toBe(false)
    const classif = classificarNotasFiscais([row], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(0)
    expect(classif.rejeitadas).toHaveLength(1)
  })

  it("CANCELADA não entra", () => {
    expect(avaliarEntregavel(nota({ status: "CANCELADA" }), STORE_A, PERIODO).entregavel).toBe(false)
    const classif = classificarNotasFiscais([nota({ id: "c", status: "CANCELADA" })], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(0)
    expect(classif.canceladas).toHaveLength(1)
  })

  it("PRODUCAO não entra", () => {
    expect(avaliarEntregavel(nota({ ambiente: "PRODUCAO" }), STORE_A, PERIODO).entregavel).toBe(false)
  })

  it("outra storeId não vaza", () => {
    const b = nota({ id: "loja-b", storeId: STORE_B, chaveAcesso: "35260700000000000000000000000000000000000006" })
    expect(avaliarEntregavel(b, STORE_A, PERIODO).entregavel).toBe(false)
    const classif = classificarNotasFiscais([nota(), b], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(1)
    expect(classif.entregaveis[0]?.storeId).toBe(STORE_A)
  })

  it("matriz completa de StatusNotaFiscal — só AUTORIZADA pode ser entregável", () => {
    expect(STATUS_NOTA_FISCAL).toHaveLength(11)
    for (const status of STATUS_NOTA_FISCAL) {
      const row = nota({ id: `s-${status}`, status })
      const av = avaliarEntregavel(row, STORE_A, PERIODO)
      if (status === "AUTORIZADA") expect(av.entregavel).toBe(true)
      else expect(av.entregavel, status).toBe(false)
    }
  })

  it("vigente=false não entra", () => {
    expect(avaliarEntregavel(nota({ vigente: false }), STORE_A, PERIODO).entregavel).toBe(false)
  })
})

describe("sinais REJEITADA/CANCELADA por competência (fail-closed)", () => {
  it("REJEITADA sem dhEmi não aparece no mês nem se repete em outras competências", () => {
    const row = nota({
      id: "rej-sem-dhemi",
      status: "REJEITADA",
      xmlAutorizado: null,
      protocolo: null,
    })
    expect(avaliarEntregavel(row, STORE_A, PERIODO).entregavel).toBe(false)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO).rejeitadas).toHaveLength(0)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO_JUNHO).rejeitadas).toHaveLength(0)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO_AGOSTO).rejeitadas).toHaveLength(0)
  })

  it("REJEITADA com dhEmi no período aparece", () => {
    const row = nota({
      id: "rej-ok",
      status: "REJEITADA",
      xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
      protocolo: null,
    })
    const classif = classificarNotasFiscais([row], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(0)
    expect(classif.rejeitadas).toHaveLength(1)
  })

  it("REJEITADA fora do período não aparece", () => {
    const row = nota({
      id: "rej-fora",
      status: "REJEITADA",
      xmlAutorizado: XML_AUTORIZADA_FORA,
      protocolo: null,
    })
    expect(classificarNotasFiscais([row], STORE_A, PERIODO).rejeitadas).toHaveLength(0)
  })

  it("CANCELADA sem dhEmi não aparece no mês nem se repete em outras competências", () => {
    const row = nota({
      id: "canc-sem-dhemi",
      status: "CANCELADA",
      xmlAutorizado: XML_SEM_DHEMI,
    })
    expect(avaliarEntregavel(row, STORE_A, PERIODO).entregavel).toBe(false)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO).canceladas).toHaveLength(0)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO_JUNHO).canceladas).toHaveLength(0)
    expect(classificarNotasFiscais([row], STORE_A, PERIODO_AGOSTO).canceladas).toHaveLength(0)
  })

  it("CANCELADA com dhEmi no período aparece", () => {
    const row = nota({ id: "canc-ok", status: "CANCELADA" })
    const classif = classificarNotasFiscais([row], STORE_A, PERIODO)
    expect(classif.entregaveis).toHaveLength(0)
    expect(classif.canceladas).toHaveLength(1)
  })

  it("CANCELADA fora do período não aparece", () => {
    const row = nota({
      id: "canc-fora",
      status: "CANCELADA",
      xmlAutorizado: XML_AUTORIZADA_FORA,
    })
    expect(classificarNotasFiscais([row], STORE_A, PERIODO).canceladas).toHaveLength(0)
  })

  it("REJEITADA/CANCELADA sem offset ou com dhEmi duplicado não entram no sinal", () => {
    expect(
      classificarNotasFiscais(
        [nota({ id: "rej-naive", status: "REJEITADA", xmlAutorizado: XML_AUTORIZADA_SEM_OFFSET, protocolo: null })],
        STORE_A,
        PERIODO,
      ).rejeitadas,
    ).toHaveLength(0)
    expect(
      classificarNotasFiscais(
        [nota({ id: "canc-dup", status: "CANCELADA", xmlAutorizado: XML_DHEMI_DUPLICADO })],
        STORE_A,
        PERIODO,
      ).canceladas,
    ).toHaveLength(0)
  })
})

describe("lerNotasFiscais SELECT isolado", () => {
  it("AUTORIZADA válida entra e XML é o texto persistido", async () => {
    const leitura = await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: ENV_ON,
      cliente: cliente([nota()]),
    })
    expect(leitura.disponivel).toBe(true)
    expect(leitura.entregaveis).toHaveLength(1)
    expect(leitura.entregaveis[0]?.xmlAutorizado).toBe(XML_AUTORIZADA_COMPETENCIA)
  })

  it("where usa somente scope.storeId", async () => {
    let where: unknown
    const c: FiscalReaderClient = {
      notaFiscal: {
        findMany: async (args) => {
          where = args.where
          return [nota()]
        },
      },
    }
    await lerNotasFiscais(scopeA, COMPETENCIA, { env: ENV_ON, cliente: c })
    expect(where).toEqual({ storeId: STORE_A })
  })

  it("módulo do reader A não chama xml-storage-reader nem grava FiscalLog", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../readers/fiscal.ts"),
      "utf8",
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toContain("readAuthorizedDocument")
    expect(code).not.toMatch(/xml-storage-reader|fiscalXmlReader/)
    expect(code).not.toMatch(/fiscalLog\.(create|update|upsert)/i)
    expect(code).not.toMatch(/eventoFiscal\.(create|update|upsert)/i)
    expect(code).toContain("findMany")
  })

  it("reader não gera FiscalLog", async () => {
    let creates = 0
    const wrapped = {
      notaFiscal: { findMany: async () => [nota()] },
      fiscalLog: {
        create: async () => {
          creates += 1
          throw new Error("FiscalLog proibido no reader A")
        },
      },
    }
    await lerNotasFiscais(scopeA, COMPETENCIA, {
      env: ENV_ON,
      cliente: wrapped as unknown as FiscalReaderClient,
    })
    expect(creates).toBe(0)
  })
})
