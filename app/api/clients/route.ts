import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      const transient = /P1001|P1002|P1017|timeout|ECONNRESET|ENOTFOUND|connection/i.test(msg)
      if (!transient || i === attempts - 1) break
      const ms = 500 * (i + 1)
      console.warn(`[api/clients] ${label} — retry ${i + 1}/${attempts} em ${ms}ms:`, msg.slice(0, 200))
      await sleep(ms)
    }
  }
  throw last
}

/**
 * Rota estável e simples para listar clientes do banco.
 * Sem lógica de importação, sem CORS complexo: retorna o que existe em `cliente` (Supabase).
 */
export async function GET(req: Request) {
  try {
    // Mantém compatibilidade com chamadas antigas, mas o model atual aponta para `cliente`.
    const lojaId = storeIdFromAssistecRequestForRead(req)
    await withDbRetry("$connect", () => prisma.$connect())
    const rows = await withDbRetry("findMany", () =>
      prisma.cliente.findMany({
        where: { storeId: lojaId },
        orderBy: { updatedAt: "desc" },
      })
    )
    console.log(`[api/clients GET] total no banco (resultado)=${rows.length}`)
    return NextResponse.json({
      ok: true,
      clientes: rows,
      lojaId,
    }, { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[api/clients GET] erro:", e)
    // Mantém a UI estável: retorna 200 com lista vazia e detalhe para diagnóstico.
    return NextResponse.json({ ok: true, clientes: [], warning: "Falha temporária ao conectar no banco", detail: msg }, { status: 200 })
  }
}

