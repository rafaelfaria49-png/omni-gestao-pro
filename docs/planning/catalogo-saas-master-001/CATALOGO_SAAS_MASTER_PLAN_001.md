# PLANEJAMENTO MESTRE — OmniCompat (SaaS de Consulta de Películas Compatíveis) — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PLANEJAMENTO (nenhum código implementado; decisões críticas pendentes de gate humano)
**Worktree:** `C:\Projetos\omni-gestao-catalogo-saas-readiness-001`
**Branch:** `audit/catalogo-saas-base-readiness-001`
**Commit base:** `bad63172ff3e5ffcc661541b42fe8dcde23ea830`
**Base factual:** auditoria reconciliada P0 em `docs/audits/catalogo-saas-base-readiness-001/`

---

## 1. Visão do produto

O **OmniCompat** (nome provisório até verificação de domínio, redes sociais e INPI) é um **SaaS independente do OmniGestão Pro**, vendido por assinatura, posicionado como uma plataforma operacional para lojas de celulares, assistências técnicas e vendedores de acessórios.

> **"A compatibilidade certa em segundos."**

O produto NÃO é "acesso a uma tabela". É uma **ferramenta operacional de consulta e compra**:

O MVP do OmniCompat inclui 14 recursos operacionais essenciais:
1. Busca inteligente de películas por marca, modelo, nome popular, código técnico, alias, variação de fornecedor e tolerância a erros de escrita;
2. Resultados de compatibilidade com grupo físico, aparelhos compatíveis, fonte, evidência, nível de confiança, avisos de teste seco e separação explícita entre 4G, 5G, Pro, Plus, Max, Ultra e Lite;
3. Favoritos de modelos e grupos;
4. Histórico de pesquisas;
5. Lista de compras de películas;
6. Agrupamento de itens equivalentes para evitar compra duplicada;
7. Geração de pedido em PDF;
8. Compartilhamento de pedido pelo WhatsApp;
9. Consulta a pedidos e listas anteriores;
10. Solicitação de inclusão de modelo ausente;
11. Relato de erro ou incompatibilidade;
12. Painel administrativo de catálogo e moderação;
13. Controle de usuários, lojas, dispositivos e sessões;
14. Instalação como PWA (sem base completa offline).

**Capinhas NÃO fazem parte do lançamento** (0 relações físicas na base — ver §4 e
[OPEN_QUESTIONS_GATES_HUMANOS_001.md](OPEN_QUESTIONS_GATES_HUMANOS_001.md)).

---

## 2. Verdade técnica de partida (números canônicos deste plano)

Todos os documentos deste plano usam EXCLUSIVAMENTE os números reconciliados da auditoria
(`RELATORIO_BASE_READINESS_001.md`, correção P0). O número 86.738 é **PROIBIDO** — foi um
erro de explosão combinatória já corrigido.

| Dimensão | Valor | Unidade |
| :--- | ---: | :--- |
| Modelos canônicos | 429 | modelos |
| Modelos com cobertura de película | 419 | modelos |
| Aliases | 1.751 | aliases |
| Aliases ambíguos (trava de marca) | 328 | aliases |
| Strings colidentes entre marcas | 21 | strings |
| Marcas | 10 | marcas |
| Linhas técnicas no seed | 1.443 | linhas |
| Registros `mesmo_modelo` (cobertura própria) | 417 | linhas |
| Associações modelo↔grupo | 1.026 | linhas |
| Grupos físicos válidos | 116 | grupos |
| Pares físicos cruzados únicos (não direcionais) | 935 | pares |
| Resultados direcionais possíveis | 1.870 | resultados |
| Pares mesma marca / multimarcas | 407 / 528 | pares |
| **Pares publicáveis no MVP** | **136** | pares (272 direcionais) |
| **Pares beta com aviso** | **34** | pares (68 direcionais) |
| Pares NÃO publicáveis (ocultos) | 765 | pares |
| Relações confirmadas em bancada física | **0** | — |
| Relações físicas de capinhas | **0** | — |
| Modelos isolados (sem par cruzado) | 172 | modelos |
| Itens na fila de revisão | 527 | itens |

**Consequência de produto:** o ativo vendável do MVP não é "quantidade de pares" — é a
**busca canônica (429 modelos + 1.751 aliases) + 417 coberturas próprias + 136 pares
confirmados + classificação de confiança honesta**. Todo o discurso comercial deriva daí.

