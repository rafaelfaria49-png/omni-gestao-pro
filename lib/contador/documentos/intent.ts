/**
 * Contador HUB · Documentos — autorização de upload ASSINADA e EXPIRADA (GOAL 012E · P1).
 *
 * Problema que este módulo fecha: até o 012C, o `complete` confiava em `documentoId`,
 * `storageRef` e metadados reenviados livremente pelo cliente, e provava posse com
 * `startsWith`/`includes`. Isso permitia apontar o `complete` para o blob de OUTRO
 * documento (bastava escolher um `documentoId` que casasse com qualquer segmento do
 * path alheio) e fazer o servidor ABRIR e, na falha de validação, REMOVER esse blob.
 *
 * Solução: o `upload-intent` emite um token assinado (HMAC-SHA256) que VINCULA no
 * servidor todos os campos que o `complete` precisa. O `complete` não aceita mais
 * nenhum desses campos vindo do cliente como fonte da verdade — só o intent decide.
 *
 * Propriedades:
 *  - **integridade**: HMAC sobre os BYTES exatos do payload transmitido (assina-se o
 *    que se verifica; nenhuma re-serialização no meio, logo nenhuma ambiguidade);
 *  - **expiração**: `exp` epoch-seconds, verificado sempre;
 *  - **escopo**: `storeId` + `userId` vêm da sessão no momento da emissão e são
 *    reconferidos contra a sessão no `complete` (cross-store/cross-user morre aqui);
 *  - **comparação em tempo constante** (`timingSafeEqual`) — sem oráculo de assinatura.
 *
 * O token NUNCA é persistido (nem em `ContadorDocumento`, nem em evento, nem em log):
 * vive só no round-trip HTTP com o navegador. O segredo NUNCA sai deste módulo.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

/** Schema do payload — versionado para que uma mudança de contrato invalide tokens antigos. */
export const INTENT_SCHEMA = "omni.contador.documentos.upload-intent/v1" as const

/**
 * Validade do intent, em segundos.
 *
 * Maior que `UPLOAD_EXPIRACAO_SEG` (120s) de propósito: a URL assinada de PUT precisa
 * apenas ser INICIADA dentro dos 120s, mas um arquivo de 25 MB em link ruim pode
 * levar minutos para terminar — e só depois o `complete` é chamado. 10 minutos cobrem
 * upload lento + confirmação, e ainda mantêm a janela de reuso curta.
 */
export const INTENT_EXPIRACAO_SEG = 600

/** Nome da env que, se presente, tem precedência sobre `AUTH_SECRET`. */
export const ENV_KEY_INTENT_SECRET = "CONTADOR_UPLOAD_INTENT_SECRET" as const

/**
 * Campos VINCULADOS pelo servidor. Todo campo aqui é imutável entre o `upload-intent`
 * e o `complete`: se o cliente reenviar qualquer um deles com valor diferente, o
 * `complete` recusa (não "corrige", não "prefere o intent em silêncio" — recusa).
 */
export type UploadIntentPayload = Readonly<{
  v: typeof INTENT_SCHEMA
  storeId: string
  userId: string
  competencia: string
  competenciaId: string
  documentoId: string
  storageRef: string
  nomeArquivo: string
  mime: string
  bytes: number
  sha256: string
  categoria: string
  versaoDeId: string | null
  exp: number
}>

/** Erro tipado de intent ausente/adulterado/expirado. Mensagem SEGURA (sem token). */
export class UploadIntentInvalidoError extends Error {
  readonly code = "UPLOAD_INTENT_INVALIDO" as const
  /** Motivo curto e não-sensível, para diagnóstico (nunca ecoa o token). */
  readonly motivo: string
  constructor(motivo: string) {
    super("Autorização de upload inválida ou expirada. Reinicie o envio.")
    this.name = "UploadIntentInvalidoError"
    this.motivo = motivo
  }
}

