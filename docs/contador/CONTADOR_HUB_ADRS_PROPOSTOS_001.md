# CONTADOR HUB — ADRs PROPOSTAS

| Campo | Valor |
|---|---|
| GOAL de origem | CONTADOR-HUB-FABLE5-MASTERPLAN-001 |
| Data | 2026-07-11 |
| Status das ADRs | **001, 003, 004, 005, 006 — Accepted em 2026-07-19 (Gate G2)** · **002, 008 — Accepted em 2026-07-31 (Gate G3)** · **007 — Accepted em 2026-08-19 (Passo 0 fiscal; `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED`)** |
| Convenção | Ao aprovar, o GOAL correspondente muda o status para Accepted no mesmo branch e registra a data |
| Gate G2 | Aprovado por Rafael em 2026-07-19. Ajuste G2-05 (PII) registrado em ADR-006 e referenciado em ADR-004. Próximo: GOAL 009 somente após publicação validada deste arquivo em `main`. |

---

## ADR-CONTADOR-001 — Competência viva versus snapshot congelado

**Contexto.** O preview trata competência como estado React; o Financeiro já possui `FechamentoFinanceiro` com snapshot DRE e reabertura; o contador precisa de números estáveis após o envio, mas a operação continua viva (cancelamentos retroativos, correções).

**Opções.**
A) Sempre leitura viva (simples; números mudam depois do envio — inaceitável para entrega contábil).
B) Sempre snapshot (estável; obriga fechamento até para consulta e cria segunda verdade permanente).
C) **Híbrido:** leitura viva enquanto `aberta/enviada`; snapshot JSON + pacote versionado no fechamento; reabertura auditada incrementa versão; alterações operacionais pós-fechamento não editam o snapshot e geram evento `alteracao_pos_fechamento`.

**Decisão recomendada.** C.

**Consequências.** Snapshot vive em `ContadorCompetencia.snapshot` (+hash); UI distingue "vivo" de "oficial"; devolução conta na competência da devolução (não retroage); reprocessar exige reabrir.

**Riscos.** Divergência vivo×snapshot pode confundir sem UI clara; snapshot grande (mitigar: totais/contagens, não linhas).

**Não decidido.** Política de correção retroativa exigida pelo escritório contábil (reabrir sempre? nota de ajuste na competência seguinte?); prazo máximo de reabertura.

> **✅ Accepted — 2026-07-19 (Gate G2).** Decisão C (Híbrido) aprovada. Competência viva enquanto `aberta/enviada`; snapshot JSON imutável + pacote versionado no fechamento; reabertura auditada incrementa versão e preserva snapshot/pacote anteriores; alterações pós-fechamento geram evento `alteracao_pos_fechamento` sem mutar o snapshot. Pendências (não bloqueiam GOAL 009, bloqueiam GOAL 012): política de correção retroativa e prazo máximo de reabertura — decisão complementar antes do GOAL 012.

---

## ADR-CONTADOR-002 — Portal interno versus portal externo

**Contexto.** `/dashboard/contador` (interno, NextAuth) e `/contador` (legado, PIN global) coexistem; o legado monta providers do ERP e não tem identidade; a regra do GOAL preserva `/contador` e `/login-contador` até auditoria + autorização.

**Opções.**
A) Consolidar tudo no dashboard com "modo contador" (viola isolamento: contador externo dentro da sessão do ERP).
B) Evoluir o legado no lugar (herda PIN/providers/UX comprometidos).
C) **Separação total:** interno permanece em `/dashboard/contador`; portal v2 reconstruído como segmento isolado (layout/sessão/ACL próprios, zero providers do ERP); legado congelado e endurecido até substituição autorizada.

**Decisão recomendada.** C. O "modo contador" interno permanece apenas como preview de UX.

**Consequências.** Duas superfícies com um único domínio/readers por trás; `requireContadorScope()` com dois caminhos de sessão; retirada do legado só no GOAL 019 mediante G4.

**Riscos.** Duplicação de UI entre interno e portal (mitigar: componentes de leitura compartilhados sem providers).

**Não decidido.** Rota final do v2: reutilizar o caminho `/contador` após retirada do legado ou novo caminho (ex.: `/portal/contador`) — insumo do GOAL 013.

