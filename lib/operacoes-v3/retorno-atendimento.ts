// ============================================================================
// Operações V3 — rascunho do atendimento de retorno/garantia (puro).
// ----------------------------------------------------------------------------
// Converte a OS original + motivo/observação no `NovaOSDraftV3` que
// `criarOSEnterpriseV3` já sabe persistir. Sem I/O. A OS original continua
// entregue (status final); o atendimento novo nasce aberto, com origem
// retorno/garantia e vínculo explícito gravado depois pela action.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { novaOSDraftVazioV3, type NovaOSDraftV3, type NovaOSSenhaTipoV3 } from "./nova-os-model";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function senhaTipoDe(os: OrdemServico): NovaOSSenhaTipoV3 {
  const tipo = os.senhaEquipamentoTipo;
  return tipo === "padrao" || tipo === "texto" || tipo === "numerica" ? tipo : "numerica";
}

export interface RetornoAtendimentoInputV3 {
  motivo: string;
  observacao?: string;
  garantiaAtiva: boolean;
}

/** Rascunho canônico para reabrir o aparelho como atendimento vinculado. */
export function buildRetornoAtendimentoDraftV3(
  os: OrdemServico,
  input: RetornoAtendimentoInputV3,
  now: Date = new Date(),
): NovaOSDraftV3 {
  const base = novaOSDraftVazioV3(now);
  const motivo = text(input.motivo);
  const observacao = text(input.observacao);
  const codigo = text(os.codigo);
  const notas = [
    codigo ? `Retorno da OS ${codigo}.` : "Retorno em garantia da OS original.",
    observacao,
  ]
    .filter(Boolean)
    .join(" ");

  const clienteId = text(os.clienteId) || text(os.cliente?.id) || undefined;
  const acessorios = Array.isArray(os.equipamento?.acessorios)
    ? os.equipamento.acessorios.map((item) => text(item)).filter(Boolean)
    : [];

  return {
    ...base,
    cliente: {
      id: clienteId,
      nome: text(os.cliente?.nome),
      telefone: text(os.cliente?.telefone) || text(os.cliente?.whatsapp) || undefined,
      documento: text(os.cliente?.documento) || undefined,
      email: text(os.cliente?.email) || undefined,
      tipo: "PF",
    },
    equipamento: {
      ...base.equipamento,
      tipo: text(os.equipamento?.tipo) || "Smartphone",
      marca: text(os.equipamento?.marca),
      modelo: text(os.equipamento?.modelo),
      imei: text(os.equipamento?.numeroSerie) || undefined,
      senha: text(os.senhaEquipamento) || undefined,
      senhaTipo: senhaTipoDe(os),
      acessorios,
    },
    recepcao: {
      ...base.recepcao,
      origem: input.garantiaAtiva ? "garantia" : "retorno",
      prioridade: "alta",
      localFisico: "balcao",
    },
    problema: {
      defeitoRelatado: motivo,
      observacoesInternas: notas || undefined,
    },
  };
}
