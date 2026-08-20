<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "CONTADOR-HUB-PRODUCTION-HARDENING-019",
  "track": "contador",
  "title": "Hardening de produção do Contador — retenção, observabilidade, carga e encerramento do legado (G4)",
  "status": "READY",
  "class": "C2",
  "risk_tier": "MEDIO",
  "branch": "goal/contador-019-production-hardening",
  "worktree": "C:/Projetos/omni-gestao-contador-019",
  "test_command": "npm run typecheck",
  "allowlist": [
    "lib/contador/retencao/**",
    "lib/contador/observabilidade.ts",
    "lib/contador/observabilidade.test.ts",
    "lib/contador/legado/**",
    "lib/contador/auth/legacy-session.ts",
    "lib/contador/auth/legacy-session.test.ts",
    "app/api/auth/contador/route.test.ts",
    "app/api/contador/pacote/route.ts",
    "app/contador-externo/_portal-pagina.ts",
    "proxy.ts",
    ".env.example",
    "scripts/contador/carga-sintetica-pacote.mjs",
    "scripts/contador/retencao-dry-run.ts",
    "docs/contador/OPERACAO_CONTADOR_019.md",
    "docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md",
    "docs/status/MOCKS_TRACKING.md",
    "docs/ai/CURRENT_STATUS.md",
    "docs/ai-execution/_evidence/**",
    "docs/execution-tracks/contador/goals/CONTADOR-HUB-PRODUCTION-HARDENING-019.md"
  ],
  "gates_liberados": [
    "G-AUTH",
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
    },
    {
      "id": "retencao_apply",
      "status": "pendente",
      "dependencias": []
    }
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "G4 APROVADO por Rafael em 2026-08-20 e publicado em origin/main (6aa470a, docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md): legado encerrado por REDIRECT /contador -> portal v2, sem remocao fisica; destrava explicitamente o trecho contador do proxy.ts (G-AUTH). G-CONFIG-DEPLOY liberado SOMENTE para .env.example (default do kill-switch CONTADOR_LEGACY_PORTAL e flag CONTADOR_RETENCAO_APPLY), conforme a lista de arquivos do GOAL 019 no mesmo roadmap. Numeros de retencao aprovados: FISCAL/JURIDICO/FOLHA sem purga automatica; FINANCEIRO/OUTRO 5 anos; pacote ZIP 12 meses; blob soft-deletado 90 dias apos excluidoEm. LGPD: manter minimizacao atual, sem PII de cliente nos CSVs. Restricoes: dry-run primeiro; nunca apagar registro, evento ou trilha de auditoria; nenhuma operacao destrutiva em Production nesta execucao; APPLY nao habilitado em nenhum ambiente. SEM schema, SEM migration.",
      "registrado_por": "Rafael (decisoes G4/LGPD/retencao publicadas em 6aa470a) + prompt de execucao do GOAL 019 nesta sessao",
      "em": "2026-08-20T15:26:52Z"
    }
  }
}
-->

# CONTADOR-HUB-PRODUCTION-HARDENING-019 — Hardening de produção do Contador — retenção, observabilidade, carga e encerramento do legado (G4)

- trilha: `contador`
- classe: C2 · status: READY
- plano: `CONTADOR-HUB-FABLE5-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/contador-019-production-hardening`
- teste: `npm run typecheck`

## Fontes (documentos de origem — o importador NÃO reimplementa nada)

- `auditoria`: `docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_AUDIT_013.md`
- `comandos`: `docs/contador/CONTADOR_HUB_COMMANDS_001.md`
- `masterplan`: `docs/contador/CONTADOR_HUB_FABLE5_MASTERPLAN_001.md`
- `roadmap`: `docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`

## Allowlist

- `lib/contador/retencao/**`
- `lib/contador/observabilidade.ts`
- `lib/contador/observabilidade.test.ts`
- `lib/contador/legado/**`
- `lib/contador/auth/legacy-session.ts`
- `lib/contador/auth/legacy-session.test.ts`
- `app/api/auth/contador/route.test.ts`
- `app/api/contador/pacote/route.ts`
- `app/contador-externo/_portal-pagina.ts`
- `proxy.ts`
- `.env.example`
- `scripts/contador/carga-sintetica-pacote.mjs`
- `scripts/contador/retencao-dry-run.ts`
- `docs/contador/OPERACAO_CONTADOR_019.md`
- `docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`
- `docs/status/MOCKS_TRACKING.md`
- `docs/ai/CURRENT_STATUS.md`
- `docs/ai-execution/_evidence/**`
- `docs/execution-tracks/contador/goals/CONTADOR-HUB-PRODUCTION-HARDENING-019.md`

## Critério de pronto

