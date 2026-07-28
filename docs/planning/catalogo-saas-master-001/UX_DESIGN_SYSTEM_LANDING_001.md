# UX, Design System e Landing Page — OmniCompat — 001

**GOAL:** `CATALOGO-SAAS-MASTER-PLAN-001`
**Data:** 22 de Julho de 2026
**Status:** DIREÇÃO CONCEITUAL (design system e telas serão GOALs próprios)

---

## 1. Direção visual

**Sensação-alvo:** ferramenta profissional de balcão — rápida, limpa, confiável. "Bancada
de precisão", não "site de tabela". Explicitamente NÃO copiar a landing do concorrente
(identidade, textos, layout, imagens).

Princípios (herdam a disciplina já praticada no OmniGestão):
- **Mobile-first radical:** tudo desenhado primeiro para uma mão no balcão; desktop é a
  adaptação.
- **Tokens semânticos, zero cor hardcoded:** `background/foreground/primary/muted/border`
  + tokens de confiança: `confidence-confirmed` (verde), `confidence-warning` (âmbar),
  `confidence-negative` (vermelho), `confidence-review` (cinza-azulado). Dark mode desde
  o dia 1 (balcão com luz variável).
- **Tipografia:** sans geométrica legível (ex. Inter/Geist); números tabulares para
  códigos; corpo ≥ 16px no mobile; modo balcão ≥ 18px.
- **Hierarquia forte, poucos elementos:** 1 ação primária por tela; selos de confiança
  são o elemento visual mais proeminente do resultado.
