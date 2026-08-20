# CONTADOR-HUB-FISCAL-INTEGRATION-018 — evidência de implementação

- trilha: `contador`
- goal: `CONTADOR-HUB-FISCAL-INTEGRATION-018`
- branch: `cursor/contador-fiscal-integration-018-47d9`
- base_main: `0f2431c20c4c48f5df2d157552c3d199ddb885f9`
- data: 2026-08-20

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
FISCAL_RUNTIME_VALIDATABLE=true
PRODUCTION_XML_ELIGIBLE=false
SEFAZ_NETWORK_USED=false
SCHEMA_CHANGED=false
GOAL_018_IMPORTED=true
GOAL_018_OPENED=true
FLAG_DEFAULT_OFF=true
STORE_ALLOWLIST_REQUIRED=true
DELIVERABLE_XML_COUNT=1
REJECTED_COUNT=1
CANCELLED_COUNT=1
FISCAL_LOG_COUNT_AFTER=0
EVENTO_FISCAL_COUNT_AFTER=0
PACKAGE_LIMIT_BEHAVIOR=PacoteLimiteExcedidoError sem truncar (MAX_ARQUIVOS_PACOTE=15)
```

## Runtime

DSN exclusivo: `CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL` (Postgres nativo `127.0.0.1:5432`, db `omni_contador_fiscal_homolog`, role `omni_homolog`). Docker ausente neste ambiente; fallback nativo do `ensure-local-postgres.sh`. Sem Production. Sem SEFAZ.

Fluxo: Prisma → reader A → predicado ADR-007 → checklist → builder → manifest/hash → `05-XML`.

Caso feliz: 1 AUTORIZADA/HOMOLOGACAO entregável (`nota-homolog-ok`). XML do ZIP == texto UTF-8 persistido. sha256 do manifesto confere.

## Validações

- `npm run contador:fiscal-homolog:test` — 3 files, 22 passed
- testes focados reader/checklist/pacote/honesty/montar-checklist/pacote.test — 6 files, 162 passed
- `npm run typecheck` — exit 0
- eslint dos arquivos alterados — exit 0
- `git diff --check` — exit 0
- `npm run build` — exit 0 (rota `/dashboard/contador` + UI)

## Fechamento

- revisão independente: **A (aprovada)** — `dhEmi` fail-closed, reader A, homologação B.
- PR **#97** mergeado em `main` (merge commit, sem squash/rebase/force): `870ed54841f42f42dbabe37268c3dd6e9e6708e7`.
- gate final na main reconciliada (`5e8331f`): testes focados 9 arquivos / 283 testes verdes · `npm run typecheck` exit 0 · `git diff --check` exit 0 · CI Vercel 3/3 verdes.
- `npm run contador:fiscal-homolog:test` nesta máquina: 18 passed, 4 skipped — a suíte de integração exige `CONTADOR_FISCAL_HOMOLOGATION_DATABASE_URL`, ausente aqui. A prova runtime (3 arquivos / 22 testes) permanece a registrada acima, no mesmo HEAD homologado; nenhum arquivo funcional mudou depois dela.
- ratificação AEP: GOAL 018 → **DONE** · trilha `contador` **PAUSED** · `current_goal=null` · `last_result=DONE`.
- GOAL 019 **não aberto** (`GOAL_019_OPENED=false`).
