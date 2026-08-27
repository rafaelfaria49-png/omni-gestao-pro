# Evidência — FISCAL-NFCE-CANCELLATION-018

- GOAL: `FISCAL-NFCE-CANCELLATION-018`
- Trilha: `fiscal` (não `contador`)
- Branch: `goal/fiscal-018-nfce-cancellation`
- Worktree: `C:/Projetos/omni-gestao-fiscal-018-cancellation`
- Base: `a2bf6b0179b1b4f1468fd0f023ce569326d30dfe` (`origin/main`)

## Entrega

- Evento `NFeRecepcaoEvento4` no adapter SEFAZ (`SefazDiretoProvider.cancelar`).
- `cStat 135` (evento registrado) é o único desfecho que autoriza persistência no webservice
  de eventos; `101` é status de **documento** na consulta (matriz 018.2: `SERVICOS_DE_CONSULTA`).
- Serviço `cancelarNfceAutorizada`: identidade `(notaFiscalId, CANCELAMENTO, 1)`, prazo 30 min
  (Portaria SRE 40/2024 + Ajuste SINIEF 19/16; CAT 12/2015 revogada), FiscalLog, transições,
  XML imutável.
- Rota `POST /api/fiscal/notas/[id]/cancelar` (admin). Distinta de `/api/vendas/[id]/cancelar`.
- `FINANCE_WRITE_COUNT=0` (serviço e rota não importam Financeiro/Caixa).

## Correção do blocker de runtime (pós-1ª revisão)

- `createSefazDiretoCancelamentoRuntime` (`lib/fiscal/events/cancelamento-sefaz-runtime.ts`):
  única fábrica do caminho administrativo persistido. Reusa a composição 016/017 —
  `SefazDiretoProvider` + `SefazSoapTransport` + guards D4 (modo `evento`) +
  `resolveActiveCertificate` + EnvVault/A1 (`loadPkcs12`) + material de assinatura.
  `SEFAZ_DIRETO` NÃO entra no REGISTRY P1 (instanciação direta).
- Fallback silencioso para `stubHomologacaoProvider` removido de
  `cancelarNfceAutorizadaPersistido`/`createPrismaCancelamentoPorts` (provider passa a ser
  obrigatório; ausente ⇒ composição real; STUB/incompatível/sem A1 ⇒ recusa antes de
  qualquer transição fiscal).
- `vereditoPersistenciaCancelamento`: resposta `simulado=true` nunca persiste;
  só `ok=true` + `cStat 135` persiste; `573` exige autorização local prévia; rejeição
  definitiva (3 dígitos) e incerto/timeout falham sem mutar NotaFiscal/Venda.
- Guards: modo `evento` roda tpAmb + SHA-256 dos bytes assinados; atestado XSD de
  `nfe_v4.00` é inaplicável a `envEvento`.

## Homologação externa

Janela H-9/H-10 `2026-08-24T18:00:00Z`–`18:10:00Z` expirada em 2026-08-25. Caminho interno pronto. Sem chamada SEFAZ real neste GOAL.

## Revisão independente

1ª revisão: família distinta (grok-4.5, read-only). Veredito **A**. P0/P1: nenhum.
`FINANCE_WRITE_COUNT=0`.
Revisão final (runtime real): glm, read-only — ver seção "Revisão final" abaixo.

## Revisão final (runtime real)

- Família distinta (GLM, read-only), pós-correção do blocker. **Veredito A** — P0: nenhum.
- Achados P1 corrigidos nesta execução:
  - P1.1 race de duplo-submit com 573/timeout tardio podia rebaixar EventoFiscal
    AUTORIZADO→REJEITADO. Corrigido: re-leitura do evento antes de persistir qualquer
    rejeição; AUTORIZADO local reconverge (`evento.cancelamento.reconvergido`) e nunca
    é rebaixado.
  - P1.2 573 sem autorização local era rejeição definitiva (422). Corrigido: classificado
    como **incerto** (409, `evento_duplicado_sem_autorizacao_local`) com mensagem exigindo
    consulta do protocolo na SEFAZ.
- Achados P2 corrigidos nesta execução:
  - P2.1 `cstat-cancelamento.test.ts` não versionado — commitado.
  - P2.2 reabrir PENDENTE não zerava cStat/xMotivo/protocolo/XMLs da tentativa anterior —
    porta Prisma agora zera ao reabrir PENDENTE.
  - P2.3 serviço não validava `nota.modelo === NFCE` — bloqueio `modelo_nao_suportado`.
  - P2.4 `xmlEvento`/`xmlRetorno` nunca persistidos — provider retorna ambos em `dados`
    e o serviço os grava no EventoFiscal (registro probatório).
- Revalidação pós-correções: 280 testes focados verdes (18 arquivos), typecheck limpo,
  lint focado limpo, build de produção ok.

## Ratificação AEP (close)

`track.mjs close fiscal` abortou nos checks 6/7/8: o bootstrap da trilha fiscal
(`3bedfcd` — protocol.json, REGISTRY, TRACK, LEDGER, state.json, goal file) foi
commitado DENTRO da branch do GOAL pela sessão de planejamento, enquanto a convenção do
repositório é bootstrap na main (cf. `9168d9d`, trilha contador). Com
`base_commit=a2bf6b0`, o diff base..HEAD sempre conterá a infra AEP — o close é
estruturalmente inexequível nesta branch antes do merge.

Procedimento de ratificação pós-merge da PR #113 (sem reescrita de história):

1. merge da PR #113 em `main` (decisão humana);
2. na worktree `C:/Projetos/omni-gestao-fiscal-018-cancellation`,
   `git fetch origin && git checkout goal/fiscal-018-nfce-cancellation`;
3. `node scripts/track.mjs open fiscal` — reancora `base_commit` no merge-base com a
   main atualizada (o diff base..HEAD esvazia e os checks 6/7/8 passam);
4. `node scripts/track.mjs close fiscal` — ratifica DONE no LEDGER.

A implementação em si está completa, revisada e validada; a pendência é exclusivamente
processual (ratificação AEP pós-merge).
