/**
 * OPS-V4-REAL-SEARCH-AND-RAILS-001 — adaptadores READ-ONLY das telas de rail.
 *
 * Garante que cada builder deriva SÓ de dado real e sinaliza `temDados: false`
 * (empty honesto) quando a base real do módulo não existe — sem inventar número,
 * técnico, SLA ou valor.
 */
import { describe, it, expect } from "vitest";
import {
  buildBancadaView,
  buildDashboardResumo,
  buildFilaItens,
  buildPdvView,
  buildSlaView,
} from "./rails-adapter";
import type { OrdemServico } from "@/types/os";
import type { FinancialProjectionOSV4, FinancialStatusV4 } from "@/lib/operacoes-v4/financial-projection";

function mkOS(p: Record<string, unknown> & { id: string }): OrdemServico {
  return p as unknown as OrdemServico;
}

describe("rails-adapter — Visão geral (dashboard)", () => {
  it("conta por status real e marca temDados", () => {
    const ordens = [
      mkOS({ id: "1", status: "aberta" }),
      mkOS({ id: "2", status: "em_execucao" }),
      mkOS({ id: "3", status: "em_execucao" }),
      mkOS({ id: "4", status: "entregue" }),
      mkOS({ id: "5", status: "cancelada" }),
    ];
    const r = buildDashboardResumo(ordens);
    expect(r.temDados).toBe(true);
    expect(r.total).toBe(5);
    expect(r.ativos).toBe(3); // exclui entregue + cancelada
    const byKey = Object.fromEntries(r.buckets.map((b) => [b.key, b.count]));
    expect(byKey.aberta).toBe(1);
    expect(byKey.em_execucao).toBe(2);
    expect(byKey.entregue).toBe(1);
  });

  it("lista vazia → temDados false (empty honesto)", () => {
    const r = buildDashboardResumo([]);
    expect(r.temDados).toBe(false);
    expect(r.total).toBe(0);
  });

  it("atrasadas só conta com SLA real (status estourado); sem SLA → temSla false", () => {
    const semSla = buildDashboardResumo([mkOS({ id: "1", status: "em_execucao" })]);
    expect(semSla.temSla).toBe(false);
    expect(semSla.atrasadas).toBe(0);

    const comSla = buildDashboardResumo([
      mkOS({ id: "1", status: "em_execucao", sla: { status: "estourado" } }),
      mkOS({ id: "2", status: "aberta", sla: { status: "ok" } }),
    ]);
    expect(comSla.temSla).toBe(true);
    expect(comSla.atrasadas).toBe(1);
  });
});

describe("rails-adapter — Fila", () => {
  it("exclui entregue/cancelada e ordena por entrada (mais antiga primeiro)", () => {
    const fila = buildFilaItens([
      mkOS({ id: "novo", status: "em_execucao", criadoEm: "2026-02-01T10:00:00Z", codigo: "OS-2" }),
      mkOS({ id: "antigo", status: "aberta", criadoEm: "2026-01-01T10:00:00Z", codigo: "OS-1" }),
      mkOS({ id: "entregue", status: "entregue", criadoEm: "2026-01-15T10:00:00Z" }),
    ]);
    expect(fila.map((r) => r.id)).toEqual(["antigo", "novo"]);
    expect(fila[0]!.codigo).toBe("OS-1");
  });
});

describe("rails-adapter — Bancada", () => {
  it("sem técnico real → temDados false (não inventa técnico)", () => {
    const view = buildBancadaView([mkOS({ id: "1", status: "em_execucao" })]);
    expect(view.temDados).toBe(false);
    expect(view.grupos).toEqual([]);
  });

  it("agrupa OS ativas por técnico real", () => {
    const view = buildBancadaView([
      mkOS({ id: "1", status: "em_execucao", tecnico: { nome: "Ana" } }),
      mkOS({ id: "2", status: "aprovado", tecnico: { nome: "Ana" } }),
      mkOS({ id: "3", status: "em_execucao", tecnico: { nome: "Bruno" } }),
      mkOS({ id: "4", status: "entregue", tecnico: { nome: "Ana" } }), // finalizada → fora
    ]);
    expect(view.temDados).toBe(true);
    expect(view.grupos.map((g) => g.tecnico)).toEqual(["Ana", "Bruno"]);
    expect(view.grupos[0]!.itens).toHaveLength(2);
    expect(view.grupos[1]!.itens).toHaveLength(1);
  });
});

describe("rails-adapter — SLA", () => {
  it("sem SLA real → temDados false (não inventa prazo)", () => {
    const view = buildSlaView([mkOS({ id: "1", status: "em_execucao" })]);
    expect(view.temDados).toBe(false);
  });

  it("separa atrasadas / vencendo / no prazo com o reader V3", () => {
    const now = Date.now();
    const view = buildSlaView([
      mkOS({ id: "1", status: "em_execucao", sla: { status: "estourado", prazo: new Date(now - 3600000).toISOString() } }),
      mkOS({ id: "2", status: "aberta", sla: { status: "atencao", prazo: new Date(now + 2 * 3600000).toISOString() } }),
      mkOS({ id: "3", status: "aberta", sla: { status: "ok", prazo: new Date(now + 48 * 3600000).toISOString() } }),
    ]);
    expect(view.temDados).toBe(true);
    expect(view.atrasadas.map((r) => r.id)).toEqual(["1"]);
    expect(view.vencendo.map((r) => r.id)).toEqual(["2"]);
    expect(view.noPrazo).toBe(1);
  });
});

