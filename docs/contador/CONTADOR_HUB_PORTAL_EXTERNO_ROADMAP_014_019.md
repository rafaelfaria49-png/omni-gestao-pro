# CONTADOR HUB — ROADMAP TÉCNICO DOS GOALs 014–019

| Campo | Valor |
|---|---|
| Documento | Plano técnico registrado pelo GOAL 013 (auditoria) — **não autoriza execução** |
| Origem | `CONTADOR_HUB_FABLE5_MASTERPLAN_001.md`, `CONTADOR_HUB_IMPLEMENTATION_GOALS_001.md`, `CONTADOR_HUB_COMMANDS_001.md`, ADRs 002/007/008 e evidências da auditoria `CONTADOR_HUB_PORTAL_EXTERNO_AUDIT_013.md` |
| Data | 2026-07-31 |
| Regra | Nenhum GOAL abaixo foi iniciado. Nenhuma funcionalidade foi inventada além do masterplan; refinamentos vindos da auditoria estão marcados como **[auditoria-013]** e permanecem dentro do escopo já previsto. |

Estado AEP no registro: 014–019 **DRAFT** (fora do caminho quente, fora do ledger, não elegíveis). Cada GOAL só se torna READY por importação de manifesto com aprovação humana do respectivo gate.

---

## 014 — CONTADOR-HUB-IDENTIDADE-CONVITE-014 · Identidade, vínculo e convite

- **Objetivo:** criar a identidade externa dedicada (migration 2 aditiva: `ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`), o fluxo convite→aceite→login→revogação, a sessão externa revogável e a página mínima autenticada listando as lojas do escopo. Substitui o PIN global por identidade real — pré-condição absoluta do portal.
- **Escopo:**
  - Schema aditivo (somente blocos novos ao final de `prisma/schema.prisma`): os três models com campos/índices conforme §6.3 da auditoria (token hasheado, `tokenVersion`, `@@unique([usuarioId, storeId])`).
  - `lib/contador/auth-externa/**`: usuários, convites, sessão (cookie próprio HMAC ≤12h, rotativo, `tokenVersion`), rate limit de login (reuso do util do GOAL 003, endurecido para chave e-mail+IP — **[auditoria-013]**, P1-2).
  - Rotas `app/api/contador-externo/**`: convite (admin interno, permissão elevada), aceite, login, logout, sessão.
  - Telas mínimas do fluxo externo no caminho decidido no G3 (recomendado `/contador-externo`).
  - Seção Permissões do ERP: gerar convite (loja+papel+e-mail), listar convites (pendentes/expirados) com revogar, listar acessos ativos com revogar.
  - Ramo externo do `requireContadorScope()` (§7.1 da auditoria) com variante nominal externa do escopo.
  - Anti-enumeração em login/aceite (erro genérico + comparação sem early-return — **[auditoria-013]**, corrige o padrão de `auth.ts:28-32` no código novo, sem tocar o interno).
  - Recuperação de acesso: fluxo mínimo **ou** adiamento registrado — conforme resposta G3 (§11.3-3 da auditoria).
- **Arquivos/módulos prováveis:** `prisma/schema.prisma` (blocos novos), `prisma/migrations/<timestamp>_contador_identidade/**`, `lib/contador/auth-externa/**` + testes, `app/api/contador-externo/**`, telas externas (rota G3), `components/dashboard/contador/**` (somente seção Permissões), `.env.example` (`CONTADOR_EXTERNO_SESSION_SECRET`), `docs/status/MOCKS_TRACKING.md`.
- **Schema:** **SIM** — migration 2 aditiva. Exige autorização explícita de schema (gate G-DADOS-SCHEMA) e revisão do SQL por Rafael **antes** do push; janela coordenada por haver frentes paralelas.
- **Riscos:** alto (autenticação). Específicos: vazamento de token de convite em log/URL; enumeração de e-mail; sessão sem revogação efetiva se `tokenVersion` não for verificado por request; cookie interno aceito por engano em rota externa (G-7); rate limit ineficaz em serverless se ficar em memória (P1-2).
- **Testes (obrigatórios):** convite expira/uso único/revogado/hash-only; senha com política e hash forte (bcrypt ≥12, util existente); login errado → 401 genérico; 6ª tentativa → 429 + `Retry-After`; sessão adulterada/expirada → 401; `tokenVersion++` derruba sessão ativa; acesso a loja não vinculada → 403; **teste cruzado**: cookie interno/legado não autentica rotas externas e vice-versa (G-7); `npx tsc --noEmit`, ESLint dos caminhos, build.
- **Critérios de aceite:** ciclo convite→aceite→login→lista de lojas→revogação com sessão caindo imediatamente; token nunca persistido em claro nem logado; eventos de convite/login/acesso com `atorTipo` correto e IP/UA (**[auditoria-013]**, P1-3); diff restrito à allowlist; legado e NextAuth intocados.
- **Dependências:** 009 (schema núcleo), **013 concluído + G3 aprovado** (ADRs 002/008 Accepted).
- **Gate humano:** **G3 prévio** (pré-condição); revisão do SQL da migration antes do push; gate de protocolo G-DADOS-SCHEMA.

