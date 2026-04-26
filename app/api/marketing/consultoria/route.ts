import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-admin"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { getMarketingMediaCredits } from "@/lib/marketing-media-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function storeIdFrom(req: Request): string {
  const h = req.headers.get(ASSISTEC_LOJA_HEADER)?.trim()
  if (h) return h
  return storeIdFromAssistecRequestForRead(req)
}

type Body = {
  /** Texto transcrito (MVP). Em breve: upload de áudio + transcrição real. */
  transcript?: string
}

async function transcribeWithOpenAI(file: File): Promise<string> {
  const key = String(process.env.OPENAI_API_KEY || "").trim()
  if (!key) throw new Error("openai_key_missing")
  const fd = new FormData()
  fd.set("model", "gpt-4o-mini-transcribe")
  fd.set("file", file, file.name || "audio.webm")
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  })
  const j = (await r.json().catch(() => ({}))) as any
  if (!r.ok) throw new Error(String(j?.error?.message || `OpenAI HTTP ${r.status}`))
  const text = String(j?.text || "").trim()
  if (!text) throw new Error("transcription_empty")
  return text
}

function buildConsultoriaCommand(transcript: string): string {
  const t = transcript.trim()
  return [
    "Você é um consultor técnico sênior de assistência (celulares / eletrônicos). Idioma: pt-BR.",
    "A seguir está a transcrição (ou resumo) de uma conversa com o cliente / explicação na bancada.",
    "Extraia e entregue APENAS um JSON válido no formato exato abaixo, sem markdown e sem texto extra:",
    "{",
    '  "diagnosticoTecnico": "Laudo técnico profissional, 4 a 8 linhas, sem gírias.",',
    '  "listaDePecas": ["peça 1", "peça 2", "peça 3"],',
    '  "mensagemWhatsAppStatus": "Mensagem curta e cordial para o cliente (WhatsApp), com status + próximos passos + prazo estimado.",',
    '  "perguntasDeConfirmacao": ["pergunta 1", "pergunta 2"]',
    "}",
    "",
    "Regras: não invente peças se o texto não sustentar; se estiver incerto, liste como hipótese e faça perguntas de confirmação.",
    "",
    "Transcrição:",
    t.slice(0, 8000),
  ].join("\n")
}

function stripCodeFences(s: string): string {
  let t = s.trim()
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "")
  }
  return t.trim()
}

function parseResult(raw: string): {
  diagnosticoTecnico: string
  listaDePecas: string[]
  mensagemWhatsAppStatus: string
  perguntasDeConfirmacao: string[]
} {
  const cleaned = stripCodeFences(raw)
  try {
    const j = JSON.parse(cleaned) as any
    return {
      diagnosticoTecnico: String(j?.diagnosticoTecnico || "").trim(),
      listaDePecas: Array.isArray(j?.listaDePecas) ? j.listaDePecas.map((x: any) => String(x || "").trim()).filter(Boolean) : [],
      mensagemWhatsAppStatus: String(j?.mensagemWhatsAppStatus || "").trim(),
      perguntasDeConfirmacao: Array.isArray(j?.perguntasDeConfirmacao)
        ? j.perguntasDeConfirmacao.map((x: any) => String(x || "").trim()).filter(Boolean)
        : [],
    }
  } catch {
    return {
      diagnosticoTecnico: cleaned,
      listaDePecas: [],
      mensagemWhatsAppStatus: "",
      perguntasDeConfirmacao: [],
    }
  }
}

async function reserveCreditAndCreateJob(storeId: string, transcriptPreview: string) {
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.storeSettings.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
      select: { marketingMediaCredits: true },
    })
    const current = settings.marketingMediaCredits ?? 50
    if (current < 1) return { ok: false as const, creditsRemaining: current }
    const next = current - 1
    await tx.storeSettings.update({ where: { storeId }, data: { marketingMediaCredits: next } })
    const job = await tx.marketingMediaJob.create({
      data: {
        storeId,
        kind: "REUNIAO",
        kindV2: "REUNIAO",
        creditsAfter: next,
        meta: {
          status: "PENDING",
          transcriptPreview,
        },
      },
      select: { id: true },
    })
    return { ok: true as const, creditsRemaining: next, jobDbId: job.id }
  })
  return result
}