describe("rails-adapter — PDV de serviço", () => {
  function projection(id: string, financialStatus: FinancialStatusV4, total: number | null, balance: number | null): FinancialProjectionOSV4 {
    return {
      version: 1, storeId: "store-a", osId: id, osCode: `OS-${id}`, operationalStatus: "pronta",
      expectedTotal: total, expectedTotalSource: ["orcamento_aprovado"], approvedBudgetTotal: total,
      osColumnTotal: total, legacyTotal: null, billingSnapshotTotal: null,
      receivableFound: balance != null, receivableId: balance != null ? `cr-${id}` : null,
      receivableTotal: total, receivableStatus: balance === 0 ? "pago" : balance != null ? "pendente" : null,
      receivedTotal: total != null && balance != null ? total - balance : null, reversedTotal: 0, balance,
      financialStatus, consistencyStatus: financialStatus === "INCONSISTENT" ? "INCONSISTENT" : "CONSISTENT",
      consistencyIssues: [], paymentMethods: [], collectionMode: null, installments: [],
      authorizedCredit: financialStatus === "AUTHORIZED_CREDIT", authorizedNoCharge: financialStatus === "AUTHORIZED_NO_CHARGE",
      noChargeCategory: null, noChargeReason: null, financialEvents: [], canReceive: financialStatus === "OPEN" || financialStatus === "PARTIAL",
      canDeliver: financialStatus === "PAID" || financialStatus === "AUTHORIZED_CREDIT" || financialStatus === "AUTHORIZED_NO_CHARGE",
      deliveryDecision: financialStatus === "PAID" ? "ALLOW_PAID" : "BLOCK_PENDING_BALANCE",
      loadedAt: "2026-07-15T12:00:00.000Z", errorCode: null,
    };
  }

  function projections(...items: FinancialProjectionOSV4[]): Map<string, FinancialProjectionOSV4> {
    return new Map(items.map((item) => [item.osId, item]));
  }

  it("sem valor/faturamento → temDados false (empty honesto)", () => {
    const view = buildPdvView([mkOS({ id: "1", status: "em_execucao" })], new Map());
    expect(view.temDados).toBe(false);
    expect(view.itens).toEqual([]);
  });

  it("lista somente a projeção server-side e conta saldos abertos", () => {
    const ordens = [
      mkOS({ id: "1", status: "pronta", codigo: "OS-1", faturamentoTotal: 150, faturamentoPendente: true }),
      mkOS({ id: "2", status: "entregue", codigo: "OS-2", faturamentoTotal: 80 }),
    ];
    const view = buildPdvView(ordens, projections(projection("1", "OPEN", 150, 150), projection("2", "PAID", 80, 0)));
    expect(view.temDados).toBe(true);
    expect(view.itens).toHaveLength(2);
    // ordena por total desc
    expect(view.itens[0]!.id).toBe("1");
    expect(view.aReceberCount).toBe(1);
    expect(view.itens[0]!.statusFaturamento).toBe("A receber");
  });

  it("saldo aberto vem da projeção, mesmo quando o pagamentoV3 da OS está antigo", () => {
    const os = mkOS({ id: "1", status: "pronta", codigo: "OS-1", pagamentoV3: { total: 470, recebido: 470 } });
    const view = buildPdvView([os], projections(projection("1", "OPEN", 470, 470)));
    expect(view.itens[0]!.statusFaturamento).toBe("A receber");
    expect(view.itens[0]!.saldoLinha).toBe("Saldo: R$ 470,00");
    expect(view.aReceberCount).toBe(1);
  });

  it("OS com orçamento real e recebido = total → 'Quitado' com saldo zero", () => {
    const view = buildPdvView(
      [mkOS({ id: "1", status: "pronta", codigo: "OS-1" })],
      projections(projection("1", "PAID", 470, 0)),
    );
    expect(view.itens[0]!.statusFaturamento).toBe("Quitado");
    expect(view.itens[0]!.saldoLinha).toBe("Saldo: R$ 0,00");
    expect(view.aReceberCount).toBe(0);
  });

  it("autorização sem cobrança é explícita e nunca vira quitada", () => {
    const view = buildPdvView(
      [mkOS({ id: "1", status: "aberta", codigo: "OS-1" })],
      projections(projection("1", "AUTHORIZED_NO_CHARGE", 0, null)),
    );
    expect(view.itens[0]!.statusFaturamento).toBe("Sem cobrança");
    expect(view.itens[0]!.statusFaturamento).not.toBe("Quitado");
    expect(view.aReceberCount).toBe(0);
  });

  it("cobrança ausente/inconsistente direciona para revisão, sem fallback zero", () => {
    const view = buildPdvView(
      [mkOS({ id: "1", status: "aberta", codigo: "OS-1" })],
      projections(projection("1", "CHARGE_NOT_CREATED", 300, null)),
    );
    expect(view.itens[0]!.statusFaturamento).toBe("Revisar cobrança");
    expect(view.itens[0]!.total).toBe("R$ 300,00");
    expect(view.aReceberCount).toBe(0);
  });
});
