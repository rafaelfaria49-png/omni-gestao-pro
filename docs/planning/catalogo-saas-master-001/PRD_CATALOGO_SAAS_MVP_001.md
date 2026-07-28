# PRD — OmniCompat (SaaS de Consulta de Películas Compatíveis) — MVP — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** PROPOSTA DE PRODUTO (pendente de gates humanos listados ao final)
**Base factual:** métricas reconciliadas P0 (`docs/audits/catalogo-saas-base-readiness-001/`)

---

## 1. Problema

O lojista de celulares/assistência técnica perde tempo e dinheiro para descobrir qual
película serve em cada aparelho:

- **Dor primária:** testar películas fisicamente uma a uma, consultar planilhas
  desorganizadas ou depender da memória do balconista mais experiente.
- **Dores complementares:** aliases diferentes para o mesmo aparelho ("A05", "Galaxy A05",
  "SM-A055"); confusão 4G × 5G; códigos técnicos impossíveis de pesquisar; bases
  desatualizadas; nenhuma noção de confiança ("serve mesmo ou 'dizem que serve'?"); erro na
  compra junto ao fornecedor; inexistência de base profissional para capinhas.

**Custo do problema para o cliente:** minutos por atendimento no balcão, películas
inutilizadas em teste, compras erradas, venda perdida quando o balconista desiste.

---

## 2. Público-alvo e personas

| Persona | Contexto | O que precisa |
| :--- | :--- | :--- |
| **Balconista** (usuário nº 1) | Atendendo com o cliente na frente, pelo celular | Resposta em < 10 segundos, 1 campo de busca, aviso claro de confiança |
| **Dono de loja / gerente** | Compra películas, controla equipe | Lista de compras, pedido em PDF p/ fornecedor, múltiplos usuários (Pro) |
| **Técnico de assistência** | Aplica película como serviço | Confirmação de variante (4G/5G), aviso "testar a seco" |
| **Distribuidor / estoquista** | Prepara pedidos grandes | Consulta por grupo físico, exportação controlada (Pro) |

Mercado primário: Brasil, pequenos varejistas de eletrônicos, operação mobile-first,
sensibilidade a preço na faixa de R$ 20–30/mês (referência: concorrente líder a R$ 22/mês).

---

## 3. Proposta de valor

**Promessa principal:**
> "Encontre a película certa em segundos, direto do balcão."

**Promessa secundária:**
> "Pare de testar película por película: consulte compatibilidades com nível de confiança
> e monte seu pedido para o fornecedor em um clique."

**Pilares (todos sustentados pela base real):**

1. **Busca que entende o balcão** — nome oficial, apelido, sigla, código técnico,
   erro comum de grafia (1.751 aliases; 328 ambíguos protegidos por trava de marca).
2. **Confiança explícita** — cada resposta diz se é "Confirmado por fornecedor",
   "Provável — teste antes" ou "Em revisão". Nunca resposta sem classificação.
3. **Variantes separadas** — 4G/5G e Pro/Plus/Max/Ultra/Lite nunca são misturados.
4. **Do resultado ao pedido** — favoritos, lista de compras, PDF para fornecedor,
   compartilhamento por WhatsApp.
5. **Base viva** — solicitação de modelo ausente vira fila de curadoria; atualização
   contínua; contribuições moderadas (Fase 2).
6. **Feita para o balcão** — mobile-first, PWA instalável, modo balcão com fonte grande,
   múltiplos dispositivos por assinatura.

**Diferenciais vs concorrência (Películas Compatíveis UTI e similares):**
- nível de confiança explícito por resultado (nenhum concorrente observado faz);
- separação honesta de variantes e trava de marca para siglas ambíguas;
- pedido/PDF integrado ao fluxo de consulta;
- UX premium mobile-first (concorrente tem landing e app visualmente datados);
- transparência de fontes ("por que dizemos que serve").

**Limitações honestas (comunicadas, não escondidas):**
- cobertura forte até 2023; lançamentos 2024–2026 em expansão contínua (10 gaps já
  mapeados: Moto G85, Edge 50, POCO F6, Realme 12 etc.);
- parte da base ainda está em curadoria e não é exibida até ter confirmação;
- nenhuma resposta garante encaixe sem conferência — recomendamos teste a seco quando o
  nível de confiança pedir;
- capinhas não fazem parte do produto no lançamento.

---

## 4. Escopo do MVP (Fase 1)

### Incluído

| Módulo | Descrição | Fonte de dados |
| :--- | :--- | :--- |
| Busca canônica | Autocomplete por modelo/alias/marca com trava de ambiguidade | 429 modelos, 1.751 aliases |
| Resultado de compatibilidade | Cobertura própria + pares confirmados + beta com aviso | 417 próprias; 136 pares (272 direcionais); 34 beta (68 direcionais) |
| Favoritos | Modelos e grupos marcados pelo usuário | — |
| Histórico | Últimas consultas do usuário/organização | — |
| Lista de compras | Agrupa películas a comprar por grupo físico | — |
| Pedido em PDF | PDF com watermark do assinante, pronto p/ fornecedor | — |
| Compartilhar WhatsApp | Link/texto do resultado ou da lista | — |
| Solicitação de modelo | "Não achei meu aparelho" → fila de curadoria | alimenta `ModelRequest` |
| Conta e dispositivos | Perfil, troca de senha, gestão de dispositivos ativos | — |
| Assinatura | Checkout, upgrade/downgrade, portal de cobrança | PaymentProvider (Gateway em aberto) |
| Admin mínimo | CRUD de modelos/aliases/grupos/relações + evidências + solicitações | — |
| PWA | Instalável, ícone, splash, funciona como app | — |

