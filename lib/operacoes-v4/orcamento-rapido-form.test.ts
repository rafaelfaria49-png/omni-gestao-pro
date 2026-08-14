import { describe, expect, it } from "vitest";
import {
  adicionarItemFixoV4,
  adicionarVarianteV4,
  buildOrcamentoRapidoInputFromFormV4,
  novaVarianteVaziaV4,
  orcamentoRapidoFormVazioV4,
  previaTotaisOrcamentoRapidoV4,
  removerItemFixoV4,
  removerVarianteV4,
  validarOrcamentoRapidoFormV4,
  type OrcamentoRapidoFormV4,
} from "./orcamento-rapido-form";

function formPreenchido(over: Partial<OrcamentoRapidoFormV4> = {}): OrcamentoRapidoFormV4 {
  const base = orcamentoRapidoFormVazioV4();
  return {
    ...base,
    clienteModo: "novo",
    clienteNovoNome: "Cliente Teste",
    clienteNovoTelefone: "11999990000",
    aparelhoMarca: "Marca X",
    aparelhoModelo: "Modelo Y",
    defeitoRelatado: "Tela quebrada",
    grupoRotulo: "Escolha a tela",
    variantes: [
      { ...novaVarianteVaziaV4(), rotulo: "Genérica", valor: 150 },
      { ...novaVarianteVaziaV4(), rotulo: "Original", valor: 300, garantiaDias: 90, badge: "Recomendado" },
    ],
    ...over,
  };
}

describe("orcamentoRapidoFormVazioV4", () => {
  it("aceita item fixo e múltiplas opções com preço, custo e garantia", () => {
    const f = formPreenchido({
      itensFixos: [{ id: "f1", descricao: "Mão de obra", valor: 100, custoV3: 0, cortesia: false, quantidade: 1 }],
    });
    expect(f.itensFixos).toHaveLength(1);
    expect(f.variantes.length).toBeGreaterThanOrEqual(2);
    expect(f.variantes[0]?.valor).toBe(150);
    expect(f.variantes[1]?.valor).toBe(300);
    expect(f.variantes[1]?.garantiaDias).toBe(90);
    const input = buildOrcamentoRapidoInputFromFormV4(f);
    expect(input.itensFixos?.[0]?.descricao).toBe("Mão de obra");
    expect(input.grupo.variantes[1]?.custoV3).toBeUndefined();
  });

  it("nasce com 2 variantes vazias e cliente modo existente", () => {
    const f = orcamentoRapidoFormVazioV4();
    expect(f.variantes).toHaveLength(2);
    expect(f.clienteModo).toBe("existente");
    expect(f.itensFixos).toEqual([]);
  });
});

describe("adicionarVarianteV4 / removerVarianteV4 — respeitam 2..4", () => {
  it("adiciona até o limite de 4 e para (no-op depois)", () => {
    let f = orcamentoRapidoFormVazioV4();
    f = adicionarVarianteV4(f);
    f = adicionarVarianteV4(f);
    expect(f.variantes).toHaveLength(4);
    const f5 = adicionarVarianteV4(f);
    expect(f5.variantes).toHaveLength(4);
    expect(f5).toBe(f); // no-op real (mesma referência)
  });

  it("remove até o piso de 2 e para (no-op depois)", () => {
    let f = orcamentoRapidoFormVazioV4();
    const idParaRemover = f.variantes[0]!.id;
    f = removerVarianteV4(f, idParaRemover);
    expect(f.variantes).toHaveLength(2); // já estava no piso, no-op
    const outroId = f.variantes[0]!.id;
    const f2 = removerVarianteV4(f, outroId);
    expect(f2.variantes).toHaveLength(2);
    expect(f2).toBe(f);
  });

  it("remove normalmente quando acima do piso", () => {
    let f = orcamentoRapidoFormVazioV4();
    f = adicionarVarianteV4(f); // 3
    const idParaRemover = f.variantes[2]!.id;
    f = removerVarianteV4(f, idParaRemover);
    expect(f.variantes).toHaveLength(2);
    expect(f.variantes.find((v) => v.id === idParaRemover)).toBeUndefined();
  });
});

describe("adicionarItemFixoV4 / removerItemFixoV4", () => {
  it("adiciona e remove itens fixos livremente (sem piso/teto)", () => {
    let f = orcamentoRapidoFormVazioV4();
    f = adicionarItemFixoV4(f);
    f = adicionarItemFixoV4(f);
    expect(f.itensFixos).toHaveLength(2);
    f = removerItemFixoV4(f, f.itensFixos[0]!.id);
    expect(f.itensFixos).toHaveLength(1);
  });
});