---

## 3. Decisões mestre (resumo — detalhe nos documentos dedicados)

| # | Decisão | Recomendação | Documento | Gate humano? |
| :--- | :--- | :--- | :--- | :--- |
| D-01 | Lançar só películas? | **SIM** — beta fechado → lançamento com preço fundador | [PRD](PRD_CATALOGO_SAAS_MVP_001.md) | Não |
| D-02 | Capinhas na comunicação | **Não anunciar no lançamento**; menção honesta só em FAQ/roadmap ("em construção com validação física, sem data") | [PRD §9](PRD_CATALOGO_SAAS_MVP_001.md) | Sim (tom) |
| D-03 | Repositório | Projeto novo, repo próprio, zero dependência runtime do OmniGestão | [ADR-001](ADR_DECISOES_ARQUITETURA_001.md) | Não |
| D-04 | Stack | Next.js + TS + Tailwind/shadcn + Prisma + Neon PostgreSQL (projeto NOVO e isolado) + Auth.js + Cloudflare R2 + Vercel + Resend + Sentry + PWA | [ARQUITETURA](ARQUITETURA_CATALOGO_SAAS_001.md) | Não |
| D-05 | Pagamentos | **Interface PaymentProvider** (gateway em aberto; Stripe, Mercado Pago, Pagar.me e Asaas em avaliação por taxas, Pix, cartão recorrente, parcelamento, webhooks, chargeback, prazo e CNPJ BR) | [PLANOS](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) | **Sim** |
| D-06 | Preços | Essencial R$ 19,90/mês · R$ 44,90/tri · R$ 119,90/ano (1 loja, 2 us, 3 disp); Pro R$ 29,90/mês · R$ 59,90/tri · R$ 159,90/ano (até 3 lojas, 5 us, 8 disp) | [PLANOS](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) | **Sim** |
| D-07 | Teste grátis | 7 dias sem cartão ou 30 pesquisas contabilizadas no backend (o que ocorrer 1º), 1 us, 1 disp, 1 org, 1 lista ativa, 1 PDF demo com marca d'água | [PLANOS](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) | Sim |
| D-08 | Busca | Motor em memória derivado do engine já auditado (`lib/catalogo-aparelhos/`) + `pg_trgm` p/ fuzzy; sem Elasticsearch | [BUSCA](BUSCA_E_COMPATIBILIDADE_001.md) | Não |
| D-09 | Evidência | Taxonomia fail-closed; agregação sempre pelo PIOR status (regra já existente no engine); `confirmado_bancada` só nasce com bancada real | [BUSCA §5](BUSCA_E_COMPATIBILIDADE_001.md) | Não |
| D-10 | Dados | ETL snapshot dos CSVs auditados → banco novo, com IDs estáveis, staging, dry-run e rollback | [IMPORTACAO](IMPORTACAO_DADOS_EXISTENTES_001.md) | Não |
| D-11 | Proteção da base | Sem endpoint de exportação total; paginação + rate limit por conta/IP/dispositivo; watermark em PDF; detecção de scraping | [SEGURANCA](SEGURANCA_PROTECAO_BASE_001.md) | Não |
| D-12 | Dispositivos | Essencial: 1 loja, até 2 usuários, até 3 dispositivos; Pro: até 3 lojas, até 5 usuários, até 8 dispositivos; troca self-service sem punição | [PLANOS](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) | Sim |
| D-13 | Marca/domínio | Não decidido — nomes candidatos exigem verificação INPI/domínio | [OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md) | **Sim** |
| D-14 | Divisão de IAs | Fable ≈ 20–25% (arquitetura/segurança/billing/importador/reviews); Sonnet ≈ 50% (implementação); modelos baratos ≈ 25% (conteúdo/pesquisa/curadoria em lote) | [MATRIZ_IAS](MATRIZ_IAS_POR_ETAPA_001.md) | Não |

---

## 4. Estratégia de capinhas (decisão fundamentada)

**Situação:** 0 relações físicas; 0 bancada; fontes públicas não confiáveis; tolerâncias
dimensionais achadas em pesquisa são heurísticas NÃO validadas.

