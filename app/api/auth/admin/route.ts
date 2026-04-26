import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"

const COOKIE_NAME = "assistec_admin_session"

export async function GET() {
  const jar = await cookies()
  const id = String(jar.get(COOKIE_NAME)?.value || "").trim()
  if (!id) return NextResponse.json({ authenticated: false })
  try {
    await prismaEnsureConnected()
    const u = await prisma.user.findFirst({ where: { id, OR: [{ role: "ADMIN" }, { role: "admin" }] } })
    if (!u) return NextResponse.json({ authenticated: false })
    return NextResponse.json({ authenticated: true, admin: { id: u.id, name: u.name } })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}

export async function POST(request: Request) {
  try {
    let body: { pin?: string } = {}
    try {
      body = (await request.json()) as { pin?: string }
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 })
    }
    const pin = String(body.pin || "").trim()
    if (!pin) return NextResponse.json({ error: "invalid_pin" }, { status: 401 })

    await prismaEnsureConnected()
    const admin = await prisma.user.findFirst({ where: { pin, OR: [{ role: "ADMIN" }, { role: "admin" }] } })
    if (!admin) {
      return NextResponse.json({ error: "invalid_pin" }, { status: 401 })
    }

    const res = NextResponse.json({ ok: true, admin: { id: admin.id, name: admin.name } })
    res.cookies.set({
      name: COOKIE_NAME,
      value: admin.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao autenticar administrador", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
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
