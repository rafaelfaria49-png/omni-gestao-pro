import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma"
import {
  assertActiveSubscriptionForImport,
  importClientesItems,
  listClientesForLoja,
} from "@/lib/clientes-import-handler"
import { storeIdFromAssistecRequestForRead, storeIdFromAssistecRequestForWrite } from "@/lib/store-id-from-request"
import { requireAdmin } from "@/lib/require-admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** CORS: permite o navegador chamar a API (incl. `fetch` com `credentials: "include"`). */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cookie, x-assistec-loja-id, X-Requested-With, Accept",
    "Access-Control-Max-Age": "86400",
  }
  if (origin) {
    base["Access-Control-Allow-Origin"] = origin
    base["Access-Control-Allow-Credentials"] = "true"
  } else {
    base["Access-Control-Allow-Origin"] = "*"
  }
  return base
}

function json(req: Request, data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders(req) })
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function loja(req: Request) {
  return storeIdFromAssistecRequestForRead(req)
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function GET(request: Request) {
  try {
    const auth = await assertActiveSubscriptionForImport()
    if (!auth.ok) {
      return json(request, { error: "Não autorizado", detail: auth.message }, 401)
    }
    const lid = loja(request)
    const clientes = await listClientesForLoja(lid)
    return json(request, { clientes })
  } catch (e) {
    console.error("[clientes/importar GET]", e)
    return json(
      request,
      { error: "Falha ao carregar", detail: errMsg(e), code: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined },
      503
    )
  }
}

export async function PUT(request: Request) {
  return handleImport(request)
}

export async function POST(request: Request) {
  console.log("--- CHEGOU NO SERVIDOR ---")
  return handleImport(request)
}

async function handleImport(request: Request) {
  try {
    const auth = await assertActiveSubscriptionForImport()
    if (!auth.ok) {
      return json(request, { error: "Não autorizado", detail: auth.message }, 401)
    }
    const adminGate = await requireAdmin()
    if (!adminGate.ok) return adminGate.res

    const lid = storeIdFromAssistecRequestForWrite(request)
    if (!lid) {
      return json(
        request,
        {
          error: "Unidade obrigatória",
          detail: "Envie o header x-assistec-loja-id ou query storeId / lojaId na importação.",
        },
        400
      )
    }

    const body = (await request.json()) as { items?: unknown }
    if (!Array.isArray(body.items)) {
      return json(request, { error: "Payload inválido", detail: "Envie { items: [ { Nome, Telefone } ] }" }, 400)
    }

    const { created, updated, skippedDuplicate } = await importClientesItems(lid, body.items)

    return json(request, { ok: true, created, updated, skippedDuplicate })
  } catch (e) {
    console.error("[clientes/importar]", e)
    const detail = errMsg(e)
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined
    return json(
      request,
      {
        error: "Falha na importação",
        detail,
        ...(code ? { prismaCode: code } : {}),
        ...(process.env.NODE_ENV === "development" && e instanceof Error && e.stack ? { stack: e.stack } : {}),
      },
      503
    )
  }
}