**Decisão recomendada:** opção **"não mencionar no lançamento"** na landing/hero/planos,
com UMA menção honesta em FAQ: *"Estamos construindo um catálogo de capinhas com validação
física em bancada. Ele será liberado apenas quando tiver confiança real — sem data
prometida."*

**Por que não "Capinhas em breve":** "em breve" cria expectativa de prazo, gera churn de
assinantes que compraram pela promessa, e a construção da base (bancada + fornecedores +
moderação) tem duração incerta (fase 4 do roadmap, sem data).

**Por que não silêncio absoluto:** lojistas VÃO perguntar (a dor existe); a FAQ honesta
converte a pergunta em pipeline de contribuição futura sem prometer prazo.

**Caminho para existir:** protocolo de bancada + medições + fotos + moderação, descrito na
Fase 4 do [ROADMAP_IMPLEMENTACAO_001.md](ROADMAP_IMPLEMENTACAO_001.md) e no
[PAINEL_ADMIN_MODERACAO_001.md](PAINEL_ADMIN_MODERACAO_001.md). Nunca aprovar
compatibilidade de capinha automaticamente por dimensões.

---

## 5. Mapa dos documentos

| Doc | Conteúdo |
| :--- | :--- |
| [PRD_CATALOGO_SAAS_MVP_001.md](PRD_CATALOGO_SAAS_MVP_001.md) | Produto, personas, escopo MVP, proposta de valor, linguagem permitida/proibida |
| [ARQUITETURA_CATALOGO_SAAS_001.md](ARQUITETURA_CATALOGO_SAAS_001.md) | Matriz de decisão de stack, topologia, deploy, backup, e-mails, PDF, cache |
| [MODELO_DADOS_CONCEITUAL_001.md](MODELO_DADOS_CONCEITUAL_001.md) | 30 entidades: finalidade, campos, índices, retenção, auditoria |
| [BUSCA_E_COMPATIBILIDADE_001.md](BUSCA_E_COMPATIBILIDADE_001.md) | Pipeline de busca, ranking, ambiguidade, taxonomia de evidência |
| [PLANOS_ASSINATURAS_PAGAMENTOS_001.md](PLANOS_ASSINATURAS_PAGAMENTOS_001.md) | Preços justificados, comparativo de gateways, ciclo de vida da assinatura |
| [UX_DESIGN_SYSTEM_LANDING_001.md](UX_DESIGN_SYSTEM_LANDING_001.md) | Direção visual, 20 telas, landing page completa, SEO |
| [PAINEL_ADMIN_MODERACAO_001.md](PAINEL_ADMIN_MODERACAO_001.md) | Painel administrativo, moderação, safeguards contra contaminação |
| [SEGURANCA_PROTECAO_BASE_001.md](SEGURANCA_PROTECAO_BASE_001.md) | Proteção do ativo de dados, anti-scraping, LGPD, RLS |
| [IMPORTACAO_DADOS_EXISTENTES_001.md](IMPORTACAO_DADOS_EXISTENTES_001.md) | ETL dos CSVs auditados → banco novo, dry-run, rollback |
| [ROADMAP_IMPLEMENTACAO_001.md](ROADMAP_IMPLEMENTACAO_001.md) | Fases 0–5 com entregas, riscos, critérios de aceite, estimativas |
| [MATRIZ_IAS_POR_ETAPA_001.md](MATRIZ_IAS_POR_ETAPA_001.md) | Qual IA em cada etapa e por quê |
| [METRICAS_E_ANALYTICS_001.md](METRICAS_E_ANALYTICS_001.md) | Métricas de produto com metas-hipótese |
| [REGISTRO_RISCOS_001.md](REGISTRO_RISCOS_001.md) | 20 riscos com mitigação e contingência |
| [ADR_DECISOES_ARQUITETURA_001.md](ADR_DECISOES_ARQUITETURA_001.md) | 10 ADRs formais |
| [BACKLOG_GOALS_INICIAIS_001.md](BACKLOG_GOALS_INICIAIS_001.md) | 26 GOALs executáveis com critérios de aceite |
| [OPEN_QUESTIONS_GATES_HUMANOS_001.md](OPEN_QUESTIONS_GATES_HUMANOS_001.md) | Decisões que exigem o proprietário |
| [RESUMO_EXECUTIVO_CATALOGO_SAAS_001.md](RESUMO_EXECUTIVO_CATALOGO_SAAS_001.md) | Síntese de 2 páginas |

