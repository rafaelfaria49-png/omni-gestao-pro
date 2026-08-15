import { describe, expect, it } from "vitest";
import type { FinancialProjectionOSV4 } from "./financial-projection";
import {
  labelTicketFinanceiroV4,
  montarResumoFinanceiroOSV4,
  situacaoFinanceiraOSV4,
} from "./financeiro-v4";

function projection(over: Partial<FinancialProjectionOSV4> = {}): FinancialProjectionOSV4 {
  return {
    version: 1,
    storeId: "s1",
    osId: "os-1",
    osCode: "OS-1",
    operationalStatus: "pronta",
    expectedTotal: 500,
    expectedTotalSource: ["orcamento_aprovado"],
    approvedBudgetTotal: 500,
    osColumnTotal: 500,
    legacyTotal: null,
    billingSnapshotTotal: null,
    receivableFound: true,
    receivableId: "cr-1",
    receivableTotal: 500,
    receivableStatus: "pendente",
    receivedTotal: 0,
    reversedTotal: 0,
    balance: 500,
    financialStatus: "OPEN",
    consistencyStatus: "CONSISTENT",
    consistencyIssues: [],
    paymentMethods: [],
    collectionMode: null,
    installments: [],
    authorizedCredit: false,
    authorizedNoCharge: false,
    noChargeCategory: null,
    noChargeReason: null,
    financialEvents: [],
    canReceive: true,
    canDeliver: false,
    deliveryDecision: "BLOCK_PENDING_BALANCE",
    loadedAt: "2026-08-15T12:00:00.000Z",
    errorCode: null,
    ...over,
  };
}

