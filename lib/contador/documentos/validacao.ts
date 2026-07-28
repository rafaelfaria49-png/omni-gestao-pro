/**
 * Contador HUB · Documentos — validação de arquivo e montagem de path (GOAL 010).
 *
 * Puro (sem IO): sanitização de nome, allowlist de extensão/MIME, verificação de
 * magic bytes, validação de texto (UTF-8, sem NUL, sem HTML/SVG/JS) e montagem do
 * `storageRef` privado. Não executa, não renderiza e não descompacta conteúdo.
 *
 * Camadas (GOAL 010 · Etapa 6):
 *   1. extensão  2. MIME declarado  3. MIME/assinatura do conteúdo real
 *   4. magic bytes  5. tamanho real  6. hash real (fora deste módulo)
 */
import { MAX_BYTES_DOCUMENTO } from "./config"

/** Extensões permitidas (decisão aprovada 010B). `jpeg` é alias de `jpg`. */
export type ExtensaoPermitida =
  | "pdf"
  | "xml"
  | "csv"
  | "xlsx"
  | "png"
  | "jpg"
  | "ofx"
  | "txt"
  | "zip"

/** Família de validação de conteúdo por extensão. */
type Familia = "pdf" | "png" | "jpg" | "zip" | "texto"

type RegraExtensao = Readonly<{
  familia: Familia
  /** MIMEs declarados aceitos. Para famílias de texto a checagem é tolerante (ver abaixo). */
  mimes: readonly string[]
}>

