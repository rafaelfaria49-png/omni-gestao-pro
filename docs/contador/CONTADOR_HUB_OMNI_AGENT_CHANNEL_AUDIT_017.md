# CONTADOR-017 — Auditoria de canais (Passo 0)

| Campo | Valor |
|---|---|
| GOAL de auditoria | `CONTADOR-017-OMNI-AGENT-CHANNEL-AUDIT-001` |
| GOAL alvo (não aberto) | `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017` |
| Tipo | Auditoria / planejamento **read-only** |
| Data | 2026-08-19 |
| `origin/main` | `ac6345744618bca0ae098eed379b16196ca0c38d` (`aep(contador): close CONTADOR-HUB-OBRIGACOES-GUIAS-016`) |
| GOAL 017 importado/aberto | **false** |
| Código de aplicação alterado nesta execução | **nenhum** |

Este documento é o **Passo 0 obrigatório** do roadmap 014–019. Não implementa o 017. Não importa nem abre o GOAL. Não envia mensagem de teste. Não chama provider externo.

---

## 0. Pré-voo

| Checagem | Resultado |
|---|---|
| `HEAD` == `origin/main` | `ac6345744618bca0ae098eed379b16196ca0c38d` |
| Working tree na base | limpa |
| AEP `.aep-active` | ausente |
| `node scripts/track.mjs status contador` | 🟡 PAUSED · `current_goal=null` · `next_goal=null` |
| GOAL 016 | **DONE** · ledger `2026-08-19T16:00:28.165Z` · last_goal `CONTADOR-HUB-OBRIGACOES-GUIAS-016` |
| GOAL 012 | **DONE** (`CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN`, evidência em `docs/ai-execution/_evidence/CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN.md`) |
| Caminho quente `docs/execution-tracks/contador/goals/` | vazio (só `.gitkeep`) |
| 017 no plano | DRAFT em `RECONCILIACAO.md` (importações 1–10 listam o id; **não há manifesto de importação do 017**) |

Fontes lidas: roadmap `docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md` §017, `CONTADOR_HUB_COMMANDS_001.md` COMANDO 17/19, masterplan §17, closures 012G e 016.

---

## 1. Eventos do Contador — produtores reais para o 017

`ContadorEvento.tipo` é **`String`**, não enum Prisma. Tipos novos (`alerta_emitido`, `mensagem_enviada`, `alerta_tratado`, `alerta_suprimido`) **não exigem migration**. Metadata é JSONB saneada (sem PII, sem `storageRef`, sem segredo). Todo evento carrega `storeId`; `competenciaId` é opcional (FK composta quando presente).

**Não inventar eventos fiscais.** O sinal `fiscal` do checklist permanece `nao_disponivel` (GOAL 018).

### 1.1 Mapa dos sinais do 017

