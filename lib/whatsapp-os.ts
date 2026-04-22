import { labelStatusOS } from "@/lib/os-status"
import type { StatusOrdemServico } from "@/generated/prisma"

/** Extrai dígitos e monta número wa.me (Brasil: 55 + DDD + número). */
export function telefoneParaWaMe(telefone: string | null | undefined): string | null {
  if (!telefone?.trim()) return null
  let d = telefone.replace(/\D/g, "")
  if (d.startsWith("0")) d = d.slice(1)
  if (d.startsWith("55")) {
    if (d.length >= 12 && d.length <= 13) return d
    return null
  }
  if (d.length === 10 || d.length === 11) return `55${d}`
  return null
}

export function buildMensagemWhatsAppOs(params: {
  clienteNome: string
  equipamento: string
  defeito: string
  status: StatusOrdemServico
  valorTotal: number
  osId: string
}): string {
  const statusLabel = labelStatusOS(params.status)
  const valor = params.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const idCurto = params.osId.slice(0, 8)
  return [
    `Olá *${params.clienteNome}*! Atualização da sua ordem de serviço.`,
    "",
    `*Equipamento:* ${params.equipamento}`,
    `*Status do aparelho:* ${statusLabel}`,
    `*Defeito relatado:* ${params.defeito}`,
    `*Valor da OS:* ${valor}`,
    `*OS:* ${idCurto}…`,
    "",
    "Qualquer dúvida, responda esta mensagem.",
  ].join("\n")
}

export function abrirWhatsAppCliente(telefone: string | null | undefined, mensagem: string): boolean {
  const wa = telefoneParaWaMe(telefone)
  if (!wa) return false
  const url = `https://wa.me/${wa}?text=${encodeURIComponent(mensagem)}`
  window.open(url, "_blank", "noopener,noreferrer")
  return true
}
