/**
 * Contador HUB · Pacote do Contador — segurança, integridade e limites (puro).
 *
 * GOAL 008 · 008B. Responsabilidades:
 * 1. Hash SHA-256 determinístico do conteúdo (integridade do manifesto).
 * 2. Neutralização de injeção de fórmula em CSV (planilhas do contador).
 * 3. Guarda anti-vazamento: `storeId` é permitido SOMENTE dentro de `manifest.json`
 *    (campo `competencia.storeId`); proibido em CSVs, Markdown e placeholders.
 * 4. Limites explícitos + `PacoteLimiteExcedidoError` (endpoint responde 413).
 * 5. Saneamento de `storeId` para uso em nome de arquivo.
 */
import { createHash } from "node:crypto"
import type { ArquivoPacote } from "./tipos"

/**
 * Limites defensivos. O pacote é competência-a-competência (dados mensais) e o conteúdo
 * deriva de linhas saneadas — NÃO foram medidos em banco de produção neste ambiente
 * (sem DB), então são tetos folgados sobre o volume mensal esperado. Exceder → 413.
 */
export const MAX_REGISTROS_POR_FONTE = 50_000
export const MAX_BYTES_DESCOMPACTADO = 25 * 1024 * 1024 // 25 MB
export const MAX_BYTES_ZIP = 10 * 1024 * 1024 // 10 MB
/** 14 da estrutura fixa do 008B + `00-FECHAMENTO/snapshot.json` do fechamento (012A). */
export const MAX_ARQUIVOS_PACOTE = 15
/** Teto lógico de duração (informativo; aplicado por quem orquestra a geração). */
export const TIMEOUT_LOGICO_MS = 30_000

const MANIFESTO_CAMINHO = "manifest.json"

export class PacoteInseguroError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PacoteInseguroError"
  }
}

export class PacoteLimiteExcedidoError extends Error {
  readonly limite: string
  constructor(limite: string, message: string) {
    super(message)
    this.name = "PacoteLimiteExcedidoError"
    this.limite = limite
  }
}

/** Estouro do teto lógico de duração da geração (endpoint responde 503). */
export class PacoteTimeoutError extends Error {
  readonly limiteMs: number
  constructor(limiteMs: number, message: string) {
    super(message)
    this.name = "PacoteTimeoutError"
    this.limiteMs = limiteMs
  }
}

/**
 * Aplica o teto lógico de duração: corre a geração contra um timer. Se estourar antes
 * de concluir, rejeita com `PacoteTimeoutError`. É "lógico" porque NÃO cancela as
 * queries Prisma em andamento — apenas limita o tempo de resposta ao cliente.
 *
 * A promessa interna pode assentar depois do estouro; seus handlers já estão anexados
 * (sem `unhandledRejection`) e o assentamento tardio é ignorado (`liquidado`). O timer é
 * `unref`-ado quando possível para não segurar o event loop.
 */
export async function executarComTimeoutLogico<T>(
  executar: () => Promise<T>,
  limiteMs: number = TIMEOUT_LOGICO_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let liquidado = false
    const timer = setTimeout(() => {
      if (liquidado) return
      liquidado = true
      reject(new PacoteTimeoutError(limiteMs, `A geração excedeu o teto lógico de ${limiteMs} ms.`))
    }, limiteMs)
    const comUnref = timer as unknown as { unref?: () => void }
    if (typeof comUnref.unref === "function") comUnref.unref()
    executar().then(
      (valor) => {
        if (liquidado) return
        liquidado = true
        clearTimeout(timer)
        resolve(valor)
      },
      (erro) => {
        if (liquidado) return
        liquidado = true
        clearTimeout(timer)
        reject(erro)
      },
    )
  })
}

/** SHA-256 (hex) do texto em UTF-8 — mesma codificação que o ZIP usa ao gravar a string. */
export function sha256Hex(conteudo: string): string {
  return createHash("sha256").update(Buffer.from(conteudo, "utf8")).digest("hex")
}

