<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN",
  "track": "contador",
  "title": "<PREENCHER>",
  "status": "DONE",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "origin/main",
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
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "AUTORIZO O PUSH FAST-FORWARD DO CONTADOR 012G E SUA RECONCILIACAO AEP PARA ORIGIN/MAIN",
      "registrado_por": "humano na sessao Kimi K3 (chat)",
      "em": "2026-07-31T15:52:23Z"
    }
  }
}
-->

# CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN — <PREENCHER>

- trilha: `contador`
- classe: C2 · status: DONE
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `origin/main`
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

## Proveniência

- importado de `CONTADOR-HUB-FABLE5-MASTERPLAN-001` em 2026-07-31T15:53:54.922Z
- commit confirmado: `7f4361e52437f68c21c9748db06238d9a4412e11` na branch `origin/main`
- evidência: `git merge-base --is-ancestor 7f4361e52437f68c21c9748db06238d9a4412e11 origin/main` → commit existe e está na branch declarada