---

## 015 — CONTADOR-HUB-PORTAL-EXTERNO-READONLY-015 · Portal externo read-only

- **Objetivo:** portal externo v2 funcional atrás de `CONTADOR_PORTAL_V2` (default off): competências das lojas autorizadas, documentos com download auditado, pacotes por versão com confirmação de recebimento, comentários compartilhados e "marcar conferido" — em layout/sessão totalmente isolados do ERP.
- **Escopo:**
  - Segmento `app/contador-externo/**` (ou rota G3): layout próprio, páginas lojas/competências/competência/documentos/pacotes conforme §9 da auditoria (T1–T8), **zero providers do ERP**.
  - `lib/contador/portal/**`: consultas do portal sobre readers/serviços existentes; confirmação de recebimento idempotente (evento, sem tabela nova).
  - APIs `app/api/contador-externo/**` de dados (§8.2 da auditoria): somente leituras + confirmar/comentar/conferir/baixar.
  - Trecho novo e mínimo no `proxy.ts` para o segmento (gate de sessão externa de páginas; APIs seguem autoprotegidas) — **sem** selo de assinatura da loja (**[auditoria-013]**, P1-1).
  - `Cache-Control: private, no-store` em 100% das respostas do portal (G-9).
  - Pseudonimização de `atorId` interno e omissão de `storageRef` nas respostas do portal (**[auditoria-013]**, P2-2/P2-3).
  - Eventos com IP/UA em login, acesso negado, downloads, comentários, confirmações, conferências (**[auditoria-013]**, P1-3).
  - Provisão manual documentada: **CORS do bucket R2** somente se upload externo for aprovado; caso contrário registrada como pendência (P1-4).
- **Arquivos/módulos prováveis:** `app/contador-externo/**`, `lib/contador/portal/**` + testes, `app/api/contador-externo/**`, `proxy.ts` (trecho novo), `.env.example` (`CONTADOR_PORTAL_V2`), `docs/status/MOCKS_TRACKING.md`.
- **Schema:** **NÃO** (usa o domínio existente + migration 2 do GOAL 014).
- **Riscos:** alto (superfície externa). Específicos: vazamento cross-store por rota esquecida (G-1/G-3); import acidental de providers do ERP; URL assinada reutilizada dentro do TTL (G-4 — mitigado, janela documentada); cache indevido (G-9); papel `leitura` vendo ação de escrita na UI.
- **Testes (obrigatórios):** cross-store em **todas** as rotas/ações; usuário revogado no meio da sessão → próxima request cai; papel `leitura` sem ações de escrita (UI e servidor); confirmação idempotente por usuário+versão; download sempre gera evento com `atorTipo:"externo"` + IP/UA; flag off → segmento inacessível; **teste programático de imports proibidos** (nenhum arquivo do portal importa `operations-store`, `loja-ativa` ou providers do dashboard); typecheck/ESLint/build.
- **Critérios de aceite:** contador de teste opera 2 lojas autorizadas e é bloqueado numa terceira (página e API); legado intocado e funcional em paralelo; linguagem read-only e estados vazio/indisponível/revogado conforme §9; critérios §13.2 da auditoria verificados.
- **Dependências:** 012 (pacote/snapshot — há o que baixar/confirmar), **014** (identidade).
- **Gate humano:** aceite funcional de Rafael; gate de protocolo **G-AUTH** (trecho novo em `proxy.ts`); rollout por flag com decisão de ativação por ambiente.

---

## 016 — CONTADOR-HUB-OBRIGACOES-GUIAS-016 · Obrigações e guias

