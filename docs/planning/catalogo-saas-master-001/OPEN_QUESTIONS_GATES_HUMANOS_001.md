# Open Questions e Gates Humanos — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** AGUARDANDO O PROPRIETÁRIO — nenhuma IA decide nada desta lista
([MATRIZ_IAS §5](MATRIZ_IAS_POR_ETAPA_001.md)). Cada gate traz recomendação fundamentada,
mas a decisão é humana e fica registrada aqui quando tomada.

---

## 1. Visão geral

| ID | Decisão | Bloqueia | Recomendação resumida |
| :--- | :--- | :--- | :--- |
| OQ-01 | Nome, marca e domínio | G-24 (landing); branding de tudo | OmniCompat (provisório com slogan "A compatibilidade certa em segundos."); validar domínio, redes e INPI |
| OQ-02 | CNPJ / estrutura que fatura | G-13 (billing live) | Gate adiado: não bloqueia dev/beta; bloqueia cobrança pública, gateway e NFS-e |
| OQ-03 | Preços finais + coorte fundador | G-13 (seed de planos) | Aprovado: Essencial R$ 19,90/44,90/119,90; Loja Pro R$ 29,90/59,90/159,90 |
| OQ-04 | Gateway final (taxas vigentes) | G-13 | Gateway em aberto via PaymentProvider (Stripe, Mercado Pago, Pagar.me, Asaas em avaliação) |
| OQ-05 | Termos de uso, privacidade e reembolso (jurídico) | G-24, G-25; beta | rascunho por IA, aprovação jurídica humana |
| OQ-06 | Texto público de capinhas (FAQ) | G-24 | texto honesto do [MASTER_PLAN §4](CATALOGO_SAAS_MASTER_PLAN_001.md) |
| OQ-07 | Checklist de claims da landing | G-24 | só os números do [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md) |
| OQ-08 | Seleção do grupo de beta (15–30 lojas) | G-26 | mix: operação própria + clientes de confiança + 5–10 frios |
| OQ-09 | Teste grátis (formato final) | G-15 | Aprovado: 7 dias sem cartão ou 30 pesquisas contabilizadas no backend |
| OQ-10 | Limites de dispositivos/usuários por plano | G-12, G-15 | Essencial 2/1; Pro 5/3 ([PLANOS §2](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)) |
| OQ-11 | Verba e canais de marketing do lançamento | Fase 2 | orgânico primeiro; verba só com funil medido |
| OQ-12 | NFS-e (emissão, município, ferramenta) | pós-MVP (recomendado antes do lançamento aberto) | resolver com contador na Fase 2 |
| OQ-13 | SEO programático por modelo | Fase 2 | decidir com dados do beta ([SEGURANCA §6](SEGURANCA_PROTECAO_BASE_001.md)) |
| OQ-14 | Lojas parceiras de bancada + N do gate de capinhas | Fase 4 | começar na operação própria; N definido no gate |

**Grupo A — bloqueiam o início/lançamento:** OQ-01 a OQ-10.
**Grupo B — decididos durante beta/fases seguintes:** OQ-11 a OQ-14.

## 2. Detalhamento — Grupo A

### OQ-01 — Nome, marca e domínio
**Contexto:** nada de nome foi decidido; o risco de colisão INPI/domínio é real
([R-18](REGISTRO_RISCOS_001.md)). O concorrente já ocupa "Películas Compatíveis" como
descrição — nome genérico demais não é registrável nem defensável.
**O que decidir:** nome do produto; domínio (.com.br); registro de marca.
**Processo recomendado:** gerar 5+ candidatos → verificar domínio + busca prévia INPI +
redes sociais → escolher 1 com 2 reservas → registrar domínio no ato; pedido INPI antes
do lançamento aberto.
**Desbloqueia:** landing, e-mails (SPF/DKIM no domínio), materiais. Repo/infra podem
começar com codinome neutro ([ROADMAP §1](ROADMAP_IMPLEMENTACAO_001.md)).

### OQ-02 — CNPJ e estrutura de faturamento
**Contexto:** Stripe live e termos exigem entidade definida; enquadramento tributário
afeta preço líquido.
**O que decidir:** faturar por CNPJ existente da operação ou abrir CNPJ próprio do SaaS;
regime (com contador).
**Recomendação:** conversa com contador ANTES do modo live; o plano não assume regime.

### OQ-03 — Preços finais e coorte fundador
**Contexto:** análise completa em [PLANOS §3](PLANOS_ASSINATURAS_PAGAMENTOS_001.md); a
proposta preliminar tinha 3 preços rejeitados com justificativa (tri 39,90; Pro tri
59,90; Pro anual 159,90).
**Recomendação:** Essencial 19,90 / 44,90 / 149,90 lista / **119,90 fundador**; Pro
29,90 / 79,90 / 249,90 lista / **199,90 fundador**; fundador = primeiras 100 orgs OU 90
dias, congelado enquanto ativa (nunca "vitalício" irrevogável).
**Decidir também:** tamanho final da coorte (100 é a recomendação).

### OQ-04 — Gateway e taxas vigentes
**Contexto:** comparativo em [PLANOS §5](PLANOS_ASSINATURAS_PAGAMENTOS_001.md); as taxas
citadas no plano são ordem de grandeza e PRECISAM ser conferidas nas tabelas atuais.
**Recomendação:** Stripe ([ADR-005](ADR_DECISOES_ARQUITETURA_001.md)), condicionada à
conferência de taxas (cartão recorrente, PIX via Checkout, câmbio/repasse).
**Decidir também:** aceitar a fraqueza PIX-mensal no MVP (recomendado: sim, medir).

