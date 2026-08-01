/**
 * Portal externo — aceite de convite (GOAL 014, ajuste G3).
 *
 * PÁGINA ESTÁTICA: o token NUNCA trafega em path (`/convite/[token]` é proibido)
 * nem em query (`?token=`) — ele chega SOMENTE no fragmento
 * (`/contador-externo/convite#token=<token>`), que o navegador jamais envia ao
 * servidor em navegação, logs de acesso, proxies ou Referer.
 *
 * Todo o fluxo acontece no client component: lê o fragmento UMA vez, limpa a
 * barra de endereço com `history.replaceState` e troca o token por POST no body.
 * Nenhum dado de sessão é necessário aqui — a página é pública por construção.
 */
import { ConviteAceite } from "./convite-aceite"

export const dynamic = "force-static"

export default function ConvitePage() {
  return <ConviteAceite />
}
