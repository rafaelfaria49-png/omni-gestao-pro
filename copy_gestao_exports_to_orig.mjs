/**
 * Copia os CSV exportados do GestãoClick (nomes longos) para os arquivos *_orig.csv
 * usados pelo merge_gestao_csv.mjs — substitui o conteúdo inteiro (byte a byte).
 *
 * Coloque na raiz do projeto:
 *   vendas.xlsx - Worksheet.csv
 *   vendas_produtos.xlsx - Worksheet.csv
 *   contas_receber.xlsx - Worksheet.csv
 *
 * Uso: node copy_gestao_exports_to_orig.mjs
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PAIRS = [
  ["vendas.xlsx - Worksheet.csv", "vendas_orig.csv"],
  ["vendas_produtos.xlsx - Worksheet.csv", "produtos_orig.csv"],
  ["contas_receber.xlsx - Worksheet.csv", "contas_orig.csv"],
]

function countDataLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8")
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
  return Math.max(0, lines.length - 1)
}

let ok = 0
for (const [srcName, destName] of PAIRS) {
  const from = path.join(__dirname, srcName)
  const to = path.join(__dirname, destName)
  if (!fs.existsSync(from)) {
    console.error(`[copy] NÃO ENCONTRADO: ${srcName}`)
    console.error(`       Caminho esperado: ${from}`)
    continue
  }
  fs.copyFileSync(from, to)
  const n = countDataLines(to)
  console.log(`[copy] OK ${srcName} → ${destName} (${n} linhas de dados após cabeçalho)`)
  ok += 1
}

if (ok !== PAIRS.length) {
  console.error(`\n[copy] Falhou: ${ok}/${PAIRS.length} arquivos. Confira se os 3 CSV com nome longo estão na raiz do projeto.`)
  process.exit(1)
}

console.log("\n[copy] Concluído. Próximo: node merge_gestao_csv.mjs")
