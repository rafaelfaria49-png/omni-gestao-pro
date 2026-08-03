/**
 * Contador HUB · avaliação pura de escopo/ACL (GOAL 006). Sem IO — testável.
 * Separado de `scope.ts` para não arrastar `next/headers`/`auth` para os testes.
 */
import type { Session } from "next-auth"
import { canAccessStore, getPermissionsFromSession } from "@/lib/auth/enterprise-permissions"
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"

declare const CONTADOR_SCOPE_VALIDADO: unique symbol
declare const CONTADOR_SCOPE_PORTAL_EXTERNO: unique symbol

/** Escopo nominal produzido exclusivamente pelo gate server-side do Contador HUB. */
export type ContadorScopeInterno = Readonly<{
  ok: true
  storeId: string
  userId: string
  permissaoContador: true
  [CONTADOR_SCOPE_VALIDADO]: true
}>

export type FalhaEscopoContador = Readonly<{
  ok: false
  motivo: "nao_autenticado" | "loja_ausente" | "sem_acesso_loja" | "sem_permissao"
}>

export type AvaliacaoAcessoContador =
  | Readonly<{
      ok: true
      storeId: string
      userId: string
      permissaoContador: true
    }>
  | FalhaEscopoContador

export type EscopoContador = ContadorScopeInterno | FalhaEscopoContador

/** Avaliação pura de escopo/ACL da loja ativa para o Contador HUB interno. */
export function avaliarAcessoContador(
  session: Session | null,
  storeIdSelecionado: string | null | undefined,
): AvaliacaoAcessoContador {
  if (!session?.user) return { ok: false, motivo: "nao_autenticado" }
  const userId = String(session.user.id ?? "").trim()
  if (!userId) return { ok: false, motivo: "nao_autenticado" }
  const storeId = (storeIdSelecionado ?? "").trim()
  if (!storeId) return { ok: false, motivo: "loja_ausente" }
  if (!canAccessStore(session, storeId)) return { ok: false, motivo: "sem_acesso_loja" }
  // Permissão DEDICADA do Contador HUB (GOAL 010). Não usa mais `hubs.financeiro`.
  if (!getPermissionsFromSession(session).hubs.contador) {
    return { ok: false, motivo: "sem_permissao" }
  }

  // Decisao serializavel e ainda nao nominal; somente o gate com IO aplica o brand interno.
  return Object.freeze({ ok: true, storeId, userId, permissaoContador: true })
}

/* ───────────────── variante externa read-only (GOAL 015 · auditoria 013 §7.1) ───────────────── */

/**
 * Escopo nominal do PORTAL EXTERNO read-only.
 *
 * SUBTIPO de `ContadorScopeInterno`: os readers read-only (que consomem apenas
 * `storeId` — ver `readers/index.ts`) o aceitam sem mudança de assinatura, e o
 * brand adicional `[CONTADOR_SCOPE_PORTAL_EXTERNO]` marca a PROCEDÊNCIA externa
 * para auditoria de tipos. Nenhum brand existente é enfraquecido: o interno
 * continua exigindo o gate NextAuth e o externo continua exigindo o gate da
 * sessão externa (GOAL 014) — esta factory só aceita um `ContadorScopeExterno`
 * já validado (sessão + vínculo ATIVO conferidos na request), nunca campos
 * soltos vindos do cliente.
 *
 * `permissaoContador: true` é exigido pela FORMA do brand interno; nenhum reader
 * o consulta (o campo nunca é lido para autorizar — ver uso em toda a base: só
 * `storeId` é consumido). Chamável exclusivamente por `lib/contador/portal/**`:
 * código interno NUNCA deve fabricar este escopo (o portal não passa pelos
 * gates de escrita do HUB, que exigem `CapacidadesContador` derivadas de
 * NextAuth — o portal opera sempre com capacidades todas falsas).
 */
export type ContadorScopeExternoReadOnly = ContadorScopeInterno &
  Readonly<{
    /** Papel externo do vínculo (`LEITURA` | `CONFERENCIA`), já validado no gate. */
    papel: ContadorScopeExterno["papel"]
    [CONTADOR_SCOPE_PORTAL_EXTERNO]: true
  }>

/**
 * ÚNICA produtora de `ContadorScopeExternoReadOnly`. Recebe o escopo externo
 * nominal (não há como chamá-la com dados não validados sem violar o tipo).
 */
export function fabricarEscopoPortalExterno(
  escopo: ContadorScopeExterno,
): ContadorScopeExternoReadOnly {
  return Object.freeze({
    ok: true,
    storeId: escopo.storeId,
    userId: escopo.usuario.id,
    permissaoContador: true,
    papel: escopo.papel,
  }) as ContadorScopeExternoReadOnly
}