describe("validarOrcamentoRapidoFormV4 — gating de UI", () => {
  it("aceita formulário preenchido corretamente", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido())).toBeNull();
  });

  it("exige cliente existente selecionado", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ clienteModo: "existente", clienteExistente: null }))).toBe(
      "Selecione o cliente existente.",
    );
  });

  it("exige nome no modo novo", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ clienteNovoNome: "" }))).toBe("Informe o nome do cliente.");
  });

  it("TELEFONE OBRIGATÓRIO no modo novo — regra só desta UI (motor não exige)", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ clienteNovoTelefone: "" }))).toBe(
      "Informe o telefone do cliente (necessário para enviar o orçamento depois).",
    );
  });

  it("cliente existente sem telefone NÃO bloqueia (diferente do modo novo)", () => {
    const f = formPreenchido({ clienteModo: "existente", clienteExistente: { id: "c1", nome: "Ana" } });
    expect(validarOrcamentoRapidoFormV4(f)).toBeNull();
  });

  it("exige marca e modelo", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ aparelhoMarca: "" }))).toBe("Informe marca e modelo do aparelho.");
  });

  it("exige defeito relatado", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ defeitoRelatado: "  " }))).toBe("Descreva o defeito relatado.");
  });

  it("exige rótulo do grupo", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido({ grupoRotulo: "" }))).toBe("Informe o rótulo do grupo de escolha.");
  });

  it("exige rótulo em toda variante", () => {
    const f = formPreenchido();
    f.variantes[1]!.rotulo = "";
    expect(validarOrcamentoRapidoFormV4(f)).toBe("Toda opção do grupo precisa de um rótulo.");
  });

  it("exige preço não-negativo em toda variante", () => {
    const f = formPreenchido();
    f.variantes[0]!.valor = -1;
    expect(validarOrcamentoRapidoFormV4(f)).toBe('Informe um preço válido para "Genérica".');
  });

  it("rejeita mais de 1 badge no grupo", () => {
    const f = formPreenchido();
    f.variantes[0]!.badge = "Top";
    expect(validarOrcamentoRapidoFormV4(f)).toBe("Use no máximo 1 selo (badge) por grupo.");
  });

  it("aceita exatamente 1 badge no grupo", () => {
    expect(validarOrcamentoRapidoFormV4(formPreenchido())).toBeNull(); // já tem 1 badge em "Original"
  });

  it("rejeita item fixo sem descrição", () => {
    const f = formPreenchido({ itensFixos: [{ id: "f1", descricao: "  ", valor: 10, cortesia: false, custoV3: 0, quantidade: 1 }] });
    expect(validarOrcamentoRapidoFormV4(f)).toBe("Há um item fixo sem descrição.");
  });

  it("máximo de 4 variantes é respeitado (array nunca ultrapassa via adicionarVarianteV4, mas valida defensivamente)", () => {
    const f = formPreenchido();
    f.variantes = [1, 2, 3, 4, 5].map((i) => ({ ...novaVarianteVaziaV4(), rotulo: `Opção ${i}`, valor: 10 }));
    expect(validarOrcamentoRapidoFormV4(f)).toBe("O grupo de escolha aceita no máximo 4 opções.");
  });
});

describe("buildOrcamentoRapidoInputFromFormV4", () => {
  it("mapeia cliente novo, aparelho, defeito e grupo corretamente", () => {
    const inputV3 = buildOrcamentoRapidoInputFromFormV4(formPreenchido());
    expect(inputV3.cliente).toEqual({ modo: "novo", nome: "Cliente Teste", telefone: "11999990000" });
    expect(inputV3.aparelho).toEqual({ marca: "Marca X", modelo: "Modelo Y" });
    expect(inputV3.defeitoRelatado).toBe("Tela quebrada");
    expect(inputV3.grupo.rotulo).toBe("Escolha a tela");
    expect(inputV3.grupo.variantes).toHaveLength(2);
  });

  it("mapeia cliente existente", () => {
    const f = formPreenchido({ clienteModo: "existente", clienteExistente: { id: "c1", nome: "Ana", telefone: "11988887777" } });
    const inputV3 = buildOrcamentoRapidoInputFromFormV4(f);
    expect(inputV3.cliente).toEqual({ modo: "existente", clienteId: "c1", nome: "Ana", telefone: "11988887777" });
  });

  it("itens fixos vazios (sem descrição) são descartados; cortesia mapeia kindV3 brinde", () => {
    const f = formPreenchido({
      itensFixos: [
        { id: "f1", descricao: "", valor: 10, cortesia: false, custoV3: 0, quantidade: 1 },
        { id: "f2", descricao: "Película", valor: 0, cortesia: true, custoV3: 5, quantidade: 1 },
      ],
    });
    const inputV3 = buildOrcamentoRapidoInputFromFormV4(f);
    expect(inputV3.itensFixos).toEqual([{ descricao: "Película", valor: 0, kindV3: "brinde", custoV3: 5 }]);
  });

  it("sem itens fixos preenchidos, itensFixos fica undefined (não [])", () => {
    const inputV3 = buildOrcamentoRapidoInputFromFormV4(formPreenchido());
    expect(inputV3.itensFixos).toBeUndefined();
  });
});

describe("previaTotaisOrcamentoRapidoV4 — reusa computeTotaisV3, zero aritmética própria", () => {
  it("faixa {min,max} coerente com as variantes do formulário", () => {
    const totais = previaTotaisOrcamentoRapidoV4(formPreenchido());
    expect(totais.faixa).toEqual({ min: 150, max: 300 });
  });

  it("formulário vazio (sem grupo preenchido) não quebra — total 0", () => {
    const f = orcamentoRapidoFormVazioV4();
    f.variantes = [];
    const totais = previaTotaisOrcamentoRapidoV4(f);
    expect(totais.total).toBe(0);
    expect(totais.faixa).toBeUndefined();
  });
});
