"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FileSpreadsheet, UploadCloud, X } from "lucide-react"
import Papa from "papaparse"
import * as XLSX from "xlsx"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { dispatchClientesRevalidate } from "@/lib/clientes-revalidate"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { defaultChecklist, horaAtualHHMM } from "@/components/dashboard/os/ordens-servico"
import { cellToTrimmedString } from "@/lib/import-normalize"
import { shouldSkipInventoryImportName } from "@/lib/inventory-import-filters"
import {
  mapGestaoClickSituacaoOs,
  mapStatusContasPagarImportBlindagem,
  mapStatusContasReceberImportBlindagem,
  parseDataBrFlex,
} from "@/lib/backup-import-datas"
import { getPedidosPagosVendas } from "@/lib/import-pagamentos-lookup"
import { contasReceberStorageKey } from "@/lib/contas-receber-storage"
import { isNomeVendedorLojaTratarConsumidorFinal } from "@/lib/contas-receber-import-constants"
import { useFinanceiro } from "@/lib/financeiro-store"
import type { MovimentoFinanceiro } from "@/lib/financeiro-types"
import type { ContaPagarItem } from "@/lib/financeiro-types"
import {
  type GestaoClickFileKind,
  applyGestaoClickPostParse,
} from "@/lib/gestaoclick-import"

type ImportKind =
  | "clientes"
  | "produtos"
  | "ordens_servico"
  | "fluxo_caixa"
  | "vendas"
  | "contas_pagar"
  | "contas_receber"

type ParsedSheet = {
  fileName: string
  headers: string[]
  rows: Record<string, unknown>[]
  grid?: unknown[][]
  headerRowIndex?: number
  detectedKind?: GestaoClickFileKind
}

type MapTarget =
  | "clientes.codigo"
  | "clientes.tipo_pessoa"
  | "clientes.nome"
  | "clientes.doc"
  | "clientes.rg"
  | "clientes.data_nascimento"
  | "clientes.razao_social"
  | "clientes.nome_fantasia"
  | "clientes.cnpj_empresa"
  | "clientes.inscricao_estadual"
  | "clientes.inscricao_municipal"
  | "clientes.ativo"
  | "clientes.telefone_fixo"
  | "clientes.telefone"
  | "clientes.email"
  | "clientes.endereco"
  | "clientes.cadastrado_em"
  | "produtos.nome"
  | "produtos.sku"
  | "produtos.categoria"
  | "produtos.preco_custo"
  | "produtos.preco_venda"
  | "produtos.estoque"
  | "ordens.numero"
  | "ordens.cliente_nome"
  | "ordens.doc_cliente"
  | "ordens.telefone"
  | "ordens.equipamento"
  | "ordens.defeito"
  | "ordens.situacao"
  | "ordens.valor_total"
  | "fluxo.data_vencimento"
  | "fluxo.data_pagamento"
  | "fluxo.descricao"
  | "fluxo.valor"
  | "fluxo.parceiro"
  | "fluxo.categoria_financeira"
  | "fluxo.status"
  | "fluxo.tipo"
  | "vendas.data"
  | "vendas.cliente"
  | "vendas.valor_total"
  | "vendas.status"
  | "contas_pagar.descricao"
  | "contas_pagar.fornecedor"
  | "contas_pagar.valor"
  | "contas_pagar.vencimento"
  | "contas_pagar.status"
  | "contas_pagar.data_pagamento"
  | "contas_receber.descricao"
  | "contas_receber.cliente"
  | "contas_receber.valor"
  | "contas_receber.vencimento"
  | "contas_receber.status"
  | "contas_receber.data_confirmacao"
  | "contas_receber.pedido"

type MappingState = Partial<Record<MapTarget, string>>

const SELECT_NONE = "__none__"

const SUGESTOES_CATEGORIA_FINANCEIRA = [
  "Vendas no balcão",
  "Manutenção de Celular",
  "Fornecedores",
  "Aluguel",
  "Internet/Energia",
  "Peças/Estoque",
] as const

const SUGESTAO_CATEGORIA_VENDAS_PADRAO = "Vendas no balcão"

const CLIENTES_TEMPLATE_HEADERS = [
  "Codigo",
  "Tipo de pessoa",
  "Nome",
  "CPF",
  "RG",
  "Data de nascimento",
  "Razão social",
  "Nome fantasia",
  "CNPJ",
  "Inscrição Estadual",
  "Inscrição Municipal",
  "Ativo",
  "Telefone",
  "Celular",
  "E-mail",
  "Cadastrado em",
  "Endereço",
] as const

/** Destino no JSON da API ↔ chave de mapeamento `clientes.*`. */
const CLIENTE_FIELD_TO_MAPTARGET: Partial<Record<(typeof CLIENTES_TEMPLATE_HEADERS)[number], MapTarget>> = {
  Codigo: "clientes.codigo",
  "Tipo de pessoa": "clientes.tipo_pessoa",
  Nome: "clientes.nome",
  CPF: "clientes.doc",
  RG: "clientes.rg",
  "Data de nascimento": "clientes.data_nascimento",
  "Razão social": "clientes.razao_social",
  "Nome fantasia": "clientes.nome_fantasia",
  CNPJ: "clientes.cnpj_empresa",
  "Inscrição Estadual": "clientes.inscricao_estadual",
  "Inscrição Municipal": "clientes.inscricao_municipal",
  Ativo: "clientes.ativo",
  Telefone: "clientes.telefone_fixo",
  Celular: "clientes.telefone",
  "E-mail": "clientes.email",
  "Cadastrado em": "clientes.cadastrado_em",
  Endereço: "clientes.endereco",
}

function downloadClientesTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...CLIENTES_TEMPLATE_HEADERS],
    [
      "GC-0001",
      "Física",
      "Cliente Exemplo",
      "123.456.789-00",
      "12.345.678-9",
      "01/01/1990",
      "",
      "",
      "",
      "",
      "",
      "Sim",
      "(11) 4002-8922",
      "(11) 99999-0000",
      "cliente@exemplo.com",
      "01/04/2026",
      "Rua Exemplo, 123 - Centro - SP",
    ],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "clientes")
  XLSX.writeFile(wb, "modelo-importacao-clientes.xlsx")
}

const PRODUTOS_TEMPLATE_HEADERS = [
  "SKU",
  "Nome",
  "Categoria",
  "Estoque",
  "Preço de Custo",
  "Preço de Venda",
  "Venda por Peso",
  "Preço por Kg",
] as const

function downloadProdutosTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...PRODUTOS_TEMPLATE_HEADERS],
    ["GC-001", "Cabo USB-C", "peca", "10", "5,00", "19,90", "Não", ""],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "produtos")
  XLSX.writeFile(wb, "modelo-importacao-produtos.xlsx")
}

const FIN_FLUXO_TEMPLATE_HEADERS = [
  "Tipo",
  "Descrição",
  "Valor",
  "Data de Pagamento",
  "Data de Vencimento",
  "Cliente/Fornecedor",
  "Plano de contas",
  "Situação",
] as const

function downloadFinanceiroFluxoTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...FIN_FLUXO_TEMPLATE_HEADERS],
    ["Entrada", "Venda balcão", "199,90", "21/04/2026", "", "Consumidor Final", "Vendas no balcão", "Confirmado"],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "fluxo_caixa")
  XLSX.writeFile(wb, "modelo-importacao-financeiro-fluxo.xlsx")
}

const FIN_CONTAS_PAGAR_TEMPLATE_HEADERS = [
  "Descrição",
  "Fornecedor",
  "Valor",
  "Vencimento",
  "Status",
  "Data pagamento",
] as const

function downloadFinanceiroContasPagarTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...FIN_CONTAS_PAGAR_TEMPLATE_HEADERS],
    ["Peças", "Fornecedor Exemplo", "350,00", "30/04/2026", "Pendente", ""],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "contas_pagar")
  XLSX.writeFile(wb, "modelo-importacao-financeiro-contas-pagar.xlsx")
}

const FIN_CONTAS_RECEBER_TEMPLATE_HEADERS = [
  "Descrição",
  "Cliente",
  "Valor",
  "Vencimento",
  "Situação",
  "Data de confirmação",
  "Nº do pedido",
] as const

function downloadFinanceiroContasReceberTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...FIN_CONTAS_RECEBER_TEMPLATE_HEADERS],
    ["Recebimento — João", "João da Silva", "120,00", "28/04/2026", "Pendente", "", "PED-0001"],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "contas_receber")
  XLSX.writeFile(wb, "assistec-pro-modelo-financeiro-contas-receber.xlsx")
}

const VENDAS_TEMPLATE_HEADERS = ["Data", "Cliente/Descrição", "Valor total", "Status"] as const

function downloadVendasTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([[...VENDAS_TEMPLATE_HEADERS], ["21/04/2026", "Venda balcão", "199,90", "Confirmado"]])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "vendas")
  XLSX.writeFile(wb, "modelo-importacao-vendas.xlsx")
}

const OS_TEMPLATE_HEADERS = [
  "Número da O.S.",
  "Nome do cliente",
  "CPF/CNPJ do cliente",
  "Telefone do cliente",
  "Equipamento / aparelho",
  "Defeito",
  "Situação",
  "Valor total",
] as const

function downloadOsTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...OS_TEMPLATE_HEADERS],
    ["OS-1001", "Cliente Exemplo", "123.456.789-00", "(14) 99999-0000", "iPhone 11", "Não liga", "Aberta", "0,00"],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "ordens_servico")
  XLSX.writeFile(wb, "modelo-importacao-ordens-servico.xlsx")
}

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function labelGestaoClickKind(k: GestaoClickFileKind | undefined): string {
  switch (k) {
    case "gestaoclick_produtos":
      return "Produtos (importação inteligente universal)"
    case "gestaoclick_clientes":
      return "Clientes (exportação GestãoClick)"
    case "gestaoclick_vendas":
      return "Vendas (modelo de dados externo) — use a aba Vendas ou Extrato Financeiro"
    default:
      return "Tipo não identificado automaticamente"
  }
}

function toNumberPtBr(raw: unknown): number {
  const s0 = String(raw ?? "").trim()
  if (!s0) return 0
  // Remove "R$", espaços e caracteres não numéricos (mantém dígitos, vírgula, ponto e sinal).
  let s = s0
    .replace(/\s+/g, "")
    .replace(/^r\$\s*/i, "")
    .replace(/[^0-9,.\-]/g, "")
  if (!s) return 0

  const hasComma = s.includes(",")
  const hasDot = s.includes(".")

  if (hasComma && hasDot) {
    // Padrão típico brasileiro: ponto como milhar, vírgula como decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      // Mais raro: vírgula como milhar e ponto como decimal.
      s = s.replace(/,/g, "")
    }
  } else if (hasComma) {
    // Só vírgula: tratar como decimal.
    s = s.replace(",", ".")
  }
  // Só ponto ou apenas dígitos: parseFloat já entende.

  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function isContasReceberPlanoContasHeader(h: string): boolean {
  const n = normHeader(h)
  return (n.includes("plano") && n.includes("conta")) || n.includes("plano de contas")
}

/** Ex.: células exportadas como "25,00" (aspas literais no texto). */
function cellLooksLikeQuotedMoney(raw: unknown): boolean {
  const s = String(raw ?? "")
  return /"[\d]{1,3}(?:\.\d{3})*,\d{2}"|"[\d]+,\d{2}"|"[\d]+"/.test(s)
}

/**
 * Ignora colunas "Plano de contas" e prioriza a coluna cujo conteúdo traz valores monetários entre aspas
 * (título por linha), evitando somar colunas agregadas.
 */
