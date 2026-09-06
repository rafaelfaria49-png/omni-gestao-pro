# FISCAL-020-H9H10-FINAL-REARM-172

Arme da janela FINAL de H9/H10 para validar em homologação o fix multi-op de NFeAutorizacao4 já publicado (#166).

## Base confirmada

- `ORIGIN_MAIN_BASE=c64f1372dbebe7335ba94994b48120961876511e` (PR #166 MERGED).
- `NFE_AUTORIZACAO4_MULTI_OP_FIX_PRESENT=true` (`expectedOperationName = "nfeAutorizacaoLote"`).
- UTC obtido no início da materialização: `2026-09-06T14:45:25.887Z` (11:45:25 BRT).

## Arming

- `ACTIVATION_ID=wsdl-h9h10-20260906-1520z-eb237492a9c8eb17`.
- `NOT_BEFORE_UTC=2026-09-06T15:20:00.000Z`.
- `NOT_BEFORE_BRT=2026-09-06T12:20:00-03:00`.
- `EXPIRES_AT_UTC=2026-09-06T16:05:00.000Z`.
- `EXPIRES_AT_BRT=2026-09-06T13:05:00-03:00`.
- Duração: `45` minutos, exatamente `WSDL_EXECUTION_MAX_WINDOW_MS`.
- `ACTIVATION_ID_IS_FRESH=true` — inédita, sem colisão em toda a árvore git.
- `EXPIRED_ACTIVATION_REUSED=false`.

## Guardas preservados

- `EXACTLY_6_HOMOLOG_TARGETS=true`.
- `NFE_AUTORIZACAO4_MULTI_OP_FIX_PRESENT=true`.
- `NFE_AUTORIZACAO4_EXPECTED_OPERATION=nfeAutorizacaoLote`.
- `FISCAL_OFF=true`, `SOAP_ENABLED=false`, `NFCE_EMISSION_ENABLED=false`.
- Trust ICP-Brasil v10, `createSefazSecureContext`, A1 mTLS, GET-only,
  HOMOLOGACAO-only, one-shot global, advisory lock, lease, resolver dinâmico da loja-piloto
  e guards H9/H10 permanecem sem alteração.
- `SOAP_CAPABILITY_CHANGED=false`, `NFCE_CAPABILITY_CHANGED=false`,
  `PRODUCTION_FISCAL_CHANGED=false`.

Nenhuma chamada administrativa, GET WSDL, handshake, SOAP, emissão NFC-e ou consumo da
activation foi executado pelo agente. A execução continua sendo exclusivamente humana,
same-origin, sem retry e em HOMOLOGAÇÃO.
