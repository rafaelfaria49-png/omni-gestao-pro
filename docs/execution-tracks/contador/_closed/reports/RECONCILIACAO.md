# Reconciliação de importação — trilha `contador`

- importação nº 8 · 2026-08-02T00:38:24.720Z
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- bootstrap_commit declarado: `d4817244c8d1f4fdabb2773e419e2910ac62658a`
- manifesto (proveniência): `docs/execution-tracks/contador/_closed/reports/IMPORT-8-MANIFEST.json`
- o diretório `import/` é gitignored; o manifesto bruto NÃO é commitado.

## 0. Delta desta importação (projeção last-wins por GOAL)

- delta: 1 NOVO · 0 ALTERADO · 15 INALTERADO
- linhas anexadas ao LEDGER.jsonl: 0 (o ledger é append-only; nada foi reescrito)
- `CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015` — **NOVO**: (inexistente) → READY · caminho quente, sem linha de ledger

### Deltas sensíveis

_(nenhum)_

### Órfãos preservados (estado vigente, ausentes do plano)

_(nenhum)_

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
- `CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN` → DONE · commit `7f4361e52437f68c21c9748db06238d9a4412e11` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 7f4361e52437f68c21c9748db06238d9a4412e11 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013` → DONE · commit `0ef448ce5f669b7b25b40245507da14da488cf84` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 0ef448ce5f669b7b25b40245507da14da488cf84 origin/main` → commit existe e está na branch declarada
- `CONTADOR-HUB-IDENTIDADE-CONVITE-014` → DONE · commit `858c1289116527fe0ac2d28bdc5d75e671e2a6f0` · branch `origin/main`
  - evidência: `git merge-base --is-ancestor 858c1289116527fe0ac2d28bdc5d75e671e2a6f0 origin/main` → commit existe e está na branch declarada

## 2. Divergentes (BLOCKED — nunca presumidos DONE)

_(nenhum)_

## 3. Pendentes de planejamento (DRAFT — fora de goals/)

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

_(nenhum)_

## 5. Superados (SUPERSEDED → _closed/goals/)

- `CONTADOR-HUB-STATUS-RECONCILE-001` — plan_rev 1 < 1
- `CONTADOR-HUB-DOCUMENTOS-REAL-010` — plan_rev 1 < 1
- `CONTADOR-HUB-FECHAMENTO-SNAPSHOT-012` — plan_rev 1 < 1

## 6. Caminho quente após a importação

- `CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015` → `docs/execution-tracks/contador/goals/CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015.md` (READY)
