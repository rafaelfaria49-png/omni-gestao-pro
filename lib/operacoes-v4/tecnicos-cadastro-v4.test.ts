import { describe, expect, it } from "vitest";
import { mergeTecnicosSeletorV4 } from "./tecnicos-cadastro-v4";

describe("mergeTecnicosSeletorV4", () => {
  it("cadastro vazio: preserva técnicos já conhecidos nas OS", () => {
    expect(mergeTecnicosSeletorV4([], [{ id: "tec:ana", nome: "Ana" }])).toEqual([{ id: "tec:ana", nome: "Ana" }]);
  });

  it("cadastro alimenta o seletor mesmo sem OS atribuída", () => {
    expect(mergeTecnicosSeletorV4([{ id: "t1", nome: "Bruno" }], [])).toEqual([{ id: "t1", nome: "Bruno" }]);
  });

  it("não duplica o mesmo id nem o mesmo nome", () => {
    const merged = mergeTecnicosSeletorV4(
      [{ id: "t1", nome: "Ana" }],
      [
        { id: "t1", nome: "Ana" },
        { id: "tec:ana", nome: "Ana" },
        { id: "t2", nome: "Carla" },
      ],
    );
    expect(merged.map((t) => t.nome)).toEqual(["Ana", "Carla"]);
    expect(merged.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("ordena por nome e ignora entradas vazias", () => {
    const merged = mergeTecnicosSeletorV4(
      [
        { id: "z", nome: "Zeca" },
        { id: " ", nome: "X" },
        { id: "a", nome: "Ana" },
      ],
      [{ id: "b", nome: "   " }],
    );
    expect(merged.map((t) => t.nome)).toEqual(["Ana", "Zeca"]);
  });
});
