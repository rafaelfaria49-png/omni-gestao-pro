# FISCAL-NFCE-INVALIDATION-019

Trilha `fiscal` · GOAL 019 · inutilização NFC-e.

- Branch: `goal/fiscal-019-nfce-inutilizacao`
- Worktree: `C:/Projetos/omni-gestao-fiscal-019-inutilizacao`
- Base: `a2bf6b0179b1b4f1468fd0f023ce569326d30dfe`
- Relatório: `docs/fiscal/FISCAL_019_INUTILIZACAO_NFCE_INVALIDATION_REPORT.md`
- G-C7: FECHAVEL_INTERNO
- Homologação SEFAZ ao vivo: pendente (H-9/H-10)

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

