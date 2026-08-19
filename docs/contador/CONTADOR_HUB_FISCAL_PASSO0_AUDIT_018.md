# CONTADOR-018 — Auditoria fiscal Passo 0

| Campo | Valor |
|---|---|
| GOAL de auditoria | `CONTADOR-018-FISCAL-PASSO0-AUDIT-001` / persistência `CONTADOR-018-PASSO0-AUDIT-PERSIST-002` |
| GOAL alvo (não aberto) | `CONTADOR-HUB-FISCAL-INTEGRATION-018` |
| Tipo | Auditoria / planejamento **read-only** |
| Data | 2026-08-19 |
| `CURRENT_MAIN` | `edbf724ba72b40262b87257d92ce77f46320143c` (`feat(operacoes-v4): fechar técnico, bancada, fila e SLA na V4`) |
| `origin/main` após fetch | **igual** a `CURRENT_MAIN` — nenhum avanço; achados fiscais/contador não invalidados |
| GOAL 018 importado/aberto | **false** |
| Código de aplicação alterado nesta execução | **nenhum** |
| Schema / env / ADR alterados | **nenhum** |

Este documento é o **Passo 0 obrigatório** do roadmap `CONTADOR-HUB-FISCAL-INTEGRATION-018`. Não implementa o 018. Não importa nem abre o GOAL. Não altera pipeline fiscal, Prisma, flags de ambiente nem o texto da ADR-007.

Revisões independentes incorporadas nesta persistência:

1. `fiscalXmlReader.readAuthorizedDocument()` **grava `FiscalLog`** — não é reader side-effect-free.
2. Identidade de bytes: canônica **na coluna persistida UTF-8**, **não** comprovada contra o transporte HTTP original da SEFAZ.

---

## 0. Pré-voo

| Checagem | Resultado |
|---|---|
| Fetch `origin/main` | feito antes de escrever |
| `HEAD` == `origin/main` (base auditada) | `edbf724ba72b40262b87257d92ce77f46320143c` |
| Working tree na base | limpa |
| AEP `.aep-active` | ausente (protocolo OPT-IN **não aplica**) |
| `node scripts/track.mjs status contador` | 🟡 PAUSED · `current_goal=null` · `next_goal=null` |
| GOAL 017 | **DONE** · ledger `2026-08-19T19:06:45.065Z` · last_goal `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017` |
| GOAL 012 | **DONE** (`CONTADOR-HUB-FECHAMENTO-R2-012G-PUBLISH-MAIN`) |
| Caminho quente `docs/execution-tracks/contador/goals/` | vazio |
| 018 no plano | **DRAFT** em `RECONCILIACAO.md` / roadmap 014–019 · **sem manifesto de importação** · **não elegível para `open`** |

Fontes lidas: roadmap [`CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md`](./CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md) §018, [`CONTADOR_HUB_COMMANDS_001.md`](./CONTADOR_HUB_COMMANDS_001.md) COMANDO 18/19, masterplan, ADRs do Contador, ADR-0018, schema Prisma fiscal, `lib/fiscal/**` (reader/storage/emissão/cStat), `lib/contador/readers`, `lib/contador/pacote`, `lib/contador/fechamento/montar-checklist.ts`.

`GOAL_018_OPENED=false`

---

## 1. Reconciliação: roadmap 018 × Fiscal atual da main

O comando/roadmap 018 é **anterior** a evoluções fiscais já na main (GOAL-013 / ADR-0018, matriz cStat 016D-B, piloto 022 dormente, GOAL 030 pagamento). Não se pode assumir o contrato antigo “XML no storage + status autorizado”.

### 1.1 Modelos Prisma fiscais

| Model | Papel | Evidência |
|---|---|---|
| `ConfiguracaoFiscalLoja` | Identidade + `fiscalEnabled` (kill-switch de **emissão**, default `false`) | `prisma/schema.prisma` ~2317 |
| `CertificadoDigital` | Metadados A1; segredo só por `*Ref` | ~2371 |
| `SerieFiscal` | Numeração atômica por `(storeId, modelo, série, ambiente)` | ~2404 |
| `NotaFiscal` | Documento + snapshots + XML + protocolo/chave | ~2430 |
| `NotaFiscalItem` | Snapshot congelado por item | ~2500 |
| `EventoFiscal` | Cancelamento / CC-e / inutilização / contingência | ~2538 |
| `FiscalEmissaoJob` | Fila emissão/cancelamento/consulta; `payload` JSONB | ~2568 |
| `FiscalLog` | Trilha append-only | ~2603 |

**Não modificado nesta auditoria.** `SCHEMA_REQUIRED=false` para o 018.

### 1.2 Enums persistidos

`StatusNotaFiscal` (documento, mais granular):

`RASCUNHO` · `VALIDANDO` · `ASSINADA` · `TRANSMITINDO` · `AUTORIZADA` · `REJEITADA` · `DENEGADA` · `CONTINGENCIA` · `CANCELADA` · `INUTILIZADA` · `ERRO`

`FiscalStatusVenda` (visão colapsada da venda):

