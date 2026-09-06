/**
 * Fixtures WSDL **SINTÉTICAS** para os testes do GOAL-017.
 *
 * ⛔ NÃO SÃO AUTORITATIVAS. Nenhum valor aqui vem da SEFAZ. Em especial, a `soapAction`
 * (`SYNTHETIC_SOAP_ACTION`) foi INVENTADA para exercitar o mecanismo de extração e **não** é a
 * resposta de H-9. Copiar esse valor para código de produção reintroduz exatamente o defeito
 * que o extrator existe para impedir: `SOAPAction` derivada de convenção em vez de lida do
 * documento oficial.
 *
 * As fixtures provam o CAMINHO (a cadeia service → port → binding → operation → message fecha,
 * e cada ruptura dela recusa), nunca o CONTEÚDO.
 */
import { sefazServiceNamespace, type SefazServico } from "../../sefaz-endpoint-catalog"
import { SEFAZ_WSDL_EXPECTED_OPERATIONS } from "../wsdl-acquisition-target"

const HOST_HOMOLOGACAO_SP = "homologacao.nfce.fazenda.sp.gov.br"

/** ⚠️ Valor inventado. Ver o aviso no topo do arquivo. */
export const SYNTHETIC_SOAP_ACTION_SUFIXO = "SYNTHETIC-NAO-OFICIAL"

export type WsdlFixtureOptions = {
  readonly servico?: SefazServico
  /** Substitui o `targetNamespace` (para provar o vínculo com o serviço esperado). */
  readonly targetNamespaceOverride?: string
  /** Publica apenas binding/port SOAP 1.1. */
  readonly soap11Apenas?: boolean
  /** Omite o atributo `soapAction` da `soap12:operation`. */
  readonly semSoapAction?: boolean
  /** Emite `soapAction=""`. */
  readonly soapActionVazia?: boolean
  /** Omite a extensão `soap12:operation` inteira. */
  readonly semExtensaoSoapOperation?: boolean
  /** Dois ports SOAP 1.2 no mesmo service, apontando para bindings distintos. */
  readonly doisPortsSoap12?: boolean
  /** Dois `wsdl:binding` com o mesmo nome. */
  readonly bindingsHomonimos?: boolean
  /** Duas operações dentro do mesmo binding. */
  readonly duasOperacoesNoBinding?: boolean
  /** Dois `wsdl:service`. */
  readonly doisServices?: boolean
  /** `transport` diferente de SOAP sobre HTTP. */
  readonly transporteInvalido?: boolean
  /** `style="rpc"` no binding. */
  readonly estiloRpc?: boolean
  /** `soap12:address/@location` apontando para outro host. */
  readonly enderecoOutroHost?: boolean
  /** `soap12:address/@location` em `http://`. */
  readonly enderecoInseguro?: boolean
  /** Remove a `wsdl:part/@element` da mensagem de entrada. */
  readonly semWrapperDeEntrada?: boolean
  /** `port/@binding` com prefixo não declarado. */
  readonly prefixoNaoDeclarado?: boolean
}

function acaoSintetica(servico: SefazServico, operacao: string): string {
  return `${sefazServiceNamespace(servico)}/${operacao}#${SYNTHETIC_SOAP_ACTION_SUFIXO}`
}

function operacaoDe(servico: SefazServico): string {
  return SEFAZ_WSDL_EXPECTED_OPERATIONS[servico] ?? `op${servico}`
}

