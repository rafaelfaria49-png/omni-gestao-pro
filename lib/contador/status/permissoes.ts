/**
 * Contador HUB · capacidades de status por papel (GOAL 011).
 *
 * Fecha a pendência deixada em aberto pela ADR-CONTADOR-005 ("quem pode marcar
 * `conferido` internamente"): **papel financeiro ou administrador**.
 *
 * Traduzido para a matriz enterprise já existente (`lib/auth/enterprise-permissions`),
 * sem criar permissão nova e sem tocar naquele arquivo:
 *
 *   - administrador  → `admin.masterConsole`
 *   - papel financeiro → `financeiro.edit`
 *
 * PURO: recebe a `Session` já resolvida pelo servidor. Nada aqui aceita papel, loja
 * ou usuário enviados pelo cliente — o chamador obtém a sessão via `auth()`.
 */
import type { Session } from "next-auth"
import { getPermissionsFromSession } from "@/lib/auth/enterprise-permissions"

export type CapacidadesContador = Readonly<{
  /** Acesso ao HUB (mesma permissão dedicada usada pelo gate de escopo). */
  acessaHub: boolean
  /** Pode marcar `conferido`/`resolvido` — papel financeiro ou administrador. */
  podeConferir: boolean
}>

/** Capacidades derivadas da sessão NextAuth. Fail-closed em sessão ausente. */
export function resolverCapacidadesContador(session: Session | null): CapacidadesContador {
  const p = getPermissionsFromSession(session)
  const acessaHub = session?.user ? p.hubs.contador === true : false
  return Object.freeze({
    acessaHub,
    // Só faz sentido conferir dentro do HUB: sem acesso ao hub, nenhuma capacidade.
    podeConferir: acessaHub && (p.admin.masterConsole === true || p.financeiro.edit === true),
  })
}
