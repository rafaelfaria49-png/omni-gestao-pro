/**
 * GOAL 020A — policy pura da contingência off-line NFC-e 65 / SP.
 *
 * Sem I/O, sem XML, sem numerador, sem rede.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  canInutilizarNumeroContingencia,
  canReuseNumeroForContingencia,
  consumerPresentationDependency,
  decideNormalToOffline,
  exactBytesRequirement,
  evaluateUnknown,
  resolveContingenciaTransmissionDeadline,
  serieEspecialPolicy,
  signedXmlInPlacePatchPolicy,
  transmissionDeadlinePolicy,
  validateContingenciaRequest,
} from "./policy"
import {
  CONTINGENCIA_MODALIDADE,
  CONTINGENCIA_MODELO,
  CONTINGENCIA_MODELO_CODIGO,
  CONTINGENCIA_TP_EMIS,
  CONTINGENCIA_UF_PILOTO,
  NEXT_BUSINESS_DAY,
  REBUILD_AND_RESIGN_REQUIRED,
  SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN,
} from "./types"

const PEDIDO_VALIDO = {
  modelo: CONTINGENCIA_MODELO,
  modeloCodigo: CONTINGENCIA_MODELO_CODIGO,
  uf: CONTINGENCIA_UF_PILOTO,
  modalidade: CONTINGENCIA_MODALIDADE,
  tpEmis: CONTINGENCIA_TP_EMIS,
  dhCont: "2026-08-16T15:00:00-03:00",
  xJust: "Falha de conectividade com a SEFAZ",
} as const

describe("validateContingenciaRequest", () => {
  it("aceita SP + modelo 65 + tpEmis 9 + dhCont/xJust", () => {
    const r = validateContingenciaRequest(PEDIDO_VALIDO)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.modelo).toBe("NFCE")
    expect(r.value.modeloCodigo).toBe("65")
    expect(r.value.uf).toBe("SP")
    expect(r.value.modalidade).toBe("OFFLINE")
    expect(r.value.tpEmis).toBe(9)
    expect(r.value.fonte).toBe("AJUSTE_SINIEF_19_16_CL_11_I")
  })

  it("ambiente não altera a policy estrutural (HOMOLOGACAO e PRODUCAO)", () => {
    for (const ambiente of ["HOMOLOGACAO", "PRODUCAO"] as const) {
      const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, ambiente })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.ambiente).toBe(ambiente)
    }
    const semAmbiente = validateContingenciaRequest(PEDIDO_VALIDO)
    expect(semAmbiente.ok).toBe(true)
  })

  it("rejeita UF não suportada", () => {
    const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, uf: "RJ" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === "uf_nao_suportada")).toBe(true)
  })

  it("rejeita modelo 55 / NF-e", () => {
    const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, modelo: "NFE", modeloCodigo: "55" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === "modelo_nao_suportado")).toBe(true)
  })

  it("rejeita modalidade e tpEmis fora do piloto (EPEC, SVC, SAT, ECF, FS)", () => {
    const casos = [
      { modalidade: "EPEC", tpEmis: 4 },
      { modalidade: "SVC", tpEmis: 6 },
      { modalidade: "SAT", tpEmis: 9 },
      { modalidade: "ECF", tpEmis: 9 },
      { modalidade: "OFFLINE", tpEmis: 2 },
      { modalidade: "OFFLINE", tpEmis: 7 },
      { modalidade: "ONLINE", tpEmis: 1 },
    ]
    for (const c of casos) {
      const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, ...c })
      expect(r.ok, JSON.stringify(c)).toBe(false)
    }
  })

  it("rejeita dhCont ausente", () => {
    const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, dhCont: "" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.code === "dh_cont_ausente")).toBe(true)
  })

  it("rejeita dhCont inválido (sem TZD, offset fracionário, data impossível)", () => {
    for (const dhCont of ["2026-08-16", "2026-08-16T15:00:00", "2026-08-16T15:00:00-03:30", "2025-02-29T10:00:00-03:00"]) {
      const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, dhCont })
      expect(r.ok, dhCont).toBe(false)
      if (!r.ok) expect(r.errors.some((e) => e.code === "dh_cont_invalido")).toBe(true)
    }
  })

  it("rejeita xJust ausente (whitespace conta como ausente)", () => {
    for (const xJust of ["", "   ", null]) {
      const r = validateContingenciaRequest({ ...PEDIDO_VALIDO, xJust })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.some((e) => e.code === "x_just_ausente")).toBe(true)
    }
  })

  it("não inventa tamanho mínimo/máximo de xJust (presença basta nesta policy)", () => {
    const curto = validateContingenciaRequest({ ...PEDIDO_VALIDO, xJust: "sem rede" })
    expect(curto.ok).toBe(true)
  })
})

describe("Normal → off-line", () => {
  it("exige REBUILD_AND_RESIGN_REQUIRED e altera chave/cDV/infNFe/@Id", () => {
    const r = decideNormalToOffline({
      tpEmisAtual: 1,
      xmlAssinado: false,
      transmissaoIniciada: false,
      numeroJaTransmitidoComoNormal: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.xmlMutation).toBe(REBUILD_AND_RESIGN_REQUIRED)
    expect(r.alteraChaveAcesso).toBe(true)
    expect(r.alteraCDV).toBe(true)
    expect(r.alteraInfNFeId).toBe(true)
    expect(r.exigeReconstrucaoXml).toBe(true)
    expect(r.exigeNovaAssinatura).toBe(true)
    expect(r.executaRebuildNesteGoal).toBe(false)
    expect(r.acopladoAoBuilderXml).toBe(false)
    expect(r.signedXmlInPlacePatch).toBe(SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN)
  })

  it("XML já assinado também exige rebuild/resign — nunca patch in-place", () => {
    const r = decideNormalToOffline({
      tpEmisAtual: 1,
      xmlAssinado: true,
      transmissaoIniciada: false,
      numeroJaTransmitidoComoNormal: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.xmlMutation).toBe(REBUILD_AND_RESIGN_REQUIRED)
    expect(r.signedXmlInPlacePatch).toBe(SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN)
  })

  it("nenhuma policy permite patch de XML assinado", () => {
    expect(signedXmlInPlacePatchPolicy()).toBe(SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN)
    const bloqueado = decideNormalToOffline({
      tpEmisAtual: 1,
      xmlAssinado: true,
      transmissaoIniciada: true,
      numeroJaTransmitidoComoNormal: false,
    })
    expect(bloqueado.ok).toBe(false)
    if (!bloqueado.ok) expect(bloqueado.signedXmlInPlacePatch).toBe(SIGNED_XML_IN_PLACE_PATCH_FORBIDDEN)
  })

  it("número já transmitido como Normal não é reutilizável", () => {
    const r = decideNormalToOffline({
      tpEmisAtual: 1,
      xmlAssinado: true,
      transmissaoIniciada: false,
      numeroJaTransmitidoComoNormal: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("numero_normal_transmitido_nao_reutilizavel")
  })

  it("só converte a partir de emissão Normal (tpEmis=1)", () => {
    for (const tpEmisAtual of [4, 6, 7, 9, 2]) {
      const r = decideNormalToOffline({
        tpEmisAtual,
        xmlAssinado: false,
        transmissaoIniciada: false,
        numeroJaTransmitidoComoNormal: false,
      })
      expect(r.ok, String(tpEmisAtual)).toBe(false)
      if (!r.ok) expect(r.code).toBe("origem_nao_e_emissao_normal")
    }
  })
})

describe("numeração (guards puros)", () => {
  it("número já transmitido Normal não pode ser reaproveitado em contingência", () => {
    const r = canReuseNumeroForContingencia({ numeroJaTransmitidoComoNormal: true })
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.code).toBe("numero_normal_transmitido_nao_reutilizavel")
      expect(r.fonte).toBe("AJUSTE_SINIEF_19_16_CL_11_PAR2_I")
    }
  })

  it("número nunca transmitido como Normal pode ser usado", () => {
    expect(canReuseNumeroForContingencia({ numeroJaTransmitidoComoNormal: false })).toEqual({ allowed: true })
  })

  it("numeração emitida em contingência não está disponível para inutilização", () => {
    const r = canInutilizarNumeroContingencia({ emitidoEmContingencia: true })
    expect(r).toMatchObject({
      allowed: false,
      code: "numero_contingencia_nao_inutilizavel",
    })
  })

  it("séries especiais antigas revogadas não são exigidas", () => {
    const r = serieEspecialPolicy()
    expect(r.exigida).toBe(false)
    expect(r.reusaSerieNormal).toBe(true)
    expect(r.faixasRevogadas).toEqual(["890-989", "501-999"])
  })
})

describe("prazo de transmissão posterior", () => {
  it("devolve NEXT_BUSINESS_DAY sem calendário e sem +1 dia", () => {
    const dhEmi = "2026-08-14T10:00:00-03:00"
    const r = resolveContingenciaTransmissionDeadline({ dhEmi })
    expect(r.policy.kind).toBe(NEXT_BUSINESS_DAY)
    expect(r.policy.countedFrom).toBe("dhEmi")
    expect(r.policy.calendarEmbedded).toBe(false)
    expect(r.policy.simplifiedPlusOneDay).toBe(false)
    expect(r.documentoPendenteDeTransmissao).toBe(true)
    expect(r.transmissionUsesExactBytes).toBe(true)
    expect(r.resolvedDeadline).toBeNull()
    expect(r.resolvedDeadline).not.toBe("2026-08-15T10:00:00-03:00")
    expect(transmissionDeadlinePolicy().kind).toBe(NEXT_BUSINESS_DAY)
  })

  it("resolver injetável é a única forma de obter data — sem calendário embutido", () => {
    const r = resolveContingenciaTransmissionDeadline({
      dhEmi: "2026-08-14T10:00:00-03:00",
      resolver: {
        calendarEmbedded: false,
        nextBusinessDayAfter: ({ dhEmi, timeZone }) => {
          expect(dhEmi).toBe("2026-08-14T10:00:00-03:00")
          expect(timeZone).toBe("America/Sao_Paulo")
          return "2026-08-17T00:00:00-03:00"
        },
      },
    })
    expect(r.resolvedDeadline).toBe("2026-08-17T00:00:00-03:00")
    expect(r.policy.calendarEmbedded).toBe(false)
  })
})

describe("exactBytes e GOAL 021", () => {
  it("EMITIDO_LOCAL (e posteriores) exigem preservação de exactBytes e proíbem rebuild", () => {
    for (const estado of ["EMITIDO_LOCAL", "PENDENTE_TX", "TX_ANDAMENTO", "AUTORIZADO_POST", "REJEITADO_DEF", "UNKNOWN"] as const) {
      const r = exactBytesRequirement(estado)
      expect(r.required).toBe(true)
      if (r.required) {
        expect(r.kind).toBe("EXACT_BYTES")
        expect(r.rebuildForbidden).toBe(true)
        expect(r.transmissionUsesIssuedBytes).toBe(true)
        expect(r.frozen).toBe(true)
      }
    }
  })

  it("PREPARADO e INTERVENCAO_MANUAL pré-emissão não congelam bytes", () => {
    expect(exactBytesRequirement("PREPARADO")).toEqual({
      required: false,
      frozen: false,
      rebuildForbidden: false,
    })
    expect(exactBytesRequirement("INTERVENCAO_MANUAL")).toEqual({
      required: false,
      frozen: false,
      rebuildForbidden: false,
    })
    const posEmissao = exactBytesRequirement("INTERVENCAO_MANUAL", "EMITIDO_LOCAL")
    expect(posEmissao.required).toBe(true)
    if (posEmissao.required) expect(posEmissao.rebuildForbidden).toBe(true)
  })

  it("apresentação ao consumidor depende do GOAL 021 sem bloquear a policy", () => {
    const d = consumerPresentationDependency()
    expect(d.goal).toBe("021")
    expect(d.requiredForConsumerPresentation).toBe(true)
    expect(d.blocksOfflinePolicy).toBe(false)
  })
})

describe("UNKNOWN fail-closed (ADR-0017)", () => {
  it("nunca retorna retryAutomatico=true e nunca autoriza emissão automática", () => {
    const u = evaluateUnknown()
    expect(u.retryAutomatico).toBe(false)
    expect(u.autorizaNovaEmissaoAutomatica).toBe(false)
    expect(u.podeRetomarTxDireto).toBe(false)
    expect(u.reconcilicao.kind).toBe("RECONCILIATION_REQUIRED")
    expect(u.reconcilicao.retornoDiretoTxAndamento).toBe(false)
  })
})

describe("pureza: nenhum módulo de contingência depende de rede, XML, numerador ou persistência", () => {
  const dir = join(process.cwd(), "lib/fiscal/contingencia")
  const fontes = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))

  it("não importa http/https/net/tls, fetch, Prisma, XML builder, signer, numbering, provider, queue", () => {
    expect(fontes.length).toBeGreaterThan(0)
    for (const arquivo of fontes) {
      const src = readFileSync(join(dir, arquivo), "utf8")
      const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']node:(http|https|net|tls|dgram)["']/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["'](undici|axios|node-fetch|got|superagent)["']/)
      expect(semComentarios, arquivo).not.toMatch(/\bfetch\s*\(/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']@\/lib\/prisma["']/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']@\/lib\/fiscal\/(xml|signing|numbering|provider|queue|emission)["']/)
      expect(semComentarios, arquivo).not.toMatch(/from\s+["']\.\.\/(xml|signing|numbering|provider|queue|emission)\b/)
    }
  })
})
