# CONTADOR-017 — baseline AEP em main (planejamento only)

Task: `CONTADOR-017-AEP-BASELINE-RECONCILIATION-001`
GOAL funcional: `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017` (não fechado)

`CHANNEL_CLASSIFICATION=B`
`EXTERNAL_SEND_ALLOWED=false`
`SCHEMA_REQUIRED=false`

PR #83 (`6be3fcb9`) integrou o Passo 0 docs-only:
`docs/contador/CONTADOR_HUB_OMNI_AGENT_CHANNEL_AUDIT_017.md`.

## O que este commit faz

Materializa o goal-file 017 no caminho quente (`goals/`) a partir do charter
aprovado (allowlist funcional do comando humano + tradução AEP-legal do glob
`notificacoes*.test.ts` → `lib/contador/__tests__/notificacoes/**`).
Regenera `state.json` e `REGISTRY.md` com `node scripts/track.mjs registry`.
Sem reexecutar o importador.

## GOALs fechados

Arquivos em `docs/execution-tracks/contador/_closed/goals/` permanecem
byte-a-byte iguais a `origin/main` pré-baseline (`6be3fcb9`).

`GOAL_CLOSED_ARTIFACTS_PRESERVED=true`

## Débito de protocolo (follow-up — não corrigido aqui)

`AEP_IMPORT_CLOSED_GOAL_REWRITE_BUG=true`

`import` / `regenerar` / `goalDoc()` não deve reconstruir charter de
`_closed/goals/` a partir de manifesto posterior. Este commit evita o
importador; o fix global de `scripts/track.mjs` fica fora deste GOAL.

## Fora deste commit

Código funcional do 017, schema/migration, Omni Agent, WhatsApp, envio
externo, close do GOAL 017, merge da feature em main.
