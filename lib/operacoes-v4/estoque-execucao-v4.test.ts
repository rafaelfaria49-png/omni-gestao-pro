import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { projetarConsumoEstoqueV4 } from "./estoque-execucao-v4";

function os(over: Record<string, unknown> = {}): OrdemServico {
  return { id: "os-1", storeId: "loja-1", ...over } as unknown as OrdemServico;
}

describe("projetarConsumoEstoqueV4", () => {
  it("vazio honesto sem OS e sem peças", () => {
    expect(projetarConsumoEstoqueV4(null)).toMatchObject({
      pecas: [],
      podeBaixar: false,
      jaConsumido: false,
    });
    expect(projetarConsumoEstoqueV4(os()).podeBaixar).toBe(false);
  });

  it("orçamento é a fonte única quando tem peças (anti dupla baixa)", () => {
    const view = projetarConsumoEstoqueV4(
      os({
        pecas: [{ id: "p1", nome: "Payload", quantidade: 2, produtoId: "prod-a" }],
        orcamento: { pecas: [{ id: "p2", nome: "Tela", quantidade: 1, produtoId: "prod-b", sku: "SKU-T" }] },
      }),
    );
    expect(view.pecas).toHaveLength(1);
    expect(view.pecas[0]).toMatchObject({ nome: "Tela", quantidade: 1, vinculada: true, origem: "payload.orcamento.pecas" });
    expect(view.podeBaixar).toBe(true);
    expect(view.vinculadaCount).toBe(1);
  });

  it("cai em payload.pecas quando o orçamento não tem peças", () => {
    const view = projetarConsumoEstoqueV4(
      os({ pecas: [{ id: "p1", nome: "Bateria", quantidade: 1, sku: "BAT-1" }] }),
    );
    expect(view.pecas[0]).toMatchObject({ nome: "Bateria", origem: "payload.pecas", vinculada: true });
    expect(view.podeBaixar).toBe(true);
  });

  it("peça sem produtoId/SKU não libera baixa (servidor ainda confirma o match)", () => {
    const view = projetarConsumoEstoqueV4(
      os({ pecas: [{ id: "manual-1", nome: "Peça avulsa", quantidade: 1 }] }),
    );
    expect(view.pecas[0]!.vinculada).toBe(false);
    expect(view.podeBaixar).toBe(false);
    expect(view.semVinculoCount).toBe(1);
  });

  it("já consumido: lista as peças mas não oferece baixa de novo", () => {
    const view = projetarConsumoEstoqueV4(
      os({
        estoqueConsumido: true,
        pecas: [{ id: "p1", nome: "Tela", quantidade: 1, produtoId: "prod-b" }],
      }),
    );
    expect(view.jaConsumido).toBe(true);
    expect(view.podeBaixar).toBe(false);
    expect(view.pecas).toHaveLength(1);
  });

  it("quantidade inválida é ignorada", () => {
    const view = projetarConsumoEstoqueV4(
      os({ pecas: [{ id: "p1", nome: "Tela", quantidade: 0, produtoId: "prod-b" }] }),
    );
    expect(view.pecas).toEqual([]);
    expect(view.podeBaixar).toBe(false);
  });
});
