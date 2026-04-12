import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveLlmEnv } from "@/lib/resolve-llm-env"
import { orchestrateCommand, type PlanoAssinatura } from "@/services/ai-orchestrator"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { composeMestreUserMessage } from "@/services/ai-mestre-reply"

export const runtime = "nodejs"

type Body = {
  command?: string
  /** Plano enviado pelo cliente; em produção, validar também cookie/servidor. */
  plano?: PlanoAssinatura | string
  lojaId?: string
}

function lojaIdFromRequest(req: Request, body: Body): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  const b = typeof body.lojaId === "string" ? body.lojaId.trim() : ""
  return b || "loja-1"
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

  const plano = (body.plano as PlanoAssinatura) ?? "bronze"
  const lojaId = lojaIdFromRequest(req, body)

  /** Força leitura no handler (evita cache estático de módulos em dev). */
  const llmResolved = resolveLlmEnv()

  let stockRows: { name: string; stock: number; price: number; category: string }[] = []
  try {
    stockRows = await prisma.estoqueProduto.findMany({
      where: { lojaId },
      select: { name: true, stock: true, price: true, category: true },
      orderBy: { name: "asc" },
      take: 120,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[orchestrate] estoque:", msg)
  }

  const result = orchestrateCommand(command, plano)
  if (!result.ok) {
    return NextResponse.json(result)
  }

  let message = ""
  let meta: { llmConfigured: boolean; backend: "openai" | "gemini" | null; stockRowsLoaded: boolean } = {
    llmConfigured: llmResolved.ok,
    backend: llmResolved.ok ? llmResolved.backend : null,
    stockRowsLoaded: stockRows.length > 0,
  }
  try {
    const composed = await composeMestreUserMessage(command, result.decision, plano, stockRows)
    message = composed.message
    meta = {
      llmConfigured: composed.meta.llmConfigured,
      backend: composed.meta.backend,
      stockRowsLoaded: stockRows.length > 0,
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    console.error("[orchestrate] compose:", err)
    message = `Roteado para ${result.decision.label}. Erro ao chamar a IA: ${err.slice(0, 160)}`
    meta = {
      llmConfigured: llmResolved.ok,
      backend: llmResolved.ok ? llmResolved.backend : null,
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
