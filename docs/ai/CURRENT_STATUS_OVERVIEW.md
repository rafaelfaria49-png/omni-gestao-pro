---
title: CURRENT_STATUS · Overview enxuto
status: vivo
owner: produto + Sonnet (atualiza a cada sprint encerrada)
last_update: 2026-08-03
fonte_detalhada: docs/ai/CURRENT_STATUS.md
---

# 📊 CURRENT_STATUS — Overview enxuto

> **Entrada rápida (< 2 min)** para qualquer IA/humano saber em que pé está cada HUB.
> **Conteúdo completo, histórico de sprints e contexto:** [`CURRENT_STATUS.md`](./CURRENT_STATUS.md) (1800+ linhas).
> **Roadmaps por HUB:** [`docs/roadmaps/INDEX.md`](../roadmaps/INDEX.md).

> Atualizar este arquivo **a cada sprint encerrada**. Mantenha enxuto — detalhes vão para `CURRENT_STATUS.md` (apêndice histórico) ou para o roadmap do HUB.

---

## 1. Mapa de maturidade por HUB

> Escala: 🟢 maduro · 🟡 em evolução · 🟠 incipiente · 🔴 não iniciado / risco crítico

| Onda | HUB | Maturidade | Frente principal | Bloqueio crítico |
|---|---|---|---|---|
| 1 | **PDV** | 🟢 maduro | **Pausa operacional** (uso real, pré-BL-07): modal s/ F11, busca F3 pro, bipe, anti-negativo, UX Smart Genius. Base: 4 PDVs convergentes, lock, INSERT, F7, À Prazo, fechamento premium | 🔴 PDV Next não persiste vendas (server-side) |
| 1 | **Operações/OS** | 🟢 maduro | Adapters Fase 2 ✅, hydration FK ✅, ADR-0001 oficial | 🟡 rota legada `/dashboard/os` ainda em paralelo |
| 1 | **Financeiro** | 🟢 backend + UI real | financeiro-v2 plugado a dados reais (FinanceiroRealProvider) ✅; services, adapters, idempotência, importador parcelado, crédito persistente | 🟡 DRE/Fluxo: evolução visual/funcional (não é mock) |
| 1 | **Estoque** | 🟢 ledger maduro | Ledger profissional ✅, importador defensivo ✅, saneamento SKU ✅; **BL-07 Fase 1 (Fundação) ✅ CONCLUÍDA + cutover** (10 lojas c/ Depósito Principal; invariante verde; `tsc`/`build` ✅) | 🟠 multi-depósito **fundado mas dormente**; operacionalização (consumidores + `depositoId` NOT NULL) = Fase 2 |
| 2 | **Operações/OS** (cross-onda) | (acima) | NFS-e, comunicação WhatsApp | 🔴 sem NFS-e |
| 2 | **CRM** | 🟡 base sólida | FK Venda→Cliente ✅, modal PF/PJ ✅, crédito persistente ✅, importador defensivo ✅ | 🟡 sem tela 360° consolidada, sem segmentação |
| 2 | **WhatsApp** | 🟡 infra ok | Webhook canônico ✅, HMAC ✅, **router multi-loja por `phone_number_id`** (ADR-0006, S-003) ✅, credencial outbound por loja ✅, envio manual ✅ | 🔴 sem opt-out persistente, sem orquestrador de massa · ⚙️ cutover (`db:push`+backfill) pendente |
| 3 | **Marketplace** | 🔴 não iniciado | Greenfield total | 🔴 sem arquitetura, sem código |
| 3 | **Marketing IA** | 🟠 incipiente | Gerador de imagens ✅, credit-costs ✅, debit-turn-credits ✅ | 🔴 sem orquestrador de campanha, sem atribuição |
| 4 | **Omni Agent** | 🟠 infra ok / poucos executores | API-guard, honesty, regex determinística, executor `recebimentoFinanceiro` ✅ | 🔴 pool de executores reais pequeno |
| 4 | **BI** | 🟠 espalhado | Painel inicial parcial | 🔴 mocks misturados com real |
| 4 | **Multi-loja** | 🟢 **zero `loja-1`** | fallback `loja-1` **server-side 100%** (S-001/S-002 + DT-14, ADR-0003) ✅, **client-side 100%** (DT-13 + DT-15 + DT-16) ✅, **WhatsApp F-04** (ADR-0006, S-003) ✅, ACL `canAccessStore` ✅, proxy cookie ✅ | ✅ **zero fallback silencioso `loja-1`** em todo o projeto (server+client+WhatsApp) |

---

## 2. Frentes ativas (sprints em curso)

> Atualizar quando abrir/fechar sprint.

