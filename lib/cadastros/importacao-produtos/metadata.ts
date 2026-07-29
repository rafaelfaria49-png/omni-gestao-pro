/**
 * Proveniência da importação — `Produto.metadata.importacao`.
 *
 * Sem migration: o namespace vive no JSONB já existente e convive com `fiscal`,
 * `atributos`, `acessorios`, `catalogoAparelhos`, `barcodeLookup`. Toda escrita
 * preserva os demais namespaces; o histórico é limitado para o JSON não crescer
 * sem teto a cada reimportação.
 */

import type { ContextoLoteImport, ProdutoImportMatch } from "./types"

/** Teto do histórico. Reimportar a mesma nota N vezes não infla o JSONB. */
export const IMPORTACAO_HISTORICO_MAX = 10

export type StatusRevisaoImport = "pendente" | "revisado"

export type LoteImportacaoMetadata = {
  batchId: string
  origem: "planilha"
  arquivo: string
  importadoEm: string
  acao: "criado" | "atualizado"
  matchPor: ProdutoImportMatch | null
  fornecedor: { nome: string; documento: string } | null
  documento: {
    tipo: "nfe" | "outro"
    numero: string
    serie: string
    chave: string
    dataEmissao: string
  } | null
  linhaOrigem: number
  statusRevisao: StatusRevisaoImport
  revisadoEm: string | null
  revisadoPor: string | null
}

export type ImportacaoMetadata = {
  ultimoLote: LoteImportacaoMetadata
  historico: LoteImportacaoMetadata[]
}

const MATCHES: ReadonlySet<string> = new Set([
  "barcode",
  "sku",
  "codigo_fornecedor",
  "nome_exato",
])

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function txt(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max)
}

/** Sanea um lote vindo do JSONB (ou de um caller). `null` quando não há `batchId`. */
export function sanitizeLoteImportacao(raw: unknown): LoteImportacaoMetadata | null {
  const o = asObject(raw)
  if (!o) return null
  const batchId = txt(o.batchId, 80)
  if (!batchId) return null

  const fornecedorRaw = asObject(o.fornecedor)
  const fornecedorNome = txt(fornecedorRaw?.nome)
  const fornecedor = fornecedorNome
    ? { nome: fornecedorNome, documento: txt(fornecedorRaw?.documento, 32) }
    : null

  const docRaw = asObject(o.documento)
  const docNumero = txt(docRaw?.numero, 40)
  const docChave = txt(docRaw?.chave, 60)
  const documento =
    docRaw && (docNumero || docChave)
      ? {
          tipo: docRaw.tipo === "nfe" ? ("nfe" as const) : ("outro" as const),
          numero: docNumero,
          serie: txt(docRaw.serie, 10),
          chave: docChave,
          dataEmissao: txt(docRaw.dataEmissao, 30),
        }
      : null

  const matchPor = txt(o.matchPor, 30)
  const linhaOrigem = Number(o.linhaOrigem)

  return {
    batchId,
    origem: "planilha",
    arquivo: txt(o.arquivo, 260),
    importadoEm: txt(o.importadoEm, 40),
    acao: o.acao === "atualizado" ? "atualizado" : "criado",
    matchPor: MATCHES.has(matchPor) ? (matchPor as ProdutoImportMatch) : null,
    fornecedor,
    documento,
    linhaOrigem: Number.isFinite(linhaOrigem) && linhaOrigem > 0 ? Math.trunc(linhaOrigem) : 0,
    statusRevisao: o.statusRevisao === "revisado" ? "revisado" : "pendente",
    revisadoEm: txt(o.revisadoEm, 40) || null,
    revisadoPor: txt(o.revisadoPor, 120) || null,
  }
}

