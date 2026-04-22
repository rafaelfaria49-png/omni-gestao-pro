/** Tipos compartilhados entre PDV (client) e rotas `/api/ops/vendas-*` (server). */

export interface PaymentBreakdownFull {
  dinheiro: number
  pix: number
  cartaoDebito: number
  cartaoCredito: number
  carne: number
  /** Valor faturado “à prazo” (conta do cliente / título em Contas a Receber). */
  aPrazo: number
  creditoVale: number
}

export interface SaleLineRecord {
  inventoryId: string
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
  qtyReturned?: number
}

export interface SaleRecord {
  id: string
  at: string
  lines: SaleLineRecord[]
  total: number
  customerCpf?: string
  customerName?: string
  paymentBreakdown: PaymentBreakdownFull
}

export interface DevolucaoRecord {
  id: string
  at: string
  saleId: string
  customerCpf: string
  customerName: string
  lines: { inventoryId: string; name: string; quantity: number; valor: number }[]
  mode: "vale_credito" | "somente_estoque"
  creditIssued: number
}
