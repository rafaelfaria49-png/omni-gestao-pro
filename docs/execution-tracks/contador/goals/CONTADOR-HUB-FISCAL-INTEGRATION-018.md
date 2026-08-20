<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-FISCAL-INTEGRATION-018",
  "track": "contador",
  "title": "Integração fiscal read-only do Contador (HOMOLOGACAO)",
  "status": "READY",
  "class": "C2",
  "risk_tier": "MEDIO",
  "branch": "cursor/contador-fiscal-integration-018-47d9",
  "worktree": "/workspace",
  "test_command": "npm run typecheck",
  "allowlist": [
    "lib/contador/readers/fiscal.ts",
    "lib/contador/__tests__/fiscal/**",
    "lib/contador/fechamento/montar-checklist.ts",
    "lib/contador/fechamento/montar-checklist.test.ts",
    "lib/contador/pacote/**",
    "lib/contador/homologation/**",
    "app/dashboard/contador/page.tsx",
    "components/dashboard/contador/**",
    ".env.example",
    "docs/status/MOCKS_TRACKING.md",
    "docs/ai/CURRENT_STATUS.md",
    "docs/contador/**",
    "docs/ai-execution/_evidence/**",
    "docs/execution-tracks/contador/goals/CONTADOR-HUB-FISCAL-INTEGRATION-018.md"
  ],
  "gates_liberados": [
    "G-CONFIG-DEPLOY"
  ],
  "read_budget": 60,
  "plan_ref": "CONTADOR-HUB-FABLE5-MASTERPLAN-001",
  "plan_rev": 1,
  "familia_executor": null,
  "revisao_independente": false,
  "reversibilidade": null,
  "gates_extra": [
    {
      "id": "main",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "schema",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "migration",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "auth_externa",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "storage_r2_preview",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "storage_r2_production",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "fiscal_readonly",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "portal_legado",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "dados_destrutivos",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "secrets",
      "status": "pendente",
      "dependencias": []
    },
    {
      "id": "deploy",
      "status": "pendente",
      "dependencias": []
    }
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "AUTORIZO O IMPORT/OPEN E A IMPLEMENTACAO DO GOAL CONTADOR-HUB-FISCAL-INTEGRATION-018, INCLUINDO G-CONFIG-DEPLOY SOMENTE PARA .env.example (CONTADOR_FISCAL_READER default off + allowlist env-only). Sem schema, sem Production, sem SEFAZ.",
      "registrado_por": "humano na sessao Cursor Cloud (GOAL CONTADOR-HUB-FISCAL-INTEGRATION-018)",
      "em": "2026-08-20T04:07:00Z"
    }
  }
}
-->

# CONTADOR-HUB-FISCAL-INTEGRATION-018 — Integração fiscal read-only do Contador (HOMOLOGACAO)

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `cursor/contador-fiscal-integration-018-47d9`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `adr`: `docs/contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md`
- `comandos`: `docs/contador/CONTADOR_HUB_COMMANDS_001.md`
- `homologacao`: `docs/contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md`
- `resumo_canonico`: `docs/contador/CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md`

## Allowlist

- `lib/contador/readers/fiscal.ts`
- `lib/contador/__tests__/fiscal/**`
- `lib/contador/fechamento/montar-checklist.ts`
- `lib/contador/fechamento/montar-checklist.test.ts`
- `lib/contador/pacote/**`
- `lib/contador/homologation/**`
- `app/dashboard/contador/page.tsx`
- `components/dashboard/contador/**`
- `.env.example`
- `docs/status/MOCKS_TRACKING.md`
- `docs/ai/CURRENT_STATUS.md`
- `docs/contador/**`
- `docs/ai-execution/_evidence/**`
- `docs/execution-tracks/contador/goals/CONTADOR-HUB-FISCAL-INTEGRATION-018.md`

## Critério de pronto

- <PREENCHER>