/** Monta um WSDL 1.1 sintético, opcionalmente com um defeito estrutural específico. */
export function wsdlFixture(options: WsdlFixtureOptions = {}): string {
  const servico: SefazServico = options.servico ?? "NFeStatusServico4"
  const tns = options.targetNamespaceOverride ?? sefazServiceNamespace(servico)
  const operacao = operacaoDe(servico)
  const soapNs = options.soap11Apenas
    ? "http://schemas.xmlsoap.org/wsdl/soap/"
    : "http://schemas.xmlsoap.org/wsdl/soap12/"
  const prefixoSoap = options.soap11Apenas ? "soap11" : "soap12"
  const transport = options.transporteInvalido
    ? "http://example.invalid/transport"
    : "http://schemas.xmlsoap.org/soap/http"
  const style = options.estiloRpc ? "rpc" : "document"

  const host = options.enderecoOutroHost ? "nfe.fazenda.sp.gov.br" : HOST_HOMOLOGACAO_SP
  const esquema = options.enderecoInseguro ? "http" : "https"
  const location = `${esquema}://${host}/ws/${servico}.asmx`

  const soapActionAttr = options.semSoapAction
    ? ""
    : options.soapActionVazia
      ? ` soapAction=""`
      : ` soapAction="${acaoSintetica(servico, operacao)}"`

  const extensaoOperacao = options.semExtensaoSoapOperation
    ? ""
    : `        <${prefixoSoap}:operation${soapActionAttr} style="${style}" soapActionRequired="true"/>\n`

  const operacaoBinding = (nome: string): string =>
    `      <wsdl:operation name="${nome}">\n` +
    extensaoOperacao +
    `        <wsdl:input><${prefixoSoap}:body use="literal"/></wsdl:input>\n` +
    `        <wsdl:output><${prefixoSoap}:body use="literal"/></wsdl:output>\n` +
    `      </wsdl:operation>\n`

  const binding = (nome: string, operacoes: string[]): string =>
    `  <wsdl:binding name="${nome}" type="tns:${servico}PortType">\n` +
    `    <${prefixoSoap}:binding transport="${transport}" style="${style}"/>\n` +
    operacoes.map(operacaoBinding).join("") +
    `  </wsdl:binding>\n`

  const port = (nomePort: string, nomeBinding: string): string => {
    const referencia = options.prefixoNaoDeclarado ? `ausente:${nomeBinding}` : `tns:${nomeBinding}`
    return (
      `    <wsdl:port name="${nomePort}" binding="${referencia}">\n` +
      `      <${prefixoSoap}:address location="${location}"/>\n` +
      `    </wsdl:port>\n`
    )
  }

  const partEntrada = options.semWrapperDeEntrada
    ? `    <wsdl:part name="parameters" type="tns:qualquer"/>\n`
    : `    <wsdl:part name="nfeDadosMsg" element="tns:nfeDadosMsg"/>\n`

  const bindings = options.bindingsHomonimos
    ? binding(`${servico}Soap12`, [operacao]) + binding(`${servico}Soap12`, [operacao])
    : options.duasOperacoesNoBinding
      ? binding(`${servico}Soap12`, [operacao, `${operacao}Alternativa`])
      : options.doisPortsSoap12
        ? binding(`${servico}Soap12`, [operacao]) + binding(`${servico}Soap12Alt`, [operacao])
        : binding(`${servico}Soap12`, [operacao])

  const ports = options.doisPortsSoap12
    ? port(`${servico}Port`, `${servico}Soap12`) + port(`${servico}PortAlt`, `${servico}Soap12Alt`)
    : port(`${servico}Port`, `${servico}Soap12`)

  const service = (nome: string): string =>
    `  <wsdl:service name="${nome}">\n${ports}  </wsdl:service>\n`

  const services = options.doisServices
    ? service(servico) + service(`${servico}Alt`)
    : service(servico)

  const operacoesPortType = options.duasOperacoesNoBinding
    ? [operacao, `${operacao}Alternativa`]
    : [operacao]

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"\n` +
    `                  xmlns:${prefixoSoap}="${soapNs}"\n` +
    `                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"\n` +
    `                  xmlns:tns="${tns}"\n` +
    `                  targetNamespace="${tns}">\n` +
    `  <wsdl:types>\n` +
    `    <xsd:schema targetNamespace="${tns}">\n` +
    `      <xsd:element name="nfeDadosMsg"/>\n` +
    `      <xsd:element name="nfeResultMsg"/>\n` +
    `    </xsd:schema>\n` +
    `  </wsdl:types>\n` +
    `  <wsdl:message name="${operacao}In">\n` +
    partEntrada +
    `  </wsdl:message>\n` +
    `  <wsdl:message name="${operacao}Out">\n` +
    `    <wsdl:part name="nfeResultMsg" element="tns:nfeResultMsg"/>\n` +
    `  </wsdl:message>\n` +
    (options.duasOperacoesNoBinding
      ? `  <wsdl:message name="${operacao}AlternativaIn">\n` +
        `    <wsdl:part name="nfeDadosMsg" element="tns:nfeDadosMsg"/>\n` +
        `  </wsdl:message>\n` +
        `  <wsdl:message name="${operacao}AlternativaOut">\n` +
        `    <wsdl:part name="nfeResultMsg" element="tns:nfeResultMsg"/>\n` +
        `  </wsdl:message>\n`
      : "") +
    `  <wsdl:portType name="${servico}PortType">\n` +
    operacoesPortType
      .map(
        (nome) =>
          `    <wsdl:operation name="${nome}">\n` +
          `      <wsdl:input message="tns:${nome}In"/>\n` +
          `      <wsdl:output message="tns:${nome}Out"/>\n` +
          `    </wsdl:operation>\n`,
      )
      .join("") +
    `  </wsdl:portType>\n` +
    bindings +
    services +
    `</wsdl:definitions>\n`
  )
}

/** WSDL bem-formado como XML, mas cuja raiz não é `wsdl:definitions`. */
export const WSDL_RAIZ_ERRADA = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>403 Forbidden</body></html>
`

/** XML mal-formado (tag não fechada). */
export const WSDL_MALFORMADO = `<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
  <wsdl:service name="aberto">
