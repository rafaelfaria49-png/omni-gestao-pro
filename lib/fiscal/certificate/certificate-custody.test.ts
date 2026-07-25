/**
 * GOAL-016B (corretivo) — custódia do certificado A1.
 *
 * Prova a regra única: só é "instalado/configurado" quando blobRef, senhaRef, status ATIVO e
 * ativo=true estão presentes AO MESMO TEMPO. Refs ausentes nunca produzem certificado ativo,
 * nunca aparecem como configurado e nunca autorizam criar linha de certificado.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  MENSAGEM_CUSTODIA_PENDENTE,
  algumCertificadoInstalado,
  certificadoInstalado,
  certificadoTemCustodia,
  decidirRegistroCertificado,
} from "./certificate-custody"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("certificadoTemCustodia", () => {
  it("exige blobRef E senhaRef preenchidas", () => {
    expect(certificadoTemCustodia({ blobRef: "FISCAL_A1_PFX_B64_LOJA_1", senhaRef: "FISCAL_A1_SENHA_LOJA_1" })).toBe(true)
    expect(certificadoTemCustodia({ blobRef: "FISCAL_A1_PFX_B64_LOJA_1", senhaRef: null })).toBe(false)
    expect(certificadoTemCustodia({ blobRef: null, senhaRef: "FISCAL_A1_SENHA_LOJA_1" })).toBe(false)
    expect(certificadoTemCustodia({ blobRef: null, senhaRef: null })).toBe(false)
  })

  it("string em branco não conta como referência", () => {
    expect(certificadoTemCustodia({ blobRef: "   ", senhaRef: "   " })).toBe(false)
  })

  it("aceita a forma sanitizada da API (blobConfigured/senhaConfigured)", () => {
    expect(certificadoTemCustodia({ blobConfigured: true, senhaConfigured: true })).toBe(true)
    expect(certificadoTemCustodia({ blobConfigured: true, senhaConfigured: false })).toBe(false)
  })

  it("null/undefined ⇒ sem custódia", () => {
    expect(certificadoTemCustodia(null)).toBe(false)
    expect(certificadoTemCustodia(undefined)).toBe(false)
  })
})

describe("certificadoInstalado · refs nulas nunca aparecem como configurado", () => {
  const custodia = { blobRef: "FISCAL_A1_PFX_B64_LOJA_1", senhaRef: "FISCAL_A1_SENHA_LOJA_1" }

  it("tudo presente ⇒ instalado", () => {
    expect(certificadoInstalado({ ...custodia, status: "ATIVO", ativo: true })).toBe(true)
  })

  it("sem refs ⇒ NÃO instalado, mesmo com status ATIVO e ativo=true", () => {
    expect(certificadoInstalado({ blobRef: null, senhaRef: null, status: "ATIVO", ativo: true })).toBe(false)
  })

  it("com refs mas inativo ou não validado ⇒ NÃO instalado", () => {
    expect(certificadoInstalado({ ...custodia, status: "ATIVO", ativo: false })).toBe(false)
    expect(certificadoInstalado({ ...custodia, status: "PENDENTE_VALIDACAO", ativo: true })).toBe(false)
    expect(certificadoInstalado({ ...custodia, status: "EXPIRADO", ativo: true })).toBe(false)
    expect(certificadoInstalado({ ...custodia, status: "INVALIDO", ativo: true })).toBe(false)
  })

  it("linha só de metadados (o que o onboarding poderia gerar) ⇒ NÃO instalado", () => {
    const somenteMetadados = { blobRef: null, senhaRef: null, status: "PENDENTE_VALIDACAO", ativo: false }
    expect(certificadoTemCustodia(somenteMetadados)).toBe(false)
    expect(certificadoInstalado(somenteMetadados)).toBe(false)
  })

  it("algumCertificadoInstalado só é true se algum estiver completo", () => {
    const semCustodia = { blobRef: null, senhaRef: null, status: "PENDENTE_VALIDACAO", ativo: false }
    const completo = { ...custodia, status: "ATIVO", ativo: true }
    expect(algumCertificadoInstalado([semCustodia, semCustodia])).toBe(false)
    expect(algumCertificadoInstalado([semCustodia, completo])).toBe(true)
    expect(algumCertificadoInstalado([])).toBe(false)
    expect(algumCertificadoInstalado(null)).toBe(false)
  })
})

describe("decidirRegistroCertificado · refs nulas ⇒ somente identidade", () => {
  it("sem linha existente ⇒ somente_identidade (não cria certificado)", () => {
    expect(decidirRegistroCertificado(null)).toEqual({ acao: "somente_identidade", motivo: "custodia_ausente" })
  })

  it("linha existente SEM custódia ⇒ somente_identidade (não ressuscita fantasma)", () => {
    expect(decidirRegistroCertificado({ id: "cert-1", blobRef: null, senhaRef: null })).toEqual({
      acao: "somente_identidade",
      motivo: "custodia_ausente",
    })
    expect(decidirRegistroCertificado({ id: "cert-1", blobRef: "so-blob", senhaRef: null })).toEqual({
      acao: "somente_identidade",
      motivo: "custodia_ausente",
    })
  })

  it("linha existente COM custódia ⇒ atualiza apenas os metadados", () => {
    expect(
      decidirRegistroCertificado({ id: "cert-9", blobRef: "FISCAL_A1_PFX_B64_LOJA_1", senhaRef: "FISCAL_A1_SENHA_LOJA_1" }),
    ).toEqual({ acao: "atualizar_metadados", certificadoId: "cert-9" })
  })

  it("a decisão nunca ativa nada — não existe ação de ativação neste contrato", () => {
    const decisoes = [
      decidirRegistroCertificado(null),
      decidirRegistroCertificado({ id: "c", blobRef: "b", senhaRef: "s" }),
    ]
    for (const d of decisoes) {
      expect(JSON.stringify(d)).not.toMatch(/ativ/i)
    }
  })
})

describe("mensagem de custódia pendente", () => {
  it("declara importação dos dados, não instalação do certificado, e pede reenvio", () => {
    expect(MENSAGEM_CUSTODIA_PENDENTE).toContain("Dados fiscais importados do certificado")
    expect(MENSAGEM_CUSTODIA_PENDENTE).toContain("não foi armazenado")
    expect(MENSAGEM_CUSTODIA_PENDENTE).toContain("cofre seguro ainda não está configurado")
    expect(MENSAGEM_CUSTODIA_PENDENTE).toContain("reenviar o certificado")
    expect(MENSAGEM_CUSTODIA_PENDENTE).not.toMatch(/instalado com sucesso|configurado com sucesso|conclu[ií]d[oa]\b/i)
  })
})

describe("custódia · zero transmissão", () => {
  it("nenhuma decisão de custódia faz chamada de rede", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    decidirRegistroCertificado(null)
    certificadoInstalado({ blobRef: "b", senhaRef: "s", status: "ATIVO", ativo: true })
    algumCertificadoInstalado([{ blobRef: null, senhaRef: null }])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