| Sinal 017 | Produtor real | Tipo de evento existente | Dados disponíveis | `storeId` / `competenciaId` | Suficiente? | Regra derivada em leitura? |
|---|---|---|---|---|---|---|
| Documento pendente | `lib/contador/documentos/service.ts` + `listarDocumentos` (`app/api/contador/documentos`) | `documento_enviado` / `documento_substituido` / `status_alterado` (GOAL 011). **Não há** evento `documento_pendente`. Status persistido: `PENDENTE`/`ENVIADO`/`CONFERIDO`/`RESOLVIDO`. `vencido` é flag derivada (`lib/contador/status/vencido.ts`). | id, categoria, título, status, vencimento, competência, loja. `storageRef` existe na row e **não deve entrar no rascunho**. | sim / sim | Sim, via **leitura do estado** (`status === PENDENTE` ou rejeitado de volta a PENDENTE), não via evento isolado. | **Sim.** Eventos de upload/status são histórico; o alerta é estado atual × limiar de dias até o fim da competência. |
| Fechamento próximo | `ContadorCompetencia` (GOAL 009/012) + `posicaoCompetencia` em `montar-checklist.ts` | `competencia_criada`, `competencia_fechada`, `competencia_reaberta`. **Não há** evento `fechamento_proximo`. | status `ABERTA`/`ENVIADA`/`COM_PENDENCIA`/`FECHADA`, `ano`/`mes`, `versao`, snapshot se fechada. | sim / sim | Sim para “competência aberta após dia X do mês civil SP”. | **Sim.** Calendário (`America/Sao_Paulo`) + status ≠ `FECHADA`. Silenciar se já `FECHADA`. |
| Guia vencendo / vencida | Agenda GOAL 016: `lib/contador/agenda/service.ts` + `vencimento.ts`. Eventos: `guia_informada`, `guia_atualizada`, `guia_paga`. Checklist: `guias_informadas_vencendo_vencidas` (janela **7 dias**, constante `GUIAS_VENCENDO_DIAS`). | Eventos de ciclo de vida, **não** de vencimento. `vencido`/`vencendo` **nunca persistidos**. Guia paga (`pagaEm`) ≡ `RESOLVIDO` via `statusEfetivoGuia`. | título, vencimento informado, valor (não usar no rascunho por padrão), `pagaEm`, ids, competência. | sim / sim | Sim. | **Sim.** Reavaliar `estaVencido` / `estaVencendo` sob demanda. Paga → não gera vencido/vencendo. |
| Pacote com pendências | Fechamento 012 materializa pacote + manifesto (`pendencias[]`, `pendenciasAssumidas` no metadata de `competencia_fechada`). `montarPendencias` em `lib/contador/pacote/fontes.ts`. **Não há** evento `pacote_gerado` separado. | `competencia_fechada` (contagem); `pacote_baixado` / `pacote_recebimento_confirmado` (portal 015). | manifesto.pendencias, checklist estados ≠ `ok` (exceto `nao_disponivel` que vai para ausências), fontes parciais. | sim / sim | Parcial. A lista viva de pendências está no manifesto do pacote da versão; o evento só tem **contagem**. | **Sim.** Ler manifesto da versão vigente **ou** rederivar de `montarPendencias` na mesma carga. Não tratar `nao_disponivel` (documentos/fiscal stub) como pendência operacional do 017 sem filtro. |
| `alteracao_pos_fechamento` | `lib/contador/fechamento/divergencia.ts` (puro, GET não grava) + `POST /api/contador/fechamento/divergencia` (grava). Dedupe já existe: `(competenciaId, versao, diffHash)` com `FOR UPDATE` na competência. | `alteracao_pos_fechamento` | `competencia`, `versao`, `diffHash`, `metricas` (contagem). Itens do diff (totais, não linhas PII). | sim / sim | Sim, **depois** do POST explícito. GET só mostra divergência viva. | **Híbrido.** O 017 deve alertar a partir do **evento persistido** (trilha) e pode oferecer o GET como preview interno. Não auto-POST. |
| Agenda / obrigações 016 | `obrigacao_criada`, `obrigacao_atualizada`, `obrigacao_status_alterado`, `template_criado`, `template_atualizado` | ciclo de vida | título, tipo operacional (não fiscal), vencimento, status da matriz 011 | sim / sim | Complementar. O roadmap 017 cita guia, não obrigação isolada. | Opcional: obrigação `envio_documento`/`fechamento` pendente pode alimentar o mesmo motor derivado, sem tipo fiscal novo. |

### 1.2 Checklist: não usar cegamente

`montarChecklistFechamento` ainda marca:

- `documentos` → `nao_disponivel` (“domínio ainda não implementado”) — **stale** após GOAL 010;
- `fechamento_oficial` → `pendente` (“GOAL 012 não implementado”) — **stale** após GOAL 012.

O 017 **não** deve derivar alertas desses dois itens. Fontes corretas: `ContadorDocumento` + `ContadorCompetencia.status`. Relatar a defasagem; **não corrigir neste Passo 0**.

O item `guias_informadas_vencendo_vencidas` **é real** (016) e pode ser reusado como evidência, com a mesma janela de 7 dias como default configurável.

### 1.3 Outros `ContadorEvento` (fora do disparo 017, úteis para audit)

