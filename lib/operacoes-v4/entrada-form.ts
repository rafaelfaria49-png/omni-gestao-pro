// ============================================================================
// Operações V4 — Entrada/Recepção · editor PURO ↔ contratos da V3.
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React, sem Prisma). Semeia o editor de Entrada V4 a
// partir da OS real (reusando `lerProvaEntradaV3` + `lerChecklistEntradaV3`, que
// já normalizam e semeiam dos campos legados) e mapeia o estado do editor para os
// inputs das actions reais da V3:
//   • `salvarIdentificacaoV3`      ← toIdentificacaoInput
//   • `salvarProvaEntradaV3`       ← toProvaEntradaInput (estado físico/avarias/credenciais)
//   • `salvarAcessoriosEntradaV3`  ← toAcessoriosInput
//   • `salvarChecklistEntradaV3`   ← toChecklistInput
// NÃO persiste, NÃO toca estoque/caixa/financeiro. As actions revalidam/sanitizam
// por conta própria. Re-exporta as tabelas de rótulo da V3 para a UI da V4.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { identidadeAtualV4 } from "./identidade-aparelho";
import {
  lerProvaEntradaV3,
  ACESSORIOS_ENTRADA_V3,
  COMPONENTES_FISICOS_V3,
  ESTADO_FISICO_STATUS_META_V3,
  OPERADORAS_V3,
  TIPOS_AVARIA_V3,
  acessorioEntradaLabelV3,
  componenteFisicoLabelV3,
  tipoAvariaLabelV3,
  type AcessorioEntradaIdV3,
  type AcessorioEntradaV3,
  type AvariaV3,
  type ComponenteFisicoV3,
  type EstadoFisicoItemV3,
  type EstadoFisicoStatusV3,
  type IdentificacaoV3,
  type SenhaTipoV3,
  type TipoAvariaV3,
} from "@/lib/operacoes-v3/prova-entrada-model";
import type { SalvarProvaEntradaInputV3 } from "@/lib/operacoes-v3/prova-entrada-actions";
import {
  lerChecklistEntradaV3,
  CHECKLIST_ESTADO_META_V3,
  type ChecklistEntradaItemV3,
  type ChecklistEstadoV3,
} from "@/lib/operacoes-v3/workspace-model";

// Re-exporta o que a UI da V4 precisa (mantém os imports da Entrada dentro de lib/operacoes-v4).
export {
  ACESSORIOS_ENTRADA_V3,
  COMPONENTES_FISICOS_V3,
  ESTADO_FISICO_STATUS_META_V3,
  OPERADORAS_V3,
  TIPOS_AVARIA_V3,
  acessorioEntradaLabelV3,
  componenteFisicoLabelV3,
  tipoAvariaLabelV3,
  CHECKLIST_ESTADO_META_V3,
};
export type {
  AcessorioEntradaV3,
  AvariaV3,
  ChecklistEntradaItemV3,
  ChecklistEstadoV3,
  EstadoFisicoStatusV3,
  IdentificacaoV3,
  SalvarProvaEntradaInputV3,
  SenhaTipoV3,
  TipoAvariaV3,
};

/** Credenciais no editor (campos controlados — strings/booleans, sem opcionais). */
export interface EntradaCredenciaisEditorV4 {
  pin: string;
  senha: string;
  senhaTipo: SenhaTipoV3;
  contaGoogle: string;
  contaApple: string;
  faceId: boolean;
  biometria: boolean;
}

