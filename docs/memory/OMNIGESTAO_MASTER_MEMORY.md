# OmniGestão Pro — Memória viva consolidada

**Tipo:** documento de continuidade (onboarding humano + agentes de IA).  
**Última consolidação:** 2026-05-08 · **Última revisão:** 2026-05-30 (R0-L4 — Blocos 0–35 + Approval Batch V1 + piloto Multi-Loja registrados; R0 em andamento)  
**Fontes:** `docs/` (módulos, reports, ai, roadmap, architecture, deploy), `prisma/migrations/`, `git log`, inspeção de rotas críticas descrita na documentação existente, e contexto de implementações recentes (WhatsApp Cloud API, PDV, MVP).

---

## 🆕 Sistema Operacional de Desenvolvimento — entrada oficial (2026-05-27)

A partir de 2026-05-27 o projeto passou a operar sob um **Sistema Operacional de Desenvolvimento** persistido em `docs/`. **Toda IA/humano que entra no projeto deve seguir esta ordem de leitura:**

0. **Entrada obrigatória de novos chats/agentes:** [`docs/ai/START_HERE.md`](../ai/START_HERE.md) —
   checklist curto de leitura + política do Neon (produção vs `omnigestao_prod_candidate`)
   centralizada lá, não duplicada aqui.
1. **Entrada universal:** [`docs/skills/INDEX.md`](../skills/INDEX.md) — lista todos os documentos da governança e seus papéis.
2. **Regras inegociáveis (versão de bolso):** [`docs/governance/GOVERNANCA.md`](../governance/GOVERNANCA.md) — leitura < 2 min antes de tocar qualquer arquivo.
3. **Estado real:** [`docs/ai/CURRENT_STATUS_OVERVIEW.md`](../ai/CURRENT_STATUS_OVERVIEW.md) — overview enxuto (< 200 linhas). Histórico completo continua em [`CURRENT_STATUS.md`](../ai/CURRENT_STATUS.md).
4. **Mapa estratégico:** [`docs/blueprint/MASTER_PLAN.md`](../blueprint/MASTER_PLAN.md) — visão única, 11 HUBs, 4 ondas.
5. **Onde estamos por HUB:** [`docs/roadmaps/INDEX.md`](../roadmaps/INDEX.md) — 11 roadmaps detalhados.

### Atualização de estado (2026-05-30 · R0-L4)

Desde a entrada oficial (Blocos 0–28), o Sistema Operacional avançou e foi exercitado:

- **Blocos 29–35 concluídos:** Execution Engine (pipeline 17 fases, safe-guards, gates, taxonomia), Research Layer (11 Benchmark + 11 Audit + Doc_Refresh), Proposal Layer (3 skills), Execution Layer S (5 skills). Total: 32 skills criadas.
- **ADR-0002** (congelamento Skill Front Matter v1) e **APPROVAL_BATCH_V1** (8 skills críticas aprovadas) concluídos.
- **Piloto Multi-Loja executado:** SPRINT_MULTI_LOJA-S-001 (mergeada, ADR-0003) + S-002 (concluída) — primeiro uso real do Engine fim-a-fim.
- **R0 — Reconciliação da governança em andamento:** alinhar status vivos/roadmap/memória ao estado real pós-operação. Baseline: `docs/audits/AUDITORIA_R0_RECONCILIACAO_GOVERNANCA.md`.
- **Estratégia atual:** "servir a operação real". Blocos 36+ (modos avançados/overnight/cowork/composite) **congelados** até concluir R0 e R1.

> Detalhe vivo: `docs/ai/CURRENT_STATUS_OVERVIEW.md` · `docs/status/EXECUTION_LOG.md` · `docs/execution/INDEX.md §5`.

### Estrutura do sistema (Blocos 0–28)

