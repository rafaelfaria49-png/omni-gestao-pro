import { describe, expect, it } from "vitest"

import {
  IMPORTACAO_HISTORICO_MAX,
  construirLoteImportacao,
  getImportacaoMetadata,
  marcarLoteRevisado,
  mergeImportacaoIntoMetadata,
  sanitizeLoteImportacao,
  type LoteImportacaoMetadata,
} from "./metadata"
import { CONTEXTO_LOTE_VAZIO, type ContextoLoteImport } from "./types"

const CONTEXTO: ContextoLoteImport = {
  fornecedor: { nome: "MARTINS COM SERV DISTR SA", documento: "43.214.055/0040-13" },
  documento: {
    tipo: "nfe",
    numero: "5380135",
    serie: "0",
    chave: "52260143214055004013550000053801351857035145",
    dataEmissao: "2026-01-02",
  },
  observacao: "",
  politicaEstoque: "nao_movimentar",
}

function lote(over: Partial<LoteImportacaoMetadata> = {}): LoteImportacaoMetadata {
  return {
    ...construirLoteImportacao({
      batchId: "adv-1",
      arquivo: "nfe-5380135-martins.xlsx",
      importadoEm: "2026-07-29T10:00:00.000Z",
      acao: "criado",
      matchPor: null,
      linhaOrigem: 1,
      contexto: CONTEXTO,
    }),
    ...over,
  }
}

describe("construirLoteImportacao", () => {
  it("registra batchId, arquivo, data, ação, match, fornecedor, documento e revisão", () => {
    expect(lote({ acao: "atualizado", matchPor: "nome_exato" })).toEqual({
      batchId: "adv-1",
      origem: "planilha",
      arquivo: "nfe-5380135-martins.xlsx",
      importadoEm: "2026-07-29T10:00:00.000Z",
      acao: "atualizado",
      matchPor: "nome_exato",
      fornecedor: { nome: "MARTINS COM SERV DISTR SA", documento: "43.214.055/0040-13" },
      documento: {
        tipo: "nfe",
        numero: "5380135",
        serie: "0",
        chave: "52260143214055004013550000053801351857035145",
        dataEmissao: "2026-01-02",
      },
      linhaOrigem: 1,
      statusRevisao: "pendente",
      revisadoEm: null,
      revisadoPor: null,
    })
  })

  it("contexto vazio produz fornecedor e documento nulos", () => {
    const l = construirLoteImportacao({
      batchId: "adv-2",
      arquivo: "x.csv",
      acao: "criado",
      matchPor: null,
      linhaOrigem: 3,
      contexto: { ...CONTEXTO_LOTE_VAZIO },
    })
    expect(l.fornecedor).toBeNull()
    expect(l.documento).toBeNull()
  })
})

describe("sanitizeLoteImportacao", () => {
  it("descarta lote sem batchId", () => {
    expect(sanitizeLoteImportacao({ arquivo: "x" })).toBeNull()
    expect(sanitizeLoteImportacao(null)).toBeNull()
    expect(sanitizeLoteImportacao("texto")).toBeNull()
  })

  it("normaliza matchPor desconhecido para null e statusRevisao inválido para pendente", () => {
    const l = sanitizeLoteImportacao({ batchId: "b", matchPor: "chute", statusRevisao: "sei-la" })
    expect(l?.matchPor).toBeNull()
    expect(l?.statusRevisao).toBe("pendente")
  })

  it("aceita os 4 matchPor do contrato", () => {
    for (const m of ["barcode", "sku", "codigo_fornecedor", "nome_exato"]) {
      expect(sanitizeLoteImportacao({ batchId: "b", matchPor: m })?.matchPor).toBe(m)
    }
  })
})

