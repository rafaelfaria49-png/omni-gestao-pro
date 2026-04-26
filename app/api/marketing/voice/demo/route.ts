import { NextResponse } from "next/server"

export const runtime = "nodejs"

/** WAV curto (~0,12s) para prévia do player (mock). */
function shortToneWav(): Uint8Array {
  const sampleRate = 8000
  const duration = 0.12
  const numSamples = Math.floor(sampleRate * duration)
  const dataSize = numSamples
  const out = new Uint8Array(44 + dataSize)
  const dv = new DataView(out.buffer)
  const w = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[pos + i] = s.charCodeAt(i)
  }
  w(0, "RIFF")
  dv.setUint32(4, 36 + dataSize, true)
  w(8, "WAVE")
  w(12, "fmt ")
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate, true)
  dv.setUint16(32, 1, true)
  dv.setUint16(34, 8, true)
  w(36, "data")
  dv.setUint32(40, dataSize, true)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const v = Math.sin(t * 440 * 2 * Math.PI) * 0.35
    out[44 + i] = Math.max(0, Math.min(255, Math.floor(128 + v * 127)))
  }
  return out
}

export async function GET() {
  const bytes = shortToneWav()
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
