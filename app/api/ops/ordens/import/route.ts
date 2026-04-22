import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import type { Prisma, Cliente } from "@/generated/prisma"
import { docDigitsForDedupe, normalizeNameForMatch } from "@/lib/import-normalize"
import { storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"

export const runtime = "nodejs"

function extractFromPayload(raw: Record<string, unknown>): {
  numero: string
  doc: string | null
  nomeNorm: string
} {
  const numero = typeof raw.numero === "string" ? raw.numero.trim() : ""
  const c = raw.cliente as Record<string, unknown> | undefined
  const nome = typeof c?.nome === "string" ? c.nome : ""
  const cpf = typeof c?.cpf === "string" ? c.cpf : ""
  return {
    numero,
    doc: docDigitsForDedupe(cpf),
    nomeNorm: normalizeNameForMatch(nome),
  }
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

export async function PUT(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const storeId = storeIdFromAssistecRequestForWrite(req)
  if (!storeId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id ou query storeId." },
      { status: 400 }
    )
  }

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

  let created = 0
  let updated = 0

  try {
    const working = await prisma.ordemServico.findMany({ where: { storeId } })
    const clientes: Cliente[] = await prisma.cliente.findMany({ where: { storeId } })
    const clienteByNomeNorm = new Map<string, string>()
    for (const c of clientes) {
      const k = normalizeNameForMatch(c.name)
      if (k && !clienteByNomeNorm.has(k)) {
        clienteByNomeNorm.set(k, c.id)
      }
    }

    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue
      const o = raw as Record<string, unknown>
      const incoming = extractFromPayload(o)
      if (!incoming.numero) continue

      let match =
        working.find((r) => r.numero === incoming.numero) ??
        (incoming.doc
          ? working.find((r) => extractFromPayload(r.payload as Record<string, unknown>).doc === incoming.doc)
          : undefined) ??
        (incoming.nomeNorm
          ? working.find(
              (r) => extractFromPayload(r.payload as Record<string, unknown>).nomeNorm === incoming.nomeNorm
            )
          : undefined)

      const payloadMerged = { ...o } as Record<string, unknown>

      const cli = payloadMerged.cliente as Record<string, unknown> | undefined
      const nomeCli = typeof cli?.nome === "string" ? cli.nome : ""
      const nomeCliNorm = normalizeNameForMatch(nomeCli)
      const clienteId =
        nomeCliNorm && clienteByNomeNorm.has(nomeCliNorm) ? (clienteByNomeNorm.get(nomeCliNorm) as string) : null

      if (match) {
        payloadMerged.id = match.id
        const updatedRow = await prisma.ordemServico.update({
          where: { id: match.id },
          data: {
            storeId,
            numero: incoming.numero,
            payload: payloadMerged as Prisma.InputJsonValue,
            clienteId,
          },
        })
        const ix = working.findIndex((r) => r.id === match.id)
        if (ix >= 0) working[ix] = updatedRow
        updated += 1
        continue
      }

      const id =
        typeof o.id === "string" && o.id.trim()
          ? o.id.trim()
          : `os-import-${incoming.numero.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${Date.now()}`
      payloadMerged.id = id
      const row = await prisma.ordemServico.create({
        data: {
          id,
          storeId,
          numero: incoming.numero,
          payload: payloadMerged as Prisma.InputJsonValue,
          clienteId,
        },
      })
      working.push(row)
      created += 1
    }

    return NextResponse.json({ ok: true, count: list.length, created, updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/ordens/import PUT]", msg)
    const dev = process.env.NODE_ENV === "development"
    return NextResponse.json(
      { error: "Falha ao importar ordens", ...(dev ? { detail: msg } : {}) },
      { status: 503 }
    )
  }
}
