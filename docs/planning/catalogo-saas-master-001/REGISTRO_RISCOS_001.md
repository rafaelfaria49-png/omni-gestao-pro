# Registro de Riscos — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** VIVO — revisar a cada fase do [ROADMAP](ROADMAP_IMPLEMENTACAO_001.md) e a cada
incidente. Probabilidade (P) e Impacto (I): Baixo / Médio / Alto. Dono no MVP: o
proprietário, salvo indicação.

---

## 1. Tabela-resumo (20 riscos)

| ID | Risco | P | I | Resposta |
| :--- | :--- | :---: | :---: | :--- |
| R-01 | Cobertura percebida como insuficiente (zero-results alto) | A | A | mitigar |
| R-02 | Scraping/cópia da base por concorrente | M | A | mitigar + rastrear |
| R-03 | Erro de compatibilidade gera prejuízo e responsabilização | M | A | mitigar |
| R-04 | Reação de preço do concorrente líder | M | M | aceitar + diferenciar |
| R-05 | Conversão trial→pago abaixo da hipótese | M | A | mitigar por dados |
| R-06 | Churn alto pós-lançamento | M | A | mitigar |
| R-07 | Curadoria depende de 1 pessoa (bus factor) | A | A | mitigar |
| R-08 | Regressão das métricas falsas (estilo 86.738) | B | A | prevenir (CI) |
| R-09 | Vazamento dos 765 pares ocultos por bug de rota | B | A | prevenir (teste) |
| R-10 | Falha de billing/webhook (acesso errado, cobrança errada) | M | A | prevenir |
| R-11 | Ausência de PIX mensal perde clientes | M | M | monitorar + evoluir |
| R-12 | Pressão comercial por capinhas sem base | A | M | política firme |
| R-13 | Preço fundador anual comprime margem além do previsto | M | M | limitar coorte |
| R-14 | Incidente LGPD/vazamento de dados pessoais | B | A | prevenir + playbook |
| R-15 | Lock-in de Gateway dificulta migração futura | M | M | abstração + export |
| R-16 | SEO programático expõe a base | B | A | prevenir (gate) |
| R-17 | Gap de lançamentos 2024–2026 frustra early adopters | A | M | mitigar (curadoria) |
| R-18 | Marca/domínio indisponível ou colidente (INPI) | M | M | resolver antes do código |
| R-19 | Acoplamento acidental ao OmniGestão | B | A | prevenir (estrutura) |
| R-20 | Sobrecarga do proprietário (dev+curadoria+suporte+vendas) | A | A | mitigar (foco/fases) |

## 2. Detalhamento

### R-01 — Cobertura percebida como insuficiente
- **Cenário:** lojista busca 5 modelos recentes, 3 dão zero-results, cancela no trial.
- **Mitigação:** beta fechado mede a taxa REAL antes de cobrar de estranhos
  ([ROADMAP §3](ROADMAP_IMPLEMENTACAO_001.md)); curadoria guiada pelo top de queries sem
  resposta ([METRICAS §5](METRICAS_E_ANALYTICS_001.md)); comunicação honesta de cobertura
  ([PRD §3](PRD_CATALOGO_SAAS_MVP_001.md)); CTA "Solicitar modelo" transforma frustração
  em pipeline.
- **Contingência:** se zero-results > 15% no beta, atrasar lançamento aberto e
  concentrar 100% da curadoria nos gaps (os 10 mapeados + top de busca).
- **Gatilho de revisão:** zero-results semanal acima da meta por 2 semanas.

### R-02 — Scraping/cópia da base
- **Mitigação:** defesa em camadas completa ([SEGURANCA §4–5](SEGURANCA_PROTECAO_BASE_001.md));
  honeytokens; watermark/fingerprint em PDF; termos com licença de uso.
- **Contingência:** honeytoken avistado fora → evidência forense + notificação
  extrajudicial; aceleração da curadoria como fosso (a base viva vale mais que a cópia
  estática).
- **Gatilho:** sinal de varredura na escada do §5 ou honeytoken externo.

