# Roadmap de Implementação — Fases 0–5 — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PROPOSTA — durações são **hipóteses de planejamento** (1 dev orquestrando IAs,
dedicação parcial); gates nunca são pulados por calendário. A Fase 4 **não tem data por
decisão** ([MASTER_PLAN §4](CATALOGO_SAAS_MASTER_PLAN_001.md)).

---

## 0. Visão geral

| Fase | Nome | Objetivo | Duração-hipótese | Gate de saída |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Fundação | Repo, infra, CI/CD, design tokens, esqueleto PWA | ~1 semana | deploy vazio em produção + CI verde |
| 1 | MVP vendável | Produto completo do [PRD §4](PRD_CATALOGO_SAAS_MVP_001.md) | ~6–9 semanas | 7 critérios de aceite do PRD + checklist [SEGURANCA §10](SEGURANCA_PROTECAO_BASE_001.md) |
| 2 | Beta fechado → lançamento | Validar com lojas reais; abrir com preço fundador | ~4–6 semanas | métricas de beta ([METRICAS §5](METRICAS_E_ANALYTICS_001.md)) + gates comerciais |
| 3 | Pro completo | Multi-loja, equipe, relatórios; 2º provedor se dados pedirem | ~3–5 semanas | adoção Pro + churn sob controle |
| 4 | Capinhas por evidência | Bancada digital + rede de lojas parceiras | **sem data** | ≥ N modelos `confirmado_bancada` de capinha (N no gate) |
| 5 | Plataforma | API pública, integrações (OmniGestão, fornecedores) | por demanda | contrato de API estável |

Transversal a todas as fases: **curadoria contínua da base** (fila de 527 itens + 10 gaps
de mercado + 34 pares beta a confirmar + 765 ocultos aguardando evidência), meta-hipótese
de 30 itens/semana ([PAINEL_ADMIN §5](PAINEL_ADMIN_MODERACAO_001.md)).

---

## 1. Fase 0 — Fundação (~1 semana)

**Entregas** ([BACKLOG G-01, G-02](BACKLOG_GOALS_INICIAIS_001.md)):

- Repositório novo, projeto Vercel novo, projeto Neon PostgreSQL novo e isolado (isolado —
  [ADR-001/ADR-002](ADR_DECISOES_ARQUITETURA_001.md)); ambientes dev/preview/prod com
  envs separadas ([ARQUITETURA §6](ARQUITETURA_CATALOGO_SAAS_001.md)).
- Next.js + TS strict + Tailwind/shadcn + tokens semânticos (incl. tokens de confiança —
  [UX §1](UX_DESIGN_SYSTEM_LANDING_001.md)) + shell PWA instalável.
- CI: typecheck, lint, testes, build; deploy preview por PR; headers de segurança.

**Critérios de aceite:** deploy de produção acessível (página "em construção"); CI
bloqueando merge em falha; dark mode funcionando; zero cor hardcoded.

**Riscos:** [R-19](REGISTRO_RISCOS_001.md) (acoplamento acidental ao OmniGestão — mitigado
por repo/conta de projeto novos desde o 1º commit).

## 2. Fase 1 — MVP vendável (~6–9 semanas)

Ordem de implementação (a mesma da resposta 20 do
[MASTER_PLAN §6](CATALOGO_SAAS_MASTER_PLAN_001.md); GOALs detalhados no
[BACKLOG](BACKLOG_GOALS_INICIAIS_001.md)):

| # | Bloco | GOALs | Por que nesta ordem |
| :--- | :--- | :--- | :--- |
| 1 | Modelo de dados + migrations | G-03 | tudo depende do schema |
| 2 | Importador ETL + publicação/rollback | G-04, G-05 | dados reais antes de qualquer UI ([IMPORTACAO](IMPORTACAO_DADOS_EXISTENTES_001.md)) |
| 3 | Motor de busca + fuzzy + ambiguidade | G-06, G-07 | o coração do produto, testável sem UI |
| 4 | API de consulta + testes de vazamento/golden set | G-08, G-09 | trava a política de visibilidade ANTES da UI |
| 5 | Auth + organizações + dispositivos | G-10, G-11, G-12 | identidade antes de cobrança |
| 6 | Billing PaymentProvider + webhooks + trial/paywall | G-13, G-14, G-15 | dinheiro com calma e testes de contrato |
| 7 | UI de consulta (busca/resultado) + favoritos/histórico | G-16, G-17 | agora a UI consome API estável |
| 8 | Lista de compras + PDF + WhatsApp | G-18, G-19 | o funil busca→pedido do [PRD §6](PRD_CATALOGO_SAAS_MVP_001.md) |
| 9 | Solicitação de modelo + notificações | G-20 | motor de crescimento da base |
| 10 | Admin mínimo (catálogo + evidências + auditoria) | G-21, G-22 | curadoria operável antes do beta |
| 11 | Rate limiting + sinais de abuso + LGPD | G-23, G-25 | proteção ligada antes de estranhos entrarem |
| 12 | Landing + demo limitada + SEO técnico | G-24 | por último: vende o que já existe |

