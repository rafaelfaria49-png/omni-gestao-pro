# FISCAL-020-H9H10-SECOND-EXPIRED-WINDOW-CONTAINMENT-OFF-165

Containment OFF da segunda janela H9/H10 já expirada. Activation:
`wsdl-h9h10-20260904-2325z-fcad5be0637f918c`. Janela UTC:
`2026-09-04T23:25:00.000Z` → `2026-09-05T00:10:00.000Z`.

## Verificação de evidência antes das contagens

- Base confirmada: `origin/main=a18c06db1c27d9fe07bf90c8819425c8ce500958`.
- O commit de arming `2e4bbcab8c5913f1998fe0bd5fe67b56d95086f6` e o PR #161 mostram a
  configuração ON e o merge às `2026-09-04T23:18:16Z`, antes do início da janela.
- Não há evidência versionada de invocation, telemetria de execução ou resposta para esta
  activation. Os metadados do PR/CI não provam chamada administrativa nem GET externo.
- Portanto, sem inferir consumo:

```text
ADMIN_CALL_COUNT=UNKNOWN_OR_ZERO_BY_EVIDENCE
EXTERNAL_WSDL_GET_COUNT=UNKNOWN_OR_ZERO_BY_EVIDENCE
```

Não foi executado POST administrativo nem GET WSDL durante este containment. A ausência de
prova não é convertida em zero.

## Containment aplicado

- `WSDL_EPHEMERAL_EXECUTION_WINDOW={activationId:null,notBeforeUtc:null,expiresAtUtc:null}`.
- `EXPIRED_ACTIVATION_REUSABLE=false` — a activation foi acrescentada à lista histórica/morta
  dos testes e não pode voltar a ser a constante executável.
- `ICPBRASIL_TRUST_UNCHANGED=true`.
- `WSDL_TARGET_CATALOG_UNCHANGED=true`.
- `SOAP_CAPABILITY_CHANGED=false`.
- `NFCE_CAPABILITY_CHANGED=false`.
- `FISCAL_OFF=true`, `PRODUCTION_FISCAL=OFF`, `H9_STATUS=ABERTO`, `H10_STATUS=ABERTO`, `GOAL_020_STATUS=RUNNING`,
  `GOAL_021_STATUS=NOT_STARTED`.

Preservados: one-shot, lease interna, resolver da loja-piloto, guards H9/H10,
HOMOLOGACAO-only, GET-only e o trust ICP-Brasil v10.
