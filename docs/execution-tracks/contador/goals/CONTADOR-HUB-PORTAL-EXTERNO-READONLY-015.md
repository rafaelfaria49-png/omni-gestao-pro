<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015",
  "track": "contador",
  "title": "Portal externo read-only do contador",
  "status": "READY",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/contador-015-portal-externo-readonly",
  "worktree": "C:/Projetos/contador-014-identidade-convite",
  "test_command": "npm run typecheck",
  "allowlist": [
    "app/contador-externo/**",
    "app/api/contador-externo/**",
    "components/contador-externo/**",
    "lib/contador/portal/**",
    "lib/contador/scope-core.ts",
    "proxy.ts",
    ".env.example",
    "docs/contador/**",
    "docs/status/MOCKS_TRACKING.md",
    "docs/ai-execution/_evidence/**"
  ],
  "gates_liberados": [],
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
  ]
}
-->

# CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 — Portal externo read-only do contador

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-015-portal-externo-readonly`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `comandos`: `import/contador/COMANDOS.md`
- `masterplan`: `import/contador/MASTERPLAN.md`
- `relatorios`: `import/contador/reports/`
- `resumo_canonico`: `import/contador/RESUMO.md`

## Allowlist

- `app/contador-externo/**`
- `app/api/contador-externo/**`
- `components/contador-externo/**`
- `lib/contador/portal/**`
- `lib/contador/scope-core.ts`
- `proxy.ts`
- `.env.example`
- `docs/contador/**`
- `docs/status/MOCKS_TRACKING.md`
- `docs/ai-execution/_evidence/**`

## Critério de pronto

- <PREENCHER>
