# Changelog — OmniGestão Pro

## 2026-08-15 — Operações V4: Fila Kanban acionável

- A rail Fila deixa de ser somente leitura: Lista e Kanban operam a mesma máquina de status da V3.
- Arrastar um ticket só entra em estação de produção permitida; destino inválido não aceita drop. Menu `Mover para`, tecla `M` e Lista fazem a mesma mudança.
- Diagnóstico→aprovação e aprovação comercial ficam no cockpit (não burla orçamento). Recebimento, entrega e cancelamento por drag ficam de fora.
- Técnico, prioridade e SLA usam os mesmos readers da Bancada. Busca + filtros + preferência de view persistida.
- Sem schema, sem motor paralelo, sem lib de DnD nova (HTML5 nativo, como a V3).

## 2026-08-14 — Operações V4: Bancada operacional (técnico, prioridade, status)

- A rail Bancada deixa de ser somente leitura: resumo do dia, fila Sem técnico e produção por técnico.
- Atribuição, reatribuição, remoção, prioridade e ações rápidas de status reusam o motor V3 (`atribuirTecnicoV3`, `definirPrioridadeV3`, máquina única).
- Técnico e prioridade também aparecem no header da OS e no início da Execução.
- Sem Kanban da Fila, sem schema, sem motor paralelo.

## 2026-08-14 — Operações V4: pipeline operacional e header transversal

- A pipeline da OS passa a ter só **Entrada → Diagnóstico → Execução → Entrega → Pós-venda**.
- Orçamento, Financeiro e Histórico saem da trilha e ficam no header da OS, reusando os estágios reais.
- A Entrada deixa as sete subseções e o rail overlay; opera em quatro grupos (Recepção e aparelho, Segurança e custódia, Inspeção, Evidências), sem repetir o que já veio da abertura.
- Sem schema, sem motor novo, sem alteração em PDV/Caixa/Financeiro engine.

## 2026-08-14 — Operações V4: entrada única `+ Novo`

- A TopBar da Operações V4 troca os três CTAs (Atendimento rápido, Orçamento rápido, Nova OS) por um único **`+ Novo`**.
- O launcher oferece as três modalidades reais — Nova Ordem de Serviço, Novo Orçamento e Atendimento Rápido — e reutiliza os motores V3 já existentes.
- Duplicar orçamento continua abrindo o modal direto, sem passar pelo launcher.
- Sem schema, sem motor novo, sem alteração em PDV/Caixa/Financeiro.

## 2026-08-03 — Numeração server-side: rebase e readiness PostgreSQL

- Infraestrutura reaplicada sobre `origin/main` `1ed325912de50750a018903cda9c14be4f4df92d`;
  a migration aditiva passou a ser `0016_add_sale_numbering_infrastructure`, depois da
  `0015_contador_identidade_externa` já presente na main.
- Migration e upgrade de vendas legadas validados em PostgreSQL local 17.10 descartável:
  3 `pedidoId` preservados e os 8 novos campos de `Venda` mantidos `NULL`.
- Concorrência real validada em `READ COMMITTED` com 50 transações na mesma loja/ano e
  20 transações por loja em duas lojas. Em snapshot forte, a criação concorrente inicial
  propagou `P2002` em `RepeatableRead` e `P2034` em `Serializable`, sem retry interno.
- A infraestrutura continua dormente: nenhum writer, rota, PDV ou importador foi integrado;
  a integração controlada permanece para o GOAL 002C.

## 2026-07-30 — Numeração server-side de venda: infraestrutura dormente

- Adicionados `SerieVenda`, código estável nullable por loja e metadados nullable de
  idempotência/numeração em `Venda`, com unique por tentativa, unique por série/número
  e FK composta que impede cruzamento de série entre lojas.
- Adicionado helper server-only que aloca `VDA-{LOJA}-{ANO}-{NNNNNN}` no mesmo
  `TransactionClient` do futuro writer, usando advisory lock na criação da série e um
  único incremento atômico no contador.
- Migration exclusivamente aditiva e sem backfill; nenhum identificador histórico,
  writer, rota, payload público ou pendência legada foi alterado.

## 2026-07-28 — Writer v1 de vendas: replay atômico e conflito fail-closed

