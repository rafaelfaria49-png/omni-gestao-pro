import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"
import {
  STAFF_ROLE_COOKIE,
  STAFF_SESSION_COOKIE,
  isStaffAppRole,
  type StaffAppRole,
} from "@/lib/staff-session"

const ADMIN_COOKIE = "assistec_admin_session"

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
}

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set({
    name,
    value: "",
    ...COOKIE_BASE,
    maxAge: 0,
  })
}

export async function GET() {
  const jar = await cookies()
  const session = String(jar.get(STAFF_SESSION_COOKIE)?.value || "").trim()
  const roleRaw = String(jar.get(STAFF_ROLE_COOKIE)?.value || "").trim()
  if (!session || !isStaffAppRole(roleRaw)) {
    return NextResponse.json({ ok: false as const })
  }
  return NextResponse.json({ ok: true as const, role: roleRaw as StaffAppRole })
}

export async function POST(request: Request) {
  try {
    let body: { mode?: string; pin?: string } = {}
    try {
      body = (await request.json()) as { mode?: string; pin?: string }
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 })
    }
    const mode = String(body.mode || "").trim().toUpperCase()
    const pin = String(body.pin || "").trim()
    if (!pin) return NextResponse.json({ error: "invalid_pin" }, { status: 401 })
    if (mode !== "ADMIN" && mode !== "GERENTE" && mode !== "VENDEDOR") {
      return NextResponse.json({ error: "invalid_mode" }, { status: 400 })
    }

    await prismaEnsureConnected()

    if (mode === "ADMIN") {
      const admin = await prisma.user.findFirst({ where: { pin, OR: [{ role: "ADMIN" }, { role: "admin" }] } })
      if (!admin) return NextResponse.json({ error: "invalid_pin" }, { status: 401 })

      const token = crypto.randomUUID()
      const res = NextResponse.json({ ok: true as const, role: "ADMIN" as const })
      res.cookies.set({ name: STAFF_SESSION_COOKIE, value: token, ...COOKIE_BASE })
      res.cookies.set({ name: STAFF_ROLE_COOKIE, value: "ADMIN", ...COOKIE_BASE })
      res.cookies.set({ name: ADMIN_COOKIE, value: admin.id, ...COOKIE_BASE })
      return res
    }

    if (mode === "VENDEDOR") {
      const u = await prisma.user.findFirst({
        where: { pin, OR: [{ role: "CAIXA" }, { role: "caixa" }] },
      })
      if (!u) return NextResponse.json({ error: "invalid_pin" }, { status: 401 })

      const token = crypto.randomUUID()
      const res = NextResponse.json({ ok: true as const, role: "VENDEDOR" as const })
      res.cookies.set({ name: STAFF_SESSION_COOKIE, value: token, ...COOKIE_BASE })
      res.cookies.set({ name: STAFF_ROLE_COOKIE, value: "VENDEDOR", ...COOKIE_BASE })
      clearCookie(res, ADMIN_COOKIE)
      return res
    }

    // GERENTE
    const envPin = String(process.env.ASSISTEC_GERENTE_PIN || "").trim()
    if (envPin && pin === envPin) {
      const token = crypto.randomUUID()
      const res = NextResponse.json({ ok: true as const, role: "GERENTE" as const })
      res.cookies.set({ name: STAFF_SESSION_COOKIE, value: token, ...COOKIE_BASE })
      res.cookies.set({ name: STAFF_ROLE_COOKIE, value: "GERENTE", ...COOKIE_BASE })
      clearCookie(res, ADMIN_COOKIE)
      return res
    }

    const gerente = await prisma.user.findFirst({
      where: { pin, OR: [{ role: "GERENTE" }, { role: "gerente" }] },
    })
    if (!gerente) {
      return NextResponse.json(
        { error: "invalid_pin", hint: "Defina ASSISTEC_GERENTE_PIN ou cadastre um usuário com role GERENTE." },
        { status: 401 }
      )
    }

    const token = crypto.randomUUID()
    const res = NextResponse.json({ ok: true as const, role: "GERENTE" as const })
    res.cookies.set({ name: STAFF_SESSION_COOKIE, value: token, ...COOKIE_BASE })
    res.cookies.set({ name: STAFF_ROLE_COOKIE, value: "GERENTE", ...COOKIE_BASE })
    clearCookie(res, ADMIN_COOKIE)
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao autenticar", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true as const })
  clearCookie(res, STAFF_SESSION_COOKIE)
  clearCookie(res, STAFF_ROLE_COOKIE)
  clearCookie(res, ADMIN_COOKIE)
  return res
}