```
docs/
  governance/                          # Sistema Operacional (Blocos 0–7)
    BLUEPRINT_GOVERNANCA.md            # Bloco 0 — mapa-mestre dos 28 blocos
    GOVERNANCA.md                      # Bloco 1 — 7 inegociáveis (versão de bolso)
    WORKFLOW_MULTI_IA.md               # Bloco 2 — Opus/Sonnet/Antigravity/Composer/ChatGPT
    SESSION_HANDOFF.md                 # Bloco 3 — abrir/fechar sessão sem perder contexto
    SPRINT_PROTOCOL.md                 # Bloco 4 — sprint do início ao fim
    AUDIT_PROTOCOL.md                  # Bloco 5 — 8 tipos de auditoria, P0–P3
    PROMPTS_OFICIAIS.md                # Bloco 7 — 13 prompts paste-and-go
  decisions/                           # Bloco 6 — ADRs
    INDEX.md
    TEMPLATE_ADR.md
    OS_ROUTE_OFICIAL.md                # ADR-0001 (legado)
  roadmaps/                            # Blocos 8–19 — 1 índice + 11 ROADMAPs por HUB
    INDEX.md                           # convenções + ordem ideal + matriz paralelismo
    ROADMAP_PDV.md
    ROADMAP_OPERACOES_OS.md
    ROADMAP_FINANCEIRO.md
    ROADMAP_ESTOQUE.md
    ROADMAP_MARKETPLACE.md
    ROADMAP_CRM.md
    ROADMAP_WHATSAPP.md
    ROADMAP_MARKETING_IA.md
    ROADMAP_OMNI_AGENT.md
    ROADMAP_BI.md
    ROADMAP_MULTI_LOJA.md
  sprints/TEMPLATE_SPRINT.md           # Bloco 20 — template oficial
  audits/TEMPLATE_AUDITORIA.md         # Bloco 21 — template oficial
  ai/CURRENT_STATUS_OVERVIEW.md        # Bloco 22 — overview enxuto
  status/                              # Bloco 23 — status vivos
    DIVIDA_TECNICA.md
    MOCKS_TRACKING.md
    RISCOS.md
    BLOCKERS.md
  blueprint/                           # Blocos 24–26 — estratégia
    MASTER_PLAN.md
    PRODUCT_VISION.md
    MONETIZATION.md
  architecture/INDEX.md                # Bloco 27 — arquitetura técnica detalhada
  memory/OMNIGESTAO_MASTER_MEMORY.md   # Bloco 28 — este arquivo (continuidade histórica)
  skills/INDEX.md                      # Entrada universal (atualizado em Blocos 7–22)
```

### Para que serve cada camada

