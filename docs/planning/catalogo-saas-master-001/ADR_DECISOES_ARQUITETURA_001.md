# ADRs — Decisões de Arquitetura — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** Todos os ADRs estão **PROPOSTOS** (aceitos no plano; ratificação final do
proprietário junto aos gates de [OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)).
Formato: Contexto → Decisão → Alternativas → Consequências.

---

## ADR-001 — Projeto e repositório independentes do OmniGestão

- **Contexto:** o SaaS nasce de dados e código auditados dentro do monorepo do
  OmniGestão, mas é um produto comercial distinto, com ciclo de vida, billing e risco
  próprios.
- **Decisão:** repositório novo, projeto Vercel novo, sem NENHUMA dependência runtime do
  OmniGestão. Reaproveitamento só por cópia vendorizada (engine puro) e snapshot de dados
  ([ARQUITETURA §5](ARQUITETURA_CATALOGO_SAAS_001.md)).
- **Alternativas:** (a) módulo dentro do monorepo — descartado: acopla deploys, risco de
  vazar dados entre produtos, polui o escopo de cada sessão de IA; (b) monorepo novo com
  dois apps — descartado: complexidade sem segundo app real.
- **Consequências:** (+) isolamento total de falhas e de dados; sessões de IA com
  contexto limpo; venda/spin-off futuro simples. (−) correções no engine copiado não
  fluem automaticamente (aceito: o engine é pequeno e estável).

## ADR-002 — Neon PostgreSQL em projeto NOVO e isolado (substituindo Supabase)

- **Contexto:** o novo SaaS (OmniCompat) exige banco relacional relacional moderno, isolado do OmniGestão Pro.
- **Decisão:** Neon PostgreSQL em projeto 100% NOVO e exclusivo do OmniCompat. ORM via Prisma com conexões pooled para a aplicação e direct para migrations (`prisma migrate`). Nenhum compartilhamento de tabelas, credenciais ou ambiente com o OmniGestão Pro. Auth via Auth.js e anexos em Cloudflare R2.
- **Alternativas:** (a) Supabase — substituído oficialmente nesta atualização; (b) banco do OmniGestão — proibido por acoplamento.
- **Consequências:** (+) isolamento total de dados, escalabilidade serverless nativa. (−) storage de anexos abstraído no Cloudflare R2.

## ADR-003 — Monolito modular Next.js na Vercel (sem microserviços/filas)

- **Contexto:** dataset minúsculo (429 modelos, 1.443 linhas), tráfego inicial de
  dezenas-centenas de assinantes, 1 dev + IAs.
- **Decisão:** um único app Next.js App Router (site público + app + admin), Server
  Actions para mutações, Route Handlers para busca/webhooks; Vercel Cron para jobs;
  nenhuma fila ([ARQUITETURA §1–3](ARQUITETURA_CATALOGO_SAAS_001.md)).
- **Alternativas:** microserviços/K8s — complexidade sem demanda; app separado para
  admin — dobra deploy e auth sem ganho no MVP.
- **Consequências:** (+) 1 deploy, 1 codebase, custo < R$ 300/mês, padrão que o time já
  opera. (−) escala vertical limitada — suficiente até ~1.000 assinantes por projeção;
  reavaliar depois.

## ADR-004 — NextAuth v5 com sessões amarradas a DeviceSession própria

- **Contexto:** o limite de dispositivos por plano é regra de NEGÓCIO central
  ([PLANOS §7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)) — não pode depender das
  limitações do provedor de auth.
- **Decisão:** Auth.js / NextAuth v5 com contas e sessões no Neon PostgreSQL e DeviceSession própria, JWT de vida
  curta validado contra `DeviceSession` server-side; revogação de dispositivo mata a
  sessão ([SEGURANCA §3](SEGURANCA_PROTECAO_BASE_001.md)). Magic link na Fase 2.
- **Alternativas:** Supabase Auth — descontinuado do escopo e dificulta o controle fino de
  sessão/dispositivo; Clerk — custo por MAU e lock-in num produto de margem apertada.
- **Consequências:** (+) controle total do fluxo, zero custo por usuário, experiência já
  operada. (−) recuperação de senha/verificação são responsabilidade nossa (Resend).

## ADR-005 — Interface `PaymentProvider` para gateway em aberto

- **Contexto:** cobrança recorrente é o código mais perigoso do MVP; o time já opera
  Stripe Billing em produção; PIX é forte no público-alvo.
- **Decisão:** Abstração total de cobrança atrás da interface `PaymentProvider`. O gateway definitivo permanece em aberto (Stripe, Mercado Pago, Pagar.me e Asaas em avaliação técnica de taxas, Pix, cartão recorrente, parcelamento, webhooks e suporte CNPJ BR).
- **Alternativas:** Mercado Pago primeiro — PIX nativo e marca forte no lojista, mas
  DX/portal/dunning inferiores e zero experiência do time em código de dinheiro novo;
  dois provedores no MVP — dobra a superfície de erro.
