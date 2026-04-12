/**
 * Extrai texto, áudio e remetente de payloads comuns (Evolution API / Baileys).
 */

export type InboundExtract = {
  fromDigits: string
  text?: string
  audioBase64?: string
  audioMime?: string
  audioUrl?: string
  imageBase64?: string
  imageMime?: string
  imageUrl?: string
  /** Resposta a botões interativos (Evolution / Baileys). */
  buttonId?: string
  buttonDisplayText?: string
}

function jidToDigits(jid: string): string {
  const base = jid.split("@")[0] ?? ""
  return base.replace(/\D/g, "")
}

function walk(o: unknown, path: string[]): unknown {
  let cur: unknown = o
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** Aceita message object com conversation, extendedTextMessage, audioMessage, etc. */
export function extractFromEvolutionLikePayload(body: unknown): InboundExtract | null {
  if (body == null || typeof body !== "object") return null
  const b = body as Record<string, unknown>

  const data =
    (b.data as Record<string, unknown> | undefined) ??
    (b.event === "messages.upsert" ? (b as { data?: unknown }).data : undefined)
  const payload = (typeof data === "object" && data ? data : b) as Record<string, unknown>

  const key = payload.key as Record<string, unknown> | undefined
  const remoteJid =
    (key?.remoteJid as string) ||
    (payload.remoteJid as string) ||
    (walk(payload, ["key", "remoteJid"]) as string | undefined)

  if (!remoteJid || typeof remoteJid !== "string") return null

  const fromDigits = jidToDigits(remoteJid)
  if (fromDigits.length < 10) return null

  const messagesUnknown = payload.messages
  let nestedFromList: unknown
  if (Array.isArray(messagesUnknown) && messagesUnknown.length > 0) {
    const first = messagesUnknown[0]
    if (first != null && typeof first === "object") {
      nestedFromList = (first as Record<string, unknown>).message
    }
  }
  const msg = (payload.message ?? nestedFromList) as Record<string, unknown> | undefined
  const message = typeof msg === "object" && msg ? msg : (payload as Record<string, unknown>)

  let text: string | undefined
  if (typeof message.conversation === "string") text = message.conversation
  else if (message.extendedTextMessage && typeof message.extendedTextMessage === "object") {
    const et = message.extendedTextMessage as { text?: string }
    if (typeof et.text === "string") text = et.text
  }

  const audio = message.audioMessage as Record<string, unknown> | undefined
  let audioBase64: string | undefined
  let audioMime: string | undefined
  let audioUrl: string | undefined
  if (audio && typeof audio === "object") {
    if (typeof audio.base64 === "string") audioBase64 = audio.base64
    if (typeof audio.mimetype === "string") audioMime = audio.mimetype
    if (typeof audio.url === "string") audioUrl = audio.url
  }

  if (typeof payload.base64 === "string" && !text) {
    audioBase64 = audioBase64 ?? payload.base64
  }

  const image = message.imageMessage as Record<string, unknown> | undefined
  let imageBase64: string | undefined
  let imageMime: string | undefined
  let imageUrl: string | undefined
  if (image && typeof image === "object") {
    if (typeof image.base64 === "string") imageBase64 = image.base64
    if (typeof image.mimetype === "string") imageMime = image.mimetype
    if (typeof image.url === "string") imageUrl = image.url
  }

  let buttonId: string | undefined
  let buttonDisplayText: string | undefined
  const br = message.buttonsResponseMessage as
    | { selectedButtonId?: string; selectedDisplayText?: string }
    | undefined
  if (br && typeof br === "object") {
    if (typeof br.selectedButtonId === "string") buttonId = br.selectedButtonId
    if (typeof br.selectedDisplayText === "string") buttonDisplayText = br.selectedDisplayText
  }
  const tbr = message.templateButtonReplyMessage as { selectedId?: string; selectedDisplayText?: string } | undefined
  if (tbr && typeof tbr === "object") {
    if (typeof tbr.selectedId === "string") buttonId = buttonId ?? tbr.selectedId
    if (typeof tbr.selectedDisplayText === "string")
      buttonDisplayText = buttonDisplayText ?? tbr.selectedDisplayText
  }
  const ir = message.interactiveResponseMessage as
    | {
        body?: { text?: string }
        nativeFlowResponseMessage?: { name?: string; paramsJson?: string }
      }
    | undefined
  if (ir?.nativeFlowResponseMessage?.name && !buttonId) {
    buttonId = ir.nativeFlowResponseMessage.name
  }

  return {
    fromDigits,
    text,
    audioBase64,
    audioMime,
    audioUrl,
    imageBase64,
    imageMime,
    imageUrl,
    buttonId,
    buttonDisplayText,
  }
}
