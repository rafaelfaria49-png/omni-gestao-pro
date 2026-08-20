/**
 * Portal externo read-only — guarda SERVER-SIDE das páginas de dados (GOAL 015,
 * fase 3). Mesmo contrato do `_portal.ts` das rotas, na linguagem de página.
 *
 * Cadeia obrigatória de TODA página de dados do portal:
 *   flag ON → escopo externo da `[loja]` do PATH (sessão + `ContadorAcesso` ATIVO
 *   conferidos a CADA render) → domínio read-only.
 *
 * Flag OFF → `notFound()` ANTES de qualquer trabalho: a página "não existe", sem
 * confirmar sessão, loja ou recurso. `acesso_negado` também é 404 — o portal
 * NUNCA confirma que uma loja alheia existe (anti-enumeração, §9 da auditoria).
 *
 * A loja nunca vem de query/body: é sempre o segmento do path, validado contra o
 * vínculo do usuário externo. Revogação/suspensão valem na navegação seguinte.
 */
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import {
  resolverEscopoExterno,
  type ContadorScopeExterno,
} from "@/lib/contador/auth-externa/escopo-externo"
import { criarRepoAuthExterna } from "@/lib/contador/auth-externa/repo-prisma"
import { CONTADOR_EXTERNO_COOKIE } from "@/lib/contador/auth-externa/sessao"
import { portalExternoV2Habilitado } from "@/lib/contador/portal/flag"
import { METRICAS, registrarMetrica } from "@/lib/contador/observabilidade"

/** Rótulo curto e estável do emissor, para a label `origem` das métricas (GOAL 019). */
const ORIGEM_METRICA = "portal_pagina"

/**
 * Resolve o escopo da página ou encerra o render (404/redirect). Só retorna com
 * um `ContadorScopeExterno` já validado — não há caminho de sucesso parcial.
 *
 * `indisponivel` (segredo de sessão ausente) NÃO redireciona: devolve `null` para
 * a página renderizar a tela honesta de indisponibilidade, igual ao GOAL 014.
 */
export async function escopoDaPaginaPortal(loja: string): Promise<ContadorScopeExterno | null> {
  if (!portalExternoV2Habilitado()) {
    negado("flag_off")
    notFound()
  }

  const token = (await cookies()).get(CONTADOR_EXTERNO_COOKIE)?.value ?? null
  const escopo = await resolverEscopoExterno(criarRepoAuthExterna(), { token, storeId: loja })

  if (escopo.ok) return escopo
  negado(escopo.motivo)
  if (escopo.motivo === "indisponivel") return null
  if (escopo.motivo === "acesso_negado") notFound()
  if (escopo.motivo === "sessao_invalida") redirect("/contador-externo/sessao-expirada")
  redirect("/contador-externo/login")
}

/**
 * GOAL 019 — métrica de acesso negado do portal.
 *
 * O `motivo` é um rótulo técnico de união fechada (`flag_off`, `nao_autenticado`,
 * `sessao_invalida`, `acesso_negado`, `indisponivel`), nunca texto livre. A LOJA
 * pedida NÃO entra na métrica de propósito: o portal é anti-enumeração (§9 da
 * auditoria 013) e publicar o segmento pedido devolveria, pelo painel, exatamente a
 * confirmação de existência que o `notFound()` recusa a dar.
 */
function negado(motivo: string): void {
  registrarMetrica(METRICAS.portalAcessoNegadoTotal, 1, { origem: ORIGEM_METRICA, motivo })
}
