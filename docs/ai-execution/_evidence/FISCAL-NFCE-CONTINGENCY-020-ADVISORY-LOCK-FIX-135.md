# FISCAL-NFCE-CONTINGENCY-020 — Advisory lock fix + prova PostgreSQL real (135)

Trilha `fiscal` · GOAL 020 (continuação) · FISCAL-020-H9H10-ADVISORY-LOCK-FIX-135.
Data: 2026-08-30 · Zero rede externa · Zero escrita em banco (transações do teste terminam em
rollback intencional; nenhum write persistente em nenhum ambiente).

## BASE / escopo

- `origin/main = 940b4beade51f62d0b6c78f565bf9623f5142a3a` (pós-containment 134)
- Branch oficial `goal/fiscal-020-contingency-offline-nfce` em `bb60b75`
  (inclui a evidência 134 — relatório da execução única 409 — sem reescrita de história)
- A PR conterá: evidência 134 + fix mínimo + teste regressivo PostgreSQL real.

## Fix (mínimo, semântica preservada)

`lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts`:

- ANTES: ``await scoped.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))```
  → coluna `void` ⇒ **P2010** determinístico na primeira instrução da transação (causa raiz
  do 409 `activation_unavailable` da execução 134; rollback sem write — activation NÃO consumida).
- DEPOIS: novo helper exportado `wsdlActivationAdvisoryLock(runQuery, dedupeKey)` com
  ``runQuery`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))::text AS lock` ``;
  `lockActivationScope` passa a chamá-lo com o `$queryRaw` da transação (bound).

Inalterado (verificado por diff): dedupeKey (`fiscal:wsdl:h9-h10:v1:<sha256(activationId)>`),
escopo do advisory lock, ordem da transação (lock é a PRIMEIRA instrução, antes do findFirst
cross-store e do create), one-shot global, pilot resolver, regra `fiscalEnabled=false`,
superfície HTTP, 6 targets, timeouts, A1, containment. Janela permanece `{null, null, null}`;
a activation `wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d` segue histórica/proibida (teste de
dormência). Nenhuma migration; nenhum schema novo.

## Prova contra PostgreSQL REAL (não-produtivo)

Novo `wsdl-advisory-lock.postgres.test.ts` — mesma convenção da integração DB existente
(env-gated; **pulada no CI sem banco**; recusa o dbname `omnigestao_prod` exato; roda somente
queries de lock/select; transações terminam em rollback — zero persistência). URL de teste
fornecida por env apontando para o banco não-produtivo já configurado (`prod_candidate`),
nunca impressa.

Resultado contra PostgreSQL real: **3/3**

1. expressão ANTIGA reproduz **P2010** isoladamente (além da reprodução já obtida na execução 134);
2. expressão NOVA roda via Prisma sem erro de desserialização;
3. lock transacional: transação A segurando a chave faz `pg_try_advisory_xact_lock` da MESMA
   dedupeKey falhar em outra conexão (serialização de concorrentes); chave DIFERENTE continua
   isolada (B toma a sua); após rollback de A a chave volta a ficar disponível.

## Validações

- vitest wsdl + rota + contingência + homologation (+ postgres real com env): **250 passed,
  3 skipped** (skip = suíte DB no CI sem env, por desenho)
- typecheck (`tsc --noEmit`): OK
- ESLint focado (módulo + teste novo): OK
- `npm run build`: OK (compiled successfully)
- `git diff --check`: OK
- WSDL_EXTERNAL_GET_COUNT=0 · SEFAZ_REQUEST_COUNT=0
- WINDOW_STATE durante todo o GOAL: `{null, null, null}`

## Revisão independente (read-only, outra família)

Veredito real: **APROVADO** · **P0=0 · P1=0** · P2=4 (informativos; 1 aplicado).

Focos confirmados pelo revisor: (1) cast `::text` não altera a semântica da lock function nem
o escopo transacional (mesma `pg_advisory_xact_lock(hashtext(...))`, cast só no resultado);
(2) lock permanece a PRIMEIRA instrução, antes do findFirst cross-store e do create; (3) suíte
postgres CI-safe (skip sem env), recusa dbname `omnigestao_prod` exato, zero escrita
persistente (rollback intencional); (4) `.bind(scoped)` é o padrão canônico do Prisma para
`$queryRaw` em transação; (5) zero segredo nos diffs (só nomes de env); (6) evidências coerentes
com o diff; (7) testes emulados do one-shot intactos (global cross-store, cold start,
concorrência, zero/múltiplas pilots, janela dormente, activation 30/08 proibida).

P2 registrados: (01) fix/teste/docs precisavam ser commitados antes da PR — **corrigido**
(commit por caminho explícito); (02) timeout explícito na transação do teste — **corrigido**
(`timeout: 15_000`); (03) gate de segurança cobre o dbname canônico exato — aceitável (a
candidate deve passar; env fornecida por humano); (04) esta evidência pré-registrava o
veredito — o veredito real coincidiu e esta seção foi reescrita com o resultado efetivo.
