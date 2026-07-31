/**
 * Contrato de MERGE PARCIAL da identidade fiscal do Produto — todas as portas de escrita.
 *
 * Defeito fechado: `mergeProdutoFiscalIntoMetadata` substituía `metadata.fiscal` inteiro.
 * Uma planilha (ou edição) trazendo só NCM/CEST apagava unidade comercial/tributável e o
 * restante da identidade já curada.
 *
 * Cada bloco reproduz a MESMA composição de metadata da porta real, usando os helpers
 * exportados de verdade — sem Prisma, sem banco. O que o teste prova é o que o banco recebe.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  fiscalInputFromBody,
  getProdutoFiscal,
  mergeProdutoFiscalIntoMetadata,
} from "@/lib/produto-fiscal"
import { mergeProdutoMetadataTwoLevels } from "@/lib/cadastros/produto-upsert-metadata"
import { canonicalizeProdutoFiscalMetadata } from "@/lib/produtos/produto-fiscal-upsert"
import { fiscalInputDaLinha } from "@/lib/cadastros/importacao-produtos/escrita"
import type { ProdutoImportLinha } from "@/lib/cadastros/importacao-produtos/types"

type Meta = Record<string, unknown>

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

// ── Composições reais das portas de escrita ─────────────────────────────────────────

/** `app/api/produtos/route.ts` (POST) — produto novo, base = metadata do body. */
function portaRestCreate(body: Meta): Meta {
  const base = (body.metadata as Meta | undefined) ?? {}
  const fiscalInput = fiscalInputFromBody(body)
  return fiscalInput ? mergeProdutoFiscalIntoMetadata(base, fiscalInput) : base
}

/** `app/api/produtos/[id]/route.ts` (PATCH) — merge de 2 níveis + merge fiscal canônico. */
function portaRestPatch(atual: Meta | null, body: Meta): Meta {
  const incoming = (body.metadata as Meta | undefined) ?? null
  let meta: unknown = incoming ? mergeProdutoMetadataTwoLevels(atual, incoming) : (atual ?? {})
  const fiscalInput = fiscalInputFromBody(body)
  if (fiscalInput) meta = mergeProdutoFiscalIntoMetadata(meta, fiscalInput)
  return meta as Meta
}

/** `app/actions/cadastros.ts` → `upsertProduto` (Cadastros V2, cadastro manual). */
function portaCadastroV2(existing: Meta | null, body: Meta): Meta {
  const incoming = (body.metadata as Meta | undefined) ?? null
  let meta: unknown =
    existing != null ? mergeProdutoMetadataTwoLevels(existing, incoming) : { ...(incoming ?? {}) }
  const fiscalInput = fiscalInputFromBody(body)
  if (fiscalInput) meta = canonicalizeProdutoFiscalMetadata(meta, fiscalInput)
  return meta as Meta
}

/** `lib/importador-avancado/persistidor.ts` — atualização de produto existente. */
function portaImportadorAvancado(atual: Meta | null, linha: ProdutoImportLinha): Meta {
  return mergeProdutoFiscalIntoMetadata(atual, fiscalInputDaLinha(linha))
}

/** `lib/importador-produtos/persist.ts` → `criarProdutoNovo` (importador especializado). */
function portaImportadorEspecializado(p: { ncm: string; cest: string }): Meta {
  const extras: Meta = {}
  if (p.ncm) extras.ncm = p.ncm
  if (p.cest) extras.cest = p.cest
  return mergeProdutoFiscalIntoMetadata(extras, { ncm: p.ncm, cest: p.cest })
}

function linhaImport(fiscal: Partial<ProdutoImportLinha["fiscal"]>): ProdutoImportLinha {
  return {
    linhaOrigem: 1,
    nome: "LIQUIDIFICADOR",
    sku: null,
    barcode: "7899882308945",
    codigoFornecedor: null,
    categoria: "Eletroportáteis",
    marca: "",
    fornecedorNome: "MARTINS",
    custo: 0,
    preco: 0,
    estoque: null,
    garantiaDias: null,
    fiscal: {
      ncm: "",
      cest: "",
      unidadeComercial: "",
      unidadeTributavel: "",
      gtinComercial: "",
      gtinTributavel: "",
      ...fiscal,
    },
    fiscalInvalido: [],
  }
}

// ── Identidade curada usada como estado inicial ──────────────────────────────────────
const CURADO = {
  fiscal: {
    ncm: "85094010",
    cest: "0000000",
    cfop: "5102",
    origemMercadoria: "0",
    unidadeComercial: "UN",
    unidadeTributavel: "UN",
  },
  importacao: { ultimoLote: { batchId: "lote-anterior" } },
  acessorios: { version: 1 },
} as const

