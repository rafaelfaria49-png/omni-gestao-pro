/**
 * Transcrição via OpenAI Whisper (API oficial).
 * Requer OPENAI_API_KEY no ambiente.
 */

export async function transcribeAudioBuffer(
  buf: Buffer,
  filename: string,
  mime: string
): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("OPENAI_API_KEY não configurada")
  }

  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename)
  form.append("model", "whisper-1")

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Whisper HTTP ${res.status}: ${t.slice(0, 500)}`)
  }

  const j = (await res.json()) as { text?: string }
  return (j.text ?? "").trim()
}
