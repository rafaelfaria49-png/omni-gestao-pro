/**
 * Contador HUB · comentários (GOAL 011).
 *
 * GET  /api/contador/comentarios?c=AAAA-MM[&documentoId=][&contexto=interno|compartilhado]
 * POST /api/contador/comentarios  { competencia, documentoId?, texto, visibilidade }
 *
 * Contrato de segurança:
 *  - loja e autor resolvidos NO SERVIDOR; `storeId`/`lojaId`/`autorId` recusados;
 *  - comentário `interna` nunca sai em `contexto=compartilhado`;
 *  - append-only: sem PUT/PATCH/DELETE neste GOAL.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { logEvento, respostaFalhaEscopo } from "@/lib/contador/documentos/http"
import { respostaErroContador } from "@/lib/contador/status/http"
import { criarComentario, listarComentarios } from "@/lib/contador/comentarios/service"
import { criarRepoComentarios } from "@/lib/contador/comentarios/repo-prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const CHAVES_PROIBIDAS = ["storeId", "lojaId", "autorId", "autorTipo", "papel", "role"] as const

function temChaveProibida(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) return CHAVES_PROIBIDAS.some((k) => fonte.has(k))
  return CHAVES_PROIBIDAS.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

const RESPOSTA_CHAVE_PROIBIDA = NextResponse.json(
  { ok: false, mensagem: "O endpoint não aceita loja, autor ou papel informados pelo cliente." },
  { status: 400 },
)

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return RESPOSTA_CHAVE_PROIBIDA

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  try {
    const comentarios = await listarComentarios(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: url.searchParams.get("c") ?? "",
        documentoId: url.searchParams.get("documentoId"),
        contexto: url.searchParams.get("contexto"),
      },
      { repo: criarRepoComentarios() },
    )
    return NextResponse.json(
      { ok: true, comentarios },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    )
  } catch (e) {
    return respostaErroContador(e)
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return RESPOSTA_CHAVE_PROIBIDA

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  let body: Record<string, unknown> = {}
  try {
    body = ((await req.json()) as Record<string, unknown>) ?? {}
  } catch {
    body = {}
  }
  if (temChaveProibida(body)) return RESPOSTA_CHAVE_PROIBIDA

  try {
    const comentario = await criarComentario(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: body.competencia,
        documentoId: body.documentoId,
        texto: body.texto,
        visibilidade: body.visibilidade,
      },
      { repo: criarRepoComentarios() },
    )
    logEvento("contador_comentario_criado", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      comentarioId: comentario.id,
      visibilidade: comentario.visibilidade,
    })
    return NextResponse.json({ ok: true, comentario }, { status: 201 })
  } catch (e) {
    return respostaErroContador(e)
  }
}
