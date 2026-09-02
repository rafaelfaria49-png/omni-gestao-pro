# FISCAL-NFCE-CONTINGENCY-020 — Containment OFF da janela H-9/H-10 04:30z expirada SEM CONSUMO (144)

Trilha `fiscal` · GOAL 020 (continuação) · handoff após expiração da janela materializada
na PR #143. Data: 2026-09-02. Contadores LOCAIS desta janela (144):
`WSDL_ADMIN_CALL_COUNT=0` · `WSDL_EXTERNAL_GET_COUNT=0` ·
`SEFAZ_SOAP_POST_COUNT=0` · `SEFAZ_PRODUCTION_REQUEST_COUNT=0` ·
`RAW_WSDL_PERSISTED=false`. Janela `null/null/null` restaurada.
*(O histórico acumulado do GOAL 020 NÃO é zero: a evidência 137 registrou 1 chamada
administrativa HTTP 200 e batch dos 6 alvos. Esta evidência registra somente a janela
`772103b09d9477ca`.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 2026-09-02T03:59:40Z | PR #143 mergeada — `main = 5be0b79` (estado ON da janela `wsdl-h9h10-20260902-0430z-772103b09d9477ca`) |
| ~04:06Z | Deploy Production ON `dpl_HivW5dvUBFSBZgREfztmsKQMfgEx` (`1rf5laffe`) READY; alias canônico `omni-gestao-pro.vercel.app` confirmado via `vercel inspect` |
| 2026-09-02T04:06Z | **PONTO DE PARADA ON**: comando fetch same-origin entregue; janela ainda não aberta (~24 min de folga) |
| 2026-09-02T04:30:00Z | `notBeforeUtc` da janela |
| 2026-09-02T04:40:00Z | `expiresAtUtc` — janela EXPIROU |
| — | **A invocation administrativa NÃO foi realizada.** Nenhum GET WSDL. Nenhuma tentativa. |
| 2026-09-02T10:12Z | Handoff 144: `origin/main = 5be0b79` confirmado; janela expirada; nenhum containment OFF posterior publicado |
| 2026-09-02T10:14Z | Commit OFF `d313c99` (`{null,null,null}`; `772103b09d9477ca` nas proibidas); testes focados 123 pass |
| 2026-09-02T10:15Z | PR #144 aberta; revisão independente **APROVADO P0=0 P1=0**; checks verdes |
| 2026-09-02T10:24:29Z | PR #144 mergeada — **`main = 5a0e70f`** |
| 2026-09-02T10:24:32Z | Deploy Production OFF `dpl_5tDHksyqHYQtrhhq9DPaYC58r8fG` (`8ydcds7fg`) criado |
| ~10:31Z | Production OFF READY; alias canônico confirmado em `8ydcds7fg` via `vercel inspect https://omni-gestao-pro.vercel.app` (sem `vercel aliases`) |
| ~10:32Z | Remoção dos deployments ON desta janela: produção `1rf5laffe` (`dpl_HivW5dv…`) + preview `dk04mh82b` — **`ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`** |

## Resultado (desta janela 144)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0** —
  contadores locais desta janela 144 (o histórico acumulado do GOAL 020 inclui a
  execução 137; ver seção abaixo).
- A activation `wsdl-h9h10-20260902-0430z-772103b09d9477ca` **NÃO foi consumida**:
  nenhuma chamada HTTP administrativa ocorreu (nem tentativa) — o one-shot global
  segue íntegro e a janela morreu por relógio.
- **Nenhum documento WSDL bruto foi recebido, persistido ou visto.**
  `RAW_WSDL_PERSISTED = false`.
- A telemetria sanitizada do GOAL 138 permanece integrada e em produção.
- Superfície canônica, teto de 6 alvos, GET-only, HOMOLOGACAO/SP, TLS, destinos,
  ausência de retry, A1, auth, provider, schema/migrations, Fiscal 018/019 e código
  de emissão NFC-e **não foram alterados**.

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137 (30/08, 20:05:17Z) — evidência canônica de rede deste GOAL**: 1 chamada
  administrativa, **HTTP 200**; o batch executou os seis alvos canônicos; a evidência
  disponível registra `WSDL_EXTERNAL_GET_COUNT ≤ 6`; os seis resultados foram
  `acquisition:wsdl_rede_incerta`; **nenhuma resposta WSDL válida foi materializada**
  (`RAW_WSDL_PERSISTED=false`).
- **Janela 139 (`0c42c4389f65469d`, 31/08 03:00→03:10Z)** — expirou sem consumo (0/0).
- **Janela 140 (`99c21bca85a94cef`, 31/08 19:00→19:10Z)** — expirou sem consumo (0/0).
- **Janela 142 (`891f55e242004bd2`, 31/08 22:30→22:40Z)** — expirou sem consumo (0/0).
- **Janela 144 (`772103b09d9477ca`, 02/09 04:30→04:40Z)** — expirou sem consumo (0/0).
- Em nenhuma janela do GOAL 020 uma resposta WSDL válida foi materializada até este corte.

## Classificação

**B-EXTERNAL-TIMING** — a execução humana não ocorreu dentro da janela autorizada.
Não-D: zero rede nesta janela, zero emissão, zero produção SEFAZ, zero segredo,
janela OFF restaurada, deployments ON desta janela removidos (não abandonados),
020 RUNNING, 021 não iniciado, `track close` NÃO executado. A autorização desta
janela **expirou com ela** e NÃO é reutilizável.

## Defesa em profundidade residual

Qualquer cópia hipotética do commit ON está morta por relógio
(`expiresAtUtc = 2026-09-02T04:40:00.000Z` no passado, permanente) e pelo one-shot
global. A activation `wsdl-h9h10-20260902-0430z-772103b09d9477ca` integra a lista de
proibidas do teste de dormência (commit OFF `d313c99`).

## Próximo passo (exige NOVA autorização humana)

Nova janela efêmera com autorização textual específica e NOVO activationId.
Nenhuma autorização anterior é reutilizável. GOAL 020 permanece RUNNING.
GOAL 021 permanece não iniciado.
