// ============================================================================
// Operações V4 — classificação pré-OS do orçamento comercial (GOAL 001).
// Vive no payload JSONB (`comercialV4`). Sem schema. OS antigas sem o bloco
// continuam OS operacionais normais.
// ============================================================================

export type StatusComercialOrcamentoV4 =
  | "rascunho"
  | "enviado"
  | "aprovado"
  | "recusado"
  | "vencido"
  | "convertido";

export type TipoRegistroComercialV4 = "orcamento_pre_os" | "os";

export interface ComercialV4 {
  tipo: TipoRegistroComercialV4;
  statusComercial: StatusComercialOrcamentoV4;
  origemAtendimento?: string;
  validadeDias?: number;
  prazoEstimado?: string;
  observacaoCliente?: string;
  observacaoInterna?: string;
  diagnosticoInicial?: {
    causaProvavel?: string;
    solucaoSugerida?: string;
    observacaoTecnica?: string;
  };
  opcaoAprovadaId?: string;
  opcaoAprovadaRotulo?: string;
  convertidoEm?: string;
  convertidoPor?: string;
}

export function lerComercialV4(os: unknown): ComercialV4 | null {
  if (!os || typeof os !== "object") return null;
  const rec = os as { comercialV4?: unknown; payload?: { comercialV4?: unknown } };
  const raw = rec.comercialV4 ?? rec.payload?.comercialV4;
  if (!raw || typeof raw !== "object") return null;
  const bloco = raw as Record<string, unknown>;
  const tipo = bloco.tipo === "orcamento_pre_os" || bloco.tipo === "os" ? bloco.tipo : null;
  if (!tipo) return null;
  const status = bloco.statusComercial;
  const statusOk: StatusComercialOrcamentoV4 | null =
    status === "rascunho" || status === "enviado" || status === "aprovado" ||
    status === "recusado" || status === "vencido" || status === "convertido"
      ? status
      : null;
  if (!statusOk) return null;
  return { tipo, statusComercial: statusOk, ...bloco } as ComercialV4;
}

/** Orçamento ainda não convertido — não entra em fila/bancada como reparo ativo. */
export function isOrcamentoPreOsAtivoV4(os: unknown): boolean {
  const c = lerComercialV4(os);
  return !!c && c.tipo === "orcamento_pre_os" && c.statusComercial !== "convertido";
}

export function podeConverterOrcamentoV4(os: unknown): boolean {
  const c = lerComercialV4(os);
  return !!c && c.tipo === "orcamento_pre_os" && c.statusComercial === "aprovado";
}

export const STATUS_COMERCIAL_LABEL_V4: Record<StatusComercialOrcamentoV4, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  vencido: "Vencido",
  convertido: "Convertido em OS",
};
