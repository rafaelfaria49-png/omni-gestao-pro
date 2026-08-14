import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(dir, relative), "utf8");

describe("Operações V4 — superfícies financeiras unificadas", () => {
  it("Header usa o chip financeiro transversal derivado da projeção e não v.pag", () => {
    const header = source("parts/CommandHeader.tsx");
    expect(header).toContain("v.financeiroHeader")
    expect(header).toContain("financeiro.destino")
    expect(header).not.toContain("v.pag.")
    expect(header).not.toContain("v.financial")
  });

  it("Financeiro usa a projeção inclusive para CR, formas, parcelas e histórico", () => {
    const financeiro = source("parts/stages/FinanceiroStage.tsx");
    expect(financeiro).toContain("v.financial")
    expect(financeiro).toContain("projection.receivableFound")
    expect(financeiro).toContain("financial.paymentMethodSummary")
    expect(financeiro).toContain("projection.installments")
    expect(financeiro).toContain("projection.financialEvents")
    expect(financeiro).not.toContain("if (!f.temDados")
  });

  it("card de recebimento usa o saldo projetado; PDV fica só com sessão/mutação", () => {
    const receber = source("parts/ReceberPagamentoV4.tsx");
    const estorno = source("parts/EstornoRecebimentoModal.tsx");
    expect(receber).toContain("v.financial.projection")
    expect(receber).toContain("projection.balance")
    expect(receber).toContain("projection.installments")
    expect(receber).not.toContain("pdv.pagamento")
    expect(receber).not.toContain("v.aPrazo")
    expect(receber).toContain("pdv.receber")
    expect(receber).toContain("pdv.sessao")
    expect(estorno).toContain("v.financial.projection")
    expect(estorno).toContain("projection.receivedTotal")
    expect(estorno).toContain("projection.balance")
    expect(estorno).not.toContain("pdv.pagamento")
    expect(estorno).toContain("pdv.estornar")
  });

  it("Entrega e CTA global traduzem decisão/canDeliver sem reimplementar o guard no cliente", () => {
    const orchestrator = source("use-v4-preview.ts");
    const delivery = source("parts/stages/EntregaStage.tsx");
    expect(orchestrator).toContain("financialProjection?.canDeliver")
    expect(orchestrator).toContain('financialProjection?.financialStatus === "AUTHORIZED_CREDIT"')
    expect(orchestrator).toContain('financialProjection?.financialStatus === "AUTHORIZED_NO_CHARGE"')
    expect(orchestrator).not.toContain("adaptPag(")
    expect(orchestrator).not.toContain("adaptFinanceiro(")
    expect(delivery).toContain("v.entregaAcoes")
    expect(delivery).not.toContain("projetarEntregaFinanceiraV3")
  });

  it("writes relevantes recarregam a projeção somente após sucesso", () => {
    const orchestrator = source("use-v4-preview.ts");
    expect(orchestrator).toMatch(/await fn\(sid, osId\);[\s\S]*reloadFinancial\(\);/)
    expect(orchestrator).toMatch(/if \(ok\) \{\s*reloadOrdens\(\);\s*reloadDetail\(\);\s*reloadFinancial\(\);/)
    expect(orchestrator).toContain("registrarEntregaV3")
    expect(orchestrator).toContain("lancarOSAPrazoV3")
    expect(orchestrator).toContain("aprovarOrcamentoV3")
  });
});
