import { describe, expect, it } from "vitest"
import {
  SEFAZ_ENDPOINT_CATALOG,
  SEFAZ_LAYOUT_VERSAO,
  sefazServiceNamespace,
} from "../sefaz-endpoint-catalog"
import {
  SEFAZ_WSDL_ACQUISITION_TARGETS,
  SEFAZ_WSDL_METHOD,
  SEFAZ_WSDL_QUERY,
  canonicalSefazWsdlTarget,
  selectSefazWsdlTarget,
  sefazWsdlTargetIntegro,
  type SefazWsdlTarget,
} from "./wsdl-acquisition-target"

const HOST_NFE_SP = "nfe.fazenda.sp.gov.br"

function alvoValido(): SefazWsdlTarget {
  const lookup = selectSefazWsdlTarget({
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeStatusServico4",
  })
  if (!lookup.ok) throw new Error("alvo canônico ausente")
  return lookup.alvo
}

describe("allow-list de aquisição de WSDL · projeção do catálogo", () => {
  it("projeta exatamente os endpoints de homologação SP já catalogados — nem um a mais", () => {
    const homologacaoCatalogada = SEFAZ_ENDPOINT_CATALOG.filter(
      (endpoint) => endpoint.ambiente === "HOMOLOGACAO" && endpoint.permitido,
    )

    expect(SEFAZ_WSDL_ACQUISITION_TARGETS).toHaveLength(homologacaoCatalogada.length)
    expect(SEFAZ_WSDL_ACQUISITION_TARGETS.map((alvo) => alvo.servico).sort()).toEqual(
      homologacaoCatalogada.map((endpoint) => endpoint.servico).sort(),
    )
    // Cada alvo é apenas `<url catalogada>?wsdl` — nenhuma URL nova é declarada neste módulo.
    for (const alvo of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      expect(alvo.url).toBe(`${alvo.endpoint.url}?${SEFAZ_WSDL_QUERY}`)
      expect(alvo.namespace).toBe(sefazServiceNamespace(alvo.servico))
      expect(sefazWsdlTargetIntegro(alvo)).toBe(true)
      if (alvo.servico === "NFeAutorizacao4") {
        expect(alvo.expectedOperationName).toBe("nfeAutorizacaoLote")
      } else {
        expect(alvo.expectedOperationName).toBeUndefined()
      }
    }
  })

  it("não projeta produção nem host NF-e em nenhuma entrada", () => {
    for (const alvo of SEFAZ_WSDL_ACQUISITION_TARGETS) {
      expect(alvo.ambiente).toBe("HOMOLOGACAO")
      expect(alvo.uf).toBe("SP")
      // Igualdade exata: `homologacao.nfce…` contém `nfce.fazenda.sp.gov.br` como substring.
      expect(alvo.host).not.toBe(HOST_NFE_SP)
      expect(alvo.host).toBe("homologacao.nfce.fazenda.sp.gov.br")
      expect(new URL(alvo.url).protocol).toBe("https:")
    }
  })

  it("o método da aquisição é GET fixo", () => {
    expect(SEFAZ_WSDL_METHOD).toBe("GET")
  })
})

describe("selectSefazWsdlTarget · catálogo fechado", () => {
  it("aceita os seis serviços canônicos de homologação", () => {
    for (const endpoint of SEFAZ_ENDPOINT_CATALOG.filter(
      (e) => e.ambiente === "HOMOLOGACAO" && e.permitido,
    )) {
      const lookup = selectSefazWsdlTarget({
        uf: "SP",
        ambiente: "HOMOLOGACAO",
        servico: endpoint.servico,
        versao: SEFAZ_LAYOUT_VERSAO,
      })
      expect(lookup.ok).toBe(true)
    }
  })

  it("recusa produção com código próprio, não com 'desconhecido'", () => {
    const lookup = selectSefazWsdlTarget({
      uf: "SP",
      ambiente: "PRODUCAO",
      servico: "NFeStatusServico4",
    })
    expect(lookup).toMatchObject({ ok: false, codigo: "alvo_nao_permitido" })
  })

  it("recusa outra UF, serviço inexistente e versão divergente", () => {
    expect(
      selectSefazWsdlTarget({ uf: "RS", ambiente: "HOMOLOGACAO", servico: "NFeStatusServico4" }),
    ).toMatchObject({ ok: false, codigo: "alvo_desconhecido" })
    expect(
      selectSefazWsdlTarget({ uf: "SP", ambiente: "HOMOLOGACAO", servico: "NFeQualquerCoisa" }),
    ).toMatchObject({ ok: false, codigo: "alvo_desconhecido" })
    expect(
      selectSefazWsdlTarget({
        uf: "SP",
        ambiente: "HOMOLOGACAO",
        servico: "NFeStatusServico4",
        versao: "3.10",
      }),
    ).toMatchObject({ ok: false, codigo: "alvo_desconhecido" })
  })

  it("não expõe nenhum parâmetro capaz de carregar URL, host, porta ou path", () => {
    const lookup = selectSefazWsdlTarget({
      uf: "SP",
      ambiente: "HOMOLOGACAO",
      servico: "NFeStatusServico4",
      // Campos extras são ignorados pelo contrato: não existe caminho de injeção de destino.
      ...({ url: `https://${HOST_NFE_SP}/ws/x.asmx?wsdl`, host: HOST_NFE_SP } as object),
    })
    expect(lookup.ok).toBe(true)
    if (!lookup.ok) return
    expect(lookup.alvo.host).toBe("homologacao.nfce.fazenda.sp.gov.br")
  })
})