function meta(): Meta {
  return JSON.parse(JSON.stringify(CURADO)) as Meta
}

// ── Cadastro manual (Cadastros V2) ───────────────────────────────────────────────────

describe("cadastro manual — Cadastros V2", () => {
  it("editar nome/categoria/marca/preço sem sinal fiscal preserva metadata.fiscal", () => {
    const out = portaCadastroV2(meta(), { nome: "Novo nome", categoria: "Casa", preco: 99 })
    expect(out.fiscal).toEqual(CURADO.fiscal)
    expect(out.importacao).toEqual(CURADO.importacao)
  })

  it("edição apenas de NCM preserva CEST, CFOP, origem e unidades", () => {
    const out = portaCadastroV2(meta(), { ncm: "85176200" })
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, ncm: "85176200" })
  })

  it("edição apenas de CEST preserva NCM e unidades", () => {
    const out = portaCadastroV2(meta(), { cest: "2104100" })
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, cest: "2104100" })
  })

  it("sugestão por código de barras (só NCM/CEST) não apaga o restante", () => {
    const out = portaCadastroV2(meta(), {
      metadata: { barcodeLookup: { gtin: "7899882308945", provedor: "cosmos" } },
      ncm: "85094010",
      cest: "2104100",
    })
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, cest: "2104100" })
    expect(out.barcodeLookup).toEqual({ gtin: "7899882308945", provedor: "cosmos" })
    expect(out.acessorios).toEqual(CURADO.acessorios)
  })

  it("bloco fiscal não canônico vindo do body continua sendo rejeitado", () => {
    const out = portaCadastroV2(meta(), {
      metadata: { fiscal: { cest: "2104100", tributacao: "Simples" } },
    })
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, cest: "2104100" })
  })
})

// ── Portas REST ──────────────────────────────────────────────────────────────────────

describe("portas REST de produto", () => {
  it("PATCH com só NCM/CEST preserva a identidade curada e os namespaces irmãos", () => {
    const out = portaRestPatch(meta(), { ncm: "85094010", cest: "2104100" })
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, cest: "2104100" })
    expect(out.importacao).toEqual(CURADO.importacao)
    expect(out.acessorios).toEqual(CURADO.acessorios)
  })

  it("PATCH sem sinal fiscal não toca em metadata.fiscal", () => {
    const out = portaRestPatch(meta(), { metadata: { atributos: { descricao: "x" } } })
    expect(out.fiscal).toEqual(CURADO.fiscal)
  })

  it("POST (produto novo) grava só o que veio", () => {
    expect(portaRestCreate({ ncm: "85094010", cest: "2104100" }).fiscal).toEqual({
      ncm: "85094010",
      cest: "2104100",
    })
  })
})

// ── Importadores ─────────────────────────────────────────────────────────────────────

describe("importadores", () => {
  it("planilha só com NCM/CEST não apaga unidades, origem nem CFOP", () => {
    const out = portaImportadorAvancado(meta(), linhaImport({ ncm: "85094010", cest: "2104100" }))
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, cest: "2104100" })
  })

  it("planilha SEM nenhum campo fiscal preserva a identidade inteira", () => {
    const out = portaImportadorAvancado(meta(), linhaImport({}))
    expect(out.fiscal).toEqual(CURADO.fiscal)
  })

  it("planilha com unidades sobrepõe só as unidades", () => {
    const out = portaImportadorAvancado(
      meta(),
      linhaImport({ unidadeComercial: "CX", unidadeTributavel: "CX" }),
    )
    expect(out.fiscal).toEqual({ ...CURADO.fiscal, unidadeComercial: "CX", unidadeTributavel: "CX" })
  })

  it("produto NOVO e produto EXISTENTE usam o mesmo contrato de merge", () => {
    const linha = linhaImport({ ncm: "85094010", cest: "2104100" })
    const novo = portaImportadorAvancado(null, linha)
    const existenteVazio = portaImportadorAvancado({}, linha)
    expect(novo.fiscal).toEqual(existenteVazio.fiscal)
    expect(novo.fiscal).toEqual({ ncm: "85094010", cest: "2104100" })
  })

  it("importador especializado (criação) produz a mesma forma canônica", () => {
    const out = portaImportadorEspecializado({ ncm: "85094010", cest: "2104100" })
    expect(out.fiscal).toEqual({ ncm: "85094010", cest: "2104100" })
    // Legado do topo continua gravado para leitores antigos.
    expect(out.ncm).toBe("85094010")
  })
})

