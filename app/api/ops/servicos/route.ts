import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { canAccessStore } from "@/lib/auth/enterprise-permissions"
import { storeIdFromAssistecRequestForRead } from "@/lib/store-id-from-request"
import { getVerifiedSubscriptionFromCookies } from "@/lib/api-auth"
import { isVencimentoExpired } from "@/lib/subscription-seal"
import { getTrustedTimeMs } from "@/lib/trusted-time"
import { listServicos } from "@/app/actions/cadastros"
import { isServicoDisponivelParaVenda } from "@/lib/servicos/servico-pdv"

export const runtime = "nodejs"
/** Sem cache de rota — sempre serviços frescos do Prisma. */
export const dynamic = "force-dynamic"
export const revalidate = 0

/** Fora de produção, a leitura não exige cookie de assinatura (dev / preview local). */
function bypassSubscriptionCheck(): boolean {
  return process.env.NODE_ENV !== "production"
}

async function requireSubscription() {
  const sub = await getVerifiedSubscriptionFromCookies()
  if (!sub.ok) {
    return { ok: false as const, res: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
  }
  const now = await getTrustedTimeMs()
  if (isVencimentoExpired(now, sub.vencimento) || sub.status !== "ativa") {
    return { ok: false as const, res: NextResponse.json({ error: "Assinatura inválida" }, { status: 403 }) }
  }
  return { ok: true as const, sub }
}

/**
 * GET /api/ops/servicos — catálogo REAL de serviços da loja (model `Servico`),
 * leitura-only para o PDV Assistência (GOAL PDV-ASSISTENCIA-SERVICOS-REAIS-001).
 *
 * Reaproveita a Server Action `listServicos` (mesma normalização usada pelo
 * Cadastros HUB) por um caminho HTTP consistente com `/api/ops/inventory`:
 * sessão + acesso à loja + gate de assinatura (com bypass em dev). Nunca escreve —
 * o CRUD real de serviços permanece em `app/actions/cadastros.ts` (Cadastros HUB).
 */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  const lojaId = storeIdFromAssistecRequestForRead(req)
  if (!lojaId) return NextResponse.json({ error: "storeId obrigatório" }, { status: 400 })
  if (!canAccessStore(session, lojaId)) return NextResponse.json({ error: "Sem acesso à loja" }, { status: 403 })
  try {
    const gate = await requireSubscription()
    if (!gate.ok && !bypassSubscriptionCheck()) return gate.res
    // O Cadastros HUB continua exibindo incompletos para correção. O catálogo
    // operacional, porém, só oferece serviços realmente vendáveis.
    const items = (await listServicos(lojaId)).filter(isServicoDisponivelParaVenda)
    return NextResponse.json({ items })
  } catch (e) {
    const dev = process.env.NODE_ENV === "development"
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/servicos GET] erro:", e)
    return NextResponse.json(
      { error: "Falha ao carregar serviços", ...(dev ? { detail: msg } : {}) },
      { status: 503 },
    )
  }
}
