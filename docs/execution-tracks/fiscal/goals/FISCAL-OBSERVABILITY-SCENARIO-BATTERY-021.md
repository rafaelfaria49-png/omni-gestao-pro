<!-- AEP:META
{
  "aep": "1.0-R2",
  "id": "FISCAL-OBSERVABILITY-SCENARIO-BATTERY-021",
  "track": "fiscal",
  "title": "Observabilidade fiscal consolidada e bateria ampla de cenários offline (SP/Piloto)",
  "status": "READY",
  "class": "C3",
  "risk_tier": "ALTO",
  "branch": "goal/fiscal-021-observability-scenario-battery",
  "worktree": "C:/Projetos/omni-gestao-fiscal-021-observability-scenario-battery",
  "test_command": "npx vitest run lib/fiscal/observability app/api/internal/fiscal/observability test/fiscal/scenario-battery",
  "allowlist": [
    "lib/fiscal/**",
    "app/api/internal/fiscal/observability/**",
    "test/fiscal/scenario-battery/**",
    "docs/fiscal/**",
    "docs/ai/CURRENT_STATUS.md",
    "docs/ai-execution/_evidence/**"
  ],
  "gates_liberados": [],
  "read_budget": 120,
  "plan_ref": "FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001",
  "plan_rev": 1,
  "familia_executor": "codex",
  "revisao_independente": true,
  "reversibilidade": "operações read-only e testes de bateria offline; nenhuma mutação de schema, banco de produção, SEFAZ externa ou credenciais",
  "gates_extra": [
    {
      "id": "sefaz_homologacao",
      "status": "bloqueado",
      "dependencias": []
    },
    {
      "id": "production",
      "status": "bloqueado",
      "dependencias": []
    }
  ],
  "gate_humano": {
    "requerido": true,
    "pendente": false,
    "aprovacao": {
      "aprovado": true,
      "autorizacao": "Definição canônica do GOAL 021 ratificada pela auditoria 175. Escopo de observabilidade interna read-only e bateria de cenários offline SP/Piloto sem chamadas SEFAZ ou mutação de produção.",
      "registrado_por": "usuário nesta sessão (GOAL FISCAL-021-AEP-DEFINITION-176)",
      "em": "2026-09-06T00:00:00Z"
    }
  }
}
-->

# FISCAL-OBSERVABILITY-SCENARIO-BATTERY-021 — Observabilidade fiscal consolidada e bateria ampla de cenários offline (SP/Piloto)

- trilha: `fiscal`
- classe: C3 · status: READY
- plano: `FISCAL-FABLE5-CONTINUATION-MASTERPLAN-001` (plan_rev 1)
- branch: `goal/fiscal-021-observability-scenario-battery`
- worktree: `C:/Projetos/omni-gestao-fiscal-021-observability-scenario-battery`
- teste: `npx vitest run lib/fiscal/observability app/api/internal/fiscal/observability test/fiscal/scenario-battery`
- risco: `ALTO`
- revisao_independente: `true`

## Fontes e Governança

- `masterplan`: `docs/fiscal/FISCAL_FABLE5_CONTINUATION_MASTERPLAN_001.md`
- `continuation_goals`: `docs/fiscal/FISCAL_CONTINUATION_IMPLEMENTATION_GOALS_001.md`
- `auditoria_175`: Auditoria de reconciliação canônica de escopo do GOAL 021
- `arquitetura_eventos`: `docs/architecture/FISCAL_EVENTS.md`
- `inutilizacao`: `docs/fiscal/FISCAL_019_INUTILIZACAO_NFCE_INVALIDATION_REPORT.md`
- `contingencia`: `docs/fiscal/FISCAL_NFCE_CONTINGENCY_Q04_020.md`

## Escopo Técnico do GOAL 021 (Execução Futura)

1. **Consolidação de métricas fiscais existentes**:
   - `queue`: profundidade de fila, tempo em espera, falhas e distribuição de status;
   - `reconciliation / uncertain state`: documentos em estado incerto / transmissão pendente de confirmação;
   - `throttling / cStat 656`: detecção de consumo indevido e pausa de fila por loja sem retry cego;
   - `contingency state`: estado do modo contingência, documentos pendentes de drenagem e tempo decorrido.

2. **Superfície interna read-only de observabilidade fiscal**:
   - Rota: `app/api/internal/fiscal/observability/route.ts` (método GET exclusivamente).
   - Reutilização estrita do mecanismo de autenticação interna existente em `app/api/internal/fiscal/queue`.
   - Proibição absoluta de exposição de:
     - segredos, senhas e tokens;
     - certificados digitais ou chaves privadas;
     - XMLs integrais;
     - payloads e dados sensíveis de clientes.

3. **Bateria integrada de cenários offline (SP / Piloto)**:
   - Suíte de testes automatizados e harness de execução offline cobrindo o ciclo de vida completo da NFC-e sob fixtures sintéticas e mocks locais.
   - `SP_ONLY=true`: cenários exclusivamente para SP modelo 65. Nenhuma expansão multi-UF.

4. **Validação de integração DANFCE e QR-Code v3**:
   - Provar a integração ponta-a-ponta dos artefatos já implementados (`lib/fiscal/danfce/**` e `lib/fiscal/danfce/qr-v3/**`) com os resultados gerados pela bateria offline.
   - NÃO reimplementar renderizadores DANFCE ou encoders de QR-Code v3.

