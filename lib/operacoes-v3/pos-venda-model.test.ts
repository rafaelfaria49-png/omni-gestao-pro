import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import {
  classificarGarantiasV3,
  kpisPosVendaV3,
  lerEntregaV3,
  lerGarantiaV3,
  lerRetornosV3,
  resumoRetornosV3,
  retornosDoClienteV3,
} from "./pos-venda-model";

const NOW = new Date("2026-06-04T12:00:00.000Z");
const DIA = 86400000;
function diasAtras(n: number): string {
  return new Date(NOW.getTime() - n * DIA).toISOString();
}

function os(over: Record<string, unknown>): OrdemServico {
  return { id: "os1", codigo: "OS-1", cliente: { nome: "Cliente" }, timeline: [], ...over } as unknown as OrdemServico;
}
function comGarantia(modelo: string, prazoDias?: number, extra: Record<string, unknown> = {}): OrdemServico {
  return os({ aberturaV3: { garantiaPrevista: { modelo, label: `Garantia ${modelo}`, prazoDias } }, ...extra });
}
function entregueEm(iso: string) {
  return { entregaV3: { entregueEm: iso, entreguePor: "Op", recebidoPor: "Cliente" } };
}

describe("entrega — leitura", () => {
  it("sem entrega → não entregue", () => {
    expect(lerEntregaV3(os({})).entregue).toBe(false);
  });
  it("com entregaV3 → entregue com metadados", () => {
    const e = lerEntregaV3(os(entregueEm(diasAtras(1))));
    expect(e.entregue).toBe(true);
    expect(e.recebidoPor).toBe("Cliente");
    expect(e.entreguePor).toBe("Op");
  });
  it("fallback para os.entregueEm/retirada", () => {
    expect(lerEntregaV3(os({ entregueEm: diasAtras(2) })).entregue).toBe(true);
  });
});

describe("garantia — situação", () => {
  it("ATIVA: entregue recentemente, dentro do prazo", () => {
    const g = lerGarantiaV3(comGarantia("tela", 90, entregueEm(NOW.toISOString())), NOW);
    expect(g.situacao).toBe("ativa");
    expect(g.prazoDias).toBe(90);
    expect(g.diasRestantes).toBe(90);
    expect(g.inicio).toBeTruthy();
    expect(g.vencimento).toBeTruthy();
  });

  it("VENCIDA: entregue há mais tempo que o prazo", () => {
    const g = lerGarantiaV3(comGarantia("tela", 90, entregueEm(diasAtras(100))), NOW);
    expect(g.situacao).toBe("vencida");
    expect(g.diasRestantes).toBeLessThan(0);
  });

  it("PREVISTA: tem garantia mas ainda não foi entregue", () => {
    const g = lerGarantiaV3(comGarantia("tela", 90), NOW);
    expect(g.situacao).toBe("prevista");
    expect(g.inicio).toBeUndefined();
    expect(g.vencimento).toBeUndefined();
  });

  it("SEM COBERTURA: modelo sem garantia", () => {
    const g = lerGarantiaV3(comGarantia("sem_garantia", 0, entregueEm(NOW.toISOString())), NOW);
    expect(g.situacao).toBe("sem_garantia");
    expect(g.semCobertura).toBe(true);
  });

  it("NENHUMA: OS sem dado de garantia", () => {
    expect(lerGarantiaV3(os({}), NOW).situacao).toBe("nenhuma");
  });

  it("usa o prazo padrão do catálogo quando não informado", () => {
    const g = lerGarantiaV3(comGarantia("bateria", undefined, entregueEm(NOW.toISOString())), NOW);
    expect(g.prazoDias).toBe(90); // padrão de bateria
    expect(g.situacao).toBe("ativa");
  });
});

describe("garantia — classificação (ativa/vencendo/vencida/prevista)", () => {
  it("separa em baldes corretos pela janela de vencimento", () => {
    const ordens = [
      comGarantia("tela", 90, { ...entregueEm(diasAtras(30)), id: "a" }), // ~60 dias → ativa
      comGarantia("tela", 90, { ...entregueEm(diasAtras(80)), id: "b" }), // ~10 dias → vencendo
      comGarantia("tela", 90, { ...entregueEm(diasAtras(100)), id: "c" }), // vencida
      comGarantia("tela", 90, { id: "d" }), // prevista (sem entrega)
      os({ id: "e" }), // nenhuma → não entra
    ];
    const seg = classificarGarantiasV3(ordens, { vencendoDias: 15, now: NOW });
    expect(seg.ativas.map((l) => l.os.id)).toEqual(["a"]);
    expect(seg.vencendo.map((l) => l.os.id)).toEqual(["b"]);
    expect(seg.vencidas.map((l) => l.os.id)).toEqual(["c"]);
    expect(seg.previstas.map((l) => l.os.id)).toEqual(["d"]);
  });
});