describe("mergeImportacaoIntoMetadata", () => {
  it("preserva TODOS os outros namespaces de metadata", () => {
    const base = {
      fiscal: { ncm: "18069000" },
      atributos: { tags: ["a"] },
      acessorios: { habilitado: true },
      catalogoAparelhos: { x: 1 },
    }
    const out = mergeImportacaoIntoMetadata(base, lote())
    expect(out.fiscal).toEqual({ ncm: "18069000" })
    expect(out.atributos).toEqual({ tags: ["a"] })
    expect(out.acessorios).toEqual({ habilitado: true })
    expect(out.catalogoAparelhos).toEqual({ x: 1 })
    expect(getImportacaoMetadata(out)?.ultimoLote.batchId).toBe("adv-1")
  })

  it("empurra o lote anterior para o histórico", () => {
    const primeiro = mergeImportacaoIntoMetadata({}, lote({ batchId: "adv-1" }))
    const segundo = mergeImportacaoIntoMetadata(primeiro, lote({ batchId: "adv-2" }))
    const meta = getImportacaoMetadata(segundo)!
    expect(meta.ultimoLote.batchId).toBe("adv-2")
    expect(meta.historico.map((h) => h.batchId)).toEqual(["adv-1"])
  })

  it("reimportar o MESMO batchId atualiza no lugar, sem duplicar histórico", () => {
    const um = mergeImportacaoIntoMetadata({}, lote({ batchId: "adv-1", acao: "criado" }))
    const dois = mergeImportacaoIntoMetadata(um, lote({ batchId: "adv-1", acao: "atualizado" }))
    const meta = getImportacaoMetadata(dois)!
    expect(meta.ultimoLote.acao).toBe("atualizado")
    expect(meta.historico).toEqual([])
  })

  it("histórico é limitado a IMPORTACAO_HISTORICO_MAX", () => {
    let meta: Record<string, unknown> = {}
    for (let i = 1; i <= IMPORTACAO_HISTORICO_MAX + 5; i++) {
      meta = mergeImportacaoIntoMetadata(meta, lote({ batchId: `adv-${i}` }))
    }
    const lido = getImportacaoMetadata(meta)!
    expect(lido.ultimoLote.batchId).toBe(`adv-${IMPORTACAO_HISTORICO_MAX + 5}`)
    expect(lido.historico).toHaveLength(IMPORTACAO_HISTORICO_MAX)
    // Mais recente primeiro.
    expect(lido.historico[0]!.batchId).toBe(`adv-${IMPORTACAO_HISTORICO_MAX + 4}`)
  })
})

describe("getImportacaoMetadata", () => {
  it("aceita o produto inteiro ou só o metadata", () => {
    const meta = mergeImportacaoIntoMetadata({}, lote())
    expect(getImportacaoMetadata({ metadata: meta })?.ultimoLote.batchId).toBe("adv-1")
    expect(getImportacaoMetadata(meta)?.ultimoLote.batchId).toBe("adv-1")
  })

  it("devolve null para produto que nunca passou por importação", () => {
    expect(getImportacaoMetadata(null)).toBeNull()
    expect(getImportacaoMetadata({ metadata: null })).toBeNull()
    expect(getImportacaoMetadata({ metadata: { fiscal: { ncm: "1" } } })).toBeNull()
  })
})

describe("marcarLoteRevisado", () => {
  it("marca revisado preservando o resto do metadata", () => {
    const base = mergeImportacaoIntoMetadata({ fiscal: { ncm: "18069000" } }, lote())
    const out = marcarLoteRevisado(base, { revisadoPor: "rafael", revisadoEm: "2026-07-29T12:00:00.000Z" })
    const meta = getImportacaoMetadata(out)!
    expect(meta.ultimoLote.statusRevisao).toBe("revisado")
    expect(meta.ultimoLote.revisadoPor).toBe("rafael")
    expect(meta.ultimoLote.revisadoEm).toBe("2026-07-29T12:00:00.000Z")
    expect(out.fiscal).toEqual({ ncm: "18069000" })
  })

  it("voltar para pendente limpa quem/quando", () => {
    const base = marcarLoteRevisado(mergeImportacaoIntoMetadata({}, lote()), { revisadoPor: "rafael" })
    const out = marcarLoteRevisado(base, { revisadoPor: "rafael", status: "pendente" })
    const meta = getImportacaoMetadata(out)!
    expect(meta.ultimoLote.statusRevisao).toBe("pendente")
    expect(meta.ultimoLote.revisadoPor).toBeNull()
    expect(meta.ultimoLote.revisadoEm).toBeNull()
  })

  it("produto sem importação não é alterado", () => {
    const base = { fiscal: { ncm: "1" } }
    expect(marcarLoteRevisado(base, { revisadoPor: "x" })).toEqual(base)
  })
})
