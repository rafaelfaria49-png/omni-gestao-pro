/**
 * Importa backup GestãoClick (CSV exportados de planilhas) para o Supabase via Prisma.
 *
 * Na raiz do projeto, arquivos fixos:
 *   vendas.csv | vendas_produtos.csv | contas_receber.csv | os_orig.csv
 *
 * Colunas esperadas (cabeçalho na 1ª linha):
 *   vendas: Nº do pedido, Cliente, Data, Total do pedido
 *   vendas_produtos: Nº do pedido, Produto, Quantidade, Valor unitário
 *   contas_receber: Descrição do recebimento, Valor total, Data do vencimento, Situação
 *   os_orig: Nº da OS, Cliente, Equipamento, Marca, Modelo, Defeitos, Solução, Valor total, Situação
 *
 * Gravação em lotes de 20 com pausa curta entre lotes.
 *
 * Uso:
 *   node --env-file=.env importar_backup.mjs
 *   node --env-file=.env importar_backup.mjs --dry-run
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import Papa from "papaparse"
import { PrismaClient } from "./generated/prisma/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const LOJA_ID = "loja-1"

/** Quantos pedidos / títulos processar antes de uma pausa (evita queda de conexão com o Supabase). */
const BATCH_SIZE = 20

const CSV_FILES = {
  vendas: "vendas.csv",
  produtos: "vendas_produtos.csv",
  contas: "contas_receber.csv",
  os: "os_orig.csv",
}

/** Rótulos exatos das colunas (também aceita variação só de espaços/acentos no cabeçalho do arquivo). */
const COL_VENDAS = {
  pedido: "Nº do pedido",
  cliente: "Cliente",
  data: "Data",
  total: "Total do pedido",
}

const COL_PRODUTOS = {
  pedido: "Nº do pedido",
  produto: "Produto",
  qtd: "Quantidade",
  vunit: "Valor unitário",
}

const COL_CONTAS = {
  descricao: "Descrição do recebimento",
  valor: "Valor total",
  vencimento: "Data do vencimento",
  situacao: "Situação",
}

const COL_OS = {
  numero: "Nº da OS",
  cliente: "Cliente",
  equipamento: "Equipamento",
  marca: "Marca",
  modelo: "Modelo",
  defeitos: "Defeitos",
  solucao: "Solução",
  valorTotal: "Valor total",
  situacao: "Situação",
}

const prisma = new PrismaClient()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Resolve o nome real da coluna no objeto parseado (chave exata ou normalizada). */
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

function requireColumnKeys(sampleRow, mapaRotulos) {
  const resolved = {}
  const faltando = []
  for (const [campo, rotulo] of Object.entries(mapaRotulos)) {
    const key = findColumnKey(sampleRow, rotulo)
    if (!key) faltando.push(rotulo)
    else resolved[campo] = key
  }
  if (faltando.length) {
    console.error("[importar_backup] Cabeçalhos no arquivo:", Object.keys(sampleRow))
    throw new Error(`Colunas obrigatórias não encontradas: ${faltando.join(", ")}`)
  }
  return resolved
}

function resolveCsvPathsFixed(root) {
  const out = {}
  for (const [role, fname] of Object.entries(CSV_FILES)) {
    const full = path.join(root, fname)
    if (!fs.existsSync(full)) {
      throw new Error(`Arquivo obrigatório não encontrado na raiz do projeto: ${fname}\n  Caminho: ${full}`)
    }
    out[role] = full
  }
  return out
}

const dry = process.argv.includes("--dry-run")

