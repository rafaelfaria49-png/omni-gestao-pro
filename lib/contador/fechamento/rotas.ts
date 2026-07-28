/**
 * Contador HUB · guardas comuns das rotas de fechamento e pacote (GOAL 012).
 *
 * Vive fora de `app/api/**` porque um `route.ts` do Next só pode exportar handlers e
 * config — qualquer outro export vira erro de build. Centralizar aqui também evita o
 * problema apontado na revisão do GOAL 011: três rotas com listas de chaves proibidas
 * divergentes, cada uma esquecendo uma chave diferente.
 */
import { NextResponse } from "next/server"

/**
 * Chaves que NUNCA podem influenciar autorização ou escopo, venham de query ou corpo.
 * Nenhuma delas é lida pelos serviços — a recusa é defesa em profundidade, para que
 * um cliente que tente forjar loja/papel receba 400 em vez de ser silenciosamente ignorado.
 */
export const CHAVES_PROIBIDAS_FECHAMENTO = [
  "storeId",
  "lojaId",
  "papel",
  "role",
  "userId",
  "atorId",
  "autorId",
  "competenciaId",
] as const

export function temChaveProibida(fonte: Record<string, unknown> | URLSearchParams): boolean {
  if (fonte instanceof URLSearchParams) {
    return CHAVES_PROIBIDAS_FECHAMENTO.some((k) => fonte.has(k))
  }
  return CHAVES_PROIBIDAS_FECHAMENTO.some((k) =>
    Object.prototype.hasOwnProperty.call(fonte, k),
  )
}

export function respostaChaveProibida(): NextResponse {
  return NextResponse.json(
    { ok: false, mensagem: "O endpoint não aceita loja, usuário, papel ou competência por id." },
    { status: 400 },
  )
}

/** Corpo JSON tolerante: body inválido vira objeto vazio (a validação é do serviço). */
export async function lerCorpoJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

export const CABECALHO_PRIVADO = { "Cache-Control": "private, no-store, max-age=0" } as const
