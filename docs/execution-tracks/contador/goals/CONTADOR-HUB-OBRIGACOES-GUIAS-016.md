<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-OBRIGACOES-GUIAS-016",
  "track": "contador",
  "title": "Obrigações e guias manuais do Contador HUB",
  "status": "READY",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/contador-016-obrigacoes",
  "worktree": "/workspace",
  "test_command": "npm run typecheck",
  "allowlist": [
    "prisma/schema.prisma",
    "prisma/migrations/0017_contador_agenda/**",
    "lib/contador/agenda/**",
    "lib/contador/fechamento/montar-checklist.ts",
    "lib/contador/fechamento/montar-checklist.test.ts",
    "app/api/contador/agenda/**",
    "app/dashboard/contador/page.tsx",
    "components/dashboard/contador/**",
    "docs/status/MOCKS_TRACKING.md",
    "docs/contador/**",
    "docs/ai-execution/_evidence/**"
  ],
  "gates_liberados": [
    "G-DADOS-SCHEMA"
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
      "autorizacao": "AUTORIZO G-DADOS-SCHEMA exclusivamente para o GOAL 016, limitado a: alteração aditiva do schema aprovada no PLAN REV2; criação da migration local correspondente; implementação completa do GOAL na branch/worktree dedicada; testes; commit local; push somente da branch do GOAL.",
      "registrado_por": "humano na sessao Cursor (GOAL CONTADOR-HUB-OBRIGACOES-GUIAS-016)",
      "em": "2026-08-19T04:18:00Z"
    }
  }
}
-->

# CONTADOR-HUB-OBRIGACOES-GUIAS-016 — Obrigações e guias manuais do Contador HUB

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-016-obrigacoes`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `comandos`: `import/contador/COMANDOS.md`
- `masterplan`: `import/contador/MASTERPLAN.md`
- `relatorios`: `import/contador/reports/`
- `resumo_canonico`: `import/contador/RESUMO.md`

## Allowlist

- `prisma/schema.prisma`
- `prisma/migrations/0017_contador_agenda/**`
- `lib/contador/agenda/**`
- `lib/contador/fechamento/montar-checklist.ts`
- `lib/contador/fechamento/montar-checklist.test.ts`
- `app/api/contador/agenda/**`
- `app/dashboard/contador/page.tsx`
- `components/dashboard/contador/**`
- `docs/status/MOCKS_TRACKING.md`
- `docs/contador/**`
- `docs/ai-execution/_evidence/**`

## Critério de pronto

- <PREENCHER>