Documentos: `documento_download_autorizado`, `documento_excluido`. Comentários: `comentario_criado`. Auth externa 014: `convite_*`, `acesso_*`, `usuario_*`, `sessao_revogada`. Portal 015: `documento_download_autorizado`, `pacote_baixado`, `pacote_recebimento_confirmado`, `status_alterado`, `comentario_criado`.

Nenhum destes é canal de saída.

---

## 2. Omni Agent / automações existentes

Classificação: **A** infraestrutura real ativa · **B** existente mas inadequada ao Contador · **C** mock/preview · **D** legado inseguro para reuso.

### 2.1 Inventário

| Peça | Caminho | Classe | Notas |
|---|---|---|---|
| Inbox + confirmação de **comando** | `app/actions/omni-agent.ts` (`submit` / `confirmOmniAgentCommand` / `rejectOmniAgentCommand`); UI `components/omni-agent/OmniAgentInboxReal.tsx` | **A** (Omni operacional) / **B** (Contador) | Confirma execução de intent (OS, despesa, recebível, lembrete interno). **Não envia mensagem.** ACL: `p.workspace.omniAgent` + gate por módulo. `storeId` obrigatório. |
| Intents | `lib/omni-agent/types.ts`, `interpret.ts`, `executor.ts` | **A** / **B** | `OS_OPEN`, buscas, `REMINDER_CREATE` (grava `OmniAgentMemory` tipo `lembrete` + `LogsAuditoria`), financeiro, caixa. **Zero intent Contador.** Escritas sempre exigem confirmação (`omniAgentNeedsConfirmation` não pode reduzir). |
| Canal Omni | `lib/omni-agent/canal.ts` | **B** | Enum de **origem**: `texto_interno` \| `whatsapp` \| `voz`. Automações criam comando com `canal: "texto_interno"`. Não é provider de envio. |
| Automações Omni | `lib/omni-agent/omni-automation-engine.ts`, triggers `venda_finalizada` / `os_entregue` / `conta_receber_vencida` | **A** / **B** | Cria `OmniAgentCommand` **PENDENTE**. Defaults `enabled: false`. Sem trigger fiscal/contador. |
| Event bus | `lib/events/event-bus.ts` + `lib/automation/automation-engine.ts` + `POST /api/automation/handle-event` | **A** / **B** | Eventos: venda/OS/cliente/`conta_receber_vencida` (este último sem emissor universal). **Não** emite `ContadorEvento`. |
| Automações WhatsApp `system_event` | `handleEvent` → `sendWhatsAppMessage` | **B** (e pé-armado) | `WHATSAPP_SYSTEM_EVENT_DELIVERY.mode = internal_record_only`, `sendsMeta: false`. Grava histórico WhatsApp da loja; **não chama Meta**. Destino = telefone de cliente/gestor no HUB WhatsApp, não contador. |
| Envio Meta real | `POST /api/whatsapp/send` → `sendCloudApiTextAndRecord` / template / media | **A** (WhatsApp HUB) / **B** (Contador) | Ver §3. |
| Keyword automation | `WHATSAPP_KEYWORD_AUTOMATION_DELIVERY` | **C** | `simulation_only`, sem Meta. |
| WhatsApp IA (catálogo/orçamento) | `lib/whatsapp/whatsapp-intent-classifier.ts` etc. | **A** (sugestão) | `requiresHumanApproval=true`, `safeToAutoSend=false`. Operador/cliente, não Contador. |
| Auditoria Omni | `lib/omni-agent/audit-log.ts` → `LogsAuditoria` (`source: omni_agent` / `omni_agent_automation`) | **A** | `storeId` no JSON metadata. Não é `ContadorEvento`. |
| Config Omni | `OmniAgentConfig` por loja | **A** / **B** | Tom, horário, `defaultChannel`, `extraConfirmIntents`. Sem destinatário contador. |
| Memória Omni | `OmniAgentMemory` | **B** | Lembrete interno do operador. Não notifica o contador externo. |
| Telegram / e-mail / SMTP | — | **C** (ausente) | `package.json` sem nodemailer/resend/sendgrid/telegram. |
| `lib/contador/notificacoes/**` | — | ausente | 017 ainda não existe. |

