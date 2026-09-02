# FISCAL-NFCE-CONTINGENCY-020 — Containment OFF da janela H-9/H-10 14:00z expirada SEM CONSUMO (147)

Trilha `fiscal` · GOAL 020 (continuação) · handoff após expiração da janela materializada
na PR #146. Data: 2026-09-02. Contadores LOCAIS desta janela (147):
`WSDL_ADMIN_CALL_COUNT=0` · `WSDL_EXTERNAL_GET_COUNT=0` ·
`SEFAZ_SOAP_POST_COUNT=0` · `SEFAZ_PRODUCTION_REQUEST_COUNT=0` ·
`RAW_WSDL_PERSISTED=false`. Janela `null/null/null` restaurada.
*(O histórico acumulado do GOAL 020 NÃO é zero: a evidência 137 registrou 1 chamada
administrativa HTTP 200 e batch dos 6 alvos. Esta evidência registra somente a janela
`4b5f2504640de6e4`.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 2026-09-02T13:31:25Z | PR #146 mergeada — `main = 3d18984` (estado ON da janela `wsdl-h9h10-20260902-1400z-4b5f2504640de6e4`) |
| ~13:38Z | Deploy Production ON `dpl_AQ6vtihX6SLNQ7Sx36RE1vpzf4Bq` (`mgrnjlga4`) READY; alias canônico confirmado via `vercel inspect` |
| 2026-09-02T13:38Z | **PONTO DE PARADA ON**: fetch same-origin entregue; restavam ~31 min até `expiresAtUtc` (≥ 8); janela ainda não aberta |
| 2026-09-02T14:00:00Z | `notBeforeUtc` da janela (11:00 BRT) |
| 2026-09-02T14:10:00Z | `expiresAtUtc` — janela EXPIROU (11:10 BRT) |
| — | **A invocation administrativa NÃO foi realizada.** Nenhum GET WSDL. Nenhuma tentativa. |
| 2026-09-02T15:54Z | Handoff 147: `origin/main = 3d18984` confirmado; janela expirada; nenhum containment OFF posterior publicado |
| ~15:56Z | Commit OFF `d78c27f` (`{null,null,null}`; `4b5f2504640de6e4` nas proibidas); testes focados 105 pass |
| ~15:56Z | PR #147 aberta; checks verdes |
| ~16:06Z | PR #147 mergeada — **`main = f3d6ece`** |
| 2026-09-02T16:06:34Z | Deploy Production OFF `dpl_5UsyPShAA7hMsi4RwidXVB6iurJD` (`hvhyxpw00`) criado |
| ~16:13Z | Production OFF READY; alias canônico confirmado em `hvhyxpw00` via `vercel inspect https://omni-gestao-pro.vercel.app` (sem `vercel aliases`) |
| ~16:14Z | Remoção dos deployments ON desta janela: produção `mgrnjlga4` (`dpl_AQ6vtihX…`) + preview `lauumehec` — **`ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`** |

## Resultado (desta janela 147)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0**.
- A activation `wsdl-h9h10-20260902-1400z-4b5f2504640de6e4` **NÃO foi consumida**.
- `RAW_WSDL_PERSISTED = false`.
- Telemetria 138, one-shot, teto de 6 alvos, GET-only, HOMOLOGACAO/SP, TLS, destinos,
  ausência de retry, A1, auth, provider, schema e emissão NFC-e **não foram alterados**.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137**: 1 chamada administrativa HTTP 200; batch dos 6 alvos; `wsdl_rede_incerta`;
  nenhuma WSDL válida (`RAW_WSDL_PERSISTED=false`).
- Janelas 139, 140, 142, 144 e **147** (`4b5f2504640de6e4`, 02/09 14:00→14:10Z): expiraram
  sem consumo (0/0 cada).
- Nenhuma resposta WSDL válida materializada até este corte.

## Classificação

**B-EXTERNAL-TIMING**. Autorização desta janela expirou com ela e NÃO é reutilizável.
GOAL 020 RUNNING. GOAL 021 não iniciado. `track close` NÃO executado.
