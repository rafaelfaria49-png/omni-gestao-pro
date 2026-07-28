/**
 * Contador HUB · timeline da competência (GOAL 011).
 *
 * GET /api/contador/timeline?c=AAAA-MM[&contexto=interno|compartilhado][&limite=N]
 *
 * SOMENTE LEITURA: projeta `ContadorEvento` + `ContadorComentario` da loja ativa.
 * Competência inexistente → lista vazia (estado honesto), não erro.
 * O DTO nunca carrega storageRef, URL assinada, secret ou metadata bruta.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { respostaErroContador } from "@/lib/contador/status/http"
import { carregarTimeline } from "@/lib/contador/timeline/service"
import { criarRepoTimeline } from "@/lib/contador/timeline/repo-prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const CHAVES_PROIBIDAS = ["storeId", "lojaId", "competenciaId"] as const

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (CHAVES_PROIBIDAS.some((k) => url.searchParams.has(k))) {
    return NextResponse.json(
      { ok: false, mensagem: "O endpoint não aceita seleção de loja ou competência por id." },
      { status: 400 },
    )
  }

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const limiteBruto = Number(url.searchParams.get("limite") ?? "")

  try {
    const resultado = await carregarTimeline(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: url.searchParams.get("c") ?? "",
        contexto: url.searchParams.get("contexto"),
        ...(Number.isFinite(limiteBruto) && limiteBruto > 0 ? { limite: limiteBruto } : {}),
      },
      { repo: criarRepoTimeline() },
    )
    return NextResponse.json(
      {
        ok: true,
        competencia: resultado.competencia,
        contexto: resultado.timeline.contexto,
        total: resultado.timeline.total,
        itens: resultado.timeline.itens,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    )
  } catch (e) {
    return respostaErroContador(e)
  }
}
