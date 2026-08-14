// ============================================================================
// Operações V4 — contratos compartilhados do atendimento comercial (GOAL 001).
// Cliente, aparelho e origem iguais em Nova OS e Novo orçamento.
// Puro: sem I/O, sem React.
// ============================================================================

import type { NovaOSEquipV4, NovaOSOrigemV4 } from "./nova-os-draft-from-form";

export type ClienteAtendimentoModoV4 = "existente" | "novo" | "balcao";

export interface ClienteAtendimentoExistenteV4 {
  id: string;
  nome: string;
  telefone?: string;
  documento?: string;
  email?: string;
}

export interface ClienteAtendimentoNovoV4 {
  nome: string;
  telefone: string;
  documento: string;
  email: string;
}

export interface ClienteAtendimentoStateV4 {
  modo: ClienteAtendimentoModoV4;
  existente: ClienteAtendimentoExistenteV4 | null;
  novo: ClienteAtendimentoNovoV4;
}

export function clienteAtendimentoVazioV4(
  modo: ClienteAtendimentoModoV4 = "existente",
): ClienteAtendimentoStateV4 {
  return { modo, existente: null, novo: { nome: "", telefone: "", documento: "", email: "" } };
}

export function validarClienteAtendimentoV4(
  c: ClienteAtendimentoStateV4,
  opts: { exigirTelefoneNovo?: boolean; permitirBalcao?: boolean } = {},
): string | null {
  if (c.modo === "balcao") {
    return opts.permitirBalcao ? null : "Cliente balcão não é permitido neste fluxo.";
  }
  if (c.modo === "existente" && !c.existente?.id?.trim()) {
    return "Selecione o cliente existente.";
  }
  if (c.modo === "novo") {
    if (!c.novo.nome.trim()) return "Informe o nome do cliente.";
    if (opts.exigirTelefoneNovo && !c.novo.telefone.trim()) {
      return "Informe o telefone do cliente (necessário para enviar o orçamento depois).";
    }
  }
  return null;
}

export const EQUIP_TIPO_ATENDIMENTO_V4: Array<{ key: NovaOSEquipV4; label: string }> = [
  { key: "celular", label: "Celular" },
  { key: "tablet", label: "Tablet" },
  { key: "notebook", label: "Notebook" },
  { key: "videogame", label: "Videogame" },
  { key: "outro", label: "Outro" },
];

export interface AparelhoAtendimentoV4 {
  tipo: NovaOSEquipV4;
  marca: string;
  modelo: string;
  imei: string;
  cor: string;
  defeitoRelatado: string;
}

export function aparelhoAtendimentoVazioV4(): AparelhoAtendimentoV4 {
  return { tipo: "celular", marca: "", modelo: "", imei: "", cor: "", defeitoRelatado: "" };
}

export function validarAparelhoAtendimentoV4(
  a: AparelhoAtendimentoV4,
  opts: { exigirDefeito?: boolean } = {},
): string | null {
  if (!a.marca.trim() || !a.modelo.trim()) return "Informe marca e modelo do aparelho.";
  if (opts.exigirDefeito !== false && !a.defeitoRelatado.trim()) {
    return "Descreva o defeito relatado.";
  }
  return null;
}

/** Origem comercial do atendimento — UI. Persistida em comercialV4; V3 recebe o mapeamento. */
export type OrigemAtendimentoComercialV4 = "whatsapp" | "balcao" | "instagram" | "ligacao" | "outro";

export const ORIGEM_ATENDIMENTO_COMERCIAL_V4: Array<{ key: OrigemAtendimentoComercialV4; label: string }> = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "balcao", label: "Balcão" },
  { key: "instagram", label: "Instagram" },
  { key: "ligacao", label: "Ligação" },
  { key: "outro", label: "Outro" },
];

export function origemComercialParaV3(origem: OrigemAtendimentoComercialV4): NovaOSOrigemV4 {
  return origem === "whatsapp" ? "whatsapp" : "balcao";
}

export function lucroEstimadoV4(venda: number, custo: number): number {
  return Math.round((Math.max(0, venda) - Math.max(0, custo)) * 100) / 100;
}

export function margemEstimadaV4(venda: number, custo: number): number | null {
  const v = Math.max(0, venda);
  if (v <= 0) return null;
  return Math.round(((v - Math.max(0, custo)) / v) * 1000) / 10;
}