describe("canonicalSefazWsdlTarget · alvo forjado não atravessa", () => {
  it("recusa objeto com URL livre, mesmo com tupla válida", () => {
    const forjado: SefazWsdlTarget = {
      ...alvoValido(),
      url: `https://${HOST_NFE_SP}/ws/NFeStatusServico4.asmx?wsdl`,
      host: HOST_NFE_SP,
    }
    expect(canonicalSefazWsdlTarget(forjado)).toBeNull()
  })

  it("recusa alvo de produção montado à mão", () => {
    const producao = SEFAZ_ENDPOINT_CATALOG.find((e) => e.ambiente === "PRODUCAO")!
    const forjado = {
      uf: producao.uf,
      ambiente: producao.ambiente,
      servico: producao.servico,
      versao: producao.versao,
      endpoint: producao,
      url: `${producao.url}?wsdl`,
      host: producao.host,
      path: `/ws/${producao.servico}.asmx`,
      namespace: producao.namespace,
    } as SefazWsdlTarget
    expect(canonicalSefazWsdlTarget(forjado)).toBeNull()
  })

  it("devolve a entrada canônica quando tudo confere", () => {
    const alvo = alvoValido()
    expect(canonicalSefazWsdlTarget({ ...alvo })).toBe(alvo)
  })

  it("recusa alvo com expectedOperationName divergente", () => {
    const lookupNFeAut = selectSefazWsdlTarget({
      uf: "SP",
      ambiente: "HOMOLOGACAO",
      servico: "NFeAutorizacao4",
    })
    expect(lookupNFeAut.ok).toBe(true)
    if (!lookupNFeAut.ok) return

    const forjadoZip: SefazWsdlTarget = {
      ...lookupNFeAut.alvo,
      expectedOperationName: "nfeAutorizacaoLoteZip",
    }
    expect(canonicalSefazWsdlTarget(forjadoZip)).toBeNull()

    const forjadoSemExpected: SefazWsdlTarget = {
      ...lookupNFeAut.alvo,
      expectedOperationName: undefined,
    }
    expect(canonicalSefazWsdlTarget(forjadoSemExpected)).toBeNull()
  })
})

describe("sefazWsdlTargetIntegro · última barreira estrutural", () => {
  const base = alvoValido()

  it.each([
    ["http em vez de https", { url: base.url.replace("https:", "http:") }],
    ["porta explícita", { url: base.url.replace(base.host, `${base.host}:8443`) }],
    ["credenciais embutidas", { url: base.url.replace("https://", "https://u:p@") }],
    ["fragmento", { url: `${base.url}#frag` }],
    ["query diferente de ?wsdl", { url: `${base.endpoint.url}?WSDL=1` }],
    ["sem query", { url: base.endpoint.url }],
    ["path divergente", { url: `https://${base.host}/outro?wsdl`, path: "/outro" }],
    ["ambiente de produção", { ambiente: "PRODUCAO" as const }],
    ["expectedOperationName indevido em serviço sem multi-op", { expectedOperationName: "qualquerOp" }],
  ])("recusa %s", (_rotulo, patch) => {
    expect(sefazWsdlTargetIntegro({ ...base, ...patch } as SefazWsdlTarget)).toBe(false)
  })

  it("recusa NFeAutorizacao4 sem expectedOperationName ou com valor divergente", () => {
    const lookupNFeAut = selectSefazWsdlTarget({
      uf: "SP",
      ambiente: "HOMOLOGACAO",
      servico: "NFeAutorizacao4",
    })
    expect(lookupNFeAut.ok).toBe(true)
    if (!lookupNFeAut.ok) return

    expect(
      sefazWsdlTargetIntegro({
        ...lookupNFeAut.alvo,
        expectedOperationName: undefined,
      } as SefazWsdlTarget),
    ).toBe(false)

    expect(
      sefazWsdlTargetIntegro({
        ...lookupNFeAut.alvo,
        expectedOperationName: "nfeAutorizacaoLoteZip",
      } as SefazWsdlTarget),
    ).toBe(false)
  })
})
