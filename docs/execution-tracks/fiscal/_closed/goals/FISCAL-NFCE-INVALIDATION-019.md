<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "FISCAL-NFCE-INVALIDATION-019",
  "track": "fiscal",
  "title": "Inutilização NFC-e de número/faixa consumida — número jamais reutilizado (reconciliação sobre main pós-GOAL-018)",
  "status": "READY",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/fiscal-019-reconcile-current-main-117",
  "worktree": "C:/Projetos/omni-gestao-fiscal-019-reconcile-117",
  "test_command": "npx vitest run lib/fiscal/inutilizacao",
  "allowlist": [
    "lib/fiscal/**",
    "app/api/fiscal/**",
    "app/api/internal/fiscal/**",
    "scripts/fiscal/**",
    "docs/fiscal/**",
    "docs/ai/CURRENT_STATUS.md",
    "docs/ai-execution/_evidence/**",
    "docs/execution-tracks/fiscal/goals/FISCAL-NFCE-INVALIDATION-019.md",
    "docs/architecture/FISCAL_EVENTS.md",
    "docs/architecture/NFCE_ARCHITECTURE.md"
  ],
  "gates_liberados": [],
  "read_budget": 80,
  "plan_ref": "FISCAL-FABLE5-CANONICAL-ROADMAP",
  "plan_rev": 1,
  "familia_executor": null,
  "revisao_independente": false,
  "reversibilidade": null,
  "gates_extra": [
    {
      "id": "sefaz_homologacao",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "schema",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "production",
      "status": "pendente",
      "dependencias": []
    }
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "Reconciliação FISCAL-019-RECONCILE-CURRENT-MAIN-117: materializar/abrir FISCAL-NFCE-INVALIDATION-019 sobre a main atual (ce1b993, pós-GOAL-018) pelo protocolo oficial scripts/track.mjs. Preservar integralmente o cancelamento 018 e as correções finais do 019. Schema/migration/auth/proxy/produção/homologação SEFAZ NÃO liberados. Sem merge neste GOAL.",
      "registrado_por": "prompt de execução FISCAL-019-RECONCILE-CURRENT-MAIN-117 nesta sessão",
      "em": "2026-08-27T00:00:00Z"
    }
  }
}
-->

# FISCAL-NFCE-INVALIDATION-019 — Inutilização NFC-e de número/faixa consumida — número jamais reutilizado (reconciliação sobre main pós-GOAL-018)

- trilha: `fiscal`
- classe: C2 · status: READY
- plano: `FISCAL-FABLE5-CANONICAL-ROADMAP` (plan_rev 1)
- branch: `goal/fiscal-019-reconcile-current-main-117`
- teste: `npx vitest run lib/fiscal/inutilizacao`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `adr-estado-incerto`: `docs/decisions/ADR-0017-estado-incerto-reconciliacao-por-chave.md`
- `dossie`: `docs/fiscal/FISCAL_SEFAZ_DOSSIE_UF_001.md`
- `eventos`: `docs/architecture/FISCAL_EVENTS.md`
- `masterplan`: `docs/governance/MASTER_FISCAL_EXECUTION_PLAN.md`
- `numeracao`: `docs/fiscal/FISCAL_NUMBERING_SERIES_REPORT_001.md`

## Allowlist

- `lib/fiscal/**`
- `app/api/fiscal/**`
- `app/api/internal/fiscal/**`
- `scripts/fiscal/**`
- `docs/fiscal/**`
- `docs/ai/CURRENT_STATUS.md`
- `docs/ai-execution/_evidence/**`
- `docs/execution-tracks/fiscal/goals/FISCAL-NFCE-INVALIDATION-019.md`
- `docs/architecture/FISCAL_EVENTS.md`
- `docs/architecture/NFCE_ARCHITECTURE.md`

## Critério de pronto

- <PREENCHER>
