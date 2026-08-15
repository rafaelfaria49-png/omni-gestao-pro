import { describe, expect, it } from "vitest";
import type { OrdemServico } from "@/types/os";
import {
  buildGarantiasPortfolioV4,
  buildPosVendaV4,
  filtrarGarantiasPortfolioV4,
} from "./posvenda-v4";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function os(extra: Record<string, unknown> = {}): OrdemServico {
  return {
    id: "os-1",
    codigo: "OS-1042",
    cliente: { nome: "Maria" },
    equipamento: { tipo: "Celular", marca: "Samsung", modelo: "S22" },
    timeline: [],
    ...extra,
  } as unknown as OrdemServico;
}

function garantia(prazoDias: number, entregueEm?: string, extra: Record<string, unknown> = {}): OrdemServico {
  return os({
    aberturaV3: { garantiaPrevista: { modelo: "tela", label: "Troca de tela", prazoDias } },
    ...(entregueEm ? { entregaV3: { entregueEm } } : {}),
    ...extra,
  });
}

describe("buildPosVendaV4", () => {
  it("não inventa garantia ausente", () => {
    const view = buildPosVendaV4(os(), NOW);
    expect(view.garantia.temGarantia).toBe(false);
    expect(view.garantia.situacaoLabel).toBe("Sem garantia registrada");
    expect(view.headerLabel).toBe("Sem garantia");
  });

  it("projeta garantia vigente e vencimento pela fonte V3", () => {
    const view = buildPosVendaV4(garantia(90, "2026-08-01T12:00:00.000Z"), NOW);
    expect(view.garantia.situacao).toBe("ativa");
    expect(view.garantia.prazoDias).toBe(90);
    expect(view.garantia.vencimento).toBe("2026-10-30T12:00:00.000Z");
    expect(view.elegibilidade.id).toBe("dentro_garantia");
  });

  it("não trata garantia vencida como vigente e permite registro sem prometer cobertura", () => {
    const view = buildPosVendaV4(garantia(30, "2026-06-01T12:00:00.000Z"), NOW);
    expect(view.garantia.situacao).toBe("vencida");
    expect(view.elegibilidade.id).toBe("fora_garantia");
    expect(view.podeAbrirRetorno).toBe(true);
  });

  it("expõe OS não entregue sem iniciar a garantia", () => {
    const view = buildPosVendaV4(garantia(90), NOW);
    expect(view.garantia.situacao).toBe("prevista");
    expect(view.elegibilidade.id).toBe("os_nao_entregue");
  });

  it("usa retornosV3, mantém vínculo, ordena e bloqueia outro retorno aberto", () => {
    const view = buildPosVendaV4(garantia(90, "2026-08-01T12:00:00.000Z", {
      retornosV3: [
        { id: "antigo", osOriginalId: "os-1", motivo: "Bateria", criadoEm: "2026-08-05T10:00:00.000Z", status: "finalizado", observacaoFinal: "Substituída" },
        { id: "aberto", osOriginalId: "os-1", osOriginalCodigo: "OS-1042", motivo: "Touch falhou", criadoEm: "2026-08-14T10:00:00.000Z", status: "aberto", garantiaAtivaNaAbertura: true },
      ],
    }), NOW);
    expect(view.historico.map((item) => item.id)).toEqual(["aberto", "antigo"]);
    expect(view.retornoAberto?.osOriginalCodigo).toBe("OS-1042");
    expect(view.podeAbrirRetorno).toBe(false);
    expect(view.podeFinalizarRetorno).toBe(true);
    expect(view.headerLabel).toBe("Retorno aberto");
  });

  it("não duplica eventos de retorno na timeline auxiliar", () => {
    const view = buildPosVendaV4(os({
      timeline: [
        { id: "entrega", tipo: "entrega_cliente", autor: "Ana", conteudo: "Serviço entregue", criadoEm: "2026-08-10T12:00:00.000Z" },
        { id: "retorno", tipo: "garantia_acionada", autor: "Ana", conteudo: "Retorno aberto", criadoEm: "2026-08-11T12:00:00.000Z" },
      ],
    }), NOW);
    expect(view.timeline.map((item) => item.id)).toEqual(["entrega"]);
  });
});

describe("portfólio de garantias V4", () => {
  const ordens = [
    garantia(30, "2026-07-20T12:00:00.000Z", { id: "vencendo", codigo: "OS-1" }),
    garantia(90, "2026-08-01T12:00:00.000Z", { id: "vigente", codigo: "OS-2", cliente: { nome: "João" } }),
    garantia(30, "2026-06-01T12:00:00.000Z", { id: "vencida", codigo: "OS-3" }),
    os({ id: "sem", codigo: "OS-4" }),
  ];

  it("conta somente dados reais e classifica vencendo em até sete dias", () => {
    const portfolio = buildGarantiasPortfolioV4(ordens, { now: NOW, vencendoDias: 7 });
    expect(portfolio.itens).toHaveLength(3);
    expect(portfolio.vigentes).toBe(2);
    expect(portfolio.vencendo).toBe(1);
    expect(portfolio.vencidas).toBe(1);
  });

  it("filtra situação e busca por OS/cliente/aparelho", () => {
    const portfolio = buildGarantiasPortfolioV4(ordens, { now: NOW, vencendoDias: 7 });
    expect(filtrarGarantiasPortfolioV4(portfolio, "vencendo").map((item) => item.osId)).toEqual(["vencendo"]);
    expect(filtrarGarantiasPortfolioV4(portfolio, "todas", "joão").map((item) => item.osId)).toEqual(["vigente"]);
    expect(filtrarGarantiasPortfolioV4(portfolio, "todas", "samsung s22")).toHaveLength(3);
  });
});