### Excluído do MVP (explícito)

- **Capinhas** (qualquer menção funcional) — Fase 4, sem data.
- Contribuições de usuários com moderação — Fase 2.
- Multiusuário/multi-loja (Pro completo) — Fase 3 (Pro pode ser vendido no lançamento com
  limites maiores, mas gestão fina de equipe fica na Fase 3 — ver [PLANOS §2](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
- Relatórios gerenciais, API pública, integrações (OmniGestão, fornecedores) — Fase 5.
- Offline completo do PWA (cache de shell apenas; dados exigem rede — proteção da base).

### Critérios de aceite do MVP (gate de lançamento do beta)

1. Busca responde p95 < 300 ms no servidor para as 100 queries mais comuns.
2. 100% das respostas exibem nível de confiança e avisos aplicáveis.
3. Nenhuma rota expõe os 765 pares `NAO_PUBLICAVEL`.
4. Assinatura só ativa via webhook validado (nunca por retorno visual de checkout).
5. PDF sempre com watermark identificando organização + usuário + data.
6. Limite de dispositivos aplicado no servidor.
7. Zero números inventados na landing (checklist de claims aprovado pelo proprietário).

---

## 5. Fluxos principais (narrativa)

1. **Consulta no balcão:** abre PWA → digita "a05" → sistema pede marca (alias ambíguo) →
   toca "Samsung" → vê Galaxy A05 com: película própria (Confirmado por fornecedor) + 3
   modelos equivalentes (2 confirmados, 1 "provável — teste antes") → mostra pro cliente →
   vende.
2. **Compra do lojista:** durante a semana favorita modelos consultados → abre Lista de
   Compras → sistema agrupa por grupo físico ("1 molde atende A05 + A05s") → gera PDF →
   envia ao fornecedor pelo WhatsApp.
3. **Modelo ausente:** busca "moto g85" → sem resultado → CTA "Solicitar este modelo" →
   preenche marca/modelo (pré-preenchido pela busca) → recebe notificação quando entrar na
   base.
4. **Assinatura:** landing → demo → cria conta → trial de 7 dias ou 30 pesquisas contabilizadas → paywall suave → escolhe plano → checkout via PaymentProvider → webhook ativa → segue usando.

---

## 6. MVP mínimo vendável (resposta direta)

O menor produto pelo qual um lojista pagará R$ 19,90/mês:

**busca confiável + resposta com nível de confiança + lista de compras/PDF + PWA.**

Tudo o mais (histórico, favoritos, solicitações) aumenta retenção mas não é o gatilho de
compra. Portanto a ordem de implementação prioriza o funil busca→resposta→pedido
([ROADMAP](ROADMAP_IMPLEMENTACAO_001.md)).

---

## 7. Números públicos autorizados (única fonte para marketing)

| Claim público | Valor | Verificável em |
| :--- | :--- | :--- |
| "Modelos catalogados" | 429 | MODELOS_CANONICOS_INVENTARIO_001.csv |
| "Marcas cobertas" | 10 | MATRIZ_COBERTURA_MARCAS_001.csv |
| "Apelidos e códigos pesquisáveis" | 1.751 | ALIASES_INVENTARIO_001.csv |
| "Grupos físicos de película mapeados" | 116 | MATRIZ_RECONCILIACAO_METRICAS_001.csv |
| "Pares mapeados (em curadoria contínua)" | 935 | MATRIZ_PARES_COMPATIBILIDADE_001.csv |
| "Compatibilidades confirmadas por fornecedor exibidas" | 136 pares / 272 respostas direcionais | idem |
| "Coberturas próprias por modelo" | 417 | idem |

Qualquer claim fora desta tabela exige atualização da auditoria antes de publicar.

---

## 8. Linguagem comercial

### Permitida
- "Consulta rápida de películas compatíveis por modelo e marca."
- "Buscador inteligente por nomes populares, siglas e códigos."
- "Cada resposta com nível de confiança — você sabe quando pode confiar e quando deve testar."
- "Monte sua lista de compras e gere o pedido em PDF para o fornecedor."
- "Base em curadoria contínua: exibimos apenas o que tem confirmação."

### Proibida (risco de propaganda enganosa, churn e responsabilização)
- Qualquer variação de "86.738" ou "milhares de compatibilidades" (número já provado falso).
- "1.443 compatibilidades" (são linhas técnicas, não compatibilidades).
- "563 pares confirmados" (eram linhas; o valor real é 136 pares).
- "Confirmado em bancada" (existem 0 registros de bancada).
- "Garantia de encaixe" / "100% de compatibilidade" / "sem necessidade de conferência".
- "Cobertura completa de todos os lançamentos".
- "Consulta de capinhas" em qualquer material de lançamento.
- Números de usuários, avaliações ou satisfação que ainda não existem.

---

## 9. Capinhas — posição de produto

Ver decisão fundamentada no [MASTER_PLAN §4](CATALOGO_SAAS_MASTER_PLAN_001.md): sem menção
na landing/planos; FAQ com texto honesto; módulo futuro condicionado a evidência de bancada
real (Fase 4, sem data). Internamente, o modelo de dados já nasce preparado
(`AccessoryType`) para não exigir migração estrutural depois.

---

## 10. Gates humanos deste PRD

- Aprovação dos textos de promessa e limitação (§3, §8).
- Decisão final do tom da FAQ de capinhas.
- Aprovação da tabela de claims públicos (§7).
- Preço e trial (referência: [PLANOS](PLANOS_ASSINATURAS_PAGAMENTOS_001.md)).
