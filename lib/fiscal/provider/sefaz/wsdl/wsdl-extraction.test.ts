import { describe, expect, it } from "vitest"
import { sefazServiceNamespace, type SefazServico } from "../sefaz-endpoint-catalog"
import { selectSefazWsdlTarget, type SefazWsdlTarget } from "./wsdl-acquisition-target"
import {
  WSDL_MAX_DOCUMENT_BYTES,
  extractSefazWsdlContract,
  type SefazWsdlExtraction,
} from "./wsdl-extraction"
import {
  SYNTHETIC_SOAP_ACTION_SUFIXO,
  WSDL_COM_DTD,
  WSDL_MALFORMADO,
  WSDL_RAIZ_ERRADA,
  wsdlFixture,
  type WsdlFixtureOptions,
} from "./__fixtures__/wsdl-fixtures"

function alvoDe(servico: SefazServico): SefazWsdlTarget {
  const lookup = selectSefazWsdlTarget({ uf: "SP", ambiente: "HOMOLOGACAO", servico })
  if (!lookup.ok) throw new Error(`alvo ausente para ${servico}`)
  return lookup.alvo
}

function extrair(
  options: WsdlFixtureOptions = {},
  servico: SefazServico = options.servico ?? "NFeStatusServico4",
): SefazWsdlExtraction {
  return extractSefazWsdlContract({
    servico,
    alvo: alvoDe(servico),
    documento: wsdlFixture({ ...options, servico }),
  })
}

describe("extractSefazWsdlContract · cadeia estrutural completa", () => {
  it("fecha H-9 e H-10 quando service → port → binding → operation → message fecham", () => {
    const resultado = extrair()
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    expect(resultado.fechaH9).toBe(true)
    expect(resultado.fechaH10).toBe(true)
    expect(resultado.contrato).toMatchObject({
      servico: "NFeStatusServico4",
      targetNamespace: sefazServiceNamespace("NFeStatusServico4"),
      serviceName: "NFeStatusServico4",
      portName: "NFeStatusServico4Port",
      bindingName: "NFeStatusServico4Soap12",
      bindingNamespace: "http://schemas.xmlsoap.org/wsdl/soap12/",
      soap12: true,
      transport: "http://schemas.xmlsoap.org/soap/http",
      style: "document",
      operationName: "opNFeStatusServico4",
      soapActionRequired: true,
      inputWrapperLocalName: "nfeDadosMsg",
      outputWrapperLocalName: "nfeResultMsg",
    })
    expect(resultado.contrato.inputWrapperNamespace).toBe(
      sefazServiceNamespace("NFeStatusServico4"),
    )
    expect(resultado.contrato.addressLocation).toBe(
      "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
    )
  })

  it("lê a soapAction VERBATIM — nunca a deriva do nome do serviço ou da operação", () => {
    const resultado = extrair()
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    // A fixture injeta um marcador que nenhuma convenção produziria. Se o extrator inferisse a
    // ação por nome, este sufixo não apareceria — e o teste positivo estaria congelando o defeito.
    expect(resultado.contrato.soapAction).toContain(SYNTHETIC_SOAP_ACTION_SUFIXO)
    expect(resultado.contrato.soapAction).not.toBe(
      `${sefazServiceNamespace("NFeStatusServico4")}/opNFeStatusServico4`,
    )
  })

  it("funciona para qualquer um dos seis serviços canônicos", () => {
    const servicos: SefazServico[] = [
      "NFeAutorizacao4",
      "NFeRetAutorizacao4",
      "NFeConsultaProtocolo4",
      "NFeStatusServico4",
      "NFeInutilizacao4",
      "NFeRecepcaoEvento4",
    ]
    for (const servico of servicos) {
      const resultado = extrair({}, servico)
      expect(resultado.ok, servico).toBe(true)
      if (!resultado.ok) continue
      expect(resultado.contrato.targetNamespace).toBe(sefazServiceNamespace(servico))
    }
  })
})

describe("extractSefazWsdlContract · H-9 não fecha sem soapAction publicada", () => {
  it.each([
    ["atributo soapAction ausente", { semSoapAction: true }],
    ["soapAction vazia", { soapActionVazia: true }],
    ["sem extensão soap12:operation", { semExtensaoSoapOperation: true }],
  ])("recusa quando %s", (_rotulo, options) => {
    const resultado = extrair(options)
    expect(resultado).toMatchObject({
      ok: false,
      codigo: "soap_action_ausente",
      fechaH9: false,
      fechaH10: false,
    })
  })
})

describe("extractSefazWsdlContract · SOAP 1.1 não fecha evidência de SOAP 1.2", () => {
  it("recusa WSDL que só publica binding SOAP 1.1", () => {
    const resultado = extrair({ soap11Apenas: true })
    expect(resultado).toMatchObject({ ok: false, codigo: "port_soap12_ausente", fechaH10: false })
    if (resultado.ok) return
    expect(resultado.mensagem).toContain("SOAP 1.1")
  })
})

