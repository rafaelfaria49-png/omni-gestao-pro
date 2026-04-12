import { NextResponse } from "next/server"
import { Socket } from "net"

/**
 * Envia bytes ESC/POS por TCP para impressora raw (JetDirect / porta 9100).
 *
 * THERMAL_PRINT_HOST (padrão 127.0.0.1) · THERMAL_PRINT_PORT (padrão 9100)
 *
 * Se THERMAL_PRINT_HTTP_URL estiver definido (ex.: bridge HTTP), usa POST em vez de TCP.
 *
 * Uso apenas em ambiente confiável; em produção restrinja a API.
 */
function sendTcp(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = new Socket()
    const t = setTimeout(() => {
      s.destroy()
      reject(new Error("Timeout ao enviar para impressora"))
    }, 12_000)
    s.once("error", (e) => {
      clearTimeout(t)
      reject(e)
    })
    s.connect(port, host, () => {
      s.write(data, (err) => {
        if (err) {
          clearTimeout(t)
          s.destroy()
          reject(err)
          return
        }
        s.end()
      })
    })
    s.once("close", () => {
      clearTimeout(t)
      resolve()
    })
  })
}

export async function POST(req: Request) {
  let body: { data?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 })
  }
  if (!body.data || typeof body.data !== "string") {
    return NextResponse.json({ ok: false, error: "Campo data (base64) obrigatório" }, { status: 400 })
  }

  let buf: Buffer
  try {
    buf = Buffer.from(body.data, "base64")
  } catch {
    return NextResponse.json({ ok: false, error: "Base64 inválido" }, { status: 400 })
  }

  const httpBridge = process.env.THERMAL_PRINT_HTTP_URL?.trim()

  try {
    if (httpBridge) {
      const r = await fetch(httpBridge, {
        method: "POST",
        body: buf,
        headers: { "Content-Type": "application/octet-stream" },
        cache: "no-store",
      })
      if (!r.ok) {
        const t = await r.text().catch(() => "")
        return NextResponse.json(
          { ok: false, error: `Bridge HTTP: ${r.status} ${t || r.statusText}` },
          { status: 502 }
        )
      }
      return NextResponse.json({ ok: true })
    }

    const host = process.env.THERMAL_PRINT_HOST || "127.0.0.1"
    const port = parseInt(process.env.THERMAL_PRINT_PORT || "9100", 10)
    if (Number.isNaN(port) || port < 1) {
      return NextResponse.json({ ok: false, error: "THERMAL_PRINT_PORT inválido" }, { status: 500 })
    }
    await sendTcp(host, port, buf)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