/** Erro tipado de segredo de assinatura ausente — fail-closed, sem revelar valores. */
export class UploadIntentSegredoError extends Error {
  readonly code = "UPLOAD_INTENT_SEGREDO_INDISPONIVEL" as const
  constructor() {
    super(
      `Assinatura de upload indisponível: configure ${ENV_KEY_INTENT_SECRET} ou AUTH_SECRET no ambiente server-side.`,
    )
    this.name = "UploadIntentSegredoError"
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Deriva a chave de assinatura do segredo do ambiente com SEPARAÇÃO DE DOMÍNIO.
 *
 * Reusa `AUTH_SECRET` (já obrigatório em produção) em vez de exigir uma variável nova
 * — provisionar env está fora do escopo desta fase. A derivação por HMAC garante que
 * a chave usada aqui não é o segredo do NextAuth: comprometer uma não entrega a outra,
 * e um token deste módulo nunca é válido em nenhum outro contexto.
 */
function derivarChave(env: EnvLike = process.env): Buffer {
  const base = (env[ENV_KEY_INTENT_SECRET] ?? env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? "").trim()
  if (!base) throw new UploadIntentSegredoError()
  return createHmac("sha256", base).update(INTENT_SCHEMA).digest()
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function deB64url(txt: string): Buffer {
  const pad = txt.length % 4 === 0 ? "" : "=".repeat(4 - (txt.length % 4))
  return Buffer.from(txt.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

function assinar(corpo: string, chave: Buffer): string {
  return b64url(createHmac("sha256", chave).update(corpo).digest())
}

/**
 * Emite o token `<payload>.<assinatura>`.
 *
 * `exp` é calculado aqui (nunca aceito do cliente). O payload é serializado UMA vez e
 * é exatamente essa string que é assinada e transmitida.
 */
export function assinarUploadIntent(
  dados: Omit<UploadIntentPayload, "v" | "exp">,
  agora: Date = new Date(),
  env: EnvLike = process.env,
): string {
  const payload: UploadIntentPayload = {
    v: INTENT_SCHEMA,
    ...dados,
    exp: Math.floor(agora.getTime() / 1000) + INTENT_EXPIRACAO_SEG,
  }
  const corpo = b64url(Buffer.from(JSON.stringify(payload), "utf8"))
  return `${corpo}.${assinar(corpo, derivarChave(env))}`
}

/** Compara assinaturas em tempo constante (evita oráculo por timing). */
function assinaturaConfere(esperada: string, recebida: string): boolean {
  const a = Buffer.from(esperada, "utf8")
  const b = Buffer.from(recebida, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Verifica assinatura, schema, expiração e formato dos campos. Lança
 * `UploadIntentInvalidoError` em qualquer desvio — nunca devolve payload parcial.
 *
 * NÃO confere `storeId`/`userId` contra a sessão: isso é responsabilidade do chamador
 * (o service), que é quem conhece o escopo autenticado.
 */
export function verificarUploadIntent(
  token: unknown,
  agora: Date = new Date(),
  env: EnvLike = process.env,
): UploadIntentPayload {
  const bruto = typeof token === "string" ? token.trim() : ""
  if (!bruto) throw new UploadIntentInvalidoError("ausente")

  const partes = bruto.split(".")
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    throw new UploadIntentInvalidoError("formato")
  }
  const [corpo, assinatura] = partes

  if (!assinaturaConfere(assinar(corpo, derivarChave(env)), assinatura)) {
    throw new UploadIntentInvalidoError("assinatura")
  }

  let payload: UploadIntentPayload
  try {
    payload = JSON.parse(deB64url(corpo).toString("utf8")) as UploadIntentPayload
  } catch {
    throw new UploadIntentInvalidoError("payload")
  }

  if (!payload || payload.v !== INTENT_SCHEMA) throw new UploadIntentInvalidoError("schema")

  const exp = payload.exp
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new UploadIntentInvalidoError("exp")
  }
  if (Math.floor(agora.getTime() / 1000) >= exp) throw new UploadIntentInvalidoError("expirado")

  // Campos obrigatórios: um payload assinado mas incompleto não pode virar documento.
  for (const campo of [
    "storeId",
    "userId",
    "competencia",
    "competenciaId",
    "documentoId",
    "storageRef",
    "nomeArquivo",
    "mime",
    "sha256",
    "categoria",
  ] as const) {
    if (typeof payload[campo] !== "string" || !payload[campo]) {
      throw new UploadIntentInvalidoError(`campo:${campo}`)
    }
  }
  if (typeof payload.bytes !== "number" || !Number.isInteger(payload.bytes) || payload.bytes <= 0) {
    throw new UploadIntentInvalidoError("campo:bytes")
  }
  if (payload.versaoDeId !== null && typeof payload.versaoDeId !== "string") {
    throw new UploadIntentInvalidoError("campo:versaoDeId")
  }

  return Object.freeze(payload)
}
