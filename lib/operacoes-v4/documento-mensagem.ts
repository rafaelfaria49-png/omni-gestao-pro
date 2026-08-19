// Mensagens de WhatsApp para documentos da OS (wa.me — mesmo contrato do orçamento).
// Texto nasce dos modelos V3 já usados na impressão; não chama Cloud API.

import type { OrdemServico } from "@/types/os";
import { documentoMetaV3, type DocumentoTipoV3 } from "@/lib/operacoes-v3/documentos";
import { termoGarantiaTextoV3 } from "@/lib/operacoes-v3/garantia-textos";
import { lerEntregaV3 } from "@/lib/operacoes-v3/pos-venda-model";
import { termoGarantiaDaOSV3 } from "@/lib/operacoes-v3/print-model";
import { statusMetaV3, statusV3FromOS } from "@/lib/operacoes-v3/status-machine";
import { montarOrcamentoClienteViewV4 } from "./orcamento-cliente-view";
import { montarMensagemOrcamentoV4 } from "./orcamento-mensagem";

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function aparelhoLabel(os: OrdemServico): string {
  return [s(os.equipamento?.marca), s(os.equipamento?.modelo)].filter(Boolean).join(" ");
}

/** Atualização curta da OS para o botão WhatsApp do painel contextual. */
export function montarMensagemAtualizacaoOSV4(os: OrdemServico): string {
  const linhas = [
    `Atualização da OS ${os.codigo || "—"}`,
    `Status: ${statusMetaV3(statusV3FromOS(os)).label}`,
  ];
  const cliente = s(os.cliente?.nome);
  if (cliente) linhas.push(`Cliente: ${cliente}`);
  const aparelho = aparelhoLabel(os);
  if (aparelho) linhas.push(`Aparelho: ${aparelho}`);
  return linhas.join("\n");
}

/** Texto do documento aberto no modal de impressão, para envio via wa.me. */
export function montarMensagemDocumentoV4(tipo: DocumentoTipoV3, os: OrdemServico): string {
  const codigo = os.codigo || "OS";
  const cliente = s(os.cliente?.nome);
  const aparelho = aparelhoLabel(os);

  switch (tipo) {
    case "termo_garantia": {
      const linhas = [`Termo de Garantia — ${codigo}`];
      if (cliente) linhas.push(`Cliente: ${cliente}`);
      if (aparelho) linhas.push(`Aparelho: ${aparelho}`);
      linhas.push("", termoGarantiaTextoV3(termoGarantiaDaOSV3(os)));
      return linhas.join("\n").trim();
    }
    case "termo_entrega": {
      const e = lerEntregaV3(os);
      const linhas = [`Termo de Entrega — ${codigo}`];
      if (cliente) linhas.push(`Cliente: ${cliente}`);
      if (aparelho) linhas.push(`Aparelho: ${aparelho}`);
      if (e.recebidoPor) linhas.push(`Retirado por: ${e.recebidoPor}`);
      if (e.entregueEm) linhas.push(`Entregue em: ${e.entregueEm}`);
      return linhas.join("\n");
    }
    case "os_cliente": {
      const linhas = [`Ordem de Serviço ${codigo}`, `Status: ${statusMetaV3(statusV3FromOS(os)).label}`];
      if (cliente) linhas.push(`Cliente: ${cliente}`);
      if (aparelho) linhas.push(`Aparelho: ${aparelho}`);
      const defeito = s(os.equipamento?.defeitoRelatado);
      if (defeito) linhas.push(`Defeito: ${defeito}`);
      return linhas.join("\n");
    }
    case "orcamento_cliente": {
      const view = montarOrcamentoClienteViewV4(os);
      return view ? montarMensagemOrcamentoV4(view) : `Orçamento — ${codigo}`;
    }
    default:
      return `${documentoMetaV3(tipo).label} — ${codigo}`;
  }
}
