import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Prisma } from "@/generated/prisma"

export const runtime = "nodejs"

async function requireSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

function lojaIdFromRequest(req: Request): string {
  const h = req.headers.get("x-assistec-loja-id")?.trim()
  if (h) return h
  const url = new URL(req.url)
  const q = url.searchParams.get("lojaId")?.trim()
  return q || "loja-1"
}

export async function GET(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const lojaId = lojaIdFromRequest(req)
  try {
    const rows = await prisma.ordemServicoDb.findMany({
      where: { lojaId },
      orderBy: { updatedAt: "desc" },
    })
    const ordens = rows.map((r) => r.payload)
    return NextResponse.json({ ordens })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/ordens GET]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao carregar ordens", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}

export async function PUT(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const lojaId = lojaIdFromRequest(req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const list = (body as { ordens?: unknown }).ordens
  if (!Array.isArray(list)) {
    return NextResponse.json({ error: "ordens deve ser um array" }, { status: 400 })
  }

  const rows: { id: string; lojaId: string; numero: string; payload: Prisma.InputJsonValue }[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : ""
    const numero = typeof o.numero === "string" ? o.numero : ""
    if (!id || !numero) continue
    rows.push({
      id,
      lojaId,
      numero,
      payload: o as Prisma.InputJsonValue,
    })
  }

  try {
    await prisma.$transaction([
      prisma.ordemServicoDb.deleteMany({ where: { lojaId } }),
      prisma.ordemServicoDb.createMany({ data: rows }),
    ])
    return NextResponse.json({ ok: true, count: rows.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/ordens PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao salvar ordens", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