const REGRAS: Record<ExtensaoPermitida, RegraExtensao> = {
  pdf: { familia: "pdf", mimes: ["application/pdf"] },
  png: { familia: "png", mimes: ["image/png"] },
  jpg: { familia: "jpg", mimes: ["image/jpeg", "image/jpg"] },
  xlsx: {
    familia: "zip",
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  zip: { familia: "zip", mimes: ["application/zip", "application/x-zip-compressed"] },
  xml: { familia: "texto", mimes: ["application/xml", "text/xml"] },
  csv: { familia: "texto", mimes: ["text/csv", "application/csv", "text/plain"] },
  ofx: {
    familia: "texto",
    mimes: ["application/x-ofx", "application/ofx", "text/plain", "application/octet-stream"],
  },
  txt: { familia: "texto", mimes: ["text/plain"] },
}

/** Alias de extensão → canônica. */
const ALIAS_EXT: Record<string, ExtensaoPermitida> = { jpeg: "jpg" }

/** Erro tipado de validação. `campo` ajuda a rota a devolver 400/422 com mensagem segura. */
export class DocumentoValidacaoError extends Error {
  readonly code = "DOCUMENTO_INVALIDO" as const
  readonly campo: string
  constructor(campo: string, message: string) {
    super(message)
    this.name = "DocumentoValidacaoError"
    this.campo = campo
  }
}

const NOME_MAX = 180
/** Nomes de dispositivo reservados no Windows (case-insensitive), sem extensão. */
const RESERVADOS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

// Caracteres de controle C0 (inclui NUL) + DEL.
const CONTROLE_RE = /[\x00-\x1f\x7f]/

/**
 * Sanea o nome do arquivo para uso seguro em path de storage.
 * Bloqueia path traversal (`..`, barras), caracteres de controle, nomes vazios,
 * nomes reservados e comprimento excessivo; colapsa a extensão dupla enganosa.
 * Lança `DocumentoValidacaoError` quando o nome não pode ser tornado seguro.
 */
export function sanitizarNomeArquivo(bruto: unknown): string {
  if (typeof bruto !== "string") {
    throw new DocumentoValidacaoError("nomeArquivo", "Nome de arquivo ausente.")
  }
  // Remove qualquer componente de diretório (Unix e Windows) — fica só o basename.
  const semDir = bruto.split(/[\\/]/).pop() ?? ""
  if (CONTROLE_RE.test(semDir)) {
    throw new DocumentoValidacaoError("nomeArquivo", "Nome de arquivo contém caracteres de controle.")
  }
  let nome = semDir
    .normalize("NFC")
    .replace(/[<>:"|?*]/g, "_") // caracteres proibidos em nomes de arquivo
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // sem componente iniciando por ponto (`.`, `..`, ocultos)

  if (nome === "" || nome === "." || nome === "..") {
    throw new DocumentoValidacaoError("nomeArquivo", "Nome de arquivo inválido.")
  }

  const pontoIdx = nome.lastIndexOf(".")
  const base = pontoIdx > 0 ? nome.slice(0, pontoIdx) : nome
  if (RESERVADOS.has(base.toLowerCase())) {
    throw new DocumentoValidacaoError("nomeArquivo", "Nome de arquivo reservado pelo sistema.")
  }

  if (nome.length > NOME_MAX) {
    // Preserva a extensão ao truncar.
    const ext = pontoIdx > 0 ? nome.slice(pontoIdx) : ""
    const baseCorte = base.slice(0, Math.max(1, NOME_MAX - ext.length))
    nome = `${baseCorte}${ext}`
  }
  return nome
}

/** Extrai e valida a extensão final; retorna a forma canônica. */
export function validarExtensao(nomeSanitizado: string): ExtensaoPermitida {
  const idx = nomeSanitizado.lastIndexOf(".")
  const extRaw = idx > 0 ? nomeSanitizado.slice(idx + 1).toLowerCase() : ""
  if (!extRaw) {
    throw new DocumentoValidacaoError("nomeArquivo", "Arquivo sem extensão reconhecível.")
  }
  const canon = ALIAS_EXT[extRaw] ?? (extRaw as ExtensaoPermitida)
  if (!(canon in REGRAS)) {
    throw new DocumentoValidacaoError("nomeArquivo", `Extensão não permitida: .${extRaw}`)
  }
  return canon
}

/** Confere o MIME declarado contra a extensão. Texto é tolerante a `text/*`. */
export function validarMimeDeclarado(ext: ExtensaoPermitida, mimeDeclarado: unknown): string {
  const mime =
    typeof mimeDeclarado === "string" ? mimeDeclarado.trim().toLowerCase().split(";")[0] : ""
  if (!mime) throw new DocumentoValidacaoError("mime", "MIME declarado ausente.")
  const regra = REGRAS[ext]
  const aceito = regra.mimes.includes(mime) || (regra.familia === "texto" && mime.startsWith("text/"))
  if (!aceito) {
    throw new DocumentoValidacaoError("mime", `MIME incompatível com .${ext}: ${mime}`)
  }
  return mime
}

/** Valida o tamanho declarado/real contra o teto e rejeita arquivo vazio. */
export function validarTamanho(bytes: unknown, campo = "bytes"): number {
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    throw new DocumentoValidacaoError(campo, "Tamanho de arquivo inválido ou vazio.")
  }
  if (bytes > MAX_BYTES_DOCUMENTO) {
    throw new DocumentoValidacaoError(
      campo,
      `Arquivo excede o limite de ${Math.floor(MAX_BYTES_DOCUMENTO / (1024 * 1024))} MB.`,
    )
  }
  return bytes
}

/* ─────────────────── validação de conteúdo real (magic bytes) ─────────────────── */

function comecaCom(buf: Buffer, assinatura: readonly number[]): boolean {
  if (buf.length < assinatura.length) return false
  for (let i = 0; i < assinatura.length; i++) if (buf[i] !== assinatura[i]) return false
  return true
}

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  // ZIP (também XLSX): local file header, empty archive ou spanned.
  zip: [0x50, 0x4b, 0x03, 0x04],
  zipEmpty: [0x50, 0x4b, 0x05, 0x06],
  zipSpanned: [0x50, 0x4b, 0x07, 0x08],
} as const

/**
 * Valida que o CONTEÚDO real bate com a extensão (magic bytes p/ binários; texto
 * UTF-8 sem NUL e sem HTML/SVG/JS p/ texto). Lança `DocumentoValidacaoError`.
 */
export function validarConteudoReal(ext: ExtensaoPermitida, buf: Buffer): void {
  if (buf.length === 0) {
    throw new DocumentoValidacaoError("conteudo", "Arquivo vazio.")
  }
  const familia = REGRAS[ext].familia
  switch (familia) {
    case "pdf":
      if (!comecaCom(buf, MAGIC.pdf)) throw assinaturaInvalida(ext)
      return
    case "png":
      if (!comecaCom(buf, MAGIC.png)) throw assinaturaInvalida(ext)
      return
    case "jpg":
      if (!comecaCom(buf, MAGIC.jpg)) throw assinaturaInvalida(ext)
      return
    case "zip":
      if (
        !comecaCom(buf, MAGIC.zip) &&
        !comecaCom(buf, MAGIC.zipEmpty) &&
        !comecaCom(buf, MAGIC.zipSpanned)
      ) {
        throw assinaturaInvalida(ext)
      }
      return
    case "texto":
      validarTexto(ext, buf)
      return
  }
}

function assinaturaInvalida(ext: ExtensaoPermitida): DocumentoValidacaoError {
  return new DocumentoValidacaoError("conteudo", `Conteúdo não corresponde a um arquivo .${ext} válido.`)
}

/** Decodifica UTF-8 de forma estrita; lança em bytes inválidos. */
function decodificarUtf8Estrito(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf)
  } catch {
    throw new DocumentoValidacaoError("conteudo", "Arquivo de texto não está em UTF-8 válido.")
  }
}

