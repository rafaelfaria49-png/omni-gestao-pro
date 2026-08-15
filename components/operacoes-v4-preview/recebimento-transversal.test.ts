import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(dir, relative), "utf8");

describe("OPS-V4-RECEBIMENTO-TRANSVERSAL-005 — shell UX do motor V3", () => {
  const financeiro = source("parts/stages/FinanceiroStage.tsx");
  const receber = source("parts/ReceberPagamentoV4.tsx");
  const entrega = source("parts/stages/EntregaStage.tsx");
  const orchestrator = source("use-v4-preview.ts");
  const viewModel = readFileSync(join(dir, "..", "..", "lib", "operacoes-v4", "financeiro-v4.ts"), "utf8");
  const form = readFileSync(join(dir, "..", "..", "lib", "operacoes-v4", "receber-pagamento-form.ts"), "utf8");

  it("não cria motor financeiro V4 paralelo", () => {
    for (const blob of [financeiro, receber, entrega, orchestrator, viewModel, form]) {
      expect(blob).not.toContain("receberOSV4");
      expect(blob).not.toContain("V4Payment");
      expect(blob).not.toContain("V4Receivable");
      expect(blob).not.toContain("V4CashTransaction");
      expect(blob).not.toContain("finalizeSaleTransaction");
      expect(blob).not.toContain("openCaixaIfClosed");
    }
  });

  it("header e stage compartilham o mesmo view-model", () => {
    expect(orchestrator).toContain("montarResumoFinanceiroOSV4");
    expect(orchestrator).toContain("financeiroResumo");
    expect(financeiro).toContain("v.financeiroResumo");
    expect(viewModel).toContain("export function montarResumoFinanceiroOSV4");
  });

  it("Entrega abre a mesma superfície de recebimento", () => {
    expect(entrega).toContain("Pagamento pendente");
    expect(entrega).toContain("v.openReceberPagamento");
    expect(entrega).not.toContain("receberOSV3");
  });

  it("recebimento imediato continua no contrato receberOSV3 via hook, sem optimistic de valor", () => {
    expect(receber).toContain("pdv.receber({");
    expect(receber).toContain("pdv.recebendo");
    expect(receber).not.toContain("setOptimistic");
    expect(orchestrator).toMatch(/if \(ok\) \{\s*reloadOrdens\(\);\s*reloadDetail\(\);\s*reloadFinancial\(\);/);
  });

  it("não inventa troco no backend — V3 de OS não tem contrato de troco", () => {
    expect(receber).not.toMatch(/\btroco\b/i);
    expect(form).not.toMatch(/\btroco\b/i);
    expect(viewModel).not.toMatch(/\btroco\b/i);
  });

  it("caixa fechado não abre sessão e aponta para o PDV existente", () => {
    expect(receber).toContain("Caixa fechado");
    expect(receber).toContain("Abra uma sessão de caixa antes de receber este pagamento.");
    expect(receber).toContain('href="/dashboard/vendas"');
    expect(receber).not.toContain("openCaixaIfClosed");
  });

  it("sheet de recebimento sai da etapa (portal) e fica acima das rails dockadas", () => {
    expect(receber).toContain("createPortal");
    expect(receber).toContain("document.body");
    const css = source("parts/receber-pagamento.module.css");
    expect(css).toContain("z-index: 90");
    expect(css).toContain(".footer");
    expect(css).toMatch(/@media \(max-width: 1366px\)/);
  });

  it("19–35. submit usa receberOSV3 via hook, sem optimistic e com reload só no sucesso", () => {
    expect(receber).toMatch(/pdv\.receber\(\{\s*linhas:\s*linhasValidas,/);
    expect(receber).toContain("pdv.recebendo");
    expect(receber).toContain("if (!podeConfirmar || !pdv.sessao?.sessaoId || pdv.recebendo) return");
    expect(orchestrator).toContain("receberOSV3");
    expect(orchestrator).toMatch(/if \(ok\) \{\s*reloadOrdens\(\);\s*reloadDetail\(\);\s*reloadFinancial\(\);/);
    expect(orchestrator).not.toContain("setOptimistic");
  });
});
