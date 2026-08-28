# FISCAL-NFCE-INVALIDATION-019

Trilha `fiscal` · GOAL 019 · inutilização NFC-e.

- Branch: `goal/fiscal-019-reconcile-current-main-117`
- Worktree: `C:/Projetos/omni-gestao-fiscal-019-reconcile-117`
- Base: `ce1b993591d9953b5960de654cb172074bb2fb3d` (main pós-GOAL-018)
- Relatório: `docs/fiscal/FISCAL_019_INUTILIZACAO_NFCE_INVALIDATION_REPORT.md`
- G-C7: FECHAVEL_INTERNO
- Homologação SEFAZ ao vivo: pendente (H-9/H-10)

## Reconciliação (2026-08-27)

Reconstrução do GOAL 019 sobre a main atual (`ce1b993`), substituindo a PR #114 (base
`a2bf6b0`, divergida). Os 7 commits de implementação foram reaplicados em ordem via
cherry-pick com resolução semântica de conflitos (assinaturas do provider 018+019
coexistem; superfície inerte recalibrada); os módulos-base criados no bootstrap antigo
foram materializados no conteúdo final `f15b71a`. Estado AEP canônico da main preservado
(018 DONE · ledger 1 linha · current_goal 019). Gate externo de homologação SEFAZ
permanece fechado.

## Closeout (2026-08-27)

Revisão independente final (outra família) sobre o head `8b6a581`; achados corrigidos na mesma branch:

- P0: atalho "EventoFiscal AUTORIZADO" baixava faixa sem vínculo comprovado com a nota/número
  do job — agora exige `nota.serie === payload.serie && nota.numero === numeroInicial === numeroFinal`
  (`execute.ts`); sem vínculo, transmite.
- P1: freio GOAL-011 do coordenador reescrevia resultado real de `INUTILIZACAO` como
  `provider_real_bloqueado` — `INUTILIZACAO` isenta do freio no `queue-worker.ts`
  (EMISSAO/CONSULTA continuam freados; teste de regressão dos dois lados).
- P2: EventoFiscal só nasce de transmissão real (fonte simulada não persiste evento);
  lacunas da alocação na reemissão agora são enfileiradas para inutilização;
  `SignedInfo` exige exatamente uma `Reference`; enqueue de lacunas da emissão não aborta
  o pipeline (log de compensação).
- P1 (CI): `createInutilizacaoXmlSigner` tipada como factory síncrona — resolvia os 6 erros
  TS que deixavam o workflow "Unit and contract" vermelho no head `8b6a581`.

Validações: 584 testes focados verdes (4 skips xmllint cobertos no CI Ubuntu); typecheck,
lint e build verdes; workflows fiscais locais ok (xsd hashes, provider/sefaz 410, dry-run gate).