function inferContasReceberValorColumn(headers: string[], rows: Record<string, unknown>[]): string | undefined {
  const eligible = headers.filter((h) => !isContasReceberPlanoContasHeader(h))
  if (eligible.length === 0) return undefined
  const sample = rows.slice(0, Math.min(100, rows.length))
  let bestQuoted: string | undefined
  let maxQuoted = 0
  for (const h of eligible) {
    let q = 0
    for (const r of sample) {
      if (cellLooksLikeQuotedMoney(r[h])) q += 1
    }
    if (q > maxQuoted) {
      maxQuoted = q
      bestQuoted = h
    }
  }
  if (bestQuoted && maxQuoted >= 1) return bestQuoted

  const valorNamed = bestMatch(
    eligible.filter((h) => {
      const n = normHeader(h)
      return n.includes("valor") && !n.includes("plano")
    }),
    ["Valor total", "valor total", "valor", "total"]
  )
  return valorNamed ?? bestMatch(eligible, ["Valor total", "valor total", "valor", "total"])
}

function extractClienteFromDescricaoRecebimento(desc: string): string {
  const s = desc.trim()
  if (!s) return ""
  const parts = s.split(/\s+-\s+/)
  if (parts.length >= 2) return parts.slice(1).join(" - ").trim()
  const dash = s.indexOf("-")
  if (dash >= 0) return s.slice(dash + 1).trim()
  return ""
}

function isCadastradoPorHeader(h: string): boolean {
  return normHeader(h).includes("cadastrado por")
}

/**
 * Valores monetários entre aspas na célula. Se houver vários (parcelas “ocultas” no mesmo texto),
 * devolve todos para desmembrar em títulos separados; senão um único valor parseado.
 */
function parseContasReceberValorCellAll(raw: unknown): number[] {
  const s0 = String(raw ?? "").trim()
  const re = /"([\d]{1,3}(?:\.\d{3})*,\d{2}|[\d]{1,6},\d{2})"/g
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s0)) !== null) {
    const v = toNumberPtBr(m[1])
    if (v > 0) out.push(v)
  }
  if (out.length > 0) return out
  const v = toNumberPtBr(raw)
  return v > 0 ? [v] : []
}

function guessNomeProprioFromRow(row: Record<string, unknown>, headers: string[]): string {
  const skipHeader = (h: string) => {
    const n = normHeader(h)
    if (n.includes("cadastrado por")) return true
    if (n.includes("plano") && n.includes("conta")) return true
    if (
      /(valor|venc|total|descricao|descri|historico|hist|status|situacao|documento|data|email|telefone|celular|cpf|cnpj|obs)/i.test(
        n
      )
    )
      return true
    return false
  }
  for (const h of headers) {
    if (skipHeader(h)) continue
    const s = cellToTrimmedString(row[h] as unknown)
    if (!s || s.length < 3) continue
    if (/^\d/.test(s)) continue
    const parts = s.split(/\s+/).filter((p) => p.length > 0)
    if (parts.length >= 2 && parts.every((p) => /^[A-Za-zÀ-ÿ]/.test(p))) return s
  }
  return ""
}

/** Cliente vem da descrição (após hífen); "Cadastrado por" é vendedor interno e não entra como cliente. */
function resolveClienteContasReceberImport(
  descricao: string,
  row: Record<string, unknown>,
  colC: string | undefined,
  headers: string[]
): string {
  const fromDesc = extractClienteFromDescricaoRecebimento(descricao)
  if (fromDesc) {
    if (isNomeVendedorLojaTratarConsumidorFinal(fromDesc)) return "Consumidor Final"
    return fromDesc
  }
  if (colC && !isCadastradoPorHeader(colC)) {
    const a = cellToTrimmedString(row[colC] as unknown)
    if (a && a !== "—") return a
  }
  const guess = guessNomeProprioFromRow(row, headers)
  if (guess && isNomeVendedorLojaTratarConsumidorFinal(guess)) return "Consumidor Final"
  return guess || "—"
}

function sanitizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
}

function buildClientesItemsFromSheet(sheet: ParsedSheet, mappingOverride?: MappingState): Record<string, unknown>[] {
  const headers = sheet.headers
  const map: MappingState = { ...defaultMappingFor("clientes", headers, sheet), ...(mappingOverride ?? {}) }
  const colNome = pickMappedColumn(map, "clientes.nome", headers, [
    "nome",
    "nome completo",
    "cliente",
    "razao social",
    "razão social",
  ])
  if (!colNome) {
    throw new Error('Mapeie a coluna da planilha que contém o nome do cliente (campo "Nome").')
  }

  const items: Record<string, unknown>[] = []
  for (let i = 0; i < sheet.rows.length; i += 1) {
    const r = sheet.rows[i]!
    const nome = cellToTrimmedString(r[colNome])
    if (!nome) continue

    const obj: Record<string, unknown> = {}
    for (const tpl of CLIENTES_TEMPLATE_HEADERS) {
      const mt = CLIENTE_FIELD_TO_MAPTARGET[tpl]
      const col = mt && map[mt] && headers.includes(String(map[mt])) ? String(map[mt]) : ""
      if (col) {
        const v = cellToTrimmedString(r[col] as unknown as string)
        if (v) obj[tpl] = v
      } else if (tpl in r) {
        obj[tpl] = cellToTrimmedString(r[tpl] as unknown as string)
      }
    }
    obj["Nome"] = nome

    const colTelWa = pickMappedColumn(map, "clientes.telefone", headers, ["celular", "whatsapp", "telefone", "fone", "contato"])
    const colTelFixo = pickMappedColumn(map, "clientes.telefone_fixo", headers, ["telefone fixo"])
    const tel =
      (colTelWa ? cellToTrimmedString(r[colTelWa] as unknown as string) : "") ||
      (colTelFixo ? cellToTrimmedString(r[colTelFixo] as unknown as string) : "") ||
      cellToTrimmedString(r["Telefone/WhatsApp"] as unknown as string) ||
      cellToTrimmedString(r["Celular"] as unknown as string) ||
      cellToTrimmedString(r["Telefone"] as unknown as string)
    if (tel) obj["Telefone/WhatsApp"] = tel

    const colEmail = pickMappedColumn(map, "clientes.email", headers, ["e-mail", "email", "mail"])
    const em =
      (colEmail ? cellToTrimmedString(r[colEmail] as unknown as string) : "") ||
      cellToTrimmedString(r["Email"] as unknown as string) ||
      cellToTrimmedString(r["E-mail"] as unknown as string)
    if (em) obj["Email"] = em

    const colDoc = pickMappedColumn(map, "clientes.doc", headers, ["cpf", "cnpj", "documento", "cpf/cnpj"])
    if (colDoc) {
      const doc = cellToTrimmedString(r[colDoc] as unknown as string)
      if (doc) obj["CPF"] = doc
    }

    items.push(obj)
  }
  return items
}

/** Coluna de categoria: prioriza cabeçalhos literais Categoria, Grupo, Tipo. */
function pickCategoryColumnHeader(headers: string[]): string {
  for (const label of ["Categoria", "Grupo", "Tipo"]) {
    const h = headers.find((x) => normHeader(x) === normHeader(label))
    if (h) return h
  }
  return bestMatch(headers, ["categoria", "grupo", "tipo"]) ?? ""
}

function bestMatch(headers: string[], candidates: string[]): string | undefined {
  const hNorm = headers.map((h) => ({ h, n: normHeader(h) }))
  for (const c of candidates) {
    const cn = normHeader(c)
    const exact = hNorm.find((x) => x.n === cn)
    if (exact) return exact.h
  }
  for (const c of candidates) {
    const cn = normHeader(c)
    const partial = hNorm.find((x) => x.n.includes(cn) || cn.includes(x.n))
    if (partial) return partial.h
  }
  return undefined
}

function matchHeaderBySynonyms(headers: string[], synonyms: string[]): string {
  const hNorm = headers.map((h) => ({ h, n: normHeader(h) }))
  const synNorm = synonyms.map((s) => normHeader(s)).filter(Boolean)
  for (const s of synNorm) {
    const exact = hNorm.find((x) => x.n === s)
    if (exact) return exact.h
  }
  for (const s of synNorm) {
    const partial = hNorm.find((x) => x.n.includes(s) || s.includes(x.n))
    if (partial) return partial.h
  }
  return ""
}

async function parseCsv(file: File): Promise<ParsedSheet> {
  const textSample = await file.slice(0, 64 * 1024).text().catch(() => "")
  const sampleLine = (textSample.split(/\r?\n/)[0] ?? "").slice(0, 8_000)
  const count = (ch: string) => (sampleLine.match(new RegExp(`\\${ch}`, "g")) ?? []).length
  const delimiter =
    count(";") > count(",") && count(";") > count("\t") ? ";" : count("\t") > count(",") ? "\t" : ","

  return await new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: false,
      delimiter,
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean) as string[]
        resolve({
          fileName: file.name,
          headers,
          rows: (result.data ?? []) as Record<string, unknown>[],
          headerRowIndex: 0,
        })
      },
      error: (err) => reject(err),
    })
  })
}

/** Garante grade 2D para importação; registra formatos inesperados do XLSX no console. */
function normalizeXlsxGridRaw(raw: unknown, fileLabel: string): unknown[][] {
  if (!Array.isArray(raw)) {
    console.warn(`[import] ${fileLabel}: sheet_to_json(header:1) não retornou array:`, raw)
    return []
  }
  return raw.map((row, rowIndex) => {
    if (Array.isArray(row)) return row
    console.warn(`[import] ${fileLabel}: linha da grade não é array:`, { rowIndex, row })
    return []
  })
}

/** Garante array de linhas objeto; registra null/objeto solto para depuração. */
function normalizeSheetRows(raw: unknown, fileLabel: string): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (raw == null) {
    console.warn(`[import] ${fileLabel}: rows é null ou undefined`)
    return []
  }
  if (typeof raw === "object") {
    console.warn(`[import] ${fileLabel}: rows veio como objeto não-array:`, raw)
    const vals = Object.values(raw as Record<string, unknown>)
    return vals.filter((v) => v != null && typeof v === "object" && !Array.isArray(v)) as Record<string, unknown>[]
  }
  console.warn(`[import] ${fileLabel}: rows em formato inesperado:`, raw)
  return []
}

/** Reconstrói headers + rows a partir da grade (mesma lógica do parseXlsx). */
function buildRowsFromGrid(grid: unknown[][], headerIndex: number): { headers: string[]; rows: Record<string, unknown>[] } {
  const headerRow = headerIndex >= 0 && Array.isArray(grid[headerIndex]) ? (grid[headerIndex] as unknown[]) : []
  const headers = headerRow.map((x) => String(x ?? "").trim()).filter((h) => h !== "")
  const rows: Record<string, unknown>[] = []
  for (let r = Math.max(0, headerIndex + 1); r < grid.length; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    const hasAnyCell = row.some((v) => String(v ?? "").trim() !== "")
    if (!hasAnyCell) continue
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]!] = row[c]
    }
    const hasAny = Object.values(obj).some((v) => String(v ?? "").trim() !== "")
    if (hasAny) rows.push(obj)
  }
  const outHeaders = headers.length === 0 && rows.length > 0 ? Object.keys(rows[0]!) : headers
  return { headers: outHeaders, rows }
}

function pickMappedColumn(
  map: MappingState,
  key: MapTarget,
  headers: string[],
  fallbacks: string[]
): string {
  const m = map[key]
  if (m && String(m).trim() !== "" && headers.includes(m)) return m
  return bestMatch(headers, fallbacks) ?? ""
}

