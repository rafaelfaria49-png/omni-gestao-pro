<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013",
  "track": "contador",
  "title": "Auditoria do Portal Externo do Contador",
  "status": "DONE",
  "class": "C2",
  "risk_tier": "ALTO",
  "branch": "origin/main",
  "worktree": "<PREENCHER>",
  "test_command": "npm run typecheck",
  "allowlist": [
    "docs/contador/**",
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
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "AUTORIZO O PUSH FAST-FORWARD DA AUDITORIA DO CONTADOR 013 E SUA RECONCILIACAO AEP PARA ORIGIN/MAIN",
      "registrado_por": "humano na sessao Kimi K3 (chat)",
      "em": "2026-07-31T20:45:41.872Z"
    }
  }
}
-->

# CONTADOR-HUB-PORTAL-EXTERNO-AUDIT-013 — Auditoria do Portal Externo do Contador

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

- `docs/contador/**`
- `docs/ai-execution/_evidence/**`

## Proveniência

- importado de `CONTADOR-HUB-FABLE5-MASTERPLAN-001` em 2026-07-31T20:46:01.037Z
- commit confirmado: `0ef448ce5f669b7b25b40245507da14da488cf84` na branch `origin/main`
- evidência: `git merge-base --is-ancestor 0ef448ce5f669b7b25b40245507da14da488cf84 origin/main` → commit existe e está na branch declarada