**Não tocar Omni Core no 017** além de um contrato documentado (`docs/contador/OMNI_AGENT_CONTRATO_017.md`).

---

## 3. Canal de saída

**`EXTERNAL_CHANNEL_EXISTS=true`**

Existe um canal externo **real** no produto: WhatsApp Cloud API (Meta), por loja.

| Campo | Valor |
|---|---|
| Canal | WhatsApp Cloud API (texto / template / mídia) |
| Provider | Meta Graph, credencial **por loja** (`WhatsAppPhoneNumber.tokenEnvKey` → env; token nunca no DB; ADR-0006) |
| Função / API | `POST /api/whatsapp/send` → `sendCloudApiTextAndRecord` / `sendCloudApiTemplateAndRecord` / `sendCloudApiMediaAndRecord` (`lib/whatsapp/whatsapp-service.ts`). Helper irmão `sendWhatsAppMessage` **não** envia Meta. |
| Autenticação | NextAuth (`guardWhatsAppApiWrite` / `requireWhatsAppApiSession`). Sem sessão → 401. |
| Store scope | `x-assistec-loja-id` (ou query). Sem loja → 403. Sem fallback `loja-1`. Credencial resolvida por `storeId`. |
| Gate de permissão | Sessão + loja. **Não** exige `p.hubs.contador`. É gate do WhatsApp HUB, não do Contador. |
| Confirmação humana | Clique do operador autenticado na inbox WhatsApp. **Não** há primitive rascunho→aprovar→`mensagem_enviada` com `confirmadaPor`. |
| Auditoria | Mensagem Prisma (`externalMessageId`/wamid) + `LogsAuditoria` se credencial ausente. Não grava `ContadorEvento`. |
| Erro | 400 com mensagem; envio bloqueado se loja sem número/token (fail-closed, sem fallback global). |
| Idempotência | wamid da Meta após o fato. **Sem** chave de dedupe do Contador. Retry do POST pode duplicar no Graph. |
| Risco de duplicata | Alto se o 017 reusar este POST. Destinatário = `conversationId` de **contato WhatsApp** (cliente), não `ContadorUsuario`. |
| Destinatário contador | **Inexistente.** `ContadorUsuario` tem e-mail + senha; **sem telefone/WhatsApp**. |

**Não reutilizável com segurança para o 017** sem GOAL de canal dedicado (mapeamento contador↔conversa, template Meta, janela 24h, permissão `hubs.contador`, confirmação + `mensagem_enviada`, idempotência).

E-mail/Telegram: **não existem**.

---

## 4. Gate humano (rascunho → aprovação → envio → audit)

**Primitive equivalente para mensagem do Contador: não existe.**

O que existe e **não** substitui:

| Primitive | Fluxo | Por que não serve ao 017 |
|---|---|---|
| Omni inbox | comando `PENDENTE`/`AGUARDANDO_CONFIRMACAO` → `confirm` executa intent | Executa OS/financeiro/lembrete interno. Não envia texto ao contador. Confirmar um comando gerado por automação **não** é “enviar rascunho”. |
| WhatsApp send | operador envia na conversa | Destino cliente; sem rascunho Contador; sem evento `mensagem_enviada`. |
| Divergência 012 | GET preview / POST grava evento | Confirmação humana de **auditoria interna**, não de envio. Padrão a copiar: leitura não grava; escrita explícita + dedupe. |
| Portal 015 | conferir / confirmar recebimento | Ações do contador **no portal**, não push outbound. |

**Regra inegociável do 017:** nenhuma mensagem sai só porque a regra disparou. Sem canal aprovado, **não propor envio automático**.

`HUMAN_CONFIRMATION_GATE_EXISTS=false` (para o contrato rascunho→envio).  
Há confirmação humana **em outros domínios** (Omni comandos, divergência POST).

`AUDIT_TRAIL_EXISTS=true` no domínio Contador (`ContadorEvento` append-only) e no Omni (`LogsAuditoria`). Falta o tipo `mensagem_enviada`.

---

## 5. Classificação do canal

**`CHANNEL_CLASSIFICATION=B`**

