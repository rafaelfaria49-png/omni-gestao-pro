/**
 * Texto do orçamento para envio via WhatsApp (layout enxuto).
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export type OrcamentoWhatsAppInput = {
  numero: string
  clienteNome: string
  /** Ex.: marca + modelo */
  aparelhoTexto: string
  /** Descrição do serviço / defeito */
  servico: string
  /** Valor total cobrado do cliente (sem custo interno). */
  valorTotal: number
  /** Data ISO YYYY-MM-DD */
  validadeAte: string
  /** Dias na linha “Garantia: X dias”; padrão 90. */
  garantiaPadraoDias?: number
}

export function buildOrcamentoWhatsAppMessage(input: OrcamentoWhatsAppInput): string {
  const total = input.valorTotal
  const validade = new Date(`${input.validadeAte}T12:00:00`).toLocaleDateString("pt-BR")
  const aparelho = input.aparelhoTexto.trim() || "—"
  const servico = input.servico.trim() || "—"
  const diasG = input.garantiaPadraoDias ?? 90

  return [
    `*Orçamento ${input.numero}*`,
    "",
    `Cliente: ${input.clienteNome}`,
    "",
    `Aparelho: ${aparelho}`,
    "",
    `Serviço: ${servico}`,
    "",
    `Valor Total: ${brl.format(total)}`,
    "",
    `Garantia: ${diasG} dias (conforme termos)`,
    "",
    `Validade: ${validade}`,
  ].join("\n")
}