describe("extractSefazWsdlContract · ambiguidade nunca é resolvida por heurística", () => {
  it.each([
    ["dois wsdl:service", { doisServices: true }, "service_ambiguo"],
    ["dois ports SOAP 1.2", { doisPortsSoap12: true }, "port_soap12_ambiguo"],
    ["bindings homônimos", { bindingsHomonimos: true }, "binding_ambiguo"],
    ["duas operações no binding", { duasOperacoesNoBinding: true }, "operacao_ambigua"],
  ])("recusa %s", (_rotulo, options, codigo) => {
    expect(extrair(options)).toMatchObject({ ok: false, codigo, fechaH9: false })
  })

  it("com dois bindings candidatos, não escolhe o que casa com o nome do serviço", () => {
    const resultado = extrair({ doisPortsSoap12: true })
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    // O binding `NFeStatusServico4Soap12` é o "óbvio" pelo nome. A recusa prova que o nome não
    // é critério de desempate.
    expect(resultado.mensagem).not.toContain("NFeStatusServico4Soap12")
  })
})

describe("extractSefazWsdlContract · incompatibilidade estrutural", () => {
  it.each([
    ["targetNamespace divergente", { targetNamespaceOverride: "http://example.invalid/x" }, "target_namespace_divergente"],
    ["transporte não-HTTP", { transporteInvalido: true }, "binding_transporte_invalido"],
    ["style rpc", { estiloRpc: true }, "binding_style_invalido"],
    ["endereço em outro host", { enderecoOutroHost: true }, "endereco_divergente"],
    ["endereço em http", { enderecoInseguro: true }, "endereco_divergente"],
    ["prefixo não declarado no binding", { prefixoNaoDeclarado: true }, "binding_nao_resolvido"],
    ["message sem part elementar", { semWrapperDeEntrada: true }, "wrapper_nao_resolvido"],
  ])("recusa %s", (_rotulo, options, codigo) => {
    expect(extrair(options)).toMatchObject({ ok: false, codigo, fechaH9: false, fechaH10: false })
  })

  it("recusa WSDL de um serviço quando o esperado é outro", () => {
    const resultado = extractSefazWsdlContract({
      servico: "NFeStatusServico4",
      alvo: alvoDe("NFeStatusServico4"),
      documento: wsdlFixture({ servico: "NFeAutorizacao4" }),
    })
    expect(resultado).toMatchObject({ ok: false, codigo: "target_namespace_divergente" })
  })

  it("recusa quando o alvo canônico não corresponde ao serviço esperado", () => {
    const resultado = extractSefazWsdlContract({
      servico: "NFeStatusServico4",
      alvo: alvoDe("NFeAutorizacao4"),
      documento: wsdlFixture({ servico: "NFeStatusServico4" }),
    })
    expect(resultado).toMatchObject({ ok: false, codigo: "target_namespace_divergente" })
  })
})

describe("extractSefazWsdlContract · documento inaceitável", () => {
  it("recusa documento vazio", () => {
    expect(
      extractSefazWsdlContract({
        servico: "NFeStatusServico4",
        alvo: alvoDe("NFeStatusServico4"),
        documento: "   ",
      }),
    ).toMatchObject({ ok: false, codigo: "documento_vazio" })
  })

  it("recusa XML mal-formado sem reparo silencioso", () => {
    expect(
      extractSefazWsdlContract({
        servico: "NFeStatusServico4",
        alvo: alvoDe("NFeStatusServico4"),
        documento: WSDL_MALFORMADO,
      }),
    ).toMatchObject({ ok: false, codigo: "documento_malformado" })
  })

  it("recusa raiz que não é wsdl:definitions (ex.: página de erro HTML)", () => {
    expect(
      extractSefazWsdlContract({
        servico: "NFeStatusServico4",
        alvo: alvoDe("NFeStatusServico4"),
        documento: WSDL_RAIZ_ERRADA,
      }),
    ).toMatchObject({ ok: false, codigo: "raiz_nao_e_wsdl" })
  })

  it("recusa DTD/ENTITY antes do parser", () => {
    expect(
      extractSefazWsdlContract({
        servico: "NFeStatusServico4",
        alvo: alvoDe("NFeStatusServico4"),
        documento: WSDL_COM_DTD,
      }),
    ).toMatchObject({ ok: false, codigo: "documento_com_dtd" })
  })

  it("recusa documento acima do limite", () => {
    const documento = `<a>${"x".repeat(WSDL_MAX_DOCUMENT_BYTES + 1)}</a>`
    expect(
      extractSefazWsdlContract({
        servico: "NFeStatusServico4",
        alvo: alvoDe("NFeStatusServico4"),
        documento,
      }),
    ).toMatchObject({ ok: false, codigo: "documento_excede_limite" })
  })
})