> **✅ Accepted — 2026-07-31 (Gate G3).** Decisão C (separação total) aprovada. **Emenda de rota do G3:** o portal v2 passa a ser oficialmente `/contador-externo` (páginas) + `/api/contador-externo` (APIs) — caminho novo; o legado `/contador` e `/login-contador` permanecem congelados e intactos até a retirada autorizada (G4 / GOAL 019). Gate de sessão externa no proxy fica para o GOAL 015 (páginas e handlers se autoprotegem por request até lá). Registro da emenda: proposta `docs/contador/CONTADOR_HUB_IDENTIDADE_CONVITE_014_SCHEMA_PROPOSAL.md` (GOAL CONTADOR-HUB-IDENTIDADE-CONVITE-014).

---

## ADR-CONTADOR-003 — Armazenamento e versionamento de documentos

**Contexto.** Não existe abstração documental geral: `FinancialAttachment` é anexo de transação (fileUrl/fileName, sem hash/storeId direto); fiscal guarda referências de XML/certificado. O HUB precisa de documento genérico com competência, categoria, autoria, hash e ciclo de vida.

**Opções.**
A) Estender `FinancialAttachment` (contamina domínio Financeiro; falta tudo: hash, categoria, competência, ACL, soft delete).
B) Storage novo dedicado ao contador (mais um provider para operar sem necessidade comprovada).
C) **`ContadorDocumento` próprio + provider de storage existente**, com paths namespaced `contador/{storeId}/{aaaa-mm}/{docId}`, hash sha256, MIME/tamanho validados, soft delete com motivo, substituição por `versaoDeId` (imutável: nada é sobrescrito), download só por endpoint autenticado com evento.

**Decisão recomendada.** C. O GOAL 010 audita o provider existente antes de escrever; se não houver provider utilizável, **para e pede aprovação**.

**Consequências.** `FinancialAttachment` e XML fiscal permanecem nos domínios de origem (adapters podem listá-los como fontes, sem migração); retenção/antivírus entram no GOAL 019.

**Riscos.** Provider existente pode não suportar streaming/escopo privado (descoberta do GOAL 010).

**Não decidido.** Provider definitivo; limites de tamanho por categoria; política de retenção por categoria; visibilidade default de documentos de funcionários (sensível/LGPD).

> **✅ Accepted — 2026-07-19 (Gate G2).** Decisão C aprovada: `ContadorDocumento` próprio + provider de storage existente, paths namespaced `contador/{storeId}/{aaaa-mm}/{docId}`, hash sha256, MIME/tamanho validados, soft delete com motivo, substituição por `versaoDeId`, download só por endpoint autenticado com evento. **Storage principal: Supabase Storage. Alternativa: Vercel Blob.** Escolha física final + limites por categoria + retenção por categoria ficam para o GOAL 010 (auditoria do provider) e GOAL 019 (retenção). Nenhum bucket criado neste gate. URL pública persistida proibida; download sempre por endpoint autenticado + `ContadorEvento`; signed URL curta (≤5 min) quando o provider exigir.

---

## ADR-CONTADOR-004 — Pacote do Contador e manifesto de arquivos

**Contexto.** O legado baixa CSV/XML montados no browser, sem manifesto, hash, versão ou trilha; o preview promete um "pacote" fictício. O pacote é o artefato de entrega ao escritório e precisa ser reproduzível e prova de conteúdo.

**Opções.**
A) Sempre sob demanda, nunca persistido (leve; sem prova do que foi entregue nem versões).
B) Sempre materializado (custo de storage; rigidez enquanto a competência está aberta).
C) **Híbrido:** sob demanda enquanto aberta (MVP, GOAL 008); materializado e versionado no fechamento (GOAL 012), com `manifest.json` (`omni.contador.pacote.manifest/v1`: fontes+filtros+contagens, arquivos com sha256/bytes, pendências, itens não disponíveis, avisos) dentro do ZIP **e** `ContadorPacote/PacoteItem` como índice consultável.

**Decisão recomendada.** C. Estrutura de pastas conforme §12 do masterplan; formatos: ZIP, CSV, MD/HTML de resumo, JSON de manifesto, XML original quando fiscal ativo.

**Consequências.** Diff entre versões via manifestos; confirmação de recebimento no portal referencia versão exata; regeneração pós-fechamento = nova versão auditada.

**Riscos.** Duplicidade manifesto×PacoteItem (aceita: um é o artefato portátil, o outro é índice de consulta/integridade); volume de storage (retenção no GOAL 019).

