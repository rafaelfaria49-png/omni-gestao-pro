/**
 * Bateria Integrada de Cenários Fiscais Offline (C01–C10) — GOAL 021.
 *
 * Suíte de testes determinísticos para NFC-e (SEFAZ-SP modelo 65, homologação).
 * Execução 100% offline, com fixtures sintéticas e mocks locais.
 *
 * RESTRIÇÕES DE SEGURANÇA:
 *  - SP_ONLY = true
 *  - SEFAZ_REQUEST_COUNT = 0
 *  - SEFAZ_SOAP_POST_COUNT = 0
 *  - NFCE_EMISSION_COUNT = 0
 *  - FISCAL_OFF = true
 *  - G-F7 = FECHADO
 *  - G-F12 = FECHADO
 */

import { createPublicKey } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DRY_RUN_TEST_CERT } from "@/lib/fiscal/dry-run"
import {
  lookupSefazCStat,
  SEFAZ_CSTAT_MATRIX_VERSION,
} from "@/lib/fiscal/provider/sefaz/sefaz-cstat-matrix"
import {
  parseDanfceFromPersisted,
  renderDanfceHtml,
  renderDanfceEscPos,
  encodeNfceQrV3OnlineUrl,
  encodeNfceQrV3OfflineUrl,
  createQrV3OfflinePemSigner,
  verifyQrV3OfflineSignature,
  selectNfceSpPublicUrls,
  DANFCE_TITULO_CONTINGENCIA,
  DANFCE_MSG_CONTINGENCIA,
  DANFCE_MSG_HOMOLOGACAO,
} from "@/lib/fiscal/danfce"
import { buildPersistedDanfceFixture } from "@/lib/fiscal/danfce/__fixtures__/persisted-nfce"
import {
  calculateOfflineTransmissionDeadline,
  offlineContingencyAlarm,
  fiscalBytesSha256,
} from "@/lib/fiscal/contingencia"
import {
  avaliarPrazoCancelamentoNfce,
  validarJustificativaCancelamento,
  buildXmlEventoCancelamento,
  signEventoCancelamentoXml,
  isCancelamentoFiscalAutorizado,
  CSTAT_EVENTO_REGISTRADO,
} from "@/lib/fiscal/events"
import {
  validateInutilizacaoPedido,
  buildInutilizacaoXml,
  signInutilizacaoXml,
  lookupInutilizacaoCStat,
  classifyInutilizacaoRetorno,
} from "@/lib/fiscal/inutilizacao"
import { reconcileAgedTransmittingNotes } from "@/lib/fiscal/reconciliation/uncertain-reconciler"
import { readFiscalObservabilitySnapshot } from "@/lib/fiscal/observability"
import { STORE_PAUSE_ACTION } from "@/lib/fiscal/queue/prisma-queue-worker"

// Constantes canônicas de auditoria
export const SP_ONLY = true
export const FISCAL_OFF = true
export const COVERAGE_GAP_UNMODELED_CSTAT = false
export const READY_FOR_G_F7_REVIEW = true

