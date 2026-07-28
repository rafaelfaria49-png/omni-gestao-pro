/**
 * POST /api/contador/documentos/upload-intent
 *
 * Fase 1 do upload direto. Valida a intenção (sessão + `hubs.contador` + loja ativa +
 * competência aberta + extensão/MIME/tamanho/hash) e devolve uma URL assinada para o
 * navegador enviar o arquivo DIRETO ao storage privado (Cloudflare R2 — GOAL 012C).
 * O binário NUNCA passa por aqui e NENHUM `ContadorDocumento` é criado ainda (só no
 * `complete`).
 *
 * Devolve também `uploadIntent`: a autorização ASSINADA que vincula documentoId,
 * storageRef e metadados no servidor, e sem a qual o `complete` recusa (GOAL 012E · P1).
 *
 * GOAL CONTADOR-HUB-DOCUMENTOS-REAL-010B · Etapa 5.
 */
import { NextResponse } from "next/server"
import { requireContadorScope } from "@/lib/contador/scope"
import { criarUploadIntent } from "@/lib/contador/documentos/service"
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
    const resultado = await criarUploadIntent(
      { storeId: escopo.storeId, userId: escopo.userId },
      {
        competencia: String(body.competencia ?? ""),
        categoria: String(body.categoria ?? ""),
        titulo: String(body.titulo ?? ""),
        nomeArquivo: String(body.nomeArquivo ?? ""),
        mime: String(body.mime ?? ""),
        bytes: Number(body.bytes),
        sha256: String(body.sha256 ?? ""),
        vencimento: body.vencimento,
        versaoDeId: body.versaoDeId == null ? null : String(body.versaoDeId),
      },
      { storage: resolverStorageDocumentos(), repo: criarRepoPrisma() },
    )
    logEvento("contador_documento_intent", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      competencia: resultado.competencia,
      documentoId: resultado.documentoId,
    })
    return NextResponse.json({
      ok: true,
      documentoId: resultado.documentoId,
      competenciaId: resultado.competenciaId,
      competencia: resultado.competencia,
      storageRef: resultado.storageRef,
      nomeSanitizado: resultado.nomeSanitizado,
      signedUrl: resultado.signedUrl,
      token: resultado.token,
      expiresInSec: resultado.expiresInSec,
      uploadIntent: resultado.uploadIntent,
      headersObrigatorios: resultado.headersObrigatorios,
    })
  } catch (e) {
    return respostaErro(e)
  }
}
