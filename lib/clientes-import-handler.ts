import { Prisma, type Cliente } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { cellToTrimmedString } from "@/lib/import-normalize"

export type ClienteListItem = {
  id: string
  nome: string
  cpf: string
  telefone: string
  email: string
  endereco: string
  aparelhosRecorrentes: string[]
  totalOS: number
  ultimaVisita: string
}

export async function assertActiveSubscriptionForImport(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) return { ok: false, message: "Cookie de sessão inválido ou ausente." }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false, message: "Assinatura inativa ou vencida." }
  }
  return { ok: true }
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : ""
      const msg = e instanceof Error ? e.message : String(e)
      const transient =
        code === "P1001" ||
        code === "P1002" ||
        code === "P1017" ||
        code === "P2024" ||
        /timeout|ECONNRESET|ENOTFOUND|connection/i.test(msg)
      if (transient && i < attempts - 1) {
        const ms = 800 * (i + 1)
        console.warn(`[clientes-import] ${label} — retry ${i + 1}/${attempts} em ${ms}ms:`, msg.slice(0, 200))
        await new Promise((r) => setTimeout(r, ms))
        continue
      }
      throw e
    }
  }
  throw last
}

export async function listClientesForLoja(storeId: string): Promise<ClienteListItem[]> {
  const sid = storeId.trim()
  const rows = await withDbRetry("findMany", () =>
    prisma.cliente.findMany({ where: { storeId: sid }, orderBy: { updatedAt: "desc" } })
  )

  return rows.map((r) => ({
    id: r.id,
    nome: r.name,
    cpf: "",
    telefone: r.phone ?? "",
    email: r.email ?? "",
    endereco: "",
    aparelhosRecorrentes: [],
    totalOS: 0,
    ultimaVisita: "",
  }))
}

export async function importClientesItems(
  storeId: string,
  items: unknown[]
): Promise<{ created: number; updated: number; skippedDuplicate: number }> {
  await withDbRetry("$connect", () => prisma.$connect())

  let created = 0
  let updated = 0
  let skippedDuplicate = 0

  for (const row of items) {
    if (!row || typeof row !== "object") continue

    try {
      const r = row as Record<string, unknown>
      const nome = cellToTrimmedString(r["Nome"] ?? r["nome"])
      const telefone =
        cellToTrimmedString(r["Telefone/WhatsApp"] ?? r["Telefone"] ?? r["telefone"]) || ""
      const email = cellToTrimmedString(r["Email"] ?? r["E-mail"] ?? r["email"]) || ""
      if (!nome) continue

      let existing: Cliente | null = null
      if (telefone) {
        existing = await withDbRetry("findFirst-phone", () =>
          prisma.cliente.findFirst({ where: { storeId, phone: telefone } })
        )
      }
      if (!existing) {
        existing = await withDbRetry("findFirst-name", () =>
          prisma.cliente.findFirst({ where: { storeId, name: nome } })
        )
      }

      if (existing) {
        await withDbRetry("update", () =>
          prisma.cliente.update({
            where: { id: existing!.id },
            data: { name: nome, phone: telefone || null, email: email || null },
          })
        )
        updated += 1
      } else {
        await withDbRetry("create", () =>
          prisma.cliente.create({
            data: {
              storeId,
              name: nome,
              phone: telefone || null,
              email: email || null,
            },
          })
        )
        created += 1
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        console.warn("[clientes-import] Unique constraint (duplicado) — ignorando e seguindo:", row)
        skippedDuplicate += 1
        continue
      }
      throw e
    }
  }

  return { created, updated, skippedDuplicate }
}
