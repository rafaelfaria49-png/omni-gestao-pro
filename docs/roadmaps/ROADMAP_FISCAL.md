---
title: Roadmap Fiscal (NFC-e/SAT/NF-e) — OmniGestão Pro
hub: fiscal
status: vivo
owner: produto/arquitetura
last_update: 2026-07-22
sprint_atual: GOAL-009 arquitetural — ADR-0014/0015/0016 aceitas; zero implementação, provisionamento ou produção
---

# 🧾 Roadmap Fiscal — OmniGestão Pro

> **Nota de governança:** Fiscal é uma **frente transversal (satélite de PDV/Operações)**,
> não um dos 11 HUBs canônicos do `docs/roadmaps/INDEX.md §5`. Este roadmap segue a estrutura
> obrigatória de roadmap de HUB por consistência. Incluir Fiscal no índice §6 é follow-up
> recomendado (não feito nesta Fase 0 para manter escopo fechado).
>
> **Base factual:** `docs/audits/AUDITORIA_PRE_FISCAL_READINESS_v01.md`,
> `docs/audits/AUDITORIA_FISCAL_GAPS_v01.md`. **Governa:**
> `docs/governance/MASTER_FISCAL_EXECUTION_PLAN.md`.

## Atualização arquitetural — GOAL-009 (2026-07-22)

- **ADR-0014:** Supabase Vault é o backend KMS de produção, com envelope encryption, DEK distinta
  por segredo/versão, AAD e bucket privado exclusivo do Fiscal.
- **ADR-0015:** a primeira integração externa será direta com a SEFAZ, exclusivamente em
  homologação e atrás de `FiscalProvider`; gateway/PAA ficam como evolução possível.
- **ADR-0016:** o primeiro piloto fica restrito à Matriz RafaCell Assistec em Taguaí/SP,
  SEFAZ-SP, NFC-e modelo 65 e `tpAmb=2`, sempre pelo `Store.id` real.
- Estas decisões são **documentais**: não implementam provider/cofre, não provisionam recursos,
  não registram credenciais e não liberam produção nem qualquer outra loja.

## 0. Reconciliação vigente — 2026-07-16

