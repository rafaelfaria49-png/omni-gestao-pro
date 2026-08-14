import { describe, expect, it } from "vitest";
import {
  aparelhoAtendimentoVazioV4,
  clienteAtendimentoVazioV4,
  lucroEstimadoV4,
  margemEstimadaV4,
  origemComercialParaV3,
  validarAparelhoAtendimentoV4,
  validarClienteAtendimentoV4,
} from "./atendimento-comercial";

describe("validarClienteAtendimentoV4", () => {
  it("exige cliente existente selecionado", () => {
    expect(validarClienteAtendimentoV4(clienteAtendimentoVazioV4("existente"))).toBe(
      "Selecione o cliente existente.",
    );
  });

  it("cliente novo preserva nome/telefone/documento/e-mail no estado", () => {
    const c = clienteAtendimentoVazioV4("novo");
    c.novo = { nome: "João", telefone: "11999990000", documento: "123", email: "a@b.com" };
    expect(validarClienteAtendimentoV4(c)).toBeNull();
    expect(c.novo).toEqual({ nome: "João", telefone: "11999990000", documento: "123", email: "a@b.com" });
  });

  it("balcão só passa quando permitido", () => {
    const c = clienteAtendimentoVazioV4("balcao");
    expect(validarClienteAtendimentoV4(c)).toMatch(/balcão/i);
    expect(validarClienteAtendimentoV4(c, { permitirBalcao: true })).toBeNull();
  });
});

describe("validarAparelhoAtendimentoV4", () => {
  it("preserva marca/modelo/IMEI/defeito", () => {
    const a = { ...aparelhoAtendimentoVazioV4(), marca: "Samsung", modelo: "S22", imei: "35", defeitoRelatado: "Tela quebrada" };
    expect(validarAparelhoAtendimentoV4(a)).toBeNull();
    expect(a.marca).toBe("Samsung");
    expect(a.modelo).toBe("S22");
    expect(a.imei).toBe("35");
    expect(a.defeitoRelatado).toBe("Tela quebrada");
  });
});

describe("origemComercialParaV3", () => {
  it("WhatsApp mapeia 1:1; demais usam balcão no contrato V3", () => {
    expect(origemComercialParaV3("whatsapp")).toBe("whatsapp");
    expect(origemComercialParaV3("instagram")).toBe("balcao");
    expect(origemComercialParaV3("ligacao")).toBe("balcao");
  });
});

describe("lucro e margem", () => {
  it("Premium R$400 / custo R$210 → lucro 190 e margem 47,5%", () => {
    expect(lucroEstimadoV4(400, 210)).toBe(190);
    expect(margemEstimadaV4(400, 210)).toBe(47.5);
  });

  it("sem venda não inventa margem", () => {
    expect(margemEstimadaV4(0, 100)).toBeNull();
  });
});