Canal externo existe (WhatsApp Cloud real), mas **falta gate/contrato suficiente** para o Contador (destinatário, permissão, confirmação auditada, idempotência, isolamento do inbox de cliente).

Não é A (reuso seguro). Não é C (o send Meta é real). Não é D como bloqueio prévio: a ambiguidade `sendWhatsAppMessage` vs `sendCloudApi*` está **documentada**; o 017 simplesmente **não chama nenhum dos dois**.

Consequência obrigatória do roadmap (B/C/D):

A primeira implementação do 017 limita-se a:

- alertas internos;
- central de avisos no HUB;
- rascunhos pt-BR;
- contrato documentado para o Omni Agent;
- **zero envio externo**.

`EXTERNAL_SEND_IN_017_ALLOWED=false`

---

## 6. Arquitetura mínima proposta para o 017

Regras **puras**, avaliadas **sob demanda** (carregar HUB + `GET` idempotente). Sem cron neste GOAL. Sem schema.

```
lib/contador/notificacoes/
  tipos.ts          — AlertId, RegraId, limiares (constantes), DedupeKey
  limiares.ts       — docPendenteDiasAntesFechamento, guiaVenceEmDias (default 7),
                      competenciaAbertaAposDia, flags booleanas
  regras.ts         — (estado + agora) → alerta tipado | null  [puro]
  avaliar.ts        — orquestra leituras já existentes + dedupe via ContadorEvento
  rascunhos.ts      — texto pt-BR marcado RASCUNHO
  dedupe.ts         — chave + consulta alerta_emitido / tratado / suprimido
  sanear.ts         — allowlist de campos no DTO e no rascunho

app/api/contador/notificacoes/
  route.ts                 — GET lista avisos da competência (scope interno)
  [id]/tratar/route.ts     — POST → evento alerta_tratado
  [id]/rascunho/route.ts   — GET rascunho (nunca envia)

components/dashboard/contador/avisos/
  — central de avisos, copiar rascunho, marcar tratado
  — limiares só como copy/constantes na Configurações (sem persistir)

docs/contador/OMNI_AGENT_CONTRATO_017.md
```

**Não** criar `enviar/route.ts` no 017.

Limiares: constantes no módulo (override só por argumento de `avaliar`, para teste). Preferências persistentes por loja → **`SCHEMA_REQUIRED=true` e PARE** essa parte. Neste desenho: **`SCHEMA_REQUIRED=false`**.

Leituras a reusar (não duplicar): `listarDocumentos`, `listarAgenda` / `carregarResumoGuiasChecklist`, `acharCompetencia`, `avaliarDivergencia` (GET), manifesto do pacote da versão, `requireContadorScope`, `p.hubs.contador` onde já for o gate das rotas Contador.

Escrita: somente `ContadorEvento` (`alerta_emitido`, `alerta_tratado`, `alerta_suprimido`). Padrão de dedupe: espelhar `registrarEventoUnico` do 012 (lock da competência + `metadata` path).

---

## 7. Dedupe

Usar `ContadorEvento`, sem tabela nova.

**Chave:** `regraId + alvoId + storeId + competenciaId + janelaId`

- `janelaId` = dia civil SP para regras diárias, ou `diffHash` para `alteracao_pos_fechamento`, ou `AAAA-MM`+limiar para fechamento próximo.
- Gravar `alerta_emitido` com metadata allowlist: `regra`, `alvo`, `janela`, `competencia` (código), sem valor de guia, sem `storageRef`.
- Reavaliação na mesma janela: `findFirst` equivalente → não cria segundo alerta.
- `alerta_tratado` / `alerta_suprimido` na mesma chave → silencia reemissão **até nova janela válida**.
- Nova janela (novo dia, novo `diffHash`, competência seguinte) → nova emissão permitida.
- Cross-store: `storeId` na chave e no `where` de toda query.
- `alerta_emitido` e `mensagem_enviada` (reservado, **não emitido no 017**) cabem como string; **sem migration**.

