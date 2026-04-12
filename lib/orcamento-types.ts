import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"

/** Orçamento persistido no mesmo armazenamento das operações (multiloja). */
export interface Orcamento {
  id: string
  numero: string
  cliente: OrdemServico["cliente"]
  aparelho: OrdemServico["aparelho"]
  defeito: string
  validadeAte: string
  custoPeca: number
  valorFinalCliente: number
  termoGarantia: string
  status: "pendente" | "aprovado" | "recusado" | "convertido"
  convertidoParaNumeroOS?: string
  /** Pagamento pelo portal do cliente (orçamentos aprovados). */
  pagamentoCliente?: "pendente" | "pago"
}