- `Venda.upsert` foi substituído por criação exclusiva: uma venda já existente nunca é atualizada pelo writer v1. O servidor compara um fingerprint canônico/versionado dos fatos; replay idêntico retorna a venda existente sem repetir itens, estoque, financeiro, títulos ou crédito-vale, enquanto fatos diferentes retornam `PEDIDO_ID_CONFLITO_MESMA_LOJA` (HTTP 409).
- Corridas `P2002` revertem a transação perdedora e classificam a venda vencedora fora da transação como replay, conflito same-store ou colisão cross-store. O guard `PEDIDO_ID_DE_OUTRA_LOJA` permanece fail-closed.
- Os dois conflitos técnicos ficam em quarentena local permanente: sem auto-retry, reenvio manual, sincronização retroativa ou descarte individual/em lote. A UI preserva a cópia local e orienta recuperação administrada.

## 2026-06-17 — PDV Assistência: migração para o motor de pagamento compartilhado

- **PDV Assistência** passou a reutilizar o **mesmo `PaymentModal` compartilhado** dos demais PDVs (Clássico/Supermercado/Venda Completa/Black) — eliminado o `PaymentModal` local duplicado (~570 linhas; saldo do arquivo: **−590 linhas**). Ganha automaticamente: pagamento misto, **à prazo com entrada + parcelas + vencimento + observação**, à prazo no Múltiplo, sugestão de saldo restante → Conta a Receber, **abertura automática do seletor de cliente** (com cadastro rápido) quando falta cliente, e idempotência por parcela em `ContaReceberTitulo`.
- **Preservado (sem regressão):** aparência do PDV Assistência (carrinho/atalhos/header), desconto (mapeado para o `discountType` interno, com snapshot/revert no cancelar), impressão (cupom via `buildPagamentosResumo`), operador/auditoria, crédito-vale, persistência de carrinho, offline/sync e `finalizeSaleTransaction` (intacto).
- **Mudanças de UX deliberadas:** o desconto agora é editado **dentro** do modal (campos R$/% no topo) em vez de um campo no PDV — F10 abre o modal nesse estado; o campo de "observação da venda" (que era só um toast, não persistido) saiu. Motor transacional, schema, auth, proxy e financeiro **não** foram tocados.

## 2026-06-17 — Venda a prazo profissional + cliente rápido no PDV

- **Modal de pagamento compartilhado** (`payment-modal.tsx`): À Prazo passa a ser combinável no **Pagamento Múltiplo** (F12); novo atalho **"Lançar R$ X restante À Prazo"** sugere o saldo como Conta a Receber em 1 toque (ex.: recebe R$ 22 em dinheiro numa venda de R$ 39,90 → sugere R$ 17,90 à prazo); campo **Observação** no card à prazo; quando falta cliente, o modal **abre o seletor de cliente** (em vez de só toast) via `onRequireCustomer`, preservando o carrinho.
- **Cadastro rápido de cliente no PDV** (`pdv-cliente-picker.tsx` + `app/api/clientes/quick`): botão "Cadastrar novo cliente" na busca (Nome obrigatório, Telefone/CPF opcionais), cria cliente real e seleciona automaticamente sem sair do PDV. Rota dedicada aberta a operador autenticado, multi-loja por header.
- **PDVs cobertos:** Clássico, Supermercado (passa a aceitar cliente/à prazo) e PDV Next (passa a enviar CPF) reutilizam o mesmo modal/motor; **Venda Completa** migrada do formulário de método único para o modal compartilhado (ganha entrada + parcelas + vencimento + múltiplo + à prazo).
- **Motor inalterado:** `finalizeSaleTransaction` + `upsertVendaInTransaction` já faziam o split correto — entrada no caixa, saldo a prazo só em `ContaReceberTitulo` (idempotente por parcela), sem duplicar e sem criar título quando aPrazo = 0. Observação opcional espelhada no payload do título. Cobertura de testes nova em `lib/ops-upsert-venda-aprazo.test.ts`.
- **Fora desta entrega:** PDV **Assistência** mantém seu modal próprio (à prazo cheio → Conta a Receber, sem entrada/parcelas) — migração para o modal compartilhado adiada por risco (modal bespoke acoplado a desconto/teclado na produção; requer teste manual de checkout).

## 2026-05-08 — Memória viva do projeto

