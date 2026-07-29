---
title: Dívida Técnica — Tracking vivo
status: vivo
owner: produto + Sonnet
last_update: 2026-06-02
fonte_overview: docs/ai/CURRENT_STATUS_OVERVIEW.md §5
---

# 🧾 Dívida Técnica — Tracking vivo

> **O que é dívida técnica aqui:** atalho consciente assumido para entregar antes, com custo de manutenção a pagar depois.
> **O que NÃO é dívida técnica:** bug em produção (vai para `BLOCKERS.md`), risco (vai para `RISCOS.md`), mock UI (vai para `MOCKS_TRACKING.md`).

> **Atualização obrigatória:** ao abrir/encerrar sprint que cria ou paga dívida.

---

## 1. Convenção

### 1.1 Severidade
- **P0** — bloqueia release / risco financeiro/fiscal / vazamento → pagar < 7 dias
- **P1** — alto custo de manutenção → pagar < 30 dias
- **P2** — incomoda, não trava → próximo ciclo
- **P3** — melhoria → quando der

### 1.2 Estados
- 🆕 nova · ⏳ pendente · 🔄 em pagamento (sprint ativa) · ✅ paga · 🚫 aceita (decisão consciente, não paga)

### 1.3 Naming
`DT-<NN>` sequencial. Não reordenar (id é estável).

---

## 2. Dívidas ativas

