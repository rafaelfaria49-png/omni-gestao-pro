import { describe, expect, it } from "vitest";
import {
  NOVO_ATENDIMENTO_COPY_V4,
  NOVO_ATENDIMENTO_OPCOES_V4,
  opcaoNovoAtendimentoV4,
  patchAbrirLauncherNovoAtendimentoV4,
  patchEscolherNovoAtendimentoV4,
  type NovoAtendimentoModalidadeV4,
} from "./novo-atendimento";

describe("NOVO_ATENDIMENTO_OPCOES_V4", () => {
  it("tem exatamente as três modalidades aprovadas — sem quarta via", () => {
    expect(NOVO_ATENDIMENTO_OPCOES_V4.map((o) => o.id)).toEqual(["os", "orcamento", "rapido"]);
  });

  it("cada opção aponta para um motor V3 já existente", () => {
    expect(opcaoNovoAtendimentoV4("os").motor).toBe("criarOSEnterpriseV3");
    expect(opcaoNovoAtendimentoV4("orcamento").motor).toBe("criarOrcamentoRapidoV3");
    expect(opcaoNovoAtendimentoV4("rapido").motor).toBe("finalizarAtendimentoRapidoV3");
  });

  it("o destino no workspace continua o dos handlers atuais", () => {
    expect(opcaoNovoAtendimentoV4("os").destino).toBe("entrada");
    expect(opcaoNovoAtendimentoV4("orcamento").destino).toBe("orcamento");
    expect(opcaoNovoAtendimentoV4("rapido").destino).toBe("entrega");
  });

  it("copy do launcher é a aprovada no GOAL", () => {
    expect(NOVO_ATENDIMENTO_COPY_V4.titulo).toBe("Novo atendimento");
    expect(NOVO_ATENDIMENTO_COPY_V4.subtitulo).toBe("Escolha como este atendimento começa.");
    expect(NOVO_ATENDIMENTO_COPY_V4.cta).toBe("+ Novo");
  });
});

describe("patchAbrirLauncherNovoAtendimentoV4", () => {
  it("abre só o launcher e fecha os três formulários", () => {
    expect(patchAbrirLauncherNovoAtendimentoV4()).toEqual({
      novoAtendimento: true,
      novaOS: false,
      orcamentoRapido: false,
      atendimentoRapido: false,
    });
  });
});

describe("patchEscolherNovoAtendimentoV4", () => {
  const casos: Array<[NovoAtendimentoModalidadeV4, keyof ReturnType<typeof patchEscolherNovoAtendimentoV4>]> = [
    ["os", "novaOS"],
    ["orcamento", "orcamentoRapido"],
    ["rapido", "atendimentoRapido"],
  ];

  it.each(casos)("escolhe %s e abre só %s", (id, flag) => {
    const patch = patchEscolherNovoAtendimentoV4(id);
    expect(patch.novoAtendimento).toBe(false);
    expect(patch.novaOS).toBe(flag === "novaOS");
    expect(patch.orcamentoRapido).toBe(flag === "orcamentoRapido");
    expect(patch.atendimentoRapido).toBe(flag === "atendimentoRapido");
  });
});
