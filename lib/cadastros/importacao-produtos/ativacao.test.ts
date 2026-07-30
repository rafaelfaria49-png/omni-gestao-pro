/**
 * Política de ativação da importação (F-05).
 *
 * O defeito original: produto EXISTENTE com preço 0 continuava `active = true` depois
 * do reparo — vendável a R$ 0,00 no PDV — enquanto produto NOVO sem preço nascia
 * inativo. Estes testes fixam a regra canônica e a lista de campos críticos.
 */

import { describe, expect, it } from "vitest"
import {
  CAMPOS_CRITICOS_IMPORT,
  MENSAGEM_PRECO_OBRIGATORIO,
  camposCriticosAlteradosNaImportacao,
  resolveImportProductActivation,
} from "./ativacao"

describe("resolveImportProductActivation — fail-closed de preço zero", () => {
  it("produto NOVO sem preço nasce inativo, incompleto e pendente", () => {
    const r = resolveImportProductActivation({
      operacao: "criacao",
      nome: "ACHOC.TODDY ORIGINAL POTE 750G",
      categoria: "Mercearia",
      preco: 0,
    })
    expect(r.active).toBe(false)
    expect(r.status).toBe("Incompleto")
    expect(r.statusRevisao).toBe("pendente")
    expect(r.vendavel).toBe(false)
    expect(r.motivo).toBe(MENSAGEM_PRECO_OBRIGATORIO)
  })

  it("produto EXISTENTE ATIVO que termina sem preço é INATIVADO (assimetria fechada)", () => {
    const r = resolveImportProductActivation({
      operacao: "atualizacao",
      nome: "ACHOC.TODDY ORIGINAL POTE 750G",
      categoria: "Mercearia",
      preco: 0,
      activeAtual: true,
      statusRevisaoAtual: "revisado",
    })
    expect(r.active).toBe(false)
    expect(r.status).toBe("Incompleto")
    // Preço zero domina: mesmo revisado antes, volta para pendente.
    expect(r.statusRevisao).toBe("pendente")
    expect(r.vendavel).toBe(false)
    expect(r.pendencias).toContain("Sem preço de venda")
  })

  it("preço negativo é tratado como sem preço", () => {
    const r = resolveImportProductActivation({
      operacao: "atualizacao",
      nome: "X",
      categoria: "Y",
      preco: -1,
      activeAtual: true,
    })
    expect(r.active).toBe(false)
    expect(r.status).toBe("Incompleto")
  })
})

describe("resolveImportProductActivation — produto existente com preço > 0", () => {
  it("preserva a situação atual: não toca active nem status", () => {
    const r = resolveImportProductActivation({
      operacao: "atualizacao",
      nome: "PRODUTO OK",
      categoria: "Mercearia",
      preco: 19.9,
      activeAtual: true,
    })
    expect(r.active).toBeUndefined()
    expect(r.status).toBeUndefined()
  })

  it("produto já INATIVO não é reativado automaticamente", () => {
    const r = resolveImportProductActivation({
      operacao: "atualizacao",
      nome: "PRODUTO OK",
      categoria: "Mercearia",
      preco: 19.9,
      activeAtual: false,
    })
    expect(r.active).toBeUndefined()
    expect(r.vendavel).toBe(false)
  })
})

describe("resolveImportProductActivation — revisão anterior", () => {
  const base = {
    operacao: "atualizacao" as const,
    nome: "PRODUTO REVISADO",
    categoria: "Mercearia",
    preco: 29.9,
    activeAtual: true,
    statusRevisaoAtual: "revisado" as const,
  }

  it("sobrevive a lote que só enriquece campos não críticos", () => {
    const r = resolveImportProductActivation({ ...base, camposCriticosAlterados: [] })
    expect(r.statusRevisao).toBe("revisado")
  })

  for (const campo of CAMPOS_CRITICOS_IMPORT) {
    it(`volta a pendente quando o lote altera o campo crítico "${campo}"`, () => {
      const r = resolveImportProductActivation({ ...base, camposCriticosAlterados: [campo] })
      expect(r.statusRevisao).toBe("pendente")
      expect(r.motivo).toContain(campo)
    })
  }

  it("a lista de campos críticos é exatamente a documentada no contrato", () => {
    expect([...CAMPOS_CRITICOS_IMPORT]).toEqual(["preco", "barcode", "sku", "categoria", "ncm", "cest"])
  })

  it("campo não crítico informado por engano não reabre a revisão", () => {
    const r = resolveImportProductActivation({
      ...base,
      camposCriticosAlterados: ["marca" as never, "fornecedor" as never],
    })
    expect(r.statusRevisao).toBe("revisado")
  })

  it("produto nunca revisado permanece pendente", () => {
    const r = resolveImportProductActivation({ ...base, statusRevisaoAtual: "pendente" })
    expect(r.statusRevisao).toBe("pendente")
  })
})