| # | Título | HUB | Severidade | Estado | Aberta em | Sprint alvo | Notas |
|---|---|---|---|---|---|---|---|
| DT-01 | PDV Next (Black Edition) sem persistência server-side | PDV | P0 | ⏳ | 2026-05-19 | SPRINT_NN_PDV | localStorage only; risco de venda perdida |
| DT-04 | Rota legada `/dashboard/os` paralela à oficial | Operações/OS | P1 | ⏳ | 2026-04-xx | SPRINT_NN_OS | ADR-0001 diz que oficial é `/operacoes-v2` |
| DT-05 | PIN supervisor contra `User.pin` (não `AdminUser`) | PDV / Auth | P1 | ⏳ | 2026-05-xx | a planejar | Memória `project_vendas_hub_correcao_operacional` |
| DT-06 | Item Avulso sem CFOP/categoria padrão | PDV | P2 | ⏳ | 2026-05-23 | bloqueia Fase 2 fiscal PDV | — |
| DT-08 | Sem multi-depósito no Estoque | Estoque | P0 | 🔄 | herdada | BL-07 Fase 2 (operacionalização) | Bloqueia adapter Marketplace. ADR-0007 + Fase 0 (Gate #1A) ✅. **Fase 1 (Fundação) + cutover CONCLUÍDOS (02/06)**: `db:push` + backfill (10 lojas, invariante verde Σ==stock), commit `a0e24ef`, `tsc`/`build` ✅. Multi-depósito **fundado mas dormente** → operacionalização (write-paths PDV/OS + `depositoId` NOT NULL) = **Fase 2**. Dívidas da Fundação → ver **DT-17** |
| DT-17 | Fundação minimalista: `ProdutoDeposito` pode driftar de `Produto.stock` até a Fase 2 (consumidores PDV/OS não cabeados) + campos diferidos vs ADR-0007 (`custoMedio`/`tipo`/`depositoId` no ledger) | Estoque | P2 | ⏳ | 2026-06-02 | BL-07 Fase 2 | Atalho consciente da Fase 1 (zero mudança de comportamento). **Cutover executado (02/06): invariante verde AGORA, mas o drift passa a acumular com a operação** (vendas/OS/entradas alteram só `Produto.stock`). Mitigação: camada **dormente** (nenhum consumidor lê `ProdutoDeposito` em prod) + `db:backfill-deposito --exec` re-runnable re-sincroniza. **Aberto até a Fase 2** (cabeia write-paths + `depositoId` NOT NULL); recomenda-se re-backfill imediatamente antes de abrir a Fase 2 |
| DT-09 | budget-policy-service com regras hardcoded | OS | P1 | ⏳ | herdada | a planejar | Falta UI por loja |
| DT-10 | Pool de executores Omni Agent pequeno | Omni Agent | P1 | ⏳ | herdada | a planejar | Só `recebimentoFinanceiro` real |
| DT-11 | Painel inicial com mocks misturados | BI | P0 | ⏳ | herdada | SPRINT_NN_BI | Confunde decisão de negócio |
| DT-12 | Mocks no `lib/utils.ts` Lovable excluídos do tsc | Lovable | P3 | 🚫 | herdada | aceito | Decisão de isolamento documentada no CLAUDE.md |

---

## 3. Dívidas pagas (histórico — últimos 90 dias)

| # | Título | Paga em | Sprint que pagou |
|---|---|---|---|
| DT-02 | `/dashboard/financeiro-v2` "mock" — UI plugada a dados reais (FinanceiroRealProvider) | ~2026-05 (pré-baseline) | migração real-data (ef44def→417872b) |
| DT-03 | Fallback `storeId="loja-1"` silencioso — vetor **server-side** de leitura de API | 2026-05-29→30 | SPRINT_MULTI_LOJA-S-001 + S-002 · ADR-0003 |
| DT-14 | Fallback `?? "loja-1"` server-side em `carteiras/*` + `dre/route` (forma nullish que escapou da S-001) | 2026-05-30 | DT-14 (SAFE-lite reforçado) · ADR-0003 |
| DT-13 | Resíduo `LEGACY_PRIMARY_STORE_ID` client-side em **PDV/vendas** (4 telas) | 2026-05-31 | DT-13 (SAFE-lite) · ADR-0003 |
| DT-15 | Resíduo `LEGACY_PRIMARY_STORE_ID` client-side em **marketing/config/onboarding/cadastros** (6 arq./9 sites; +3 guards) | 2026-05-31 | DT-15 (SAFE-lite) · ADR-0003 |
| DT-16 | **Provider-fonte** (`lib/loja-ativa.tsx`, F-11) semeava `lojaAtivaId` com `lojas[0]?.id \|\| LEGACY_PRIMARY_STORE_ID` na race de 1ª carga + irmão `lib/perfil-loja-provider.tsx` | 2026-06-01 | DT-16 (SAFE-lite reforçado) · ADR-0003 |
| DT-07 | **Webhook WhatsApp single-store** (`WHATSAPP_WEBHOOK_STORE_ID` + número/token global, fallback `loja-1`) → router multi-loja por `phone_number_id` (`WhatsAppPhoneNumber`) + credencial por loja (**F-04**) | 2026-06-01 | MULTI_LOJA-S-003 · ADR-0006 |

> **Nota DT-03 + DT-14 (server-side fechado — J4):** o vetor **server-side** de `loja-1` está **100% eliminado**. A S-001/S-002 cobriu a forma `|| "loja-1"`; **DT-14** fechou a forma **nullish** `?? "loja-1"` que havia escapado em `carteiras/*` + `dre/route.ts` (o teste/áudit da S-001 só varria `||`, e o resíduo era multi-linha). Hoje **zero** literal `"loja-1"` de código em `app/api/**` (resta só 1 comentário em `exportar/route.ts`).

> **Nota DT-13 + DT-15 + DT-16 (client-side 100% fechado — J4):** **DT-13** (4 telas PDV/vendas) + **DT-15** (marketing, configuracoes ×3, centro-personalizacao, importador, onboarding, cadastros — 6 arq./9 sites, +3 guards de loja vazia) eliminaram o fallback `LEGACY_PRIMARY_STORE_ID` em **todos os componentes de UI**; **DT-16** fechou a **raiz** — o provider-fonte `lib/loja-ativa.tsx` (F-11) + o irmão `lib/perfil-loja-provider.tsx`. Padrão canônico `(lojaAtivaId ?? "").trim()`; semente extraída para helper puro `lib/loja-ativa-seed.ts` (`resolveSeedStoreId`, sem semear `loja-1` na 1ª carga). Guard estático em `lib/multi-loja-client-no-legacy-fallback.test.ts` (12 arquivos — agora cobre `loja-ativa.tsx` + `perfil-loja-provider.tsx`). **O client-side de `lojaAtivaId` está 100% sem fallback silencioso.**
> - **F-04/DT-07** — **webhook WhatsApp** single-store: **PAGO** (`MULTI_LOJA-S-003`, Gate #2 aprovado 2026-06-01 · **ADR-0006**). Roteamento inbound por `phone_number_id` (mapa `WhatsAppPhoneNumber`) + credencial outbound por loja, sem `loja-1`; `webhookDefaultStoreId` removido. Era o **último vetor `loja-1` aberto** → agora **zero fallback silencioso `loja-1` em todo o projeto** (server + client + WhatsApp). **Cutover operacional pendente:** `db:push` da migração `0010` + backfill do número no deploy (ver ENTRY 019 + AUDITORIA F-04 §6).
> - Legítimos por design (não são dívida ativa): `lib/stores-api-access.ts` (**F-15**, server, onboarding-only), `lib/ops-loja-id.ts` (P3 intencional), `store-defaults.ts` (constante canônica).

> **Nota DT-02 (R0-L5):** evidência code-structural (não runtime): hub lê de `/api/financeiro/*` via `FinanceiroRealProvider` (16 fetches; 0 dados hardcoded; sem fallback fake; init em arrays vazios). **Observação:** **DRE / Fluxo de caixa** têm dados reais conectados, mas **evolução visual/funcional ainda pendente** (`ROADMAP_FINANCEIRO` §6/§8) — maturidade de UI, **não** mock.

---

## 4. Dívidas aceitas (não pagar — decisão consciente)

| # | Título | Razão | ADR |
|---|---|---|---|
| DT-12 | Mocks Lovable excluídos do tsc | Isolamento intencional do hub; benefício > custo | — (decisão documentada no CLAUDE.md) |

---

## 5. Como abrir uma nova dívida

1. Identifique o atalho assumido **na própria sprint que cria** (não esquecer).
2. Adicione linha em §2 com próximo `DT-NN`.
3. Referencie no §7 do relatório de encerramento da sprint.
4. Atualize `CURRENT_STATUS_OVERVIEW.md §5` se for P0/P1.

---

## 6. Como pagar uma dívida

1. Sprint dedicada ou item dentro de sprint maior.
2. Mover da tabela §2 para §3 com data e sprint.
3. Atualizar roadmap do HUB (remover do "gaps").
4. Atualizar `CURRENT_STATUS_OVERVIEW.md §5`.

---

## 7. Fonte da verdade

- **Tracking de dívida:** este arquivo.
- **Overview:** `docs/ai/CURRENT_STATUS_OVERVIEW.md §5`.
- **Detalhe por HUB:** `docs/roadmaps/ROADMAP_<HUB>.md §5 (gaps)`.
