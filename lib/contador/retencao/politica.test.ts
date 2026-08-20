/**
 * GOAL 019 — política de retenção. Matriz de aceite do GOAL, item a item.
 *
 * As datas são fixas e em UTC; nada aqui depende do relógio da máquina nem do fuso
 * do runner — um teste de retenção que muda de resultado conforme o dia é pior que
 * nenhum teste.
 */
import { describe, expect, it } from "vitest"
import {
  BLOB_SOFT_DELETADO_RETENCAO_DIAS,
  blobSoftDeletadoElegivel,
  CATEGORIAS_DOCUMENTO,
  corteBlobSoftDeletado,
  corteDocumento,
  cortePacote,
  documentoElegivelPorIdade,
  FINANCEIRO_RETENCAO_ANOS,
  OUTRO_RETENCAO_ANOS,
  PACOTE_RETENCAO_MESES,
  pacoteElegivel,
  PURGE_DISABLED,
  purgaPorIdadeDesabilitada,
  referenciaIdadeDocumento,
  RETENCAO_DOCUMENTOS,
  subtrairAnosUtc,
  subtrairDiasUtc,
  subtrairMesesUtc,
  type CategoriaDocumentoRetencao,
} from "./politica"

const AGORA = new Date("2026-08-20T12:00:00.000Z")

/** Documento cuja competência e createdAt caem na mesma data — o caso simples. */
function doc(categoria: CategoriaDocumentoRetencao, quando: string) {
  const d = new Date(quando)
  return { categoria, competenciaFimExclusivo: d, createdAt: d }
}

describe("números aprovados (decisão humana de 2026-08-20)", () => {
  it("os quatro números batem com a decisão publicada", () => {
    expect(FINANCEIRO_RETENCAO_ANOS).toBe(5)
    expect(OUTRO_RETENCAO_ANOS).toBe(5)
    expect(PACOTE_RETENCAO_MESES).toBe(12)
    expect(BLOB_SOFT_DELETADO_RETENCAO_DIAS).toBe(90)
  })

  it("toda categoria do enum tem política declarada (Record exaustivo)", () => {
    for (const categoria of CATEGORIAS_DOCUMENTO) {
      expect(RETENCAO_DOCUMENTOS[categoria], categoria).toBeDefined()
      expect(RETENCAO_DOCUMENTOS[categoria].fundamento.length).toBeGreaterThan(0)
    }
  })
})

describe("FISCAL / JURIDICO / FOLHA — sem purga automática por idade", () => {
  for (const categoria of ["FISCAL", "JURIDICO", "FOLHA"] as const) {
    it(`${categoria} é PURGE_DISABLED e não tem data de corte`, () => {
      expect(RETENCAO_DOCUMENTOS[categoria].tipo).toBe(PURGE_DISABLED)
      expect(purgaPorIdadeDesabilitada(categoria)).toBe(true)
      expect(corteDocumento(categoria, AGORA)).toBeNull()
    })

    it(`${categoria} nunca é elegível por idade — nem com 50 anos`, () => {
      expect(documentoElegivelPorIdade(doc(categoria, "1976-01-01T00:00:00.000Z"), AGORA)).toBe(false)
      expect(documentoElegivelPorIdade(doc(categoria, "1900-01-01T00:00:00.000Z"), AGORA)).toBe(false)
    })
  }
})

describe("FINANCEIRO / OUTRO — janela de 5 anos", () => {
  for (const categoria of ["FINANCEIRO", "OUTRO"] as const) {
    it(`${categoria} com menos de 5 anos é PROTEGIDO`, () => {
      expect(documentoElegivelPorIdade(doc(categoria, "2024-08-20T12:00:00.000Z"), AGORA)).toBe(false)
      expect(documentoElegivelPorIdade(doc(categoria, "2021-08-21T12:00:00.000Z"), AGORA)).toBe(false)
    })

    it(`${categoria} com mais de 5 anos é CANDIDATO`, () => {
      expect(documentoElegivelPorIdade(doc(categoria, "2021-08-19T12:00:00.000Z"), AGORA)).toBe(true)
      expect(documentoElegivelPorIdade(doc(categoria, "2015-01-01T00:00:00.000Z"), AGORA)).toBe(true)
    })

    it(`${categoria} exatamente na borda dos 5 anos é PROTEGIDO (empate protege)`, () => {
      expect(documentoElegivelPorIdade(doc(categoria, "2021-08-20T12:00:00.000Z"), AGORA)).toBe(false)
    })
  }
})