- **Consequências:** (+) menor risco de erro financeiro; dunning/portal prontos.
  (−) fraqueza PIX mensal — mitigada no pré-pago e monitorada
  ([R-11](REGISTRO_RISCOS_001.md)); adicionar provedor depois é implementação da
  interface, não reescrita.

## ADR-006 — Motor de busca em memória + `pg_trgm` (sem search engine externo)

- **Contexto:** 429 modelos e 1.751 aliases cabem em < 5 MB; o engine puro já existe,
  auditado, com normalização/cascata/ambiguidade validadas por testes.
- **Decisão:** vendorizar o engine (`lib/catalogo-aparelhos/`), índice em memória por
  instância chaveado por `catalogVersion`, `pg_trgm` como fallback fuzzy controlado
  ([BUSCA §2](BUSCA_E_COMPATIBILIDADE_001.md)).
- **Alternativas:** Elasticsearch/Algolia/Meilisearch — custo e operação para um dataset
  que cabe em RAM; `pg_trgm` para tudo — perde a semântica fina de ranking/ambiguidade
  já construída.
- **Consequências:** (+) p95 < 300 ms sem infra nova; comportamento já testado.
  (−) reconstrução de índice por instância no cold start (aceitável: < 5 MB); disciplina
  de invalidação por versão.

## ADR-007 — Pares de compatibilidade DERIVADOS, nunca armazenados como verdade

- **Contexto:** a explosão 86.736/86.738 nasceu de materializar pares a partir de um
  pseudo-grupo. Pares armazenados divergem silenciosamente da fonte.
- **Decisão:** a verdade primária é `FilmCompatibility` (modelo↔grupo, ou `self`); pares
  A↔B emergem por derivação com status = pior lado
  ([MODELO_DADOS — FilmCompatibility](MODELO_DADOS_CONCEITUAL_001.md)). A matriz de 935
  pares da auditoria é oráculo de validação, não tabela.
- **Alternativas:** tabela de pares materializada — performance marginal num dataset
  minúsculo, ao custo do risco de dessincronização que já nos queimou.
- **Consequências:** (+) impossível o par contradizer a fonte; correção P0 virou
  arquitetura. (−) derivação a cada build de índice (barata; cacheada por versão).

## ADR-008 — Status derivado de evidência, fail-closed, sem promoção automática

- **Contexto:** o valor do produto é a confiança honesta; uma promoção automática errada
  destrói o diferencial.
- **Decisão:** status de compatibilidade é DERIVADO da pior evidência ativa pela ordem de
  [BUSCA §5.2](BUSCA_E_COMPATIBILIDADE_001.md); import nunca promove
  ([IMPORTACAO §4](IMPORTACAO_DADOS_EXISTENTES_001.md)); override manual só REBAIXA;
  `confirmado_bancada` só nasce de BenchTest aprovado com dupla verificação.
- **Alternativas:** status editável direto pelo curador — mais rápido e mais perigoso
  (foi assim que bases concorrentes ficaram não confiáveis); promoção por múltiplos
  user_reports — aceita só até `multiplas_fontes_publicas` com ≥ 3 organizações
  distintas ([PAINEL_ADMIN §4](PAINEL_ADMIN_MODERACAO_001.md)).
- **Consequências:** (+) o selo verde é defensável; auditoria completa por evidência.
  (−) curadoria mais trabalhosa — é o preço do produto ser honesto.

## ADR-009 — Catálogo versionado com publicação atômica e rollback

- **Contexto:** uma edição errada de catálogo envenena resultados para todos os
  assinantes ([PAINEL_ADMIN §3](PAINEL_ADMIN_MODERACAO_001.md)).
- **Decisão:** toda mutação publicada gera `CatalogVersion` (manifesto + stats);
  publicação é transação atômica com simulação de impacto e invariantes hard-gate;
  rollback = repontar versão (< 1 min); cache de busca chaveado pela versão
  ([IMPORTACAO §6](IMPORTACAO_DADOS_EXISTENTES_001.md)).
- **Alternativas:** edição direta com backup diário — janela de horas de dados
  envenenados; event sourcing completo — overengineering.
- **Consequências:** (+) publicar deixa de ser ato de fé; diff e história por versão.
  (−) fluxo de edição em 2 passos (rascunho→publicar) — desejado, não tolerado.

## ADR-010 — PWA sem offline de dados

- **Contexto:** balcão quer app instalável e rápido; mas cache offline da base = a base
  inteira no dispositivo do assinante, ou seja, exportação gratuita
  ([SEGURANCA §4](SEGURANCA_PROTECAO_BASE_001.md)).
- **Decisão:** PWA instalável com cache do SHELL apenas; dados sempre online; estado
  offline honesto ("sem conexão — os dados exigem internet",
  [UX §1](UX_DESIGN_SYSTEM_LANDING_001.md)).
- **Alternativas:** offline dos favoritos — reavaliável no futuro com payload mínimo e
  expiração curta (fica FORA do MVP); app nativo — custo sem ganho para o caso de uso.
- **Consequências:** (+) proteção da base preservada; PWA continua instalável e rápido.
  (−) sem consulta em queda de internet — limitação comunicada com honestidade.
