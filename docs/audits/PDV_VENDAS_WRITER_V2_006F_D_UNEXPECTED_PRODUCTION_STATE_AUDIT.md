---
title: PDV-VENDAS-WRITER-V2-006F-D — Unexpected Production state audit
audit_id: PDV-VENDAS-WRITER-V2-006F-D
hub: pdv
tipo: dados
data: 2026-08-18
status: publicada
imutavel_apos: publicada
---

# PDV-VENDAS-WRITER-V2-006F-D — Auditoria do estado inesperado de Production

> **Status:** publicada · **Modo:** somente leitura
> **Classificação:** **B**
> **Escritas desta auditoria:** zero (código de aplicação, env, alias, SQL, SerieVenda, Venda, Caixa, Estoque, Financeiro, códigos de loja: intocados)
> **006G / canary / quarentenas / caixa:** não executados

## 0. Veredito executivo

| # | Entrega | Resultado |
|---|---|---|
| 1 | `origin/main` atual | `e08db423ac8b8100f3bf3b2e97405c883e63919f` |
| 2 | Production SHA atual (canônico `omni-gestao-pro`) | **`e08db42`** — avançou além de `3889f87` |
| 3 | Contrato exato da flag | `SALE_SERVER_NUMBERING_ENABLED === "true"` (exato), **e** `VERCEL_ENV === "production"`, **e** projeto canônico |
| 4 | Motivo técnico de `writer=v2` / `reason=enabled` | As três condições do gate foram satisfeitas no processo Production. **Não há fallback** que devolva `enabled` sem a env |
| 5 | Histórico da ativação | Código do gate **imutável desde `177eee8` (2026-08-04)**. A ativação **não está no Git**. Há um **redeploy** do SHA `1f15384` em **2026-08-18T01:45:10Z** (URL Vercel nova) — candidato, **não prova** |
| 6 | `series = 1` | Contagem de linhas `SerieVenda` da `loja-1` = 1 (uma série anual). **Não** é “1 venda” |
| 7 | `vendasV2 = 282` | Contagem de `Venda` da `loja-1` com `serieVendaId IS NOT NULL`. **Não** implica criação recente. Sem banco, sem timestamps |
| 8 | Timestamps/agregados | **Inacessíveis** neste ambiente (`DATABASE_URL` ausente). SQL read-only no §8 |
| 9 | 10 códigos | Contrato GET devolve o que está no banco. Os 10 pares observados no 006F-C **não estão versionados**. Confirmação independente de DB: **não**. Coerência do relatório humano: **sim** |
| 10 | Script humano 006F-C escreveu? | **Não.** `ALREADY_CONFIGURED` não existe na API. PUT idempotente seria `UNCHANGED` (200) **sem** `UPDATE`. O relato humano diz que **nenhum PUT foi necessário** |
| 11 | Riscos | Writer V2 **está vivo** em Production (PDV novo + recovery + faturamento OS). Flag **não documentada** como ligada. `CURRENT_STATUS` ainda descreve a flag como ausente |
| 12 | Revisão independente | §12 — classificação B mantida após tentativa de falsificação |
| 13 | Classificação | **B** |

**Por que não A:** o mecanismo `enabled` está coerente com o contrato, mas **não há evidência documental** (GOAL, commit, ADR, env audit) de que a flag foi ligada por autorização explícita.

