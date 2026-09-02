# FISCAL-NFCE-CONTINGENCY-020 — Containment OFF da janela H-9/H-10 22:30z expirada SEM CONSUMO (142)

Trilha `fiscal` · GOAL 020 (continuação) · handoff após expiração da janela materializada
na PR #140. Data: 2026-09-02. Contadores LOCAIS desta janela (142):
`WSDL_ADMIN_CALL_COUNT=0` · `WSDL_EXTERNAL_GET_COUNT=0` ·
`SEFAZ_SOAP_POST_COUNT=0` · `SEFAZ_PRODUCTION_REQUEST_COUNT=0` ·
`RAW_WSDL_PERSISTED=false`. Janela `null/null/null` restaurada.
*(O histórico acumulado do GOAL 020 NÃO é zero: a evidência 137 registrou 1 chamada
administrativa HTTP 200 e batch dos 6 alvos. Esta evidência registra somente a janela
`891f55e242004bd2`.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 2026-08-31T21:55:49Z | PR #140 mergeada — `main = facf2be` (estado ON da janela `wsdl-h9h10-20260831-2230z-891f55e242004bd2`) |
| 2026-08-31T22:05:09Z | Deploy Production ON `dpl_Gg6XLgEoDNM1cDSdzkEJdZraumEe` (`8qh22op1x`) READY; alias canônico `omni-gestao-pro.vercel.app` anexado a ele (confirmado depois via `vercel inspect`) |
| 2026-08-31T22:30:00Z | `notBeforeUtc` da janela |
| 2026-08-31T22:40:00Z | `expiresAtUtc` — janela EXPIROU |
| — | **A invocation administrativa NÃO foi realizada.** Nenhum fetch manual foi disparado. Nenhuma nova tentativa foi feita. |
| 2026-09-02T02:53Z | Handoff 142: `origin/main = facf2be` confirmado; janela expirada (`now > 22:40Z`); nenhum containment OFF posterior publicado |
| 2026-09-02T02:57Z | Commit OFF `3c2d724` (`{null,null,null}`; `891f55e242004bd2` nas proibidas); testes focados 221 pass / 3 skipped |
| 2026-09-02T02:57Z | PR #141 aberta; checks verdes (unit ubuntu/windows, container/supply-chain, Vercel omni-gestao e omni-gestao-pro) |
| 2026-09-02T03:06:49Z | PR #141 mergeada — **`main = 5ebc8a7`** |
| 2026-09-02T03:06:52Z | Deploy Production OFF `dpl_6H5JuYCqysFaGVWtekxdCFm2rsXp` (`bhd7n154x`) criado |
| ~03:10Z | Production OFF READY (duração 3 min); alias canônico confirmado em `bhd7n154x` via `vercel inspect https://omni-gestao-pro.vercel.app` (sem `vercel aliases`) |
| ~03:20Z | Remoção dos deployments ON desta janela: produção `8qh22op1x` (`dpl_Gg6XLgEo…`) + preview `iqp0y09po` (`dpl_G42hdVuj…`) — **`ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`** |

## Resultado (desta janela 142)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0** —
  contadores locais desta janela 142 (o histórico acumulado do GOAL 020 inclui a
  execução 137; ver seção abaixo).
- A activation `wsdl-h9h10-20260831-2230z-891f55e242004bd2` **NÃO foi consumida**:
  nenhuma chamada HTTP administrativa ocorreu (nem tentativa) — o one-shot global
  segue íntegro e a janela morreu por relógio (`expired` → fail-closed permanente
  antes de ACL/Prisma/A1/socket).
- **Nenhum documento WSDL bruto foi recebido, persistido ou visto.**
  `RAW_WSDL_PERSISTED = false`.
- A telemetria sanitizada do GOAL 138 permanece integrada e em produção.
- Superfície canônica, teto de 6 alvos, transporte WSDL, TLS, destinos, retry, A1,
  autenticação, provider, schema/migrations, Fiscal 018/019 e código de emissão
  NFC-e **não foram alterados**.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137 (30/08, 20:05:17Z) — evidência canônica de rede deste GOAL**: 1 chamada
  administrativa, **HTTP 200**; o batch executou os seis alvos canônicos; a evidência
  disponível registra `WSDL_EXTERNAL_GET_COUNT ≤ 6`; os seis resultados foram
  `acquisition:wsdl_rede_incerta`; **nenhuma resposta WSDL válida foi materializada**
  (`RAW_WSDL_PERSISTED=false`).
- **Janela 139 (`0c42c4389f65469d`, 31/08 03:00→03:10Z)** — expirou sem consumo: login
  ADMIN falhou (`CredentialsSignin`), nenhuma chamada (0/0).
- **Janela 140 (`99c21bca85a94cef`, 31/08 19:00→19:10Z)** — expirou sem consumo:
  invocation browser-assisted não executada a tempo, nenhuma chamada (0/0).
- **Janela 142 (`891f55e242004bd2`, 31/08 22:30→22:40Z)** — expirou sem consumo:
  invocation administrativa não realizada, nenhum fetch manual, nenhuma chamada (0/0).
- Em nenhuma janela do GOAL 020 uma resposta WSDL válida foi materializada até este corte.

## Classificação

**B-EXTERNAL-TIMING** — a execução humana não ocorreu dentro da janela autorizada
(falha de timing externo, sem qualquer chamada ou tentativa). Não-D: zero rede nesta
janela, zero emissão, zero produção SEFAZ, zero segredo, janela OFF restaurada,
deployments ON desta janela removidos (não abandonados), 020 RUNNING, 021 não iniciado,
`track close` NÃO executado. A autorização desta janela **expirou com ela** e NÃO é
reutilizável.

## Defesa em profundidade residual

Qualquer cópia hipotética do commit ON está morta por relógio
(`expiresAtUtc = 2026-08-31T22:40:00.000Z` no passado, permanente) e pelo one-shot
global. A activation `wsdl-h9h10-20260831-2230z-891f55e242004bd2` integra a lista de
proibidas do teste de dormência (commit OFF `3c2d724`).

## Próximo passo (exige NOVA autorização humana)

Nova janela efêmera com autorização textual específica e NOVO activationId.
Nenhuma autorização anterior é reutilizável. GOAL 020 permanece RUNNING.
GOAL 021 permanece não iniciado.
