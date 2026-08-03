/**
 * Escopo canônico das vendas de uma sessão de caixa.
 *
 * Antes, a LISTA de vendas da sessão usava o vínculo `payload.sessaoId` enquanto os
 * TOTAIS (`sessao-detalhe`) e o snapshot de fechamento (`caixa/fechar`) usavam apenas a
 * janela `abertaEm..fechadaEm`. Uma venda registrada segundos ANTES do POST que abriu a
 * sessão aparecia na lista e ficava FORA dos totais.
 *
 * Caso real (loja-2, PDV1, 02/08/2026): a sessão foi aberta às 09:26:55 e as vendas
 * VDA-2026-0590 (09:25:46) e VDA-2026-0591 (09:26:17) — R$ 22,98 — pertenciam a ela pelo
 * vínculo, mas não entravam no fechamento: a tela listava 7 vendas e somava 5.
 *
 * Agora lista e totais saem do MESMO conjunto: vínculo explícito quando existe; janela +
 * terminal apenas como fallback para sessões legadas (anteriores ao vínculo no payload).
 * Nenhuma FK nova, nenhuma alteração de dado — só o escopo da leitura.
 */

/** Modo como o conjunto de vendas da sessão foi resolvido. */
export type EscopoVendasModo = "vinculo" | "janela"

/** Campos mínimos de venda usados pelos totais (o restante do row é irrelevante aqui). */
export type VendaDaSessao = {
  pedidoId: string
  total: number
  status: string
}

/**
 * Escolhe o conjunto autoritativo: o vínculo explícito vence sempre que existir.
 * A janela só entra quando NENHUMA venda referencia a sessão (sessão legada).
 */
export function escolherEscopoVendas<T>(
  porVinculo: readonly T[],
  porJanela: readonly T[],
): { vendas: T[]; modo: EscopoVendasModo } {
  return porVinculo.length > 0
    ? { vendas: [...porVinculo], modo: "vinculo" }
    : { vendas: [...porJanela], modo: "janela" }
}

/** Arredonda para centavos (mesma convenção das rotas de caixa). */
function centavos(valor: number): number {
  return Math.round(valor * 100) / 100
}

/**
 * Soma as vendas ATIVAS do conjunto. Venda cancelada é excluída — o cancelamento já
 * é propagado para `Venda.status` e não pode continuar contando no fechamento.
 */
export function somarVendasAtivas(vendas: readonly VendaDaSessao[]): {
  total: number
  count: number
  pedidoIds: string[]
} {
  const ativas = vendas.filter((v) => v.status !== "cancelada")
  return {
    total: centavos(ativas.reduce((soma, v) => soma + (Number(v.total) || 0), 0)),
    count: ativas.length,
    pedidoIds: ativas.map((v) => v.pedidoId).filter((id) => typeof id === "string" && id.length > 0),
  }
}

/**
 * `where` da agregação do ledger financeiro para as vendas da sessão.
 *
 * `MovimentacaoFinanceira.referenciaId` recebe o `pedidoId` da venda
 * (`lib/ops-upsert-venda.ts`), então o vínculo é direto e não depende de `createdAt` —
 * é isso que corrige a venda que caiu fora da janela.
 *
 * Lista vazia devolve `null`: o chamador deve tratar como total zero SEM consultar o
 * banco (um `in: []` no Prisma casaria com nada, mas a chamada seria desperdício).
 */
export function financeiroDasVendasWhere(
  storeId: string,
  pedidoIds: readonly string[],
): { storeId: string; origem: string; tipo: string; referenciaId: { in: string[] } } | null {
  if (pedidoIds.length === 0) return null
  return {
    storeId,
    origem: "venda",
    tipo: "entrada",
    referenciaId: { in: [...pedidoIds] },
  }
}