### R-03 — Erro de compatibilidade com prejuízo
- **Cenário:** selo verde errado → lojista vende, película não serve, cliente dele volta.
- **Mitigação:** taxonomia fail-closed (nunca promover — [BUSCA §5](BUSCA_E_COMPATIBILIDADE_001.md));
  avisos por selo; `CompatibilityReport` rebaixa automático no 2º relato
  ([MODELO_DADOS](MODELO_DADOS_CONCEITUAL_001.md)); termos com limitação de
  responsabilidade ([SEGURANCA §7](SEGURANCA_PROTECAO_BASE_001.md)).
- **Contingência:** rebaixar o par na hora, contato direto com afetados, post-mortem na
  curadoria (qual evidência falhou).
- **Gatilho:** ≥ 2 reports sobre o mesmo par (automático).

### R-04 — Reação de preço do concorrente
- **Mitigação:** posicionamento por VALOR (confiança explícita, UX, pedido integrado),
  nunca guerra de preço ([PLANOS §1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)); coorte
  fundadora cria base fiel cedo.
- **Contingência:** manter preço, acelerar diferenciais que ele não tem (selos,
  variantes, PDF); nunca reagir cortando preço no 1º movimento.

### R-05 — Conversão trial→pago baixa
- **Mitigação:** trial sem cartão maximiza a amostra; funil instrumentado por etapa
  ([METRICAS §3](METRICAS_E_ANALYTICS_001.md)); paywall suave com valor demonstrado.
- **Contingência:** testar (nesta ordem) onboarding guiado → trial 14 dias → trial com
  cartão — uma variável por vez, decidida por dado.
- **Gatilho:** conversão < 15% após 2 ciclos completos de trial.

