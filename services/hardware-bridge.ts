/**
 * Bridge de hardware via Web Serial API (Chrome/Edge).
 * Balanças comerciais (Toledo, Filizola, Urano, etc.) costumam enviar peso em ASCII contínuo.
 *
 * Protocolos variam por modelo/firmware — use `protocol: "auto"` e ajuste `baudRate`
 * (2400, 4800, 9600, 115200) conforme o manual da balança.
 */

export type ScaleProtocol = "toledo" | "filizola" | "auto"

export type ScaleConnectionOptions = {
  baudRate?: number
  protocol?: ScaleProtocol
  /** Filtro opcional de porta (substring do nome, ex.: "USB") */
  portNameIncludes?: string
}

let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
let activePort: SerialPort | null = null
let buffer = ""

declare global {
  interface SerialPortFilter {
    usbVendorId?: number
    usbProductId?: number
  }
  interface SerialPort {
    readable: ReadableStream<Uint8Array> | null
    open: (options: { baudRate: number }) => Promise<void>
    close: () => Promise<void>
  }
  interface Navigator {
    serial?: {
      requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>
    }
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serial
}

/**
 * Extrai peso em kg de uma linha típica de balança (ASCII).
 * Cobre formatos comuns: "ST,NT,0,   1,234 kg", "02.350kg", "+1234 g" (converte para kg).
 */
export function parseWeightLineKg(line: string): number | null {
  const t = line.trim()
  if (!t) return null

  const kgMatch = t.match(/(\d+[.,]\d{2,6})\s*(?:kg|KG)/i)
  if (kgMatch) {
    const v = parseFloat(kgMatch[1].replace(",", "."))
    return Number.isFinite(v) && v >= 0 && v < 10000 ? v : null
  }

  const gMatch = t.match(/(\d+)\s*(?:g|G)\b/)
  if (gMatch) {
    const g = parseInt(gMatch[1], 10)
    if (Number.isFinite(g) && g >= 0 && g < 1_000_000) return Math.round((g / 1000) * 10000) / 10000
  }

  const toledoLike = t.match(/[+,]?\s*(\d{1,4}[.,]\d{2,4})\b/)
  if (toledoLike) {
    const v = parseFloat(toledoLike[1].replace(",", "."))
    if (Number.isFinite(v) && v >= 0 && v < 10000) return v
  }

  const plain = t.match(/\b(\d{1,3}[.,]\d{3})\b/)
  if (plain) {
    const v = parseFloat(plain[1].replace(",", "."))
    if (Number.isFinite(v) && v >= 0 && v < 1000) return v
  }

  return null
}

export function extractLastWeightFromBuffer(text: string, protocol: ScaleProtocol): number | null {
  const lines = text.split(/\r?\n/)
  let best: number | null = null
  for (const line of lines) {
    const w = parseWeightLineKg(line)
    if (w != null) best = w
  }
  if (best != null) return best
  const joined = text.slice(-500)
  return parseWeightLineKg(joined)
}

export async function openScalePort(opts: ScaleConnectionOptions = {}): Promise<void> {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial não disponível. Use Chrome/Edge e HTTPS (ou localhost).")
  }
  await closeScalePort()
  const port = await navigator.serial!.requestPort()
  await port.open({ baudRate: opts.baudRate ?? 9600 })
  activePort = port
  buffer = ""
  const textDecoder = new TextDecoder("utf-8")
  const readable = port.readable
  if (!readable) throw new Error("Porta sem stream de leitura")
  const reader = readable.getReader()
  activeReader = reader
  ;(async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) buffer += textDecoder.decode(value, { stream: true })
        if (buffer.length > 16000) buffer = buffer.slice(-8000)
      }
    } catch {
      /* desconectado */
    }
  })().catch(() => {})
}

export async function closeScalePort(): Promise<void> {
  try {
    await activeReader?.cancel()
  } catch {
    /* ignore */
  }
  activeReader = null
  try {
    await activePort?.close()
  } catch {
    /* ignore */
  }
  activePort = null
  buffer = ""
}

/**
 * Lê o último peso estável disponível no buffer (últimas leituras seriais).
 */
export function peekLastWeightKg(protocol: ScaleProtocol = "auto"): number | null {
  return extractLastWeightFromBuffer(buffer, protocol)
}

/**
 * Aguarda até `timeoutMs` por um peso válido (polling do buffer).
 */
export async function waitForStableWeightKg(
  protocol: ScaleProtocol = "auto",
  timeoutMs = 2500
): Promise<number | null> {
  const start = Date.now()
  let last: number | null = null
  while (Date.now() - start < timeoutMs) {
    const w = peekLastWeightKg(protocol)
    if (w != null && w > 0) {
      if (last != null && Math.abs(last - w) < 0.002) return w
      last = w
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  return peekLastWeightKg(protocol)
}
