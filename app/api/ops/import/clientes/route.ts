/** Model `Cliente` → tabela `public.cliente` (`@@map`). Delegate: `prisma.cliente`. */
import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { importClientesJson } from "@/lib/import-clientes-json"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"

export const runtime = "nodejs"

function missingClientesTableResponse() {
  return NextResponse.json(
    {
      error:
        'Tabela "cliente" não existe no Postgres/Supabase. Verifique se a tabela foi criada e se o Prisma está apontando para o projeto certo.',
    },
    { status: 503 }
  )
}

function isMissingRelationError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") return true
  const msg = e instanceof Error ? e.message : String(e)
  return /does not exist|não existe|relation.*does not exist/i.test(msg)
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

export async function GET(req: Request) {
  const gate = await requireSubscription()
  if (!gate.ok) return gate.res
  const storeId = storeIdFromAssistecRequestForRead(req)

  try {
    const rows = await prisma.cliente.findMany({
      where: { storeId },
      orderBy: { updatedAt: "desc" },
    })
    const clientes = rows.map((r) => ({
      id: r.id,
      nome: r.name,
      cpf: "",
      telefone: r.phone ?? "",
      email: r.email ?? "",
      endereco: "",
      aparelhosRecorrentes: [] as string[],
      totalOS: 0,
      ultimaVisita: "",
    }))
    return NextResponse.json({ clientes })
  } catch (e) {
    if (isMissingRelationError(e)) return missingClientesTableResponse()
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
  return importClientesJson(req)
}

export async function POST(req: Request) {
  return importClientesJson(req)
}