`NAO_FISCAL` · `PENDENTE` · `EMITINDO` · `EM_CONTINGENCIA` · `AUTORIZADA` · `REJEITADA` · `CANCELADA_FISCAL` · `BLOQUEADA_FISCAL`

Também: `ModeloFiscal` (`NFCE`/`SAT`/`NFE`), `AmbienteFiscal` (`HOMOLOGACAO`/`PRODUCAO`), `TipoEmissao` (`NORMAL`/`CONTINGENCIA_OFFLINE`), `TipoEventoFiscal`, `StatusEventoFiscal`, `FiscalJobTipo`, `FiscalJobStatus`.

**Não inferir significado jurídico só pelo nome do enum.** A §2 separa *enum existente* de *write encontrado*.

### 1.3 Pipeline de autorização (real)

1. Snapshot congelado (`venda-fiscal-snapshot-service`) cria `NotaFiscal` **RASCUNHO** `vigente=true`.
2. Preparer (`finalized-nfce-preparer`) monta XML assinável **em memória** (builder + signer).
3. `persistBeforeTransmission` grava `xmlAssinado`, série/número/`chaveAcesso`, status **`TRANSMITINDO`**; SHA-256 dos bytes assinados no `FiscalEmissaoJob.payload.document.bytesSha256`.
4. Provider / consulta; estado incerto → job `CONSULTA` (ADR-0017).
5. `markAuthorized` persiste `status=AUTORIZADA`, `xmlAutorizado`, `protocolo`, `cStat`, `xMotivo`, `dataAutorizacao` (+ QR/digest opcionais). Imutável após primeira persistência (ADR-0018).
6. `markRejected` persiste `status=REJEITADA` + `cStat`/`xMotivo` — **sem** `xmlAutorizado`.

Espelho `xmlStorageRef`: **no-op** (`noopXmlStorageMirror.active === false`). Coluna é a fonte primária.

### 1.4 Cancelamento / rejeição / denegação / contingência / inutilização

| Operação | Schema | Write de produção encontrado? |
|---|---|---|
| Rejeição | `NotaFiscal.status=REJEITADA` | **Sim** — `markRejected` |
| Autorização | `AUTORIZADA` + XML + protocolo | **Sim** — `markAuthorized` |
| Denegação (`cStat` 110) | enum `DENEGADA` existe | **Não** como `DENEGADA`. Matriz cStat mapeia 110 → `REJECTED` → persistido como **`REJEITADA`** (`sefaz-cstat-matrix.ts`; `toFiscalTransmissionResult`) |
| Cancelamento | `EventoFiscal` (`xmlEvento`/`xmlRetorno`) + enum `CANCELADA` | Stub/mock devolvem `CANCELADA`; `SefazDiretoProvider.cancelar` é **inerte**. Nenhum writer de produção encontrado que grave `NotaFiscal.status=CANCELADA` |
| Inutilização | enum `INUTILIZADA` + evento `INUTILIZACAO` | Mesmo padrão: stub/mock; provider direto inerte |
| Contingência | enum `CONTINGENCIA` / venda `EM_CONTINGENCIA` | Pipeline de emissão mapeia erro de transmissão → `FiscalStatusVenda.EM_CONTINGENCIA`. Write de `StatusNotaFiscal.CONTINGENCIA` **não** encontrado no persistidor incerto |
| Protocolo | `NotaFiscal.protocolo` (autorização); `EventoFiscal.protocolo` (evento) | Autorização: sim. Evento: coluna existe, writer de cancelamento de produção não encontrado |
| Chave | `NotaFiscal.chaveAcesso` `@unique` | Gravada **antes** da transmissão |
| XML original | `xmlAssinado` (pré) / `xmlAutorizado` (pós) | Ver §6 — canônico **na coluna**, não no transporte HTTP |
| Snapshots | `snapshotEmitente` / `snapshotDestinatario` / `snapshotPagamento` + itens | Congelados no RASCUNHO; **não** reconstruem XML autorizado |
| Feature flags fiscais | `fiscalEnabled` default-off; piloto 022 dormente | **Não** é a flag do Contador (ver §8) |

### 1.5 Guards / flags

- Emissão: `ConfiguracaoFiscalLoja.fiscalEnabled` (default `false`). Kill-switch de **fila/emissão**, não de leitura do Contador.
- `CONTADOR_FISCAL_READER`: **não existe** em código nem `.env.example` — só menção documental + stub `nao_disponivel`.
- ADR-0018: acesso XML server-side, isolamento `storeId`, nenhum XML completo em logs.

---

## 2. Matriz de estados reais da nota

`AUTHORIZED_STATUS` comprovado como base de entregável: **`AUTORIZADA`**.

Legenda **entregável?**: “proposta da auditoria (Opção A)” — **não aprovado**.

