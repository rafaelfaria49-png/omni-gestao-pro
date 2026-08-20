/**
 * Contador HUB · Legado — encerramento do portal `/contador` (GOAL 019 · gate G4).
 *
 * Decisão humana G4 (Rafael, 2026-08-20, publicada em `main`): o portal legado é
 * encerrado por **REDIRECT para o portal v2**, NÃO por remoção. Nada é apagado do
 * tree: `app/contador/**`, `app/login-contador/**` e o adapter de sessão legada
 * continuam existindo — o que muda é que nenhuma navegação chega até eles enquanto
 * o kill-switch estiver na posição padrão.
 *
 * Classificação pura e Edge-safe (o `proxy.ts` roda em Edge e só consome estas
 * funções). Sem `process.env` aqui: a leitura da flag é do chamador, para o módulo
 * permanecer testável e determinístico.
 *
 * ── por que o alvo é `/contador-externo/login` ──
 * É a rota REAL do portal v2 no repositório (`app/contador-externo/login/page.tsx`),
 * e é a única entrada que NÃO depende de `CONTADOR_PORTAL_V2`: as páginas de dados
 * do portal (`_portal-pagina.ts`) respondem 404 com a flag desligada, mas o login do
 * v2 responde sempre. Apontar para `/contador-externo` levaria quem ainda não tem
 * sessão a um redirect extra, e apontar para uma rota gated levaria a 404 enquanto o
 * rollout do v2 não estivesse concluído. O login já reencaminha para `/contador-externo`
 * quem tem sessão válida.
 */

/** Entrada do portal v2 — rota real, verificada no repositório. */
export const PORTAL_V2_LOGIN = "/contador-externo/login" as const
/** Raiz do portal v2 (lista de lojas vinculadas), para referência do runbook. */
export const PORTAL_V2_RAIZ = "/contador-externo" as const

/**
 * `true` para o segmento do portal EXTERNO (v2). Precede qualquer classificação de
 * legado: `/contador-externo` começa com `/contador` e NUNCA pode ser redirecionado
 * para si mesmo — isso seria um laço.
 */
export function isSegmentoPortalV2(pathname: string): boolean {
  return pathname === PORTAL_V2_RAIZ || pathname.startsWith(`${PORTAL_V2_RAIZ}/`)
}

/**
 * `true` para as páginas do portal LEGADO: `/contador`, `/contador/**`,
 * `/login-contador` e `/login-contador/**`.
 *
 * Casa por segmento, nunca por prefixo cru: `/contador-externo/...` e
 * `/contadores` NÃO são legado. É esta função que impede o redirect de capturar
 * rotas vizinhas.
 */
export function isRotaLegadaContador(pathname: string): boolean {
  if (isSegmentoPortalV2(pathname)) return false
  if (pathname === "/contador" || pathname.startsWith("/contador/")) return true
  if (pathname === "/login-contador" || pathname.startsWith("/login-contador/")) return true
  return false
}

/**
 * Destino de uma rota legada quando o portal legado está DESLIGADO (posição padrão
 * a partir do GOAL 019).
 *
 * `null` significa "não é rota legada — siga o fluxo normal do proxy". O destino é
 * sempre o mesmo, sem `?next=`: carregar o caminho legado como `next` do portal v2
 * seria oferecer ao v2 um retorno para uma página que já não atende.
 */
export function destinoLegadoContador(pathname: string): string | null {
  return isRotaLegadaContador(pathname) ? PORTAL_V2_LOGIN : null
}
