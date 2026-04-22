/**
 * Reimporta clientes para `clientes_importados` a partir de um arquivo CSV ou JSON.
 *
 * Exemplos:
 *   node --env-file=.env scripts/reimport-clientes.mjs --file "./clientes.json"
 *   node --env-file=.env scripts/reimport-clientes.mjs --file "./clientes.csv"
 *   node --env-file=.env scripts/reimport-clientes.mjs --file "./clientes.csv" --lojaId loja-1
 *
 * Formatos aceitos:
 * - JSON: array de objetos com chaves `Nome`/`nome` e opcional `Telefone`/`telefone`
 * - CSV: cabeçalho com colunas `Nome` e opcional `Telefone` (case-insensitive)
 */
import fs from "node:fs"
import path from "node:path"
import { PrismaClient } from "../generated/prisma/index.js"

const prisma = new PrismaClient()

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  return process.argv[i + 1] ?? null
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function toStr(v) {
  return String(v ?? "").trim()
}

function normalizeNameForMatch(name) {
  const raw = toStr(name)
  if (!raw) return ""
  // Normalização simples: remove acentos + lowercase + remove tudo que não é letra/número/espaço
  const noAccents = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  return noAccents
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
    .trim()
}

function parseCsv(text) {
  // Parser CSV simples (bom o suficiente p/ Nome/Telefone sem aspas complexas).
  const lines = stripBom(text).split(/\\r?\\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split(",").map((h) => h.trim())
  const idxNome = header.findIndex((h) => h.toLowerCase() === "nome")
  const idxTel = header.findIndex((h) => h.toLowerCase() === "telefone")
  if (idxNome === -1) throw new Error("CSV inválido: precisa de coluna 'Nome'.")
  return lines.slice(1).map((line) => {
    const cols = line.split(",")
    return {
      Nome: (cols[idxNome] ?? "").trim(),
      Telefone: idxTel >= 0 ? (cols[idxTel] ?? "").trim() : "",
    }
  })
}

async function main() {
  const file = argValue("--file")
  const lojaId = (argValue("--lojaId") || "loja-1").trim() || "loja-1"
  if (!file) throw new Error("Uso: --file <caminho para .json ou .csv> [--lojaId loja-1]")

  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
  const ext = path.extname(abs).toLowerCase()
  const raw = fs.readFileSync(abs, "utf8")

  let rows
  if (ext === ".json") {
    const parsed = JSON.parse(stripBom(raw))
    if (!Array.isArray(parsed)) throw new Error("JSON inválido: esperado um array.")
    rows = parsed
  } else if (ext === ".csv") {
    rows = parseCsv(raw)
  } else {
    throw new Error(`Extensão não suportada: ${ext} (use .json ou .csv)`)
  }

  await prisma.$connect()

  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const r = row
    const nome = toStr(r.Nome ?? r.nome)
    const telefone = toStr(r.Telefone ?? r.telefone) || null
    if (!nome) continue
    const nomeNorm = normalizeNameForMatch(nome)
    if (!nomeNorm) continue

    const existing = await prisma.cliente.findFirst({ where: { lojaId, nomeNorm } })
    if (existing) {
      await prisma.cliente.update({ where: { id: existing.id }, data: { nome, telefone } })
      updated += 1
      continue
    }

    try {
      await prisma.cliente.create({
        data: {
          lojaId,
          nome,
          nomeNorm,
          docDigits: null,
          cpf: null,
          telefone,
          email: null,
          endereco: "",
        },
      })
      created += 1
    } catch (e) {
      // ignora duplicados por constraints (nomeNorm/docDigits) para não abortar o lote inteiro
      skipped += 1
    }
  }

  console.log(JSON.stringify({ lojaId, created, updated, skipped, totalInput: rows.length }, null, 2))
}

main()
  .catch((e) => {
    console.error("[reimport-clientes] FALHA:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