/** Cabeçalhos parecem coluna de preço (para desempate quando nomes são genéricos). */
function headerLooksPriceRelated(h: string): boolean {
  const n = normHeader(h)
  return (
    n.includes("preco") ||
    n.includes("valor") ||
    n.includes("vlr") ||
    n.includes("custo") ||
    n.includes("venda") ||
    n.includes("compra") ||
    n.includes("varejo") ||
    n.includes("fornecedor")
  )
}

/**
 * Resolve colunas de Preço de Custo vs Preço de Venda sem inverter:
 * REGRA LITERAL (Excel de backup do usuário):
 * - Coluna exatamente "Valor Varejo" = PREÇO DE VENDA (price)
 * - Coluna exatamente "Comprime" = PREÇO DE CUSTO (cost)
 * - Se não achar por nome, usa grade: Z = venda, K = custo
 */
function resolveCustoVendaColumns(
  headers: string[],
  rows: Record<string, unknown>[],
  startRow: number,
  colNome: string,
  map: MappingState,
  /** Colunas já usadas (SKU etc.) para não confundir com preço. */
  otherMappedColumns: string[] = []
): { colCusto: string; colVenda: string } {
  const CUSTO_CANDIDATES = [
    "preco de custo",
    "preço de custo",
    "preco custo",
    "p custo",
    "valor custo",
    "valor de custo",
    "vlr custo",
    "vlr_custo",
    "custo",
    "custo unitario",
    "custo unitário",
    "preco compra",
    "preço compra",
    "valor compra",
    "valor fornecedor",
    "preco fornecedor",
    "custo fornecedor",
    "compra",
    "preco_custo",
  ]
  const VENDA_CANDIDATES = [
    "valor varejo",
    "valor de varejo",
    "preço varejo",
    "preco varejo",
    "preço de varejo",
    "preco de varejo",
    "vlr venda",
    "vlr_venda",
    "valor venda",
    "valor de venda",
    "preco de venda",
    "preço de venda",
    "preco venda",
    "p venda",
    "preco_venda",
    "venda",
    "valor total venda",
    "preco de venda rs",
    "varejo",
  ]

  void rows
  void startRow
  const skipCols = new Set([colNome, ...otherMappedColumns].filter(Boolean))

  // Preferência: seleção manual -> exato -> sinônimos
  const mappedVenda =
    map["produtos.preco_venda"] && headers.includes(String(map["produtos.preco_venda"]))
      ? String(map["produtos.preco_venda"])
      : ""
  const mappedCusto =
    map["produtos.preco_custo"] && headers.includes(String(map["produtos.preco_custo"]))
      ? String(map["produtos.preco_custo"])
      : ""

  const headersCandidate = headers.filter((h) => !skipCols.has(h))
  const colVenda =
    mappedVenda ||
    headersCandidate.find((h) => String(h).trim() === "Valor Varejo") ||
    matchHeaderBySynonyms(headersCandidate, VENDA_CANDIDATES) ||
    ""
  const colCusto =
    mappedCusto ||
    headersCandidate.find((h) => String(h).trim() === "Comprime") ||
    matchHeaderBySynonyms(headersCandidate, CUSTO_CANDIDATES) ||
    ""

  return { colCusto, colVenda }
}

/**
 * Monta itens de estoque a partir de cabeçalhos detectados (planilha compatível ou exportação larga).
 * Usado na importação inteligente universal, que antes enviava só `grid` à API.
 */
function buildProdutosItemsFromSheetFlexible(sheet: ParsedSheet, mappingOverride?: MappingState): Array<{
  id: string
  name: string
  stock: number
  cost: number
  price: number
  category: string
}> {
  let rows = normalizeSheetRows(sheet.rows, sheet.fileName)
  let headers = sheet.headers

  if (rows.length === 0 && sheet.grid && sheet.grid.length > 0 && sheet.headerRowIndex != null && sheet.headerRowIndex >= 0) {
    const built = buildRowsFromGrid(sheet.grid, sheet.headerRowIndex)
    rows = built.rows
    headers = built.headers.length > 0 ? built.headers : sheet.headers
    if (rows.length > 0) {
      console.warn(
        `[import] ${sheet.fileName}: rows estava vazio; reconstruído da grade (${rows.length} linha(s)).`
      )
    }
  }

  if (headers.length === 0 && rows.length > 0) {
    headers = Object.keys(rows[0]!)
  }

  const map: MappingState = { ...defaultMappingFor("produtos", headers), ...(mappingOverride ?? {}) }
  const colNome = pickMappedColumn(map, "produtos.nome", headers, [
    "nome",
    "produto",
    "descricao",
    "descrição",
    "descrição do produto",
  ])
  if (!colNome) {
    throw new Error(
      'Não foi possível detectar a coluna "Nome" do produto. Use o modelo de planilha sugerido ou confira os cabeçalhos.'
    )
  }

  const colSku = pickMappedColumn(map, "produtos.sku", headers, [
    "sku",
    "codigo",
    "código",
    "cod",
    "referencia",
    "referência",
    "ean",
    "gtin",
  ])
  const colEstoque = pickMappedColumn(map, "produtos.estoque", headers, [
    "estoque",
    "quantidade",
    "saldo",
    "estoque atual",
  ])
  // Categoria: permitir seleção manual (Categoria/Grupo) e manter autodetecção como fallback.
  const colCategoriaManual = pickMappedColumn(map, "produtos.categoria", headers, ["categoria", "grupo", "tipo"])
  const colCategoria = colCategoriaManual || pickCategoryColumnHeader(headers)

  const items: Array<{
    id: string
    name: string
    stock: number
    cost: number
    price: number
    category: string
  }> = []
  const seen = new Set<string>()
  const totalRows = rows.length
  let startRow = totalRows
  for (let ri = 0; ri < totalRows; ri += 1) {
    const nm = String(rows[ri]![colNome] ?? "").trim()
    if (!shouldSkipInventoryImportName(nm)) {
      startRow = ri
      break
    }
  }

  const { colCusto, colVenda } = resolveCustoVendaColumns(headers, rows, startRow, colNome, map, [
    colSku,
    colEstoque,
    colCategoria,
  ])

  // Fallback literal por coluna (grade): K = custo (11ª coluna), Z = venda (26ª coluna)
  // Índices 0-based: K=10, Z=25
  const grid = sheet.grid ? normalizeXlsxGridRaw(sheet.grid, sheet.fileName) : []
  const useGridFallback = (!colCusto || !colVenda) && grid.length > 0
  const colK = 10
  const colZ = 25
  if (useGridFallback) {
    console.warn("[import] Fallback por coluna K/Z ativado (não encontrei cabeçalhos exatos).", {
      fileName: sheet.fileName,
      colCusto,
      colVenda,
      headers,
    })
  }

  for (let i = startRow; i < totalRows; i += 1) {
    const r = rows[i]!
    const name = String(r[colNome] ?? "").trim()
    if (shouldSkipInventoryImportName(name)) continue
    const skuRaw = colSku ? String(r[colSku] ?? "").trim() : ""
    const base = sanitizeId(skuRaw || name)
    let id = base ? `gc-${base}` : `gc-item-${i + 1}`
    if (seen.has(id)) id = `${id}-${i + 1}`
    seen.add(id)

    let price = colVenda ? toNumberPtBr(r[colVenda]) : 0
    let cost = colCusto ? toNumberPtBr(r[colCusto]) : 0

    if (useGridFallback) {
      // tenta ler da linha do grid correspondente (headerIndex+1+i)
      const headerIndex = sheet.headerRowIndex ?? 0
      const gridRowIndex = Math.max(0, headerIndex + 1 + i)
      const rowArr = Array.isArray(grid[gridRowIndex]) ? (grid[gridRowIndex] as unknown[]) : undefined
      if (rowArr) {
        if (!colVenda) price = toNumberPtBr(rowArr[colZ])
        if (!colCusto) cost = toNumberPtBr(rowArr[colK])
      }
    }

    // Regra literal: não deixar custo zerado se existe valor na coluna de custo.
    if (cost <= 0 && colCusto) {
      const raw = r[colCusto]
      const parsed = toNumberPtBr(raw)
      if (parsed > 0) cost = parsed
    }

    // Categoria preferencial: colunas literais GestãoClick "Categoria" ou "Grupo".
    const catFromExact = String(
      (r["Categoria"] as unknown as string) ??
        (r["categoria"] as unknown as string) ??
        (r["Grupo"] as unknown as string) ??
        (r["grupo"] as unknown as string) ??
        ""
    ).trim()
    const catRaw =
      catFromExact || (colCategoria ? String(r[colCategoria] ?? "").trim() : "")
    items.push({
      id,
      name,
      cost,
      price,
      stock: Math.max(0, Math.floor(colEstoque ? toNumberPtBr(r[colEstoque]) : 0)),
      // Não aplicar fallback aqui; deixar vazio se não houver categoria mapeada.
      // O fallback para "peca" acontece apenas na API, ao persistir no banco.
      category: catRaw,
    })
  }

  return items
}

async function parseXlsx(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const first = wb.SheetNames[0]
  const sheet = first ? wb.Sheets[first] : undefined
  if (!sheet) return { fileName: file.name, headers: [], rows: [], grid: [], headerRowIndex: -1 }

  const rawGrid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
  const grid = normalizeXlsxGridRaw(rawGrid, file.name)
  // Alguns XLSX vêm com linhas vazias antes do cabeçalho. Encontra a 1ª linha com pelo menos 1 célula preenchida.
  const headerIndex = grid.findIndex((row) => Array.isArray(row) && row.some((v) => String(v ?? "").trim() !== ""))
  const headerRow = headerIndex >= 0 && Array.isArray(grid[headerIndex]) ? (grid[headerIndex] as unknown[]) : []
  const headers = headerRow
    .map((x) => String(x ?? "").trim())
    .filter((h) => h !== "")

  const rows: Record<string, unknown>[] = []
  for (let r = Math.max(0, headerIndex + 1); r < grid.length; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    // Ignora linha completamente vazia (Excel às vezes inclui linhas “fantasma”)
    const hasAnyCell = row.some((v) => String(v ?? "").trim() !== "")
    if (!hasAnyCell) continue
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]!] = row[c]
    }
    const hasAny = Object.values(obj).some((v) => String(v ?? "").trim() !== "")
    if (hasAny) rows.push(obj)
  }

  // Fallback: se não detectou headers, tenta inferir do 1º objeto ao invés de ficar sem opções no Select.
  if (headers.length === 0 && rows.length > 0) {
    return {
      fileName: file.name,
      headers: Object.keys(rows[0]!),
      rows,
      grid,
      headerRowIndex: headerIndex,
    }
  }
  return { fileName: file.name, headers, rows, grid, headerRowIndex: headerIndex }
}

async function parseFileUniversal(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return await parseCsv(file)
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return await parseXlsx(file)
  throw new Error("Formato não suportado. Envie .csv ou .xlsx.")
}

