import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { validarNovaOSDraftV3 } from "./nova-os-model";
import { buildRetornoAtendimentoDraftV3 } from "./retorno-atendimento";

const NOW = new Date("2026-08-19T12:00:00.000Z");

function os(extra: Record<string, unknown> = {}): OrdemServico {
  return {
    id: "os-1042",
    codigo: "OS-1042",
    clienteId: "cli-1",
    cliente: { id: "cli-1", nome: "Maria", telefone: "11999999999", documento: "123" },
    equipamento: {
      tipo: "Smartphone",
      marca: "Samsung",
      modelo: "S22",
      numeroSerie: "IMEI-1",
      acessorios: ["Chip", ""],
    },
    senhaEquipamento: "1478",
    senhaEquipamentoTipo: "numerica",
    ...extra,
  } as unknown as OrdemServico;
}

describe("buildRetornoAtendimentoDraftV3", () => {
  it("clona cliente/aparelho e classifica origem pela cobertura", () => {
    const draft = buildRetornoAtendimentoDraftV3(
      os(),
      { motivo: "  Touch voltou a falhar  ", observacao: "  Cliente deixou o aparelho  ", garantiaAtiva: true },
      NOW,
    );

    expect(draft.cliente).toMatchObject({ id: "cli-1", nome: "Maria", telefone: "11999999999", documento: "123" });
    expect(draft.equipamento).toMatchObject({
      tipo: "Smartphone",
      marca: "Samsung",
      modelo: "S22",
      imei: "IMEI-1",
      senha: "1478",
      senhaTipo: "numerica",
      acessorios: ["Chip"],
    });
    expect(draft.recepcao.origem).toBe("garantia");
    expect(draft.recepcao.prioridade).toBe("alta");
    expect(draft.problema.defeitoRelatado).toBe("Touch voltou a falhar");
    expect(draft.problema.observacoesInternas).toBe("Retorno da OS OS-1042. Cliente deixou o aparelho");
    expect(validarNovaOSDraftV3(draft)).toBeNull();
  });

  it("usa origem retorno quando a garantia não está ativa", () => {
    const draft = buildRetornoAtendimentoDraftV3(os(), { motivo: "Fora do prazo", garantiaAtiva: false }, NOW);
    expect(draft.recepcao.origem).toBe("retorno");
  });

  it("não inventa marca/modelo — a validação oficial bloqueia o rascunho incompleto", () => {
    const draft = buildRetornoAtendimentoDraftV3(
      os({ equipamento: { tipo: "Smartphone", marca: "", modelo: "", defeitoRelatado: "" } }),
      { motivo: "Falha", garantiaAtiva: true },
      NOW,
    );
    expect(validarNovaOSDraftV3(draft)).toBe("Informe marca e modelo do equipamento.");
  });
});
