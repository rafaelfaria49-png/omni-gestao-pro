import type { PagamentoLinha } from "@/lib/contas-receber-pagamentos"

/**
 * Título em Contas a Receber (localStorage no painel; opcionalmente espelhado em `ContaReceberTitulo` no Prisma).
 */
export type ContaReceberRow = {
  id: string | number
  descricao: string
  cliente: string
  valor: number
  vencimento: string
  status: string
  tipo: string
  movimentoBaixaId?: string
  /** Linhas de recebimento (local); status PENDENTE após estorno. */
  historicoPagamentos?: PagamentoLinha[]
  /** Controles manuais de parcela/baixas parciais (opcional) */
  parcelasTotal?: number
  formaPagamentoPreferida?: string
  observacoesPagamento?: string
  /** Total original da venda (ex.: banco / importação). */
  total_value?: number
  /** Entrada já paga no contrato; parcelas = saldo após entrada ÷ N (não divide o total bruto). */
  entry_value?: number
  /** Parcelas vindas do banco (quando existir). `id` estável para integridade de baixa. */
  parcelas?: Array<{ id?: string; vencimento: string; valor: number }>
  /**
   * Referências de vendas vinculadas (PDV / importação). Espelha a relação Prisma
   * `ContaReceberTitulo.vendas` quando os dados vêm do servidor com `include: { vendas: true }`.
   */
  vendas?: Array<{ pedidoId?: string; saleId?: string; total?: number }>
}
