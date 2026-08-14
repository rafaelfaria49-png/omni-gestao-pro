import { describe, expect, it } from "vitest";
import { isOrcamentoPreOsAtivoV4, lerComercialV4, podeConverterOrcamentoV4 } from "./orcamento-pre-os";

describe("lerComercialV4", () => {
  it("OS antiga sem bloco continua operacional (não é pré-OS)", () => {
    expect(lerComercialV4({ id: "os-1" })).toBeNull();
    expect(isOrcamentoPreOsAtivoV4({ id: "os-1" })).toBe(false);
  });

  it("orçamento ainda não convertido não é OS operacional ativa", () => {
    const os = { comercialV4: { tipo: "orcamento_pre_os", statusComercial: "enviado" } };
    expect(isOrcamentoPreOsAtivoV4(os)).toBe(true);
    expect(podeConverterOrcamentoV4(os)).toBe(false);
  });

  it("aprovado pode converter; convertido some da fila de pré-OS", () => {
    const aprovado = { comercialV4: { tipo: "orcamento_pre_os", statusComercial: "aprovado" } };
    const convertido = { comercialV4: { tipo: "orcamento_pre_os", statusComercial: "convertido", convertidoEm: "2026-08-14" } };
    expect(podeConverterOrcamentoV4(aprovado)).toBe(true);
    expect(isOrcamentoPreOsAtivoV4(convertido)).toBe(false);
  });

  it("lê também de payload.comercialV4 (shape hidratado)", () => {
    const os = { payload: { comercialV4: { tipo: "orcamento_pre_os", statusComercial: "rascunho" } } };
    expect(lerComercialV4(os)?.statusComercial).toBe("rascunho");
  });
});