| STATUS | Significado no sistema (evidência de código) | Protocolo? | Chave? | XML? | XML é final? | Pode ser cancelada? | Entregável (prop. A)? | Evidência |
|---|---|---|---|---|---|---|---|---|
| `RASCUNHO` | Snapshot persistido; 1 vigente por venda | não | não (ainda) | não | não | N/A (ainda não autorizada) | **não** | `venda-fiscal-snapshot-service.ts` cria `status: RASCUNHO` |
| `VALIDANDO` | Enum + resposta de stub `validarSnapshot`/`prepararEmissao` | não | possível em memória | não persistido como autorizado | não | não comprovado | **não** | stub/mock; write Prisma de nota **não** encontrado |
| `ASSINADA` | Enum; fixtures de teste usam o rótulo | não obrigatório | pode existir no documento finalizado | `xmlAssinado` possível **antes** do update `TRANSMITINDO` | não (pré-SEFAZ) | não comprovado | **não** | `persistBeforeTransmission` aceita `ASSINADA` no WHERE mas **escreve** `TRANSMITINDO`; write estável `ASSINADA` não encontrado |
| `TRANSMITINDO` | Identidade + `xmlAssinado` persistidos; SEFAZ pode ter recebido | não (ainda) | sim (alocada) | `xmlAssinado` sim; `xmlAutorizado` não | **não** (não autorizado) | não comprovado neste estado | **não** | `prisma-uncertain-state-persistence.ts` `persistBeforeTransmission` |
| `AUTORIZADA` | Uso autorizado persistido; XML+protocolo imutáveis | **sim** (canônico `cStat` 100; ADR-0018 admite outros códigos de autorização) | **sim** | `xmlAutorizado` + `xmlAssinado` | **sim, na coluna persistida** (ver §6) | juridicamente sim *depois*; writer de cancelamento de produção **não** encontrado | **sim, se** predicado A (não aprovado) | `markAuthorized` |
| `REJEITADA` | Rejeição terminal persistida; número pode ter sido consumido (matriz cStat) | não de autorização | pode existir (já alocada) | sem `xmlAutorizado`; pode haver `xmlAssinado` | não (não autorizado) | N/A como NFC-e autorizada | **não** | `markRejected`; cStat 110 também cai aqui |
| `DENEGADA` | Enum jurídico; **não é o status persistido do caminho 110** | — | — | — | — | documento denegado já registrado na SEFAZ (matriz: sem inutilizar) | **não** | enum no schema; `cStat` 110 → `REJECTED` → `REJEITADA`. `StatusNotaFiscal.DENEGADA` **sem write** |
| `CONTINGENCIA` | Enum da nota; venda usa `EM_CONTINGENCIA` | não | possível | XML de contingência é outro contrato (`tpEmis=9`); não é `xmlAutorizado` de uso normal | não como autorizado online | resolver transmissão antes (máquina da venda) | **não** | `emission-pipeline.ts` / `venda-fiscal-state-machine.ts`; write `StatusNotaFiscal.CONTINGENCIA` não encontrado |
| `CANCELADA` | Enum + stub `cancelar` (`cStat` 135 simulado) | protocolo de **evento**, se existisse | chave da nota original | `xmlAutorizado` histórico **imutável** (ADR-0018); `xmlEvento` no schema | XML autorizado permanece o da autorização; evento é outro artefato | é o estado *após* cancelar, se persistido | **não na Opção A**; Opção B pendente | stub/mock; sem writer de produção |
| `INUTILIZADA` | Enum + stub `inutilizar` (`cStat` 102 simulado) | protocolo de inutilização, se existisse | não é NFC-e autorizada | não é XML de NFC-e autorizada | N/A | N/A | **não** | stub/mock; ADR-007: inclusão no relatório **não decidida** |
| `ERRO` | Enum; mock devolve em falha genérica | não | possível | não autorizado | não | não comprovado | **não** | `mock-provider.ts`; write Prisma de nota não encontrado |

Estados de **venda** (`PENDENTE`, `EMITINDO`, `NAO_FISCAL`, …) **não** são `StatusNotaFiscal`. O reader do 018 deve filtrar a **nota**, não só `Venda.fiscalStatus`.

Não há status persistido chamado `pendente`/`processando` na nota: o mais próximo de “processando” é `TRANSMITINDO` (+ jobs `PROCESSANDO` / `cStat` 103/105).

---

## 3. Predicado “entregável” — proposta, não decisão

`DECISION_1_ENTREGAVEL_PREDICATE=REQUIRED`

Nada abaixo está aprovado. A **Opção A** é a recomendação da auditoria.

### 3.1 Opção A (recomendada)

```
entregavel(nota) =
    nota.storeId == scope.storeId          -- isolamento; evidência: ADR-0003 + reader fiscal where {id, storeId}
AND nota.vigente == true                   -- 1 vigente por venda; evidência: snapshot-service
AND nota.status == AUTORIZADA              -- único status com XML+protocolo persistidos de fato
AND protocolo presente / não-vazio         -- markAuthorized + matriz cStat 100 exige protocolo
AND chaveAcesso presente / não-vazio       -- persistida pré-transmissão; @unique
AND xmlAutorizado presente / não-vazio     -- coluna canônica (ADR-0018); empacotar esses bytes, sem builder
AND dataCompetencia ∈ PeriodoUtc           -- CAMPO AINDA HUMANO (DECISION_3)
AND ambiente ∈ conjunto permitido          -- homologação × produção: ADR-007 “não decidido”
```

