import type { DadosBasicosEditorV4 } from "./dados-basicos-form";
import type { EntradaEditorV4 } from "./entrada-form";
import type { PendenciaEntradaV4 } from "./entrada-pendencias";

export const ENTRADA_SECTION_IDS = [
  "dados-basicos",
  "identificacao",
  "seguranca",
  "estado-fisico",
  "checklist",
  "acessorios",
  "fotos",
] as const;

export type EntradaSectionId = (typeof ENTRADA_SECTION_IDS)[number];

export type EntradaSectionMeta = {
  id: EntradaSectionId;
  step: number;
  label: string;
  eyebrow: string;
  description: string;
  canSave: boolean;
};

export const ENTRADA_SECTIONS: readonly EntradaSectionMeta[] = [
  { id: "dados-basicos", step: 1, label: "Dados básicos", eyebrow: "Recepção", description: "Defeito, prioridade, origem e responsabilidade pelo recebimento.", canSave: true },
  { id: "identificacao", step: 2, label: "Identificação", eyebrow: "Aparelho", description: "IMEI, número de série, modelo, cor e operadora.", canSave: true },
  { id: "seguranca", step: 3, label: "Segurança / Acesso", eyebrow: "Credenciais", description: "Acesso temporário necessário para diagnóstico e testes.", canSave: true },
  { id: "estado-fisico", step: 4, label: "Estado físico", eyebrow: "Inspeção", description: "Condição externa do aparelho e avarias observadas.", canSave: true },
  { id: "checklist", step: 5, label: "Checklist", eyebrow: "Testes iniciais", description: "Verificação objetiva das funções do aparelho na entrada.", canSave: true },
  { id: "acessorios", step: 6, label: "Acessórios", eyebrow: "Custódia", description: "Itens entregues junto com o aparelho.", canSave: true },
  { id: "fotos", step: 7, label: "Fotos", eyebrow: "Evidências", description: "Registros fotográficos já vinculados à prova de entrada.", canSave: false },
] as const;

export function getEntradaSection(id: EntradaSectionId): EntradaSectionMeta {
  return ENTRADA_SECTIONS.find((section) => section.id === id) ?? ENTRADA_SECTIONS[0];
}

export function previousEntradaSection(id: EntradaSectionId): EntradaSectionId | null {
  const index = ENTRADA_SECTION_IDS.indexOf(id);
  return index > 0 ? ENTRADA_SECTION_IDS[index - 1] : null;
}

export function nextEntradaSection(id: EntradaSectionId): EntradaSectionId | null {
  const index = ENTRADA_SECTION_IDS.indexOf(id);
  return index >= 0 && index < ENTRADA_SECTION_IDS.length - 1 ? ENTRADA_SECTION_IDS[index + 1] : null;
}

export type EntradaSectionCompletion = Record<EntradaSectionId, boolean>;

export function deriveEntradaSectionCompletion(pendencias: PendenciaEntradaV4[]): EntradaSectionCompletion {
  const byKey = new Map(pendencias.map((item) => [item.chave, item.preenchido]));
  const prova = byKey.get("estado-avarias-acesso") === true;
  return {
    "dados-basicos": byKey.get("dados-basicos") === true,
    identificacao: byKey.get("identificacao") === true,
    seguranca: prova,
    "estado-fisico": prova,
    checklist: byKey.get("checklist") === true,
    acessorios: byKey.get("acessorios") === true,
    fotos: byKey.get("fotos") === true,
  };
}

export function entradaCompletionProgress(completion: EntradaSectionCompletion) {
  return {
    completed: ENTRADA_SECTION_IDS.filter((id) => completion[id]).length,
    total: ENTRADA_SECTION_IDS.length,
  };
}

function snapshot(id: EntradaSectionId, ed: EntradaEditorV4, db: DadosBasicosEditorV4): unknown {
  switch (id) {
    case "dados-basicos": return db;
    case "identificacao": return ed.identificacao;
    case "seguranca": return ed.credenciais;
    case "estado-fisico": return { estadoFisico: ed.estadoFisico, avarias: ed.avarias };
    case "checklist": return ed.checklist;
    case "acessorios": return ed.acessorios;
    case "fotos": return null;
  }
}

export function isEntradaSectionDirty(
  id: EntradaSectionId,
  currentEditor: EntradaEditorV4,
  currentBasics: DadosBasicosEditorV4,
  savedEditor: EntradaEditorV4,
  savedBasics: DadosBasicosEditorV4,
): boolean {
  return JSON.stringify(snapshot(id, currentEditor, currentBasics)) !== JSON.stringify(snapshot(id, savedEditor, savedBasics));
}
