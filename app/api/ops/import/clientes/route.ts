import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { docDigitsForDedupe, formatCpfCnpjFromDigits, normalizeNameForMatch } from "@/lib/import-normalize"

export const runtime = "nodejs"

type ClienteItem = {
  nome: string
  doc?: string
  telefone?: string
  email?: string
  endereco?: string
}

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
    const rows = await prisma.clienteImportado.findMany({
      where: { lojaId },
      orderBy: { updatedAt: "desc" },
    })
    const clientes = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      cpf: formatCpfCnpjFromDigits(r.docDigits),
      telefone: r.telefone,
      email: r.email,
      endereco: r.endereco,
      aparelhosRecorrentes: [] as string[],
      totalOS: 0,
      ultimaVisita: "",
    }))
    return NextResponse.json({ clientes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/import/clientes GET]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao carregar clientes", ...(dev ? { detail: msg } : {}) },
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

  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items deve ser um array" }, { status: 400 })
  }

  const normalized: ClienteItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const nome = typeof o.nome === "string" ? o.nome.trim() : ""
    if (!nome) continue
    normalized.push({
      nome,
      doc: typeof o.doc === "string" ? o.doc : undefined,
      telefone: typeof o.telefone === "string" ? o.telefone : undefined,
      email: typeof o.email === "string" ? o.email : undefined,
      endereco: typeof o.endereco === "string" ? o.endereco : undefined,
    })
  }

  let created = 0
  let updated = 0

  try {
    for (const it of normalized) {
      const nomeNorm = normalizeNameForMatch(it.nome)
      if (!nomeNorm) continue
      const docDigits = docDigitsForDedupe(it.doc ?? "")

      const byDoc = docDigits
        ? await prisma.clienteImportado.findFirst({ where: { lojaId, docDigits } })
        : null
      const byNome = await prisma.clienteImportado.findFirst({ where: { lojaId, nomeNorm } })

      if (byDoc && byNome && byDoc.id !== byNome.id) {
        await prisma.clienteImportado.delete({ where: { id: byNome.id } })
        await prisma.clienteImportado.update({
          where: { id: byDoc.id },
          data: {
            nome: it.nome,
            nomeNorm,
            docDigits,
            telefone: it.telefone ?? "",
            email: it.email ?? "",
            endereco: it.endereco ?? "",
          },
        })
        updated += 1
        continue
      }

      const target = byDoc ?? byNome
      const data = {
        nome: it.nome,
        nomeNorm,
        docDigits,
        telefone: it.telefone ?? "",
        email: it.email ?? "",
        endereco: it.endereco ?? "",
      }

      if (target) {
        await prisma.clienteImportado.update({
          where: { id: target.id },
          data,
        })
        updated += 1
      } else {
        await prisma.clienteImportado.create({
          data: { ...data, lojaId },
        })
        created += 1
      }
    }

    return NextResponse.json({ ok: true, count: normalized.length, created, updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/import/clientes PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao importar clientes", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
