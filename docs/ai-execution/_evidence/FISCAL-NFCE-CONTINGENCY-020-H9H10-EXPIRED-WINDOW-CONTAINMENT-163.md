# FISCAL-NFCE-CONTINGENCY-020 — Containment OFF da janela H-9/H-10 19:55z expirada SEM CONSUMO (163)

Trilha `fiscal` · GOAL 020 (continuação) · containment OFF após expiração da janela materializada
na PR #159. Data: 2026-09-04. Contadores LOCAIS desta janela (163):
`WSDL_ADMIN_CALL_COUNT=0` · `WSDL_EXTERNAL_GET_COUNT=0` ·
`SEFAZ_SOAP_POST_COUNT=0` · `SEFAZ_PRODUCTION_REQUEST_COUNT=0` ·
`RAW_WSDL_PERSISTED=false`. Janela `null/null/null` restaurada.
*(O histórico acumulado do GOAL 020 NÃO é zero: a evidência 137 e 154 registraram chamadas
administrativas. Esta evidência registra exclusivamente a janela `wsdl-h9h10-20260904-1955z-d2c844a079986c9e`.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| ~19:40Z | Preflight e autorização humana de arming H-9/H-10 45 min com ICP-Brasil v10 |
| ~19:52Z | PR #159 aberta com janela `wsdl-h9h10-20260904-1955z-d2c844a079986c9e` (19:55→20:40Z) |
| 2026-09-04T19:54:19Z | Checks CI verdes (ubuntu 2m17s, windows 2m54s, container 6m25s, Vercel pass) |
| 2026-09-04T19:54:33Z | PR #159 mergeada — `main = 0728915437f8a8a1867419fa6034675d1a3b4e94` |
| 2026-09-04T19:54:32Z | Deploy Production ON `dpl_oEcLAXP1XvwRiBj7QNFYrD7iSwLx` (`4v9c030m6`) criado |
| ~19:58Z | Production ON READY com alias `omni-gestao-pro.vercel.app` conferido via `/api/version` (`0728915437f8`) |
| 2026-09-04T19:55:00Z | `notBeforeUtc` da janela de arming alcançado |
| 2026-09-04T20:40:00Z | `expiresAtUtc` — janela EXPIROU sem execução administrativa autorizada no prazo |
| — | **A invocation administrativa NÃO foi realizada.** Zero POST, zero GET WSDL, zero SOAP, zero NFC-e. |
| ~21:30Z | Handoff 163: `origin/main = 0728915437f8` confirmado; containment OFF iniciado |
| — | Janela restaurada a `{null,null,null}`; `wsdl-h9h10-20260904-1955z-d2c844a079986c9e` registrada como morta |

## Resultado (desta janela 163)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0**.
- A activation `wsdl-h9h10-20260904-1955z-d2c844a079986c9e` **NÃO foi consumida** (one-shot intacto no banco, morta por relógio).
- `RAW_WSDL_PERSISTED = false`.
- Trust anchor ICP-Brasil v10 (PR #156) permanece implantada e inalterada.
- Catálogo dos 6 alvos, guards, one-shot, lease, auth, provider, schema e emissão NFC-e **não foram alterados**.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137**: 1 chamada administrativa HTTP 200; batch dos 6 alvos; falha incerta pré-telemetria.
- **Execução 154**: 1 chamada administrativa HTTP 200; batch dos 6 alvos; falha classificada como `TLS_CERTIFICATE / UNABLE_TO_GET_ISSUER_CERT_LOCALLY` em `SECURE_CONNECT`.
- Janelas 139, 140, 142, 144, 147, 150 e **163** (`wsdl-h9h10-20260904-1955z-d2c844a079986c9e`, 04/09 19:55→20:40Z): expiraram ou não foram utilizadas (0/0 cada).
- **Total de chamadas administrativas do GOAL 020: 2. Total de WSDL válidas obtidas: 0.**

## Classificação

**B-EXTERNAL-TIMING**. A janela de arming expirou sem consumo dentro do prazo.
Autorização desta janela expirou com ela e NÃO é reutilizável.
H-9 e H-10 permanecem **ABERTOS**. GOAL 020 permanece **RUNNING**. GOAL 021 **não iniciado**.
`PRODUCTION_FISCAL=OFF`. Pronto para novo ciclo controlado quando autorizado.