describe("retorno — leitura + vínculo OS original", () => {
  const comRetornos = os({
    id: "os9",
    retornosV3: [
      { id: "r1", osOriginalId: "os9", osOriginalCodigo: "OS-9", motivo: "Tela falhando de novo", criadoEm: diasAtras(2), status: "aberto" },
      { id: "r2", osOriginalId: "os9", motivo: "Não carrega", criadoEm: diasAtras(10), status: "finalizado", finalizadoEm: diasAtras(8) },
    ],
  });

  it("lê retornos (mais recentes primeiro) e mantém o vínculo com a OS original", () => {
    const list = lerRetornosV3(comRetornos);
    expect(list.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(list.every((r) => r.osOriginalId === "os9")).toBe(true);
  });

  it("lê observação de abertura e o atendimento vinculado", () => {
    const list = lerRetornosV3(os({
      retornosV3: [{
        id: "r1",
        osOriginalId: "os9",
        motivo: "Touch",
        observacao: "Cliente deixou o aparelho",
        criadoEm: diasAtras(1),
        status: "aberto",
        osRetornoId: "os-nova",
        osRetornoCodigo: "OS-2001",
      }],
    }));
    expect(list[0]).toMatchObject({
      observacao: "Cliente deixou o aparelho",
      osRetornoId: "os-nova",
      osRetornoCodigo: "OS-2001",
    });
  });

  it("resume contagem por status", () => {
    const r = resumoRetornosV3(comRetornos);
    expect(r).toMatchObject({ total: 2, abertos: 1, finalizados: 1 });
    expect(r.ultimoMotivo).toBe("Tela falhando de novo");
  });

  it("ignora entradas inválidas", () => {
    expect(lerRetornosV3(os({ retornosV3: [{}, { id: "" }, null] }))).toHaveLength(0);
  });
});

describe("retornos — agregação por cliente", () => {
  it("soma retornos de todas as OS do mesmo cliente", () => {
    const ordens = [
      os({ id: "o1", clienteId: "c1", retornosV3: [{ id: "x", osOriginalId: "o1", motivo: "a", criadoEm: diasAtras(1), status: "aberto" }] }),
      os({ id: "o2", clienteId: "c1", retornosV3: [{ id: "y", osOriginalId: "o2", motivo: "b", criadoEm: diasAtras(1), status: "finalizado" }] }),
      os({ id: "o3", clienteId: "c2", retornosV3: [{ id: "z", osOriginalId: "o3", motivo: "c", criadoEm: diasAtras(1), status: "aberto" }] }),
    ];
    const agg = retornosDoClienteV3(ordens, ordens[0]);
    expect(agg).toMatchObject({ total: 2, abertos: 1, ordensComRetorno: 2 });
  });
});

describe("KPIs de pós-venda", () => {
  it("conta garantias ativas, retornos e taxa de retorno (OS com retorno ÷ entregues)", () => {
    const ordens = [
      comGarantia("tela", 90, { ...entregueEm(diasAtras(10)), id: "k1" }), // entregue + garantia ativa
      comGarantia("tela", 90, {
        ...entregueEm(diasAtras(20)),
        id: "k2",
        retornosV3: [{ id: "r", osOriginalId: "k2", motivo: "voltou", criadoEm: diasAtras(1), status: "aberto" }],
      }), // entregue + retorno aberto
      comGarantia("tela", 90, { id: "k3" }), // prevista, não entregue
    ];
    const kpi = kpisPosVendaV3(ordens, { now: NOW });
    expect(kpi.osEntregues).toBe(2);
    expect(kpi.garantiasAtivas).toBe(2); // k1 e k2 ativas
    expect(kpi.totalRetornos).toBe(1);
    expect(kpi.retornosAbertos).toBe(1);
    expect(kpi.osComRetorno).toBe(1);
    expect(kpi.taxaRetorno).toBe(50); // 1 de 2 entregues
  });
});