**Não decidido.** Inclusão de PDF de resumo (dependência de geração de PDF) vs MD/HTML no MVP; SLA de geração; dados pessoais de cliente nos CSVs (decisão LGPD de Rafael).

> **✅ Accepted — 2026-07-19 (Gate G2).** Decisão C aprovada: pacote híbrido (sob demanda enquanto aberta — MVP GOAL 008 já em produção; materializado e versionado no fechamento — GOAL 012). Manifesto `omni.contador.pacote.manifest/v1` dentro do ZIP **e** `ContadorPacote/PacoteItem` como índice consultável. `@@unique([competenciaId, versao])`; versões anteriores **preservadas** (nunca sobrescritas); supersessão = nova versão auditada. Hash por arquivo (sha256) + `manifestoHash` (sha256 do manifest.json canônico) em `ContadorPacote`. **Ajuste G2-05 (PII) aplicado aqui:** dados pessoais de cliente (CPF, nome, telefone, e-mail, endereço, IMEI, observações) **não incluídos por padrão** nos CSVs do pacote. **Não criar toggle automático de PII no GOAL 009.** Inclusão futura de CPF/nome em CSV depende de decisão explícita posterior + permissão adequada + justificativa operacional/jurídica + registro de auditoria. Pendências: PDF de resumo vs MD/HTML (GOAL 012); SLA de geração (GOAL 019).

---

## ADR-CONTADOR-005 — Máquina de status e reabertura

**Contexto.** O GOAL original lista nove estados candidatos de competência e a máquina de item `pendente→enviado→conferido→resolvido` com "vencido" paralelo. Estados demais criam dupla verdade com o que já é derivável do checklist/timeline.

**Opções.**
A) Nove estados persistidos (expressivo; redundante e frágil — três deles são deriváveis).
B) Dois estados (aberta/fechada) (simples demais; perde o ciclo de conferência com o contador).
C) **Quatro estados persistidos de competência** — `aberta | enviada | com_pendencia | fechada` — com `reaberta` como transição (volta a `aberta`, `versao+1`, motivo obrigatório) e `em_preparacao/pronta_para_envio/em_conferencia/conferida` derivados de checklist, timeline e status de itens. Itens: `pendente→enviado→conferido→resolvido`; rejeição volta a `pendente` com comentário obrigatório; `vencido` = flag derivada.

**Decisão recomendada.** C.

**Consequências.** Transições com matriz de permissão (fechar/reabrir = elevada + confirmação + motivo + evento); UI mostra estados derivados sem persisti-los; efeitos do fechamento conforme ADR-001.

**Riscos.** Estados derivados exigem regras claras de exibição (documentar em `lib/contador/status.ts`).

**Não decidido.** Se "enviar" exige checklist mínimo completo ou apenas confirmação com pendências assumidas; quem pode marcar `conferido` internamente além do contador (proposta atual: papel financeiro).

> **✅ Accepted — 2026-07-19 (Gate G2).** Decisão C aprovada: **4 estados persistidos** (`aberta | enviada | com_pendencia | fechada`); `reaberta` é **transição auditada** (volta a `aberta`, `versao+1`, motivo obrigatório, permissão elevada, evento append-only, snapshot/pacote anteriores preservados) — **não é um quinto estado**. Estados derivados (`em_preparacao`, `pronta_para_envio`, `em_conferencia`, `conferida`) não persistidos. Itens: `pendente→enviado→conferido→resolvido`; rejeição volta a `pendente` com comentário obrigatório; `vencido` = flag derivada. Matriz de transição + permissões em `lib/contador/status.ts` (GOAL 011). Pendências (não bloqueiam GOAL 009): critério de "enviar" e quem marca `conferido` internamente — decisão no GOAL 011.

---

## ADR-CONTADOR-006 — Dados read-only versus persistência própria

**Contexto.** O legado agrega no cliente com heurísticas; o risco clássico é o HUB virar segunda fonte de verdade de vendas/caixa/contas/estoque/fiscal.

**Opções.**
A) Copiar dados para tabelas do contador (sincronização eterna; divergência garantida).
B) Ler tudo sempre vivo, sem persistir nada (sem estabilidade pós-envio; sem domínio próprio).
C) **Fronteira estrita:** readers/adapters server-side para todo dado operacional (nunca duplicado); persistência própria **somente** para o domínio do HUB (competência, documento, pacote, comentário, status, evento, obrigação, guia); snapshots apenas no fechamento, rotulados como oficiais; VIEWS agregadas só se um reader se provar caro (medido, não presumido).