- **Objetivo:** agenda operacional 100% manual/informada (migration 3 aditiva: `ContadorObrigacao`, `ContadorObrigacaoTemplate`, `ContadorGuia`): CRUD com máquina de status do GOAL 011, `vencido` sempre derivado, instanciação explícita de templates por competência, guia com PDF/comprovante via documentos. **Zero cálculo fiscal** — rótulo permanente "informado pelo responsável".
- **Escopo:** schema aditivo (blocos novos); `lib/contador/agenda/**` (obrigações, templates, guias); rotas `app/api/contador/agenda/**`; seções Obrigações e Guias do HUB interno; sinal derivado "guias vencendo/vencidas" no checklist; eventos `obrigacao_criada/atualizada`, `guia_informada/paga`. Acesso do contador externo a esta agenda fica condicionado ao portal (015) e à matriz §15 do masterplan — não cria superfície nova além dela.
- **Arquivos/módulos prováveis:** `prisma/schema.prisma` (blocos novos), `prisma/migrations/<timestamp>_contador_agenda/**`, `lib/contador/agenda/**` + testes, `app/api/contador/agenda/**`, `components/dashboard/contador/**` (seções Obrigações/Guias), `lib/contador/fechamento/montar-checklist.ts` (somente novo sinal), `docs/status/MOCKS_TRACKING.md`.
- **Schema:** **SIM** — migration 3 aditiva. Mesma disciplina do 014: SQL revisado antes do push, janela coordenada, gate G-DADOS-SCHEMA.
- **Riscos:** médio. Específicos: qualquer valor calculado silenciosamente (proibido); `vencido` persistido por engano (deve ser derivado); instanciação automática de templates (deve ser ação explícita, idempotente por `(templateId, competenciaId)`).
- **Testes:** instanciação idempotente; dia inexistente no mês → último dia; template inativo não instancia; guia sem título/valor/vencimento → inválida; `vencido` derivado nos dois lados; matriz de status do 011 reutilizada; cross-store em todas as operações.
- **Critérios de aceite:** criar template → gerar do mês → registrar guia com PDF → marcar paga com comprovante → timeline e checklist refletem; zero valor fiscal fictício; estimativa legada intocada.
- **Dependências:** 011 (máquina de status), 010 (documentos para PDF/comprovante).
- **Gate humano:** janela de migration coordenada + revisão do SQL (padrão G2 já aprovado para migrations aditivas; gate de protocolo G-DADOS-SCHEMA).

---

## 017 — CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017 · Integração Omni Agent

- **Objetivo:** camada de notificação/lembrete consumindo `ContadorEvento` + agenda: documento pendente, fechamento próximo, guia vencendo, pacote com pendências (manifesto), `alteracao_pos_fechamento`; rascunho de mensagem ao contador com envio **sempre** confirmado por humano; tudo pelo gate de políticas com audit.
- **Escopo:** `lib/contador/notificacoes/**` (regras puras com limiares configuráveis, avaliação sob demanda + dedupe por evento `alerta_emitido`, rascunhos pt-BR marcados como RASCUNHO); central de avisos na UI do HUB; contrato documentado para o Omni Core (`docs/contador/OMNI_AGENT_CONTRATO_017.md`). **Passo 0 obrigatório:** verificar canal de saída existente; se não houver, entrega só alertas internos + contrato — **não criar integração externa sem aprovação**.
- **Arquivos/módulos prováveis:** `lib/contador/notificacoes/**` + testes, `app/api/contador/notificacoes/**`, `components/dashboard/contador/**` (central de avisos + config mínima), `docs/contador/OMNI_AGENT_CONTRATO_017.md`, `docs/status/MOCKS_TRACKING.md`.
- **Schema:** **NÃO** — dedupe via `ContadorEvento`; se uma tabela de preferências se mostrar necessária, **PARAR e propor** (não criar por conta).
- **Riscos:** médio. Específicos: envio autônomo sem confirmação (proibido); rascunho com dado sensível além do necessário; spam de alertas sem dedupe/janela; tocar código do Omni Core além de consumir contrato.
- **Testes:** cada regra dispara/silencia com massa adequada; dedupe por (regra, alvo, janela); marcar tratado suprime reemissão; sem canal → zero tentativa de envio em qualquer caminho.
- **Critérios de aceite:** um lembrete de ponta a ponta com trilha; nenhuma automação fora do gate/permissões; nenhuma inferência fiscal.
- **Dependências:** 012 (eventos de fechamento/pacote), 016 (agenda/guias).
- **Gate humano:** aprovação explícita de canal externo antes de qualquer envio; confirmação humana registrada por mensagem enviada (evento `mensagem_enviada { canal, confirmadaPor }`).