### R-06 — Churn alto
- **Mitigação:** produto de hábito diário (favoritos, listas, histórico); pesquisa de
  saída de 1 pergunta; e-mails de recuperação D+3/D+15
  ([PLANOS §3.4](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
- **Contingência:** se churn > 8% por 2 meses: entrevistas com cancelados, priorizar o
  motivo nº 1 reportado, reavaliar preço anual (retém mais).

### R-07 — Bus factor da curadoria
- **Mitigação:** protocolo documentado ([PAINEL_ADMIN §5–6](PAINEL_ADMIN_MODERACAO_001.md));
  admin com fila priorizada operável por terceiros; IA barata pré-processa lote
  ([MATRIZ_IAS §4](MATRIZ_IAS_POR_ETAPA_001.md)).
- **Contingência:** treinar 1 pessoa de confiança como `CURATOR` já na Fase 2 (papel
  existe no RBAC desde o MVP).

### R-08 — Regressão de métricas falsas
- **Mitigação:** paridade par a par contra os oráculos EM CI
  ([IMPORTACAO §5](IMPORTACAO_DADOS_EXISTENTES_001.md)); hard gate de grupo > 25 membros;
  proibição do 86.738 escrita em todos os documentos; claims públicos só do
  [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md).
- **Contingência:** CI vermelho bloqueia publicação; se algo passar, rollback de
  catálogo em < 1 min ([IMPORTACAO §6](IMPORTACAO_DADOS_EXISTENTES_001.md)).

### R-09 — Vazamento dos pares ocultos
- **Mitigação:** teste automatizado de vazamento em TODAS as rotas públicas com a matriz
  como oráculo ([BUSCA §7.4](BUSCA_E_COMPATIBILIDADE_001.md)); visibilidade derivada por
  política central, nunca por rota.
- **Contingência:** rota culpada desligada na hora; post-mortem; teste novo cobrindo o
  caso.

### R-10 — Falha de billing/webhook
- **Mitigação:** contrato de webhook inegociável ([PLANOS §7.3](PLANOS_ASSINATURAS_PAGAMENTOS_001.md));
  idempotência por `providerEventId`; conciliação diária local×provedor que ALERTA e
  nunca auto-corrige ([PLANOS §4](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
- **Contingência:** divergência → correção manual auditada; em incidente amplo,
  comunicação proativa + cortesia de dias de acesso.

### R-11 — Ausência de PIX mensal
- **Mitigação:** PIX avulso no tri/anual desde o MVP; medir perda no funil de checkout.
- **Contingência:** Mercado Pago atrás da interface `PaymentProvider` na Fase 3
  ([ADR-005](ADR_DECISOES_ARQUITETURA_001.md)).
- **Gatilho:** abandono no passo de pagamento > 30% com "PIX" citado na pesquisa de saída.

### R-12 — Pressão por capinhas
- **Mitigação:** posição pública única e honesta (FAQ — [MASTER_PLAN §4](CATALOGO_SAAS_MASTER_PLAN_001.md));
  FAQ converte pergunta em solicitação/pipeline.
- **Contingência:** NUNCA ceder publicando dado não validado; se a demanda explodir,
  antecipar a Fase 4 com bancada real — o gate por evidência continua o mesmo.

### R-13 — Margem do fundador anual
- **Mitigação:** coorte limitada (100 orgs OU 90 dias); "congelado enquanto ativa", nunca
  vitalício irrevogável ([PLANOS §3.3](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
- **Contingência:** encerrar a coorte antecipadamente (é OU, não E) — gate humano.

### R-14 — Incidente LGPD
- **Mitigação:** minimização de dados (sem CPF), IP em hash, RLS, playbook de incidente
  ([SEGURANCA §7](SEGURANCA_PROTECAO_BASE_001.md)).
- **Contingência:** playbook: conter → avaliar → comunicar ANPD/titulares quando
  exigível → post-mortem público se apropriado.

### R-15 — Lock-in Stripe
- **Mitigação:** domínio agnóstico (`Subscription/Payment/PaymentEvent`), interface
  `PaymentProvider`, export periódico de dados de cobrança.
- **Contingência:** migração de cartões tokenizados via processo oficial do provedor
  (lento mas viável); novos clientes entram no provedor novo primeiro.

### R-16 — SEO programático expõe a base
- **Mitigação:** decisão é GATE ([SEGURANCA §6](SEGURANCA_PROTECAO_BASE_001.md)); páginas
  só por modelo, sem resposta; nunca por par/grupo.
- **Contingência:** despublicar páginas + `noindex` imediato; aquisição volta a demo/social.

### R-17 — Gap de lançamentos 2024–2026
- **Mitigação:** os 10 gaps já viram `ModelRequest in_research` no import
  ([IMPORTACAO §4](IMPORTACAO_DADOS_EXISTENTES_001.md)); comunicação de limitação honesta
  ([PRD §3](PRD_CATALOGO_SAAS_MVP_001.md)); prioridade de curadoria por demanda real.
- **Contingência:** mutirão de curadoria focado em lançamentos antes do lançamento aberto.

### R-18 — Marca/domínio
- **Mitigação:** verificação INPI + domínio ANTES de qualquer código com nome
  ([OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md)); repo/infra podem nascer com
  codinome neutro.
- **Contingência:** lista de 3+ nomes candidatos verificados; rebrand pré-lançamento é
  barato, pós-lançamento é caro.

### R-19 — Acoplamento acidental ao OmniGestão
- **Mitigação:** repo/Vercel novos + projeto Supabase (Database/Auth/Storage) exclusivo e
  isolado ([ADR-001/ADR-011](ADR_DECISOES_ARQUITETURA_001.md));
  reaproveitamento SÓ por cópia vendorizada ([ARQUITETURA §5](ARQUITETURA_CATALOGO_SAAS_001.md));
  revisão de PR checa imports.
- **Contingência:** qualquer dependência descoberta é tratada como bug P0.

### R-20 — Sobrecarga do proprietário
- **Mitigação:** fases com gate de saída (nunca 3 frentes ao mesmo tempo —
  [ROADMAP §7](ROADMAP_IMPLEMENTACAO_001.md)); IAs assumem o volume
  ([MATRIZ_IAS](MATRIZ_IAS_POR_ETAPA_001.md)); metas de curadoria realistas (30/semana é
  hipótese, não chicote).
- **Contingência:** se o ritmo quebrar, corta-se ESCOPO (adiar Fase 3), nunca qualidade
  da base nem segurança.

## 3. Processo de gestão

1. Revisão do registro no fim de cada fase e após qualquer incidente.
2. Risco disparado → vira item com dono e prazo; post-mortem curto vai para o repo.
3. Novos riscos entram com ID sequencial (R-21…) — nunca reciclar IDs.
4. Riscos aceitos (R-04) são revisitados a cada trimestre — aceitar não é esquecer.