- **Estados sempre desenhados:** vazio, loading (skeleton, nunca spinner de página
  inteira), erro com ação de recuperação, offline ("sem conexão — os dados exigem
  internet").
- **Acessibilidade WCAG AA:** contraste ≥ 4,5:1; alvos ≥ 44px; foco visível; selos de
  confiança NUNCA só por cor (sempre ícone + texto); navegação por teclado no desktop.
- **min-w-0 em todo item flex/grid** (regra anti-overflow já aprendida).

## 2. Componentes-chave do design system

| Componente | Notas |
| :--- | :--- |
| `SearchBox` | Campo único com debounce 250ms, chips de marca p/ desambiguação, histórico recente |
| `ConfidenceBadge` | Selo ícone+texto: Confirmado em bancada / por fornecedor / múltiplas fontes / Testar antes / Não recomendado / Em revisão |
| `DeviceCard` | Nome canônico + marca + sufixo 4G/5G + variantTier sempre visíveis; aliases secundários |
| `CompatList` | Lista de equivalentes agrupada por selo (confirmados primeiro), avisos por item |
| `WarningCallout` | Avisos fixos de domínio (teste a seco, película ≠ capinha) |
| `PlanCard` | Compacto (aprender com o erro do concorrente: cards longos demais) |
| `EmptyState` | Ilustração leve + explicação honesta + CTA (ex. "Solicitar modelo") |
| `DeviceSessionRow` | Dispositivo, último acesso, botão revogar |
| `PaywallGate` | Aviso suave de limite/plano com upgrade em 1 toque |

## 3. As 20 telas

Formato compacto: **Obj** objetivo · **Cont** conteúdo · **1ª** ação principal ·
**2ª** secundárias · **Vazio/Load/Erro** estados · **Mob** mobile · **A11y** foco de
acessibilidade · **Copy** microcopy exemplar.

### 3.1 Landing page
Ver §4 (seção completa própria).

### 3.2 Demonstração de busca (na landing)
**Obj** provar valor em 10s sem cadastro. **Cont** SearchBox real limitado a allowlist
estática de ~30 modelos populares; resultado real com selos. **1ª** buscar; após 5
consultas → CTA "Crie sua conta para continuar". **2ª** ver planos. **Vazio** "Na
demonstração buscamos só os modelos mais populares — na versão completa são 429." **Load**
skeleton de 3 cards. **Erro** "Demonstração indisponível — veja o vídeo" (fallback GIF).
**Mob** campo full-width acima da dobra. **A11y** foco automático não forçado (não roubar
scroll). **Copy** placeholder: "Digite o modelo… ex.: A05, iPhone 11, moto g53".

### 3.3 Login
**Obj** entrar sem fricção. **Cont** e-mail+senha, "esqueci a senha", link p/ cadastro.
**1ª** Entrar. **2ª** recuperar senha. **Erro** credencial inválida sem revelar qual campo
(anti-enumeração) — "E-mail ou senha incorretos". **Load** botão com spinner inline.
**Mob** autofill/1Password-friendly, teclado de e-mail. **A11y** labels reais, erro
anunciado por aria-live. **Copy** título: "Bom te ver de novo".

### 3.4 Cadastro
**Obj** conta criada em < 1 min. **Cont** nome, e-mail, senha, nome da loja, WhatsApp
(opcional); consentimento LGPD explícito; e-mail de verificação. **1ª** Criar conta e
começar o teste grátis. **2ª** login. **Erro** e-mail já usado → oferecer login/recuperação.
**Vazio/Load** padrão. **Mob** 1 coluna, 5 campos no máximo. **A11y** requisitos de senha
anunciados antes do erro. **Copy** sob o CTA: "7 dias grátis. Sem cartão. Cancele quando
quiser."

### 3.5 Escolha de plano
**Obj** decidir Essencial×Pro e período sem confusão. **Cont** 2 PlanCards + toggle
mensal/tri/anual com economia explícita ("2 meses grátis"); tabela comparativa curta;
selo fundador com contagem honesta. **1ª** Assinar plano. **2ª** continuar no teste;
FAQ de cobrança. **Erro** falha ao criar checkout → tentar de novo + suporte. **Mob**
cards empilhados, toggle fixo no topo. **A11y** preços lidos com contexto ("por mês").
**Copy** "Você pode mudar de plano quando quiser."

### 3.6 Checkout
**Obj** pagar sem medo. **Cont** redirect ao checkout do provedor (Stripe) com resumo
antes: plano, período, valor, renovação. Página de retorno faz **polling do estado real**
("Confirmando seu pagamento…"). **1ª** Ir para pagamento seguro. **2ª** trocar plano,
PIX (tri/anual). **Erro** pagamento recusado → mensagem do provedor traduzida + tentar
outro método. **Load** estado "confirmando" com explicação honesta (webhook). **Mob**
resumo compacto sticky. **A11y** anunciar mudanças de status. **Copy** "Seu acesso é
liberado automaticamente assim que o pagamento é confirmado — normalmente em segundos."

### 3.7 Dashboard (home do app)
**Obj** levar à busca em 0 cliques. **Cont** SearchBox dominante no topo; atalhos:
favoritos recentes, últimas consultas, lista de compras aberta; banner de estado da
assinatura quando relevante. **1ª** buscar. **2ª** ver listas, favoritos. **Vazio**
primeira visita: mini-tour de 3 passos ("Busque → Confira o selo → Adicione à lista").
**Load** skeletons. **Mob** busca acima da dobra, cards 1 coluna. **A11y** landmark
`main`/`search`. **Copy** saudação com nome da loja.

### 3.8 Busca principal
**Obj** do teclado ao resultado em segundos. **Cont** SearchBox + resultados
incrementais; chips de marca quando ambíguo ("Qual marca? Samsung · Motorola · Xiaomi");
filtro por marca persistente na sessão. **1ª** tocar num resultado. **2ª** limpar,
trocar marca. **Vazio** zero resultados → EmptyState "Não encontramos 'moto g85'" + CTA
**Solicitar este modelo** (pré-preenchido) + sugestões fuzzy "você quis dizer". **Load**
skeleton por item; latência-alvo percebida < 1s. **Erro** "Falha na busca — tente
novamente" preservando o texto digitado. **Mob** resultados tocáveis grandes; teclado
não cobre o 1º resultado. **A11y** combobox ARIA correto (listbox/option), anúncios de
contagem. **Copy** ambíguo: "A05 existe em mais de uma marca — escolha a marca".

### 3.9 Resultado (detalhe do modelo)
**Obj** responder "qual película serve?" com confiança explícita. **Cont** cabeçalho do
aparelho (nome canônico + 4G/5G + variante + códigos técnicos); bloco "Película do
próprio modelo" (selo); lista de equivalentes agrupada por selo (confirmados → beta com
aviso); WarningCallout fixo; aviso de variante irmã ("Existe também em 4G"). **1ª**
Adicionar à lista de compras. **2ª** favoritar; compartilhar WhatsApp; reportar
incompatibilidade; ver grupo físico. **Vazio** modelo sem cobertura → honesto: "Ainda não
temos película catalogada para este modelo" + CTA solicitar prioridade. **Load** skeleton
de blocos. **Erro** retry. **Mob** selos e nomes em 1 coluna; ações como barra fixa
inferior. **A11y** selo = ícone+texto; ordem de leitura lógica. **Copy** beta: "Provável
compatibilidade — faça o teste seco antes de aplicar."

