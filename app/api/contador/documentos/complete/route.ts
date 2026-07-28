/**
 * POST /api/contador/documentos/complete
 *
 * Fase 2 do upload direto. Revalida sessão/permissão/loja, LÊ o objeto recém-enviado
 * ao Supabase, recalcula SHA-256 e bytes no servidor, valida conteúdo real (magic
 * bytes / texto), compara com o intent e só então cria `ContadorDocumento` + evento em
 * transação. Idempotente pelo `documentoId`. Falha de validação remove o objeto órfão.
 *
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 5/6/9.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { completarUpload, toDto } from "@/lib/contador/documentos/service"
import { criarRepoPrisma } from "@/lib/contador/documentos/repo-prisma"
import { storageR2 } from "@/lib/contador/documentos/storage-r2"
import { logEvento, respostaErro, respostaFalhaEscopo } from "@/lib/contador/documentos/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(req: Request) {
  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, mensagem: "Corpo inválido." }, { status: 400 })
  }

  try {
    const { documento, criado } = await completarUpload(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        documentoId: String(body.documentoId ?? ""),
        competencia: String(body.competencia ?? ""),
        storageRef: String(body.storageRef ?? ""),
        categoria: String(body.categoria ?? ""),
        titulo: String(body.titulo ?? ""),
        nomeArquivo: String(body.nomeArquivo ?? ""),
        mime: String(body.mime ?? ""),
        bytes: Number(body.bytes),
        sha256: String(body.sha256 ?? ""),
        vencimento: body.vencimento,
        versaoDeId: body.versaoDeId == null ? null : String(body.versaoDeId),
      },
      { storage: storageR2, repo: criarRepoPrisma() },
    )
    logEvento("contador_documento_complete", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      documentoId: documento.id,
      criado,
    })
    return NextResponse.json({ ok: true, criado, documento: toDto(documento) }, { status: criado ? 201 : 200 })
  } catch (e) {
    return respostaErro(e)
  }
}
