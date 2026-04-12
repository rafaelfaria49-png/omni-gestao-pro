/**
 * Tempo confiável para checagem de vencimento: API externa com fallback ao relógio do runtime (Edge/servidor).
 * O cliente não controla este valor — evita burlar vencimento alterando data do SO.
 */
export async function getTrustedTimeMs(): Promise<number> {
  try {
    const ctrl = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(2800)
      : undefined
    const r = await fetch("https://worldtimeapi.org/api/ip", {
      cache: "no-store",
      ...(ctrl ? { signal: ctrl } : {}),
    })
    if (r.ok) {
      const j = (await r.json()) as { unixtime?: number }
      if (typeof j.unixtime === "number") return j.unixtime * 1000
    }
  } catch {
    /* fallback */
  }
  return Date.now()
}