**Não entra (Opção A):** `RASCUNHO`, `VALIDANDO`, `ASSINADA`, `TRANSMITINDO`, `REJEITADA` (inclui denegação persistida), `DENEGADA` se algum dia for gravada, `CONTINGENCIA`, `CANCELADA`, `INUTILIZADA`, `ERRO`.

### 3.2 Opção B

Opção A **mais** notas `CANCELADA` que ainda tenham `xmlAutorizado` (histórico imutável), com política de pacote da §4.

Consequência: o escritório vê a NFC-e que existiu e o cancelamento; o ZIP deixa de ser “somente autorizadas vigentes”.

### 3.3 Ambiente (não pode desaparecer)

ADR-007: *“Não decidido. Ambientes (homologação × produção) no mesmo pacote”*.

Pode ser resolvido **dentro** do predicado (cláusula `ambiente`) **ou** no rollout da flag (só ligar em loja `HOMOLOGACAO`). Continua decisão humana.

`readAuthorizedDocument` **não** aplica este predicado (não filtra `AUTORIZADA`; código `nota_nao_autorizada` existe no tipo e **não é usado**). O 018 **não** pode tratar o reader fiscal atual como predicado.

---

## 4. Cancelamento

`CANCELLED_XML_POLICY_DECISION_REQUIRED=true`

`DECISION_2_CANCELLED_XML_POLICY=REQUIRED`

| Artefato | Estado atual |
|---|---|
| XML autorizado depois cancelado | ADR-0018: `xmlAutorizado` **não é substituído**. Se o cancelamento um dia persistir, os bytes autorizados permanecem |
| XML/evento de cancelamento | Colunas `EventoFiscal.xmlEvento` / `xmlRetorno` existem; writer de produção **não** encontrado |
| Representação canônica no Fiscal para o pacote | **Não existe** |

Políticas (não escolher nesta auditoria):

- **A)** Excluir XML de nota cancelada de `05-XML`; listar canceladas só no relatório/checklist.
- **B)** Incluir XML autorizado histórico + XML do evento (quando o evento existir de verdade).
- **C)** “Já canônico no Fiscal” — **recusar**: não há pacote canônico hoje.

Recomendação operacional **até** haver evento persistido: **A**. Não implementar.

---

## 5. Storage / identidade de bytes

### 5.1 Caminho real

```
NotaFiscal
  xmlAutorizado  (@db.Text)     ← fonte primária canônica persistida (ADR-0018)
  xmlAssinado    (@db.Text)     ← pré-transmissão
  xmlStorageRef  (opcional)     ← hoje null; mirror no-op
  protocolo / chaveAcesso / cStat / dataAutorizacao
        ↓
fiscalXmlReader.readAuthorizedDocument({ storeId, notaFiscalId [, vendaId] })
  WHERE id + storeId
  SHA-256 UTF-8 do texto da coluna
  + FiscalLog (efeito colateral — §5.2)
        ↓
bytes do texto persistido (não do socket HTTP)
```

`XML_PERSISTED_SOURCE_CANONICAL=true`

`XML_PERSISTED_UTF8_IDENTITY=true`

`SEFAZ_TRANSPORT_BYTE_IDENTITY_PROVEN=false`

Formulação precisa (obrigatória):

- `NotaFiscal.xmlAutorizado` é a **fonte primária canônica persistida**.
- O cálculo de SHA-256 no reader é sobre **UTF-8 do texto persistido** (`createHash("sha256").update(content, "utf8")` em `xml-storage-reader.ts`).
- O GOAL 018 deve empacotar **esse conteúdo**, sem passar pelo `nfce-xml-builder` / signer / snapshot vivo.
- Identidade com os **bytes do transporte HTTP original SEFAZ** **não está comprovada** nesta auditoria.

Hash persistido **na nota:** não há coluna `xmlHash`. Hash do assinado vive no job (`payload.document.bytesSha256`). Hash do autorizado é **computado na leitura**. O manifesto do pacote deve hashear os bytes **empacotados**.

Risco de XML reconstruído: o builder existe (`lib/fiscal/xml/nfce-xml-builder.ts`); dry-run gera XML efêmero. ADR-0018 e o reader fiscal declaram **nunca reconstruir**. O 018 deve falhar fechado se `xmlAutorizado` estiver vazio — nunca “completar” com builder.

`xmlStorageRef` é referência **privada**. **Proibido** no `manifest.json` público e nos CSVs.

### 5.2 Efeito colateral do `fiscalXmlReader` (ajuste da revisão)

`FISCAL_XML_READER_SIDE_EFFECT=true`

`CONTADOR_CAN_REUSE_FISCAL_XML_READER_AS_IS=false`

`FISCAL_PURE_READER_DECISION_REQUIRED=true`

`DECISION_6_PURE_FISCAL_READER=REQUIRED`

`createFiscalXmlReader` / `readAuthorizedDocument` (`lib/fiscal/storage/xml-storage-reader.ts`):

