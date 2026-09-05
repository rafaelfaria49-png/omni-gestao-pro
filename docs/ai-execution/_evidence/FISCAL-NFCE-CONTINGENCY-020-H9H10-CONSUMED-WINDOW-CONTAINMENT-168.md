# FISCAL-020-H9H10-CONSUMED-WINDOW-CONTAINMENT-EVIDENCE-168

Containment OFF da activation H9/H10 consumida em uma única execução humana autenticada.

## Identificação e contagens

- `CONSUMED_ACTIVATION=wsdl-h9h10-20260905-1516z-025c3251e20744df`
- Arming merge: `2e589a1ae9a33e168537edcc8a7767891a62889f` (PR #164).
- `ADMIN_CALL_COUNT=1`; resposta administrativa: HTTP `200`, `ok=false`, `code=completed`.
- `EXTERNAL_WSDL_GET_COUNT=6`.
- `SEFAZ_NETWORK_GET_SUCCESS=6/6`.
- `SEFAZ_HTTP_200=6/6`.
- `TLS_MTLS_REAL_PATH_PASS=true`.
- Todos os seis responses: `Content-Type: text/xml; charset=utf-8`.
- A execução foi humana e única; o agente não repetiu a chamada, não fez novo GET, SOAP ou NFC-e.

## Evidência dos seis alvos

| Serviço | HTTP | bytes | SHA-256 | H-9 | H-10 | operação/classificação |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| `NFeAutorizacao4` | 200 | 4058 | `b1c67b11afb4bdbb54903eee908ad14694b4b9a1cd78518af89c612f79fb3771` | false | false | `extraction:operacao_ambigua` |
| `NFeRetAutorizacao4` | 200 | — | `a838070b990d2aee1148826f7c3569c70d797a261622345ebcec5837add470f9` | true | true | `nfeRetAutorizacaoLote` |
| `NFeConsultaProtocolo4` | 200 | — | `9bd481ee87d12fe983a70cb851d241da6beea457cd3f00eb7572b55e83cf2562` | true | true | `nfeConsultaNF` |
| `NFeStatusServico4` | 200 | — | `5919f710f54ea4a353b99faca73d25ddd56ad4acd89b750d257e13e6014ea570` | true | true | `nfeStatusServicoNF` |
| `NFeInutilizacao4` | 200 | — | `43000268d91e0fb6815fafa9a5a468130a3b5c666381653353df0e48fa988a15` | true | true | `nfeInutilizacaoNF` |
| `NFeRecepcaoEvento4` | 200 | — | `f2638978318aa638d844c18df8977a953e81117c654e67cadf42ffcafa131131` | true | true | `nfeRecepcaoEventoNF` |

- `H9_PASS=5/6`; `H10_PASS=5/6`.
- `NFeAutorizacao4` não falhou em transporte: WSDL adquirido com HTTP 200, mas o extractor recusou o binding porque contém mais de uma `wsdl:operation`. Classificação exclusiva: `extraction:operacao_ambigua`.
- O blocker anterior de TLS não se reproduziu na execução real.

## Containment e limites

- Configuração versionada restaurada para `activationId=null`, `notBeforeUtc=null`, `expiresAtUtc=null`.
- A activation consumida ficou histórica e explicitamente proibida de reutilização.
- `FISCAL_OFF=true`; `H9_STATUS=PARCIAL_5_DE_6`; `H10_STATUS=PARCIAL_5_DE_6`; `GOAL_020_STATUS=RUNNING`; `GOAL_021_STATUS=NOT_STARTED`.
- Trust ICP-Brasil v10, SecureContext SEFAZ, A1 mTLS, catálogo de exatamente 6 targets, one-shot global, advisory lock, lease de rede, resolver da loja-piloto, GET-only e HOMOLOGACAO-only preservados.
- `SOAP_CAPABILITY_CHANGED=false`; `NFCE_CAPABILITY_CHANGED=false`; `PRODUCTION_FISCAL_CHANGED=false`.
- Nenhum certificado privado, cookie, segredo ou payload sensível foi persistido. O extractor não foi corrigido neste GOAL.
