// ============================================================
// lib/importador-avancado/persistidor.ts
// Persiste registros mergeados no Prisma com upsert idempotente
// Ordem: clientes → fornecedores → produtos → OS → vendas → financeiro
// ============================================================

import { prisma } from "@/lib/prisma"
import { normalizeNameForMatch, docDigitsForDedupe } from "@/lib/import-normalize"
import type {
  RegistroMergeado,
  LogLinhaImport,
  DominioImport,
  ResultadoImportacao,
  ResumoLinhaProduto,
} from "./types"
import {
  extrairCamposOS,
  extrairCamposCliente,
  extrairCamposProduto,
  extrairCamposContaReceber,
  extrairCamposContaPagar,
} from "./merger"
import type { Prisma } from "@/generated/prisma"
import { StatusOrdemServico } from "@/generated/prisma"
import { upsertContaReceber } from "@/lib/financeiro/services/contas-receber-service"
import { upsertContaPagar } from "@/lib/financeiro/services/contas-pagar-service"
import { nomePareceDocumento } from "@/lib/produto-sku-normalize"
import { getProdutoFiscal, mergeProdutoFiscalIntoMetadata } from "@/lib/produto-fiscal"
import {
  alertasDaLinha,
  ativacaoDaAtualizacao,
  ativacaoDaCriacao,
  camposCriticosAlteradosNaImportacao,
  candidatoDoPlano,
  construirLoteImportacao,
  contextoDeMatch,
  diffAtualizacao,
  fiscalInputDaLinha,
  getImportacaoMetadata,
  indexarCandidatos,
  mergeImportacaoIntoMetadata,
  montarAtualizacaoProduto,
  montarCriacaoProduto,
  planejarMatchProduto,
  resolverNomeCategoria,
  temBloqueio,
  CONTEXTO_LOTE_VAZIO,
} from "@/lib/cadastros/importacao-produtos"
import type {
  AlertaImport,
  ContextoLoteImport,
  IndiceCandidatos,
  ProdutoCandidatoRow,
  ProdutoImportLinha,
} from "@/lib/cadastros/importacao-produtos"

// ── Utilitários ───────────────────────────────────────────────

function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function toStatusPrisma(s: string): StatusOrdemServico {
  switch (s) {
    case "EmAnalise": return StatusOrdemServico.EmAnalise
    case "Pronto": return StatusOrdemServico.Pronto
    case "Entregue": return StatusOrdemServico.Entregue
    default: return StatusOrdemServico.Aberto
  }
}

/**
 * O `slugCategoria` antigo (`norm().replace(/\s+/g,"_")`) foi removido: gravava
 * `pilhas_e_baterias` na coluna `category` e ainda copiava esse slug para `brand`.
 * A categoria agora é resolvida por `resolverNomeCategoria`, que reaproveita a
 * grafia da `CategoriaCadastro` da loja quando ela já existir.
 */

// ── Persistência por domínio ─────────────────────────────────

