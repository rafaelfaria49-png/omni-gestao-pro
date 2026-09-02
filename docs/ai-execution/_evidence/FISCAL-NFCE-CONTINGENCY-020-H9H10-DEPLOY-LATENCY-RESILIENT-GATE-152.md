# FISCAL-NFCE-CONTINGENCY-020 — Gate H-9/H-10 resiliente à latência de deploy (152)

Trilha `fiscal` · GOAL 020 (continuação) · 2026-09-02.
Configuração versionada permanece **DORMENTE** `{null, null, null}`.
ZERO rede SEFAZ · ZERO activation real · ZERO Production ON.

## Problema

A janela absoluta curta (teto 15 min, uso típico 10 min) absorvia ao mesmo tempo
checks/merge/build/deploy, espera humana e a única invocation de rede. A tentativa
21:27→21:37Z abortou corretamente: Production ainda Building com 7,9 min restantes.

## Desenho

| Camada | Papel | Teto |
|---|---|---|
| Janela externa (`activationId` / `notBeforeUtc` / `expiresAtUtc`) | Elegibilidade da única invocation (arming) | `WSDL_EXECUTION_MAX_WINDOW_MS` = 45 min |
| Lease interna de rede | Rede GET após consumo one-shot persistido | `min(consumedAt + 10 min, expiresAtUtc)` |

- Lease começa no `consumedAt`, não no deploy/`notBefore`.
- Sem `WSDL_EXECUTION_MIN_LEASE_MS` (2 min) restantes até o deadline externo, o consumo falha **antes** de persistir e **antes** de qualquer socket.
- Binding privado carrega `consumedAtMs` + `leaseExpiresAtMs`.
- `consumeWsdlTargetExecutionPermit` e `wsdlExecutionActivationStillActive` revalidam a lease interna.
- One-shot, advisory lock, `dedupeKey` global, 6 alvos, um permit por alvo, `tentativas=1`, zero retry: preservados.
- Superfície Production-only / ADMIN / HOMOLOGACAO-SP / GET-only / TLS ≥ 1.2 / `rejectUnauthorized=true` / destinos canônicos / A1 por refs opacas: intocada.

## Validação

- Testes focados da janela + superfície canônica + rota: **92 pass**.
- `git diff --check` e ESLint focado nos arquivos do gate.
- Typecheck do repositório (`npm run typecheck`).
- Nenhuma chamada `fetch` nos testes do gate; nenhum socket externo.

## Estado após este GOAL

- `WSDL_EPHEMERAL_EXECUTION_WINDOW = {null,null,null}`
- GOAL 020 RUNNING · GOAL 021 não iniciado
- Human gate H-9/H-10 **não** aberto
- `READY_FOR_H9H10_RESILIENT_GATE=true`
