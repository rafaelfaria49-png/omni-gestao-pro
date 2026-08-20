import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import { buildDashboardOperacionalV4 } from "./dashboard-v4";

const NOW = new Date("2026-08-19T15:00:00.000Z");

function os(over: Record<string, unknown>): OrdemServico {
  return { id: "o", codigo: "OS", cliente: { nome: "C" }, timeline: [], ...over } as unknown as OrdemServico;
}

describe("dashboard operacional V4", () => {
  it("lista vazia → temDados false", () => {
    const d = buildDashboardOperacionalV4([], NOW);
    expect(d.temDados).toBe(false);
    expect(d.resumo.ativas).toBe(0);
  });

  it("agrega fila, SLA, técnico, retorno e entrega do dia sem inventar", () => {
    const d = buildDashboardOperacionalV4(
      [
        os({
          id: "a",
          codigo: "OS-A",
          operacaoStatusV3: "em_execucao",
          sla: { prazo: new Date(NOW.getTime() - 3600000).toISOString() },
        }),
        os({ id: "b", codigo: "OS-B", operacaoStatusV3: "aberta" }),
        os({
          id: "c",
          codigo: "OS-C",
          operacaoStatusV3: "pronta",
          tecnico: { id: "t1", nome: "Ana" },
        }),
        os({
          id: "d",
          codigo: "OS-D",
          operacaoStatusV3: "entregue",
          entregueEm: NOW.toISOString(),
          entregaV3: { entregueEm: NOW.toISOString(), recebidoPor: "Maria" },
        }),
        os({
          id: "e",
          codigo: "OS-E",
          operacaoStatusV3: "entregue",
          retornosV3: [{ id: "r1", osOriginalId: "e", motivo: "Não ligou", status: "aberto", criadoEm: NOW.toISOString() }],
        }),
      ],
      NOW,
    );
    expect(d.temDados).toBe(true);
    expect(d.resumo.atrasadas).toBe(1);
    expect(d.resumo.semTecnico).toBeGreaterThanOrEqual(2);
    expect(d.resumo.prontas).toBe(1);
    expect(d.resumo.entreguesHoje).toBe(1);
    expect(d.resumo.retornosAbertos).toBe(1);
    expect(d.atrasadas.map((r) => r.osId)).toEqual(["a"]);
    expect(d.fila.find((c) => c.status === "pronta")?.count).toBe(1);
    expect(d.entreguesHoje[0]?.extra).toContain("Maria");
  });
});
