# FISCAL-NFCE-CONTINGENCY-020 — Diagnóstico browser-assisted: janela expirou SEM CONSUMO (140)

Trilha `fiscal` · GOAL 020 (continuação) · execução do gate textual (não-consumido em 139).
Data: 2026-08-31 · Zero rede NESTA janela (140): `WSDL_ADMIN_CALL_COUNT=0` ·
`WSDL_EXTERNAL_GET_COUNT=0` · Janela `null/null/null` restaurada.
*(Correção documental: a frase original "ZERO rede em todo o GOAL acumulado" era um ERRO —
o GOAL 020 acumulado NÃO tem zero rede; a execução 137 (30/08, 20:05:17Z) registrou 1
chamada administrativa HTTP 200 com `WSDL_EXTERNAL_GET_COUNT ≤ 6`. Ver §Histórico acumulado
abaixo e a evidência canônica 137.)*

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 18:28 | Preflight fail-closed: `main = a546ca9` (OFF), janela `null/null/null`, 0 deployments ON, tree limpa |
| 18:30–18:33 | Janela calculada e materializada: `wsdl-h9h10-20260831-1900z-99c21bca85a94cef`, `19:00:00Z → 19:10:00Z` (10 min ≤ teto 15 min); commit ON `6137773`; testes 75/75 |
| 18:33 | PR #137 aberto; modelo de execução: invocation SAME-ORIGIN manual do humano no Console do Chrome (nenhum cookie/token manipulado pelo agente) |
| 18:36–18:40 | Revisão independente do diff ON: **APROVADO P0=0 P1=0** (5/5 itens) |
| 18:40–18:42 | PR #137: checks 6/6 verdes, sem drift fiscal → merge `5777356` às **18:42:48Z** |
| 18:48 | FASE ON: deployment Production `dpl_2NRViE3EEHqK7nHervigFMjoqm2p` (`ripbdw99x`) **READY**; alias canônico `omni-gestao-pro.vercel.app` confirmado anexado a ele (via `vercel inspect`) |
| 18:48 | **PONTO DE PARADA**: comando JavaScript exato entregue ao humano (fetch same-origin, POST sem body, uma invocation, sem retry) |
| — | **A invocation NÃO foi executada.** Relógio do Chrome quando o humano retomou: `19:34:18.044Z` — 24 min após a expiração (`19:10:00Z`) |
| 19:46 | Containment: commit OFF `0e6fe53` (`{null,null,null}`; `99c21bca85a94cef` nas proibidas); testes verdes |
| 19:50:08 | PR #138: checks 6/6, sem drift → merge → **`main = 3bc7e05`** |
| 19:56 | Deploy Production OFF `dpl_HqPwz84yDaNULU49ZcEoq7HXLnNX` (`bgr2hhoqm`) READY; alias canônico confirmado nele |
| 19:57 | Remoção dos deployments ON: produção `ripbdw99x` + preview `738goze7r` — **`ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`** |

## Resultado (desta janela 140)

- **WSDL_ADMIN_CALL_COUNT = 0** · **WSDL_EXTERNAL_GET_COUNT = 0** ·
  **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0** — contadores
  locais desta janela 140 (o histórico acumulado do GOAL 020 inclui a execução 137; ver
  seção abaixo).
- A activation `99c21bca85a94cef` **NÃO foi consumida**: nenhuma chamada HTTP administrativa
  ocorreu (nem tentativa) — o one-shot global segue íntegro e a janela morreu por relógio
  (`expired` → 404 permanente antes de ACL/Prisma/A1/socket).
- **Nenhum documento WSDL bruto foi recebido, persistido ou visto.** `RAW_WSDL_PERSISTED = false`.
- A telemetria sanitizada do GOAL 138 permanece integrada e em produção, pronta para a
  próxima janela autorizada: `transportPhase`/`transportClass`/`transportCode` por serviço,
  além dos campos sanitizados existentes (httpStatus/byteLength/sha256/contentTypeEvidence).

## Histórico acumulado do GOAL 020 (honesto)

- **Execução 137 (30/08, 20:05:17Z) — evidência canônica de rede deste GOAL**: 1 chamada
  administrativa, **HTTP 200**; o batch executou os seis alvos canônicos; a evidência
  disponível registra `WSDL_EXTERNAL_GET_COUNT ≤ 6` (nenhuma contagem mais precisa é
  suportada); os seis resultados foram `acquisition:wsdl_rede_incerta`; **nenhuma resposta
  WSDL válida foi materializada** naquela execução (`RAW_WSDL_PERSISTED=false`).
- **Janela 139 (`0c42c4389f65469d`, 31/08 03:00→03:10Z)** — expirou sem consumo: login ADMIN
  falhou (`CredentialsSignin`), nenhuma chamada (0/0).
- **Janela 140 (`99c21bca85a94cef`, 31/08 19:00→19:10Z)** — expirou sem consumo: invocation
  browser-assisted não executada a tempo pelo humano (relógio 19:34:18Z), nenhuma chamada (0/0).
- Em nenhuma janela do GOAL 020 uma resposta WSDL válida foi materializada até hoje.

## Classificação (GOAL 138, janela 2 de diagnóstico)

**B-EXTERNAL-TIMING** — a execução humana não ocorreu dentro da janela autorizada (falha de
timing externo, sem qualquer chamada ou tentativa). Não-D: zero rede, zero emissão, zero
produção, zero segredo, janela OFF restaurada, deployments ON removidos (não abandonados),
020 RUNNING, 021 não iniciado, `track close` NÃO executado. A autorização desta janela
**expirou com ela** e NÃO é reutilizável.

## Defesa em profundidade residual

Qualquer cópia hipotética do commit ON estaria morta por relógio
(`expiresAtUtc = 19:10:00Z` no passado, permanente) e pelo one-shot global. A activation
`99c21bca85a94cef` integra a lista de proibidas do teste de dormência (commit OFF `0e6fe53`).

## Próximo passo (exige NOVA autorização humana)

Nova janela efêmera com autorização textual específica e NOVO activationId, preferindo o
mesmo modelo browser-assisted (invocation same-origin manual no Chrome autenticado) com
janela futura suficiente para o ciclo de deploy (~30 min entre merge e `notBeforeUtc`).
Nenhuma autorização anterior é reutilizável.