- Lê `NotaFiscal` com `storeId` (e `notaFiscalId`); loja B não lê loja A.
- **Não** altera `status`, XML, protocolo nem chave da nota.
- **Grava `FiscalLog` em toda leitura** (`acao: "fiscal.storage.authorized_read"`, ~L159–177).
- **Pode gravar outro `FiscalLog`** se o mirror estiver ativo e divergir (`fiscal.storage.mirror_divergent`, ~L142–158). O mirror hoje é no-op, mas o ramo de escrita permanece no código.

Portanto **não** é “read-only puro” nem satisfaz sozinho o requisito estrito de reader fiscal **side-effect-free** do Contador. Não chamar de primitive reutilizável as-is.

Alternativas para o **charter 018** (não escolher, não implementar):

- **A.** `lib/contador/readers/fiscal.ts` faz `SELECT` read-only direto em `NotaFiscal` (e, se preciso, eventos), reusando só contratos/helpers **puros** (hash UTF-8, competência, saneamento). Zero `FiscalLog.create`.
- **B.** A trilha Fiscal expõe primitive **no-log**, explicitamente read-only; o Contador passa a consumi-la.

DANFC-e (`loadDanfceForReprint`) hoje chama o reader com log — fora do escopo do 018; só mostra que o efeito já tem caller.

---

## 6. Isolamento multi-loja

| Superfície | `storeId`? | Risco |
|---|---|---|
| `NotaFiscal` / `EventoFiscal` / jobs / logs | coluna + índices | Reader fiscal: `where: { id, storeId }` — teste “loja B → null” em `xml-protocol-storage.test.ts` |
| `fiscalXmlReader` | obrigatório (erro `store_id_obrigatorio`) | Isola leitura; **não** isola o efeito `FiscalLog` do requisito Contador |
| Readers Contador atuais | `scope.storeId` no servidor | Padrão a copiar; nunca do body |
| Competência | `PeriodoUtc` America/Sao_Paulo | Campo da **nota** ainda humano |
| Pacote | `storeId` só em `manifest.json` → `competencia.storeId` | CSVs/placeholders não podem carregar `storeId` nem `xmlStorageRef` |

Teste cross-store obrigatório no 018: nota autorizada da loja A **não** entra em checklist, CSV nem `05-XML` da loja B; falha de lookup ≠ enumeração; hashes/protocolos da A ausentes do ZIP da B.

---

## 7. Feature flag

`CONTADOR_FISCAL_READER_EXISTS=false`

Não há primitive equivalente em código. O 018 **pode** adicionar a flag **sem schema**, no padrão de [`lib/contador/portal/flag.ts`](../../lib/contador/portal/flag.ts): valor exato `"on"` (trim, case-insensitive); ausente = off.

Contrato esperado do roadmap (a confirmar na DECISION_4):

- default off;
- ativação controlada por loja/ambiente;
- flag off → fiscal `nao_disponivel`;
- zero pasta de XML entregável quando off (permanece o placeholder `05-XML/LEIA-ME.md` **ou** aviso equivalente — o 018 não deve sumir com a honestidade).

**Não** reutilizar `fiscalEnabled`: é kill-switch de **emissão**. Ligar o Contador via `fiscalEnabled` misturaria leitura contábil com autorização de transmitir.

Esta auditoria **não** edita `.env` / `.env.example`.

`DECISION_4_FLAG_ROLLOUT=REQUIRED`

---

## 8. Runtime fiscal

`FISCAL_RUNTIME_VALIDATABLE=false`

`DECISION_5_HOMOLOGATION_STORE=REQUIRED`

| Evidência | O que mostra |
|---|---|
| Piloto NFC-e GOAL 022 (`nfce-homologation-pilot-wiring.ts`) | **Dormente**: `EXTERNAL_EXECUTION_DENIED`; A1 recusado; transporte offline |
| `stubHomologacaoProvider` / `mock-provider` | Simula autorizar/cancelar/inutilizar **sem** SEFAZ |
| Fixtures DANFC-e / testes GOAL-013 | XML de teste assinado com cert de teste; **não** é loja viva |
| `SefazDiretoProvider` | Cancelar/inutilizar inertes; emissão ainda gated |
| `CURRENT_STATUS` / planos mestres | Homologação SEFAZ / N6 e produção N7 historicamente 0; `fiscalEnabled` default-off |

Não há evidência nesta auditoria de **uma loja/ambiente de homologação vivo** com as quatro representações pedidas (autorizado, rejeitado, cancelado, XML real disponível) **fora de teste**. Fixtures cobrem autorizado (e variantes) em unidade; cancelado real persistido **não**.

**Não usar Production para gerar notas de teste.**

Homologação do 018 exige decisão humana de loja/fixture **depois** do predicado — não desbloqueia implementação sozinha.

---

## 9. ADR-007

Arquivo: [`CONTADOR_HUB_ADRS_PROPOSTOS_001.md`](./CONTADOR_HUB_ADRS_PROPOSTOS_001.md) § **ADR-CONTADOR-007**.

