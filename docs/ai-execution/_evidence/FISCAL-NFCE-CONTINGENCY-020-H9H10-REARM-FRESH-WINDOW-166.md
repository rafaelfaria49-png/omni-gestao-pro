# FISCAL-020-H9H10-REARM-FRESH-WINDOW-166

Rearm da terceira janela efêmera H9/H10 após o containment OFF confirmado no PR #163.

## Arming

- `ORIGIN_MAIN_BASE=d460b47dd785c193473511da3ab7a1d638611c52`.
- UTC obtido no início da materialização: `2026-09-05T15:00:43.736Z`.
- `ACTIVATION_ID=wsdl-h9h10-20260905-1516z-025c3251e20744df`.
- `NOT_BEFORE_UTC=2026-09-05T15:16:00.000Z`.
- `EXPIRES_AT_UTC=2026-09-05T16:01:00.000Z`.
- Duração: `45` minutos, dentro de `WSDL_EXECUTION_MAX_WINDOW_MS`.
- `ACTIVATION_ID_IS_FRESH=true` — não coincide com as activations mortas de 19:55z/23:25z.
- `EXPIRED_ACTIVATION_REUSED=false`.

## Guardas preservados

- `EXACTLY_6_HOMOLOG_TARGETS=true`.
- `FISCAL_OFF=true`, `SOAP_ENABLED=false`, `NFCE_EMISSION_ENABLED=false`.
- Trust ICP-Brasil v10, `createSefazSecureContext`, A1 mTLS, GET-only,
  HOMOLOGACAO-only, one-shot global, advisory lock, lease, resolver dinâmico da loja-piloto
  e guards H9/H10 permanecem sem alteração.
- `SOAP_CAPABILITY_CHANGED=false`, `NFCE_CAPABILITY_CHANGED=false`,
  `PRODUCTION_FISCAL_CHANGED=false`.

Nenhuma chamada administrativa, GET WSDL, handshake, SOAP, emissão NFC-e ou consumo da
activation foi executado pelo agente. A execução, se autorizada pelo gate READY posterior,
será uma única invocation humana same-origin, sem retry.
