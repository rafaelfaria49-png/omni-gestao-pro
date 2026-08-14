import { describe, expect, it } from "vitest";
import { seedDadosBasicos } from "./dados-basicos-form";
import { seedEntradaEditor } from "./entrada-form";
import type { PendenciaEntradaV4 } from "./entrada-pendencias";
import {
  ENTRADA_SECTIONS,
  ENTRADA_SECTION_IDS,
  deriveEntradaSectionCompletion,
  entradaCompletionProgress,
  getEntradaSection,
  isEntradaSectionDirty,
  nextEntradaSection,
  previousEntradaSection,
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

describe("workspace focado da Entrada — 18 comportamentos críticos", () => {
  it("1. mantém exatamente as sete seções na ordem operacional", () => {
    expect(ENTRADA_SECTION_IDS).toEqual(["dados-basicos", "identificacao", "seguranca", "estado-fisico", "checklist", "acessorios", "fotos"]);
  });

  it("2. numera as seções continuamente de 1 a 7", () => {
    expect(ENTRADA_SECTIONS.map((section) => section.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("3. expõe um rótulo único para cada seção", () => {
    expect(new Set(ENTRADA_SECTIONS.map((section) => section.label)).size).toBe(7);
  });

  it("4. mantém Fotos como a única seção sem contrato de save", () => {
    expect(ENTRADA_SECTIONS.filter((section) => !section.canSave).map((section) => section.id)).toEqual(["fotos"]);
  });

  it("5. avança pela sequência sem saltos", () => {
    expect(ENTRADA_SECTION_IDS.slice(0, -1).map(nextEntradaSection)).toEqual(ENTRADA_SECTION_IDS.slice(1));
  });

  it("6. retorna pela sequência sem saltos", () => {
    expect(ENTRADA_SECTION_IDS.slice(1).map(previousEntradaSection)).toEqual(ENTRADA_SECTION_IDS.slice(0, -1));
  });

  it("7. não oferece etapa anterior em Dados básicos", () => {
    expect(previousEntradaSection("dados-basicos")).toBeNull();
  });

  it("8. não inventa etapa posterior a Fotos", () => {
    expect(nextEntradaSection("fotos")).toBeNull();
  });

  it("9. deriva todas as seções como pendentes quando a OS não tem dados reais", () => {
    expect(Object.values(deriveEntradaSectionCompletion(pendencias()))).toEqual(Array(7).fill(false));
  });

  it("10. mapeia Dados básicos e Identificação independentemente", () => {
    const completion = deriveEntradaSectionCompletion(pendencias({ "dados-basicos": true, identificacao: true }));
    expect(completion["dados-basicos"]).toBe(true);
    expect(completion.identificacao).toBe(true);
    expect(completion.checklist).toBe(false);
  });

  it("11. usa a prova de entrada real para Segurança e Estado físico", () => {
    const completion = deriveEntradaSectionCompletion(pendencias({ "estado-avarias-acesso": true }));
    expect(completion.seguranca).toBe(true);
    expect(completion["estado-fisico"]).toBe(true);
  });

  it("12. conclui Fotos somente quando há foto real", () => {
    expect(deriveEntradaSectionCompletion(pendencias({ fotos: true })).fotos).toBe(true);
    expect(deriveEntradaSectionCompletion(pendencias()).fotos).toBe(false);
  });

  it("13. calcula progresso inicial como 0 de 7", () => {
    expect(entradaCompletionProgress(deriveEntradaSectionCompletion(pendencias()))).toEqual({ completed: 0, total: 7 });
  });

  it("14. calcula progresso completo como 7 de 7", () => {
    const all = pendencias({ "dados-basicos": true, identificacao: true, "estado-avarias-acesso": true, checklist: true, acessorios: true, fotos: true });
    expect(entradaCompletionProgress(deriveEntradaSectionCompletion(all))).toEqual({ completed: 7, total: 7 });
  });

  it("15. detecta rascunho alterado em Dados básicos", () => {
    const ed = seedEntradaEditor(null);
    const savedDb = seedDadosBasicos(null);
    const currentDb = { ...savedDb, recebidoPor: "Rafael" };
    expect(isEntradaSectionDirty("dados-basicos", ed, currentDb, ed, savedDb)).toBe(true);
  });

  it("16. isola alterações de Identificação das outras seções", () => {
    const saved = seedEntradaEditor(null);
    const current = { ...saved, identificacao: { ...saved.identificacao, imei: "123" } };
    const db = seedDadosBasicos(null);
    expect(isEntradaSectionDirty("identificacao", current, db, saved, db)).toBe(true);
    expect(isEntradaSectionDirty("checklist", current, db, saved, db)).toBe(false);
  });

  it("17. detecta alteração de credencial somente em Segurança", () => {
    const saved = seedEntradaEditor(null);
    const current = { ...saved, credenciais: { ...saved.credenciais, senha: "2580" } };
    const db = seedDadosBasicos(null);
    expect(isEntradaSectionDirty("seguranca", current, db, saved, db)).toBe(true);
    expect(isEntradaSectionDirty("estado-fisico", current, db, saved, db)).toBe(false);
  });

  it("18. considera clones equivalentes como rascunho salvo", () => {
    const saved = seedEntradaEditor(null);
    const db = seedDadosBasicos(null);
    const clone = structuredClone(saved);
    expect(ENTRADA_SECTION_IDS.every((id) => !isEntradaSectionDirty(id, clone, { ...db }, saved, db))).toBe(true);
    expect(getEntradaSection("fotos").label).toBe("Fotos");
  });
});