/** Estado completo do editor de Entrada da V4. */
export interface EntradaEditorV4 {
  identificacao: { imei: string; serial: string; operadora: string; modelo: string; cor: string };
  estadoFisico: EstadoFisicoItemV3[];
  avarias: AvariaV3[];
  credenciais: EntradaCredenciaisEditorV4;
  acessorios: AcessorioEntradaV3[];
  checklist: ChecklistEntradaItemV3[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clean(v: string | undefined | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : undefined;
}

function uid(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
}

/** Semeia o editor a partir da OS real (provaEntradaV3 + checklist), com fallback legado. */
export function seedEntradaEditor(os: OrdemServico | null | undefined): EntradaEditorV4 {
  const prova = lerProvaEntradaV3(os ?? null);
  const checklist = lerChecklistEntradaV3(os ?? null);
  const cred = prova.credenciais ?? {};
  const identidade = identidadeAtualV4(os);
  return {
    identificacao: {
      imei: identidade.imei || str(prova.identificacao.imei),
      serial: identidade.serial || str(prova.identificacao.serial),
      operadora: identidade.operadora || str(prova.identificacao.operadora),
      modelo: identidade.modelo || str(prova.identificacao.modelo),
      cor: identidade.cor || str(prova.identificacao.cor),
    },
    estadoFisico: prova.estadoFisico.map((e) => ({ ...e })),
    avarias: prova.avarias.map((a) => ({ ...a })),
    credenciais: {
      pin: str(cred.pin),
      senha: str(cred.senha),
      senhaTipo: cred.senhaTipo ?? "numerica",
      contaGoogle: str(cred.contaGoogle),
      contaApple: str(cred.contaApple),
      faceId: cred.faceId === true,
      biometria: cred.biometria === true,
    },
    acessorios: prova.acessorios.map((a) => ({ ...a })),
    checklist: checklist.map((c) => ({ ...c })),
  };
}

// ---- Mapeadores editor → inputs das actions V3 -----------------------------

export function toIdentificacaoInput(editor: EntradaEditorV4): IdentificacaoV3 {
  const id = editor.identificacao;
  return {
    imei: clean(id.imei),
    serial: clean(id.serial),
    operadora: clean(id.operadora),
    modelo: clean(id.modelo),
    cor: clean(id.cor),
  };
}

export function toProvaEntradaInput(editor: EntradaEditorV4): SalvarProvaEntradaInputV3 {
  const c = editor.credenciais;
  return {
    estadoFisico: editor.estadoFisico,
    avarias: editor.avarias,
    credenciais: {
      pin: clean(c.pin),
      senha: clean(c.senha),
      senhaTipo: c.senhaTipo,
      contaGoogle: clean(c.contaGoogle),
      contaApple: clean(c.contaApple),
      faceId: c.faceId,
      biometria: c.biometria,
    },
  };
}

export function toAcessoriosInput(editor: EntradaEditorV4): AcessorioEntradaV3[] {
  return editor.acessorios.map((a) => ({ ...a }));
}

export function toChecklistInput(editor: EntradaEditorV4): ChecklistEntradaItemV3[] {
  return editor.checklist.map((c) => ({ ...c }));
}

// ---- Toggles puros (devolvem um novo editor) -------------------------------

export function setEstadoFisicoStatus(
  editor: EntradaEditorV4,
  componente: ComponenteFisicoV3,
  status: EstadoFisicoStatusV3,
): EntradaEditorV4 {
  return {
    ...editor,
    estadoFisico: editor.estadoFisico.map((e) => (e.componente === componente ? { ...e, status } : e)),
  };
}

export function setEstadoFisicoObs(editor: EntradaEditorV4, componente: ComponenteFisicoV3, obs: string): EntradaEditorV4 {
  return {
    ...editor,
    estadoFisico: editor.estadoFisico.map((e) => (e.componente === componente ? { ...e, obs: obs.trim() ? obs : undefined } : e)),
  };
}

export function toggleAcessorio(editor: EntradaEditorV4, id: AcessorioEntradaIdV3): EntradaEditorV4 {
  return {
    ...editor,
    acessorios: editor.acessorios.map((a) => (a.id === id ? { ...a, presente: !a.presente } : a)),
  };
}

export function setChecklistEstado(editor: EntradaEditorV4, id: string, estado: ChecklistEstadoV3): EntradaEditorV4 {
  return {
    ...editor,
    checklist: editor.checklist.map((c) => (c.id === id ? { ...c, estado } : c)),
  };
}

const CHECKLIST_CICLO: ChecklistEstadoV3[] = ["ok", "ruim", "nao_testado"];
/** Avança o estado do item: ok → ruim → nao_testado → ok. */
export function cycleChecklistEstado(editor: EntradaEditorV4, id: string): EntradaEditorV4 {
  return {
    ...editor,
    checklist: editor.checklist.map((c) => {
      if (c.id !== id) return c;
      const next = CHECKLIST_CICLO[(CHECKLIST_CICLO.indexOf(c.estado) + 1) % CHECKLIST_CICLO.length]!;
      return { ...c, estado: next };
    }),
  };
}

export function addAvaria(editor: EntradaEditorV4, tipo: TipoAvariaV3): EntradaEditorV4 {
  const nova: AvariaV3 = { id: uid("av"), tipo, local: "" };
  return { ...editor, avarias: [...editor.avarias, nova] };
}

export function setAvaria(
  editor: EntradaEditorV4,
  id: string,
  patch: Partial<Pick<AvariaV3, "tipo" | "local" | "descricao">>,
): EntradaEditorV4 {
  return { ...editor, avarias: editor.avarias.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

export function removeAvaria(editor: EntradaEditorV4, id: string): EntradaEditorV4 {
  return { ...editor, avarias: editor.avarias.filter((a) => a.id !== id) };
}

// ---- Padrão 3×3 (senha tipo "padrao") ---------------------------------------

/**
 * Alterna um ponto (0–8) na sequência do Padrão 3×3, serializada como "1-3-4"
 * (1-indexado, ordem de toque). Mesmo comportamento do `PatternPadV3` da V3:
 * ponto já presente na sequência é no-op (correção só via limpar tudo).
 */
export function togglePadraoPonto(value: string, ponto: number): string {
  const seq = value ? value.split("-").filter(Boolean) : [];
  const token = String(ponto + 1);
  if (seq.includes(token)) return value;
  return [...seq, token].join("-");
}