**Decisão recomendada.** C. A tabela regra-de-data-por-fonte (§7 do masterplan) é o contrato dos readers; a heurística dia/valor do legado é substituída por vínculo explícito de domínio ou por relatório separado de OS.

**Consequências.** Todo número do HUB é reconciliável com a origem; correções operacionais fluem automaticamente enquanto a competência está aberta.

**Riscos.** Performance de agregação em lojas grandes (mitigar com índices existentes; medir antes de criar VIEW/cache).

**Não decidido.** Fonte canônica de "forma de pagamento" (payload da venda × `MovimentacaoFinanceira`) e de "despesas" (categorização) — descobertas do GOAL 006 a registrar aqui.

> **✅ Accepted — 2026-07-19 (Gate G2).** Decisão C aprovada: fronteira estrita — readers/adapters server-side para todo dado operacional (nunca duplicado); persistência própria **somente** para o domínio do HUB (competência, documento, pacote, comentário, status, evento, obrigação, guia); snapshots apenas no fechamento, rotulados como oficiais. GOAL 006 já implementou esta fronteira em `lib/contador/readers/*` (read-only, escopado por `storeId`, multi-loja, sem escrita). Fonte canônica de "forma de pagamento" resolvida defensivamente no código (lê `Venda.payload.paymentBreakdown` com reconciliação contra `Venda.total`); "despesas" depende de categorização (GOAL futuro).
>
> **🔹 Ajuste G2-05 (PII) — aprovado por Rafael em 2026-07-19:**
> - **Minimização conservadora obrigatória.** CPF, nome de cliente, telefone, e-mail, endereço, IMEI e observações **não serão incluídos por padrão** no domínio do Contador, nos eventos ou no pacote.
> - **Não criar toggle automático de PII no GOAL 009.** Nenhum campo/flag/enum de PII entra no schema núcleo.
> - **Inclusão futura de CPF ou nome em CSV** dependerá de: (a) decisão explícita posterior de Rafael; (b) permissão adequada (`p.hubs.contador` dedicada — aprovada para criação futura); (c) justificativa operacional/jurídica documentada; (d) registro de auditoria (`ContadorEvento`).
> - Esta regra **vincula ADR-004** (pacote) e **ADR-005** (eventos): o manifesto e os CSVs do MVP atual já não carregam PII de cliente; o `ContadorEvento.metadata` é saneado (sem payload bruto, sem documento, sem PII, sem token, sem stack).
> - IDs técnicos (id de cliente, id de OS, id de venda) são suficientes para reconciliação com as fontes originais.

---

## ADR-CONTADOR-007 — Integração desacoplada com Fiscal

**Contexto.** Fundação fiscal existe (`NotaFiscal`, eventos, logs) mas o runtime está parcialmente dormente/default-off. O preview promete "Notas fiscais (XML)" sem lastro.

**Opções.**
A) Acoplar o HUB ao motor fiscal (herda instabilidade e responsabilidade jurídica indevida).
B) Ignorar fiscal até homologação total (perde o artefato mais valioso quando existir).
C) **Contrato read-only `fiscalReader` atrás de `CONTADOR_FISCAL_READER` (por loja):** lista somente status juridicamente entregável (critério definido no GOAL 018 junto à trilha fiscal), sinais de rejeição/cancelamento no checklist, XML autorizado no pacote com hash; enquanto dormente, `nao_disponivel` explícito.

**Decisão recomendada.** C. O HUB jamais emite, calcula tributo ou altera dados fiscais; a `estimativaImposto()` do legado nunca alimenta obrigação/guia.

**Consequências.** Zero dependência de deploy entre trilhas; a promessa visual do preview só vira entrega com flag ligada e loja homologada.

**Riscos.** Definição de "status entregável" tem nuance jurídica — decisão conjunta com a trilha fiscal, registrada aqui.

**Não decidido (histórico do Proposed).** Ambientes (homologação × produção) no mesmo pacote — **resolvido nesta fase** como `ENTREGAVEL_AMBIENTE=HOMOLOGACAO_ONLY_INITIAL_ROLLOUT` (Production no entregável exige decisão humana posterior, sem apagar a possibilidade futura); inclusão de eventos de inutilização no relatório **permanece fora** deste aceite.

