"use client"

import { useRef, useState } from "react"
import { UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import Papa from "papaparse"

export default function MigracaoPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [csvColumns, setCsvColumns] = useState<string[]>([])
  const [csvError, setCsvError] = useState<string | null>(null)

  const handleUpload = (file: File) => {
    setCsvError(null)
    setCsvColumns([])

    const isCsv =
      file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv")
    if (!isCsv) {
      setCsvError("Envie um arquivo .csv de Clientes para ler as colunas.")
      return
    }

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      preview: 1,
      complete: (result) => {
        const fields = (result.meta.fields ?? []).filter(Boolean) as string[]
        if (fields.length === 0) {
          setCsvError("Não foi possível detectar as colunas (primeira linha).")
          return
        }
        setCsvColumns(fields)
      },
      error: (err) => {
        setCsvError(err.message || "Falha ao ler o CSV.")
      },
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">Migração / Importação</h1>
        <p className="text-sm text-muted-foreground">
          Envie um CSV de Clientes para o sistema ler as colunas. (Em breve: validação e mapeamento de colunas.)
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          handleUpload(file)
          e.currentTarget.value = ""
        }}
      />

      <Button
        type="button"
        size="lg"
        className="h-12"
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="w-5 h-5 mr-2" />
        Upload de Arquivo
      </Button>

      {csvError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {csvError}
        </div>
      )}

      {csvColumns.length > 0 && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-foreground">Colunas detectadas</p>
          <div className="flex flex-wrap gap-2">
            {csvColumns.map((c) => (
              <span
                key={c}
                className="text-xs px-2 py-1 rounded-md bg-secondary text-secondary-foreground border border-border"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

