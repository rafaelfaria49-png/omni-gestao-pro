import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma, prismaEnsureConnected } from "@/lib/prisma"

const ADMIN_COOKIE = "assistec_admin_session"

export async function requireAdmin(): Promise<
  | { ok: true; admin: { id: string; name: string } }
  | { ok: false; res: NextResponse }
> {
  const jar = await cookies()
  const id = String(jar.get(ADMIN_COOKIE)?.value || "").trim()
  if (!id) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  try {
    await prismaEnsureConnected()
    const u = await prisma.user.findFirst({ where: { id, OR: [{ role: "ADMIN" }, { role: "admin" }] } })
    if (!u) return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
    return { ok: true, admin: { id: u.id, name: u.name } }
  } catch {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
}