**Por que não D:** o default do código continua **v1**; o gate **não mudou** entre `3889f87` e `e08db42`; o SHA de Production avançou por merge legítimo (PR #70), mas **esse delta não ativa v2**. O estado observado (`enabled` + série consumida + 282 vendas com `serieVendaId`) é **internamente coerente**, não um default quebrado.

**B significa:** sabemos **o que** `enabled` exige; **não** sabemos com prova **quando** a env foi gravada nem **se** as 282 vendas são recovery, PDV orgânico, OS, ou mistura.

**PARAR.** Não avançar para canary, 006G, recuperação de quarentenas, fechamento de caixa, cancelamento de venda, alteração de códigos, env, alias ou redeploy.

---

## 1. Escopo, método e limites

### 1.1 Dentro

- Contrato e testes de `SALE_SERVER_NUMBERING_ENABLED`.
- Capability `GET /api/ops/venda-persist/v2`.
- Histórico Git da flag, da rota v2 e do writer.
- Metadados GitHub Deployments do projeto canônico.
- Contratos `SerieVenda`, `Venda` (numeração server-side) e `PUT/GET /api/stores/numeracao-venda`.
- Relato humano do 006F-C (números, códigos, capability).

### 1.2 Fora

- 006G, canary, recovery, cancelamento, Caixa, Estoque, Financeiro.
- Alteração de env, alias, redeploy, schema, SQL de escrita.
- Módulos fora desta trilha.

### 1.3 Premissas

- O relato humano do 006F-C é tratado como **observação Production autenticada**, não como prova de origem dos 282 registros.
- Projeto canônico = `Production – omni-gestao-pro`. O legado `omni-gestao` **nunca** ativa v2 pelo gate (falha na condição de `VERCEL_PROJECT_ID` antes da flag).
- Sem `DATABASE_URL` / `DIRECT_URL` nesta worktree: **nenhuma query** foi tentada contra Production.

### 1.4 Fontes

- `origin/main` = `e08db423ac8b8100f3bf3b2e97405c883e63919f` (2026-08-18T03:33:37Z).
- GitHub Deployments API do repositório `rafaelfaria49-png/omni-gestao-pro-pdv-claude`.
- Código em `HEAD` (idêntico a `origin/main` no início desta auditoria).

---

## 2. origin/main e Production SHA

### 2.1 origin/main

```
e08db423ac8b8100f3bf3b2e97405c883e63919f
e08db42 fix(vendas): recovery histórico das quarentenas restantes
```

Ancestral esperado pela trilha anterior:

```
3889f8786491fddeec93085145f1593e97ac18fa
3889f87 fix(vendas): endurecer recovery individual de quarentena
2026-08-17T21:24:47Z
```

`3889f87` **é ancestral** de `origin/main`. Há **um** commit entre eles: `e08db42`.

### 2.2 Production canônica (`Production – omni-gestao-pro`)

Últimos deployments Production do canônico (GitHub, mais recente primeiro):

| created_at (UTC) | SHA | Notas |
|---|---|---|
| 2026-08-18T03:39:54Z | **`e08db42`** | status `success` (03:39:55Z). URL Vercel `omni-gestao-lksqns8dc-…` |
| 2026-08-17T15:00:05Z | `1f15384` | 1º success 2026-08-17T15:00:06Z (`omni-gestao-efjv89a36-…`) **e 2º success 2026-08-18T01:45:10Z** (`omni-gestao-hsq1jqoe6-…`) |
| 2026-08-16T18:07:15Z | `46e451f` | Primeiro Production **depois** do merge do Writer V2 (`ddb1697`) |

`3889f87` **nunca foi deployment Production**. Só Preview:

- `Preview – omni-gestao-pro` 2026-08-17T21:27:40Z
- `Preview – omni-gestao` 2026-08-17T21:30:05Z

### 2.3 O que o SHA esperado significava

A trilha anterior tomou `3889f87` como SHA “de Production”. Na metadata acessível:

- `origin/main` esteve em `3889f87` entre 2026-08-17T21:24:47Z e 2026-08-18T03:33:37Z;
- Production canônica **não acompanhou** esse SHA;
- Production saltou `1f15384` → `e08db42`.

Delta `1f15384..e08db42` (três commits, nenhum no gate):

1. `083a780` — recovery em lote; texto do commit: **`SALE_SERVER_NUMBERING_ENABLED permanece ausente`**
2. `3889f87` — endurecer recovery individual
3. `e08db42` — recovery histórico das 24 quarentenas restantes (PR #70)

`git diff 1f15384 e08db42 -- lib/vendas/sale-numbering-runtime-gate.ts app/api/ops/venda-persist/v2/route.ts` = **vazio**.

**Conclusão FASE 2:** Production avançou para `e08db42`. Esse avanço **não explica** `writer=v2`. Nenhum redeploy foi disparado por esta auditoria.

---

## 3. Contrato da flag (FASE 1)

Fonte: `lib/vendas/sale-numbering-runtime-gate.ts`.

### 3.1 Onde é lida

| Superfície | Uso |
|---|---|
| `resolveSaleNumberingWriter()` | Lê `process.env.VERCEL_ENV`, `VERCEL_PROJECT_ID`, `SALE_SERVER_NUMBERING_ENABLED` |
| `GET /api/ops/venda-persist/v2` | Devolve `{ ok, writer, reason }` — **capability autenticada** |
| `POST /api/ops/venda-persist/v2` | Recusa com `SALE_WRITER_V1_ACTIVE` / 409 se não for v2 |
| `app/actions/operacoes.ts` (`criarVendaDeOSAction`) | Se v2, aloca número pela mesma série do PDV |
| `lib/vendas/quarantine-recovery-service.ts` | Recovery **exige** v2 (`isRecoveryWriterEnabled`) |
| Rotas de recovery individual/lote | Mesmo gate |

O writer v1 (`/api/ops/venda-persist`) **não** consulta o gate.

### 3.2 Valor que ativa v2

Condições **cumulativas**, comparação **exata** (sem `trim`, sem case-fold):

1. `VERCEL_ENV === "production"`
2. `VERCEL_PROJECT_ID` igual a `CANONICAL_VERCEL_PROJECT_ID` (reexportado de `scripts/migration-authority-guard.mjs`)
3. `SALE_SERVER_NUMBERING_ENABLED === "true"` — único literal (`SALE_SERVER_NUMBERING_FLAG_ENABLED_VALUE`)

`reason` correspondente: `"enabled"`. `writer`: `"v2"`.

Qualquer outra combinação devolve **v1**. Ausência da flag no canônico Production: `reason = "flag-absent"` — exatamente o estado **anterior conhecido**.

### 3.3 Polaridade / default

Fail-open deliberado: ausência, `TRUE`, `1`, espaço, newline, preview, development, projeto legado → **v1**. O default **não** é v2. Teste `sale-numbering-runtime-gate.test.ts`: “v2 só aparece na única combinação autorizada”.

### 3.4 Flag equivalente?

Não. Não existe segunda env, `NEXT_PUBLIC_*`, entrada em `.env.example`, `vercel.json` ou `next.config.mjs` que ligue o writer. `MIGRATION_AUTHORITY_ENABLED` é **ortogonal** (migrations).

### 3.5 Banco pode habilitar v2?

Não. O gate **não lê Prisma**, loja, `SerieVenda`, `codigoNumeracaoVenda` nem relógio. Provisionar código **não** liga o writer (contrato 002C-0b, `store-sale-numbering-provision.ts`).

### 3.6 Fallback que devolveria `enabled` sem env?

Não. `reason: "enabled"` só é retornado no último `return` do avaliador, depois das três comparações exatas. Cliente (`classifySaleWriterCapability`) só classifica `writer === "v2"`; não inventa `enabled`.

**Motivo técnico do probe humano (`httpStatus=200`, `ok=true`, `writer="v2"`, `reason="enabled"`):** o processo Production do canônico está com `SALE_SERVER_NUMBERING_ENABLED` igual ao literal `"true"`.

---

## 4. Histórico do código (FASE 3)

| Commit | Data (UTC) | Papel |
|---|---|---|
| `177eee8` | 2026-08-04T22:25:09Z | **Introduce** o gate e a flag. Sem call site. Flag não configurada |
| `a9e1172` / PR #43 | 2026-08-05 | Provisionamento do código de loja. **Não** lê a flag |
| `ddb1697` | 2026-08-16T14:02:25Z | **Introduce** `app/api/ops/venda-persist/v2` + `persistSaleV2`. Mensagem: *“Production não é ativada nesta mudança.”* |
| `46e451f` | Production 2026-08-16T18:07:15Z | Código v2 **atrás do gate** chega a Production |
| `083a780` | 2026-08-17T15:17:45Z | Recovery em lote. *“SALE_SERVER_NUMBERING_ENABLED permanece ausente”* |
| `3889f87` | 2026-08-17T21:24:47Z | Recovery individual. **Gate byte-idêntico** |
| `e08db42` / PR #70 | 2026-08-18T03:33:37Z | Recovery histórico. **Gate byte-idêntico**. Production 03:39:54Z |

`git log --follow -- lib/vendas/sale-numbering-runtime-gate.ts` tem **um** commit: `177eee8`. Nenhum commit posterior altera o default ou relaxa a flag.

Não há GOAL versionado nesta worktree que grave `SALE_SERVER_NUMBERING_ENABLED=true` em Production.

Candidato **não conclusivo** para o instante da env: o **segundo** status `success` de `1f15384` em 2026-08-18T01:45:10Z, com URL Vercel **diferente** da do deploy original. Isso é o padrão de **rebuild Production do mesmo SHA** (típico de mudança de env). Outras envs também disparam rebuild. Sem o audit log da Vercel, **não prova** qual variável mudou.

---

## 5. Significado dos dados da loja-1 (FASE 4)

Fonte do relato humano: leitura de `readStoreSaleNumberingStatuses` via `GET /api/stores/numeracao-venda`. Campos reais:

```ts
uso: { series, vendas, consumido }
imutavel === uso.consumido
```

O rótulo `vendasV2` do script humano = `uso.vendas`.

### 5.1 `series = 1`

`SELECT count(*) FROM series_venda WHERE "storeId" = 'loja-1'`.

Uma linha `SerieVenda` por `(storeId, ano)`. Valor 1 = **uma série anual** existente (muito provavelmente 2026 + prefixo snapshot `L01`). **Não** é o próximo número e **não** é a quantidade de vendas.

A série nasce no **primeiro** `allocateSaleNumber` (`ensureSerieVenda` → `serieVenda.create`, `proximoNumero` default 1). Call sites produtivos:

- Writer V2 PDV (`persistSaleV2` → allocator)
- Recovery de quarentena (mesmo `persistSaleV2`)
- `criarVendaDeOSAction` quando o gate está em v2 (`allocateSaleNumberForWriter`)

### 5.2 `vendasV2 = 282`

```ts
prisma.venda.count({ where: { storeId: "loja-1", serieVendaId: { not: null } } })
```

São 282 vendas da `loja-1` **já ligadas a uma série**. Isso inclui PDV v2, recovery via v2 e faturamento OS v2. **Exclui** o histórico v1 (`serieVendaId` nulo).

Não significa “282 vendas criadas no 006F-C” nem “282 vendas hoje”. Provisionamento de código **não cria** `Venda`. Recovery do PR #70 fala em **24** quarentenas restantes — número distinto de 282.

`numeracaoOrigem` **não** distingue v2: o writer grava o enum `SERVER_V1` (não existe `SERVER_V2` no schema). Discriminante canônico: `serieVendaId IS NOT NULL`.

### 5.3 `consumido = true` / `imutavel = true`

`consumido` é `true` **sempre que existe pelo menos uma `SerieVenda`**, mesmo com zero vendas. Aqui há 282 vendas, então a série foi de fato usada.

Efeito: `PUT` de código **diferente** retorna `IMMUTABLE` / 409. Repetir o **mesmo** código continua `UNCHANGED` (idempotente).

Número comercial alocado: `VDA-{PREFIXO}-{ANO}-{NNNNNN}` (padding 6). Para `L01` / 2026 o primeiro seria `VDA-L01-2026-000001`. O maior número consumido espera-se `proximoNumero - 1` na série ativa (incremento atômico na mesma transação da venda; rollback desfaz o incremento).

### 5.4 Banco Production nesta auditoria

`DATABASE_URL` e `DIRECT_URL` **ausentes**. Nenhuma query executada.

---

## 6. SQL read-only para gate humano (FASE 4)

Executar em transação `READ ONLY` no banco **canônico** (não no legado). Não aplicar, não `UPDATE`, não criar série.

```sql
BEGIN TRANSACTION READ ONLY;

-- A) códigos das 10 lojas (contrato GET)
SELECT id, name, "codigoNumeracaoVenda"
FROM stores
ORDER BY id;

-- B) série(s) da loja-1
SELECT id, "storeId", ano, prefixo, "proximoNumero", ativo, "createdAt", "updatedAt"
FROM series_venda
WHERE "storeId" = 'loja-1'
ORDER BY ano;

-- C) agregados de Venda V2 (serieVendaId NOT NULL) da loja-1
SELECT
  count(*) AS vendas_com_serie,
  min(at) AS primeira_at,
  max(at) AS ultima_at,
  min("numeradaEm") AS primeira_numerada_em,
  max("numeradaEm") AS ultima_numerada_em,
  min("numeroSequencial") AS menor_seq,
  max("numeroSequencial") AS maior_seq,
  count(*) FILTER (WHERE payload ? 'recovery') AS com_payload_recovery,
  count(*) FILTER (WHERE payload #>> '{origem}' = 'os') AS origem_os
FROM vendas
WHERE "storeId" = 'loja-1'
  AND "serieVendaId" IS NOT NULL;

-- D) origem declarada (atenção: writer v2 grava SERVER_V1)
SELECT "numeracaoOrigem", count(*)
FROM vendas
WHERE "storeId" = 'loja-1'
  AND "serieVendaId" IS NOT NULL
GROUP BY 1;

-- E) conferência do número 282 e da série única
SELECT
  (SELECT count(*) FROM series_venda WHERE "storeId" = 'loja-1') AS series,
  (SELECT count(*) FROM vendas WHERE "storeId" = 'loja-1' AND "serieVendaId" IS NOT NULL) AS vendas_v2,
  (SELECT "proximoNumero" - 1 FROM series_venda WHERE "storeId" = 'loja-1' ORDER BY ano DESC LIMIT 1) AS maior_reservado_esperado;

ROLLBACK;
```

Interpretação mínima para o gate:

- Se `primeira_numerada_em` for **anterior** a 2026-08-18T01:45Z, a flag (ou um writer v2 efetivo) já operava **antes** do rebuild candidato.
- Se as 282 tiverem `payload.recovery`, a massa é **recovery**, não canary recente.
- Se `maior_seq` ≈ 282 e `proximoNumero` ≈ 283, a série está **contígua e coerente**.

---

## 7. Códigos e `ALREADY_CONFIGURED` (FASE 5)

### 7.1 Contrato da rota

`PUT /api/stores/numeracao-venda` **não** devolve `ALREADY_CONFIGURED`. Resultados:

| `provisionStoreSaleNumberingCode` | HTTP | Body | Escrita |
|---|---|---|---|
| `SAVED` | 200 | `{ ok: true, unchanged: false, store }` | `UPDATE` + auditoria |
| `UNCHANGED` | 200 | `{ ok: true, unchanged: true, store }` | **Nenhuma** (mesmo código já persistido; sem auditoria) |
| `IMMUTABLE` | 409 | código imutável | Nenhuma |
| `INVALID` / `CONFLICT` / `STORE_NOT_FOUND` | 400/409/404 | erro | Nenhuma |

`GET` devolve `{ stores: Status[] }` com HTTP 200. Status inclui `codigo`, `configurado`, `imutavel`, `uso.{series,vendas,consumido}`.

O literal `ALREADY_CONFIGURED` **não existe** no repositório. É rótulo **do script humano**. Combinado com “não precisou fazer PUT” e HTTP 200: o script leu o GET (ou teria recebido `UNCHANGED` se tivesse PUT o mesmo valor). **Em ambos os casos não há escrita de código.**

Confirmação: os 10 códigos **já estavam persistidos** antes do 006F-C. O script **não** foi a origem de `L01`…`LTCX`.

### 7.2 Mapa relatado (não versionado)

Nenhum seed, constante ou teste do repositório contém `L01` / `LTCX`. O mapa abaixo é o **relato 006F-C**, coerente com `totalStores=10`, `configured=10`, `allUnique=true`, listas vazias de inválidos/duplicados/mismatch:

| storeId | codigo |
|---|---|
| loja-1 | L01 |
| loja-2 | L02 |
| loja-5 | L05 |
| loja-6 | L06 |
| loja-7 | L07 |
| loja-8 | L08 |
| loja-9 | L09 |
| loja-10 | L10 |
| loja-11 | L11 |
| loja-teste-caixa | LTCX |

Esta auditoria **não alterou** códigos. Confirmação SQL: query A do §6.

---

## 8. Coerência vs regressão

Evidência de que **não** é um default de código invertido:

- Gate inalterado desde 2026-08-04.
- Testes exigem a combinação única para v2.
- `083a780` ainda documenta a flag como ausente no momento daquele merge.

Evidência de que os 282 **podem ser dados legítimos já existentes**:

- Só `allocateSaleNumber` preenche `serieVendaId`.
- Série + 282 + código imutável é o estado **esperado** após uso real do writer v2 (PDV e/ou recovery e/ou OS), não o estado de um PUT de código.
- 006F-C não cria vendas.

Evidência **insuficiente**:

- Quando a env foi gravada (Vercel env audit inacessível).
- Primeira/última `numeradaEm` (banco inacessível).
- Se 282 ≈ recovery histórico vs vendas orgânicas.

O probe anterior `writer=v1` / `flag-absent` e o probe atual `writer=v2` / `enabled` diferem **somente** pela presença do literal `"true"` no processo. Não diferem pelo SHA `3889f87`→`e08db42`.

---

## 9. Riscos encontrados

| ID | Sev. | Risco |
|---|---|---|
| R-1 | P0 operacional | Writer V2 **está ativo** em Production. PDV autenticado que probeia a capability passa a POST `/api/ops/venda-persist/v2`. Recovery deixa de estar bloqueado pelo gate. Faturamento de OS usa a série server-side |
| R-2 | P1 governança | Ativação da flag **não está versionada** (nem GOAL, nem ADR, nem `CURRENT_STATUS`). `CURRENT_STATUS` ainda afirma que a flag não foi configurada em ambiente algum |
| R-3 | P2 evidência | 282 vendas com série na `loja-1` **sem** timestamps nesta auditoria. Não se pode afirmar “regressão recente” nem “canary acidental do 006F-C” |
| R-4 | P2 metadata | SHA esperado `3889f87` **nunca serviu Production**. Quem operar sobre esse pressuposto está olhando Preview |
| R-5 | P3 contrato | Enum `numeracaoOrigem` grava `SERVER_V1` no caminho v2 — armadilha de auditoria futura |
| R-6 | informativo | Comentário obsoleto no gate (“neste GOAL o gate NÃO tem call site”) — documental, sem efeito de runtime |

Nada disto autoriza desligar a flag, redeployar, ou “consertar” os 282 registros.

---

## 10. O que esta auditoria NÃO fez

- Não alterou `SALE_SERVER_NUMBERING_ENABLED`.
- Não redeployou, não moveu alias.
- Não criou `SerieVenda` nem `Venda`.
- Não executou canary nem 006G.
- Não recuperou quarentenas.
- Não cancelou venda, não fechou caixa, não tocou Estoque/Financeiro.
- Não modificou códigos de loja.
- Não atualizou `docs/ai/CURRENT_STATUS.md` (o estado “flag ligada” só deve ser publicado depois do gate humano sobre A/B/D).

---

## 11. Entregáveis 1–13 (checklist)

1. **origin/main:** `e08db423ac8b8100f3bf3b2e97405c883e63919f`
2. **Production SHA canônico:** `e08db423ac8b8100f3bf3b2e97405c883e63919f` (Ready 2026-08-18T03:39:55Z). `3889f87` não foi Production
3. **Flag:** `SALE_SERVER_NUMBERING_ENABLED === "true"` + production + projeto canônico
4. **Motivo técnico:** gate devolve `{ writer: "v2", reason: "enabled" }` só nessa tríade; o probe 200 confirma a tríade no processo
5. **Histórico:** flag introduzida em `177eee8`; call site em `ddb1697`; Production com código v2 desde `46e451f`; **ativação da env fora do Git**; rebuild candidato `1f15384` @ 2026-08-18T01:45:10Z
6. **`series=1`:** uma `SerieVenda` da `loja-1`
7. **`vendasV2=282`:** 282 `Venda` com `serieVendaId` na `loja-1` — não necessariamente recentes
8. **Timestamps:** SQL §6; não executado aqui
9. **Códigos:** mapa do 006F-C; GET lê o banco; não versionado; não alterado
10. **Escrita do script humano:** nenhuma evidência de PUT efetivo; contrato `UNCHANGED`/`GET` = zero `UPDATE`
11. **Riscos:** §9
12. **Revisão independente:** §12
13. **Classificação: B**

---

## 12. Revisão independente (falsificação)

Tentativas de derrubar o veredito:

| Hipótese | Resultado |
|---|---|
| “O default do código passou a v2 depois de `3889f87`.” | **Falsa.** Diff do gate `3889f87..HEAD` vazio. Único commit do arquivo: `177eee8` |
| “`reason=enabled` pode sair com flag ausente.” | **Falsa.** Teste da matriz: só `{canonical production + "true"}` habilita v2. Ausência → `flag-absent` |
| “O banco liga o writer.” | **Falsa.** Gate não lê DB. Provisionamento é estático-proibido de mencionar a flag |
| “Production ainda está em `3889f87`.” | **Falsa.** Último success canônico é `e08db42`. `3889f87` só Preview |
| “O SHA `e08db42` é o que ligou v2.” | **Falsa.** Esse commit não toca o gate. Ligar v2 exige a env |
| “006F-C criou as 282 vendas ao configurar códigos.” | **Falsa.** PUT de código não chama allocator. Relato: nenhum PUT |
| “`series=1` significa uma venda.” | **Falsa.** É `count(SerieVenda)` |
| “282 vendas = as 24 quarentenas do PR #70.” | **Não sustentada.** 24 ≠ 282. Sem timestamps, origem indefinida |
| “Estado inconsistente (v2 sem série / série sem código).” | **Não observado.** Relato: código `L01`, configurado, série 1, 282 vendas, imutável — internamente coerente |
| “Classificação A (ativação legítima documentada).” | **Não sustenta.** Sem GOAL/env audit que autorize a flag |
| “Classificação D (default errado / deploy que quebra o gate).” | **Não sustenta.** Default v1 intacto; deploy extra não muda o gate |

A classificação **B sobrevive**. O único fato técnico fechado é: **a env `"true"` está efetiva no processo Production canônico agora.** O *quando/quem/autorização* e a *origem das 282* permanecem abertos até o SQL §6 e o audit log da Vercel.

---

## 13. Próximo passo permitido (não executado)

Somente gate humano:

1. Rodar o SQL §6 em `READ ONLY`.
2. Consultar o audit log de env da Vercel no projeto `omni-gestao-pro` / Production (quem alterou `SALE_SERVER_NUMBERING_ENABLED` e quando).
3. Só então decidir A (coerente e autorizado) vs D (ativação indevida), se a evidência nova fechar o buraco que hoje força **B**.

Não executar 006G. Não canary. Não recuperar quarentenas. Não fechar caixa.