describe("resolveImportProductActivation — criação com preço válido", () => {
  it("ativa quando apto", () => {
    const r = resolveImportProductActivation({
      operacao: "criacao",
      nome: "PRODUTO NOVO",
      categoria: "Mercearia",
      preco: 10,
    })
    expect(r.active).toBe(true)
    expect(r.status).toBe("Ativo")
    expect(r.vendavel).toBe(true)
  })

  it("sem categoria entra inativo mesmo com preço", () => {
    const r = resolveImportProductActivation({
      operacao: "criacao",
      nome: "PRODUTO NOVO",
      categoria: null,
      preco: 10,
    })
    expect(r.active).toBe(false)
    expect(r.status).toBe("Inativo")
    expect(r.pendencias).toContain("Sem categoria")
  })

  it("conflito de identidade impede ativação", () => {
    const r = resolveImportProductActivation({
      operacao: "criacao",
      nome: "PRODUTO NOVO",
      categoria: "Mercearia",
      preco: 10,
      temConflitoIdentidade: true,
    })
    expect(r.active).toBe(false)
    expect(r.pendencias).toContain("Conflito de SKU ou código de barras")
  })
})

describe("camposCriticosAlteradosNaImportacao", () => {
  const atual = { sku: "SKU-1", barcode: "7891234567895", category: "Mercearia", price: 10 }
  const fiscalAtual = { ncm: "18069000", cest: "1700600" }
  const semFiscalNovo = { ncm: null, cest: null }

  it("patch vazio não altera nada", () => {
    expect(
      camposCriticosAlteradosNaImportacao({ patch: {}, atual, fiscalAtual, fiscalNovo: semFiscalNovo }),
    ).toEqual([])
  })

  it("chave presente com MESMO valor não conta como alteração", () => {
    expect(
      camposCriticosAlteradosNaImportacao({
        patch: { price: 10, barcode: "7891234567895", sku: "SKU-1", category: "Mercearia" },
        atual,
        fiscalAtual,
        fiscalNovo: { ncm: "18069000", cest: "1700600" },
      }),
    ).toEqual([])
  })

  it("detecta preço, barcode, sku e categoria alterados", () => {
    const out = camposCriticosAlteradosNaImportacao({
      patch: { price: 20, barcode: "7899999999994", sku: "SKU-2", category: "Bebidas" },
      atual,
      fiscalAtual,
      fiscalNovo: semFiscalNovo,
    })
    expect(out).toEqual(["preco", "barcode", "sku", "categoria"])
  })

  it("limpeza de SKU sintético (patch.sku = null) conta como alteração de sku", () => {
    const out = camposCriticosAlteradosNaImportacao({
      patch: { sku: null },
      atual: { ...atual, sku: "linha-7" },
      fiscalAtual,
      fiscalNovo: semFiscalNovo,
    })
    expect(out).toEqual(["sku"])
  })

  it("detecta NCM/CEST somente quando a planilha traz valor diferente", () => {
    expect(
      camposCriticosAlteradosNaImportacao({
        patch: {},
        atual,
        fiscalAtual,
        fiscalNovo: { ncm: "85065010", cest: null },
      }),
    ).toEqual(["ncm"])

    expect(
      camposCriticosAlteradosNaImportacao({
        patch: {},
        atual,
        fiscalAtual,
        fiscalNovo: { ncm: "18069000", cest: "9999999" },
      }),
    ).toEqual(["cest"])
  })

  it("planilha sem fiscal não apaga nem reabre revisão", () => {
    expect(
      camposCriticosAlteradosNaImportacao({
        patch: {},
        atual,
        fiscalAtual,
        fiscalNovo: { ncm: "", cest: "" },
      }),
    ).toEqual([])
  })

  it("barcode ausente no banco recebendo o da nota conta como alteração", () => {
    const out = camposCriticosAlteradosNaImportacao({
      patch: { barcode: "7892840819170" },
      atual: { ...atual, barcode: null },
      fiscalAtual,
      fiscalNovo: semFiscalNovo,
    })
    expect(out).toEqual(["barcode"])
  })
})