function defaultMappingFor(kind: ImportKind, headers: string[], sheet?: ParsedSheet): MappingState {
  const map: MappingState = {}

  if (kind === "clientes") {
    map["clientes.codigo"] = bestMatch(headers, ["codigo", "código", "cod", "codigo do cliente"]) ?? ""
    map["clientes.tipo_pessoa"] = bestMatch(headers, ["tipo de pessoa", "tipo pessoa", "pessoa"]) ?? ""
    map["clientes.nome"] =
      bestMatch(headers, [
        "nome",
        "nome completo",
        "nome do cliente",
        "cliente",
        "razao social",
        "razão social",
        "nome cliente",
        "nome/razao",
        "nome fantasia",
        "fantasia",
      ]) ?? ""
    map["clientes.doc"] =
      bestMatch(headers, [
        "cpf",
        "cnpj",
        "cpf/cnpj",
        "documento",
        "doc",
        "cpf ou cnpj",
        "documento fiscal",
      ]) ?? ""
    map["clientes.rg"] = bestMatch(headers, ["rg", "ie", "rg/ie"]) ?? ""
    map["clientes.data_nascimento"] = bestMatch(headers, ["data de nascimento", "nascimento", "dt nascimento"]) ?? ""
    map["clientes.razao_social"] = bestMatch(headers, ["razao social", "razão social"]) ?? ""
    map["clientes.nome_fantasia"] = bestMatch(headers, ["nome fantasia", "fantasia"]) ?? ""
    map["clientes.cnpj_empresa"] = bestMatch(headers, ["cnpj (empresa)", "cnpj empresa", "cnpj"]) ?? ""
    map["clientes.inscricao_estadual"] = bestMatch(headers, ["inscricao estadual", "inscrição estadual", "ie"]) ?? ""
    map["clientes.inscricao_municipal"] = bestMatch(headers, ["inscricao municipal", "inscrição municipal", "im"]) ?? ""
    map["clientes.ativo"] = bestMatch(headers, ["ativo", "status", "status ativo"]) ?? ""
    map["clientes.telefone_fixo"] = bestMatch(headers, ["telefone fixo", "telefone", "fone", "tel"]) ?? ""
    map["clientes.telefone"] =
      bestMatch(headers, [
        "celular",
        "telefone celular",
        "fone",
        "whatsapp",
        "contato",
        "tel",
      ]) ?? ""
    map["clientes.email"] = bestMatch(headers, ["email", "e-mail", "e mail", "mail"]) ?? ""
    map["clientes.endereco"] =
      bestMatch(headers, [
        "endereco",
        "endereço",
        "logradouro",
        "rua",
        "bairro",
        "cidade",
        "endereco completo",
        "localizacao",
        "localização",
      ]) ?? ""
    map["clientes.cadastrado_em"] = bestMatch(headers, ["cadastrado em", "data de cadastro", "cadastro em"]) ?? ""
  }

  if (kind === "produtos") {
    map["produtos.nome"] = bestMatch(headers, ["nome", "produto", "descricao", "descrição"]) ?? ""
    map["produtos.sku"] = bestMatch(headers, ["sku", "codigo", "código", "cod", "referencia", "referência", "ean", "gtin"]) ?? ""
    map["produtos.categoria"] = bestMatch(headers, ["categoria", "grupo", "tipo"]) ?? ""
    map["produtos.preco_custo"] =
      bestMatch(headers, [
        "preco de custo",
        "preço de custo",
        "preco compra",
        "preço compra",
        "valor compra",
        "valor_custo",
        "valor custo",
        "custo",
        "preco custo",
        "preco_custo",
        "valor fornecedor",
        "preco fornecedor",
        "custo fornecedor",
      ]) ?? ""
    map["produtos.preco_venda"] =
      bestMatch(headers, [
        "valor varejo",
        "valor de varejo",
        "preço varejo",
        "preco varejo",
        "preco de venda",
        "preço de venda",
        "preco venda",
        "vlr venda",
        "preco_venda",
        "venda",
        "valor de venda",
      ]) ?? ""
    map["produtos.estoque"] = bestMatch(headers, ["estoque", "quantidade", "saldo", "estoque atual"]) ?? ""
  }

  if (kind === "ordens_servico") {
    map["ordens.numero"] =
      bestMatch(headers, ["numero", "número", "os", "ordem", "ordem servico", "ordem de servico", "n os"]) ?? ""
    map["ordens.cliente_nome"] = bestMatch(headers, ["nome cliente", "cliente", "nome", "razao social"]) ?? ""
    map["ordens.doc_cliente"] = bestMatch(headers, ["cpf", "cnpj", "cpf/cnpj", "documento cliente", "cliente cpf"]) ?? ""
    map["ordens.telefone"] = bestMatch(headers, ["telefone", "celular", "whatsapp", "fone"]) ?? ""
    map["ordens.equipamento"] =
      bestMatch(headers, ["equipamento", "aparelho", "produto", "marca modelo", "modelo", "descricao equipamento"]) ?? ""
    map["ordens.defeito"] = bestMatch(headers, ["defeito", "problema", "relato", "observacao defeito"]) ?? ""
    map["ordens.situacao"] = bestMatch(headers, ["situacao", "situação", "status", "estado"]) ?? ""
    map["ordens.valor_total"] =
      bestMatch(headers, ["valor total", "total", "valor os", "valor da os", "total geral"]) ?? ""
  }

  if (kind === "fluxo_caixa") {
    map["fluxo.descricao"] =
      bestMatch(headers, ["Descrição do recebimento", "Descrição do pagamento", "descricao", "descrição", "historico", "histórico", "detalhe"]) ?? ""
    map["fluxo.status"] = bestMatch(headers, ["Situação", "situacao", "situação", "status"]) ?? ""
    map["fluxo.categoria_financeira"] =
      bestMatch(headers, ["Plano de contas", "plano de contas", "categoria", "categoria financeira", "grupo", "centro de custo"]) ?? ""
    map["fluxo.parceiro"] =
      bestMatch(headers, ["Entidade Nome", "entidade nome", "cliente", "fornecedor", "favorecido", "credor", "devedor", "sacado", "nome"]) ?? ""
    map["fluxo.valor"] =
      bestMatch(headers, ["Valor total", "valor total", "valor", "total", "valor pago", "valor liquido", "valor líquido", "saldo"]) ?? ""
    map["fluxo.data_vencimento"] =
      bestMatch(headers, ["Data do vencimento", "data do vencimento", "vencimento", "data vencimento", "data de vencimento", "venc"]) ?? ""
    map["fluxo.data_pagamento"] =
      bestMatch(headers, ["Data de confirmação", "data de confirmação", "confirmacao", "confirmação", "pagamento", "data pagamento", "data de pagamento", "pago em", "baixado em"]) ?? ""
    map["fluxo.tipo"] =
      bestMatch(headers, ["tipo", "entrada/saida", "entrada", "saida", "saída", "credito", "crédito", "debito", "débito"]) ?? ""
  }

  if (kind === "vendas") {
    map["vendas.data"] =
      bestMatch(headers, [
        "data do vencimento",
        "data de confirmação",
        "data",
        "data emissao",
        "data emissão",
        "emissao",
        "emissão",
        "data da venda",
        "data venda",
        "data emissão do documento",
        "criado em",
      ]) ?? ""
    map["vendas.cliente"] =
      bestMatch(headers, [
        "descrição do recebimento",
        "descricao do recebimento",
        "descrição do pagamento",
        "descricao do pagamento",
        "cliente",
        "nome cliente",
        "razao social",
        "razão social",
        "nome",
        "destinatario",
        "documento",
        "identificador",
        "nº venda",
        "numero venda",
        "num venda",
        "descricao",
        "descrição",
        "historico",
        "histórico",
      ]) ?? ""
    map["vendas.valor_total"] =
      bestMatch(headers, [
        "valor total",
        "valor total",
        "total",
        "valor",
        "total venda",
        "valor liquido",
        "valor líquido",
        "valor pago",
        "pago",
        "saldo",
      ]) ?? ""
    map["vendas.status"] =
      bestMatch(headers, ["situação", "situacao", "status", "situacao da venda", "status da venda"]) ?? ""
  }

  if (kind === "contas_pagar") {
    map["contas_pagar.descricao"] =
      bestMatch(headers, [
        "descricao",
        "descrição",
        "historico",
        "histórico",
        "detalhe",
        "documento",
        "nº venda",
        "numero venda",
        "num venda",
      ]) ?? ""
    map["contas_pagar.fornecedor"] =
      bestMatch(headers, ["fornecedor", "credor", "favorecido", "nome", "cliente fornecedor"]) ?? ""
    map["contas_pagar.valor"] =
      bestMatch(headers, [
        "valor",
        "valor total",
        "valor titulo",
        "valor título",
        "valor a pagar",
        "valor liquido",
        "valor líquido",
        "valor pago",
        "pago",
        "saldo",
      ]) ?? ""
    map["contas_pagar.vencimento"] =
      bestMatch(headers, ["vencimento", "data vencimento", "venc", "data de vencimento", "data venc"]) ?? ""
    map["contas_pagar.status"] = bestMatch(headers, ["status", "situacao", "situação", "pago"]) ?? ""
    map["contas_pagar.data_pagamento"] =
      bestMatch(headers, ["data pagamento", "data de pagamento", "pagamento", "pago em", "dt pagamento"]) ?? ""
  }

  if (kind === "contas_receber") {
    map["contas_receber.descricao"] =
      bestMatch(headers, [
        "Descrição do recebimento",
        "descrição do recebimento",
        "descrição do pagamento",
        "descricao",
        "descrição",
        "historico",
        "histórico",
        "documento",
      ]) ?? ""
    map["contas_receber.cliente"] =
      bestMatch(
        headers.filter((h) => !isCadastradoPorHeader(h)),
        ["cliente", "nome", "devedor", "sacado"]
      ) ?? ""
    map["contas_receber.valor"] =
      bestMatch(
        headers.filter((h) => !isContasReceberPlanoContasHeader(h)),
        [
          "Valor total",
          "valor total",
          "valor a receber",
          "valor titulo",
          "valor título",
          "valor",
          "valor liquido",
          "valor líquido",
          "valor pago",
          "pago",
          "saldo",
        ]
      ) ?? ""
    map["contas_receber.vencimento"] =
      bestMatch(headers, ["vencimento", "data vencimento", "venc", "data de vencimento", "data venc"]) ?? ""
    map["contas_receber.status"] = bestMatch(headers, ["Situação", "situacao", "situação", "status"]) ?? ""
    map["contas_receber.data_confirmacao"] =
      bestMatch(headers, [
        "Data de confirmação",
        "data de confirmação",
        "Data de confirmacao",
        "data de confirmacao",
        "Data confirmação",
        "data confirmação",
        "Confirmado em",
        "confirmado em",
        "Data pagamento",
        "data pagamento",
      ]) ?? ""
    map["contas_receber.pedido"] =
      bestMatch(headers, [
        "Nº do pedido",
        "nº do pedido",
        "Numero do pedido",
        "numero do pedido",
        "Pedido",
        "pedido",
        "ID pedido",
      ]) ?? ""
    if (sheet?.rows?.length) {
      const inferred = inferContasReceberValorColumn(headers, sheet.rows)
      if (inferred) map["contas_receber.valor"] = inferred
    }
  }

  return map
}

function buildOrdemPayloadFromRow(
  row: Record<string, unknown>,
  mapping: MappingState,
  index: number
): Record<string, unknown> {
  const colNum = mapping["ordens.numero"]
  const colNome = mapping["ordens.cliente_nome"]
  const colDoc = mapping["ordens.doc_cliente"]
  const colTel = mapping["ordens.telefone"]
  const colEquip = mapping["ordens.equipamento"]
  const colDefeito = mapping["ordens.defeito"]
  const colSit = mapping["ordens.situacao"]
  const colVal = mapping["ordens.valor_total"]

  const numRaw = colNum ? String(row[colNum] ?? "").trim() : ""
  const numero = numRaw
    ? numRaw.toUpperCase().startsWith("OS")
      ? numRaw
      : `OS-${numRaw.replace(/^os-?/i, "").trim()}`
    : `OS-IMP-${index + 1}`

  const nome = colNome ? String(row[colNome] ?? "").trim() : ""
  const docRaw = colDoc ? String(row[colDoc] ?? "").trim() : ""
  const tel = colTel ? String(row[colTel] ?? "").trim() : ""
  const equipamento = colEquip ? String(row[colEquip] ?? "").trim() : ""
  const defeito = colDefeito ? String(row[colDefeito] ?? "").trim() : ""
  const situacaoRaw = colSit ? String(row[colSit] ?? "").trim() : ""
  const valorTotal = colVal ? toNumberPtBr(row[colVal]) : 0

  const today = new Date().toISOString().slice(0, 10)
  return {
    id: `imp-${sanitizeId(numero)}-${index}`,
    numero,
    cliente: {
      nome: nome || "Cliente",
      telefone: tel,
      cpf: docRaw,
    },
    aparelho: { marca: "", modelo: equipamento || "—", imei: "", cor: "" },
    checklist: defaultChecklist.map((x) => ({ ...x })),
    defeito,
    solucao: "",
    status: mapGestaoClickSituacaoOs(situacaoRaw),
    dataEntrada: today,
    horaEntrada: horaAtualHHMM(),
    dataPrevisao: today,
    dataSaida: null,
    horaSaida: null,
    valorServico: valorTotal > 0 ? valorTotal : 0,
    valorPecas: 0,
    fotos: [],
    observacoes: "",
    termoGarantia: "",
    textoGarantiaEditado: "",
  }
}