Race: dois GETs paralelos podem duplicar sem lock. Reusar o `FOR UPDATE` na competência do 012 no caminho que **persiste** `alerta_emitido`. Avaliação pura (preview) pode não persistir; persistir só quando a central materializa o aviso (decisão de implementação: persistir no GET autenticado com dedupe forte, ou só ao “ver”/tratar — documentar no contrato; recomendação: persistir no GET da central com lock, como o POST de divergência, para a trilha existir).

---

## 8. Contrato do rascunho

```
marca:     RASCUNHO  (literal no topo do texto e no DTO `estado: "rascunho"`)
idioma:    pt-BR
ação:      copiar; humano decide se cola em e-mail/WhatsApp fora do sistema
envio:     proibido neste GOAL
```

Campos mínimos: loja (id técnico ou nome operacional já usado no HUB, sem PII de cliente), competência `AAAA-MM`, tipo do alerta, prazo/vencimento informado (data), identificador curto do alvo (id de documento/guia), microcopy “informado pelo responsável” quando vier da agenda.

**Proibido no rascunho:** valor de guia (default), cálculo de imposto, NCM/CST, XML, `storageRef`, URL assinada, token, e-mail/telefone/CPF/IMEI de cliente, snapshot bruto, diff de totais detalhado (no máximo “os totais oficiais divergem dos dados vivos”).

Nenhuma inferência fiscal. Nenhuma regra dispara `send*`.

---

## 9. Plano de testes proposto

Vitest, massa injetável (`agora` + fakes de repo). Sem rede, sem Meta.

1. Cada regra dispara com massa que a satisfaz.
2. Cada regra silencia sem a massa / com limiar não atingido.
3. Vencimento por janela (hoje, +7, +8; timezone SP).
4. Dedupe: segunda avaliação na mesma janela não cria segundo `alerta_emitido`.
5. Tratado suprime reemissão da mesma chave.
6. Nova janela válida reemite.
7. Cross-store: loja B não vê/emite chave da loja A.
8. Competência correta (`c=AAAA-MM`); competência fechada silencia “fechamento próximo”.
9. Dados sensíveis ausentes do rascunho (`storageRef`, valor, PII).
10. Sem canal → zero chamada a `sendCloudApi*` / `sendWhatsAppMessage` / fetch Graph (grep/teste de módulo sem import desses símbolos).
11. Regra nunca envia diretamente (funções de regra puras, sem IO de envio).
12. `alteracao_pos_fechamento` persistido gera alerta; GET divergente sem POST não inventa evento (pode mostrar preview interno se a UI já o faz).
13. Guia paga (`pagaEm`) deixa de gerar vencido/vencendo.
14. Documento `RESOLVIDO` / `CONFERIDO` não dispara “pendente”.
15. Checklist stale `documentos`/`fechamento_oficial` **não** é fonte do alerta.

Typecheck: `npm run typecheck`. ESLint dos caminhos novos. Build se houver rotas novas.

---

## 10. Charter sugerido — `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017`

Não executar `track.mjs import/open` nesta sessão. Texto para o humano colar no manifesto quando autorizar.

```
id: CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017
title: Alertas internos e rascunhos do Contador HUB (sem envio externo)
class: C2
risk_tier: MEDIO
dependencias: 012 DONE, 016 DONE
channel_classification: B
external_send_allowed: false
schema: NAO
gates_liberados: (nenhum de schema/auth/proxy)
```

**Objetivo:** avaliar sob demanda os sinais reais (documento pendente, fechamento próximo, guia vencendo/vencida, pacote com pendências do manifesto, `alteracao_pos_fechamento`), persistir dedupe em `ContadorEvento`, exibir central de avisos no HUB interno, gerar rascunho pt-BR marcado RASCUNHO, documentar contrato Omni. Zero envio Meta/e-mail/Telegram.

**Allowlist proposta:**

- `lib/contador/notificacoes/**`
- `lib/contador/__tests__/notificacoes*.test.ts`
- `app/api/contador/notificacoes/**`
- `components/dashboard/contador/avisos/**`
- `app/dashboard/contador/page.tsx` (somente gancho da central)
- `docs/contador/OMNI_AGENT_CONTRATO_017.md`
- `docs/status/MOCKS_TRACKING.md`

