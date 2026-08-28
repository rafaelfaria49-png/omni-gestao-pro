<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001",
  "track": "pdv",
  "title": "Busca de vendas por item/produto + vale-troca real + crédito/vale no pagamento",
  "status": "READY",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/pdv-001-trocas-busca-vale-credito",
  "worktree": "C:/Projetos/omni-gestao",
  "test_command": "npx vitest run app/api/vendas/historico/route.test.ts app/api/ops/devolucao/route.test.ts app/api/ops/credito-cliente/route.test.ts lib/ops-upsert-venda-vale-concorrencia.test.ts lib/ops-upsert-venda-vale.test.ts lib/ops-upsert-venda.test.ts lib/ops-upsert-venda-safety.test.ts lib/pdv-payments.test.ts lib/caixa-fechamento-resumo.test.ts",
  "allowlist": [
    "app/api/vendas/historico/route.ts",
    "app/api/vendas/historico/route.test.ts",
    "lib/vendas/historico-busca.ts",
    "app/api/ops/devolucao/route.ts",
    "app/api/ops/devolucao/route.test.ts",
    "app/api/ops/credito-cliente/route.ts",
    "app/api/ops/credito-cliente/route.test.ts",
    "lib/ops-upsert-venda.ts",
    "lib/ops-upsert-venda-vale-concorrencia.test.ts",
    "lib/ops-upsert-venda-vale.test.ts",
    "lib/ops-upsert-venda-replay-conflict.test.ts",
    "lib/operations-store.tsx",
    "components/dashboard/vendas/payment-modal.tsx",
    "components/dashboard/vendas/pdv-classic.tsx",
    "components/dashboard/vendas/vendas-arquivo-geral.tsx",
    "e2e/specs/06-pdv-caixa-historico.spec.ts"
  ],
  "gates_liberados": [],
  "read_budget": 40,
  "plan_ref": "PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001",
  "plan_rev": 1,
  "familia_executor": null,
  "revisao_independente": false,
  "reversibilidade": null
}
-->

# PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001 — Busca de vendas por item/produto + vale-troca real + crédito/vale no pagamento

- trilha: `pdv`
- classe: C2 · status: READY
- plano: `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` (plan_rev 1)
- branch: `goal/pdv-001-trocas-busca-vale-credito`
- teste: `npx vitest run app/api/vendas/historico/route.test.ts app/api/ops/devolucao/route.test.ts app/api/ops/credito-cliente/route.test.ts lib/ops-upsert-venda-vale-concorrencia.test.ts lib/ops-upsert-venda-vale.test.ts lib/ops-upsert-venda.test.ts lib/ops-upsert-venda-safety.test.ts lib/pdv-payments.test.ts lib/caixa-fechamento-resumo.test.ts`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `GOAL`: `import/pdv/PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001.md`

## Allowlist

- `app/api/vendas/historico/route.ts`
- `app/api/vendas/historico/route.test.ts`
- `lib/vendas/historico-busca.ts`
- `app/api/ops/devolucao/route.ts`
- `app/api/ops/devolucao/route.test.ts`
- `app/api/ops/credito-cliente/route.ts`
- `app/api/ops/credito-cliente/route.test.ts`
- `lib/ops-upsert-venda.ts`
- `lib/ops-upsert-venda-vale-concorrencia.test.ts`
- `lib/ops-upsert-venda-vale.test.ts`
- `lib/ops-upsert-venda-replay-conflict.test.ts`
- `lib/operations-store.tsx`
- `components/dashboard/vendas/payment-modal.tsx`
- `components/dashboard/vendas/pdv-classic.tsx`
- `components/dashboard/vendas/vendas-arquivo-geral.tsx`
- `e2e/specs/06-pdv-caixa-historico.spec.ts`

## Critério de pronto

- <PREENCHER>
