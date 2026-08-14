import { describe, expect, it } from "vitest";
import { seedDadosBasicos } from "./dados-basicos-form";
import { seedEntradaEditor } from "./entrada-form";
import type { PendenciaEntradaV4 } from "./entrada-pendencias";
import {
  ENTRADA_GROUPS,
  ENTRADA_GROUP_IDS,
  ENTRADA_SECTIONS,
  ENTRADA_SECTION_IDS,
  deriveEntradaGroupCompletion,
  deriveEntradaSectionCompletion,
  entradaGroupProgress,
  getEntradaGroup,
  getEntradaSection,
  isEntradaGroupDirty,
  isEntradaSectionDirty,
  nextEntradaGroup,
  previousEntradaGroup,
} from "./entrada-workspace";

function pendencias(values: Partial<Record<PendenciaEntradaV4["chave"], boolean>> = {}): PendenciaEntradaV4[] {
  return [
    ["dados-basicos", true],
    ["identificacao", true],
    ["estado-avarias-acesso", true],
    ["checklist", true],
    ["acessorios", true],
    ["fotos", false],
  ].map(([chave, temContrato]) => ({
    chave: chave as PendenciaEntradaV4["chave"],
    rotulo: String(chave),
    preenchido: values[chave as PendenciaEntradaV4["chave"]] === true,
    temContrato: temContrato as boolean,
  }));
}

describe("workspace da Entrada — 4 grupos operacionais", () => {
  it("1. navega por quatro grupos, não por sete etapas artificiais", () => {
    expect(ENTRADA_GROUP_IDS).toEqual(["recepcao", "seguranca-custodia", "inspecao", "evidencias"]);
    expect(ENTRADA_GROUPS.map((group) => group.step)).toEqual([1, 2, 3, 4]);
  });

  it("2. cada grupo tem rótulo único", () => {
    expect(new Set(ENTRADA_GROUPS.map((group) => group.label)).size).toBe(4);
  });

  it("3. preserva os contratos internos das sete seções de persistência", () => {
    expect(ENTRADA_SECTION_IDS).toEqual([
      "dados-basicos",
      "identificacao",
      "seguranca",
      "estado-fisico",
      "checklist",
      "acessorios",
      "fotos",
    ]);
    expect(ENTRADA_SECTIONS.filter((section) => !section.canSave).map((section) => section.id)).toEqual(["fotos"]);
  });

  it("4. Recepção agrupa o que já veio da abertura da OS", () => {
    expect([...getEntradaGroup("recepcao").sections]).toEqual(["dados-basicos", "identificacao"]);
    expect([...getEntradaGroup("seguranca-custodia").sections]).toEqual(["seguranca", "acessorios"]);
    expect([...getEntradaGroup("evidencias").sections]).toEqual(["fotos"]);
  });

  it("5. avança pelos grupos sem saltos", () => {
    expect(ENTRADA_GROUP_IDS.slice(0, -1).map(nextEntradaGroup)).toEqual(ENTRADA_GROUP_IDS.slice(1));
    expect(ENTRADA_GROUP_IDS.slice(1).map(previousEntradaGroup)).toEqual(ENTRADA_GROUP_IDS.slice(0, -1));
  });

  it("6. não oferece grupo anterior em Recepção nem posterior em Evidências", () => {
    expect(previousEntradaGroup("recepcao")).toBeNull();
    expect(nextEntradaGroup("evidencias")).toBeNull();
  });

  it("7. grupos nascem pendentes quando a OS não tem dados reais", () => {
    expect(Object.values(deriveEntradaGroupCompletion(pendencias()))).toEqual([false, false, false, false]);
  });

  it("8. Recepção só fecha com recepção e identificação reais", () => {
    const soRecepcao = deriveEntradaGroupCompletion(pendencias({ "dados-basicos": true }));
    expect(soRecepcao.recepcao).toBe(false);
    const completa = deriveEntradaGroupCompletion(pendencias({ "dados-basicos": true, identificacao: true }));
    expect(completa.recepcao).toBe(true);
  });

  it("9. Inspeção usa prova de entrada + checklist", () => {
    const completion = deriveEntradaGroupCompletion(pendencias({ "estado-avarias-acesso": true, checklist: true }));
    expect(completion["seguranca-custodia"]).toBe(true);
    expect(completion.inspecao).toBe(true);
  });

  it("10. Evidências só fecha com fotos ou assinatura reais", () => {
    expect(deriveEntradaGroupCompletion(pendencias({ acessorios: true })).evidencias).toBe(false);
    expect(deriveEntradaGroupCompletion(pendencias({ fotos: true })).evidencias).toBe(true);
    expect(entradaGroupProgress(deriveEntradaGroupCompletion(pendencias()))).toEqual({ completed: 0, total: 4 });
  });

  it("11. progresso completo é 4 de 4", () => {
    const all = pendencias({
      "dados-basicos": true,
      identificacao: true,
      "estado-avarias-acesso": true,
      checklist: true,
      acessorios: true,
      fotos: true,
    });
    expect(entradaGroupProgress(deriveEntradaGroupCompletion(all))).toEqual({ completed: 4, total: 4 });
  });

  it("12. rascunho em Dados básicos suja só Recepção", () => {
    const ed = seedEntradaEditor(null);
    const savedDb = seedDadosBasicos(null);
    const currentDb = { ...savedDb, recebidoPor: "Rafael" };
    expect(isEntradaGroupDirty("recepcao", ed, currentDb, ed, savedDb)).toBe(true);
    expect(isEntradaGroupDirty("seguranca-custodia", ed, currentDb, ed, savedDb)).toBe(false);
    expect(isEntradaSectionDirty("dados-basicos", ed, currentDb, ed, savedDb)).toBe(true);
  });

  it("13. alteração de credencial suja só Segurança e custódia", () => {
    const saved = seedEntradaEditor(null);
    const current = { ...saved, credenciais: { ...saved.credenciais, senha: "2580" } };
    const db = seedDadosBasicos(null);
    expect(isEntradaGroupDirty("seguranca-custodia", current, db, saved, db)).toBe(true);
    expect(isEntradaGroupDirty("inspecao", current, db, saved, db)).toBe(false);
    expect(isEntradaSectionDirty("estado-fisico", current, db, saved, db)).toBe(false);
  });

  it("14. clones equivalentes não sujam nenhum grupo", () => {
    const saved = seedEntradaEditor(null);
    const db = seedDadosBasicos(null);
    const clone = structuredClone(saved);
    expect(ENTRADA_GROUP_IDS.every((id) => !isEntradaGroupDirty(id, clone, { ...db }, saved, db))).toBe(true);
    expect(getEntradaSection("fotos").label).toBe("Fotos");
  });
});
