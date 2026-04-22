export type CarteiraTipo = "empresa" | "pessoal"

export interface Carteira {
  id: string
  nome: string
  saldoInicial: number
  cor: string
  tipo: CarteiraTipo
}

export interface MovimentoFinanceiro {
  id: string
  carteiraId: string
  tipo: "entrada" | "saida"
  valor: number
  descricao: string
  categoria: string
  status?: "Pago" | "Pendente"
  at: string
}

export interface TransferenciaCarteira {
  id: string
  deCarteiraId: string
  paraCarteiraId: string
  valor: number
  at: string
  observacao?: string
}

export interface ContaPagarItem {
  id: string
  descricao: string
  fornecedor: string
  valor: number
  /** YYYY-MM-DD */
  dataVencimento: string
  status: "pendente" | "pago" | "atrasado"
  categoria: string
}

export const CARTEIRAS_INICIAIS: Carteira[] = [
  {
    id: "cart-pessoal",
    nome: "Pessoal",
    saldoInicial: 0,
    cor: "#6366f1",
    tipo: "pessoal",
  },
  {
    id: "cart-rafacell",
    nome: "Empresa (caixa)",
    saldoInicial: 0,
    cor: "#0ea5e9",
    tipo: "empresa",
  },
  {
    id: "cart-rafa-brinquedos",
    nome: "Operação secundária",
    saldoInicial: 0,
    cor: "#f97316",
    tipo: "empresa",
  },
]
