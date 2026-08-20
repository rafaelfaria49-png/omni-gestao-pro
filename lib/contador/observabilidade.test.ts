/**
 * GOAL 019 — observabilidade: nomes canônicos, emissão e contrato de privacidade.
 *
 * O teste de privacidade é feito por TENTATIVA DE VAZAMENTO: alimenta o saneador com
 * exatamente aquilo que a política proíbe (storageRef, URL assinada, e-mail, CPF,
 * CNPJ, nome de cliente, conteúdo de documento) e exige que nada sobreviva — nem
 * inteiro, nem truncado.
 */
import { describe, expect, it, vi } from "vitest"
import {
  CHAVES_LABEL_PERMITIDAS,
  METRICAS,
  metricasPadrao,
  metricasSilenciosas,
  registrarMetrica,
  sanearLabels,
  sinkLogEstruturado,
  type AmostraMetrica,
} from "./observabilidade"

function coletor() {
  const amostras: AmostraMetrica[] = []
  return { amostras, sink: (a: AmostraMetrica) => void amostras.push(a) }
}

describe("nomes canônicos", () => {
  it("expõe as oito métricas exigidas pelo GOAL 019", () => {
    expect(Object.values(METRICAS).sort()).toEqual(
      [
        "contador_portal_access_denied_total",
        "package_generation_duration_ms",
        "package_generation_failures_total",
        "retention_apply_total",
        "retention_bytes_candidate",
        "retention_candidates_total",
        "retention_dry_run_total",
        "retention_failures_total",
      ].sort(),
    )
  })
})

