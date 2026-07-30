<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN",
  "track": "contador",
  "title": "<PREENCHER>",
  "status": "BLOCKED",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "goal/contador-MAIN-<slug>",
  "worktree": "<PREENCHER>",
  "test_command": "npm run typecheck",
  "allowlist": [
    "app/dashboard/contador/**",
    "app/contador/**",
    "app/login-contador/**",
    "app/api/contador/**",
    "components/dashboard/contador/**",
    "lib/contador/**",
    "docs/contador/**",
    "prisma/schema.prisma",
    "prisma/migrations/0014_contador_hub_nucleo/**"
  ],
  "gates_liberados": [],
  "read_budget": 8,
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
    "pendente": true,
    "motivo": "gate humano exigido pelo manifesto; nenhuma evidência de aprovação registrada",
    "decisao": "HUMAN_PUSH_AUTHORIZATION_NOT_SENT"
  }
}
-->

# CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN — <PREENCHER>

- trilha: `contador`
- classe: C2 · status: BLOCKED
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-MAIN-<slug>`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `comandos`: `import/contador/COMANDOS.md`
- `masterplan`: `import/contador/MASTERPLAN.md`
- `relatorios`: `import/contador/reports/`
- `resumo_canonico`: `import/contador/RESUMO.md`

## Allowlist

- `app/dashboard/contador/**`
- `app/contador/**`
- `app/login-contador/**`
- `app/api/contador/**`
- `components/dashboard/contador/**`
- `lib/contador/**`
- `docs/contador/**`
- `prisma/schema.prisma`
- `prisma/migrations/0014_contador_hub_nucleo/**`

## Gate humano pendente — BLOCKED

- motivo: gate humano exigido pelo manifesto; nenhuma evidência de aprovação registrada
- decisão humana requerida: `HUMAN_PUSH_AUTHORIZATION_NOT_SENT`
- este GOAL NÃO está READY, NÃO é elegível e NÃO pode ser aberto por track.mjs.
- ausência de aprovação NÃO libera o GOAL — a liberação exige evidência explícita registrada pelo fluxo oficial do AEP.