### 3.10 Lista de compras
**Obj** transformar consultas em pedido. **Cont** itens agrupados por grupo físico
("1 molde atende: A05 + A05s — 2 modelos"), quantidade por item, total de itens.
**1ª** Gerar pedido (PDF). **2ª** renomear lista, arquivar, remover item, nova lista
(Pro). **Vazio** "Sua lista está vazia — adicione modelos a partir da busca." **Load**
otimista com rollback. **Erro** toast + item mantido. **Mob** steppers de quantidade
grandes. **A11y** agrupamentos como headings. **Copy** dica: "Agrupamos por molde para
você comprar certo."

### 3.11 Gerador de pedido (PDF)
**Obj** documento pronto para o fornecedor. **Cont** preview: cabeçalho da loja, itens
por grupo, quantidades, observações; aviso do watermark. **1ª** Gerar e baixar PDF.
**2ª** enviar por WhatsApp; copiar como texto. **Vazio** n/a (vem da lista). **Load**
"Gerando seu PDF…" (< 3s). **Erro** fallback: copiar pedido como texto. **Mob** share
sheet nativo. **A11y** PDF com texto real (não imagem). **Copy** rodapé do PDF: "Gerado
por [produto] para {loja} — {data}".

### 3.12 Histórico
**Obj** reencontrar consultas. **Cont** lista cronológica (query → modelo aberto),
filtro por dia/usuário (Pro). **1ª** repetir consulta. **2ª** favoritar a partir do item.
**Vazio** "Suas consultas aparecerão aqui." **Load** paginação infinita com skeleton.
**Erro** retry. **Mob** linhas compactas. **A11y** datas legíveis (não só relativas).
**Copy** "ontem às 14:32".

### 3.13 Favoritos
**Obj** acesso de 1 toque aos modelos do dia a dia. **Cont** grid de DeviceCards;
badge se o status de alguma compatibilidade favoritada mudou ("Em revisão"). **1ª**
abrir resultado. **2ª** remover; adicionar à lista. **Vazio** "Favorite os modelos que
você mais vende." **Load** skeleton grid. **Erro** retry. **Mob** 2 colunas. **A11y**
botão remover com rótulo do modelo. **Copy** mudança: "O selo deste modelo mudou —
toque para ver."

### 3.14 Solicitação de modelo
**Obj** capturar demanda não atendida com esforço mínimo. **Cont** formulário
pré-preenchido (marca/modelo da busca falha), campo de observação; lista "suas
solicitações" com status (Aberta → Em pesquisa → Adicionada). **1ª** Enviar solicitação.
**2ª** ver solicitações anteriores. **Vazio** "Nenhuma solicitação ainda." **Load**
otimista. **Erro** manter texto. **Mob** 3 campos no máximo. **A11y** status com texto,
não só cor. **Copy** pós-envio: "Recebido! Avisaremos quando este modelo entrar na
base." (sem prometer prazo).

