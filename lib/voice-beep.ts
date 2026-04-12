/**
 * Bips curtos para início/fim da captura de voz (Web Audio API).
 */

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  return new Ctx()
}

export function playVoiceBeep(kind: "start" | "end"): void {
  try {
    const ctx = getCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = kind === "start" ? 920 : 520
    g.gain.setValueAtTime(0.001, ctx.currentTime)
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kind === "start" ? 0.1 : 0.08))
    osc.connect(g)
    g.connect(ctx.destination)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + (kind === "start" ? 0.11 : 0.09))
    osc.onended = () => {
      ctx.close().catch(() => {})
    }
  } catch {
    /* ignore */
  }
}
