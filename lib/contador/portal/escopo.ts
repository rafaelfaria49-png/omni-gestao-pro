/**
 * Contador HUB · Portal externo read-only — adaptadores de escopo (GOAL 015).
 *
 * UMA direção só: `ContadorScopeExterno` (produzido pelo gate da sessão externa,
 * GOAL 014) → escopos consumidos pelos serviços/readers read-only do domínio.
 *
 * NENHUMA função aqui aceita `storeId` do cliente: a loja vem SEMPRE do
 * `ContadorScopeExterno` já validado (sessão + `ContadorAcesso` ATIVO conferidos
 * na request). As rotas (fase 2) é que resolvem o escopo; este módulo só adapta.
 *
 * Capacidades: o portal NUNCA deriva `CapacidadesContador` de NextAuth — usa a
 * constante somente-leitura (tudo falso), então `podeFechar`/`podeReabrir` e
 * afins saem sempre `false` dos serviços reutilizados.
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import {
  fabricarEscopoPortalExterno,
  type ContadorScopeExternoReadOnly,
} from "@/lib/contador/scope-core"
import type { CapacidadesContador } from "@/lib/contador/status/permissoes"
import { PortalPapelInsuficienteError } from "./erros"

/**
 * Capacidades SOMENTE-LEITURA do portal: tudo falso, sempre. Nenhum caminho do
 * portal pode fechar/reabrir competência nem gerenciar acesso externo — e os
 * serviços reutilizados enxergam exatamente isso.
 */
export const CAPACIDADES_PORTAL_READONLY: CapacidadesContador = Object.freeze({
  acessaHub: false,
  podeConferir: false,
  podeGerenciarAcessoExterno: false,
})

/**
 * Escopo estrutural `{ storeId, userId }` consumido pelos serviços read-only
 * reutilizados (documentos, comentários, timeline, fechamento-estado).
 * `userId` é o id técnico do usuário EXTERNO — nunca um AdminUser id.
 */
export type EscopoEstruturalPortal = Readonly<{ storeId: string; userId: string }>

export function escopoEstruturalPortal(escopo: ContadorScopeExterno): EscopoEstruturalPortal {
  return Object.freeze({ storeId: escopo.storeId, userId: escopo.usuario.id })
}

/**
 * Escopo NOMINAL read-only (auditoria 013 §7.1) para os readers agregados
 * (`construirDadosContador` e cia.), que exigem o tipo nominal do domínio.
 */
export function escopoNominalPortal(escopo: ContadorScopeExterno): ContadorScopeExternoReadOnly {
  return fabricarEscopoPortalExterno(escopo)
}

/** Única ação de escrita do portal exige CONFERENCIA — LEITURA é 403 de domínio. */
export function exigirPapelConferencia(escopo: ContadorScopeExterno): void {
  if (escopo.papel !== "CONFERENCIA") throw new PortalPapelInsuficienteError()
}
