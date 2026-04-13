"use client"

import { useMemo, useRef, useState } from "react"
import { FileSpreadsheet, Link2, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Papa from "papaparse"
import * as XLSX from "xlsx"

type ImportKind = "clientes" | "produtos" | "ordens_servico" | "vendas_financeiro" | "servicos"

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
  | "servicos.nome"
  | "servicos.descricao"
  | "servicos.preco"
  | "ordens.doc_cliente"
  | "vendas.doc_cliente"

type MappingState = Partial<Record<MapTarget, string>>

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function digitsOnly(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "")
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
  return await new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: true,
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

  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]
  const headerRow = Array.isArray(grid[0]) ? (grid[0] as unknown[]) : []
  const headers = headerRow.map((x) => String(x ?? "").trim()).filter(Boolean)
  const rows: Record<string, unknown>[] = []
  for (let r = 1; r < grid.length; r += 1) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]!] = row[c]
    }
    const hasAny = Object.values(obj).some((v) => String(v ?? "").trim() !== "")
    if (hasAny) rows.push(obj)
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

  if (kind === "servicos") {
    map["servicos.nome"] = bestMatch(headers, ["nome", "servico", "serviço", "descricao", "descrição"]) ?? ""
    map["servicos.descricao"] = bestMatch(headers, ["descricao", "descrição", "observacao", "observação"]) ?? ""
    map["servicos.preco"] = bestMatch(headers, ["preco", "preço", "valor"]) ?? ""
  }

  if (kind === "ordens_servico") {
    map["ordens.doc_cliente"] = bestMatch(headers, ["cpf", "cnpj", "cpf/cnpj", "documento cliente", "cliente cpf"]) ?? ""
  }

  if (kind === "vendas_financeiro") {
    map["vendas.doc_cliente"] = bestMatch(headers, ["cpf", "cnpj", "cpf/cnpj", "documento", "cliente cpf"]) ?? ""
  }

  return map
}

