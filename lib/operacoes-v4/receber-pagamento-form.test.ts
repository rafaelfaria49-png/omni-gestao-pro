import { describe, expect, it } from "vitest";
import {
  buildReceberOSInputV4,
  linhasValidasRecebimentoV4,
  parseValorRecebimentoV4,
  rascunhoRecebimentoValidoV4,
  valorSugeridoRecebimentoV4,
  vencimentoAPrazoValidoV4,
} from "./receber-pagamento-form";

describe("formulário de recebimento V4 — contrato V3", () => {
  it("quitação sugere o saldo e parcial começa vazio", () => {
    expect(valorSugeridoRecebimentoV4("quitacao", 350)).toBe(350);
    expect(valorSugeridoRecebimentoV4("parcial", 350)).toBe(0);
    expect(valorSugeridoRecebimentoV4("entrada", 350)).toBe(0);
  });

  it("aceita vírgula monetária e rejeita valor inválido", () => {
    expect(parseValorRecebimentoV4("200,50")).toBe(200.5);
    expect(parseValorRecebimentoV4("abc")).toBe(0);
  });

  it("split válido cobre o saldo de quitação", () => {
    const rascunho = rascunhoRecebimentoValidoV4({
      intencao: "quitacao",
      saldo: 200,
      linhas: [
        { forma: "dinheiro", valorStr: "50" },
        { forma: "pix", valorStr: "150" },
      ],
    });
    expect(rascunho).toMatchObject({ ok: true, totalInformado: 200, restante: 0 });
  });

  it("não permite submit com linha em branco ou soma acima do saldo", () => {
    expect(rascunhoRecebimentoValidoV4({
      intencao: "parcial",
      saldo: 200,
      linhas: [
        { forma: "pix", valorStr: "100" },
        { forma: "dinheiro", valorStr: "" },
      ],
    }).ok).toBe(false);
    expect(rascunhoRecebimentoValidoV4({
      intencao: "parcial",
      saldo: 200,
      linhas: [{ forma: "pix", valorStr: "250" }],
    }).ok).toBe(false);
  });

  it("quitação incompleta não passa", () => {
    expect(rascunhoRecebimentoValidoV4({
      intencao: "quitacao",
      saldo: 200,
      linhas: [{ forma: "pix", valorStr: "80" }],
    })).toMatchObject({ ok: false, restante: 120 });
  });

  it("buildReceberOSInputV4 manda linhas no contrato V3 e não inventa quitacao persistida", () => {
    const linhas = linhasValidasRecebimentoV4([{ forma: "pix", valorStr: "200" }]);
    expect(buildReceberOSInputV4({
      linhas,
      sessaoId: " sess-1 ",
      intencao: "quitacao",
      observacao: "  sinal  ",
    })).toEqual({
      linhas: [{ forma: "pix", valor: 200 }],
      sessaoId: "sess-1",
      intencao: undefined,
      observacao: "sinal",
    });
    expect(buildReceberOSInputV4({
      linhas,
      sessaoId: "sess-1",
      intencao: "entrada",
    }).intencao).toBe("entrada");
  });

  it("duas montagens iguais do mesmo rascunho produzem o mesmo input (retry não muda o contrato)", () => {
    const linhas = linhasValidasRecebimentoV4([{ forma: "pix", valorStr: "80" }, { forma: "dinheiro", valorStr: "20" }]);
    const a = buildReceberOSInputV4({ linhas, sessaoId: "s", intencao: "parcial" });
    const b = buildReceberOSInputV4({ linhas, sessaoId: "s", intencao: "parcial" });
    expect(a).toEqual(b);
  });

  it("23–28. valor zero, acima do saldo e soma inválida não geram input válido", () => {
    expect(rascunhoRecebimentoValidoV4({ intencao: "parcial", saldo: 200, linhas: [{ forma: "pix", valorStr: "0" }] }).ok).toBe(false);
    expect(rascunhoRecebimentoValidoV4({ intencao: "parcial", saldo: 200, linhas: [{ forma: "pix", valorStr: "200.01" }] }).ok).toBe(false);
    expect(rascunhoRecebimentoValidoV4({ intencao: "parcial", saldo: 200, linhas: [] }).ok).toBe(false);
  });

  it("36–43. split de 2 e 3 formas, remoção, centavos e forma repetida (permitida pelo V3)", () => {
    const duas = rascunhoRecebimentoValidoV4({
      intencao: "quitacao",
      saldo: 450,
      linhas: [
        { forma: "pix", valorStr: "300" },
        { forma: "credito", valorStr: "150" },
      ],
    });
    expect(duas).toMatchObject({ ok: true, totalInformado: 450, restante: 0 });
    const tres = rascunhoRecebimentoValidoV4({
      intencao: "quitacao",
      saldo: 200,
      linhas: [
        { forma: "dinheiro", valorStr: "50" },
        { forma: "pix", valorStr: "100" },
        { forma: "debito", valorStr: "50" },
      ],
    });
    expect(tres.ok).toBe(true);
    const repetida = rascunhoRecebimentoValidoV4({
      intencao: "parcial",
      saldo: 80,
      linhas: [
        { forma: "pix", valorStr: "30,10" },
        { forma: "pix", valorStr: "20,15" },
      ],
    });
    expect(repetida).toMatchObject({ ok: true, totalInformado: 50.25, restante: 29.75 });
    const aposRemocao = rascunhoRecebimentoValidoV4({
      intencao: "parcial",
      saldo: 80,
      linhas: [{ forma: "pix", valorStr: "30,10" }],
    });
    expect(aposRemocao.totalInformado).toBe(30.1);
    expect(rascunhoRecebimentoValidoV4({
      intencao: "quitacao",
      saldo: 200,
      linhas: [{ forma: "pix", valorStr: "80" }, { forma: "dinheiro", valorStr: "80" }],
    }).ok).toBe(false);
  });

  it("44–48. a prazo exige vencimento válido e não monta pagamento imediato", () => {
    expect(vencimentoAPrazoValidoV4("")).toBe(false);
    expect(vencimentoAPrazoValidoV4("nao-e-data")).toBe(false);
    expect(vencimentoAPrazoValidoV4("2026-09-10")).toBe(true);
    const pagamento = buildReceberOSInputV4({
      linhas: [{ forma: "pix", valor: 10 }],
      sessaoId: "s",
      intencao: "parcial",
    });
    expect(pagamento).not.toHaveProperty("vencimento");
  });
});