function validarTexto(ext: ExtensaoPermitida, buf: Buffer): void {
  if (buf.includes(0x00)) {
    throw new DocumentoValidacaoError("conteudo", "Arquivo de texto contém bytes NUL.")
  }
  const texto = decodificarUtf8Estrito(buf)
  const head = texto.slice(0, 4096).replace(/^\uFEFF/, "").trimStart().toLowerCase()

  // Bloqueia HTML / SVG / JavaScript embutido (independe da extensão declarada).
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.includes("<svg") ||
    head.includes("<script")
  ) {
    throw new DocumentoValidacaoError("conteudo", "Conteúdo HTML/SVG/script não é permitido.")
  }

  if (ext === "xml") {
    if (!head.startsWith("<?xml") && !head.startsWith("<")) {
      throw new DocumentoValidacaoError("conteudo", "Conteúdo não parece um XML válido.")
    }
  } else if (ext === "ofx") {
    if (!head.includes("ofx")) {
      throw new DocumentoValidacaoError("conteudo", "Conteúdo não parece um extrato OFX.")
    }
  }
  // csv/txt: qualquer texto UTF-8 sem NUL e sem HTML/SVG/JS é aceito.
}

/* ─────────────────────────── montagem do storageRef ─────────────────────────── */

/** Sanea um segmento de path (storeId/documentoId): ASCII seguro, sem barra nem `..`. */
export function sanitizarSegmentoPath(valor: string, rotulo: string): string {
  const limpo = (valor ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  if (!limpo) {
    throw new DocumentoValidacaoError(rotulo, `Segmento de caminho inválido: ${rotulo}.`)
  }
  return limpo
}

/**
 * Monta o `storageRef` privado canônico:
 *   `contador/{storeId}/{aaaa-mm}/{documentoId}/{nomeSanitizado}`
 * `aaaaMm` deve vir no formato `AAAA-MM`.
 */
export function montarStorageRef(params: {
  storeId: string
  aaaaMm: string
  documentoId: string
  nomeSanitizado: string
}): string {
  const storeSeg = sanitizarSegmentoPath(params.storeId, "storeId")
  const docSeg = sanitizarSegmentoPath(params.documentoId, "documentoId")
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.aaaaMm)) {
    throw new DocumentoValidacaoError("competencia", "Competência inválida para o caminho (AAAA-MM).")
  }
  // O nome já vem saneado; garante ausência de barra remanescente.
  if (/[\\/]/.test(params.nomeSanitizado)) {
    throw new DocumentoValidacaoError("nomeArquivo", "Nome de arquivo com separador de caminho.")
  }
  return `contador/${storeSeg}/${params.aaaaMm}/${docSeg}/${params.nomeSanitizado}`
}

/**
 * Confere que um `storageRef` é EXATAMENTE o path canônico dos parâmetros dados.
 *
 * Substitui (GOAL 012E · P1) a checagem anterior por `startsWith`/`includes`, que era
 * insegura: qualquer path que começasse com o prefixo da loja e contivesse o
 * `documentoId` como segmento passava — inclusive o path de OUTRO documento, bastando
 * escolher um `documentoId` que casasse com um segmento alheio (ex.: `2026-06`).
 * Isso dava ao `complete` um alvo arbitrário para abrir e remover.
 *
 * Aqui não há prefixo nem substring: reconstrói-se o path canônico e compara-se por
 * IGUALDADE ESTRITA. Um `storageRef` que não seja byte-a-byte o path esperado é falso.
 */
export function storageRefCanonicoConfere(
  storageRef: string,
  params: {
    storeId: string
    aaaaMm: string
    documentoId: string
    nomeSanitizado: string
  },
): boolean {
  let canonico: string
  try {
    canonico = montarStorageRef(params)
  } catch {
    // Parâmetros que nem montam path canônico jamais autorizam um ref.
    return false
  }
  return storageRef === canonico
}
