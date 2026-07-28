/**
 * POST /api/contador/documentos/complete
 *
 * Fase 2 do upload direto. Revalida sessão/permissão/loja, EXIGE o `uploadIntent`
 * assinado emitido na fase 1, LÊ o objeto recém-enviado ao storage privado
 * (Cloudflare R2 — GOAL 012C), recalcula SHA-256 e bytes no servidor, valida conteúdo
 * real (magic bytes / texto) e só então cria `ContadorDocumento` + evento em transação.
 * Idempotente pelo `documentoId`. Falha de conteúdo remove o objeto órfão — e apenas
 * aquele que o intent autorizou.
 *
 * Nenhum campo vinculado ao intent é aceito do cliente como fonte da verdade: o corpo
 * pode reenviá-los, mas divergir do intent é recusa (GOAL 012E · P1).
 *
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 5/6/9.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { completarUpload, toDto } from "@/lib/contador/documentos/service"
import { criarRepoPrisma } from "@/lib/contador/documentos/repo-prisma"
import { resolverStorageDocumentos } from "@/lib/contador/documentos/storage"
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
        // Autorização assinada — sem ela o service recusa antes de qualquer IO.
        uploadIntent: body.uploadIntent,
        // Livres (rótulo/prazo): o operador pode ajustá-los antes de confirmar.
        titulo: body.titulo,
        vencimento: body.vencimento,
        // Vinculados: repassados CRUS para serem conferidos contra o intent. Não são
        // coagidos aqui — `undefined` (ausente) e `""` (adulterado) precisam diferir.
        documentoId: body.documentoId,
        competencia: body.competencia,
        storageRef: body.storageRef,
        categoria: body.categoria,
        nomeArquivo: body.nomeArquivo,
        mime: body.mime,
        bytes: body.bytes,
        sha256: body.sha256,
        versaoDeId: body.versaoDeId,
      },
      { storage: resolverStorageDocumentos(), repo: criarRepoPrisma() },
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
