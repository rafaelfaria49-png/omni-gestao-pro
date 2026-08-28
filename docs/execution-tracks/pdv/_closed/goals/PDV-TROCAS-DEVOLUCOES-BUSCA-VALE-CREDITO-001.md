<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001",
  "track": "pdv",
  "title": "Busca de vendas por item/produto + vale-troca real + crédito/vale no pagamento",
  "status": "DONE",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/pdv-001-trocas-busca-vale-credito",
  "worktree": "<PREENCHER>",
  "test_command": "npx vitest run app/api/vendas/historico/route.test.ts app/api/ops/devolucao/route.test.ts app/api/ops/credito-cliente/route.test.ts lib/ops-upsert-venda-vale-concorrencia.test.ts lib/ops-upsert-venda-vale.test.ts lib/ops-upsert-venda.test.ts lib/ops-upsert-venda-safety.test.ts app/api/vendas/[id]/cancelar/route.test.ts lib/pdv-payments.test.ts lib/caixa-fechamento-resumo.test.ts",
  "allowlist": [
    "app/api/vendas/**",
    "lib/vendas/historico-busca.ts",
    "app/api/ops/devolucao/route.ts",
    "app/api/ops/devolucao/route.test.ts",
    "app/api/ops/credito-cliente/route.ts",
    "app/api/ops/credito-cliente/route.test.ts",
    "lib/ops-upsert-venda.ts",
    "app/api/ops/venda-persist/route.ts",
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
  "plan_rev": 2,
  "familia_executor": null,
  "revisao_independente": false,
  "reversibilidade": null
}
-->

# PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001 — Busca de vendas por item/produto + vale-troca real + crédito/vale no pagamento

- trilha: `pdv`
- classe: C2 · status: DONE
- plano: `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` (plan_rev 2)
- branch: `goal/pdv-001-trocas-busca-vale-credito`
- teste: `npx vitest run app/api/vendas/historico/route.test.ts app/api/ops/devolucao/route.test.ts app/api/ops/credito-cliente/route.test.ts lib/ops-upsert-venda-vale-concorrencia.test.ts lib/ops-upsert-venda-vale.test.ts lib/ops-upsert-venda.test.ts lib/ops-upsert-venda-safety.test.ts app/api/vendas/[id]/cancelar/route.test.ts lib/pdv-payments.test.ts lib/caixa-fechamento-resumo.test.ts`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `GOAL 001`: `import/pdv/PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001.md`
- `GOAL 002`: `import/pdv/PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002.md`

## Allowlist

- `app/api/vendas/**`
- `lib/vendas/historico-busca.ts`
- `app/api/ops/devolucao/route.ts`
- `app/api/ops/devolucao/route.test.ts`
- `app/api/ops/credito-cliente/route.ts`
- `app/api/ops/credito-cliente/route.test.ts`
- `lib/ops-upsert-venda.ts`
- `app/api/ops/venda-persist/route.ts`
- `lib/ops-upsert-venda-vale-concorrencia.test.ts`
- `lib/ops-upsert-venda-vale.test.ts`
- `lib/ops-upsert-venda-replay-conflict.test.ts`
- `lib/operations-store.tsx`
- `components/dashboard/vendas/payment-modal.tsx`
- `components/dashboard/vendas/pdv-classic.tsx`
- `components/dashboard/vendas/vendas-arquivo-geral.tsx`
- `e2e/specs/06-pdv-caixa-historico.spec.ts`

## Proveniência

- importado de `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` em 2026-08-28T00:06:26.872Z
- commit confirmado: `dc7e1e60a5acfbad7910a521e3872dda1f2f3e9e` na branch `goal/pdv-001-trocas-busca-vale-credito`
- evidência: `git merge-base --is-ancestor dc7e1e60a5acfbad7910a521e3872dda1f2f3e9e goal/pdv-001-trocas-busca-vale-credito` → commit existe e está na branch declarada
