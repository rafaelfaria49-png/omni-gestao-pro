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

Implementação read-only do GOAL 018 no runtime local HOMOLOGACAO (estratégia B + reader A). **Não ratificar/fechar** se `FISCAL_RUNTIME_VALIDATABLE != true`.

- [x] `lib/contador/readers/fiscal.ts` — SELECT Prisma side-effect-free; não chama `fiscalXmlReader.readAuthorizedDocument`; não grava FiscalLog/EventoFiscal/NotaFiscal.
- [x] Flag `CONTADOR_FISCAL_READER` default off; liga só com valor exato `"on"`; allowlist env-only `CONTADOR_FISCAL_READER_STORE_ALLOWLIST` (sem schema). Flag off / loja fora / config inválida → `nao_disponivel` (nunca “zero notas”).
- [x] Predicado ADR-007: `storeId` do scope + allowlisted + vigente + AUTORIZADA + HOMOLOGACAO + protocolo/chave/`xmlAutorizado` não vazios + `dhEmi` extraído do XML parseável no período canônico. Sem fallback para `dataAutorizacao`/`createdAt`/snapshot/`dataEmissao`.
- [x] REJEITADA/CANCELADA/PRODUCAO nunca entram em `05-XML`; rejeitadas e canceladas geram sinal no checklist.
- [x] Pacote: XML = texto UTF-8 persistido; nome `05-XML/{chaveAcesso}.xml`; sha256 do manifesto; placeholder quando flag off; `MAX_ARQUIVOS_PACOTE=15` sem truncar.
- [x] Relatório fiscal mínimo somente leitura (sem emissão/cancelamento/inutilização/correção/reprocessamento).
- [x] Prova runtime: Prisma → reader A → predicado → checklist → builder → manifest/hash → `05-XML` na massa homolog (1 AUTORIZADA/HOMOLOGACAO entregável). FiscalLog=0 · EventoFiscal=0.
- [x] `HOMOLOGATION_STRATEGY_SELECTED=B` · `PURE_READER_STRATEGY_SELECTED=A` · `FISCAL_RUNTIME_VALIDATABLE=true` · `PRODUCTION_XML_ELIGIBLE=false` · `SCHEMA_CHANGED=false` · `SEFAZ_NETWORK_USED=false`.
- [ ] Revisão independente (não mergear / não `track close` nesta entrega).