| Item | Estado |
|---|---|
| Status | **Proposed** (GOALs 001/003–006 Accepted G2; 002/008 Accepted G3; **007 não**) |
| Decisão recomendada | C — `fiscalReader` atrás de `CONTADOR_FISCAL_READER`; HUB não emite / não calcula tributo |
| Predicado “entregável” | **Não decidido** — “nuance jurídica; decisão conjunta com a trilha fiscal, registrada aqui” |
| Não decidido no texto | Homologação × produção no mesmo pacote; inutilização no relatório |

Pontos que **ainda** exigem aprovação humana: predicado, cancelados, data da competência, flag/rollout, loja de homologação, reader puro (esta revisão), ambiente no pacote.

**ADR não modificada** nesta auditoria.

`ADR_007_STATUS=Proposed`

---

## 10. Checklist — sinal fiscal atual

`CHECKLIST_FISCAL_CURRENT_STATE=nao_disponivel` (constante; fonte **não consultada**)

[`montar-checklist.ts`](../../lib/contador/fechamento/montar-checklist.ts) `derivarFiscal`: `estado: "nao_disponivel"`, evidência `"não consultado"`, texto `CONTADOR_FISCAL_READER`.

Readers agregados ([`lib/contador/readers/index.ts`](../../lib/contador/readers/index.ts)): `fiscal: monetarioIndisponivel(...)` + alerta informativo. **Não** é mock numérico disfarçado de total.

Transição honesta planejada (não implementar):

```
flag off                         → nao_disponivel
flag on + reader disponível      → sinal real (ok / atencao / pendente conforme predicado)
flag on + falha de reader/storage → nao_disponivel ou erro honesto
nunca: ausência de leitura       → ok
nunca: falha                     → "zero notas"
```

Rejeições/cancelamentos, quando a flag estiver on: sinais de checklist (`atencao`), **não** XML no pacote (salvo DECISION_2).

---

## 11. Pacote `05-XML` atual

`PACKAGE_05_XML_CURRENT_STATE=placeholder`

[`lib/contador/pacote/fontes.ts`](../../lib/contador/pacote/fontes.ts): único arquivo `05-XML/LEIA-ME.md` (placeholder honesto). Avisos do manifesto citam `CONTADOR_FISCAL_READER` / GOAL 018. Hashes SHA-256 UTF-8 de **todos** os arquivos de conteúdo; `manifest.json` não se auto-referencia.

Planejamento (018, não executar):

| Requisito | Como evitar o erro |
|---|---|
| XML duplicado | Uma linha vigente (`vigente=true`) + nome `{chaveAcesso}.xml` |
| Outra loja | `storeId` no SELECT; teste cross-store |
| Rejeitado indevido | predicado A |
| Cancelado | DECISION_2; default sugerido = fora de `05-XML` |
| `storageRef` no manifesto público | allowlist de campos; proibir `xmlStorageRef` |
| Alteração dos bytes | copiar o texto da coluna; sem builder, sem pretty-print, sem re-encode |
| Ordem determinística | sort por `chaveAcesso` |
| Relação | `05-XML/relacao.csv` (chave, número, data, valor, status) **sem** PII / sem ref de storage |

Limites atuais do pacote ([`seguranca.ts`](../../lib/contador/pacote/seguranca.ts)):

- `MAX_ARQUIVOS_PACOTE = 15` (estrutura 008B + snapshot 012A)
- `MAX_BYTES_DESCOMPACTADO = 25 MiB`
- `MAX_BYTES_ZIP = 10 MiB`

**Muitos XML estouram o teto de arquivos.** O 018 precisa constatar e decidir teto/estratégia (não nesta auditoria). Falha de limite → 413 / erro honesto, não ZIP truncado silencioso.

Flag off: **não** criar XML no ZIP; manter placeholder ou aviso em `itensNaoDisponiveis`.

---

## 12. UI mínima prevista

Relatório **somente leitura** na competência:

- contagem por `StatusNotaFiscal` (e/ou entregável vs demais);
- estado da fonte (`nao_disponivel` / real / erro);
- selo de flag.

**Proibido:** botão de emissão, cancelamento, inutilização, correção, qualquer mutação fiscal, interpretação tributária, `estimativaImposto()` do legado.

---

## 13. Testes propostos (charter 018 — não executar)

1. Matriz completa de `StatusNotaFiscal` (cada enum: entra / não entra / checklist).
2. Flag off → `nao_disponivel` + sem XML entregável.
3. Runtime/reader indisponível → `nao_disponivel`/erro; **não** `ok`.
4. Somente entregáveis (predicado aprovado) no ZIP.
5. `REJEITADA` (incl. cenário cStat 110) não entra em `05-XML`.
6. Cancelado conforme DECISION_2.
7. Bytes empacotados = texto persistido em `xmlAutorizado` (hash UTF-8 confere).
8. Hash do manifesto confere com os arquivos do ZIP.
9. Cross-store.
10. Falha de leitura/storage **não** vira “zero notas / tudo ok”.
11. Diff do 018 **não** toca `lib/fiscal/emission/**`, provider, Prisma, certificados.
12. Reader do Contador **não** grava `FiscalLog` (se Opção A) **ou** usa primitive no-log (Opção B).

