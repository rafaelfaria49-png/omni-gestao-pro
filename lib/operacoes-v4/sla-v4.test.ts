import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import {
  FILTROS_SLA_VAZIOS,
  SEM_TECNICO_SLA_V4,
  buildSlaOperacionalV4,
  filtrarSlaV4,
  filtrosSlaAtivosV4,
  formatAtrasoSlaV4,
} from "./sla-v4";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const H = 3600000;
const emHoras = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

function os(over: Record<string, unknown>): OrdemServico {
  return {
    id: "o",
    codigo: "OS",
    cliente: { nome: "C" },
    timeline: [],
    ...over,
  } as unknown as OrdemServico;
}

describe("SLA operacional V4", () => {
  it("agrupa por lerSlaV3 — não pelo sla.status legado isolado", () => {
    const proj = buildSlaOperacionalV4(
      [
        os({ id: "a", codigo: "OS-A", operacaoStatusV3: "em_execucao", sla: { prazo: emHoras(-2) } }),
        os({ id: "r", codigo: "OS-R", operacaoStatusV3: "em_execucao", sla: { prazo: emHoras(2) } }),
        os({ id: "n", codigo: "OS-N", operacaoStatusV3: "aberta", sla: { prazo: emHoras(48) } }),
        os({ id: "s", codigo: "OS-S", operacaoStatusV3: "aberta" }),
        os({ id: "e", codigo: "OS-E", operacaoStatusV3: "entregue", sla: { prazo: emHoras(-10), status: "estourado" } }),
      ],
      NOW,
    );
    expect(proj.temDados).toBe(true);
    expect(proj.atrasadas.map((r) => r.osId)).toEqual(["a"]);
    expect(proj.emRisco.map((r) => r.osId)).toEqual(["r"]);
    expect(proj.noPrazo.map((r) => r.osId)).toEqual(["n"]);
    expect(proj.semPrazo.map((r) => r.osId)).toEqual(["s"]);
    expect(proj.lista.map((r) => r.osId)).not.toContain("e");
    expect(proj.resumo).toEqual({ ativas: 4, atrasadas: 1, emRisco: 1, noPrazo: 1, semPrazo: 1 });
  });

  it("OS só com status estourado (sem prazo ISO) entra em atrasadas", () => {
    const proj = buildSlaOperacionalV4(
      [os({ id: "x", operacaoStatusV3: "em_execucao", sla: { status: "estourado" } })],
      NOW,
    );
    expect(proj.atrasadas.map((r) => r.osId)).toEqual(["x"]);
    expect(proj.atrasadas[0]!.sla.texto).toBe("Atrasada");
  });

  it("expõe técnico, prioridade e atraso real na linha", () => {
    const proj = buildSlaOperacionalV4(
      [
        os({
          id: "1",
          codigo: "OS-1",
          operacaoStatusV3: "em_execucao",
          prioridadeV3: "urgente",
          tecnico: { id: "t1", nome: "Ana" },
          sla: { prazo: emHoras(-1.5) },
        }),
      ],
      NOW,
    );
    const row = proj.atrasadas[0]!;
    expect(row.tecnicoNome).toBe("Ana");
    expect(row.prioridade).toBe("urgente");
    expect(row.atrasoMinutos).toBe(90);
    expect(formatAtrasoSlaV4(row.atrasoMinutos)).toBe("1h 30min");
  });

  it("filtra por técnico / prioridade / situação", () => {
    const proj = buildSlaOperacionalV4(
      [
        os({
          id: "1",
          operacaoStatusV3: "em_execucao",
          prioridadeV3: "alta",
          tecnico: { id: "t1", nome: "Ana" },
          sla: { prazo: emHoras(-1) },
        }),
        os({ id: "2", operacaoStatusV3: "aberta", prioridadeV3: "baixa", sla: { prazo: emHoras(48) } }),
      ],
      NOW,
    );
    const soAna = filtrarSlaV4(proj, { ...FILTROS_SLA_VAZIOS, tecnicoId: "t1" });
    expect(soAna.lista.map((r) => r.osId)).toEqual(["1"]);
    const semTec = filtrarSlaV4(proj, { ...FILTROS_SLA_VAZIOS, tecnicoId: SEM_TECNICO_SLA_V4 });
    expect(semTec.lista.map((r) => r.osId)).toEqual(["2"]);
    const atras = filtrarSlaV4(proj, { ...FILTROS_SLA_VAZIOS, situacao: "atrasada" });
    expect(atras.lista.map((r) => r.osId)).toEqual(["1"]);
    expect(filtrosSlaAtivosV4(FILTROS_SLA_VAZIOS)).toBe(false);
    expect(filtrosSlaAtivosV4({ ...FILTROS_SLA_VAZIOS, situacao: "atrasada" })).toBe(true);
  });

  it("lista vazia → temDados false, sem prazo inventado", () => {
    const proj = buildSlaOperacionalV4([], NOW);
    expect(proj.temDados).toBe(false);
    expect(proj.atrasadas).toEqual([]);
    expect(proj.resumo.ativas).toBe(0);
  });
});
