# Reconciliação de importação — trilha `contador`

- importação nº 1 · 2026-07-30T21:29:13.806Z
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- bootstrap_commit declarado: `d4817244c8d1f4fdabb2773e419e2910ac62658a`
- manifesto (proveniência): `docs/execution-tracks/contador/_closed/reports/IMPORT-1-MANIFEST.json`
- o diretório `import/` é gitignored; o manifesto bruto NÃO é commitado.

## 1. Confirmados (DONE com prova no Git)

- `CONTADOR-HUB-HONESTY-ROUTE-SAFETY-002` → DONE · commit `7310d9e69ede8981eabca39aff87c9cc3024ab1a` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 7310d9e69ede8981eabca39aff87c9cc3024ab1a origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-P0-AUTH-EXTERNA-003` → DONE · commit `a23c0f8aefa5147ad183f2c8a2d1b688a3b66dd6` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor a23c0f8aefa5147ad183f2c8a2d1b688a3b66dd6 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-P0-STORE-SCOPE-004` → DONE · commit `066e9f2324f8889c169f3b01b723732214b6b54c` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 066e9f2324f8889c169f3b01b723732214b6b54c origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-COMPETENCIA-CONTRATOS-005` → DONE · commit `50c1db823215a36622b05fad759ea80357130f24` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 50c1db823215a36622b05fad759ea80357130f24 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-DADOS-REAIS-READONLY-006` → DONE · commit `4f901968365efc0cded6d9a2e348b9f381c1d0c4` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 4f901968365efc0cded6d9a2e348b9f381c1d0c4 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-FECHAMENTO-READONLY-007` → DONE · commit `7217acbf378e618c4d6409500f8467038f6922f8` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 7217acbf378e618c4d6409500f8467038f6922f8 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-PACOTE-EXPORT-MVP-008` → DONE · commit `ab0b754e8b605b2d220be3f6610403bdcc483e0a` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor ab0b754e8b605b2d220be3f6610403bdcc483e0a origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-SCHEMA-NUCLEO-009` → DONE · commit `2d808c442428f41bc1417917421ac8b6c29ab6e6` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 2d808c442428f41bc1417917421ac8b6c29ab6e6 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-STATUS-COMENTARIOS-011` → DONE · commit `1f1190a078ea54e2092da02ce844856f380ec11c` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 1f1190a078ea54e2092da02ce844856f380ec11c origin/main` → commit existe e está na branch declarada

## 2. Divergentes (BLOCKED — nunca presumidos DONE)

- `CONTADOR-HUB-STATUS-RECONCILE-001` → BLOCKED (`divergencia`) · DONE sem prova no Git
  - evidência: `git merge-base --is-ancestor f56039918fb34a45e7f7790e861f0d871832469b origin/main` → exit 1 — commit fora da branch declarada

## 3. Pendentes de planejamento (DRAFT — fora de goals/)

- `CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-IDENTIDADE-CONVITE-014` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-OBRIGACOES-GUIAS-016` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-FISCAL-INTEGRATION-018` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.
- `CONTADOR-HUB-PRODUCTION-HARDENING-019` → DRAFT · no plano (`plano_ids`) e não declarado no manifesto
  - planejamento futuro: não exige commit, branch nem prova no Git.
  - fora do caminho quente, fora do ledger e NÃO elegível para `open`.

## 4. Bloqueados por gate humano (BLOCKED — não executáveis)

- `CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN` → BLOCKED (`gate`) · gate humano exigido pelo manifesto; nenhuma evidência de aprovação registrada
  - decisão humana requerida: `HUMAN_PUSH_AUTHORIZATION_NOT_SENT`
  - ausência de aprovação NÃO libera o GOAL — exige evidência explícita registrada pelo fluxo oficial do AEP.

## 5. Superados (SUPERSEDED → _closed/goals/)

- `CONTADOR-HUB-DOCUMENTOS-REAL-010` — plan_rev 1 < 1
- `CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012` — plan_rev 1 < 1

## 6. Caminho quente após a importação

_(vazio)_
