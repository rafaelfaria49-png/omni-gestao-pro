# CONTADOR-018 — Auditoria de prontidão de homologação fiscal

| Campo | Valor |
|---|---|
| GOAL de auditoria | `CONTADOR-018-HOMOLOGATION-READINESS-AUDIT-006` |
| GOAL alvo (não aberto) | `CONTADOR-HUB-FISCAL-INTEGRATION-018` |
| Tipo | Auditoria / planejamento **read-only** |
| Data | 2026-08-20 |
| `CURRENT_MAIN` | `a1e537cbf816b94b7f17e531811de7b118f6067f` (`fix(auth): migrar supervisor pin para hash seguro`) |
| `origin/main` após fetch | **igual** a `CURRENT_MAIN` |
| Código de aplicação alterado nesta execução | **nenhum** |
| Schema / env / AEP import-open | **nenhum** |
| Persistência desta auditoria | este arquivo + correção stale de `docs/ai/CURRENT_STATUS.md` (PR #89 já mergeado) |

Este documento define a forma **mínima e segura** de tornar o Fiscal validável para o futuro GOAL 018 **sem Production**, **sem emitir documento real** e **sem alterar o domínio Fiscal**. Não implementa reader, flag, pacote `05-XML`, loja, fixture persistida, env nem AEP import/open.

`GOAL_018_OPENED=false` · `GOAL_018_STATUS=DRAFT_NOT_IMPORTED`

Fontes imediatamente anteriores (não substituídas): [`CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md`](./CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md) (PR #88 merge `fac38130`) · [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md`](./CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md) (PR #89 merge `3a613cfd`) · ADR-CONTADOR-007 **Accepted**.

---

## 0. Pré-voo

| Checagem | Resultado |
|---|---|
| Fetch `origin/main` | feito antes de escrever |
| `HEAD` == `origin/main` (base auditada) | `a1e537cbf816b94b7f17e531811de7b118f6067f` |
| Working tree na base | limpa |
| AEP `.aep-active` | ausente (protocolo OPT-IN **não aplica**; `open` **não** executado) |
| `node scripts/track.mjs status contador` | 🟡 **PAUSED** · `current_goal=null` · `next_goal=null` |
| Caminho quente `docs/execution-tracks/contador/goals/` | **vazio** |
| Ledger (última linha) | `2026-08-19T19:06:45.065Z` `CONTADOR-HUB-OMNI-AGENT-INTEGRATION-017` → **DONE** |
| PR #89 | **MERGED** `2026-08-20T01:45:57Z` · merge `3a613cfd4c9fd4074b9a804e30e149fac003477b` · ancestral de `origin/main` |
| ADR-CONTADOR-007 na main | **Accepted** (2026-08-19; publicado via PR #89) |
| GOAL 018 | **DRAFT_NOT_IMPORTED** (`RECONCILIACAO.md` / plano 014–019; sem manifesto de importação; **não** elegível para `open`) |
| `GOAL_018_OPENED` | **false** |

```
CURRENT_MAIN=a1e537cbf816b94b7f17e531811de7b118f6067f
AEP_CONTADOR=PAUSED
current_goal=null
GOAL_018_STATUS=DRAFT_NOT_IMPORTED
GOAL_018_OPENED=false
ADR_007_STATUS=Accepted
PR_89_MERGED=true
```

---

## 1. Resíduo documental (stale PR #89)

Em `docs/ai/CURRENT_STATUS.md` (main auditada) existiam textos equivalentes a **“PR #89, merge pendente”**:

| Local | Trecho stale | Classificação |
|---|---|---|
| Lead (linha 3) | `ADR-007 Accepted (PR #89, merge pendente)` | **stale** — PR #89 já está em `origin/main` |
| Bloco Contador (linha 13) | `PR **#89**, merge humano pendente` | **stale** — idem |

Correção **somente** desses trechos neste PR docs-only. Não se alteram os registros recentes de Fiscal GOAL 030 nem de Operações V4.

Outros documentos ainda citam “merge humano pendente” (`CONTADOR_HUB_FISCAL_HOMOLOGATION_PREP_018.md`, `CONTADOR_HUB_FISCAL_PASSO0_AUDIT_018.md` §15/§18). **Fora do escopo desta execução** — registrados aqui como resíduo; não reescritos.

---

## 2. Ambientes não-Production existentes hoje

Auditoria **somente** de configuração, documentação e código. Nenhum secret revelado. Nenhum ambiente criado.

| Opção | Existe hoje? | Evidência (sem secret) | Isolado de Production? | Serve o caminho Contador 018? |
|---|---|---|---|---|
| Testes unitários / in-memory | **sim** | Vitest `environment: node`; fakes Prisma em `xml-protocol-storage.test.ts`, readers/portal/status do Contador; `vitest.config.ts` não sobe banco | sim (processo local, sem DB) | predicado, hash, competência, cross-store **unitário** — **não** é runtime Prisma real |
| Banco local / teste PostgreSQL | **parcial** | Precedente opt-in `SALE_NUMBERING_TEST_DATABASE_URL` (`lib/vendas/server-sale-numbering.integration.test.ts`) recusa host não-local. **Não** há equivalente fiscal/contador. `docker-compose.fiscal-xsd.yml` é worker XSD isolado, **sem** Postgres | se provisionado localmente, sim | **não provisionado** para `NotaFiscal` |
| Banco separado preview/staging | **não comprovado** | `.env.example` documenta `DATABASE_URL`/`DIRECT_URL` Supabase (pooler 6543 / direct 5432) **sem** segundo projeto staging nomeado. Auditoria de deploy: Preview **não** roda `migrate deploy` (`scripts/vercel-build.mjs`) | isolamento **não provado** no repo | não usar como “staging fiscal” sem prova de `DATABASE_URL` distinta |
| Vercel Preview | **sim, como deploy** | `VERCEL_ENV=preview` é ambiente de build conhecido; bucket R2 de **documentos do Contador** é separado (`omni-contador-documentos-preview` vs prod, `.env.example`) | deploy sim; **DB Fiscal não comprovadamente isolado** | não basta para `NotaFiscal` HOMOLOGACAO |
| Supabase não-Production | **não comprovado** | stack é Supabase; não há no repo um project-ref de homologação distinto do Production | desconhecido | não assumir |
| Loja/fixture `HOMOLOGACAO` já persistida | **não** | piloto GOAL 022 dormente (`nfce-homologation-pilot-wiring.ts`, `EXTERNAL_EXECUTION_DENIED`); `fiscalEnabled` default-off; nenhuma loja viva com as quatro representações pedidas | n/a | massa **não** existe em banco |
| Provider SEFAZ homologação **real** | **não operacional** | `STUB_HOMOLOGACAO` simula sem SEFAZ; `SefazDiretoProvider` é **offline** (transporte recusa; `SEFAZ_DIRETO` fora do `REGISTRY` P1); cancelar/inutilizar inertes | n/a (não transmite) | **fora** do caminho de leitura do Contador; **proibido** emitir nesta fase |

```
AVAILABLE_NON_PROD_ENVIRONMENTS=unit_in_memory; vercel_preview_deploy; r2_preview_bucket_contador_docs; opt_in_local_postgres_precedent_non_fiscal
NON_PRODUCTION_RUNTIME_AVAILABLE=false
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
```

**Conclusão:** o que existe de verdade para o 018 **hoje** é (1) bateria in-memory e (2) um precedente de Postgres local opt-in em outro módulo. Não há loja-piloto HOMOLOGACAO persistida, não há banco staging fiscal isolado comprovado, e não há SEFAZ de homologação ligável sem alterar o domínio Fiscal / gates G-F7.

---

## 3. Critério objetivo — `FISCAL_RUNTIME_VALIDATABLE`

### 3.1 Definição (vigente para o futuro 018)

`FISCAL_RUNTIME_VALIDATABLE=true` **somente** quando o caminho real abaixo puder executar em ambiente **não-Production**, com dados `ambiente=HOMOLOGACAO`, **sem provider mock no caminho que está sendo validado**:

```
Prisma
  → NotaFiscal persistida (coluna xmlAutorizado + predicado)
  → reader do Contador (SELECT side-effect-free)
  → predicado entregável (ADR-007)
  → checklist (sinal fiscal)
  → builder do pacote
  → manifest / sha256
  → pasta 05-XML
```

| O que conta | O que **não** conta |
|---|---|
| `NotaFiscal` gravada em PostgreSQL real (efêmero/local/staging isolado) | fake Prisma in-memory **sozinho** |
| SELECT do reader do Contador (Opção A) ou primitive no-log (Opção B) **sem** `FiscalLog.create` | `fiscalXmlReader.readAuthorizedDocument` as-is (grava `FiscalLog`) |
| bytes empacotados = texto UTF-8 da coluna `xmlAutorizado` | XML reconstruído por `nfce-xml-builder` / signer |
| predicado ADR-007 (inclui `ambiente == HOMOLOGACAO`) | “zero notas = ok” |
| provider **ausente** do caminho (leitura não transmite) | stub/mock de autorização no caminho sob teste |

Fixtures unitárias **continuam obrigatórias** (matriz de status, `dhEmi`, cross-store, flag off). Sozinhas **não** tornam o runtime validável.

### 3.2 Estado atual

`FISCAL_RUNTIME_VALIDATABLE=false`

Não há `NotaFiscal` HOMOLOGACAO persistida fora de teste in-memory. O checklist fiscal permanece `nao_disponivel` (fonte não consultada). `05-XML` é placeholder `LEIA-ME.md`.

---

## 4. Classificação das estratégias de homologação

Nenhuma estratégia é implementada nesta execução. Nenhuma emite NFC-e. Nenhuma usa Production.

### A. Fixtures in-memory apenas

| Dimensão | Avaliação |
|---|---|
| Isolamento de Production | **alto** |
| Fidelidade ao runtime real | **baixa** (não exercita Prisma/`@db.Text`/encoding) |
| Secrets / certificado | **não** |
| Prisma real | **não** |
| Pacote `05-XML` real | só se o builder for chamado com strings injetadas — **não** prova persistência |
| Risco operacional | **mínimo** |
| Custo de manutenção | **baixo** (já há fixtures DANFC-e / XSD / GOAL-013) |
| `FISCAL_RUNTIME_VALIDATABLE` | **não** |

Papel: **obrigatório** como camada unitária. Insuficiente como prova de runtime.

### B. Prisma + banco efêmero/local de testes com rows persistidas (**recomendada**)

| Dimensão | Avaliação |
|---|---|
| Isolamento de Production | **alto** se o DSN for local/efêmero e recusar host não-local (precedente `SALE_NUMBERING_TEST_DATABASE_URL`) |
| Fidelidade ao runtime real | **alta no caminho de leitura** (mesmo client Prisma, mesma coluna, mesmo builder) |
| Secrets / certificado | **não** (XML já persistido; sem A1, sem SEFAZ) |
| Prisma real | **sim** |
| Pacote `05-XML` real | **sim** (1 XML no lugar do placeholder cabe no teto atual — §8) |
| Risco operacional | **baixo** (opt-in; zero rede fiscal) |
| Custo de manutenção | **médio** (provisionar Postgres de teste + seed da massa mínima) |
| `FISCAL_RUNTIME_VALIDATABLE` | **sim**, quando o seed existir e o caminho §3.1 passar |

Forma **mínima e segura**. Não cria ambiente hospedado. Não altera Fiscal. Não transmite. O provider **não entra** no caminho validado.

### C. Staging / Preview com banco físico isolado

| Dimensão | Avaliação |
|---|---|
| Isolamento de Production | **alto somente se** `DATABASE_URL` for projeto/banco distinto — **hoje não comprovado** |
| Fidelidade ao runtime real | **máxima** (deploy Vercel + Prisma + pacote HTTP) |
| Secrets / certificado | storage R2 preview já é separado; DB/certificado fiscal **não** provisionar aqui |
| Prisma real | **sim**, se o banco existir |
| Pacote `05-XML` real | **sim** |
| Risco operacional | **médio-alto** se Preview compartilhasse Production (não provado que não compartilhe) |
| Custo de manutenção | **alto** (projeto Supabase, env Vercel, migrações Preview hoje **skipped**) |
| `FISCAL_RUNTIME_VALIDATABLE` | **sim**, *se* isolado — **não disponível agora** |

Não criar neste GOAL. Não é necessário se B estiver provisionado. Não usar Preview até prova explícita de DSN ≠ Production.

### D. SEFAZ HOMOLOGACAO real

| Dimensão | Avaliação |
|---|---|
| Isolamento de Production | alto *em tese* (`tpAmb=2`) | **irrelevante**: emissão está fora do 018 |
| Fidelidade ao runtime real | máxima na **emissão** — o 018 valida **leitura** |
| Secrets / certificado | **sim** (A1, CSC, credenciamento) |
| Prisma real | sim, como efeito colateral da emissão |
| Pacote `05-XML` real | sim, mas XML viria de transmissão — **proibido nesta etapa** |
| Risco operacional | **alto** (rede, certificado, G-F7, piloto 022, alterar Fiscal) |
| Custo de manutenção | **alto** |
| `FISCAL_RUNTIME_VALIDATABLE` | **não exigido** para o caminho Contador; **rejeitada** para abrir o 018 |

`SEFAZ_NETWORK_REQUIRED=false`. Piloto 022 permanece dormente. Stub/mock **não** substituem B no caminho validado; simplesmente **não são chamados**.

### Recomendação única de homologação

```
RECOMMENDED_HOMOLOGATION_STRATEGY=B
```

**B** (Prisma + Postgres efêmero/local + seed HOMOLOGACAO derivado de fixture de teste) + **A** como suíte unitária obrigatória.

C = evolução opcional depois de B, só com DSN isolado comprovado.

D = **não** para o 018 nesta fase.

---

## 5. Massa mínima de homologação

Nenhuma destas linhas é transmitida à SEFAZ. Nenhuma usa XML/dados de cliente real de Production. Seed futuro (não nesta execução) em banco **não-Production**.

Competência de referência sugerida para os casos positivos: `2026-07` (`America/Sao_Paulo`), alinhada ao `dhEmi` literal das fixtures XSD (`2026-07-14T12:00:00-03:00`). Fixtures DANFC-e usam venda `2026-06-18` — úteis para o caso “fora da competência” ou para uma competência `2026-06` dedicada.

| # | Caso | Persistência mínima | Entra em `05-XML`? | Papel |
|---|---|---|---|---|
| 1 | AUTORIZADA + vigente + HOMOLOGACAO + protocolo + chave + `xmlAutorizado` com `dhEmi` válido na competência | row `NotaFiscal` completa | **sim** | caminho feliz (único entregável) |
| 2 | AUTORIZADA fora da competência | mesmo predicado, `dhEmi` noutro mês SP | **não** na competência sob teste | não inflar zero |
| 3 | AUTORIZADA sem/`dhEmi` inválido | XML sem `ide/dhEmi` ou não parseável | **não** (DECISION_3 fail-closed) | negativo |
| 4 | REJEITADA | `status=REJEITADA`, sem `xmlAutorizado` (espelha `markRejected`) | **não** | checklist `atencao` quando flag on |
| 5 | CANCELADA **sintética** | `status=CANCELADA` + `xmlAutorizado` histórico opcional | **não** (política A) | política negativa; **não** fabricar `EventoFiscal` em banco real |
| 6 | Outra `storeId` | clone da #1 com loja B | **não** no reader da loja A | isolamento multi-loja |
| 7 | `ambiente=PRODUCAO` | mesma forma da #1, `ambiente=PRODUCAO` | **não** nesta fase | teste negativo (`PRODUCTION_XML_ELIGIBLE=false`) |

```
MINIMUM_FIXTURE_SET=autorizada_homologacao_vigente_dhemi_ok; autorizada_fora_competencia; autorizada_dhemi_invalido; rejeitada; cancelada_sintetica_politica_negativa; outra_storeId; producao_caso_negativo
```

Writer de produção de `CANCELADA` **não** existe (Passo 0). A massa #5 é **somente** row sintética para o predicado recusar o XML. Não é evento SEFAZ.

---

## 6. XML da massa

| Regra | Estado |
|---|---|
| Reusar XML de fixture já existente / derivada de artefato de teste aprovado | **sim** |
| Reconstruir XML na leitura do Contador | **proibido** |
| XML ou dados de cliente real de Production | **proibido** |
| Identidade empacotada | UTF-8 da coluna `xmlAutorizado` (ADR-0018); hash = `sha256` UTF-8 do texto persistido |

Fontes reusáveis (**não** Production):

| Artefato | Serve a massa? | Nota |
|---|---|---|
| `lib/fiscal/danfce/__fixtures__/persisted-nfce.ts` | **sim** (kinds `homologacao`, `autorizado_simples`; `producao` só para o caso negativo #7) | NFC-e 4.00 assinada com **certificado de teste**; CNPJ de fixture; `ambiente` explícito |
| `lib/fiscal/xsd/__fixtures__/nfce-xsd-fixtures.ts` | **sim** para `dhEmi` conhecido (`2026-07-14T12:00:00-03:00`) | XML de teste XSD, não SEFAZ |
| `lib/fiscal/storage/xml-protocol-storage.test.ts` | **não** como entregável | XML **sem** `ide/dhEmi` — útil só como caso #3 (dhEmi ausente), não como #1 |

O XML GOAL-013 (`nfeProc` mínimo) **não** satisfaz o predicado entregável. A massa #1 deve derivar de DANFC-e ou XSD (com `dhEmi`), persistida **como texto de coluna**, nunca re-assinada no reader.

DANFC-e `kind=producao` existe e é fixture de teste (`tpAmb=1` no envelope de teste) — usar **apenas** como caso negativo #7, nunca como entregável.

---

## 7. Reader — Opção A vs Opção B

Estado na main **depois** dos GOALs fiscais recentes (013/ADR-0018, 016D, 021 DANFC-e, 022 dormente, 030 pagamento):

| Peça | Estado |
|---|---|
| `lib/contador/readers/fiscal.ts` | **não existe** |
| `lib/contador/readers/index.ts` | `fiscal: monetarioIndisponivel(...)` + alerta informativo; **não consulta** `NotaFiscal` |
| `CONTADOR_FISCAL_READER` | só documental; **ausente** de código e `.env.example` |
| `createFiscalXmlReader` / `readAuthorizedDocument` | SELECT + **`fiscalLog.create` em toda leitura** (`acao: "fiscal.storage.authorized_read"`); ramo extra se mirror divergir |
| Primitive Fiscal **no-log** | **não existe** |
| Callers do reader com log | DANFC-e `loadDanfceForReprint` — fora do 018 |

`FISCAL_READER_AS_IS_FORBIDDEN=true` (ADR-007 DECISION_6). A vs B estava **pendente**. Esta auditoria **recomenda**; **não implementa**.

### 7.1 Opção A — SELECT side-effect-free no Contador

`lib/contador/readers/fiscal.ts`: `notaFiscal.findMany` / `findFirst` com `where: { storeId }`, `select` mínimo, **zero** `fiscalLog.create`. Contrato **próprio** do Contador (predicado ADR-007, competência por `dhEmi`, allowlist). Reusa só helpers **puros** (hash UTF-8, `resolvePeriodoUtc`, parser `dhEmi`).

Padrão já vigente: `carregarFontesComCliente` + porta `ContadorReaderClient` (vendas, financeiro, caixa).

### 7.2 Opção B — primitive Fiscal explicitamente no-log

A trilha Fiscal exporia `readAuthorizedDocumentNoLog` (ou equivalente) **nova**, estável, sem `FiscalLog`, sem mirror write. O Contador passaria a consumi-la.

Não existe hoje. Criá-la **altera `lib/fiscal`** enquanto a trilha Fiscal segue em paralelo (GOAL 030 e seguintes).

### 7.3 Comparação

| Critério | A | B |
|---|---|---|
| Dependência entre trilhas | Contador lê schema público `NotaFiscal`; Fiscal segue evoluindo emissão sem ser caller | 018 **espera** primitive nova no Fiscal |
| Risco de side effect | controlado no Contador (proibido importar `xml-storage-reader`) | baixo **depois** de existir e de prova de zero log; hoje inexistente |
| Isolamento multi-loja | `storeId` no SELECT, igual aos outros readers | igual, se a primitive exigir `storeId` |
| Duplicação de contrato | predicado/allowlist/`dhEmi` ficam no Contador (é o contrato do HUB) | duplica ou exporta o predicado para o Fiscal — o HUB ainda precisa do predicado ADR-007 |
| Estabilidade | readers do Contador já são a porta estável de fechamento/pacote | primitive nova ainda não tem callers nem testes de “no-log” |
| Impacto sobre Fiscal em paralelo | **nenhum** código Fiscal | **sim** — arquivo em `lib/fiscal/storage/**`, review da trilha fiscal |
| Testabilidade | fake `ContadorReaderClient` + suíte B em Postgres opt-in | exige fake Fiscal + acordo de API |

### 7.4 Recomendação única

```
RECOMMENDED_READER_OPTION=A
A_VS_B_DECISION_RECOMMENDATION=A
READER_OPTION_A=lib/contador/readers/fiscal.ts SELECT read-only contrato proprio do Contador
READER_OPTION_B=primitive Fiscal no-log — inexistente; nao criar so para servir o 018
```

Preferência arquitetural confirmada: **nenhuma** primitive no-log estável existe → **A**. Não alterar `lib/fiscal` só para o 018. Prova obrigatória no charter 018: **zero** `FiscalLog.create` no grafo do reader usado pelo pacote.

---

## 8. Limites do pacote

Herdados de [`lib/contador/pacote/seguranca.ts`](../../lib/contador/pacote/seguranca.ts):

| Limite | Valor | Falha |
|---|---|---|
| `MAX_ARQUIVOS_PACOTE` | **15** | `PacoteInseguroError` (não 413 de bytes) |
| `MAX_BYTES_DESCOMPACTADO` | 25 MiB | 413 / `PacoteLimiteExcedidoError` — **nunca truncar** |
| `MAX_BYTES_ZIP` | 10 MiB | idem |

Composição atual que **enche** o teto de 15:

1. 12 arquivos de conteúdo (`montarArquivosConteudo`, incl. `05-XML/LEIA-ME.md`)
2. `00-LEIA-ME/indice.md`
3. `manifest.json`
4. extra `00-FECHAMENTO/snapshot.json` (GOAL 012A)

**25 MiB / 10 MiB:** NFC-e individuais são KB. A massa mínima (#1 = um XML) **não** estoura bytes. Volume mensal real de loja viva **não** é o problema desta auditoria.

**Arquivos:** o 018 **consegue começar** com os limites atuais.

| Cenário | Cabe em 15? |
|---|---|
| Reader + predicado + checklist + testes unitários (sem XML extra) | sim (pacote inalterado) |
| Substituir `05-XML/LEIA-ME.md` por **um** `{chave}.xml` (massa #1) | **sim** (continua 15) |
| Substituir o placeholder por `{chave}.xml` **+** `05-XML/relacao.csv` (charter Passo 0) | **não** (16) |
| N XMLs da competência real | **não** |

```
PACKAGE_LIMIT_BLOCKING=false
```

Interpretado como: **não bloqueia abrir/começar** o 018. O slice `05-XML` com `relacao.csv` ou N arquivos é **gate interno do 018** (subir teto **ou** empacotar XML de outro modo). **Não** aumentar limites nesta auditoria. Homologação de **volume** fica fora da prova mínima de runtime (um XML entregável basta para §3.1).

---

## 9. Critério para importar / abrir o GOAL 018

| Gate | Valor nesta auditoria | Notas |
|---|---|---|
| `ADR_007_ACCEPTED` | **true** | PR #89 merge `3a613cfd` |
| `PREDICATE_APPROVED` | **true** | Opção A + `ambiente == HOMOLOGACAO` (DECISION_1/5) |
| `HOMOLOGATION_STRATEGY_SELECTED` | **recomendado B** — **ratificação humana ainda pendente** | esta auditoria não substitui o aceite de Rafael |
| `PURE_READER_STRATEGY_SELECTED` | **recomendado A** — **ratificação humana ainda pendente** | DECISION_6 permanece parcial até o aceite |
| `NON_PRODUCTION_RUNTIME_AVAILABLE` | **false** | B não provisionado; sem seed HOMOLOGACAO persistido |
| `PACKAGE_LIMIT_BLOCKING` | **false** | teto 15 não impede começar; impede N arquivos/`relacao.csv` no slice posterior |

```
GOAL_018_CAN_BE_OPENED_AFTER_THIS_AUDIT=false
```

O 018 **não** deve ser importado/`open` só com este PR. Ainda depende de:

1. aceite humano de **B** (homologação) e **A** (reader);
2. provisionamento do runtime não-Production (Postgres opt-in + seed da massa §5), **sem** Production e **sem** SEFAZ;
3. import AEP explícito (autorização humana; **não** nesta execução).

Depois de (1)+(2), o 018 pode ser importado com gates no charter: zero `FiscalLog`; zero `lib/fiscal/emission/**`; flag default off; `PRODUCTION_XML_ELIGIBLE=false`; teto de arquivos tratado **antes** de N XMLs.

---

## 10. O que esta execução não fez

- Código, Prisma/schema, env, secrets, loja, seed, AEP `import`/`open`.
- Emissão, consulta ou cancelamento SEFAZ.
- Escolha implementada de A vs B (só recomendação).
- Aumento de `MAX_ARQUIVOS_PACOTE`.
- Reescrita dos docs Passo 0 / PREP (stale residual registrado, não corrigido).

---

## 11. Relatório

```
CURRENT_MAIN=a1e537cbf816b94b7f17e531811de7b118f6067f
ADR_007_STATUS=Accepted
GOAL_018_STATUS=DRAFT_NOT_IMPORTED
GOAL_018_OPENED=false
AVAILABLE_NON_PROD_ENVIRONMENTS=unit_in_memory; vercel_preview_deploy; r2_preview_bucket_contador_docs; opt_in_local_postgres_precedent_non_fiscal
RECOMMENDED_HOMOLOGATION_STRATEGY=B
NON_PRODUCTION_RUNTIME_AVAILABLE=false
FISCAL_RUNTIME_VALIDATABLE=false
MINIMUM_FIXTURE_SET=autorizada_homologacao_vigente_dhemi_ok; autorizada_fora_competencia; autorizada_dhemi_invalido; rejeitada; cancelada_sintetica_politica_negativa; outra_storeId; producao_caso_negativo
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
READER_OPTION_A=lib/contador/readers/fiscal.ts SELECT read-only contrato proprio do Contador
READER_OPTION_B=primitive Fiscal no-log — inexistente
RECOMMENDED_READER_OPTION=A
A_VS_B_DECISION_RECOMMENDATION=A
PACKAGE_LIMIT_BLOCKING=false
GOAL_018_CAN_BE_OPENED_AFTER_THIS_AUDIT=false
REMAINING_BLOCKERS=ratificacao_humana_A_e_B; provisionar_postgres_efemero_local_com_seed_HOMOLOGACAO; AEP_import_open_ainda_negado; teto_15_arquivos_antes_do_slice_N_xml_ou_relacao_csv
CODE_CHANGED=false
SCHEMA_CHANGED=false
ENV_CHANGED=false
```

```
CONTADOR_018_HOMOLOGATION_READINESS_AUDIT_COMPLETE=true
READY_FOR_HOMOLOGATION_DECISION=true
GOAL_018_OPENED=false
```

**Fim da auditoria. GOAL 018 permanece não importado / não aberto. PARE.**

---

## Addendum — ratificação humana + provisionamento B (2026-08-20)

Rafael ratificou **homologação B** e **reader A**, autorizou o merge do PR **#92** e o Postgres efêmero/local com seed HOMOLOGACAO. **Não** autorizou Production, SEFAZ nem `import`/`open` do GOAL 018.

Provisionamento: [`CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md`](./CONTADOR_HUB_FISCAL_HOMOLOGATION_PROVISION_018.md).

```
HOMOLOGATION_STRATEGY_SELECTED=B
PURE_READER_STRATEGY_SELECTED=A
NON_PRODUCTION_RUNTIME_AVAILABLE=true
FISCAL_RUNTIME_VALIDATABLE=false
GOAL_018_OPENED=false
GOAL_018_CAN_BE_OPENED_AFTER_THIS_AUDIT=false
SEFAZ_NETWORK_REQUIRED=false
PRODUCTION_REQUIRED=false
REMAINING_BLOCKERS=AEP_import_open_ainda_negado; teto_15_arquivos_antes_do_slice_N_xml_ou_relacao_csv; reader_predicado_checklist_05xml_sao_GOAL_018
```

`FISCAL_RUNTIME_VALIDATABLE` segue **false** até o 018 implementar o caminho §3.1 (reader A → predicado → checklist → pacote/`05-XML`) sobre esta massa, sem mock no caminho. O teto de 15 arquivos **não** foi aumentado.

**GOAL 018 permanece não importado / não aberto.**
