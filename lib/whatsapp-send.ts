/**
 * Envio de texto via Evolution API (ou compatível).
 * Variáveis: WHATSAPP_API_BASE, WHATSAPP_API_KEY, WHATSAPP_INSTANCE
 */

export async function sendWhatsAppText(
  toDigits: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = process.env.WHATSAPP_API_BASE?.replace(/\/$/, "")
  const key = process.env.WHATSAPP_API_KEY
  const instance = process.env.WHATSAPP_INSTANCE
  if (!base || !key || !instance) {
    return { ok: false, error: "Integração WhatsApp não configurada (env)" }
  }

  const n = toDigits.replace(/\D/g, "")
  if (n.length < 10) {
    return { ok: false, error: "Número inválido" }
  }

  const url = `${base}/message/sendText/${instance}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
    },
    body: JSON.stringify({ number: n, text }),
  })

  if (!res.ok) {
    const t = await res.text()
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 400)}` }
  }

  return { ok: true }
}

export type WhatsAppReplyButton = {
  id: string
  displayText: string
}

/**
 * Botões interativos (Evolution API v2 — tipo `reply`).
 * Documentação: POST /message/sendButtons/{instance}
 */
export async function sendWhatsAppButtons(
  toDigits: string,
  opts: {
    title: string
    description: string
    footer: string
    buttons: WhatsAppReplyButton[]
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = process.env.WHATSAPP_API_BASE?.replace(/\/$/, "")
  const key = process.env.WHATSAPP_API_KEY
  const instance = process.env.WHATSAPP_INSTANCE
  if (!base || !key || !instance) {
    return { ok: false, error: "Integração WhatsApp não configurada (env)" }
  }

  const n = toDigits.replace(/\D/g, "")
  if (n.length < 10) {
    return { ok: false, error: "Número inválido" }
  }

  if (opts.buttons.length < 1 || opts.buttons.length > 3) {
    return { ok: false, error: "Use entre 1 e 3 botões (limite WhatsApp)" }
  }

  const url = `${base}/message/sendButtons/${instance}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
    },
    body: JSON.stringify({
      number: n,
      title: opts.title.slice(0, 60),
      description: opts.description.slice(0, 1024),
      footer: opts.footer.slice(0, 60),
      buttons: opts.buttons.map((b) => ({
        type: "reply",
        displayText: b.displayText.slice(0, 25),
        id: b.id.slice(0, 256),
      })),
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 400)}` }
  }

  return { ok: true }
}