async function persistirClientes(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[]
): Promise<Map<string, string>> {
  const nomeParaId = new Map<string, string>()

  for (const reg of registros) {
    try {
      const campos = extrairCamposCliente(reg)
      if (!campos.name.trim()) {
        log.push({ dominio: "clientes", chave: reg.chave, acao: "ignorado", detalhe: "Nome vazio" })
        continue
      }

      const docDigits = docDigitsForDedupe(campos.document)
      const nomeNorm = normalizeNameForMatch(campos.name)

      // Busca por documento (CPF/CNPJ) primeiro — mais precisa que nome
      const docDigitsLocal = docDigitsForDedupe(campos.document)
      let existente: { id: string } | null = null
      if (docDigitsLocal) {
        existente = await prisma.cliente.findFirst({
          where: { storeId, document: { contains: docDigitsLocal } },
          select: { id: true },
        })
      }
      // Fallback: busca por nome insensível a maiúsculas
      if (!existente) {
        existente = await prisma.cliente.findFirst({
          where: {
            storeId,
            name: { equals: campos.name, mode: "insensitive" as const },
          },
          select: { id: true },
        })
      }

      const cidadeUf = [campos.city].filter(Boolean).join("") || ""
      const data = {
        storeId,
        name: campos.name,
        phone: campos.phone ?? null,
        email: campos.email ?? null,
        document: campos.document || "",
        kind: (campos.kind === "PJ" ? "PJ" : "PF") as string,
        city: cidadeUf,
        active: campos.active ?? true,
        tags: campos.payload as Prisma.InputJsonValue,
      }

      let id: string
      if (existente) {
        await prisma.cliente.update({ where: { id: existente.id }, data })
        id = existente.id
        log.push({ dominio: "clientes", chave: reg.chave, acao: "atualizado" })
      } else {
        const criado = await prisma.cliente.create({ data })
        id = criado.id
        log.push({ dominio: "clientes", chave: reg.chave, acao: "criado" })
      }

      nomeParaId.set(nomeNorm, id)
      if (docDigits) nomeParaId.set(docDigits, id)
    } catch (e) {
      log.push({
        dominio: "clientes",
        chave: reg.chave,
        acao: "erro",
        detalhe: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return nomeParaId
}

async function persistirFornecedores(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[]
): Promise<void> {
  for (const reg of registros) {
    try {
      const campos = extrairCamposCliente(reg)
      if (!campos.name.trim()) {
        log.push({ dominio: "fornecedores", chave: reg.chave, acao: "ignorado", detalhe: "Nome vazio" })
        continue
      }

      // Model Fornecedor não tem @@unique — "upsert lógico" via findFirst + create/update
      const docDigits = docDigitsForDedupe(campos.document)
      let existente: { id: string } | null = null
      if (docDigits) {
        existente = await prisma.fornecedor.findFirst({
          where: { storeId, document: { contains: docDigits } },
          select: { id: true },
        })
      }
      if (!existente) {
        existente = await prisma.fornecedor.findFirst({
          where: {
            storeId,
            name: { equals: campos.name, mode: "insensitive" as const },
          },
          select: { id: true },
        })
      }

      const data = {
        storeId,
        name: campos.name,
        document: campos.document || "",
        email: campos.email ?? "",
        phone: campos.phone ?? "",
        active: campos.active ?? true,
      }

      if (existente) {
        await prisma.fornecedor.update({ where: { id: existente.id }, data })
        log.push({ dominio: "fornecedores", chave: reg.chave, acao: "atualizado" })
      } else {
        await prisma.fornecedor.create({ data })
        log.push({ dominio: "fornecedores", chave: reg.chave, acao: "criado" })
      }
    } catch (e) {
      log.push({
        dominio: "fornecedores",
        chave: reg.chave,
        acao: "erro",
        detalhe: e instanceof Error ? e.message : String(e),
      })
    }
  }
}

// ── Produtos: candidatos, plano e persistência ───────────────

const PRODUTO_CANDIDATO_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  brand: true,
  supplierName: true,
  active: true,
  price: true,
  metadata: true,
} as const

/**
 * Carrega, em poucas consultas, todos os candidatos possíveis do lote e devolve o
 * índice puro de `lib/cadastros/importacao-produtos/candidatos.ts`.
 *
 * Sem o pré-carregamento, uma nota da Modenuti com centenas de itens faria 4 queries
 * por linha. Todas as buscas são escopadas por `storeId` — o mesmo EAN em outra loja
 * é outro produto e nunca aparece aqui.
 */
async function carregarCandidatosProdutos(
  storeId: string,
  linhas: ReadonlyArray<ProdutoImportLinha>,
): Promise<IndiceCandidatos> {
  const barcodes = [...new Set(linhas.map((l) => l.barcode).filter((b): b is string => !!b))]
  const skus = [...new Set(linhas.map((l) => l.sku).filter((s): s is string => !!s))]
  const nomes = [...new Set(linhas.map((l) => l.nome).filter(Boolean))]
  const fornecedores = [
    ...new Set(
      linhas.filter((l) => l.codigoFornecedor).map((l) => l.fornecedorNome.trim()).filter(Boolean),
    ),
  ]

  const buscar = async (where: Prisma.ProdutoWhereInput): Promise<ProdutoCandidatoRow[]> => {
    const rows = await prisma.produto.findMany({
      where: { storeId, ...where },
      select: PRODUTO_CANDIDATO_SELECT,
      take: 5000,
    })
    return rows.map((r) => ({ ...r, price: Number(r.price ?? 0) }))
  }

  const [rowsBarcode, rowsSku, rowsNome, rowsFornecedor, categoriasRows] = await Promise.all([
    barcodes.length > 0 ? buscar({ barcode: { in: barcodes } }) : Promise.resolve([]),
    // `gc-` era o prefixo do importador legado: o mesmo código pode estar gravado
    // como `123` ou `gc-123`. Buscamos as duas formas e comparamos pelo miolo.
    skus.length > 0
      ? buscar({ sku: { in: [...skus, ...skus.map((s) => `gc-${s}`)], mode: "insensitive" } })
      : Promise.resolve([]),
    nomes.length > 0 ? buscar({ name: { in: nomes, mode: "insensitive" } }) : Promise.resolve([]),
    fornecedores.length > 0
      ? buscar({ supplierName: { in: fornecedores, mode: "insensitive" } })
      : Promise.resolve([]),
    prisma.categoriaCadastro
      .findMany({ where: { storeId, type: "produto", active: true }, select: { name: true } })
      .catch(() => [] as Array<{ name: string }>),
  ])

  // Dedupe por id: uma mesma linha pode voltar em mais de uma das consultas.
  const unicos = new Map<string, ProdutoCandidatoRow>()
  for (const r of [...rowsBarcode, ...rowsSku, ...rowsNome, ...rowsFornecedor]) {
    if (!unicos.has(r.id)) unicos.set(r.id, r)
  }

  return indexarCandidatos([...unicos.values()], categoriasRows.map((c) => c.name))
}

type ResumoProdutoImportado = ResumoLinhaProduto

/** Linha do preview de produtos — tudo que a tela precisa mostrar antes de importar. */
export type PreviewLinhaProduto = {
  linhaOrigem: number
  produto: string
  barcode: string
  sku: string
  categoria: string
  marca: string
  fornecedor: string
  custo: number
  preco: number
  estoque: number | null
  ncm: string
  cest: string
  resultado: "criar" | "atualizar" | "ignorar" | "conflito"
  matchPor: string | null
  motivo: string
  /** Campos que a importação vai alterar no produto existente. */
  camposAlterados: string[]
  /** Campos deliberadamente preservados (estoque, e preço/custo quando a planilha não traz). */
  camposPreservados: string[]
  alertas: AlertaImport[]
}

export type PreviewProdutos = {
  linhas: PreviewLinhaProduto[]
  totalCriar: number
  totalAtualizar: number
  totalIgnorar: number
  totalConflito: number
  /** `true` trava o botão Importar. */
  bloqueado: boolean
}

/**
 * Planeja o lote de produtos SEM escrever nada. Mesmo motor de matching do
 * `persistirProdutos` — o preview não pode divergir do que será persistido.
 */
export async function planejarProdutosDoLote(
  storeId: string,
  registros: RegistroMergeado[],
  contexto: ContextoLoteImport = { ...CONTEXTO_LOTE_VAZIO },
): Promise<PreviewProdutos> {
  const fornecedorPadrao = contexto.fornecedor?.nome ?? ""
  const linhas = registros.map((reg) => extrairCamposProduto(reg, { fornecedorPadrao }))
  const validas = linhas.filter((l) => l.nome.trim() && !nomePareceDocumento(l.nome))
  const candidatos = await carregarCandidatosProdutos(storeId, validas)
  const consumidos = new Set<string>()

  const out: PreviewLinhaProduto[] = linhas.map((linha) => {
    const semNome = !linha.nome.trim() || nomePareceDocumento(linha.nome)
    const ctx = contextoDeMatch(linha, candidatos, consumidos)

    const plano = semNome
      ? {
          acao: "ignorar" as const,
          produtoId: null,
          matchPor: null,
          motivo: "Linha sem nome de produto válido",
          conflitos: [],
        }
      : planejarMatchProduto(linha, ctx)

    if (plano.produtoId) consumidos.add(plano.produtoId)

    const categoria = resolverNomeCategoria(linha.categoria, candidatos.categorias)
    const alvo = candidatoDoPlano(ctx, plano.produtoId)

    let camposAlterados: string[] = []
    let camposPreservados: string[] = []
    if (plano.acao === "atualizar" && alvo) {
      const diff = diffAtualizacao(linha, alvo, { categoria })
      camposAlterados = diff.alterados
      camposPreservados = diff.preservados
    } else if (plano.acao === "criar") {
      camposPreservados = [
        contexto.politicaEstoque === "planilha_somente_novos"
          ? "estoque da planilha"
          : "estoque zerado (sem movimentação)",
      ]
    }

    return {
      linhaOrigem: linha.linhaOrigem,
      produto: linha.nome,
      barcode: linha.barcode ?? "",
      sku: linha.sku ?? "",
      categoria,
      marca: linha.marca,
      fornecedor: linha.fornecedorNome,
      custo: linha.custo,
      preco: linha.preco,
      estoque: linha.estoque,
      ncm: linha.fiscal.ncm,
      cest: linha.fiscal.cest,
      resultado: plano.acao,
      matchPor: plano.matchPor,
      motivo: plano.motivo,
      camposAlterados,
      camposPreservados,
      alertas: alertasDaLinha(linha, plano),
    }
  })

  return {
    linhas: out,
    totalCriar: out.filter((l) => l.resultado === "criar").length,
    totalAtualizar: out.filter((l) => l.resultado === "atualizar").length,
    totalIgnorar: out.filter((l) => l.resultado === "ignorar").length,
    totalConflito: out.filter((l) => l.resultado === "conflito").length,
    bloqueado: out.some((l) => temBloqueio(l.alertas)),
  }
}

async function persistirProdutos(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[],
  ctx: { batchId: string; contexto: ContextoLoteImport },
  resumo: ResumoProdutoImportado[],
): Promise<void> {
  const fornecedorPadrao = ctx.contexto.fornecedor?.nome ?? ""
  const importadoEm = new Date().toISOString()

  const preparadas = registros.map((reg) => ({
    reg,
    linha: extrairCamposProduto(reg, { fornecedorPadrao }),
  }))

  const validas = preparadas.filter(({ reg, linha }) => {
    if (!linha.nome.trim()) {
      log.push({ dominio: "produtos", chave: reg.chave, acao: "ignorado", detalhe: "Nome vazio" })
      resumo.push({
        chave: reg.chave,
        linhaOrigem: linha.linhaOrigem,
        nome: "",
        acao: "ignorado",
        matchPor: null,
        motivo: "Linha sem nome de produto",
        produtoId: null,
      })
      return false
    }
    // Guard de documento: termos/contratos que vazam para a planilha não viram produto.
    if (nomePareceDocumento(linha.nome)) {
      log.push({
        dominio: "produtos",
        chave: reg.chave,
        acao: "ignorado",
        detalhe: "Linha parece termo/documento, não produto (revisar)",
      })
      resumo.push({
        chave: reg.chave,
        linhaOrigem: linha.linhaOrigem,
        nome: linha.nome.slice(0, 80),
        acao: "ignorado",
        matchPor: null,
        motivo: "Linha parece termo/documento, não produto",
        produtoId: null,
      })
      return false
    }
    return true
  })

  if (validas.length === 0) return

  const candidatos = await carregarCandidatosProdutos(
    storeId,
    validas.map((v) => v.linha),
  )

  // Ids já consumidos neste lote: duas linhas da mesma planilha não podem cair no
  // mesmo produto (aconteceria com nomes repetidos + match por nome).
  const consumidos = new Set<string>()

  for (const { reg, linha } of validas) {
    try {
      const matchCtx = contextoDeMatch(linha, candidatos, consumidos)
      const plano = planejarMatchProduto(linha, matchCtx)

      if (plano.acao === "conflito" || plano.acao === "ignorar") {
        log.push({
          dominio: "produtos",
          chave: reg.chave,
          acao: "ignorado",
          detalhe: `${plano.acao === "conflito" ? "Conflito" : "Ignorado"}: ${plano.motivo}`,
        })
        resumo.push({
          chave: reg.chave,
          linhaOrigem: linha.linhaOrigem,
          nome: linha.nome,
          acao: plano.acao === "conflito" ? "conflito" : "ignorado",
          matchPor: null,
          motivo: plano.motivo,
          produtoId: null,
        })
        continue
      }

      const categoria = resolverNomeCategoria(linha.categoria, candidatos.categorias)
      const fiscalInput = fiscalInputDaLinha(linha)
      const alvo = candidatoDoPlano(matchCtx, plano.produtoId)

      if (plano.acao === "atualizar" && alvo) {
        const atualDoBanco = await prisma.produto
          .findUnique({
            where: { id: alvo.id },
            select: { metadata: true, sku: true, barcode: true, category: true, price: true },
          })
          .catch(() => null)
        const metadataAtual = atualDoBanco?.metadata ?? null

        // ── Política de ativação/revisão (F-05) ──────────────────────────────
        // Precisa do estado ANTERIOR: revisão registrada + campos críticos que este
        // lote realmente altera. Revisão só é reaberta quando algo crítico muda.
        const revisaoAnterior = getImportacaoMetadata({ metadata: metadataAtual })
        const patchPrevia = montarAtualizacaoProduto(linha, alvo, { categoria })
        const camposCriticosAlterados = camposCriticosAlteradosNaImportacao({
          patch: patchPrevia,
          atual: {
            sku: atualDoBanco?.sku ?? alvo.sku,
            barcode: atualDoBanco?.barcode ?? alvo.barcode,
            category: atualDoBanco?.category ?? null,
            price: Number(atualDoBanco?.price ?? alvo.price ?? 0),
          },
          fiscalAtual: getProdutoFiscal({ metadata: metadataAtual }),
          fiscalNovo: { ncm: fiscalInput.ncm, cest: fiscalInput.cest },
        })
        const ativacao = ativacaoDaAtualizacao(linha, alvo, {
          categoria,
          statusRevisaoAtual: revisaoAnterior?.ultimoLote.statusRevisao,
          camposCriticosAlterados,
        })

        const lote = construirLoteImportacao({
          batchId: ctx.batchId,
          arquivo: reg.fontes[0] ?? "",
          importadoEm,
          acao: "atualizado",
          matchPor: plano.matchPor,
          linhaOrigem: linha.linhaOrigem,
          contexto: ctx.contexto,
          statusRevisao: ativacao.statusRevisao,
          revisadoEm: revisaoAnterior?.ultimoLote.revisadoEm ?? null,
          revisadoPor: revisaoAnterior?.ultimoLote.revisadoPor ?? null,
        })

        let metadata: Record<string, unknown> = mergeProdutoFiscalIntoMetadata(
          metadataAtual,
          fiscalInput,
        )
        metadata = mergeImportacaoIntoMetadata(metadata, lote)
        if (linha.codigoFornecedor) {
          metadata.fornecedor = {
            ...(typeof metadata.fornecedor === "object" && metadata.fornecedor !== null
              ? (metadata.fornecedor as Record<string, unknown>)
              : {}),
            codigo: linha.codigoFornecedor,
            nome: linha.fornecedorNome || undefined,
          }
        }

        // `montarAtualizacaoProduto` omite `stock` de propósito: saldo só muda por
        // movimentação auditada (app/actions/estoque.ts → MovimentacaoEstoque).
        // `active`/`status` vêm da política e só aparecem para REBAIXAR o produto que
        // termina sem preço — importação nunca reativa cadastro desligado (F-05).
        await prisma.produto.update({
          where: { id: alvo.id },
          data: {
            ...montarAtualizacaoProduto(linha, alvo, {
              categoria,
              statusRevisaoAtual: revisaoAnterior?.ultimoLote.statusRevisao,
            }),
            metadata: metadata as Prisma.InputJsonValue,
          },
        })
        consumidos.add(alvo.id)
        log.push({ dominio: "produtos", chave: reg.chave, acao: "atualizado" })
        resumo.push({
          chave: reg.chave,
          linhaOrigem: linha.linhaOrigem,
          nome: linha.nome,
          acao: "atualizado",
          matchPor: plano.matchPor,
          motivo: plano.motivo,
          produtoId: alvo.id,
        })
        continue
      }

      // ── Criação ────────────────────────────────────────────────────────────
      // Produto novo sempre nasce pendente de conferência.
      const loteCriacao = construirLoteImportacao({
        batchId: ctx.batchId,
        arquivo: reg.fontes[0] ?? "",
        importadoEm,
        acao: "criado",
        matchPor: plano.matchPor,
        linhaOrigem: linha.linhaOrigem,
        contexto: ctx.contexto,
        statusRevisao: ativacaoDaCriacao(linha, categoria).statusRevisao,
      })

      let metadata: Record<string, unknown> = mergeProdutoFiscalIntoMetadata({}, fiscalInput)
      metadata = mergeImportacaoIntoMetadata(metadata, loteCriacao)
      if (linha.codigoFornecedor) {
        metadata.fornecedor = { codigo: linha.codigoFornecedor, nome: linha.fornecedorNome || undefined }
      }

      // Política de estoque + regra de ativação vivem em `montarCriacaoProduto`:
      // `nao_movimentar` (padrão) cadastra com saldo 0 e produto sem preço nasce inativo.
      const criado = await prisma.produto.create({
        data: {
          storeId,
          ...montarCriacaoProduto(linha, {
            categoria,
            politicaEstoque: ctx.contexto.politicaEstoque,
          }),
          metadata: metadata as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
      consumidos.add(criado.id)
      log.push({ dominio: "produtos", chave: reg.chave, acao: "criado" })
      resumo.push({
        chave: reg.chave,
        linhaOrigem: linha.linhaOrigem,
        nome: linha.nome,
        acao: "criado",
        matchPor: null,
        motivo: plano.motivo,
        produtoId: criado.id,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.push({ dominio: "produtos", chave: reg.chave, acao: "erro", detalhe: msg })
      resumo.push({
        chave: reg.chave,
        linhaOrigem: linha.linhaOrigem,
        nome: linha.nome,
        acao: "erro",
        matchPor: null,
        motivo: msg,
        produtoId: null,
      })
    }
  }
}

async function persistirOS(
  storeId: string,
  registros: RegistroMergeado[],
  clienteNomeParaId: Map<string, string>,
  log: LogLinhaImport[]
): Promise<void> {
  for (const reg of registros) {
    try {
      const campos = extrairCamposOS(reg)

      // Tenta resolver clienteId: documento → mapa de nomes → banco por nome
      const nomeNorm = normalizeNameForMatch(campos.clienteNome)
      const docCampos = String(
        reg.campos["cliente.cpf"] ?? reg.campos["cliente.cnpj"] ?? reg.campos["cliente.documento"] ?? ""
      ).trim()
      const docDigitsOS = docDigitsForDedupe(docCampos)

      let clienteId: string | null = null

      // 1. Tenta pelo documento (mais preciso — evita mesclar homônimos)
      if (docDigitsOS) {
        clienteId = clienteNomeParaId.get(docDigitsOS) ?? null
      }

      // 2. Fallback: mapa de nomes da importação atual
      if (!clienteId) {
        clienteId = clienteNomeParaId.get(nomeNorm) ?? null
      }

      // 3. Fallback: busca no banco por documento
      if (!clienteId && docDigitsOS) {
        const cli = await prisma.cliente.findFirst({
          where: { storeId, document: { contains: docDigitsOS } },
          select: { id: true },
        })
        clienteId = cli?.id ?? null
      }

      // 4. Último fallback: busca no banco por nome
      if (!clienteId && campos.clienteNome) {
        const cli = await prisma.cliente.findFirst({
          where: {
            storeId,
            name: { equals: campos.clienteNome, mode: "insensitive" },
          },
          select: { id: true },
        })
        clienteId = cli?.id ?? null
      }

      // 5. Fallback final: busca por nome com contains (mais tolerante a variações)
      if (!clienteId && campos.clienteNome) {
        const nomeNorm = normalizeNameForMatch(campos.clienteNome)
        // Pega primeira palavra significativa do nome (ex: "ANDRESSA" de "ANDRESSA SILVA")
        const primeiraPalavra = nomeNorm.split(/\s+/).filter(w => w.length >= 3)[0]
        if (primeiraPalavra) {
          const cli = await prisma.cliente.findFirst({
            where: {
              storeId,
              name: { contains: primeiraPalavra, mode: "insensitive" },
            },
            select: { id: true },
          })
          clienteId = cli?.id ?? null
        }
      }

      const payloadFinal = {
        ...campos.payload,
        clienteNome: campos.clienteNome,
      } as Prisma.InputJsonValue

      // Normaliza número da OS
      const numeroNorm = campos.numero.toUpperCase().startsWith("OS")
        ? campos.numero
        : `OS-${campos.numero}`

      const existente = await prisma.ordemServico.findFirst({
        where: { storeId, numero: numeroNorm },
        select: { id: true },
      })

      if (existente) {
        await prisma.ordemServico.update({
          where: { id: existente.id },
          data: {
            clienteId,
            valorTotal: campos.valorTotal,
            valorBase: campos.valorBase,
            equipamento: campos.equipamento,
            defeito: campos.defeito,
            laudoTecnico: campos.laudoTecnico || null,
            status: toStatusPrisma(campos.status),
            payload: payloadFinal,
          },
        })
        log.push({ dominio: "ordens_servicos", chave: numeroNorm, acao: "atualizado" })
      } else {
        const id = `os-import-${numeroNorm.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${Date.now()}`
        await prisma.ordemServico.create({
          data: {
            id,
            storeId,
            numero: numeroNorm,
            clienteId,
            valorTotal: campos.valorTotal,
            valorBase: campos.valorBase,
            equipamento: campos.equipamento,
            defeito: campos.defeito,
            laudoTecnico: campos.laudoTecnico || null,
            status: toStatusPrisma(campos.status),
            payload: payloadFinal,
          },
        })
        log.push({ dominio: "ordens_servicos", chave: numeroNorm, acao: "criado" })
      }
    } catch (e) {
      log.push({
        dominio: "ordens_servicos",
        chave: reg.chave,
        acao: "erro",
        detalhe: e instanceof Error ? e.message : String(e),
      })
    }
  }
}

async function persistirVendas(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[]
): Promise<void> {
  for (const reg of registros) {
    try {
      const c = reg.campos
      const pedidoId = String(c["venda.numero"] ?? c["_raw.Nº do pedido"] ?? reg.chave).trim()
      if (!pedidoId) continue

      const total =
        (c["financeiro.valorTotal"] as number | null) ??
        parseFloat(String(c["_raw.Total do pedido"] ?? "0").replace(",", ".")) ??
        0

      const dataRaw = String(c["data.data"] ?? c["_raw.Data"] ?? "").trim()
      let at = new Date()
      if (dataRaw) {
        const match = dataRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (match) at = new Date(`${match[3]}-${match[2]}-${match[1]}`)
        else if (/^\d{4}-\d{2}-\d{2}/.test(dataRaw)) at = new Date(dataRaw)
      }

      const clienteNome = String(c["cliente.nome"] ?? c["_raw.Cliente"] ?? "").trim() || null
      const pagamentosArr = (c["_array.vendas_pagamentos"] as Record<string, unknown>[] | undefined) ?? []
      const produtosArr = (c["_array.vendas_produtos"] as Record<string, unknown>[] | undefined) ?? []

      const payload = {
        pedidoId,
        cliente: clienteNome,
        total,
        at: at.toISOString(),
        formaPagamento: pagamentosArr[0]?.["pagamento.forma"] ?? pagamentosArr[0]?.["_raw.Forma de pagamento"] ?? null,
        parcelas: pagamentosArr.map((p) => ({
          valor: p["financeiro.valorParcela"] ?? p["_raw.Valor da parcela"],
          forma: p["pagamento.forma"] ?? p["_raw.Forma de pagamento"],
          vencimento: p["pagamento.vencimento"] ?? p["_raw.Vencimento"],
        })),
        itens: produtosArr.map((p) => ({
          produto: p["produto.nome"] ?? p["_raw.Produto"],
          quantidade: p["item.quantidade"] ?? p["_raw.Quantidade"] ?? 1,
          valorUnitario: p["financeiro.valorUnitario"] ?? p["_raw.Valor unitário"],
          valorTotal: p["financeiro.valorTotal"] ?? p["_raw.Valor total"],
        })),
        vendedor: c["meta.vendedor"] ?? c["_raw.Vendedor"] ?? null,
        fontes: reg.fontes,
        importadoEm: new Date().toISOString(),
      }

      await prisma.venda.upsert({
        where: { pedidoId },
        create: {
          storeId,
          pedidoId,
          total: typeof total === "number" ? total : 0,
          at,
          clienteNome,
          payload: payload as Prisma.InputJsonValue,
        },
        update: {
          total: typeof total === "number" ? total : 0,
          at,
          clienteNome,
          payload: payload as Prisma.InputJsonValue,
        },
      })

      log.push({ dominio: "vendas", chave: pedidoId, acao: "criado" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes("Unique")) {
        log.push({ dominio: "vendas", chave: reg.chave, acao: "atualizado" })
      } else {
        log.push({ dominio: "vendas", chave: reg.chave, acao: "erro", detalhe: msg })
      }
    }
  }
}

// ── Helpers de persistência financeira ───────────────────────

/** Slug compatível com `localKey` (sem `:` para não quebrar parse). */
function slugForLocalKey(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "sem-descricao"
}

/**
 * Enumera parcelas por (descricao+entidade): ordena por vencimento ASC e
 * atribui {numero, total}. Quando há colisão de vencimento, usa o índice
 * original do array como desempate estável.
 */
function indexarParcelas<T extends { descricao: string; vencimento: string }>(
  itens: ReadonlyArray<T>,
  entidadeDeIndex: (i: number) => string,
): Map<number, { numero: number; total: number }> {
  const grupos = new Map<string, number[]>()
  for (let i = 0; i < itens.length; i++) {
    const chave = `${itens[i]!.descricao}|${entidadeDeIndex(i)}`
    const lista = grupos.get(chave)
    if (lista) lista.push(i)
    else grupos.set(chave, [i])
  }
  const resultado = new Map<number, { numero: number; total: number }>()
  for (const indices of grupos.values()) {
    indices.sort((a, b) => {
      const va = itens[a]!.vencimento || ""
      const vb = itens[b]!.vencimento || ""
      if (va === vb) return a - b
      return va.localeCompare(vb)
    })
    const total = indices.length
    indices.forEach((idx, pos) => {
      resultado.set(idx, { numero: pos + 1, total })
    })
  }
  return resultado
}

async function persistirContasReceber(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[]
): Promise<void> {
  // Pré-extrai todos os registros (extrator é puro/barato) para podermos
  // numerar parcelas antes de persistir.
  const extraidos = registros.map((reg) => ({ reg, campos: extrairCamposContaReceber(reg) }))
  const ordemParcelas = indexarParcelas(
    extraidos.map((e) => e.campos),
    (i) => extraidos[i]!.campos.cliente,
  )

  for (let i = 0; i < extraidos.length; i++) {
    const { reg, campos } = extraidos[i]!
    try {
      if (!campos.descricao && !campos.cliente && campos.valor === 0) {
        log.push({ dominio: "contas_receber", chave: reg.chave, acao: "ignorado", detalhe: "Linha vazia" })
        continue
      }

      const parc = ordemParcelas.get(i) ?? { numero: 1, total: 1 }
      const sufixo = parc.total > 1 ? ` (${parc.numero}/${parc.total})` : ""
      const descricaoFinal = `${campos.descricao || `Recebimento ${reg.chave}`}${sufixo}`

      const slugDesc = slugForLocalKey(campos.descricao || reg.chave)
      const slugCli = slugForLocalKey(campos.cliente)
      const venc = campos.vencimento || "sem-venc"
      const valorCents = Math.round((campos.valor ?? 0) * 100)
      // localKey única por parcela. Re-importar a mesma planilha cai no mesmo
      // upsert (idempotente). Parcelas diferentes (vencimento ou ordem) não
      // colidem porque o índice está embutido na chave.
      const localKey = `imp-gc:${storeId}:cr:${slugDesc}:${slugCli}:${venc}:${valorCents}:${parc.numero}`

      const statusCanon = campos.status ?? "pendente"
      const historico: Array<Record<string, unknown>> = []
      if (statusCanon === "pago" && campos.valorPago > 0) {
        historico.push({
          tipo: "pagamento",
          valor: campos.valorPago,
          data: campos.dataConfirmacao ?? null,
          observacao: "Importado GestaoClick (Confirmado)",
          importadoEm: new Date().toISOString(),
        })
      }

      const payloadPatch = {
        ...campos.payload,
        parcela: { numero: parc.numero, total: parc.total },
        valorPago: campos.valorPago,
        valorOriginal: campos.valor,
        historico,
      }

      // replacePayload: true → re-importações reescrevem o payload (inclui
      // histórico) em vez de acumular pagamentos duplicados.
      await upsertContaReceber({
        storeId,
        localKey,
        descricao: descricaoFinal,
        cliente: campos.cliente || undefined,
        valor: campos.valor,
        vencimento: campos.vencimento || undefined,
        status: statusCanon,
        payloadPatch,
        replacePayload: true,
      })

      log.push({
        dominio: "contas_receber",
        chave: `${reg.chave}#${parc.numero}/${parc.total}`,
        acao: "criado",
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.push({ dominio: "contas_receber", chave: reg.chave, acao: "erro", detalhe: msg })
    }
  }
}

async function persistirContasPagar(
  storeId: string,
  registros: RegistroMergeado[],
  log: LogLinhaImport[]
): Promise<void> {
  const extraidos = registros.map((reg) => ({ reg, campos: extrairCamposContaPagar(reg) }))
  const ordemParcelas = indexarParcelas(
    extraidos.map((e) => e.campos),
    (i) => extraidos[i]!.campos.fornecedorNome,
  )

  for (let i = 0; i < extraidos.length; i++) {
    const { reg, campos } = extraidos[i]!
    try {
      if (!campos.descricao && !campos.fornecedorNome && campos.valor === 0) {
        log.push({ dominio: "contas_pagar", chave: reg.chave, acao: "ignorado", detalhe: "Linha vazia" })
        continue
      }

      const parc = ordemParcelas.get(i) ?? { numero: 1, total: 1 }
      const sufixo = parc.total > 1 ? ` (${parc.numero}/${parc.total})` : ""
      const descricaoFinal = `${campos.descricao || `Pagamento ${reg.chave}`}${sufixo}`

      const slugDesc = slugForLocalKey(campos.descricao || reg.chave)
      const slugFor = slugForLocalKey(campos.fornecedorNome)
      const venc = campos.vencimento || "sem-venc"
      const valorCents = Math.round((campos.valor ?? 0) * 100)
      const localKey = `imp-gc:${storeId}:cp:${slugDesc}:${slugFor}:${venc}:${valorCents}:${parc.numero}`

      const statusCanon = campos.status ?? "pendente"
      const historico: Array<Record<string, unknown>> = []
      if (statusCanon === "pago" && campos.valorPago > 0) {
        historico.push({
          tipo: "pagamento",
          valor: campos.valorPago,
          data: campos.dataConfirmacao ?? null,
          observacao: "Importado GestaoClick (Confirmado)",
          importadoEm: new Date().toISOString(),
        })
      }

      const payloadPatch = {
        ...campos.payload,
        parcela: { numero: parc.numero, total: parc.total },
        valorPago: campos.valorPago,
        valorOriginal: campos.valor,
        historico,
      }

      await upsertContaPagar({
        storeId,
        localKey,
        descricao: descricaoFinal,
        fornecedorNome: campos.fornecedorNome || undefined,
        valor: campos.valor,
        vencimento: campos.vencimento || undefined,
        status: statusCanon,
        numeroDocumento: campos.numeroDocumento || undefined,
        payloadPatch,
        replacePayload: true,
      })

      log.push({
        dominio: "contas_pagar",
        chave: `${reg.chave}#${parc.numero}/${parc.total}`,
        acao: "criado",
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.push({ dominio: "contas_pagar", chave: reg.chave, acao: "erro", detalhe: msg })
    }
  }
}

// ── Orquestrador principal ────────────────────────────────────

export async function persistirImportacao(
  storeId: string,
  grupos: Map<DominioImport, RegistroMergeado[]>,
  batchId: string,
  /** Contexto humano do lote (fornecedor, NF-e, política de estoque). Opcional. */
  contextoLote: ContextoLoteImport = { ...CONTEXTO_LOTE_VAZIO }
): Promise<ResultadoImportacao> {
  const inicio = Date.now()
  const log: LogLinhaImport[] = []
  const resumoProdutos: ResumoProdutoImportado[] = []

  // 1. Clientes primeiro (OS e Vendas dependem deles)
  const clienteNomeParaId = new Map<string, string>()
  const regClientes = grupos.get("clientes") ?? []
  if (regClientes.length > 0) {
    const mapa = await persistirClientes(storeId, regClientes, log)
    for (const [k, v] of mapa) clienteNomeParaId.set(k, v)
  }

  // 2. Fornecedores (independente — usa persistência própria, NÃO vai pra tabela Cliente)
  const regFornecedores = grupos.get("fornecedores") ?? []
  if (regFornecedores.length > 0) {
    await persistirFornecedores(storeId, regFornecedores, log)
  }

  // 3. Produtos / Catálogo
  const regProdutos = grupos.get("produtos") ?? []
  if (regProdutos.length > 0) {
    await persistirProdutos(storeId, regProdutos, log, { batchId, contexto: contextoLote }, resumoProdutos)
  }

  // 4. Serviços catálogo — não persiste em produto. Aguarda model Servico próprio.
  const regServicos = grupos.get("servicos_catalogo") ?? []
  if (regServicos.length > 0) {
    for (const reg of regServicos) {
      log.push({
        dominio: "servicos_catalogo",
        chave: reg.chave,
        acao: "ignorado",
        detalhe: "Modelo Servico não implementado — será coberto em Fix futuro",
      })
    }
  }

  // 5. Ordens de Serviço (depende de clientes)
  const regOS = grupos.get("ordens_servicos") ?? []
  if (regOS.length > 0) {
    await persistirOS(storeId, regOS, clienteNomeParaId, log)
  }

  // 6. Vendas (depende de clientes + produtos)
  const regVendas = grupos.get("vendas") ?? []
  if (regVendas.length > 0) {
    await persistirVendas(storeId, regVendas, log)
  }

  // 7. Contas a receber (importador → Prisma via service idempotente)
  const regContasReceber = grupos.get("contas_receber") ?? []
  if (regContasReceber.length > 0) {
    await persistirContasReceber(storeId, regContasReceber, log)
  }

  // 8. Contas a pagar (importador → Prisma via service idempotente)
  const regContasPagar = grupos.get("contas_pagar") ?? []
  if (regContasPagar.length > 0) {
    await persistirContasPagar(storeId, regContasPagar, log)
  }

  const criados = log.filter((l) => l.acao === "criado").length
  const atualizados = log.filter((l) => l.acao === "atualizado").length
  const ignorados = log.filter((l) => l.acao === "ignorado").length
  const erros = log.filter((l) => l.acao === "erro").length

  return {
    batchId,
    ok: erros === 0,
    criados,
    atualizados,
    ignorados,
    erros,
    log,
    duracaoMs: Date.now() - inicio,
    resumoProdutos,
  }
}
