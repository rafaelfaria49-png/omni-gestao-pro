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

- Família distinta (GLM, read-only), pós-correção do blocker.
- (veredito registrado após a execução da revisão)
