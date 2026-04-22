/**
 * Lê os exports longos do GestãoClick na raiz e gera vendas.csv, vendas_produtos.csv,
 * contas_receber.csv com separador ; e cabeçalhos esperados pelo importar_backup.mjs.
 *
 * Arquivos originais na raiz (renomeados para simplificar):
 *   vendas_orig.csv
 *   produtos_orig.csv
 *   contas_orig.csv
 *
 * Uso: node merge_gestao_csv.mjs
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import Papa from "papaparse"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Entradas: os três CSV originais na raiz (GestãoClick / export). */
const SOURCES = Object.freeze({
  vendas: "vendas_orig.csv",
  produtos: "produtos_orig.csv",
  contas: "contas_orig.csv",
})

const OUT = {
  vendas: "vendas.csv",
  produtos: "vendas_produtos.csv",
  contas: "contas_receber.csv",
}

const TARGET_VENDAS = ["Nº do pedido", "Cliente", "Data", "Total do pedido"]
const TARGET_PROD = ["Nº do pedido", "Produto", "Quantidade", "Valor unitário"]
const TARGET_CONTAS = ["Descrição do recebimento", "Valor total", "Data do vencimento", "Situação"]

/** Aliases por coluna de destino (tenta na ordem). */
const ALIAS_VENDAS = {
  "Nº do pedido": ["Nº do pedido", "Nº Pedido", "Numero do pedido", "Nº do Pedido", "Pedido", "Num pedido"],
  Cliente: ["Cliente", "Nome do cliente", "Cliente / Razão social", "Razão social"],
  Data: ["Data", "Data da venda", "Data do pedido", "Emissão", "Dt"],
  "Total do pedido": [
    "Total do pedido",
    "Valor total",
    "Total",
    "Vlr total",
    "Valor Total do Pedido",
    "Total geral",
  ],
}

const ALIAS_PROD = {
  "Nº do pedido": ["Nº do pedido", "Nº Pedido", "Numero do pedido", "Pedido"],
  Produto: ["Produto", "Descrição", "Descrição do produto", "Item", "Nome do produto"],
  Quantidade: ["Quantidade", "Qtd", "Qtde"],
  "Valor unitário": ["Valor unitário", "Valor unitario", "Vlr unitário", "Preço unitário", "Vlr unit"],
}

const ALIAS_CONTAS = {
  "Descrição do recebimento": [
    "Descrição do recebimento",
    "Descricao do recebimento",
    "Descrição",
    "Histórico",
    "Titulo",
    "Título",
  ],
  "Valor total": ["Valor total", "Valor", "Vlr", "Saldo", "Total"],
  "Data do vencimento": ["Data do vencimento", "Vencimento", "Data vencimento", "Vencto"],
  Situação: ["Situação", "Situacao", "Status", "Estado"],
}

