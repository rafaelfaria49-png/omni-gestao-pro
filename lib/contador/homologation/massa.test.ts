import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { DHEMI_COMPETENCIA, DHEMI_FORA_COMPETENCIA, XML_SEM_DHEMI } from "./xml-fixtures"
import { COMPETENCIA_REF, LINHAS_MASSA, STORE_A, STORE_B } from "./massa"

const DIR = dirname(fileURLToPath(import.meta.url))

function fonteHomologacao(): string {
  const arquivos = ["guard-url.ts", "xml-fixtures.ts", "massa.ts", "seed.ts", "index.ts"]
  return arquivos.map((nome) => readFileSync(join(DIR, nome), "utf8")).join("\n")
}

describe("massa HOMOLOGACAO mínima", () => {
  it("tem os 7 casos da auditoria, chaves e localKeys únicos", () => {
    expect(LINHAS_MASSA).toHaveLength(7)
    expect(new Set(LINHAS_MASSA.map((l) => l.caso)).size).toBe(7)
    expect(new Set(LINHAS_MASSA.map((l) => l.chaveAcesso)).size).toBe(7)
    expect(new Set(LINHAS_MASSA.map((l) => l.pedidoId)).size).toBe(7)
    expect(new Set(LINHAS_MASSA.map((l) => `${l.storeId}:${l.localKey}`)).size).toBe(7)
    expect(COMPETENCIA_REF).toEqual({ ano: 2026, mes: 7 })
  })

  it("caminho feliz é AUTORIZADA + HOMOLOGACAO + vigente + protocolo + dhEmi na competência", () => {
    const ok = LINHAS_MASSA.find((l) => l.caso === "autorizada_homologacao_vigente_dhemi_ok")
    expect(ok).toMatchObject({
      storeId: STORE_A,
      status: "AUTORIZADA",
      ambiente: "HOMOLOGACAO",
      vigente: true,
    })
    expect(ok?.protocolo).toBeTruthy()
    expect(ok?.xmlAutorizado).toContain(`<dhEmi>${DHEMI_COMPETENCIA}</dhEmi>`)
    expect(ok?.xmlAutorizado).toContain("<tpAmb>2</tpAmb>")
  })

  it("casos negativos cobrem competência, dhEmi, rejeição, cancelamento, outra loja e PRODUCAO", () => {
    const fora = LINHAS_MASSA.find((l) => l.caso === "autorizada_fora_competencia")
    expect(fora?.xmlAutorizado).toContain(`<dhEmi>${DHEMI_FORA_COMPETENCIA}</dhEmi>`)

    const dhemi = LINHAS_MASSA.find((l) => l.caso === "autorizada_dhemi_invalido")
    expect(dhemi?.xmlAutorizado).toContain("<dhEmi>nao-e-instante</dhEmi>")

    const rej = LINHAS_MASSA.find((l) => l.caso === "rejeitada")
    expect(rej?.xmlAutorizado).toBeNull()
    expect(rej?.status).toBe("REJEITADA")

    const canc = LINHAS_MASSA.find((l) => l.caso === "cancelada_sintetica_politica_negativa")
    expect(canc?.status).toBe("CANCELADA")
    expect(canc?.xmlAutorizado).toBeTruthy()

    const outra = LINHAS_MASSA.find((l) => l.caso === "outra_storeId")
    expect(outra?.storeId).toBe(STORE_B)

    const prod = LINHAS_MASSA.find((l) => l.caso === "producao_caso_negativo")
    expect(prod?.ambiente).toBe("PRODUCAO")
    expect(prod?.storeId).toBe(STORE_A)
  })

  it("expõe XML sem dhEmi como fixture derivada, sem reconstruir na leitura", () => {
    expect(XML_SEM_DHEMI).not.toContain("<dhEmi>")
    expect(XML_SEM_DHEMI).toContain("<NFe")
  })
})

describe("isolamento do módulo de homologação", () => {
  it("não importa reader Fiscal com log, SEFAZ, emission nem lib/prisma", () => {
    const fonte = fonteHomologacao()
    expect(fonte).not.toMatch(/xml-storage-reader/)
    expect(fonte).not.toMatch(/readAuthorizedDocument/)
    expect(fonte).not.toMatch(/fiscalLog\.create/)
    expect(fonte).not.toMatch(/lib\/prisma/)
    expect(fonte).not.toMatch(/lib\/fiscal\/emission/)
    expect(fonte).not.toMatch(/SefazDireto/)
    expect(fonte).not.toMatch(/readers\/fiscal/)
  })
})
