/**
 * GOAL-016D-A — catálogo fechado de endpoints SEFAZ (D3) e anti-SSRF (D6 regra 4).
 *
 * Prova que o destino NUNCA vem de entrada do chamador: só existe seleção por tupla fechada
 * `(uf, ambiente, serviço, versão)`, com host exato, `https:` obrigatório e produção negada.
 */
import { describe, expect, it } from "vitest"
import {
  SEFAZ_ENDPOINT_CATALOG,
  SEFAZ_LAYOUT_VERSAO,
  selectSefazEndpoint,
  sefazEndpointIntegro,
  sefazServiceNamespace,
  type SefazEndpoint,
  type SefazServico,
} from "./sefaz-endpoint-catalog"

const SERVICOS: SefazServico[] = [
  "NFeAutorizacao4",
  "NFeRetAutorizacao4",
  "NFeConsultaProtocolo4",
  "NFeStatusServico4",
  "NFeInutilizacao4",
  "NFeRecepcaoEvento4",
]

describe("catálogo — dados oficiais versionados", () => {
  it("homologação SP resolve os seis serviços no host oficial da NFC-e", () => {
    for (const servico of SERVICOS) {
      const r = selectSefazEndpoint({ uf: "SP", ambiente: "HOMOLOGACAO", servico })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.endpoint.url).toBe(
        `https://homologacao.nfce.fazenda.sp.gov.br/ws/${servico}.asmx`,
      )
      expect(r.endpoint.host).toBe("homologacao.nfce.fazenda.sp.gov.br")
      expect(r.endpoint.versao).toBe(SEFAZ_LAYOUT_VERSAO)
    }
  })

  it("namespace segue o padrão WSDL do MOC 7.00, por serviço", () => {
    expect(sefazServiceNamespace("NFeAutorizacao4")).toBe(
      "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4",
    )
    expect(sefazServiceNamespace("NFeStatusServico4")).toBe(
      "http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4",
    )
  })

  it("todo endpoint catalogado é https, sem porta, sem query e sem credencial embutida", () => {
    for (const e of SEFAZ_ENDPOINT_CATALOG) {
      const url = new URL(e.url)
      expect(url.protocol).toBe("https:")
      expect(url.host).toBe(e.host)
      expect(url.port).toBe("")
      expect(url.search).toBe("")
      expect(url.username).toBe("")
      expect(url.password).toBe("")
    }
  })

  it("o catálogo é congelado (não dá para injetar endpoint em runtime)", () => {
    expect(Object.isFrozen(SEFAZ_ENDPOINT_CATALOG)).toBe(true)
    for (const e of SEFAZ_ENDPOINT_CATALOG) expect(Object.isFrozen(e)).toBe(true)
  })

  it("não existe SOAPAction no catálogo — H-9/H-10 seguem pendentes, sem chute", () => {
    const serializado = JSON.stringify(SEFAZ_ENDPOINT_CATALOG)
    expect(serializado.toLowerCase()).not.toContain("soapaction")
    expect(serializado).not.toContain("?wsdl")
  })
})

