/**
 * Contador HUB · classificação de rotas do portal externo para o proxy (GOAL 014,
 * ajuste G3 #4). Puro e testável — o `proxy.ts` (Edge) só consome estas funções.
 *
 * O segmento `/contador-externo/**` NÃO é ERP: não exige selo de assinatura da
 * loja nem sessão NextAuth. Mas "não é ERP" não significa "público" — somente as
 * TRÊS rotas exatas de `CONTADOR_EXTERNO_ROTAS_PUBLICAS` são públicas (login,
 * aceite de convite e sessão expirada).
 *
 * Todo o restante do segmento se AUTOPROTEGE no servidor, falhando fechado:
 * páginas server-validam a sessão externa a cada request e redirecionam para
 * o login; APIs respondem 401/403 genéricos. O gate de sessão externa NO PROXY
 * é escopo do GOAL 015 (gate G-AUTH) — aqui nada de verificação de sessão.
 */
export const CONTADOR_EXTERNO_ROTAS_PUBLICAS = [
  "/contador-externo/login",
  "/contador-externo/convite",
  "/contador-externo/sessao-expirada",
] as const

/** Segmento do portal externo (qualquer path sob `/contador-externo`). */
export function isSegmentoContadorExterno(pathname: string): boolean {
  return pathname === "/contador-externo" || pathname.startsWith("/contador-externo/")
}

/**
 * Rota PÚBLICA do portal externo — match EXATO (sem prefixo):
 * `/contador-externo/login/x` ou `/contador-externo/convite/abc` NÃO são públicas.
 */
export function isRotaPublicaContadorExterno(pathname: string): boolean {
  return (CONTADOR_EXTERNO_ROTAS_PUBLICAS as readonly string[]).includes(pathname)
}