- **Documentação:** criado [`docs/memory/OMNIGESTAO_MASTER_MEMORY.md`](../memory/OMNIGESTAO_MASTER_MEMORY.md) — relatório longo de continuidade: histórico por fases, implementações por módulo (Financeiro, PDV, Operações, WhatsApp, Auth, Billing, etc.), separação *inferencial* Claude Code vs Cursor, status ✅/⚠️/❌, decisões arquiteturais, pendências P0/P1/P2/P3, temas (incl. Quantum Violet como acento, não tema studio), PDVs, produção/Vercel, riscos, sequência MVP e apêndices (migrations, índice de reports, commits).
- **`docs/ai/CURRENT_STATUS.md`:** link para a memória mestra e nota sobre possível defasagem da tabela da auditoria na linha WhatsApp.
- **`docs/PROJECT_MASTER.md`** e **`docs/START_HERE.md`:** entrada na ordem de leitura apontando para a memória consolidada.
- **`docs/modules/reports/AUDITORIA_GERAL_OMNIGESTAO_PRO.md`:** ajuste na linha do WhatsApp HUB (Meta Cloud API real + automações parciais).
- **`docs/roadmap/ROADMAP.md`:** Fase C — bullet WhatsApp alinhado à integração Meta existente.

## 2026-05-09 (WhatsApp Cloud API)

