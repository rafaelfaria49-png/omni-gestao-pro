# Reconciliação de importação — trilha `pdv`

- importação nº 4 · 2026-08-28T00:06:26.872Z
- plano: `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` (plan_rev 2)
- bootstrap_commit declarado: `2b223705a3a2d6982a50b2fbb1d025cedc8541d5`
- manifesto (proveniência): `docs/execution-tracks/pdv/_closed/reports/IMPORT-4-MANIFEST.json`
- o diretório `import/` é gitignored; o manifesto bruto NÃO é commitado.

## 0. Delta desta importação (projeção last-wins por GOAL)

- delta: 2 NOVO · 0 ALTERADO · 0 INALTERADO
- linhas anexadas ao LEDGER.jsonl: 1 (o ledger é append-only; nada foi reescrito)
- `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` — **NOVO**: (inexistente) → DONE
- `PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002` — **NOVO**: (inexistente) → READY · caminho quente, sem linha de ledger

### Deltas sensíveis

_(nenhum)_

### Órfãos preservados (estado vigente, ausentes do plano)

_(nenhum)_

## 1. Confirmados (DONE com prova no Git)

- `PDV-TROCAS-DEVOLUCOES-BUSCA-VALE-CREDITO-001` → DONE · commit `dc7e1e60a5acfbad7910a521e3872dda1f2f3e9e` · branch `goal/pdv-001-trocas-busca-vale-credito`
  - evidência: `git merge-base --is-ancestor dc7e1e60a5acfbad7910a521e3872dda1f2f3e9e goal/pdv-001-trocas-busca-vale-credito` → commit existe e está na branch declarada

## 2. Divergentes (BLOCKED — nunca presumidos DONE)

_(nenhum)_

## 3. Pendentes de planejamento (DRAFT — fora de goals/)

_(nenhum)_

## 4. Bloqueados por gate humano (BLOCKED — não executáveis)

_(nenhum)_

## 5. Superados (SUPERSEDED → _closed/goals/)

_(nenhum)_

## 6. Caminho quente após a importação

- `PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002` → `docs/execution-tracks/pdv/goals/PDV-TROCAS-VALE-HARDENING-PRE-PUBLISH-002.md` (READY)
