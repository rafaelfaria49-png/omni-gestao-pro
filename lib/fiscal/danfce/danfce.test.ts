/**
 * DANFC-e renderizável e reimprimível sobre documento persistido (GOAL 021).
 *
 * Fixtures fiscais locais. Zero A1 real. Zero rede SEFAZ. Zero leitura viva.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { BOBINA_CHARS } from "@/lib/pdv-impressao-config"
import type { AuthorizedXmlDocument } from "@/lib/fiscal/storage"
import { buildPersistedDanfceFixture, type DanfceFixtureKind } from "./__fixtures__/persisted-nfce"
import {
  DANFCE_DOCUMENTO,
  DANFCE_MSG_CONTINGENCIA,
  DANFCE_MSG_HOMOLOGACAO,
  DANFCE_MSG_SEM_PROTOCOLO,
  DOCUMENTO_NAO_FISCAL_NAO_E_DANFCE,
  DanfceParseError,
  danfceFingerprint,
  escposQrFromPersisted,
  loadDanfceForReprint,
  parseDanfceFromPersisted,
  renderDanfceEscPos,
  renderDanfceHtml,
  renderQrSvg,
  selectNfceSpPublicUrls,
  type DanfceReprintPorts,
} from "./index"
import * as qrOnline from "./qr-v3/online"
import * as qrOffline from "./qr-v3/offline"

const HERE = dirname(fileURLToPath(import.meta.url))

function sourceOf(...files: string[]): string {
  return files.map((file) => readFileSync(resolve(HERE, file), "utf8")).join("\n")
}

function fakeReader(doc: AuthorizedXmlDocument): DanfceReprintPorts & { calls: number } {
  const port = {
    calls: 0,
    async readAuthorizedDocument(locator: { storeId: string; notaFiscalId: string }) {
      port.calls += 1
      if (locator.storeId !== doc.storeId || locator.notaFiscalId !== doc.notaFiscalId) return null
      return doc
    },
  }
  return port
}

describe("DANFC-e · documento persistido", () => {
  it("autorizado homologação: emitente, itens, totais, chave, protocolo, QR persistido e consulta oficial", async () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const encodeOnline = vi.spyOn(qrOnline, "encodeNfceQrV3Online")
    const reader = fakeReader(document)
    const model = await loadDanfceForReprint(
      { storeId: document.storeId, notaFiscalId: document.notaFiscalId },
      reader,
    )
    expect(model.documento).toBe(DANFCE_DOCUMENTO)
    expect(model.variante).toBe("autorizado")
    expect(model.ambiente).toBe("HOMOLOGACAO")
    expect(model.emitente.cnpj).toBe("11222333000181")
    expect(model.emitente.endereco).toContain("Rua das Flores")
    expect(model.itens).toHaveLength(1)
    expect(model.itens[0]?.descricao).toContain("Cabo")
    expect(model.quantidadeTotalItens).toBe("2")
    expect(model.valorTotal).toBe("50.00")
    expect(model.chaveAcesso).toBe(document.chaveAcesso)
    expect(model.protocolo).toBe(document.protocolo)
    expect(model.qrCodeData).toBe(document.qrCodeData)
    expect(model.urlConsulta).toBe(selectNfceSpPublicUrls("HOMOLOGACAO").urlChave)
    expect(model.homologacaoSemValorFiscal).toBe(true)
    expect(model.mensagensFiscais).toContain(DANFCE_MSG_HOMOLOGACAO)
    const html = renderDanfceHtml(model)
    expect(html).toContain("Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica")
    expect(html).toContain(">Cód<")
    expect(html).toContain(">Un<")
    expect(html).toContain("Consulte pela Chave de Acesso em")
    expect(encodeOnline).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    encodeOnline.mockRestore()
    fetchSpy.mockRestore()
  })

  it("homologação visual é inequívoca e não parece produção", () => {
    const { document } = buildPersistedDanfceFixture("homologacao")
    const model = parseDanfceFromPersisted(document)
    const html = renderDanfceHtml(model)
    expect(html).toContain(DANFCE_MSG_HOMOLOGACAO)
    expect(html).toContain('data-danfce-homologacao="1"')
    expect(html).toContain("background:#000;color:#fff")
    expect(html).not.toMatch(/AMBIENTE DE PRODUÇÃO/)
    const escpos = new TextDecoder("latin1").decode(renderDanfceEscPos(model))
    expect(escpos).toContain("HOMOLOG")
  })

  it("consumidor ausente, CPF e CNPJ vêm só do XML persistido", () => {
    const ausente = parseDanfceFromPersisted(buildPersistedDanfceFixture("consumidor_ausente").document)
    expect(ausente.consumidor).toEqual({ kind: "ausente" })
    expect(renderDanfceHtml(ausente)).toContain("CONSUMIDOR NÃO IDENTIFICADO")

    const cpf = parseDanfceFromPersisted(buildPersistedDanfceFixture("consumidor_cpf").document)
    expect(cpf.consumidor.kind).toBe("cpf")
    if (cpf.consumidor.kind === "cpf") expect(cpf.consumidor.cpf).toBe("12345678909")
    expect(renderDanfceHtml(cpf)).toContain("CPF:")

    const cnpj = parseDanfceFromPersisted(buildPersistedDanfceFixture("consumidor_cnpj").document)
    expect(cnpj.consumidor.kind).toBe("cnpj")
    if (cnpj.consumidor.kind === "cnpj") expect(cnpj.consumidor.cnpj).toBe("33445556000177")
    expect(renderDanfceHtml(cnpj)).toContain("CNPJ:")
  })

  it("múltiplos itens e múltiplas formas de pagamento, com troco quando persistido", () => {
    const itens = parseDanfceFromPersisted(buildPersistedDanfceFixture("multiplos_itens").document)
    expect(itens.itens).toHaveLength(2)
    expect(itens.quantidadeTotalItens).toBe("3")
    expect(itens.valorTotal).toBe("400.00")
    expect(renderDanfceHtml(itens)).toContain("Película")
    expect(renderDanfceHtml(itens)).toContain("Capa")

    const pags = parseDanfceFromPersisted(buildPersistedDanfceFixture("multiplos_pagamentos").document)
    expect(pags.pagamentos.length).toBeGreaterThanOrEqual(2)
    expect(pags.pagamentos.map((p) => p.tPag).sort()).toEqual(["01", "17"])
    expect(pags.troco).toBe("10.00")
    const html = renderDanfceHtml(pags)
    expect(html).toContain("Dinheiro")
    expect(html).toContain("PIX")
    expect(html).toContain("Troco")
  })

  it("produção usa URLs oficiais de produção e não exibe marcação de homologação", () => {
    const model = parseDanfceFromPersisted(buildPersistedDanfceFixture("producao").document)
    expect(model.ambiente).toBe("PRODUCAO")
    expect(model.tpAmb).toBe("1")
    expect(model.homologacaoSemValorFiscal).toBe(false)
    expect(model.urlConsulta).toBe(selectNfceSpPublicUrls("PRODUCAO").urlChave)
    expect(model.qrCodeData.startsWith(selectNfceSpPublicUrls("PRODUCAO").qrCodeBaseUrl)).toBe(true)
    const html = renderDanfceHtml(model)
    expect(html).not.toContain(DANFCE_MSG_HOMOLOGACAO)
    expect(html).not.toContain('data-danfce-homologacao="1"')
  })

  it("contingência tpEmis=9 usa XML persistido, marca o DANFC-e e não inventa protocolo", () => {
    const { document } = buildPersistedDanfceFixture("contingencia_sem_protocolo")
    const encodeOffline = vi.spyOn(qrOffline, "encodeNfceQrV3Offline")
    expect(document.protocolo).toBeNull()
    expect(document.xmlAutorizado).toBeNull()
    const model = parseDanfceFromPersisted(document)
    expect(model.tpEmis).toBe("9")
    expect(model.contingencia).toBe(true)
    expect(model.variante).toBe("contingencia")
    expect(model.protocolo).toBeNull()
    expect(model.mensagensFiscais).toContain(DANFCE_MSG_CONTINGENCIA)
    expect(model.mensagensFiscais).toContain(DANFCE_MSG_SEM_PROTOCOLO)
    expect(model.qrCodeData).toBe(document.qrCodeData)
    expect(encodeOffline).not.toHaveBeenCalled()
    encodeOffline.mockRestore()
    const html = renderDanfceHtml(model)
    expect(html).toContain('data-danfce-contingencia="1"')
    expect(html).toContain('data-danfce-sem-protocolo="1"')
    expect(html).toContain("não autorizado")
    const contingenciaAutorizada = parseDanfceFromPersisted(buildPersistedDanfceFixture("contingencia_tpemis_9").document)
    expect(contingenciaAutorizada.tpEmis).toBe("9")
    expect(contingenciaAutorizada.protocolo).toBeTruthy()
  })
})

describe("DANFC-e · reimpressão determinística", () => {
  it("mesmo documento persistido → mesmo modelo → mesmo conteúdo fiscal", async () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const reader = fakeReader(document)
    const first = await loadDanfceForReprint(
      { storeId: "loja-1", notaFiscalId: document.notaFiscalId },
      reader,
    )
    const second = await loadDanfceForReprint(
      { storeId: "loja-1", notaFiscalId: document.notaFiscalId },
      reader,
    )
    expect(danfceFingerprint(first)).toBe(danfceFingerprint(second))
    expect(renderDanfceHtml(first)).toBe(renderDanfceHtml(second))
    expect(Buffer.from(renderDanfceEscPos(first))).toEqual(Buffer.from(renderDanfceEscPos(second)))
    expect(reader.calls).toBe(2)
  })

  it("documento AUTORIZADO antigo com tPag 17 continua reimprimível (XML persistido, sem reconstruir pagamento)", async () => {
    const { document } = buildPersistedDanfceFixture("multiplos_pagamentos")
    expect(document.status).toBe("AUTORIZADA")
    expect(document.protocolo).toBeTruthy()
    expect(document.xmlAutorizado).toMatch(/<tPag>17<\/tPag>/)
    const reader = fakeReader(document)
    const model = await loadDanfceForReprint(
      { storeId: document.storeId, notaFiscalId: document.notaFiscalId },
      reader,
    )
    expect(model.variante).toBe("autorizado")
    expect(model.pagamentos.map((p) => p.tPag).sort()).toEqual(["01", "17"])
    expect(model.troco).toBe("10.00")
    expect(reader.calls).toBe(1)
    expect(document.xmlAutorizado).toContain("<vTroco>10.00</vTroco>")
  })

  it("NFC-e AUTORIZADA com tPag 17 sem card (XML legado) reimprime o XML persistido", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const xmlLegado = String(document.xmlAutorizado).replace(
      /<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>/,
      "<tPag>17</tPag><vPag>50.00</vPag>",
    )
    const legado = { ...document, xmlAutorizado: xmlLegado, xmlAssinado: xmlLegado }
    expect(legado.xmlAutorizado).toMatch(/<tPag>17<\/tPag>/)
    expect(legado.xmlAutorizado).not.toContain("<card>")
    const model = parseDanfceFromPersisted(legado)
    expect(model.pagamentos.map((p) => p.tPag)).toEqual(["17"])
    expect(renderDanfceHtml(model)).not.toContain("tpIntegra")
  })

  it("NFC-e AUTORIZADA com PIX 17 + card/tpIntegra=2 reimprime sem reconstruir YA04", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const xmlCard = String(document.xmlAutorizado).replace(
      /<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>/,
      "<tPag>17</tPag><vPag>50.00</vPag><card><tpIntegra>2</tpIntegra></card>",
    )
    const withCard = { ...document, xmlAutorizado: xmlCard, xmlAssinado: xmlCard }
    expect(withCard.xmlAutorizado).toContain("<tpIntegra>2</tpIntegra>")
    const model = parseDanfceFromPersisted(withCard)
    expect(model.pagamentos.map((p) => p.tPag)).toEqual(["17"])
    expect(renderDanfceHtml(model)).not.toContain("tpIntegra")
  })

  it("NFC-e AUTORIZADA com tPag 03 sem card (XML legado) reimprime o XML persistido", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const xmlLegado = String(document.xmlAutorizado).replace(
      /<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>/,
      "<tPag>03</tPag><vPag>50.00</vPag>",
    )
    const legado = { ...document, xmlAutorizado: xmlLegado, xmlAssinado: xmlLegado }
    expect(legado.xmlAutorizado).toMatch(/<tPag>03<\/tPag>/)
    expect(legado.xmlAutorizado).not.toContain("<card>")
    const model = parseDanfceFromPersisted(legado)
    expect(model.pagamentos.map((p) => p.tPag)).toEqual(["03"])
    expect(renderDanfceHtml(model)).toContain("50")
  })

  it("NFC-e AUTORIZADA com card/tpIntegra=2 reimprime sem reconstruir YA04", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const xmlCard = String(document.xmlAutorizado).replace(
      /<tPag>01<\/tPag>\s*<vPag>50\.00<\/vPag>/,
      "<tPag>04</tPag><vPag>50.00</vPag><card><tpIntegra>2</tpIntegra></card>",
    )
    const withCard = { ...document, xmlAutorizado: xmlCard, xmlAssinado: xmlCard }
    expect(withCard.xmlAutorizado).toContain("<tpIntegra>2</tpIntegra>")
    const model = parseDanfceFromPersisted(withCard)
    expect(model.pagamentos.map((p) => p.tPag)).toEqual(["04"])
    expect(renderDanfceHtml(model)).not.toContain("tpIntegra")
  })

  it("QR de reimpressão é o persistido, não recalculado, e aparece no HTML/ESC/POS", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const encodeOnline = vi.spyOn(qrOnline, "encodeNfceQrV3Online")
    const model = parseDanfceFromPersisted(document)
    const qr = document.qrCodeData
    expect(qr).toBeTruthy()
    if (!qr) return
    const html = renderDanfceHtml(model)
    expect(html).toContain(`data-qr-payload="${qr}"`)
    expect(html).toContain(qr.replace(/&/g, "&amp;"))
    const svg = renderQrSvg(qr)
    expect(svg).toContain(`data-qr-payload="${qr}"`)
    const qrBytes = escposQrFromPersisted(qr)
    expect(Buffer.from(qrBytes).includes(Buffer.from(qr, "utf8"))).toBe(true)
    expect(encodeOnline).not.toHaveBeenCalled()
    encodeOnline.mockRestore()
  })

  it("rejeita URL não oficial e QR divergente da chave", () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    expect(() =>
      parseDanfceFromPersisted({
        ...document,
        qrCodeData: "https://qr.example.test/nfce?p=x",
        urlConsulta: document.urlConsulta,
      }),
    ).toThrow(DanfceParseError)
    expect(() =>
      parseDanfceFromPersisted({
        ...document,
        urlConsulta: "https://consulta.example.test/nfce",
        xmlAutorizado: document.xmlAutorizado,
      }),
    ).toThrow(DanfceParseError)
    const fakeQr = `${selectNfceSpPublicUrls("HOMOLOGACAO").qrCodeBaseUrl}?p=${"0".repeat(44)}|3|2`
    expect(() =>
      parseDanfceFromPersisted({
        ...document,
        qrCodeData: fakeQr,
        xmlAutorizado: document.xmlAutorizado?.replace(document.qrCodeData ?? "", fakeQr) ?? null,
        xmlAssinado: document.xmlAssinado?.replace(document.qrCodeData ?? "", fakeQr) ?? null,
      }),
    ).toThrow(/não corresponde à chave/)
  })

  it("isolamento por loja: reader de outra store não reimprime", async () => {
    const { document } = buildPersistedDanfceFixture("autorizado_simples")
    const reader = fakeReader(document)
    await expect(
      loadDanfceForReprint({ storeId: "loja-outra", notaFiscalId: document.notaFiscalId }, reader),
    ).rejects.toMatchObject({ code: "nota_nao_encontrada" })
  })
})

describe("DANFC-e · zero leitura viva, zero rede, distinção não fiscal", () => {
  const kinds: DanfceFixtureKind[] = [
    "autorizado_simples",
    "homologacao",
    "consumidor_ausente",
    "consumidor_cpf",
    "consumidor_cnpj",
    "multiplos_itens",
    "multiplos_pagamentos",
    "contingencia_sem_protocolo",
  ]

  it("camada DANFC-e não lê Venda/Produto/Cliente vivos nem recalcula QR", () => {
    const src = sourceOf(
      "parse-persisted.ts",
      "reprint.ts",
      "render-html.ts",
      "render-escpos.ts",
      "print.ts",
      "types.ts",
    )
    expect(src).not.toMatch(/prisma\.(venda|produto|cliente|Venda|Produto|Cliente)/)
    expect(src).not.toMatch(/encodeNfceQrV3(Online|Offline)/)
    expect(src).not.toMatch(/statusServico|NFeAutorizacao|fetch\(/)
    expect(src).not.toMatch(/derivePagamentoFiscal|assertPagamentoFiscalCanonico|from-venda-breakdown/)
    expect(src).toMatch(/qrCodeData/)
  })

  it("HTML fiscal nunca se autodenomina comprovante não fiscal", () => {
    for (const kind of kinds) {
      const html = renderDanfceHtml(parseDanfceFromPersisted(buildPersistedDanfceFixture(kind).document))
      expect(html).toContain('data-documento="DANFCE"')
      expect(html).not.toContain("DOCUMENTO NÃO FISCAL")
      expect(html).not.toContain(DOCUMENTO_NAO_FISCAL_NAO_E_DANFCE)
    }
  })

  it("comprovante comercial existente declara que não é DANFC-e", () => {
    const cupom = readFileSync(resolve(process.cwd(), "components/dashboard/vendas/cupom-nao-fiscal.tsx"), "utf8")
    expect(cupom).toContain("DOCUMENTO NÃO FISCAL")
    expect(cupom).toContain(DOCUMENTO_NAO_FISCAL_NAO_E_DANFCE)
    const title = cupom.match(/<DialogTitle[\s\S]*?<\/DialogTitle>/)?.[0] ?? ""
    expect(title).toContain("Cupom / Recibo Não Fiscal")
    expect(title).not.toContain("DANFC")
  })

  it("impressão reutiliza 80mm e preserva 58mm do stack existente", () => {
    expect(BOBINA_CHARS["58mm"]).toBe(32)
    expect(BOBINA_CHARS["80mm"]).toBe(48)
    const model = parseDanfceFromPersisted(buildPersistedDanfceFixture("autorizado_simples").document)
    const bytes58 = renderDanfceEscPos(model, { maxChars: 32, qrModuleSize: 3 })
    const bytes80 = renderDanfceEscPos(model, { maxChars: 48, qrModuleSize: 4 })
    expect(bytes58.byteLength).toBeGreaterThan(100)
    expect(bytes80.byteLength).toBeGreaterThan(100)
    const printSrc = sourceOf("print.ts")
    expect(printSrc).toContain("openThermalHtmlPrint")
    expect(printSrc).toContain("printWithFallback")
    expect(printSrc).toContain("58mm")
    expect(printSrc).toContain("80mm")
  })

  it("nenhuma rede durante parse/render das fixtures", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    for (const kind of kinds) {
      const model = parseDanfceFromPersisted(buildPersistedDanfceFixture(kind).document)
      renderDanfceHtml(model)
      renderDanfceEscPos(model)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
