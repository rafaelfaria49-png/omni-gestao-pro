<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017",
  "track": "contador",
  "title": "Alertas internos e rascunhos do Contador HUB (sem envio externo)",
  "status": "READY",
  "class": "C2",
  "risk_tier": "MEDIO",
  "branch": "goal/contador-017-omni-agent-integration",
  "worktree": "/workspace",
  "test_command": "npm run typecheck",
  "allowlist": [
    "lib/contador/notificacoes/**",
    "lib/contador/__tests__/notificacoes/**",
    "app/api/contador/notificacoes/**",
    "components/dashboard/contador/avisos/**",
    "components/dashboard/contador/contador-hub-preview.tsx",
    "components/dashboard/contador/contador-hub-honesty.test.ts",
    "app/dashboard/contador/page.tsx",
    "docs/contador/OMNI_AGENT_CONTRATO_017.md",
    "docs/status/MOCKS_TRACKING.md"
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
      "autorizacao": "AUTORIZO o GOAL 017: merge docs-only do PR #83; baseline AEP docs-only em main; implementação completa na branch dedicada goal/contador-017-omni-agent-integration; commit e push somente dessa branch. Sem envio externo, sem alteração WhatsApp/Omni Agent, sem schema/migration, sem merge da feature em main, sem fechamento do GOAL 017.",
      "registrado_por": "humano na sessao Cursor (GOAL CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017)",
      "em": "2026-08-19T16:52:00Z"
    }
  }
}
-->

# CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017 — Alertas internos e rascunhos do Contador HUB (sem envio externo)

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-017-omni-agent-integration`
- teste: `npm run typecheck`
- canal: classificação B · `EXTERNAL_SEND_ALLOWED=false` · schema: não

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `comandos`: `import/contador/COMANDOS.md`
- `masterplan`: `import/contador/MASTERPLAN.md`
- `relatorios`: `import/contador/reports/`
- `resumo_canonico`: `import/contador/RESUMO.md`
- auditoria Passo 0: `docs/contador/CONTADOR_HUB_OMNI_AGENT_CHANNEL_AUDIT_017.md`

## Allowlist

A gramática AEP não aceita glob `*`. O padrão humano `lib/contador/__tests__/notificacoes*.test.ts` foi materializado como diretório `lib/contador/__tests__/notificacoes/**`.

- `lib/contador/notificacoes/**`
- `lib/contador/__tests__/notificacoes/**`
- `app/api/contador/notificacoes/**`
- `components/dashboard/contador/avisos/**`
- `components/dashboard/contador/contador-hub-preview.tsx`
- `components/dashboard/contador/contador-hub-honesty.test.ts`
- `app/dashboard/contador/page.tsx`
- `docs/contador/OMNI_AGENT_CONTRATO_017.md`
- `docs/status/MOCKS_TRACKING.md`

## Fora de escopo

- `prisma/**` · `lib/omni-agent/**` · `lib/whatsapp/**` · `lib/automation/**` · `app/api/whatsapp/**` · `auth.ts` · `proxy.ts`
- envio externo (Meta / e-mail / Telegram) · rota `/enviar` · evento `mensagem_enviada`
- merge da feature em `main` · close deste GOAL

## Critério de pronto

- Alertas internos derivados de fontes reais (010/012/016): documento pendente, fechamento próximo, guia vencendo/vencida, pacote com pendências, `alteracao_pos_fechamento`.
- GET `/api/contador/notificacoes` somente leitura (zero INSERT/UPDATE).
- POST `/avaliar` persiste só `alerta_emitido` novos, com dedupe atômico.
- POST `/[id]/tratar` grava `alerta_tratado` (idempotente).
- GET `/[id]/rascunho` gera rascunho pt-BR (ação = copiar; envio = proibido).
- Central real no HUB existente; sem botão Enviar.
- Contrato Omni publicado; Omni Core intocado.
- `EXTERNAL_SEND_ALLOWED=false`.
