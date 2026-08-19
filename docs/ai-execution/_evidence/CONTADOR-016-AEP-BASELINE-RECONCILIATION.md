# CONTADOR-016 — baseline AEP em main (planejamento only)

Task: `CONTADOR-016-AEP-BASELINE-RECONCILIATION-003`
GOAL funcional: `CONTADOR-HUB-OBRIGACOES-GUIAS-016` (não fechado)

`SCHEMA_REDUCTION_RATIFIED=true`

Ratificação humana das reduções classe B: `responsavel`, `observacao` (coberto por `descricao`), `ContadorGuia.descricao`, `tipoInformado`, nomenclatura `informadoPor*` → `criadoPor*`. Nenhuma altera os critérios funcionais do GOAL 016. Schema/migration 0017 não entram neste commit.

## O que este commit faz

Materializa o goal-file 016 no caminho quente (`goals/`) a partir do charter já aprovado (import `4892c09d`, validado: READY, allowlist, `G-DADOS-SCHEMA`). Regenera `state.json` e `REGISTRY.md` com `node scripts/track.mjs registry`. Sem reexecutar o importador.

## GOAL 015 fechado

Arquivo `docs/execution-tracks/contador/_closed/goals/CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015.md` permanece byte-a-byte igual a `origin/main` pré-baseline.

- SHA-256: `82fd2d61643ecdcc11ac0607af4050b26601ccd87f5e65f4f115c866e6c04bc6`
- git blob: `9d9c3a231bf28790b3b5cdd816b9dfc30c4357d6`
- LEDGER do 015: intocado

`GOAL_015_CLOSED_ARTIFACT_PRESERVED=true`

## Débito de protocolo (follow-up — não corrigido aqui)

`AEP_IMPORT_CLOSED_GOAL_REWRITE_BUG=true`

`import` / `regenerar` / `goalDoc()` não deve reconstruir charter de `_closed/goals/` a partir de manifesto posterior. Este commit evita o importador; o fix global de `scripts/track.mjs` fica fora deste GOAL.

## Fora deste commit

Código funcional do 016, `prisma/**`, migration Production, deploy, close do GOAL 016.