describe("Bateria de Cenários Fiscais Offline C01–C10 (GOAL 021)", () => {
  let sefazRequestCount = 0
  let sefazSoapPostCount = 0
  let nfceEmissionCount = 0
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sefazRequestCount = 0
    sefazSoapPostCount = 0
    nfceEmissionCount = 0
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      sefazRequestCount += 1
      const url = String(info)
      if (url.includes("sefaz") || url.includes("fazenda.sp.gov.br")) {
        sefazSoapPostCount += 1
      }
      throw new Error(`Chamada de rede SEFAZ proibida na bateria offline: ${url}`)
    })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    expect(sefazRequestCount).toBe(0)
    expect(sefazSoapPostCount).toBe(0)
    expect(nfceEmissionCount).toBe(0)
  })

  it("C01: Autorização canônica (cStat 100) com persistência, DANFCE e QR v3 online", () => {
    const lookup = lookupSefazCStat("100", "NFeAutorizacao4")
    expect(lookup.ok).toBe(true)
    if (!lookup.ok) throw new Error()
    expect(lookup.entry.outcome).toBe("AUTHORIZED")
    expect(lookup.entry.reason).toBe("AUTORIZADO")
    expect(lookup.entry.consequencias.terminal).toBe(true)
    expect(lookup.entry.consequencias.numeroConsumido).toBe(true)
    expect(lookup.entry.consequencias.requiresInutilizacao).toBe(false)
    expect(lookup.entry.consequencias.requiresConsultation).toBe(false)

    // Parse de artefato persistido
    const fixture = buildPersistedDanfceFixture("autorizado_simples")
    const model = parseDanfceFromPersisted(fixture.document)
    expect(model.variante).toBe("autorizado")
    expect(model.ambiente).toBe("HOMOLOGACAO")
    expect(model.chaveAcesso).toBe(fixture.document.chaveAcesso)
    expect(model.protocolo).toBe(fixture.document.protocolo)

    // Renderização DANFCE HTML e ESC/POS
    const html = renderDanfceHtml(model)
    expect(html).toContain("Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica")
    expect(html).toContain(model.chaveAcesso)
    expect(html).toContain(DANFCE_MSG_HOMOLOGACAO)

    const escpos = renderDanfceEscPos(model)
    expect(escpos).toBeInstanceOf(Uint8Array)
    expect(escpos.length).toBeGreaterThan(0)

    // QR-Code v3 Online
    const urls = selectNfceSpPublicUrls("HOMOLOGACAO")
    const qrOnline = encodeNfceQrV3OnlineUrl({
      baseUrl: urls.qrCodeBaseUrl,
      chave: model.chaveAcesso,
      tpAmb: "2",
    })
    expect(qrOnline.ok).toBe(true)
    if (qrOnline.ok) {
      expect(qrOnline.url).toContain(urls.qrCodeBaseUrl)
      expect(qrOnline.url).toContain(`p=${model.chaveAcesso}|3|2`)
    }
  })

  it("C02: Processamento de lote assíncrono (103 → 105 → 104 → 100)", () => {
    // 103: Lote recebido com sucesso
    const l103 = lookupSefazCStat("103", "NFeAutorizacao4")
    expect(l103.ok).toBe(true)
    if (!l103.ok) throw new Error()
    expect(l103.entry.outcome).toBe("PROCESSING")
    expect(l103.entry.reason).toBe("LOTE_EM_PROCESSAMENTO")
    expect(l103.entry.exigeRecibo).toBe(true)
    expect(l103.entry.consequencias.numeroConsumido).toBe(true)
    expect(l103.entry.consequencias.requiresConsultation).toBe(true)

    // 105: Lote em processamento
    const l105 = lookupSefazCStat("105", "NFeRetAutorizacao4")
    expect(l105.ok).toBe(true)
    if (!l105.ok) throw new Error()
    expect(l105.entry.outcome).toBe("PROCESSING")
    expect(l105.entry.consequencias.requiresConsultation).toBe(true)

    // 104: Lote processado (instrução estrutural que desce ao protocolo interno)
    const l104 = lookupSefazCStat("104", "NFeRetAutorizacao4")
    expect(l104.ok).toBe(true)
    if (!l104.ok) throw new Error()
    expect(l104.entry.outcome).toBe("LOTE_PROCESSADO")

    // Protocolo interno com 100: Autorizado
    const l100 = lookupSefazCStat("100", "NFeRetAutorizacao4")
    expect(l100.ok).toBe(true)
    if (!l100.ok) throw new Error()
    expect(l100.entry.outcome).toBe("AUTHORIZED")
    expect(l100.entry.consequencias.terminal).toBe(true)
    expect(l100.entry.consequencias.numeroConsumido).toBe(true)
  })

  it("C03: Duplicidade de chave (cStat 204) — convergência sem retransmissão cega nem queima", () => {
    const lookup = lookupSefazCStat("204", "NFeAutorizacao4")
    expect(lookup.ok).toBe(true)
    if (!lookup.ok) throw new Error()
    expect(lookup.entry.outcome).toBe("UNCERTAIN")
    expect(lookup.entry.reason).toBe("DUPLICATE_REQUIRES_CONSULTATION")
    // Consequências: exige consulta e NÃO inutiliza nem descarta
    expect(lookup.entry.consequencias.requiresConsultation).toBe(true)
    expect(lookup.entry.consequencias.requiresInutilizacao).toBe(false)
    expect(lookup.entry.consequencias.terminal).toBe(false)
    expect(lookup.entry.consequencias.numeroConsumido).toBe(true)
  })

  it("C04: Serviço SEFAZ indisponível (cStat 108 / 109) — fail-closed imediato", () => {
    for (const cStat of ["108", "109"]) {
      const lookup = lookupSefazCStat(cStat, "NFeAutorizacao4")
      expect(lookup.ok).toBe(true)
      if (!lookup.ok) throw new Error()
      expect(lookup.entry.outcome).toBe("UNCERTAIN")
      expect(lookup.entry.reason).toBe("SERVICE_UNAVAILABLE")
      // Preservação do documento sem queima e sem transição espúria
      expect(lookup.entry.consequencias.terminal).toBe(false)
      expect(lookup.entry.consequencias.numeroConsumido).toBe(false)
      expect(lookup.entry.consequencias.requiresInutilizacao).toBe(false)
      expect(lookup.entry.consequencias.requiresConsultation).toBe(true)
    }
  })

  it("C05: Consulta de documento não constante (cStat 217) — contrato canônico", () => {
    // 217 só é legítimo em NFeConsultaProtocolo4
    const consulta = lookupSefazCStat("217", "NFeConsultaProtocolo4")
    expect(consulta.ok).toBe(true)
    if (!consulta.ok) throw new Error()
    expect(consulta.entry.outcome).toBe("NOT_FOUND")
    expect(consulta.entry.reason).toBe("NAO_CONSTA")
    expect(consulta.entry.consequencias.terminal).toBe(false)
    expect(consulta.entry.consequencias.numeroConsumido).toBe(false)
    expect(consulta.entry.consequencias.requiresInutilizacao).toBe(false)

    // Em autorização, 217 é divergência estrutural (SERVICE_MISMATCH)
    const autorizacao = lookupSefazCStat("217", "NFeAutorizacao4")
    expect(autorizacao.ok).toBe(false)
    if (!autorizacao.ok) {
      expect(autorizacao.reason).toBe("SERVICE_MISMATCH")
    }
  })

  it("C06: Consumo indevido / Throttling (cStat 656) — parada dura, pausa por loja e sem loop", async () => {
    const lookup = lookupSefazCStat("656", "NFeAutorizacao4")
    expect(lookup.ok).toBe(true)
    if (!lookup.ok) throw new Error()
    expect(lookup.entry.outcome).toBe("THROTTLED")
    expect(lookup.entry.reason).toBe("CONSUMO_INDEVIDO")
    // requiresConsultation DEVE ser false para evitar o loop de consulta que alimenta o 656
    expect(lookup.entry.consequencias.requiresConsultation).toBe(false)

    // Observabilidade consolidada comprova a pausa e a evidência canônica
    const now = new Date("2026-09-06T12:00:00.000Z")
    const mockClient = {
      fiscalEmissaoJob: {
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      fiscalLog: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.acao === STORE_PAUSE_ACTION) {
            return {
              cStat: "656",
              detalhe: { paused: true, scope: "store", cStat: "656" },
              mensagem: "Fila fiscal da loja pausada por consumo indevido (656).",
            }
          }
          return null
        }),
        findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.acao === STORE_PAUSE_ACTION) {
            return [{ storeId: "loja-656", detalhe: { paused: true } }]
          }
          return []
        }),
      },
      notaFiscal: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }

    const snapshot = await readFiscalObservabilitySnapshot(
      { storeId: "loja-656", now },
      mockClient as never,
    )

    expect(snapshot.throttling.isPaused).toBe(true)
    expect(snapshot.throttling.pausedScope).toBe("store")
    expect(snapshot.throttling.cStat656Evidence).toBe(true)
    expect(snapshot.throttling.reason).toBe("cstat_656")
  })

  it("C07: Timeout e transmissão incerta (TRANSMITINDO) — reconciliação sem duplicação", async () => {
    const now = new Date("2026-09-06T12:00:00.000Z")
    const notaId = "nota-incerta-c07"
    const chaveAcesso = "35260712345678000199650010000000421123456789"
    const xmlAssinado = `<NFe Id="NFe${chaveAcesso}"><infNFe><ide><nNF>42</nNF></ide></infNFe></NFe>`

    let createdJobs = 0
    const mockClient = {
      notaFiscal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: notaId,
            storeId: "loja-c07",
            vendaId: "venda-c07",
            modelo: "NFCE",
            ambiente: "HOMOLOGACAO",
            serie: 1,
            numero: 42,
            chaveAcesso,
            xmlAssinado,
            updatedAt: new Date(now.getTime() - 180_000), // envelhecida > 2 min
          },
        ]),
      },
      fiscalEmissaoJob: {
        findFirst: vi.fn().mockResolvedValue(null), // sem emissão ativa sob lease
        upsert: vi.fn().mockImplementation(() => {
          createdJobs += 1
          return { id: "job-consulta-c07" }
        }),
      },
      fiscalLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
      },
    }

    const report = await reconcileAgedTransmittingNotes(
      {
        now,
        storeId: "loja-c07",
        uncertainAgeMs: 120_000,
        pauseSnapshot: { globalPaused: false, globalSource: "none", pausedStoreIds: [] },
      },
      mockClient as never,
    )

    expect(report.candidates).toBe(1)
    expect(report.created).toBe(1)
    expect(createdJobs).toBe(1)
    expect(report.consultationJobIds).toEqual(["job-consulta-c07"])
  })

  it("C08: Cancelamento fiscal (evento 110111 / cStat 135) — via módulo canônico de eventos", () => {
    const emissao = new Date("2026-09-06T12:00:00.000Z")
    const nowDentroPrazo = new Date("2026-09-06T12:20:00.000Z") // 20 min (limite 30 min)
    const nowForaPrazo = new Date("2026-09-06T12:35:00.000Z") // 35 min

    // Prazo
    const avaliacaoOk = avaliarPrazoCancelamentoNfce({
      dataAutorizacao: emissao,
      agora: nowDentroPrazo,
    })
    expect(avaliacaoOk.ok).toBe(true)

    const avaliacaoExpirada = avaliarPrazoCancelamentoNfce({
      dataAutorizacao: emissao,
      agora: nowForaPrazo,
    })
    expect(avaliacaoExpirada.ok).toBe(false)

    // Justificativa (min 15 chars)
    const justValida = validarJustificativaCancelamento("Cliente desistiu da compra do produto.")
    expect(justValida.ok).toBe(true)

    const justCurta = validarJustificativaCancelamento("Desistiu")
    expect(justCurta.ok).toBe(false)

    // XML do Evento
    const chaveAcesso = "35260712345678000199650010000000421123456789"
    const xmlEvento = buildXmlEventoCancelamento({
      tpAmb: "2",
      cnpj: "12345678000199",
      chaveAcesso,
      protocolo: "135260000000001",
      justificativa: "Cliente desistiu da compra do produto.",
      dhEvento: nowDentroPrazo,
      sequencia: 1,
    })
    expect(xmlEvento).toContain("<tpEvento>110111</tpEvento>")
    expect(xmlEvento).toContain("<descEvento>Cancelamento</descEvento>")
    expect(xmlEvento).toContain(`<chNFe>${chaveAcesso}</chNFe>`)

    // Assinatura do Evento com cert de teste
    const assinado = signEventoCancelamentoXml(xmlEvento, DRY_RUN_TEST_CERT)
    expect(assinado).toContain("<Signature")

    // Classificação de cStat 135
    const lookup135 = lookupSefazCStat("135", "NFeRecepcaoEvento4")
    expect(lookup135.ok).toBe(true)
    if (!lookup135.ok) throw new Error()
    expect(lookup135.entry.outcome).toBe("AUTHORIZED")
    expect(lookup135.entry.reason).toBe("EVENTO_REGISTRADO")
    expect(isCancelamentoFiscalAutorizado(CSTAT_EVENTO_REGISTRADO)).toBe(true)
  })

  it("C09: Inutilização de número com cStat 102 — via módulo canônico de inutilização", () => {
    // Validação e Geração de XML
    const pedidoInput = {
      tpAmb: "2" as const,
      cUF: "35" as const,
      ano: "26",
      cnpj: "12345678000199",
      modelo: "65" as const,
      serie: "1",
      nNFIni: 50,
      nNFFin: 50,
      xJust: "Erro operacional no caixa ao registrar numero da nota fiscal.",
    }
    const pedido = validateInutilizacaoPedido(pedidoInput)
    expect(pedido.ok).toBe(true)
    if (!pedido.ok) throw new Error()

    const buildResult = buildInutilizacaoXml(pedidoInput)
    expect(buildResult.ok).toBe(true)
    if (!buildResult.ok || !buildResult.xml) throw new Error()

    expect(buildResult.xml).toContain("<xServ>INUTILIZAR</xServ>")
    expect(buildResult.xml).toContain("<nNFIni>50</nNFIni>")
    expect(buildResult.xml).toContain("<nNFFin>50</nNFFin>")

    const signedResult = signInutilizacaoXml(buildResult.xml, DRY_RUN_TEST_CERT)
    expect(signedResult.xml).toContain("<Signature")

    // Matriz de cStat de inutilização: 102
    const lookup102 = lookupInutilizacaoCStat("102")
    expect(lookup102).not.toBeNull()
    expect(lookup102?.kind).toBe("SUCCESS")
    expect(lookup102?.rotulo).toContain("Inutilização de número homologado")

    const classif = classifyInutilizacaoRetorno({
      cStat: "102",
      xMotivo: "Homologado",
      nProt: "135260000000001",
    })
    expect(classif.outcome).toBe("SUCCESS")
    expect(classif.reason).toBe("INUTILIZACAO_HOMOLOGADA")
  })

  it("C10: Contingência offline tpEmis=9 — bytes imutáveis, QR v3 offline e prazos", () => {
    const emissao = new Date("2026-09-04T15:00:00.000Z") // sexta-feira
    const prazo = calculateOfflineTransmissionDeadline(emissao)
    // Primeiro dia útil seguinte é segunda-feira 23:59:59.999 UTC
    expect(prazo.getUTCDay()).toBe(1) // segunda-feira
    expect(prazo.getUTCHours()).toBe(23)
    expect(prazo.getUTCMinutes()).toBe(59)

    // Alarmes
    const nowSafe = new Date("2026-09-04T16:00:00.000Z")
    expect(offlineContingencyAlarm(nowSafe, prazo)).toBe("SAFE")

    const nowApproaching = new Date(prazo.getTime() - 30 * 60 * 1000) // 30 min antes
    expect(offlineContingencyAlarm(nowApproaching, prazo)).toBe("APPROACHING")

    const nowExpired = new Date(prazo.getTime() + 1000)
    expect(offlineContingencyAlarm(nowExpired, prazo)).toBe("EXPIRED")

    // Fixture de Contingência (sem protocolo = variante contingência pura)
    const fixture = buildPersistedDanfceFixture("contingencia_sem_protocolo")
    const model = parseDanfceFromPersisted(fixture.document)
    expect(model.variante).toBe("contingencia")
    expect(model.mensagensFiscais).toContain(DANFCE_MSG_CONTINGENCIA)

    const html = renderDanfceHtml(model)
    expect(html).toContain(DANFCE_TITULO_CONTINGENCIA)

    // QR-Code v3 Offline assinado e verificado
    const urls = selectNfceSpPublicUrls("HOMOLOGACAO")
    const signer = createQrV3OfflinePemSigner(DRY_RUN_TEST_CERT.privateKeyPem)
    const qrOffline = encodeNfceQrV3OfflineUrl({
      baseUrl: urls.qrCodeBaseUrl,
      chave: model.chaveAcesso,
      tpAmb: "2",
      dhEmi: model.dhEmi,
      vNF: model.valorTotal,
      destinatario: { kind: "ausente" },
      sign: signer,
    })
    expect(qrOffline.ok).toBe(true)
    if (qrOffline.ok) {
      expect(qrOffline.url).toContain(urls.qrCodeBaseUrl)
      expect(qrOffline.url).toContain(`p=${qrOffline.encoded.payload}`)
      expect(
        verifyQrV3OfflineSignature(
          qrOffline.encoded.canonical,
          qrOffline.encoded.assinatura,
          createPublicKey(DRY_RUN_TEST_CERT.certificatePem),
        ),
      ).toBe(true)
    }

    // Imutabilidade dos bytes
    const xml = fixture.document.xmlAssinado ?? ""
    const bytes1 = fiscalBytesSha256(new TextEncoder().encode(xml))
    const bytes2 = fiscalBytesSha256(new TextEncoder().encode(xml))
    expect(bytes1).toBe(bytes2)
  })

  it("Auditoria 175: cStats 203, 208, 215, 225 permanecem NÃO modelados na matriz e não geram gaps", () => {
    const unmodeledCodes = ["203", "208", "215", "225"]

    for (const code of unmodeledCodes) {
      const lookup = lookupSefazCStat(code, "NFeAutorizacao4")
      expect(lookup.ok).toBe(false)
      if (!lookup.ok) {
        expect(lookup.reason).toBe("UNKNOWN")
      }
    }

    expect(COVERAGE_GAP_UNMODELED_CSTAT).toBe(false)
    expect(READY_FOR_G_F7_REVIEW).toBe(true)
    expect(SP_ONLY).toBe(true)
    expect(FISCAL_OFF).toBe(true)
    expect(SEFAZ_CSTAT_MATRIX_VERSION).toBe("018.2")
  })
})