> **Fonte factual:** [`FISCAL_RECONCILE_REPORT_001.md`](../fiscal/FISCAL_RECONCILE_REPORT_001.md) ·
> fechamento XSD [`FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md`](../fiscal/FISCAL_XSD_GOAL_002_CLOSURE_REPORT.md) ·
> prova C14N/XMLDSig [`FISCAL_XML_C14N_EXTERNAL_PROOF_003.md`](../fiscal/FISCAL_XML_C14N_EXTERNAL_PROOF_003.md) ·
> fechamento GOAL-003 [`FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md`](../fiscal/FISCAL_XML_C14N_GOAL_003_CLOSURE_REPORT.md) ·
> fechamento GOAL-004 [`FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md`](../fiscal/FISCAL_PRODUTO_UPSERT_PARITY_004_CLOSURE_REPORT.md).
> O commit `ba0cc12` colocou F2–F4 e o dry-run no código. O merge `82c219c` (PR #4) integrou o
> worker XSD B2. O merge `e52d16b` (PR #6) integrou a prova externa C14N/XMLDSig. O merge
> `b307337` (PR #8) integrou a paridade fiscal do `upsertProduto` (Cadastros V2).
> **Cadastro fiscal canônico ≠ regra tributária ≠ montagem de XML ≠ assinatura ≠ transmissão
> ≠ homologação ≠ produção.**

| Fase | Código/teste | Runtime/banco | Evidência externa | Estado reconciliado |
|---|---|---|---|---|
| F0 | plano e arquitetura existentes | n/a | não aplicável | governança reconciliada |
| F1 | ADR-0009 + EnvVault testado | sem caller; 0 certificados | nenhuma | N3 interno |
| F2 | tax-engine testado | sem caller | sem contador; sem ST | N3, lacuna CSOSN 500 |
| F3 | XML/chave + **XSD oficial B2** | worker XSD sob demanda; sem caller de venda | schema oficial versionado; **sem SEFAZ** | **N4 no eixo XSD**; G-C2 **fechado** |
| F4 | signer endurecido (RSA-SHA1) + C14N 1.0 **integrado** | **sem caller de venda** (dormente) | prova Java/JSR 105 + CI PR #6 + artefato | **N4 no eixo C14N/XMLDSig**; P-05 fechado |
| Cadastro produto | `metadata.fiscal` canônica em REST/importadores **e** Cadastros V2 | schema JSONB inalterado | testes N3 (PR #8) | **P-04 / GOAL-004 FECHADO**; N3 no eixo |
| F5 | contrato + stub | 0 notas; sem provider real | nenhuma SEFAZ | N1 |
| F6 | ausente | ausente | nenhuma | N0 |
| F7 | tabela da fila + guards | 0 jobs; sem produtor/worker | nenhuma | N1; ativação proibida |
| F8 | ausente | ausente | nenhuma | N0 |
| F9 | schema + stub | 0 eventos | nenhuma | N1 |
| F10 | ausente | ausente | nenhuma | N0 |
| F11 | ausente | zero evidência | nenhuma | N0; não homologado |
| F12 | ausente | zero evidência | nenhuma | N0; não produtivo |

**Gates:** G-C1 fechado (GOAL-001) · **G-C2 fechado** (XSD B2) · **critério C14N/XMLDSig do gate
técnico F4→F5 = FECHADO** (GOAL-003, PR #6) · gate Fiscal **global** F4→F5 e G-F5/G-F7/G-F12
**ainda abertos** (**não** avançados pelo GOAL-004). Não existe G-C3.

**GOAL-004** (`FISCAL-PRODUTO-UPSERT-PARITY-004`): **FECHADO** (implementação + merge PR #8 +
fechamento documental). Equivale ao GOAL histórico **002 / P-04** (não renumerar a tabela
histórica). `metadata.fiscal` = fonte canônica; `metadata.fiscalRegime` = visual não canônico.
Somente o GOAL 022 poderá construir ativação, restrita a `HOMOLOGACAO` e sujeita a G-F7.

**GOAL-005 reconciliado** (`FISCAL-GOAL-005-SCOPE-RECONCILIATION`, 16/07/2026): o slot nomeado 005 =
**`FISCAL-DRY-RUN-INTEGRITY-PROOF-005`** (“Prova de Integridade do Dry-Run Fiscal”), **definido
documentalmente**. Colisão “005” separada e preservada — XSD histórico **cumprido**
(GOAL nomeado 002); rótulo de código `GOAL_005` snapshot **dormente** (componente/pré-requisito);
Contador HUB competência = **trilho distinto** read-only. **Não renumerar histórico.** Nenhum gate
fechado; N6=0; N7=0. Fonte:
[`FISCAL_GOAL_005_SCOPE_RECONCILIATION.md`](../fiscal/FISCAL_GOAL_005_SCOPE_RECONCILIATION.md).

**GOAL-005A** (`FISCAL-XSD-WORKER-GITHUB-ACTIONS-SUPPLY-CHAIN-005A`, 19/07/2026): **integrado e
fechado na main** (PR **#12**, merge commit `2a7f102ce7bb22b363cd6d24b17920d483182640`, head
`d512794…`, branch de origem **preservada**). Bundle offline aprovado (run `29669361609`,
commit `c0d4b00…`), lock versionado em `workers/fiscal-xsd/supply-chain.lock.json`, supply chain
disponível, Trivy 0/0, runtime com egress bloqueado, testes XSD 7/7. **Nenhum gate Fiscal global
fechado.** **005B ainda não iniciado.** **GOAL-005 técnico permanece PARCIAL.** Próximo passo
exige definição e autorização **separadas** (não iniciar 005B automaticamente). Relatórios:
[`FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_REPORT.md`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_REPORT.md)
·
[`FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_POST_MERGE_CLOSURE.md`](../fiscal/FISCAL_XSD_WORKER_GHA_SUPPLY_CHAIN_005A_POST_MERGE_CLOSURE.md).

**GOAL-005B — escopo ratificado** (`FISCAL-DRY-RUN-INTEGRITY-PROOF-005B-SCOPE-RATIFICATION`,
20/07/2026): a definição e a autorização separadas exigidas acima foram **emitidas**. O GOAL técnico
futuro é **`FISCAL-DRY-RUN-INTEGRITY-PROOF-005B`** (“Integração do Worker XSD Real na Prova de
Integridade do Dry-Run Fiscal”), **DEFINIDO DOCUMENTALMENTE — NÃO INICIADO**. Decisão humana:
**Caminho 2** — o próprio 005B reaplica o harness de `d4dfcf1` (7 arquivos sob
`tools/fiscal-dry-run-integrity-proof/`, hoje **fora da main**), cria **workflow dedicado**
(`.github/workflows/fiscal-dry-run-integrity-proof.yml`) e integra o `xmllint` real. Auditoria de
origem `818253b…` reclassificada de **B** para **A**, condicionada à integração desta ratificação
(**Gate H1**). Compatibilidade com a `main` **comprovada**: os 10 contratos importados são
byte-idênticos; a única ligação falsa é o composition-gate em `run.ts:45`; nenhum schema, worker ou
Prisma precisa mudar. **Dependência do artifact:** bundle `8436826125` (run `29669361609`), consumo
**fail-closed**, com **expiração em 2026-07-26T01:59:00Z** — se expirar, o 005B para e exige um GOAL
**separado** de renovação do bundle 005A. Matriz do harness: **1 positivo + 8 negativos** (os 7 do
worker **+ XML malformado** — camadas distintas, o `7/7` do 005A permanece correto). Zero emissão,
zero persistência, zero SEFAZ. **Nenhum gate Fiscal fechado; N6=0; N7=0. GOAL-005 técnico permanece
PARCIAL.** **Próximo passo: auditoria de merge-readiness desta ratificação**; a implementação
técnica só começa após a integração na `main`. Fonte:
[`FISCAL_DRY_RUN_INTEGRITY_PROOF_005B_SCOPE_RATIFICATION.md`](../fiscal/FISCAL_DRY_RUN_INTEGRITY_PROOF_005B_SCOPE_RATIFICATION.md).

---

## 1. Visão

Emitir documentos fiscais (NFC-e primeiro; SAT/NF-e depois) de forma **provider-agnóstica,
multi-loja e satélite** — sem nunca travar o balcão — transformando cada venda do PDV em
documento fiscal válido na SEFAZ.

## 2. Objetivos

1. Emitir **NFC-e autorizada** (cStat 100) em homologação para a Matriz RafaCell Assistec,
   Taguaí/SP, exclusivamente via SEFAZ-SP, modelo 65 e `tpAmb=2`.
2. **Zero impacto** no tempo de fechamento da venda (emissão 100% assíncrona pós-commit).
3. **Multi-loja real**: identidade/certificado/série/CSC por loja, habilitação loja-a-loja.
4. **Segredo seguro**: certificado A1 e CSC nunca em claro nem no bundle do cliente.
5. Cobertura de eventos: cancelamento e inutilização dentro das regras da SEFAZ.

## 3. Concorrentes analisados

| Concorrente | Aprendizado de 1 linha |
|---|---|
| Bling / Tiny | Emissão via gateway próprio; UX "1 clique" esconde a fila assíncrona por trás. |
| Avantpro / Mercado Turbo (PDV) | NFC-e no PDV com contingência offline é requisito de balcão, não opcional. |
| Omie / ContaAzul | Forte em NF-e (serviço/produto) + integração contábil; fiscal acoplado ao financeiro. |
| Gateways (Focus/PlugNotas/eNotas/NFE.io) | Abstraem SEFAZ por UF; custo recorrente troca esforço de manutenção por OPEX. |

> Benchmark detalhado de PDV/Estoque em `docs/skills/executoras/research/SKILL_BENCHMARK_*`.

## 4. Diferenciais do OmniGestão

- **Satélite desacoplado**: fila `FiscalEmissaoJob` com lock/retry/dedupe — o PDV só enfileira.
- **Provider-agnóstico de fábrica**: trocar SEFAZ-direto ↔ gateway sem tocar o pipeline.
- **Primeira integração definida:** SEFAZ direta somente em homologação, com SOAP/UF encapsulados
  no adapter `FiscalProvider` (ADR-0015).
- **Snapshot congelado**: o documento usa a foto fiscal do instante da venda, não dado vivo.
- **Default-off + habilitação por loja**: adoção gradual sem risco para lojas não fiscais.

## 5. Gaps atuais (real, cruzado com auditoria)

**Código existente (não refazer do zero):** schema fiscal, identidade por loja, state machine,
produto fiscal, snapshot, provider abstrato, pipeline, numeração, tax-engine, XML, assinatura,
EnvVault e dry-run. Os guards da state machine têm seis callers reais; o restante do motor permanece
sem caller no fluxo de venda e o banco fiscal está vazio.

**Falta (o trabalho real):**
- P0: ~~paridade fiscal do `upsertProduto`~~ (**feito, GOAL-004 / PR #8, N3 cadastro**) ·
  ST/CSOSN 500 · ~~XSD oficial~~ (**feito, G-C2**) ·
  ~~C14N interoperável~~ (**feito no eixo técnico, GOAL-003**) · gate global de dry-run auferível.
- P1: provider/transmissão em homologação · QR-Code/CSC · estado incerto · fila · DANFCE · eventos ·
  contingência · observabilidade. Ativação somente no GOAL 022 e mediante gate.
- Doc: o ponteiro histórico `CURRENT_STATUS.md:2934` estava errado. O caminho real é
  `docs/ai/CURRENT_STATUS.md`, agora com seção fiscal consolidada; o texto "NF-e — mock" permanece
  apenas no contexto do preview PDV Next, não como estado fiscal global.

> Detalhe e severidade: `docs/audits/AUDITORIA_FISCAL_GAPS_v01.md`.

## 6. Funcionalidades futuras (priorizadas)

1. NFC-e Simples Nacional B2C (caminho mais curto ao "autorizado").
2. DANFCE com QR-Code.
3. Cancelamento + inutilização.
4. Contingência offline.
5. NF-e modelo 55 (B2B) e SAT (SP).
6. Integração contábil (exportação de XML/relatórios).
7. Painel de observabilidade fiscal (fila/falhas/cStat).

## 7. Backlog (granular, pronto para virar sprint)

- [x] ADR: contrato do cofre e piloto por env → **ADR-0009** (aceita).
- [x] ADR: backend KMS de produção → **ADR-0014** (Supabase Vault + Storage privado Fiscal,
  envelope encryption e DEK por segredo/versão; aceita).
- [x] `lib/fiscal/tax-engine/*`: motor Simples Nacional existente e testado (`ba0cc12`), **sem ST/CSOSN 500**.
- [x] `lib/fiscal/xml/*`: builder `infNFe` 4.00 + chave existentes (`ba0cc12`).
- [x] Worker XSD B2 + `validarXsd` real + pacote `PL_010e_v1.02` (merge `82c219c`, G-C2).
- [x] `lib/fiscal/signing/*`: XMLDSig com RSA-SHA1/SHA-1 (ADR-0011), C14N 1.0 e prova externa
  Java/JSR 105; **N4 no eixo C14N/XMLDSig**, sem certificado real.
- [x] Paridade fiscal do `upsertProduto` (Cadastros V2) — `metadata.fiscal` canônica (PR #8,
  merge `b307337`); contrato `lib/produto-fiscal.ts` reutilizado; **N3 no eixo cadastro**;
  `fiscalRegime` não canônico; sem schema/migration/emissão.
- [ ] `lib/fiscal/provider/<impl>`: provider real (homologação) registrado no resolver.
- [x] Gate G-F5: primeira integração = **SEFAZ direta em homologação**, sem gateway/PAA →
  ADR-0015.
- [x] Gate G-F5.1: primeiro piloto = **Matriz RafaCell/Taguaí, SP, SEFAZ-SP, NFC-e 65,
  `tpAmb=2`**, sempre pelo `Store.id` real e sem herança → ADR-0016.
- [ ] `lib/fiscal/qrcode/*`: QR-Code NFC-e + URL consulta por UF/CSC.
- [ ] Produtor pós-commit (enfileira `FiscalEmissaoJob`) + worker idempotente.
- [ ] Reflexo de status fiscal no PDV/recibo (read-only).
- [ ] DANFCE unificado sobre XML autorizado.
- [ ] Serviço de eventos (`EventoFiscal`) cancelamento/inutilização.
- [ ] Atualizar `CURRENT_STATUS.md` (fiscal: mock → fundação dormente).

## 8. Fases (objetivo + critério de saída)

| Fase | Objetivo | Critério de saída |
|---|---|---|
| **F0** Plano Mestre | Auditar + planejar | 4 docs criados; tsc limpo; código intocado ✅ |
| **F1** ADR cofre `[GATE]` | Decidir onde mora o A1/senha | ADR aprovado |
| **F2** Tributos | Calcular impostos NFC-e SN | Função pura + testes |
| **F3** XML | Gerar `infNFe` + chave | XML válido no XSD |
| **F4** Assinatura | Assinar com A1 | XML assinado verificável; segredo nunca logado |
| **Dry-Run** (gate) | Esteira a seco, sem transmitir (descarta XML) | Relatório de prontidão verde — critério de entrada da F5 |
| **F5** SEFAZ-SP direta `[GATE ✅]` | Matriz real + preflight + adapter `FiscalProvider` em homologação | NFC-e 65 (`tpAmb=2`) autorizada; protocolo/XML persistidos; reconciliação idempotente |
| **F6** QR-Code | QR + URL consulta | QR validado no portal SEFAZ homolog. |
| **F7** Ativação `[GATE]` | Ligar emissão por fila (piloto) | Venda real (homolog.) → job → autoriza; PDV não trava |
| **F8** DANFCE | Representação gráfica | DANFCE com QR sobre XML autorizado |
| **F9** Eventos | Cancelamento/inutilização | Evento autorizado + status refletido |
| **F10** Contingência | Offline → transmissão posterior | Entra/sai de contingência; fila reprocessa |
| **F11** Homologação ampla | Bateria SEFAZ por UF | Casos felizes + rejeição/denegação verdes |
| **F12** Produção `[GATE]` | Virada por loja | NFC-e autorizada em produção na loja-piloto |

> Detalhe de cada fase (arquivos prováveis, "não fazer", DoD): `MASTER_FISCAL_EXECUTION_PLAN.md §3`.

## 9. Dependências

| Depende de | Por quê |
|---|---|
| **PDV** | Origem da venda; ponto de enfileiramento pós-commit (não inline). |
| **Estoque/Produto** | Identidade fiscal do item (NCM/CEST/CFOP/origem via `getProdutoFiscal`). |
| **CRM/Cliente** | Destinatário (CPF/CNPJ + endereço estruturado para NFC-e nominal/NF-e). |
| **Multi-loja** | Piloto somente Matriz por `Store.id` real; identidade/certificado/série/CSC próprios; sem fallback ou herança. |
| **Infra/segredo** | Cofre para o A1/CSC (ADR F1) — bloqueia assinatura. |

> Matriz de paralelismo: Fiscal **não deve** evoluir em paralelo com mudanças de contrato do
> PDV (`finalizeSaleTransaction`) nem do schema — é serial nesses pontos.

## 10. Riscos

| Risco | Tipo | Mitigação |
|---|---|---|
| Emissão inline travar o balcão | Técnico/Produto | Fila assíncrona obrigatória; PDV só enfileira. |
| Falha fiscal desfazer a venda | Técnico | Venda commita primeiro; fiscal é satélite; nunca rollback de venda. |
| Vazamento de certificado/senha | Segurança | Segredo só por referência; cofre por ADR; nunca em log/bundle. |
| Imposto calculado errado | Negócio/Legal | Começar por matriz mínima (SN B2C); testes; homologação ampla antes de produção. |
| Ligar para todas as lojas de uma vez | Produto | Habilitação loja-a-loja; kill-switch `fiscalEnabled`. |
| Divergência de layout/endpoint por UF | Técnico | Resolver versionado no adapter SEFAZ; domínio canônico; gateway/PAA como alternativa futura por ADR. |
| Envio acidental à produção | Legal/Operacional | Provider inicial aceita só `HOMOLOGACAO`/`tpAmb=2`; endpoint de produção bloqueado antes da rede. |

## 11. Sprint atual

**GOAL-016C (`FISCAL-GOAL-016C-SECRET-PROVIDER-CUSTODIA-A1-001`) IMPLEMENTADO na branch
`fiscal/goal-016c-secret-provider-custodia-a1`** — contrato server-only do Secret Provider
completado sobre o port `FiscalSecretVault` (ADR-0009 D1) com `describeSecret`,
`checkAvailability` e `rotateCertificadoPfx`; resolver único de backend
(`resolveFiscalSecretProvider` — `env` no piloto; provider declarado não implementado ⇒
indisponível fail-closed, sem fallback); serviço de custódia A1
(`certificado-custodia-service`) com armazenar/rotacionar/revogar/descrever — rotação valida e
grava a nova versão ANTES de trocar o ponteiro e revoga a anterior só APÓS a confirmação;
endpoints `POST /api/fiscal/onboarding/certificado/custodia` (upload → valida → cofre → refs
opacas, `PENDENTE_VALIDACAO`+inativo), `POST /api/fiscal/certificado/[id]/rotacionar` e fluxo
`revogar` no `PATCH /api/fiscal/certificado/[id]`; GETs expõem bloco `cofre`
(provider/disponibilidade/capacidades) e `atualizadoEm`. Pipeline **dormente**: `fiscalEnabled`
intocado, zero emissão/SEFAZ, zero schema/migration; no piloto (EnvVault sem escrita) a custódia
automática responde 503 fail-closed e o provisionamento manual segue valendo. **Não integrado à
main**: aguarda revisão independente e gate humano. Próximo gate esperado:
`FISCAL-GOAL-016D-SEFAZ-ADAPTER-HOMOLOGACAO`, somente após aprovação humana da custódia.

**GOAL-009 conclui somente a decisão arquitetural.** ADR-0014/0015/0016 estão aceitas; o cofre,
o provider e os recursos Supabase/SEFAZ continuam não implementados e não provisionados. Produção,
`tpAmb=1` e emissão fiscal real permanecem bloqueados.

**GOAL-004 paridade `upsertProduto` (`FISCAL-PRODUTO-UPSERT-PARITY-004`) FECHADO em 16/07/2026** —
integrado na `main` pelo PR #8 (merge `b307337`, implementação `3f8928c`); Cadastros V2 grava
`metadata.fiscal` canônica com o contrato existente; create/update/parcial não destrutivos;
`fiscalRegime` só visual; Barcode/Cosmos com revisão humana; **N3 no eixo cadastro**; N6=0;
N7=0; signer dormente; sem schema/migration; sem emissão/SEFAZ. GOAL-003 (C14N) e GOAL-002 (XSD)
permanecem fechados. **GOAL-005A** (supply chain GHA do worker XSD): **integrado e fechado na
main** pelo PR **#12** (merge `2a7f102`, head `d512794`; run `29669361609`, lock materializado,
bundle offline aprovado, Trivy 0/0). **GOAL-005 técnico** (`FISCAL-DRY-RUN-INTEGRITY-PROOF-005`)
**permanece PARCIAL**. **GOAL-005B: escopo RATIFICADO em 20/07/2026 pelo Caminho 2** — definição e
autorização separadas **emitidas**; estado **DEFINIDO DOCUMENTALMENTE — NÃO INICIADO**; o 005B
carregará o harness de `d4dfcf1`, com workflow dedicado e consumo fail-closed do bundle 005A
(**expira 2026-07-26T01:59:00Z**). A implementação técnica só começa **após** a integração da
ratificação na `main` (Gate H1). Homologação e produção **não** foram abertas. Gate Fiscal global
**aberto**.

## 12. Status atual (1 parágrafo)

A frente fiscal tem fundação dormente com **validação XSD oficial real** (worker B2, G-C2),
**prova técnica externa de C14N/XMLDSig** (PR #6), **cadastro fiscal canônico do produto** também
na porta Cadastros V2 (PR #8 / GOAL-004, N3) e **supply chain offline do worker XSD integrada na
main** (PR #12 / GOAL-005A — imagem/bundle/lock/Trivy 0/0/runtime sem egress). Schema,
identidade, guards, snapshot, tax-engine, XML, assinatura (RSA-SHA1), vault, provider stub,
pipeline e numeração existem; o motor de emissão **não tem caller de venda**; banco fiscal vazio;
`fiscalEnabled` inalcançável. O gate Fiscal **global** ainda **não** autoriza F5. **Cadastro
canônico ≠ regra tributária ≠ XML ≠ assinatura ≠ transmissão ≠ homologação ≠ produção. N6=0 e
N7=0.** GOAL-005 técnico continua **PARCIAL**; 005B tem **escopo ratificado** (Caminho 2) mas
permanece **NÃO INICIADO**, dependente da integração da ratificação e de artifact com validade até
**2026-07-26**. Sequência oficial em `docs/fiscal/`.

O Gate G-F5 está decidido arquiteturalmente pela ADR-0015, mas nenhuma chamada externa foi feita.
O escopo de futura homologação é exclusivamente a Matriz/Taguaí via `Store.id` real (ADR-0016);
demais lojas, UFs e qualquer produção permanecem fail-closed.

## 13. Métricas de sucesso

- **Tempo extra na venda por causa do fiscal:** ~0 ms (emissão fora da transação).
- **Taxa de autorização** (cStat 100) em homologação: > 99% nos casos felizes.
- **Lojas habilitadas sem incidente de balcão:** 100% das ativadas.
- **Vazamento de segredo:** 0 (auditável: nada em claro em log/bundle/coluna).
- **Jobs em dead-letter:** monitorado e drenado (sem documento "preso").

## 14. Blockers

- **BL-FISCAL-1:** ✅ **DECISÃO RESOLVIDA** por `ADR-0009` + `ADR-0014` (EnvVault piloto →
  Supabase Vault + Storage privado exclusivo do Fiscal em produção). Implementação e
  provisionamento permanecem bloqueios de execução.
- **BL-FISCAL-2:** ✅ **DECISÃO RESOLVIDA** por `ADR-0015`: SEFAZ direta na homologação inicial;
  gateway/PAA ficam como alternativas futuras.
- **BL-FISCAL-3:** 🟡 **ESCOPO RESOLVIDO** por ADR-0016 (Matriz/Taguaí, SP, SEFAZ-SP, NFC-e 65,
  `tpAmb=2`). Antes da F5 ainda faltam credenciamento confirmado e preflight completo da
  configuração real, sem registrar valores nesta documentação.

> Tracking vivo de blockers gerais: `docs/status/BLOCKERS.md`.

## 15. Referências

- Auditorias: `docs/audits/AUDITORIA_PRE_FISCAL_READINESS_v01.md`,
  `docs/audits/AUDITORIA_FISCAL_GAPS_v01.md`.
- Plano mestre: `docs/governance/MASTER_FISCAL_EXECUTION_PLAN.md`.
- Decisões do GOAL-009: `docs/decisions/ADR-0014-supabase-vault-backend-kms-fiscal.md`,
  `docs/decisions/ADR-0015-sefaz-direta-homologacao-inicial.md` e
  `docs/decisions/ADR-0016-piloto-homologacao-sp-matriz-rafacell.md`.
- Código vivo: `lib/fiscal/**`, `prisma/schema.prisma` (bloco fiscal ~L2075+),
  `app/api/fiscal/**`, `components/configuracoes-v3/.../FiscalSection.tsx`.
- Commits da fundação: `32ae9c8`, `549513d`, `ca681ed`, `04ce54d`, `b5177cf`, `a206dce`,
  `cd565c8`, `2b88411`.
- Arquitetura oficial (Fase 1, **criada**): `docs/decisions/ADR-0008-fiscal-architecture.md` +
  `docs/architecture/{FISCAL_SCHEMA_DESIGN,NFCE_ARCHITECTURE,FISCAL_EVENTS,FISCAL_SECURITY,FISCAL_DRY_RUN}.md`
  (sem sufixo `_v01`; comentários de código que citam `_v01`/`§17/§18` não foram alterados —
  área protegida).