---

## 018 — CONTADOR-HUB-FISCAL-INTEGRATION-018 · Integração Fiscal

- **Objetivo:** `fiscalReader` read-only atrás de `CONTADOR_FISCAL_READER` (por loja, default off): notas da competência com status juridicamente entregável, sinais de rejeição/cancelamento no checklist, XML autorizados na pasta `05-XML` do pacote com hash no manifesto.
- **Escopo:** `lib/contador/readers/fiscal.ts` + testes; sinal fiscal do checklist (`nao_disponivel` → real quando flag on); inclusão de `05-XML` no builder do pacote (bytes originais do storage fiscal, sem transformação, sha256 no manifesto); relatório simples por status na UI. **Passo 0 obrigatório:** mapear campos reais de status/protocolo/XML no schema fiscal e obter de Rafael o predicado "entregável" por escrito, registrado na ADR-007.
- **Arquivos/módulos prováveis:** `lib/contador/readers/fiscal.ts`, testes, `lib/contador/fechamento/montar-checklist.ts` (somente sinal fiscal), `lib/contador/pacote/builder.ts` (somente pasta 05-XML), `components/dashboard/contador/**` (relatório simples), `.env.example` (`CONTADOR_FISCAL_READER`), `docs/status/MOCKS_TRACKING.md`.
- **Schema:** **NÃO** — consome o domínio fiscal existente em leitura.
- **Riscos:** médio (status jurídico). Específicos: expor rascunho/pendente/denegado como entregável; acoplar ao pipeline fiscal instável; ligar flag por default; nuance jurídica decidida sem a trilha fiscal.
- **Testes:** predicado com todos os status; flag off/runtime ausente → `nao_disponivel` + aviso no manifesto (sem pasta 05-XML); XML no ZIP byte-idêntico ao storage (hash confere); cross-store no reader.
- **Critérios de aceite:** pacote de loja homologada contém somente XML autorizados; contagens batem com a trilha fiscal; pipeline fiscal intocado; flag default off.
- **Dependências:** 012 + **runtime fiscal ativo/validável** em ao menos uma loja de homologação + **ADR-007 Accepted**.
- **Gate humano:** aprovação do predicado "entregável" (Passo 0) e da ADR-007; decisão de ligar a flag por loja/ambiente.

---

## 019 — CONTADOR-HUB-PRODUCTION-HARDENING-019 · Hardening de produção

- **Objetivo:** prontidão de produção e encerramento do legado: retenção/descarte por categoria, limites finais de upload, observabilidade (métricas/alertas do masterplan §22), revisão LGPD do pacote e do runbook (bases legais, direitos do titular, fluxo de incidente — §10 da auditoria), teste de carga da geração de pacote, e — **somente mediante G4** — retirada/redirecionamento do portal legado.
- **Escopo:** `lib/contador/retencao/**` (política por categoria em constantes — números decididos por Rafael antes do merge; job idempotente com dry-run obrigatório que descarta blobs soft-deletados e expira documentos além da retenção **sem apagar registro/evento**); limites/quota por categoria/competência; `lib/contador/observabilidade.ts` (métricas nomeadas; alertas documentados em runbook); revisão LGPD (minimização já default — **[auditoria-013]**: PII de cliente segue fora dos CSVs salvo decisão explícita futura com permissão adequada + justificativa + auditoria, conforme ajuste G2-05); script de carga (ex.: 20k vendas) com SLA observado; runbook `docs/contador/OPERACAO_CONTADOR_019.md` (inclui ROPA do portal, direitos do titular-contador, fluxo art. 48, checklist de produção — **[auditoria-013]**). **Com G4:** executar a decisão do 013 para o legado (desligar flag por default, redirect `/contador`→portal v2 ou remoção), atualizar proxy/rotas, comunicar no runbook.
- **Arquivos/módulos prováveis:** `lib/contador/retencao/**`, `lib/contador/observabilidade.ts`, `lib/contador/documentos/**` e `lib/contador/pacote/**` (limites/instrumentação), `app/api/contador/**` (instrumentação; endpoint do job protegido), `docs/contador/OPERACAO_CONTADOR_019.md`, `.env.example`, `docs/status/MOCKS_TRACKING.md`, script de carga em `scripts/`. **Somente com G4:** `app/contador/**`, `app/login-contador/**`, `app/api/auth/contador/route.ts`, `proxy.ts` (trecho contador), `lib/contador-aggregates.ts`.
- **Schema:** **NÃO** (retenção opera sobre dados; proibido tocar `prisma/**`).
- **Riscos:** médio. Específicos: descarte errado sem dry-run; afrouxar guard por engano; remover legado sem G4; retenção apagar trilha (proibido — dado some, trilha fica); métrica com dado sensível.
- **Testes:** retenção com massa dentro/fora da janela; dry-run não altera nada; idempotência; limites/quota no upload; métricas emitidas; com G4: rotas legadas respondem conforme decisão e rotas vizinhas intactas (smoke).
- **Critérios de aceite:** dry-run de retenção revisado; carga medida e registrada; checklist de produção do runbook assinado por Rafael; flags finais documentadas; nenhum guard afrouxado.
- **Dependências:** 015 (portal v2 no ar); idealmente 016–018.
- **Gate humano:** **G4** explícito para a retirada do legado; aprovação prévia dos números de retenção e das decisões LGPD do runbook.