**Critérios de aceite da fase = gate do beta** (os 7 do [PRD §4](PRD_CATALOGO_SAAS_MVP_001.md)):
p95 < 300 ms; 100% das respostas com selo; zero exposição dos 765 ocultos; ativação só por
webhook; PDF sempre com watermark; limite de dispositivos no servidor; zero claims
inventados na landing. Mais o checklist completo de
[SEGURANCA §10](SEGURANCA_PROTECAO_BASE_001.md).

**Riscos principais:** [R-08](REGISTRO_RISCOS_001.md) (regressão de métricas falsas —
mitigado pela paridade em CI), [R-10](REGISTRO_RISCOS_001.md) (billing — mitigado por
testes de contrato + conciliação diária).

## 3. Fase 2 — Beta fechado → lançamento (~4–6 semanas)

**Beta fechado** (gate humano: seleção de 15–30 lojas —
[OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)):

- Contas de cortesia auditadas; canal de feedback direto (WhatsApp);
- métrica central: **taxa de busca-sem-resposta real** ([METRICAS §3](METRICAS_E_ANALYTICS_001.md))
  — decide se a cobertura sustenta lançamento aberto ([MASTER_PLAN §6.2](CATALOGO_SAAS_MASTER_PLAN_001.md));
- curadoria intensiva guiada por zero-results (fila + gaps).

**Entregas de produto:**

- Moderação de contribuições completa ([PAINEL_ADMIN §4](PAINEL_ADMIN_MODERACAO_001.md));
- magic link ([ARQUITETURA §2.4](ARQUITETURA_CATALOGO_SAAS_001.md));
- ajustes de conversão da landing/trial guiados por dados;
- decisão de SEO programático (gate — [SEGURANCA §6](SEGURANCA_PROTECAO_BASE_001.md));
- dashboard de abuso avançado.

**Lançamento aberto:** preço fundador (primeiras 100 organizações OU 90 dias —
[PLANOS §3.3](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)); depoimentos reais do beta (com
autorização) entram na landing ([UX §4.4](UX_DESIGN_SYSTEM_LANDING_001.md)).

**Critérios de saída:** conversão trial→pago e churn dentro das faixas-hipótese de
[METRICAS §5](METRICAS_E_ANALYTICS_001.md); zero incidentes de vazamento; fila de
curadoria em ritmo sustentável.

## 4. Fase 3 — Pro completo (~3–5 semanas)

- Multi-loja (até 3 organizações filhas), papéis finos de equipe, relatórios de uso
  ([PLANOS §2](PLANOS_ASSINATURAS_PAGAMENTOS_001.md));
- exportação CSV controlada (só listas próprias);
- **decisão por dados:** se a perda de conversão por ausência de PIX mensal for relevante,
  implementar Mercado Pago atrás da interface `PaymentProvider`
  ([PLANOS §5](PLANOS_ASSINATURAS_PAGAMENTOS_001.md), [ADR-005](ADR_DECISOES_ARQUITETURA_001.md));
- melhoria de curadoria assistida (sugestões em lote geradas por IA barata, sempre
  aprovadas por humano — [MATRIZ_IAS §4](MATRIZ_IAS_POR_ETAPA_001.md)).

## 5. Fase 4 — Capinhas por evidência (SEM DATA)

Pré-condições para sequer iniciar (todas):

1. Películas em regime estável (churn/curadoria sob controle);
2. Protocolo de bancada digital rodando para películas
   ([PAINEL_ADMIN §6](PAINEL_ADMIN_MODERACAO_001.md));
3. Gate humano definindo **N** (quantos modelos com `confirmado_bancada` de capinha
   liberam o módulo) e a rede inicial de lojas parceiras.

**Entregas:** protocolo de capinha (campos extras: botões, portas, aberturas), formulário
de bancada mobile, dupla verificação, `FeatureFlag capinhas_module` (nasce `false` —
[MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md)), comunicação: continua só na FAQ até o
gate liberar.

**Proibições permanentes:** aprovação automática por dimensões
([PAINEL_ADMIN §6](PAINEL_ADMIN_MODERACAO_001.md)); qualquer anúncio com data; qualquer
dado de capinha fora do fluxo de bancada.

## 6. Fase 5 — Plataforma (por demanda)

- API pública autenticada (chaves por organização, rate limit próprio, escopo de leitura);
- integração OmniGestão↔SaaS **via API** (nunca banco compartilhado —
  [ARQUITETURA §5](ARQUITETURA_CATALOGO_SAAS_001.md));
- integrações com fornecedores (pedido direto);
- relatórios gerenciais avançados.

Só entra o que tiver demanda comprovada por assinantes pagantes.

## 7. Princípios de execução do roadmap

1. **Gate nunca é pulado por calendário** — data é hipótese, critério é lei.
2. **Cada bloco da Fase 1 termina com testes verdes em CI** antes do próximo começar
   (evita "MVP 90% pronto para sempre").
3. **Curadoria não para durante o desenvolvimento** — a base é o produto.
4. **Toda mudança de escopo volta ao planejamento** — este roadmap é revisado, não
   ignorado.
5. **Nada de código antes dos gates humanos do Grupo A**
   ([OPEN_QUESTIONS §2](OPEN_QUESTIONS_GATES_HUMANOS_001.md)) — marca, preços e termos
   influenciam repo, seeds de plano e landing.
