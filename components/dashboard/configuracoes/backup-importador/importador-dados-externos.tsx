"use client"

import { useMemo, useRef, useState } from "react"
import { FileSpreadsheet, Link2, UploadCloud } from "lucide-react"
import Papa from "papaparse"
import * as XLSX from "xlsx"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { dispatchClientesRevalidate } from "@/lib/clientes-revalidate"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { defaultChecklist, horaAtualHHMM } from "@/components/dashboard/os/ordens-servico"

type ImportKind = "clientes" | "produtos" | "ordens_servico"

type ParsedSheet = {
  fileName: string
  headers: string[]
  rows: Record<string, unknown>[]
}

type MapTarget =
  | "clientes.nome"
  | "clientes.doc"
  | "clientes.telefone"
  | "clientes.email"
  | "clientes.endereco"
  | "produtos.nome"
  | "produtos.sku"
  | "produtos.preco_custo"
  | "produtos.preco_venda"
  | "produtos.estoque"
  | "ordens.numero"
  | "ordens.cliente_nome"
  | "ordens.doc_cliente"
  | "ordens.telefone"

type MappingState = Partial<Record<MapTarget, string>>

const SELECT_NONE = "__none__"

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function toNumberPtBr(raw: unknown): number {
  const s = String(raw ?? "").trim()
  if (!s) return 0
  const norm = s.replace(/\./g, "").replace(",", ".")
  const n = parseFloat(norm)
  return Number.isFinite(n) ? n : 0
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
        resolve({ fileName: file.name, headers, rows: (result.data ?? []) as Record<string, unknown>[] })
      },
      error: (err) => reject(err),
    })
  })
}

async function parseXlsx(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const first = wb.SheetNames[0]
  const sheet = first ? wb.Sheets[first] : undefined
  if (!sheet) return { fileName: file.name, headers: [], rows: [] }

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][]
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
    return { fileName: file.name, headers: Object.keys(rows[0]!), rows }
  }
  return { fileName: file.name, headers, rows }
}

async function parseFileUniversal(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return await parseCsv(file)
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return await parseXlsx(file)
  throw new Error("Formato não suportado. Envie .csv ou .xlsx.")
}

