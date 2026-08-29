<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "PDV-VENDA-EM-ESPERA-RESTORE-001",
  "track": "pdv",
  "title": "Restaurar Venda em Espera nos três PDVs operacionais",
  "status": "READY",
  "class": "C3",
  "risk_tier": "ALTO",
  "branch": "goal/pdv-003-venda-em-espera-restore",
  "worktree": "C:/Projetos/omni-gestao",
  "test_command": "npx vitest run lib/pdv-hold.test.ts lib/pdv-assistencia-shortcuts.test.ts components/dashboard/vendas/pdv-assistencia-layout.test.ts",
  "allowlist": [
    "lib/pdv-hold.ts",
    "lib/pdv-hold.test.ts",
    "lib/pdv-keymap.ts",
    "components/dashboard/vendas/pdv-classic.tsx",
    "components/dashboard/vendas/pdv-supermercado.tsx",
    "components/dashboard/vendas/pdv-assistencia-enterprise.tsx",
    "components/dashboard/vendas/venda-espera-modal.tsx",
    "components/dashboard/vendas/pdv-omni-classic-shell.tsx",
    "docs/ai/CURRENT_STATUS.md",
    "CHANGELOG.md"
  ],
  "gates_liberados": [],
  "read_budget": 160,
  "plan_ref": "PDV-VENDA-EM-ESPERA-RESTORE-001",
  "plan_rev": 1,
  "familia_executor": "codex",
  "revisao_independente": true,
  "reversibilidade": "persistência local aditiva e reversível; nenhuma alteração de schema, transação de venda, estoque, financeiro, caixa, fiscal ou impressão",
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "Autorizo cadastrar/liberar o GOAL PDV-VENDA-EM-ESPERA-RESTORE-001 na trilha pdv e executar a restauração conforme o pedido desta sessão.",
      "registrado_por": "usuário nesta sessão",
      "em": "2026-08-29T00:00:00-03:00"
    }
  }
}
-->

# PDV-VENDA-EM-ESPERA-RESTORE-001 — Restaurar Venda em Espera

## Objetivo

Deixar plenamente operacional a Venda em Espera nos PDV Assistência, PDV Classic e
PDV Supermercado, reutilizando `lib/pdv-hold` e a persistência local existente.
Preservar integralmente o layout novo do PDV Assistência, a impressão térmica direta
e os fluxos de finalização, numeração, estoque, Financeiro, Caixa e Fiscal.

## Regras funcionais

- Localizar primeiro a infraestrutura existente e corrigir a causa da UI ausente ou
  inoperante; não criar sistema paralelo.
- Expor acesso visível e rápido, preferencialmente `Em espera (N)`, nos três PDVs.
- Permitir múltiplas vendas em espera quando compatível com o contrato local existente.
- Ao colocar em espera, salvar o carrinho e limpar o PDV atual para nova venda.
- Ao retomar, reconstruir o carrinho e o cliente e remover o hold somente depois de
  carregamento válido.
- Preservar itens, quantidades, preços, descontos, cliente, metadata,
  `accessorySelection`, modelo/cor, serviços e preço manual quando aplicável.
- Nunca sobrescrever silenciosamente um carrinho atual: oferecer colocar o atual em
  espera ou cancelar a retomada.
- Permitir descarte com confirmação; descarte não cria, cancela ou movimenta venda,
  estoque, Financeiro, Caixa ou Fiscal.
- Manter isolamento por `storeId` e, quando presente, `terminalId`.
- Validar reload entre hold e resume; não criar sincronização cloud/multiestação.

Durante hold devem permanecer falsos: `SALE_CREATED`, `STOCK_MOVED`,
`FINANCIAL_MOVED`, `CAIXA_MOVED` e `FISCAL_EMITTED`.

## Preservações obrigatórias

- PDV Assistência: grade 3x3, nove atalhos, carrinho largo, scroll, pagamentos 3x2,
  topo compacto, nomes longos e impressão direta.
- PDV Classic e Supermercado: comportamento operacional restaurado sem redesenho.
- Não alterar `finalizeSaleTransaction`, Writer V2, numeração server-side, estoque,
  Financeiro, Fiscal, schema/migrations ou o novo fluxo de impressão.

## Validação obrigatória

Cobrir hold/resume simples, múltiplos itens, quantidade maior que um, cliente e sem
cliente, accessorySelection/modelo/cor, serviço/preço manual quando aplicável,
reload, descarte, carrinho atual protegido, isolamento por loja, metadata, ausência
de criação/movimentação no hold e finalização retomada criando uma única venda real.

Executar os testes focados de `pdv-hold`, regressões relacionadas dos três PDVs,
typecheck, ESLint dos arquivos alterados, `git diff --check` e build. Validação visual
em navegador só deve ser declarada se realmente executada.

## Critério de pronto

Os três PDVs exibem e operam Venda em Espera com múltiplos holds, retomada íntegra,
reload, descarte, proteção do carrinho atual e isolamento por loja, sem efeitos
colaterais em venda real, estoque, Financeiro, Caixa ou Fiscal; todos os gates de
qualidade executados reportam resultado honesto.
