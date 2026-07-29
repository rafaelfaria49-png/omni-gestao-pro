# ADRs — Decisões de Arquitetura — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026 (atualizado em 28 de Julho de 2026 — `CATALOGO-SAAS-INFRA-SUPABASE-DEDICADO-003`)
**Status:** ADRs de produto seguem **PROPOSTOS** (aceitos no plano; ratificação final do
proprietário junto aos gates de [OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)).
[ADR-011](#adr-011--supabase-dedicado-como-plataforma-de-dados-autenticação-e-arquivos) é
**APROVADA** (decisão de infraestrutura já ratificada pelo proprietário), supersedendo
[ADR-002](#adr-002--neon-postgresql-em-projeto-novo-e-isolado-substituindo-supabase-supersedida-por-adr-011)
e [ADR-004](#adr-004--nextauth-v5-com-sessões-amarradas-a-devicesession-própria-supersedida-por-adr-011).
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

## ADR-002 — Neon PostgreSQL em projeto NOVO e isolado (substituindo Supabase) — SUPERSEDIDA por ADR-011

> **SUPERSEDIDA em 28 de Julho de 2026.** Ver
> [ADR-011](#adr-011--supabase-dedicado-como-plataforma-de-dados-autenticação-e-arquivos).
> O banco do OmniCompat passou a ser **Supabase Database (PostgreSQL)**, em projeto
> exclusivo. O texto abaixo é mantido como **registro histórico** da decisão anterior.

- **Contexto:** o novo SaaS (OmniCompat) exige banco relacional relacional moderno, isolado do OmniGestão Pro.
- **Decisão (histórica, supersedida):** Neon PostgreSQL em projeto 100% NOVO e exclusivo do OmniCompat. ORM via Prisma com conexões pooled para a aplicação e direct para migrations (`prisma migrate`). Nenhum compartilhamento de tabelas, credenciais ou ambiente com o OmniGestão Pro. Auth via Auth.js e anexos em Cloudflare R2.
- **Alternativas:** (a) Supabase — à época, substituído por Neon; reintroduzido pela ADR-011 como plataforma dedicada e isolada; (b) banco do OmniGestão — proibido por acoplamento.
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

## ADR-004 — NextAuth v5 com sessões amarradas a DeviceSession própria — SUPERSEDIDA por ADR-011

> **SUPERSEDIDA em 28 de Julho de 2026.** Ver
> [ADR-011](#adr-011--supabase-dedicado-como-plataforma-de-dados-autenticação-e-arquivos).
> A autenticação do OmniCompat passou a ser **Supabase Auth**, com o controle de
> dispositivos (`DeviceSession`) preservado como regra de negócio na camada de aplicação.
> O texto abaixo é mantido como **registro histórico** da decisão anterior.

- **Contexto:** o limite de dispositivos por plano é regra de NEGÓCIO central
  ([PLANOS §7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)) — não pode depender das
  limitações do provedor de auth.
- **Decisão (histórica, supersedida):** Auth.js / NextAuth v5 com contas e sessões no Neon PostgreSQL e DeviceSession própria, JWT de vida
  curta validado contra `DeviceSession` server-side; revogação de dispositivo mata a
  sessão ([SEGURANCA §3](SEGURANCA_PROTECAO_BASE_001.md)). Magic link na Fase 2.
- **Alternativas:** Supabase Auth — à época, descontinuado do escopo; readotado pela ADR-011
  com DeviceSession própria preservada por cima do Supabase Auth; Clerk — custo por MAU e
  lock-in num produto de margem apertada.
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

## ADR-011 — Supabase dedicado como plataforma de dados, autenticação e arquivos

- **Contexto:** o GOAL `CATALOGO-SAAS-INFRA-SUPABASE-DEDICADO-003` revisita a escolha de
  infraestrutura registrada em ADR-002/ADR-004. Operar banco, autenticação e storage em
  três produtos separados (Neon + Auth.js + Cloudflare R2) multiplica contas, credenciais
  e superfícies de configuração para um MVP tocado por 1 dev + IAs.
- **Decisão anterior:** Neon PostgreSQL (banco) + Auth.js/NextAuth v5 (autenticação) +
  Cloudflare R2 (storage), registradas em
  [ADR-002](#adr-002--neon-postgresql-em-projeto-novo-e-isolado-substituindo-supabase-supersedida-por-adr-011)
  e [ADR-004](#adr-004--nextauth-v5-com-sessões-amarradas-a-devicesession-própria-supersedida-por-adr-011).
  Ambas ficam **SUPERSEDIDAS** por esta ADR.
- **Decisão nova:** adotar **Supabase Database (PostgreSQL) + Supabase Auth + Supabase
  Storage** como plataforma de dados, autenticação e arquivos do OmniCompat, em conta,
  organização e projeto **exclusivos e isolados** do OmniGestão Pro — nunca a conta
  Supabase hoje usada pelo OmniGestão Pro (capacidade já comprometida) e sem qualquer
  compartilhamento de tabelas, Auth, buckets, credenciais ou ambiente. Prisma continua
  como ORM das tabelas de domínio do OmniCompat, conectado ao Postgres do Supabase
  (conexão pooled para runtime da aplicação, conexão direct para migrations e tarefas
  administrativas); o schema interno de Auth/Storage do Supabase não é recriado nem
  gerenciado pelo Prisma, e nenhuma migration do Prisma pode ser destrutiva sobre esses
  schemas.
- **Motivos:** reunir banco + autenticação + storage numa única plataforma reduz o número
  de contas/credenciais/serviços operados no MVP; simplifica desenvolvimento e
  administração por um único operador; mantém isolamento total do OmniGestão Pro através
  de projeto próprio, sem reutilizar a conta Supabase comprometida nem a infraestrutura
  Neon usada por outro projeto.
- **Alternativas consideradas:** (a) manter Neon + Auth.js + Cloudflare R2 — descartada:
  três contas/credenciais separadas para o mesmo problema que o Supabase resolve
  unificado; (b) reaproveitar o projeto/conta Supabase atual do OmniGestão — **proibida**:
  capacidade já comprometida e quebraria o isolamento entre produtos (ADR-001); (c)
  Clerk/PlanetScale/outros — mesmas objeções de custo e lock-in já registradas em
  ADR-002/ADR-004.
- **Benefícios:** menos serviços e credenciais no MVP; RLS nativo como defesa em
  profundidade ([SEGURANCA](SEGURANCA_PROTECAO_BASE_001.md)); Storage integrado dispensa
  configuração S3-compatible separada; Auth com helpers SSR para Next.js reduz código
  próprio de sessão (o controle de dispositivos via `DeviceSession` continua sendo regra
  de negócio da aplicação, não do provedor).
- **Riscos:** dependência de uma única plataforma para banco+auth+storage (menor
  redundância de fornecedor); conta nova, sem histórico, exige governança cuidadosa;
  limites do plano gratuito podem não sustentar produção.
- **Mitigadores:** MFA obrigatório e recuperação segura na conta nova; avaliação de plano
  pago e de backups ANTES do lançamento comercial; chave privilegiada (service-role) só no
  servidor, nunca em `NEXT_PUBLIC_*`, nunca commitada; abstrações próprias de storage e
  autorização na aplicação para permitir migração futura se necessário.
- **Impacto no roadmap:** nenhuma mudança nas fases ou prazos-hipótese do
  [ROADMAP](ROADMAP_IMPLEMENTACAO_001.md) — é troca de infraestrutura, não de escopo de
  produto.
- **Impacto no G-01:** [BACKLOG G-01](BACKLOG_GOALS_INICIAIS_001.md) passa a prever
  Supabase (Database/Auth/Storage) como plataforma planejada, com `.env.example` de
  placeholders Supabase; a fundação continua sem criar conta, projeto, banco real ou
  autenticação real.
- **Estado:** **APROVADO** pelo proprietário — GOAL `CATALOGO-SAAS-INFRA-SUPABASE-DEDICADO-003`.
- **Neon PostgreSQL, Auth.js/NextAuth v5 e Cloudflare R2 estão SUPERSEDIDOS** como
  arquitetura vigente do OmniCompat; permanecem apenas como registro histórico em
  ADR-002/ADR-004.
- **Data da decisão:** 28 de Julho de 2026.
- **Reavaliação:** esta escolha pode ser revista se custos, limites de plano ou riscos do
  Supabase mudarem materialmente antes do lançamento em produção — nenhuma decisão de
  infraestrutura deste plano é permanente por padrão.
