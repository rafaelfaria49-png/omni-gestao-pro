# FISCAL-NFCE-CONTINGENCY-020 — Diagnóstico H-9/H-10 executado (TLS_CERTIFICATE) + Containment OFF (154)

Trilha `fiscal` · GOAL 020 (continuação) · handoff de executor (cota do executor anterior).
Data: 2026-09-03. Esta evidência registra **a activation consumida** e o **containment OFF**.

> **Não é uma janela vazia.** Diferente das evidências 139/140/142/144/147/150, a activation
> desta vez **foi consumida** e a chamada administrativa **foi executada**, exatamente uma vez.

## Activation

| Campo | Valor |
|---|---|
| `activationId` | `wsdl-h9h10-20260903-0037z-b3913bea58774deb` |
| `notBeforeUtc` | `2026-09-03T00:37:00.000Z` |
| `expiresAtUtc` | `2026-09-03T01:22:00.000Z` (45 min de arming EXTERNO) |
| Estado após 154 | **CONSUMIDA / HISTÓRICA — one-shot GASTO, jamais reutilizável** |
| Commit ON | `2c78d1f` (PR #153, mergeada → `main = b09449f`) |

## Contadores desta execução (154)

```
WSDL_ADMIN_CALL_COUNT                     = 1
BATCH_TARGET_COUNT                        = 6
HTTP_ADMIN_STATUS                         = 200
DIAGNOSTIC_ROOT_CLASS                     = TLS_CERTIFICATE
DIAGNOSTIC_ROOT_CODE                      = UNABLE_TO_GET_ISSUER_CERT_LOCALLY
TRANSPORT_PHASE                           = SECURE_CONNECT
HTTP_RESPONSE_FROM_WSDL_TARGETS_REACHED   = false
RAW_WSDL_RECEIVED                         = false
RAW_WSDL_PERSISTED                        = false
H9_STATUS                                 = ABERTO
H10_STATUS                                = ABERTO
SEFAZ_SOAP_POST_COUNT                     = 0
SEFAZ_PRODUCTION_REQUEST_COUNT            = 0
NFCE_EMISSION_COUNT                       = 0
SECOND_INVOCATION_COUNT                   = 0
RETRY_COUNT                               = 0
```

A invocation foi **única**, **same-origin**, **browser-assisted**, autenticada **ADMIN** no host
canônico de Production. Não houve segunda invocation e não haverá retry.

## Resposta administrativa (sanitizada, íntegra)

`HTTP 200` · `body.code = "completed"` · `body.ok = false` · `services.length = 6`

Os **seis** serviços retornaram **exatamente o mesmo** resultado — nenhuma variação entre alvos:

| # | Serviço | `transportPhase` | `transportClass` | `transportCode` | `failureClass` | `httpStatus` | `byteLength` | `sha256` | `h9` | `h10` |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `NFeAutorizacao4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |
| 2 | `NFeRetAutorizacao4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |
| 3 | `NFeConsultaProtocolo4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |
| 4 | `NFeStatusServico4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |
| 5 | `NFeInutilizacao4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |
| 6 | `NFeRecepcaoEvento4` | `SECURE_CONNECT` | `TLS_CERTIFICATE` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` | `acquisition:wsdl_rede_incerta` | `null` | `null` | `null` | `false` | `false` |

São exatamente os 6 alvos canônicos fechados (SEFAZ-SP · **HOMOLOGACAO**). Nenhum alvo fora
da lista foi tocado.

## Leitura do resultado (o que a evidência PROVA)

1. O pipeline interno **funcionou de ponta a ponta**: janela ativa → superfície canônica →
   auth ADMIN/Production → loja-piloto resolvida → A1 por refs opacas → advisory lock →
   consumo one-shot persistido → lease de rede → permit único por alvo → batch fechado de 6.
   O gate resiliente do 152 (arming externo vs lease interna de 10 min) sustentou a execução.
2. A telemetria sanitizada do 138 **entregou o diagnóstico que faltava**. A execução 137 morreu
   como `wsdl_rede_incerta` opaco; aqui a mesma falha vem **classificada**:
   fase `SECURE_CONNECT`, classe `TLS_CERTIFICATE`, código `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
3. A falha é **pré-HTTP** e **anterior ao handshake concluído**: nenhum alvo devolveu status,
   corpo ou bytes. `HTTP_RESPONSE_FROM_WSDL_TARGETS_REACHED = false`,
   `RAW_WSDL_RECEIVED = false`.
4. **Uniformidade absoluta** nos 6 alvos (mesmo host, mesma cadeia) — o modo de falha é
   sistêmico do caminho TLS, não específico de um serviço.

## O que a evidência NÃO decide (deliberadamente)

`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` significa que o verificador **não encontrou localmente o
emissor** de um certificado apresentado. Isso admite ao menos duas causas raiz distintas:

- **(a)** a SEFAZ apresenta uma **cadeia incompleta** (falta intermediária no handshake); ou
- **(b)** o **trust store do runtime Node/Vercel é insuficiente** (âncora ICP-Brasil ausente).

**Esta distinção NÃO está decidida e NÃO é declarada aqui.** Ela pertence ao próximo GOAL.
Nada foi alterado em CA/trust store, TLS, hostname/IP ou destino para investigá-la.

## Estado das hipóteses

| Hipótese | Estado |
|---|---|
| **H-9** — WSDL oficial obtido e verificável | **ABERTO** |
| **H-10** — contrato de operações confirmado contra o WSDL oficial | **ABERTO** |

Nenhuma WSDL válida foi materializada em nenhuma execução do GOAL 020 até este corte.

## Containment OFF (154)

Restaurado no mecanismo versionado
(`lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts`):

```
activationId  = null
notBeforeUtc  = null
expiresAtUtc  = null
```

`wsdl-h9h10-20260903-0037z-b3913bea58774deb` foi acrescentada às listas de activations mortas
nos testes — não pode voltar a ser configuração executável.

**Preservado sem alteração:** ledger one-shot · advisory lock (`pg_advisory_xact_lock` com cast
`::text`, fix 135) · dedupe global entre lojas · teto de 6 alvos · permit único por alvo ·
gate resiliente 152 (arming vs lease 10 min) · telemetria sanitizada 138 (allowlist fechada de
códigos Node) · GET-only · zero retry · `rejectUnauthorized=true` · TLS ≥ 1.2 · destinos
canônicos HOMOLOGACAO/SP · A1 por refs opacas · auth ADMIN/Production-only · provider · schema.

**Não executado nesta sessão:** nova invocation · novo GET WSDL · SOAP POST · emissão NFC-e ·
SEFAZ PRODUÇÃO · nova activation · nova janela · alteração de CA/trust store · relaxamento de
TLS · mudança de hostname/IP.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137** (30/08): 1 chamada administrativa HTTP 200; 6 alvos; `wsdl_rede_incerta`
  **sem** telemetria de transporte; nenhuma WSDL válida.
- **Execução 154** (03/09, esta): 1 chamada administrativa HTTP 200; 6 alvos; mesma falha,
  agora **classificada** como `TLS_CERTIFICATE / UNABLE_TO_GET_ISSUER_CERT_LOCALLY` em
  `SECURE_CONNECT`; nenhuma WSDL válida.
- Janelas 139, 140, 142, 144, 147 e 150: expiraram ou não foram utilizadas (0/0 cada).
- **Total de chamadas administrativas do GOAL 020: 2. Total de WSDL válidas obtidas: 0.**

## Classificação

**C-EXTERNAL-TLS-CHAIN**. O bloqueio deixou de ser incerto e passou a ser **identificado por
classe e código**, sem ainda estar atribuído a uma das duas causas raiz. GOAL 020 permanece
**RUNNING**. GOAL 021 **não iniciado**. `track close` **não executado**.
