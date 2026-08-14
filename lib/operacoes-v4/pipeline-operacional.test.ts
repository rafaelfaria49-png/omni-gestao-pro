import { describe, expect, it } from "vitest";
import type { V4Status } from "@/components/operacoes-v4-preview/types";
import {
  PIPELINE_OPERACIONAL_IDS_V4,
  destinoOperacionalPorStatusV4,
  estadoNoPipelineOperacionalV4,
  isPipelineOperacionalIdV4,
  labelPipelineOperacionalV4,
} from "./pipeline-operacional";

describe("pipeline operacional V4 — 5 etapas técnicas", () => {
  it("expõe exatamente as cinco etapas na ordem da assistência", () => {
    expect(PIPELINE_OPERACIONAL_IDS_V4).toEqual([
      "entrada",
      "diagnostico",
      "execucao",
      "entrega",
      "posvenda",
    ]);
  });

  it("não inclui orçamento, financeiro nem histórico na trilha", () => {
    expect(isPipelineOperacionalIdV4("orcamento")).toBe(false);
    expect(isPipelineOperacionalIdV4("financeiro")).toBe(false);
    expect(isPipelineOperacionalIdV4("historico")).toBe(false);
    expect(PIPELINE_OPERACIONAL_IDS_V4.map(labelPipelineOperacionalV4)).toEqual([
      "Entrada",
      "Diagnóstico",
      "Execução",
      "Entrega",
      "Pós-venda",
    ]);
  });

  it("abre a OS na etapa operacional, não na comercial/financeira", () => {
    expect(destinoOperacionalPorStatusV4("aberta")).toBe("entrada");
    expect(destinoOperacionalPorStatusV4("diagnostico")).toBe("diagnostico");
    expect(destinoOperacionalPorStatusV4("aguardando_aprovacao")).toBe("diagnostico");
    expect(destinoOperacionalPorStatusV4("aprovado")).toBe("execucao");
    expect(destinoOperacionalPorStatusV4("aguardando_peca")).toBe("execucao");
    expect(destinoOperacionalPorStatusV4("em_execucao")).toBe("execucao");
    expect(destinoOperacionalPorStatusV4("pronta")).toBe("entrega");
    expect(destinoOperacionalPorStatusV4("entregue")).toBe("entrega");
  });

  it("status sem etapa operacional cai no histórico transversal", () => {
    expect(destinoOperacionalPorStatusV4("cancelada")).toBe("historico");
    expect(destinoOperacionalPorStatusV4("desconhecido")).toBe("historico");
    expect(destinoOperacionalPorStatusV4(undefined)).toBe("historico");
  });

  it("OS aberta marca só Entrada como atual", () => {
    expect(estadoNoPipelineOperacionalV4("entrada", "aberta").current).toBe(true);
    expect(estadoNoPipelineOperacionalV4("diagnostico", "aberta").pending).toBe(true);
    expect(estadoNoPipelineOperacionalV4("execucao", "aberta").pending).toBe(true);
  });

  it("aguardando aprovação conclui o diagnóstico sem abrir execução", () => {
    expect(estadoNoPipelineOperacionalV4("diagnostico", "aguardando_aprovacao").done).toBe(true);
    expect(estadoNoPipelineOperacionalV4("diagnostico", "aguardando_aprovacao").current).toBe(false);
    expect(estadoNoPipelineOperacionalV4("execucao", "aguardando_aprovacao").pending).toBe(true);
  });

  it("OS pronta marca Entrega como atual — nunca um nó financeiro", () => {
    const entrega = estadoNoPipelineOperacionalV4("entrega", "pronta");
    expect(entrega.current).toBe(true);
    expect(entrega.done).toBe(false);
    expect(estadoNoPipelineOperacionalV4("execucao", "pronta").done).toBe(true);
    expect(estadoNoPipelineOperacionalV4("posvenda", "pronta").pending).toBe(true);
  });

  it("aguardando peça acende atenção na Execução", () => {
    const exec = estadoNoPipelineOperacionalV4("execucao", "aguardando_peca");
    expect(exec.current).toBe(true);
    expect(exec.alert).toBe(true);
    expect(exec.visual).toBe("alert");
    expect(exec.alertReason).toBe("Aguardando peça");
  });

  it("entrega bloqueada pelo financeiro acende atenção sem marcar concluída", () => {
    const entrega = estadoNoPipelineOperacionalV4("entrega", "pronta", {
      canDeliver: false,
      hasOpenCharge: true,
    });
    expect(entrega.current).toBe(true);
    expect(entrega.alert).toBe(true);
    expect(entrega.done).toBe(false);
  });

  it("status desconhecido não marca etapa atual nem concluída", () => {
    for (const id of PIPELINE_OPERACIONAL_IDS_V4) {
      const n = estadoNoPipelineOperacionalV4(id, "desconhecido" as V4Status);
      expect(n.current).toBe(false);
      expect(n.done).toBe(false);
      expect(n.pending).toBe(true);
    }
  });
});