---

## 14. Decisões humanas (não executar)

Ambiente homologação/produção permanece visível (cláusula do predicado e/ou rollout). Não foi absorvido em silêncio.

### DECISION_1_ENTREGAVEL_PREDICATE=REQUIRED

- **Recomendação:** Opção A (`AUTORIZADA` + protocolo + chave + `xmlAutorizado` + vigente + store + período + ambiente permitido).
- **Alternativa:** Opção B (incluir canceladas com XML histórico).
- **Impacto:** conteúdo jurídico de `05-XML` e do aceite manual.

### DECISION_2_CANCELLED_XML_POLICY=REQUIRED

- **Recomendação:** A (excluir de `05-XML`) enquanto não houver `EventoFiscal` de cancelamento persistido.
- **Alternativa:** B (autorizado + evento) quando o writer existir.
- **Impacto:** escritório sem XML cancelado vs pacote completo de ciclo de vida.
- `CANCELLED_XML_POLICY_DECISION_REQUIRED=true`

### DECISION_3_COMPETENCE_DATE_SOURCE=REQUIRED

- **Problema:** [`competencia.ts`](../../lib/contador/competencia.ts) documenta `campoData: "dataEmissao"` e `filtroStatus: "autorizado"` — **coluna `dataEmissao` não existe** em `NotaFiscal`.
- **Candidatos:** `dataAutorizacao` (pós-SEFAZ); `createdAt`; `dhEmi` **dentro** do XML (não coluna).
- **Recomendação da auditoria (não decisão):** `dataAutorizacao` para entregáveis Opção A — é o instante que o Fiscal realmente persiste na autorização.
- **Impacto:** nota autorizada no mês seguinte à venda pode cair em outra competência.

### DECISION_4_FLAG_ROLLOUT=REQUIRED

- **Recomendação:** env `CONTADOR_FISCAL_READER` default off (`"on"` para ligar) **e** allowlist de `storeId` (sem schema), independente de `fiscalEnabled`.
- **Alternativa:** só env global (todas as lojas ao ligar) — mais arriscado.
- **Ambiente:** decidir se homologação e produção podem coexistir no mesmo pacote (herança ADR-007).
- **Impacto:** loja sem runtime não pode parecer “zero XML = ok”.

### DECISION_5_HOMOLOGATION_STORE=REQUIRED

- **Recomendação:** designar loja-piloto `HOMOLOGACAO` (ou fixture persistida) com pelo menos `AUTORIZADA` + `xmlAutorizado`; rejeitada via teste; cancelada só quando o domínio existir. Nunca Production.
- **Alternativa:** aceitar o 018 só com fixtures injetadas — enfraquece o aceite “pacote de loja homologada”.
- **Impacto:** `FISCAL_RUNTIME_VALIDATABLE` continua `false` até essa loja/fixture existir.

### DECISION_6_PURE_FISCAL_READER=REQUIRED

- **Recomendação:** não reutilizar `readAuthorizedDocument` as-is.
- **Alternativa A:** SELECT no reader do Contador.
- **Alternativa B:** primitive Fiscal no-log.
- **Impacto:** gerar o pacote mensal **não** deve appendar um `FiscalLog` por nota.

---

## 15. Charter proposto — `CONTADOR-HUB-FISCAL-INTEGRATION-018`

**Não importar / não abrir.** Rascunho para decisão humana após as DECISION_*.

### Objetivo

Reader fiscal **side-effect-free** do Contador, atrás de `CONTADOR_FISCAL_READER` (default off): notas da competência segundo predicado **aprovado**; sinais de rejeição/cancelamento no checklist; XML **persistido** (`xmlAutorizado`) em `05-XML` com sha256 no manifesto; UI só de contagem.

### Allowlist provável

- `lib/contador/readers/fiscal.ts` (**novo**)
- `lib/contador/__tests__/fiscal*.test.ts`
- `lib/contador/fechamento/montar-checklist.ts` (somente sinal `fiscal`)
- `lib/contador/pacote/fontes.ts` / `builder.ts` / possivelmente `tipos.ts` / `seguranca.ts` (teto de arquivos)
- `components/dashboard/contador/**` (relatório mínimo)
- `.env.example` (`CONTADOR_FISCAL_READER`)
- `docs/status/MOCKS_TRACKING.md`
- ADR-007 **somente depois** de Accepted por humano (texto da ADR **não** nesta auditoria)

**Proibido:** `prisma/**`; `lib/fiscal/emission/**`; providers; certificados; auth/proxy; ligar `fiscalEnabled`.

**Não pressupor** `fiscalXmlReader.readAuthorizedDocument` como porta do Contador. Reuso permitido: tipos/contratos **puros**, hash UTF-8, isolamento `storeId` como *padrão a copiar*, **não** a função que grava `FiscalLog`.

### Comportamento

Flag off → `nao_disponivel` + placeholder `05-XML`. Flag on + predicado → XML só entregáveis; falha → erro/`nao_disponivel`. Zero reconstrução via builder.