/** Tamanho em bytes do texto em UTF-8 (coerente com o hash e o ZIP). */
export function bytesUtf8(conteudo: string): number {
  return Buffer.byteLength(conteudo, "utf8")
}

/**
 * Célula que começa com `= + - @` (ou TAB/CR) pode ser interpretada como fórmula
 * pelo Excel/Sheets. Prefixamos com apóstrofo para forçar texto. Aplicar SOMENTE em
 * células textuais — nunca em números (quebraria negativos legítimos).
 */
const PREFIXO_FORMULA = /^[=+\-@\t\r]/
export function neutralizarFormula(valor: string): string {
  return PREFIXO_FORMULA.test(valor) ? `'${valor}` : valor
}

/**
 * Sanea `storeId` para uso em nome de arquivo: apenas ASCII `[A-Za-z0-9_-]`, sem barra,
 * dois-pontos, `..` ou caminho absoluto; tamanho limitado. Vazio → "loja".
 */
export function sanitizarStoreIdParaArquivo(storeId: string): string {
  const limpo = (storeId ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return limpo || "loja"
}

const SENTINELAS_PROIBIDAS = [
  '"payload"',
  '"stack"',
  '"sessionToken"',
  "Authorization:",
  "Bearer ",
] as const

/**
 * Guarda anti-vazamento. `storeId` só pode aparecer em `manifest.json`. Nenhum arquivo
 * pode conter sentinelas de PII/segredo. Falha fechado (conteúdo é 100% controlado).
 */
export function assertPacoteSeguro(
  arquivos: readonly ArquivoPacote[],
  opcoes: Readonly<{ storeId?: string | null }> = {},
): void {
  if (arquivos.length > MAX_ARQUIVOS_PACOTE) {
    throw new PacoteInseguroError(
      `Pacote excedeu o limite de ${MAX_ARQUIVOS_PACOTE} arquivos (${arquivos.length}).`,
    )
  }

  const storeId = (opcoes.storeId ?? "").trim()

  for (const arquivo of arquivos) {
    const ehManifesto = arquivo.caminho === MANIFESTO_CAMINHO
    if (storeId && !ehManifesto && arquivo.conteudo.includes(storeId)) {
      throw new PacoteInseguroError(
        `Arquivo "${arquivo.caminho}" contém o storeId fora do manifesto (vazamento).`,
      )
    }
    for (const sentinela of SENTINELAS_PROIBIDAS) {
      if (arquivo.conteudo.includes(sentinela)) {
        throw new PacoteInseguroError(
          `Arquivo "${arquivo.caminho}" contém sentinela proibida (${sentinela}).`,
        )
      }
    }
  }
}

/** Aborta se uma fonte excede o teto de registros (endpoint → 413). */
export function assertRegistrosFonte(nome: string, registros: number): void {
  if (registros > MAX_REGISTROS_POR_FONTE) {
    throw new PacoteLimiteExcedidoError(
      "registros_por_fonte",
      `Fonte "${nome}" excedeu ${MAX_REGISTROS_POR_FONTE} registros (${registros}).`,
    )
  }
}

/** Aborta se o conteúdo descompactado excede o teto (endpoint → 413). Não trunca. */
export function assertBytesDescompactados(arquivos: readonly ArquivoPacote[]): number {
  let total = 0
  for (const a of arquivos) total += bytesUtf8(a.conteudo)
  if (total > MAX_BYTES_DESCOMPACTADO) {
    throw new PacoteLimiteExcedidoError(
      "bytes_descompactados",
      `Conteúdo descompactado excedeu ${MAX_BYTES_DESCOMPACTADO} bytes (${total}).`,
    )
  }
  return total
}

/** Aborta se o ZIP final excede o teto (endpoint → 413). */
export function assertBytesZip(bytes: number): void {
  if (bytes > MAX_BYTES_ZIP) {
    throw new PacoteLimiteExcedidoError(
      "bytes_zip",
      `ZIP final excedeu ${MAX_BYTES_ZIP} bytes (${bytes}).`,
    )
  }
}
