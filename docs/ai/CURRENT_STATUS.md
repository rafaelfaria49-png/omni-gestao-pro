# OmniGestão Pro — Estado Atual do Projeto

> Última atualização: 21 Ago 2026 — **Contador HUB · DASHBOARD INTERNO HONESTO (`CONTADOR-HUB-INTERNAL-REALIFICATION-023`):** nenhuma fixture do HUB interno afirma mais estado da empresa do usuário. Saíram funcionários fictícios, escritório contábil de exemplo, razão social/CNPJ de exemplo, resumo financeiro e KPIs fabricados, progresso "3 de 9 / 35%", situação inventada por documento nos dossiês e o Radar CNPJ que dizia "certidão vencida" sobre um CNPJ nunca consultado. O aviso global stale — que negava envio, fechamento, guia e documento enquanto Documentos/Fechamento/Obrigações já eram reais — foi **removido**; o preview restante é identificado **no bloco**. **Folha & DP** virou a projeção dos documentos reais de categoria `folha` da competência (sem cálculo de folha, holerite, encargos, eSocial, ponto ou cadastro de colaborador; `RH_ENGINE_CREATED=false`), **Portal do contador** ganhou resumo real de acessos/convites pelos contratos do GOAL 014, **Configurações** lê o cadastro persistido da loja (`Store.name`/`cnpj`) e esconde o que não tem persistência, e **Dossiês** virou híbrida (itens `sistema` com correspondência inequívoca leem o DTO do GOAL 006). **Zero CTA no-op** sobrou. Exportação individual por relatório **não** foi implementada (exigiria nova superfície de API/auth; duplicar CSV é vedado) — o bloco aponta o arquivo equivalente dentro do Pacote. `SCHEMA_CHANGED=false` · `EXTERNAL_PORTAL_CHANGED=false` · `R2_CHANGED=false`. Anterior — 21 Ago 2026 — **Contador HUB · PORTAL V2 OPERACIONAL EM PRODUCTION:** storage real em Cloudflare R2 (bucket privado dedicado + CORS restrito ao domínio de Production), portal v2 **on**, portal legado **off**, `CONTADOR_RETENCAO_APPLY` **ausente**. Smoke autenticado real executado ponta a ponta com identidade de smoke dedicada (papel LEITURA, uma loja, **revogada ao final**): convite → aceite → sessão → escopo → competências → **escrita e leitura reais no R2 com SHA-256 conferido** → cross-store negado (403 sem vazamento) → isolamento de cookie nos dois sentidos → logout com invalidação server-side → revogação de sessão ativa → soft delete com trilha preservada. Pacote oficial **não disponível** (a v1 nasce no primeiro fechamento; fechar só para o teste é vedado). Corretivo de UI mergeado antes do smoke (PR **#104**, `ea1eaf6`): link de convite deixou de ser inalcançável quando o clipboard do navegador está bloqueado. `CONTADOR_PRODUCTION_SMOKE_PASS=true` · `CONTADOR_OPERATIONALLY_LIVE=true` · `PRODUCTION_RETENTION_APPLY_EXECUTED=false` · `SCHEMA_CHANGED=false`. Evidência: [`docs/contador/OPERACAO_CONTADOR_019.md`](../contador/OPERACAO_CONTADOR_019.md) §12. Anterior — 20 Ago 2026 — **Contador HUB · GOAL 018 FECHADO NA MAIN (`CONTADOR-HUB-FISCAL-INTEGRATION-018`):** integração fiscal read-only mergeada em `main` (PR **#97**, merge commit `870ed54`). Reader **A** + homologação **B**, flag `CONTADOR_FISCAL_READER` default off + allowlist env-only obrigatória, `dhEmi` fail-closed sem fallback. `FISCAL_RUNTIME_VALIDATABLE=true` · `PRODUCTION_XML_ELIGIBLE=false` · `SEFAZ_NETWORK_USED=false` · `SCHEMA_CHANGED=false`. AEP: GOAL 018 **DONE** · trilha `contador` **PAUSED** · `current_goal=null` · `GOAL_019_OPENED=false`. Anterior — **Fiscal · GOAL 030 PIX dinâmico YA04 (`FISCAL-030-PIX17-YA04-NONINTEGRATED-089`):** novas emissões NFC-e com PIX dinâmico (tPag 17) emitem `<card><tpIntegra>2</tpIntegra></card>` com evidência server-side. `tpIntegra=1`, ausente/inválido e legado 17 sem evidência são fail-closed. Estático 20 / automático 23 permanecem sem card. PaymentModal/Caixa/Financeiro intactos. Sem schema, sem SEFAZ. Classificação **A**. Detalhe: [`docs/fiscal/FISCAL_PAYMENT_PIX17_YA04_NONINTEGRATED_089_REPORT.md`](../fiscal/FISCAL_PAYMENT_PIX17_YA04_NONINTEGRATED_089_REPORT.md) · ADR-0023 (**aceita/vigente**, adendo 089). Anterior — **Fiscal · GOAL 030 POS não integrado (`FISCAL-030-CARD-POS-SIMPLE-TPINTEGRA-087`):** novas emissões NFC-e com cartão 03/04 emitem `<card><tpIntegra>2</tpIntegra></card>` com evidência server-side. `tpIntegra=1`, CNPJ/`tBand`/`cAut` e legado sem evidência são fail-closed. PaymentModal/Caixa/Financeiro intactos. PIX 17+YA04 permanece residual. Sem schema, sem SEFAZ. Classificação **A**. Detalhe: [`docs/fiscal/FISCAL_PAYMENT_CARD_POS_SIMPLE_TPINTEGRA_087_REPORT.md`](../fiscal/FISCAL_PAYMENT_CARD_POS_SIMPLE_TPINTEGRA_087_REPORT.md) · ADR-0023 (**aceita/vigente**, adendo 087). Anterior — **Operações V4 · Closeout dos blockers (`OPS-V4-BLOCKERS-FINAL-CLOSEOUT-018`):** V4 passou de **parcialmente implementada** para **operacionalmente fechada**. Os 7 blockers restantes (A-G) foram resolvidos: (A) persistência real de `OSStatusChange`/`OSTimelineEvent` via Server Actions; (B) `OsListItem.tecnico` agora usa `tecnicoNome` persistido; (C) `OSTimeline` e `OSKanban` leem eventos persistidos; (D) `OSDocuments` usa a API real de documentos; (E) `OSPrint` usa dados reais da OS; (F) `OSWhatsApp` envia via API real; (G) `OSNew` cria OS persistida. V4 é agora o motor operacional de produção. Anterior — **Fiscal · GOAL 030 PIX tPag 17 (`FISCAL-030-PIX-TPAG-17-DYNAMIC-085`):** novas emissões NFC-e com PIX dinâmico emitem `tPag=17` (sem YA04). PIX estático permanece `20`; PIX automático permanece `23`. Legado PIX sem evidência de tipo continua fail-closed. Caixa/Financeiro intactos. Sem schema, sem SEFAZ. Classificação **A**. Detalhe: [`docs/fiscal/FISCAL_PAYMENT_PIX_TPAG_17_DYNAMIC_085_REPORT.md`](../fiscal/FISCAL_PAYMENT_PIX_TPAG_17_DYNAMIC_085_REPORT.md). Anterior — **Fiscal · GOAL 030 PIX automático (`FISCAL-030-PIX-AUTOMATIC-TPAG-23-083`):** novas emissões NFC-e com PIX automático emitem `tPag=23`. PIX estático permanece `20`. Sem schema, sem SEFAZ. PIX dinâmico (`tPag=17`) permanece residual. Classificação **A**. Anterior — **Operações V4 no dashboard (`OPS-V4-DASHBOARD-SWAP-017`):** `/dashboard/operacoes` agora monta a V4 (fonte de verdade persistida). A V2 isolada permanece em `/dashboard/operacoes-v2` como legado. Sem persistência nova, sem schema, sem Server Actions novas. Classificação **A**. Anterior — **Contador HUB · GOAL 018 implementação fiscal read-only (`CONTADOR-HUB-FISCAL-INTEGRATION-018`):** reader **A** (`lib/contador/readers/fiscal.ts` SELECT Prisma, sem FiscalLog) + homologação **B**. Flag `CONTADOR_FISCAL_READER` default off + allowlist obrigatória env-only `CONTADOR_FISCAL_READER_STORE_ALLOWLIST`. Predicado ADR-007 com `dhEmi` fail-closed (corretivo, sem fallback). `FISCAL_RUNTIME_VALIDATABLE=true` · `PRODUCTION_XML_ELIGIBLE=false`. Revisão independente **A**. PR **#97** **MERGEADO** em `main` (merge commit `870ed54`). GOAL 018 **DONE** (`GOAL_018_CLOSED=true`). Anterior — **Fiscal · GOAL 030 PIX (`FISCAL-030-PIX-TPAG-20-082`):** novas emissões NFC-e com PIX emitem `tPag=20` (sem YA04). Caixa/Financeiro intactos. Sem schema, sem SEFAZ. PIX dinâmico (`tPag=17`) permanece residual. Classificação **A**. Anterior — **Operações V4 (`OPS-V4-OS-ENGINE-016`):** motor persistido da OS (Server Actions + `lib/operacoes/v4/`) implementado e validado. UI V4 (`components/operacoes/v4/`) pronta mas **ainda não** no dashboard — `/dashboard/operacoes` continua V2. Sem schema. Classificação **A**. Anterior — **Fiscal · GOAL 030 numerário (`FISCAL-030-NUMERARIO-TROCO-081`):** novas emissões NFC-e em dinheiro (`tPag=01`) com `cashTendered` válido passam a emitir `<vTroco>` no XML. Caixa/Financeiro intactos. Sem schema, sem SEFAZ. Classificação **A**. Anterior — **WhatsApp HUB (`WHATSAPP-REAL-PERSISTENCE-079`):** Inbox/Chat/Templates/Automations/Quick Replies/Broadcast **reais** (`storeId` + Prisma). Relatórios/Configurações **stub explícito**. Sem Meta Graph, sem schema. Classificação **A**. Anterior — **Fiscal · GOAL 030 crédito/vale (`FISCAL-030-CREDITO-LOJA-TPAG-21-080`):** novas emissões NFC-e com crédito da loja / vale-crédito passam a emitir `tPag=21`. Caixa/Financeiro intactos. Sem schema, sem SEFAZ. Classificação **A**. Anterior — **Fiscal · GOAL 030 carnê/a prazo (`FISCAL-030-CARNE-APRAZO-FAILCLOSED-077`):** carnê e a prazo **bloqueados** na emissão NFC-e (`PAGAMENTO_CARNE_NAO_SUPORTADO` / `PAGAMENTO_APRAZO_NAO_SUPORTADO`). Caixa, Financeiro, OS e estoque intactos. Sem schema, sem SEFAZ. Classificação **A**. Anterior — **Fiscal · GOAL 030 contrato de pagamento (`FISCAL-030-PAYMENT-CONTRACT-075`):** contrato canônico de pagamento NFC-e documentado e testado. Emissão continua fail-closed para meios sem evidência. Classificação **A**. Anterior — **Estoque (`ESTOQUE-UI-INTEGRATION-074`):** Estoque HUB UI integrada ao backend persistido (`/dashboard/estoque`). Sem schema. Classificação **A**.

> Referência rápida para retomar o projeto ou fazer onboarding.

> **Entrada obrigatória de novos chats/agentes:** [`docs/ai/START_HERE.md`](./START_HERE.md) —
> leitura obrigatória + política do Neon centralizada lá (não duplicada aqui).

---

## Contador HUB — DASHBOARD INTERNO HONESTO · 21/08/2026

```
SECTIONS_TOTAL=11
REAL_COUNT_AFTER=8
HYBRID_COUNT_AFTER=3
PREVIEW_COUNT_AFTER=0
GLOBAL_NOTICE_STALE_REMOVED=true
FECHAMENTO_PREVIEW_PILL_REMOVED=true
DOCUMENT_BADGE_REAL_OR_REMOVED=removed
FOLHA_FAKE_EMPLOYEES_REMOVED=true
FOLHA_DOCUMENTOS_REAL=true
RH_ENGINE_CREATED=false
PORTAL_FAKE_OFFICE_REMOVED=true
PORTAL_REAL_SUMMARY=true
CONFIG_FAKE_COMPANY_REMOVED=true
CONFIG_PERSISTENCE_CREATED=false
DOSSIES_SYSTEM_REALIFIED=true
DOSSIES_PREVIEW_REMAINDER_HONEST=true
REPORT_EXPORT_REALIFIED=false
DEAD_FIXTURES_REMOVED=7
SCHEMA_CHANGED=false
EXTERNAL_PORTAL_CHANGED=false
R2_CHANGED=false
```

**Classificação das 11 seções.** REAL (8): Fechamento, Documentos, Obrigações, Permissões
& acesso, Timeline, Folha & DP, Portal do contador, Configurações. HÍBRIDA (3): Visão geral,
Relatórios, Dossiês — todas com o bloco preview identificado localmente. PREVIEW total: nenhuma.

**O que era enganoso e saiu.** `FOLHA_FUNCIONARIOS` (Ana Souza / Carlos Lima / Marina Reis),
pró-labore com nome de sócio e holerite ilustrativo; o cartão "Escritório Contábil Exemplo ·
acesso somente leitura · ativo" do Portal; "Loja Exemplo Ltda" / "00.000.000/0001-00" nas
Configurações; `RESUMO_FINANCEIRO` (R$ 48,2k de vendas etc.) renderizado **ao lado** do resumo
REAL da mesma competência; `VISAO_KPIS`; `VISAO_DOSSIE_PROGRESS` e o anel "3 de 9 / 35%";
o `status` fabricado por linha de dossiê; o Radar CNPJ com "CND Federal válida" / "Alvará
vencido" / "2 pendências e-CAC"; o badge numérico `4` da aba Documentos; e o `GlobalPreviewNotice`,
cujo texto afirmava «Nenhum envio, fechamento, guia ou documento é processado» — falso desde os
GOALs 010/012/016. Fixtures mortas apagadas (grep = zero consumo produtivo): `VISAO_ALERTAS`,
`OBRIGACOES_ROWS`, `FECHAMENTO_CHECKLIST`, `DOCUMENTOS_ROWS`, `PERMISSOES_ROWS`, `MESES`,
`COMPETENCIA_INICIAL`.

**O que virou real.** **Folha & DP** (`components/dashboard/contador/folha/`) lista os documentos
de categoria `folha` da competência via `GET /api/contador/documentos?c=…&categoria=folha`, com
download autorizado por URL assinada, estados de carga/vazio/erro e microcopy explícita sobre o
que fica fora (cálculo de folha, holerite, encargos, eSocial, ponto, cadastro de colaborador).
**Portal do contador** (`components/dashboard/contador/portal/`) resume o acesso externo pelos
mesmos contratos da aba Permissões (`/api/contador-externo/acessos` + `/convites`): ativos,
convites pendentes, suspensos, revogados, papel e data — com 403 dito como "não é seu para ver",
nunca como "nenhum contador". A lista «o contador pode» foi corrigida: o portal v2 **não** recebe
upload. **Configurações** exibe `Store.name`/`Store.cnpj` da loja ativa por um reader server-side
escopado (`lib/contador/readers/loja.ts`) — sem endpoint novo, sem schema novo — e **oculta** os
controles sem persistência. **Dossiês** virou híbrida: itens de origem `sistema` com correspondência
inequívoca no DTO do GOAL 006 (fluxo realizado, contas a pagar, contas a receber, formas de
pagamento) mostram o valor real **com a disponibilidade que o próprio DTO declara**; os demais
dizem "sem fonte no OmniGestão nesta fase". `anexar` ganhou CTA real para Documentos; `portal` e
`solicitar` perderam o botão e viraram instrução.

**Zero CTA no-op.** O helper `noop`, o toast honesto e a constante `CTA_INDISPONIVEL_TITLE` foram
removidos por falta de call site. O único `disabled` restante é o do Pacote do Contador, condicionado
a haver dado real — não a "fase".

**Pendência declarada.** `REPORT_EXPORT_REALIFIED=false`: gerar o CSV individual de um relatório
reusando o gerador do Pacote exige nova superfície de API/auth sobre o endpoint endurecido
`GET /api/contador/pacote` (hoje só devolve o ZIP inteiro), e duplicar a lógica de CSV é vedado.
O bloco assume isso e aponta o arquivo equivalente dentro do pacote; "Posição de estoque" fica
marcado como **sem fonte** (o DTO do Contador não lê Estoque).

---

## Contador HUB — PORTAL V2 OPERACIONAL EM PRODUCTION · 21/08/2026

```
CONTADOR_PORTAL_V2_PRODUCTION_ACTIVE=true
CONTADOR_LEGACY_DISABLED=true
CONTADOR_INFRA_PRODUCTION_READY=true
R2_PRODUCTION_READY=true
R2_BUCKET_PRIVATE=true
R2_CORS_RESTRITO_A_PRODUCTION=true
R2_RUNTIME_WRITE_PASS=true
R2_RUNTIME_READ_PASS=true
SMOKE_DOWNLOAD_BYTES_MATCH=true
SMOKE_DOWNLOAD_HASH_MATCH=true
AUTHORIZED_STORE_PASS=true
CROSS_STORE_BLOCK_PASS=true
COOKIE_ISOLATION_PASS=true
LOGOUT_PASS=true
REVOCATION_PASS=true
ACTIVE_ACCESS_AFTER_SMOKE=false
SMOKE_DOCUMENT_SOFT_DELETED=true
AUDIT_TRAIL_PRESERVED=true
PACKAGE_DOWNLOAD_PASS=not_available
CONTADOR_PRODUCTION_SMOKE_PASS=true
CONTADOR_OPERATIONALLY_LIVE=true
CONTADOR_RETENCAO_APPLY=ausente
PRODUCTION_RETENTION_APPLY_EXECUTED=false
SCHEMA_CHANGED=false
```

**O que mudou de fato.** O Contador saiu de "infra provisionada" para **operacional**: o
portal externo v2 está no ar, o legado desligado, e o storage real em Cloudflare R2 foi
exercitado por escrita e leitura verdadeiras — não por checker. Um documento sintético foi
enviado pelo fluxo real do produto e baixado pelo portal externo com **bytes e SHA-256
idênticos**; a autorização de download devolve apenas URL assinada, sem expor `storageRef`.

**Achado que faltava no provisionamento.** Bucket R2 nasce **sem CORS**, e o upload do
Contador é direto do navegador para a URL assinada. Sem a regra de CORS o envio quebrava
como erro de rede genérico. Nenhum smoke sem sessão detecta isso — as rotas externas param
em 401 antes de tocar o storage. A regra aplicada é restrita ao domínio de Production.

**Segurança verificada em produção.** Loja não concedida responde 403 genérico, sem vazar
nome, competência, documento ou pacote. Isolamento de cookie provado nos dois sentidos:
sessão de contador não vira sessão de ERP, e sessão de ERP comprovadamente válida não vira
sessão de contador. Logout invalida no servidor (cookie reusado → 401), e revogação do
vínculo derruba sessão **ativa** na requisição seguinte. Soft delete preserva a trilha:
`documento_enviado` → `documento_download_autorizado` (ator externo) → `documento_excluido`.

**Pendências.** Pacote oficial ainda não existe — a v1 nasce no primeiro fechamento, e
fechar competência só para teste é vedado. Contadores ainda não foram comunicados da nova
URL. Existe um objeto órfão no bucket (upload cujo `complete` foi recusado), inerte e sem
registro no acervo, que a retenção desligada não remove. Detalhe operacional em
[`docs/contador/OPERACAO_CONTADOR_019.md`](../contador/OPERACAO_CONTADOR_019.md) §12.

---

## Contador HUB — GOAL 019 hardening de produção · 20/08/2026

```
RETENTION_POLICY_IMPLEMENTED=true
RETENTION_DRY_RUN_PASS=true
PRODUCTION_RETENTION_APPLY_EXECUTED=false
FISCAL_AUTO_PURGE=false
JURIDICO_AUTO_PURGE=false
FOLHA_AUTO_PURGE=false
FINANCEIRO_RETENTION_YEARS=5
OUTRO_RETENTION_YEARS=5
PACKAGE_RETENTION_MONTHS=12
SOFT_DELETED_BLOB_RETENTION_DAYS=90
AUDIT_TRAIL_PRESERVED=true
PII_IN_CSV=false
OBSERVABILITY_READY=true
LOAD_TEST_COMPLETED=true
LEGACY_REDIRECT_ACTIVE=true
PORTAL_V2_PRESERVED=true
SCHEMA_CHANGED=false
CONTADOR_RETENCAO_APPLY=off (não definida em nenhum ambiente)
CONTADOR_LEGACY_PORTAL=off (default INVERTIDO no 019; só "on" reabre o legado)
```

Política de retenção centralizada em `lib/contador/retencao/politica.ts` (calendário
civil UTC, não múltiplo de dias). Job idempotente em `lib/contador/retencao/job.ts`:
**dry-run é o modo padrão** e não recebe sequer a porta de escrita; `apply` exige
`CONTADOR_RETENCAO_APPLY=on` e falha fechado sem ela. O descarte atinge **apenas o
blob** — nenhum `DELETE` de `ContadorDocumento`, `ContadorPacote`, `ContadorPacoteItem`
ou `ContadorEvento`, e o snapshot congelado é intocável (pacote segue regenerável).
Idempotência ancorada na existência do objeto no storage.

Observabilidade em `lib/contador/observabilidade.ts` — 8 métricas nomeadas sobre o log
estruturado que já existia; labels com allowlist de chave **e** formato de valor
(slug iniciado por letra), que exclui `storageRef`, URL assinada, e-mail e
CPF/CNPJ/telefone com ou sem máscara.

**G4 executado (redirect, não remoção):** `/contador` e `/login-contador` redirecionam
para `/contador-externo/login`; `POST /api/auth/contador` responde 503. Nada foi
removido do repositório e o gate de sessão legado do `proxy.ts` ficou intacto como
caminho de rollback (`CONTADOR_LEGACY_PORTAL=on`). Portal v2 e `/dashboard/contador`
inalterados.

Carga sintética (sem banco): 20 000 vendas / 40 091 itens → pacote em **635 ms**, ZIP
de 1,21 MB, heap 62,3 MB, 0 falhas. **Não há SLA canônico** — resultado registrado, sem
threshold inventado. Runbook: [`docs/contador/OPERACAO_CONTADOR_019.md`](../contador/OPERACAO_CONTADOR_019.md).

**Pendências que bloqueiam o APPLY real** (não bloqueiam dry-run): decidir processo
pendente para `FINANCEIRO`/`OUTRO` e o soft-delete de blob `FISCAL` aos 90 dias.
`CONTADOR_PORTAL_V2` continua `off` por padrão — ligar junto com a comunicação do
encerramento do legado, senão as páginas de dados do v2 respondem 404.

---

## Contador HUB — GOAL 018 FECHADO NA MAIN (PR #97) · 20/08/2026

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
FISCAL_RUNTIME_VALIDATABLE=true
PRODUCTION_XML_ELIGIBLE=false
SEFAZ_NETWORK_USED=false
SCHEMA_CHANGED=false
CONTADOR_HUB_FISCAL_INTEGRATION_018=DONE
GOAL_018_CLOSED=true
GOAL_019_OPENED=false
CONTADOR_FISCAL_READER=off (default; liga só com valor exato "on")
CONTADOR_FISCAL_READER_STORE_ALLOWLIST=env-only CSV (sem schema)
```

Reader A em `lib/contador/readers/fiscal.ts` (SELECT `NotaFiscal` isolado por `storeId`; nunca `fiscalXmlReader.readAuthorizedDocument`; nunca grava FiscalLog/EventoFiscal). Checklist atualiza só o sinal fiscal. Pacote substitui `05-XML/LEIA-ME.md` apenas com XML entregável (texto UTF-8 persistido + sha256). UI: relatório fiscal mínimo somente leitura. Runtime homolog local (Postgres nativo 5432 nesta prova): 1 AUTORIZADA/HOMOLOGACAO entregável, 1 rejeitada, 1 cancelada; FiscalLog=0; EventoFiscal=0. Corretivo `dhEmi` fail-closed (competência só do XML autorizado, sem fallback). Revisão independente **A** (aprovada: `dhEmi` fail-closed, reader A, homologação B). PR **#97** **MERGEADO** em `main` — merge commit `870ed54841f42f42dbabe37268c3dd6e9e6708e7`. AEP: GOAL 018 **DONE** · trilha `contador` **PAUSED** · `current_goal=null` · `last_goal=CONTADOR-HUB-FISCAL-INTEGRATION-018` · `last_result=DONE`. GOAL 019 **não aberto** (`GOAL_019_OPENED=false`) — planejamento humano. Detalhe: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md`](../contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md).

---

## Contador HUB — Passo 0 fiscal FECHADO + ADR-007 Accepted · 19/08/2026

Auditoria [`CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md`](../contador/CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md) na main (PR **#88** merge `fac38130`). ADR-CONTADOR-007 **Accepted** (PR **#89** MERGED) com predicado Opção A **e** `ambiente == HOMOLOGACAO` (`ENTREGAVEL_AMBIENTE=HOMOLOGACAO_ONLY_INITIAL_ROLLOUT`; `PRODUCTION_XML_ELIGIBLE=false`), cancelados fora de `05-XML`, competência por `dhEmi` de `xmlAutorizado` **sem fallback**, flag `CONTADOR_FISCAL_READER` default off + allowlist de loja (não `fiscalEnabled`; allowlist **não** substitui o gate de ambiente), homologação isolada (nunca Production nesta fase; Production no entregável exige decisão humana posterior) e **proibição** de reusar `fiscalXmlReader.readAuthorizedDocument` as-is (`FISCAL_READER_AS_IS_FORBIDDEN=true`). Reader **A** e homologação **B** **ratificados** por Rafael (2026-08-20). Preparação: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md`](../contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md). Auditoria de prontidão: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md`](../contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_READINESS_AUDIT_018.md). Provisionamento B: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md`](../contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md). `FISCAL_RUNTIME_VALIDATABLE=false` (estado esperado **antes** do GOAL 018; é critério de **aceite**, não de import/open). `PRE_OPEN_NON_PRODUCTION_RUNTIME_REQUIRED=true`. `NON_PRODUCTION_RUNTIME_AVAILABLE=true` com Postgres local dedicado + seed HOMOLOGACAO. `GOAL_018_OPENED=true` (esta entrega). `GOAL_018_STATUS=RUNNING`. Trilha AEP `contador` **RUNNING** no GOAL 018. `current_goal=CONTADOR-HUB-FISCAL-INTEGRATION-018`.

---

## Contador HUB — Homologação B provisionada (sem GOAL 018) · 20/08/2026

Rafael autorizou merge do PR **#92** e o Postgres **efêmero/local** com seed HOMOLOGACAO. Reader = Opção **A** (`lib/contador/readers/fiscal.ts` SELECT read-only — **implementado no GOAL 018**). Homologação = Opção **B** (Prisma + Postgres local + 7 rows persistidas). DSN dedicado: host loopback, database `omni_contador_fiscal_homolog`, role `omni_homolog`, portas `54329`/`5432` — recusa db/role de dev e remoto. Sem Production, sem SEFAZ, sem `prisma/schema.prisma`. Massa em `homolog-contador-a` / `homolog-contador-b`. `PRE_OPEN_NON_PRODUCTION_RUNTIME_REQUIRED=true` · `NON_PRODUCTION_RUNTIME_AVAILABLE=true` · `FISCAL_RUNTIME_VALIDATABLE=true` (prova 018: Prisma → reader A → predicado → checklist → 05-XML). Detalhe: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md`](../contador/CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md).

---

## Contador HUB — GOAL 017 FECHADO NA MAIN (PR #85) · 19/08/2026

Central de avisos **REAL** na Visão geral. Sem botão Enviar. Canal classificação **B**. Contrato: [`docs/contador/OMNI_AGENT_CONTRATO_017.md`](../contador/OMNI_AGENT_CONTRATO_017.md). AEP: GOAL 017 **DONE** · trilha `contador` **PAUSED** · `current_goal=null`. `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED`.

---

## Contador HUB — Gate G2 APROVADO · Fase 0–2 (GOALs 001–011 em main) · 28/07/2026

> **Gate G2 aprovado por Rafael em 2026-07-19.** ADRs 001, 003, 004, 005, 006 marcadas como **Accepted** em [`CONTADOR_HUB_ADRS_PROPOSTOS_001.md`](../contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md) com data e emendas. Ajuste **G2-05 (PII)**: CPF, nome, telefone, e-mail, endereço, IMEI e observações **não incluídos por padrão** no domínio/eventos/pacote; **sem toggle automático no GOAL 009**; inclusão futura exige decisão explícita + permissão `p.hubs.contador` + justificativa + auditoria. Storage principal: **Supabase Storage** (alternativa: Vercel Blob; escolha física final no GOAL 010). Permissão dedicada `p.hubs.contador` aprovada para criação futura (antes do GOAL 010). **GOAL 009 somente após publicação validada deste fechamento em main.**

### Estado real (confirmado por código em `origin/main`)

| Bloco | Status | Evidência |
|---|---|---|
| Competência canônica `AAAA-MM` · tz `America/Sao_Paulo` · intervalo UTC semiaberto | ✅ real | `lib/contador/competencia.ts` (GOAL 005) |
| Readers read-only (vendas, financeiro, caixa) · multi-loja · ACL via sessão | ✅ real | `lib/contador/readers/*`, `lib/contador/scope.ts` (GOAL 006) |
| Visão Geral + relatórios básicos com dados reais | ✅ real | `app/dashboard/contador/page.tsx` (GOAL 006) |
| Checklist de fechamento derivado · "Fechar" desabilitado | ✅ real (RO) | `lib/contador/fechamento/montar-checklist.ts` (GOAL 007) |
| Pacote MVP sob demanda (ZIP + CSVs + manifesto v1 + sha256) · sem persistência | ✅ real (MVP) | `app/api/contador/pacote/route.ts` (GOAL 008) |
| Documentos reais · upload privado Cloudflare R2 (intent→PUT assinado→complete) · SHA-256 server · download assinado ≤300s · substituição versionada · soft delete · eventos | ✅ real | `lib/contador/documentos/*`, `app/api/contador/documentos/*`, `components/dashboard/contador/documentos/*` (GOAL 010) · permissão `hubs.contador` · requer bucket+secrets externos (`scripts/contador/setup-storage.mjs`) |
| Domínio persistido (Competencia, Documento, Comentario, Evento) | ✅ real | models `Contador*` no schema · **migration 0014** aplicada (GOAL 009) |
| Status do documento · máquina persistida com 5 transições · `conferido`/`resolvido` exigem papel financeiro ou administrador · rejeição com motivo obrigatório · `vencido` **derivado** (nunca persistido) | ✅ real | `lib/contador/status/*`, `app/api/contador/status` (GOAL 011) |
| Comentários `interna` × `compartilhada` por competência e por documento · corte de visibilidade na consulta e na projeção | ✅ real | `lib/contador/comentarios/*`, `app/api/contador/comentarios` (GOAL 011) |
| Timeline / atividade · projeção read-only de `ContadorEvento` + `ContadorComentario` · DTO com allowlist de metadata | ✅ real | `lib/contador/timeline/*`, `app/api/contador/timeline`, `components/dashboard/contador/timeline/*` (GOAL 011) |
| Fechamento oficial com snapshot + versão | ❌ não existe | GOAL 012 pendente — competência `FECHADA` já bloqueia transição de status (409) |
| Portal externo v2 | ❌ não existe | GOALs 013–015 pendentes (G3) — comentários `compartilhada` prontos, **sem consumidor externo** |
| Obrigações, Dossiês, Folha, Portal, Permissões, Configurações (UI) + cartões ilustrativos da Visão Geral | 🟡 preview | seguem rotuladas como Preview — aguardam GOALs 012–016 |

### Planejamento (série 001 — publicada em `docs/contador/`)

- [`CONTADOR_HUB_FABLE5_MASTERPLAN_001.md`](../contador/CONTADOR_HUB_FABLE5_MASTERPLAN_001.md) — masterplan Fable 5 (19 GOALs, 5 fases, gates G1–G4).
- [`CONTADOR_HUB_IMPLEMENTATION_GOALS_001.md`](../contador/CONTADOR_HUB_IMPLEMENTATION_GOALS_001.md) — sequência, dependências, riscos por GOAL.
- [`CONTADOR_HUB_COMMANDS_001.md`](../contador/CONTADOR_HUB_COMMANDS_001.md) — comandos prontos (1 por GOAL).
- [`CONTADOR_HUB_ADRS_PROPOSTOS_001.md`](../contador/CONTADOR_HUB_ADRS_PROPOSTOS_001.md) — 8 ADRs (001/003/004/005/006 Accepted G2; 002/008 Accepted G3; **007 Accepted 2026-08-19**; `GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED`).
- [`CONTADOR_HUB_DADOS_REAIS_READONLY_006.md`](../contador/CONTADOR_HUB_DADOS_REAIS_READONLY_006.md) — closure do GOAL 006.
- [`CONTADOR_HUB_STATUS_COMENTARIOS_011.md`](../contador/CONTADOR_HUB_STATUS_COMENTARIOS_011.md) — closure do GOAL 011 (inclui **Pendências da revisão**).

**Próximo:** GOALs 012–018 entregues. Gates: **G3** realizado (portal v2 + ADRs 002/008); **G4 APROVADO em 2026-08-20** — legado encerrado por redirect `/contador` → portal v2, a executar no GOAL 019. **ADR-007 Accepted** · GOAL 018 **DONE**. Decisões pré-019 (G4, LGPD e números de retenção) registradas em [`CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`](../contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md). GOAL 019 **não aberto**.

> **Ressalva de revisão (GOAL 011):** antes de integrar o portal externo (GOAL 015) é obrigatório filtrar também os **eventos** da timeline no contexto `compartilhado` — hoje só os comentários são cortados. Detalhe e demais pendências no documento de closure do GOAL 011.

---

## Fiscal — GOAL-005A FECHADO NA MAIN (PR #12 + PR #13) + GOAL-005B ESCOPO RATIFICADO (não iniciado) + GOAL-005 PARCIAL · 20/07/2026

> Fontes: [`FISCAL_RECONCILE_REPORT_001.md`](../fiscal/FISCAL_RECONCILE_REPORT_001.md) ·
> [`FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md`](../fiscal/FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md) ·
> [`FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md`](../fiscal/FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md) ·
> [`FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md`](../fiscal/FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md) ·
> [`FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_REPORT.md`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_REPORT.md) ·
> [`FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_POST_MERGE_CLOSURE.md`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_POST_MERGE_CLOSURE.md).
>
> **PR #8** merge `b307337…` (GOAL-004). **PR #12** merge
> `2a7f102ce7bb22b363cd6d24b17920d483182640` (GOAL-005A; parents `98e05df…` + `d512794…`;
> `merged_at` `2026-07-19T15:08:52Z`). `origin/main` contém `2a7f102…`.
> **G-C1/G-C2 fechados** (reconciliação + XSD). **Critério C14N/XMLDSig do F4→F5 = FECHADO**
> (GOAL-003). Gate Fiscal **global ABERTO** (inalterado). Sem homologação SEFAZ
> (N6=0), sem produção (N7=0), sem emissão ativada. Signer **dormente**. Callers produtivos **0**.
> GOAL-004 **FECHADO**. **GOAL-005A fechado na main** — run `29669361609`, commit `c0d4b00…`,
> artifact `8436826125` aprovado, lock integrado, Trivy 0/0, runtime offline, XSD 7/7.
> **PR #13** merge `a40ff5cbbed9eb3bf8f0764ba3b63e75f78bdcd6` (fechamento documental do 005A;
> parents `ab0b754…` + `55d578e…`) — é a `origin/main` corrente.
> **GOAL-005B: escopo RATIFICADO em 20/07/2026 (Caminho 2) — DEFINIDO DOCUMENTALMENTE, NÃO
> INICIADO**; ratificação ainda **pendente de integração** na `main`.
> GOAL-005 técnico **continua PARCIAL**. Contador HUB intocado.
> A ocorrência “NF-e — mock” em seções de preview PDV **não** descreve o estado global da frente
> fiscal.

### GOAL-004 — paridade fiscal do `upsertProduto` (Cadastros V2)

- **Estado:** **FECHADO** — implementação + merge commit + fechamento documental.
- **Equivalência histórica:** GOAL histórico **002 / P-04** (paridade `upsertProduto`); parcial
  prévio `04ce54d` (contrato + REST/importadores). **Não** renumerar docs históricos.
- **Arquivos (4):** `app/actions/cadastros.ts` · `produto-ia.tsx` ·
  `lib/produtos/produto-fiscal-upsert.ts` · `lib/produtos/produto-fiscal-upsert.test.ts`
  (+206 / −20).
- **`metadata.fiscal`:** **única fonte fiscal canônica** do Produto (10 campos do contrato
  `lib/produto-fiscal.ts` — **inalterado**): ncm, cest, cfop, cst, csosn, origemMercadoria,
  unidadeComercial, unidadeTributavel, codigoAnp, exTipi.
- **`metadata.fiscalRegime`:** namespace de **compatibilidade visual/textual** do Cadastros V2
  (`tributacao`, `origem`, `atualizadoEm`) — **não** canônico; **não** lido por
  `getProdutoFiscal`, motor Fiscal, APIs fiscais ou importadores; **não** autoriza emissão.
- **Comportamento:** create canônico; update sem fiscal preserva bloco; update parcial
  não-destrutivo; metadata não fiscal preservada; campos desconhecidos rejeitados; sem default
  tributário falso.
- **Barcode/Cosmos:** sugestões NCM/CEST sob **revisão humana** (não auto-confirmadas).
- **Schema / migration / regra tributária:** não alterados · nenhuma · nenhuma.
- **Nível N:** **N3** neste eixo cadastro; **N6=0**; **N7=0** (sem operação real / SEFAZ /
  homologação / produção).
- **Gates:** nenhum avançado por este GOAL (G-C1/G-C2/C14N inalterados; F4→F5 global, G-F5,
  G-F7, G-F12 abertos).
- **Checks do PR #8:** Vercel **success**; **sem** checks independentes de TypeScript, ESLint,
  testes unitários ou build no GitHub — evidências **reutilizadas da auditoria** de merge
  readiness (61/61 testes; TS/ESLint/build verdes).
- **Follow-ups (não implementados):** R-1 legado `fiscal.tributacao` → `fiscalRegime`; R-2
  exibição NCM/CEST via `getProdutoFiscal`; R-3 UI demais campos fiscais; R-4 status de
  completude fiscal; R-5 sem caller produtivo/transmissão sem GOAL específico.
- **Próximo passo:** auditoria documental de merge readiness deste fechamento; **não** iniciar
  GOAL-005 automaticamente.

### GOAL-005 — reconciliação de escopo (classe G → definido; técnico PARCIAL)

- **Auditoria formal:** `FISCAL-GOAL-005-FORMAL-EVALUATION` (branch
  `audit/fiscal-goal-005-formal-evaluation`, commit `f6d6f2a…`) — classificação **G — escopo
  ambíguo**. **Não** integrada à main (evidência).
- **Reconciliação:** `FISCAL-GOAL-005-SCOPE-RECONCILIATION` (16/07/2026) — resolve a colisão “005”.
- **Nome oficial:** slot nomeado 005 = **`FISCAL-DRY-RUN-INTEGRITY-PROOF-005`** — “Prova de
  Integridade do Dry-Run Fiscal” (rótulo provisório equivalente: `FISCAL-DRY-RUN-INTEGRITY-005`).
- **Colisão “005” separada (não renumerar histórico):** XSD histórico **cumprido** (GOAL nomeado
  002); rótulo de código `GOAL_005` snapshot **dormente** (componente/pré-requisito); Contador HUB
  competência = **trilho distinto** read-only; pendência P-05 (C14N) **fechada** (GOAL nomeado 003).
- **Estado do GOAL-005 técnico:** **PARCIAL** — definido documentalmente; prova de dry-run
  end-to-end **ainda não** entregue. Nenhum gate avançado; **N6=0**, **N7=0**; sem emissão/SEFAZ;
  signer dormente; callers produtivos 0.
- **Limites do futuro GOAL-005:** offline; fixtures sintéticas; sem caller produtivo/PDV/venda; sem
  SEFAZ/homologação/produção; sem certificado/CSC/idToken; sem regra tributária; sem
  schema/migration; sem tocar Contador HUB. Nível inicial N3; máximo N4 só no eixo integridade do
  dry-run.
- **Fonte:** [`FISCAL_GOAL_005_SCOPE_RECONCILIATION.md`](../fiscal/FISCAL_GOAL_005_SCOPE_RECONCILIATION.md).

### GOAL-005A — supply chain GHA do worker XSD (fechado na main) · 19/07/2026

- **Estado:** **integrado e fechado na main** (PR **#12** merged).
- **Merge:** `2a7f102ce7bb22b363cd6d24b17920d483182640` · head `d512794…` · branch origem
  preservada · método merge commit.
- **Run:** `29669361609` (#5) · `success` · 2/2 jobs · commit `c0d4b00e2f3aa93c7715d430a0f1c4d141abdb91`.
- **Artifact final:** `fiscal-xsd-worker-offline-approved-c0d4b00…` · ID `8436826125`.
- **Lock:** integrado · SHA-256 `5402dca9cf37cb1c0892cb4458be78fa9f360f69e9ad2440770d55ed340266e8`.
- **Evidências:** Trivy **0/0** · runtime offline · egress `blocked-enforced` · XSD **7/7**.
- **Gates:** gate Fiscal global **aberto**; N6=0; N7=0; nenhum gate alterado por 005A.
- **GOAL-005 técnico:** **PARCIAL** · Contador HUB: intocado.
- **005B:** definição/autorização separada **emitida** em 20/07/2026 — ver seção seguinte.
- **Relatórios:**
  [`005A REPORT`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_REPORT.md) ·
  [`005A POST-MERGE`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_POST_MERGE_CLOSURE.md).

### GOAL-005B — escopo ratificado (definido documentalmente, NÃO iniciado) · 20/07/2026

- **`main` contém o 005A:** `origin/main` = `a40ff5cbbed9eb3bf8f0764ba3b63e75f78bdcd6`
  (PR **#12** técnico + PR **#13** documental). Worker e lock presentes e conferidos.
- **005B auditado:** `audit/fiscal-dry-run-005b-formal-audit` @ `818253b…` — classificação **B**,
  por dois pendentes **documentais**: escopo não ratificado e harness fora da `main`.
- **Caminho 2 escolhido:** o **próprio 005B carrega o harness** (reaplicação consciente de
  `d4dfcf15b600bf46f51c347e99656800d1ec201a`); não há GOAL separado só para publicar o harness.
- **Compatibilidade comprovada:** os **10 contratos** que o harness importa são **byte-idênticos**
  entre `d4dfcf1` e a `main`; a `main` não alterou `lib/fiscal/**` nem `package.json` desde o
  merge-base `ccb8b0f`; a **única** ligação falsa é o composition-gate em `run.ts:45`. Nenhum
  schema, worker ou Prisma precisa mudar.
- **Harness:** **7 arquivos** sob `tools/fiscal-dry-run-integrity-proof/` (confirmados por
  `git ls-tree`), hoje **fora da `main`**.
- **Ratificação pendente de integração:** classe **A** condicionada ao **Gate H1** (este documento
  na `main`). Enquanto não integrado, o 005B **não pode ser iniciado**.
- **Implementação ainda não iniciada:** nenhum código escrito, nenhum workflow criado, nenhum
  artifact baixado, nenhum Docker executado, manifesto e golden **intocados**.
- **Dependência com prazo:** bundle `8436826125` (run `29669361609`) — consumo **fail-closed**,
  **expira 2026-07-26T01:59:00Z**; se expirar, o 005B para e exige GOAL **separado** de renovação
  do 005A.
- **GOAL-005 técnico:** **PARCIAL** · **gate Fiscal global: ABERTO** · **N6=0** · **N7=0** ·
  nenhum gate alterado · Contador HUB intocado · zero emissão/persistência/SEFAZ.
- **Relatório:**
  [`005B SCOPE RATIFICATION`](../fiscal/FISCAL_DRY_RUN_INTEGRITY_PROOF_005B_SCOPE_RATIFICATION.md).

### Base prévia (inalterada por GOAL-004 / 005A / 005B)

- **Worker XSD:** B2 integrado; G-C2 **FECHADO**; N4 no eixo XSD; **bundle offline 005A na main**.
- **Assinatura / C14N:** N4 no eixo C14N/XMLDSig; critério técnico F4→F5 **FECHADO** (GOAL-003).
- **Signer:** **dormente** — zero callers de venda; dry-run/testes apenas.
- **Runtime:** seis guards em rotas de correção/cancelamento. Snapshot, emissão, tax-engine, vault e
  numeração **sem** caller no fluxo de venda.
- **Homologação / produção:** N6=0 · N7=0 · `fiscalEnabled` inalcançável · SEFAZ **não** chamada.
- **Riscos remanescentes:** dry-run global incompleto; ST/CSOSN 500; provider real; fila/eventos;
  G-F5/G-F7/G-F12; follow-ups R-1…R-5 do GOAL-004.
- **Documentos:** [roadmap](../roadmaps/ROADMAP_FISCAL.md) ·
  [plano mestre](../governance/MASTER_FISCAL_EXECUTION_PLAN.md) ·
  [continuação](../fiscal/FISCAL_CONTINUATION_IMPLEMENTATION_GOALS_001.md) ·
  [fechamento GOAL-002](../fiscal/FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md) ·
  [fechamento GOAL-003](../fiscal/FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md) ·
  [fechamento GOAL-004](../fiscal/FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md) ·
  [ADR-0010](../decisions/ADR-0010-validacao-xsd-worker-containerizado-xmllint-provisionado.md) ·
  [ADR-0011](../decisions/ADR-0011-assinatura-xmldsig-nfce-rsa-sha1-imposta-pelo-schema.md).

---

## Operações V4 — Closeout dos blockers (`OPS-V4-BLOCKERS-FINAL-CLOSEOUT-018`) · 20/08/2026

> Fecha os gaps reais restantes da V4 reusando motores já existentes.
> Sem schema novo, sem segundo PDV, sem PIN/auth paralelo.

- **Execução / Estoque:** `consumirEstoqueOSActionV3` → adapter `consumeEstoqueFromOS`. Replay = `already_consumed`. Timeline + livro-razão (`origem=os`, documento da OS). A V4 recarrega na hora.
- **Rail Receber:** deixa de parecer um PDV operacional read-only. Lista abre o Financeiro/Recebimento real da OS (`openOSFromRail(..., true)`). Sem segundo motor de pagamento.
- **Técnicos:** seletor passa a unir `listTecnicos` (cadastro da loja) com os já atribuídos nas OS.
- **Config / Segurança:** Config da V4 e a superfície residual de segurança abrem `/dashboard/configuracoes`. Sem PIN paralelo.
- **Auditoria de UX:** sai da navegação operacional.

---

## Operações V4 — Dashboard / Histórico / acabamento (`OPS-V4-DASHBOARD-HISTORICO-FINAL-017`) · 19/08/2026

> Fecha a Visão geral e o Histórico transversal da OS com dados já existentes.
> Sem schema, sem motor paralelo.

- **Visão geral (`DashboardV4`):** fila por status, SLA, sem técnico/bancada, prontas, retornos, entregas do dia — cliques abrem a rail ou a OS.
- **Histórico:** timeline filtrável, cliente/aparelho, OS relacionadas (aparelho/cliente/retorno/origem), anexos, assinatura, observação interna real, export de auditoria, ligar via `tel:`.
- **Acabamento:** selo "Protótipo" sai das rails restantes; ligar/export/histórico do cliente deixam de ser no-op.

---

## Operações V4 — Técnico / Bancada / Fila / SLA (`OPS-V4-TECNICO-BANCADA-FILA-016`) · 19/08/2026

> Fecha o fluxo operacional de chão de oficina na V4. O motor continua 100% V3
> (payload-only). Sem schema, sem action V4 paralela.

### O que mudou

- **Técnico:** atribuir/trocar/remover na Bancada, Fila, header e Execução via `atribuirTecnicoV3`.
- **Bancada física:** entrar/sair grava `aberturaV3.recepcao.localFisico` (`definirLocalFisicoV3`) + timeline.
- **Status:** Fila (Kanban/Lista) e Bancada seguem a política compartilhada → `aplicarTransicaoStatusV3`.
- **SLA rail própria (`SlaV4`):** agrupa atrasadas / em risco / no prazo / sem prazo com `lerSlaV3` (não mais `os.sla.status` legado isolado).
- **Observação interna e checklist técnico:** `adicionarObservacaoInternaV3` e `salvarChecklistTecnicoV3` (sem `updateOSPayload`).
- **Identidade das rails:** Fila, Bancada e SLA abrem o Workspace na Execução (`openOSProducao`). CTA comercial da Bancada continua abrindo o cockpit sem override.

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro engine/Estoque/WhatsApp/Fiscal/auth/proxy.

---

## Operações V4 — Documentos, assinatura e anexos (`OPS-V4-DOCUMENTOS-ASSINATURA-ANEXOS-015`) · 19/08/2026

> Fecha a camada documental da OS na V4 reusando os motores V3 já existentes.
> Sem schema, sem action paralela, sem Cloud API nova.

### O que mudou

- **Impressão / reimpressão:** o menu Docs e a etapa Entrega abrem `PrintPreviewV3` para OS cliente, Termo de Garantia, Termo de Entrega, via interna, etiqueta e orçamento. `registrarImpressaoDocumentoV3` continua auditando na timeline.
- **Assinatura:** retirada digital segue em `entregaV3.assinaturaRetirada` (`SignaturePadV3` + `salvarAssinaturaRetiradaV3`).
- **Fotos de saída:** `entregaV3.fotosSaida` com add/remove (`adicionarFotoSaidaV3` / `removerFotoSaidaV3`); confirmar entrega **preserva** fotos já gravadas.
- **Anexos:** thumbs reais de entrada + saída no rail, histórico e painel de anexos. `+` navega para captura real (Entrada ou Entrega).
- **WhatsApp:** `montarLinkWaV4` / `montarMensagemDocumentoV4` — `wa.me`, só documento visível ao cliente. Sem `/api/whatsapp/send` (inbox exige `conversationId`).

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro engine/Estoque/Fiscal/auth/proxy. WhatsApp HUB intocado.

---

## Operações V4 — Guard comercial da Bancada (`OPS-V4-BANCADA-COMMERCIAL-TRANSITION-GUARD-003B`) · 15/08/2026

> Micro-GOAL sobre o commit da Fila: Fila e Bancada passam a consultar a **mesma**
> política de transições rápidas. A máquina V3 continua autoridade.

### O que mudou

- **Policy compartilhada** `lib/operacoes-v4/transicoes-producao-v4.ts`: `proximasTransicoesV3` ∩ destinos de chão − pares comerciais − cancelar/receber/entregar.
- **Bancada:** Diagnóstico e Aguardando aprovação perdem o botão de status. CTAs abrem a OS (`openOSFromRail`). Ações seguras (iniciar serviço, aguardar peça, peça chegou, marcar pronta) continuam.
- **Fila:** continua usando a mesma policy (drag / Mover para). Sem segundo grafo.

**Segurança:** sem schema, sem action nova, sem tocar `enviarOrcamentoV3` / `aprovarOrcamentoV3` / Financeiro / Entrega.

---

## Operações V4 — Fila Kanban acionável (`OPS-V4-FILA-KANBAN-WRITE-004`) · 15/08/2026

> A Fila V4 deixa de ser uma lista somente leitura e vira a esteira operacional
> da assistência. O motor continua 100% V3.

### O que mudou

- **Tela dedicada `FilaV4`:** Kanban + Lista, tickets densos (técnico, prioridade, SLA, defeito).
- **Write real:** `moverStatusFila` → `destinosPermitidosFilaV4` (`proximasTransicoesV3` ∩ recorte de produção) → `aplicarTransicaoStatusV3`. Refresh sem F5 via `runWriteOnOs`.
- **Drag seguro:** só destinos de chão de oficina. Destino inválido não recebe drop. Sem optimistic move — loading por card; erro recarrega a verdade do servidor.
- **Comercial protegido:** diagnóstico→aguardando aprovação e aguardando aprovação→aprovada ficam no cockpit (`enviarOrcamentoV3` / `aprovarOrcamentoV3`).
- **Mesma mudança sem drag:** menu `Mover para`, tecla `M`, Lista.
- **Filtros:** busca, técnico, prioridade, SLA. Preferência Kanban/Lista em `omnigestao:operacoes-v4:fila-view:v1`.
- **Fora deste slice:** recebimento, entrega, cancelamento por drag, pós-venda. `recebida` não entra no Kanban de produção.

**Segurança:** sem schema/migration, sem action V4 paralela, sem segunda máquina de status, sem tocar PDV/Caixa/Financeiro engine/Estoque/WhatsApp/Fiscal/auth/proxy.

---

## Operações V4 — Bancada operacional (`OPS-V4-PRODUCAO-TECNICO-BANCADA-003`) · 14/08/2026

> A Bancada V4 deixa de ser uma rail somente leitura e vira a superfície de
> produção do dia. O motor continua 100% V3.

### O que mudou

- **Tela dedicada `BancadaV4`:** resumo operacional, fila **Sem técnico** (P0), produção agrupada por técnico.
- **Mutations reais:** `atribuirTecnicoV3` (inclui remoção com `null`), `definirPrioridadeV3`, `aplicarTransicaoStatusV3` só nos destinos de chão de oficina autorizados por `podeTransicionarV3`.
- **Adapter puro** `lib/operacoes-v4/producao-v4.ts`: projeção, ordenação (SLA crítico → prioridade → idade), filtros client-side. Sem KPI inventada (sem tempo médio / capacidade / produtividade).
- **Workspace:** tickets de técnico e prioridade no `CommandHeader`; resumo no início da Execução.
- **Fora deste slice (à época):** Kanban drag da Fila (fechado em `OPS-V4-FILA-KANBAN-WRITE-004`), peças/apontamentos write, cadastro de funcionário.

**Segurança:** sem schema/migration, sem action V4 paralela, sem tocar PDV/Caixa/Financeiro engine/Estoque/WhatsApp/Fiscal/auth/proxy. Técnicos conhecidos continuam inferidos das OS (`tecnicosConhecidosV3`) — não há cadastro independente, portanto não se inventam técnicos "livres".

---

## Operações V4 — Pipeline operacional e Entrada simplificada (`OPS-V4-PIPELINE-ENTRADA-NAV-SIMPLIFY-002`) · 14/08/2026

> Segundo GOAL da reorganização operacional da V4. Depois da criação unificada,
> o cockpit deixa de parecer um wizard de oito etapas e passa a refletir o
> fluxo real da assistência.

### O que mudou

- **Pipeline:** só Entrada, Diagnóstico, Execução, Entrega e Pós-venda. Estados visuais concluída / atual / pendente / atenção.
- **Orçamento:** saiu da pipeline. Ticket comercial no header (`Cobrança não definida`, `Orçamento · Rascunho`, `Enviado`, `Aprovado`, `Recusado`) abre o `OrcamentoStage` real.
- **Financeiro:** saiu da pipeline. Ticket financeiro no header (`A receber`, parcial, `Quitado`) abre o `FinanceiroStage` real. Leitura indisponível não se disfarça de ausência de cobrança.
- **Histórico:** saiu da pipeline. Ação `Histórico` + contagem de eventos no header abre o `HistoricoStage` real.
- **Entrada:** 4 grupos — Recepção e aparelho, Segurança e custódia, Inspeção, Evidências. Snapshot do que já veio da abertura. Sem rail overlay `entrada-nav`.
- **Contratos:** helpers puros `pipeline-operacional.ts`, `os-header-transversal.ts`, `identidade-aparelho.ts` e `checklist-aplicabilidade.ts`. Fotos e assinatura da entrada reusam as actions V3. Sem schema, sem motor novo.

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro engine/Estoque/WhatsApp/Fiscal/auth/proxy. Destinos `orcamento`/`financeiro`/`historico` continuam válidos; só saíram da trilha.

---

## Operações V4 — Novo atendimento comercial (`OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001`) · 14/08/2026

> Primeiro GOAL da reorganização operacional da V4. A criação de atendimentos
> deixa de ser três botões no topo e vira uma entrada única e profissional.

### O que mudou

- **TopBar:** um CTA `+ Novo` no lugar de Atendimento rápido / Orçamento rápido / Nova OS.
- **Launcher:** overlay compacto à direita, copy *"Novo atendimento — Escolha como este atendimento começa."* e três tickets:
  - **Nova OS** → `criarOSEnterpriseV3` → workspace Entrada
  - **Orçamento** → `criarOrcamentoRapidoV3` → workspace Orçamento
  - **Atendimento rápido** → `finalizarAtendimentoRapidoV3` → workspace Entrega
- **Empty state** do workspace (`OSPicker`) também entra pelo `+ Novo`.
- **Contrato puro** `lib/operacoes-v4/novo-atendimento.ts` documenta modalidade → motor → destino (preparação para os próximos GOALs de pipeline/recebimento).
- **Formulários:** Nova OS, Novo orçamento e Atendimento rápido passam pelo mesmo shell/accordion e pelas seções compartilhadas de cliente e aparelho.
- **Pré-OS:** `payload.comercialV4` classifica o orçamento; não entra em fila/bancada até converter (mesmo `osId`).
- **Fora / dívida:** catálogo de peças no create ainda é opcional; prova de entrada completa fica no workspace; Instagram/Ligação persistem no carimbo comercial e mapeiam origem V3 para balcão.

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro/Estoque/Inventário/WhatsApp/Fiscal/auth/proxy/Vendas HUB/Operações V3 actions.

---

## Operações V4 (Preview) — Orçamento: custo interno e margem (slice `OPS-V4-ORCAMENTO-CUSTO-MARGEM-004D`) · 01/07/2026

> Slice de UX sobre o Orçamento V4 (rascunho/enviado, editor real). Objetivo: dar controle de
> custo interno, custo de peça, lucro e margem **sem expor isso ao cliente** — a tela V4 é cockpit
> interno, nunca documento de cliente.

### Slice 004D — Custo interno, lucro e margem

- **Serviço manual**: novo campo de custo interno por linha (`novoServicoManualV4({..., custo})`),
  grava `custoV3` **só quando > 0** (0/ausente/negativo = "não informado" — mesma convenção usada
  em outras telas de custo/margem do OmniGestão).
- **Peça do catálogo**: custo é **somente leitura**, vem do produto (`custoUnitario`); mostra
  `Custo R$X / un.` ou **"Custo não informado"** quando o cadastro não tem custo. Não baixa
  estoque, não altera produto.
- **Totais** (painel do editor): subtotal, desconto, total ao cliente, custo interno, lucro
  estimado e **margem estimada (%)** — novo helper puro `margemPercentualV4` (`lucro/total`, `null`
  sem total). Aviso quando alguma linha válida não tem custo informado (`itensSemCustoV4`).
- **Honestidade**: microcopy fixa **"Custo interno — não aparece para o cliente."** no painel de
  Totais (editor e read-only). Sem impressão/envio nesta fase.
- **Persistência**: reusa o contrato **já existente** `salvarOrcamentoV3`/`SalvarOrcamentoV3Input`
  (V3 intocado) — `custoV3`/`custoUnitario` já eram campos do modelo V3, nenhuma action/schema nova.

**Arquivos:** `lib/operacoes-v4/orcamento-form.{ts,test.ts}` ·
`components/operacoes-v4-preview/parts/stages/OrcamentoStage.tsx` (editados).

**Limitação conhecida (fora de escopo deste slice):** o agregado read-only de custo/lucro em
`os-adapter.ts` (`adaptOrcamento`) só aparece quando **100% das linhas são peças com custo**
("Decisão 2" pré-existente) — um orçamento com serviço (mesmo com `custoV3` informado) continua
sem agregado nessa tela específica após enviar/aprovar/recusar. O dado fica persistido no
payload; só não é somado nessa view. Registrado como achado para follow-up, não corrigido aqui.

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro/Estoque/Inventário/WhatsApp/
Fiscal/auth/proxy/Vendas HUB/Produtos-Cadastros/Operações V3 actions/`os-adapter.ts`.

`tsc --noEmit` ✅ · `vitest run lib/operacoes-v3 lib/operacoes-v4 components/operacoes-v4-preview`
✅ **338 passed** (+14) · `npm run build` ✅ (compila limpo, sem retry). **Commitado (`6008dd8`),
PUSHADO — `origin/main == HEAD`.**

---

## Operações V4 (Preview) — Dados básicos da OS reais (slice `OPS-V4-DADOS-BASICOS-OS-REAL-003B`) · 01/07/2026

> A **Operações V4 Preview** (`/dashboard/operacoes-v4-preview`) é um cockpit visual **paralelo**
> à V2/V3 (rota isolada, não afeta nenhuma delas). Vem sendo migrada de mock para **dado real**
> em **slices pequenos**, sempre **reusando** actions já existentes e seguras da V3 (nunca
> backend novo, nunca schema, nunca tocando Financeiro/Caixa/Estoque). Slices reais até aqui:
> Nova OS (`OPS-V4-NOVA-OS-REAL-001`), Diagnóstico/Orçamento (`OPS-V4-ORCAMENTO-REAL-002`),
> Entrada/Recepção parcial (`OPS-V4-ENTRADA-RECEPCAO-REAL-003`) e agora Dados básicos da OS
> (`OPS-V4-DADOS-BASICOS-OS-REAL-003B`).

### Slice 003B — Dados básicos da OS

A aba **Entrada** ganha edição real dos campos que tinham ficado pendentes do slice 003:
**defeito relatado, prioridade, origem, recebido por, localização física, previsão/SLA e
observações internas**. Nova action **payload-only** `salvarDadosBasicosOSV3`
(`lib/operacoes-v3/dados-basicos-actions.ts`) grava direto no `payload` (JSONB) + coluna
denormalizada `defeito` — mesma disciplina de `workspace-actions`/`prova-entrada-actions`,
**sem `updateOSPayload` do V2** (logo sem sync de Financeiro), sem alterar
status/orçamento/diagnóstico/estoque/caixa. Reader puro `lerDadosBasicosV3`
(`lib/operacoes-v3/dados-basicos-model.ts`) + editor `lib/operacoes-v4/dados-basicos-form.ts`
alimentam o formulário e o painel lateral (`ContextColumn`), que passa a mostrar Origem e
Observações internas reais.

**Arquivos:** `lib/operacoes-v3/{dados-basicos-model,dados-basicos-actions}.ts` (novos) ·
`lib/operacoes-v4/dados-basicos-form.{ts,test.ts}` (novos) ·
`components/operacoes-v4-preview/{os-adapter.ts, use-v4-preview.ts, preview-honesty.test.ts,
parts/ContextColumn.tsx, parts/stages/EntradaStage.tsx}` (editados).

**Status honesto:** Entrada, Diagnóstico e Orçamento têm **partes reais** (leitura e escrita).
Execução, Financeiro, Entrega, documentos, anexos, assinatura e PDV de Serviço/garantia
**continuam preview/read-only ou futuro**, exceto as transições de status já seguras
(`diagnostico`/`em_execucao`) implementadas nos slices anteriores.

**Segurança:** sem schema/migration, sem tocar PDV/Caixa/Financeiro/Estoque/Inventário/
WhatsApp/Fiscal/auth/proxy/Vendas HUB.

`tsc --noEmit` ✅ · `vitest run lib/operacoes-v3 lib/operacoes-v4 components/operacoes-v4-preview`
✅ **324 passed** · `npm run build` ✅ (compila limpo, sem retry). **Commitado localmente
(`c60047f`), sem push.**

---

## WhatsApp IA — Catálogo & Orçamento Assistido (F1–F4) · 15/06/2026

> Nova frente: IA **assistida** sobre o WhatsApp HUB (inbox real, Meta Cloud API já em
> produção). **Tudo é somente leitura / sugestão ao operador** — **nada é enviado
> automaticamente**, nenhuma OS/cobrança/cotação é criada. Toda classificação/sugestão carrega
> `requiresHumanApproval = true` e `safeToAutoSend = false`. Blueprint completo:
> [`docs/whatsapp/WHATSAPP_IA_ORCAMENTOS_E_CATALOGO_BLUEPRINT.md`](../whatsapp/WHATSAPP_IA_ORCAMENTOS_E_CATALOGO_BLUEPRINT.md).

### Status atual

| Fase | Entrega | Status | Hash |
|---|---|---|---|
| **F1** | Blueprint da arquitetura (catálogo, orçamento, fornecedores) | ✅ Concluído | `8a35ef1` |
| **F2** | Classificação de intenção do inbound | ✅ Concluído | `0fd7abf` |
| **F3** | Catálogo / estoque / fotos (consulta) | ✅ Concluído | `545c0e0` |
| **F4** | Orçamento de assistência assistido | ✅ Concluído | `d82d83b` |
| **F5** | Fornecedores e Cotação | ⏳ Próximo — **Gate obrigatório** | — |

**F1 — Blueprint (`8a35ef1`).** Arquitetura completa da IA para catálogo, orçamento e
fornecedores: diagnóstico do que já existe (Cloud API, webhook, multi-loja, camada IA
assistida, Omni Agent) × o que falta, intents, fluxos assistidos, segurança/LGPD, proposta de
schema futuro e roadmap por fases. Documento — sem código.

**F2 — Classificação de intenção (`0fd7abf`).** Classificador do inbound exibido no inbox com
intenção, confiança, entidades e sugestão de resposta para o operador revisar. Intents:
**Produto · Orçamento · Status OS · Garantia · Financeiro · Outro** (+ Cotação só com contexto
interno de fornecedor). **Assistido — sem envio automático.**

**F3 — Catálogo / Estoque / Fotos (`545c0e0`).** Quando a intenção é consulta de produto, busca
produtos **reais da loja ativa** e sugere resposta: **consulta de catálogo, estoque
(EM/BAIXO/SEM), imagens (ProductMedia), multi-loja estrito (sem fallback loja-1)**. Reusa o
motor de busca do PDV (`scorePdvSearch`). **Somente leitura** — não altera estoque. Não expõe
custo/margem/fornecedor.

**F4 — Orçamento de assistência assistido (`d82d83b`).** **Resolver de aparelho** (marca/modelo)
+ **resolver de serviço** (tela/bateria/conector/software/desbloqueio/limpeza/diagnóstico) +
**motor de orçamento** que sugere **valor + faixa de preço** com **origem** explícita
(`SERVICO_CADASTRADO` / `PRODUTO_COMPATIVEL` / `ESTIMATIVA` / `SEM_DADOS`) e badge
**Real/Estimado/Revisar**. Lê **apenas preço de venda** (`Servico.preco`/`Produto.preco`) — nunca
custo/margem/fornecedor. **Somente leitura — sem criar OS.**

### O que NÃO existe ainda (não confundir com o entregue)

Não há, nesta frente: **envio automático de mensagem · IA autônoma · cotação automática a
fornecedor · criação automática de OS · negociação com fornecedor.** A fase é **assistida** —
o operador revisa e confirma toda resposta antes de qualquer envio.

### Próximo — F5 (Fornecedores e Cotação)

Introduz o **primeiro schema novo** desta frente (ex.: `Cotacao` / `FornecedorCapacidade`),
portanto exige **Gate obrigatório** antes de implementar: **ADR + revisão de schema + revisão
multi-loja**.

### Não alterado por F1–F4

Webhook de produção (`app/api/webhooks/whatsapp`), envio real de WhatsApp, schema
Prisma/migrations, PDV, Caixa, Financeiro, Operações V3, Estoque, Inventário, Marketplace,
Fiscal, `finalizeSaleTransaction`. As novas rotas (`…/product-suggestion`,
`…/assistance-quote`) são **read-only** e escopadas por loja.

---

## Status Geral — 11/06/2026

### Operações V3 (~98% arquitetural)

Módulo operacional principal da assistência técnica. Últimas melhorias **concluídas e em produção**:

**Proteção de rascunho da Nova OS** — commit `8e626a6`
- Auto-save automático do rascunho · recuperação ao reabrir a Nova OS
- Proteção contra clique acidental fora do modal · confirmação antes de descartar
- Persistência por unidade (`storeId`) · limpeza automática após criação bem-sucedida
- **Senha do aparelho excluída** do armazenamento local
- Validações: `tsc` OK · `vitest` OK · `build` OK

**Atendimento Rápido Real** — commit `86914e9`
- Deixou de ser casca visual e passou a operar com fluxo real
- Cliente **existente / novo / Balcão** · serviços rápidos pré-configurados + **manual**
- Integração com **caixa, recebimento, histórico operacional e OS Enterprise**
- Registro **rastreável** de atendimentos de balcão
- Fluxo: Atendimento Rápido → cria OS simplificada → registra recebimento → registra operação de caixa → conclui → aparece no histórico
- **Cliente Balcão** = singleton por unidade (não duplica cadastro; não exige CPF/telefone)
- Limitações conhecidas: conversão Atendimento → OS Completa ainda **sem pré-preenchimento** · catálogo persistente de serviços requer **schema próprio** · **split** de pagamento ainda não exposto no fluxo rápido

### PDV

**Provisionamento do código de numeração por loja (GOAL 002C-0b) — gate G1 FECHADO, writer v2 continua desligado (05/08/2026)**
- Superfície administrativa **na gestão de unidades já existente** (`GestaoUnidadesSaas`,
  usada por `/dashboard/unidades` e por Configurações V3 → Lojas): novo bloco
  `components/dashboard/configuracoes/numeracao-venda-lojas.tsx` lista **cada loja
  acessível** com nome, id, código atual e estado **Configurado / Não configurado**, e
  oferece a ação de configurar ou substituir. **Nenhuma segunda área de gestão de lojas.**
- Escrita concentrada em **um** serviço canônico server-only
  `lib/vendas/store-sale-numbering-provision.ts`, exposto por
  `PUT /api/stores/numeracao-venda` (`requireAdmin` + ACL da loja pela sessão) e lido por
  `GET` na mesma rota (mesma política de leitura de `/api/stores`). A loja é **resolvida no
  servidor**; nada validado no cliente é confiado.
- Validação passa **exclusivamente** por `planStoreSaleNumberingCodes` (contrato 002C-0), com
  os códigos ocupados lidos **na mesma transação** da escrita. Só a coluna
  `codigoNumeracaoVenda` é atualizada; a unique global da migration 0016 continua sendo a
  proteção final e **P2002 vira conflito** (409), sem revelar a loja ocupante quando ela está
  fora do escopo do operador. Alteração efetiva registra auditoria do módulo
  (`store.codigoNumeracaoVenda`, área `pdv`); repetir o mesmo valor é **idempotente** e não
  audita.
- **Nenhuma geração automática**: sem MAX, count, nome da loja ou aleatoriedade — o código vem
  do operador e o campo nasce vazio. A UI mostra apenas o **prefixo comercial honesto**
  (`VDA-{CODIGO}-{ANO}-{SEQUÊNCIA}`), sem simular ano ou número.
- **Imutabilidade após uso** ancorada em evidência de schema: existir `SerieVenda` para a loja.
  `SerieVenda.prefixo` é snapshot **write-once** do código e `Venda` referencia a série por FK
  composta `Restrict` — trocar o código depois disso quebraria a série (é o que
  `assertSerieUsavel` recusa). Vendas ligadas à série são exibidas como reforço, nunca como
  critério extra; **nada é inferido do formato de `pedidoId` das vendas v1**. Não existe ação
  para apagar o código.
- **Zero alteração operacional:** writer v1, gate de runtime, allocator, `venda-persist`,
  `sync-legacy-vendas`, PDVs, `mergeSalesById`, recibos, `prisma/schema.prisma` e migrations
  intactos. Configurar o código **não ativa** a numeração server-side, e a flag do writer v2
  **não** foi configurada em ambiente algum — a ativação depende dos slices 002C-1..3.
- Validação: `vitest lib/vendas` **287 passed | 16 skipped** (31 novos do serviço) ·
  `vitest app/api/stores` **15 passed** (novos da rota) · suíte completa
  **4568 passed | 2 expected fail | 152 skipped**, com a mesma falha **pré-existente e
  ambiental** de `tools/fiscal-dry-run-integrity-proof/proof.test.ts` (verificador Java
  externo ausente) · `tsc --noEmit` ✅ (0 erros) · `eslint` dos arquivos alterados ✅
  (0 erros) · `build` ✅ · `git diff --check` ✅ · secret scan ✅.
- **Gate que continua aberto:** G4 (suíte de concorrência contra PostgreSQL real).
  Próximo: **002C-1** (writer atrás do gate, `clientSaleId` opcional).

**Contratos da numeração server-side (GOAL 002C-0) — decididos e testados, SEM call site (04/08/2026)**
- [`ADR-0021`](../decisions/ADR-0021-identidade-tecnica-e-numero-comercial-da-venda.md) fixa a
  separação: **`clientSaleId`** é a identidade técnica criada no cliente, estável entre
  retries, única por `storeId`, nunca exibida; **`pedidoId`** é o número comercial alocado
  **só** pelo servidor no fluxo v2, dentro da transação.
- Replay é reconhecido por **`(storeId, clientSaleId)`** — nunca por `pedidoId`. Mesma chave
  devolve a venda existente, sem alocar número novo e sem duplicar estoque, caixa,
  financeiro ou eventos. Qualquer divergência é conflito fail-closed.
- Helpers **puros** novos: `lib/vendas/sale-identity-contracts.ts` (valida/normaliza
  `clientSaleId`, classifica forma de `pedidoId`, decide create × replay × conflito, e
  representa v1 × v2 sem Prisma) e `lib/vendas/store-sale-numbering-code.ts` (valida
  `codigoNumeracaoVenda` e recusa vazio, inválido e duplicado). Nenhum deles gera
  `clientSaleId` nem aceita `pedidoId` como fallback.
- **Gate de runtime** server-only `lib/vendas/sale-numbering-runtime-gate.ts`: v2 exige
  `VERCEL_ENV === "production"` **+** projeto canônico **+**
  `SALE_SERVER_NUMBERING_ENABLED === "true"` exato. Qualquer ausência, `TRUE`, `1`, espaço,
  newline, ambiente desconhecido, projeto legado ou terceiro projeto ⇒ **writer v1**.
  Polaridade **fail-open** deliberada: o gate nunca impede uma venda do fluxo v1.
- O ID canônico de projeto é **reexportado** de `scripts/migration-authority-guard.mjs` por
  `lib/deploy/canonical-deployment.ts` — fonte única, sem cópia. **O guard de migrations não
  foi alterado**; a dependência é unidirecional (app → guard).
- **Zero alteração de comportamento:** `lib/ops-upsert-venda.ts`, `venda-persist`,
  `sync-legacy-vendas`, `operations-store.tsx`, `operations-sales-merge.ts` e os 6 PDVs
  seguem intocados — provado por teste estático que proíbe call site em cada um deles.
  A flag **não** foi configurada em ambiente algum. Schema, migration e allocator intactos.
- Validação: `vitest` das suítes de numeração **97 passed** (63 novos + 34 do 002B) ·
  suíte completa **4522 passed | 2 expected fail | 152 skipped**, com 1 falha
  **pré-existente e ambiental** (`tools/fiscal-dry-run-integrity-proof/proof.test.ts`,
  verificador Java externo ausente — reproduzida no commit base sem estas mudanças) ·
  `tsc --noEmit` ✅ (0 erros) · `eslint` dos arquivos alterados ✅ · `build` ✅ ·
  `git diff --check` ✅ · secret scan ✅.
- **Gates que continuam abertos:** G1 (provisionamento de `Store.codigoNumeracaoVenda` — o
  writer ainda falharia em 100% das vendas) e G4 (suíte de concorrência contra PostgreSQL
  real). Próximo: **002C-1** (writer atrás do gate, `clientSaleId` opcional).

**Readiness do writer de numeração server-side (GOAL 002C) — Classe B, liberado com gates (04/08/2026)**
- Auditoria read-only sobre `origin/main@69fb419`. **Zero** alteração de código, testes,
  configuração, SQL, migration, deploy ou Vercel. Writer **não** implementado.
- O bloqueio **Classe C** anterior (dois projetos Production migrando bancos diferentes)
  está **resolvido** pela ativação da autoridade de migrations (bloco abaixo).
- Writer canônico identificado: `lib/ops-upsert-venda.ts#upsertVendaInTransaction`, motor
  único de `/api/ops/venda-persist` e `/api/ops/sync-legacy-vendas` — **ponto único de
  integração** recomendado.
- Fontes atuais de numeração: **três** — `nextSaleId` no navegador (MAX+1 sobre
  `localStorage`, reinicia por loja), `count()+1` fora de transação em
  `criarVendaDeOSAction` (prefixo `VND-`) e número externo do importador avançado.
- Fronteira transacional: a transação existente de `venda-persist`
  (`maxWait 15s` / `timeout 20s`, **READ COMMITTED** por default) já é a correta;
  `allocateSaleNumber` pode ser chamado dentro dela sem mudança de isolamento.
- P2034 ⇒ retry **da transação inteira**, com limite. P2002 ⇒ classificação por constraint;
  `(storeId, clientSaleId)` vira replay idempotente, nunca retry cego.
- **Gates bloqueantes (P0):** G1 — nenhuma superfície versionada configura
  `Store.codigoNumeracaoVenda` (o writer falharia em 100% das vendas); G2 — sem gate de
  runtime canônico o writer também ficaria ativo no projeto legado, que usa banco distinto;
  G3 — `mergeSalesById` casa local↔remoto por `id`, então número server-side sem
  `clientSaleId` reintroduz pendência fantasma e permite duplicação por reenvio.
  G4 (P1) — a suíte de concorrência é opt-in e precisa ser executada contra PostgreSQL real.
- Recomendação: **liberar o 002C** condicionado a G1–G4, fatiado em 002C-0..002C-3.
  Implementação monolítica **não** recomendada.
- Relatório: `docs/audits/PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md`.

**Autoridade de migrations Production — ATIVA e comprovada em Production (04/08/2026)**
- `MIGRATION_AUTHORITY_ENABLED` foi criada **somente** em `omni-gestao-pro`, escopo
  **Production**, no nível do projeto (não Shared). Legado e demais projetos do time
  seguem sem a flag.
- Redeploys controlados do mesmo commit `69fb419` comprovaram decisões opostas:
  canônico `MIGRATION_RUN: 1` → `MIGRATION_SUCCEEDED: 1` com **um único**
  `prisma migrate deploy` (`No pending migrations to apply.`, baseline no-op);
  legado `MIGRATION_SKIPPED: 1`, `MIGRATION_RUN: 0`, `migrate deploy: 0`. Os dois
  deployments ficaram `Ready`.
- Zero alteração de código, Git, schema, migrations, SQL, `migrate resolve`,
  rollback ou acesso direto ao banco. `0016` mantida nos dois bancos.
- Consequência operacional: todo deployment Production do canônico passa a executar
  `migrate deploy` automaticamente — migrations só devem chegar à `main` revisadas.
- Governança de migrations **fechada**. Próximo passo: **readiness do GOAL 002C**
  (ainda não iniciado).
- Relatório:
  `docs/audits/DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`.

**Guard de autoridade de migrations Production — implementação do contrato (04/08/2026)**
- O proprietário confirmou `omni-gestao-pro` como projeto Production canônico;
  `omni-gestao`/`omni-gestao-pi.vercel.app` permanece legado e ativo por tráfego
  residual de PWA/assets/páginas públicas, sem operação de negócio comprovada.
- `scripts/migration-authority-guard.mjs` implementa o contrato fail-closed:
  `VERCEL_ENV=production` + flag exata `MIGRATION_AUTHORITY_ENABLED=true` + igualdade
  com o `VERCEL_PROJECT_ID` canônico versionado em constante server-only.
- Nome e domínio não autorizam migration. Projeto legado, terceiro projeto, Preview,
  Development e local emitem `MIGRATION_SKIPPED` e continuam o build. Project ID
  ausente ou flag/environment inválidos bloqueiam uma tentativa explícita com
  `MIGRATION_GUARD_BLOCKED`.
- A disponibilidade de `VERCEL_PROJECT_ID`, `VERCEL_ENV` e
  `VERCEL_PROJECT_PRODUCTION_URL` no build foi confirmada pelas System Environment
  Variables, habilitadas no projeto canônico. IDs e valores sensíveis não são logados.
- Nesta entrega o contrato foi apenas implementado no código; a flag ainda não
  existia na Vercel e nenhum deploy ou migration foi executado. A ativação
  operacional ocorreu no GOAL seguinte (bloco acima).
- A `0016_add_sale_numbering_infrastructure` permanece provisoriamente aplicada nos
  dois bancos. Não houve rollback, SQL ou nova verificação física.

**Governança de migrations Production — auditoria Classe C (03/08/2026)**
- Auditoria read-only dos projetos Vercel `omni-gestao-pro` e `omni-gestao`, ambos
  conectados ao mesmo repositório, à branch Production `main` e ao mesmo runner.
- Os dois projetos mantêm aliases Production próprios, recebem o mesmo fluxo de
  deployments e apontam para **`DIFFERENT_DATABASES`**. Não existe flag explícita,
  validação de `VERCEL_PROJECT_ID` ou lock entre projetos antes de
  `prisma migrate deploy`.
- `omni-gestao-pro` era o candidato mais forte e foi posteriormente confirmado pelo
  proprietário como projeto canônico. O banco canônico e a disposição final do banco
  legado continuam sujeitos à decisão humana e ao escopo operacional correspondente.
- O modelo recomendado de **flag explícita + project ID exato** foi implementado no
  código; sua ativação na Vercel continua pendente e fora deste GOAL.
- A `0016_add_sale_numbering_infrastructure` permanece aplicada provisoriamente nos
  dois bancos. Não há dano comprovado e não se autoriza rollback sem catálogo,
  ledger e contagens read-only.
- **GOAL 002C segue bloqueado.** O guard de código não escolhe o banco canônico,
  não altera os dois bancos e não define o destino do ambiente legado.
- Relatório:
  `docs/audits/DEPLOY_PRODUCTION_MIGRATION_GOVERNANCE_AUDIT_001.md`.

**Auditoria Production da migration `0016` — Classe C (03/08/2026)**
- O PR #34 foi integrado em `6a0d141` às 17:17 BRT. Os deployments Production de
  `omni-gestao-pro` (aplicação às 17:19:07 BRT) e `omni-gestao` (aplicação às
  17:22:49 BRT) executaram `prisma migrate deploy` e aplicaram a `0016`.
- A comparação segura das identidades determinou **`DIFFERENT_DATABASES`**. Os dois
  projetos Production migraram destinos distintos; isso aciona a **Classe C**.
- A inspeção SQL direta foi interrompida no ponto de parada: catálogo,
  `_prisma_migrations` e contagens agregadas permanecem não verificados. O código
  publicado continua dormente, com zero call sites do helper e zero uso dos campos
  novos na UI.
- Decisão operacional: não fazer rollback automático nem alterar Production. O
  **GOAL 002C está bloqueado** até um trabalho separado de governança do pipeline e
  verificação read-only dos dois bancos:
  `DEPLOY-PRODUCTION-MIGRATION-GOVERNANCE-AUDIT-001`.
- Relatório:
  `docs/audits/PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md`.

**Numeração server-side de venda — código DORMENTE; schema aplicado em Production (30/07/2026)**
- Migration aditiva `0016_add_sale_numbering_infrastructure`, aplicada depois da
  `0015_contador_identidade_externa`: `series_venda`,
  `Store.codigoNumeracaoVenda` e 8 campos **nullable** em `Venda`; sem backfill,
  renumeração ou coluna obrigatória no histórico.
- Constraints: unique `(storeId, clientSaleId)`, unique
  `(serieVendaId, numeroSequencial)` e FK composta `(serieVendaId, storeId)`.
- `lib/vendas/server-sale-numbering.ts` é server-only e recebe o
  `Prisma.TransactionClient` do caller. A série anual é criada sob advisory lock e o
  número é reservado num único incremento atômico; rollback do caller reverte o contador.
- Formato futuro: `VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}`, ano civil do servidor em
  `America/Sao_Paulo`, teto 999.999 e falha fechada sem configuração/na exaustão.
- **O código não foi ativado:** nenhum writer/rota/PDV/importador chama o helper e a
  UI não usa os campos novos. O estado dos dados Production não foi consultado nesta
  auditoria e não permite afirmar que nenhuma loja recebeu código ou que todos os
  campos novos permanecem nulos.
- A suíte PostgreSQL real é opt-in via `SALE_NUMBERING_TEST_DATABASE_URL` e recusa host
  remoto. Fakes cobrem apenas contrato/rollback simulado, nunca são tratados como prova
  de lock ou concorrência real.
- **Readiness local em 03/08/2026:** base auditada
  `origin/main@1ed325912de50750a018903cda9c14be4f4df92d`; migration e upgrade de
  3 vendas legadas verdes em PostgreSQL 17.10 descartável, preservando os `pedidoId` e
  mantendo os 8 campos novos `NULL`.
- Em `READ COMMITTED`, 50 transações concorrentes na mesma loja/ano e 20 por loja em
  duas lojas produziram séries monotônicas, sem duplicidade, lacuna ou cruzamento.
  A criação inicial sob snapshot forte propagou `P2002` em `RepeatableRead` e `P2034`
  em `Serializable`; não há retry interno/global nesta infraestrutura. O futuro writer
  poderá repetir com limite somente a transação inteira classificada como `P2034`.
- A cadeia histórica bruta de migrations continua sem bootstrap integral por falha
  preexistente na `0005`; a prova partiu de banco vazio materializado pelo
  `schema-pre-0015.prisma`, registrou o baseline `0001..0014` e aplicou fisicamente
  `0015` + `0016`. A aplicação Production posterior ocorreu automaticamente pelo
  pipeline dos dois projetos, não por essa prova local.
- O **GOAL 002C permanece bloqueado** pela auditoria Production Classe C.

**Writer legado v1 — replay atômico e conflito permanente (28/07/2026)**
- `Venda` passou a ser **create-only**: não existe mais `upsert` permissivo no caminho compartilhado.
- Reenvio idêntico na mesma loja é replay sem novas escritas; divergência canônica vira
  `PEDIDO_ID_CONFLITO_MESMA_LOJA`; colisão entre lojas preserva `PEDIDO_ID_DE_OUTRA_LOJA`.
- Corrida `P2002` é classificada somente após rollback e releitura do vencedor fora da transação abortada.
- Os dois conflitos de identidade ficam em quarentena permanente no cliente: sem retry automático/manual,
  reenvio retroativo ou descarte; a recuperação exige ação administrativa explícita.
- Sem alteração de schema/migration e sem acesso ao Neon. A recuperação administrativa dos registros já
  conflitantes permanece fora deste escopo.

Última sprint concluída: **PDV_FASE0_IMPL_1** — commit `718591d`
- Operador real no comprovante (nome da sessão, não UUID)
- Badge de pendências de sincronização · saneamento do layout legado `"venda-completa"` · aviso de atualização PWA
- Status: **sem P0 ativo conhecido** · núcleo transacional preservado · auditoria Fase 0 concluída

### Próxima prioridade

1. **Validação operacional real na RafaCell**
2. Correções de uso real identificadas durante a operação
3. Conversão **Atendimento Rápido → OS Completa** com pré-preenchimento
4. Planejamento WhatsApp / Portal para Operações V3
5. BL-07 Multi-Depósito

> **Observação:** a prioridade atual **não é criar novos módulos** — é **estabilizar e validar em produção**
> Operações V3, Atendimento Rápido, Nova OS e PDV antes de abrir novas frentes estruturais.

---

### Operações V3 — Atendimento Rápido Real · serviço de balcão (11/06/2026)

**O que é:** a aba **Atendimento Rápido** era uma **casca** ("nada é gravado aqui; a criação real
fica na Nova OS Enterprise"). Agora é um **fluxo real e integrado** para registrar serviços rápidos de
balcão (transferência de dados, película, configuração de WhatsApp, criação/recuperação de conta,
instalação de app, limpeza simples, configuração de aparelho) que precisam **entrar no caixa** e ficar
**rastreáveis**. **Princípio:** reusar a espinha da V3, sem sistema paralelo e **sem schema novo**.

**Arquitetura (reuso, sem schema):** uma única action `finalizarAtendimentoRapidoV3` orquestra peças
existentes —
1. **Cliente** resolvido como **Cliente Balcão** (singleton por unidade, criado uma vez e reaproveitado —
   sem exigir CPF/telefone e sem duplicar cadastro), **novo** (`criarCliente`) ou **existente**;
2. **OS simplificada** via `criarOSEnterpriseV3` (serviço como item *serviço cobrado*; equipamento
   placeholder "Serviço rápido/Balcão" quando ausente — o modelo da OS exige marca/modelo; origem `balcao`);
3. **Recebimento** via `receberOSV3` (forma única dinheiro/PIX/débito/crédito) → **Conta a Receber** +
   movimentação + **`caixaOperacao recebimento_cr`** → entra no **fechamento do caixa** (separado por forma);
4. **Conclusão**: patch do payload → `operacaoStatusV3 = "entregue"` + tag `atendimentoRapidoV3` + timeline.
   Serviço-only ⇒ **nenhuma baixa de estoque**.

**Gate de caixa:** exige caixa **aberto** (validado na UI e no servidor); se fechado, bloqueia com aviso.
Em falha, **os dados do formulário são preservados** (não apaga). Em sucesso: limpa o form, recarrega a
lista e oferece **"Ver OS"**. Nasce **entregue** → aparece em Fila/Histórico/Workspace e nas métricas de
entregues.

**Catálogo de serviços:** **não há tabela persistente** no projeto — usa lista **curada** (`SERVICOS_RAPIDOS_V3`)
+ entrada **manual** com valor editável. Persistir um catálogo é follow-up (exige schema).

| Camada | Arquivo |
|---|---|
| Modelo puro | `lib/operacoes-v3/atendimento-rapido-model.ts` **(novo)** + `.test.ts` (11 testes) |
| Write-path | `lib/operacoes-v3/atendimento-rapido-actions.ts` **(novo)** (`finalizarAtendimentoRapidoV3` + Cliente Balcão singleton) |
| Tela | `components/operacoes-v3/pages/AtendimentoRapidoV3.tsx` **(reescrita)** |

**⚠️ Limitações / follow-up:** (a) **"Converter para OS completa"** abre a Nova OS Enterprise **sem
pré-preencher** (`abrirNovaOS()` não aceita seed) — como o atendimento já é uma OS, também dá para enriquecer
via "Ver OS" no Workspace; (b) **catálogo de serviços persistente** (precisa schema); (c) **split de pagamento**
no atendimento rápido (hoje forma única; `receberOSV3` já suporta split); (d) se a OS for criada e o
recebimento falhar depois (ex.: caixa fechado na corrida), fica uma OS aberta sem pagamento — caixa é checado
**antes**; rollback/retry é follow-up.

**Validação:** `tsc` ✅ · `vitest` (completo) **502 passed | 2 expected fail** (+11 do modelo) · `next build
--webpack` ✅ EXIT=0. **Commitado (`86914e9`) e pushado.**

**Não alterado:** schema Prisma/migrations, PDV de produtos/Vendas HUB, `finalizeSaleTransaction`, Financeiro
engine, estoque, WhatsApp/Portal, BL-07, Marketplace, Fiscal, Nova OS Enterprise, V2 (serviços de
OS/recebimento/caixa apenas **chamados**).

---

### Operações V3 — Fase 3C.0 · Espinha de Eventos (06/06/2026)

**O que é:** o blueprint da Fase 3C apontou que a V3 é **funcional, porém muda** — altera estados e
cria registros, mas não anuncia nada ao ecossistema. Esta fase a torna **produtora oficial de eventos**.
**Produtora-only:** publica em memória + notifica assinantes locais; **não** entrega externamente
(WhatsApp/Meta/Portal/Prisma/event-bus global estão **fora do escopo** — o consumo real é a 3C.1+).
Escopo 100% em `lib/operacoes-v3/**` (nenhuma tela tocada).

**1. Inventário (10 eventos oficiais):** `os_criada`, `os_orcamento_criado`, `os_orcamento_aprovado`,
`os_aguardando_peca`, `os_pronta`, `os_entregue`, `os_garantia_criada`, `os_garantia_expirada`,
`os_retorno_aberto`, `os_retorno_finalizado` — cada um com label/descrição/origem esperada (`EVENTOS_V3`).

**2. Payload consistente:** `{ tipo, osId, numeroOS, clienteId, clienteNome, status, loja, timestamp,
metadata }`. `construirEventoV3` monta a partir da OS; `status` vem da **máquina única**
(`statusV3FromOS`) — mesma fonte da timeline, então **evento e timeline nunca divergem**. `origem`
(write-path emissor) viaja em `metadata` (observabilidade).

**3. Publisher único:** `emitirEventoOperacaoV3` é o **único** ponto de emissão — nenhuma tela/ação
emite "na mão". **Nunca lança** (best-effort: evento inválido é descartado com motivo; assinante que
falha é isolado; falha ao montar payload é capturada). Valida via `validarEventoV3`.

**4. Integração (6 write-paths, 1–3 linhas cada):** `nova-os-actions` → `os_criada`; `status-actions`
→ `statusV3ParaEvento(to)` (pronta/aguardando_peca/entregue; demais status sem evento dedicado);
`orcamento-actions` → `os_orcamento_criado` (enviar) e `os_orcamento_aprovado` (aprovar);
`entrega-actions` → `os_entregue` (caminho canônico da entrega formal); `retorno-actions` →
`os_retorno_aberto`/`os_retorno_finalizado`; `garantia-actions` → `os_garantia_criada`. Emissão sempre
**após** o `prisma.update` bem-sucedido (só anuncia estado real).

**6. Observabilidade (debug simples, sem painel):** ring buffer em memória (últimos 50) +
`console.debug`/`warn` quando `OPERACOES_V3_EVENT_DEBUG=1` ou `setDebugOperacaoEventoV3(true)`. Mostra
**evento emitido + payload + origem**. `lerDebugEventosV3()` lê o buffer; `subscribeOperacaoEventoV3`
é o gancho para o bridge da 3C.1 (sem alterar modelo/publisher).

| Camada | Arquivo |
|---|---|
| Modelo puro | `lib/operacoes-v3/event-model.ts` **(novo)** + `event-model.test.ts` (14 testes) |
| Publisher | `lib/operacoes-v3/event-publisher.ts` **(novo)** + `event-publisher.test.ts` (7 testes) |
| Integração | `nova-os-actions.ts` · `status-actions.ts` · `orcamento-actions.ts` · `entrega-actions.ts` · `retorno-actions.ts` · `garantia-actions.ts` (import + emissão cirúrgica) |

**⚠️ Limitações conscientes:** (a) `os_garantia_expirada` é **definido, sem emissor** — expiração é
derivada na leitura (`pos-venda-model`) e exige gatilho temporal (job/cron) da 3C.3; (b) sem entrega
externa — assinantes só existirão na 3C.1; (c) o buffer é por-instância de servidor (debug, não
auditoria persistente); (d) `os_entregue` pode sair de dois caminhos (entrega formal × transição de
status) — dedup é responsabilidade do consumidor (3C.1), distinguível por `metadata.origem`.

**Validação:** `tsc` ✅ (0 erros) · `vitest run lib/operacoes-v3` ✅ **134 passed** (+21) · `vitest`
(completo) **421 passed | 2 expected fail** · `build` ✅ EXIT=0 (98 rotas via `next build --webpack`;
1ª execução abortou no flake de memória do worker Windows — `memory allocation failed`/0xC0000409,
ambiental, idêntico às fases anteriores —, **passou no retry** com `--max-old-space-size=8192`).
**Commitado — Fase 3C.0 concluída.**

**Não alterado:** schema Prisma/migrations, WhatsApp/Meta, Portal Cliente, rotas públicas, auth,
Marketplace, Fiscal, BL-07, PDV, Financeiro HUB, Operações V2, event-bus global (`lib/events`),
`@/types/os`, telas `components/operacoes-v3/**`.

---

### Operações V3 — Fase 3B · Técnicos, Bancada e Produção (06/06/2026)

**O que é:** transforma a V3 em ferramenta real de **bancada** para controlar a produção interna —
técnicos, filas, prioridade, SLA, produtividade. **Foco não-financeiro.** Escopo 100% em
`lib/operacoes-v3/**` e `components/operacoes-v3/**`.

**1. Bancada (reescrita):** **Produção do dia** (em diagnóstico/execução/prontas/atrasadas/sem técnico/
entregues hoje), **Fila de produção** (Aguardando diagnóstico · Em diagnóstico · Aguardando peça · Em
execução · Pronta — colunas mapeadas direto na máquina de status) e **OS por técnico** (grupo **"Sem
técnico"** sempre visível) com **prioridade, status, SLA, valor, cliente, aparelho e próxima ação**.

**2. Atribuir técnico:** no Workspace (bloco Produção/Técnico) — atribuir/alterar/remover com **datalist**
de técnicos conhecidos + digitação livre. `atribuirTecnicoV3` grava em **`payload.tecnico`** (fonte que a
UI já lê) + timeline `atribuicao_tecnico`. Id estável por slug do nome.

**3/8. Ações rápidas (máquina única):** iniciar diagnóstico / iniciar execução / marcar pronta via
`proximaAcaoV3` (= `acaoPrimariaV3`) → `mudarStatus` (`aplicarTransicaoStatusV3`). **Sem novo fluxo de
status.** Eventos saem como `mudanca_status` (item 10).

**5. Prioridade V3:** baixa/normal/alta/urgente/**garantia-retorno** em `payload.prioridadeV3` (fallback do
`os.prioridade` V2). Mostrada em **Fila/Bancada/Workspace/Dashboard** (chip no `OSCardV3` + seletor no
Workspace) e usada para **ordenar** (desempate por SLA/prazo). Timeline `observacao` (`prioridade_alterada`).

**6. SLA simples:** `lerSlaV3` → **No prazo / Em risco (≤24h ou alerta) / Atrasada / Sem prazo** a partir de
`os.sla` + previsão da recepção; OS finalizada não fica atrasada. `calcularAtrasoMinutosV3` dá o atraso.

**7. Métricas por técnico (reais):** total atribuídas, em execução, prontas, atrasadas, entregues hoje
(`metricasPorTecnicoV3`). Tela Técnicos atualizada; tempo médio/comissão seguem "a conectar".

**9. Workspace:** bloco **Produção / Técnico** (técnico, prioridade, SLA, localização física, status de
bancada + próxima ação).

| Camada | Arquivo |
|---|---|
| Modelo puro | `lib/operacoes-v3/producao-model.ts` **(novo)** + `producao-model.test.ts` (14 testes) |
| Write-paths | `lib/operacoes-v3/producao-actions.ts` **(novo)** (`atribuirTecnicoV3`/`definirPrioridadeV3`) |
| Hook | `components/operacoes-v3/hooks/use-producao-v3.ts` **(novo)** |
| Componentes | `components/operacoes-v3/components/{PrioridadeBadgeV3,ProducaoTecnicoV3}.tsx` **(novos)** + `OSCardV3.tsx` (chip) |
| Telas | `pages/{BancadaV3 (reescrita),OSWorkspaceV3,DashboardV3,TecnicosV3}.tsx` |

**⚠️ Limitações:** persistência em `payload` (sem schema); **sem catálogo de técnicos** (lista derivada das
OS + digitação, id por slug); prioridade "garantia/retorno" é escolhida (não auto-setada por retorno); SLA
depende de prazo/previsão existir; tempo médio/comissão ficam para o futuro.

**Validação:** `tsc` ✅ · `vitest run lib/operacoes-v3` ✅ **113 passed** · `vitest` (completo) **400 passed |
2 expected fail** · `build` ✅ (98 rotas; `next build --webpack` no fallback — `npm run build` esbarra no
lock do prisma engine no Windows, ambiental).

**Não alterado:** schema Prisma/migrations, PDV principal, Financeiro HUB, WhatsApp, Marketplace, Fiscal,
BL-07, Operações V2.

---

### Operações V3 — Fase 3A · Entrega Técnica + Retornos + Garantias Ativas (04/06/2026)

**O que é:** transforma a V3 numa ferramenta completa de **pós-venda** da assistência — entrega,
garantia, retorno, acompanhamento. **Foco não-financeiro.** Escopo 100% em `lib/operacoes-v3/**` e
`components/operacoes-v3/**`.

**1. Entrega formal (PRONTA/RECEBIDA → ENTREGUE):** `registrarEntregaV3` grava **data/hora + operador
(sessão) + quem retirou + observação** em `payload.entregaV3` (+ popula `entregueEm`/`retirada` legados).
Timeline obrigatória: `entrega_cliente` (+ `mudanca_status` implícito por RECEBIDA quando parte de
PRONTA). Regras de status vêm da **máquina única** (1B). **Sem baixar estoque.**

**2. Termo de Entrega:** `TermoEntregaDocV3` (novo) — nº OS, cliente, equipamento, serviço realizado,
data de entrega, recebido por, assinaturas. Integrado ao **`PrintPreviewV3`** (novo tipo `termo_entrega`)
— **a impressão principal da OS não foi tocada**.

**3/4. Garantias ativas × vencidas:** `lerGarantiaV3` conta a garantia **a partir da entrega** →
situações **nenhuma · sem_cobertura · prevista · ativa · vencida** com **início, vencimento e dias
restantes**. Tela **Garantias** segmenta Ativa / Vencendo (≤15d) / Vencida / Prevista (cliente,
equipamento, tipo, datas, dias).

**5. Retorno em garantia:** `abrirRetornoV3`/`finalizarRetornoV3` — retorno **vinculado à OS original**
(`payload.retornosV3[]` com `osOriginalId`, motivo, autor, snapshot `garantiaAtivaNaAbertura`). Timeline
cruzada: `garantia_acionada` (criado) / `observacao` (finalizado). Retorno é **registro embutido** na OS
original (sem nova linha de OS / sem schema).

**6. Histórico de retornos:** por OS (Workspace) e **por cliente** (`retornosDoClienteV3`); tela
**Retornos** lista todos (OS/cliente/motivo/datas/status) + KPIs.

**7. Workspace — seção Pós-venda:** `PosVendaV3` (entrega + garantia + retornos + histórico do cliente),
com ações reais e botão **Imprimir Termo de Entrega**.

**8. Dashboard — KPIs pós-venda:** garantias ativas, garantias vencendo, retornos em aberto e **taxa de
retorno** (OS com retorno ÷ entregues). Sem BI complexo.

| Camada | Arquivo |
|---|---|
| Modelo puro | `lib/operacoes-v3/pos-venda-model.ts` **(novo)** + `pos-venda-model.test.ts` (15 testes) |
| Entrega | `lib/operacoes-v3/entrega-actions.ts` **(novo)** |
| Retorno | `lib/operacoes-v3/retorno-actions.ts` **(novo)** |
| Termo de Entrega | `print-model.ts` (`montarTermoEntregaV3`) · `documentos.ts` (`termo_entrega`) · `garantia-actions.ts` (label) · `print/TermoEntregaDocV3.tsx` **(novo)** · `print/PrintPreviewV3.tsx` |
| Workspace | `components/operacoes-v3/components/PosVendaV3.tsx` **(novo)** + `hooks/use-pos-venda-v3.ts` **(novo)** + `pages/OSWorkspaceV3.tsx` |
| Telas | `pages/GarantiasV3.tsx` (reescrita) · `pages/RetornosV3.tsx` (placeholder→real) · `pages/DashboardV3.tsx` (KPIs) |

**⚠️ Limitações:** garantia "vencida" é **derivada** (sem job de expiração) — marcada em timeline ao abrir
retorno fora de cobertura; retorno é **registro embutido** (não OS separada); entrega é **status-only**
(sem estoque/garantia material); tipos de evento reusam o union existente (`@/types/os` intacto).

**Validação:** `tsc` ✅ · `vitest run lib/operacoes-v3` ✅ **99 passed** · `vitest` (completo) **386 passed
| 2 expected fail** · `build` ✅ (98 rotas; `next build --webpack` no retry — `npm run build` esbarra no
lock do prisma engine/worker do Windows, ambiental).

**Não alterado:** schema Prisma/migrations, PDV principal, Financeiro HUB, WhatsApp, Marketplace, Fiscal,
BL-07, V2.

---

### Operações V3 — Fase 2B · Recebimento Avançado + Fechamento Operacional (04/06/2026)

**O que é:** evolui o PDV de Serviço para fechar o fluxo real da assistência — split de pagamento,
rótulos de recebimento, comprovante, estorno auditado e avanço de status pós-quitação.

**1. Split:** um recebimento aceita N formas (`linhas: [{forma, valor}]`); a soma é validada contra o
saldo (`validarSplitV3` — motor único, barra valor > saldo). No banco: **um único lançamento** do total
no título de Conta a Receber (estorno limpo) **+ uma `caixaOperacao recebimento_cr` por forma**
(fechamento separa por forma; dinheiro entra na gaveta).

**2. Sinal/entrada/parcial/quitação:** rótulo selecionável (sinal/entrada/parcial); **quitação é
derivada** quando o recebimento zera o saldo. O rótulo aparece na timeline, no comprovante e no caixa.

**3. Comprovante:** `ReciboPreviewV3` (novo) — modal portado ao body + `@media print`, **componente
separado** (não toca a impressão principal da OS). Nº OS, cliente, equipamento, formas, valor pago,
saldo restante, situação, data/hora, operador, assinatura.

**4. Estorno auditado:** `estornarRecebimentoOSV3` reusa o serviço existente `estornarContaReceber`
(modo `ultimo_pagamento`) — exige caixa aberto + período não fechado; reverte o último lançamento do
título único, atualiza espelho + timeline (`financeiro_conta_receber_atualizada`) e registra
`caixaOperacao estorno_recebimento_cr` (auditoria da sessão).

**5. Entregar e receber / avanço de status:** após quitar, o PDV oferece **Avançar para Recebida** e
**Marcar como Entregue** (máquina única 1B) — **status-only, sem baixar estoque**.

**6. Caixa/fechamento (confirmado):** `aggregateCaixaOperacoes` já soma `recebimento_cr` em
"recebimentos de contas" (separado de vendas) e a parcela em dinheiro na gaveta.

| Camada | Arquivo |
|---|---|
| Modelo (split/intenção/comprovante) | `lib/operacoes-v3/payment-model.ts` |
| Comprovante (componente) | `components/operacoes-v3/components/print/ReciboPreviewV3.tsx` **(novo)** |
| Action (receber split + estorno + caixa por forma) | `lib/operacoes-v3/pdv-servico-actions.ts` |
| Hook | `components/operacoes-v3/hooks/use-pdv-servico-v3.ts` |
| UI | `components/operacoes-v3/pages/PdvServicoV3.tsx` |
| Testes | `lib/operacoes-v3/os-conta-receber-unica.test.ts` (+5) |

**⚠️ Limitação consciente:** o estorno é gravado para auditoria, mas o fechamento ainda **não abate**
`estorno_recebimento_cr` da gaveta (o helper `lib/caixa-fechamento-resumo.ts` é compartilhado com o PDV
principal e ficou fora de escopo) — fazer estornos na mesma sessão; netting é follow-up 2C.

**Validação:** `tsc` ✅ · `vitest run lib/operacoes-v3` ✅ **84 passed** · `vitest` (completo) **371 passed
| 2 expected fail** · `build` ✅ (98 rotas; `next build --webpack` no retry — `npm run build` esbarra no
lock do prisma engine/worker do Windows, ambiental). **Não commitado.**

**Não alterado:** schema/migration, Financeiro HUB, adapter/contas-receber-service (só **chamados**),
PDV de vendas, `lib/caixa-fechamento-resumo.ts`, V2, WhatsApp, Marketplace, Fiscal, BL-07.

---

### Operações V3 — Correção 2A.1 · Conta a Receber única por OS (04/06/2026)

**Problema (auditoria 2A):** a V3 (PDV de Serviço) criava título `receber:os:*` enquanto o adapter
V2 criava `os-faturamento:*` — chaves diferentes → risco **real** de **duas Contas a Receber para a
mesma OS** (e, na ordem V3→V2, recebimento duplicado / título órfão).

**Correção:** **chave ÚNICA por OS** compartilhada por V2 e V3 — `os-faturamento:{storeId}:{osId}`,
gerada pelo contrato oficial `buildContaReceberLocalKey({ kind: "adapter_os_faturamento" })`. Como
`ContaReceberTitulo` é `@@unique(storeId, localKey)`, o **banco** garante **um único título por OS**.
`resolverTituloOS` **reaproveita** o título existente (criado pela V2 OU por recebimento V3 anterior)
e **nunca cria `receber:os:*`**. Cancelar a OS na V3 faz **best-effort** de cancelar o título único
(sem órfão); o cancelamento V2 já mira a mesma chave.

| Arquivo | Mudança |
|---|---|
| `lib/operacoes-v3/payment-model.ts` | `localKeyReceberOSV3`/`localKeyAdapterOSV3` → **uma** `localKeyContaReceberOSV3` via contrato (mata o drift de string) |
| `lib/operacoes-v3/pdv-servico-actions.ts` | `resolverTituloOS` com chave única (reaproveita; sem `receber:os:*`) |
| `lib/operacoes-v3/status-actions.ts` | cancelar OS → `cancelContaReceber` best-effort na chave única (exceção 2A.1 documentada) |
| `lib/operacoes-v3/payment-model.test.ts` | teste de chave = adapter V2, nunca `receber:os:*` |
| `lib/operacoes-v3/os-conta-receber-unica.test.ts` **(novo)** | 8 testes de integração (Prisma em memória + funções de produção + adapter V2 real) |

**Compatibilidade:** V2 intacta (adapter/serviços só **chamados**, não alterados); o pagamento feito
na V3 é **preservado** se a V2 faturar depois (o `historico` sobrevive ao upsert do adapter). **Sem
dado legado a migrar** (a 2A nunca foi releasada → não há `receber:os:*` em nenhum banco).

**Validação:** `tsc` ✅ · `vitest` ✅ **366 passed | 2 expected fail** (35 arquivos) · `build` ✅ (98
rotas via `next build --webpack`; `npm run build` esbarra no lock do prisma engine no Windows —
ambiental). **Não commitado.**

**Não alterado:** schema/migration, Financeiro HUB, adapter `os-faturamento.ts`, contas-receber-service,
PDV de vendas, V2, WhatsApp, Marketplace, BL-07.

---

### Operações V3 — Fase 2A · PDV de Serviço Real (recebimento da OS) (03/06/2026)

**O que é:** o **PDV de Serviço** passa a **receber pagamento de OS de verdade**, reusando os serviços
financeiros existentes (Conta a Receber + Caixa) — sem motor duplicado, sem tocar PDV de vendas/V2/
schema. Exige **caixa ABERTO** + período não fechado; garante um **título de Conta a Receber
idempotente**; baixa **total/parcial** via `liquidarContaReceber`/`registrarPagamentoParcial` (proteção
contra valor > saldo já nos services); lança **movimentação** e registra **`caixaOperacao
recebimento_cr`** (entra no **caixa do dia/fechamento**); espelha o status (`sem_cobranca/aberto/
parcial/quitado`) em `payload.pagamentoV3` + evento na timeline.

**UI/UX:** tela PDV de Serviço (seleção de OS cobrável, formas dinheiro/PIX/débito/crédito —
parcelado/crediário/carteira "a conectar" —, validação, gate de caixa). **Status de pagamento** em
Header/Fila/Workspace; botão **"Receber no PDV de Serviço"** no Workspace.

| Arquivo | Papel |
|---|---|
| `lib/operacoes-v3/payment-model.ts` **(novo, puro)** | saldo/status, validação, formas, split, espelho, chave do título |
| `lib/operacoes-v3/payment-model.test.ts` **(novo)** | testes do modelo |
| `lib/operacoes-v3/pdv-servico-actions.ts` **(novo, use server)** | recebimento real (caixa + CR + movimentação + espelho + timeline) |
| `components/operacoes-v3/hooks/use-pdv-servico-v3.ts` **(novo)** | estado client (ler/receber) |
| `components/operacoes-v3/pages/PdvServicoV3.tsx` **(reescrito)** | tela de recebimento |
| `components/operacoes-v3/components/OSHeaderV3.tsx` · `pages/FilaOSV3.tsx` · `pages/OSWorkspaceV3.tsx` | status de pagamento real + handoff p/ PDV de Serviço |

**⚠️ Limitações (→ 2B):** split multi-forma modelado mas não cabeado; parcelado/crediário/carteira "a
conectar"; sem comprovante de recebimento; sem estorno V3; "Entregar e receber" só navega (não muda
status). O **risco de chave duplicada** desta fase foi **corrigido na Correção 2A.1** (acima).

**Validação:** `tsc` ✅ · `vitest` ✅ (lib/operacoes-v3 **71 passed** ao fim da 2A) · `build` ✅.
**Não commitado.**

**Não alterado:** schema/migration, Financeiro HUB, V2, `@/types/os`, PDV de vendas, WhatsApp,
Marketplace, BL-07.

---

### Operações V3 — Fase 1E · Garantias Profissionais + Documentos Operacionais (03/06/2026)

**O que é:** profissionaliza a camada documental — garantia e documentos como recursos de 1ª classe.
Tudo **side-effect-free** (só `payload` + timeline); **sem** schema/Financeiro/caixa/PDV/V2.

**1. Biblioteca de garantias** (`lib/operacoes-v3/garantia-textos.ts`, centralizado): `GARANTIA_CATALOGO_V3`
com 11 modelos — tela, bateria, conector, câmera, alto-falante, microfone, software, **placa** (novo),
oxidação, sem garantia, personalizado. Cada um: **título · prazo padrão · cobertura · exclusões ·
observações**. `gerarTermoGarantiaV3` monta o termo; oxidação/sem-garantia deixam claro que **não há
cobertura**. "Placa" também entrou no seletor da Nova OS (`GARANTIA_MODELOS_V3`).

**2. Sugestão automática (item 4):** `sugerirGarantiaPorDescricaoV3` (palavras-chave) +
`sugerirGarantiaDaOSV3` (varre os serviços cobrados da OS) → "Troca de tela" sugere garantia de tela,
"bateria" → bateria, "reballing/placa" → placa, etc. O usuário pode alterar manualmente.

**3. Documentos (`lib/operacoes-v3/documentos.ts`):** catálogo `DocumentoTipoV3` —
`os_cliente` (1D), `termo_garantia`, `comprovante_interno`, `etiqueta`. O preview (`PrintPreviewV3`) virou
**multi-tipo**, renderizando o componente certo por tipo.
- **Termo de Garantia** (`TermoGarantiaDocV3`): documento dedicado (cliente, equipamento, serviço
  realizado, garantia aplicada, prazo, cobertura, exclusões, assinatura) — imprime só a garantia.
- **Via Interna** (`OSPrintDocumentV3` variante `interna`): mostra **custo interno, lucro estimado, itens
  internos e observações internas** + tarja "NÃO ENTREGAR AO CLIENTE". O cliente **nunca** vê esses dados.
- **Etiqueta técnica** (`EtiquetaTecnicaV3`): nº OS, cliente, equipamento, status, técnico (estrutura
  inicial; térmica fica para o futuro).

**4. Workspace — aba Garantia (itens 5/6):** `GarantiaOSV3` agora mostra tipo/prazo/validade/situação,
exibe a **sugestão** (com "Aplicar"), permite **escolher modelo/prazo e Salvar** (`salvarGarantiaOSV3` →
`payload.aberturaV3.garantiaPrevista` + evento `garantia_gerada`/alterada na timeline) e **Imprimir termo**.
Botões de documentos no rodapé: **Imprimir OS · Imprimir Garantia · Via Interna · Etiqueta**. Cada
impressão registra `documento_impresso` (auditável, best-effort via `registrarImpressaoDocumentoV3`).

**Diferença cliente × interno:** a via cliente **exclui** item interno, custo e observação interna; a via
interna **inclui** custo/lucro/itens internos/obs internas. Garantido por testes.

| Camada | Arquivo | Papel |
|---|---|---|
| Biblioteca | `lib/operacoes-v3/garantia-textos.ts` **(reescrito)** | Catálogo 11 modelos + termo + sugestão por descrição |
| Documentos | `lib/operacoes-v3/documentos.ts` **(novo)** | Tipos/rótulos/estado dos 4 documentos |
| Modelo impressão | `lib/operacoes-v3/print-model.ts` **(estendido)** | Variante interna (`blocoInternoV3`), `montarTermoGarantiaDocV3`, `montarEtiquetaV3`, `sugerirGarantiaDaOSV3` |
| Write-paths | `lib/operacoes-v3/garantia-actions.ts` **(novo, use server)** | `salvarGarantiaOSV3` + `registrarImpressaoDocumentoV3` (payload + timeline) |
| Hook | `components/operacoes-v3/hooks/use-garantia-v3.ts` **(novo)** | salvar garantia + registrar impressão |
| Docs print | `components/operacoes-v3/components/print/{TermoGarantiaDocV3,EtiquetaTecnicaV3}.tsx` **(novos)** + `OSPrintDocumentV3` (interna) + `PrintPreviewV3` (multi-tipo) | Componentes A4 |
| Aba garantia | `components/operacoes-v3/components/GarantiaOSV3.tsx` **(reescrito)** | Editar + sugestão + imprimir termo |
| Workspace | `components/operacoes-v3/pages/OSWorkspaceV3.tsx` **(alterado)** | Botões de documentos + estado `printTipo` |
| Testes | `lib/operacoes-v3/print-model.test.ts` **(estendido)** | +6 (catálogo/placa, sugestão, documentos, via interna, termo, etiqueta) |

**⚠️ Limitações:** renovação/retorno de garantia = futuro (estrutura preparada); etiqueta sem térmica;
endereço completo do cliente não impresso (a OS não persiste esses campos). Sem recebimento/caixa.

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npx vitest run lib/operacoes-v3` ✅ **61 passed**
(11 status + 8 orçamento + 8 nova OS + 13 workspace + 21 impressão/garantia/documentos). `build` rodado
ao final do lote (junto da Fase 2A). **Não commitado.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **V2**, `@/types/os`, **PDV**, **Financeiro HUB**,
**Caixa**, **WhatsApp**, **Marketplace**, **Fiscal**, **BL-07**.

---

### Operações V3 — Fase 1D · Impressão Enterprise da OS (03/06/2026)

**O que é:** o botão **Imprimir** do OS Workspace gera um **documento profissional A4** da OS (via
cliente), pronto para imprimir/entregar ou **salvar como PDF** pelo navegador. Documento **híbrido** —
completo como o modelo Gestão Click, limpo como o Smart System. **Apenas documento**: nada de
recebimento, caixa, Financeiro, PDV, schema ou V2.

**Como abrir:** no Workspace de uma OS, **Imprimir** (cabeçalho) ou **Imprimir OS** (rodapé) abre o
**preview modal** `PrintPreviewV3`, **portado para `document.body`** (escapa do AppShell). O preview tem
toolbar **Imprimir / Voltar** (`data-no-print`) e injeta CSS `@media print` (`@page A4`) que esconde toda
a app e imprime **somente** `#og-print-root`. **Escolha de engenharia:** modal (não rota nova) — mais
seguro/simples, sem mexer no layout do dashboard nem no gate de auth, reusando a OS já carregada.

**Dados que entram no documento:** cabeçalho (logo + nome/CNPJ/endereço/cidade-UF/telefone/e-mail da
**unidade ativa** via `useLojaAtiva().empresaDocumentos`, com **fallback honesto centralizado** em
`dadosEmpresaPrintV3`), nº da OS em destaque, status, data de criação e de impressão; cliente
(nome/telefone/doc/e-mail); equipamento (tipo/marca/modelo/IMEI-série, **senha padrão 3×3 desenhada**,
acessórios, condição, defeito relatado); checklist de entrada compacto (item: OK/Ruim/N/T);
diagnóstico (inicial/final/causa/solução) + observações; tabela de itens; resumo financeiro previsto;
termo de garantia; assinaturas cliente/técnico + declaração de ciência.

**O que fica OCULTO do cliente (regras críticas):** **item interno** (`kind="interno"`) não aparece;
**custo interno NUNCA** aparece (a tabela só expõe valor ao cliente/subtotal); **observação interna**
(`interna=true`) é filtrada. **Brinde** aparece como "Brinde" / **R$ 0,00**. Tudo testado.

**Garantia:** gerada por **modelo** no helper centralizado `lib/operacoes-v3/garantia-textos.ts`
(`gerarTermoGarantiaV3`) — cobertura + exclusões claras, linguagem não-abusiva; **oxidação** e
**sem garantia** deixam explícito que **não há cobertura**; **personalizado** usa o texto livre da OS.
Lido da `aberturaV3.garantiaPrevista` (modelo/prazo/termo) definida na Nova OS.

**Financeiro (só previsão, sem recebimento real):** subtotal/desconto/total do orçamento +
**sinal/recebido previsto**, **saldo previsto**, **forma**, **vencimento** e **observação** — lidos de
`aberturaV3.pagamentoPrevisto`. Nada é registrado em caixa/Conta a Receber.

| Camada | Arquivo | Papel |
|---|---|---|
| Garantia | `lib/operacoes-v3/garantia-textos.ts` **(novo)** | Termo profissional por modelo (cobertura/exclusões; oxidação/sem-garantia sem cobertura) |
| Modelo impressão | `lib/operacoes-v3/print-model.ts` **(novo, puro)** | Empresa (fallback), itens imprimíveis (oculta interno/custo), financeiro previsto, checklist/senha, `montarDocumentoOSV3` |
| Testes | `lib/operacoes-v3/print-model.test.ts` **(novo)** | 15 testes (oculta interno/custo, brinde 0, financeiro, senha 3×3, garantia, doc completo) |
| Documento A4 | `components/operacoes-v3/components/print/OSPrintDocumentV3.tsx` **(novo)** | Render puro do `DocumentoOSV3` (variante cliente; preparado p/ interna/etiqueta) |
| Preview | `components/operacoes-v3/components/print/PrintPreviewV3.tsx` **(novo)** | Modal portado ao body + CSS print + toolbar |
| Workspace | `components/operacoes-v3/pages/OSWorkspaceV3.tsx` **(alterado)** | Botões Imprimir abrem o preview; mapeia empresa da unidade ativa |

**Exceção de tokens (documentada):** o documento A4 usa **cores fixas branco/preto/cinza**
(`bg-white`/`text-black`/`text-zinc-*`/`border-zinc-*`), confinadas a `OSPrintDocumentV3.tsx` — é um
documento impresso (não UI da app), conforme exceção do CORE_RULES §7.

**⚠️ Limitações conscientes:** só a **via cliente** (interna/etiqueta/termo-separado ficam estruturados
para o futuro via prop `variante`); endereço completo do cliente não é impresso porque a OS não persiste
esses campos (Nova OS guarda só nome/telefone/doc/e-mail no snapshot da OS) — campos ausentes são
ocultados, sem inventar dado; sem recebimento/caixa/Financeiro/estoque.

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npx vitest run lib/operacoes-v3` ✅ **55 passed**
(11 status + 8 orçamento + 8 nova OS + 13 workspace + **15 impressão/garantia**) · `npm run build` →
**compilação webpack limpa** (3 execuções), mas a **coleta/geração de páginas** aborta com flakes de
worker do Windows (`spawn UNKNOWN` / código 134 SIGABRT / `VirtualAlloc failed`) — **ambiental/memória**,
idêntico às fases anteriores, **não** oriundo deste código (rota `/dashboard/operacoes-v3` é dinâmica).
Conforme combinado, confirmados **tsc + vitest**. **Não commitado.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **Operações V2**, `@/types/os`, **PDV**,
**Financeiro HUB**, **WhatsApp**, **Marketplace**, **Fiscal**, **BL-07**.

---

### Operações V3 — OS Workspace Enterprise · prontuário do equipamento (03/06/2026)

> Pedido do usuário rotulado como "Fase 1C"; como já houve uma Fase 1C (orçamento), aqui é
> documentado como **OS Workspace Enterprise** para evitar colisão de nome.

**O que é:** transforma o **OS Workspace** na tela principal de trabalho do técnico e do atendente
(referências: Gestão Click, Smart System, fluxo RafaCell). Ao abrir uma OS, abre-se um **prontuário do
equipamento** com (quase) toda a operação numa tela só — **sem PDV, Financeiro, WhatsApp ou visual
premium** nesta fase.

**Modelo (sem schema, sem `@/types/os`):** `lib/operacoes-v3/workspace-model.ts` (puro) lê os campos
operacionais do que já existe + extras no `payload`: checklist (`payload.checklist`, compatível V2),
senha (`senhaEquipamento`/`senhaEquipamentoTipo`), acessórios (`equipamento.acessorios`), diagnóstico
técnico (`payload.diagnosticoV3`, **campo novo**), recepção (`payload.aberturaV3.recepcao`, da Nova OS),
e a **timeline operacional derivada** (status + eventos; nunca inventa data/responsável).

**Write-paths side-effect-free:** `lib/operacoes-v3/workspace-actions.ts` (`"use server"`) grava SOMENTE
o `payload` via Prisma + um evento de auditoria na timeline — **não** muda status, **não** mexe em
`valorTotal`, **não** chama `updateOSPayload` do V2 (que sincroniza Financeiro). Três ações:
`salvarChecklistEntradaV3`, `salvarSenhaAcessoriosV3`, `salvarDiagnosticoV3`.

| Camada | Arquivo | Papel |
|---|---|---|
| Modelo puro | `lib/operacoes-v3/workspace-model.ts` **(novo)** | Checklist/senha/diagnóstico/recepção readers + `construirTimelineOperacionalV3` + `lerHistoricoV3` |
| Write-path | `lib/operacoes-v3/workspace-actions.ts` **(novo, use server)** | Salva checklist/senha-acessórios/diagnóstico no payload + timeline; sem efeitos colaterais |
| Testes | `lib/operacoes-v3/workspace-model.test.ts` **(novo)** | 13 testes (checklist, senha, diagnóstico, recepção, timeline por status/evento/cancelada, histórico) |
| Hook | `components/operacoes-v3/hooks/use-workspace-v3.ts` **(novo)** | `salvarChecklist/salvarSenhaAcessorios/salvarDiagnostico` (pending/erro) |
| Timeline | `components/operacoes-v3/components/OSTimelineV3.tsx` **(novo)** | Stepper de 8 etapas (item 3) |
| Checklist | `components/operacoes-v3/components/ChecklistEntradaV3.tsx` **(novo)** | 13 itens × 3 estados, editável + salvar (item 4) |
| Senha/acess. | `components/operacoes-v3/components/SenhaAcessoriosV3.tsx` **(novo)** | Senha (3 tipos, padrão 3×3) + acessórios, editável + salvar (item 5) |
| Diagnóstico | `components/operacoes-v3/components/DiagnosticoTecnicoV3.tsx` **(novo)** | Inicial/final/causa/solução, editável + salvar (item 6) |
| Serviços | `components/operacoes-v3/components/ServicosExecutadosV3.tsx` **(novo)** | Read-only; qtd + valor ao cliente; **nunca custo** (item 7) |
| Anexos | `components/operacoes-v3/components/AnexosV3.tsx` **(novo)** | Estrutura MVP antes/depois (item 8) |
| Garantia | `components/operacoes-v3/components/GarantiaOSV3.tsx` **(novo)** | Situação + validade + termo, preparada p/ impressão (item 9) |
| Histórico | `components/operacoes-v3/components/OSHistoricoV3.tsx` **(novo)** | Timeline completa auditável (item 10) |
| Pad 3×3 | `components/operacoes-v3/components/PatternPadV3.tsx` **(novo)** | Extraído da Nova OS; reusado no Workspace |
| Cabeçalho | `components/operacoes-v3/components/OSHeaderV3.tsx` **(enriquecido)** | + IMEI/série, entrada, previsão, marca/modelo + slot de ações rápidas (item 2) |
| Workspace | `components/operacoes-v3/pages/OSWorkspaceV3.tsx` **(reescrito)** | Prontuário contínuo com âncoras (#checklist/#senha/#diagnostico/#orcamento/#servicos/#garantia/#anexos/#historico) |

**Campos adicionados ao payload:** `diagnosticoV3 { inicial, final, causa, solucao, atualizadoEm, atualizadoPor }`
(novo); `checklist` passa a ser gravado pela V3 (lista V3 de 13 itens) mantendo o shape `ChecklistItem`;
`senhaEquipamento`/`senhaEquipamentoTipo` e `equipamento.acessorios` reescritos pelo bloco Senha. Cada
edição anexa um evento à `timeline` (`checklist_finalizado` / `observacao` / `diagnostico_registrado`).

**⚠️ Limitações conscientes (escopo):** anexos são **estrutura MVP** (sem upload real — "Adicionar" é toast
honesto); impressão de OS/termo de garantia é **placeholder**; recebimento/caixa/Financeiro/portal/BI/
estoque real **não** implementados; a timeline de "Recebida" (intake) usa a data de entrada/criação, pois
o status `recebida` da máquina V3 é um marco posterior — as duas semânticas coexistem sem inventar dado.

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npx vitest run lib/operacoes-v3` ✅ **40 passed**
(11 status + 8 orçamento + 8 nova OS + 13 workspace) · `npm run build` → **compilação webpack limpa**
(4 execuções), mas a etapa de **geração estática** aborta com `VirtualAlloc failed` (worker Windows,
0xC0000409) — falha **ambiental/memória** idêntica às fases 1C e Nova OS, **não** oriunda deste código
(a rota `/dashboard/operacoes-v3` é dinâmica, não entra na geração estática). **Não commitado.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **Operações V2** e write-paths do HUB,
`@/types/os`, **PDV**, **Financeiro HUB**, **WhatsApp**, **Marketplace**, **Fiscal**, **BL-07**.

---

### Operações V3 — Nova OS Enterprise + separação OS × PDV de Serviço (03/06/2026)

**O que é:** a V3 não tinha um botão claro de **abertura completa** de OS — o "Atendimento rápido"
era só casca visual sem persistência. Esta frente cria o **fluxo principal de abertura** da OS no
balcão e **separa papéis**: **Nova OS Enterprise = abrir** a ordem; **PDV de Serviço = receber/baixar**
o pagamento depois (fase posterior). Os dois não se misturam.

**Botão "Nova OS" (item 1)** — primário, visível em **5 pontos**: topo do módulo (header do Shell),
**Dashboard**, **Fila de OS**, **Atendimento rápido** e **OS Workspace quando não há OS selecionada**.
Todos abrem o mesmo modal (estado único no Shell via `abrirNovaOS` no contexto).

**Atendimento rápido (item 2)** — mantido, mas **claramente rotulado** como check-in **simplificado**,
com banner e CTAs que levam à Nova OS Enterprise (a criação real mora lá).

**Modal "Nova OS Enterprise" (item 3)** — modal grande, utilizável no balcão **sem F11** (stepper de 8
passos com corpo rolável + rodapé fixo com totais). Seções: **A. Cliente** (buscar real + cadastrar
novo: nome/tel/doc/e-mail/endereço/cidade/UF/CEP), **B. Equipamento** (tipo/marca/modelo/IMEI/senha —
numérica/texto/**padrão visual 3×3** — + acessórios: chip/capinha/película/carregador/cabo/cartão +
outros), **C. Recepção** (entrada/previsão/origem balcão·WhatsApp·retorno·garantia/recebido por/
prioridade/local físico), **D+E. Problema + Diagnóstico** (defeito/condição/obs internas + diagnóstico/
solução previstos), **F. Itens** (serviço/peça × **cobrado/brinde/interno** + custo interno × valor ao
cliente + baixa estoque sim/não), **G. Orçamento inicial** (subtotal/desconto/total/custo/lucro ao vivo),
**H. Pagamento previsto** (forma/vencimento/sinal/obs — **só previsão**), **I. Garantia prevista**
(10 modelos + personalizado + termo), **J. Resumo** + "Criar Ordem de Serviço".

**Persistência (item 4) — caminho seguro:** a OS é criada de verdade por **`criarOS`** (`@/api/os` →
`createOS`, que numera/audita) e cliente novo por **`criarCliente`** (`@/api/clientes` → `createCliente`).
Itens cobrados viram `pecas`/`servicosCatalogo`; **brinde/interno** entram com **valor ao cliente R$ 0,00**
(preservando o custo). Os extras da abertura (recepção, diagnóstico, pagamento previsto, garantia
prevista, condição, itens com `kind`/`baixaEstoque`, totais) viajam em **`payload.aberturaV3`** (JSONB)
+ `operacaoStatusV3: "aberta"` — **sem tocar schema nem `@/types/os`**. A OS nasce **ABERTA** e aparece
imediatamente na Fila/Dashboard/Workspace V3.

| Camada | Arquivo | Papel |
|---|---|---|
| Modelo puro | `lib/operacoes-v3/nova-os-model.ts` **(novo)** | Tipos do rascunho (A→J), opções (origem/garantia/acessórios/forma), `computeTotaisNovaOSV3` (regra de brindes), `validarNovaOSDraftV3` |
| Write-path | `lib/operacoes-v3/nova-os-actions.ts` **(novo, use server)** | `criarOSEnterpriseV3` — auth + guard (`operacoes.criarOs`) + cria cliente/OS pelo caminho seguro; extras no `payload`. Sem estoque/financeiro/WhatsApp |
| Testes | `lib/operacoes-v3/nova-os-model.test.ts` **(novo)** | 8 testes (totais brinde/interno, desconto, validação, garantia) |
| Modal | `components/operacoes-v3/components/NovaOSEnterpriseModalV3.tsx` **(novo)** | Stepper 8 passos, busca/cadastro de cliente, padrão 3×3, itens, totais ao vivo, resumo |
| Contexto/Shell | `context/OperacoesV3Context.tsx` · `OperacoesV3Shell.tsx` | `abrirNovaOS` + render do modal + botão "Nova OS" no header |
| Botões | `pages/DashboardV3.tsx` · `pages/FilaOSV3.tsx` · `pages/AtendimentoRapidoV3.tsx` · `pages/OSWorkspaceV3.tsx` | CTA "Nova OS" em cada tela; Atendimento rápido sinalizado como simplificado |

**Separação Nova OS × PDV de Serviço (item 5):** o modal **não** recebe pagamento — exibe explicitamente
*"Pagamento previsto salvo. Recebimento real será feito no PDV de Serviço."* O PDV de Serviço (receber
PIX/dinheiro/cartão, parcial/sinal, quitar, lançar no caixa, aparecer no fechamento) fica para fase
posterior.

**Impressão (item 6):** **não** implementada agora; os dados salvos (`payload.aberturaV3` + cliente/
equipamento/itens/garantia) já permitem gerar a OS impressa depois.

**⚠️ Limitações conscientes (escopo):** (a) **não baixa estoque** (flag `baixaEstoqueV3` só registrada);
(b) **não cria Conta a Receber** nem recebe pagamento (só previsão em `payload`); (c) o **desconto** do
orçamento inicial fica em `payload.aberturaV3` (a geração do orçamento real, Fase 1C, recomputa a partir
dos itens — reaplicar desconto ao editar o orçamento); (d) `createOS` soma no `valorTotal` apenas
`servicosCatalogo.valorVenda` (peças entram quando o orçamento é gerado) — comportamento pré-existente do
V2, não alterado.

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npm run build` ✅ (webpack; 1º run abortou no flake do
worker Windows em "Collecting page data", **passou no retry** — compilação limpa em ambos) · `vitest`
**+8** (modelo Nova OS, 8/8). **Não commitado.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **Operações V2** e write-paths do HUB, `@/types/os`,
**PDV** (vendas), **Financeiro HUB**, **WhatsApp**, **Fiscal**, **Marketplace**, **BL-07**.

---

### Operações V3 — Fase 1C: orçamento como cidadão de 1ª classe (03/06/2026)

**O que é:** consolida o **orçamento** como o centro da OS no Workspace V3. Antes, a seção de
orçamento era um resumo simples; agora é um **painel operacional editável** (área principal), com
estrutura profissional de orçamento — **sem nenhum efeito financeiro/estoque/garantia/WhatsApp**.

**Modelo (sem schema, sem tocar `@/types/os`):** os campos extras da V3 — `kindV3` (cobrado/brinde/
interno) por linha, `custoV3` de serviço e o **histórico de versões** — vivem como propriedades
adicionais dentro do `payload` (JSONB) e sobrevivem à hidratação pelo spread (mesma disciplina do
`operacaoStatusV3` da Fase 1B). Fonte de verdade pura: `lib/operacoes-v3/orcamento-model.ts`.

**Brindes (item 6):** `cobrado` impacta custo **e** valor ao cliente; `brinde` e `interno` impactam
**custo/lucro**, **não** o valor ao cliente. Ex.: Troca de tela (cobrado) + Película (brinde) +
Capinha (brinde) → o cliente paga só a troca; o custo das brindes reduz o lucro.

**Estados + timeline (itens 2/3):** badge dos 5 estados (rascunho/enviado/aprovado/recusado/**expirado**
derivado por `validoAte`). Cada ação grava evento de timeline real (`orcamento_criado/atualizado/
enviado/aprovado/recusado`), exibido na "Linha do tempo" do Workspace.

**Histórico de versões (item 4):** cada **Salvar** empilha um snapshot anterior em
`payload.orcamentoVersoesV3` (nunca perde informação); visualização das versões no próprio painel.

**Lucro estimado (item 7):** custo interno · valor ao cliente · lucro — **somente leitura**, sem
integração financeira.

**Ações reais (itens 8/9/10), todas side-effect-free:** `enviarOrcamentoV3` (→ enviado; avança a OS a
*aguardando aprovação* pela máquina 1B), `aprovarOrcamentoV3` (→ aprovado; avança a OS a *aprovada*),
`recusarOrcamentoV3` (→ recusado + timeline, sem outros efeitos), `salvarOrcamentoV3` (edita itens/
desconto/brindes + versão). **Não** usam `approveOrcamento`/`rejectOrcamento` do V2 (que materializam/
cancelam Conta a Receber).

**Aprovado (item 11):** banner **"ORÇAMENTO APROVADO"** + botão **"Iniciar serviço"** (avança a OS a
*em execução* pela máquina única).

**Dashboard (item 12):** métricas reais de orçamento — em rascunho · enviados · aprovados · recusados
(da leitura já existente, `contarOrcamentosPorStatusV3`).

| Camada | Arquivo | Papel |
|---|---|---|
| Modelo puro | `lib/operacoes-v3/orcamento-model.ts` **(novo)** | Tipos V3 (kind/custo/versão), totais com brindes, lucro, status efetivo (expirado), contagem p/ dashboard |
| Write-path | `lib/operacoes-v3/orcamento-actions.ts` **(reescrito, use server)** | `salvar/enviar/aprovar/recusar` — só payload (orçamento+status OS+timeline+versões); sem financeiro/estoque/garantia |
| Máquina | `lib/operacoes-v3/status-machine.ts` | + `statusOSAposEnviarOrcamento` / `statusOSAposAprovarOrcamento` (acoplamento orçamento→OS centralizado) |
| Testes | `lib/operacoes-v3/orcamento-model.test.ts` **(novo)** | 8 testes (brindes, desconto, lucro, expirado, contagem) |
| Painel | `components/operacoes-v3/components/OrcamentoPanelV3.tsx` **(novo)** | Editor de serviços/peças/brindes + totais + lucro + estados + ações + versões + banner aprovado |
| Hook | `components/operacoes-v3/hooks/use-orcamento-v3.ts` | Expõe gerar/salvar/enviar/aprovar/recusar (pending/erro) |
| Workspace | `pages/OSWorkspaceV3.tsx` | Seção 3 substituída pelo `OrcamentoPanelV3` (área principal) |
| Dashboard | `pages/DashboardV3.tsx` | Bloco de métricas de orçamento (real) |

**⚠️ Limitação consciente (escopo):** Aprovar/Iniciar serviço **não** materializam Conta a Receber,
**não** consomem estoque, **não** geram garantia (continuam exclusivos do V2/fases futuras). A coluna
`ordem_servico_item` (mirror do V2) **não** é sincronizada nas edições V3. Seguro enquanto a V3 é casca
isolada por URL; **não** usar como caminho de faturamento em produção antes do cabeamento (1D/2).

**Validação:** `npx tsc --noEmit` ✅ · `npm run build` ✅ (exit 0, 98 rotas; flakes do Windows —
lock do `prisma generate` e worker nativo em "Collecting page data" — contornados com `next build`
direto + `--max-old-space-size=8192`) · `vitest` **306 passed | 2 expected fail** (+8). **Não commitado.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **V2** e write-paths do HUB (`approveOrcamento`/
`rejectOrcamento`/`updateOSStatus`/`updateOSPayload`), `@/types/os`, Financeiro HUB, PDV, WhatsApp,
Marketplace, Fiscal, BL-07.

---

### Operações V3 — Fase 1B: máquina única de status (03/06/2026)

**O que é:** uma **única fonte de verdade** para o fluxo operacional da OS na V3. Antes, o status era
mexido por caminhos potencialmente divergentes (Kanban, botões, Workspace, action bar). Agora **toda**
mudança de status passa pela mesma engine pura + um único write-path.

**Os 10 status oficiais:** `aberta · diagnostico · aguardando_aprovacao · aprovado · aguardando_peca ·
em_execucao · pronta · recebida · entregue · cancelada`. Grafo (avanço linear): aberta→diagnóstico→
aguardando_aprovação→aprovada→{aguardando_peça | em_execução}; aguardando_peça→em_execução→pronta→
**recebida**→entregue; qualquer não-final→cancelada. Estados finais (entregue/cancelada) são imutáveis.

**RECEBIDA sem tocar schema:** o status V3 autoritativo vive em **`payload.operacaoStatusV3`** (JSONB,
sobrevive à hidratação pelo spread do payload). `payload.status` recebe a **projeção V2** (recebida→
"pronta") para manter o V2 legado e a coluna Prisma colapsada coerentes. Leitura efetiva via
`statusV3FromOS` (prefere o campo V3; legado nunca produz "recebida").

| Camada | Arquivo | Papel |
|---|---|---|
| Engine pura | `lib/operacoes-v3/status-machine.ts` **(novo)** | Tipos, meta (label/tone/final), grafo `TRANSICOES_V3`, `podeTransicionarV3`, `proximasTransicoesV3`, `acaoPrimariaV3`, `statusV3FromOS`, `projetarStatusV2`. **Única fonte de regra.** |
| Write-path | `lib/operacoes-v3/status-actions.ts` **(novo)** | `aplicarTransicaoStatusV3` — valida pela engine, grava **status + timeline apenas** (auth + storeId). **Não** chama `updateOSStatus`/`updateOSPayload` do V2 (evita estoque/financeiro/garantia/Omni). |
| Testes | `lib/operacoes-v3/status-machine.test.ts` **(novo)** | 11 testes: grafo do blueprint, bloqueios, finais, derivação/projeção, Kanban (9 colunas). |
| Contexto/Shell | `context/OperacoesV3Context.tsx` · `OperacoesV3Shell.tsx` | Expõem `mudarStatus` (write + reload + toast) e `notificar`; badge "somente leitura" → "status + orçamento reais". |
| Action Bar | `components/OSCommandBarV3.tsx` | Ação primária recomendada + transições válidas + Cancelar (todas reais). Caminhos inválidos **não são oferecidos**. |
| Kanban | `pages/FilaOSV3.tsx` | **Arrastar card** entre colunas → valida na engine → `mudarStatus` (ou toast amigável). Colunas/agrupamento por status V3 efetivo. |
| Badges | `components/StatusBadgeV3.tsx` · `OSHeaderV3` · `OSCardV3` · `HistoricoClientesV3` · Lista | Renderizam o status V3 efetivo (incl. **Recebida**). |
| Workspace | `pages/OSWorkspaceV3.tsx` | Command bar ligada ao write real; recarrega OS + lista (Kanban ↔ Workspace sincronizados). |

**Bloqueio + mensagem amigável:** `podeTransicionarV3` roda no **cliente** (pré-valida o drop do Kanban →
toast imediato) **e** no **servidor** (a action rejeita com o mesmo motivo). Mesma regra, sem divergência.

**Timeline:** cada transição grava um evento `mudanca_status` (`{ de, para, engine: "operacoes-v3" }`),
exibido na "Linha do tempo" do Workspace após o reload.

**⚠️ Divergência consciente (escopo da fase):** a transição para **ENTREGUE na V3 é status-only** — **não**
consome estoque, **não** cria garantia, **não** materializa Financeiro (diferente do `updateOSStatus` do
V2). Isso é intencional (fase exclui estoque/financeiro/garantia) e seguro enquanto a V3 é casca isolada
por URL, **mas** não deve virar o caminho de finalização em produção antes do cabeamento (Fase 1C/2).

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npm run build` ✅ (exit 0, 98 rotas) ·
`vitest` **298 passed | 2 expected fail** (era 279 | 2; +11 da máquina; sem regressões).
**Não commitado — aguardando revisão.**

**Não alterado:** schema Prisma, migrations, auth/proxy, **V2** e seus write-paths
(`updateOSStatus`/`updateOSPayload`/`operacao-hub-flow`), `@/api/os`, PDV, Financeiro HUB, WhatsApp,
Marketplace, Fiscal, BL-07.

**Próximo (1C/2):** cabear ENTREGUE/CANCELADA aos efeitos reais (estoque/garantia/financeiro) de forma
governada · diagnóstico/execução estruturados · pagamento real (Financeiro).

---

### Operações V3 — Fase 1A: Workspace + Orçamento real ligados (03/06/2026)

**O que é:** primeira frente **funcional** da V3. O **OS Workspace V3** (`/dashboard/operacoes-v3`)
deixa de ser somente leitura no fluxo **OS → Orçamento → envio**: abre uma OS real (`getOrdem`),
distingue **prévia sintetizada** vs **orçamento materializado** e executa **ações reais de orçamento**
reusando — **sem backend novo** — as mesmas funções já usadas pelo HUB V2. **V2 intacta.** Escopo tocado
**somente** em `components/operacoes-v3/**` e `lib/operacoes-v3/**`.

**O que agora funciona (real):**
- **Gerar orçamento da OS** — CTA aparece quando não há orçamento ou só há a prévia sintetizada;
  chama `gerarOrcamentoDaOS` → materializa um **rascunho editável** a partir dos itens da OS.
- **Enviar ao cliente / Reenviar** — quando há orçamento real em `rascunho`/`enviado`; chama
  `enviarOrcamentoAoCliente` → status `enviado`.
- Após sucesso, a tela **recarrega** a OS e a lista (estado de pendência + erro honesto na própria seção).
- **Seção "3. Orçamento" acima de "5. Financeiro"** (ordem obrigatória), mostrando serviços, peças,
  desconto (se existir) e **total final**, com badge de status (rascunho/enviado/aprovado/prévia/sem orçamento).

**Actions reais usadas** (via fronteira `lib/operacoes-v3/orcamento-actions.ts` → `@/api/os`, idênticas às do HUB V2):
`gerarOrcamentoDaOS` · `enviarOrcamentoAoCliente`. A fronteira só **normaliza a assinatura** para
`(storeId, osId)` e fixa o `autor` da timeline — **não** é backend duplicado.

**Placeholders honestos (não chamam write-path — Fase 1B+):** **Aprovar** e **Reprovar** orçamento
(têm efeito financeiro real: `approveOrcamento` materializa Conta a Receber / `rejectOrcamento` cancela
cobrança) → toast honesto. Também placeholders: Receber pagamento, Diagnóstico/Execução/Entrega/Garantia
estruturados, impressão de documento/etiqueta, portal do cliente, e toda a barra de comando contextual.

**Segurança (verificado no código, não só documentado):**
- `gerarOrcamentoDaOS`/`enviarOrcamentoAoCliente` fazem patch só de `{ orcamento, timeline }` — **sem**
  campos de faturamento → o gate de `syncFinanceiroAfterOSPayloadUpdate` **não cria/cancela Conta a Receber**.
- **Sem dupla baixa de estoque:** a V3 **não** chama consumo de estoque; o `syncOperacaoItensComOrcamento`
  do "enviar" só espelha `ordem_servico_item` (rascunho), **nunca** toca `Produto.stock`/`MovimentacaoEstoque`
  (e ainda respeita `estoqueConsumido`). A correção de fonte única de peças da **OS-P0.1** continua sendo a
  fonte única — não foi duplicada.
- **Financeiro permanece "a conectar"** (estado de recebimento real vive no Financeiro, fora deste read layer).

**Arquivos (Fase 1A):**

| Arquivo | Mudança |
|---|---|
| `lib/operacoes-v3/orcamento-actions.ts` **(novo)** | Fronteira de ações seguras: wrappers `(storeId, osId)` para `gerarOrcamentoDaOS`/`enviarOrcamentoAoCliente`; documenta o que **não** é reexportado (aprovar/reprovar) |
| `components/operacoes-v3/hooks/use-orcamento-v3.ts` **(novo)** | Hook client: estado `pending`/`error` + `gerar()`/`enviar()` |
| `components/operacoes-v3/pages/OSWorkspaceV3.tsx` | Liga CTA Gerar/Enviar, badge de status do orçamento, Aprovar/Reprovar como placeholder honesto |
| `components/operacoes-v3/hooks/use-ordem-v3.ts` | `reload()` para refazer a leitura após ação real |

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npm run build` ✅ (exit 0, 98 rotas;
`/dashboard/operacoes-v3` estática, `/dashboard/operacoes-v2` presente e intacta).
**Não commitado — aguardando revisão.**

**Não alterado:** V2, schema Prisma, migrations, auth/proxy, `@/api/os` e demais write-paths do HUB
(`createOS`/`updateOSStatus`/`applyOperacaoHubAcao`/`approveOrcamento`/`rejectOrcamento`/`gerarCobranca*`),
PDV, Financeiro HUB, WhatsApp, Marketplace, Fiscal, BL-07.

**Próximo (Fase 1B/2):** ligar **Aprovar/Reprovar** com confirmação explícita (efeito financeiro real) ·
conectar o estado real de **pagamento/recebimento** (Financeiro) · diagnóstico/execução/entrega estruturados ·
edição de itens do orçamento (desconto por linha) dentro do Workspace.

---

### Operações V3 — casca navegável isolada criada (02/06/2026)

**O que é:** nova **casca operacional** da Operações numa rota paralela e **isolada**
(`/dashboard/operacoes-v3`), espelhando o padrão de isolamento da **Configurações V3** (Server
Component fino + `<Suspense>` → Client Component com **navegação por estado interno**; loja ativa via
`useLojaAtiva`). **Não substitui a V2** (`/dashboard/operacoes-v2` intacta) e **não toca
backend/schema/write-paths**. Escopo criado **somente** em `app/dashboard/operacoes-v3/**` e
`components/operacoes-v3/**` (~35 arquivos novos).

**19 telas navegáveis** + **OS Workspace** (tela principal: cabeçalho sticky · barra de comando
contextual por status · 8 seções colapsáveis · lateral de contexto · rodapé utilitário — **sem JSON cru**).

| Nível | Telas |
|---|---|
| **Real (leitura)** | Dashboard (contagens/atrasadas/garantias/receita estimada) · Fila (Kanban/Lista) · Bancada (por técnico) · SLA · Workspace (`getOrdem`) · Orçamentos (funil) · Garantias · Histórico de clientes |
| **Parcial** | Técnicos (carga real; produtividade *a conectar*) · Serviços (agregado real das OS; catálogo/CRUD *a conectar*) |
| **Placeholder honesto** | Atendimento Rápido e PDV de Serviço (cascas de formulário, **sem write**) · Retornos · Portal · Notificações · Peças & Pedidos · Rastreio Físico · Relatórios · Configurações do módulo |

**Leitura via** `listOrdens`/`getOrdem` de `app/actions/ordens.ts` (acessores que **não lançam** —
retornam `[]`/`null`). **Toda ação de escrita** (mudar status, receber, aprovar, gerar OS, imprimir…)
é **placeholder honesto** (toast "disponível na próxima fase") — **nenhum write-path é chamado**.
**Pagamento** real (em aberto/parcial/quitado) vive no Financeiro e não está acoplado a este read
layer → exibido como **"a conectar"** (sem simular recebimento); idem "Recebido hoje"/"Saldo aberto".

**Tokens:** apenas semânticos (`bg-card`, `text-foreground`, `border-border`, `bg-primary/10`, status
`success/warning/info/destructive`). `shadow-card`/`shadow-soft` **não** são utilitários globais →
usado `shadow-sm`. Casca **self-contained** (não importa o kit shadcn global).

**Validação:** `npx tsc --noEmit` ✅ (0 erros) · `npm run build` ✅ (98 rotas; `/dashboard/operacoes-v3`
estática; `/dashboard/operacoes-v2` presente e intacta). **Não commitado — aguardando revisão.**

**Não alterado:** V2, schema Prisma, auth/proxy, write-paths de OS (`createOS`/`updateOS*`/
`applyOperacaoHubAcao`/`gerarCobranca*`…), PDV, Financeiro HUB, WhatsApp, Marketplace, Fiscal, BL-07.

**Próximo passo sugerido:** revisão visual (`npm run dev` → `/dashboard/operacoes-v3`) → decidir
entrada na sidebar (hoje só por URL) → priorizar quais telas ligam dados/escrita reais primeiro,
sem duplicar o motor da V2.

---

### Operações HUB — Sprint OS-P0.1 · PASSO 1: Nova OS → orçamento real (02/06/2026)

**Contexto:** baseado na auditoria forense + Diagrama de Remediação aprovado. O PASSO 1 religa a
**fratura intake → orçamento**: a Nova OS gravava `servicosCatalogo`/`pecas` mas **nenhum orçamento**;
a hidratação sintetizava um orçamento "aprovado" **read-only**, travando desconto/edição/envio/aprovação.

**O que foi feito (variante de menor risco — "Gerar orçamento da OS"):**
- Síntese da hidratação marcada com `Orcamento.sintetizado: true` (é prévia, não orçamento real).
- `OrcamentoPanel` mostra CTA **"Gerar orçamento da OS"** → `gerarOrcamentoDaOS` materializa um
  orçamento **rascunho editável** a partir dos itens da OS → destrava **desconto/edição/enviar/aprovar**.
- **Fonte única de peças** no consumo de estoque (`selectEstoquePecaSource`): orçamento quando tiver
  peças, senão `payload.pecas` — **resolve a dupla baixa** (antes as duas fontes eram somadas por `produtoId`).

| Arquivo | Mudança |
|---|---|
| `lib/operacoes/services/orcamento-builder.ts` **(novo, puro)** | `buildOrcamentoRascunhoFromOS` + `selectEstoquePecaSource` |
| `lib/operacoes/services/orcamento-builder.test.ts` **(novo)** | 8 testes (build + fonte única + brinde R$0) |
| `components/operacoes/lovable/types/os.ts` | `Orcamento.sintetizado?` (aditivo) |
| `lib/operacoes/services/hydration-service.ts` | marca síntese `sintetizado: true` |
| `lib/operacoes/adapters/os-estoque.ts` | `listCandidatePecas` → fonte única |
| `components/operacoes/lovable/api/os.ts` | `gerarOrcamentoDaOS` (rascunho via `updateOSPayload`) |
| `components/operacoes/lovable/store/osStore.tsx` | expõe `gerarOrcamentoDaOS` |
| `.../components/operacoes/OrcamentoPanel.tsx` | CTA "Gerar orçamento da OS" + guard de `draft` |

**Decisões de menor risco:** orçamento criado como `rascunho` → **não dispara Contas a Receber**
(financeiro intocado); **não** chama `syncOperacaoItensComOrcamento` (evita `ordem_servico_item` cedo);
`gerarOrcamentoDaOS` idempotente (não sobrescreve orçamento real). **Garantia intocada.**

**Validação:** `npx tsc --noEmit` ✅ · `vitest` **8/8** (`orcamento-builder`) · `npm run build` ✅ (97 rotas).

**Pendente:** **PASSO 2** — unificar action bar × Kanban drag (numa OS ainda não materializada,
"Enviar/Aprovar orçamento" da action bar ainda estoura; caminho correto = **Gerar orçamento** primeiro).
**PASSO 3** — forma de pagamento + desconto no fechamento de balcão.

---

### Operações HUB — read layer da OS conectado (Kanban/Painel/Histórico/Detalhe) (02/06/2026)

**Contexto:** após a Nova OS passar a criar OS de verdade (commit `8f7df4c`), o restante do módulo
exibia os dados de leitura zerados — Kanban com card sem valor, Painel e Histórico em **R$ 0,00**
mesmo com serviço/peça preenchidos.

**Causa raiz (read layer):** `lib/operacoes/services/hydration-service.ts → mergeOrcamentoFromPrismaRow`
sintetizava o `orcamento` da OS **só a partir de serviços** — **peças eram ignoradas**. Como todo o HUB
lê `os.orcamento.total` (card do Kanban, ticket do Painel, total do Histórico, resumo do Detalhe), uma OS
com valor em peças ficava **R$ 0,00** (e OS só com peças não gerava orçamento algum; a coluna `valorTotal`
do Prisma, escrita pelo `createOS`, também é só de serviços). Além disso o Painel somava "receita estimada"
**só de OS entregues** e o `OSDetalhe` não tinha seção de peças nem linha de custo/lucro.

**Correções (somente read layer / DTOs — sem schema, sem write path):**

| Arquivo | Mudança |
|---|---|
| `lib/operacoes/services/hydration-service.ts` | Orçamento sintetizado passa a incluir **peças** (linhas + soma no total). Propaga para Kanban (`OSCard`), Painel (ticket), Histórico (total investido) e Detalhe. **Guard preservado:** só sintetiza para OS **sem** orçamento real |
| `components/operacoes/lovable/pages/DashboardOperacional.tsx` | "Receita estimada" = pipeline de **todas as OS não-canceladas** (não só entregues) |
| `components/operacoes/lovable/pages/OSDetalhe.tsx` | Nova seção **"Peças utilizadas"** + resumo com **Valor ao cliente · Custo interno (oculto do cliente) · Lucro estimado** + tipo de senha |

**Pendente (sinalizado, fora do escopo "read layer"):** a coluna `valorTotal` do Prisma (escrita por
`createOS`) ainda é **só de serviços** — o HUB não depende mais dela, mas leitores externos (rota legada
`/api/ops/ordens`, relatórios) veem valor sem peças. Ajuste futuro é no **write path** (`createOS`), **sem
schema**.

**Validação:** `npx tsc --noEmit` ✅ (exit 0) · `npm run build` ✅ (exit 0, 97 rotas). Não tocado: schema,
auth/proxy, PDV, Marketplace, WhatsApp, Fiscal, Financeiro HUB, BL-07.

---

### Operações HUB — Nova OS operacional: cria OS de verdade + cliente/serviços/peças/financeiro (02/06/2026)

**Contexto:** a tela **Nova Ordem de Serviço** (`/dashboard/operacoes-v2`, modal Lovable) estava crua e o
botão **"Criar OS" falhava em silêncio** ao digitar um cliente novo. A auditoria também localizou a
implementação real anterior na rota legada `/dashboard/os` (`OsPageClient.tsx`, DT-04) — seus padrões
maduros (busca de cliente + novo cliente inline, senha por tipo, financeiro editável, erro real) foram
**portados** para a Nova OS oficial (ADR-0001), sem reverter para a legada.

**Causa raiz do botão:** o modal enviava `clienteId: clienteId || c_tmp_${...}` — um id **falso** quando
nenhum cliente existente era selecionado. `OrdemServico.clienteId` é **FK real** (`schema.prisma:657`,
`onDelete: Restrict`) → `createOS` violava a FK → exceção → `catch` genérico "Falha ao criar OS".
Selecionar cliente existente funcionava; **digitar um cliente novo quebrava**.

**Correções (escopo: Operações HUB / Nova OS apenas):**

| Item | Antes | Agora |
|---|---|---|
| Criar OS | id de cliente falso → FK violada → erro genérico | resolve cliente **real** (selecionado ou criado) + **mensagem de erro real** |
| Cliente | Select simples | **busca** (nome/tel/CPF) + **cadastro de novo cliente no modal** (reusa `createCliente`) |
| Senha | texto livre | tipo **Numérica/PIN · Texto · Padrão (desenho)** com input adaptado |
| Checklist | N/T selecionado ~invisível | **OK=verde · Ruim=vermelho · N/T=azul**, sempre marcado |
| Serviços | dropdown vazio = "risco" | empty-state honesto + busca + **serviço manual** (custo/valor/garantia/obs) |
| Peças | lista gigante sem busca | **busca por nome/SKU/EAN** + preço/estoque + **item avulso manual** |
| Financeiro | valores travados | **custo/valor editáveis por linha**, lucro recalcula, custo **oculto do cliente** |
| UX | rodapé rolava | rodapé **fixo**, estado "Criando…", erro visível |

**Arquivos:** `components/operacoes/lovable/components/operacoes/NovaOSModal.tsx` (rework),
`api/clientes.ts` (+`criarCliente` reusa `createCliente`), `store/osStore.tsx` (expõe `criarCliente`),
`types/os.ts` (+`senhaEquipamentoTipo`/`observacao` opcionais). **Não alterado:** `prisma/schema.prisma`,
`createOS`, auth/proxy, PDV, Financeiro HUB, WhatsApp, Marketplace, Fiscal, BL-07.

**Fase futura (documentada):** grid visual de desbloqueio de 9 pontos (hoje placeholder honesto em texto);
itens manuais não movimentam estoque (avisado na UI); reaproveitar `ConsultoriaIA` na Nova OS; decomissionar
a rota legada `/dashboard/os` (DT-04).

**Validação:** `npx tsc --noEmit` ✅ (exit 0) · `npm run build` ✅ (exit 0, 97 rotas; a 1ª execução teve o
flake conhecido de OOM de worker no Windows em "Generating static pages" → re-run com
`--max-old-space-size=8192` passou limpo). A Nova OS **persiste de verdade** via `createOS` (Server Action
Prisma) — não é mock.

---

### BL-07 Estoque Multi-Depósito — Fase 1 (Fundação) CONCLUÍDA · cutover executado (02/06/2026)

**Estado:** ✅ **CONCLUÍDA** — código (commit `a0e24ef` + push) **e** cutover de banco executados,
sob autorização de área protegida (`SPRINT_BL07_FASE1`). Validação completa: `prisma generate` ✅ ·
`npx tsc --noEmit` ✅ · `npm run build` ✅ · Vitest **279 passed | 2 expected fail** (14 novos do núcleo).

**Cutover (02/06/2026) — executado com sucesso:**
- `npm run db:push` → *"Your database is now in sync with your Prisma schema"* (aditivo; **sem
  data-loss**). Tabelas **`depositos`** e **`produto_depositos`** criadas.
- `npm run db:backfill-deposito -- --exec` → **10 lojas** com **Depósito Principal** criado;
  `ProdutoDeposito` populado a partir de `Produto.stock`.
- **Invariante VERDE:** `Σ ProdutoDeposito == Σ Produto.stock` em todas as lojas (**drift total = 0**).
  Re-dry-run confirmou `principal=ok` nas 10 lojas.

**Princípio honrado:** **ZERO mudança de comportamento operacional.** É **só fundação** — nenhum
consumidor (PDV/OS/relatórios) foi alterado; `Produto.stock` segue intacto como cache agregado e
fonte operacional. A camada nova é **dormente** (preparada para a Fase 2 cabear os write-paths).

**O que foi implementado (aditivo):**

| Camada | Arquivo | Papel |
|---|---|---|
| Schema | `prisma/schema.prisma` | + models `Deposito` (id, storeId, nome, codigo, ativo, principal, timestamps) e `ProdutoDeposito` (storeId, produtoId, depositoId, quantidade) + back-relations em `Produto` e `Store`. Nada existente alterado/dropado |
| Migração | `prisma/migrations/0011_deposito_produto_deposito/migration.sql` | DDL **aditiva** (CREATE TABLE ×2 + índices + FKs guardadas + índice parcial `1 principal/loja`). Rollback = DROP das 2 tabelas |
| Núcleo (puro) | `lib/estoque/deposito-core.ts` | Lógica testável com client injetado (`import type`): ensure principal, agregado, por-depósito, set, backfill. `assertStoreId` sem fallback loja-1 |
| Service | `lib/estoque/estoque-deposito-service.ts` | Wrapper fino ligado ao `prisma` (dormente — nenhum consumidor chama) |
| Backfill | `scripts/backfill-deposito.mjs` + `npm run db:backfill-deposito` | Bootstrap lojas existentes (principal + ProdutoDeposito a partir de `Produto.stock`) + gate de invariante (Σ == stock); dry-run default |
| Bootstrap | `app/api/stores/route.ts` | 1 hook **best-effort** (`ensureDepositoPrincipal`) ao criar loja — nunca bloqueia a criação |
| Testes | `lib/estoque/deposito-core.test.ts` | 14 testes: principal idempotente, ProdutoDeposito upsert, agregação, backfill/re-sync, **isolamento multi-loja** |

**Proteções multi-loja (ETAPA 6):** `storeId` obrigatório em toda função (`assertStoreId` lança sem
fallback `loja-1` — ADR-0003); `where.storeId` em todas as queries; `setEstoqueDeposito` valida que
depósito **e** produto são da mesma loja (anti-vazamento cross-tenant) — coberto por teste.

**Divergências conscientes vs ADR-0007 (a reconciliar no Gate #2 ou ADR de follow-up):**
- Modelo nomeado **`ProdutoDeposito`** (não `EstoqueSaldo`); campo **`principal`** (não `isDefault`).
- **Sem `custoMedio` por depósito**, **sem `tipo`/`metadata`** em `Deposito`, **sem `depositoId` em
  `MovimentacaoEstoque`** — Fase 1 minimalista ("somente saldo físico", per diretriz). ADR-0007 previa
  esses campos; ficam para fase posterior (ou atualização do ADR).
- `storeId` em `ProdutoDeposito` é escalar indexado (sem FK direta a Store) — integridade via FKs de produto/depósito.

**Encerramento:** Fase 1 **concluída** (código `a0e24ef` + push + cutover de banco com invariante verde).
**Dívida aberta:** **DT-17** (P2) permanece — `ProdutoDeposito` passa a driftar de `Produto.stock` com
a operação normal (consumidores ainda não cabeados); mitigado pela camada **dormente** + `db:backfill-deposito`
re-runnable (re-sincroniza). **Próximo passo oficial: BL-07 Fase 2** (cabear write-paths PDV/OS por
depósito + `depositoId` NOT NULL + seleção/transferência) — **não iniciada**.

---

### BL-07 Estoque Multi-Depósito — Fase 0 (arquitetura) concluída · Gate #1A aprovado (02/06/2026)

**O que é:** wiring de governança da conclusão da **Fase 0** do **BL-07** (estoque multi-depósito).
A Fase 0 (arquitetura e planejamento — **read-only**, sem código/schema/migração) produziu o pacote
de arquitetura + a proposta de sprint faseada. **Gate #1A aprovado** por Rafael em 02/06/2026.
Sucede o **Gate #1** de **ADR-0007** (decisão de modelo, 01/06): agora a *arquitetura completa* está
detalhada e o BL-07 está pronto para abrir a **Fase 1 (Fundação)** sob autorização de área protegida.

**Documentos criados (somente documentação):**

| Arquivo | Papel |
|---|---|
| `docs/architecture/estoque/BL07_FASE0_ARQUITETURA.md` | Dossiê: **D1** estado atual · **D2** gap analysis (Tiny/Bling/GestãoClick/Smart Genius/AvantPro/Linx/NetSuite) · **D3** modelo multi-depósito · **D4** fluxos obrigatórios · **D5** riscos P0–P3 |
| `docs/sprints/proposals/SPRINT_BL07_FASE1.md` | Proposta de sprint faseada — **Fase 1 (Fundação)** detalhada + **Fases 2/3/4** com estimativa de esforço |
| `docs/architecture/estoque/README.md` | Índice do pacote + resumo executivo |

**Estado atual mapeado (do código):** estoque é **single-depósito implícito** (`Produto.stock` único
+ ledger `MovimentacaoEstoque` **sem `depositoId`**). PDV tem anti-negativo **atômico** (DT-B,
`ops-upsert-venda.ts`); **o ledger da OS é best-effort** (`try/catch` em `os-estoque.ts` — risco de
drift por depósito); **Marketplace não sincroniza saldo** (só lista catálogo). Sem
reserva/comprometido/disponível/em trânsito.

**Riscos encontrados (top P0 — detalhe na Parte 5 do dossiê):**
- **MIG-01** — migração quebra ledger histórico → DDL **aditiva** + backfill transacional + gate de invariante.
- **CONC-02** — drift `EstoqueSaldo`×`Produto.stock` agravado pelo **ledger best-effort da OS** → promover OS a **atômico**.
- **CONC-01** — race de baixa por (produto, depósito) → estender predicado atômico `saldo>=qty` (DT-B) ao `EstoqueSaldo`.
- **MLOJA-01** — vazamento cross-tenant via depósito → `storeId` FK + `@@unique([storeId,nome])` + `where storeId` (ADR-0003).
- **NEG-01/R-05** — oversell Marketplace → reserva otimista **só na Fase 3** (não antecipar adapter).

**Dependências para abrir a Fase 1 (Fundação):**
1. **Autorização explícita de área protegida** — tocar `prisma/schema.prisma` + services de estoque core (PDV/OS) — **ainda não concedida**.
2. Gate #1A ✅ (esta entrada).
3. Esforço estimado **L–XL (~5–8 dias-dev)**; DoD: **drift = 0** (`Σ EstoqueSaldo == Produto.stock`), 0 `depositoId` nulo, **comportamento idêntico** ao pré-migração.

**Plano faseado:** Fase 1 Fundação → Fase 2 Operação (seleção de depósito + transferência intra-loja)
→ Fase 3 Reserva & Marketplace (anti-oversell) → Fase 4 Inteligência & Fiscal (NF-e XML, curva ABC, FIFO).

**Esta entrada é só governança/rastreabilidade** — sem mudança de código/schema/Prisma/APIs/runtime.
Referências: [`BL07_FASE0_ARQUITETURA.md`](../architecture/estoque/BL07_FASE0_ARQUITETURA.md) ·
[`SPRINT_BL07_FASE1.md`](../sprints/proposals/SPRINT_BL07_FASE1.md) · ADR-0007 · `ROADMAP_ESTOQUE` · BL-07 · DT-08.

---

### Pausa operacional PDV — estabilização em uso real (pré-BL-07 · 01/06/2026)

**Por quê (desvio controlado, não caótico):** o PDV entrou em **operação real na loja** e
apareceram problemas reais de fluxo, teclado, busca, bipe, finalização, toast e UX operacional.
Antes de abrir a próxima grande frente estrutural (**BL-07 — Estoque multi-depósito**, já com modelo
decidido em **ADR-0007**), foi aberta uma **pausa operacional** para estabilizar o PDV em uso real.
É uma **pausa controlada na sequência do roadmap** — registrada aqui para rastreabilidade, não uma
troca caótica de prioridade.

**Contexto imediatamente anterior (já concluído):**
- **WhatsApp Multi-Loja F-04/DT-07** ✅ (ADR-0006, `MULTI_LOJA-S-003`, Gate #2 01/06) — fechou o
  último vetor `loja-1` do projeto.
- **ADR-0007 (modelo de depósitos)** ✅ aceito no Gate #1 (01/06) → **BL-12 resolvido**. A
  **implementação** (multi-depósito, Sprint Fase 0 `ESTOQUE-S-00x`) vira **BL-07**, a **próxima grande
  frente estrutural** — ainda **não aberta**.

**Correções operacionais de PDV já entregues nesta pausa (Clássico em foco):**

| Correção | Commit |
|----------|--------|
| **DT-B — baixa de estoque anti-negativo** no PDV ✅ | `ec04043` |
| **Busca multi-termo** + **bipe** + atalho **INSERT** (item avulso) ✅ | `b9c147d` |
| Toast/UX operacional · Quantidade seleciona ao focar · Resumo do Caixa em 2 colunas ✅ | `3bc0e70` |
| **Modal de pagamento** 2 colunas + teclado (Clássico) ✅ | `03b4ac2` |
| **Modal de pagamento sem F11** (largura `max-w-[1250px]`, compactação, scroll único, Confirmar muted) + **busca F3 profissional** (tabela Cód./SKU·EAN·Produto·Un·Estoque·Preço + teclado ↑↓/Enter + contador) ✅ | `292e073` |
| **UX inspirada no Smart Genius** (formas em lista vertical, busca operacional) ✅ | `292e073` |
| **Modais F1/F3 do Clássico — largura/grid corrigidos e equilibrados** (causa-raiz: `sm:max-w-lg` do `DialogContent` vencia; override `sm:max-w-[…]` via `cn`/twMerge. **F1** pagamento: 1000px, colunas 45/55, botão "Confirmar Dinheiro" enxuto. **F3** busca: 1000px, grid 5-col `Produto·SKU·EAN·Estoque·Preço` ~50/15/15/10/10 com `minmax` anti-colapso + `line-clamp-2`, sem barra horizontal). **Ajuste visual apenas** — lógica/teclado/cálculos/APIs intactos; demais shells byte-idênticos ✅ | `90f433a` · `4e229b9` · *(equilíbrio neste commit)* |

**Prioridade imediata (sequência oficial):** (1) **finalizar PDV operacional** → (2) abrir **BL-07**
(estoque multi-depósito, Fase 0) → (3) iniciar **Fiscal** (NFC-e/SAT). **Importador Universal IA
fica adiado.**

**Esta entrada é só governança/documentação** — sem mudança de código/schema/runtime de PDV. As
correções de PDV acima já foram entregues e validadas (`tsc`/`build`) nos commits citados.

**HANDOFF · 02/06/2026 · PDV (Clássico)**
De: Claude Code (Opus) → próxima sessão

- ✅ **Concluído:** modais **F1** (Finalizar Pagamento) e **F3** (Pesquisar Produto) do Clássico — largura/grid equilibrados em **1000px**, sem barra horizontal, sem colapso "letra-por-letra", sem scroll vertical inicial; botão de dinheiro enxuto ("Confirmar Dinheiro"). `npx tsc --noEmit` 0 erros · `next build --webpack` OK (97 páginas).
- 🟡 **Em aberto:** validação visual final pelo operador na loja (`npm run dev:clean` + hard refresh).
- ⛔ **Bloqueado por:** nada.
- **Próxima ação:** considerar a **pausa operacional do PDV encerrada** e abrir **BL-07** (estoque multi-depósito, Fase 0 — ADR-0007 já aceito). **Não reabrir escopo de PDV** sem novo pedido explícito.
- **Arquivos críticos:** `components/dashboard/vendas/payment-modal.tsx` (branch `twoColumn`) · `components/dashboard/vendas/pdv-omni-classic-shell.tsx` (modal F3) · causa-raiz em `components/ui/dialog.tsx:64` (`sm:max-w-lg`).
- **Não tocar:** demais shells PDV (Supermercado / Venda Completa / Black — byte-idênticos), lógica/teclado/cálculos/eventos/APIs, estoque, financeiro, schema, auth, proxy.
- **Critério de pronto:** operador confirma F1/F3 visualmente equilibrados em uso real.
- **Risco:** baixo (somente classes Tailwind de largura/grid/espaçamento).

---

### MULTI_LOJA-S-003 — F-04/DT-07: router WhatsApp multi-loja por `phone_number_id` (Gate #2 aprovado · cutover pendente — 01/06/2026)

**Escopo fechado (SAFE-lite reforçado — área protegida autorizada):** elimina o **último vetor
`loja-1` aberto** do projeto. O WhatsApp era single-store (`WHATSAPP_WEBHOOK_STORE_ID` + número/token
global, com fallback silencioso `loja-1` via `webhookDefaultStoreId`). Passa a rotear **inbound por
`phone_number_id`** e resolver **credencial outbound por loja** — sem fallback. Decisão: **ADR-0006**.

| Arquivo | Mudança |
|---------|---------|
| `prisma/schema.prisma` + `prisma/migrations/0010_whatsapp_phone_number/` | Model **`WhatsAppPhoneNumber`** (`phoneNumberId @unique → storeId`, `tokenEnvKey`, `wabaId`, `displayPhone`, `active`). Migração **aditiva** (`CREATE TABLE IF NOT EXISTS` + FK guardada); aplicar com `npm run db:push`. Token **nunca no DB** — só o nome da env. |
| `lib/whatsapp/whatsapp-service.ts` | `webhookDefaultStoreId` **removido**. Novos: `resolveStoreIdByPhoneNumberId` (inbound), `resolveSoleActiveStoreId` (fluxos sem `phone_number_id`), `requireStoreCloudCreds` (outbound, lança + audita sem credencial). |
| `lib/whatsapp/store-credentials.ts` **(NOVO)** | `resolveCredentialsFromRow` (decisão **pura/testável**) + `resolveStoreWhatsAppCredentials(storeId)`. |
| `lib/whatsapp.ts` | Cliente Graph não lê env global de número/token — caller injeta `WhatsAppCloudCredentials`. |
| `lib/whatsapp-meta-cloud-webhook.ts` | Roteamento por `phone_number_id`; número não-mapeado/inativo → descarta + audita, **sem `loja-1`**. |
| `app/api/whatsapp/webhook/route.ts` + `app/api/debug/whatsapp-*` | Webhook não-Meta audita store-agnóstico; debug resolve via `?storeId=`/`resolveSoleActiveStoreId`. |
| `lib/whatsapp-webhook-ai.ts` | Owner-AI (`fechar_dia`) resolve a loja pela única ativa; 0/>1 → avisa o dono + audita, sem `loja-1`. |
| `app/actions/omni-agent.ts` | Status WhatsApp Cloud **por loja** (não env global). |
| `lib/whatsapp/whatsapp-service-routing.test.ts` + `lib/whatsapp/store-credentials.test.ts` | Guard estático (anti-reintrodução de `webhookDefaultStoreId`) + testes da decisão pura. |
| `scripts/backfill-whatsapp-phone-number.mjs` **(NOVO)** | Seed do número atual no mapa. |

**Validação (CP5):** `npx tsc --noEmit` 0 erros · `npm run build` **OK** (exit 0, árvore completa) ·
Vitest **258 passed | 2 expected fail** (era 245 | 3; o expected-fail do baseline F-04 agora passa).

**Auditoria de fechamento:** `docs/audits/AUDITORIA_F-04_WHATSAPP_ROUTER_MULTI_LOJA.md` — **0 P0/P1**;
F-01 (inbound) e F-02 (outbound) **resolvidos**; resíduos P2 (onboarding por loja) + P3 (heurística
Evolution single-number; 200 anti-retry intencional).

**Gate #2 aprovado (01/06/2026):** ADR-0006 `aceito`, DT-07 §3 ✅, commit + push em `main`. **Zero
fallback silencioso `loja-1` em todo o projeto** (server + client + WhatsApp). **Cutover operacional
pendente** (não executado): `npm run db:push` (aplica `whatsapp_phone_numbers`) → `backfill --exec`
(seed do número atual) → deploy.

**Não alterado:** auth, proxy, services `lib/financeiro/*` / `lib/operacoes/*`, PDV core. Schema e
`lib/whatsapp/*` foram tocados **com autorização explícita** (F-04 exige o mapa em schema).

---

### DT-16 — F-11: provider-fonte de loja ativa sem fallback loja-1 (concluído 01/06/2026)

**Escopo fechado (SAFE-lite reforçado):** elimina o último resíduo client-side de
`LEGACY_PRIMARY_STORE_ID` — a **raiz** que semeava `lojaAtivaId`. Com isso o **client-side
fica 100%** sem fallback silencioso para a loja principal (server-side já estava 100% via DT-03/DT-14).

| Arquivo | Mudança |
|---------|---------|
| `lib/loja-ativa-seed.ts` **(NOVO)** | Helper puro `resolveSeedStoreId(rawSaved, lojas)` — decisão de semente sem I/O/React. Retorna `null` quando nenhuma loja é determinável (1ª carga antes de `/api/stores`): **não semeia `loja-1`**. Sentinela legado `loja-antiga` migra para a primeira loja real. |
| `lib/loja-ativa.tsx` | O1: `mapStoresResponseToPerfis` descarta loja sem id (era `\|\| LEGACY`). O2+O3: effect de semente passa pelo helper; sem loja → não grava (re-roda quando `lojas` carrega). O5: `opsStorageKey` cai em `OPS_KEY_LEGACY` (não `loja-1`). Import de `LEGACY_PRIMARY_STORE_ID` removido. |
| `lib/perfil-loja-provider.tsx` | Irmão: `lojaAtivaId \|\| LEGACY_PRIMARY_STORE_ID` → `(lojaAtivaId ?? "").trim()`; sem unidade ativa não consulta `/api/settings/perfil-loja` (guard nos 2 effects). Import removido. |
| `lib/loja-ativa-seed.test.ts` **(NOVO)** | 9 testes do helper (inclui o bug-raiz: LS vazio + sem lojas → `null`). |
| `lib/multi-loja-client-no-legacy-fallback.test.ts` | Guard estático estendido (bloco DT-16) a `loja-ativa.tsx` + `perfil-loja-provider.tsx`. |

**Bug-raiz corrigido:** na race de 1ª carga (LS vazio + `lojas` ainda vazio), o effect semeava
`loja-1` em state+localStorage+cookie e, ao re-rodar, travava nele — prendendo contas multi-loja
cuja 1ª loja ≠ `loja-1`. Benigno na RafaCell (loja-1 é a matriz real), risco P2→P1 em multi-tenant.

**Validação:** `npx tsc --noEmit` 0 erros · Vitest **245 passed | 3 expected fail** · `npm run build` OK
(flake OOM nativo no Windows em "Collecting page data" na 1ª execução — recompilação com
`--max-old-space-size=8192` gerou todas as rotas; não é efeito do código).

**Não alterado:** schema Prisma, auth, proxy, services (`lib/financeiro/*`, `lib/operacoes/*`),
`store-defaults.ts` (constante canônica), `lib/ops-loja-id.ts` (P3), `lib/stores-api-access.ts`
(F-15, server). **Único vetor `loja-1` ainda aberto:** F-04/DT-07 (webhook WhatsApp single-store).

---

### Limpeza de unidades — Fase 1: Proteção de Lojas (concluído 30/05/2026)

Antecede a limpeza/exclusão das lojas de teste. Inventário read-only mapeou **10 lojas**
(relatório: `docs/modules/reports/INVENTARIO_LOJAS_2026-05-30.md`). Achado: a API
`DELETE /api/stores/[id]` só protegia a loja principal — **loja-2 e loja-11 estavam
excluíveis**. Fase 1 adiciona uma camada de proteção antes de qualquer DELETE.

| Arquivo | Papel |
|---------|-------|
| `lib/store-defaults.ts` | `PROTECTED_STORE_IDS = ["loja-1","loja-2"]`, `isWhitelistedProtectedStore()`, `evaluateStoreProtection()` (decisão pura, sem I/O) |
| `lib/stores-api-access.ts` | `assertStoreDeletable(req, storeId)` resolve loja principal + ativa e aplica a decisão; re-exporta a lógica |
| `app/api/stores/[id]/route.ts` | `DELETE` chama `assertStoreDeletable()` (substitui check só-principal) |
| `components/dashboard/configuracoes/gestao-unidades-saas.tsx` | Botão excluir desabilitado + badge "Protegida" p/ loja real/principal/ativa |
| `lib/stores-api-access.test.ts` | 9 testes da lógica de proteção |

**Bloqueios ativos:** loja-1 (403), loja-2 (403), loja principal (403), loja **ativa** (409),
storeId vazio (400). **loja-11 permanece SEM proteção** de propósito (decisão de destino
pendente). Validação: `tsc` limpo · `next build` OK · `vitest` 12/12 (novos + store-defaults).

**Não alterado:** schema Prisma, auth, proxy. **Nenhuma limpeza/exclusão executada** —
Fases 2-5 aguardam autorização explícita.

**Memória viva consolidada:**
[`docs/memory/OMNIGESTAO_MASTER_MEMORY.md`](../memory/OMNIGESTAO_MASTER_MEMORY.md)

**Auditoria consolidada:**
[`docs/modules/reports/AUDITORIA_GERAL_OMNIGESTAO_PRO.md`](../modules/reports/AUDITORIA_GERAL_OMNIGESTAO_PRO.md)

---

### Migração Smart Genius — adaptador Clientes + Contas a Receber (concluído 29/05/2026)

**Problema:** os relatórios Smart Genius `RELATORIO DE CLIENTES CADASTRADOS.xls` e
`RELATORIO DE CONTAS Á RECEBER.xls` não importavam pelo Importador Avançado:
clientes caíam 100% como "Nome vazio" (banner na linha 0 + cabeçalho real em 1-2 linhas
não lido por `sheet_to_json` sem `header:1`); contas a receber caíam como `desconhecido`
(filename "contas **a** receber" não casava, cabeçalho na linha 1, rótulos Smart
`Total:`/`Menor Venc:`/`Em atraso:`/`A vencer:` ausentes do dicionário).

**Solução:** adaptador **isolado** `lib/importador-avancado/smart-genius/`, interceptado
em `app/api/import/advanced/route.ts` ANTES do fluxo genérico. Detecção estrita por
banner ("Listagem de Clientes" / "Listagem de Contas a Receber") com testes negativos
garantindo que **Gestão Clique e Smart Genius Produtos NÃO casam** (seguem intactos).

| Arquivo | Papel |
|---------|-------|
| `lib/importador-avancado/smart-genius/detectar.ts` | Detecção por assinatura de banner + cabeçalho (1 ou 2 linhas) |
| `lib/importador-avancado/smart-genius/parser.ts` | AOA (`header:1`), pula banner, mapa rótulo→coluna, normaliza |
| `lib/importador-avancado/smart-genius/normalizar.ts` | número BR, telefone (remove duplicata), data dd/mm→ISO |
| `lib/importador-avancado/smart-genius/persistir.ts` | Clientes (dedupe por nome) + Contas a Receber (2 títulos via `upsertContaReceber`) |
| `lib/importador-avancado/smart-genius/orquestrar.ts` | Separa Smart vs genérico; persiste clientes antes de contas |
| `app/api/import/advanced/route.ts` | Branch Smart (fase 1.5); fluxo genérico intacto para o resto |
| `+ detectar.test.ts / parser.test.ts` | 12 testes (inclui negativos GC/Smart Produtos) |

**Regra Contas a Receber (aprovada):** saldo consolidado → 2 títulos/cliente.
`Em atraso > 0` → título **vencido** (desc. "SALDO MIGRADO SMARTGENIUS - EM ATRASO");
`A vencer > 0` → título **pendente** (desc. "… - A VENCER"); valor zero não cria título;
importa o **principal** (nunca soma Reaj); `Total`/`Reaj`/`Tot. Reaj`/código legado vão em
`payload.observacao`. Vencimento = "Menor Venc". `localKey` = `imp-smart:{storeId}:cr:{codigo|slugNome}:{atraso|avencer}`
(idempotente). Reimport não rebaixa título já pago/parcial/cancelado/estornado.

**Validação contra arquivos reais:** Clientes 80 válidos / 4 sem-nome; Contas 45 clientes →
**42 títulos vencidos (R$ 16.280,50) + 7 pendentes (R$ 1.243,06)**. `tsc` limpo ·
`vitest` 202 passed / 4 expected-fail · `next build` OK.

**Não alterado (intacto):** schema Prisma, auth, proxy, `financeiro/contracts`, Importador de
Produtos, fluxo genérico do Importador Avançado (Gestão Clique). Nenhuma migração de banco.

---

### SPRINT_MULTI_LOJA-S-001 — Fallback silencioso loja-1 eliminado + ACL guards (concluído 29/05/2026)

**Escopo:** F-01 + F-02 (atômicos) + F-05 + F-06 + F-07 + F-14.

| Item | Estado |
|------|--------|
| `storeIdFromAssistecRequestForRead` | Retorna `null` (era `"loja-1"`) |
| `opsLojaIdFromRequest` (ops-api-gate) | Retorna `string \| null` |
| Callers com `\|\| "loja-1"` | 55 rotas + helpers corrigidos com guard 400 |
| Exceção F-02-anchor | `exportar/route.ts` — TODO para Sprint_02 |
| auth() + canAccessStore | dashboard/resumo, dashboard/elite, clients, ops/inventory, ops/sync-legacy-vendas |
| WhatsApp actions canAccessStore | sendWhatsAppTextAction, sendWhatsAppTemplateAction, sendWhatsAppMediaAction |
| send-daily canAccessStore | Adicionado após storeId resolvido |
| `sendDailyClosingToPhone.storeId` | Não-nullable (F-14) |
| Testes | 189 passed \| 4 expected fail (era 90 \| 14) |
| **Status** | **Pronto para Gate #2 (merge)** |

**Pendências remanescentes (próximas sprints):**
- ~~F-03 — proxy.ts cookie typo~~ — ✅ RESOLVIDO em SPRINT_MULTI_LOJA-S-002
- F-04 — Webhook WhatsApp single-store (`WHATSAPP_WEBHOOK_STORE_ID`) — schema novo necessário
- F-08 — sync-legacy-financeiro sem auth+canAccessStore — sprint de descomissionamento legacy
- ~~F-02-anchor — `exportar/route.ts` via anchor-tag~~ — ✅ RESOLVIDO em SPRINT_MULTI_LOJA-S-002

---

### SPRINT_MULTI_LOJA-S-002 — F-03 (proxy cookie typo) + F-02-anchor (exportar) (concluído 30/05/2026)

**Escopo fechado:** F-03 + F-02-anchor (somente). Nenhuma área vetada tocada.

| Finding | Local | Correção |
|---------|-------|----------|
| F-03 | `proxy.ts:132` | Lia `req.cookies.get("assistec_active_store")` (underscores) — cookie real é `assistec-active-store` (hífens). Agora importa e usa `ASSISTEC_ACTIVE_STORE_COOKIE` de `@/lib/store-defaults`. O redirect `?storeAccess=denied` (ACL de loja na borda via `enterpriseStoreCookieRedirect`) passa a disparar de verdade. |
| F-02-anchor | `app/api/financeiro/relatorios/exportar/route.ts:303-307` | Removido o `\|\| "loja-1"` (único remanescente em produção). `storeId` ausente → **400** explícito (alinhado ao ADR-0003). O caller (`FinanceiroRealContext.tsx:exportarRelatorio`) já enviava `storeId` na query e bloqueava sem loja ativa — caminho feliz intacto. |

**Testes ajustados:** `lib/proxy-cookie-mismatch.test.ts` (snapshots do bug → contrato pós-fix; `it.fails` → `it`); `lib/multi-loja-no-hardcoded-fallback.test.ts` (removida a exclusão do `exportar/route.ts` — agora coberto, segue 0 ocorrências).

**Validação:** `tsc` limpo · Vitest **217 passed | 3 expected fail** · `next build` OK (middleware Proxy compilou no Edge). **Não alterado:** schema Prisma, auth, demais áreas vetadas. ADR-0003 atualizado (exceção F-02-anchor encerrada).

---

### P0 — Importador de Produtos: matching seguro + isolamento multi-loja (concluído 26/05/2026)

**Incidente reportado:** ao importar planilha Smart (~4.800 itens) na Loja de Teste,
preview reportou 25 possíveis duplicados; mas a execução do lote 1/10 retornou
`Criados 0 / Atualizados 500`. Resultado real: 239 produtos antigos foram **sobrescritos**,
nenhum novo foi criado.

**Causa raiz (5 bugs):**

1. **SKU inventado** (`persist.ts:58-60` antigo): quando a planilha não trazia SKU, o persist gerava `IMP-${cat}-${slugDoNome.slice(0,20)}`. Nomes parecidos (ex.: "Cabo USB 1m", "Cabo USB 2m") colidiam no slice → mesmo SKU → atualização cruzada em massa.
2. **Matching `OR` agressivo** (`persist.ts:64-69` antigo): buscava `sku`, `sku-original`, `sku-normalizado`, `gc-${sku}`, `barcode`, **e barcode == sku se EAN-like**. SKU curto "10" da planilha bateu em produto antigo com SKU "10" da GestãoClick.
3. **Aliases agressivos de SKU** (`normalizar.ts`): `"id"` e `"cod"` mapeavam qualquer índice numérico (1, 2, 3…) para SKU.
4. **Preview ≠ Execute**: `dedupe.ts` (preview) usava um critério; `persist.ts` (execute) usava um OR mais amplo + considerava o SKU inventado. Daí "preview 25, execute atualizou 500".
5. **Sem trava anti-update massivo**: rota aceitava qualquer ratio criados/atualizados sem questionar.

Sobre multi-loja: `storeIdFromAssistecRequestForWrite` já está correto (sem fallback `loja-1`, retorna `null` se header ausente). Schema do Produto tem `@@unique([storeId, sku])` e `where: { storeId }` em todas as queries. Mas adicionamos **defesa em profundidade** com `lojaAtivaIdConfirmado` no body do lote — server compara com o header e aborta em divergência.

**Arquivos alterados/criados:**

| Arquivo | Mudança |
|---------|---------|
| `lib/importador-produtos/match.ts` **(NOVO)** | Função única `resolveProductImportMatch(p, banco)` + `decidirAcao(resolucao, modo)`. Classifica SKU/barcode em `forte` (alfanumérico OU ≥7 dígitos OU EAN-8/12/13/14) vs `fraca` (curto numérico ≤6 dígitos). Match fraco NUNCA autoriza update automático. |
| `lib/importador-produtos/normalizar.ts` | Removidos aliases `"id"` e `"cod"` (curtos demais, ambíguos). Mantidos `"sku"`, `"codigo"/"código"`, `"codigo interno"`, `"referencia"`, `"ref"`. |
| `lib/importador-produtos/persist.ts` | Reescrito: `aplicarLinha` usa `resolveProductImportMatch` + `decidirAcao`. SKU vazio → grava `null` (não inventa `IMP-*`). Snapshot do banco em 2 queries batch (em vez de N `findFirst`). Verifica `existente.storeId === storeId` antes do update. Logs estruturados. |
| `lib/importador-produtos/dedupe.ts` | Reescrito: `analisarDuplicadosBanco` usa a MESMA `resolveProductImportMatch` do persist. Devolve `{ forte, fraco, semChave }`. Preview e execução agora compartilham a lógica de match. |
| `lib/importador-produtos/types.ts` | + `ModoConflito: "atualizar" \| "pular" \| "criar"` (default novo é `criar`). + `analiseDuplicadosBanco: AnaliseDuplicados` no preview. + `lojaAtivaIdConfirmado: string` no `LoteRequest` (verificação dupla server-side). + `LoteErroSeguranca`. |
| `app/api/import/produtos/preview/route.ts` | Storeid ausente → 400 com mensagem clara (sem fallback). Usa `analisarDuplicadosBanco` (forte/fraco). Logs estruturados. |
| `app/api/import/produtos/lote/route.ts` | (a) Valida `body.lojaAtivaIdConfirmado === storeId` ou 409. (b) Trava **anti-update massivo**: se `criados=0 && atualizados=itens.length`, ou se `atualizados/itens > 50% && criados=0 && atualizados≥50` → 422 + log de auditoria `import.produtos.lote.bloqueado`. (c) `metadata.telemetria` com contagem de matches forte/fraco. |
| `components/dashboard/configuracoes/importador-produtos/hooks/use-importador-produtos.ts` | Default `modoConflito = "criar"`. `escolherArquivo` faz reset hard (abort fetch + reseta estado). Detecta troca de loja no meio do fluxo e reseta. Envia `lojaAtivaIdConfirmado`. Valida `preview.storeId === lojaAtivaNoMomento` antes de enviar lote. |
| `components/dashboard/configuracoes/importador-produtos/LotesProdutos.tsx` | `ModoConflitoSelector` passa a expor 3 modos com tooltips claros: "Criar novos (seguro)", "Atualizar existentes", "Pular qualquer duplicata". |
| `components/dashboard/configuracoes/importador-produtos/PreviewProdutos.tsx` | Cards passam a separar "Match FORTE no banco", "Match FRACO (não atualiza)" e "Sem chave (criados sem SKU)" — operador vê exatamente o que vai acontecer. |
| `lib/importador-produtos/match.test.ts` **(NOVO)** | 25 testes Vitest cobrindo classificação SKU/barcode, resolução de match, decisão por modo, e o **cenário do incidente Smart** (239 antigos + 500 novos com SKUs curtos): default e modo "atualizar" criam 500, modo "pular" pula 239 + cria 261. |

**Regra SKU/barcode/código interno (consolidada):**

| Origem na planilha | Vai para | Aceita update auto? |
|---|---|---|
| Coluna "SKU"/"Código"/"Referência" alfanumérica | `Produto.sku` | sim, se modo "atualizar" |
| Coluna "SKU"/"Código" numérica ≥7 dígitos | `Produto.sku` (forte) | sim, se modo "atualizar" |
| Coluna "SKU"/"Código" numérica ≤6 dígitos (ex.: "10", "148", "1000") | `Produto.sku` (gravado, mas considerado **fraco**) | **NÃO** — produto novo é criado |
| Coluna "Código de barras"/"EAN"/"GTIN" 8/12/13/14 dígitos | `Produto.barcode` (forte) | sim, se modo "atualizar" |
| SKU/barcode vazios na planilha | `null` no banco (Postgres NULL não conta para `@@unique`) | n/a |

**Proteção anti-update errado (resumo):**

1. **Classificação de chave** em `match.ts` separa forte vs fraca antes de qualquer query.
2. **Preview e execute compartilham** a função `resolveProductImportMatch` — não pode divergir.
3. **Default seguro**: modo `"criar"` (cria todos; pula só com match forte).
4. **Trava server-side**: lote com `criados=0 + atualizados=todos` ou ratio > 50% sem nenhum criado retorna 422 + auditoria `bloqueado`.
5. **Verificação dupla de loja**: `lojaAtivaIdConfirmado` no body é comparado ao `storeId` do header — divergência aborta com 409.
6. **Reset hard no client**: trocar arquivo OU loja ativa aborta fetch pendente e zera estado.
7. **Defesa final por linha**: antes do `update`, confere `existente.storeId === storeId`; mismatch retorna erro `tentativa de atualizar produto da loja X a partir da loja Y (bloqueado)`.

**Onde estava o vazamento storeId (multi-loja):**

Não houve vazamento estrutural — `storeIdFromAssistecRequestForWrite` e o `where: { storeId }` em todas as queries já isolavam por loja. A hipótese mais provável do incidente é **race entre troca de unidade na UI e click no botão de importar**: o usuário trocou para Loja de Teste, mas o header `x-assistec-loja-id` ainda continha `loja-1` no momento do upload. Daí a query achou os 239 produtos antigos da loja-1 e os atualizou. As travas novas (`lojaAtivaIdConfirmado` + reset on store change) bloqueiam esse cenário.

**Comandos Prisma/migração:** nenhum. O schema `Produto.sku` já era `String?` — gravar `null` quando vazio funciona out-of-the-box no Postgres.

**Validação:**
- `npx tsc --noEmit` → 0 erros
- `npx vitest run lib/importador-produtos/match.test.ts` → **25 testes passando** (cenário Smart inclusive)
- `npm run build` → ver resultado mais abaixo (em execução)

**Não alterado (intacto):** schema Prisma, auth, proxy, sidebar, PDV, financeiro, vendas, marketplace, WhatsApp, Omni Agent. O Importador Avançado (aba "Planilhas") segue intacto — só o "Produtos (lotes)" foi reformulado.

**Próximo passo recomendado:** após confirmar o build, refazer o teste real com a planilha Smart na aba "Produtos (lotes)" da Loja de Teste e validar que o resultado bate com o preview (deve criar a maioria, não atualizar nada da loja-1).

---

## ✅ Concluído e Funcionando

---

### Importação — aviso "XLS legado de produtos" na aba Planilhas (concluído 26/05/2026)

**Contexto:** homologação do Importador de Produtos em lotes (entrega anterior) expôs uma armadilha
de UX: ao enviar `Relatorio de produtos cadastrados.xls` na aba **antiga "Planilhas"** (Importador
Avançado) em vez da nova **"Produtos (lotes)"**, o resultado foi `Criados 0 / Atualizados 0 /
Ignorados 4749 / Erros 0` com mensagem de sucesso. Causa raiz: o parser do avançado
(`lib/importador-avancado/parser.ts:23`) chama `sheet_to_json` sem `header:1` e usa a 1ª linha do
XLS como cabeçalho. Como o relatório legado tem banner antes do header real, todos os "headers"
ficam fora do dicionário semântico, `produto.nome` nunca é mapeado e cada linha cai em
`Nome vazio` em `lib/importador-avancado/persistidor.ts:194-197`.

Não mexemos no parser antigo nesta entrega (decisão explícita do usuário: validar a planilha
na aba nova primeiro). Apenas adicionamos um aviso preventivo na aba errada.

| Arquivo | Mudança |
|---------|---------|
| `components/dashboard/configuracoes/importador-avancado/ImportadorAvancado.tsx` | + helper inline `parecemXlsLegadoDeProdutos(file)` (estrito: extensão `.xls` BIFF antigo **+** "produto" no nome, sem acento). + prop opcional `onSwitchToProdutosLotes?: () => void`. Banner amber sob `UploadZone` quando há ≥1 arquivo detectado: explica por que o avançado ignoraria tudo, lista os arquivos, e (se a callback foi passada) renderiza botão "Abrir aba 'Produtos (lotes)'". Sem bloqueio do fluxo — o usuário ainda pode pré-visualizar se quiser. |
| `components/cadastros/lovable/components/cadastros/ImportacaoHub.tsx` | `PlanilhasSection` ganha prop `onSwitchToProdutosLotes` e a repassa para `<ImportadorAvancado>`. O `ImportacaoHub` injeta `() => setSub("produtos")` ao renderizar a aba Planilhas. |

**Não alterado (intacto):** schema Prisma, auth/proxy, parser/detector/merger/persistidor do
Importador Avançado, fluxo da aba "Produtos (lotes)", outras rotas de importação. Outras chamadas
de `<ImportadorAvancado />` fora do ImportacaoHub (se existirem) continuam funcionando — a prop é
opcional, sem callback o banner só mostra o texto orientativo.

**Critério de detecção (deliberadamente estreito):** só dispara para `.xls` (BIFF antigo) com
"produto" no nome. Não pega `.xlsx` legítimos (backups GestaoClick canônicos) nem `.xls` de
outros domínios (clientes, vendas).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (todas as rotas geradas, sem erros nem warnings).

**Próximo passo (pendente, fora desta entrega):** validar a mesma planilha
`Relatorio de produtos cadastrados.xls` na aba **"Produtos (lotes)"**, conferir o preview real
(linhas lidas / válidos / inválidos / cabeçalho detectado), e só então decidir se o parser
antigo precisa ser endurecido (`header:1` + `detectarCabecalho` portado do novo).

---

### Encerramento de fase — WhatsApp HUB Agentic AI + Omni Agent endurecido (26/05/2026)

**Contexto:** auditorias finais pós-correções; escopo documental apenas (histórico abaixo preservado).

#### WhatsApp HUB (`/dashboard/whatsapp`)

| Item | Estado |
|------|--------|
| Inbox Agentic AI operacional | Conversas/mensagens reais (API + polling); envio via `POST /api/whatsapp/send` (Meta Cloud quando configurada) |
| CRM real | Painel lateral com cliente vinculado; OS e vendas reais quando há `clienteId` |
| Vínculo seguro por telefone | `PATCH` conversa + `GET /api/clientes/match-by-phone` (match scoped por loja) |
| Endpoint match-by-phone | `app/api/clientes/match-by-phone` |
| Painel lateral | OS/vendas/histórico a partir de cadastro e APIs reais |
| Análise IA | `POST /api/whatsapp/conversations/[id]/ai-analysis` — LLM server-side (OpenRouter/OpenAI/Gemini) + cache |
| Sugestão IA | LLM real no card IA; fallback honesto em `lib/whatsapp/ai-local-suggestion.ts` (rótulos «Sugestão local» / heurística explícita) |
| Auditoria final | Sem P0 bloqueante no fluxo operacional principal — ver relatório |
| **Status** | **Pronto para piloto operacional** (credenciais Meta + chave LLM no servidor) |

#### Omni Agent HUB (`/dashboard/omni-agent`)

| Item | Estado |
|------|--------|
| Endurecimento multi-loja | `assertStoreId` nas Server Actions; UI bloqueia sem unidade ativa (`OmniAgentStoreRequired`) |
| Auth `handle-event` | `lib/omni-agent/automation-event-guard.ts` — sessão enterprise ou assinatura ops; header = `payload.storeId` |
| Remoção fallback `loja-1` | Sem `LEGACY_PRIMARY_STORE_ID` no Hub nem em `lib/omni-agent` |
| Catálogo honesto | `COMMAND_GROUPS_REAL` vs `COMMAND_GROUPS_TRIAGE` (venda/estoque = triagem; despesa/recebimento avulso = movimentação real após confirmar) |
| Executores financeiros reais | `EXPENSE_CREATE` → `MovimentacaoFinanceira` saída; `RECEIVABLE_CREATE` → entrada (`origem: omni_agent`, idempotência por `commandId`) |
| Canal real persistido | Modal «Novo comando» + feed/inbox com `normalizeOmniAgentCanal` / `canalDisplayLabel` |
| Eventos OS entregue | `emitOsFinalizadaOmniEvent` em `updateOSStatus` (transição → `entregue`) |
| Auditoria final | Sem P0 operacionais abertos — ver relatório |
| **Status** | **Piloto enterprise interno** (regex determinístico; sem LLM autónomo nesta fase) |

#### Configurações (aba `settings`) — persistência real (GOAL OMNI-AGENT-HUB-CONFIG-REAL-001, 08/07/2026)

| Item | Estado |
|------|--------|
| Modelo `OmniAgentConfig` | Novo, aditivo, 1 linha por loja (`prisma/schema.prisma`); substitui a chave `omni-settings` do `localStorage` |
| Perfil do agente, canal padrão, horário, autonomia | Persistidos via `getOmniAgentConfig`/`upsertOmniAgentConfig`/`resetOmniAgentConfig` (`app/actions/omni-agent.ts`) |
| Efeito real no pipeline | `omniAgentNeedsConfirmation` (`lib/omni-agent/config.ts`): autonomia `baixo` e `extraConfirmIntents` forçam confirmação extra em leituras; canal padrão preenche `submitOmniAgentCommand` quando nenhum canal é informado. Escritas continuam exigindo confirmação sempre, sem exceção configurável |
| Removido (teatro) | Toggle "Aprovação automática" (nunca teve efeito) e painel de "Permissões demo" editável (permissões reais são só papel NextAuth + `INTENT_MODULE`, não editáveis aqui) |
| Ainda sem efeito automático | Horário de atendimento (persistido, não gate nenhuma rotina ainda); perfil/tom/prompt (sem provider LLM) |
| **Status** | Configuração real por loja; nenhuma automação/LLM/provider/workspace introduzidos (fora de escopo deste GOAL) |

#### Memória Cliente (aba `memory`) — memória operacional real (GOAL OMNI-AGENT-HUB-MEMORY-REAL-001, 08/07/2026)

| Item | Estado |
|------|--------|
| Modelo `OmniAgentMemory` | Novo, aditivo (`prisma/schema.prisma`); `storeId` obrigatório, `clienteId` opcional (`onDelete: SetNull`) |
| Tipos suportados | `nota`, `decisao`, `lembrete`, `incidente`, `preferencia`, `observacao` (`lib/omni-agent/memory.ts`) |
| Server actions | `app/actions/omni-agent-memory.ts`: `createOmniAgentMemory`, `updateOmniAgentMemory`, `archiveOmniAgentMemory`, `listOmniAgentMemoriesByCliente`, `listRecentOmniAgentMemories`, `searchOmniAgentMemories` — todas com gate `workspace.omniAgent` + `storeId` |
| Arquivar ≠ apagar | `status: ativo \| arquivado`; nunca há `delete` físico |
| Auditoria | `OMNI_AGENT_MEMORY_CREATE` / `_UPDATE` / `_ARCHIVE` em `logs_auditoria` |
| Integração com comandos | `REMINDER_CREATE` no executor (`lib/omni-agent/executor.ts`) agora também grava uma `OmniAgentMemory` (`tipo: lembrete`, `origem: omni_agent`), além do log de auditoria já existente. Sem nova interpretação em `interpret.ts` |
| UI | Aba Memória Cliente: lista/cria/edita/arquiva memórias do cliente selecionado; card "Últimas memórias da loja" com busca por termo. `localStorage` (chave `omni-notes`) removido |
| Removido (teatro) | Card fixo "Memória operacional / timeline IA ainda não ativada" — substituído pela memória real |
| **Status** | Memória operacional real, sem LLM/embeddings/timeline automática — registro manual estruturado, buscável por termo |

#### Timeline Operacional Real (aba `memory`) — GOAL OMNI-AGENT-HUB-TIMELINE-REAL-001 (08/07/2026)

Sem modelo Prisma novo: é uma **agregação read-only** de fontes já persistidas. Sem IA, sem inferência,
sem resumo automático — cada evento tem origem e referência rastreáveis (`kind` + `id` da fonte real).

| Origem | Fonte real | Observações |
|--------|-----------|-------------|
| `memoria` | `OmniAgentMemory` | 1 evento por registro (ativo ou arquivado); tipo/prioridade derivados do campo `tipo` da memória |
| `comando` | `OmniAgentCommand` | Sempre loja-wide (o modelo não tem FK de cliente); `clienteId` só é preenchido quando `resultado.clienteId` existe (ex.: `OS_OPEN` executado) |
| `auditoria` | `logs_auditoria` (`action IN (OMNI_AGENT_CONFIG_SAVE, OMNI_AGENT_CONFIG_RESET)`) | Única contribuição não-duplicada da auditoria — as demais ações Omni (`OMNI_AGENT_LEMBRETE`, `_EXEC_OK`, `_EXEC_ERRO`, `_DESPESA`, `_RECEBIMENTO`, `_MEMORY_*`) já são representadas por `OmniAgentMemory`/`OmniAgentCommand` e foram deliberadamente excluídas para não duplicar o mesmo fato |
| `ordem_servico` | `OrdemServico.payload.timeline` (`EventoTimeline[]`) | Quando a OS tem timeline rica, cada entrada vira 1 evento; sem timeline (ex.: importação legada), 1 evento de fallback "OS aberta" a partir de `createdAt` |
| `cliente` | `Cliente.createdAt` | Só aparece com um `clienteId` explícito no filtro (1 evento "Cliente cadastrado"); não lista clientes recentes da loja (fora de escopo, evita duplicar Cadastros HUB) |

| Item | Estado |
|------|--------|
| Módulo puro | `lib/omni-agent/timeline.ts` — tipos, mapeadores por origem, `aggregateOmniAgentTimeline` (filtro por cliente/origem/tipo/período/busca + ordenação desc + paginação), 100% testável sem banco |
| Server action | `app/actions/omni-agent-timeline.ts` — `getOmniAgentTimeline(storeId, filtros)`, gate `workspace.omniAgent`; busca só as origens pedidas (evita consultas desnecessárias); cada fonte com `take` limitado antes de agregar |
| Isolamento | Toda query filtra por `storeId`; `logs_auditoria` (sem coluna `storeId` própria) é filtrada em memória a partir do `metadata` JSON antes de virar evento |
| UI | Aba Memória Cliente ganhou card "Timeline operacional": filtro loja/cliente, origem (multi-seleção), período (de/até), busca por termo, paginação "Carregar mais" |
| **Diferença para a futura Timeline Inteligente (Omni Core)** | Esta é a **Timeline Operacional**: organiza fatos existentes, sem gerar texto novo. A Timeline Inteligente (fase futura do Core) adicionaria resumo por LLM, inferência de padrões e memória semântica — nenhuma dessas capacidades existe aqui |
| **Status** | Real, somente leitura, sem duplicar dados entre origens |

#### Pendências restantes (próximas fases — não bloqueiam o encerramento acima)

- Migration futura: coluna `storeId` em `logs_auditoria` (hoje `storeId`/`tenantId` só em `metadata` JSON nas escritas Omni) — a Timeline já contorna isso filtrando em memória, mas uma coluna real destravaria consultas mais amplas de auditoria.
- Emissor server-side para evento `conta_receber_vencida` (cron/job financeiro).
- Executores reais: venda / estoque (além de triagem/lembrete); despesa e recebimento avulso já persistem em `MovimentacaoFinanceira`.
- WhatsApp bidirecional no Agent (canal persistido; outbound Meta continua no HUB WhatsApp).
- LLM governado com tools/JSON schema no Omni Agent.
- Memória operacional unificada (timeline cliente: PDV + OS + WhatsApp + financeiro) — a Timeline Operacional Real acima já unifica memória/comando/config/OS/cadastro; PDV e WhatsApp como origens seguem futuros.
- Horário de atendimento sem enforcement automático ainda (persistido, sem gate de rotina).
- `OmniAgentMemory` sem reativação de item arquivado (só arquivar) — avaliar se faz sentido no próximo GOAL.
- Timeline sem paginação por cursor (usa offset em memória) — trocar por cursor se o volume por loja crescer muito.

#### Referências de auditoria

- [`docs/audits/AUDITORIA_FINAL_WHATSAPP_HUB.md`](../audits/AUDITORIA_FINAL_WHATSAPP_HUB.md)
- [`docs/audits/AUDITORIA_FINAL_OMNI_AGENT_HUB.md`](../audits/AUDITORIA_FINAL_OMNI_AGENT_HUB.md)

**Validação desta atualização doc:** `npx tsc --noEmit` — escopo só markdown; sem alteração de código.

---

### Lote 5 — Remoção do else branch JSX do PDV Clássico (concluído 26/05/2026)

**Contexto:** follow-up direto do Lote 4. Quando `uiShell` foi colapsado para o literal `"omni-smart"`, o ternário `{uiShell === "omni-smart" ? (...) : (...)}` em `pdv-classic.tsx` passou a ter o ramo `else` permanentemente inalcançável em runtime. Eram **~710 linhas de UI legada** (toggle balcão/completa, busca de cliente inline, grid de produtos client-side, painel do carrinho lateral antigo, totais e botão "Finalizar venda" legado) já reimplementadas dentro do `PdvOmniClassicShell`. Mantê-las era código morto puro — risco zero de runtime, mas confunde leitura, deixa "feature fantasma" e infla o arquivo.

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/pdv-classic.tsx` (commit `f9cf0d1`) | **Substituição cirúrgica do ternário inteiro** pelo conteúdo do branch ativo (`<div className="..."><CaixaStatusBar /><PdvOmniClassicShell />`). Zero mudanças em handlers, estados ou imports. **−713 / +0 linhas** (2518 → 1805). |

**Mantido (vestígios benignos da prop `uiShell`):**
- Tipo `uiShell?: "omni-smart"` (linha ~171) — contrato público.
- Default `uiShell = "omni-smart"` (linha ~185) — assinatura do componente.
- Dependency arrays e comentários históricos referenciam `uiShell` em ~4 lugares. Limpeza cosmética para um próximo passe (não há condicional executável dependendo dela).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (todas as 80+ rotas geradas).

**Commit:** `f9cf0d1` (refactor PDV — else branch removido).

**Não alterado:** schema Prisma, auth/proxy, demais PDVs (Supermercado, Assistência, Venda Completa Enterprise, Black Edition), `PdvOmniClassicShell`, modais compartilhados, `CaixaStatusBar`/`CaixaProvider`. Outras sessões paralelas (WhatsApp, ia-mestre, omni-agent, credits) **não foram tocadas** neste lote — commit isolou apenas `pdv-classic.tsx`.

**Riscos restantes:** nenhum funcional. Vestígios da prop `uiShell` (tipo + default + comentários) podem ser podados num passe cosmético futuro.

---

### Lote 4 — Limpeza do keymap legado `uiShell=default` (concluído 26/05/2026)

**Contexto:** última pendência do contexto inicial (#7). O `PdvClassic` carregava um caminho legado para `uiShell="default"` (handler de teclado próprio, dialog `operationType` de sangria/suprimento, painel `cashHistory` local, função `saveOperation`). Em produção `vendas-pdv.tsx:117` SEMPRE passa `uiShell="omni-smart"` — então o caminho `default` era **código morto**, e qualquer atalho adicionado ali virava "feature fantasma" (não executava).

**Sangria/suprimento já tinham migrado** para o `CaixaStatusBar` compartilhado (com retry/idempotência via `lib/pdv-caixa-operacao.ts`) em sessão anterior, mas o código antigo nunca foi removido por cautela.

**Auditoria confirmou:**
- Único consumidor: `app/dashboard/vendas/vendas-pdv.tsx:117` — `<PdvClassic ... uiShell="omni-smart" />` fixo.
- Outros caminhos (`pdv-github-original/`) já estavam gated por env flag desde a Sprint 0.

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/pdv-classic.tsx` (commit `687d92c`) | **Remoção do dead code:** `useEffect` handler legado (~125 linhas), função `saveOperation` (~110 linhas), helper `labelOperacaoCaixa`, states `operationType`/`operationValue`/`operationReason`/`cashHistory`, dialog `operationType` + painel "Histórico financeiro do caixa", ramo `operationType !== null` em `shellModalBlocking`. Imports mortos: `HandCoins`, `useCaixa`, destructuring `adicionarEntrada`/`adicionarSaida`/`sessaoId`. **−307 / +22 linhas**. |
| `components/dashboard/vendas/pdv-classic.tsx` (commit `2d5a184`) | **Limpeza do tipo + condicionais:** tipo `uiShell?: "default" \| "omni-smart"` → `uiShell?: "omni-smart"`. Default `"default"` → `"omni-smart"`. 12 condicionais defensivas (`if (uiShell !== "default")`, `if (uiShell === "default") return`, etc.) removidas. Deps `uiShell` desnecessárias removidas dos `useEffect`/`useCallback`. **−67 / +46 linhas**. |

**Mantido (omni-smart usa ativamente):**
- `pdvUiMode` (touch/scanner) + botões correspondentes.
- Refs `productInputRef`, `customerInputRef`, `quantityInputRef` + inputs.
- ~~Ternário `{uiShell === "omni-smart" ? (...) : (...)}` no JSX~~ — **removido no Lote 5** (commit `f9cf0d1`, −713 linhas).

**Total da limpeza:** **−374 / +68 linhas** (saldo líquido de ~306 linhas removidas).

**Validação:** `npx tsc --noEmit` 0 erros nos arquivos da sessão · `npm run build` OK (todas as 80+ rotas geradas).

**Commits:** `687d92c` (remoção dead code) · `2d5a184` (tipo e condicionais).

**Não alterado:** schema Prisma, auth/proxy, contratos públicos (prop `uiShell` continua opcional aceitando `"omni-smart"`), demais PDVs, CaixaStatusBar e CaixaProvider.

**Riscos restantes:**
- ~~Ternário JSX `uiShell === "omni-smart" ? (...) : (...)` ainda renderiza a branch `else` no código~~ — **resolvido no Lote 5** (commit `f9cf0d1`).
- `components/pdv-github-original/` mantém cópia antiga do `PdvClassic` (gated por env, sem importação ativa). Não tocado nesta sessão — segue como artefato histórico.

---

### Lote 3 — Recebimento de Contas no PDV (F9 convergente nos 3 PDVs) (concluído 26/05/2026)

**Contexto:** pendência #4 do contexto — receber/baixar títulos de Contas a Receber direto do PDV, sem ter que sair para o módulo financeiro. Convergência operacional: mesmo modal, mesmo backend, mesmo atalho nos 3 PDVs.

**Tecla escolhida:** F9 (canônico do `lib/pdv-keymap.ts`). O contexto inicial sugeria F5, mas F5 já é "Cancelar item selecionado" nos PDVs e no keymap canônico. F9 já estava reservado como "Contas a receber" no mapa — agora vira "Recebimento de contas (liquidar / pagamento parcial)" e ganha implementação real.

**Backend reusado (sem novo endpoint):**
- `GET /api/ops/contas-receber-list` — lista todos os títulos da loja com summary/audit.
- `POST /api/financeiro/contas-receber/liquidar` — baixa total (gera `MovimentacaoFinanceira` entrada, idempotente).
- `POST /api/financeiro/contas-receber/pagamento-parcial` — baixa parcial (mantém status pendente, soma no histórico do payload).

| Arquivo | Mudança |
|---------|---------|
| `components/dashboard/vendas/pdv-recebimento-modal.tsx` (NOVO ~415 linhas) | Modal compartilhado pelos 3 PDVs. Busca por cliente/descrição/ID; lista títulos abertos (pendente/parcial/atrasado/vencido); KPIs de saldo total; seletor global de forma de pagamento; por título: "Quitar total" e "Baixa parcial" com campo de valor. Pré-filtra pelo nome do cliente selecionado no PDV. Toasts de sucesso/erro. Tokens semânticos (4 temas). |
| `components/dashboard/vendas/pdv-classic.tsx` | Substitui o dialog antigo do shell ("Ir para Contas a Receber", só atalho de navegação) pelo `PdvRecebimentoModal` real, controlado pelo mesmo state `shellReceivablesOpen` que F9 já dispara. Shell omni-smart mantém callback compatível por enquanto. |
| `components/dashboard/vendas/pdv-supermercado.tsx` | Adiciona F9 ao guard de atalhos (state `recebimentoOpen`, bloqueio recíproco com outros modais) + renderiza `PdvRecebimentoModal`. Foco volta ao bipe ao fechar. |
| `components/dashboard/vendas/pdv-assistencia-enterprise.tsx` | Migração crítica: F9 era "limpar carrinho" (colisão pré-existente com o canônico). F9 agora abre Recebimento; **limpar carrinho migra para Ctrl+L** (handler precoce no onKeyDown, respeita `inInput`, mantém o `AlertDialog` de confirmação). `anyModalOpen` considera `recebimentoOpen` para evitar interceptações cruzadas. Pré-filtro usa `customerName` (state local). |
| `lib/pdv-keymap.ts` | F9 redefinido como "Recebimento de contas (liquidar / pagamento parcial)" + adicionado `Ctrl+L = Limpar carrinho (Assistência)`. Ajuda do Clássico (que lê do mapa) atualiza automática. |

**Convergência confirmada (3 PDVs operacionais):**

| Funcionalidade | Clássico | Supermercado | Assistência |
|---|---|---|---|
| F9 = Recebimento de Contas | ✅ | ✅ | ✅ (era limpar carrinho) |
| Modal `PdvRecebimentoModal` compartilhado | ✅ | ✅ | ✅ |
| Pré-filtro pelo cliente selecionado | ✅ | — (sem state de cliente) | ✅ |
| Ctrl+L = Limpar carrinho | — | — | ✅ (novo) |

**Auditoria:** já vem grátis do backend — toda liquidação/parcial gera `LogsAuditoria` (`liquidacao_conta_receber` / `pagamento_parcial_conta_receber`) e `MovimentacaoFinanceira` (entrada com `referenciaId = tituloId`, origem `receber`).

**Validação:** `npx tsc --noEmit` 0 erros nos arquivos da sessão · `npm run build` OK (todas as 80+ rotas geradas).

**Commits:** `c74305e` (modal compartilhado) · `9f01816` (Clássico + Supermercado) · `c900b5d` (Assistência + Ctrl+L).

**Não alterado:** schema Prisma, auth/proxy, serviços `liquidarContaReceber` / `registrarPagamentoParcial` / `cancelContaReceber` (reusados como estão), UI antiga de Contas a Receber em `/dashboard/financeiro/contas-a-receber` (continua intacta para fluxos administrativos avançados).

**Riscos restantes:**
- O `PdvRecebimentoModal` lista TODOS os títulos da loja e filtra client-side. Loja com >5k títulos pode ficar lenta — paginação server-side é follow-up.
- "Limpar carrinho" no Assistência via Ctrl+L exige adaptação de muscle memory de quem usava F9. Toast/tooltip não foi adicionado para não poluir.
- Pré-filtro do Clássico usa o `selectedCustomer.name` (busca por substring no campo `cliente` do título). Se o nome no PDV diferir do gravado no título (ex.: variação de espaço, MAIÚSCULAS), o operador precisa limpar o filtro e buscar manualmente.
- Forma de pagamento é metadado/auditoria (campo `formaPagamento` no log). A entrada financeira é sempre na carteira default do título (ou nenhuma carteira) — não distribui por método como o caixa do PDV faz. Para isso, próximo passo seria gerar `MovimentacaoFinanceira` separadas por forma.
- PDV Venda Completa Enterprise (4º PDV, fora dos 3 operacionais) não recebeu F9 nesta sessão.

---

### Lote 2 — Confiabilidade financeira (FK à prazo + dashboard sem canceladas) (concluído 26/05/2026)

**Contexto:** continuação da estabilização operacional. Dois gaps de confiabilidade financeira:
- (#5) Cancelar venda PDV à prazo **não estornava** o(s) título(s) em Contas a Receber (operador precisava cancelar manualmente).
- (#6) Painel inicial (dashboard elite) **inflava o faturamento** somando vendas canceladas.

| Arquivo | Mudança |
|---------|---------|
| `lib/ops-upsert-venda.ts` | Passo 6 (criação de `ContaReceberTitulo` para à prazo) agora captura o `id` do **primeiro** título criado (n=1) via `select: { id: true }` e grava em `Venda.contaReceberTituloId` via `tx.venda.update`. Antes, o campo ficava sempre `null` porque os títulos eram upsertados pelo `localKey` mas a FK nunca era populada na venda. Idempotente — re-sync da mesma venda re-aponta para o mesmo id. |
| `app/api/vendas/[id]/cancelar/route.ts` | Bloco "4. Estorno do título à prazo" substituído: deixa de depender só da FK singular e varre **TODOS** os títulos via `localKey: { startsWith: 'pdv-aprazo-${pedidoId}' }`. Para cada um, chama `estornarMovimentacaoPorReferencia` (origem `receber`) e `cancelContaReceber`. Cobre vendas de 1 parcela e até N parcelas (até 24) com o mesmo código. Resposta JSON ganha `titulosAprazoCancelados` para visibilidade. Idempotente (estorno por `referenciaId` + cancelContaReceber tem guard contra já-pago). |
| `app/api/dashboard/elite/route.ts` | 3 queries que somavam canceladas/devolvidas recebem `status: { notIn: ["cancelada", "devolvida"] }`: `faturamentoHojeAgg` (KPI "Faturamento de hoje"), `vendas7d` (gráfico de 7 dias), `lastVendas` (lista "Últimas movimentações"). Alinhado ao filtro que já existia em `vendaItens7d` (gráfico de categorias) e nas demais rotas do projeto (`historico`, `sessao-detalhe`, `clientes`, `cadastros`). |

**Efeito operacional:**
- Cancelar venda PDV à prazo agora estorna automaticamente o(s) título(s) e a(s) movimentação(ões) de Contas a Receber. Sem mais "venda cancelada mas título ativo".
- Painel inicial agora bate com o relatório de Histórico de Vendas (que já filtrava canceladas). Operador para de ver KPI inflado quando há cancelamentos do dia.

**Validação:** `npx tsc --noEmit` 0 erros nos arquivos da sessão · `npm run build` OK (todas as 80+ rotas geradas).

**Commits:** `b7a4872` (FK + cancelar varre parcelas) · `2bb4bfb` (dashboard exclui canceladas).

**Não alterado:** schema Prisma (FK `contaReceberTituloId` + índice já existiam — só não eram populados), auth/proxy, lógica de cancelamento de movimentações financeiras (`cancelContaReceber` / `estornarMovimentacaoPorReferencia` reusadas como estão), outras queries de venda (todas já filtravam `cancelada` corretamente).

**Riscos restantes:**
- O cancelamento varre `localKey LIKE 'pdv-aprazo-${pedidoId}%'`. Se um título à prazo for **renomeado** manualmente em Contas a Receber (alterando `localKey`), ele não será mais alcançado pelo cancelamento automático. UI atual não permite renomear, mas vale documentar.
- `Venda.contaReceberTituloId` aponta para a **primeira** parcela. Se o usuário esperar "ver todos os títulos a partir da venda", a UI precisa varrer por `localKey` (mesma técnica usada no cancelamento). Não há essa UI hoje — apenas a indicação singular.
- Vendas à prazo antigas (anteriores ao commit `b7a4872`) que não têm a FK populada **continuam recuperáveis** no cancelamento via varredura por `localKey`. Não precisa backfill.
- Painel `dashboard/elite` é o único corrigido. Outros painéis menos críticos (se houver no Hub Financeiro V2 mock) podem ter o mesmo padrão — não auditados nesta sessão.

---

### Convergência operacional PDV — INSERT + Pagamento Múltiplo nos 3 PDVs (concluído 26/05/2026)

**Contexto:** homologação do lote 1 revelou divergência operacional no core de entrada/pagamento entre os 3 PDVs:
- PDV Clássico: INSERT ✅ · Pagamento Múltiplo ❌
- PDV Rápido (Supermercado): INSERT ✅ · Pagamento Múltiplo ❌
- PDV Assistência: INSERT ❌ · Pagamento Múltiplo ✅ (modal próprio)

Objetivo: convergir comportamento operacional sem duplicar lógica nem mexer no layout visual de cada PDV.

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/payment-modal.tsx` | + prop opcional `multipayHint?: boolean`. Quando `true` ao abrir: ignora `instantPayIntent` (não auto-adiciona forma cheia), foca o campo "Valor a Adicionar" e exibe banner violeta explicando o fluxo de split ("informe o valor parcial → escolha a forma → repita até zerar"). Sem mudar `handleAddPayment` nem o array `payments[]` — só descobre a UX nativa que já existia. |
| `components/dashboard/vendas/pdv-classic.tsx` | + state `multipayMode`, função `openMultipayModal()`, F12 no `fnKeys` do shell omni-smart + `case "F12"` em `openShellShortcut`. Botão "Misto" renomeado para "Múltiplo" (cor violeta, tooltip explicando F12 e fluxo), chamando `openMultipayModal()`. PaymentModal recebe `multipayHint={multipayMode}` e reseta o flag no `onClose`. |
| `components/dashboard/vendas/pdv-supermercado.tsx` | + state `multipayMode`, callback `openMultipayModal()`, F12 no guard de `onKeyDown` (capture). Botão "Finalizar (outros)" renomeado para "Múltiplo [F12]" (violeta, ícone `Layers`), chamando `openMultipayModal()`. PaymentModal recebe `multipayHint`. Import `Layers` adicionado. |
| `components/dashboard/vendas/pdv-assistencia-enterprise.tsx` | **Bug do INSERT corrigido:** o tratamento de `Insert` ficou inalcançável porque o keydown fazia `if (!F_KEYS.includes(e.key)) return` antes de chegar no `switch` (Insert ∉ F_KEYS). Movido para antes do guard, respeitando `inInput` e `anyModalOpen`. Case "Insert" morto do switch removido. PaymentModal próprio (com "multiplo" via F12) **inalterado** — manteve o visual específico do Assistência. |
| `lib/pdv-keymap.ts` | + `{ key: "F12", desc: "Pagamento múltiplo (split em várias formas)" }`. Ajuda de atalhos do Clássico (que lê do mapa) atualiza automaticamente. |

**Convergência confirmada (3 PDVs operacionais):**

| Funcionalidade | Clássico | Rápido/Supermercado | Assistência |
|---|---|---|---|
| INSERT (Item Avulso) | ✅ | ✅ | ✅ (corrigido) |
| Pagamento Múltiplo (F12) | ✅ (modal compartilhado) | ✅ (modal compartilhado) | ✅ (modal próprio, mantido) |
| F7 Venda em espera | ✅ | ✅ | ✅ |
| Atalhos canônicos `PDV_KEYMAP` | ✅ | ✅ (parcial — F2/F3/F4/F7/F12/Insert) | ✅ (parcial — F1-F12/Insert) |

**Modal de pagamento compartilhado:** Clássico + Supermercado usam o mesmo `payment-modal.tsx` (com `multipayHint`). Assistência mantém modal próprio (`PaymentModal` interno) por decisão explícita: "manter layout visual específico de cada PDV" (regra do usuário). Convergência é **comportamental**, não código.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (todas as rotas geradas).

**Riscos restantes / fora de escopo:**
- O PDV Assistência continua com PaymentModal próprio (split visual de 2 campos lado a lado, próprio da loja de assistência técnica). Unificar a UX visual exigiria refator maior — fora do escopo "convergência operacional".
- Dashboard analytics ainda soma canceladas (pendência reportada no contexto da sessão — não tocado aqui).
- `Venda.contaReceberTituloId` ainda não vinculado no fluxo PDV à prazo (cancelamento não estorna o título automaticamente — paridade mantida).
- Recebimento de contas no PDV (F5 dedicado) ainda não implementado.
- Limpeza do keymap legado `default` (handler morto em `pdv-classic.tsx` linhas 1076-1199) segue pendente — marcado como legado por comentário; não removido para evitar reescrita.
- PDV Venda Completa Enterprise (4º PDV, fora dos 3 operacionais) não recebeu F12; ele já usa o `payment-modal.tsx` compartilhado mas continua sem botão Múltiplo dedicado — pode ser adicionado em sessão futura com a mesma técnica.

---

### Configurações V3 — settings conectadas ao runtime (concluído 26/05/2026)

| Setting | Persistência | Consumer runtime |
|---------|--------------|------------------|
| `incluirImpostoEstimadoNoPdv` / `aliquotaImpostoEstimadoPdv` | `printerConfig.pdvParams` (API `/api/stores/[id]/settings`) | PDV Classic, Supermercado, Assistência Enterprise, Venda Completa via `lib/pdv-cart-totals.ts` + `PaymentModal` |
| `moduloControleConsumo` | idem | `/dashboard/vendas/mesas` + botão **Mesas** no PDV quando ativo |
| `formasPagamento[]` | idem | Config V3 → Vendas → Formas de pagamento; runtime: `lib/pdv-formas-pagamento.ts` → PDV Classic, Supermercado (`payment-modal`), Assistência (botões + modal interno). Ativar/desativar, ordem, ícone/cor, exigir cliente/CPF/autorização, troco, múltiplo |
| `garantiaPadraoDias` / `validadeOrcamentoDias` | idem | Orçamentos + PDV (já existia) |
| Centro financeiro V3 (`cardFees`) | API + `localStorage` espelho | PDV maquininhas + Config Financeiro (já existia) |

**Correções:** `StoreSettingsProvider` não usa mais fallback silencioso `loja-1` sem unidade ativa; `save()` falha explícito sem `storeId`; settings zerados ao trocar unidade (sem flash da loja anterior). KPIs Financeiro na Config V3 rotulados como cache local.

**Isolamento multi-loja Config V3 (26/05/2026):** providers duplicados removidos das seções (usa `AppOpsProviders` do dashboard); remount da seção ativa ao trocar unidade (`key={sec}-{storeId}`). Preferências de navegador scoped por unidade: `lib/store-scoped-storage.ts` (PDV layout/modo, importação modo, classic layout). Tema por unidade em `printerConfig.appearance.studioTheme` + `StoreAppearanceSync` no dashboard. Centro financeiro sem fallback `loja-1`. Banner `UnidadeAtivaRequiredBanner` nas seções que exigem loja. Importação: modo `@omnigestao:importacao-modo::{storeId}`.

**Em breve (UI honesta):** moeda/fuso (GeralSection), relatório mensal por e-mail (FinanceiroSection).

**UX Config V3 — auditoria honesta (26/05/2026):** toggles/forms só gravam via API real (`/api/stores`, `/api/admin/users`, `printerConfig`). Futuro explícito: moeda/fuso (Geral), relatório e-mail (Financeiro), prévia global (Aparência), 2FA/sessões (Segurança), Marketing IA hub (Integrações). KPIs Financeiro = cache localStorage. Importação: modo só no navegador. Detalhe: `docs/audits/AUDITORIA_CONFIG_V3_UX.md`.

**Master Console V1 (26/05/2026):** equipa via `GET /api/admin/users`; reset de senha real (`PATCH /api/admin/users/[id]` + senha temporária gerada no cliente); KPI faturamento `—` + badge Sem dados; colaboradores com loading/`…`; delete só após `ok: true`; `EmployeeAccessSheet` read-only (matriz módulos Em breve); Financeiro V3 links → `/dashboard/financeiro-v2` + contas a pagar/receber; Gestão Unidades sem fallback silencioso `loja-1`.

**Impressão PDV (26/05/2026):** `printerConfig.impressao` por unidade (host/porta TCP, bobina 58/80mm, gaveta, auto-print, comprovante simplificado/completo, logo HTML, rodapé, vias, flags OS/crediário). UI em Config V3 → PDV → Impressão operacional. Runtime: `lib/pdv-print-runtime.ts` + `useStoreSettings().impressaoConfig` no PDV Classic, PaymentModal, OS térmica e recibos de crediário.

**Central de Auditoria (26/05/2026):** aba `?sec=auditoria` — histórico read-only de alterações críticas. Persistência em `LogsAuditoria` (`source=configuracoes-v3`, `action=config:{area}`) com metadata JSON (usuário, loja, seção, campo, antes/depois, IP/UA quando via servidor). Gravação automática em `PUT /api/stores/[id]/settings`, `PUT /api/stores/[id]`, `POST/PATCH /api/admin/users`. API: `GET/POST /api/config-audit` (acesso `admin.configuracoes`).

---

### Importador de Produtos em lotes — XLS legado / planilhas grandes (concluído 25/05/2026)

**Contexto:** loja Rafa Brinquedos tem ~4.870 produtos num `.xls` antigo (BIFF) com banner antes do cabeçalho.
O Importador Avançado existente (`/api/import/advanced`) processa tudo num único request síncrono e o detector
de cabeçalho do SheetJS pega a primeira linha — ele se confundia com o banner do relatório e marcava o
domínio como "produtos" sem mapear nome/sku/preço. Precisávamos de fluxo dedicado com preview honesto e
lotes manuais sem quebrar o importador atual.

**Estratégia:** caminho paralelo dedicado a Produtos, sem tocar em `parser.ts`/`persistidor.ts` do
importador avançado. Estoque de produto pré-existente **continua intocado** (regra global, ver
memória `project_import_nao_sobrescreve_estoque`).

| Arquivo | Mudança |
|---------|---------|
| `lib/importador-produtos/types.ts` (NOVO) | Tipos `ProdutoNormalizado`, `DeteccaoCabecalho`, `PreviewProdutosResult`, `LoteRequest`, `LoteResult`, `ModoConflito`. |
| `lib/importador-produtos/normalizar.ts` (NOVO) | Dicionário de aliases por campo canônico (sku/barcode/nome/custo/preco/estoque/categoria), `parseNumeroBr` (R$ 1.234,56), `pareceBanner` (descarta linhas de título/relatório), `pontuarLinhaComoCabecalho`. |
| `lib/importador-produtos/parser.ts` (NOVO) | Lê buffer xls/xlsx/csv via SheetJS `header:1` (AOA), detecta cabeçalho nas primeiras 20 linhas (score por aliases), normaliza linhas, valida — devolve `{validos, invalidos, cabecalho}`. Suporta CSV/TSV com BOM, separador `;`/`,`/`	`, aspas. `fatiarEmLotes` para chunks. |
| `lib/importador-produtos/dedupe.ts` (NOVO) | Conta duplicados internos (sku/barcode/nome) e possíveis duplicados no banco via `findMany(in:[...])` em lotes de 500 — sem N+1. |
| `lib/importador-produtos/persist.ts` (NOVO) | `persistirLoteProdutos(storeId, itens, modoConflito)` — upsert por linha. Dedup forte (sku original + normalizado + `gc-` legado + barcode + EAN como barcode). Modo `atualizar` mantém estoque; modo `pular` não toca. Erro por linha não aborta o lote. |
| `app/api/import/produtos/preview/route.ts` (NOVO) | `POST` (multipart, 1 arquivo, max 50MB). Auth NextAuth + legacy. `maxDuration: 120s`. Retorna `{cabecalho, totalLinhasLidas, validos, invalidos, duplicadosInternos, possiveisDuplicadosBanco, amostra[20], linhasInvalidas[50], lotes[][], tamanhoLote, totalLotes}`. |
| `app/api/import/produtos/lote/route.ts` (NOVO) | `POST` (JSON). Recebe `{batchId, loteIndex, totalLotes, modoConflito, itens[≤1000]}`. Persiste via `persistirLoteProdutos` + grava `LogsAuditoria` action `import.produtos.lote(.erro)` por lote (best-effort, sem schema novo). |
| `components/dashboard/configuracoes/importador-produtos/{ImportadorProdutos,UploadProdutos,PreviewProdutos,LotesProdutos,LogProdutos}.tsx` + `hooks/use-importador-produtos.ts` (NOVOS) | UI Lovable-friendly: upload 1 arquivo → preview (cards de números + cabeçalho mapeado + 20 linhas normalizadas + linhas inválidas) → seletor de conflito (Atualizar/Pular) → progresso real lote a lote → log final detalhado com erros/pulados. Tokens semânticos (4 temas). |
| `components/cadastros/lovable/components/cadastros/ImportacaoHub.tsx` | + subtab `"Produtos (lotes)"` (ícone `Package`) entre Planilhas e XML, renderizando `<ImportadorProdutos />` dentro do `AppOpsProviders`. Sidebar explica quando usar este fluxo e o que nunca é alterado. Importador Avançado existente **intacto**. |

**Comportamento:**
- Aceita `.xls` (BIFF antigo), `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv` — sem dep extra (SheetJS já estava em v0.18.5).
- Cabeçalho é detectado mesmo quando há linhas-banner ("Relatório de produtos", "Loja: …", "Data: …") antes.
- Lotes de **500** itens fixos. 4.870 itens → ~10 lotes. Cada lote = 1 POST manual.
- Conflito SKU/barcode: `Atualizar existente` (default — atualiza nome/preço/custo/categoria, **mantém estoque**) ou `Pular existente` (não toca em produtos já cadastrados).
- Multi-loja: `storeIdFromAssistecRequestForWrite(req)` em ambas as rotas. Sem header `x-assistec-loja-id` = 400.
- Idempotência: re-rodar o mesmo lote bate no mesmo SKU → "atualizado" ou "pulado", nunca duplica.
- Linha ruim não derruba o lote — erro fica em `LoteResult.itens[].acao = "erro"` com detalhe.
- `LogsAuditoria` registra cada lote: batchId, storeId, arquivo, loteIndex/totalLotes, totais, falhas (até 100).

**Como testar:**
1. Selecionar a unidade da loja em teste (header automático via `useLojaAtiva`).
2. Cadastros → Importação → aba **"Produtos (lotes)"**.
3. Arrastar `Relatorio de produtos cadastrados.xls`.
4. Clicar **"Pré-visualizar"** — esperar ~5-15s. Conferir nos cards: `Linhas lidas ≈ 4.870`, `Válidos > 0`, `Lotes ≈ 10`. Conferir o mapa do cabeçalho (cada coluna deve mostrar `→ Nome`/`→ SKU`/etc.).
5. (Opcional) Trocar o modo de conflito para "Pular existente" antes do primeiro lote.
6. Clicar **"Importar próximo lote (1/10)"** — esperar 30-60s, conferir totais acumulados.
7. Repetir até o último lote. Tela final mostra criados/atualizados/pulados/erros e detalhamento.
8. Conferir em **Cadastros → Auditoria** ou no painel de logs: aparece 1 entrada por lote (`import.produtos.lote`).

**Validação:** `npx tsc --noEmit` **0 erros** · `npm run build` **OK** (rotas `/api/import/produtos/preview` e `/api/import/produtos/lote` registradas — 1ª tentativa teve OOM transitório de worker do Next, recompilou e finalizou na 2ª como em outras sessões).

**Não alterado (intacto):** `prisma/schema.prisma`, auth/proxy, `app/api/import/advanced/route.ts`, `lib/importador-avancado/*`, qualquer fluxo de PDV/Caixa/Financeiro/OS. Regra "import não sobrescreve estoque" preservada — produto existente nunca tem `stock` atualizado.

**Pendências/limites conhecidos:**
- Parsing acontece toda vez no servidor (cliente não cacheia o resultado entre reloads do navegador). Refresh durante a importação descarta o preview — não há retomar de lote por enquanto.
- Sem detector de moeda/locale por coluna: assume PT-BR (`1.234,56`) e cai para US se só houver `.`. Já cobre 99% das planilhas reais.
- `categoria` é gravada também em `Produto.brand` (mesmo comportamento do importador avançado, para legado).
- Não há upload múltiplo nesta aba — pensado para 1 arquivo grande por vez. Múltiplos arquivos seguem na aba "Planilhas" original.
- Estimativa de duração: ~30-60s/lote (Supabase pooler). Para o caso `Relatorio de produtos cadastrados.xls` (4.870 itens), espera-se ~5-10 minutos no total se o operador encadear os lotes.

### Sprint À Prazo Enterprise — Parcelamento no PDV (concluído 25/05/2026)

**Contexto:** fluxo de venda à prazo era simplista demais — sem entrada, sem parcelas, sem vencimento configurável. Saldo à prazo entrava erroneamente no caixa físico.

| Arquivo | Mudança |
|---------|---------|
| `lib/operations-sale-types.ts` | Novo tipo `APrazoConfig { parcelas, primeiroVencimento, intervalDias }`. Adicionado em `SaleRecord`. |
| `lib/operations-store.tsx` | Novo campo `vendasAPrazo` no `DailyLedger`. `totalEntradas` do caixa agora **exclui** `pb.aPrazo` (receita futura, não caixa físico). `vendasCarne` separado de `vendasAPrazo`. `finalizeSaleTransaction` aceita `aPrazoConfig?`. |
| `lib/ops-upsert-venda.ts` | `aPrazoConfig?` em `SalePayload`. Step 6 cria **um `ContaReceberTitulo` por parcela** com `localKey pdv-aprazo-{pedidoId}-{n}` (idempotente). |
| `components/dashboard/vendas/payment-modal.tsx` | Botão "À prazo" abre bloco de config (como carnê): entrada opcional + forma da entrada + parcelas 1-24 + primeiro vencimento + resumo das parcelas + badges Entrada/Financiado. `PaymentMethod` ganha `aPrazoConfig?`. |
| `lib/pdv-append-conta-receber.ts` | Cria N entradas no localStorage (uma por parcela). |
| `lib/whatsapp-daily-server.ts` | `vendasAPrazo: 0` nos objetos `DailyLedger` literais. |
| PDVs: `pdv-classic`, `pdv-supermercado`, `pdv-venda-completa-enterprise`, `PdvBlackEdition` | Extraem `aPrazoConfig` do array `payments` e passam para `finalizeSaleTransaction`. |

**Casos cobertos:** à prazo puro, dinheiro+prazo, pix+prazo, crédito+prazo, qualquer entrada+saldo a prazo.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos/pendências:** `venda-completa-enterprise.tsx` (formulário próprio, não usa PaymentModal) continua com à prazo simples (1 parcela/30 dias) — requer refatoração maior para adotar o bloco de config; à-prazo no PDV Assistência (modal próprio) fora do escopo; relatório de fechamento caixa não exibe `vendasAPrazo` ainda (campo disponível, display é follow-up).

### Convergência PDV — P1: keymap-base + sangria única + Black na barra (concluído 24/05/2026)

**Contexto:** continuação da Sprint de Convergência (`docs/ai/PDV_CONVERGENCIA_AUDIT.md`),
incremental e seguro, sem reescrever PDVs, sem schema/auth/proxy, Black mantido gated.

| # | Arquivo | Mudança |
|---|---|---|
| P1.1 keymap-base | `lib/pdv-keymap.ts` (NOVO) + `pdv-classic.tsx` | `PDV_KEYMAP` = fonte única dos atalhos canônicos (referência omni-smart). Ajuda do Clássico (End/F1) passa a renderizar a partir dele (corrige inclusive a inconsistência antiga "F1=ajuda" → F1=pagar). Demais PDVs adotam o mapa incrementalmente (dispatch não reescrito). |
| P1.2 sangria única | `pdv-classic.tsx` | Removidos os itens **Sangria** e **Reforço (Suprimento)** do menu engrenagem (redundantes). Sangria/suprimento agora **só** na barra compartilhada (`CaixaStatusBar`, sempre visível no topo do Clássico). `openOperation` removido; diálogo `operationType` legado permanece inerte (estado ainda referenciado por guards de teclado). |
| P1.3 Black na barra | `components/pdv-next/PdvBlackEdition.tsx` | Black renderiza `<CaixaStatusBar variant="pdv" />` → ganha sangria/suprimento + pill de terminal + KPIs + fechamento ERP do core. **Continua gated.** Shell preto mantém seus controles (de-dup visual é follow-up). |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos/pendências restantes (P2+):** keymap **dispatch** ainda não unificado (3 keydowns
divergentes — só os dados/ajuda convergiram); diálogo de sangria legado inerte no Clássico
(referenciado por guards — limpar exige mexer nos guards); Black com 2 superfícies de caixa
(barra + shell) — unificar visual depois; consolidar Venda Completa (2 arquivos); à-prazo
uniforme; aposentar keymap `default`; caixa localStorage por terminal (Fase 5).

### Convergência PDV — P0: Black Edition no core (gated) (concluído 24/05/2026)

**Contexto:** auditoria de convergência (`docs/ai/PDV_CONVERGENCIA_AUDIT.md`) apontou que o
**PDV Next/Black era o único fora do núcleo** — `handlePaymentConfirm` só limpava a UI (ghost-sale,
sem Venda/estoque/financeiro). Os outros 4 PDVs já usam `finalizeSaleTransaction` + `CaixaStatusBar`.

**Correção (mantendo GATED — `NEXT_PUBLIC_OG_EXPERIMENTAL` OFF em produção):**

| Arquivo | Mudança |
|---|---|
| `components/pdv-next/PdvBlackShell.tsx` | `PdvBlackCartRow` ganha `inventoryId?` (id real do produto p/ persistir). |
| `components/pdv-next/PdvBlackEdition.tsx` | `handlePaymentConfirm(payments)` agora **persiste via `finalizeSaleTransaction`** (Venda+estoque+financeiro, idempotente, syncPending, à-prazo na tx) em vez de só resetar a UI. Filtra linhas resolvíveis no inventory real; reduz `payments`→`paymentBreakdown`; guarda `clienteId` selecionado; bloqueia se caixa fechado; toast de sucesso/falha. `addProduct` grava `inventoryId`. |

**Efeito:** o Black deixa de ser ghost-sale **arquiteturalmente** — quando (e se) for liberado,
já está no mesmo motor dos demais. **Continua hidden/gated** (não liberado em produção). Caixa do
Black já usava os modais reais de abertura/fechamento (compartilhados).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (2ª tentativa — 1ª teve OOM transitório de worker, não-código).

**Pendente da Sprint de Convergência (P1+):** keymap-base compartilhado; remover sangria redundante
do Clássico; consolidar Venda Completa (2 arquivos); à-prazo uniforme; aposentar keymap `default`;
caixa localStorage por terminal (Fase 5). Black ainda não usa `CaixaStatusBar` (sem sangria no Black) —
próximo passo do alinhamento.

### Sangria/Suprimento acessível em todos os PDVs (concluído 24/05/2026)

**Contexto:** homologação multi-terminal revelou que **sangria/suprimento só existia no
PDV Clássico** (menu engrenagem). No PDV Rápido/Supermercado, Assistência e Venda Completa
**não havia fluxo de sangria/suprimento** — gap operacional (não era regressão; nunca existiu lá).

**Auditoria:**
- `pdv-classic.tsx` → tem (menu engrenagem + diálogo + handler com retry/idempotência da Sprint 1.2). ✅
- `pdv-supermercado.tsx` / `pdv-assistencia-enterprise.tsx` / `pdv-venda-completa-enterprise.tsx` → **não tinham**. ❌
- Todos renderizam o **`CaixaStatusBar`** compartilhado (que só tinha Abrir/Fechar).

**Correção cirúrgica (sem tocar no Clássico que já funciona):**

| Arquivo | Mudança |
|---|---|
| `lib/pdv-caixa-operacao.ts` (NOVO) | Helper `registrarOperacaoCaixaServer` — retry exponencial + idempotência por `localId` (mesmo contrato/endpoint da Sprint 1.2). |
| `components/dashboard/caixa/caixa-status-bar.tsx` | Botões **Sangria** e **Suprimento** + diálogo (valor/motivo) quando o caixa está aberto. Reflete na barra na hora (`adicionarSaida/Entrada`), persiste via helper, alerta se sem sessão (não silencia). Auditoria via `appendAuditLog`. |

**Efeito:** sangria/suprimento agora acessível em **todos os PDVs** (a barra é compartilhada).
O Clássico mantém também o menu engrenagem (entrada redundante, inofensiva). Backend financeiro,
estoque, schema, auth/proxy, temas e o retry do Clássico **inalterados**.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

### Multi-Terminais Fase 3 — Relatórios por terminal (concluído 24/05/2026)

**Contexto:** organizar relatórios/histórico/fechamento por PDV1/PDV2/PDV3 + consolidado geral.
Detalhes em [`docs/ai/PDV_MULTI_TERMINAIS_FASE3_RELATORIOS_REPORT.md`](./PDV_MULTI_TERMINAIS_FASE3_RELATORIOS_REPORT.md).

**Descoberta:** a maior parte já estava implementada/commitada (de sessão anterior): filtro por
terminal + badge + detalhe no **Histórico de Vendas** (`vendas-arquivo-geral.tsx`) e no **Histórico
de Caixa** (`caixa-historico-client.tsx`); rotas `vendas/historico`, `caixa/sessoes` e
`caixa/sessao-detalhe` já aceitam `terminalId` (`id`/`"sem"`/todos) e retornam terminal + KPIs.

**Lacuna fechada nesta sessão:**

| Arquivo | Mudança |
|---|---|
| `components/dashboard/caixa/fechamento-caixa-modal.tsx` | Terminal agora aparece no **fechamento**: cabeçalho ("Terminal: …"), **comprovante** (copiar/imprimir) e `payload.resumoFechamento` (`terminalId`/`terminalLabel`). Usa `useTerminalAtivo`; "Sem terminal" para sessões legadas. Lógica de fechamento inalterada (por `sessaoId`, totais server-side). |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Não incluído:** consolidado gerencial dedicado (`/api/ops/caixa/consolidado` + card PDV1×PDV2×PDV3) —
hoje o consolidado é o filtro "Todos os terminais". Vendas antigas sem `terminalId` = "Sem terminal".

**Fora de escopo / pendente:** `components/vendas-hub/lovable/features/vendas/VendasHub.tsx` tem
mudança não relacionada (botão Voltar TanStack→Next) **não commitada** — para revisão do usuário.
Homologação runtime da Sprint 1.2 segue pendente.

### Sprint 1.2 — Estabilização final de Caixa/PDV (concluído 24/05/2026)

**Contexto:** 5 itens cirúrgicos recomendados na auditoria (`docs/ai/AUDITORIA_2026-05-24.md`),
fechando os riscos P0/P1 restantes de caixa. Sem schema/auth/proxy; sem refator.

| # | Arquivo | Mudança |
|---|---|---|
| 1 Desconto | `components/dashboard/vendas/pdv-classic.tsx` | Tecla **F10 = Desconto** no keymap vivo (omni-smart) → abre pagamento com campos de desconto (convenção do PDV Assistência). Linha na ajuda de atalhos. |
| 2 Retry sangria/supr. | `components/dashboard/vendas/pdv-classic.tsx` + `app/api/ops/caixa/operacao/route.ts` | **Retry exponencial** (4 tentativas, 400/800/1600ms) no cliente, com **idempotência por `localId`** no servidor (gravado no `payload` JSONB — sem schema). Retry de 5xx/rede; para em 4xx. Sem duplicar sangria. |
| 3 Título à prazo | `lib/ops-upsert-venda.ts` + `lib/pdv-append-conta-receber.ts` | `ContaReceberTitulo` à prazo agora criado **dentro da transação de venda** (passo 6), `localKey` `pdv-aprazo-{pedidoId}` (idempotente, sem dup). Removido o POST fire-and-forget do cliente (mantido só o cache localStorage). Persistência passa a herdar o retry `syncPending` do `venda-persist`. |
| 4 Guard abrir caixa | `app/api/ops/caixa/abrir/route.ts` + `components/dashboard/caixa/abertura-caixa-modal.tsx` | Se já há `SessaoCaixa` ABERTA (loja + terminal), o `abrir` **retorna a existente** (`alreadyOpen:true`) em vez de criar duplicada. Modal adota saldo/sessão do servidor + toast informativo. |
| 5 Código morto | `components/dashboard/estoque/servicos.tsx` | **Removido** (`Servicos()` sem nenhum import — confirmado; só docs/strings de categoria referenciavam). |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` **OK** (prisma generate + next build completos, 95/95 páginas).

**Não alterado:** schema Prisma, auth/proxy, PDV Assistência/Supermercado, Marketplace/Omni Agent/Marketing IA/WhatsApp, `local-key.ts`, adapter `os-faturamento`.

**Riscos restantes (Sprint 2+):** desconto continua sendo aplicado no modal de pagamento (F10 abre lá — não há tela de desconto isolada); `Venda.contaReceberTituloId` não é vinculado no fluxo PDV à prazo (cancelamento não estorna o título à prazo automaticamente — paridade mantida); guard de abrir reconcilia saldo no modal mas `totalEntradas/totalSaidas` da barra seguem runtime local; OS legado vs v2, auth staff legado e `pdv-github-original/` seguem para Sprints 2–4.

### Sprint 1.1 — Estabilização do PDV Clássico (concluído 24/05/2026)

**Contexto:** homologação operacional revelou bugs no **PDV Clássico** (shell omni-smart)
que a auditoria estrutural não pegou. Correções cirúrgicas, sem tocar Assistência/Supermercado.

**Mapa de renderização confirmado:** Clássico → `pdv-classic` (shell `pdv-omni-classic-shell`,
`uiShell="omni-smart"`); Assistência → `pdv-assistencia-enterprise` (early-return em pdv-classic);
Supermercado → `pdv-supermercado`. O `uiShell="default"` é **legado/sem uso** (VendasPDV usa sempre omni-smart).

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/pdv-classic.tsx` | (1) **INSERT/Item Avulso corrigido:** a tecla estava só no handler `default` (desativado no omni-smart) → "feature fantasma". Adicionado `Insert` ao keymap vivo do shell (`down`) → abre o modal. (2) **Busca de cliente ao digitar:** o campo inline "Cliente" só guardava texto; agora alimenta a busca live (`customerSearch`/`useClienteSearch`) e abre o picker. (3) **Loja segura:** passa `storeId` (loja ativa) ao shell. (4) **Keymap consolidado:** comentário marcando o handler `default` como legado + linha `Insert` na ajuda de atalhos. |
| `components/dashboard/vendas/pdv-omni-classic-shell.tsx` | Cabeçalho do estabelecimento agora **sempre visível** (era `hidden md:flex` → invisível em telas menores) + **badge com o `storeId`** ao lado do nome, para o operador confirmar a unidade antes de vender. |

**storeId/loja ativa — diagnóstico:** o nome exibido e o storeId de gravação vêm da **mesma fonte**
(`useLojaAtiva`/`opsStorageKey`); não há `loja-1` hardcoded no caminho de escrita. Se o PDV mostra
loja-1, a venda vai para loja-1 — por isso o badge sempre visível é a salvaguarda. (Causa provável do
sintoma original: loja de teste criada via script **após** o app carregar a lista → exigia reload do switcher.)

**Validação:** `npx tsc --noEmit` 0 erros · `npx next build --webpack` OK (árvore de rotas completa).
⚠️ `npm run build` falha localmente por **lock do `prisma generate`** (DLL do Prisma travada pelo
`npm run dev` em execução) — não é erro de código; o build do Next compila normalmente.

**Não alterado (intacto):** PDV Assistência e Supermercado (INSERT/atalhos já funcionam neles);
auth/proxy; schema; servidor segue como fonte da verdade.

**Riscos restantes → Sprint 1.2:** desconto sem tecla dedicada no Clássico (só menu CTRL/avançado);
handler `default` legado permanece (marcado, não removido, para evitar refator grande); propagação
cross-tab da troca de loja não implementada (reload resolve).

### Sprint 1 — PDV + Caixa confiável (concluído 24/05/2026)

**Contexto:** deixar o fluxo de caixa seguro para uso diário — servidor como fonte
da verdade; localStorage como cache que **não** pode causar venda perdida, caixa
falso aberto ou totais divergentes. Mudanças cirúrgicas, sem refatorar.

| Arquivo | Mudança |
|---|---|
| `app/dashboard/clientes/ClientesPageClient.tsx` | Link "Iniciar Venda (PDV)" `/dashboard/pdv?clienteId=` (redirect que **descartava a query**) → `/dashboard/vendas?clienteId=` (rota canônica, param preservado). |
| `components/dashboard/vendas/pdv-classic.tsx` | (1) "Ver contas a receber" `/?page=contas-receber` (legado SPA) → `/dashboard/financeiro/contas-a-receber`. (2) "Nova O.S." `/?page=os` → `/dashboard/operacoes-v2` (rota oficial). (3) **Sangria/suprimento sem sessão deixou de ser silencioso:** quando o caixa está aberto mas sem `sessaoId` confirmado no servidor, agora alerta (antes incrementava o total local e mostrava "registrado com sucesso" sem persistir). |
| `lib/operations-store.tsx` | **Caixa falso aberto corrigido:** o bootstrap só restaurava sessão (server aberto + local fechado). Agora trata o inverso — server **sem** sessão aberta + local aberto → fecha localmente (fonte de verdade = servidor). Roda só com servidor respondendo (`rCaixa.ok` + inventory/ordens carregados); offline não dispara; vendas `syncPending` preservadas. Cura o "caixa fantasma" após refresh/reload. |

**Fluxo validado (código):** abrir caixa (POST `/api/ops/caixa/abrir` → `sessaoId`) ·
venda (`venda-persist` idempotente, `syncPending` reenvia em online/foco/30s) ·
sangria/suprimento (`/api/ops/caixa/operacao` + alerta se sem sessão) · fechar
(`/api/ops/caixa/fechar` calcula `totalVendasServer` do ledger) · histórico ·
**refresh/reload** (reconciliação bidirecional com o servidor).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (95/95 páginas).

**Riscos restantes → Sprint 1.2:** (a) `abrir` sempre cria nova `SessaoCaixa` (sem
guard de duplicada — corrigir exige ajuste no modal de abertura); (b) caixa em
**dois** locais de localStorage (blob ops + snapshot `omnigestao:caixa:` — redundante,
mas consistente); (c) `totalEntradas/totalSaidas` da barra são runtime local (podem
divergir do servidor durante o turno — fechamento usa o canônico do servidor); (d) PDV
não pré-seleciona cliente via `?clienteId=` (param já preservado para uso futuro); (e)
link "Nova OS" do CRM ainda aponta para `/dashboard/os` (legado).

### Sprint 0 — Blindagem de navegação operacional (concluído 24/05/2026)

**Contexto:** primeira sprint da estabilização operacional — impedir uso operacional
incorreto antes da operação real, **sem remover código** e preservando rotas para dev.

| Arquivo | Mudança |
|---|---|
| `lib/feature-flags.ts` | + `experimentalPdvEnabled` e `roadmapHubsEnabled`, ambos via env `NEXT_PUBLIC_OG_EXPERIMENTAL=1` (default OFF em produção). |
| `app/dashboard/vendas/vendas-page-client.tsx` | **Armadilha crítica corrigida:** o PDV oficial auto-redirecionava para `/dashboard/pdv-next` (que **não persiste vendas**) quando `localStorage["@omnigestao:pdv-layout"]==="next"`. Agora só redireciona com `experimentalPdvEnabled`; em operação faz **auto-heal** da preferência presa (volta para `classic`). |
| `app/dashboard/pdv-next/page.tsx` · `app/dashboard/pdv-github-original/page.tsx` | Gate operacional: renderizam `ModuleEmDesenvolvimento` (com link para o PDV oficial) quando `!experimentalPdvEnabled`. Componentes reais preservados (acesso via env em dev). |
| `components/configuracoes-v3/.../PdvSection.tsx` | Card "PDV Next" oculto da galeria em operação (`visibleFlows`); liberado em dev via env. |
| `components/painel-inicial/Sidebar.tsx` | Hubs de roadmap (Marketing IA, Marketplace) ocultos do menu via `experimental`/`roadmapHubsEnabled` (mock/não operacional). |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (todas as rotas compilam; experimentais seguem registradas, apenas gated).

**Links quebrados identificados (para Sprint 1, não corrigidos aqui):**
`ClientesPageClient.tsx` usa `/dashboard/pdv?clienteId=` → o redirect de `/dashboard/pdv` **descarta a query** (perde `clienteId`); `pdv-classic.tsx` navega via legado `/?page=os` e `/?page=contas-receber` (quebra potencial dependente da home SPA).

**Pendências (fora do escopo Sprint 0):** páginas Marketplace/Marketing IA seguem
acessíveis por URL direta (só ocultas do menu); IA Mestre / Omni Agent / Financeiro V2
**não** foram alterados (decisão do usuário pendente).

### PDV Multi-Terminais — Fase 2 (lock + heartbeat) (concluído 23/05/2026)

**Contexto:** impedir dois computadores no mesmo terminal ao mesmo tempo, via lock
server-side por terminal + heartbeat, com liberação automática por expiração e
Assumir/Liberar para admin/gerente. Detalhes em
[`docs/ai/PDV_MULTI_TERMINAIS_FASE2_LOCK_REPORT.md`](./PDV_MULTI_TERMINAIS_FASE2_LOCK_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | `PdvTerminal` + `lockedByDeviceId`/`lockedByOperador`/`lockedAt`/`heartbeatAt` (nullable) + `@@index([storeId, heartbeatAt])`. Aditivo (`db push` aplicado). |
| `lib/pdv-terminal-lock.ts` | **NOVO** — lógica pura (TTL 120s, heartbeat 30s, `computeLockStatus`) reusada por server e client. |
| `app/api/ops/terminal/{lock,heartbeat,unlock}/route.ts` | **NOVO** — lock atômico (`updateMany` condicional), heartbeat, unlock próprio/forçado. `force` exige `p.pdv.cancelarVenda` (admin/gerente). Degrada (200) em falha de infra. |
| `app/actions/terminais.ts` | `listTerminais(storeId, deviceId?)` retorna estado de lock (status/operador/heartbeat/isMine); desativar limpa o lock. |
| `lib/pdv-terminal.ts` | + `lockTerminal`/`heartbeatTerminal`/`unlockTerminal` + hook `useTerminalHeartbeat` (adquire, bate 30s, detecta perda, libera no unmount/beforeunload). |
| `components/dashboard/vendas/terminal-selector.tsx` | Lock-aware: Livre/Em uso/Offline/Ocupado/Inativo, bloqueia ocupado, Assumir/Liberar (admin) com confirmação. |
| `app/dashboard/vendas/vendas-page-client.tsx` | Keeper de heartbeat; bloqueia PDV se perder o lock (painel reassumir/reselecionar); banner de degradação. |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK (rotas registradas) · `npx prisma db push` em sync.

**Pendências (relatório):** venda não revalida lock no servidor por transação; 2 abas no mesmo
device = mesmo deviceId (sem BroadcastChannel); `localStorage` do caixa ainda por loja;
relatórios por terminal e `pdv-next` fora do escopo.

### PDV Multi-Terminais — Fase 1 (cadastro + seleção) (concluído 23/05/2026)

**Contexto:** base profissional de múltiplos terminais por loja (PDV1, PDV2, PDV3…),
estilo supermercado, para que dois computadores não abram o mesmo caixa por engano.
Detalhes em [`docs/ai/PDV_MULTI_TERMINAIS_FASE1_REPORT.md`](./PDV_MULTI_TERMINAIS_FASE1_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | **NOVO** model `PdvTerminal` (`code` PDV1…, `name`, `status` ACTIVE/INACTIVE, `@@unique([storeId, code])`); + colunas nullable `SessaoCaixa.terminalId` e `Venda.terminalId` + índices. 100% aditivo (`db push` aplicado). |
| `app/actions/terminais.ts` | **NOVO** — `listTerminais` (cria PDV1/2/3 default), `criarTerminal`, `setTerminalStatus`. Scoped por `storeId`; `withPrismaSafe` degrada se a tabela não existir. |
| `lib/pdv-terminal.ts` | **NOVO** — `deviceId` estável, seleção por loja em localStorage, hook `useTerminalAtivo`. |
| `components/dashboard/vendas/terminal-selector.tsx` | **NOVO** — tela "Selecionar Terminal": cards, adicionar, ativar/desativar, fallback "Continuar sem terminal". |
| `app/dashboard/vendas/vendas-page-client.tsx` | Gate: seleciona terminal antes do PDV (com fallback que não bloqueia a operação). |
| `components/dashboard/caixa/caixa-status-bar.tsx` | Exibe terminal atual (badge) + "Trocar" com caixa fechado. |
| `components/dashboard/caixa/abertura-caixa-modal.tsx` · `app/api/ops/caixa/abrir/route.ts` | Caixa grava `terminalId` na `SessaoCaixa` (com fallback se a coluna não existir). |
| `lib/operations-sale-types.ts` · `lib/ops-upsert-venda.ts` · `lib/operations-store.tsx` | Venda carrega `terminalId` em `Venda.payload` (caminho financeiro intacto). |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK · `npx prisma db push` em sync.

**Fase 2 (pendente, documentada):** lock/heartbeat anti-simultâneo, caixa/venda 100% por
terminal (coluna `Venda.terminalId` + reconciliação/fechamento por terminal), relatórios
PDV1/PDV2/PDV3 + consolidado, `localStorage` do caixa por terminal, gate no `pdv-next`,
limite de terminais por plano.

### Vendas HUB — Correção operacional de vendas (concluído 23/05/2026)

**Contexto:** décima fase — implementar edição segura de vendas com auditoria,
separar área operacional de relatórios. Detalhes em
[`docs/ai/VENDAS_HUB_CORRECAO_OPERACIONAL_REPORT.md`](./VENDAS_HUB_CORRECAO_OPERACIONAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `app/api/vendas/[id]/corrigir/route.ts` | **NOVO** — endpoint de correção segura: altera forma de pagamento (com PIN supervisor + ajuste `MovimentacaoFinanceira.descricao`), cliente, observação. Valida total imutável, motivo obrigatório, auditoria em `payload.correcoes[]`. |
| `app/api/vendas/[id]/route.ts` | GET expõe `clienteId`, `observacao` e `correcoes[]` do payload. |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | Header renomeado "Histórico de Vendas" → "Vendas". Botão "Corrigir venda" (Wrench) na tabela, drawer e dropdown mobile. Modal de correção com 3 abas (Pagamento/Cliente/Observação). Seção "Correções" no drawer com histórico before/after. |

**Funcionalidades:**
- Correção de forma de pagamento (ex.: Dinheiro → PIX) com PIN supervisor
- Correção de cliente vinculado (nome + FK)
- Correção de observação
- Total e itens **nunca alterados** (validação server-side `422 total_mismatch`)
- Auditoria completa em `Venda.payload.correcoes[]` (before/after, operador, supervisor, motivo)
- `MovimentacaoFinanceira` ajustada na descrição (valor total preservado)
- Drawer mostra histórico de correções

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos restantes:** correção de pagamento redistribui 100% do total em uma forma
(correção parcial de pagamento misto exigiria UI breakdown — fora de escopo);
validação visual nos 4 temas recomendada.

### Caixa — Fechamento ERP Premium (estilo Gestão Click) (concluído 23/05/2026)

**Contexto:** evoluir o fechamento de caixa para padrão ERP — consolidação por
origem, por forma de pagamento e resumo operacional. Detalhes em
[`docs/ai/FECHAMENTO_CAIXA_ERP_PREMIUM_REPORT.md`](./FECHAMENTO_CAIXA_ERP_PREMIUM_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `lib/caixa-fechamento-resumo.ts` (NOVO) | Helper puro único: `classifyLineOrigem`, `filterSalesDaSessao`, `computeFechamentoResumo` → por origem (PDV/Balcão, Item Avulso, O.S.), por pagamento e consolidação. Convenção `recebido = líquido − aPrazo` alinhada ao `MovimentacaoFinanceira(origem:"venda")`. |
| `components/dashboard/caixa/fechamento-caixa-modal.tsx` | Resumo ERP (KPIs + por origem + por pagamento + gaveta), **conferência por dinheiro físico** (`saldoInicial + dinheiro + suprimentos − sangrias`, corrige conferir gaveta contra total que incluía pix/cartão), cabeçalho operador/sessão, impressão/cópia ERP, persistência do resumo em `SessaoCaixa.payload.resumoFechamento`. |
| `components/dashboard/caixa/caixa-relatorio.tsx` | Card "Vendas por origem" reusando o helper. |
| `components/dashboard/caixa/caixa-historico-client.tsx` | Comprovante (impressão + detalhe) consome `payload.resumoFechamento`, com fallback ao ledger legado. |

**Sem schema novo** (resumo viaja no `payload` JSONB existente). Rotas
`caixa/{fechar,sessao-detalhe}` e o ledger financeiro **inalterados**.
Multi-terminal **não** iniciado (fora de escopo).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Pendências (relatório):** PDV Balcão × Venda Completa não são distinguíveis na
origem (mesmo `finalizeSaleTransaction`, sem marcador); operador é o `cashierId`
local (nome amigável fica no server); vendas `syncPending` entram no resumo
operacional (canônico financeiro segue sendo `totalVendasServer`).

### PDV — Venda Avulsa via tecla INSERT (Item Avulso) (concluído 23/05/2026)

**Contexto:** trazer ao OmniGestão o fluxo do sistema antigo onde **INSERT**
vendia rápido um item não cadastrado no balcão. Detalhes em
[`docs/ai/PDV_ITEM_AVULSO_INSERT_GOAL_REPORT.md`](./PDV_ITEM_AVULSO_INSERT_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `lib/os-pdv-virtual-lines.ts` | + `AVULSO_PREFIX`, `isAvulsoSaleLine`, `isVirtualSaleLine` (união O.S.+avulso), `avulsoInventoryId()`. Linha avulsa = `inventoryId` com prefixo `__avulso__` — não toca estoque. |
| `lib/operations-sale-types.ts` | `SaleLineRecord` + `isAvulso?` e `custoUnitario?: number\|null`. |
| `lib/operations-store.tsx` | `finalizeSaleTransaction` aceita avulso; usa `isVirtualSaleLine` para pular validação/decremento de stock; mapping propaga `isAvulso`/`custoUnitario`. |
| `lib/ops-upsert-venda.ts` | `SalePayload.lines[]` + `isAvulso?`/`custoUnitario?`; Step 2/3 pulam resolução de produto e ledger para avulso. `MovimentacaoFinanceira` do total à vista inalterada. |
| `components/dashboard/vendas/item-avulso-modal.tsx` (NOVO) | Modal com descrição/valor/qtd/custo opcional; mostra total e margem estimada; tokens semânticos. |
| `components/dashboard/vendas/pdv-classic.tsx` · `pdv-supermercado.tsx` · `pdv-assistencia-enterprise.tsx` | Tecla INSERT + handler `addItemAvulso` + filter do `onConfirm` aceitando avulso, nos **3 PDVs operacionais**. Clássico ainda ganha item "Item Avulso" no menu Operações de Caixa. Linha avulsa rotulada "AVULSO" no carrinho. |
| `lib/audit-log.ts` | + action `pdv_item_avulso_adicionado`. |
| `app/api/ops/devolucao/route.ts` · `app/api/vendas/[id]/cancelar/route.ts` | Trocam `isOsVirtualSaleLine`→`isVirtualSaleLine` (defesa: cancelar/devolver venda com avulso não tenta repor estoque inexistente). |

**Comportamento:** item avulso entra na venda, caixa, financeiro, cupom e
histórico; **não** baixa estoque, **não** cria `MovimentacaoEstoque`, **não**
cria produto. Custo opcional vai em `Venda.payload.lines[].custoUnitario`
(ausente = custo desconhecido). Idempotência/retry/syncPending preservados.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Cobertura:** os **3 PDVs operacionais** (Clássico, Assistência, Supermercado)
têm Item Avulso via INSERT.

**Pendências (relatório):** relatórios de margem ainda não distinguem "custo
zero" de "custo desconhecido" (avulso sem custo informado fica `undefined` no
payload); item avulso é sempre quantidade inteira (sem venda por peso);
`pdv-next` segue sem persistir venda (não usar).

### CRM / Clientes HUB — Auditoria e estabilização para uso real (concluído 23/05/2026)

**Contexto:** oitava fase — auditoria ponta-a-ponta do CRM `/dashboard/clientes`
(SPA Lovable-style ~2.235 linhas): listagem, drawer de cadastro/edição (5 abas),
drawer de perfil (3 abas), histórico de compras + OS, timeline, total gasto,
integrações Venda→Cliente / OS→Cliente, multi-loja. Detalhes em
[`docs/ai/CLIENTES_HUB_GOAL_REPORT.md`](./CLIENTES_HUB_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `app/api/clientes/route.ts` | **Bug de consistência crítico:** `totalSpent` retornado era a coluna estática `Cliente.totalSpent` (preenchida só no import, nunca atualizada por PDV/OS). Agora a lista agrega `OrdemServico Pronto/Entregue` + `Venda concluida` por `clienteId` (dois `groupBy` paralelos, scoped por `storeId`), com fallback à coluna estática — mesma estratégia do `listClientes` do Cadastros HUB. Consistência entre módulos. |
| `app/api/clientes/[id]/route.ts` | Detalhe do cliente agora retorna `totalSpent` **agregado** (dois `aggregate` paralelos somando OS+Vendas sem o limite de 15 do `include`), com fallback ao estático. Resolve o caso "perfil mostra R$ 0,00 mas histórico abaixo lista 5 vendas". |
| `app/dashboard/clientes/ClientesPageClient.tsx` | (1) **Métrica falsa removida:** KPI "Ticket Médio" caía para `380.00` hardcoded quando não havia `totalSpent>0` → trocado por `0`. (2) **Contraste de tema corrigido:** caixas `listError` e `formError` usavam `bg-red-950/20 text-red-200` (invisível em Light/Soft Ice) → tokens semânticos `border-destructive/30 bg-destructive/10 text-destructive` (legíveis nos 4 temas). |

**Auditoria (real, multi-loja preservado):** busca server-side por
nome/CPF/CNPJ/cidade; filtros por PF/PJ/status/VIP/inadimplente/cidade reais;
KPIs reais; drawer de cadastro com 5 abas persistindo `tags` estruturadas
(labels, address, financial, operational); drawer de perfil com histórico real
de OS e Vendas (relações Prisma) e timeline derivada de eventos reais; ações
WhatsApp/Nova OS/Iniciar Venda com deep-link `?clienteId=`. `storeId` via
`ASSISTEC_LOJA_HEADER` em todas as chamadas.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos restantes (documentados no relatório):** dois editores de cliente com
formatos diferentes de `tags` (Cadastros HUB salva como `string[]` → sobrescreve
o objeto estruturado do CRM); histórico do perfil limitado a 15 últimos (total
agora é agregado sem esse limite); opções hardcoded de Carteira/Técnico
Responsável no form; `toastRafacell` força tom preto cross-tema (marca); coluna
`Cliente.totalSpent` permanece estática (não é atualizada por PDV/OS — agregação
em leitura é o suficiente).

### Estoque HUB — Auditoria e estabilização para operação real (concluído 23/05/2026)

**Contexto:** sétima fase — auditoria ponta-a-ponta do Estoque HUB: saldo,
movimentações, inventário, ajustes, entradas/saídas, integrações PDV→estoque e
OS→estoque, filtros/busca, multi-loja. Detalhes em
[`docs/ai/ESTOQUE_HUB_GOAL_REPORT.md`](./ESTOQUE_HUB_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `components/dashboard/estoque/gestao-produtos.tsx` | **Mock enganoso crítico corrigido:** a importação de XML NF-e (`confirmarEntradaMercadoria`) só alterava o estado local do React mas exibia "Entrada de mercadoria concluída / Estoque atualizado com sucesso" — nada era persistido (sumia ao recarregar). Tornado **pré-visualização honesta**: função fake removida, botão "Confirmar Entrada" desabilitado ("em breve"), banner âmbar explicando que XML não grava no estoque (entrada real via Cadastros → Estoque ou Importador Avançado), copy corrigida. Removido também `const mockProducts` morto. |

**Auditoria (real, multi-loja preservado):** backend `app/actions/estoque.ts`
(entrada com custo médio ponderado, ajuste com delta, livro-razão imutável
`MovimentacaoEstoque`, KPIs/alertas, tudo `storeId`-scoped); Auditoria de Estoque
(`auditoria-estoque.tsx`) e Movimentação/Inventário (`planejamento-compras.tsx`)
são reais; integrações PDV→estoque (`origem:"pdv"`) e OS→estoque (`origem:"os"`)
visíveis e auditáveis. `toast.info` confirmado existente no hook.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos restantes (documentados no relatório):** "Estoque Mínimo (Alerta)" do
form **não persiste** (sem coluna no schema) → KPI "Estoque Baixo" conta
`stock<=0`; entrada real por NF-e segue pendente (preview); editar "Estoque Atual"
pelo produto sobrescreve saldo **sem livro-razão** (use Entrada/Ajuste para
trilha); estoque negativo possível em concorrência (já detectado na Auditoria);
`servicos.tsx` do estoque é código morto.

### Cadastros HUB — Auditoria e estabilização para uso real (concluído 23/05/2026)

**Contexto:** sexta fase — auditoria ponta-a-ponta do Cadastros HUB
(`/dashboard/cadastros-v2`): Dashboard, Clientes, Produtos, Serviços,
Fornecedores, Técnicos, Equipamentos, Categorias/Marcas, Importação e
Auditoria. Detalhes em [`docs/ai/CADASTROS_HUB_GOAL_REPORT.md`](./CADASTROS_HUB_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `app/actions/cadastros.ts` | **Bug crítico de perda de dados:** `ClienteDTO` ganha `email` e `listClientes` mapeia `c.email`. Antes o DTO não trazia email → o modal de edição usava `defaultValue=""` → `updateCliente` gravava `email: null`, **apagando o email** de qualquer cliente editado sem redigitar o campo. |
| `components/cadastros/lovable/components/cadastros/CadastrosHub.tsx` | (1) Email do cliente prefilled na edição (`defaultValue={editing?.email}`). (2) Card fake "IA de Cadastros" (números hardcoded + botão "Corrigir com IA" morto) → "Sugestões de melhoria" com dados **reais** de `stats` + botão real que navega para Produtos. (3) Busca global morta do header removida. (4) Botões mortos "Filtros"/"Exportar" do `Toolbar` desabilitados ("em breve"); busca do `Toolbar` agora condicional ao handler. (5) Busca real ligada em Serviços/Fornecedores/Técnicos/Equipamentos (antes a caixa não filtrava). (6) Botões IA do card de Equipamento desabilitados (não disparam mais o modal por bubbling). |

**Auditoria (todas reais, multi-loja preservado):** CRUD real via Server
Actions → Prisma para Clientes, Produtos (com exclusão protegida por vínculos),
Serviços, Fornecedores, Técnicos, Equipamentos, Categorias/Marcas; estoque via
`app/actions/estoque`; Importação (auditada 21/05) e Auditoria de logs reais.
`storeId` resolvido por loja ativa em todas as actions.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos restantes (documentados no relatório):** campos do form de Cliente
(Endereço/UF/Observações/Consentimento LGPD) e de Serviço (Peças/Checklist/
Marketing IA) **não persistem** (sem coluna no schema); cards de Técnico com
métricas zeradas fixas; coluna "Categoria" de Fornecedor sempre "—"; Auditoria
e Histórico de importação **não filtram por `storeId`** (logs globais,
pré-existente). Nenhum exige correção sem mudança de schema/queries.

### Vendas HUB — Auditoria e estabilização para uso real (concluído 23/05/2026)

**Contexto:** quinta fase — auditoria ponta-a-ponta do Vendas HUB (HUB Central,
Venda Completa Enterprise, Orçamentos, Histórico de Vendas, links internos) e
correção do bug visual de inputs/search bars em todos os temas. Detalhes em
[`docs/ai/VENDAS_HUB_GOAL_REPORT.md`](./VENDAS_HUB_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `styles/operational-density.css` | Removido `padding-inline … !important` das regras `[data-slot="input"]` e `input.border-input.rounded-md`. Esse `!important` (sempre ativo via `data-density="operational"` no `<html>`) sobrescrevia `pl-9`/`pr-9`, fazendo o texto/placeholder colidir com o ícone `absolute` dos search bars (Cliente e Itens na Venda Completa, Histórico, Orçamentos, pickers de PDV) em **todos os temas** (Light/Soft Ice/Midnight/Black). O `<Input>` base já usa `px-2.5` (= `--density-control-px`), então inputs sem ícone não regridem. |

**Auditoria (todas reais):** Venda Completa Enterprise — busca de cliente
(`/api/clientes`), busca/bipe de itens (inventory + scan), finalização via
`finalizeSaleTransaction` (estoque + `MovimentacaoFinanceira` + ledger),
integração com caixa aberto, a prazo (`ContaReceberTitulo`), enrich de dados
enterprise (`Venda.payload.enterprise`) e cupom não fiscal. HUB Central com cards
apontando para rotas reais. Histórico (`vendas-arquivo-geral`) com KPIs/detalhe
reais. Multi-loja preservado.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Riscos restantes:** rotas placeholder do SPA TanStack (`/pdv`, `/vendas/nova`,
`/orcamentos`, `/pedidos`, `/fiscal`) seguem "Em construção" e desconectadas dos
cards (código morto navegacional); Orçamentos é fluxo legado/transição;
`enrichVendaEnterprise` pode perder metadados silenciosamente se todos os retries
falharem (venda já registrada); PDV Black Edition (`/dashboard/pdv-next`) continua
sem persistir vendas. Validação visual em navegador nos 4 temas recomendada.

### Operações HUB — Auditoria e estabilização para uso real (concluído 23/05/2026)

**Contexto:** quarta fase de preparação para operação real — auditoria
ponta-a-ponta de OS (criar → editar → status → estoque → faturamento →
cancelar). Detalhes em
[`docs/ai/OPERACOES_HUB_GOAL_REPORT.md`](./OPERACOES_HUB_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `app/api/ops/ordens/route.ts` | **PUT** agora bloqueia (`409 ordens_ja_existentes`) quando a loja já tem OS persistidas. O endpoint era usado apenas para migração one-shot do localStorage legado quando o banco está vazio (`lib/operations-store.tsx` bootstrap), mas o `deleteMany`+`createMany` original podia apagar/zerar todas as OS de uma loja se chamado por engano ou com permissão de edição. Guard server-side preserva o caso legítimo. |
| `app/actions/operacoes.ts` | `criarVendaDeOSAction` agora resolve `clienteNome` por prioridade (`os.cliente?.nome` → lookup por `clienteId` → fallback `"Cliente"`) e persiste a FK `Venda.clienteId`. Antes gravava `clienteId` no campo `clienteNome` (cuid aparecia no Histórico de Vendas) e quebrava o cálculo de `Cliente.totalGasto` para vendas oriundas de OS. |

**Idempotência confirmada:** consumo/restauração/delta de estoque via flags em
`payload.estoqueConsumido` + `estoqueRestaurado` + `estoqueUltimaRevisaoEm`;
adapter OS→Faturamento via `localKey: adapter_os_faturamento:{storeId}:{osId}`
com merge de revisões em `payload.revisoes[]`. Multi-loja preservado em todas
as Server Actions via `requireOperacaoAuth`.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Orientação para uso amanhã:** Operações HUB V2 (`/dashboard/operacoes-v2`)
pronto. PDV (Goals 1–3) inalterado. Riscos restantes (Lovable hub usa
`CURRENT_STORE_ID = "loja-1"` mutável; race teórica em `nextCodigo`; estoque
fora da tx do status) documentados no relatório.

### Financeiro do PDV — Estabilização para operação real de caixa (concluído 23/05/2026)

**Contexto:** terceira fase de preparação para operação real em loja — auditoria
ponta-a-ponta dos registros financeiros gerados pelo PDV
(`MovimentacaoFinanceira`, `SessaoCaixa`, `CaixaOperacao`) nos 3 PDVs operacionais
(Clássico, Assistência, Supermercado). Detalhes em
[`docs/ai/FINANCEIRO_CAIXA_GOAL_REPORT.md`](./FINANCEIRO_CAIXA_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `lib/ops-upsert-venda.ts` | `MovimentacaoFinanceira(origem:"venda")` agora grava `createdAt = at` (data real da venda no cliente). Vendas offline re-sincronizadas tardiamente passam a cair na sessão de caixa temporalmente correta, em vez de na sessão atual do servidor (`/api/ops/caixa/{fechar,sessao-detalhe}` filtra por `createdAt BETWEEN abertaEm AND fechadaEm`). |
| `components/dashboard/vendas/pdv-classic.tsx` | Sangria/suprimento deixou de **falhar em silêncio**: substitui `void fetch(...).catch(() => {})` por handler que loga e exibe toast destrutivo "Sangria/Suprimento não confirmado no servidor". O `caixa.totalSaidas`/`totalEntradas` local diverge do DB quando o servidor rejeita ou cai — operador precisa saber para retentar. |

**Idempotência confirmada em todas as origens financeiras críticas:**
`venda` (referenciaId=pedidoId), `cancelamento_pdv` (referenciaId=pedidoId,
tipo:saida), `devolucao_pdv` (referenciaId=devolucao.id), `sangria_pdv` /
`suprimento_pdv` (referenciaId=caixaOperacao.id). Multi-loja preservado em
todos os endpoints de escrita (`opsLojaIdFromRequestForWrite`).

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Orientação para uso amanhã:** PDV **Clássico / Assistência / Supermercado**.
**NÃO usar `/dashboard/pdv-next`**. Riscos restantes (idempotência fraca de
sangria/suprimento, fire-and-forget do título à prazo, devolução com vale gera
saída financeira) documentados no relatório.

### PDV ↔ Estoque — Auditoria de integração para uso real (concluído 23/05/2026)

**Contexto:** segunda fase de preparação para operação real em loja — auditoria ponta-a-ponta
do caminho venda PDV → baixa de estoque → ledger → financeiro nos 3 PDVs operacionais
(Clássico, Assistência, Supermercado). Detalhes em
[`docs/ai/ESTOQUE_PDV_GOAL_REPORT.md`](./ESTOQUE_PDV_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `lib/ops-upsert-venda.ts` | Coleta `unresolvedInventoryIds[]` no Step 3 e emite `console.warn("[upsert-venda] estoque-nao-baixado", { pedidoId, lojaId, unresolvedInventoryIds })` quando uma linha não-virtual não casa por id/sku/barcode. Dá observabilidade para o cenário "venda OK mas estoque inflado" (produto deletado mid-sale, SKU divergente). Sem mudança de contrato. |

**Idempotência confirmada em todas as camadas:** `Venda.pedidoId` (PK), `ItemVenda`
(deleteMany+create), `MovimentacaoEstoque` (guard `documento+produtoId+origem`),
`MovimentacaoFinanceira` (guard `referenciaId+origem+tipo`), `DevolucaoVenda`
(`@unique storeId_localId`), e cancelamento (mesmos guards com `origem:"cancelamento_pdv"`).
Reenvios da rede de segurança Goal 1 (online/visibilitychange/30 s) **não duplicam** estoque
nem financeiro.

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Orientação para uso amanhã:** usar **Clássico / Assistência / Supermercado**. **NÃO usar
`/dashboard/pdv-next`** (continua não persistindo vendas, Goal 1). Riscos restantes (estoque
negativo em concorrência, venda por peso truncada como int) documentados como pré-existentes
no relatório.

### PDV & Caixa — Estabilização para operação real (concluído 23/05/2026)

**Contexto:** preparar PDV/Caixa para uso real em loja. Auditoria completa do fluxo
(abrir caixa → vender → finalizar → fechar) + 2 correções cirúrgicas. Detalhes em
[`docs/ai/PDV_CAIXA_GOAL_REPORT.md`](./PDV_CAIXA_GOAL_REPORT.md).

| Arquivo | Mudança |
|---|---|
| `components/dashboard/caixa/abertura-caixa-modal.tsx` | Abertura deixou de **falhar em silêncio**: toast destrutivo quando a sessão não é registrada no servidor (caixa abre local, mas o operador é avisado). |
| `lib/operations-store.tsx` | **Rede de segurança de venda**: além do reenvio no bootstrap, vendas `syncPending` são reenviadas em `online`, foco da aba e a cada 30s (`venda-persist` é idempotente). Reduz risco de venda presa só no localStorage até reload. |

**Validação:** `npx tsc --noEmit` 0 erros · `npm run build` OK.

**Risco crítico documentado:** PDV Black Edition (`/dashboard/pdv-next`) **não persiste
vendas** (`handlePaymentConfirm` só reseta UI) — não usar para operação real. Demais
riscos (fechamento offline reabre no reload mas auto-cura; abertura duplicada;
`totalEntradas` acumulativo) listados no relatório.

### Trocas — Fase 4 Crédito/Vale persistente no banco (concluído 22/05/2026)

**Contexto:** crédito/vale do cliente estava 100% em `localStorage` (`customerCredits`) — sumia entre navegadores, caixas e computadores.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | + modelos `ClienteCredito` e `UsoCreditoCliente`. `Store` + `Cliente` + `DevolucaoVenda` ganham relações. Tabelas: `clientes_creditos` e `usos_credito_cliente`. |
| `app/api/ops/credito-cliente/route.ts` (NOVO) | `GET ?lojaId=&[doc=]` — retorna créditos ativos agregados por CPF/CNPJ. Usado no bootstrap e no drawer de detalhes. |
| `app/api/ops/devolucao/route.ts` | Passo 4 dentro da transação: cria `ClienteCredito` quando `creditoEmitido > 0` e `tipo !== "somente_estoque"`. Atômico — rollback se devolução falhar. |
| `lib/ops-upsert-venda.ts` | `SalePayload` + `customerCpf?`. Passo 5 dentro da transação: debita `ClienteCredito` (oldest-first) e cria `UsoCreditoCliente` quando `creditoVale > 0`. Atômico — rollback se venda falhar. |
| `lib/operations-store.tsx` | `loadDb` bootstrap: fetch `GET /api/ops/credito-cliente` após reconciliação de sessão; DB sobrescreve localStorage para docs conhecidos (best-effort). |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | `saldoCredito` state; `openDetalhe` busca saldo atual se venda tem devolução com crédito; drawer mostra "Saldo em haver: R$ X" ou "Crédito totalmente utilizado". |

**Fluxo completo:**
1. Operador faz devolução com modo `vale_credito` ou `troca`:
   - `registrarDevolucao` debita estoque + cria `DevolucaoVenda` + cria `ClienteCredito` (DB) na mesma tx.
   - `customerCredits[cpf].saldo` em localStorage atualizado imediatamente.
2. Operador usa o vale em nova venda (`creditoVale` no `paymentBreakdown`):
   - `finalizeSaleTransaction` valida saldo em localStorage e debita.
   - `venda-persist` → `upsertVendaInTransaction` debita `ClienteCredito` e cria `UsoCreditoCliente` (DB) na mesma tx.
3. Ao iniciar o PDV (bootstrap):
   - `loadDb` busca `GET /api/ops/credito-cliente?lojaId=...` e mescla DB → localStorage. DB vence para CPFs conhecidos.
4. Drawer Histórico de Vendas:
   - Se venda tem devolução com crédito e `clienteCpf`, busca saldo atual em `GET /api/ops/credito-cliente?doc=...`.
   - Mostra "Saldo em haver" (verde) ou "Crédito totalmente utilizado" (neutro).

**Comportamento sem cadastro de cliente (sem CPF):**
- `registrarDevolucao` requer CPF → não permite vale sem doc (comportamento pré-existente mantido).
- Crédito sem CPF não é persistido no DB (linha `if (docNorm)` na devolução).

**Schema:**

```prisma
model ClienteCredito {
  clienteDoc    String   // CPF/CNPJ dígitos — chave de lookup
  valorOriginal Float
  saldoAtual    Float
  status        String   // "ativo" | "zerado" | "expirado"
  validoAte     DateTime?
  usos          UsoCreditoCliente[]
  // + storeId, clienteId?, devolucaoId?, vendaOrigemId, createdAt, updatedAt
}

model UsoCreditoCliente {
  vendaId     String   // pedidoId da venda
  valor       Float    // quanto foi debitado
  saldoAntes  Float
  saldoDepois Float
  operador    String
  // + creditoId, storeId, at
}
```

**Idempotência e atomicidade:**
- `ClienteCredito` é criado dentro da transação de `DevolucaoVenda` → rollback se falhar.
- `UsoCreditoCliente` é criado dentro da transação de `Venda` → rollback se falhar.
- Não há guards adicionais de idempotência: a transação só é executada uma vez (bloqueada pelo `pedidoId` único no upsert de Venda).

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → em andamento ao fechar a sessão.

**Limitações / Fases futuras:**
- `validoAte` (validade opcional) existe no schema mas não é verificada no PDV ainda.
- Crédito gerado antes da Fase 4 (pré-22/05/2026) está apenas em localStorage — não migrado retroativamente.
- Bootstrap recupera do DB, mas operação offline (sem internet) ainda usa só localStorage.
- `getSaldoCreditoCliente` continua retornando valor de localStorage; após bootstrap, os valores são sincronizados.

---

### Trocas — Fase 3 Troca Imediata + Cupom (concluído 22/05/2026)

**Contexto:** modo "troca" da Fase 0 emitia apenas vale-crédito local; não havia ligação com nova venda. Operador precisava abrir o PDV em paralelo. Não havia comprovante operacional.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `components/dashboard/vendas/trocas-devolucao.tsx` | Mini-PDV embutido (modo "troca"): busca produto/SKU/EAN no inventory real, mini-carrinho com `+/-/x`, resumo "Devolvido / Nova compra / Diferença". Cobrança da diferença via `paymentBreakdown` (dinheiro/pix/débito/crédito) usando o **próprio `finalizeSaleTransaction`** existente — abate `creditoVale` recém-emitido como crédito interno. Excesso devolvido escolhe entre vale ou dinheiro. **Cupom de Troca/Devolução** (`CupomTroca`) abre automaticamente após confirmar (devolução simples, vale e troca imediata): imprimir 80mm, imprimir vale ESC/POS, copiar resumo. |
| `app/api/vendas/[id]/route.ts` | GET expõe `modo` e `novaVendaId` extraídos do `payload` de cada devolução (vínculo para a timeline). |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | Drawer: badge "Troca imediata" em destaque + mini-timeline `venda original → devolução → nova venda` quando `payload.modo === "troca_imediata"`. |

**Cenários da troca imediata:**
- `nova > devolvido` → cobra **só a diferença** na forma escolhida; cria nova venda real (PDV core inalterado).
- `nova = devolvido` → finaliza sem cobrança; vale consumido integralmente.
- `nova < devolvido` → vale parcial consumido + opção de gerar vale-troca ou devolver em dinheiro.

**Vínculo via payload (sem alterar schema):** `DevolucaoVenda.payload` agora guarda `{ modo: "troca_imediata", vendaOriginalId, novaVendaId, valorDevolvido, totalNovaCompra, diferencaPaga, diferencaForma, creditoRestante, excessoDinheiro }`. A nova venda é criada via `finalizeSaleTransaction` standard.

**Reaproveitamento:** `finalizeSaleTransaction` (PDV core), `registrarDevolucao` (Fase 0), `/api/ops/devolucao` (estoque + status server), `buildValeTrocaEscPos`, `openThermalHtmlPrint`. Nenhuma duplicação de lógica de PDV.

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → Compiled successfully.

**Limitações / Fase 4:** crédito persistente em DB segue fora de escopo (Fase 1); excesso em dinheiro só é registrado no audit-log (não cria `MovimentacaoFinanceira` saída — operador entrega no caixa); recovery automático se `finalizeSaleTransaction` falhar após `registrarDevolucao` continua manual (toast com instrução clara).

---

### Cancelamento de Venda — Fase 2 ERP-safe (concluído 22/05/2026)

**Contexto:** o cancelamento marcava `status="cancelada"` + motivo/operador/data e estornava **apenas** o título à prazo (`contaReceberTituloId`). **Não repunha estoque** nem estornava a entrada à vista (`MovimentacaoFinanceira origem:"venda"`). Sem trilha de auditoria de estoque/financeiro no cancelamento.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `app/api/vendas/[id]/cancelar/route.ts` | Cancelamento agora roda em **transação**: (1) marca cancelada; (2) **repõe estoque** por `ItemVenda` resolvendo produto via `OR[id,sku,barcode]`, criando `MovimentacaoEstoque(tipo:"entrada", origem:"cancelamento_pdv", documento=pedidoId)` — repõe o **líquido** (vendido − já devolvido na Fase 0) para não duplicar entrada; (3) **estorna à vista** criando `MovimentacaoFinanceira(saida, origem:"cancelamento_pdv")` pelo valor líquido (entrada `venda` − refunds de devolução). Idempotente em estoque (`documento+produtoId+origem`) e financeiro (`referenciaId+tipo+origem`). `sessaoId` registrado na descrição do estorno (não reabre sessão). Estorno à prazo (`contaReceberTitulo`) mantido. |
| `app/api/vendas/[id]/route.ts` | Detalhe expõe `estoqueReposto` e `estornoFinanceiro` (flags do cancelamento). |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | Banner de cancelamento mostra "Estoque reposto" / "Estorno financeiro registrado". |

**Idempotência:** retry do cancelamento é bloqueado por `status==="cancelada"` (409) **e** por guards `findFirst` em estoque/financeiro (defesa em profundidade). Reposição/estorno nunca duplicam.

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → Compiled successfully.

**Riscos/pendências:** sessão de caixa fechada não é reaberta — estorno é registrado mesmo assim (auditável; impacto operacional documentado). Crédito/vale persistente segue fora de escopo (Fase 1).

---

### Trocas & Devoluções — Fase 0 (unificação real, concluído 22/05/2026)

**Contexto:** o F8 do PDV Assistência abria um `TrocasModal` 100% mock (inputs `itemDesc`/`motivo`, toast fake, `setTimeout(1500)`). Os botões "Trocas"/"Devoluções" do shell Omni/Classic eram placeholders. O Histórico de Vendas não tinha entrada para troca/devolução. A devolução existente (`/api/ops/devolucao`) persistia `DevolucaoVenda` + financeiro, **mas não devolvia estoque real** nem atualizava `Venda.status`.

**Objetivo da fase:** substituir o mock pelo fluxo real **reaproveitando** `TrocasDevolucao`, `/api/ops/devolucao`, `GET /api/vendas/[id]`, `qtyReturned` e `buildValeTrocaEscPos` — sem criar sistema novo.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `app/api/ops/devolucao/route.ts` | **Estoque REAL** dentro da transação: resolve produto por `OR [id, sku, barcode]`, `increment` em `Produto.stock` e cria `MovimentacaoEstoque(tipo:"entrada", origem:"devolucao")` com custo/auditoria (mesmo padrão do adapter OS→Estoque). Idempotência por `documento(localId)+produtoId+origem`. **`Venda.status`** atualizado para `parcialmente_devolvida`/`devolvida` agregando devoluções vs `ItemVenda`. `tipo` zod aceita `devolucao`. |
| `app/api/vendas/[id]/route.ts` | Detalhe expõe `creditoEmitido` por devolução. |
| `components/dashboard/vendas/trocas-devolucao.tsx` | 4 modos (devolução / troca / crédito-vale / somente estoque) mapeados ao modo local; campo **motivo**; props `initialSaleId` + `initialSale` (prefill) e `onRegistered` (refresh externo). `qtyReturned`, bloqueio de excesso e impressão ESC/POS preservados. |
| `components/dashboard/vendas/pdv-assistencia-enterprise.tsx` | `TrocasModal` mock **removido**; F8 abre `<TrocasDevolucao />` real em Dialog. |
| `components/dashboard/vendas/pdv-omni-classic-shell.tsx` + `pdv-classic.tsx` | Botões "Trocas"/"Devoluções" do diálogo avançado ligados ao modal real (`onOpenTrocas` → `showDevolucaoModal`). |
| `components/dashboard/vendas/vendas-arquivo-geral.tsx` | Botão "Trocar / Devolver" (linha, menu e drawer) abre `TrocasDevolucao` com a venda pré-carregada (snapshot); drawer mostra crédito gerado por devolução e label "Devolução". |

**Status real vs mock:**

| Item | Status |
|---|---|
| F8 PDV Assistência → fluxo real | ✅ Real |
| Trocas/Devoluções no Omni/Classic | ✅ Real |
| Botão Trocar/Devolver no Histórico | ✅ Real (carrega cliente + itens) |
| Estoque devolvido ao banco + ledger auditável | ✅ Real (`origem:"devolucao"`) |
| `Venda.status` parcial/total automático | ✅ Real (server-side) |
| Vale-troca ESC/POS | ✅ Real (inalterado) |
| Crédito do cliente | ⚠️ Local (localStorage) — persistência DB fica para Fase 1 |

**Fora de escopo (Fase 1/2):** estorno de cartão, PIX automático, financeiro avançado, crédito persistente em DB, carrinho negativo, multi-venda avançada.

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → Compiled successfully.

---

### Fluxos de Novo Cadastro — Unificação (concluído 22/05/2026)

**Contexto:** Existiam 3 pontos de entrada para criar cadastros (Topbar, CadastrosHub modal, DashboardPanel) com comportamento inconsistente. O Topbar apontava para páginas legacy. O ProductAIModal tinha botões mortos e animação fake de IA.

**Arquivos alterados:**

| Arquivo | Mudança |
|---------|---------|
| `components/painel-inicial/Topbar.tsx` | "Novo Cliente" e "Novo Produto" agora apontam para `/dashboard/cadastros-v2` (CadastrosHub canônico) em vez de páginas legacy |
| `components/cadastros/lovable/components/cadastros/produto-ia.tsx` | Botão "Preencher com IA" desabilitado com label "Em breve"; "Salvar rascunho" desabilitado; seção "Imagem IA" marcada como "Em breve" com `pointer-events-none` |

**O que já funcionava e não foi alterado:**

- Modal "Novo cadastro" do CadastrosHub: todos os 6 cards (Cliente, Produto, Serviço, Fornecedor, Técnico, Equipamento) já abriam formulários reais via `autoOpen` — mecanismo correto, nenhuma mudança necessária.
- `upsertProduto`: estoque, custo, preço e todos os campos mapeados já salvavam corretamente.
- Todos os 6 painéis do CadastrosHub: persistência real via server actions.

**O que ficou como "Em breve" (documentado em `docs/auditoria/CADASTROS_FLUXOS_UNIFICACAO.md`):**

- Preenchimento automático de produto por IA (OCR, voz, link, código de barras)
- Upload e processamento de imagem de produto
- Rascunhos de produto
- Campos NCM, Tributação, Tags, Descrição, Modelo — presentes no form mas não mapeados em `upsertProduto`

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → Compiled successfully.

---

### Bug: decremento de estoque ignorava quantidade total quando mesmo produto em múltiplas linhas (corrigido 21/05/2026)

**Problema em produção:** produto com estoque 2, vendido em 2 unidades → estoque ficava 1 (deveria ficar 0).

**Causa raiz:** o PDV pode enviar o mesmo produto em N linhas do carrinho (ex.: 2 cliques → 2 linhas qty=1, ou manualmente incrementado → 1 linha qty=2). O Step 3 de `upsertVendaInTransaction` processava linha por linha. Após criar `MovimentacaoEstoque` para a linha 1, o guard de idempotência `findFirst({ documento, produtoId, origem:"pdv" })` encontrava essa entrada na linha 2 e pulava → só 1 unidade decrementada em vez da soma correta.

**Solução — agregação prévia por produto (1 arquivo, 1 bloco):**

`lib/ops-upsert-venda.ts` Step 3: antes de criar o ledger, agrega `qtyByProdutoId: Map<dbId, totalQty>` somando as quantidades de todas as linhas do mesmo produto. Cria `resolvedByDbId` mapa reverso para acessar `sku/nome`. Então itera por produto único (não por linha), criando um único `MovimentacaoEstoque` e um único `decrement` com a quantidade total. Idempotência preservada: o guard `findFirst(documento+produtoId)` continua bloqueando retry da mesma venda.

| Cenário | Antes | Depois |
|---|---|---|
| 1 linha qty=2 | ✓ (decrementa 2) | ✓ (decrementa 2) |
| 2 linhas qty=1 mesmo produto | ✗ (decrementa 1) | ✓ (decrementa 2) |
| Retry da mesma venda | ✓ (bloqueado) | ✓ (bloqueado) |
| Produtos diferentes | ✓ | ✓ |

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → OK.

---

### Bug: estoque PDV não baixava + detalhe de venda falhava (corrigido 21/05/2026)

**Problema em produção:** vendas finalizadas no PDV mostravam saldo no financeiro/caixa mas:
- `Produto.stock` nunca decrementava;
- Nenhuma `MovimentacaoEstoque` era criada;
- Botão "Detalhes" na venda retornava erro 400 "ID da venda obrigatório".

**Causa raiz 1 — OR lookup ausente (estoque):**
`app/api/ops/inventory/route.ts` → `rowToItem()` retorna `id = skuTrim || row.id`. Quando o produto tem SKU (ex. "P001"), `InventoryItem.id = "P001"` (não o cuid). O PDV grava `inventoryId: "P001"` no carrinho. `upsertVendaInTransaction` Step 3 fazia `findFirst({ id: "P001" })` — campo `id` é cuid, não SKU → retornava `null` → `continue` → sem decremento, sem ledger.

**Causa raiz 2 — params não-await (detalhe):**
`app/api/vendas/[id]/route.ts` usava `{ params }: { params: { id: string } }` + `params.id` síncrono. No Next.js 16.2.0 `params` é uma `Promise` — `params.id === undefined` → 400 "ID da venda obrigatório".

**Solução (3 arquivos, mínimo necessário):**

| Arquivo | Mudança |
|---|---|
| `lib/ops-upsert-venda.ts` | Step 2 (ItemVenda): resolve produto via `OR [{ id }, { sku }, { barcode }]` + caches resultado em `resolvedProductMap<rawInvId, ResolvedProduct>`. Grava `ItemVenda.inventoryId = resolved.dbId` (cuid real). Step 3 (MovimentacaoEstoque): consome `resolvedProductMap` — sem re-busca; usa `resolved.dbId` para idempotência, decremento e ledger. |
| `app/api/vendas/[id]/route.ts` | `params: Promise<{ id: string }>` + `const { id: rawId } = await params`. |
| `app/api/vendas/[id]/cancelar/route.ts` | Mesma correção de `params`. |

**Efeito colateral positivo:** `ItemVenda.inventoryId` agora armazena o cuid real do `Produto` em vez do SKU, tornando as consultas de detalhe/devolução mais robustas.

**Validação:** `npx tsc --noEmit` → 0 erros. `npx next build --webpack` → OK.

---

### Caixa Híbrido → SessaoCaixa Server como fonte principal (concluído 21/05/2026)

**Problema:** estado do caixa vivia 100% em localStorage. Se limpo entre turnos, o PDV perdia a sessão ativa (abre sessão duplicada no server), e o fechamento gravava `totalVendas` vindo do localStorage (que podia divergir do banco).

**Solução (3 arquivos, best-effort/backward-compatible):**

| Arquivo | Mudança |
|---|---|
| `app/api/ops/caixa/sessao-detalhe/route.ts` | Agrega `MovimentacaoFinanceira(origem:"venda")` no intervalo da sessão → devolve `totalVendas` + `totalVendasCount` em `totais`. Sem mudança de assinatura existente (campo novo, adição). |
| `app/api/ops/caixa/fechar/route.ts` | Lê `abertaEm` da sessão; calcula `totalVendasServer` e `totalVendasCount` do banco; mescla com payload do cliente antes de gravar em `SessaoCaixa.payload`. Registro de fechamento agora é auditável mesmo se localStorage estava divergente. |
| `lib/operations-store.tsx` | No `loadDb` bootstrap, após sincronizar inventory/orders/sales, faz `GET /api/ops/caixa/sessoes?status=ABERTA&take=1`. Se server tem sessão ABERTA e estado local diz fechado (ou sem sessaoId): restaura `caixaSessaoId`, `isOpen=true`, `saldoInicial`, `dataAbertura`. Best-effort — falha silenciosa; não auto-fecha sessão no sentido inverso (segurança). |

**Fonte de verdade por campo após esta sessão:**

| Campo | Antes | Depois |
|---|---|---|
| `caixa.isOpen` | localStorage | localStorage + reconciliação server no bootstrap |
| `caixaSessaoId` | localStorage | localStorage + recuperação server no bootstrap |
| `caixa.saldoInicial` | localStorage | localStorage + recuperação server no bootstrap |
| `caixa.totalEntradas` | localStorage (acumulativo) | localStorage (runtime); `totalVendasServer` em `SessaoCaixa.payload` no fechamento |
| `totalVendas` histórico | localStorage snapshot em payload | banco (`MovimentacaoFinanceira`) — calculado server-side no fechamento e no `sessao-detalhe` |
| sangria/suprimento | `CaixaOperacao` DB (já era) | inalterado |

**O que NÃO foi alterado:**
- Fluxo de abertura/fechamento do caixa (modal UX, botões, toasts).
- `totalEntradas` runtime na barra PDV (ainda vem do localStorage acumulativo — mudá-la seria refatoração visual).
- Auth, proxy, OS, Marketplace, WhatsApp.
- Idempotência de `MovimentacaoFinanceira` e `MovimentacaoEstoque` (sessão anterior).

**Riscos remanescentes:**
- `totalEntradas` na barra PDV pode divergir de `totalVendasServer` (se vendas falharam no sync ou se localStorage foi parcialmente limpo). Resolver exigiria polling de `sessao-detalhe` durante o turno — fora de escopo.
- Sessões históricas (pré-21/05/2026) terão `totalVendasServer = 0` em `sessao-detalhe` (não existiam `MovimentacaoFinanceira(origem:"venda")` antes dessa data).
- Se caixa fechado no server mas localStorage diz aberto (raro — requereria fechamento externo direto no DB), a reconciliação NÃO fecha localmente. Operador verá caixa "aberto" que já foi fechado. Solução futura: verificar `status=FECHADA` do `sessaoId` local.

**Validação:** `npx tsc --noEmit` → 0 erros. `npm run build` → OK.

---

### PDV → Financeiro + Estoque — consolidação do fluxo de venda (concluído 21/05/2026)

**Problema:** o PDV finalizava a venda, decrementava estoque em memória (localStorage) e persistia `Venda` + `ItemVenda` no banco, mas:
- `Produto.stock` nunca era decrementado no banco;
- Nenhum `MovimentacaoEstoque` era criado para rastreabilidade;
- Nenhuma `MovimentacaoFinanceira` era lançada (receita PDV invisível no DRE/fluxo).

**Solução (cirúrgica — apenas 2 arquivos):**

| Arquivo | Mudança |
|---|---|
| `lib/ops-upsert-venda.ts` | `SalePayload` ganha `paymentBreakdown?: Partial<PaymentBreakdownFull>`. `upsertVendaInTransaction` ganha parâmetro `operadorLabel?` e, dentro da mesma transação, executa: (3) `MovimentacaoEstoque` por linha real com idempotência via `documento=pedidoId + produtoId + origem:"pdv"`; (4) `MovimentacaoFinanceira(entrada, "venda")` pelo valor imediato (total − aPrazo) com idempotência via `referenciaId=pedidoId + origem:"venda"`. |
| `app/api/ops/venda-persist/route.ts` | Resolve `operadorLabel` da sessão NextAuth e propaga ao `upsertVendaInTransaction`. |

**Comportamento completo de uma venda PDV (do confirm ao banco):**

1. `finalizeSaleTransaction` (client-side): valida caixa, decrementa estoque em memória, grava `SaleRecord` em localStorage, emite `venda_finalizada`, dispara `POST /api/ops/venda-persist` (fire-and-forget).
2. `venda-persist` → `upsertVendaInTransaction` (mesma transação Prisma):
   - Upsert `Venda` + recria `ItemVenda` (idempotente por `pedidoId`).
   - Para cada item físico: cria `MovimentacaoEstoque(tipo:"saida", origem:"pdv")` e decrementa `Produto.stock`.
   - Se `valorImediato > 0`: cria `MovimentacaoFinanceira(tipo:"entrada", origem:"venda")`.
3. Se aPrazo > 0: client chama `appendContaReceberTituloPdvAprazo` → `ContaReceberTitulo` no banco (fluxo pré-existente, não alterado).

**Idempotência (anti-dupla movimentação em retry):**
- `MovimentacaoEstoque`: `findFirst({ documento, produtoId, origem:"pdv" })` antes de criar.
- `MovimentacaoFinanceira`: `findFirst({ referenciaId, origem:"venda", tipo:"entrada" })` antes de criar.

**O que NÃO foi alterado:**
- `operations-store.tsx` (client-side), fluxo aPrazo, auth/proxy/schema.prisma.
- PDV Classic, Assistência e Supermercado — usam o mesmo `finalizeSaleTransaction` e `venda-persist`, ganham os efeitos automaticamente.
- PDV Black Edition — `handlePaymentConfirm` ainda não chama `venda-persist` (pendência pré-existente, não escopo desta sessão).

**Riscos remanescentes:**
- Histórico de vendas anteriores (245 no banco): `Produto.stock` está inflado em relação ao que foi vendido. Novas vendas serão decrementadas corretamente a partir desta sessão.
- Operações offline (venda no localStorage sem sync): `Produto.stock` e ledgers não são retroativamente corrigidos — depende de um reconciliador futuro.
- `creditoVale` não gera `MovimentacaoFinanceira` (é abatimento de saldo já existente, não receita nova).

**Validação:** `npx tsc --noEmit` → 0 erros. `npm run build` → OK.

---

### Operações HUB — Adapter OS → Estoque Fase 2 (concluído 21/05/2026)

**Antes:** o adapter `lib/operacoes/adapters/os-estoque.ts` já fazia consumo/restauração/delta real do estoque com transação, idempotência, anti-negativo e ledger profissional (`MovimentacaoEstoque` com `tipo:"saida"`, `origem:"os"`). Mas as movimentações geradas pela OS gravavam `usuario: null`, `documento: null`, `custoUnitario: 0` e `valorTotal: 0` — sem auditoria de quem baixou, sem vínculo humano com a OS e sem valor consumido para KPIs.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `lib/operacoes/adapters/os-estoque.ts` | `registrarLedgerOS` recebe `osNumero` e `operador` e grava: `usuario` (do session label), `documento` = número da OS (ex.: `OS-2026-00012`), `motivo` igual ao `documento`, `custoUnitario` = `arredonda2(max(0, precoCusto))` e `valorTotal` = `qtd × custoUnitario`. As três funções públicas (`consumeEstoqueFromOS`, `restoreEstoqueFromOS`, `applyEstoqueDelta`) ganham `operador?: string \| null`, leem `OrdemServico.numero` na mesma transação e repassam ao ledger. `tipo` e `origem` mantidos. |
| `app/actions/operacoes.ts` | `updateOSStatus` e `updateOSPayload` resolvem `getOperatorLabelFromSession(await auth())` uma vez e propagam para as 4 chamadas (1 consume + 2 restore + 1 delta). |

**Campos do `MovimentacaoEstoque` para `origem:"os"`:**

| Campo | Antes | Depois |
|---|---|---|
| `usuario` | `null` | operador NextAuth (`name` ou `email`) |
| `documento` | `null` | `OrdemServico.numero` (fallback `OS {osId}`) |
| `motivo` | `OS {osId}` (cuid) | mesmo do `documento` (número humano) |
| `custoUnitario` | `0` | `precoCusto` atual do produto |
| `valorTotal` | `0` | `qtd × custoUnitario` |

**Validação:** `npx tsc --noEmit` — 0 erros novos nos arquivos modificados. Os 4 erros pré-existentes em `components/omni-agent/OmniAgentHub.tsx` (linhas 732–744, `points`/`heatmap` undefined) eram causados pelas variáveis de gráfico sintético e foram **resolvidos na sessão de refatoração visual de 21/05/2026** (remoção dos `useMemo` com `Math.random()`).

**Comportamento preservado (NÃO alterado):**

- Idempotência (`payload.estoqueConsumido`, `estoqueUltimaRevisaoEm`).
- Validação anti-negativo prévia em transação.
- Best-effort: falhas registram `estoque_sync_erro` na timeline, não quebram a OS.
- `tipo:"saida"` + `origem:"os"` mantidos como par diferenciador (PDV usa `origem:"pdv"`).

**Riscos remanescentes / pendências:**

- Operador pode vir `null` em transições disparadas fora de sessão NextAuth (job interno) — schema aceita; relatórios precisarão tratar.
- Produtos com `precoCusto = 0` (legados GestaoClick) continuarão gerando `valorTotal = 0` até cadastro de custo — não é regressão.
- Movimentos históricos pré-21/05/2026 continuam com campos `null/0` — só novas baixas/restaurações são preenchidas. Backfill opcional fica como próximo passo.
- `registrarLedgerOS` continua silencioso em falha (`console.error`) — endurecer com evento `estoque_ledger_erro` fica para fase futura.

**Próximos passos sugeridos:** F2.4 — evento `estoque_item_ignorado` visível na timeline; F2.5 — defesa em profundidade na idempotência via consulta ao ledger; F2.6 — KPI "valor consumido por OS" agora que `valorTotal` é confiável.

---

### Omni Agent HUB — Refinamento Visual Premium (concluído 21/05/2026)

**Contexto:** backend, Prisma, server actions, automações e lógica de comandos mantidos intactos. Sessão exclusivamente de visual/UX.

**Problema principal:** gráfico SVG "Comandos por hora" e "Mapa de calor (semana)" usavam `Math.random()` em `useMemo` — dados 100% sintéticos apresentados como tendências reais. Quatro erros TypeScript (`points`/`heatmap` undefined) eram consequência direta dessas variáveis.

**Arquivos alterados:**

| Arquivo | Tipo |
|---|---|
| `components/omni-agent/OmniAgentHub.tsx` | Múltiplas edições cirúrgicas (visual/UX) |
| `components/omni-agent/OmniAgentInboxReal.tsx` | Reescrita completa visual (lógica inalterada) |

**Mudanças em `OmniAgentHub.tsx`:**

- **Dados sintéticos removidos:** `useMemo` com `Math.random()` para `hours`, `points` e `heatmap` eliminados
- **Gráfico fake → distribuição real:** card "Comandos por hora" substituído por barras de distribuição por status usando `stats.executed`, `stats.pending`, `stats.awaitingConfirmation`, `stats.error` (dados Prisma reais) com skeleton loading
- **Heatmap aleatório → resumo honesto:** 4 métricas reais (hoje, total histórico, taxa de acerto, pendentes) com skeleton por célula
- **Stat component:** prop `loading` com skeleton animado; prop `accent` para cor semântica por tipo de métrica
- **Header:** ícone `Bot` → `Cpu`; status badge com cor semântica (verde/cinza); notificações com lista scrollável e link "Ver Inbox"; botões `sm:inline-flex`
- **Tabs:** labels `hidden sm:inline`; badges de pendência com formato compacto
- **Feed rows:** borda esquerda `border-l-2` colorida por `badgeKind` (`emerald`/`amber`/`blue`/`destructive`)
- **Último comando:** card com borda colorida e badge de status contextual
- **AutomationsTab:** borda esquerda `emerald` (ativa) / `border` (inativa); badge Ativa/Inativa; template em bloco `bg-muted/50 font-mono`; skeleton de loading; empty state com ícone `Zap`
- **MemoryTab:** avatar de iniciais (2 letras, `rounded-full`) na lista; skeleton de 5 itens; empty state com ícone `Users`
- **ReportsTab:** stat grid com `loading` prop e cores semânticas; barras `rounded-full` com `transition-all duration-500`; cards financeiros com cores por tipo (receita=verde, despesa=vermelho, pend.=âmbar); skeleton do financeiro em vez de texto simples
- **SettingsTab:** audit log com ponto `bg-primary/40` por linha, monospace, hover sutil, container `bg-muted/30`
- **Floating button:** pill com `ring-2`; cor semântica online/pausado; label dinâmico ("X pendentes" / "Online" / "Pausado"); mini-dashboard expandido polido

**Mudanças em `OmniAgentInboxReal.tsx`:**

- **Skeleton loading:** 3 cards animados com avatar, texto e badges
- **Filtros pill:** barra no estilo das Tabs principais; contadores por status integrados ao label
- **Borda esquerda colorida por status:** `amber`=pendente · `blue`=aguardando · `emerald`=executado · `destructive`=erro
- **Ícone semântico por card:** `Clock` (pendente) · `AlertTriangle` (aguardando) · `CheckCircle2` (executado) · `XCircle` (erro)
- **Botão "Executar":** spinner `Loader2` durante processamento; "Recusar" com hover `text-destructive`
- **Confirmação de cliente ambíguo:** container `bg-blue-500/5 border-blue-500/20`
- **Campos interpretados:** label `uppercase tracking-wider`; `sm:grid-cols-2`
- **Resultado:** container `bg-card` com label uppercase
- **Empty state:** ícone `Inbox` centralizado com subtexto orientativo

**Validação:** `npx tsc --noEmit` → **0 erros** (os 4 erros pré-existentes de `points`/`heatmap` foram eliminados junto com as variáveis).

**O que NÃO foi alterado:**
- Prisma, server actions, automações, event bus
- WhatsApp backend, auth, proxy
- Lógica de interpretação de comandos, tipos, APIs
- Mocks de "sugestões" no OverviewTab (cards de ação UI, não dados)
- WhatsAppTab, CommandsTab, NewCommandModal, CommandPalette (sem mudanças visuais além das passadas pelo Stat refatorado)

**Pontos que ainda dependem do backend para evolução futura:**
- Gráfico de comandos por hora: exigiria `OmniAgentHubStatsDTO` com breakdown `por hora`
- Memória operacional / timeline unificada do cliente: fase 3
- Créditos IA / plano no SettingsTab: localStorage local, sem backend

---

### Cadastros HUB > Importação — HUB reestruturado (concluído 21/05/2026)

**Antes:** aba "Importação" do `CadastrosHub` rodava um `ImportFlow` mock (drag&drop fake, mapeamento de colunas fictício, contagens de erro hardcoded) + um modal `Importar planilha` que abria o mesmo mock. O `ImportadorAvancado` real existia mas só era acessível por `Configurações > Importação`. XML NF-e tinha apenas protótipo isolado em `components/dashboard/estoque/gestao-produtos.tsx`. Não havia histórico/auditoria consolidado de lotes de import.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `components/cadastros/lovable/components/cadastros/ImportacaoHub.tsx` (NOVO) | HUB 3-blocos: (1) **Planilhas** monta `<ImportadorAvancado />` real dentro de `<AppOpsProviders>`; (2) **XML NF-e** com `DOMParser` cliente lendo `det/prod/xProd/cProd/NCM/CFOP/vUnCom/qCom` — preview de cabeçalho + tabela de itens, banner "Parser experimental — preview apenas, não persiste no banco", botão "Confirmar entrada" desabilitado; (3) **Histórico** consome `listImportacoesAuditoria` com empty state honesto. Header com 3 KPIs clicáveis (Lotes / Última / Registros consolidados) derivados dos logs reais. |
| `components/cadastros/lovable/components/cadastros/CadastrosHub.tsx` | Removidos `ImportFlow` mock e modal `Importar planilha`. Botão "Importar" do header navega para `tab=importacao`. `ImportacaoPanel` agora delega ao `<ImportacaoHub />`. |
| `app/actions/cadastros.ts` | Nova Server Action `listImportacoesAuditoria(limit)` lê `LogsAuditoria` com `action startsWith "import."`. Tipo amigável (Planilhas / XML NF-e / Outro), totais, batchId, duração, porDominio, status (ok/erro). Sem schema novo — usa o modelo existente. |
| `app/api/import/advanced/route.ts` | Best-effort `prisma.logsAuditoria.create` ao final de cada batch: `action: "import.planilha"` (ou `.erro`), `source: "importador_avancado"`, `metadata` JSON com `batchId`, `storeId`, `duracaoMs`, `totais`, `porDominio`, `arquivos`. `requireSubscription` agora devolve `userLabel` para logar quem importou. |

**Status real vs placeholder:**

| Bloco | Status |
|---|---|
| Planilhas (CSV/XLSX/ZIP GestaoClick) | ✅ Real — reaproveita `ImportadorAvancado` intacto |
| Histórico de lotes (data, usuário, totais, duração, batchId, porDominio) | ✅ Real — gravação a partir desta sessão; lotes pré-21/05/2026 não aparecem |
| KPIs do header (Lotes / Última / Registros) | ✅ Real — calculados sobre `LogsAuditoria` |
| XML NF-e — preview cliente (cabeçalho + itens) | ✅ Real (preview-only) |
| XML NF-e — gravação de estoque/fornecedor/preço | ⚠️ Placeholder honesto: banner explícito, botão desabilitado, card "Planejado" / "Fora deste fluxo" |

**Validação:** `npx tsc --noEmit` EXIT 0 · `npm run build` Compiled successfully in 35.2s.

**Pendências:**
- Backend fiscal definitivo (entrada estoque por NF-e, vínculo fornecedor por CNPJ, atualização preço custo + NCM/CFOP, lançamento financeiro automático, integração SEFAZ) — fora de escopo desta sessão.
- Lotes importados antes de 21/05/2026 não constam no Histórico (o gancho de auditoria foi adicionado nesta sessão).

---

### Financeiro HUB V2 — aba "A Pagar" plugada em dados reais (concluído 20/05/2026)

**Antes:** `/api/financeiro/pagar` retornava `rows[]` apenas com `id, descricao, fornecedor, valor, vencimento, status`. `fornecedorFromPayload` fazia fallback para a string `"Fornecedor"` (mock falso). `normalizePagarRows` ignorava `descricao` e `parcela`; UI mostrava `id` cru ("imp-gc:loja-1:cp:funcionario:…").

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `app/api/financeiro/pagar/route.ts` | Helper `pickStringFromPayload`/`parcelaLabelFromPayload`. `rows[]` (e detalhe via `?localKey=`) agora inclui `categoria` (payload.planoContas), `formaPagamento`, `contaBancaria`, `observacao`, `parcela: "N/M"`. `fornecedorFromPayload` deixou de retornar "Fornecedor" como fallback — devolve string vazia, UI decide o "—". |
| `components/financeiro/lovable/context/FinanceiroRealContext.tsx` | Tipo `ContaPagar` ganha `descricao`, `categoria`, `parcela`, `formaPagamento`, `contaBancaria`, `observacao`. `normalizePagarRows` propaga todos os campos sem fallback enganoso (vazio fica vazio). |
| `components/financeiro/lovable/routes/financeiro.tsx` | Aba "A Pagar": coluna `Doc.` → `Título` exibindo `descricao` (truncate + tooltip), novas colunas `Categoria` e `Parcela`, sub-texto "saldo R$ X" em Pago quando parcial, empty state honesto (mensagem diferente para "sem dados na loja" vs "filtro vazio"), vencimento "—" quando vazio. `handleDuplicar` agora propaga `descricao` e `categoria`. |

**Validação (5 exemplos reais):**

- **ALUGUEL IMOVEL** — vencido · R$ 1.950,00 · venc 10/04/2026 · categoria Aluguel · fornecedor "—" (vazio na planilha)
- **FUNCIONARIO** — 4 parcelas: 1/4 R$ 600 (vencido, 07/04, 13º salário) · 2/4 R$ 400 (pendente, 20/04, VALE) · 3/4 e 4/4 R$ 600 (pendentes, 07/05, PAGAMENTO)
- **WORD CELL PRIME** — 3 parcelas pagas (R$ 110 + R$ 195,25 + R$ 215), fornecedor "WORD CELL PRIME", categoria Compras
- **PLANETA CELULARES** — 2 parcelas pagas via PIX (R$ 310 + R$ 138), fornecedor "PLANETA CELULARES", categoria Compras
- **Fechamento de caixa** — 22 registros preservados (RAFAEL FARIA DE LIMA / Ajuste de caixa)

**Summary (KPIs aba A Pagar):**

| Estado | Qtd | Valor |
|---|---|---|
| Pago | 31 | R$ 10.984,17 |
| Vencido | 4 | R$ 2.804,05 |
| Pendente | 3 | R$ 1.600,00 |
| **Total** | **38** | **R$ 15.388,22** ✓ |

Bate exatamente com a expectativa indicada pelo usuário (~R$ 15.388,22).

**Limitações restantes da aba A Pagar:**

- KPIs específicos da aba A Pagar (cards no topo da aba) ainda não foram adicionados — Visão Geral já tem `StatCard "A pagar"` consumindo `summaryP.totalAberto`. Adicionar bloco de KPIs dentro de `ContasPagar()` seria escopo de UX, não foi pedido.
- `HistoricoPagarModal` busca `payload.historico` via `?localKey=` (já retorna corretamente o pagamento gravado pelo importador), mas renderização do histórico continua simples.
- Modais (`PagarContaModal`, `EstornoPagarModal`) usam `conta.id` (localKey) no título — visualmente longo mas funcional.
- Forma de pagamento e Conta bancária estão no contexto/modelo mas não foram expostas como colunas visíveis na tabela (decisão de manter visual atual de 7 colunas).

---

### Financeiro HUB V2 — aba "A Receber" plugada em dados reais (concluído 20/05/2026)

**Antes:** o `FinanceiroRealContext` já consumia `/api/financeiro/receber` mas perdia informação no caminho: `parcela` hardcoded `"1/1"`, `descricao` não chegava ao tipo `ContaReceber`, coluna "Título" da tabela mostrava o `localKey` cru (ex.: `imp-gc:loja-1:cr:venda-de-no-131:cleiton-…:2026-02-21:20000:1`).

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `app/api/financeiro/receber/route.ts` | `rows[]` agora inclui `descricao` (já existia) e `parcela` (extraída de `payload.parcela.{numero,total}` → `"N/M"`). Mantém compatibilidade com clientes antigos do endpoint (campos novos, nenhum removido). |
| `components/financeiro/lovable/context/FinanceiroRealContext.tsx` | Tipo `ContaReceber` ganha `descricao: string`. `normalizeReceberRows` usa `parcela` real do endpoint (sem fallback `"1/1"`) e preserva `descricao` para a UI. |
| `components/financeiro/lovable/routes/financeiro.tsx` | Coluna "Título" da tabela "A Receber" mostra `descricao` (ex.: "Venda de nº 131 (1/5)") com fallback monoespaçado para `id` quando descrição vazia. Coluna "Recebido" agora exibe sub-texto "saldo R$ X" quando há recebimento parcial. Vencimento exibe "—" se vazio. |

**Validação (Venda 131 / CLEITON):**

```
Título                    Cliente                    Parcela Venc.       Status    Valor       Recebido    Saldo
Venda de nº 131 (1/5)     CLEITON RICARDO SIQUEIRA   1/5     2026-02-21  pago      R$ 200,00   R$ 200,00   R$ 0,00
Venda de nº 131 (2/5)     CLEITON RICARDO SIQUEIRA   2/5     2026-03-23  pago      R$ 272,50   R$ 272,50   R$ 0,00
Venda de nº 131 (3/5)     CLEITON RICARDO SIQUEIRA   3/5     2026-04-22  pendente  R$ 272,50   R$ 0,00     R$ 272,50
Venda de nº 131 (4/5)     CLEITON RICARDO SIQUEIRA   4/5     2026-05-22  pendente  R$ 272,50   R$ 0,00     R$ 272,50
Venda de nº 131 (5/5)     CLEITON RICARDO SIQUEIRA   5/5     2026-06-21  pendente  R$ 272,50   R$ 0,00     R$ 272,50
```

KPIs reais já em funcionamento desde antes desta sessão (`fluxoCaixa`, `summaryR`, `summaryP` consumidos pelos `StatCard` da Visão Geral e da aba Fluxo) — apenas refletem agora os 307 títulos preservados pelo importador.

**Limitações restantes do Financeiro HUB V2:**

- HistoricoModal já chama `/api/financeiro/receber?localKey=...` que retorna `payload.historico` — entrada `tipo: "pagamento"` gravada pelo importador (Confirmado) aparece ali, mas o modal renderiza só genéricos; refinamento de UI do histórico ainda não foi feito.
- Renegociação (`RenegociarModal`) continua placeholder ("em preparação") — sem backend.
- "Recibo" é gerado client-side a partir do `id` do título — usa `localKey` cru.
- Aba **A Pagar** segue o mesmo fluxo `FinanceiroRealContext`/`normalizePagarRows`, mas `parcela` ainda não foi exposta (importador já grava `payload.parcela` para pagar — plug é simétrico, só não aplicado nesta sessão por escopo).
- Carteiras, DRE, Conciliação, Fechamento, Relatórios continuam reais via seus próprios endpoints — não tocados.

---

### Importador GestaoClick — contas_receber/pagar com parcelas (concluído 20/05/2026)

**Bug original:** Vendas parceladas chegavam ao Financeiro HUB com apenas 1 parcela. Ex.: Venda nº 131 / CLEITON RICARDO SIQUEIRA tinha 5 parcelas na planilha mas o banco guardava só 1 (a última, R$ 272,50 não pago).

**Causa raiz (4 problemas independentes):**

1. **`localKey` colidia** — `chaveJoin` de contas_receber apontava para `financeiro.descricao`. Como todas as 5 parcelas têm a mesma descrição ("Venda de nº 131"), `localKey = imp-${storeId}-${chave}` era idêntica, e `upsertContaReceber` sobrescrevia cada parcela na mesma row.
2. **Valor sempre = 0** — colunas reais do GestaoClick são `Plano de contas_3` / `Plano de contas_8` (pivot ofuscado), não mapeadas no dicionário.
3. **Vencimento sempre vazio** — coluna real é `Plano de contas_9`, também não mapeada.
4. **Status nunca casava** — `"Confirmado"` (294 linhas) e `"Não Pago"` (6 linhas) não estavam em `RECEBER_ALIASES`; quase tudo caía em `pendente` por fallback.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `lib/importador-avancado/merger.ts` | Novo helper `extrairPerfilGestaoClick` reconhece o pivot `Plano de contas_1..9` e mapeia entidade/valor/vencimento. Novo `mapearStatusReceberCanon`: `Confirmado→pago`, `Não Pago→pendente`, `Atrasado→vencido`, etc. `extrairCamposContaReceber`/`Pagar` retornam status canônico + `valorPago` + `dataConfirmacao` + `statusOriginal`. Prioriza `_raw` para descrições (evita `normalizarLinha` converter "Venda de nº 131" → `131`). |
| `lib/importador-avancado/persistidor.ts` | `persistirContasReceber`/`Pagar` agora: (a) pré-extrai todos os registros e numera parcelas N/M via `indexarParcelas` (agrupa por descrição+entidade, ordena por vencimento); (b) gera `localKey` única por parcela: `imp-gc:{storeId}:cr:{slugDesc}:{slugCli}:{venc}:{valorCents}:{n}`; (c) registra histórico de pagamento quando `status=pago`; (d) usa `replacePayload: true` para idempotência em re-importação. |

**Resultado pós-fix (re-import da planilha real, 307 linhas):**

- Venda 131 / CLEITON: **5 parcelas** corretas (1/5 R$ 200 pago, 2/5 R$ 272,50 pago, 3/5–5/5 R$ 272,50 pendente)
- Outras vendas parceladas: 14 grupos com ≥2 parcelas preservados
- Distribuição: 294 pago (R$ 17.989,41) · 7 vencido (R$ 2.124,99) · 6 pendente (R$ 1.522,49)
- Re-importação idempotente: mesma `localKey` → upsert no mesmo título, sem duplicar histórico

**Script auxiliar:** `scripts/reimport-contas-receber.ts` — re-roda o pipeline completo via CLI (`npx tsx scripts/reimport-contas-receber.ts <xlsx>`); limpa títulos com prefixos `imp-loja-1-` (legado) e `imp-gc:{storeId}:cr/cp:` antes de re-importar.

---

### Cadastros HUB — UX Clientes + Vínculo Venda→Cliente (concluído 19/05/2026)

#### UX Clientes (Fase 4)

**Arquivo principal:** `components/cadastros/lovable/components/cadastros/CadastrosHub.tsx`

- **Modal PF/PJ:** Select de tipo controlado; ao mudar PF↔PJ o campo de documento é limpo e a label/placeholder mudam dinamicamente (`CPF 000.000.000-00` / `CNPJ 00.000.000/0000-00`); máscara aplicada em tempo real
- **Botões da tabela:** Eye/Wrench/ShoppingCart desabilitados com `opacity-40 cursor-not-allowed` e tooltip "em breve"; Editar funciona; WhatsApp abre `wa.me` se cliente tiver telefone, desabilitado se não tiver
- **Total gasto real:** calcula em tempo real via aggregate Prisma (OS + Venda por clienteId); fallback para `Cliente.totalSpent` se DB falhar

#### Vínculo Venda → Cliente (FK real no banco)

**Schema alterado:**

| Model | Mudança |
|---|---|
| `Venda` | + `clienteId String?` + `cliente Cliente? @relation(onDelete: SetNull)` + `@@index([clienteId])` |
| `Cliente` | + `vendas Venda[]` |

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `lib/operations-sale-types.ts` | `SaleRecord` + `clienteId?: string` |
| `lib/ops-upsert-venda.ts` | `SalePayload` + `clienteId`; upsert persiste no banco |
| `lib/operations-store.tsx` | `finalizeSaleTransaction` aceita + propaga `clienteId` |
| `venda-completa-enterprise.tsx` | passa `clienteId: selectedCliente.id` |
| `pdv-venda-completa-enterprise.tsx` | passa `clienteId: selectedCliente?.id` |
| `pdv-assistencia-enterprise.tsx` | passa `clienteId: selectedClienteId ?? undefined` |
| `pdv-classic.tsx` | passa `clienteId: selectedCustomer?.id` |

**Regra de totalGasto:**
```
totalGasto = SUM(OS.valorTotal WHERE status IN [Pronto, Entregue] AND clienteId = c.id)
           + SUM(Venda.total WHERE status = "concluida" AND clienteId = c.id)
```

**Backfill:** `run-backfill-venda-cliente.mjs` (match por doc/telefone normalizado, nunca por nome).
- 245 vendas GestaoClick não têm `payload.enterprise` → ficam `clienteId = null`
- Futuras vendas PDV Enterprise são vinculadas em tempo real

**`pdv-supermercado.tsx`** e consumidor final: `clienteId = null`, comportamento inalterado.

---

### Governança IA — sincronização canonical (concluído 19/05/2026)

- **`CLAUDE.md`** atualizado com bloco de governança obrigatória no topo (ler antes de qualquer tarefa)
- **`.cursor/rules/omnigestao.mdc`** criado — regras carregadas automaticamente pelo Cursor em toda sessão (`alwaysApply: true`)
- **`docs/skills/`** criado com estrutura canônica:
  - `INDEX.md` — índice de governança
  - `rules/CORE_RULES.md` — regras globais
  - `rules/DELIVERY_CHECKLIST.md` — checklist de encerramento
  - `rules/AI_WORKFLOW.md` — papéis Sonnet vs Opus, contexto, GitHub
  - `rules/FRONTEND_IMPORT_RULES.md` — regras de importação de UI externa

---

### Cadastros HUB — Fase 1+2+3 (concluído 19/05/2026)

**Arquivo:** `components/cadastros/lovable/components/cadastros/CadastrosHub.tsx`

- **Fase 1 (busca clientes):** state `filterQuery` controlado, `visibleRows` com filtro nome/telefone/documento/cidade, contador atualizado, busca funciona desde o 1º caractere
- **Fase 2 (visual inputs):** campo de pesquisa da Toolbar trocado de `bg-card` para `bg-background` — texto visível em todos os temas
- **Fase 3 (performance):** separados `refreshRows` (rápido, bloqueia só tabela) e `refreshAlerts` (lento, silencioso) — busca responsiva imediatamente, alertas carregam em paralelo sem travar a lista

---

### PDV Next / Black Edition — 4º PDV (concluído 19/05/2026)

**Rota:** `/dashboard/pdv-next`
**Galeria:** `Configurações > PDV` → 4 cards na grade "Fluxos principais"

#### Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `components/pdv-next/PdvBlackShell.tsx` | Shell visual Black Edition isolado — sempre preto, sem dependência de `useStudioTheme`. Header operacional: loja, caixa aberto/fechado, operador, cupom, relógio, status online. Tabela de itens, sidebar (total emerald, cliente, NF-e), barra F1–F9 |
| `components/pdv-next/PdvBlackEdition.tsx` | Controller: carrinho, catálogo real (`mergePdvCatalogWithInventory`), busca de clientes real (`useClienteSearch`), caixa (`useCaixa`), atalhos globais F1–F9, `PaymentModal` |
| `app/dashboard/pdv-next/page.tsx` | Rota Next.js com Suspense |

#### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `app/dashboard/layout.tsx` | `isVendas` inclui `/dashboard/pdv-next` (noPadding + flex-1) |
| `components/configuracoes-v3/features/settings/sections/PdvSection.tsx` | 4º card com preview black/emerald, badge Beta, link direto para `/dashboard/pdv-next` |

#### Status real vs mock

| Funcionalidade | Status |
|----------------|--------|
| Produtos do inventário (ao vivo) | ✅ Real |
| Busca de clientes (F2) via API | ✅ Real |
| Status caixa aberto/fechado | ✅ Real |
| Nome da loja e operador | ✅ Real |
| Atalhos F1–F9 (teclado global) | ✅ Real |
| Bipe/scan de produto (Enter) | ✅ Real |
| CaixaStatusBar (abertura/fechamento) | ✅ Real |
| Pagamento (PaymentModal) | ⚠️ Mock — abre o modal, limpa carrinho, **não persiste venda no banco** |
| Documento fiscal (NF-e) | ⚠️ Mock — placeholder "NF-e — mock" |

#### PDVs preservados (sem alteração)

| PDV | Rota | Status |
|-----|------|--------|
| PDV Clássico/Omni | `/dashboard/vendas` | ✅ Intocado |
| PDV Assistência | `/dashboard/vendas` (services layout) | ✅ Intocado |
| PDV Supermercado | `/dashboard/vendas` (supermercado layout) | ✅ Intocado |
| **PDV Next / Black Edition** | `/dashboard/pdv-next` | ✅ **Novo — isolado** |

---

### Importador Avançado — GestaoClick (concluído 17/05/2026)

**Commit 1** — `lib/importador-avancado/` (6 arquivos):
- `types.ts`, `detector.ts`, `merger.ts`, `parser.ts`, `persistidor.ts`, `index.ts`

**Commit 2** — `app/api/import/advanced/route.ts`:
- `GET /api/import/advanced` → capabilities (formatos, domínios, limites)
- `POST /api/import/advanced?modo=preview` → planilhasDetectadas, grupos, confiança
- `POST /api/import/advanced?modo=importar` → { batchId, totais, porDominio, errosDetalhados, duracaoMs }
- Auth via NextAuth v5 + fallback cookie legado
- Suporte a ZIP do GestaoClick (adm-zip + jszip instalados)

**Commit 3** — UI do Importador Avançado:
- `components/dashboard/configuracoes/importador-avancado/hooks/use-importador-avancado.ts` — engine completa (upload, preview, import, estado em máquina de fases)
- `UploadZone.tsx` — drag & drop multi-arquivo, aceita ZIP
- `PreviewCruzamento.tsx` — lista planilhas com barra de confiança, amostra colapsável, botão Importar tudo
- `LogAuditoria.tsx` — resultado pós-import agrupado por domínio, batchId copiável, erros detalhados
- `ImportadorAvancado.tsx` — orquestrador (UploadZone → PreviewCruzamento → BarraProgresso → LogAuditoria)

**Integração:**
- `components/configuracoes-v3/features/settings/sections/ImportacaoSection.tsx` substituído por switcher de 2 cards (padrão PdvSection):
  - "Importação Universal" → `<ImportadorDadosExternos />` (legado, default)
  - "Importação Avançada" → `<ImportadorAvancado />`
  - Modo persistido em `localStorage["@omnigestao:importacao-modo"]`

**Dependências instaladas:**
- `adm-zip@^0.5.17`, `jszip@^3.10.1` (runtime — ZIP do GestaoClick)
- `@types/adm-zip` (devDependencies)

**Resultado de importação real (ZIP GestaoClick, 17/05/2026):**
- 17/17 arquivos detectados com domínio correto e confiança ≥70%
- Log do import reportou: ~555 criados / 2 atualizados / 13 ignorados / 0 erros (~53s) — *não reconferido nesta sessão*
- Estado do banco verificado após o import: Clientes 40 ✅ | Fornecedores 15 (tabela própria) ✅ | Produtos 231 ✅ | OS 34 ✅ | Vendas 245 ✅
- servicos_catalogo: ignorado (modelo próprio pendente)
- contas_pagar/receber: detectadas mas não persistidas (Fix futuro)

---

### Fixes aplicados (detector, parser, persistidor, hydration)

| Fix | Arquivo | O que fez |
|---|---|---|
| Fix 1 | deps | `npm install adm-zip jszip` |
| Fix 2 | `detector.ts` | Dicionário calibrado com headers reais GestaoClick (`"n da os"→os.numero`, `"nome"→cliente.nome`, etc.) |
| Fix 3 | `parser.ts` | Removido branch ExcelJS (não instalado → derrubava compilação da rota) |
| Fix 4 | `detector.ts` | `"n do pedido"→venda.numero`; reordenação de assinaturas (sub-domínios de vendas e `fornecedores_enderecos` antes dos genéricos); `clientes` passa a exigir `tipoPessoa` |
| Fix 5 | — | Não houve um Fix 5 isolado nesta sessão — o ajuste de `clientes_enderecos` foi incorporado ao Fix 6 |
| Fix 6 | `detector.ts` | `nomeNorm.includes(norm(n))` — normaliza entradas de `nomesArquivo` antes de comparar (underscore virava espaço e nunca casava); `clientes_enderecos.nomesArquivo` restrito |
| Fix 7 | `persistidor.ts` | Clientes: grava `document`, `kind`, `city`, `active`; Produtos: grava `barcode`, `brand`, SKU sintético anti-colisão; OS: match 4 camadas (doc→mapa→doc banco→nome banco) |
| Fix 8 | `use-importador-avancado.ts` | Hook lê `planilhasDetectadas` do response (backend) e preenche também `planilhas` (compatibilidade componentes) |
| Fix 9 | `route.ts` | Lê `modo` do query string (`?modo=importar`) e não só do FormData — era a causa de NUNCA persistir |
| Fix 10 | `persistidor.ts` | Fornecedores persistem na tabela `Fornecedor` (não mais em `Cliente`); `servicos_catalogo` marcado como ignorado; OS ganha 5ª camada de match (contains da 1ª palavra) |
| Fix 11 | `app/api/ops/ordens/route.ts` | GET usa `hydrateOSRows` com `include: { cliente, garantiasOperacionais }` em vez de devolver `r.payload` cru |
| Fix 12 | `app/actions/ordens.ts` | `findMany` inclui `cliente`; `DbOrdemRow` tipado com `cliente?`; `mapRows` propaga `{ id, nome }` |
| Fix 13 | `lib/operacoes/services/hydration-service.ts` | `PrismaOSRow` aceita `cliente?` (nome opcional); `applyPrismaEnrichment` propaga nome real do cliente (FK) quando payload tem `"—"` |

---

### Operações HUB — dados reais via Prisma (concluído 17/05/2026)

- **Kanban** mostra nome do cliente, defeito e valor nos cards ✅
- **Detalhe da OS** mostra `CLIENTE: LARISSA SOARES` (FK real) ✅
- **Histórico de clientes** vincula OS corretamente ✅
- Pipeline de status funcional (Aberto → Diagnóstico → Aprovado → etc.)
- `osStore` → `osApi.listOrdens` → Server Action `listOrdens` → `hydrateOSRows` → Kanban

**Arquivos principais da cadeia:**
```
components/operacoes/lovable/store/osStore.tsx
components/operacoes/lovable/api/os.ts  → listOrdens → listOrdensPrisma
app/actions/ordens.ts                   → findMany + include cliente + hydrateOSRows
lib/operacoes/services/hydration-service.ts  → applyPrismaEnrichment (propaga cliente real)
components/operacoes/lovable/components/operacoes/OSCard.tsx
```

---

### Hubs Visuais (mantidos da versão anterior)

- **WhatsApp HUB** — dados reais via Prisma, Meta Cloud API real, webhook HMAC, automações
- **PDV** — Assistência, Rápido, Completo; busca por SKU/EAN/nome; layout fixo sem scroll global
- **Cadastros HUB** — Clientes (UX completa: modal PF/PJ com máscara, botões corrigidos, totalGasto real OS+Venda), Produtos, Fornecedores com dados reais
- **Financeiro** — contas a pagar/receber com service Prisma (sem plug na UI visual ainda)

### Sistema de Temas
- 4 temas: Light, Soft Ice, Midnight, Black Edition
- Sincronização bidirecional Hub ↔ Global
- Tokens semânticos globais (bg-background, bg-card, text-foreground, etc.)

---

## 🔄 Em Andamento

| Item | Situação |
|---|---|
| **PDV Black Edition — persistência de vendas** | `PdvBlackEdition.tsx`: `handlePaymentConfirm` limpa carrinho localmente. Próximo passo: plugar `adicionarEntrada(useCaixa)` + criar venda no banco (Server Action `registrarVendaPDV`) |
| Equipamento no card Kanban | `os.equipamento` chega como string `"MOTOROLA MOTO EDGE 30"` — card exibe `—` na linha de marca/modelo. Fix pendente: `hydration-service` ler `payload.aparelho.{tipo,marca,modelo}` |
| servicos_catalogo (12 serviços) | Detectados mas ignorados — aguarda model `Servico` próprio no Prisma |
| contas_pagar / contas_receber — UI Financeiro V2 | **Persistência real OK** (importador GestaoClick com parcelas, fix 20/05/2026). Falta plugar o HUB V2 Lovable em `lib/financeiro/services/` — UI ainda mostra mocks |
| Fornecedores endereços | `fornecedores_enderecos.xlsx` (1 linha) importado mas sem modelo de endereço de fornecedor |
| Editar cliente/técnico na OS via UI | Botão "Vincular cliente" não existe ainda na tela de detalhe da OS |
| Relatórios de vendas a prazo | Vendas importadas existem no banco mas Relatórios HUB não as exibe ainda |

---

## 🔜 Próximos Passos (Backlog Priorizado)

### P0 — Crítico (bloqueia uso em produção)

- [ ] **Fix equipamento no card Kanban** — `hydration-service.ts`: ler `payload.aparelho.{tipo,marca,modelo}` quando `os.equipamento` é string plana
- [ ] **Vincular cliente na OS via UI** — botão inline na tela de detalhe para buscar e selecionar cliente
- [ ] **Atribuir técnico na OS via UI** — select de técnicos na tela de detalhe

### P1 — Importante

- [ ] **PDV Black Edition — persistir vendas** — `PdvBlackEdition.tsx`: plugar `adicionarEntrada` + Server Action `registrarVendaPDV`; rota `/dashboard/pdv-next` já existe, motor de carrinho já funciona
- [x] ~~**Persistir contas_pagar/contas_receber no importador**~~ — concluído 20/05/2026, com parcelamento idempotente e mapeamento GestaoClick
- [ ] **Persistir servicos_catalogo** — criar model `Servico` ou reutilizar `Produto` com `type="servico"`
- [ ] **Relatórios de vendas** — exibir vendas importadas (245 no banco) no Relatórios HUB
- [ ] **Vendas a prazo** — listar no módulo Financeiro HUB (contas a receber vinculadas)

### P2 — Qualidade

- [ ] **Label de domínio no PreviewCruzamento** — planilhas sem domínio mostrado (ex: `clientes_enderecos`, sub-domínios OS) ficam sem label no card
- [ ] **Dedup de clientes** — homônimos (SOLANGE × SOLANGE SOL COXINHA, MICHEL × MICHEL DOUGLAS) não são mesclados; match só por doc exato
- [ ] **Normalização de telefone** — `149981153484` vs `(14)99...` inconsistente na importação
- [ ] **Histórico de clientes** — exibir vendas além das OS (hoje só OS aparecem)

### P3 — Expansão

- [ ] Marketplace HUB
- [ ] Sistema de mídia para OS (upload de fotos/anexos)
- [ ] Marketing IA com dados reais
- [ ] Financeiro HUB — fechamento de caixa, conciliação

---

## ⚠️ Atenção ao Retomar

1. **Sempre rodar `npx tsc --noEmit`** antes de commitar — zero tolerância
2. **Sempre ler `docs/skills/rules/CORE_RULES.md`** antes de qualquer tarefa (governança obrigatória)
3. **PDV Black Edition** — pagamento **não persiste** no banco ainda. `handlePaymentConfirm` em `PdvBlackEdition.tsx` apenas limpa o carrinho localmente. NÃO apresente como real ao usuário final.
4. **Galeria PDV** — agora com 4 cards em `PdvSection.tsx` (grid `lg:grid-cols-4`). O 4º card usa `href` direto para `/dashboard/pdv-next`, não usa o mecanismo de `draftFlow`.
5. **Operações HUB usa dados REAIS via Prisma** (não mais mock) desde 17/05/2026
6. **Importador Avançado** — endpoint `POST /api/import/advanced` lê `modo` do **query string** (`?modo=preview` / `?modo=importar`), não do FormData
7. **GestaoClick ZIP** — todos os 17 arquivos detectam corretamente (Fix 6: `norm()` aplicado também nos `nomesArquivo`)
8. **Não tocar**: `auth.ts`, `proxy.ts`, `schema.prisma`
9. WhatsApp envio usa Meta Cloud API real (requer ENVs configuradas)
10. A rota `/dashboard/os` (legado) continua em paralelo ao `/dashboard/operacoes-v2`

---

## 📁 Arquivos-chave desta sessão

```
lib/importador-avancado/
├── types.ts
├── detector.ts          ← calibrado com headers reais GestaoClick
├── merger.ts
├── parser.ts            ← sem ExcelJS (Fix 3)
├── persistidor.ts       ← campos completos (Fix 7, 10)
└── index.ts

app/api/import/advanced/route.ts   ← lê modo do query string (Fix 9)
app/actions/ordens.ts              ← include cliente no findMany (Fix 12)
lib/operacoes/services/hydration-service.ts  ← propaga cliente FK (Fix 13)

components/dashboard/configuracoes/importador-avancado/
├── hooks/use-importador-avancado.ts   ← lê planilhasDetectadas (Fix 8)
├── UploadZone.tsx
├── PreviewCruzamento.tsx
├── LogAuditoria.tsx
└── ImportadorAvancado.tsx

components/configuracoes-v3/features/settings/sections/ImportacaoSection.tsx
```

---

## 📊 Estado do Banco (loja-1) após importação de 17/05/2026

| Modelo | Total | Observação |
|---|---|---|
| Cliente | 40 | Todos do `clientes.xlsx` GestaoClick |
| Produto | 231 | `produtos.xlsx` GestaoClick |
| OrdemServico | 34 | `ordens_servicos*.xlsx` GestaoClick |
| Venda | 245 | `vendas*.xlsx` GestaoClick |
| Fornecedor | 15 | `fornecedores.xlsx` (import 17/05) + eventuais legados — tabela `Fornecedor` não foi limpa antes do re-import |
| ContaReceberTitulo | 0 | Detectada, não persistida |
| ContaPagarTitulo | 0 | Detectada, não persistida |

> Contagens verificadas via Prisma em 17/05/2026 (`storeId: loja-1`).
