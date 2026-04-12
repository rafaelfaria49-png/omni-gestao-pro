import { cookies } from "next/headers"
import { NextResponse } from "next/server"

const COOKIE_NAME = "assistec_admin_session"

/** PIN padrão para testes; sobrescreva com ASSISTEC_ADMIN_PIN em produção. */
const DEFAULT_ADMIN_PIN = "1234"

function getExpectedPin(): string {
  const p = process.env.ASSISTEC_ADMIN_PIN?.trim()
  if (p && p.length > 0) return p
  return DEFAULT_ADMIN_PIN
}

export async function GET() {
  const jar = await cookies()
  const ok = jar.get(COOKIE_NAME)?.value === "1"
  return NextResponse.json({ authenticated: ok })
}

export async function POST(request: Request) {
  const expected = getExpectedPin()
  let body: { pin?: string } = {}
  try {
    body = (await request.json()) as { pin?: string }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  if (body.pin !== expected) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: "1",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return res
}