5. **Relatório objetivo de prontidão técnica para G-F7**:
   - Emissão de relatório de prontidão técnica (`READY_FOR_G_F7_REVIEW=true|false`).
   - Avaliação objetiva para subsidiar futura decisão humana do gate G-F7 (sem ativação automática).

## Correção Canônica Obrigatória da Auditoria 175: Política de cStat

- **Proibição de cStat não modelado como verdade canônica**:
  - Os códigos `cStat 203`, `cStat 208`, `cStat 215` e `cStat 225` NÃO estão representados na matriz canônica atual do runtime Fiscal.
  - O GOAL 021 NÃO deve assumir semântica arbitrária para esses códigos.
  - A bateria deve usar somente semântica proveniente das fontes canônicas já existentes por módulo (`lib/fiscal/provider/sefaz/sefaz-cstat-matrix.ts`, etc.).

- **Tratamento de Gaps de Cobertura**:
  - Qualquer cenário desejado dependente de cStat não modelado deve ser classificado obrigatoriamente como:
    `COVERAGE_GAP_UNMODELED_CSTAT`.
  - É expressamente proibido inventar:
    - outcome / desfecho da nota;
    - consumo de numeração fiscal;
    - inutilização automática;
    - política de retry;
    - terminalidade de estado.
  - Qualquer expansão da matriz de cStat exigirá GOAL próprio com fundamentação documental e autoridade fiscal competente.
  - Se houver qualquer `COVERAGE_GAP_UNMODELED_CSTAT` material para os cenários obrigatórios:
    `READY_FOR_G_F7_REVIEW=false`.

## Matriz de Cenários Base Obrigatórios (C01–C10)

- **C01 — Autorização feliz**: cStat 100 com persistência de protocolo e chave autorizada.
- **C02 — Processamento de lote assíncrono**: 103 (lote recebido) → 105 (lote em processamento) → 104 (lote processado) → 100 (autorizado).
- **C03 — Duplicidade de chave (cStat 204)**: consulta/convergência por chave e reconciliação idempotente, sem retransmissão cega nem queima de novo número.
- **C04 — Serviço SEFAZ indisponível (cStat 108 / 109)**: tratamento fail-closed imediato, preservação do documento sem transição espúria.
- **C05 — Consulta de documento não constante (cStat 217)**: documento não consta na SEFAZ conforme contrato canônico atual de consulta.
- **C06 — Consumo indevido / Throttling (cStat 656)**: parada dura do processamento por loja, pausa da fila, zero loop de retry automático.
- **C07 — Timeout e transmissão incerta**: documento em estado incerto submetido à reconciliação por chave sem duplicação de numeração.
- **C08 — Cancelamento fiscal**: evento 110111 com cStat 135 utilizando estritamente a matriz canônica de eventos existente em `lib/fiscal/events`.
- **C09 — Inutilização de número/faixa**: inutNFe com cStat 102 utilizando exclusivamente o módulo canônico de inutilização em `lib/fiscal/inutilizacao` com garantia de lock e não reutilização do número.
- **C10 — Contingência offline (tpEmis=9)**: entrada em contingência, emissão offline com artefatos DANFCE e QR v3 assinado offline, seguida de drenagem/transmissão posterior simulada.

## Restrições de Gates e Segurança Operacional

- `gates_liberados`: `[]` (nenhum gate de produção ou SEFAZ liberado).
- Gates expressamente proibidos de ativação:
  - `G-F5.2`, `G-F5.3`
  - `G-H1`, `G-H2`, `G-H3`, `G-H4`, `G-H5`, `G-H6`
  - `G-F7` (ativação de loja-piloto em homologação)
  - `G-F12` (produção)
- Escopo geográfico:
  - `SP_ONLY=true`
  - Não criar suporte a segunda UF.
  - Não construir matriz multi-UF.
  - Não disparar requisições para servidores de outras UFs.
- Parâmetros estritos de segurança na execução:
  - `SEFAZ_REQUEST_COUNT=0`
  - `SEFAZ_SOAP_POST_COUNT=0`
  - `NFCE_EMISSION_COUNT=0`
  - `FISCAL_OFF=true`
  - `PRODUCTION_REQUIRED=false`
  - `SCHEMA_CHANGED=false`
  - `MIGRATION_CREATED=false`

## Allowlist da Trilha de Execução

```
lib/fiscal/**
app/api/internal/fiscal/observability/**
test/fiscal/scenario-battery/**
docs/fiscal/**
docs/ai/CURRENT_STATUS.md
docs/ai-execution/_evidence/**
```

## Critério de Pronto (Definition of Done)

1. Superfície interna read-only de observabilidade fiscal (`app/api/internal/fiscal/observability/route.ts`) implementada e protegida por autenticação interna.
2. Consolidação de telemetria e métricas de fila, estado incerto, throttling 656 e contingência.
3. Cenários C01 a C10 cobertos por suíte automatizada offline com dados mockados e fixtures determinísticas.
4. Conformidade estrita com a política de cStat: cStats 203, 208, 215 e 225 classificados como `COVERAGE_GAP_UNMODELED_CSTAT`, sem inferência indevida.
5. Integração dos geradores DANFCE e QR-Code v3 com os desfechos da bateria comprovada sem retrabalho de implementação.
6. Relatório objetivo de prontidão técnica para G-F7 produzido, mantendo `G_F7_AUTO_ACTIVATION=false`.
7. Zero chamadas externas de rede, zero emissão ao vivo, zero alteração de schema/migration.
8. Bateria de testes `npx vitest run lib/fiscal/observability app/api/internal/fiscal/observability test/fiscal/scenario-battery` 100% verde.
