import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

/**
 * Contrato canónico de acesso (GOAL PLAT-AUTH-PROXY-SESSION-ENTITLEMENT-003D).
 *
 * ⚠️ CONTENÇÃO TEMPORÁRIA — NÃO É A ARQUITETURA FINAL.
 *
 * Separa os três conceitos que estavam misturados no selo `assistec_sub_v1`:
 *
 *   1. IDENTIDADE      → sessão NextAuth + utilizador existente e ativo (aqui).
 *   2. ENTITLEMENT     → assinatura da empresa. **Ainda não verificável**: o
 *                        schema não expressa a relação funcionário → empresa
 *                        assinante (não há Tenant/Organization, `Store` não tem
 *                        dono, e a assinatura Stripe vive por `AdminUser`).
 *   3. AUTORIZAÇÃO     → papel, membership, lojas e permissões de HUB, que
 *                        permanecem nos gates server-side existentes
 *                        (`requireEnterpriseWith`, `canAccessStore`, …).
 *
 * Enquanto (2) não tiver fonte confiável, a verificação comercial fica FORA do
 * caminho de entrada — de forma explícita e uniforme para todos os utilizadores
 * autenticados, para que funcionário e ADMIN não tenham regras contraditórias.
 * Resolver isto exige migration aditiva (GOAL de Tenant/Organization).
 *
 * O que este módulo garante desde já:
 *   · sem sessão NextAuth não há acesso — um selo isolado nunca autentica;
 *   · utilizador inexistente ou desativado é recusado;
 *   · nenhum papel administrativo é concedido por aqui.
 */

/**
 * Marcador de "entitlement comercial ainda não verificado".
 *
 * NÃO é uma data comercial real: existe apenas para preencher o formato que os
 * gates legados esperam enquanto (2) não tem fonte confiável. Nunca deve ser
 * exibido ao utilizador nem persistido. Removido pelo GOAL de Tenant.
 */
export const ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO = "9999-12-31"

export type SessionEntitlement =
  | {
      ok: true
      userId: string
      role: string
      /** Plano real do registo de billing quando existir; "" quando desconhecido. */
      plano: string
      /** Sempre "ativa": ver `ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO`. */
      status: "ativa"
      vencimento: string
      source: "session"
    }
  | { ok: false; reason: "no_session" | "user_not_found" | "user_inactive" }

/**
 * Resolve identidade a partir da sessão NextAuth e confirma no servidor que o
 * utilizador continua a existir e está ativo — um JWT emitido antes da
 * desativação não pode continuar a valer.
 */
export async function getSessionEntitlement(): Promise<SessionEntitlement> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, reason: "no_session" }

  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { active: true, planName: true, role: true },
  })
  if (!user) return { ok: false, reason: "user_not_found" }
  if (user.active === false) return { ok: false, reason: "user_inactive" }

  return {
    ok: true,
    userId,
    role: String(session?.user?.role ?? user.role ?? ""),
    plano: String(user.planName ?? "").trim().toLowerCase(),
    status: "ativa",
    vencimento: ENTITLEMENT_NAO_VERIFICADO_VENCIMENTO,
    source: "session",
  }
}
