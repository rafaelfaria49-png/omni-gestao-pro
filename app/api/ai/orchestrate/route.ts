import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { orchestrateCommand, type PlanoAssinatura } from "@/services/ai-orchestrator"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { composeMestreUserMessage, type StockSummaryRow } from "@/services/ai-mestre-reply"
import { pickMestreModel } from "@/lib/ai-model-policy"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"

/** Prisma exige Node; a chamada Gemini em si é compatível com Edge, mas este handler não. */
export const runtime = "nodejs"

type Body = {
  command?: string
  /** Plano enviado pelo cliente; em produção, validar também cookie/servidor. */
  plano?: PlanoAssinatura | string
  lojaId?: string
  /** Modelo sugerido pelo cliente (ex.: Gemini Flash no básico; GPT/Claude no premium). */
  model?: string
}

function lojaIdFromRequest(req: Request, body: Body): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  const b = typeof body.lojaId === "string" ? body.lojaId.trim() : ""
  if (b) return b
  return storeIdFromAssistecRequestForRead(req)
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const command = typeof body.command === "string" ? body.command.trim() : ""
  if (!command) {
    return NextResponse.json({ error: "command obrigatório" }, { status: 400 })
  }

  const lojaId = lojaIdFromRequest(req, body)

  // Plano (first-class): resolve sempre a partir da unidade (Store.subscriptionPlan).
  // Fallback temporário: cookie verificado / body, para compatibilidade em ambientes sem coluna preenchida.
  let plano: PlanoAssinatura | string = "bronze"
  try {
    const store = await prisma.store.findUnique({ where: { id: lojaId }, select: { subscriptionPlan: true } })
    const p = String(store?.subscriptionPlan || "").trim()
    if (p === "OURO") plano = "ouro"
    else if (p === "PRATA") plano = "prata"
    else if (p === "BRONZE") plano = "bronze"
  } catch {
    /* ignore */
  }
  if (plano === "bronze") {
    try {
      const sub = await getVerifiedSubscriptionFromCookies()
      if (sub.ok && typeof sub.plano === "string" && sub.plano.trim()) {
        plano = sub.plano.trim()
      } else if (typeof body.plano === "string" && body.plano.trim()) {
        plano = body.plano.trim()
      }
    } catch {
      /* ignora */
    }
  }

  // Modelo: básico travado no backend; premium pode escolher (request + preferência salva).
  let storedModel: string | null = null
  try {
    const st = await prisma.storeSettings.findUnique({ where: { storeId: lojaId }, select: { printerConfig: true } })
    const cfg = st?.printerConfig && typeof st.printerConfig === "object" ? (st.printerConfig as Record<string, unknown>) : null
    storedModel = cfg && typeof (cfg as any).aiMestreModel === "string" ? String((cfg as any).aiMestreModel).trim() : null
  } catch {
    storedModel = null
  }
  const model = pickMestreModel({ plano, requestedModel: body.model, storedModel })

  let stockRows: StockSummaryRow[] = []
  try {
    const rows = await prisma.produto.findMany({
      where: { storeId: lojaId },
      select: { name: true, stock: true, price: true, category: true },
      orderBy: { name: "asc" },
      take: 120,
    })
    stockRows = rows.map((r) => ({
      name: r.name,
      stock: r.stock,
      price: r.price,
      category: r.category ?? "",
    }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[orchestrate] estoque:", msg)
  }

  const result = orchestrateCommand(command, plano)
  if (!result.ok) {
    return NextResponse.json(result)
  }

  let message = ""
  let meta: { llmConfigured: boolean; backend: "openrouter" | "gemini" | "openai" | null; stockRowsLoaded: boolean; fallbackUsed?: boolean } = {
    llmConfigured: true,
    backend: "openrouter",
    stockRowsLoaded: stockRows.length > 0,
  }
  try {
    const composed = await composeMestreUserMessage(command, result.decision, plano, stockRows, model)
    message = composed.message
    meta = {
      llmConfigured: composed.meta.llmConfigured,
      backend: composed.meta.backend,
      stockRowsLoaded: stockRows.length > 0,
      fallbackUsed: composed.meta.fallbackUsed,
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    console.error("[orchestrate] compose:", err)
    if (err === "OPENROUTER_KEY_MISSING") {
      message = "Assistente temporariamente indisponível."
    } else if (err === "OPENROUTER_FAILED") {
      message =
        "Não obtive resposta do assistente agora. Tente de novo em alguns segundos."
    } else {
      message = "Não consegui completar a resposta. Tente novamente em instantes."
    }
    meta = {
      llmConfigured: false,
      backend: null,
      stockRowsLoaded: stockRows.length > 0,
    }
  }

  if (!message.trim()) {
    message = `Roteado para ${result.decision.label}.`
  }

  return NextResponse.json({
    ...result,
    message,
    integration: meta,
  })
}