async function refundCredit(storeId: string, meta: Record<string, unknown>) {
  try {
    await prisma.$transaction(async (tx) => {
      const settings = await tx.storeSettings.upsert({
        where: { storeId },
        create: { storeId },
        update: {},
        select: { marketingMediaCredits: true },
      })
      await tx.storeSettings.update({
        where: { storeId },
        data: { marketingMediaCredits: (settings.marketingMediaCredits ?? 0) + 1 },
      })
      await tx.marketingMediaJob.create({
        data: { storeId, kind: "REUNIAO", kindV2: "REUNIAO", meta: { ...meta, status: "REFUND" } },
      })
    })
  } catch {
    /* ignore */
  }
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  try {
    const jobs = await prisma.marketingMediaJob.findMany({
      where: {
        storeId,
        OR: [{ kindV2: "REUNIAO" }, { kind: "REUNIAO" }, { kind: "reuniao" }],
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, meta: true, createdAt: true, creditsAfter: true },
    })
    const items = jobs.map((j) => {
      const m = (j.meta || {}) as Record<string, unknown>
      return {
        id: j.id,
        createdAt: j.createdAt.toISOString(),
        creditsAfter: j.creditsAfter,
        status: typeof m.status === "string" ? m.status : "UNKNOWN",
        diagnosticoTecnico: typeof m.diagnosticoTecnico === "string" ? m.diagnosticoTecnico : "",
        listaDePecas: Array.isArray(m.listaDePecas) ? (m.listaDePecas as unknown[]) : [],
        mensagemWhatsAppStatus: typeof m.mensagemWhatsAppStatus === "string" ? m.mensagemWhatsAppStatus : "",
        perguntasDeConfirmacao: Array.isArray(m.perguntasDeConfirmacao) ? (m.perguntasDeConfirmacao as unknown[]) : [],
      }
    })
    return NextResponse.json({ ok: true, items })
  } catch {
    return NextResponse.json({ ok: false, items: [], error: "db_error" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const storeId = storeIdFrom(req)
  let transcript = ""
  const ct = String(req.headers.get("content-type") || "")
  if (ct.includes("multipart/form-data")) {
    try {
      const fd = await req.formData()
      const file = fd.get("audio")
      if (file && file instanceof File) {
        transcript = await transcribeWithOpenAI(file)
      }
      if (!transcript) {
        const t = fd.get("transcript")
        if (typeof t === "string") transcript = t.trim()
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao ler form-data" }, { status: 400 })
    }
  } else {
    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
    }
    transcript = typeof body.transcript === "string" ? body.transcript.trim() : ""
  }

  if (!transcript) {
    return NextResponse.json(
      { error: "transcript obrigatório (ou envie áudio com OPENAI_API_KEY configurada)" },
      { status: 400 }
    )
  }
  if (transcript.length > 10_000) return NextResponse.json({ error: "transcript muito longo" }, { status: 400 })

  const reserved = await reserveCreditAndCreateJob(storeId, transcript.slice(0, 240))
  if (!reserved.ok) {
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "sem_creditos", creditsRemaining: credits, message: "Saldo de créditos insuficiente." },
      { status: 402 }
    )
  }

  const command = buildConsultoriaCommand(transcript)

  try {
    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: { meta: { status: "RUNNING", stage: "extracting" } },
    })

    // Reutiliza o orquestrador já existente (IA Mestre).
    const res = await fetch(new URL("/api/ai/orchestrate", req.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ASSISTEC_LOJA_HEADER]: storeId,
      },
      body: JSON.stringify({ command, model: "auto", lojaId: storeId }),
    })
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
    const msg = String(j.message || "").trim()
    if (!msg) throw new Error("Sem resposta da IA.")

    const parsed = parseResult(msg)
    if (!parsed.diagnosticoTecnico) throw new Error("Resultado vazio.")

    await prisma.marketingMediaJob.update({
      where: { id: reserved.jobDbId },
      data: {
        meta: {
          status: "DONE",
          transcriptPreview: transcript.slice(0, 240),
          ...parsed,
        },
      },
    })

    return NextResponse.json({
      ok: true,
      creditsRemaining: reserved.creditsRemaining,
      result: parsed,
      jobId: reserved.jobDbId,
    })
  } catch (e) {
    await refundCredit(storeId, { error: e instanceof Error ? e.message : "consultoria_error" })
    const credits = await getMarketingMediaCredits(storeId).catch(() => 0)
    return NextResponse.json(
      { ok: false, error: "consultoria_error", creditsRemaining: credits, message: "Falha na consultoria. Crédito retornado." },
      { status: 502 }
    )
  }
}