---

## 6. Respostas às 22 questões obrigatórias

1. **É comercialmente viável lançar apenas películas?** Sim. A dor principal (perda de
   tempo no balcão) é de películas; o concorrente líder (Películas Compatíveis UTI) vende
   exatamente isso a R$ 22/mês. Condição: comunicar cobertura com honestidade (§3 D-01) e
   entrar em beta fechado antes de cobrar de estranhos.
2. **136 pares publicáveis bastam para um beta?** Para um **beta fechado, sim** — porque o
   valor consultável real do MVP é maior que os pares: 417 coberturas próprias + 272
   resultados direcionais confirmados + 68 beta com aviso, sobre 419 modelos pesquisáveis
   por 1.751 aliases. Para lançamento aberto, a meta é elevar pares publicáveis via
   curadoria da fila (527 itens) e novas confirmações de fornecedor — sem prometer prazo.
   O beta serve exatamente para medir a taxa de busca-sem-resposta real.
3. **Como comunicar a cobertura sem enganar?** Publicar apenas contagens verdadeiras e
   auditáveis: "429 modelos catalogados, 10 marcas, 1.751 apelidos e códigos, 116 grupos
   físicos mapeados, mais de 900 pares em curadoria — exibimos somente o que tem
   confirmação de fornecedor, com nível de confiança em cada resposta". Nunca somar linhas
   técnicas como compatibilidades. Linguagem proibida no [PRD §8](PRD_CATALOGO_SAAS_MVP_001.md).
4. **Teste grátis?** Sim: regra oficial de trial com duração máxima de 7 dias sem cartão e limite máximo de 30 pesquisas contabilizadas no backend (encerra no que ocorrer 1º). Inclui 1 usuário, 1 dispositivo, 1 organização, 1 lista ativa, 1 PDF demonstrativo com indicação de demonstração e favoritos. Pesquisas contabilizadas no backend com deduplicação de 10 min por query normalizada. Após encerramento, a conta entra em modo limitado sem cobrança automática.
5. **Qual preço lançar?** Planos aprovados de lançamento: Essencial mensal R$ 19,90, trimestral R$ 44,90, anual R$ 119,90; Loja Pro mensal R$ 29,90, trimestral R$ 59,90, anual R$ 159,90.
6. **Diferenças reais Essencial × Pro?** Essencial = 1 loja, até 2 usuários, até 3 dispositivos, consulta, confiança, favoritos, histórico, lista, PDF simples, solicitações e relatos. Loja Pro = até 3 lojas, até 5 usuários, até 8 dispositivos, PDF personalizado com marca da loja, compartilhamento facilitado WhatsApp, histórico ampliado, relatórios de buscas, permissões e prioridade em solicitações.
7. **Limite de dispositivos?** Essencial até 3 dispositivos (2 usuários / 1 loja); Pro até 8 dispositivos (5 usuários / 3 lojas), com troca self-service.
8. **Qual processador de pagamento?** Abstração via interface PaymentProvider. Gateway definitivo em aberto para avaliação entre Stripe, Mercado Pago, Pagar.me e Asaas com base em pesquisa atualizada de taxas, Pix, cartão recorrente, parcelamento, webhooks, chargeback, prazos e suporte a CNPJ BR.
9. **Qual arquitetura?** Next.js App Router + TypeScript + Tailwind/shadcn + Prisma + Neon PostgreSQL (projeto isolado) + Auth.js + Cloudflare R2 + Vercel + Resend + Sentry + PWA.
10. **Banco de dados e infraestrutura?** O Supabase foi substituído oficialmente pelo Neon PostgreSQL em projeto 100% NOVO e isolado do OmniGestão (Prisma ORM, conexões pooled e direct). Autenticação via Auth.js / NextAuth v5 com persistência no Neon. Armazenamento de arquivos via Cloudflare R2.
11. **Como proteger a base?** Defesa em camadas: sem endpoint de export total; respostas
    mínimas paginadas; rate limit conta/IP/dispositivo; telemetria de consulta anômala;
    watermark identificando o assinante em todo PDF; suspensão gradual; termos de licença.
    [SEGURANCA](SEGURANCA_PROTECAO_BASE_001.md). Sem promessa de impedimento absoluto.