### 3.15 Conta
**Obj** autogestão sem suporte. **Cont** perfil (nome, e-mail, senha), dados da loja,
preferências (modo balcão, tema), LGPD (exportar meus dados, excluir conta). **1ª**
salvar. **2ª** excluir conta (dupla confirmação + consequências claras). **Erro**
validações inline. **Mob** seções acordeão. **A11y** confirmação destrutiva acessível.
**Copy** exclusão: "Isso apaga sua conta e anonimiza seus dados. Assinatura ativa será
cancelada."

### 3.16 Dispositivos
**Obj** gerenciar o limite do plano sem atrito. **Cont** lista DeviceSessionRow
(rótulo, último acesso, atual marcado); contador "2 de 2 dispositivos". **1ª** revogar
dispositivo. **2ª** renomear. **Vazio** só o atual. **Load** padrão. **Erro** retry.
**Mob** swipe para revogar com confirmação. **A11y** "dispositivo atual" anunciado.
**Copy** ao exceder no login: "Seu plano permite 2 dispositivos. Desconecte um para
continuar aqui." (escolha do usuário, nunca automática).

### 3.17 Assinatura
**Obj** transparência total de cobrança. **Cont** plano atual, próximo vencimento,
método de pagamento, histórico de faturas (recibos), botões upgrade/downgrade/cancelar,
portal do provedor. **1ª** gerenciar pagamento (portal). **2ª** mudar plano; cancelar
(fluxo honesto de 2 passos, sem dark pattern). **Erro** estado `past_due` com CTA
"Atualizar cartão". **Mob** cartões empilhados. **A11y** valores com contexto. **Copy**
cancelamento: "Você mantém acesso até {data}. Seus dados ficam guardados por 12 meses."

### 3.18 Painel administrativo (visão geral)
**Obj** cockpit interno de operação. **Cont** KPIs do dia (buscas, zero-results, novas
assinaturas, solicitações abertas, reports abertos), fila de curadoria priorizada,
últimas ações de auditoria. **1ª** ir para a fila de curadoria. **2ª** atalhos p/ CRUDs.
**Estados** todos com dados reais (nunca métrica inventada). **Mob** utilizável, mas
otimizado p/ desktop. **A11y** tabelas com headers. Detalhe completo em
[PAINEL_ADMIN_MODERACAO_001.md](PAINEL_ADMIN_MODERACAO_001.md).

### 3.19 Moderação (contribuições/solicitações/reports)
**Obj** processar filas com contexto completo e decisão auditada. **Cont** fila com
filtros (tipo, idade, demanda), item aberto mostra: dado proposto × dado atual, evidências,
histórico do contribuinte; ações Aprovar (gera rascunho) / Rejeitar (motivo obrigatório)
/ Pedir info. **Vazio** "Fila limpa 🎉". **Erro** conflito de edição concorrente
detectado e explicado. **A11y** atalhos de teclado (j/k/a/r). **Copy** rejeição sempre
com motivo visível ao autor.

### 3.20 Gestão de compatibilidades (admin)
**Obj** editar a base com segurança máxima. **Cont** busca por modelo/grupo; tela do
grupo: membros, status derivado por membro, evidências por relação, simulação "o que
muda se eu aprovar" (diff de pares exibíveis); ações: adicionar/remover membro, anexar
evidência, rebaixar status (com motivo), desativar/restaurar relação. **1ª** salvar como
rascunho → publicar com confirmação. **2ª** ver histórico/rollback. **Erro** validações
de política (ex. tentar promover sem evidência → bloqueado com explicação). **A11y**
diff legível. **Copy** confirmação de publicação: "Isso altera {n} resultados visíveis
para assinantes."

## 4. Landing page — planejamento completo

### 4.1 Estrutura de seções (ordem)

1. **Header** — logo, "Como funciona", "Planos", "FAQ", CTA "Testar grátis" (sticky no scroll).
2. **Hero** — headline + subheadline + CTA duplo + mock real do app no celular (screenshot
   verdadeiro do produto, não montagem genérica — diferencial direto contra o hero datado
   do concorrente).