- WhatsApp: **integração Meta Cloud API real** — `lib/whatsapp.ts` (cliente Graph API: texto, template, mídia); `app/api/webhooks/whatsapp/route.ts` (verificação `X-Hub-Signature-256`, `after()` assíncrono, resposta 200 imediata); `app/api/whatsapp/send/route.ts` (texto/template/mídia outbound); `app/actions/whatsapp.ts` (Server Actions com guard NextAuth); `lib/whatsapp-meta-cloud-webhook.ts` (processamento de payload inbound: deduplicação por wamid, contato upsert, conversa findOrCreate, `addMessage`).
- WhatsApp HUB UI: carrega conversas/automações/respostas rápidas de Prisma na inicialização (`/api/whatsapp/conversations?includeMessages=1`, `/api/whatsapp/automations`, `/api/whatsapp/quick-replies`); fallback para mock se banco vazio; `sendMessage` usa `/api/whatsapp/send` com `conversationId` real; `mapConversationsToContacts` normaliza dados do Prisma para o schema de UI do HUB.
- WhatsApp service (`lib/whatsapp/whatsapp-service.ts`): adicionados `sendCloudApiTextAndRecord`, `sendCloudApiTemplateAndRecord`, `sendCloudApiMediaAndRecord` (chamam Cloud API + `addMessage` outbound); `logWebhookPayload` registra ingress no log de automação.
- Docs: ENVs WhatsApp (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_STORE_ID`) adicionadas ao `CLAUDE.md`; `CURRENT_STATUS.md` atualizado com seção da integração real.
- WhatsApp HUB UI — **CRUD persistido**: toggle de automação chama `PATCH /api/whatsapp/automations/[id]` com rollback local em caso de erro; salvar edição de automação persiste via PATCH; deletar resposta rápida chama `DELETE /api/whatsapp/quick-replies/[id]`; criar/editar resposta usa `POST`/`PATCH` com id real retornado pelo servidor. Todas as ações exibem toast de erro se a API falhar.

## 2026-05-09

- PDV **Assistência** — correção definitiva de overflow/topo cortado (`docs/modules/reports/PDV_ASSISTENCIA_LAYOUT_FINAL.md` §3): remove margens negativas do wrapper `services`; `flex-1 min-h-0 basis-0` na rota `/dashboard/vendas`; root do assistência sem `h-full`; carrinho com `ScrollArea` em invólucro `min-h-0 flex-1`. Sem mudança em Omni shell nem lógica de venda.
- PDV **Rápido / Omni clássico** (`?modo=rapido`) — layout e busca (`docs/modules/reports/PDV_RAPIDO_LAYOUT_E_BUSCA.md`): `lib/pdv-product-search.ts`; `PdvOmniClassicShell` com painel direito no modo rápido, F3 filtrável e empty state; BIPE/sugestões e grade legada em `pdv-classic` usam o mesmo matcher (acentos, categoria, códigos).
- PDV **Assistência** — layout final no AppShell (`docs/modules/reports/PDV_ASSISTENCIA_LAYOUT_FINAL.md`): `AppShell` com `min-h-0` na coluna e no `main`; ramo `services` em `pdv-classic` com full-bleed (`-mx`/`-my`) só para o Assistência; `PdvAssistenciaEnterprise` com `h-full flex-col`, header em fluxo normal e grade sem `calc(100vh)`; demais PDVs inalterados.
- MVP — **passo 06 empty states e fallbacks visuais** (`docs/modules/reports/MVP_STABILIZATION_PASS_06.md`): componentes `EmptyState`, `ErrorState`, `LoadingState` em `components/ui/states/`; `FinanceiroV2LoadingFallback` com skeleton + `loading.tsx` de rota; PDV substitui `return null` por `<LoadingState>`; Estoque adiciona `isLoading` state com feedback no TableBody e empty state contextual com ação "Novo Produto".
- PDV: **layout fixo sem rolagem global** — `AppShell.main` convertido em flex container (`flex flex-col overflow-hidden`); rota `/dashboard/vendas` usa wrapper `overflow-hidden` sem `pb-24`; `VendasPageClient` remove `min-h-[100dvh]` e aplica `-mx-4 sm:-mx-6 lg:-mx-8`; aside com `h-full`, card Informativo com `flex-1` para preencher espaço. PDV encaixado em 100vh sem scroll de página; produtos rolam internamente; Total/Finalizar sempre visíveis. Relatório: `docs/modules/reports/PDV_FIXED_LAYOUT_POLISH.md`.
- PDV: **UX premium do autocomplete/BIPE** — navegação por teclado (↓/↑ percorre sugestões, Enter seleciona ativo, ESC limpa campo), highlight visual da linha ativa (`bg-accent` / `bg-white/[0.12]`), scroll automático para manter item visível. Foco retorna ao campo após qualquer seleção. Sem alteração de schema, financeiro ou lógica de busca. Relatório: `docs/modules/reports/PDV_UX_AUTOCOMPLETE_IMPROVEMENTS.md`.
- PDV: **fix busca de produtos no campo BIPE** — `filteredProducts` passa a filtrar por SKU e código interno além de nome/categoria/EAN; campo "Código / Bipe" exibe dropdown de autocomplete em tempo real (até 8 sugestões com nome, SKU, EAN e estoque); clique na sugestão adiciona o item ao carrinho sem sair do campo; comportamento `Enter` via `findPdvProductByScan` mantido intacto. Relatório: `docs/modules/reports/PDV_FIX_BUSCA_PRODUTOS.md`.

## 2026-05-08

- MVP — **passo 05 smoke UI / rotas** (`docs/modules/reports/MVP_STABILIZATION_PASS_05.md`): redirects `/dashboard/cadastros` → `cadastros-v2`, `/dashboard/produtos` → `estoque`, `/dashboard/pdv` → `vendas`; placeholder `ModuleEmDesenvolvimento` para relatórios e rota legada `financeiro`; dropdown **Novo** no Topbar com links reais; `mobile-nav` com `href`/`externalPath` para Estoque onde faltava.
- MVP — **passo 04 guard dev-health** (`docs/modules/reports/MVP_STABILIZATION_PASS_04.md`): `lib/dev-tools/dev-access.ts`; em produção `/dashboard/dev-health` exige `ENABLE_DEV_HEALTH=true` ou `NEXT_PUBLIC_ENABLE_DEV_HEALTH=true`; checklist `docs/deploy/PRODUCTION_CHECKLIST.md` atualizado.
- MVP — **passo 03 painel interno de health** (`docs/modules/reports/MVP_STABILIZATION_PASS_03.md`): página `/dashboard/dev-health` (somente leitura, sem secrets); checklist atualizado em `docs/deploy/PRODUCTION_CHECKLIST.md`.
- MVP — **passo 02 produção / smoke** (`docs/modules/reports/MVP_STABILIZATION_PASS_02.md`): checklist `docs/deploy/PRODUCTION_CHECKLIST.md`; script `scripts/smoke-production.mjs`; `force-dynamic` em `GET` de `/api/stores/[id]`, `/api/stores/[id]/settings`, `/api/ops/import/clientes`, `/api/settings/perfil-loja`, `/api/audit/logs`.
- MVP — **estabilização visual e honestidade de dados** (`docs/modules/reports/MVP_STABILIZATION_PASS_01.md`): painel inicial sem KPIs fictícios; selos “Exemplo”/aviso de pré-visualização; Financeiro HUB com badges Preview/Demo nas abas híbridas; navegação Operações “Novo” vs OS legado; `GET /api/ops/ordens` com `force-dynamic`; fallbacks em listas financeiras do contexto.
- Financeiro: **fundação carteiras / movimentos / ledger** — tipos `lib/financeiro/types/`, serviços puros `lib/financeiro/services/` (saldo derivado, previstos, eventos, `buildMovimentoFromContaReceber` sem persistência); gap Prisma documentado em `docs/modules/reports/FINANCEIRO_LEDGER_BASE.md`.
- Financeiro: camada de **contratos oficiais** (`lib/financeiro/contracts/`) — status, origens, local keys (`os-faturamento` preservado), payload JSONB helpers, valores/datas; adapter OS → receber passa a importar helpers sem mudar merge de revisões; doc `docs/modules/reports/FINANCEIRO_CONTRACTS_STATUS_BASE.md`.

## 2026-05-07

- Financeiro: **service Prisma Contas a Receber** (`lib/financeiro/services/contas-receber-service.ts`) — listagem, upsert idempotente por `(storeId, localKey)`, cancelar, liquidar, pagamento parcial, estorno (`titulo_completo` / `ultimo_pagamento`), resumos `buildContaReceberSummary` / `buildContaReceberAuditTrail`; histórico em `payload.historico` e contratos em `lib/financeiro/contracts/`; relatórios `FINANCEIRO_RECEBER_SERVICE_REAL.md` e `FINANCEIRO_RECEBER_API_UNIFICATION.md` (sem alteração de Prisma/UI V2).
- Financeiro: **service Prisma Contas a Pagar** (`lib/financeiro/services/contas-pagar-service.ts`) — list/get/upsert idempotente por `(storeId, localKey)`, cancelar, liquidar, pagamento parcial, estorno (`titulo_completo` / `ultimo_pagamento`), resumos `buildContaPagarSummary` / `buildContaPagarAuditTrail`; histórico em `payload.historico` e contratos em `lib/financeiro/contracts/`; relatórios `FINANCEIRO_PAGAR_REAL_CHECKIN.md` e `FINANCEIRO_PAGAR_SERVICE_REAL.md` (sem alteração de Prisma/UI V2).
- Financeiro: APIs Ops **Contas a Pagar** — `POST /api/ops/contas-pagar-persist` (upsert snapshot via service) e `GET /api/ops/contas-pagar-list` (rows + summary + audit + metadata), mantendo compatibilidade com payloads simples/legados; relatório `FINANCEIRO_PAGAR_API_PERSIST_LIST.md`.
- Financeiro: APIs oficiais (Financeiro) **Contas a Pagar — baixas/estornos server-side** — `POST /api/financeiro/contas-pagar/pagamento-parcial`, `liquidar`, `estornar` e `estornar-ultimo-pagamento` delegando para `contas-pagar-service` + `logsAuditoria` leve; relatório `FINANCEIRO_PAGAR_BAIXAS_E_ESTORNOS.md` (sem integração UI nesta entrega).
- Financeiro: painel legado **Contas a Pagar híbrido** — leitura server-side (`GET /api/ops/contas-pagar-list`) com fallback localStorage, persistência snapshot (`POST /api/ops/contas-pagar-persist`) e baixas/estornos server-first (`/api/financeiro/contas-pagar/*`), mantendo localStorage como espelho; relatório `FINANCEIRO_PAGAR_PAINEL_HIBRIDO.md`.
- Documentação: check-in **Financeiro V2 — real vs mock** (`docs/modules/reports/FINANCEIRO_V2_REAL_CHECKIN.md`), atualização de `docs/modules/FINANCEIRO.md` e tabela em `docs/ai/CURRENT_STATUS.md` para distinguir hub mock, painel legado e Prisma/adapters.
- Operações HUB V2: adicionada camada de **normalização segura de status** (sem migration), preservando granularidade no payload (`payload.operacaoStatus`) e mantendo compatibilidade com `StatusOrdemServico` do Prisma.
- Operações HUB V2: anexos agora usam persistência local **IndexedDB** + referência estável `local-idb://...` no payload (prepara migração futura para Storage real).
- Operações HUB V2: adapter idempotente **OS → Contas a Receber (Prisma)** materializa `ContaReceberTitulo` a partir de `faturamento*` no payload, com eventos na timeline e cancelamento seguro (sem deletar).
- Operações HUB V2: modularização segura do backend operacional (extração de helpers/serviços de payload, timeline, hidratação, status e sync financeiro) sem alteração de comportamento.
- Operações HUB V2: política segura para **revisão de orçamento aprovado** (histórico no payload + auditoria na timeline + marcação de revisão no título a receber, sem duplicidade).
- Operações HUB V2: adapter idempotente **OS → Estoque real (Prisma)** consome `Produto.stock` e cria `OrdemServicoItem` ao finalizar a OS (`entregue`), com trilha no payload e eventos na timeline.
- Operações HUB V2: padronização de peças/produtos com `produtoId` real no payload quando origem é o catálogo (Cadastros/Prisma), mantendo compatibilidade com mocks e fallback por SKU.
- Operações HUB V2: estoque — **restauração automática** ao sair de `entregue`/cancelar e **delta transacional** após revisão de orçamento aprovado (consumo/restauração parcial), com idempotência e histórico no payload.