</wsdl:definitions>
`

/** WSDL com DTD declarada. */
export const WSDL_COM_DTD = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE definitions [<!ENTITY x "y">]>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"/>
`

export type NFeAutorizacao4FixtureOptions = {
  /** Lista e ordem das operações no binding (padrão: ["nfeAutorizacaoLote", "nfeAutorizacaoLoteZip"]). */
  readonly operations?: readonly string[]
  /** Substitui a soapAction de nfeAutorizacaoLote. */
  readonly soapActionLote?: string
  /** Substitui a soapAction de nfeAutorizacaoLoteZip. */
  readonly soapActionZip?: string
  /** Se true, duplica a operação especificada no binding. */
  readonly duplicateOperation?: string
  /** Se true, omite a declaração de portType. */
  readonly semPortType?: boolean
}

/**
 * Fixture que simula a estrutura real do WSDL do NFeAutorizacao4 (multi-operação).
 * Publica nfeAutorizacaoLote (XML nfeDadosMsg) e nfeAutorizacaoLoteZip (GZip Base64 nfeDadosMsgZip).
 */
export function nfeAutorizacao4MultiOpFixture(
  options: NFeAutorizacao4FixtureOptions = {},
): string {
  const servico: SefazServico = "NFeAutorizacao4"
  const tns = sefazServiceNamespace(servico)
  const location = `https://${HOST_HOMOLOGACAO_SP}/ws/${servico}.asmx`
  const operations = options.operations ?? ["nfeAutorizacaoLote", "nfeAutorizacaoLoteZip"]

  const defaultAction = (op: string): string => {
    if (op === "nfeAutorizacaoLote" && options.soapActionLote) return options.soapActionLote
    if (op === "nfeAutorizacaoLoteZip" && options.soapActionZip) return options.soapActionZip
    return acaoSintetica(servico, op)
  }

  const wrapperIn = (op: string): string =>
    op === "nfeAutorizacaoLoteZip" ? "nfeDadosMsgZip" : "nfeDadosMsg"

  const bindingOperations = [...operations]
  if (options.duplicateOperation) {
    bindingOperations.push(options.duplicateOperation)
  }

  const distinctOps = Array.from(new Set(operations))

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"\n` +
    `                  xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"\n` +
    `                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"\n` +
    `                  xmlns:tns="${tns}"\n` +
    `                  targetNamespace="${tns}">\n` +
    `  <wsdl:types>\n` +
    `    <xsd:schema targetNamespace="${tns}">\n` +
    `      <xsd:element name="nfeDadosMsg"/>\n` +
    `      <xsd:element name="nfeDadosMsgZip"/>\n` +
    `      <xsd:element name="nfeResultMsg"/>\n` +
    `    </xsd:schema>\n` +
    `  </wsdl:types>\n` +
    distinctOps
      .map(
        (op) =>
          `  <wsdl:message name="${op}SoapIn">\n` +
          `    <wsdl:part name="${wrapperIn(op)}" element="tns:${wrapperIn(op)}"/>\n` +
          `  </wsdl:message>\n` +
          `  <wsdl:message name="${op}SoapOut">\n` +
          `    <wsdl:part name="nfeResultMsg" element="tns:nfeResultMsg"/>\n` +
          `  </wsdl:message>\n`,
      )
      .join("") +
    (options.semPortType
      ? ""
      : `  <wsdl:portType name="${servico}Soap12">\n` +
        distinctOps
          .map(
            (op) =>
              `    <wsdl:operation name="${op}">\n` +
              `      <wsdl:input message="tns:${op}SoapIn"/>\n` +
              `      <wsdl:output message="tns:${op}SoapOut"/>\n` +
              `    </wsdl:operation>\n`,
          )
          .join("") +
        `  </wsdl:portType>\n`) +
    `  <wsdl:binding name="${servico}Soap12" type="tns:${servico}Soap12">\n` +
    `    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>\n` +
    bindingOperations
      .map(
        (op) =>
          `    <wsdl:operation name="${op}">\n` +
          `      <soap12:operation soapAction="${defaultAction(op)}" style="document" soapActionRequired="true"/>\n` +
          `      <wsdl:input><soap12:body use="literal"/></wsdl:input>\n` +
          `      <wsdl:output><soap12:body use="literal"/></wsdl:output>\n` +
          `    </wsdl:operation>\n`,
      )
      .join("") +
    `  </wsdl:binding>\n` +
    `  <wsdl:service name="${servico}">\n` +
    `    <wsdl:port name="${servico}Soap12" binding="tns:${servico}Soap12">\n` +
    `      <soap12:address location="${location}"/>\n` +
    `    </wsdl:port>\n` +
    `  </wsdl:service>\n` +
    `</wsdl:definitions>\n`
  )
}
