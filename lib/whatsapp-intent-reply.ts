import type { VoiceIntent } from "@/lib/voice-intents"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"

/** Mensagem curta para confirmação via WhatsApp após parseVoiceIntent. */
export function buildIntentConfirmationMessage(intent: VoiceIntent): string {
  switch (intent.kind) {
    case "pdv_sale":
      return intent.itemName
        ? `Comando reconhecido: venda — ${intent.itemName}${intent.price != null ? ` (${intent.price.toFixed(2)})` : ""}. Conclua no PDV se necessário.`
        : "Comando reconhecido: abrir venda no PDV."
    case "os_new":
      return `Comando reconhecido: nova O.S.${intent.clienteNome ? ` Cliente: ${intent.clienteNome}.` : ""}`
    case "cadastro_cliente":
      return "Comando reconhecido: cadastro de cliente. Abra o módulo Clientes no painel."
    case "cadastro_produto":
      return "Comando reconhecido: cadastro de produto. Abra Estoque no painel."
    case "cadastro_fornecedor":
      return "Comando reconhecido: fornecedores. Use Contas a Pagar no painel."
    case "estoque_view":
      return `Comando reconhecido: consultar estoque. Veja o painel ${APP_DISPLAY_NAME}.`
    case "preco_consulta":
      return `Comando reconhecido: consulta de preço — ${intent.produtoQuery}.`
    case "entrada_mercadoria":
      return "Comando reconhecido: entrada de mercadoria. Abra importação de NF no estoque."
    case "abrir_caixa":
      return "Comando reconhecido: abrir caixa. Use o PDV no painel."
    case "relatorio_vendas":
      return "Comando reconhecido: relatório de vendas. Abra Financeiro no painel."
    case "faturamento":
      return "Comando reconhecido: faturamento. Abra Fluxo de Caixa no painel."
    case "orcamento":
      return "Comando reconhecido: orçamentos. Abra o módulo Orçamentos."
    case "consultar_credito":
      return "Comando reconhecido: consulta de crédito. Abra Clientes no painel."
    case "fechar_dia":
      return "Fechamento do dia: gerando resumo e enviando para o WhatsApp do dono (se configurado)."
    default:
      return "Comando processado."
  }
}