**Proibido:** `prisma/**`, `lib/omni-agent/**`, `lib/whatsapp/**`, `lib/automation/**`, `app/api/whatsapp/**`, `auth.ts`, `proxy.ts`, portal legado, envio externo, tabela de preferências.

**Critérios de aceite:**

- Central lista avisos da loja ativa × competência, com isolamento cross-store.
- Cada regra do §1 dispara e silencia conforme testes.
- Dedupe e “tratado” conforme §7.
- Rascunho RASCUNHO pt-BR sem dado sensível; botão copiar; **sem** botão enviar.
- Contrato Omni publicado; Omni Core intocado.
- Nenhuma inferência fiscal; microcopy de agenda “informado pelo responsável”.
- `MOCKS_TRACKING`: central real; canal externo explicitamente fora.

**Gates:** nenhum G-DADOS-SCHEMA. Sem G-AUTH (`proxy.ts` intocado). Aprovação humana **antes** de qualquer GOAL futuro de canal.

**Testes:** §9. Comando: `npm run typecheck` + vitest focado em `lib/contador/notificacoes` + rotas.

---

## 11. Relatório final da auditoria

```
CURRENT_MAIN=ac6345744618bca0ae098eed379b16196ca0c38d
AEP_STATUS=PAUSED current_goal=null next_goal=null .aep-active=absent
GOAL_016_DONE=true
GOAL_017_OPENED=false
CONTADOR_EVENT_SOURCES=documento(estado PENDENTE+vencido derivado); competencia(status+calendario); guia(016 vencendo/vencido derivado+guia_paga); pacote(manifesto.pendencias via competencia_fechada); alteracao_pos_fechamento(POST 012); obrigacao(016 complementar)
OMNI_AGENT_EXISTING_INFRA=inbox+confirm command (A/B); automations→PENDENTE (A/B); event-bus venda/OS (B); WhatsApp system_event internal_record_only (B); Meta send real no HUB WhatsApp (A/B); sem e-mail/telegram (C ausente)
EXTERNAL_CHANNEL_EXISTS=true
EXTERNAL_CHANNEL=WhatsApp Cloud API POST /api/whatsapp/send sendCloudApiTextAndRecord (inadequado ao Contador)
HUMAN_CONFIRMATION_GATE_EXISTS=false
AUDIT_TRAIL_EXISTS=true
CHANNEL_CLASSIFICATION=B
SCHEMA_REQUIRED=false
DEDUPE_STRATEGY=ContadorEvento tipo alerta_emitido chave (regra,alvo,store,competencia,janela); tratado/suprimido silencia até nova janela; lock FOR UPDATE na competência; tipos string sem migration
INTERNAL_ALERTS_READY=true
DRAFT_MESSAGE_CONTRACT=RASCUNHO pt-BR minimo sem valor/storageRef/PII/fiscal; copiar somente; humano obrigatorio antes de qualquer envio futuro
EXTERNAL_SEND_IN_017_ALLOWED=false
PROPOSED_ALLOWLIST=lib/contador/notificacoes/**; lib/contador/__tests__/notificacoes*.test.ts; app/api/contador/notificacoes/**; components/dashboard/contador/avisos/**; app/dashboard/contador/page.tsx (gancho); docs/contador/OMNI_AGENT_CONTRATO_017.md; docs/status/MOCKS_TRACKING.md
TEST_PLAN=ver §9
BLOCKERS=nenhum para alertas internos; envio externo bloqueado até GOAL de canal + destinatario ContadorUsuario + confirmacao auditada; checklist documentos/fechamento_oficial stale (não usar; não corrigir no 017 salvo autorização)
```

```
CONTADOR_017_CHANNEL_AUDIT_COMPLETE=true
READY_FOR_GOAL_017_IMPLEMENTATION_DECISION=true
```

`docs/ai/CURRENT_STATUS.md` **não** atualizado: nenhum módulo mudou de mock→real; o 017 permanece não iniciado.

---

Fim do Passo 0. PARE (implementação do 017).