| Sprint | HUB | Status | Owner IA | Data início |
|---|---|---|---|---|
| R0 — Reconciliação governança | cross | em curso (L0 ✅; baseline `AUDITORIA_R0_RECONCILIACAO_GOVERNANCA.md`) | Opus + Rafael | 2026-05-30 |
| Pausa operacional PDV (estabilização em uso real, pré-BL-07) | PDV | em curso | Opus + Rafael | 2026-06-01 |

---

## 3. Próximas sprints sugeridas (top 5 prioridade)

> Em ordem recomendada — quem encerra a atual, abre a próxima.

0. **Pausa operacional PDV** (em curso — **prioridade imediata**) — estabilizar o PDV em **uso real**: fluxo, teclado, busca/F3, bipe, finalização, toast, modal de pagamento, UX Smart Genius. **Precede o BL-07.**
1. **SPRINT_NN_PDV** — Persistência server-side do PDV Next (P0; fecha Fase 1 PDV).
2. ~~**SPRINT_NN_MULTI_LOJA** — F-04: router WhatsApp por `phone_number_id`~~ — ✅ **concluída** (`MULTI_LOJA-S-003`; ADR-0006; Gate #2 01/06). *Fechou o **último vetor `loja-1`**; multi-loja 100% (server+client+WhatsApp). Resta o cutover operacional (`db:push`+backfill+deploy).*
3. **SPRINT_NN_WHATSAPP** — Opt-out persistente + monitor qualidade (P0; previne banimento Meta).
4. **SPRINT_BL07_FASE1 / BL-07** — Multi-depósito **Fundação**; modelo decidido (**ADR-0007**, BL-12 ✅) + **Fase 0 arquitetura concluída** (Gate #1A 02/06 — [dossiê](../architecture/estoque/BL07_FASE0_ARQUITETURA.md) + [proposta](../sprints/proposals/SPRINT_BL07_FASE1.md)). **Próxima grande frente estrutural** após o PDV operacional; desbloqueia Marketplace. Aguarda autorização de área protegida (`schema.prisma` + services core).

> **Sequência oficial:** (1) finalizar **PDV operacional** → (2) **BL-07** (estoque multi-depósito, Fase 0) → (3) **Fiscal** (NFC-e/SAT). **Importador Universal IA adiado.**
> financeiro-v2 saiu do top-5: deixou de ser mock (DT-02 paga, R0-L5). Evolução de UI DRE/Fluxo segue no `ROADMAP_FINANCEIRO`.

---

## 4. Áreas protegidas (lembrete)

> Qualquer mudança nestes paths **exige autorização explícita do humano**. Ver [`docs/governance/GOVERNANCA.md`](../governance/GOVERNANCA.md).

- `auth.ts`, `auth.config.ts`, `proxy.ts`
- `prisma/schema.prisma`
- `lib/pdv*` core
- `lib/financeiro/*` services
- `lib/operacoes/*` services
- `lib/whatsapp/*` core
- `lib/omni-agent/*` executores

---

## 5. Dívidas técnicas críticas

| # | Item | HUB | Severidade |
|---|---|---|---|
| 1 | PDV Next sem persistência server-side | PDV | P0 |
| 2 | ~~Webhook WhatsApp single-store — DT-07~~ | Multi-loja/WhatsApp | ✅ **pago** (S-003 · ADR-0006 · Gate #2 01/06) |
| 3 | Opt-out WhatsApp ausente | WhatsApp | P0 |
| 4 | Sem multi-depósito Estoque (DT-08) | Estoque | P0 (bloqueia Marketplace) — Fase 0 arquitetura ✅; Fase 1 a abrir |
| 5 | Rota legada `/dashboard/os` paralela | OS | P1 |
| 6 | Pool de executores Omni Agent pequeno | Omni Agent | P1 |
| 7 | Dois projetos Vercel Production com autoridade implícita de migration em bancos distintos — DT-19 | Deploy/Banco | P0 — Classe C; decisão canônica e guard bloqueiam GOAL 002C |

> Detalhe e tracking vivo em `docs/status/DIVIDA_TECNICA.md`. (DT-03 + DT-14: `loja-1` server-side **100% pago**; DT-13 + DT-15: client **de componentes** pago; **client-side ainda não 100%** — resta **F-11** provider-fonte + F-04 webhook — ver §3 de lá.)

---

## 6. Última atualização significativa

> Apêndice — listar entradas mais recentes do `CURRENT_STATUS.md` para contexto rápido.

- **2026-06-02** — **BL-07 Estoque Multi-Depósito · Fase 1 (Fundação) CONCLUÍDA + CUTOVER:** `db:push` aplicou `depositos`/`produto_depositos` (aditivo, sem data-loss); `db:backfill-deposito --exec` criou Depósito Principal em **10 lojas** + populou `ProdutoDeposito` de `Produto.stock`; **invariante verde** (Σ ProdutoDeposito == Σ Produto.stock, drift total = 0). `prisma generate`/`tsc`/`build` ✅. Camada dormente → zero mudança de comportamento. Commit `a0e24ef`. DT-17 (P2) aberto até Fase 2. **Próximo oficial: BL-07 Fase 2.**
- **2026-06-02** — **BL-07 Estoque Multi-Depósito · Fase 1 (Fundação) EM ANDAMENTO:** autorização de área protegida concedida. Escrito (aditivo, zero mudança de comportamento): models `Deposito`+`ProdutoDeposito`, migração `0011`, núcleo puro `lib/estoque/deposito-core.ts` + service dormente, `scripts/backfill-deposito.mjs` (+`db:backfill-deposito`), hook best-effort em store creation, 14 testes (vitest **14/14** ✅). `Produto.stock` intacto. **`tsc`/`build` pendentes** (dev server em uso real trava `prisma generate`). Divergências conscientes vs ADR-0007 (`ProdutoDeposito`/`principal`; sem `custoMedio`/`tipo`/`depositoId@ledger` na Fase 1). Sem commit (parar p/ revisão).
- **2026-06-02** — **BL-07 Estoque Multi-Depósito · Fase 0 (arquitetura) CONCLUÍDA — Gate #1A:** dossiê de arquitetura ([`BL07_FASE0_ARQUITETURA.md`](../architecture/estoque/BL07_FASE0_ARQUITETURA.md): estado atual, gap analysis Tiny/Bling/GestãoClick/Smart Genius/AvantPro/Linx/NetSuite, modelo multi-depósito, fluxos, riscos P0–P3) + proposta de sprint faseada ([`SPRINT_BL07_FASE1.md`](../sprints/proposals/SPRINT_BL07_FASE1.md), Fases 1–4). Riscos P0 destacados: migração (MIG-01), drift agravado pelo **ledger best-effort da OS** (CONC-02), oversell Marketplace (NEG-01). **Só governança** — sem código/schema/Prisma/APIs. Fase 1 (Fundação) aguarda autorização de área protegida.
- **2026-06-01** — **MULTI_LOJA-S-003 (F-04/DT-07) — Gate #2 APROVADO:** router WhatsApp multi-loja por `phone_number_id` (mapa `WhatsAppPhoneNumber`) + credencial outbound por loja, **sem fallback `loja-1`**; `webhookDefaultStoreId` removido. **ADR-0006 `aceito`**, DT-07 **pago**. Migração `0010` aditiva (cutover `db:push`+backfill pendente). Build OK · vitest **258 passed | 2 expected fail**. Auditoria: [`AUDITORIA_F-04_WHATSAPP_ROUTER_MULTI_LOJA.md`](../audits/AUDITORIA_F-04_WHATSAPP_ROUTER_MULTI_LOJA.md). **Era o último vetor `loja-1`** → agora zero fallback silencioso em todo o projeto (server+client+WhatsApp).
- **2026-06-01** — Governança: **`COWORK_RELEASE_PLAN.md`** criado — auditoria dos 4 gargalos (COWORK frozen · `SKILL_LOCK_HUB` · approval de skills · `BENCHMARK_PROTOCOL`) + mapa de desbloqueio em 2 trilhos + design do `SKILL_LOCK_HUB` + veredito. **Conclusão:** bootstrap **~98%** (design); CoWork **supervisionado destravável com 1 decisão** (ADR-0005, sem build novo); **autônomo** exige 3 builds. 1º HUB recomendado: **Multi-Loja** (não-protegido, ex.: BL-08). `execution/INDEX §3` atualizado (R0/R1 concluídos; liberação COWORK pendente de decisão).
- **2026-06-01** — Governança: **Bootstrap CoWork — maturidade pós-INTAKE** avaliada e 2 gaps doc-fixáveis fechados (SAFE-lite light): (1) **porta de entrada** cabeada (`skills/INDEX` + `execution/INDEX §1`) — comando livre "Trabalhe no X" agora aponta o `INTAKE_PROTOCOL` como 1ª ação; (2) **DoD provisório** passa a viajar no Intake Manifest (`INTAKE §4/§12 definition_of_done`). Veredito: **roteamento de intake ~95%** (maduro); **execução CoWork ~60%** (congelada por decisão + builds: COWORK frozen, `SKILL_LOCK_HUB`, skills draft, `BENCHMARK_PROTOCOL`). Simulação "Trabalhe no Marketplace" → `RED/BLOCKED` correto. Relatório: [`docs/execution/BOOTSTRAP_COWORK_MATURITY.md`](../execution/BOOTSTRAP_COWORK_MATURITY.md).
- **2026-06-01** — Governança: **`INTAKE_PROTOCOL.md`** criado (`docs/execution/`, pós-R1) — roteador **read-only** que materializa a `FASE 1` (comando livre "Trabalhe no X" → Intake Manifest → **Gate #1 existente**); não altera Engine/SAFE-lite/gates. Canoniza **`ROADMAP §7`** como backlog (reconciliação Tier A em `GOVERNANCA §8` + `SPRINT_PROTOCOL §4.1`). `SKILL_INTAKE_ROUTER` diferida.
- **2026-05-31** — DT-15 (SAFE-lite): resíduo `LEGACY_PRIMARY_STORE_ID` client-side em marketing/config/onboarding/cadastros eliminado (6 arq./9 sites + 3 guards de loja vazia). Com DT-13, **client de componentes limpo**. **Ainda não 100%** — resta **F-11** (provider-fonte `lib/loja-ativa.tsx`).
- **2026-05-31** — DT-13 (SAFE-lite): resíduo `LEGACY_PRIMARY_STORE_ID` client-side nas **4 telas de PDV/vendas** eliminado (`(lojaAtivaId ?? "").trim()` + guard estático).
- **2026-05-30** — DT-14 (SAFE-lite reforçado): fallback nullish `?? "loja-1"` em `carteiras/*` + `dre` eliminado (forma que escapou da S-001 por ser `??` e multi-linha) — `loja-1` **server-side 100%** fechado; ADR-0003.
- **2026-05-30** — R0-L5: financeiro-v2 confirmado sobre dados reais (DT-02 paga · MOCK-01 removido · BL-13 destravado); DRE/Fluxo = evolução de UI pendente.
- **2026-05-30** — R0: reconciliação da governança iniciada (baseline `AUDITORIA_R0`; lote L0 ✅).
- **2026-05-30** — SPRINT_MULTI_LOJA-S-002: F-03 (proxy cookie) + F-02-anchor (exportar) — fallback `loja-1` **server-side** 100% eliminado.
- **2026-05-30** — Fase 1 Proteção de Lojas (anti-exclusão acidental).
- **2026-05-29** — SPRINT_MULTI_LOJA-S-001: fallback silencioso `loja-1` em leituras de API eliminado + ACL `canAccessStore` (ADR-0003).
- **2026-05-26** — Lote 5: remoção do else branch JSX morto no PDV Clássico.
- **2026-05-26** — Lote 3: F9 recebimento de contas convergente nos 3 PDVs.
- **2026-05-26** — Convergência operacional PDV: INSERT + Pagamento Múltiplo nos 3 PDVs.
- **2026-05-25** — Sprint À Prazo Enterprise (parcelamento no PDV).
- **2026-05-24** — Convergência PDV P1 e P0 (Black Edition no core).
- **2026-05-23** — PDV Multi-Terminais Fase 2 (lock + heartbeat).
- **2026-05-23** — PDV Item Avulso via INSERT.
- **2026-05-21** — Adapter OS → Estoque Fase 2 (auditoria de usuário).

> Histórico completo: [`CURRENT_STATUS.md`](./CURRENT_STATUS.md) §sprints.

---

## 7. Como atualizar este arquivo

1. Ao encerrar uma sprint, atualize:
   - §1 (maturidade do HUB, se mudou).
   - §2 (remover sprint encerrada).
   - §3 (recomendar próxima).
   - §5 (atualizar dívida resolvida).
   - §6 (entrada nova no apêndice).
2. **Não duplicar** detalhe do `CURRENT_STATUS.md` — aqui é overview.
3. **Manter < 200 linhas** — se crescer, dividir.
4. `last_update` no front matter obrigatório.

---

## 8. Referências cruzadas

- **Histórico completo:** [`CURRENT_STATUS.md`](./CURRENT_STATUS.md)
- **Roadmaps:** [`docs/roadmaps/INDEX.md`](../roadmaps/INDEX.md) → 11 HUBs com fases, gaps, métricas
- **Governança:** [`docs/governance/GOVERNANCA.md`](../governance/GOVERNANCA.md) → regras inegociáveis
- **Sprints:** [`docs/sprints/TEMPLATE_SPRINT.md`](../sprints/TEMPLATE_SPRINT.md) → como rodar sprint
- **Auditorias:** [`docs/audits/TEMPLATE_AUDITORIA.md`](../audits/TEMPLATE_AUDITORIA.md) → como auditar
- **ADRs:** [`docs/decisions/INDEX.md`](../decisions/INDEX.md) → decisões arquiteturais
- **Status vivos:** `docs/status/{DIVIDA_TECNICA,MOCKS_TRACKING,RISCOS,BLOCKERS}.md`
