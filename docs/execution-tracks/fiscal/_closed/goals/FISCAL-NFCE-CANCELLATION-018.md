<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "FISCAL-NFCE-CANCELLATION-018",
  "track": "fiscal",
  "title": "Cancelamento fiscal de NFC-e autorizada (evento SEFAZ idempotente)",
  "status": "READY",
  "class": "C3",
  "risk_tier": "ALTO",
  "branch": "goal/fiscal-018-nfce-cancellation",
  "worktree": "C:/Projetos/omni-gestao-fiscal-018-cancellation",
  "test_command": "npx vitest run lib/fiscal/events lib/fiscal/provider/sefaz/sefaz-cstat-matrix.test.ts lib/fiscal/provider/sefaz/sefaz-direto-provider.test.ts lib/fiscal/provider/provider.test.ts lib/fiscal/venda-fiscal-state-machine.test.ts app/api/fiscal --reporter=dot",
  "allowlist": [
    "lib/fiscal/**",
    "app/api/fiscal/**",
    "docs/fiscal/**",
    "docs/architecture/FISCAL_EVENTS.md",
    "docs/architecture/NFCE_ARCHITECTURE.md",
    "docs/ai/CURRENT_STATUS.md",
    "docs/ai-execution/_evidence/**",
    "docs/decisions/**"
  ],
  "gates_liberados": [],
  "read_budget": 80,
  "plan_ref": "FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001",
  "plan_rev": 1,
  "familia_executor": "grok",
  "revisao_independente": true,
  "reversibilidade": "evento fiscal persistido é histórico; correção é novo evento, nunca rewrite de XML autorizado",
  "gates_extra": [],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "GOAL canônico 018 do Fable 5: FISCAL-NFCE-CANCELLATION-018. Commit/push/PR autorizados. Sem merge na main. Sem schema. Sem produção. Sem GOAL 019.",
      "registrado_por": "humano na sessao Grok Build (GOAL FISCAL-NFCE-CANCELLATION-018)",
      "em": "2026-08-25T00:00:00Z"
    }
  }
}
-->

# FISCAL-NFCE-CANCELLATION-018 — Cancelamento fiscal de NFC-e autorizada

- trilha: `fiscal` (não `contador`)
- classe: C3 · status: READY
- plano: `FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/fiscal-018-nfce-cancellation`
- worktree: `C:/Projetos/omni-gestao-fiscal-018-cancellation`
- teste: vitest focado em events/provider/guards + rotas `/api/fiscal`

## Objetivo

Fechar o cancelamento fiscal de NFC-e autorizada: evento SEFAZ idempotente, prazo/condições
oficiais (Portaria CAT 12/2015 art. 14 — 30 minutos), efeitos corretos em NotaFiscal/Venda,
fluxo administrativo, matriz de guards, auditoria FiscalLog e **zero escrita automática**
no Financeiro/Caixa.

## Contrato

Cancelamento comercial ≠ cancelamento fiscal.

Identidade do evento: `(notaFiscalId, tipo, sequencia)`.

Após autorização do cancelamento:

- `NotaFiscal`: AUTORIZADA → CANCELADA
- `Venda`: → CANCELADA_FISCAL

Snapshot e XML autorizado permanecem históricos e imutáveis.

## Fora de escopo

- Inutilização, CC-e, contingência, DANFCE, produção, SAT.
- SIPET / cancelamento extemporâneo automático.
- Estorno financeiro automático.
- Merge na main.
- GOAL 019 e Contador 018.