| Camada | Responde a... |
|---|---|
| **governance/** | "Como trabalhamos?" — regras, workflow IA, sprint/audit protocols, prompts |
| **decisions/** | "Por que decidimos X?" — ADRs imutáveis |
| **roadmaps/** | "Para onde vamos por HUB?" — visão, fases, gaps, métricas |
| **sprints/** | "O que está sendo executado?" — sprint atual + histórico |
| **audits/** | "O que está doente?" — auditorias periódicas com findings P0–P3 |
| **ai/** | "Onde estamos hoje?" — overview enxuto + histórico completo |
| **status/** | "O que está travando/devendo agora?" — dívida, mocks, riscos, blockers vivos |
| **blueprint/** | "O que estamos construindo no fundo?" — master plan, visão produto, monetização |
| **architecture/** | "Como o código está organizado?" — padrões, pastas, decisões técnicas |
| **memory/** | "O que aconteceu antes?" — continuidade histórica (este arquivo) |

### Princípios do sistema

- **Documentação como código:** versionada, revisada, imutável quando precisa ser (ADRs, sprints encerradas, auditorias publicadas).
- **Fonte da verdade única por assunto:** se duas docs falam o mesmo, uma é fonte e outra é pointer.
- **Atualização disciplinada:** `last_update` no front matter; atualizar ao encerrar sprint, ao mudar estado, ao decidir.
- **Modular incremental:** entregar bloco a bloco, sem respostas monolíticas que truncam contexto.

---

## Leitura complementar (legado e contexto histórico)

- Histórico completo de sprints e contexto: [`docs/ai/CURRENT_STATUS.md`](../ai/CURRENT_STATUS.md) (1800+ linhas — apêndice histórico)
- Auditoria por módulo (P0/P1, riscos): [`docs/modules/reports/AUDITORIA_GERAL_OMNIGESTAO_PRO.md`](../modules/reports/AUDITORIA_GERAL_OMNIGESTAO_PRO.md)
- Roadmap macro **legado** (substituído pelos roadmaps por HUB): [`docs/roadmap/ROADMAP.md`](../roadmap/ROADMAP.md)
- Backend (Actions, services, adapters): [`docs/architecture/BACKEND.md`](../architecture/BACKEND.md)
- Checklist Vercel: [`docs/deploy/PRODUCTION_CHECKLIST.md`](../deploy/PRODUCTION_CHECKLIST.md)

**Aviso sobre atribuição Claude Code vs Cursor:**  
O repositório não marca commits por ferramenta. A seção 3 e 4 deste documento usa **inferência** a partir de mensagens de commit, padrões de branch (`merge: dev → main`, `terminal-1`), amplitude de mudanças e alinhamento com relatórios em `docs/modules/reports/`. Onde não há evidência, consta como **não atribuível**.

---

## 1. Histórico geral

### 1.1 Linha do tempo (visão macro)

| Fase | Período aproximado | O que caracteriza |
|------|-------------------|-------------------|
| **Origem** | Commit raiz `dcfd4c4` (“Primeiro commit OmniGestao Pro”) | Base Next.js + Prisma + módulos iniciais |
| **Importação / migração** | Commits `4e58486` … `a094467` | Importador XLSX, lotes, performance, anti-duplicados |
| **PDV e vendas** | `b823216`, `968e308`, `6f946f0` | Multi-maquininhas, Vendas HUB, modo rápido |
| **Multi-loja / segurança** | `8a99eb4`, `a85a156` | RBAC, isolamento de lojas, mosaico de IAs |
| **IA Mestre** | `ce19718` … `37edf62` | Chat, projetos, imagens, treino, configurações |
| **Financeiro modular** | `1d53e2c`, `8434913`, `e52b015` | Services receber/pagar, HUB V2 com dados reais (evolução documentada nos reports) |
| **Operações HUB real** | `125db30`, `807c3d3` | OS via Prisma no hub; serviços e painéis |
| **Integração “todos hubs Prisma”** | `f0c4eb9` | Marco de unificação de leitura de dados |
| **Auth NextAuth v5** | `499d7e5`, `1f66063` | Credentials, login em `app/login`, loading |
| **Billing Stripe** | `5000cfd`, `4661b9e` | Planos, checkout, portal, webhook, plan-guard |
| **MVP estabilização** | `57f4229` … `66eb251` | Docs reorganizadas, passes 01–06, empty states, PDV layout/BIPE |
| **Produção / Edge** | `613922c` | Proxy default export Edge |
| **WhatsApp Cloud API** | `7f58507` + trabalho documentado em `CHANGELOG` 2026-05-09 | Meta Graph, webhook `/api/webhooks/whatsapp`, send route, HUB |

### 1.2 Arquitetura adotada (síntese)

- **Next.js 16 (App Router)** + React 19 + TypeScript strict.
- **Prisma 6** + PostgreSQL (Supabase: `DATABASE_URL` pooler, `DIRECT_URL` migrations).
- **UI:** Tailwind 4 + shadcn; HUBs Lovable em subárvores com MemoryRouter e providers locais.
- **Estado global:** Zustand em fluxos operacionais; **loja ativa** via `LojaAtivaProvider` + cookie `assistec-active-store` (hífens; const `ASSISTEC_ACTIVE_STORE_COOKIE`) + header `x-assistec-loja-id`.
- **Padrão de dados:** muitas entidades usam **`payload` JSONB** como fonte rica de estado; enums Prisma como “visão colapsada” (ex.: status OS).
- **Backend:** Server Actions preferidas para mutações do dashboard; **API Routes** para automações, webhooks, clientes HTTP externos e painéis que já consomem REST.
- **Deploy:** Vercel; riscos de **cache** e **ENV** documentados (`VERCEL_PROD_DATA_EMPTY_DIAGNOSIS.md`, checklist produção).

### 1.3 Módulos “de produto” (nome comercial vs código)

| Módulo | Rotas / áreas principais | Natureza |
|--------|--------------------------|----------|
| Dashboard | `/dashboard` | KPIs honestos (passo MVP 01); ainda majoritariamente visualização |
| Cadastros HUB | `/dashboard/cadastros-v2` | Server Actions + Prisma (híbrido maduro) |
| Estoque | `/dashboard/estoque`, APIs produtos | Prisma + consumo OS |
| Vendas / PDV | `/dashboard/vendas`, `?modo=rapido` | Transação real; caixa local por loja |
| Operações HUB | `/dashboard/operacoes-v2` | OS Prisma + adapters CR/estoque |
| OS legado | `/dashboard/os` | Fluxo completo paralelo |
| Financeiro HUB V2 | `/dashboard/financeiro-v2` | UI Lovable **plugada a dados reais** (FinanceiroRealProvider, header de loja); DRE/Fluxo = evolução de UI (R0-L5) |
| Financeiro legado | `components/dashboard/financeiro/*` | Contas a pagar **híbrido** server-first + localStorage espelho |
| WhatsApp HUB | `/dashboard/whatsapp` | **Conversas/mensagens/envio** ligados a Prisma + Meta Cloud API quando configurado |
| Marketing / IA Mestre | várias sob `/dashboard` | Misto real/mock conforme tela |
| Omni Agent | integrado ao dashboard | UX demonstrativa; execução auditável pendente (`AGENT_HUB.md`) |
| Billing | `/meu-plano`, APIs credits, Stripe | Stripe SaaS (commits dedicados) |
| Marketplace | doc placeholder | Não iniciado para integrações externas |

---

## 2. Implementações importantes (por módulo)

### 2.1 Financeiro

**Pronto (servidor):**

- Contratos e helpers: `lib/financeiro/contracts/` (`FINANCEIRO_CONTRACTS_STATUS_BASE.md`).
- Ledger lógico / tipos / serviços puros: `lib/financeiro/types/`, `lib/financeiro/services/` — **sem** novas tabelas dedicadas de ledger na entrega base (`FINANCEIRO_LEDGER_BASE.md`).
- **Contas a receber:** `lib/financeiro/services/contas-receber-service.ts` — upsert por `localKey`, histórico em `payload.historico`, baixas/estornos (`FINANCEIRO_RECEBER_SERVICE_REAL.md`, `FINANCEIRO_RECEBER_API_UNIFICATION.md`).
- **Contas a pagar:** `contas-pagar-service.ts` + `GET/POST /api/ops/contas-pagar-list|persist` + rotas `POST /api/financeiro/contas-pagar/*` (`FINANCEIRO_PAGAR_*`).
- **Painel legado contas a pagar:** híbrido localStorage + servidor (`FINANCEIRO_PAGAR_PAINEL_HIBRIDO.md`).
- **Adapter OS → receber:** materialização idempotente de título a partir do payload da OS (`OPERACOES_HUB_V2_OS_CONTAS_RECEBER_ADAPTER.md`).

**Parcial:**

- Financeiro HUB V2: UI premium **sobre dados reais** (FinanceiroRealProvider); DRE/Fluxo com evolução de UI pendente (R0-L5).
- Rotas `app/dashboard/financeiro/*`: vários stubs “em construção” — usuário pode cair em superfície sem dados.
- Fluxo de caixa / carteiras na UI V2: **plugados a dados reais** (`/api/financeiro/fluxo-caixa`, `/carteiras`); evolução de UI pendente (R0-L5).

**Pendente / decisão de produto:**

- Uma **entrada única** “Financeiro” que não confunda mock com Prisma (roadmap Fase B).
- Tabelas definitivas de ledger/movimento se o produto exigir conciliação multi-caixa server-side.

### 2.2 PDV

**Pronto:**

- `finalizeSaleTransaction` e integração com operações/financeiro (ver `docs/modules/VENDAS.md` e código em `components/dashboard/vendas`).
- CaixaStatusBar unificada; estado de caixa em **localStorage** por `storeId`.
- **BIPE / autocomplete:** busca por SKU, código, EAN, nome; UX teclado (`PDV_FIX_BUSCA_PRODUTOS.md`, `PDV_UX_AUTOCOMPLETE_IMPROVEMENTS.md`).
- **Layout:** AppShell flex, overflow controlado, PDV Assistência sem corte de topo (`PDV_FIXED_LAYOUT_POLISH.md`, `PDV_ASSISTENCIA_LAYOUT_FINAL.md`).
- **Modo rápido:** `lib/pdv-product-search.ts`, F3, layout coluna fixa (`PDV_RAPIDO_LAYOUT_E_BUSCA.md`).

**Parcial / risco:**

- Caixa só local → **multi-terminal** não é fonte única; documentar limite comercial ou evoluir para servidor.

### 2.3 Operações (OS)

**Pronto:**

- Lista/criação/atualização OS via Server Actions (`app/actions/operacoes.ts`) + serviços `lib/operacoes/services/`.
- Normalização de status granular vs enum Prisma (`OPERACOES_HUB_V2_STATUS_NORMALIZATION.md`).
- Anexos em IndexedDB com URLs estáveis (`OPERACOES_HUB_V2_ANEXOS_REAL.md`).
- Faturamento → CR (`OPERACOES_HUB_V2_FATURAMENTO_CHECKIN.md`).
- Estoque na entrega + restauração/delta (`OPERACOES_HUB_V2_ESTOQUE_*`, `OS_ESTOQUE_ADAPTER`).
- Peças com `produtoId` real (`OPERACOES_HUB_V2_PECAS_PRODUTO_REAL.md`).
- Política de orçamento aprovado (`OPERACOES_HUB_V2_ORCAMENTO_APROVADO_POLICY.md`).

**Parcial:**

- Narrativa antiga em alguns docs ainda fala “mock no hub” para certos painéis — cruzar com código atual ao retomar.
- **Duplicidade conceitual** com OS legado: decisão de produto pendente (P0 na auditoria).

### 2.4 WhatsApp

**Pronto (2026-05):**

- Modelos Prisma: `WhatsAppContact`, `WhatsAppConversation`, `WhatsAppMessage`, automações, quick replies, AI settings, logs (já existiam; migration histórica `0003_aux_ledger_audit_whatsapp_app_settings`).
- Serviço: `lib/whatsapp/whatsapp-service.ts` — contatos, conversas, mensagens, seed do hub, simulação de automação, sugestão IA local, envio legado `sendWhatsAppMessage` (DB), e funções **Cloud API** `sendCloudApi*AndRecord`.
- Cliente Graph: `lib/whatsapp.ts` — `sendTextMessage`, `sendTemplateMessage`, `sendMediaMessage`, validação de destino.
- Webhook Meta: `app/api/webhooks/whatsapp/route.ts` — GET challenge, POST com `X-Hub-Signature-256` (se `WHATSAPP_APP_SECRET` ou `META_APP_SECRET`), **`after()`** para processar sem bloquear resposta **200**, idempotência por `wamid`.
- Processamento: `lib/whatsapp-meta-cloud-webhook.ts` — upsert contato, conversa aberta, `addMessage` inbound.
- Envio HTTP: `POST /api/whatsapp/send` (texto, template, mídia).
- Server Actions: `app/actions/whatsapp.ts` — guard `auth()`.
- Webhook legado/simulação: `app/api/whatsapp/webhook/route.ts` (Evolution, `logWebhookPayload`, opcional `WHATSAPP_WEBHOOK_LEGACY_AI`).
- HUB: carrega `/api/whatsapp/conversations?includeMessages=1` com header loja; fallback mock; envio real quando há `conversationId`.

**Parcial:**

- Automações de **evento de sistema** ainda passam por simulação/logs; não disparan Meta automaticamente em todos os fluxos.
- Dashboard e cards de métricas no HUB ainda misturam números ilustrativos em abas não ligadas ao Prisma.

**Pendente:**

- Fila/worker se volume crescer; templates e opt-in comercial; observabilidade (métricas Meta + logs internos sem PII excessivo).

### 2.5 Auth

**Pronto:**

- NextAuth v5 + Credentials (`auth.ts`, `auth.config.ts`), login em `app/login`, `loading.tsx`.

**Parcial / crítico:**

- `AccessGate` e perfil staff ainda com **mock em localStorage** em fluxos de dashboard — inadequado para B2B sério sem hardening adicional (auditoria P0).

### 2.6 Billing

**Pronto (commits):**

- Stripe: checkout, portal, webhook, dashboard, plan-guard (`4661b9e`, `5000cfd`).

**Parcial:**

- Alinhar política comercial, créditos e trilha de auditoria com o que a UI promete (ver módulo créditos `/api/credits/*`).

### 2.7 Marketplace

- **Placeholder** (`docs/modules/MARKETPLACE.md`); sem integrações ML/Shopee etc.

### 2.8 Marketing IA

- Telas e APIs em `app/api/marketing/*`; partes mock (calendário, ideias); risco de custo de API sem teto — governança P2.

### 2.9 Omni Agent

- Hub integrado (`5fe1de0`); gráfico de vendas corrigido; doc `AGENT_HUB.md` descreve limitações — execução real auditável pendente.

### 2.10 Cadastros

- Server Actions `app/actions/cadastros.ts`; stats, produtos, clientes; hardening de erros em produção (`5c4ee37`).

### 2.11 Dashboard

- MVP passo 01: KPIs honestos, avisos de pré-visualização; gráficos marcados como exemplo.

### 2.12 Temas

- Sincronização global `data-studio-theme`, classes no `documentElement`, hubs chamando `applyGlobalTheme()` / equivalente WhatsApp.
- Doc `docs/themes/THEMES.md` ainda **placeholder** — gap de documentação.

### 2.13 IA (geral)

- IA Mestre: múltiplas sub-rotas com persistência local e simulações; créditos sincronizados via localStorage em parte (`6290970`).
- Regras de negócio IA: `AI_BUSINESS_RULES.md`, `AI_SYSTEM.md`, `WHATSAPP_AI.md`.

### 2.14 APIs

- Padrão: rotas dinâmicas `force-dynamic` + `revalidate = 0` onde listagens Prisma (`MVP_STABILIZATION_PASS_02.md`).
- Ops: `contas-receber-list`, `contas-pagar-list`, `ordens`, persistências, etc.
- Debug: `prod-health`, `dev-health` (guard em produção).

### 2.15 Prisma

- Schema amplo (multi-`Store`, OS, financeiro, WhatsApp, etc.).
- **Migrations nomeadas** (ver seção 12 abaixo); política: não `db push` em produção sem controle.

---

## 3. O que o Claude Code implementou (inferência)

Indícios: commits grandes com mensagens em português/inglês técnicas, merges `dev → main`, features completas (financeiro, operações, WhatsApp), documentação extensa em `docs/modules/reports/`, `CLAUDE.md`.

**Provável / forte:**

- Modularização backend operações (`OPERACOES_BACKEND_MODULARIZATION.md`).
- Services financeiros receber/pagar + APIs Ops + rotas financeiro pagar.
- Painel contas a pagar híbrido e relatórios financeiros associados.
- Operações HUB: adapters estoque e CR, política orçamento, anexos IndexedDB, normalização status.
- Sequência MVP estabilização (passes 01–06) + checklist deploy + smoke script.
- PDV: layout, BIPE, autocomplete, modo rápido.
- WhatsApp Cloud API (cliente, webhook novo, send, integração HUB) conforme `CHANGELOG` 2026-05-09.
- Billing Stripe completo.
- NextAuth v5 + movimentação de login.
- Proxy Edge fix.
- Reorganização da árvore `docs/` (`57f4229`).

**Não atribuível sem ambiguidade:**

- Pequenos fixes de UI pontuais misturados em merges.
- Conteúdo escrito apenas em chat sem commit correspondente.

---

## 4. O que o Cursor implementou (inferência)

Indícios: tarefas interativas de integração, ajustes finos, documentação pontual, sessões descritas pelo usuário como “Cursor”; commits menores “fix(ui)”, “fix(clientes)”.

**Provável:**

- Ajustes de dynamic/loading em várias rotas (`df59677`, `2884c00`, `ac5014f`, `9fabd5f`, etc.).
- Iterações em empty states / ErrorState (`84ca501`, `66eb251`).
- Documentação de continuidade e relatórios quando solicitados explicitamente pelo usuário no IDE.

**Importante:** muitos commits são **merge commits** ou squash — a divisão 3/4 é **heurística** para onboarding, não para auditoria legal de autoria.

---

## 5. Status atual real (checklist)

| Área | Status |
|------|--------|
| Prisma + migrations | ✅ Pronto |
| Operações HUB OS + adapters | ✅ Pronto (com ressalva duplicidade OS legado) |
| Financeiro servidor (CR/CP) | ✅ Pronto |
| Financeiro HUB V2 UI dados | ✅ Dados reais (DRE/Fluxo: evolução de UI) |
| PDV venda + layout | ✅ Pronto |
| Caixa multi-terminal | ⚠️ Parcial (localStorage) |
| WhatsApp conversas + webhook + send | ✅ Pronto (config ENV) |
| WhatsApp automações evento sistema | ⚠️ Parcial (simulação) |
| Auth sessão Credentials | ✅ Pronto |
| Auth staff gate produção | ❌ Pendente / mock |
| Stripe billing | ✅ Pronto (validar operação comercial) |
| Marketplace | ❌ Pendente |
| Omni Agent execução real | ❌ Pendente |
| Master console dados reais | ❌ Pendente |
| Dashboard KPIs agregados | ❌ Pendente (honesto mas não “vivo”) |

---

## 6. Principais decisões arquiteturais

1. **Multi-loja:** todo dado mutável escopado por `storeId`; header `x-assistec-loja-id` em escritas; cookie + fallback `LEGACY_PRIMARY_STORE_ID` em leituras.
2. **Payload JSONB** como fonte operacional rica; enums como projeção.
3. **Server Actions** para fluxo dashboard interno; **REST** para webhooks, integrações e clientes já acoplados a fetch.
4. **Híbrido localStorage + API** no financeiro legado até UI 100% server-first — aceite explícito de drift controlado por sync.
5. **Idempotência financeira:** `localKey` determinística (`os-faturamento:…`, `receber:…`, etc.).
6. **Hubs Lovable:** isolamento via MemoryRouter; tema sincronizado com shell global.
7. **Rotas dinâmicas** em APIs sensíveis a loja para evitar cache vazio na Vercel.
8. **Webhooks:** responder **200** rápido à Meta; processar com `after()` onde aplicável.
9. **Segredos:** nunca logar tokens WhatsApp/Stripe; checklist produção reforça.

---

## 7. Lista de pendências (consolidada da auditoria + roadmap)

### P0 — crítico

1. **Duplicidade OS:** HUB V2 vs `/dashboard/os` — decisão de produto e comunicação na UI.
2. **Financeiro percepção:** uma navegação que não misture mock e Prisma sem aviso claro.
3. **Auth staff:** substituir ou restringir mock `AccessGate` em produção paga.
4. **Deploy / dados zerados:** ENV, `storeId`, cache — processo de release (`VERCEL_PROD_DATA_EMPTY_DIAGNOSIS.md`).
5. **Expectativa de métricas:** não reintroduzir KPIs falsos no dashboard sem dados.

### P1 — importante

1. PDV/caixa: estratégia multi-terminal ou documentação explícita de limitação.
2. Contas a pagar: reduzir dependência de localStorage quando UI estável.
3. Contas a receber: rotas dashboard ou redirect único para painel real.
4. Vendas HUB: matriz real vs mock por feature.
5. Cadastros: smoke por `storeId` em staging espelhando produção.
6. Prisma: política `migrate dev` vs `db push` por ambiente.
7. Atualizar **AUDITORIA** linha WhatsApp (ainda menciona “sem Meta completa”) após revisão pós-integração.

### P2 — melhoria

1. Master Console → Prisma.
2. Marketing IA: limites e auditoria de crédito.
3. Omni Agent: sandbox e trilha.
4. Preencher placeholders: `CLIENTES.md`, `VENDAS.md`, `MARKETPLACE.md`, **`THEMES.md`**.
5. OpenAPI / catálogo interno de APIs.

### P3 — futuro

1. Marketplace externo.
2. Cadastro inteligente em massa (IA).
3. Eliminar cores hardcoded residuais onde violar design system.

---

## 8. Estado dos temas

| Tema | Estado no produto | Notas |
|------|-------------------|--------|
| **Light** | ✅ Suportado | Classe `light` no root; usado como fallback |
| **Soft Ice** | ✅ Suportado | Classe `soft-ice` |
| **Midnight** | ✅ Suportado | Classe `midnight` |
| **Black Edition** | ✅ Suportado | Hub WhatsApp mapeia tab “black” → `black-edition` global |
| **Quantum Violet** | ⚠️ Não como tema global nomeado | Aparece como **acento visual** (violet) em landing, marketing, alguns componentes PDV — **não** documentado como tema de studio em `THEMES.md` |
| **Futuros** | 💡 Sugestão | Documentar tokens semânticos em `THEMES.md`; opcional tema “High contrast”; alinhar landing neon com tokens do app ou manter escopado `.landing-page` |

---

## 9. Relatório dos PDVs

| Modo | Onde | Estado | Problemas conhecidos | Melhorias já feitas |
|------|------|--------|----------------------|---------------------|
| **Assistência** | Enterprise assistência | ✅ Operacional | Scroll/top cortado (histórico) | Layout final AppShell, ScrollArea carrinho, remoção `100vh` problemático |
| **Rápido** | `?modo=rapido` | ✅ Operacional | Dependência de catálogo carregado | `pdv-product-search`, F3, layout coluna direita |
| **Omni Smart / clássico** | `pdv-classic` | ✅ Operacional | Superfície grande; regressões visuais possíveis | BIPE unificado com modo rápido; mesma base de busca |

**Omni Smart** no código corresponde ao fluxo **clássico/enterprise** dentro de `pdv-classic` e shells associados — tratar “Smart” como marca de UX, não arquivo único isolado.

---

## 10. Financeiro (quadro único)

| Camada | Real | Mock/híbrido |
|--------|------|----------------|
| Contas a receber service | ✅ | UI HUB V2 receber |
| Contas a pagar service | ✅ | UI HUB V2 pagar |
| APIs Ops list/persist | ✅ | — |
| Baixas/estornos pagar | ✅ | Integração completa HUB V2 |
| Painel legado pagar | Híbrido | localStorage espelho |
| Fluxo de caixa / carteiras UI V2 | Serviços lógicos | UI mock |
| Ledger persistido | ❌ Gap modelagem | Tipos + serviços puros documentados |

**Fluxo de caixa:** depende de consolidação de movimentos; hoje há fundação em código sem tabelas dedicadas.

---

## 11. WhatsApp HUB (quadro único)

| Capacidade | Real | Mock / parcial |
|------------|------|----------------|
| Lista conversas + mensagens (Prisma) | ✅ Via API + header loja | Fallback `mockContacts` se vazio |
| Envio texto Meta | ✅ `/api/whatsapp/send` | Sem `conversationId` cai no optimistic local só |
| Template / mídia Meta | ✅ API send + actions | UI HUB não expõe todos os campos |
| Webhook Meta callback | ✅ `/api/webhooks/whatsapp` | URL antiga `/api/whatsapp/webhook` ainda existe (Evolution/legacy) |
| Verificação HMAC | ✅ Se secret configurado | Sem secret: aceita payload (ainda 200) — apenas para dev controlado |
| Store do webhook | `WHATSAPP_WEBHOOK_STORE_ID` ou legado | Multi-loja fina por número: melhoria futura |
| Automações keyword | Simulação + logs | Envio automático Meta não padrão em todos os ramos |
| Dashboard métricas HUB | Visual | Números fixos em cards superiores |

**URL webhook Meta (produção):** `https://omni-gestao-pro.vercel.app/api/webhooks/whatsapp`  
**Variáveis:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET` (recomendado), `WHATSAPP_WEBHOOK_STORE_ID` (opcional, loja do ingress).

---

## 12. Produção / Vercel

**Problemas já documentados:**

- Dados vazios por cache/ENV (`VERCEL_PROD_DATA_EMPTY_DIAGNOSIS.md`).
- Erro Server Component cadastros (`VERCEL_SERVER_COMPONENT_CADASTROS_ERROR.md`).

**Mitigações implementadas:**

- `force-dynamic` + `revalidate = 0` em rotas GET críticas.
- Smoke HTTP `scripts/smoke-production.mjs`.
- `/dashboard/dev-health` com guard (`ENABLE_DEV_HEALTH`).
- `GET /api/debug/prod-health`.

**ENV (ver checklist):** Supabase URLs, NextAuth secret, URLs app, Stripe, WhatsApp, flags dev-health.

---

## 13. Riscos atuais (sintetizados)

| Categoria | Risco |
|-----------|--------|
| Técnico | Drift schema entre ambientes; webhooks sem assinatura em dev |
| Arquitetura | Duas OS + duas superfícies financeiras |
| UX | Usuário acreditar que mock é produção |
| Deploy | Cache de API + loja errada |
| Dados | localStorage financeiro vs servidor; caixa local |
| Regulatório / custo | APIs Meta e IA sem limites claros no produto |

---

## 14. Próxima sequência recomendada (MVP → lançamento)

Alinhado a `ROADMAP.md` Fase B + auditoria:

1. **Congelar produto OS:** rota oficial + ocultar ou renomear a alternativa até migração.
2. **Auth real no dashboard** para perfis staff (ou feature flag de mock só em dev).
3. **Financeiro:** uma home que leve a painéis Prisma reais ou plug incremental do HUB V2 por abas.
4. **Dashboard:** APIs agregadoras ou manter placeholders honestos.
5. **Release train:** `tsc`, `build`, lint, checklist ENV, smoke, teste manual mínimo por módulo (`DEPLOY.md`).
6. **PDV:** documentar limite de caixa local; opcional sync server fase 2.
7. **WhatsApp:** revisar assinatura HMAC obrigatória em produção; monitorar logs sem PII; templates aprovados na Meta.
8. **Revisar AUDITORIA** tabela linha 16–17 (WhatsApp/Agent) vs código atual.
9. **Preencher `THEMES.md`** com mapa real de classes (`light`, `soft-ice`, `midnight`, `black-edition`) e relação com `data-studio-theme`.

---

## Apêndice A — Migrations Prisma (nome de pasta)

Ordem observada no repositório:

1. `0001_init_clientes_produtos`
2. `0002_product_price_cost`
3. `0003_aux_ledger_audit_whatsapp_app_settings`
4. `0004_multistore_stores_units`
5. `0005_multitenant_product_sku_composite`
6. `0006_store_settings_contact_per_store`
7. `0007_ledger_per_store_conta_receber_composite_localkey`
8. `0008_fornecedores_contas_pagar`
9. `0009_produto_barcode`

Novas features WhatsApp Cloud **reutilizaram** modelos existentes — sem migration dedicada “add_whatsapp” na pasta no momento desta consolidação.

---

## Apêndice B — Índice de relatórios `docs/modules/reports/` (principal)

MVP: `MVP_STABILIZATION_PASS_01.md` … `PASS_06.md`  
Financeiro: `FINANCEIRO_*`, `FINANCEIRO_PAGAR_PAINEL_HIBRIDO.md`  
Operações: `OPERACOES_HUB_V2_*`, `OPERACOES_BACKEND_MODULARIZATION.md`  
PDV: `PDV_*`  
Produção: `VERCEL_*`  
Auditoria: `AUDITORIA_GERAL_OMNIGESTAO_PRO.md`  
Check-in árvore: `WORKING_TREE_CHECKIN_2026_05_07.md`

---

## Apêndice C — Commits recentes (amostra `git log --oneline -25`)

Usar `git log` no clone para lista atualizada. Na consolidação deste documento, marcos incluem: `7f58507` (WhatsApp + PDV), `613922c` (proxy Edge), `499d7e5` (NextAuth v5), `4661b9e` (Stripe), passes MVP `66eb251` … `57f4229` (docs).

---

*Fim da memória viva — atualizar este arquivo a cada marco de release ou quando P0/P1 mudarem.*
