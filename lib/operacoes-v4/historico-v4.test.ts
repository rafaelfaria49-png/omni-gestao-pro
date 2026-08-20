import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { buildHistoricoTransversalV4, montarAuditoriaExportV4 } from "./historico-v4";

function os(over: Record<string, unknown>): OrdemServico {
  return { id: "o", codigo: "OS", cliente: { nome: "C" }, timeline: [], ...over } as unknown as OrdemServico;
}

describe("histórico transversal V4", () => {
  it("sem OS → temOs false, sem relacionadas inventadas", () => {
    const h = buildHistoricoTransversalV4(null, []);
    expect(h.temOs).toBe(false);
    expect(h.relacionadas).toEqual([]);
  });

  it("liga aparelho, cliente, origem de retorno e evidências reais", () => {
    const atual = os({
      id: "os-2",
      codigo: "OS-2",
      clienteId: "cli-1",
      cliente: { id: "cli-1", nome: "Ana", telefone: "11999990000" },
      equipamento: { marca: "Apple", modelo: "iPhone 12", numeroSerie: "123456789012345" },
      vinculoRetornoV3: { osOrigemId: "os-1", osOrigemCodigo: "OS-1" },
      retornosV3: [{ id: "r", osOriginalId: "os-1", osRetornoId: "os-3", osRetornoCodigo: "OS-3", status: "aberto", motivo: "Tela", criadoEm: "2026-08-01T00:00:00Z" }],
      entregaV3: { assinaturaRetirada: { dataUrl: "data:image/png;base64,xx" } },
      anexos: [{ id: "a1" }],
    });
    const orig = os({
      id: "os-1",
      codigo: "OS-1",
      clienteId: "cli-1",
      cliente: { id: "cli-1", nome: "Ana" },
      equipamento: { marca: "Apple", modelo: "iPhone 12", numeroSerie: "123456789012345" },
      operacaoStatusV3: "entregue",
    });
    const outraCliente = os({
      id: "os-9",
      codigo: "OS-9",
      clienteId: "cli-1",
      cliente: { id: "cli-1", nome: "Ana" },
      equipamento: { marca: "Samsung", modelo: "A10" },
    });
    const h = buildHistoricoTransversalV4(atual, [orig, atual, outraCliente]);
    expect(h.temOs).toBe(true);
    expect(h.cliente).toBe("Ana");
    expect(h.aparelho).toContain("iPhone 12");
    expect(h.aparelhoTemHistorico).toBe(true);
    expect(h.relacionadas.some((r) => r.osId === "os-1" && (r.papel === "aparelho" || r.papel === "origem"))).toBe(true);
    expect(h.relacionadas.some((r) => r.osId === "os-9" && r.papel === "cliente")).toBe(true);
    expect(h.relacionadas.some((r) => r.osId === "os-3" && r.papel === "retorno")).toBe(true);
    expect(h.temAssinatura).toBe(true);
    expect(h.temAnexos).toBe(true);
    expect(h.retornosAbertos).toBe(1);
  });

  it("export da auditoria é texto real, sem inventar evento", () => {
    const txt = montarAuditoriaExportV4({
      codigo: "OS-1",
      cliente: "Ana",
      aparelho: "iPhone",
      eventos: [{ text: "OS criada", meta: "Ana · 01/08" }],
    });
    expect(txt).toContain("OS-1");
    expect(txt).toContain("OS criada");
    expect(txt).not.toContain("mock");
  });
});
