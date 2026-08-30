# FISCAL-NFCE-CONTINGENCY-020 — H-9/H-10 execução única + containment + causa raiz (134)

Trilha `fiscal` · GOAL 020 (continuação) · operação FISCAL-020-H9H10-ACQUIRE-CONTAIN-131.
Data: 2026-08-30 · Autorização textual humana recebida nesta sessão (verbatim, GOAL 131).

## Linha do tempo (UTC)

| Instante | Evento |
|---|---|
| 14:0x | FASE 3: commit ON isolado `2494c42` — janela `wsdl-h9h10-20260830-1440z-fed207ff67bc1c6d`, `2026-08-30T14:40:00.000Z → 14:50:00.000Z` (10 min ≤ teto 15 min) |
| ~14:1x | Revisão independente do diff ON: **APROVADO, P0=0, P1=0** (6/6 itens confirmados; P2 informativos — incl. gate de cancelamento de homologação que deriva da mesma constante, verificado sem caminho de invocação em `app/`) |
| 14:1x–14:26 | PR #128: checks 12/12 verdes → merge por merge commit → `main = 4050c7f` |
| 14:35:32 | FASE 4: deployment Production ON `dpl_7ieh8BhM…` READY, alias canônico `omni-gestao-pro.vercel.app` apontando para ele |
| 14:37:12 | Login ADMIN via mecanismo existente (NextAuth credentials, `admin@rafacell.com.br`/`loja-1`, cookie apenas em jar temporário local — nunca impresso) |
| **14:40:13** | **FASE 5: a ÚNICA chamada administrativa** — `POST /api/fiscal/wsdl/ephemeral-execution?storeId=loja-1` no host canônico → **HTTP 409 `{"ok":false,"code":"activation_unavailable"}`** |
| 14:41:51 | FASE 6: commit OFF `dcbf88b` (null/null/null restaurado) → PR #129 → checks verdes → merge `940b4be` |
| 14:56 | Deploy Production OFF `dpl_57nNcKPv…` READY; alias canônico promovido ao OFF |
| 14:56 | Inventário + remoção: deployments ON (`mypwkbf6w` production, `gwk1jc708` preview) **REMOVIDOS** com sucesso da Vercel |

## Resultado da execução

- **WSDL_ADMIN_CALL_COUNT = 1** (exatamente uma; sem retry)
- **WSDL_EXTERNAL_GET_COUNT = 0** · **SEFAZ_SOAP_POST_COUNT = 0** · **SEFAZ_PRODUCTION_REQUEST_COUNT = 0**
- A resposta 409 `activation_unavailable` provém do último guard da rota (consumo do one-shot);
  todos os guards anteriores PASSARAM: janela ativa ✓, superfície canônica ✓, ACL ADMIN ✓,
  request fechada ✓, piloto `loja-1` resolvida e única ✓, config 132 (`STUB_HOMOLOGACAO` +
  `fiscalEnabled=false` + certificado) ✓, `resolveActiveCertificate` OK ✓ (prova REAL do A1 em
  produção: ATIVO/vigente/refs/cofre — a evidência humana do DB foi confirmada pelo runtime),
  A1 SecureContext aberto ✓.
- **Nenhum documento WSDL bruto foi recebido, persistido ou visto.** `RAW_WSDL_PERSISTED = false`.
- Nenhum segredo (cookie, token, senha, PFX, ref) foi extraído ou impresso; jar de sessão
  temporário apagado após o uso.

## Causa raiz (diagnóstico offline pós-containment)

`P2010 — "Failed to deserialize column of type 'void'"` — em
`lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts` (`productiveActivationLedgerClient` →
`lockActivationScope`):

```ts
await scoped.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))`
```

`pg_advisory_xact_lock()` retorna `void`; o Prisma `$queryRaw` não desserializa colunas `void`
e lança `P2010` SEMPRE na primeira instrução da transação → rollback → colapso para
`already_consumed_or_persistence_unavailable` → 409. Reproduzido deterministicamente contra o
banco de dev com rollback intencional (zero persistência; verificado: 0 linhas após o teste).
O bug entrou no refresh do gate (1cdc108): os testes usam ledger emulado, cujo
`lockActivationScope` é no-op — a chamada de 14:40:13Z foi a primeira invocação REAL deste
caminho.

**Fix (1 linha, não aplicado neste GOAL — fora do escopo do 131):** cast de retorno, p.ex.
`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey}))::text AS lock` (verificado funcional).

**Estado do one-shot:** a transação falhou ANTES de qualquer write (e rollbacks são
garantidos) — a activation `fed207ff…` NÃO foi consumida; nenhum job/log foi criado (nem em
qualquer loja). A janela expirou às 14:50:00Z e a activation está na lista de proibidas do
teste de dormência (commit OFF `dcbf88b`).

## Containment (FASE 6) — completo

- Commit OFF `dcbf88b`: `{null, null, null}` restaurado + teste de dormência reestabelecido
  (activation de 30/08 adicionada às proibidas) → PR #129 → merge `940b4be` → deploy
  Production `dpl_57nNcKPv…` READY → alias canônico no OFF.
- Deployments contendo a config ON: **2 encontrados, 2 removidos** (`vercel rm` bem-sucedido;
  nenhum relacionado restante). `ACTIVE_ON_DEPLOYMENTS_REMAINING = 0`.
- Defesa em profundidade residual: qualquer cópia hipotética do commit ON estaria morta por
  relógio (`expiresAtUtc = 14:50:00Z` no passado, permanente; `evaluateWsdlExecutionWindow` →
  `expired` → 404 antes de ACL/Prisma/A1/socket).
- Gate OFF confirmado em todos os caminhos executáveis: produção canônica (código OFF), sem
  deployment ON acessível, sem janela futura configurada.

## Classificação (GOAL 131)

**B-EXTERNAL-EVIDENCE** — evidência externa parcial (nenhum dos 6 serviços retornou documento;
falha determinística de infraestrutura interna ANTES da rede). H-9/H-10 permanecem **ABERTOS**.
Não houve repetição de chamada, não houve SOAP/emissão, não houve produção, não houve exposição
de segredo, o deployment ON foi removido (não abandonado), o GOAL 020 permanece RUNNING e o
GOAL 021 não foi iniciado ⇒ **não-D**.

Próximo passo sugerido (exige novo GOAL/gate humano): aplicar o fix de 1 linha do
`lockActivationScope`, validar com transação real (rollback) e re-solicitar nova janela.
