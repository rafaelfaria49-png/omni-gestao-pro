# CONTADOR-016 — integridade do GOAL 015 fechado após import do 016

GOAL aberto: `CONTADOR-HUB-OBRIGACOES-GUIAS-016`
Task: `CONTADOR-016-INDEPENDENT-REVIEW-FIXES-002`

`AEP_CLOSED_GOAL_015_INTEGRITY_BLOCKER=true`
`AEP_015_HISTORY_PRESERVED=false`

## Fato

`origin/main` (`789c791327decd031fcbf2b185199762ea8b5489`):

- `docs/execution-tracks/contador/state.json` — `last_goal` 015 / `last_result` DONE.
- `docs/execution-tracks/contador/_closed/goals/CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015.md` — metadata **READY**, allowlist histórica (`app/contador-externo/**`, `proxy.ts`, …), branch de recovery, critério de pronto histórico.

Commit de import desta branch:

- `4892c09d` `aep(contador): import 11 (plan_rev 1)`
- reescreve o artefato fechado 015 para status **DONE**, troca allowlist/branch/worktree e remove o critério de pronto histórico, substituindo por «Proveniência» gerada.

## Causa (scripts/track.mjs)

O `import` confirma GOALs DONE no manifesto e chama `regenerar(_closed/goals/<id>.md, goalDoc(...))`.

`goalDoc()` (scripts/track.mjs) **regenera o markdown inteiro** a partir do metadata atual do manifesto + bloco de proveniência. Não preserva charter, allowlist de execução, recovery notes nem critério de pronto históricos.

Isso não é edição manual de `state.json` / ledger / goal fechado. É o importador oficial.

## O que este GOAL não pode fazer

- Editar `state.json`, `LEDGER.jsonl`, `REGISTRY.md` ou `_closed/goals/` à mão — proibido.
- Restaurar o arquivo 015 com `git checkout origin/main -- <path>` — escreveria fora da allowlist do GOAL 016; `track.mjs check` item 6 recusaria.
- Alterar `scripts/track.mjs` para deixar de reescrever charters fechados — correção de protocolo, fora deste GOAL.

## Resultado

- Status DONE no artefato da branch é coerente com `state.json` da main.
- O charter histórico do 015 **não** permanece íntegro nesta branch.
- O import do 016 reescreveu o fechado 015 de forma destrutiva via `goalDoc`/`regenerar`.
- Não há procedimento AEP permitido **dentro da allowlist do 016** para excluir essa mutação do conjunto publicável sem nova autorização humana (ampliar allowlist ou consertar o importador).

A mutação permanece no commit de import `4892c09d`. Merge de `origin/main` não a reverte: a main não alterou esse arquivo nos 3 commits novos.

## Reconciliação (CONTADOR-016-AEP-BASELINE-RECONCILIATION-003)

Autorização humana: commit AEP/docs-only em `origin/main` + restaurar o fechado 015 **a partir de origin/main** (fonte exata), sem reescrever o texto.

- Baseline: `4d030593` `aep(contador): baseline do GOAL 016 preservando histórico fechado`
- SHA-256 do 015 (main e branch, após restore): `82fd2d61643ecdcc11ac0607af4050b26601ccd87f5e65f4f115c866e6c04bc6`
- `GOAL_015_CLOSED_ARTIFACT_PRESERVED=true`
- `AEP_IMPORT_CLOSED_GOAL_REWRITE_BUG=true` (follow-up; `track.mjs` não foi alterado)

