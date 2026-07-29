# Matriz de IAs por Etapa — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PROPOSTA OPERACIONAL — implementa a decisão D-14 do
[MASTER_PLAN §3](CATALOGO_SAAS_MASTER_PLAN_001.md): Fable ≈ 20–25% do esforço,
Sonnet ≈ 50%, modelos baratos ≈ 25%.

---

## 1. Princípios de alocação

1. **Código de dinheiro, segurança e dados = modelo mais forte.** Billing/webhooks,
   importador, política de visibilidade, rate limiting e modelo de dados são os lugares
   onde um erro custa caro e é silencioso — Fable executa ou revisa linha a linha.
2. **Implementação previsível = Sonnet.** CRUD, telas do design system, formulários,
   testes de componente: alto volume, padrões claros, revisão por diff.
3. **Volume barato = modelos baratos.** Conteúdo, pesquisa de mercado, rascunhos de
   curadoria em lote — desde que TUDO passe por aprovação (humana ou de modelo superior)
   antes de virar verdade.
4. **IA nunca decide gate humano.** Preço, marca, termos jurídicos, seleção de beta,
   liberação de capinhas: IA prepara material de decisão; o proprietário decide
   ([OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)).
5. **Curadoria da base segue fail-closed:** modelo barato pode SUGERIR (rascunho de
   alias, possível fonte); só curador humano aprova, e aprovação nunca promove status
   além do que a evidência sustenta ([BUSCA §5](BUSCA_E_COMPATIBILIDADE_001.md)).
6. **Todo PR de área crítica tem revisor diferente do autor** (Sonnet escreve → Fable
   revisa; Fable escreve → humano revisa o diff).

## 2. Matriz por etapa

| Etapa / GOALs ([BACKLOG](BACKLOG_GOALS_INICIAIS_001.md)) | Executor | Revisor | Racional |
| :--- | :--- | :--- | :--- |
| Fase 0 — fundação repo/CI (G-01) | Sonnet | Fable | setup padrão, mas envs/secrets exigem revisão forte |
| Fase 0 — tokens + shell PWA (G-02) | Sonnet | humano (visual) | design system é padrão conhecido |
| Modelo de dados + migrations (G-03) | **Fable** | humano | schema erra caro; migra mal, dói para sempre |
| Importador ETL + paridade (G-04, G-05) | **Fable** | humano | é a guarda dos números canônicos (935/136/34/765) |
| Motor de busca + ambiguidade (G-06, G-07) | **Fable** | Sonnet (testes) | portar o engine sem regressão de política |
| API de consulta + visibilidade (G-08) | **Fable** | humano | é a rota que pode vazar os 765 ocultos |
| Testes golden set / vazamento (G-09) | Sonnet | Fable | volume de casos; a política já veio decidida |
| Auth + orgs + dispositivos (G-10–G-12) | Sonnet | **Fable** | padrão Supabase Auth + DeviceSession próprio; sessões/limites são segurança |
| Billing + webhooks + trial (G-13–G-15) | **Fable** | humano | código de dinheiro; idempotência e conciliação |
| UI de consulta e resultado (G-16, G-17) | Sonnet | humano (visual) | telas do [UX §3](UX_DESIGN_SYSTEM_LANDING_001.md) |
| Listas + PDF + WhatsApp (G-18, G-19) | Sonnet | Fable (watermark) | UI padrão; watermark/fingerprint é segurança |
| Solicitação de modelo + notificações (G-20) | Sonnet | Sonnet | CRUD com regras simples |
| Admin mínimo + evidências (G-21, G-22) | Sonnet | **Fable** | UI padrão, mas os safeguards do [PAINEL_ADMIN §3](PAINEL_ADMIN_MODERACAO_001.md) são críticos |
| Rate limit + abuso + LGPD (G-23, G-25) | **Fable** | humano | segurança pura ([SEGURANCA](SEGURANCA_PROTECAO_BASE_001.md)) |
| Landing + demo + SEO (G-24) | Sonnet | humano (claims) | claims públicos = checklist do [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md), aprovação humana |
| Copy/microcopy, FAQ, e-mails | barato | humano | volume; tom validado por humano |
| Pesquisa de mercado/gaps (contínua) | barato | curador | rascunho de pesquisa → fila de curadoria |
| Curadoria em lote (fila de 527 + aliases) | barato | curador humano | sugere; nunca aplica ([PAINEL_ADMIN §4](PAINEL_ADMIN_MODERACAO_001.md)) |
| Beta: análise de feedback/métricas | Sonnet | humano | síntese de dados reais |
| Revisões de PR críticos (transversal) | **Fable** | — | papel permanente de revisor |

## 3. Distribuição-alvo do esforço

| Modelo | Fatia | Onde |
| :--- | :--- | :--- |
| **Fable** (mais caro, mais forte) | ≈ 20–25% | arquitetura, dados, importador, busca/visibilidade, billing, segurança, revisões críticas |
| **Sonnet** (cavalo de tração) | ≈ 50% | implementação de UI, CRUDs, auth, testes, integrações padrão |
| **Modelos baratos** | ≈ 25% | conteúdo, pesquisa, curadoria em lote, rascunhos |

A fatia do Fable é maior no INÍCIO (fundação de dados/busca/billing) e cai quando o
projeto vira manutenção — inverter isso (barato na fundação, caro na manutenção) é o
anti-padrão que gera retrabalho.

## 4. Regras operacionais

1. **Contexto mínimo obrigatório:** toda sessão de IA recebe o documento do GOAL, os
   números canônicos ([MASTER_PLAN §2](CATALOGO_SAAS_MASTER_PLAN_001.md)) e a lista de
   proibições (86.738, promoção de status, capinhas).
2. **Nunca modelo barato em código de dinheiro/segurança/dados** — nem para "ajuste
   pequeno".
3. **Curadoria em lote:** barato gera CSV de sugestões com fonte → curador aprova no
   admin → vira evidência `user_report`/rascunho — nunca escrita direta no catálogo.
4. **Cada GOAL termina com o relatório padrão** (o que mudou, testes, o que NÃO foi
   feito) — disciplina já praticada no OmniGestão.
5. **Regressão de política = rollback imediato** e o GOAL volta com executor mais forte.

## 5. O que NUNCA é delegado a IA (qualquer uma)

- Decisões dos gates humanos ([OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md));
- aprovação final de evidência/publicação de catálogo (curador humano);
- textos jurídicos finais (termos, privacidade, reembolso) — IA rascunha, advogado/humano
  aprova;
- resposta pública a incidente de segurança ou LGPD;
- promessas comerciais novas (claims fora do [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md)).
