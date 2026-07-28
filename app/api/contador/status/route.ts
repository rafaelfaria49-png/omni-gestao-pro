/**
 * Contador HUB · status de documento (GOAL 011).
 *
 * GET  /api/contador/status              → capacidades do papel + matriz de transição
 * POST /api/contador/status              → aplica uma transição
 *
 * Contrato de segurança:
 *  - loja, usuário e papel são resolvidos NO SERVIDOR (`requireContadorScope` + `auth`);
 *    `storeId`/`lojaId`/`papel` no corpo ou na query são recusados, nunca honrados;
 *  - transição fora da matriz → 409; rejeição sem motivo → 422; papel insuficiente → 403;
 *  - status + evento (+ comentário do motivo) nascem numa única transação.
 */
import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requireContadorScope } from "@/lib/contador/scope"
import { respostaFalhaEscopo, logEvento } from "@/lib/contador/documentos/http"
import { respostaErroContador } from "@/lib/contador/status/http"
import { resolverCapacidadesContador } from "@/lib/contador/status/permissoes"
import { criarRepoStatus } from "@/lib/contador/status/repo-prisma"
import { alterarStatusDocumento } from "@/lib/contador/status/service"
import { STATUS_ITEM, TRANSICOES } from "@/lib/contador/status/matriz"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Chaves que NUNCA podem influenciar a autorização, venham de onde vierem. */
const CHAVES_PROIBIDAS = ["storeId", "lojaId", "papel", "role", "userId", "atorId"] as const

function temChaveProibida(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) return CHAVES_PROIBIDAS.some((k) => fonte.has(k))
  return CHAVES_PROIBIDAS.some((k) => Object.prototype.hasOwnProperty.call(fonte, k))
}

const RESPOSTA_CHAVE_PROIBIDA = NextResponse.json(
  { ok: false, mensagem: "O endpoint não aceita loja, usuário ou papel informados pelo cliente." },
  { status: 400 },
)

/** Capacidades do papel autenticado + matriz — a UI só oferece o que o servidor aceita. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  if (temChaveProibida(url.searchParams)) return RESPOSTA_CHAVE_PROIBIDA

  const escopo = await requireContadorScope()
  if (!escopo.ok) return respostaFalhaEscopo(escopo)

  const capacidades = resolverCapacidadesContador(await auth())

  return NextResponse.json(
    {
      ok: true,
      capacidades: { podeConferir: capacidades.podeConferir },
      statusPossiveis: STATUS_ITEM,
      transicoes: TRANSICOES.map((t) => ({
        de: t.de,
        para: t.para,
        acao: t.acao,
        rotulo: t.rotulo,
        exigeMotivo: t.exigeMotivo,
        exigePapelElevado: t.exigePapelElevado,
        permitida: !t.exigePapelElevado || capacidades.podeConferir,
      })),
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
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

  const capacidades = resolverCapacidadesContador(await auth())

  try {
    const documento = await alterarStatusDocumento(
      { storeId: escopo.storeId, userId: escopo.userId },
      capacidades,
      { documentoId: body.documentoId, para: body.para, motivo: body.motivo },
      { repo: criarRepoStatus() },
    )
    logEvento("contador_status_alterado", {
      storeId: escopo.storeId,
      userId: escopo.userId,
      documentoId: documento.id,
      statusNovo: documento.status,
    })
    return NextResponse.json({ ok: true, documento })
  } catch (e) {
    return respostaErroContador(e)
  }
}