### Testes

§13.

### Gates (todos obrigatórios **antes** de implementar)

- ADR-007 **Accepted**
- Predicado entregável **aprovado por escrito**
- Política de cancelado **aprovada**
- Fonte temporal da competência **aprovada**
- Reader **realmente** side-effect-free (DECISION_6)
- Ambiente/fixture fiscal **validável** (não Production)

### Dependências

GOAL 012 **DONE**. Runtime fiscal “ativo” **não** está validável hoje (`FISCAL_RUNTIME_VALIDATABLE=false`). Schema: **não**.

### Decisões humanas ainda necessárias

DECISION_1 … DECISION_6.

---

## 16. Relatório final

```
CURRENT_MAIN=edbf724ba72b40262b87257d92ce77f46320143c
AEP_STATUS=PAUSED current_goal=null .aep-active=absent GOAL_018_OPENED=false
GOAL_017_DONE=true
GOAL_018_OPENED=false
FISCAL_MODELS=ConfiguracaoFiscalLoja,CertificadoDigital,SerieFiscal,NotaFiscal,NotaFiscalItem,EventoFiscal,FiscalEmissaoJob,FiscalLog
FISCAL_STATUS_MATRIX=RASCUNHO,VALIDANDO,ASSINADA,TRANSMITINDO,AUTORIZADA,REJEITADA,DENEGADA,CONTINGENCIA,CANCELADA,INUTILIZADA,ERRO
AUTHORIZED_STATUS=AUTORIZADA
PROTOCOL_SOURCE=NotaFiscal.protocolo (markAuthorized)
ACCESS_KEY_SOURCE=NotaFiscal.chaveAcesso (persistBeforeTransmission)
XML_SOURCE=NotaFiscal.xmlAutorizado (coluna @db.Text; xmlStorageRef no-op)
XML_IS_ORIGINAL=coluna persistida canônica; NÃO comprovado vs bytes HTTP SEFAZ
XML_HASH_AVAILABLE=computado UTF-8 na leitura; sem coluna na nota; assinado no job.payload.document.bytesSha256
XML_PERSISTED_SOURCE_CANONICAL=true
XML_PERSISTED_UTF8_IDENTITY=true
SEFAZ_TRANSPORT_BYTE_IDENTITY_PROVEN=false
CANCELLED_XML_POLICY_DECISION_REQUIRED=true
CONTADOR_FISCAL_READER_EXISTS=false
FISCAL_XML_READER_SIDE_EFFECT=true
CONTADOR_CAN_REUSE_FISCAL_XML_READER_AS_IS=false
FISCAL_PURE_READER_DECISION_REQUIRED=true
FISCAL_RUNTIME_VALIDATABLE=false
HOMOLOGATION_EVIDENCE=piloto 022 dormente; stub/mock; fixtures de teste; nenhuma loja viva comprovada
ADR_007_STATUS=Proposed
CHECKLIST_FISCAL_CURRENT_STATE=nao_disponivel
PACKAGE_05_XML_CURRENT_STATE=placeholder (05-XML/LEIA-ME.md)
ENTREGAVEL_PREDICATE_PROPOSAL=OPCAO_A_NAO_APROVADA
HUMAN_DECISIONS_REQUIRED=DECISION_1_ENTREGAVEL_PREDICATE,DECISION_2_CANCELLED_XML_POLICY,DECISION_3_COMPETENCE_DATE_SOURCE,DECISION_4_FLAG_ROLLOUT,DECISION_5_HOMOLOGATION_STORE,DECISION_6_PURE_FISCAL_READER
SCHEMA_REQUIRED=false
PROPOSED_ALLOWLIST=lib/contador/readers/fiscal.ts,lib/contador/__tests__/fiscal*.test.ts,lib/contador/fechamento/montar-checklist.ts,lib/contador/pacote/fontes.ts,lib/contador/pacote/builder.ts,components/dashboard/contador/**,.env.example,docs/status/MOCKS_TRACKING.md
TEST_PLAN=matriz status; flag off; runtime down; so entregaveis; rejeitado fora; cancelado humano; bytes coluna UTF-8; hash manifesto; cross-store; falha!=zero; pipeline intocado; sem FiscalLog no reader Contador
BLOCKERS=ADR-007 Proposed; predicado nao aprovado; cancelados; data competencia (dataEmissao inexistente); reader puro; runtime nao validavel; teto MAX_ARQUIVOS_PACOTE=15
```

```
CONTADOR_018_PASSO0_AUDIT_COMPLETE=true
READY_FOR_HUMAN_FISCAL_PREDICATE_DECISION=true
GOAL_018_OPENED=false
```

---

## 17. Escopo desta persistência

| Ação | Feito? |
|---|---|
| Documento único de auditoria | este arquivo |
| Código / Prisma / env / ADR | **não** |
| `track import/open` do 018 | **não** |
| `docs/ai/CURRENT_STATUS.md` | **não** (pedido: somente este markdown) |

Pendências: as seis DECISION_* — **nenhuma executada**.