// ── Equivalência semântica entre as portas ───────────────────────────────────────────

describe("contrato: todas as portas produzem o mesmo metadata.fiscal", () => {
  it("mesmo estado + mesmo patch NCM/CEST → mesmo resultado nas 4 portas", () => {
    const esperado = { ...CURADO.fiscal, cest: "2104100" }
    const patch = { ncm: "85094010", cest: "2104100" }

    expect(portaCadastroV2(meta(), patch).fiscal).toEqual(esperado)
    expect(portaRestPatch(meta(), patch).fiscal).toEqual(esperado)
    expect(
      portaImportadorAvancado(meta(), linhaImport({ ncm: patch.ncm, cest: patch.cest })).fiscal,
    ).toEqual(esperado)
    // Porta de criação: parte do vazio, então o esperado é só o patch.
    expect(portaRestCreate(patch).fiscal).toEqual(patch)
    expect(portaImportadorEspecializado(patch).fiscal).toEqual(patch)
  })

  it("nenhuma porta de escrita monta `metadata.fiscal` à mão", () => {
    const arquivos = [
      "app/actions/cadastros.ts",
      "app/api/produtos/route.ts",
      "app/api/produtos/[id]/route.ts",
      "lib/importador-avancado/persistidor.ts",
      "lib/importador-produtos/persist.ts",
      "lib/produtos/produto-fiscal-upsert.ts",
    ]
    for (const rel of arquivos) {
      const fonte = readFileSync(resolve(RAIZ, rel), "utf8")
      // Atribuição direta ao bloco fiscal só pode existir dentro do helper canônico.
      expect(fonte, `${rel} atribui metadata.fiscal fora do contrato`).not.toMatch(
        /\.fiscal\s*=[^=]/,
      )
      expect(fonte, `${rel} não usa o helper fiscal canônico`).toMatch(
        /mergeProdutoFiscalIntoMetadata|canonicalizeProdutoFiscalMetadata/,
      )
    }
  })

  it("`lib/produto-fiscal.ts` é o único módulo que grava o bloco fiscal", () => {
    const helper = readFileSync(resolve(RAIZ, "lib/produto-fiscal.ts"), "utf8")
    expect(helper.match(/base\.fiscal\s*=[^=]/g)?.length).toBe(1)
  })
})

// ── Regressão NF-e Martins ───────────────────────────────────────────────────────────

describe("regressão Martins — liquidificador 7899882308945", () => {
  const inicial = {
    fiscal: {
      ncm: "85094010",
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
      gtinComercial: "7899882308945",
    },
    importacao: { ultimoLote: { batchId: "martins-teste" } },
  }

  const patchParcial = { ncm: "85094010", cest: "2104100" }

  it("importação parcial preserva a identidade e adiciona o CEST", () => {
    const out = mergeProdutoFiscalIntoMetadata(
      JSON.parse(JSON.stringify(inicial)) as Meta,
      patchParcial,
    )
    expect(out.fiscal).toEqual({
      ncm: "85094010",
      cest: "2104100",
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
      gtinComercial: "7899882308945",
    })
    // Proveniência da importação intacta.
    expect(out.importacao).toEqual(inicial.importacao)
    // Nenhuma chave nova no metadata além das que já existiam.
    expect(Object.keys(out).sort()).toEqual(["fiscal", "importacao"])
  })

  it("a leitura canônica devolve NCM e CEST após o merge", () => {
    const out = mergeProdutoFiscalIntoMetadata(
      JSON.parse(JSON.stringify(inicial)) as Meta,
      patchParcial,
    )
    expect(getProdutoFiscal({ metadata: out })).toMatchObject({
      ncm: "85094010",
      cest: "2104100",
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
    })
  })

  it("reaplicar o mesmo merge é idempotente", () => {
    const um = mergeProdutoFiscalIntoMetadata(
      JSON.parse(JSON.stringify(inicial)) as Meta,
      patchParcial,
    )
    const dois = mergeProdutoFiscalIntoMetadata(um, patchParcial)
    const tres = mergeProdutoFiscalIntoMetadata(dois, patchParcial)
    expect(dois).toEqual(um)
    expect(tres).toEqual(um)
  })

  it("pela porta real do importador o resultado é o mesmo", () => {
    const out = portaImportadorAvancado(
      JSON.parse(JSON.stringify(inicial)) as Meta,
      linhaImport({ ncm: "85094010", cest: "2104100" }),
    )
    expect(out.fiscal).toMatchObject({
      ncm: "85094010",
      cest: "2104100",
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
    })
    expect(out.importacao).toEqual(inicial.importacao)
  })
})
