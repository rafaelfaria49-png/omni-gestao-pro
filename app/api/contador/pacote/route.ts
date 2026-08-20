/**
 * GET /api/contador/pacote?c=AAAA-MM
 *
 * Gera SOB DEMANDA o Pacote do Contador (MVP) da loja ATIVA na competência e devolve um ZIP.
 * Não persiste nada: sem storage, sem registro em banco, sem snapshot, sem cache.
 *
 * Autenticação: gate interno do Contador HUB (`requireContadorScope` = sessão NextAuth +
 * cookie de loja ativa + ACL multi-loja + permissão financeiro). O `storeId` vem SOMENTE do
 * escopo; qualquer `storeId`/`lojaId` na query é rejeitado (400). Header de loja não troca o
 * escopo (o gate ignora headers).
 *
 * GOAL CONTADOR-HUB-PACOTE-EXPORT-MVP-008 · 008B.
 */
import { NextResponse } from "next/server"
import {
  competenciaAtual,
  formatCompetencia,
  parseCompetencia,
} from "@/lib/contador/competencia"
import { requireContadorScope } from "@/lib/contador/scope"
import type { FalhaEscopoContador } from "@/lib/contador/scope-core"
import {
  gerarPacoteContador,
  PacoteLimiteExcedidoError,
  PacoteTimeoutError,
} from "@/lib/contador/pacote"
import { METRICAS, registrarMetrica } from "@/lib/contador/observabilidade"

// jszip + Prisma exigem Node; o download é dinâmico e nunca cacheado.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Rótulo curto e estável do emissor, para a label `origem` das métricas (GOAL 019). */
const ORIGEM_METRICA = "pacote_sob_demanda"

const MOTIVO_STATUS: Record<FalhaEscopoContador["motivo"], number> = {
  nao_autenticado: 401,
  loja_ausente: 400,
  sem_acesso_loja: 403,
  sem_permissao: 403,
}

const MOTIVO_MSG: Record<FalhaEscopoContador["motivo"], string> = {
  nao_autenticado: "Sessão não encontrada. Faça login para gerar o pacote da competência.",
  loja_ausente: "Nenhuma loja ativa selecionada. Escolha uma unidade para gerar o pacote.",
  sem_acesso_loja: "Pacote indisponível para a unidade ativa.",
  sem_permissao: "Sua conta não tem permissão para gerar o pacote do Contador HUB.",
}

/** Log estruturado server-side. Nunca inclui CSV, PII, payload, cookie, token nem stack. */
function logEvento(evento: string, campos: Record<string, unknown>): void {
  try {
    console.info(JSON.stringify({ evento, ...campos }))
  } catch {
    console.info(evento)
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)

  // Seleção de loja por parâmetro é proibida (o escopo é a única fonte de storeId).
  if (url.searchParams.has("storeId") || url.searchParams.has("lojaId")) {
    return NextResponse.json(
      { ok: false, mensagem: "O endpoint não aceita seleção de loja por parâmetro." },
      { status: 400 },
    )
  }

  // Competência: ausência → atual; presente e inválida → 400 (sem fallback silencioso).
  const cRaw = url.searchParams.get("c")
  const competencia = cRaw === null ? competenciaAtual() : parseCompetencia(cRaw)
  if (!competencia) {
    return NextResponse.json(
      { ok: false, mensagem: "Competência inválida. Use o formato AAAA-MM." },
      { status: 400 },
    )
  }

  const escopo = await requireContadorScope()
  if (!escopo.ok) {
    return NextResponse.json(
      { ok: false, motivo: escopo.motivo, mensagem: MOTIVO_MSG[escopo.motivo] },
      { status: MOTIVO_STATUS[escopo.motivo] },
    )
  }

  const compCodigo = formatCompetencia(competencia)
  const inicio = Date.now()
  logEvento("contador_pacote_inicio", {
    storeId: escopo.storeId,
    userId: escopo.userId,
    competencia: compCodigo,
  })

  try {
    const pacote = await gerarPacoteContador({ scope: escopo, competencia, agora: new Date() })
    logEvento("contador_pacote_gerado", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: compCodigo,
      duracaoMs: Date.now() - inicio,
      bytesZip: pacote.metricas.bytesZip,
      bytesDescompactados: pacote.metricas.bytesDescompactados,
      arquivos: pacote.metricas.arquivos,
      contagens: pacote.metricas.contagens,
      fontesParciais: pacote.metricas.fontesParciais,
      fontesIndisponiveis: pacote.metricas.fontesIndisponiveis,
    })
    // GOAL 019 — métrica nomeada, ao lado do log estruturado que já existia.
    // Labels passam pelo saneador: `loja` é escopo de tenant, nunca PII de cliente.
    registrarMetrica(METRICAS.pacoteGeracaoDuracaoMs, Date.now() - inicio, {
      origem: ORIGEM_METRICA,
      loja: escopo.storeId,
      resultado: "ok",
    })
    return new NextResponse(Buffer.from(pacote.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pacote.nomeArquivo}"`,
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (e) {
    if (e instanceof PacoteLimiteExcedidoError) {
      logEvento("contador_pacote_limite_excedido", {
        storeId: escopo.storeId,
        userId: escopo.userId,
        competencia: compCodigo,
        limite: e.limite,
        duracaoMs: Date.now() - inicio,
      })
      registrarMetrica(METRICAS.pacoteGeracaoFalhasTotal, 1, {
        origem: ORIGEM_METRICA,
        loja: escopo.storeId,
        motivo: "limite_excedido",
      })
      return NextResponse.json(
        { ok: false, mensagem: "O pacote desta competência é grande demais para geração sob demanda." },
        { status: 413 },
      )
    }
    if (e instanceof PacoteTimeoutError) {
      logEvento("contador_pacote_timeout", {
        storeId: escopo.storeId,
        userId: escopo.userId,
        competencia: compCodigo,
        limiteMs: e.limiteMs,
        duracaoMs: Date.now() - inicio,
      })
      registrarMetrica(METRICAS.pacoteGeracaoFalhasTotal, 1, {
        origem: ORIGEM_METRICA,
        loja: escopo.storeId,
        motivo: "timeout",
      })
      return NextResponse.json(
        { ok: false, mensagem: "A geração do pacote desta competência demorou mais que o tempo limite. Tente novamente em instantes." },
        { status: 503 },
      )
    }
    logEvento("contador_pacote_falha", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: compCodigo,
      erro: e instanceof Error ? e.name : "erro",
      duracaoMs: Date.now() - inicio,
    })
    registrarMetrica(METRICAS.pacoteGeracaoFalhasTotal, 1, {
      origem: ORIGEM_METRICA,
      loja: escopo.storeId,
      motivo: "erro_interno",
    })
    return NextResponse.json(
      { ok: false, mensagem: "Não foi possível gerar o pacote desta competência agora. Tente novamente em instantes." },
      { status: 500 },
    )
  }
}