function defaultMappingFor(kind: ImportKind, headers: string[]): MappingState {
  const map: MappingState = {}

  if (kind === "clientes") {
    map["clientes.nome"] = bestMatch(headers, ["nome", "cliente", "razao social", "nome cliente", "nome/razao"]) ?? ""
    map["clientes.doc"] = bestMatch(headers, ["cpf", "cnpj", "cpf/cnpj", "documento", "doc"]) ?? ""
    map["clientes.telefone"] = bestMatch(headers, ["telefone", "celular", "fone", "whatsapp", "contato"]) ?? ""
    map["clientes.email"] = bestMatch(headers, ["email", "e-mail"]) ?? ""
    map["clientes.endereco"] = bestMatch(headers, ["endereco", "endereço", "logradouro", "rua", "bairro", "cidade"]) ?? ""
  }

  if (kind === "produtos") {
    map["produtos.nome"] = bestMatch(headers, ["nome", "produto", "descricao", "descrição"]) ?? ""
    map["produtos.sku"] = bestMatch(headers, ["sku", "codigo", "código", "cod", "referencia", "referência", "ean", "gtin"]) ?? ""
    map["produtos.preco_custo"] = bestMatch(headers, ["preco de custo", "custo", "valor custo", "preco_custo"]) ?? ""
    map["produtos.preco_venda"] = bestMatch(headers, ["preco de venda", "venda", "valor", "preco_venda", "preco"]) ?? ""
    map["produtos.estoque"] = bestMatch(headers, ["estoque", "quantidade", "saldo", "estoque atual"]) ?? ""
  }

  if (kind === "ordens_servico") {
    map["ordens.numero"] =
      bestMatch(headers, ["numero", "número", "os", "ordem", "ordem servico", "ordem de servico", "n os"]) ?? ""
    map["ordens.cliente_nome"] = bestMatch(headers, ["nome cliente", "cliente", "nome", "razao social"]) ?? ""
    map["ordens.doc_cliente"] = bestMatch(headers, ["cpf", "cnpj", "cpf/cnpj", "documento cliente", "cliente cpf"]) ?? ""
    map["ordens.telefone"] = bestMatch(headers, ["telefone", "celular", "whatsapp", "fone"]) ?? ""
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

  const numRaw = colNum ? String(row[colNum] ?? "").trim() : ""
  const numero = numRaw
    ? numRaw.toUpperCase().startsWith("OS")
      ? numRaw
      : `OS-${numRaw.replace(/^os-?/i, "").trim()}`
    : `OS-IMP-${index + 1}`

  const nome = colNome ? String(row[colNome] ?? "").trim() : ""
  const docRaw = colDoc ? String(row[colDoc] ?? "").trim() : ""
  const tel = colTel ? String(row[colTel] ?? "").trim() : ""

  const today = new Date().toISOString().slice(0, 10)
  return {
    id: `imp-${sanitizeId(numero)}-${index}`,
    numero,
    cliente: {
      nome: nome || "Cliente",
      telefone: tel,
      cpf: docRaw,
    },
    aparelho: { marca: "", modelo: "", imei: "", cor: "" },
    checklist: defaultChecklist.map((x) => ({ ...x })),
    defeito: "",
    solucao: "",
    status: "aguardando_peca",
    dataEntrada: today,
    horaEntrada: horaAtualHHMM(),
    dataPrevisao: today,
    dataSaida: null,
    horaSaida: null,
    valorServico: 0,
    valorPecas: 0,
    fotos: [],
    observacoes: "",
    termoGarantia: "",
    textoGarantiaEditado: "",
  }
}

export function ImportadorDadosExternos() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const importRunRef = useRef(false)
  const { lojaAtivaId } = useLojaAtiva()

  const [kind, setKind] = useState<ImportKind>("clientes")
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<MappingState>({})

  const [importLog, setImportLog] = useState<string>("")
  const [isImporting, setIsImporting] = useState(false)
  const [progressNow, setProgressNow] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressLabel, setProgressLabel] = useState("")

  const [counts, setCounts] = useState<Record<ImportKind, number>>({
    clientes: 0,
    produtos: 0,
    ordens_servico: 0,
  })

  const expectedFields = useMemo(() => {
    if (kind === "clientes") {
      return [
        { key: "clientes.nome" as const, label: "Nome" },
        { key: "clientes.doc" as const, label: "CPF/CNPJ" },
        { key: "clientes.telefone" as const, label: "Telefone/WhatsApp" },
        { key: "clientes.email" as const, label: "E-mail" },
        { key: "clientes.endereco" as const, label: "Endereço" },
      ]
    }
    if (kind === "produtos") {
      return [
        { key: "produtos.nome" as const, label: "Nome do Produto" },
        { key: "produtos.sku" as const, label: "SKU/Código" },
        { key: "produtos.preco_custo" as const, label: "Preço de Custo" },
        { key: "produtos.preco_venda" as const, label: "Preço de Venda" },
        { key: "produtos.estoque" as const, label: "Estoque" },
      ]
    }
    return [
      { key: "ordens.numero" as const, label: "Número da O.S." },
      { key: "ordens.cliente_nome" as const, label: "Nome do cliente" },
      { key: "ordens.doc_cliente" as const, label: "CPF/CNPJ do cliente" },
      { key: "ordens.telefone" as const, label: "Telefone do cliente" },
    ]
  }, [kind])

  const canImport = useMemo(() => {
    if (!sheet) return false
    if (kind === "ordens_servico") {
      const n = mapping["ordens.numero"] && String(mapping["ordens.numero"]).trim()
      const nome = mapping["ordens.cliente_nome"] && String(mapping["ordens.cliente_nome"]).trim()
      const doc = mapping["ordens.doc_cliente"] && String(mapping["ordens.doc_cliente"]).trim()
      return Boolean(n || nome || doc)
    }
    const first = expectedFields[0]?.key
    if (!first) return false
    return Boolean(mapping[first] && String(mapping[first]).trim())
  }, [expectedFields, kind, mapping, sheet])

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
          ...(lojaAtivaId ? { [ASSISTEC_LOJA_HEADER]: lojaAtivaId } : {}),
        },
        body: JSON.stringify({ items: chunk }),
        credentials: "include",
        timeoutMs: 60_000,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null
        throw new Error(data?.error || data?.detail || `Falha no lote ${b + 1}/${batches} (HTTP ${res.status})`)
      }

      setProgressNow(end)
      setProgressLabel(`Item ${end} de ${total}...`)
      await yieldToUi()
    }
  }

  const uploadClientesInBatches = async (
    items: Array<{ nome: string; doc?: string; telefone?: string; email?: string; endereco?: string }>
  ) => {
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
          ...(lojaAtivaId ? { [ASSISTEC_LOJA_HEADER]: lojaAtivaId } : {}),
        },
        body: JSON.stringify({ items: chunk }),
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
          ...(lojaAtivaId ? { [ASSISTEC_LOJA_HEADER]: lojaAtivaId } : {}),
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
    setSheet(null)
    setImportLog("")
    setProgressNow(0)
    setProgressTotal(0)
    setProgressLabel("")
    try {
      const parsed = await parseFileUniversal(file)
      if (parsed.headers.length === 0) {
        setParseError("Não foi possível detectar colunas (primeira linha).")
        return
      }
      setSheet(parsed)
      setMapping(defaultMappingFor(kind, parsed.headers))
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha ao ler o arquivo.")
    }
  }

  const runImport = async () => {
    if (!sheet || importRunRef.current || isImporting) return
    importRunRef.current = true
    setIsImporting(true)
    setParseError(null)

    try {
      if (kind === "produtos") {
        const colNome = mapping["produtos.nome"] || ""
        const colSku = mapping["produtos.sku"] || ""
        const colCusto = mapping["produtos.preco_custo"] || ""
        const colVenda = mapping["produtos.preco_venda"] || ""
        const colEstoque = mapping["produtos.estoque"] || ""
        if (!colNome) throw new Error("Mapeie ao menos a coluna de Nome do Produto.")

        const items: Array<{ id: string; name: string; stock: number; cost: number; price: number; category: string }> = []
        const seen = new Set<string>()
        const totalRows = sheet.rows.length

        setProgressTotal(totalRows)
        setProgressNow(0)
        for (let i = 0; i < totalRows; i += 1) {
          const r = sheet.rows[i]!
          const name = String(r[colNome] ?? "").trim()
          if (!name) continue
          const skuRaw = String(r[colSku] ?? "").trim()
          const base = sanitizeId(skuRaw || name)
          let id = base ? `gc-${base}` : `gc-item-${i + 1}`
          if (seen.has(id)) id = `${id}-${i + 1}`
          seen.add(id)

          items.push({
            id,
            name,
            cost: toNumberPtBr(r[colCusto]),
            price: toNumberPtBr(r[colVenda]),
            stock: Math.max(0, Math.floor(toNumberPtBr(r[colEstoque]))),
            category: "peca",
          })

          if ((i + 1) % 500 === 0 || i + 1 === totalRows) {
            setProgressNow(i + 1)
            setProgressLabel(`Preparando item ${i + 1} de ${totalRows}...`)
            await yieldToUi()
          }
        }

        setProgressNow(0)
        setProgressTotal(items.length)
        setProgressLabel("Enviando para o banco em lotes de 500 (atualiza se já existir por nome ou SKU)...")
        await yieldToUi()

        await uploadInventoryInBatches(items)

        setCounts((prev) => ({ ...prev, produtos: prev.produtos + items.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Sucesso: ${items.length} produto(s) processados (criados ou atualizados conforme nome/SKU no banco).`
        })
        return
      }

      if (kind === "clientes") {
        const colNome = mapping["clientes.nome"] || ""
        const colDoc = mapping["clientes.doc"] || ""
        const colTel = mapping["clientes.telefone"] || ""
        const colEmail = mapping["clientes.email"] || ""
        const colEnd = mapping["clientes.endereco"] || ""
        if (!colNome) throw new Error("Mapeie a coluna Nome.")

        const items: Array<{ nome: string; doc?: string; telefone?: string; email?: string; endereco?: string }> = []
        const totalRows = sheet.rows.length
        setProgressTotal(totalRows)
        setProgressNow(0)

        for (let i = 0; i < totalRows; i += 1) {
          const r = sheet.rows[i]!
          const nome = String(r[colNome] ?? "").trim()
          if (!nome) continue
          items.push({
            nome,
            doc: colDoc ? String(r[colDoc] ?? "").trim() : undefined,
            telefone: colTel ? String(r[colTel] ?? "").trim() : undefined,
            email: colEmail ? String(r[colEmail] ?? "").trim() : undefined,
            endereco: colEnd ? String(r[colEnd] ?? "").trim() : undefined,
          })
          if ((i + 1) % 500 === 0 || i + 1 === totalRows) {
            setProgressNow(i + 1)
            setProgressLabel(`Preparando cliente ${i + 1} de ${totalRows}...`)
            await yieldToUi()
          }
        }

        if (items.length === 0) throw new Error("Nenhuma linha com nome de cliente.")

        setProgressNow(0)
        setProgressTotal(items.length)
        setProgressLabel("Enviando clientes (atualiza se CPF/CNPJ ou nome já existir)...")
        await yieldToUi()

        await uploadClientesInBatches(items)
        dispatchClientesRevalidate()

        setCounts((prev) => ({ ...prev, clientes: prev.clientes + items.length }))
        setImportLog((prev) => {
          const head = prev ? `${prev}\n` : ""
          return `${head}Sucesso: ${items.length} cliente(s) processados (criados ou atualizados).`
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
          return `${head}Sucesso: ${ordens.length} O.S. processada(s) (criadas ou atualizadas).`
        })
        return
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha na importação.")
    } finally {
      importRunRef.current = false
      setIsImporting(false)
      setProgressLabel("")
    }
  }

  return (
    <div className="space-y-6">
      <Tabs value={kind} onValueChange={(v) => setKind(v as ImportKind)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto gap-1 bg-secondary p-1">
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="ordens_servico">O.S.</TabsTrigger>
        </TabsList>

        <TabsContent value={kind} className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                O que estou importando agora?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={kind} onValueChange={(v) => setKind(v as ImportKind)}>
                    <SelectTrigger className="h-11 bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clientes">Clientes</SelectItem>
                      <SelectItem value="produtos">Produtos</SelectItem>
                      <SelectItem value="ordens_servico">Ordens de Serviço</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Arquivo</Label>
                  <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      void handleUpload(file)
                      e.currentTarget.value = ""
                    }}
                  />
                  <Button type="button" variant="outline" className="w-full h-11" onClick={() => inputRef.current?.click()}>
                    <UploadCloud className="w-4 h-4 mr-2" />
                    Upload de Arquivo (CSV/XLSX)
                  </Button>
                </div>
              </div>

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
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="w-5 h-5 text-primary" />
                Mapeamento de colunas (GestãoClick → Assistec Pro)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!sheet ? (
                <p className="text-sm text-muted-foreground">Envie um arquivo para detectar as colunas e liberar o mapeamento.</p>
              ) : (
                <div className="grid gap-4">
                  {expectedFields.map((f) => (
                    <div key={f.key} className="grid gap-2 sm:grid-cols-2 sm:items-center">
                      <Label className="text-sm">{f.label}</Label>
                      <Select
                        value={mapping[f.key] && String(mapping[f.key]).trim() ? (mapping[f.key] as string) : SELECT_NONE}
                        onValueChange={(v) =>
                          setMapping((prev) => ({ ...prev, [f.key]: v === SELECT_NONE ? "" : v }))
                        }
                      >
                        <SelectTrigger className="h-11 bg-secondary border-border">
                          <SelectValue placeholder="Selecione uma coluna do seu arquivo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SELECT_NONE}>— (não mapear)</SelectItem>
                          {sheet.headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h || "N/A"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              <Separator />

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Clientes, produtos e O.S. são gravados no banco. Registros com o mesmo CPF/CNPJ ou mesmo nome (clientes e
                  produtos) ou mesmo número / mesmo cliente (O.S.) são atualizados em vez de duplicados.
                </p>
                <Button type="button" disabled={!canImport || isImporting} onClick={() => void runImport()}>
                  Importar agora
                </Button>
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
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
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
          </div>
          <pre className="text-xs rounded-lg bg-secondary/40 border border-border p-3 whitespace-pre-wrap">
            {importLog || "Sucesso: 0 Clientes, 0 Produtos, 0 O.S. importadas"}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

