import * as XLSX from "xlsx"

type ParsedSheet = {
  fileName: string
  headers: string[]
  rows: Record<string, unknown>[]
}

type WorkerRequest = {
  fileName: string
  buffer: ArrayBuffer
}

type WorkerResponse =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; error: string }

function parseXlsxFromBuffer(fileName: string, buffer: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "array" })
  const first = wb.SheetNames[0]
  const sheet = first ? wb.Sheets[first] : undefined
  if (!sheet) return { fileName, headers: [], rows: [] }

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
  return { fileName, headers, rows }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  try {
    const { fileName, buffer } = ev.data
    const sheet = parseXlsxFromBuffer(fileName, buffer)
    const res: WorkerResponse = { ok: true, sheet }
    self.postMessage(res)
  } catch (e) {
    const res: WorkerResponse = { ok: false, error: e instanceof Error ? e.message : String(e) }
    self.postMessage(res)
  }
}

