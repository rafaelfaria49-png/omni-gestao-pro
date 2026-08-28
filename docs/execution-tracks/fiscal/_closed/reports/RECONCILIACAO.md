# Reconciliação de importação — trilha `fiscal`

- importação nº 2 · 2026-08-28T03:36:02.349Z
- plano: `FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001` (plan_rev 1)
- bootstrap_commit declarado: `a3a2d3255d0fbd8309e3fdf21f510fde3bf73b70`
- manifesto (proveniência): `docs/execution-tracks/fiscal/_closed/reports/IMPORT-2-MANIFEST.json`
- o diretório `import/` é gitignored; o manifesto bruto NÃO é commitado.

## 0. Delta desta importação (projeção last-wins por GOAL)

- delta: 1 NOVO · 0 ALTERADO · 0 INALTERADO
- linhas anexadas ao LEDGER.jsonl: 0 (o ledger é append-only; nada foi reescrito)
- `FISCAL-NFCE-CONTINGENCY-020` — **NOVO**: (inexistente) → READY · caminho quente, sem linha de ledger

### Deltas sensíveis

_(nenhum)_

### Órfãos preservados (estado vigente, ausentes do plano)

- `FISCAL-NFCE-CANCELLATION-018` — mantém `DONE`; a importação NÃO remove estado em silêncio.
- `FISCAL-NFCE-INVALIDATION-019` — mantém `DONE`; a importação NÃO remove estado em silêncio.

## 1. Confirmados (DONE com prova no Git)

_(nenhum)_

## 2. Divergentes (BLOCKED — nunca presumidos DONE)

_(nenhum)_

## 3. Pendentes de planejamento (DRAFT — fora de goals/)

_(nenhum)_

## 4. Bloqueados por gate humano (BLOCKED — não executáveis)

_(nenhum)_

## 5. Superados (SUPERSEDED → _closed/goals/)

_(nenhum)_

## 6. Caminho quente após a importação

- `FISCAL-NFCE-CONTINGENCY-020` → `docs/execution-tracks/fiscal/goals/FISCAL-NFCE-CONTINGENCY-020.md` (READY)