/** LEITURA CANÔNICA do namespace. `null` quando o produto nunca passou por importação. */
export function getImportacaoMetadata(
  source: { metadata?: unknown } | Record<string, unknown> | null | undefined,
): ImportacaoMetadata | null {
  if (!source || typeof source !== "object") return null
  const talvezProduto = asObject((source as { metadata?: unknown }).metadata)
  const metadata = talvezProduto ?? asObject(source)
  if (!metadata) return null

  const bloco = asObject(metadata.importacao)
  if (!bloco) return null

  const ultimoLote = sanitizeLoteImportacao(bloco.ultimoLote)
  if (!ultimoLote) return null

  const historicoRaw = Array.isArray(bloco.historico) ? bloco.historico : []
  const historico = historicoRaw
    .map(sanitizeLoteImportacao)
    .filter((l): l is LoteImportacaoMetadata => l !== null)
    .slice(0, IMPORTACAO_HISTORICO_MAX)

  return { ultimoLote, historico }
}

/**
 * ESCRITA CANÔNICA: promove o lote atual a `ultimoLote` e empurra o anterior para o
 * histórico (mais recente primeiro, cortado em `IMPORTACAO_HISTORICO_MAX`).
 * Reimportar o MESMO `batchId` atualiza o lote no lugar — não duplica histórico.
 */
export function mergeImportacaoIntoMetadata(
  metadataBase: unknown,
  lote: LoteImportacaoMetadata,
): Record<string, unknown> {
  const base = { ...(asObject(metadataBase) ?? {}) }
  const atual = getImportacaoMetadata(base)

  let historico = atual?.historico ?? []
  if (atual && atual.ultimoLote.batchId !== lote.batchId) {
    historico = [atual.ultimoLote, ...historico]
  }
  historico = historico
    .filter((l) => l.batchId !== lote.batchId)
    .slice(0, IMPORTACAO_HISTORICO_MAX)

  base.importacao = { ultimoLote: lote, historico }
  return base
}

/** Marca o último lote como revisado, preservando todo o resto do metadata. */
export function marcarLoteRevisado(
  metadataBase: unknown,
  opts: { revisadoPor: string; revisadoEm?: string; status?: StatusRevisaoImport },
): Record<string, unknown> {
  const base = { ...(asObject(metadataBase) ?? {}) }
  const atual = getImportacaoMetadata(base)
  if (!atual) return base
  const status = opts.status ?? "revisado"
  const revisado: LoteImportacaoMetadata = {
    ...atual.ultimoLote,
    statusRevisao: status,
    revisadoEm: status === "revisado" ? (opts.revisadoEm ?? new Date().toISOString()) : null,
    revisadoPor: status === "revisado" ? txt(opts.revisadoPor, 120) || null : null,
  }
  base.importacao = { ultimoLote: revisado, historico: atual.historico }
  return base
}

/** Monta o lote a gravar a partir do contexto do lote + resultado da linha. */
export function construirLoteImportacao(input: {
  batchId: string
  arquivo: string
  importadoEm?: string
  acao: "criado" | "atualizado"
  matchPor: ProdutoImportMatch | null
  linhaOrigem: number
  contexto: ContextoLoteImport
}): LoteImportacaoMetadata {
  return {
    batchId: txt(input.batchId, 80),
    origem: "planilha",
    arquivo: txt(input.arquivo, 260),
    importadoEm: input.importadoEm ?? new Date().toISOString(),
    acao: input.acao,
    matchPor: input.matchPor,
    fornecedor: input.contexto.fornecedor
      ? {
          nome: txt(input.contexto.fornecedor.nome),
          documento: txt(input.contexto.fornecedor.documento, 32),
        }
      : null,
    documento: input.contexto.documento
      ? {
          tipo: input.contexto.documento.tipo,
          numero: txt(input.contexto.documento.numero, 40),
          serie: txt(input.contexto.documento.serie, 10),
          chave: txt(input.contexto.documento.chave, 60),
          dataEmissao: txt(input.contexto.documento.dataEmissao, 30),
        }
      : null,
    linhaOrigem: Math.max(0, Math.trunc(input.linhaOrigem)),
    statusRevisao: "pendente",
    revisadoEm: null,
    revisadoPor: null,
  }
}
