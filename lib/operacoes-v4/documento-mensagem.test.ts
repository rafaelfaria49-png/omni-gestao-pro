import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { montarMensagemAtualizacaoOSV4, montarMensagemDocumentoV4 } from "./documento-mensagem";

function os(over: Record<string, unknown> = {}): OrdemServico {
  return {
    id: "os-1",
    codigo: "OS-88",
    status: "pronta",
    operacaoStatusV3: "pronta",
    cliente: { nome: "Maria", telefone: "11999998888" },
    equipamento: { marca: "Samsung", modelo: "A15", defeitoRelatado: "Tela quebrada" },
    ...over,
  } as unknown as OrdemServico;
}

describe("montarMensagemAtualizacaoOSV4", () => {
  it("inclui código, status, cliente e aparelho reais", () => {
    const txt = montarMensagemAtualizacaoOSV4(os());
    expect(txt).toContain("OS-88");
    expect(txt).toMatch(/Pronta/i);
    expect(txt).toContain("Maria");
    expect(txt).toContain("Samsung A15");
  });
});

describe("montarMensagemDocumentoV4", () => {
  it("termo de garantia usa o texto do modelo V3", () => {
    const txt = montarMensagemDocumentoV4(
      "termo_garantia",
      os({ aberturaV3: { garantiaPrevista: { modelo: "tela", prazoDias: 90, label: "Troca de Tela" } } }),
    );
    expect(txt).toContain("Termo de Garantia — OS-88");
    expect(txt).toContain("90 dias");
  });

  it("termo de entrega lê retirada real", () => {
    const txt = montarMensagemDocumentoV4(
      "termo_entrega",
      os({
        entregaV3: { entregueEm: "2026-08-01T12:00:00.000Z", recebidoPor: "Maria Silva" },
      }),
    );
    expect(txt).toContain("Termo de Entrega — OS-88");
    expect(txt).toContain("Maria Silva");
  });

  it("OS cliente não inventa valor", () => {
    const txt = montarMensagemDocumentoV4("os_cliente", os());
    expect(txt).toContain("Ordem de Serviço OS-88");
    expect(txt).toContain("Tela quebrada");
    expect(txt).not.toMatch(/R\$\s*0,00/);
  });
});
