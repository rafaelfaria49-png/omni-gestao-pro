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

export const ENTRADA_GROUP_IDS = ["recepcao", "seguranca-custodia", "inspecao", "evidencias"] as const;

export type EntradaGroupId = (typeof ENTRADA_GROUP_IDS)[number];

export type EntradaSectionMeta = {
  id: EntradaSectionId;
  step: number;
  label: string;
  eyebrow: string;
  description: string;
  canSave: boolean;
};

export type EntradaGroupMeta = {
  id: EntradaGroupId;
  step: number;
  label: string;
  eyebrow: string;
  description: string;
  sections: readonly EntradaSectionId[];
  canSave: boolean;
};

/** Contratos internos de persistência — a UI navega por grupos, não por estas 7 chaves. */
export const ENTRADA_SECTIONS: readonly EntradaSectionMeta[] = [
  { id: "dados-basicos", step: 1, label: "Dados básicos", eyebrow: "Recepção", description: "Ajustes operacionais da recepção que ainda faltam após a abertura.", canSave: true },
  { id: "identificacao", step: 1, label: "Identificação", eyebrow: "Aparelho", description: "Complete só o identificador que faltou na abertura da OS.", canSave: true },
  { id: "seguranca", step: 2, label: "Acesso", eyebrow: "Credenciais", description: "Acesso temporário necessário para diagnóstico e testes.", canSave: true },
  { id: "estado-fisico", step: 3, label: "Estado físico", eyebrow: "Inspeção", description: "Condição externa do aparelho e avarias observadas.", canSave: true },
  { id: "checklist", step: 3, label: "Checklist", eyebrow: "Testes iniciais", description: "Verificação objetiva das funções do aparelho na entrada.", canSave: true },
  { id: "acessorios", step: 4, label: "Acessórios", eyebrow: "Custódia", description: "Itens entregues junto com o aparelho.", canSave: true },
  { id: "fotos", step: 4, label: "Fotos", eyebrow: "Evidências", description: "Registros fotográficos já vinculados à prova de entrada.", canSave: false },
] as const;

export const ENTRADA_GROUPS: readonly EntradaGroupMeta[] = [
  {
    id: "recepcao",
    step: 1,
    label: "Recepção",
    eyebrow: "Recepção e aparelho",
    description: "Aparelho e recepção já informados na abertura. Confira e complete só o que faltou.",
    sections: ["dados-basicos", "identificacao"],
    canSave: true,
  },
  {
    id: "seguranca-custodia",
    step: 2,
    label: "Segurança",
    eyebrow: "Segurança e custódia",
    description: "Acesso ao aparelho e itens recebidos com ele.",
    sections: ["seguranca", "acessorios"],
    canSave: true,
  },
  {
    id: "inspecao",
    step: 3,
    label: "Inspeção",
    eyebrow: "Condição e testes",
    description: "Condição física e testes funcionais na entrada.",
    sections: ["estado-fisico", "checklist"],
    canSave: true,
  },
  {
    id: "evidencias",
    step: 4,
    label: "Evidências",
    eyebrow: "Fotos e assinatura",
    description: "Fotos da entrada e assinatura do cliente na prova de entrada.",
    sections: ["fotos"],
    canSave: true,
  },
] as const;

export function getEntradaSection(id: EntradaSectionId): EntradaSectionMeta {
  return ENTRADA_SECTIONS.find((section) => section.id === id) ?? ENTRADA_SECTIONS[0];
}

export function getEntradaGroup(id: EntradaGroupId): EntradaGroupMeta {
  return ENTRADA_GROUPS.find((group) => group.id === id) ?? ENTRADA_GROUPS[0];
}

export function previousEntradaSection(id: EntradaSectionId): EntradaSectionId | null {
  const index = ENTRADA_SECTION_IDS.indexOf(id);
  return index > 0 ? ENTRADA_SECTION_IDS[index - 1] : null;
}

export function nextEntradaSection(id: EntradaSectionId): EntradaSectionId | null {
  const index = ENTRADA_SECTION_IDS.indexOf(id);
  return index >= 0 && index < ENTRADA_SECTION_IDS.length - 1 ? ENTRADA_SECTION_IDS[index + 1] : null;
}

export function previousEntradaGroup(id: EntradaGroupId): EntradaGroupId | null {
  const index = ENTRADA_GROUP_IDS.indexOf(id);
  return index > 0 ? ENTRADA_GROUP_IDS[index - 1] : null;
}

export function nextEntradaGroup(id: EntradaGroupId): EntradaGroupId | null {
  const index = ENTRADA_GROUP_IDS.indexOf(id);
  return index >= 0 && index < ENTRADA_GROUP_IDS.length - 1 ? ENTRADA_GROUP_IDS[index + 1] : null;
}

export type EntradaSectionCompletion = Record<EntradaSectionId, boolean>;
export type EntradaGroupCompletion = Record<EntradaGroupId, boolean>;

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

export function deriveEntradaGroupCompletion(pendencias: PendenciaEntradaV4[]): EntradaGroupCompletion {
  const sections = deriveEntradaSectionCompletion(pendencias);
  return {
    recepcao: sections["dados-basicos"] && sections.identificacao,
    "seguranca-custodia": sections.seguranca,
    inspecao: sections["estado-fisico"] && sections.checklist,
    evidencias: sections.fotos,
  };
}

export function entradaCompletionProgress(completion: EntradaSectionCompletion) {
  return {
    completed: ENTRADA_SECTION_IDS.filter((id) => completion[id]).length,
    total: ENTRADA_SECTION_IDS.length,
  };
}

export function entradaGroupProgress(completion: EntradaGroupCompletion) {
  return {
    completed: ENTRADA_GROUP_IDS.filter((id) => completion[id]).length,
    total: ENTRADA_GROUP_IDS.length,
  };
}

export function isEntradaGroupDirty(
  id: EntradaGroupId,
  currentEditor: EntradaEditorV4,
  currentBasics: DadosBasicosEditorV4,
  savedEditor: EntradaEditorV4,
  savedBasics: DadosBasicosEditorV4,
): boolean {
  return getEntradaGroup(id).sections.some((section) =>
    isEntradaSectionDirty(section, currentEditor, currentBasics, savedEditor, savedBasics),
  );
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