### Decisões humanas registradas — Rafael, 2026-08-20 (pré-GOAL 019)

Estas decisões fecham as pendências que este documento reservava ao humano. O GOAL 019
**não está aberto**; isto é insumo de planejamento.

**G4 — APROVADO.** Legado encerrado por **redirect `/contador` → portal v2** (não remoção).
Destrava, no 019: `app/contador/**`, `app/login-contador/**`, `app/api/auth/contador/route.ts`,
trecho contador do `proxy.ts` e `lib/contador-aggregates.ts`.

**LGPD — APROVADO.** Manter a minimização atual: **sem PII de cliente nos CSVs**, conforme o
ajuste G2-05 (já default). Nenhuma inclusão de PII nesta fase.

**Retenção — números aprovados:**

| Alvo | Política aprovada |
| --- | --- |
| Documentos · `FISCAL`, `JURIDICO`, `FOLHA` | **Sem purga automática nesta fase** |
| Documentos · `FINANCEIRO`, `OUTRO` | **5 anos** |
| Pacotes gerados (ZIP de fechamento) | **12 meses** após a geração |
| Blob de documento soft-deletado | **90 dias** após `excluidoEm` |

Restrições que acompanham a aprovação:

- o job opera **primeiro em dry-run**;
- **nunca** apaga registro, evento ou trilha de auditoria — só conteúdo/blob elegível;
- o pacote é derivado e reconstruível a partir do snapshot congelado da competência, o que
  sustenta a janela de 12 meses.

Consequência de projeto: como `FISCAL` e `JURIDICO` ficam **sem purga**, a regra de *processo
pendente* do RICMS/SP art. 202 (ver [`../fiscal/FISCAL_XML_RETENTION_POLICY_001.md`](../fiscal/FISCAL_XML_RETENTION_POLICY_001.md),
§3) segue **automaticamente satisfeita** — o GOAL 019 **não** precisa construir marcador de
processo pendente no schema. Isso remove o único bloqueio estrutural que a purga finita traria.

Ponto em aberto para o runbook (não bloqueia o 019): decidir se algum documento
`FINANCEIRO` pode ser objeto de processo pendente antes de o job sair de dry-run para
descarte real. O piso legal de 5 anos analisado em `FISCAL_XML_RETENTION_POLICY_001.md`
trata do XML da NFC-e (coluna Postgres), não do blob `ContadorDocumento`.

---

## Grafo e regras finais

```
013 (esta auditoria) ──G3──> 014 ──> 015 ──G4(no 019)──> legado retirado
                              │        │
012 ──────────────────────────┴──015───┴──> 019
011 ──> 016 ──> 017            012 ──> 017 / 018
```

- Ordem de dependências: 014←(009,013+G3); 015←(012,014); 016←(010,011); 017←(012,016); 018←(012, fiscal ativo, ADR-007); 019←(015) + G4 para o Passo do legado.
- Regras transversais herdadas (COMANDOS §6): isolamento por worktree, stage por caminho, nunca push em main, todo reader/endpoint novo com teste cross-store, todo download com evento, nenhum segredo/URL assinada em log, ambiguidade material → parar e perguntar.
- Nenhum GOAL corretivo adicional foi criado por esta auditoria: os pontos P1–P3 mapeados foram absorvidos como requisitos de aceite dos GOALs já previstos.

— Fim do roadmap 014–019.
