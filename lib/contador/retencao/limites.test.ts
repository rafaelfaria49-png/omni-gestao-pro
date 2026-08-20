/**
 * GOAL 019 — inventário de limites.
 *
 * O objetivo destes testes NÃO é congelar números (isso engessaria decisões futuras);
 * é provar que o 019 **não inventou nem mexeu em teto nenhum**: cada limite com valor
 * é idêntico à sua fonte original, e cada limite sem número canônico é `null` com a
 * observação explicando o comportamento preservado — nunca um teto arbitrário.
 */
import { describe, expect, it } from "vitest"
import {
  DOWNLOAD_EXPIRACAO_SEG,
  MAX_BYTES_DOCUMENTO,
  UPLOAD_EXPIRACAO_SEG,
} from "@/lib/contador/documentos/config"
import {
  MAX_ARQUIVOS_PACOTE,
  MAX_BYTES_DESCOMPACTADO,
  MAX_BYTES_ZIP,
  MAX_REGISTROS_POR_FONTE,
  TIMEOUT_LOGICO_MS,
} from "@/lib/contador/pacote/seguranca"
import { LIMITES_CONTADOR, limitePorId, limitesSemNumeroCanonico } from "./limites"

describe("cobertura dos quatro escopos exigidos", () => {
  it("cobre arquivo, categoria, competência e pacote", () => {
    const escopos = new Set(LIMITES_CONTADOR.map((l) => l.escopo))
    expect(escopos).toEqual(new Set(["arquivo", "categoria", "competencia", "pacote"]))
  })

  it("ids são únicos", () => {
    const ids = LIMITES_CONTADOR.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("nenhum número foi alterado pelo GOAL 019", () => {
  const ESPERADO: readonly (readonly [string, number])[] = [
    ["documento.bytes_max", MAX_BYTES_DOCUMENTO],
    ["documento.upload_url_ttl", UPLOAD_EXPIRACAO_SEG],
    ["documento.download_url_ttl", DOWNLOAD_EXPIRACAO_SEG],
    ["pacote.registros_por_fonte_max", MAX_REGISTROS_POR_FONTE],
    ["pacote.bytes_descompactados_max", MAX_BYTES_DESCOMPACTADO],
    ["pacote.bytes_zip_max", MAX_BYTES_ZIP],
    ["pacote.arquivos_max", MAX_ARQUIVOS_PACOTE],
    ["pacote.timeout_logico", TIMEOUT_LOGICO_MS],
  ]

  for (const [id, valor] of ESPERADO) {
    it(`${id} reexporta exatamente a fonte original`, () => {
      const limite = limitePorId(id)
      expect(limite, id).toBeDefined()
      expect(limite!.valor).toBe(valor)
      expect(limite!.fonte).toBeTruthy()
    })
  }
})

describe("limites sem número canônico", () => {
  it("categoria e competência são declaradas como SEM teto dedicado", () => {
    const semNumero = limitesSemNumeroCanonico().map((l) => l.id)
    expect(semNumero).toEqual(["categoria.documentos_max", "competencia.documentos_max"])
  })

  it("`null` vem sempre com fonte nula e observação explicando o comportamento atual", () => {
    for (const limite of limitesSemNumeroCanonico()) {
      expect(limite.fonte, limite.id).toBeNull()
      expect(limite.unidade, limite.id).toBeNull()
      expect(limite.observacao.length, limite.id).toBeGreaterThan(40)
    }
  })

  it("nenhum upload fica sem teto: o teto por arquivo continua existindo", () => {
    // "sem número dedicado por categoria" nunca pode significar "upload ilimitado".
    const porArquivo = limitePorId("documento.bytes_max")
    expect(porArquivo!.valor).toBe(MAX_BYTES_DOCUMENTO)
    expect(porArquivo!.valor).toBeGreaterThan(0)
  })
})

describe("integridade do inventário", () => {
  it("todo limite com valor tem unidade e fonte declaradas", () => {
    for (const limite of LIMITES_CONTADOR) {
      if (limite.valor === null) continue
      expect(limite.unidade, limite.id).not.toBeNull()
      expect(limite.fonte, limite.id).not.toBeNull()
      expect(limite.valor, limite.id).toBeGreaterThan(0)
    }
  })

  it("limitePorId devolve undefined para id inexistente", () => {
    expect(limitePorId("nao.existe")).toBeUndefined()
  })
})