type ImportUiTab = "clientes" | "produtos" | "financeiro" | "vendas"

function targetKeyForSheetColumn(
  header: string,
  defaultMap: MappingState,
  allowedKeys: MapTarget[]
): MapTarget | typeof SELECT_NONE {
  for (const k of allowedKeys) {
    if (defaultMap[k] === header) return k
  }
  return SELECT_NONE
}

function currentTargetForColumn(header: string, mapping: MappingState, allowedKeys: MapTarget[]): MapTarget | typeof SELECT_NONE {
  for (const k of allowedKeys) {
    if (mapping[k] === header) return k
  }
  return SELECT_NONE
}

function applyColumnTarget(
  prev: MappingState,
  header: string,
  newTarget: MapTarget | typeof SELECT_NONE,
  allowedKeys: MapTarget[]
): MappingState {
  const next = { ...prev }
  for (const k of allowedKeys) {
    if (next[k] === header) next[k] = ""
  }
  if (newTarget !== SELECT_NONE) {
    next[newTarget] = header
  }
  return next
}

export function ImportadorDadosExternos() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const importRunRef = useRef(false)
  const { lojaAtivaId } = useLojaAtiva()
  /** Escrita na API exige unidade explícita — sem fallback legado no header. */
  const storeHeaderParaEscrita = useMemo(() => (lojaAtivaId ?? "").trim(), [lojaAtivaId])
  const temLojaObrigatoria = storeHeaderParaEscrita.length > 0
  const { setContasPagar, movimentos, setMovimentos, carteiras } = useFinanceiro()

  const [uiTab, setUiTab] = useState<ImportUiTab>("clientes")
  const [financeSub, setFinanceSub] = useState<"fluxo_caixa" | "contas_pagar" | "contas_receber">("fluxo_caixa")
  const [vendasSub, setVendasSub] = useState<"vendas" | "ordens_servico">("vendas")
  const [selectedFileName, setSelectedFileName] = useState<string>("")
  const [isDragActive, setIsDragActive] = useState(false)

  const kind: ImportKind = useMemo(() => {
    if (uiTab === "clientes") return "clientes"
    if (uiTab === "produtos") return "produtos"
    if (uiTab === "financeiro") return financeSub
    return vendasSub
  }, [uiTab, financeSub, vendasSub])

  const downloadTemplate = useMemo(() => {
    if (kind === "clientes") {
      return { label: "Baixar modelo (Clientes)", run: downloadClientesTemplateXlsx }
    }
    if (kind === "produtos") {
      return { label: "Baixar modelo (Produtos)", run: downloadProdutosTemplateXlsx }
    }
    if (kind === "fluxo_caixa") {
      return { label: "Baixar modelo (Financeiro · Extrato)", run: downloadFinanceiroFluxoTemplateXlsx }
    }
    if (kind === "contas_pagar") {
      return { label: "Baixar modelo (Financeiro · Contas a pagar / Fornecedores)", run: downloadFinanceiroContasPagarTemplateXlsx }
    }
    if (kind === "contas_receber") {
      return { label: "Baixar modelo (Financeiro · Contas a receber)", run: downloadFinanceiroContasReceberTemplateXlsx }
    }
    if (kind === "vendas") {
      return { label: "Baixar modelo (Vendas)", run: downloadVendasTemplateXlsx }
    }
    return { label: "Baixar modelo (Ordens de serviço)", run: downloadOsTemplateXlsx }
  }, [kind])
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<MappingState>({})
  const [fluxoCategoriaDefault, setFluxoCategoriaDefault] = useState<string>("")

  const [importLog, setImportLog] = useState<string>("")
  const [validationErrors, setValidationErrors] = useState<Array<{ line: number; message: string }>>([])
  const [isImporting, setIsImporting] = useState(false)
  const [progressNow, setProgressNow] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressLabel, setProgressLabel] = useState("")

  const [counts, setCounts] = useState<Record<ImportKind, number>>({
    clientes: 0,
    produtos: 0,
    ordens_servico: 0,
    fluxo_caixa: 0,
    vendas: 0,
    contas_pagar: 0,
    contas_receber: 0,
  })

  const expectedFields = useMemo(() => {
    const isHistVendas = sheet?.detectedKind === "gestaoclick_vendas"

    if (kind === "clientes") {
      return [
        { key: "clientes.codigo" as const, label: "Código" },
        { key: "clientes.tipo_pessoa" as const, label: "Tipo de Pessoa" },
        { key: "clientes.nome" as const, label: "Nome" },
        { key: "clientes.doc" as const, label: "CPF/CNPJ" },
        { key: "clientes.rg" as const, label: "RG/IE" },
        { key: "clientes.data_nascimento" as const, label: "Data de Nascimento" },
        { key: "clientes.razao_social" as const, label: "Razão Social" },
        { key: "clientes.nome_fantasia" as const, label: "Nome Fantasia" },
        { key: "clientes.cnpj_empresa" as const, label: "CNPJ Empresa" },
        { key: "clientes.inscricao_estadual" as const, label: "Inscrição Estadual" },
        { key: "clientes.inscricao_municipal" as const, label: "Inscrição Municipal" },
        { key: "clientes.ativo" as const, label: "Status Ativo" },
        { key: "clientes.telefone_fixo" as const, label: "Telefone Fixo" },
        { key: "clientes.telefone" as const, label: "Telefone/WhatsApp" },
        { key: "clientes.email" as const, label: "E-mail" },
        { key: "clientes.endereco" as const, label: "Endereço" },
        { key: "clientes.cadastrado_em" as const, label: "Data de Cadastro" },
      ]
    }
    if (kind === "produtos") {
      return [
        { key: "produtos.nome" as const, label: "Nome do Produto" },
        { key: "produtos.sku" as const, label: "SKU/Código" },
        { key: "produtos.categoria" as const, label: "Categoria/Grupo" },
        { key: "produtos.preco_custo" as const, label: "Preço de Custo" },
        { key: "produtos.preco_venda" as const, label: "Preço de Venda" },
        { key: "produtos.estoque" as const, label: "Estoque" },
      ]
    }
    if (kind === "ordens_servico") {
      return [
        { key: "ordens.numero" as const, label: "Número da O.S." },
        { key: "ordens.cliente_nome" as const, label: "Nome do cliente" },
        { key: "ordens.doc_cliente" as const, label: "CPF/CNPJ do cliente" },
        { key: "ordens.telefone" as const, label: "Telefone do cliente" },
        { key: "ordens.equipamento" as const, label: "Equipamento / aparelho" },
        { key: "ordens.defeito" as const, label: "Defeito" },
        { key: "ordens.situacao" as const, label: "Situação" },
        { key: "ordens.valor_total" as const, label: "Valor total" },
      ]
    }
    if (kind === "fluxo_caixa") {
      return [
        { key: "fluxo.tipo" as const, label: "Tipo (Entrada/Saída)" },
        { key: "fluxo.descricao" as const, label: "Descrição/Histórico" },
        { key: "fluxo.valor" as const, label: "Valor (R$)" },
        { key: "fluxo.data_pagamento" as const, label: "Data de Pagamento" },
        { key: "fluxo.data_vencimento" as const, label: "Data de Vencimento" },
        { key: "fluxo.parceiro" as const, label: "Cliente/Fornecedor" },
        { key: "fluxo.categoria_financeira" as const, label: "Categoria Financeira" },
        { key: "fluxo.status" as const, label: "Status" },
      ]
    }
    if (kind === "vendas") {
      return [
        {
          key: "vendas.data" as const,
          label: isHistVendas ? "Data da venda" : "Data",
        },
        {
          key: "vendas.cliente" as const,
          label: isHistVendas ? "Coluna de Cliente / Descrição" : "Cliente",
        },
        {
          key: "vendas.valor_total" as const,
          label: isHistVendas ? "Valor da venda" : "Valor total",
        },
        {
          key: "vendas.status" as const,
          label: isHistVendas ? "Status da venda" : "Status",
        },
      ]
    }
    if (kind === "contas_pagar") {
      return [
        { key: "contas_pagar.descricao" as const, label: "Descrição" },
        { key: "contas_pagar.fornecedor" as const, label: "Fornecedor" },
        { key: "contas_pagar.valor" as const, label: "Valor" },
        { key: "contas_pagar.vencimento" as const, label: "Vencimento" },
        { key: "contas_pagar.data_pagamento" as const, label: "Data de pagamento (blindagem)" },
        { key: "contas_pagar.status" as const, label: "Status" },
      ]
    }
    return [
      { key: "contas_receber.descricao" as const, label: "Descrição" },
      { key: "contas_receber.cliente" as const, label: "Cliente (fallback se descrição sem hífen)" },
      { key: "contas_receber.valor" as const, label: "Valor" },
      { key: "contas_receber.vencimento" as const, label: "Vencimento" },
      { key: "contas_receber.status" as const, label: "Situação" },
      { key: "contas_receber.data_confirmacao" as const, label: "Data de confirmação (prioridade pago)" },
      { key: "contas_receber.pedido" as const, label: "Nº do pedido (cruzamento com pagamentos)" },
    ]
  }, [kind, sheet])

  const defaultMappingSnapshot = useMemo(
    () => (sheet ? defaultMappingFor(kind, sheet.headers, sheet) : ({} as MappingState)),
    [kind, sheet]
  )

  const allowedMapTargets = useMemo(() => expectedFields.map((f) => f.key), [expectedFields])

  const canImport = useMemo(() => {
    if (!sheet) return false
    if (!temLojaObrigatoria) return false
    if (kind === "clientes") {
      const colNome = mapping["clientes.nome"] && String(mapping["clientes.nome"]).trim()
      return Boolean(colNome && sheet.rows.length > 0)
    }
    if (kind === "produtos") {
      const colNomeMap = mapping["produtos.nome"] && String(mapping["produtos.nome"]).trim()
      const hasNomeHeader = sheet.headers.some((h) => normHeader(h) === normHeader("Nome"))
      const gcGrid = Boolean(sheet.grid && sheet.grid.length > 0)
      return Boolean(
        (colNomeMap && sheet.headers.includes(colNomeMap)) || hasNomeHeader || gcGrid
      )
    }
    if (kind === "ordens_servico") {
      if (sheet.rows.length === 0) return false
      const n = mapping["ordens.numero"] && String(mapping["ordens.numero"]).trim()
      const nome = mapping["ordens.cliente_nome"] && String(mapping["ordens.cliente_nome"]).trim()
      const doc = mapping["ordens.doc_cliente"] && String(mapping["ordens.doc_cliente"]).trim()
      return Boolean(n || nome || doc)
    }
    if (kind === "fluxo_caixa") {
      if (sheet.rows.length === 0) return false
      const v = mapping["fluxo.valor"] && String(mapping["fluxo.valor"]).trim()
      const d = mapping["fluxo.descricao"] && String(mapping["fluxo.descricao"]).trim()
      const dtp = mapping["fluxo.data_pagamento"] && String(mapping["fluxo.data_pagamento"]).trim()
      const dtv = mapping["fluxo.data_vencimento"] && String(mapping["fluxo.data_vencimento"]).trim()
      return Boolean(v && d && (dtp || dtv))
    }
    if (kind === "vendas") {
      if (sheet.rows.length === 0) return false
      const d = mapping["vendas.data"] && String(mapping["vendas.data"]).trim()
      const c = mapping["vendas.cliente"] && String(mapping["vendas.cliente"]).trim()
      const v = mapping["vendas.valor_total"] && String(mapping["vendas.valor_total"]).trim()
      return Boolean(d && c && v)
    }
    if (kind === "contas_pagar") {
      if (sheet.rows.length === 0) return false
      const v = mapping["contas_pagar.valor"] && String(mapping["contas_pagar.valor"]).trim()
      const ven = mapping["contas_pagar.vencimento"] && String(mapping["contas_pagar.vencimento"]).trim()
      return Boolean(v && ven)
    }
    if (kind === "contas_receber") {
      if (sheet.rows.length === 0) return false
      const v = mapping["contas_receber.valor"] && String(mapping["contas_receber.valor"]).trim()
      const ven = mapping["contas_receber.vencimento"] && String(mapping["contas_receber.vencimento"]).trim()
      return Boolean(v && ven)
    }
    return false
  }, [kind, mapping, sheet, temLojaObrigatoria])

  useEffect(() => {
    if (!sheet?.headers?.length) return
    setMapping(defaultMappingFor(kind, sheet.headers, sheet))
  }, [kind, sheet])

  const preview = useMemo(() => {
    if (!sheet) return null
    try {
      if (kind === "produtos") {
        const items = buildProdutosItemsFromSheetFlexible(sheet, mapping).slice(0, 8)
        return { kind: "produtos" as const, items }
      }
      if (kind === "clientes") {
        const items = buildClientesItemsFromSheet(sheet, mapping).slice(0, 8)
        return { kind: "clientes" as const, items }
      }
      if (kind === "ordens_servico") {
        const items = sheet.rows.slice(0, 5).map((row, idx) => buildOrdemPayloadFromRow(row, mapping, idx))
        return { kind: "ordens_servico" as const, items }
      }
    } catch (e) {
      return { kind: "erro" as const, error: e instanceof Error ? e.message : String(e) }
    }
    return null
  }, [kind, mapping, sheet])

  const yieldToUi = async () => {
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  const fetchWithTimeout = async (
    input: RequestInfo | URL,
    init: RequestInit & { timeoutMs?: number } = {}
  ) => {
    const timeoutMs = init.timeoutMs ?? 60_000
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(input, { ...init, signal: ctrl.signal })
    } finally {
      window.clearTimeout(t)
    }
  }

  const uploadInventoryInBatches = async (
    items: Array<{ id: string; name: string; stock: number; cost: number; price: number; category: string }>
  ) => {
    if (!Array.isArray(items)) {
      console.warn("[import] uploadInventoryInBatches: `items` não é um array:", items)
      throw new Error("Dados de produtos inválidos: esperado uma lista (array) de itens.")
    }
    const total = items.length
    const batchSize = 500
    const batches = Math.ceil(total / batchSize)
    setProgressTotal(total)
    setProgressNow(0)

    for (let b = 0; b < batches; b += 1) {
      const start = b * batchSize
      const end = Math.min(total, start + batchSize)
      const chunk = items.slice(start, end)

      setProgressLabel(`Enviando lote ${b + 1}/${batches}... (até item ${end} de ${total})`)
      await yieldToUi()

      const res = await fetchWithTimeout("/api/ops/inventory/import", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeHeaderParaEscrita,
        },
        body: JSON.stringify({ items: chunk }),
        credentials: "include",
        timeoutMs: 60_000,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        const combined = [data?.error, data?.detail].filter(Boolean).join(" — ")
        throw new Error(combined || `Falha no lote ${b + 1}/${batches} (HTTP ${res.status})`)
      }

      setProgressNow(end)
      setProgressLabel(`Item ${end} de ${total}...`)
      await yieldToUi()
    }
  }

  const uploadClientesInBatches = async (items: Record<string, unknown>[]) => {
    const total = items.length
    const batchSize = 200
    const batches = Math.ceil(total / batchSize)
    setProgressTotal(total)
    setProgressNow(0)

    for (let b = 0; b < batches; b += 1) {
      const start = b * batchSize
      const end = Math.min(total, start + batchSize)
      const chunk = items.slice(start, end)

      setProgressLabel(`Clientes: lote ${b + 1}/${batches}... (até ${end} de ${total})`)
      await yieldToUi()

      const res = await fetchWithTimeout("/api/ops/import/clientes", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeHeaderParaEscrita,
        },
        body: JSON.stringify({ items: chunk }),
        credentials: "include",
        timeoutMs: 120_000,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string; prismaCode?: string } | null
        const combined = [data?.error, data?.detail, data?.prismaCode].filter(Boolean).join(" — ")
        throw new Error(combined || `Falha no lote ${b + 1}/${batches} (HTTP ${res.status})`)
      }

      setProgressNow(end)
      await yieldToUi()
    }
  }

  const uploadOrdensInBatches = async (items: Record<string, unknown>[]) => {
    const total = items.length
    const batchSize = 100
    const batches = Math.ceil(total / batchSize)
    setProgressTotal(total)
    setProgressNow(0)

    for (let b = 0; b < batches; b += 1) {
      const start = b * batchSize
      const end = Math.min(total, start + batchSize)
      const chunk = items.slice(start, end)

      setProgressLabel(`O.S.: lote ${b + 1}/${batches}... (até ${end} de ${total})`)
      await yieldToUi()

      const res = await fetchWithTimeout("/api/ops/ordens/import", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: storeHeaderParaEscrita,
        },
        body: JSON.stringify({ ordens: chunk }),
        credentials: "include",
        timeoutMs: 120_000,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        throw new Error(data?.error || data?.detail || `Falha no lote ${b + 1}/${batches} (HTTP ${res.status})`)
      }

      setProgressNow(end)
      await yieldToUi()
    }
  }

  const handleUpload = async (file: File) => {
    setParseError(null)
    setValidationErrors([])
    setSheet(null)
    setImportLog("")
    setProgressNow(0)
    setProgressTotal(0)
    setProgressLabel("")
    setSelectedFileName(file?.name ?? "")
    try {
      const parsed = await parseFileUniversal(file)
      const enriched: ParsedSheet =
        (parsed.grid?.length ?? 0) > 0
          ? (applyGestaoClickPostParse({ ...parsed }) as ParsedSheet)
          : { ...parsed, headerRowIndex: parsed.headerRowIndex ?? 0, detectedKind: "unknown" }
      if (enriched.headers.length === 0 && (enriched.rows?.length ?? 0) === 0) {
        setParseError("Não foi possível detectar colunas ou linhas de dados.")
        return
      }
      const rowsNorm = normalizeSheetRows(enriched.rows, enriched.fileName)
      const gridNorm = enriched.grid ? normalizeXlsxGridRaw(enriched.grid, enriched.fileName) : enriched.grid
      const finalSheet = { ...enriched, rows: rowsNorm, grid: gridNorm }
      setSheet(finalSheet)
      // Segurança de destino: não alteramos automaticamente a aba ativa.
      // O usuário escolhe explicitamente (Produtos / Financeiro / etc.) para evitar mistura de importações.
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha ao ler o arquivo.")
    }
  }

  const clearFile = () => {
    setParseError(null)
    setValidationErrors([])
    setSheet(null)
    setImportLog("")
    setSelectedFileName("")
    setProgressNow(0)
    setProgressTotal(0)
    setProgressLabel("")
    if (inputRef.current) inputRef.current.value = ""
  }

  const callImportValidate = async (): Promise<
    { ok: true } | { ok: false; errors: Array<{ line: number; message: string }> }
  > => {
    if (!sheet || !temLojaObrigatoria) {
      return { ok: false, errors: [{ line: 0, message: "Selecione a unidade (loja) no cabeçalho antes de importar." }] }
    }
    const mappingRec = mapping as Record<string, string>
    const bodyBase = { rows: sheet.rows, mapping: mappingRec }

    let url = ""
    let body: Record<string, unknown> = bodyBase

    if (kind === "clientes") {
      url = "/api/import/validate/clientes"
    } else if (kind === "produtos") {
      url = "/api/import/validate/produtos"
    } else if (kind === "fluxo_caixa" || kind === "contas_pagar" || kind === "contas_receber") {
      url = "/api/import/validate/financeiro"
      body = { ...bodyBase, financeKind: kind }
    } else if (kind === "vendas") {
      url = "/api/import/validate/vendas"
      body = { ...bodyBase, mode: "vendas" }
    } else if (kind === "ordens_servico") {
      url = "/api/import/validate/vendas"
      body = { ...bodyBase, mode: "ordens" }
    } else {
      return { ok: true }
    }

    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ASSISTEC_LOJA_HEADER]: storeHeaderParaEscrita,
      },
      body: JSON.stringify(body),
      credentials: "include",
      timeoutMs: 120_000,
    })
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      errors?: Array<{ line: number; message: string }>
      error?: string
    } | null
    if (!res.ok) {
      return {
        ok: false,
        errors: [{ line: 0, message: data?.error ?? `Falha na validação (HTTP ${res.status}).` }],
      }
    }
    if (!data?.ok) {
      const errs = Array.isArray(data?.errors) ? data!.errors! : [{ line: 0, message: "Validação reprovada." }]
      return { ok: false, errors: errs }
    }
    return { ok: true }
  }

  const runImport = async () => {
    if (!sheet || importRunRef.current || isImporting) return
    importRunRef.current = true
    setIsImporting(true)
    setParseError(null)
    setValidationErrors([])

    try {
      setProgressLabel("Validando colunas no servidor (sem gravar ainda)…")
      setProgressTotal(100)
      setProgressNow(8)
      await yieldToUi()
      const validated = await callImportValidate()
      setProgressNow(28)
      await yieldToUi()
      if (!validated.ok) {
        setValidationErrors(validated.errors)
        const lines = validated.errors
          .slice(0, 60)
          .map((er) => (er.line > 0 ? `Linha ${er.line}: ${er.message}` : er.message))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}[Validação — nada foi gravado]\n${lines.join("\n")}`
        })
        throw new Error(
          validated.errors.length
            ? `Validação: ${validated.errors.length} alerta(s). Corrija o mapeamento ou a planilha e tente novamente.`
            : "Validação reprovada."
        )
      }

      if (kind === "produtos") {
        setProgressLabel("Mapeando colunas (nome, custo, varejo, estoque)…")
        await yieldToUi()
        const items = buildProdutosItemsFromSheetFlexible(sheet, mapping)
        if (items.length === 0) {
          throw new Error(
            "Nenhum produto válido encontrado. Confira colunas de nome e valores numéricos (use vírgula como decimal, ex.: 5,20)."
          )
        }
        setProgressNow(0)
        setProgressTotal(items.length)
        setProgressLabel("Enviando produtos em lotes de 500…")
        await yieldToUi()

        await uploadInventoryInBatches(items)

        setCounts((prev) => ({ ...prev, produtos: prev.produtos + items.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${items.length} produto(s) gravados na unidade atual (criados ou atualizados conforme a API).`
        })
        return
      }

      if (kind === "clientes") {
        const totalRows = sheet.rows.length
        setProgressTotal(totalRows)
        setProgressNow(0)
        setProgressLabel(`Preparando ${totalRows} linha(s)...`)
        await yieldToUi()

        const items = buildClientesItemsFromSheet(sheet, mapping)

        if (items.length === 0) throw new Error("Nenhuma linha com nome de cliente.")

        setProgressNow(0)
        setProgressTotal(items.length)
        setProgressLabel("Enviando clientes em lote — atualiza se CPF/CNPJ ou nome já existir...")
        await yieldToUi()

        await uploadClientesInBatches(items)
        dispatchClientesRevalidate()

        setCounts((prev) => ({ ...prev, clientes: prev.clientes + items.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${items.length} cliente(s) processados (criados ou atualizados) na unidade atual.`
        })
        return
      }

      if (kind === "ordens_servico") {
        const totalRows = sheet.rows.length
        const ordens: Record<string, unknown>[] = []
        setProgressTotal(totalRows)
        setProgressNow(0)

        for (let i = 0; i < totalRows; i += 1) {
          const r = sheet.rows[i]!
          ordens.push(buildOrdemPayloadFromRow(r, mapping, i))
          if ((i + 1) % 500 === 0 || i + 1 === totalRows) {
            setProgressNow(i + 1)
            setProgressLabel(`Preparando O.S. ${i + 1} de ${totalRows}...`)
            await yieldToUi()
          }
        }

        setProgressNow(0)
        setProgressTotal(ordens.length)
        setProgressLabel("Enviando ordens (atualiza por número, CPF/CNPJ ou nome do cliente)...")
        await yieldToUi()

        await uploadOrdensInBatches(ordens)

        setCounts((prev) => ({ ...prev, ordens_servico: prev.ordens_servico + ordens.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${ordens.length} O.S. processada(s) (criadas ou atualizadas) na unidade atual.`
        })
        return
      }

      if (kind === "fluxo_caixa") {
        const cTipo = mapping["fluxo.tipo"]
        const cDesc = mapping["fluxo.descricao"]
        const cVal = mapping["fluxo.valor"]!
        const cPag = mapping["fluxo.data_pagamento"]
        const cVen = mapping["fluxo.data_vencimento"]
        const cParceiro = mapping["fluxo.parceiro"]
        const cCat = mapping["fluxo.categoria_financeira"]
        const cStatus = mapping["fluxo.status"]

        const carteiraDefault =
          carteiras.find((c) => c.tipo === "empresa")?.id ?? carteiras[0]?.id ?? "cart-rafacell"

        const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
        const existingKeys = new Set(
          (movimentos ?? []).map((m) => `${m.at.slice(0, 10)}|${m.valor.toFixed(2)}|${normText(m.descricao)}`)
        )

        const novos: MovimentoFinanceiro[] = []
        for (let i = 0; i < sheet.rows.length; i += 1) {
          const r = sheet.rows[i]!

          const desc0 =
            (cDesc ? cellToTrimmedString(r[cDesc]) : "") ||
            cellToTrimmedString(r["Descrição"] as unknown as string) ||
            cellToTrimmedString(r["Historico"] as unknown as string) ||
            cellToTrimmedString(r["Histórico"] as unknown as string)
          if (!desc0) continue

          const rawValor = r[cVal]
          const valorNum = toNumberPtBr(rawValor)
          const rawV = String(rawValor ?? "").trim()
          if (!rawV && valorNum <= 0) continue

          const dtBase = cPag ? parseDataBrFlex(r[cPag]) : cVen ? parseDataBrFlex(r[cVen]) : new Date().toISOString().slice(0, 10)
          const at = `${dtBase}T12:00:00.000Z`

          const tipoTxt = cTipo ? String(r[cTipo] ?? "").trim().toLowerCase() : ""
          const statusRaw = cStatus ? String(r[cStatus] ?? "").trim() : ""
          const statusTxt = statusRaw.toLowerCase()
          const statusInterno: "Pago" | "Pendente" = statusRaw === "Confirmado" ? "Pago" : "Pendente"
          const inferredTipo: "entrada" | "saida" =
            /saida|saída|debito|d[eé]bito|pagar|desp/i.test(tipoTxt) || /saida|saída|debito|d[eé]bito|pagar|desp/i.test(statusTxt)
              ? "saida"
              : "entrada"

          const parceiro = cParceiro ? cellToTrimmedString(r[cParceiro]) : ""
          const categoria = cCat ? cellToTrimmedString(r[cCat]) : ""
          const categoriaFinal = categoria || fluxoCategoriaDefault.trim() || "Outros"

          const descricaoParts = [desc0]
          if (parceiro) descricaoParts.push(parceiro)
          const descricao = descricaoParts.join(" — ")

          const key = `${dtBase}|${valorNum.toFixed(2)}|${normText(descricao)}`
          if (existingKeys.has(key)) continue
          existingKeys.add(key)

          novos.push({
            id: `mov-imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            carteiraId: carteiraDefault,
            tipo: inferredTipo,
            valor: Math.max(0, valorNum),
            descricao,
            categoria: categoriaFinal,
            status: statusInterno,
            at,
          })
        }

        setMovimentos((prev) => [...novos, ...(prev ?? [])])
        setCounts((prev) => ({ ...prev, fluxo_caixa: prev.fluxo_caixa + novos.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${novos.length} movimentação(ões) importada(s) no Fluxo de Caixa (dedupe por data+valor+descrição).`
        })
        return
      }

      if (kind === "vendas") {
        const cData = mapping["vendas.data"]!
        const cDesc = mapping["vendas.cliente"]!
        const cVal = mapping["vendas.valor_total"]!
        const cStat = mapping["vendas.status"]

        const carteiraDefault =
          carteiras.find((c) => c.tipo === "empresa")?.id ?? carteiras[0]?.id ?? "cart-rafacell"

        const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
        const existingKeys = new Set(
          (movimentos ?? []).map((m) => `${m.at.slice(0, 10)}|${m.valor.toFixed(2)}|${normText(m.descricao)}`)
        )

        const novos: MovimentoFinanceiro[] = []
        for (let i = 0; i < sheet.rows.length; i += 1) {
          const r = sheet.rows[i]!
          const desc0 = cDesc ? cellToTrimmedString(r[cDesc]) : ""
          if (!desc0) continue

          const rawValor = r[cVal]
          const valorNum = toNumberPtBr(rawValor)
          const rawV = String(rawValor ?? "").trim()
          if (!rawV && valorNum <= 0) continue

          const dtBase = cData ? parseDataBrFlex(r[cData]) : new Date().toISOString().slice(0, 10)
          const at = `${dtBase}T12:00:00.000Z`

          const statusRaw = cStat ? String(r[cStat] ?? "").trim() : ""
          const statusInterno: "Pago" | "Pendente" = statusRaw === "Confirmado" ? "Pago" : "Pendente"

          const descricao = desc0
          const key = `${dtBase}|${valorNum.toFixed(2)}|${normText(descricao)}`
          if (existingKeys.has(key)) continue
          existingKeys.add(key)

          novos.push({
            id: `mov-venda-imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            carteiraId: carteiraDefault,
            tipo: "entrada",
            valor: Math.max(0, valorNum),
            descricao,
            categoria: SUGESTAO_CATEGORIA_VENDAS_PADRAO,
            status: statusInterno,
            at,
          })
        }

        setMovimentos((prev) => [...novos, ...(prev ?? [])])
        setCounts((prev) => ({ ...prev, vendas: prev.vendas + novos.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${novos.length} lançamento(s) de vendas importado(s) como Movimentação Financeira (dedupe por data+valor+descrição).`
        })
        return
      }

      if (kind === "contas_pagar") {
        const colD = mapping["contas_pagar.descricao"]
        const colF = mapping["contas_pagar.fornecedor"]
        const colV = mapping["contas_pagar.valor"]!
        const colVen = mapping["contas_pagar.vencimento"]!
        const colS = mapping["contas_pagar.status"]
        const colPag = mapping["contas_pagar.data_pagamento"]
        const novos: ContaPagarItem[] = []
        for (let i = 0; i < sheet.rows.length; i += 1) {
          const r = sheet.rows[i]!
          const valor = toNumberPtBr(r[colV])
          const rawV = String(r[colV] ?? "").trim()
          if (!rawV && valor <= 0) continue
          novos.push({
            id: `cp-imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            descricao: colD ? cellToTrimmedString(r[colD]) : "Importado",
            fornecedor: colF ? cellToTrimmedString(r[colF]) : "—",
            valor: valor > 0 ? valor : 0,
            dataVencimento: parseDataBrFlex(r[colVen]),
            status: mapStatusContasPagarImportBlindagem(
              colS ? r[colS] : undefined,
              r[colVen],
              colPag ? r[colPag] : undefined
            ),
            categoria: "Importação backup",
          })
        }
        setContasPagar((prev) => [...novos, ...prev])
        setCounts((prev) => ({ ...prev, contas_pagar: prev.contas_pagar + novos.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${novos.length} conta(s) a pagar adicionada(s) ao módulo Financeiro (navegador).`
        })
        return
      }

      if (kind === "contas_receber") {
        const colD = mapping["contas_receber.descricao"]
        const colC = mapping["contas_receber.cliente"]
        const colV = mapping["contas_receber.valor"]!
        const colVen = mapping["contas_receber.vencimento"]!
        const colS = mapping["contas_receber.status"]
        const colDataConf = mapping["contas_receber.data_confirmacao"]
        const colPedido = mapping["contas_receber.pedido"]
        const pedidosPagos = getPedidosPagosVendas()
        type RowRec = {
          id: string
          descricao: string
          cliente: string
          valor: number
          vencimento: string
          status: string
          tipo: string
        }
        const novos: RowRec[] = []
        for (let i = 0; i < sheet.rows.length; i += 1) {
          const r = sheet.rows[i]!
          const valores = parseContasReceberValorCellAll(r[colV])
          const rawV = String(r[colV] ?? "").trim()
          if (!rawV && valores.length === 0) continue
          const venc = colVen ? parseDataBrFlex(r[colVen]) : new Date().toISOString().slice(0, 10)
          const [y, m, d] = venc.split("-")
          const vencBr = d && m && y ? `${d}/${m}/${y}` : venc
          const descricao = colD ? cellToTrimmedString(r[colD]) : "Importado"
          const cliente = resolveClienteContasReceberImport(descricao, r, colC, sheet.headers)
          const pedidoVal = colPedido ? cellToTrimmedString(r[colPedido]) : ""
          const chaveExternaPaga = pedidoVal ? pedidosPagos.has(pedidoVal) : false
          const statusLinha = mapStatusContasReceberImportBlindagem(
            colS ? r[colS] : undefined,
            colDataConf ? r[colDataConf] : undefined,
            colVen ? r[colVen] : undefined,
            chaveExternaPaga
          )
          const nParc = valores.length
          for (let p = 0; p < nParc; p += 1) {
            const valor = valores[p]!
            if (valor <= 0) continue
            const tipo =
              nParc > 1 ? `Backup · Parcela ${p + 1}/${nParc}` : "Backup"
            novos.push({
              id: `cr-imp-${Date.now()}-${i}-${p}-${Math.random().toString(36).slice(2, 7)}`,
              descricao,
              cliente,
              valor,
              vencimento: vencBr,
              status: statusLinha,
              tipo,
            })
          }
        }
        const key = contasReceberStorageKey(lojaAtivaId || LEGACY_PRIMARY_STORE_ID)
        try {
          const prev = JSON.parse(localStorage.getItem(key) || "[]") as unknown
          const merged = Array.isArray(prev) ? [...novos, ...prev] : novos
          localStorage.setItem(key, JSON.stringify(merged))
        } catch {
          localStorage.setItem(key, JSON.stringify(novos))
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("assistec-contas-receber-imported"))
        }
        setCounts((prev) => ({ ...prev, contas_receber: prev.contas_receber + novos.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Validação OK.\nSucesso: ${novos.length} título(s) em Contas a Receber. Data de confirmação preenchida força Pago; vendedor após hífen vira Consumidor Final se não houver outra coluna de nome. Várias parcelas entre aspas na mesma célula são desmembradas. Sem juros na importação.`
        })
        return
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha na importação.")
    } finally {
      importRunRef.current = false
      setIsImporting(false)
      setProgressLabel("")
      setProgressNow(0)
      setProgressTotal(0)
    }
  }

  return (
    <div className="space-y-6">
      <Tabs value={uiTab} onValueChange={(v) => setUiTab(v as ImportUiTab)} className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto gap-1 bg-secondary p-1">
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
        </TabsList>

        <TabsContent value={uiTab} className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                Importação universal (um arquivo por vez)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!temLojaObrigatoria && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                  Selecione a <strong className="font-medium">unidade (loja) ativa</strong> no cabeçalho do sistema antes
                  de enviar a planilha. A importação exige o vínculo com a loja para gravar no banco com segurança.
                </div>
              )}

              {uiTab === "financeiro" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={financeSub === "fluxo_caixa" ? "default" : "outline"}
                    onClick={() => setFinanceSub("fluxo_caixa")}
                  >
                    Extrato / Fluxo de caixa
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={financeSub === "contas_pagar" ? "default" : "outline"}
                    onClick={() => setFinanceSub("contas_pagar")}
                  >
                    Contas a pagar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={financeSub === "contas_receber" ? "default" : "outline"}
                    onClick={() => setFinanceSub("contas_receber")}
                  >
                    Contas a receber
                  </Button>
                </div>
              )}

              {uiTab === "vendas" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={vendasSub === "vendas" ? "default" : "outline"}
                    onClick={() => setVendasSub("vendas")}
                  >
                    Histórico de vendas (lançamentos)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={vendasSub === "ordens_servico" ? "default" : "outline"}
                    onClick={() => setVendasSub("ordens_servico")}
                  >
                    Ordens de serviço
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Label>Arquivo (.csv, .xlsx ou .xls)</Label>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  disabled={!temLojaObrigatoria}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    void handleUpload(file)
                    e.currentTarget.value = ""
                  }}
                />
                <button
                  type="button"
                  disabled={!temLojaObrigatoria}
                  onClick={() => inputRef.current?.click()}
                  onDragEnter={(e) => {
                    if (!temLojaObrigatoria) return
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragActive(true)
                  }}
                  onDragOver={(e) => {
                    if (!temLojaObrigatoria) return
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragActive(true)
                  }}
                  onDragLeave={(e) => {
                    if (!temLojaObrigatoria) return
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragActive(false)
                  }}
                  onDrop={(e) => {
                    if (!temLojaObrigatoria) return
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragActive(false)
                    const file = e.dataTransfer?.files?.[0]
                    if (file) void handleUpload(file)
                  }}
                  className={[
                    "w-full rounded-xl border border-dashed px-4 py-5 text-left transition-colors",
                    "bg-background/40 hover:bg-background/60",
                    isDragActive ? "border-primary bg-primary/5" : "border-border",
                    !temLojaObrigatoria ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center border border-border">
                      <UploadCloud className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {selectedFileName ? "Arquivo selecionado" : "Arraste e solte aqui, ou clique para escolher"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Dica: Você não precisa ajustar sua planilha. Nosso sistema identificará suas colunas no próximo passo.
                      </p>
                    </div>
                  </div>
                </button>
                {selectedFileName ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                    <span className="text-xs font-medium text-foreground truncate">{selectedFileName}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={clearFile}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <Button type="button" variant="secondary" className="w-full" onClick={downloadTemplate.run} disabled={!temLojaObrigatoria}>
                {downloadTemplate.label}
              </Button>

              {parseError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {parseError}
                </div>
              )}

              {sheet && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Arquivo: <strong className="text-foreground">{sheet.fileName}</strong> · Linhas:{" "}
                    <strong className="text-foreground">{sheet.rows.length}</strong>
                    {sheet.grid && sheet.grid.length > 0 ? (
                      <>
                        {" "}
                        · Grade: <strong className="text-foreground">{sheet.grid.length}</strong> linhas ×{" "}
                        <strong className="text-foreground">{(sheet.grid[0] as unknown[])?.length ?? 0}</strong> colunas
                      </>
                    ) : null}
                  </p>
                  {sheet.detectedKind && sheet.detectedKind !== "unknown" && (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      Detecção automática: <strong className="text-foreground">{labelGestaoClickKind(sheet.detectedKind)}</strong>
                    </p>
                  )}
                  {sheet.headers.length > 0 && (
                    <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-3">
                      <p className="text-xs font-medium text-foreground">
                        Mapeamento inteligente: cada coluna da sua planilha → campo do sistema (ajuste o vínculo se a
                        sugestão não for a ideal).
                      </p>
                      <div className="overflow-x-auto rounded-md border border-border/60 bg-background/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                              <th className="p-2 font-medium">Coluna na planilha</th>
                              <th className="p-2 font-medium">Sugestão automática</th>
                              <th className="p-2 font-medium min-w-[200px]">Vínculo com o sistema</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.headers.map((header) => {
                              const suggested = targetKeyForSheetColumn(
                                header,
                                defaultMappingSnapshot,
                                allowedMapTargets
                              )
                              const sugLabel =
                                suggested === SELECT_NONE
                                  ? "—"
                                  : (expectedFields.find((f) => f.key === suggested)?.label ?? String(suggested))
                              const cur = currentTargetForColumn(header, mapping, allowedMapTargets)
                              const selectVal = cur === SELECT_NONE ? SELECT_NONE : cur
                              return (
                                <tr key={header} className="border-b border-border/60 last:border-0">
                                  <td className="p-2 align-middle font-medium text-foreground">{header}</td>
                                  <td className="p-2 align-middle text-muted-foreground">{sugLabel}</td>
                                  <td className="p-2 align-middle">
                                    <Select
                                      value={selectVal}
                                      onValueChange={(v) =>
                                        setMapping((prev) =>
                                          applyColumnTarget(
                                            prev,
                                            header,
                                            v === SELECT_NONE ? SELECT_NONE : (v as MapTarget),
                                            allowedMapTargets
                                          )
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-9 bg-background border-border text-xs">
                                        <SelectValue placeholder="Ignorar coluna" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={SELECT_NONE}>— Ignorar coluna</SelectItem>
                                        {expectedFields.map((f) => (
                                          <SelectItem key={`${header}-${f.key}`} value={f.key}>
                                            {f.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {kind === "fluxo_caixa" && (
                        <div className="pt-2 border-t border-border/60">
                          <Label className="text-xs text-muted-foreground">Categoria Financeira (padrão)</Label>
                          <Input
                            value={fluxoCategoriaDefault}
                            onChange={(e) => setFluxoCategoriaDefault(e.target.value)}
                            placeholder="Ex.: Vendas no balcão"
                            className="h-9 bg-background border-border text-xs mt-1"
                            list="sugestoes-categoria-financeira"
                          />
                          <datalist id="sugestoes-categoria-financeira">
                            {SUGESTOES_CATEGORIA_FINANCEIRA.map((c) => (
                              <option key={c} value={c} />
                            ))}
                          </datalist>
                          <p className="text-xs text-muted-foreground mt-1">
                            Se a planilha não tiver coluna Plano de contas (categoria), este valor será usado.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {validationErrors.length > 0 && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 space-y-1 max-h-48 overflow-auto">
                      <p className="text-xs font-medium text-destructive">Última validação (corrija antes de importar)</p>
                      <ul className="text-[11px] text-destructive space-y-0.5 list-disc pl-4">
                        {validationErrors.slice(0, 80).map((err, i) => (
                          <li key={`${err.line}-${i}`}>
                            {err.line > 0 ? `Linha ${err.line}: ` : ""}
                            {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preview?.kind === "erro" ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      Prévia: {preview.error}
                    </div>
                  ) : preview?.items ? (
                    <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground">Prévia (antes de confirmar)</p>
                      <pre className="max-h-64 overflow-auto rounded-md bg-background/60 p-3 text-[11px] leading-relaxed">
                        {JSON.stringify(preview.items, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                Validar e gravar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                O fluxo sempre envia o arquivo para <strong className="text-foreground">validação no servidor</strong>{" "}
                (com o mapeamento atual) antes de gravar nada. Assim reduzimos erros de coluna e respostas 500 do banco.
                Use os modelos abaixo quando quiser um cabeçalho já compatível.
              </p>
              {uiTab === "clientes" ? (
                <p className="text-xs text-muted-foreground">
                  Foco: <strong className="text-foreground">Nome</strong>, <strong className="text-foreground">CPF/CNPJ</strong>{" "}
                  e <strong className="text-foreground">contato</strong> (telefone/e-mail). Campos extras são opcionais.
                </p>
              ) : uiTab === "produtos" ? (
                <p className="text-xs text-muted-foreground">
                  Foco: <strong className="text-foreground">SKU</strong>,{" "}
                  <strong className="text-foreground">preço de custo</strong>,{" "}
                  <strong className="text-foreground">preço de venda</strong> e <strong className="text-foreground">estoque</strong>.
                  Nome e categoria continuam disponíveis para o cadastro completo.
                </p>
              ) : uiTab === "financeiro" ? (
                <p className="text-xs text-muted-foreground">
                  Escolha o subtipo (extrato, contas a pagar ou receber). Cada um usa o endpoint de validação do módulo
                  Financeiro antes de mesclar aos dados locais.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Vendas</strong>: lançamentos no fluxo financeiro local.{" "}
                  <strong className="text-foreground">Ordens de serviço</strong>: gravadas no banco com a mesma unidade
                  ativa.
                </p>
              )}

              <Separator />

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Clientes, produtos e O.S. vão para o Postgres com <code className="text-[10px]">storeId</code> da
                  unidade selecionada. Vendas e contas a receber usam armazenamento local do navegador; contas a pagar
                  somam ao Financeiro já carregado.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <Button type="button" disabled={!canImport || isImporting} onClick={() => void runImport()}>
                    Validar e importar
                  </Button>
                </div>
              </div>

              {isImporting && progressTotal > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{progressLabel || `Item ${progressNow} de ${progressTotal}...`}</span>
                    <span className="tabular-nums">
                      {Math.round((progressNow / Math.max(1, progressTotal)) * 100)}%
                    </span>
                  </div>
                  <Progress value={(progressNow / Math.max(1, progressTotal)) * 100} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Log final</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 text-sm">
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Clientes</span>
              <div className="font-semibold">{counts.clientes}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Produtos</span>
              <div className="font-semibold">{counts.produtos}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">O.S.</span>
              <div className="font-semibold">{counts.ordens_servico}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Extrato Financeiro</span>
              <div className="font-semibold">{counts.fluxo_caixa}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Vendas</span>
              <div className="font-semibold">{counts.vendas}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Contas a pagar</span>
              <div className="font-semibold">{counts.contas_pagar}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Contas a receber (local)</span>
              <div className="font-semibold">{counts.contas_receber}</div>
            </div>
          </div>
          <pre className="text-xs rounded-lg bg-secondary/40 border border-border p-3 whitespace-pre-wrap">
            {importLog ||
              "Nenhuma importação nesta sessão. Use as categorias acima e o botão Importar agora quando o arquivo estiver pronto."}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