describe("view-model financeiro V4", () => {
  it("distingue prévia de cobrança real", () => {
    const previa = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PRICE_DEFINED", canReceive: false, receivableFound: false, receivedTotal: null, balance: null }),
      caixaAberto: true,
    });
    expect(previa.situacao).toBe("previa");
    expect(previa.sintetizada).toBe(true);
    expect(previa.cobrancaReal).toBe(false);
    expect(previa.podeReceberSaldo).toBe(false);
    expect(labelTicketFinanceiroV4(previa)).toBe("Prévia sem cobrança");
  });

  it("sem cobrança autorizada não vira a receber", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({
        financialStatus: "AUTHORIZED_NO_CHARGE",
        expectedTotal: 0,
        receivedTotal: 0,
        balance: 0,
        canReceive: false,
        receivableFound: false,
      }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("sem_cobranca");
    expect(labelTicketFinanceiroV4(resumo)).toBe("Sem cobrança");
  });

  it("aberto mostra total/recebido/saldo e permite receber quando o motor permite", () => {
    const resumo = montarResumoFinanceiroOSV4({ projection: projection(), caixaAberto: true });
    expect(resumo).toMatchObject({
      situacao: "a_receber",
      situacaoLabel: "A receber",
      total: 500,
      recebido: 0,
      saldo: 500,
      cobrancaReal: true,
      podeReceber: true,
      podeReceberSaldo: true,
      podeLancarPrazo: true,
      exigeCaixa: true,
    });
    expect(labelTicketFinanceiroV4(resumo)).toBe("R$ 500,00 a receber");
  });

  it("parcial não vira quitado", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({
        financialStatus: "PARTIAL",
        receivedTotal: 200,
        balance: 300,
        receivableStatus: "parcial",
      }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("parcial");
    expect(resumo.situacaoLabel).toBe("Parcial");
    expect(resumo.saldo).toBe(300);
    expect(labelTicketFinanceiroV4(resumo)).toBe("Parcial  R$ 300,00 pendente");
  });

  it("quitado zera saldo e bloqueia novo recebimento", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({
        financialStatus: "PAID",
        receivedTotal: 500,
        balance: 0,
        canReceive: false,
        canDeliver: true,
        deliveryDecision: "ALLOW_PAID",
      }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("quitado");
    expect(resumo.saldo).toBe(0);
    expect(resumo.podeReceberSaldo).toBe(false);
    expect(labelTicketFinanceiroV4(resumo)).toBe("Quitado");
  });

  it("CHARGE_NOT_CREATED com total positivo é saldo recebível (V3 cria o título)", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({
        financialStatus: "CHARGE_NOT_CREATED",
        receivableFound: false,
        receivableId: null,
        receivedTotal: null,
        balance: null,
        canReceive: false,
        consistencyStatus: "INCOMPLETE",
        consistencyIssues: ["Total positivo sem Conta a Receber correspondente."],
      }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("a_receber");
    expect(resumo.podeReceber).toBe(false);
    expect(resumo.podeReceberSaldo).toBe(true);
    expect(resumo.saldo).toBe(500);
    expect(resumo.recebido).toBe(0);
  });

  it("caixa fechado não inventa recebimento possível no motor imediato", () => {
    const resumo = montarResumoFinanceiroOSV4({ projection: projection(), caixaAberto: false });
    expect(resumo.caixaAberto).toBe(false);
    expect(resumo.exigeCaixa).toBe(true);
    expect(resumo.podeLancarPrazo).toBe(true);
  });

  it("histórico omite operador ausente e marca estorno", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({
        financialEvents: [
          {
            eventId: "RECEIVABLE:1",
            source: "RECEIVABLE",
            type: "pagamento",
            amount: 200,
            paymentMethod: "PIX",
            occurredAt: "2026-08-15T10:00:00.000Z",
            actor: "Ana",
            description: "Pagamento registrado",
          },
          {
            eventId: "RECEIVABLE:2",
            source: "RECEIVABLE",
            type: "estorno_pagamento",
            amount: 200,
            paymentMethod: null,
            occurredAt: "2026-08-15T11:00:00.000Z",
            actor: null,
            description: "Pagamento estornado",
          },
        ],
      }),
      caixaAberto: true,
    });
    expect(resumo.recebimentos).toHaveLength(2);
    expect(resumo.recebimentos[0]).toMatchObject({ operador: "Ana", forma: "PIX", estornado: false });
    expect(resumo.recebimentos[1]).toMatchObject({ operador: null, estornado: true, status: "Estornado" });
  });

  it("mapeia status da projeção sem reclassificar no cliente", () => {
    expect(situacaoFinanceiraOSV4("PRICE_DEFINED")).toBe("previa");
    expect(situacaoFinanceiraOSV4("CANCELLED")).toBe("cancelada");
    expect(situacaoFinanceiraOSV4("AUTHORIZED_CREDIT")).toBe("a_prazo");
  });

  it("1. OS sem cobrança não é recebível", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "NO_PRICE", expectedTotal: 0, receivedTotal: 0, balance: 0, canReceive: false, receivableFound: false }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("sem_cobranca");
    expect(resumo.podeReceberSaldo).toBe(false);
  });

  it("2. prévia sintetizada nunca vira recebível", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PRICE_DEFINED", canReceive: false, receivableFound: false }),
      caixaAberto: true,
    });
    expect(resumo.sintetizada).toBe(true);
    expect(resumo.podeReceberSaldo).toBe(false);
    expect(resumo.cobrancaReal).toBe(false);
  });

  it("3–9. cobrança real em aberto, parcial e quitada conservam total/recebido/saldo", () => {
    const aberto = montarResumoFinanceiroOSV4({ projection: projection(), caixaAberto: true });
    expect(aberto).toMatchObject({ total: 500, recebido: 0, saldo: 500, situacao: "a_receber" });
    const parcial = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PARTIAL", receivedTotal: 200, balance: 300 }),
      caixaAberto: true,
    });
    expect(parcial).toMatchObject({ total: 500, recebido: 200, saldo: 300, situacao: "parcial" });
    expect(parcial.situacao).not.toBe("quitado");
    const quitada = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PAID", receivedTotal: 500, balance: 0, canReceive: false }),
      caixaAberto: true,
    });
    expect(quitada).toMatchObject({ total: 500, recebido: 500, saldo: 0, situacao: "quitado" });
  });

  it("6. cobrança cancelada não habilita receber", () => {
    const resumo = montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "CANCELLED", canReceive: false }),
      caixaAberto: true,
    });
    expect(resumo.situacao).toBe("cancelada");
    expect(resumo.podeReceberSaldo).toBe(false);
  });

  it("10–12. histórico real e estado de caixa", () => {
    const aberto = montarResumoFinanceiroOSV4({
      projection: projection({
        financialEvents: [{
          eventId: "1", source: "RECEIVABLE", type: "pagamento", amount: 80,
          paymentMethod: "Dinheiro", occurredAt: "2026-08-15T10:32:00.000Z", actor: "Rafael",
          description: "Pagamento registrado",
        }],
      }),
      caixaAberto: false,
    });
    expect(aberto.recebimentos[0]).toMatchObject({ valor: 80, forma: "Dinheiro", operador: "Rafael" });
    expect(aberto.caixaAberto).toBe(false);
    expect(montarResumoFinanceiroOSV4({ projection: projection(), caixaAberto: true }).caixaAberto).toBe(true);
  });

  it("13–16. formas e capacidades seguem o contrato V3", () => {
    const resumo = montarResumoFinanceiroOSV4({ projection: projection(), caixaAberto: true });
    expect(resumo.formasDisponiveis.map((f) => f.value)).toEqual(["dinheiro", "pix", "debito", "credito"]);
    expect(resumo.formasIndisponiveis.map((f) => f.value)).toEqual(["parcelado", "crediario", "carteira"]);
    expect(resumo.suportaSplit).toBe(true);
    expect(resumo.suportaAPrazo).toBe(true);
  });

  it("17–18. podeEstornar só com recebido e prévia não é recebível", () => {
    expect(montarResumoFinanceiroOSV4({
      projection: projection({ receivedTotal: 0 }),
      caixaAberto: true,
    }).podeEstornar).toBe(false);
    expect(montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PARTIAL", receivedTotal: 80, balance: 420 }),
      caixaAberto: true,
    }).podeEstornar).toBe(true);
    expect(montarResumoFinanceiroOSV4({
      projection: projection({ financialStatus: "PRICE_DEFINED", canReceive: false }),
      caixaAberto: true,
    }).podeReceberSaldo).toBe(false);
  });
});
