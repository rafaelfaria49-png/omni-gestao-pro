/**
 * Gerador de matriz QR (byte mode, ECC M) para renderizar o DANFC-e.
 *
 * Recebe o `qrCodeData` **já persistido** e só desenha. Não monta payload NFC-e,
 * não assina e não consulta SEFAZ.
 *
 * Algoritmo ISO/IEC 18004 (QR Code Model 2), versões 1–20, correção M.
 */

/** Total de codewords por versão (ISO/IEC 18004 Tabela 1). */
const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085]
/** Codewords de ECC por bloco — ECC M (Nayuki / ISO Tabela 9). */
const ECC_CW = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
/** Número de blocos de ECC — ECC M. */
const ECC_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]

function dataCodewords(version: number): number {
  return (TOTAL_CW[version] ?? 0) - (ECC_CW[version] ?? 0) * (ECC_BLOCKS[version] ?? 1)
}
const ALIGNMENT: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
}

const EXP: number[] = new Array(512)
const LOG: number[] = new Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function rsGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function rsEncode(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree)
  const ecc = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ ecc[0]
    ecc.shift()
    ecc.push(0)
    for (let i = 0; i < degree; i++) ecc[i] ^= gfMul(gen[i + 1], factor)
  }
  return ecc
}

function sizeOf(version: number): number {
  return 21 + 4 * (version - 1)
}

function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= 20; v++) {
    const headerBytes = 1 + (v >= 10 ? 2 : 1)
    if (byteLen + headerBytes + 1 <= dataCodewords(v)) return v
  }
  throw new Error("QR persistido excede a capacidade do gerador DANFC-e.")
}

function addBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

function bytesToCodewords(data: Uint8Array, version: number): number[] {
  const bits: number[] = []
  addBits(bits, 0b0100, 4)
  addBits(bits, data.length, version >= 10 ? 16 : 8)
  for (const byte of data) addBits(bits, byte, 8)
  const capacity = dataCodewords(version) * 8
  const remain = Math.min(4, Math.max(0, capacity - bits.length))
  for (let i = 0; i < remain; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let b = 0; b < 8; b++) value = (value << 1) | (bits[i + b] ?? 0)
    codewords.push(value)
  }
  const pad = [0xec, 0x11]
  let padIndex = 0
  while (codewords.length < dataCodewords(version)) {
    codewords.push(pad[padIndex % 2]!)
    padIndex++
  }
  return codewords
}

function interleave(codewords: number[], version: number): number[] {
  const blockCount = ECC_BLOCKS[version] ?? 1
  const eccLen = ECC_CW[version] ?? 10
  const dataLen = dataCodewords(version)
  const shortBlocks = blockCount - (dataLen % blockCount)
  const shortLen = Math.floor(dataLen / blockCount)
  const blocks: number[][] = []
  const eccBlocks: number[][] = []
  let offset = 0
  for (let i = 0; i < blockCount; i++) {
    const len = shortLen + (i < shortBlocks ? 0 : 1)
    const block = codewords.slice(offset, offset + len)
    offset += len
    blocks.push(block)
    eccBlocks.push(rsEncode(block, eccLen))
  }
  const result: number[] = []
  const maxData = Math.max(...blocks.map((b) => b.length))
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]!)
  }
  for (let i = 0; i < eccLen; i++) {
    for (const block of eccBlocks) result.push(block[i]!)
  }
  return result
}

function reserved(size: number, version: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) grid[r]![c] = true
  }
  const finder = (r: number, c: number) => {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) mark(r + y, c + x)
  }
  finder(0, 0)
  finder(0, size - 7)
  finder(size - 7, 0)
  for (let i = 8; i < size - 8; i++) {
    mark(6, i)
    mark(i, 6)
  }
  for (const row of ALIGNMENT[version] ?? []) {
    for (const col of ALIGNMENT[version] ?? []) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) mark(row + y, col + x)
    }
  }
  for (let i = 0; i < 9; i++) {
    mark(8, i)
    mark(i, 8)
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i)
    mark(size - 1 - i, 8)
  }
  mark(size - 8, 8)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j)
        mark(size - 11 + j, i)
      }
    }
  }
  return grid
}

function placeFinders(modules: boolean[][], size: number): void {
  const paint = (r: number, c: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const on = y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4)
        modules[r + y]![c + x] = on
      }
    }
  }
  paint(0, 0)
  paint(0, size - 7)
  paint(size - 7, 0)
}

function placeTiming(modules: boolean[][], size: number): void {
  for (let i = 8; i < size - 8; i++) {
    modules[6]![i] = i % 2 === 0
    modules[i]![6] = i % 2 === 0
  }
}