function normHeader(s) {
  return String(s ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/** Converte "75,00", "1.234,56", " 100 " em número. */
function parseBrNumber(val) {
  if (val == null || val === "") return NaN
  if (typeof val === "number" && Number.isFinite(val)) return val
  let t = String(val).trim().replace(/\s/g, "").replace(/R\$/gi, "")
  if (!t) return NaN
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".")
  } else {
    t = t.replace(/,/g, ".")
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/** dd/mm/aaaa, dd-mm-aaaa, ou ISO. */
function parseBrDate(val) {
  if (val == null || val === "") return new Date()
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const d = parseInt(m[1], 10)
    const mo = parseInt(m[2], 10)
    let y = parseInt(m[3], 10)
    if (y < 100) y += 2000
    const dt = new Date(y, mo - 1, d, 12, 0, 0)
    return Number.isNaN(dt.getTime()) ? new Date() : dt
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) return new Date(t)
  return new Date()
}

function osStatusFromCsv(s) {
  const t = String(s ?? "").trim().toLowerCase()
  // enum StatusOrdemServico: Aberto | EmAnalise | Pronto | Entregue
  if (!t) return "Aberto"
  if (t.includes("final")) return "Entregue"
  if (t.includes("entreg")) return "Entregue"
  if (t.includes("pronto")) return "Pronto"
  if (t.includes("andamento") || t.includes("analise") || t.includes("análise")) return "EmAnalise"
  if (t.includes("abert")) return "Aberto"
  return "Aberto"
}

async function upsertOsPrisma(lojaId, osRow) {
  const numero = osRow.numero ? String(osRow.numero).trim() : ""
  if (!numero) throw new Error("OS sem número")

  const equipamentoRaw = String(osRow.equipamento ?? "").trim()
  const marca = String(osRow.marca ?? "").trim()
  const modelo = String(osRow.modelo ?? "").trim()
  const equipamento = [equipamentoRaw, marca, modelo].filter(Boolean).join(" ").trim()

  const defeito = String(osRow.defeitos ?? "").trim()
  const laudoTecnico = String(osRow.solucao ?? "").trim() || null
  const valorTotal = Number.isFinite(osRow.valorTotal) ? osRow.valorTotal : 0
  const status = osStatusFromCsv(osRow.situacao)

  const payload = {
    numero,
    cliente: String(osRow.cliente ?? "").trim(),
    equipamento: equipamentoRaw,
    marca,
    modelo,
    defeitos: defeito,
    solucao: laudoTecnico || "",
    valorTotal,
    situacao: String(osRow.situacao ?? "").trim(),
    importacao: "gestaoclick",
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.ordemServico.findFirst({
      where: { storeId: lojaId, numero },
      select: { id: true },
    })

    if (existing?.id) {
      await tx.ordemServico.update({
        where: { id: existing.id },
        data: {
          storeId: lojaId,
          numero,
          payload,
          equipamento,
          defeito,
          laudoTecnico,
          valorTotal,
          valorBase: valorTotal,
          status,
        },
      })
      return
    }

    await tx.ordemServico.create({
      data: {
        storeId: lojaId,
        numero,
        payload,
        equipamento,
        defeito,
        laudoTecnico,
        valorTotal,
        valorBase: valorTotal,
        status,
      },
    })
  })
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`)
  }
  const text = fs.readFileSync(filePath, "utf8")
  const delims = [";", ",", "\t"]
  let best = null
  for (const d of delims) {
    const r = Papa.parse(text, { delimiter: d, preview: 2 })
    if (r.data?.[0]?.length > 1) {
      best = d
      break
    }
  }
  const parsed = Papa.parse(text, {
    delimiter: best || ";",
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => String(h).replace(/^\uFEFF/, "").trim(),
  })
  if (parsed.errors?.length) {
    console.warn("[importar_backup] avisos Papa:", parsed.errors.slice(0, 3))
  }
  return parsed.data.filter((row) => Object.values(row).some((v) => String(v ?? "").trim() !== ""))
}

function pedidoKey(raw) {
  const s = raw == null ? "" : String(raw).trim()
  if (!s) return ""
  return s.replace(/^0+/, "") || s
}

function buildSaleFromGestaoClick(vendaRow, colMap, linhasProdutos) {
  const kPedido = colMap.pedido
  const rawPedido = kPedido ? vendaRow[kPedido] : ""
  const pk = pedidoKey(rawPedido)
  const pedidoId = pk ? `GC-${pk}` : ""

  const kCliente = colMap.cliente
  const kData = colMap.data
  const kTotal = colMap.total

  const clienteNome = kCliente ? String(vendaRow[kCliente] ?? "").trim() : ""
  const at = kData ? parseBrDate(vendaRow[kData]) : new Date()
  let total = kTotal != null ? parseBrNumber(vendaRow[kTotal]) : NaN

  const lines = []
  let idx = 0
  for (const pr of linhasProdutos) {
    const nome =
      (colMap.p_nome && pr[colMap.p_nome] != null ? String(pr[colMap.p_nome]) : "").trim() || "Item"
    const qRaw = colMap.p_qtd ? parseBrNumber(pr[colMap.p_qtd]) : 1
    const qtd = Number.isFinite(qRaw) && qRaw > 0 ? Math.round(qRaw) : Math.max(1, Math.round(Number(qRaw) || 1))
    const vu = colMap.p_vunit ? parseBrNumber(pr[colMap.p_vunit]) : NaN
    const vl = colMap.p_vlinha ? parseBrNumber(pr[colMap.p_vlinha]) : NaN
    const unitPrice = Number.isFinite(vu) ? vu : 0
    let lineTotal = Number.isFinite(vl) ? vl : Math.round(unitPrice * qtd * 100) / 100

    lines.push({
      inventoryId: `gc-import-${pedidoId}-${idx}`,
      name: nome,
      quantity: qtd,
      unitPrice,
      lineTotal,
      qtyReturned: 0,
    })
    idx += 1
  }

  const sumLines = Math.round(lines.reduce((a, l) => a + (Number(l.lineTotal) || 0), 0) * 100) / 100
  if (!Number.isFinite(total) || total <= 0) {
    total = sumLines
  }

  return {
    id: pedidoId,
    at: at.toISOString(),
    total,
    customerName: clienteNome || undefined,
    paymentBreakdown: {
      dinheiro: 0,
      pix: 0,
      cartaoDebito: 0,
      cartaoCredito: 0,
      carne: 0,
      aPrazo: 0,
      creditoVale: 0,
    },
    lines,
    importacao: "gestaoclick",
    pedidoOriginal: rawPedido,
  }
}

async function upsertVendaPrisma(lojaId, sale) {
  const pedidoId = typeof sale.id === "string" && sale.id.trim() ? sale.id.trim() : ""
  if (!pedidoId) throw new Error("sale.id vazio")

  const total = typeof sale.total === "number" && Number.isFinite(sale.total) ? sale.total : 0
  let at
  try {
    at = sale.at ? new Date(sale.at) : new Date()
    if (Number.isNaN(at.getTime())) at = new Date()
  } catch {
    at = new Date()
  }
  const clienteNome =
    typeof sale.customerName === "string" && sale.customerName.trim() ? sale.customerName.trim() : null

  const lines = Array.isArray(sale.lines) ? sale.lines : []
  const payload = { ...sale }

  await prisma.$transaction(async (tx) => {
    const v = await tx.venda.upsert({
      where: { pedidoId },
      create: {
        storeId: lojaId,
        pedidoId,
        payload,
        total,
        at,
        clienteNome,
      },
      update: {
        storeId: lojaId,
        payload,
        total,
        at,
        clienteNome,
      },
    })

    await tx.itemVenda.deleteMany({ where: { vendaId: v.id } })

    for (const line of lines) {
      const inventoryId = typeof line.inventoryId === "string" ? line.inventoryId : null
      const nome = typeof line.name === "string" ? line.name : ""
      const qRaw = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 0
      const quantidade = Math.max(0, Math.min(2_000_000_000, Math.round(qRaw)))
      const precoUnitario =
        typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice) ? line.unitPrice : 0
      const lineTotal =
        typeof line.lineTotal === "number" && Number.isFinite(line.lineTotal)
          ? line.lineTotal
          : Math.round(precoUnitario * quantidade * 100) / 100

      await tx.itemVenda.create({
        data: {
          vendaId: v.id,
          inventoryId,
          nome,
          quantidade,
          precoUnitario,
          lineTotal,
        },
      })
    }
  })
}

function mapVendasColumns(rows) {
  if (!rows.length) {
    return {
      pedido: COL_VENDAS.pedido,
      cliente: COL_VENDAS.cliente,
      data: COL_VENDAS.data,
      total: COL_VENDAS.total,
    }
  }
  return requireColumnKeys(rows[0], COL_VENDAS)
}

function mapProdutosColumns(rows) {
  if (!rows.length) {
    return {
      pedido: COL_PRODUTOS.pedido,
      p_nome: COL_PRODUTOS.produto,
      p_qtd: COL_PRODUTOS.qtd,
      p_vunit: COL_PRODUTOS.vunit,
      p_vlinha: null,
    }
  }
  const m = requireColumnKeys(rows[0], COL_PRODUTOS)
  return {
    pedido: m.pedido,
    p_nome: m.produto,
    p_qtd: m.qtd,
    p_vunit: m.vunit,
    p_vlinha: null,
  }
}

function mapContasColumns(rows) {
  if (!rows.length) {
    return {
      id: null,
      descricao: COL_CONTAS.descricao,
      cliente: null,
      valor: COL_CONTAS.valor,
      vencimento: COL_CONTAS.vencimento,
      status: COL_CONTAS.situacao,
    }
  }
  const m = requireColumnKeys(rows[0], COL_CONTAS)
  return {
    id: null,
    descricao: m.descricao,
    cliente: null,
    valor: m.valor,
    vencimento: m.vencimento,
    status: m.situacao,
  }
}

function groupProdutosPorPedido(rows, colMap) {
  const map = new Map()
  for (const row of rows) {
    const pk = pedidoKey(row[colMap.pedido])
    if (!pk) continue
    if (!map.has(pk)) map.set(pk, [])
    map.get(pk).push(row)
  }
  return map
}

async function importContas(rows, colMap, lojaId) {
  let n = 0
  const batches = chunk(rows, BATCH_SIZE)
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    console.log(`[importar_backup] Lote contas a receber ${b + 1}/${batches.length} (${batch.length} linhas)`)
    for (let i = 0; i < batch.length; i++) {
      const globalIndex = b * BATCH_SIZE + i
      const row = batch[i]
      const idRaw =
        colMap.id && row[colMap.id] != null && String(row[colMap.id]).trim()
          ? String(row[colMap.id]).trim()
          : `gc-cr-${globalIndex + 1}`
      const localKey = `GC-CR-${idRaw}`

      const descricao = colMap.descricao ? String(row[colMap.descricao] ?? "").trim() : ""
      const cliente = colMap.cliente ? String(row[colMap.cliente] ?? "").trim() : ""
      const valor = colMap.valor ? parseBrNumber(row[colMap.valor]) : 0
      const vRaw = colMap.vencimento ? row[colMap.vencimento] : ""
      const vencimento = vRaw
        ? parseBrDate(vRaw).toLocaleDateString("pt-BR")
        : new Date().toLocaleDateString("pt-BR")
      let st = colMap.status ? String(row[colMap.status] ?? "").trim() : "pendente"
      if (!st) st = "pendente"

      const payload = {
        id: localKey,
        descricao,
        cliente: cliente || "",
        valor: Number.isFinite(valor) ? valor : 0,
        vencimento,
        status: st,
        tipo: "Importado GestãoClick",
        importacao: "gestaoclick",
      }

      if (dry) {
        console.log("[dry-run] conta", localKey, descricao.slice(0, 40))
        n += 1
        continue
      }

      await prisma.contaReceberTitulo.upsert({
        where: { storeId_localKey: { storeId: lojaId, localKey } },
        create: {
          storeId: lojaId,
          localKey,
          payload,
          descricao,
          cliente,
          valor: Number.isFinite(valor) ? valor : 0,
          vencimento,
          status: st,
        },
        update: {
          storeId: lojaId,
          payload,
          descricao,
          cliente,
          valor: Number.isFinite(valor) ? valor : 0,
          vencimento,
          status: st,
        },
      })
      n += 1
    }
    if (!dry && b < batches.length - 1) {
      await sleep(200)
    }
  }
  return n
}

async function main() {
  const root = __dirname
  const paths = resolveCsvPathsFixed(root)

  console.log("[importar_backup] Pasta raiz:", root)
  console.log("[importar_backup] Arquivos CSV (nomes fixos):")
  console.log(" ", CSV_FILES.vendas, "→", paths.vendas)
  console.log(" ", CSV_FILES.produtos, "→", paths.produtos)
  console.log(" ", CSV_FILES.contas, "→", paths.contas)
  console.log(" ", CSV_FILES.os, "→", paths.os)
  console.log("  lojaId:", LOJA_ID, "| lote:", BATCH_SIZE, dry ? "| (dry-run)" : "")

  const rowsVendas = readCsv(paths.vendas)
  const rowsProd = readCsv(paths.produtos)
  const rowsContas = readCsv(paths.contas)
  const rowsOs = readCsv(paths.os)

  const mapV = mapVendasColumns(rowsVendas)
  const mapP = mapProdutosColumns(rowsProd)
  const mapC = mapContasColumns(rowsContas)
  const mapOs = rowsOs.length ? requireColumnKeys(rowsOs[0], COL_OS) : null

  const byPedido = groupProdutosPorPedido(rowsProd, mapP)

  const vendasParaImportar = []
  for (const vr of rowsVendas) {
    const pk = pedidoKey(vr[mapV.pedido])
    if (!pk) continue
    const linhas = byPedido.get(pk) || []
    vendasParaImportar.push(buildSaleFromGestaoClick(vr, { ...mapV, ...mapP }, linhas))
  }

  let vendasOk = 0
  let vendasErro = 0

  const lotesVendas = chunk(vendasParaImportar, BATCH_SIZE)
  for (let li = 0; li < lotesVendas.length; li++) {
    const lote = lotesVendas[li]
    console.log(`[importar_backup] Lote vendas ${li + 1}/${lotesVendas.length} (${lote.length} pedidos)`)
    for (const sale of lote) {
      try {
        if (dry) {
          console.log("[dry-run] venda", sale.id, "itens:", sale.lines.length, "total:", sale.total)
          vendasOk += 1
        } else {
          await upsertVendaPrisma(LOJA_ID, sale)
          vendasOk += 1
        }
      } catch (e) {
        vendasErro += 1
        console.error("[importar_backup] venda falhou", sale?.id, e?.message || e)
      }
    }
    if (!dry && li < lotesVendas.length - 1) {
      await sleep(200)
    }
  }

  let contasN = 0
  try {
    contasN = await importContas(rowsContas, mapC, LOJA_ID)
  } catch (e) {
    console.error("[importar_backup] contas a receber:", e)
    throw e
  }

  // Ordens de serviço (OS) — upsert por (storeId, numero)
  let osOk = 0
  let osErro = 0
  if (rowsOs.length === 0) {
    console.log("[importar_backup] os_orig.csv: 0 linhas de dados (ok).")
  } else {
    const batchesOs = chunk(rowsOs, BATCH_SIZE)
    for (let b = 0; b < batchesOs.length; b++) {
      const batch = batchesOs[b]
      console.log(`[importar_backup] Lote O.S. ${b + 1}/${batchesOs.length} (${batch.length} linhas)`)
      for (const row of batch) {
        try {
          const osRow = {
            numero: row[mapOs.numero],
            cliente: row[mapOs.cliente],
            equipamento: row[mapOs.equipamento],
            marca: row[mapOs.marca],
            modelo: row[mapOs.modelo],
            defeitos: row[mapOs.defeitos],
            solucao: row[mapOs.solucao],
            valorTotal: parseBrNumber(row[mapOs.valorTotal]),
            situacao: row[mapOs.situacao],
          }
          if (dry) {
            osOk += 1
            continue
          }
          await upsertOsPrisma(LOJA_ID, osRow)
          osOk += 1
        } catch (e) {
          osErro += 1
          console.error("[importar_backup] O.S. falhou", e?.message || e)
        }
      }
      if (!dry && b < batchesOs.length - 1) {
        await sleep(200)
      }
    }
  }

  if (!dry) {
    const nv = await prisma.venda.count({ where: { storeId: LOJA_ID } })
    const nc = await prisma.contaReceberTitulo.count({ where: { storeId: LOJA_ID } })
    const nos = await prisma.ordemServico.count({ where: { storeId: LOJA_ID } })
    console.log("\n[importar_backup] Concluído.")
    console.log("  Vendas processadas (ok):", vendasOk, " erros:", vendasErro)
    console.log("  Contas a receber gravadas:", contasN)
    console.log("  O.S. processadas (ok):", osOk, " erros:", osErro)
    console.log("  Total no banco — vendas (loja):", nv, " — títulos CR (loja):", nc, " — O.S. (loja):", nos)
  } else {
    console.log(
      "\n[importar_backup] Dry-run concluído. Vendas:",
      vendasOk,
      "contas (simuladas):",
      rowsContas.length,
      "O.S.:",
      osOk,
      "erros O.S.:",
      osErro
    )
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
