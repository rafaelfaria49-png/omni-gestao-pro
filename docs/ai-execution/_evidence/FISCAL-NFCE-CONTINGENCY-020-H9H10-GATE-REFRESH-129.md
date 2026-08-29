# FISCAL-NFCE-CONTINGENCY-020 — H-9/H-10 gate refresh (129)

Trilha `fiscal` · GOAL 020 (continuação) · refresh do gate efêmero H-9/H-10.

- Branch: `goal/fiscal-020-contingency-offline-nfce` (worktree oficial do GOAL 020)
- BASE: `c5398b6a3e1bde44f8ad01715e5c8337a7decdc6` + merge de origin/main `64bef549fa311e3231ce390fd131fdba0c1c0d67`
- Drift absorvido: apenas PDV Assistência / impressão térmica / `.vercelignore` — nenhum caminho fiscal

## Auditoria pré-edição (confirmada por leitura)

1. `WSDL_EXECUTION_PILOT_STORE_ID = "loja-1"` — `wsdl-ephemeral-execution-window.ts` ✓
2. consumo dependente do literal — `consumeActivation`, permits e rota ✓
3. rota exigia `fiscalEnabled=false` — `route.ts` preflight ✓
4. janela expirada 24/08 (`wsdl-h9h10-20260824-1800z-8cd1649df764940e`) na constante ✓
5. superfície canônica Production-only (`wsdl-canonical-production-surface.ts`) ✓
6. batch exatamente 6 GETs (`WSDL_EXECUTION_EXPECTED_TARGETS=6`, `closedTargets`) ✓
7. URL/host/path derivados só do catálogo (`wsdl-acquisition-target.ts`) ✓
8. A1 só por refs opacas (`blobRef`/`senhaRef`; material descartado pós-SecureContext) ✓
9. nenhum POST SOAP/emissão alcançável pela superfície WSDL (GET fixo, sem envelope) ✓

## Mudanças

- **Pilot store**: novo `wsdl-pilot-store-resolver.ts` — resolução dinâmica de
  `ConfiguracaoFiscalLoja` (HOMOLOGACAO + NFCE + SEFAZ_DIRETO + `certificadoAtivoId` válido;
  exatamente UMA candidata; zero → bloqueia; >1 → bloqueia e exige decisão humana; erro de
  leitura → bloqueia). Literal `"loja-1"` removido do código produtivo. Rota e gate consomem o
  resolver; request autenticada deve pertencer exatamente à candidata resolvida.
- **One-shot global**: preservado sem schema/migration sobre `FiscalEmissaoJob
  @@unique([storeId, dedupeKey])`: transação de consumo toma `pg_advisory_xact_lock(hashtext(dedupeKey))`
  e recusa se QUALQUER loja já consumiu a mesma activation (`findFirst` por `dedupeKey` sem
  escopo de loja). Coberto por teste de troca de piloto dentro da janela, concorrência e cold start.
- **fiscalEnabled**: decisão documentada (doc gate 019 + docstrings) — preflight agora exige
  `fiscalEnabled=true` (a piloto é a loja operacional do pipeline 020 em HOMOLOGACAO); o antigo
  `false` era proxy de fase sem pipeline. Nenhuma emissão/transmissão é habilitada: superfície
  segue GET de metadados, sem corpo, sem SOAP, alvos fechados do catálogo.
- **Janela**: constante restaurada a `null/null/null` (dormente). Ativação 24/08 é evidência
  histórica; nenhuma nova `activationId` criada neste GOAL.
- **Superfície preservada**: Production-only canônico, ADMIN fiscal, request sem body, sem
  URL/host/porta/path do caller, GET fixo, ≤6 alvos, HOMOLOGACAO/SP, TLS ≥ 1.2, zero redirect,
  timeout/body bounds, A1 via cofre, one-shot persistente, containment por deployment.

## Prova de não-rede

Todos os testes usam transporte capturado/loopback sintético ou seams injetados; nenhuma chamada
WSDL, DNS, TLS ou SEFAZ foi executada neste GOAL.

- WSDL_EXTERNAL_GET_COUNT=0
- SEFAZ_REQUEST_COUNT=0

Asserts de teste: `fetch` spy não chamado (janela/resolver) e seams de `acquire` injetados
(batch); rota dormente responde 404 antes de qualquer dependência.

## Validações

- vitest `lib/fiscal/provider/sefaz/wsdl` + `app/api/fiscal/wsdl` + homologation: 173/173
- vitest `lib/fiscal/contingencia` + `app/api/fiscal/contingencia` + certificate + provider: 662/662
- typecheck (`tsc --noEmit`, 4 GB): OK
- ESLint focado (wsdl lib + rota): OK
- `npm run build`: OK
- `git diff --check`: OK