describe("referência de idade — o mais recente entre competência e createdAt", () => {
  it("documento antigo anexado ontem NÃO fica elegível pelo createdAt novo", () => {
    const entrada = {
      categoria: "FINANCEIRO" as const,
      competenciaFimExclusivo: new Date("2015-02-01T00:00:00.000Z"),
      createdAt: new Date("2026-08-19T00:00:00.000Z"),
    }
    expect(referenciaIdadeDocumento(entrada)).toEqual(entrada.createdAt)
    expect(documentoElegivelPorIdade(entrada, AGORA)).toBe(false)
  })

  it("competência recente com createdAt antigo também protege", () => {
    const entrada = {
      categoria: "OUTRO" as const,
      competenciaFimExclusivo: new Date("2026-08-01T00:00:00.000Z"),
      createdAt: new Date("2015-01-01T00:00:00.000Z"),
    }
    expect(referenciaIdadeDocumento(entrada)).toEqual(entrada.competenciaFimExclusivo)
    expect(documentoElegivelPorIdade(entrada, AGORA)).toBe(false)
  })
})

describe("pacotes — janela de 12 meses", () => {
  it("gerado há menos de 12 meses é PROTEGIDO", () => {
    expect(pacoteElegivel(new Date("2026-01-10T00:00:00.000Z"), AGORA)).toBe(false)
    expect(pacoteElegivel(new Date("2025-08-21T00:00:00.000Z"), AGORA)).toBe(false)
  })

  it("gerado há mais de 12 meses é CANDIDATO", () => {
    expect(pacoteElegivel(new Date("2025-08-19T00:00:00.000Z"), AGORA)).toBe(true)
    expect(pacoteElegivel(new Date("2023-03-01T00:00:00.000Z"), AGORA)).toBe(true)
  })

  it("exatamente 12 meses é PROTEGIDO (empate protege)", () => {
    expect(pacoteElegivel(cortePacote(AGORA), AGORA)).toBe(false)
  })
})

describe("blob soft-deletado — janela de 90 dias, borda INCLUSIVA", () => {
  it("menos de 90 dias desde excluidoEm é PROTEGIDO", () => {
    expect(blobSoftDeletadoElegivel(subtrairDiasUtc(AGORA, 89), AGORA)).toBe(false)
    expect(blobSoftDeletadoElegivel(subtrairDiasUtc(AGORA, 1), AGORA)).toBe(false)
  })

  it("exatamente 90 dias é CANDIDATO (decisão literal: excluidoEm + 90d <= agora)", () => {
    expect(blobSoftDeletadoElegivel(corteBlobSoftDeletado(AGORA), AGORA)).toBe(true)
    expect(blobSoftDeletadoElegivel(subtrairDiasUtc(AGORA, 90), AGORA)).toBe(true)
  })

  it("mais de 90 dias é CANDIDATO", () => {
    expect(blobSoftDeletadoElegivel(subtrairDiasUtc(AGORA, 91), AGORA)).toBe(true)
    expect(blobSoftDeletadoElegivel(new Date("2020-01-01T00:00:00.000Z"), AGORA)).toBe(true)
  })

  it("documento nunca excluído nunca é candidato por esta política", () => {
    expect(blobSoftDeletadoElegivel(null, AGORA)).toBe(false)
  })
})

describe("aritmética de calendário civil (não múltiplo fixo de dias)", () => {
  it("5 anos antes é a MESMA data, não 1825 ou 1826 dias", () => {
    expect(subtrairAnosUtc(new Date("2026-08-20T12:00:00.000Z"), 5).toISOString()).toBe(
      "2021-08-20T12:00:00.000Z",
    )
  })

  it("29/02 menos 1 ano faz CLAMP para 28/02 — nunca vaza para 01/03", () => {
    expect(subtrairAnosUtc(new Date("2024-02-29T00:00:00.000Z"), 1).toISOString()).toBe(
      "2023-02-28T00:00:00.000Z",
    )
  })

  it("31/03 menos 1 mês faz CLAMP para o fim de fevereiro", () => {
    expect(subtrairMesesUtc(new Date("2026-03-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    )
    expect(subtrairMesesUtc(new Date("2024-03-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    )
  })

  it("12 meses atravessa a virada de ano corretamente", () => {
    expect(subtrairMesesUtc(new Date("2026-01-15T08:30:00.000Z"), 12).toISOString()).toBe(
      "2025-01-15T08:30:00.000Z",
    )
    expect(subtrairMesesUtc(new Date("2026-01-15T08:30:00.000Z"), 13).toISOString()).toBe(
      "2024-12-15T08:30:00.000Z",
    )
  })

  it("a janela de 5 anos atravessa anos bissextos sem deriva", () => {
    // 2020 e 2024 são bissextos: uma aproximação por 365 dias erraria em 2 dias.
    const corte = corteDocumento("FINANCEIRO", new Date("2026-03-01T00:00:00.000Z"))
    expect(corte?.toISOString()).toBe("2021-03-01T00:00:00.000Z")
  })

  it("90 dias é contagem corrida — a única unidade em que o múltiplo é correto", () => {
    expect(subtrairDiasUtc(new Date("2026-08-20T12:00:00.000Z"), 90).toISOString()).toBe(
      "2026-05-22T12:00:00.000Z",
    )
  })
})