function normHeader(s) {
  return String(s ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function findColumnKey(sampleRow, labelEsperado) {
  if (!sampleRow || typeof sampleRow !== "object") return null
  const keys = Object.keys(sampleRow)
  const candidato = String(labelEsperado).trim()
  const exato = keys.find((k) => k === candidato)
  if (exato) return exato
  const want = normHeader(candidato)
  const porNorm = keys.find((k) => normHeader(k) === want)
  if (porNorm) return porNorm
  const wantCompact = want.replace(/\s/g, "")
  return keys.find((k) => normHeader(k).replace(/\s/g, "") === wantCompact) || null
}

function resolveSourceKeys(sampleRow, targetOrder, aliasMap) {
  const map = {}
  const missing = []
  for (const destCol of targetOrder) {
    const aliases = aliasMap[destCol] || [destCol]
    let found = null
    for (const a of aliases) {
      found = findColumnKey(sampleRow, a)
      if (found) break
    }
    if (!found) missing.push(destCol)
    map[destCol] = found
  }
  if (missing.length) {
    console.error("[merge] Cabeçalhos no arquivo:", Object.keys(sampleRow))
    throw new Error(`Colunas não encontradas no original: ${missing.join(", ")}`)
  }
  return map
}

/** Sempre lê com separador `;` (GestãoClick / Excel BR). Cabeçalhos sem espaços extras. */
function readCsvSemicolon(filePath, logLabel) {
  const text = fs.readFileSync(filePath, "utf8")
  const rawLines = text.split(/\r?\n/)

  console.log(`[merge] --- ${logLabel} (${path.basename(filePath)}) ---`)
  console.log("[merge] Primeiras 2 linhas (texto bruto do arquivo):")
  console.log("  linha 1:", JSON.stringify(rawLines[0] ?? ""))
  console.log("  linha 2:", JSON.stringify(rawLines[1] ?? "(ausente — só há cabeçalho ou arquivo termina aqui)"))

  const parsed = Papa.parse(text, {
    delimiter: ";",
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) =>
      String(h)
        .replace(/^\uFEFF/, "")
        .trim()
        .replace(/\s+/g, " "),
  })

  if (parsed.errors?.length) {
    console.warn("[merge] Avisos Papa.parse:", parsed.errors.slice(0, 5))
  }

  const fieldList = parsed.meta?.fields
  console.log(
    `[merge] Após parse (delimiter=';'): colunas=${Array.isArray(fieldList) ? fieldList.length : "?"} | linhas em parsed.data=${parsed.data?.length ?? 0}`
  )
  if (Array.isArray(fieldList) && fieldList.length) {
    console.log("[merge] Cabeçalhos normalizados:", fieldList)
  }

  const rowsRaw = Array.isArray(parsed.data) ? parsed.data : []
  const rows = rowsRaw
    .map((row) => {
      if (!row || typeof row !== "object") return null
      const o = {}
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).trim().replace(/\s+/g, " ")
        o[key] = v
      }
      return o
    })
    .filter(Boolean)
    .filter((row) => Object.values(row).some((v) => String(v ?? "").trim() !== ""))

  console.log(`[merge] Linhas de dados não vazias após filtro: ${rows.length}\n`)

  return { rows, delimiterUsed: ";" }
}

function writeCsvSemicolon(fields, dataRows) {
  return Papa.unparse(
    { fields, data: dataRows },
    {
      delimiter: ";",
      newline: "\n",
      quotes: true,
      quoteChar: '"',
      escapeChar: '"',
    }
  )
}

function mergeTable(sourceName, sourceFile, outFile, targetFields, aliasMap) {
  const root = __dirname
  const src = path.join(root, sourceFile)
  if (!fs.existsSync(src)) {
    throw new Error(`Arquivo original não encontrado:\n  ${src}\nCopie "${sourceName}" para a raiz do projeto e rode de novo.`)
  }

  const { rows } = readCsvSemicolon(src, sourceName)
  if (!rows.length) {
    console.warn(`[merge] ${sourceFile}: sem linhas de dados (só cabeçalho ou células vazias); gerando só cabeçalho na saída.`)
    const empty = []
    fs.writeFileSync(path.join(root, outFile), writeCsvSemicolon(targetFields, empty), "utf8")
    return 0
  }

  const keyByDest = resolveSourceKeys(rows[0], targetFields, aliasMap)
  const dataRows = rows.map((r) => targetFields.map((col) => String(r[keyByDest[col]] ?? "").trim()))

  const content = writeCsvSemicolon(targetFields, dataRows)
  fs.writeFileSync(path.join(root, outFile), "\uFEFF" + content, "utf8")
  return rows.length
}

function main() {
  const root = __dirname
  console.log("[merge_gestao_csv] Pasta:", root)

  const nV = mergeTable("vendas", SOURCES.vendas, OUT.vendas, TARGET_VENDAS, ALIAS_VENDAS)
  console.log(`  OK ${OUT.vendas} (${nV} linhas de dados)`)

  const nP = mergeTable("vendas_produtos", SOURCES.produtos, OUT.produtos, TARGET_PROD, ALIAS_PROD)
  console.log(`  OK ${OUT.produtos} (${nP} linhas de dados)`)

  const nC = mergeTable("contas_receber", SOURCES.contas, OUT.contas, TARGET_CONTAS, ALIAS_CONTAS)
  console.log(`  OK ${OUT.contas} (${nC} linhas de dados)`)

  console.log("\n[merge_gestao_csv] Concluído. Separa: ; | BOM UTF-8 para Excel.")
  console.log("Próximo passo: node --env-file=.env importar_backup.mjs --dry-run")
}

try {
  main()
} catch (e) {
  console.error(e.message || e)
  process.exit(1)
}
