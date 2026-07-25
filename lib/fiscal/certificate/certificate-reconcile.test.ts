/**
 * GOAL-016B — reconciliação do certificado com a loja e procedência por campo.
 *
 * Prova: bloqueio por CNPJ divergente e por certificado de outra unidade; troca entre lojas;
 * dados parciais viram pendência; ausência de fonte cadastral cai no pré-preenchimento da loja;
 * nome comercial interno NUNCA substitui razão social; payload de gravação não carrega
 * `fiscalEnabled`, provider nem CSC; e nada aqui transmite.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  montarPayloadIdentidadeConfirmada,
  reconciliarOnboarding,
  type CertificadosContexto,
  type FiscalLojaSnapshot,
  type StoreSnapshot,
} from "./certificate-reconcile"
import { LOOKUP_NAO_CONFIGURADO_MENSAGEM, type FiscalIdentityLookupResultado } from "./lookup-provider"
import type { CampoIdentidadeFiscal, CampoOnboarding, CertificadoExtraido } from "./onboarding-types"

const CNPJ_LOJA1 = "11222333000181"
const CNPJ_OUTRO = "45723174000110"

const LOOKUP_NAO_CONFIGURADO: FiscalIdentityLookupResultado = {
  status: "nao_configurado",
  mensagem: LOOKUP_NAO_CONFIGURADO_MENSAGEM,
}

const SEM_CERTIFICADOS: CertificadosContexto = {
  fingerprintJaRegistradaNestaLoja: false,
  possuiAtivoComOutraFingerprint: false,
  fingerprintVinculadaAOutraLoja: false,
}

function certificado(over: Partial<CertificadoExtraido> = {}): CertificadoExtraido {
  return {
    cnpj: CNPJ_LOJA1,
    titularCn: `RAFACELL COMERCIO LTDA:${CNPJ_LOJA1}`,
    subject: `CN=RAFACELL COMERCIO LTDA:${CNPJ_LOJA1}`,
    nomeEmpresarial: "RAFACELL COMERCIO LTDA",
    email: "fiscal@rafacell.test",
    validoDe: "2026-01-01T00:00:00.000Z",
    validoAte: "2027-01-01T00:00:00.000Z",
    autoridadeCertificadora: "AC TESTE RFB v5",
    serialNumber: "0a1b2c3d",
    fingerprintSha1: "aa".repeat(20),
    cadeiaDisponivel: true,
    vigente: true,
    chavePublicaRsaBits: 2048,
    ...over,
  }
}

function fiscalLoja(over: Partial<FiscalLojaSnapshot> = {}): FiscalLojaSnapshot {
  return {
    fiscalEnabled: false,
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: CNPJ_LOJA1,
    inscricaoEstadual: "",
    inscricaoMunicipal: "",
    cnae: "",
    regimeTributario: "SIMPLES_NACIONAL",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    codigoMunicipioIbge: "",
    municipio: "",
    uf: "",
    cep: "",
    fone: "",
    email: "",
    ...over,
  }
}

function store(over: Partial<StoreSnapshot> = {}): StoreSnapshot {
  return {
    nome: "Rafacell Matriz",
    cnpj: CNPJ_LOJA1,
    telefone: "1140028922",
    endereco: { rua: "Rua das Flores", numero: "100", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01001000" },
    ...over,
  }
}

function campo(campos: CampoOnboarding[], nome: CampoIdentidadeFiscal): CampoOnboarding {
  const c = campos.find((x) => x.campo === nome)
  if (!c) throw new Error(`campo ${nome} ausente na prévia`)
  return c
}

function base(over: Partial<Parameters<typeof reconciliarOnboarding>[0]> = {}) {
  return reconciliarOnboarding({
    storeId: "loja-1",
    extraido: certificado(),
    bloqueiosInspecao: [],
    fiscalLoja: fiscalLoja(),
    store: store(),
    lookup: LOOKUP_NAO_CONFIGURADO,
    certificados: SEM_CERTIFICADOS,
    ...over,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("reconciliarOnboarding · CNPJ e loja (item 3)", () => {
  it("CNPJ do certificado igual ao da loja ⇒ confere, sem bloqueio, pode confirmar", () => {
    const p = base()
    expect(p.podeConfirmar).toBe(true)
    expect(p.bloqueios).toEqual([])
    expect(p.reconciliacao).toMatchObject({
      cnpjCertificado: CNPJ_LOJA1,
      cnpjLojaFiscal: CNPJ_LOJA1,
      cnpjStore: CNPJ_LOJA1,
      confere: true,
    })
    expect(campo(p.campos, "cnpj").origem).toBe("certificado")
  })

  it("CNPJ divergente ⇒ bloqueio cnpj_divergente e confirmação travada", () => {
    const p = base({ extraido: certificado({ cnpj: CNPJ_OUTRO }) })
    expect(p.podeConfirmar).toBe(false)
    expect(p.bloqueios.map((b) => b.codigo)).toContain("cnpj_divergente")
    expect(p.reconciliacao.confere).toBe(false)
    expect(campo(p.campos, "cnpj").origem).toBe("divergente")
  })

  it("troca entre lojas: o MESMO certificado passa na loja dona e é bloqueado na outra", () => {
    const cert = certificado()
    const naLojaDona = base({ storeId: "loja-1", extraido: cert })
    const naOutraLoja = reconciliarOnboarding({
      storeId: "loja-2",
      extraido: cert,
      bloqueiosInspecao: [],
      fiscalLoja: fiscalLoja({ cnpj: CNPJ_OUTRO }),
      store: store({ cnpj: CNPJ_OUTRO, nome: "Rafa Brinquedos" }),
      lookup: LOOKUP_NAO_CONFIGURADO,
      certificados: SEM_CERTIFICADOS,
    })

    expect(naLojaDona.podeConfirmar).toBe(true)
    expect(naOutraLoja.podeConfirmar).toBe(false)
    expect(naOutraLoja.bloqueios.map((b) => b.codigo)).toContain("cnpj_divergente")
    // As referências de custódia são por loja — jamais cruzam unidades.
    expect(naLojaDona.custodia.blobRefEsperada).not.toBe(naOutraLoja.custodia.blobRefEsperada)
  })

  it("mesma fingerprint vinculada a outra unidade ⇒ bloqueio certificado_de_outra_loja", () => {
    const p = base({
      certificados: { ...SEM_CERTIFICADOS, fingerprintVinculadaAOutraLoja: true },
    })
    expect(p.podeConfirmar).toBe(false)
    expect(p.bloqueios.map((b) => b.codigo)).toContain("certificado_de_outra_loja")
  })

  it("loja sem CNPJ cadastrado ⇒ adota o do certificado, sem bloquear", () => {
    const p = base({ fiscalLoja: fiscalLoja({ cnpj: "" }), store: store({ cnpj: "" }) })
    expect(p.podeConfirmar).toBe(true)
    expect(campo(p.campos, "cnpj")).toMatchObject({ valor: CNPJ_LOJA1, origem: "certificado" })
  })

  it("bloqueios da inspeção (ex.: vencido) são preservados na prévia", () => {
    const p = base({
      bloqueiosInspecao: [{ codigo: "certificado_vencido", mensagem: "Certificado vencido — não pode ser usado." }],
      extraido: certificado({ vigente: false }),
    })
    expect(p.podeConfirmar).toBe(false)
    expect(p.bloqueios.map((b) => b.codigo)).toContain("certificado_vencido")
  })
})

describe("reconciliarOnboarding · origem por campo (item 5)", () => {
  it("o certificado só alimenta CNPJ, razão social e e-mail — endereço/IE/regime vêm da loja", () => {
    const p = base({
      fiscalLoja: fiscalLoja({ inscricaoEstadual: "111222333444", uf: "SP", municipio: "São Paulo" }),
    })
    expect(campo(p.campos, "cnpj").origem).toBe("certificado")
    expect(campo(p.campos, "razaoSocial")).toMatchObject({ valor: "RAFACELL COMERCIO LTDA", origem: "certificado" })
    expect(campo(p.campos, "email")).toMatchObject({ valor: "fiscal@rafacell.test", origem: "certificado" })

    for (const nome of ["logradouro", "bairro", "cep", "municipio", "uf", "inscricaoEstadual", "regimeTributario"] as const) {
      expect(campo(p.campos, nome).origem).not.toBe("certificado")
    }
  })

  it("sem fonte cadastral configurada ⇒ endereço é herdado da loja e marcado como origem 'loja'", () => {
    const p = base()
    expect(p.lookup).toMatchObject({ status: "nao_configurado", fonte: "", consultadoEm: null })
    expect(p.lookup.mensagem).toBe(LOOKUP_NAO_CONFIGURADO_MENSAGEM)
    expect(campo(p.campos, "logradouro")).toMatchObject({ valor: "Rua das Flores", origem: "loja", fonte: "Cadastro da loja" })
    expect(campo(p.campos, "uf")).toMatchObject({ valor: "SP", origem: "loja" })
    // Herança do cadastro operacional tem confiança baixa ⇒ pede confirmação humana.
    expect(campo(p.campos, "logradouro").requerConfirmacao).toBe(true)
  })

  it("com fonte cadastral configurada ⇒ campos ganham origem 'fonte_cadastral' com data e confiança", () => {
    const consultadoEm = "2026-07-25T12:00:00.000Z"
    const lookup: FiscalIdentityLookupResultado = {
      status: "ok",
      fonte: "Fonte cadastral homologada",
      consultadoEm,
      campos: {
        logradouro: { valor: "Avenida Paulista", fonte: "Fonte cadastral homologada", obtidoEm: consultadoEm, confianca: "alta" },
        inscricaoEstadual: { valor: "112233445566", fonte: "Fonte cadastral homologada", obtidoEm: consultadoEm, confianca: "alta" },
      },
    }
    const p = base({ lookup })
    expect(p.lookup).toMatchObject({ status: "ok", fonte: "Fonte cadastral homologada", consultadoEm })
    expect(campo(p.campos, "inscricaoEstadual")).toMatchObject({
      valor: "112233445566",
      origem: "fonte_cadastral",
      obtidoEm: consultadoEm,
      confianca: "alta",
    })
    // Fonte externa discorda do que a loja tem gravado ⇒ divergente, exige decisão humana.
    const log = campo(p.campos, "logradouro")
    expect(log.origem).toBe("divergente")
    expect(log.valor).toBe("Avenida Paulista")
    expect(log.valorAlternativo).toBe("Rua das Flores")
    expect(log.requerConfirmacao).toBe(true)
  })

  it("dados parciais ⇒ campos sem nenhuma fonte ficam pendentes e listados em pendencias", () => {
    const p = base({ fiscalLoja: fiscalLoja({ cnpj: CNPJ_LOJA1 }), store: null })
    expect(campo(p.campos, "inscricaoEstadual").origem).toBe("pendente")
    expect(campo(p.campos, "codigoMunicipioIbge").origem).toBe("pendente")
    expect(p.pendencias).toContain("inscricaoEstadual")
    expect(p.pendencias).toContain("codigoMunicipioIbge")
    expect(p.pendencias).not.toContain("cnpj")
  })

  it("valor digitado pelo usuário aparece com origem 'manual'", () => {
    const p = base({ manual: { inscricaoMunicipal: "9988776", nomeFantasia: "Rafacell Centro" } })
    expect(campo(p.campos, "inscricaoMunicipal")).toMatchObject({ valor: "9988776", origem: "manual" })
    expect(campo(p.campos, "nomeFantasia")).toMatchObject({ valor: "Rafacell Centro", origem: "manual" })
  })
})

describe("reconciliarOnboarding · nome comercial interno ≠ razão social (item 5)", () => {
  it("nome comercial interno nunca vem do certificado e não substitui a razão social", () => {
    const p = base({ manual: { nomeFantasia: "Loja do Centro" } })
    expect(campo(p.campos, "nomeFantasia")).toMatchObject({ valor: "Loja do Centro", origem: "manual" })
    expect(campo(p.campos, "razaoSocial")).toMatchObject({ valor: "RAFACELL COMERCIO LTDA", origem: "certificado" })

    const payload = montarPayloadIdentidadeConfirmada(p.campos, { nomeFantasia: "Loja do Centro" })
    expect(payload.nomeFantasia).toBe("Loja do Centro")
    expect(payload.razaoSocial).toBe("RAFACELL COMERCIO LTDA")
  })

  it("sem nome comercial informado, o campo fica pendente — não é preenchido com o nome empresarial", () => {
    const p = base({ store: null, fiscalLoja: fiscalLoja({ nomeFantasia: "" }) })
    expect(campo(p.campos, "nomeFantasia").origem).toBe("pendente")
    expect(campo(p.campos, "nomeFantasia").valor).toBe("")
  })
})

describe("montarPayloadIdentidadeConfirmada · o que pode e o que não pode ser gravado (item 6)", () => {
  it("payload contém só campos de identidade — nunca fiscalEnabled, provider, CSC, ambiente ou série", () => {
    const p = base()
    const payload = montarPayloadIdentidadeConfirmada(p.campos)
    const chaves = Object.keys(payload)
    for (const proibida of ["fiscalEnabled", "provider", "providerConfig", "cscId", "cscTokenRef", "ambiente", "modeloFiscal", "serieFiscalPadrao", "certificadoAtivoId"]) {
      expect(chaves).not.toContain(proibida)
    }
    expect(chaves.sort()).toEqual(
      [
        "bairro", "cep", "cnae", "cnpj", "codigoMunicipioIbge", "complemento", "email", "fone",
        "inscricaoEstadual", "inscricaoMunicipal", "logradouro", "municipio", "nomeFantasia",
        "numero", "razaoSocial", "regimeTributario", "uf",
      ].sort(),
    )
  })

  it("o CNPJ não é sobrescrevível pelo usuário — a reconciliação manda", () => {
    const p = base()
    const payload = montarPayloadIdentidadeConfirmada(p.campos, { cnpj: CNPJ_OUTRO })
    expect(payload.cnpj).toBe(CNPJ_LOJA1)
  })

  it("valores confirmados manualmente vencem os herdados", () => {
    const p = base()
    const payload = montarPayloadIdentidadeConfirmada(p.campos, { logradouro: "Rua Confirmada", numero: "77" })
    expect(payload.logradouro).toBe("Rua Confirmada")
    expect(payload.numero).toBe("77")
  })
})

describe("reconciliarOnboarding · dormência e custódia (itens 6 e 7)", () => {
  it("reflete fiscalEnabled da loja (false) e declara transmissão nenhuma", () => {
    const p = base()
    expect(p.fiscalEnabledAtual).toBe(false)
    expect(p.transmissao).toBe("nenhuma")
  })

  it("custódia do segredo fica pendente e aponta as referências canônicas da própria loja", () => {
    const p = base({ storeId: "loja-1" })
    expect(p.custodia.pendente).toBe(true)
    expect(p.custodia.blobRefEsperada).toBe("FISCAL_A1_PFX_B64_LOJA_1")
    expect(p.custodia.senhaRefEsperada).toBe("FISCAL_A1_SENHA_LOJA_1")
  })

  it("sinaliza reaproveitamento e substituição de certificado sem bloquear", () => {
    const p = base({
      certificados: {
        fingerprintJaRegistradaNestaLoja: true,
        possuiAtivoComOutraFingerprint: true,
        fingerprintVinculadaAOutraLoja: false,
      },
    })
    expect(p.podeConfirmar).toBe(true)
    expect(p.reconciliacao.jaRegistradoNestaLoja).toBe(true)
    expect(p.reconciliacao.substituiraCertificadoAtivo).toBe(true)
  })

  it("a reconciliação não faz nenhuma chamada de rede (zero transmissão)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    base()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
