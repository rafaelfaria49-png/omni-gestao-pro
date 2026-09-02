# FISCAL-NFCE-CONTINGENCY-020 — Containment OFF da janela H-9/H-10 21:27z NÃO UTILIZADA (150)

Trilha `fiscal` · GOAL 020 (continuação) · handoff após o gate ≥ 8 min até `expiresAtUtc`.
Data: 2026-09-02. Contadores LOCAIS desta janela (150):
`WSDL_ADMIN_CALL_COUNT=0` · `WSDL_EXTERNAL_GET_COUNT=0` ·
`SEFAZ_SOAP_POST_COUNT=0` · `SEFAZ_PRODUCTION_REQUEST_COUNT=0` ·
`RAW_WSDL_PERSISTED=false`. Janela `null/null/null` restaurada.
*(O histórico acumulado do GOAL 020 NÃO é zero: a evidência 137 registrou 1 chamada
administrativa HTTP 200 e batch dos 6 alvos. Esta evidência registra somente a janela
`bfefedc2de8f65f9`.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| ~21:12Z | Autorização humana verbatim H-9/H-10 sincronizada (humano presente; folga 12–15 min) |
| ~21:12Z | Preflight fail-closed: `origin/main = 25f41a0`; janela `null/null/null`; `ACTIVE_ON_DEPLOYMENTS_REMAINING=0`; GOAL 020 RUNNING; GOAL 021 não iniciado |
| — | Janela materializada: `wsdl-h9h10-20260902-2127z-bfefedc2de8f65f9` · `notBeforeUtc=2026-09-02T21:27:00.000Z` · `expiresAtUtc=2026-09-02T21:37:00.000Z` (10 min; 18:27–18:37 BRT) |
| — | Commit ON `fc28c25` → PR #149 (revisão independente APPROVE P0=0 P1=0; CI verde) |
| 2026-09-02T21:24:30Z | PR #149 mergeada — `main = fe50630` (estado ON) |
| 2026-09-02T21:24:28Z | Deploy Production ON `dpl_CGPPBZNGZWkEyQYU8c8r9zXX8fQH` (`r7vu7jg1b`) criado |
| 2026-09-02T21:29:06Z | Production ON ainda **Building**; restavam **7,9 min** até `expiresAtUtc` |
| 2026-09-02T21:29:10Z | **GATE ≥ 8 min FALHOU**. Fetch NÃO entregue. Invocation NÃO realizada. Containment OFF iniciado. |
| 2026-09-02T21:27:00Z | `notBeforeUtc` da janela (18:27 BRT) — nunca usada para invocation |
| 2026-09-02T21:37:00Z | `expiresAtUtc` — janela EXPIROU (18:37 BRT) |
| — | **A invocation administrativa NÃO foi realizada.** Nenhum GET WSDL. Nenhuma tentativa. |
| ~21:32Z | Commit OFF `bd8850b` (`{null,null,null}`; `bfefedc2de8f65f9` nas proibidas); testes focados 16+14 pass |
| ~21:33Z | PR #150 aberta; revisão independente APPROVE P0=0 P1=0 |
| 2026-09-02T21:42:55Z | Checks PR #150 verdes (ubuntu 1m54s · windows 3m5s · container 6m35s · Vercel pass) |
| 2026-09-02T21:43:15Z | PR #150 mergeada — **`main = 453566c`** |
| 2026-09-02T21:43:10Z | Deploy Production OFF `dpl_8pzh5yfNcpguK2FyzY5ueKN7VYHV` (`2qe1vllq4`) criado |
| ~21:52Z | Production OFF READY; alias canônico confirmado em `2qe1vllq4` via `vercel inspect https://omni-gestao-pro.vercel.app` (sem `vercel aliases`) |
| 2026-09-02T21:52:50Z | Remoção dos deployments ON desta janela: produção `r7vu7jg1b` (`dpl_CGPPBZNG…`) + preview `epx5c26x5` — **`ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`** |

## Resultado (desta janela 150)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0**.
- A activation `wsdl-h9h10-20260902-2127z-bfefedc2de8f65f9` **NÃO foi consumida**.
- `RAW_WSDL_PERSISTED = false`.
- Fetch same-origin **não** foi entregue (gate de 8 minutos restantes).
- Telemetria 138, one-shot, teto de 6 alvos, GET-only, HOMOLOGACAO/SP, TLS, destinos,
  ausência de retry, A1, auth, provider, schema e emissão NFC-e **não foram alterados**.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137**: 1 chamada administrativa HTTP 200; batch dos 6 alvos; `wsdl_rede_incerta`;
  nenhuma WSDL válida (`RAW_WSDL_PERSISTED=false`).
- Janelas 139, 140, 142, 144, 147 e **150** (`bfefedc2de8f65f9`, 02/09 21:27→21:37Z): expiraram
  ou não foram utilizadas (0/0 cada).
- Nenhuma resposta WSDL válida materializada até este corte.

## Classificação

**B-EXTERNAL-TIMING**. Production ON não ficou READY a tempo do gate ≥ 8 min restantes
até `expiresAtUtc`. Autorização desta janela expirou com ela e NÃO é reutilizável.
GOAL 020 RUNNING. GOAL 021 não iniciado. `track close` NÃO executado.