12. **Como limitar scraping?** Rate limit em múltiplas janelas (min/hora/dia), limites por
    plano, detecção de padrões (varredura sequencial de modelos, volume fora do perfil de
    balcão), CAPTCHA progressivo, honeytokens na base, bloqueio + auditoria.
    [SEGURANCA §4](SEGURANCA_PROTECAO_BASE_001.md).
13. **Como representar evidências?** Entidades `CompatibilityEvidence` + `EvidenceSource` +
    `BenchTest` separadas da relação; status da relação é DERIVADO da pior evidência ativa,
    nunca editado à mão sem trilha. Taxonomia completa de 11 status em
    [BUSCA §5](BUSCA_E_COMPATIBILIDADE_001.md).
14. **Como importar os dados?** ETL versionado: CSVs auditados (hash SHA-256 conferido com o
    manifesto) → staging → validação → dry-run com relatório → publicação atômica com
    snapshot de rollback. IDs estáveis reutilizam os slugs existentes (`apple_iphone_11`).
    [IMPORTACAO](IMPORTACAO_DADOS_EXISTENTES_001.md).
15. **Mencionar capinhas no lançamento?** Não na landing/hero/planos; só FAQ honesta (§4).
16. **Quando liberar capinhas?** Sem data. Critério de liberação por evidência: ≥ N modelos
    com `confirmado_bancada` de capinha em bancada real (N definido no gate da Fase 4),
    nunca por calendário. [ROADMAP Fase 4](ROADMAP_IMPLEMENTACAO_001.md).
17. **Como construir a base de bancada?** Protocolo padronizado (teste seco: borda, câmera,
    sensor, molde), registro fotográfico, lojas parceiras (a própria operação Rafacell
    primeiro), formulário de bancada no admin, dupla verificação antes de promover status.
    [PAINEL_ADMIN §6](PAINEL_ADMIN_MODERACAO_001.md).
18. **Como evitar responsabilidade indevida?** Nunca prometer "garantia de encaixe";
    avisos contextuais por nível de confiança; termos de uso com limitação de
    responsabilidade; canal de contestação (`CompatibilityReport`) que rebaixa status
    automaticamente para revisão. [SEGURANCA §7](SEGURANCA_PROTECAO_BASE_001.md).
19. **MVP mínimo vendável?** Landing + demo limitada + auth + assinatura + busca canônica +
    resultado com confiança + favoritos + histórico + lista de compras + PDF com watermark +
    limite de dispositivos + solicitação de modelo + admin mínimo. Nada além disso.
    [PRD §6](PRD_CATALOGO_SAAS_MVP_001.md).
20. **Sequência de implementação?** Fase 0 (fundação) → Fase 1 na ordem: repo → modelo de
    dados → importador → motor de busca → API/UI de consulta → auth → billing → listas/PDF →
    dispositivos → admin mínimo → landing → beta fechado. [ROADMAP](ROADMAP_IMPLEMENTACAO_001.md)
    e [BACKLOG](BACKLOG_GOALS_INICIAIS_001.md).
21. **Quanto usar Fable?** ≈ 20–25% do esforço: arquitetura, modelo de dados, importador,
    billing/webhooks, segurança, revisões de PR críticos. O resto em Sonnet (implementação)
    e modelos baratos (conteúdo, pesquisa, curadoria em lote). [MATRIZ_IAS](MATRIZ_IAS_POR_ETAPA_001.md).
22. **Decisões que exigem o proprietário?** Marca/domínio, CNPJ/estrutura legal, preços
    finais, gateway final (com taxas vigentes), política de reembolso, texto de capinhas,
    seleção do grupo de beta, verba de marketing, aceite jurídico dos termos.
    [OPEN_QUESTIONS](OPEN_QUESTIONS_GATES_HUMANOS_001.md).

---

## 7. O que este plano NÃO autoriza

- Criar código, repositório novo, banco ou checkout (isso são GOALs futuros).
- Reutilizar qualquer número da auditoria anterior à correção P0 (86.738 etc.).
- Anunciar capinhas, bancada ou cobertura que não existam.
- Acoplar o SaaS ao banco produtivo do OmniGestão.