Hardening de produção do Contador HUB, **sem schema** e **sem operação destrutiva em
Production**. Evidência: `docs/ai-execution/_evidence/CONTADOR-HUB-PRODUCTION-HARDENING-019.md`.
Runbook: `docs/contador/OPERACAO_CONTADOR_019.md`.

- [x] Política de retenção centralizada em `lib/contador/retencao/politica.ts`, com os
      números aprovados por Rafael e aritmética de **calendário civil** (UTC, clamp de
      fim de mês) — nunca múltiplo fixo de dias.
- [x] `FISCAL`, `JURIDICO` e `FOLHA` são `PURGE_DISABLED`: não existe caminho de código
      que produza corte por idade (o retorno é `null`, e o job nem consulta candidatos).
- [x] `FINANCEIRO`/`OUTRO` 5 anos · pacote ZIP 12 meses · blob soft-deletado 90 dias
      após `excluidoEm`. Bordas: janelas de idade exclusivas (empate protege);
      soft-delete inclusivo, conforme a decisão literal.
- [x] Job idempotente com **DRY-RUN como modo padrão**. Em dry-run a porta de escrita
      não é sequer construída — provado por porta-sentinela que lança em qualquer uso.
- [x] Dry-run reporta candidatos, blobs soft-deletados, pacotes, bytes estimados,
      protegidos pela política e erros/indisponibilidades.
- [x] APPLY só atrás de `CONTADOR_RETENCAO_APPLY=on` (valor exato). Sem a flag, falha
      **fechado** (`RetencaoApplyBloqueadoError`) — nunca cai em dry-run silencioso.
      **Flag não habilitada em nenhum ambiente nesta execução.**
- [x] Descarte atinge SOMENTE o blob: nenhum `DELETE` de `ContadorDocumento`,
      `ContadorPacote`, `ContadorPacoteItem` ou `ContadorEvento`; snapshot congelado
      intocado. A porta de escrita não expõe método capaz de fazê-lo.
- [x] Idempotência ancorada na existência do objeto no storage: 2ª execução → 0
      descartes, 0 eventos novos. Blob ausente é `ja_ausentes`, não erro fatal.
- [x] Pacote descartado permanece **regenerável**: competência, snapshot, versão,
      `manifestoHash` e `ContadorPacoteItem` preservados; regeneração pelo fluxo
      existente `GET /api/contador/pacote`.
- [x] Limites inventariados em `lib/contador/retencao/limites.ts` por arquivo,
      categoria, competência e pacote. **Nenhum número criado, elevado ou reduzido**;
      `categoria` e `competencia` declarados sem número canônico e registrados no
      runbook. Nenhum upload ilimitado novo.
- [x] `lib/contador/observabilidade.ts` com as 8 métricas nomeadas sobre o log
      estruturado existente. Labels com allowlist de chave **e** formato de valor —
      sem PII, sem `storageRef`, sem URL assinada, sem CPF/CNPJ com ou sem máscara.
- [x] Carga sintética de ~20k vendas medida e registrada (635 ms, ZIP 1,21 MB, heap
      62,3 MB, 0 falhas). **Sem SLA canônico** — resultado observado, sem threshold
      inventado.
- [x] Runbook `docs/contador/OPERACAO_CONTADOR_019.md` com políticas, dry-run, leitura
      do relatório, habilitação do APPLY, rollback, LGPD (minimização, bases legais já
      documentadas, direitos do titular-contador, art. 48, ROPA), métricas/alertas e
      checklist de produção — incluindo a ressalva de processo pendente antes do APPLY.
- [x] **G4 executado**: `/contador` e `/login-contador` redirecionam para
      `/contador-externo/login` (rota real do v2); `POST /api/auth/contador` responde
      503 pelo default invertido de `CONTADOR_LEGACY_PORTAL`. Nada removido
      fisicamente; gate de sessão legado do `proxy.ts` preservado como rollback.
      Nenhum guard afrouxado.
- [x] Portal v2, `/dashboard/contador`, `/api/**` e demais rotas vizinhas intactas
      (teste dedicado, incluindo anti-laço em `/contador-externo`).
- [x] `RETENTION_POLICY_IMPLEMENTED=true` · `RETENTION_DRY_RUN_PASS=true` ·
      `PRODUCTION_RETENTION_APPLY_EXECUTED=false` · `AUDIT_TRAIL_PRESERVED=true` ·
      `PII_IN_CSV=false` · `OBSERVABILITY_READY=true` · `LOAD_TEST_COMPLETED=true` ·
      `LEGACY_REDIRECT_ACTIVE=true` · `PORTAL_V2_PRESERVED=true` · `SCHEMA_CHANGED=false`.