function placeAlignment(modules: boolean[][], version: number, size: number): void {
  for (const row of ALIGNMENT[version] ?? []) {
    for (const col of ALIGNMENT[version] ?? []) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          modules[row + y]![col + x] = Math.max(Math.abs(y), Math.abs(x)) !== 1
        }
      }
    }
  }
}

function placeFormat(modules: boolean[][], size: number, mask: number): void {
  // Format bits for ECC M (01) + mask, BCH encoded (ISO Table C.1).
  const FORMATS = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]
  const bits = FORMATS[mask] ?? FORMATS[0]!
  const coords: Array<[number, number]> = []
  for (let i = 0; i <= 5; i++) coords.push([8, i])
  coords.push([8, 7], [8, 8], [7, 8])
  for (let i = 5; i >= 0; i--) coords.push([i, 8])
  for (let i = 0; i < 15; i++) {
    const on = ((bits >> i) & 1) === 1
    const [r, c] = coords[i]!
    modules[r]![c] = on
  }
  for (let i = 0; i < 8; i++) modules[size - 1 - i]![8] = ((bits >> i) & 1) === 1
  for (let i = 0; i < 7; i++) modules[8]![size - 7 + i] = ((bits >> (14 - i)) & 1) === 1
  modules[size - 8]![8] = true
}

function placeVersion(modules: boolean[][], version: number, size: number): void {
  if (version < 7) return
  const VERSIONS: Record<number, number> = {
    7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3, 11: 0x0bbf6, 12: 0x0c762, 13: 0x0d847, 14: 0x0e60d,
    15: 0x0f72f, 16: 0x10b5d, 17: 0x1149b, 18: 0x12ad0, 19: 0x139ea, 20: 0x146c3,
  }
  const bits = VERSIONS[version] ?? 0
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1
    const r = Math.floor(i / 3)
    const c = size - 11 + (i % 3)
    modules[r]![c] = on
    modules[c]![r] = on
  }
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

function placeData(modules: boolean[][], reservedMap: boolean[][], data: number[], mask: number): void {
  const size = modules.length
  const bits: number[] = []
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  let bitIndex = 0
  let direction = -1
  let row = size - 1
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (;;) {
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc
        if (!reservedMap[row]![c]) {
          const bit = bits[bitIndex] ?? 0
          bitIndex++
          modules[row]![c] = (bit === 1) !== maskFn(mask, row, c)
        }
      }
      row += direction
      if (row < 0 || row >= size) {
        row -= direction
        direction = -direction
        break
      }
    }
  }
}

function cloneGrid(grid: boolean[][]): boolean[][] {
  return grid.map((row) => row.slice())
}

function penalty(modules: boolean[][]): number {
  const size = modules.length
  let score = 0
  for (let r = 0; r < size; r++) {
    let run = 1
    for (let c = 1; c < size; c++) {
      if (modules[r]![c] === modules[r]![c - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) score += 3 + (run - 5)
  }
  for (let c = 0; c < size; c++) {
    let run = 1
    for (let r = 1; r < size; r++) {
      if (modules[r]![c] === modules[r - 1]![c]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) score += 3 + (run - 5)
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c]
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) score += 3
    }
  }
  return score
}

export function encodeQrModules(text: string): boolean[][] {
  const data = new TextEncoder().encode(text)
  const version = chooseVersion(data.length)
  const size = sizeOf(version)
  const codewords = interleave(bytesToCodewords(data, version), version)
  const reservedMap = reserved(size, version)

  let best: boolean[][] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (let mask = 0; mask < 8; mask++) {
    const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
    placeFinders(modules, size)
    placeTiming(modules, size)
    placeAlignment(modules, version, size)
    placeFormat(modules, size, mask)
    placeVersion(modules, version, size)
    placeData(modules, reservedMap, codewords, mask)
    const score = penalty(modules)
    if (score < bestScore) {
      bestScore = score
      best = cloneGrid(modules)
    }
  }
  return best!
}

export function renderQrSvg(text: string, modulePx = 3): string {
  const modules = encodeQrModules(text)
  const size = modules.length
  const quiet = 4
  const dim = (size + quiet * 2) * modulePx
  const rects: string[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r]![c]) continue
      const x = (c + quiet) * modulePx
      const y = (r + quiet) * modulePx
      rects.push(`<rect x="${x}" y="${y}" width="${modulePx}" height="${modulePx}"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges" data-qr-payload="${escapeAttr(text)}"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects.join("")}</g></svg>`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}