export default function MigracaoPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
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
    vendas_financeiro: 0,
    servicos: 0,
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
    if (kind === "servicos") {
      return [
        { key: "servicos.nome" as const, label: "Nome do Serviço" },
        { key: "servicos.descricao" as const, label: "Descrição" },
        { key: "servicos.preco" as const, label: "Preço" },
      ]
    }
    if (kind === "ordens_servico") {
      return [{ key: "ordens.doc_cliente" as const, label: "CPF/CNPJ do Cliente (para vínculo automático)" }]
    }
    return [{ key: "vendas.doc_cliente" as const, label: "CPF/CNPJ do Cliente (para vínculo automático)" }]
  }, [kind])

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

  const mappedPreview = useMemo(() => {
    if (!sheet) return []
    return sheet.rows.slice(0, 5)
  }, [sheet])

  const canImport = useMemo(() => {
    if (!sheet) return false
    // exige pelo menos o primeiro campo do bloco
    const first = expectedFields[0]?.key
    if (!first) return false
    return Boolean(mapping[first] && String(mapping[first]).trim())
  }, [expectedFields, mapping, sheet])

  const yieldToUi = async () => {
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  const runImport = async () => {
    if (!sheet) return
    if (isImporting) return
    setIsImporting(true)

    // Base de clientes para vínculo (na sessão) — simples: pega docs mapeados.
    const docKey = mapping["clientes.doc"]
    const docsImported = new Set<string>()
    if (docKey && kind === "clientes") {
      const total = sheet.rows.length
      setProgressTotal(total)
      setProgressNow(0)
      for (let i = 0; i < total; i += 1) {
        const r = sheet.rows[i]!
        const doc = digitsOnly(r[docKey])
        if (doc.length === 11 || doc.length === 14) docsImported.add(doc)
        if ((i + 1) % 100 === 0 || i + 1 === total) {
          setProgressNow(i + 1)
          setProgressLabel(`Importando item ${i + 1} de ${total}...`)
          await yieldToUi()
        }
      }
    }

    const linkKey =
      kind === "ordens_servico" ? mapping["ordens.doc_cliente"] : kind === "vendas_financeiro" ? mapping["vendas.doc_cliente"] : ""
    let vinculados = 0
    if ((kind === "ordens_servico" || kind === "vendas_financeiro") && linkKey) {
      const total = sheet.rows.length
      setProgressTotal(total)
      setProgressNow(0)
      for (let i = 0; i < total; i += 1) {
        const r = sheet.rows[i]!
        const doc = digitsOnly(r[linkKey])
        if (docsImported.has(doc)) vinculados += 1
        if ((i + 1) % 100 === 0 || i + 1 === total) {
          setProgressNow(i + 1)
          setProgressLabel(`Importando item ${i + 1} de ${total}...`)
          await yieldToUi()
        }
      }
    }

    const qtd = sheet.rows.length
    setCounts((prev) => ({ ...prev, [kind]: prev[kind] + qtd }))
    setImportLog((prev) => {
      const head = prev ? `${prev}\n` : ""
      const vinc = vinculados > 0 ? ` (vinculados ao Cliente: ${vinculados})` : ""
      return `${head}Sucesso: +${qtd} ${kind}${vinc}`
    })

    setProgressLabel("")
    setIsImporting(false)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Módulo de Migração (Importador Multidimensional)</h1>
        <p className="text-sm text-muted-foreground">
          Selecione o tipo de importação, envie um arquivo do GestãoClick (CSV/XLSX) e ajuste o mapeamento das colunas.
        </p>
      </div>

      <Tabs value={kind} onValueChange={(v) => setKind(v as ImportKind)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 h-auto gap-1 bg-secondary p-1">
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="ordens_servico">O.S.</TabsTrigger>
          <TabsTrigger value="vendas_financeiro">Vendas/Financeiro</TabsTrigger>
          <TabsTrigger value="servicos">Serviços</TabsTrigger>
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
                      <SelectItem value="vendas_financeiro">Vendas e Financeiro</SelectItem>
                      <SelectItem value="servicos">Serviços</SelectItem>
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
                  <div className="flex flex-wrap gap-2">
                    {sheet.headers.slice(0, 40).map((c) => (
                      <span
                        key={c}
                        className="text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground border border-border"
                      >
                        {c}
                      </span>
                    ))}
                    {sheet.headers.length > 40 && (
                      <span className="text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground border border-border">
                        +{sheet.headers.length - 40} colunas…
                      </span>
                    )}
                  </div>
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
                <p className="text-sm text-muted-foreground">
                  Envie um arquivo para detectar as colunas e liberar o mapeamento.
                </p>
              ) : (
                <div className="grid gap-4">
                  {expectedFields.map((f) => (
                    <div key={f.key} className="grid gap-2 sm:grid-cols-2 sm:items-center">
                      <Label className="text-sm">{f.label}</Label>
                      <Select
                        value={mapping[f.key] ?? ""}
                        onValueChange={(v) => setMapping((prev) => ({ ...prev, [f.key]: v }))}
                      >
                        <SelectTrigger className="h-11 bg-secondary border-border">
                          <SelectValue placeholder="Selecione uma coluna do seu arquivo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">— (não mapear)</SelectItem>
                          {sheet.headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
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
                  Importação inicial: processa as linhas e gera log (persistência completa por módulo será evoluída em seguida).
                </p>
                <Button type="button" disabled={!canImport || isImporting} onClick={() => void runImport()}>
                  Importar agora
                </Button>
              </div>

              {isImporting && progressTotal > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{progressLabel || `Importando item ${progressNow} de ${progressTotal}...`}</span>
                    <span className="tabular-nums">
                      {Math.round((progressNow / Math.max(1, progressTotal)) * 100)}%
                    </span>
                  </div>
                  <Progress value={(progressNow / Math.max(1, progressTotal)) * 100} />
                </div>
              )}
            </CardContent>
          </Card>

          {sheet && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Prévia (primeiras 5 linhas)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <pre className="text-xs rounded-lg bg-secondary/40 border border-border p-3 overflow-auto max-h-[240px]">
                  {JSON.stringify(mappedPreview, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Log final</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
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
              <span className="text-muted-foreground">Vendas/Financeiro</span>
              <div className="font-semibold">{counts.vendas_financeiro}</div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
              <span className="text-muted-foreground">Serviços</span>
              <div className="font-semibold">{counts.servicos}</div>
            </div>
          </div>

          <pre className="text-xs rounded-lg bg-secondary/40 border border-border p-3 whitespace-pre-wrap">
            {importLog ||
              "Sucesso: 0 Clientes, 0 Produtos, 0 O.S., 0 Vendas/Financeiro, 0 Serviços importados (envie um arquivo e clique em Importar)."}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