> **✅ Accepted — 2026-08-19 (Passo 0 fiscal).** Decisão C aprovada por Rafael. Fonte: auditoria [`CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md`](./CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md) (PR #88, merge `fac38130`) + aceite humano das DECISION_1–6. AEP: `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED` · trilha `contador` **PAUSED** · `current_goal=null`. Nenhuma implementação do reader começa antes da escolha A/B (emenda 6).
>
> **Emendas do aceite:**
> 1. **Predicado entregável (DECISION_1, Opção A) nesta fase:**
>    `ENTREGAVEL_AMBIENTE=HOMOLOGACAO_ONLY_INITIAL_ROLLOUT`
>    ```
>    entregavel(nota) =
>        nota.storeId == scope.storeId
>    AND storeId ∈ allowlist
>    AND vigente == true
>    AND status == AUTORIZADA
>    AND protocolo presente
>    AND chaveAcesso presente
>    AND xmlAutorizado presente
>    AND dhEmi válido ∈ PeriodoUtc da competência
>    AND ambiente == HOMOLOGACAO
>    ```
>    `PRODUCTION_XML_ELIGIBLE=false` nesta fase. Nenhuma `NotaFiscal` com `ambiente=PRODUCAO` entra em `05-XML` no rollout inicial. A possibilidade futura de Production **não** é apagada: habilitar PRODUCAO no entregável exige **decisão humana posterior de rollout** — não alterar o predicado em silêncio.
> 2. **Cancelados (DECISION_2, política A):** XML de nota cancelada **fora** de `05-XML`; checklist/relatório podem listar canceladas. `xmlAutorizado` histórico permanece imutável (ADR-0018) e **não** entra no pacote enquanto a nota estiver `CANCELADA`.
> 3. **Data da competência (DECISION_3):** somente `dhEmi` extraído de `NotaFiscal.xmlAutorizado` (`infNFe/ide/dhEmi`). **Sem fallback** para `dataAutorizacao`, `createdAt`, snapshot da venda ou `dataEmissao` (coluna **inexistente**). `dhEmi` ausente/ilegível ⇒ a nota **não** é entregável.
> 4. **Flag e dois gates (DECISION_4 + DECISION_5):** `CONTADOR_FISCAL_READER` env, default off (valor exato `"on"`); allowlist de `storeId`; **não** reutilizar `fiscalEnabled`. `STORE_ALLOWLIST_REQUIRED=true`. `ENVIRONMENT_GATE_REQUIRED=true`. A allowlist **não** substitui o ambiente: allowlist responde **qual loja** pode usar o reader; `ambiente` responde **qual documento fiscal daquela loja** é elegível. Loja allowlisted pode ter histórico `HOMOLOGACAO` e `PRODUCAO` — **ambos os gates são obrigatórios**. Default operacional: loja-piloto `HOMOLOGACAO`.
> 5. **Homologação (DECISION_5):** ambiente/fixture **isolado** (`HOMOLOGACAO`); **nunca** Production para notas de teste nem XML de `PRODUCAO` no pacote nesta fase. Preparação: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md`](./CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md). Runtime vivo ainda **não** validável.
> 6. **Reader puro (DECISION_6) — aceite parcial:**
>    `CONTADOR_CAN_REUSE_FISCAL_XML_READER_AS_IS=false`
>    `FISCAL_READER_AS_IS_FORBIDDEN=true`
>    `FISCAL_PURE_READER_IMPLEMENTATION_CHOICE_REQUIRED=true`
>    `DECISION_6_ACCEPTED_SCOPE=proibido reutilizar readAuthorizedDocument as-is`
>    Ainda **pendente antes de escrever código:** (A) SELECT side-effect-free em `lib/contador/readers/fiscal.ts` **ou** (B) primitive Fiscal explicitamente no-log. **Não escolhido** neste aceite. Importar o 018 no futuro exige essa escolha + prova de zero `FiscalLog` no reader do Contador.
>
> **Ainda fora deste aceite:** eventos de inutilização no relatório; ligar a flag em Production; `GOAL_018_OPENED=true`; escolher A vs B do reader.

---

## ADR-CONTADOR-008 — Convite e autorização do contador externo

**Contexto.** Hoje: PIN único global com default `5678` e cookie literal `1`; nenhuma entidade de usuário externo, convite, vínculo com loja, expiração, revogação ou trilha. A auditoria proíbe usar isso como fundação.

**Opções.**
A) Manter PIN por loja (ainda sem identidade individual nem revogação real).
B) Reutilizar NextAuth/`User` interno com papel "contador" (mistura sessões e abre navegação do ERP ao externo).
C) **Identidade externa dedicada:** `ContadorUsuario` (email único, senhaHash com util forte já existente no repo se houver, `tokenVersion`), `ContadorConvite` (token hasheado, expiração, revogação, criadoPor), `ContadorAcesso` (vínculo usuário↔loja com papel `leitura|conferencia`, concessão/revogação auditadas); sessão em cookie próprio assinado, curto e rotativo; revogação imediata via `tokenVersion`; rate limit e eventos de login/acesso; MVP de convite por **link copiável** gerado pelo admin (sem dependência de provider de e-mail).

**Decisão recomendada.** C.

**Consequências.** Um contador atende N lojas com um único login e escopo verificado no servidor; revogar é instantâneo; toda sessão externa é atribuível.

**Riscos.** Link copiável depende do canal que o lojista usar para enviá-lo (mitigar: expiração curta + uso único + aceite exige e-mail correspondente).

**Não decidido.** E-mail automático (provider a escolher) vs link copiável permanente; MFA (recomendado como evolução no GOAL 019); SSO; recuperação de senha (fluxo mínimo no 014 ou adiado); agrupamento por Empresa/CNPJ acima de `storeId` (registrar aqui quando decidido).

> **✅ Accepted — 2026-07-31 (Gate G3).** Decisão C (identidade externa dedicada) aprovada, confirmando o §11.1 do GOAL 013. **Emendas do G3:** (1) convite por **link copiável** é o modelo do MVP — verificado que o repo não tem infra de e-mail; o token (32 bytes, base64url) é exibido **uma única vez** ao admin e só o sha256 hex é persistido; envio automático fica **não implementado** (registrado, sem envio falso); (2) a sessão externa combina **cookie HMAC ≤12h rotativo** (Web Crypto, chave derivada com separação de domínio de `CONTADOR_EXTERNO_SESSION_SECRET` — sem fallback, fail-closed 503) **com linha persistida revogável** verificada a cada request — são **4 models** (`ContadorUsuario`, `ContadorConvite`, `ContadorAcesso`, `ContadorSessaoExterna`), sendo a sessão persistida o único acréscimo estrutural sobre o §6.3 da auditoria (que previa 3), exigido pelo comando do GOAL; (3) papel padrão do convite = `leitura`; `conferencia` só por escolha explícita do admin; (4) recuperação de acesso é **administrativa** (revogar + novo convite) — self-service adiado. Registro: proposta `docs/contador/CONTADOR_HUB_IDENTIDADE_CONVITE_014_SCHEMA_PROPOSAL.md` (migration `0015_contador_identidade_externa`, domínio `lib/contador/auth-externa/**`, rotas `/api/contador-externo/**`, portal `/contador-externo/**`).

---

## Encerramento

**Gate G2 — aprovado em 2026-07-19 por Rafael.** ADRs 001, 003, 004, 005, 006 marcadas como Accepted acima, com data e emendas (ajuste G2-05 de PII em ADR-006, referenciado em ADR-004). Storage principal (Supabase Storage) e alternativa (Vercel Blob) aprovados com escolha física final no GOAL 010. Permissão dedicada `p.hubs.contador` aprovada para criação futura (antes do GOAL 010). Regras multi-loja/ACL, concorrência/idempotência, soft delete e estratégia de rollback da migration aprovadas.

**Pendentes (não bloqueiam GOAL 009):** política de correção retroativa e prazo máximo de reabertura (→ GOAL 012, já entregue); tabela final de retenção por categoria (→ GOAL 019); inutilização no relatório fiscal (fora do aceite da ADR-007); escolha A vs B do reader fiscal puro (gate do futuro 018). Critério jurídico de status entregável fiscal **ratificado** na ADR-007 em 2026-08-19. AEP: `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED`.

**Próximo gate:** **G4** antes do GOAL 019 (retirada do legado). **ADR-007 Accepted em 2026-08-19** — `GOAL_018_OPENED=false`. **G3 realizado em 2026-07-31:** ADRs 002 e 008 Accepted com as emendas registradas acima (rota oficial `/contador-externo`; identidade externa separada opção C; convite por link copiável; sessão persistida revogável + cookie HMAC ≤12h, 4 models).

**GOAL 009** (migration núcleo) só deve ser iniciado **após a publicação validada deste arquivo em `main`** e após o comando 9/19 ser preparado contra a base atual.