describe("emissão", () => {
  it("emite uma amostra com nome, valor e labels saneadas", () => {
    const { amostras, sink } = coletor()
    registrarMetrica(METRICAS.retencaoCandidatosTotal, 7, { alvo: "documentos", modo: "dry-run" }, sink)
    expect(amostras).toHaveLength(1)
    expect(amostras[0]).toMatchObject({
      evento: "metrica",
      metrica: "retention_candidates_total",
      valor: 7,
      labels: { alvo: "documentos", modo: "dry-run" },
    })
  })

  it("o sink padrão escreve UMA linha JSON em console.info (padrão do HUB)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      registrarMetrica(METRICAS.retencaoDryRunTotal, 1, { modo: "dry-run" })
      expect(spy).toHaveBeenCalledTimes(1)
      const linha = String(spy.mock.calls[0]![0])
      expect(linha.includes("\n")).toBe(false)
      const json = JSON.parse(linha) as AmostraMetrica
      expect(json.metrica).toBe("retention_dry_run_total")
    } finally {
      spy.mockRestore()
    }
  })

  it("valor não-finito vira 0 em vez de contaminar o painel com NaN", () => {
    const { amostras, sink } = coletor()
    registrarMetrica(METRICAS.pacoteGeracaoDuracaoMs, Number.NaN, undefined, sink)
    registrarMetrica(METRICAS.pacoteGeracaoDuracaoMs, Number.POSITIVE_INFINITY, undefined, sink)
    expect(amostras.map((a) => a.valor)).toEqual([0, 0])
  })

  it("um sink que explode NÃO derruba o caminho instrumentado", () => {
    expect(() =>
      registrarMetrica(METRICAS.retencaoFalhasTotal, 1, undefined, () => {
        throw new Error("coletor fora do ar")
      }),
    ).not.toThrow()
  })

  it("a porta silenciosa não emite nada", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      metricasSilenciosas.registrar(METRICAS.retencaoDryRunTotal, 1, { modo: "dry-run" })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it("a porta padrão delega ao log estruturado", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      metricasPadrao.registrar(METRICAS.retencaoApplyTotal, 1, { modo: "apply" })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("contrato de privacidade das labels", () => {
  it("chave fora da allowlist é descartada", () => {
    expect(sanearLabels({ storageRef: "x", email: "a", cpf: "1", nome: "Fulano" })).toEqual({})
    for (const chave of ["storageRef", "url", "email", "cpf", "cnpj", "nome", "cliente", "token"]) {
      expect(CHAVES_LABEL_PERMITIDAS.has(chave), chave).toBe(false)
    }
  })

  const VAZAMENTOS: readonly (readonly [string, string])[] = [
    ["storageRef", "contador/loja-1/2026-08/ckv9x2p0000abc"],
    ["URL assinada", "https://acct.r2.cloudflarestorage.com/b/o?X-Amz-Signature=deadbeef"],
    ["e-mail", "contador@escritorio.com.br"],
    ["CPF formatado", "123.456.789-00"],
    ["CPF sem máscara", "12345678900"],
    ["CNPJ formatado", "12.345.678/0001-90"],
    ["CNPJ sem máscara", "12345678000190"],
    ["telefone", "11987654321"],
    ["nome de cliente", "Maria da Silva"],
    ["conteúdo de documento", "NOTA FISCAL DE SERVICO - VALOR TOTAL R$ 1.234,56 - TOMADOR ..."],
  ]

  for (const [rotulo, valor] of VAZAMENTOS) {
    it(`${rotulo} NÃO sobrevive nem numa chave permitida`, () => {
      // Mesmo usando `motivo`, que É permitida, o valor é recusado pelo formato.
      const saneado = sanearLabels({ motivo: valor, categoria: valor, loja: valor })
      expect(saneado).toEqual({})
    })

    it(`${rotulo} não aparece, nem truncado, na amostra emitida`, () => {
      const { amostras, sink } = coletor()
      registrarMetrica(METRICAS.portalAcessoNegadoTotal, 1, { motivo: valor }, sink)
      const serializado = JSON.stringify(amostras[0])
      expect(serializado).not.toContain(valor)
      // Truncar um storageRef ainda seria um storageRef: nenhum prefixo pode restar.
      expect(serializado).not.toContain(valor.slice(0, 12))
    })
  }

  it("rótulos técnicos legítimos passam intactos", () => {
    expect(
      sanearLabels({
        alvo: "blobs_soft_deletados",
        modo: "apply",
        categoria: "FINANCEIRO",
        resultado: "ok",
        motivo: "acesso_negado",
        loja: "loja-1",
        politica: "anos_5",
        origem: "pacote_sob_demanda",
      }),
    ).toEqual({
      alvo: "blobs_soft_deletados",
      modo: "apply",
      categoria: "FINANCEIRO",
      resultado: "ok",
      motivo: "acesso_negado",
      loja: "loja-1",
      politica: "anos_5",
      origem: "pacote_sob_demanda",
    })
  })

  it("valor puramente numérico NÃO vira label — número é dado, vai em `valor`", () => {
    // É esta regra que fecha a porta para CPF/CNPJ/telefone sem máscara.
    expect(sanearLabels({ politica: 5 })).toEqual({})
    expect(sanearLabels({ motivo: "12345678900" })).toEqual({})
    expect(sanearLabels({ loja: "11987654321" })).toEqual({})
    expect(sanearLabels({ categoria: "0" })).toEqual({})
  })

  it("objeto, array, null e undefined são descartados", () => {
    expect(sanearLabels({ motivo: { a: 1 } })).toEqual({})
    expect(sanearLabels({ motivo: ["a"] })).toEqual({})
    expect(sanearLabels({ motivo: null })).toEqual({})
    expect(sanearLabels({ motivo: undefined })).toEqual({})
    expect(sanearLabels(undefined)).toEqual({})
  })

  it("valor longo demais é descartado inteiro (nada de prefixo)", () => {
    const longo = "a".repeat(41)
    expect(sanearLabels({ motivo: longo })).toEqual({})
    expect(sanearLabels({ motivo: "a".repeat(40) })).toEqual({ motivo: "a".repeat(40) })
  })

  it("o sink padrão nunca lança, mesmo com amostra não serializável", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      const circular = { evento: "metrica", metrica: METRICAS.retencaoDryRunTotal, valor: 1 } as Record<
        string,
        unknown
      >
      circular.labels = circular
      expect(() => sinkLogEstruturado(circular as unknown as AmostraMetrica)).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})
