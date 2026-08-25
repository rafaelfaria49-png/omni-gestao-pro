# Evidência — FISCAL-NFCE-CANCELLATION-018

- GOAL: `FISCAL-NFCE-CANCELLATION-018`
- Trilha: `fiscal` (não `contador`)
- Branch: `goal/fiscal-018-nfce-cancellation`
- Worktree: `C:/Projetos/omni-gestao-fiscal-018-cancellation`
- Base: `a2bf6b0179b1b4f1468fd0f023ce569326d30dfe` (`origin/main`)

## Entrega

- Evento `NFeRecepcaoEvento4` no adapter SEFAZ (`SefazDiretoProvider.cancelar`).
- `cStat 101` (e `135`) na matriz, restritos ao serviço de evento — não são autorização de uso.
- Serviço `cancelarNfceAutorizada`: identidade `(notaFiscalId, CANCELAMENTO, 1)`, prazo 30 min, FiscalLog, transições, XML imutável.
- Rota `POST /api/fiscal/notas/[id]/cancelar` (admin). Distinta de `/api/vendas/[id]/cancelar`.
- `FINANCE_WRITE_COUNT=0` (serviço e rota não importam Financeiro/Caixa).

## Homologação externa

Janela H-9/H-10 `2026-08-24T18:00:00Z`–`18:10:00Z` expirada em 2026-08-25. Caminho interno pronto. Sem chamada SEFAZ real neste GOAL.
