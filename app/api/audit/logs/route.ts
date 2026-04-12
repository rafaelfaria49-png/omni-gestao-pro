import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isAdminSession } from "@/lib/api-auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Acesso restrito ao administrador" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action")?.trim()
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const where: {
    action?: string
    createdAt?: { gte?: Date; lte?: Date }
  } = {}

  if (action && action !== "all") {
    where.action = action
  }

  if (from || to) {
    where.createdAt = {}
    if (from) {
      const d = new Date(from)
      if (!Number.isNaN(d.getTime())) where.createdAt.gte = d
    }
    if (to) {
      const d = new Date(to)
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999)
        where.createdAt.lte = d
      }
    }
  }

  const rows = await prisma.logsAuditoria.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  return NextResponse.json({
    logs: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      userLabel: r.userLabel,
      detail: r.detail,
      metadata: r.metadata,
      source: r.source,
    })),
  })
}
