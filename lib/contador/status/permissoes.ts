/**
 * Contador HUB · capacidades de status por papel (GOAL 011).
 *
 * Fecha a pendência deixada em aberto pela ADR-CONTADOR-005 ("quem pode marcar
 * `conferido` internamente"): **papel financeiro ou administrador**.
 *
 * Traduzido para a matriz enterprise já existente (`lib/auth/enterprise-permissions`):
 *
 *   - administrador  → `admin.masterConsole`
 *   - papel financeiro → `financeiro.edit` (somente para `podeConferir`)
 *
 * GOAL 014 (ajuste G3): a gestão da identidade EXTERNA do contador NÃO reusa
 * `financeiro.edit` (fallback silencioso proibido pelo comando humano) — ela
 * exige a permissão ESPECÍFICA do domínio `contador.manageExternalAccess`
 * (admin/gerente na matriz Fase 1), com `admin.masterConsole` como caminho
 * administrativo. Ver docstring do tipo.
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
  /**
   * GOAL 014 — pode gerenciar a identidade EXTERNA do contador (convites,
   * vínculos e suspensão/reativação da identidade).
   *
   * Critério (ajuste G3, permissão específica — ZERO referência a
   * `financeiro.edit`):
   *
   *   hubs.contador && (contador.manageExternalAccess || admin.masterConsole)
   *
   * `contador.manageExternalAccess` é a permissão explícita do domínio Contador
   * na matriz enterprise (admin e gerente na Fase 1); `admin.masterConsole`
   * também administra (caminho do administrador). Campo OBRIGATÓRIO e enumerável.
   */
  podeGerenciarAcessoExterno: boolean
}>

/** Capacidades derivadas da sessão NextAuth. Fail-closed em sessão ausente. */
export function resolverCapacidadesContador(session: Session | null): CapacidadesContador {
  const p = getPermissionsFromSession(session)
  const acessaHub = session?.user ? p.hubs.contador === true : false
  // Só faz sentido operar dentro do HUB: sem acesso ao hub, nenhuma capacidade.
  const elevado = acessaHub && (p.admin.masterConsole === true || p.financeiro.edit === true)
  const gerenciaExterno =
    acessaHub && (p.contador.manageExternalAccess === true || p.admin.masterConsole === true)
  return Object.freeze({
    acessaHub,
    podeConferir: elevado,
    podeGerenciarAcessoExterno: gerenciaExterno,
  })
}