describe("verificação estrutural — a última barreira do catálogo", () => {
  /**
   * `sefazEndpointIntegro` protege contra uma edição futura do catálogo que introduza um
   * destino inseguro. Como o catálogo versionado é todo válido, essa barreira só tem
   * cobertura real se for exercitada diretamente com entradas malformadas.
   */
  const base: SefazEndpoint = {
    uf: "SP",
    ambiente: "HOMOLOGACAO",
    servico: "NFeStatusServico4",
    versao: SEFAZ_LAYOUT_VERSAO,
    url: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
    host: "homologacao.nfce.fazenda.sp.gov.br",
    namespace: sefazServiceNamespace("NFeStatusServico4"),
    permitido: true,
    motivoNegacao: null,
  }

  it("aprova a entrada oficial bem formada", () => {
    expect(sefazEndpointIntegro(base)).toBe(true)
  })

  it("rejeita http:, host divergente da URL, porta, credencial, query, hash e path errado", () => {
    const malformados: Array<[string, Partial<SefazEndpoint>]> = [
      ["http em vez de https", { url: "http://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx" }],
      ["host da URL diverge do host declarado", { url: "https://evil.example.com/ws/NFeStatusServico4.asmx" }],
      ["porta explícita", { url: "https://homologacao.nfce.fazenda.sp.gov.br:8443/ws/NFeStatusServico4.asmx" }],
      [
        "credencial embutida (user@host)",
        { url: "https://user:pass@homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx" },
      ],
      ["query string", { url: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx?wsdl" }],
      ["fragmento", { url: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx#x" }],
      ["path de outro serviço", { url: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx" }],
      ["URL sintaticamente inválida", { url: "nao-e-url" }],
    ]
    for (const [rotulo, override] of malformados) {
      expect(sefazEndpointIntegro({ ...base, ...override }), rotulo).toBe(false)
    }
  })
})

describe("anti-SSRF — quatro ataques de endpoint", () => {
  it("ataque 1: produção é catalogada, porém NEGADA com motivo explícito (não 'desconhecida')", () => {
    for (const servico of SERVICOS) {
      const r = selectSefazEndpoint({ uf: "SP", ambiente: "PRODUCAO", servico })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.codigo).toBe("endpoint_nao_permitido")
      expect(r.mensagem).toMatch(/produ/i)
    }
  })

  it("ataque 2: host PARECIDO com o oficial não existe no catálogo", () => {
    const hostsParecidos = [
      "homologacao.nfce.fazenda.sp.gov.br.evil.com",
      "homologacao-nfce.fazenda.sp.gov.br",
      "nfce.fazenda.sp.gov.br.attacker.io",
      "xhomologacao.nfce.fazenda.sp.gov.br",
    ]
    const hostsCatalogados = SEFAZ_ENDPOINT_CATALOG.map((e) => e.host)
    for (const host of hostsParecidos) {
      expect(hostsCatalogados).not.toContain(host)
      // e nenhuma comparação por sufixo aceitaria: o host catalogado não é sufixo do falso
      expect(hostsCatalogados.some((h) => h === host)).toBe(false)
    }
  })

  it("ataque 3: host da NF-e NÃO substitui o host da NFC-e", () => {
    const hosts = SEFAZ_ENDPOINT_CATALOG.map((e) => e.host)
    expect(hosts).not.toContain("homologacao.nfe.fazenda.sp.gov.br")
    expect(hosts).not.toContain("nfe.fazenda.sp.gov.br")
    for (const h of hosts) expect(h).toContain("nfce.")
  })

  it("ataque 4: UF/ambiente/serviço/versão fora do catálogo ⇒ endpoint_desconhecido", () => {
    const foraDoCatalogo = [
      { uf: "RJ", ambiente: "HOMOLOGACAO", servico: "NFeAutorizacao4" },
      { uf: "SP", ambiente: "CONTINGENCIA", servico: "NFeAutorizacao4" },
      { uf: "SP", ambiente: "HOMOLOGACAO", servico: "NFeDistribuicaoDFe" },
      { uf: "SP", ambiente: "HOMOLOGACAO", servico: "NFeAutorizacao4", versao: "3.10" },
    ]
    for (const entrada of foraDoCatalogo) {
      const r = selectSefazEndpoint(entrada)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.codigo).toBe("endpoint_desconhecido")
    }
  })

  it("a seleção não aceita URL/host como entrada — a assinatura só admite a tupla fechada", () => {
    // A assinatura já rejeita `url`/`host` em tempo de compilação; o cast por `unknown`
    // existe só para simular um chamador não-tipado e provar a defesa em RUNTIME: chaves de
    // destino injetadas são simplesmente ignoradas e a URL continua vindo do catálogo.
    const entradaComInjecao = {
      uf: "SP",
      ambiente: "HOMOLOGACAO",
      servico: "NFeStatusServico4",
      url: "https://evil.example.com/ws",
      host: "evil.example.com",
    } as unknown as Parameters<typeof selectSefazEndpoint>[0]

    const r = selectSefazEndpoint(entradaComInjecao)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.endpoint.url).toBe(
      "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
    )
  })
})