### OQ-05 — Termos de uso, privacidade e reembolso
**Contexto:** limitação de responsabilidade e licença da base são a defesa jurídica do
ativo ([SEGURANCA §7](SEGURANCA_PROTECAO_BASE_001.md)); reembolso além do CDC é decisão
comercial ([PLANOS §3.4](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
**Recomendação:** IA rascunha; revisão jurídica humana antes do beta (os termos valem
para as contas de cortesia também).

### OQ-06 — Texto público de capinhas
**Contexto:** decisão de produto já tomada (não anunciar; FAQ honesta —
[MASTER_PLAN §4](CATALOGO_SAAS_MASTER_PLAN_001.md)); falta o proprietário aprovar o TOM
do texto da FAQ (D-02).
**Texto-base recomendado:** *"Estamos construindo um catálogo de capinhas com validação
física em bancada. Ele será liberado apenas quando tiver confiança real — sem data
prometida."*

### OQ-07 — Checklist de claims da landing
**Contexto:** critério de aceite nº 7 do MVP ([PRD §4](PRD_CATALOGO_SAAS_MVP_001.md)):
zero números inventados, aprovação humana explícita.
**Processo:** antes do G-24 fechar, o proprietário assina a lista final de claims
(base: [PRD §7](PRD_CATALOGO_SAAS_MVP_001.md)); qualquer claim novo exige atualizar a
auditoria primeiro.

### OQ-08 — Grupo do beta fechado
**Contexto:** o beta mede a taxa real de busca-sem-resposta e gera os primeiros
depoimentos ([ROADMAP §3](ROADMAP_IMPLEMENTACAO_001.md)).
**Recomendação:** 15–30 lojas: a operação própria (Rafacell) + lojistas conhecidos de
confiança + 5–10 lojistas "frios" (sem relação prévia — feedback não enviesado).
Cortesia auditada, prazo definido, expectativa clara de feedback.

### OQ-09 — Teste grátis
**Recomendação:** 7 dias sem cartão + demo pública de 5 consultas
([PLANOS §6](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)); revisitar com dados do beta
(alternativa: 14 dias com cartão) — decisão inicial é necessária para G-15.

### OQ-10 — Limites por plano
**Recomendação:** Essencial 2 dispositivos/1 usuário; Pro 5/3; troca self-service sem
punição ([PLANOS §2/§7.1](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)). Confirmar antes do
seed de planos (G-13).

## 3. Detalhamento — Grupo B

### OQ-11 — Marketing do lançamento
**Contexto:** CAC-caixa ≈ 0 no início (orgânico: grupos de lojistas, Instagram,
indicação); verba paga só faz sentido com funil medido.
**Decidir na Fase 2:** se/quanto investir, em qual canal, com meta de CAC × LTV.

### OQ-12 — NFS-e
**Contexto:** emissão de nota de serviço para assinantes PJ será cobrada; depende de
município/regime (OQ-02).
**Recomendação:** resolver com contador durante o beta; não bloqueia o beta (cortesia),
bloqueia moralmente o lançamento aberto.

### OQ-13 — SEO programático
**Contexto:** tráfego de cauda longa × risco de exposição
([SEGURANCA §6](SEGURANCA_PROTECAO_BASE_001.md), [R-16](REGISTRO_RISCOS_001.md)).
**Decidir na Fase 2:** ativar ou não as páginas por modelo, com dados de aquisição do
beta na mão.

### OQ-14 — Bancada e capinhas (Fase 4)
**Contexto:** pré-condições em [ROADMAP §5](ROADMAP_IMPLEMENTACAO_001.md); protocolo em
[PAINEL_ADMIN §6](PAINEL_ADMIN_MODERACAO_001.md).
**Decidir no gate da Fase 4:** o valor de **N** (modelos com `confirmado_bancada` de
capinha que liberam o módulo), a rede inicial de lojas parceiras e as contas Pro de
cortesia associadas.

## 4. Regras deste documento

1. Decisão tomada → registrar aqui (data, decisão, quem) e propagar aos documentos
   afetados na próxima revisão `-002`.
2. Gate do Grupo A pendente = GOAL dependente NÃO inicia
   ([BACKLOG](BACKLOG_GOALS_INICIAIS_001.md) indica as dependências).
3. Nenhuma resposta aqui é urgência artificial: o custo de decidir errado é maior que o
   de esperar uma semana.

## 5. Lista Oficial dos 16 Gates Que Permanecem Abertos
1. Domínio definitivo (.com.br);
2. Redes sociais (handles oficiais);
3. Disponibilidade e registro da marca no INPI;
4. Identidade visual e logotipo definitivos;
5. CNPJ operador definitivo (decisão com contador entre 2 opções);
6. Enquadramento CNAE e regime tributário;
7. Seleção do gateway de pagamento definitivo;
8. Tabela de tarifas atuais praticadas pelo gateway escolhido;
9. Política formal de cancelamento;
10. Política formal de reembolso;
11. Textos legais finais (Termos de Uso e Política de Privacidade);
12. Grupo nominal das 15 a 30 lojas parceiras do beta fechado;
13. Política de uso justo (fair use policy);
14. Critérios finais de moderação administrativa;
15. Data pública de lançamento comercial;
16. Tabela de preços posterior ao período de lançamento/fundador.