3. **Demonstração de busca** — o widget real (§3.2). É a seção mais importante da página.
4. **Problema** — 3 dores em cards ("Testar película por película", "A05, A05s, A05 4G…
   qual é qual?", "Planilha desatualizada").
5. **Solução / Como funciona** — 3 passos ilustrados: Busque → Confira o selo → Monte o pedido.
6. **Níveis de confiança** — explica os selos com exemplos reais; é a seção que constrói
   a credibilidade que o concorrente não tem.
7. **Exemplos de compatibilidade** — 3 cards reais (ex.: iPhone XR ↔ iPhone 11 —
   Confirmado por fornecedor).
8. **Pedido automático + PDF + WhatsApp** — screenshot do fluxo lista→PDF.
9. **Múltiplos dispositivos** — "No celular do balcão e no PC do estoque."
10. **Comparação com tabelas tradicionais** — tabela: planilha/grupo de WhatsApp × nós
    (atualização, confiança, busca, pedido). Sem citar concorrente nominalmente.
11. **Números honestos** — SOMENTE os claims autorizados ([PRD §7](PRD_CATALOGO_SAAS_MVP_001.md)):
    429 modelos · 10 marcas · 1.751 apelidos/códigos · curadoria contínua. **Sem** contagem
    de usuários/satisfação inventada; depoimentos só após beta real.
12. **Planos** — PlanCards compactos + toggle período + fundador com contagem real.
13. **FAQ** — cobre: teste grátis, dispositivos, cancelamento, "vocês garantem o
    encaixe?" (resposta honesta), "e capinhas?" (texto aprovado no gate), LGPD.
14. **Segurança & atualizações** — dados protegidos, base em curadoria contínua.
15. **CTA final** — repetição do hero condensada.
16. **Footer** — termos, privacidade, contato/WhatsApp, CNPJ (quando existir).

### 4.2 Mensagens

- **Headline (candidata):** "A película certa, em segundos."
- **Subheadline:** "Busque por nome, apelido ou código. Veja o nível de confiança.
  Monte o pedido para o fornecedor. Direto do balcão."
- **CTA principal:** "Testar grátis por 7 dias" (sem cartão).
- **CTA secundário:** "Ver demonstração" (âncora para o widget).
- **Textos de confiança:** "Exibimos somente compatibilidades com confirmação — e
  avisamos quando é melhor testar antes."
- **Textos de limitação (obrigatórios):** "Cobertura em expansão contínua; não achou um
  modelo? Solicite e avisaremos." / "Nenhuma resposta substitui a conferência física
  quando o selo pedir teste."
- **Proibido na landing:** tudo do [PRD §8](PRD_CATALOGO_SAAS_MVP_001.md) (86.738,
  garantia de encaixe, capinhas como recurso, métricas inventadas).

### 4.3 SEO

- **Palavras-chave primárias:** "película compatível", "compatibilidade de películas",
  "película serve em qual celular", "tabela de películas compatíveis", "película 3D
  compatível [modelo]".
- **Long-tail programático (Fase 2, decisão de exposição no gate):** páginas públicas
  por MODELO (não por par) com conteúdo raso ("Consulte películas compatíveis com
  {modelo}") SEM expor a resposta — a resposta fica atrás do login. Equilíbrio
  SEO × proteção da base descrito em [SEGURANCA §6](SEGURANCA_PROTECAO_BASE_001.md).
- Técnica: SSG para landing, meta/OG completos, sitemap, schema.org `SoftwareApplication`
  + `FAQPage`, Core Web Vitals verdes (landing < 100KB JS).

### 4.4 Prova social

No lançamento: **nenhum depoimento inventado.** Substitutos honestos: demonstração ao
vivo, números auditáveis, garantia de arrependimento 7 dias, "feito por quem tem loja".
Depoimentos reais entram após o beta fechado (com autorização escrita dos lojistas).
