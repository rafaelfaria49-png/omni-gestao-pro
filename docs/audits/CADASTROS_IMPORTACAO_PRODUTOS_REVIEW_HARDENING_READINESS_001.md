# CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-READINESS-001

**Tipo:** readiness independente (auditoria empírica de terceiro)
**Branch auditada:** `goal/cadastros-importacao-produtos-review-hardening-001`
**Branch da auditoria:** `audit/cadastros-importacao-produtos-review-readiness-001`
**Data:** 29–30/07/2026
**Autor:** Claude Code (Opus 5) — sessão de readiness

> Esta auditoria **não presumiu** que o relatório anterior estava correto. As provas
> críticas foram reproduzidas contra **PostgreSQL 17 real** e contra a **aplicação rodando**.

---

## 1. Classificação

### 🔴 **C — CORREÇÕES OBRIGATÓRIAS. Merge NÃO recomendado.**

O motivo não é a qualidade do código de domínio — que é boa, coesa e bem testada —
mas o fato **empiricamente comprovado** de que a entrega principal da branch (os
filtros de importação server-side) **não funciona na aplicação rodando**: o caminho
SQL bruto falha com `SQLSTATE 42804` em **100% das chamadas** e degrada
silenciosamente para um fallback que devolve dados **materialmente errados**, sem
qualquer erro visível ao operador.

Três dos dez filtros são **no-op completo** (devolvem o catálogo inteiro) e um
devolve **superset** que marca códigos de fornecedor legítimos como sintéticos.

Próximo GOAL: **`CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-CORRECTIONS-001`**

### Checklist de gate A/B

| Requisito para A/B | Estado |
|---|---|
| PostgreSQL real aprovado | ⚠️ Aprovado no SQL isolado; **reprovado na aplicação** (F-02) |
| Visual aprovado | ⚠️ UI excelente, mas **exibe números errados** (F-02) |
| Node 20 aprovado | ✅ |
| Fixture Martins aprovada | ⚠️ 12 de 13 critérios; **reprovado** em "produtos inativos" (F-05) |
| Isolamento multi-loja aprovado | ✅ (sem exceção) |
| Domínio multipart aprovado | ⚠️ Defeito confirmado, porém **inalcançável** hoje (F-06) |
| Zero acesso remoto | ✅ |

---

## 2. Commits auditados

Intervalo validado — **4 commits, lineares, sem merge commit**:

| SHA | Mensagem |
|---|---|
| `53c5c01` | fix(importacao): corrigir identidade e dedupe de produtos |
| `3188804` | feat(cadastros): adicionar conferencia de produtos por lote |
| `4f4264f` | fix(cadastros): alinhar ficha fiscal estoque e score |
| `1bdc5d8` | docs(importacao): documentar contrato de produtos e reparo do Martins |

Pré-flight confirmado:

- `origin/main` = `79176891ccc8e336339df69bfa2fc2e609cfc0db` (`7917689`) — **base original da branch**;
- `origin/goal/...` = `1bdc5d83cf5eeb73ae8b5fed9d19b1a6b74c1d7e` (`1bdc5d8`);
- **main NÃO avançou** desde a criação da branch → divergência = 4 commits à frente, 0 atrás, **sem conflito possível**;
- `prisma/schema.prisma` **intacto**; `prisma/migrations/**` **intacto**;
- **nenhum** arquivo de área protegida tocado (`auth.ts`, `auth.config.ts`, `proxy.ts`, `lib/prisma.ts`, `next.config.mjs`, `tsconfig.json`, `lib/financeiro/contracts/*`, `AppShell.tsx`) — varredura por padrão retornou vazio.

### Inventário do diff

41 arquivos · **+6841 / −244**

| Camada | Arquivos | Observação |
|---|---|---|
| Server Actions | `app/actions/cadastros.ts` (+574) | listagem paginada, filtros JSONB, conferência |
| API route | `app/api/import/advanced/route.ts` (+84) | contexto do lote, preview de produtos |
| Domínio novo (puro) | `lib/cadastros/importacao-produtos/**` (19 arquivos) | matching, sku, metadata, escrita, precificação, alertas, categoria, fixture |
| Importador | `lib/importador-avancado/{detector,merger,persistidor,types}.ts` | +479 no persistidor |
| Score | `lib/cadastros/produto-quality-score.ts` (+201) | |
| UI | 8 componentes (2 novos: `ConferenciaLoteProdutos.tsx` 707, `PreviewProdutosLote.tsx` 288, `ContextoProdutosLote.tsx` 281) | |
| Doc | `docs/modules/reports/IMPORTACAO_PRODUTOS_CONTRATO.md` (+231) | |
| Testes | 11 arquivos `*.test.ts` | 206 testes |

---

## 3. Ambiente controlado

| Item | Valor |
|---|---|
| Node | **v20.19.5** (portátil oficial, `nodejs.org/dist/v20.19.5/node-v20.19.5-win-x64.zip`, extraído no scratchpad) |
| npm | **10.8.2** |
| Prisma CLI / Client | **6.19.3** |
| Query Engine | `c2990dca591cba766e3b7ef5d9e8a84796e47ab7` |
| PostgreSQL | **17.10** (`x86_64-windows`, msvc-19.44.35227) |
| Cluster | **descartável**, `initdb` próprio no scratchpad, `--locale=C -E UTF8` |
| Host/porta | `127.0.0.1:55433` (`listen_addresses = '127.0.0.1'`) |
| Banco | `omni_readiness_import_001` |
| Usuário | `readiness_owner` (local descartável) |
| Worktree | `C:\tmp\omni-gestao-cadastros-import-review-readiness` |

**Zero acesso remoto.** Guard executado antes de cada comando Prisma: aborta se a URL
contiver `neon.tech` ou não casar `127.0.0.1:55433/omni_readiness_import_001`.
Nenhum `db push`, `migrate deploy` ou `migrate resolve` remoto. Neon **não foi tocado**.
Produtos reais da Martins **não foram reimportados** em produção.

Docker/Podman **não disponíveis** na máquina (preferência 1 indisponível) → usada a
**preferência 2/3**: binários PostgreSQL 17 locais com cluster próprio e isolado.

`prisma db push` executado **exclusivamente** nesse banco local (autorizado pelo GOAL,
pois a cadeia histórica não é bootstrap-complete). Schema aplicado sem erro.

### Massa de dados semeada

`loja-1` = 2 produtos · `loja-2` = **5.023 produtos**

- 5.000 em massa com variantes de metadata: `lote-a` pendente/hoje (500), `lote-b` revisado/antigo (500), legado `{ncm,cest}` no topo (500), canônico `{fiscal:{ncm,cest}}` (500), `{}` vazio (500), `null` (2.500);
- **13 Martins no estado degradado fiel**: `sku` `linha-1..13`, `barcode NULL`, `brand` = categoria slugada, `category` = categoria slugada, preço 0, estoque 0, `active: true`, `metadata: null`;
- adversariais nomeados: 2 produtos de mesmo nome, `IMP-4471` e `IMP-9902` legítimos, `gc-linha-77` e `IMP-mercearia-arroz-tipo1` sintéticos, marca curada (`Duracell`), marca == categoria por escolha do operador;
- **mesmo EAN `7892840819170` na loja-1 e na loja-2** (produtos distintos).

> Nota de schema relevante: `@@unique([storeId, barcode])` impede mais de um `barcode = ''`
> por loja. "Barcode vazio" no estado degradado é portanto **`NULL`**, não string vazia —
> exatamente como a fixture da branch já modela. O filtro `semBarcode` cobre os dois casos.

---

## 4. Revisão de código

### Aprovado sem ressalva

| Item | Veredito | Evidência |
|---|---|---|
| SQL bruto parametrizado | ✅ | Todo valor de usuário via `${}` (bind). `batchId`, `fornecedorNome`, `categoria`, `marca`, `q`, `storeId` |
| Ausência de `$queryRawUnsafe` | ✅ | Nenhuma ocorrência no diff. As 8 ocorrências no repo estão em `scripts/reset-*.ts` e `app/api/debug/**`, **fora do diff** |
| `ORDER BY` sem interpolação de cliente | ✅ | `ordenacaoSqlProdutos` é allowlist por `switch` (`cadastros.ts:1189-1209`) |
| Isolamento por `storeId` | ✅ | `storeId` é sempre a **primeira** condição (`cadastros.ts:1515`); fallback Prisma também (`:1396`) |
| `batchId` como entrada não confiável | ✅ | `trim()`, bind, e **nunca** sozinho: `aplicarConferenciaLote` exige `id ∈ ids AND storeId`, e revalida `batchId` por item (`:2155-2170`) |
| Regex de SKU sintético | ✅ | `IMP_GERADO_RE` exige dois segmentos → `IMP-4471` **não** casa (`sku.ts:20`) |
| Matching (barcode/sku/fornecedor/nome) | ✅ | Conflito de identidade primeiro; nome ambíguo é fail-closed (`matching.ts`) |
| Preservação de metadata | ✅ | `mergeImportacaoIntoMetadata` faz spread da base → `fiscal`/`atributos`/`acessorios` sobrevivem (`metadata.ts:137`) |
| Limite do histórico | ✅ | `IMPORTACAO_HISTORICO_MAX = 10`, dedupe por `batchId` |
| Política de estoque | ✅ | `PatchAtualizacaoProduto` **não possui** as chaves `stock` nem `active` — preservação é **estrutural**, não condicional (`escrita.ts:110-120`) |
| Preço/custo preservados | ✅ | `price` só quando `linha.preco > 0`; `precoCusto` só quando `> 0` |
| Marca curada | ✅ | Limpa **apenas** quando é cópia da categoria (`escrita.ts:141`) |
| Precificação | ✅ | Markup vs margem bruta separados; acréscimo sobre **custo**; arredondamento `,90`/`,99` nunca desce |
| Tratamento de falha parcial | ✅ | `try/catch` por linha; erro em uma linha não aborta o lote |

**Nenhuma consulta ou mutation permite acessar produto de outra loja conhecendo apenas
`productId` ou `batchId`** — verificado por leitura e por teste (§7).

### Ressalvas de código (não bloqueantes)

- **`persistidor.ts:506,529`** — `findUnique`/`update` chaveados só por `id`. Seguro porque `alvo` vem de consulta escopada por `storeId`, mas depende do invariante em vez de reafirmá-lo. Sugestão: `findFirst({ where: { id, storeId } })`.
- **`cadastros.ts:2191,2200`** — `ativados++` / `revisados++` incrementam **antes** do `try/catch` do `update`. Em falha parcial, os contadores reportam mais do que foi gravado (`atualizados` está correto).
- **`cadastros.ts:1547`** — `fornecedorNome` usa `ILIKE ${valor}` **sem escapar** `%`/`_`, enquanto o fallback usa `equals`. Divergência semântica entre os dois caminhos (ver F-04).
- **`persistirImportacao` não é transacional.** Falha no meio deixa escrita parcial. É deliberado e documentado (idempotência vem do matching), mas deve constar no contrato.

---

## 5. 🔴 F-02 (P0) — Caminho SQL bruto falha em runtime e degrada em silêncio

**BLOQUEIA MERGE.**

### O que acontece

Na aplicação rodando (Next.js 16.2.0 + webpack, Node 20), **toda** chamada a
`listProdutosPaginado` que ativa o caminho raw falha com:

```
prisma:error Invalid `prisma.$queryRaw()` invocation:
Raw query failed. Code: `42804`.
Message: `ERROR: argument of WHERE must be type boolean, not type jsonb`
```

**27 ocorrências** registradas no log do dev server durante a validação visual.

O `catch` (`cadastros.ts:1638`) captura, loga em `console.error` e **cai no fallback
Prisma** — sem erro na UI, sem toast, sem indicação de degradação.

### Causa raiz

O objeto `Prisma.Sql` devolvido por `Prisma.join(sqlConditions, " AND ")` **não é
reconhecido como SQL** pelo template tag `$queryRaw` no runtime empacotado pelo
Next.js. Em vez de ser interpolado como texto, é **serializado como parâmetro** →
a query chega ao Postgres como `WHERE $1` com `$1` de tipo `jsonb` → `42804`.

Sintoma clássico de **duas instâncias do runtime do Prisma Client** no bundle
(camada de Server Actions vs. camada Node), quebrando o `instanceof Sql`.

### Por que os testes não pegaram

Sob Vitest (import direto, sem bundler) o `instanceof` funciona e o caminho raw
roda **perfeitamente** — reproduzi 24/24 asserções corretas. O defeito só existe
**depois do bundler**. Nenhum teste da branch exercita a rota/action através do
build do Next.

### Consequência medida (loja-2, 5.023 produtos)

Contagens autoritativas obtidas por **SQL escrito à mão** vs. o que a **UI exibe**:

| Filtro | SQL autoritativo | UI (fallback) | Veredito |
|---|---|---|---|
| Última importação | 13 | 13 | ✅ |
| Importados hoje | 513 | **5023** | 🔴 **no-op — devolve tudo** |
| Pendentes de revisão | 513 | 513 | ✅ |
| Revisados | 500 | 500 | ✅ |
| batchId específico | 500 | 500 | ✅ |
| Fornecedor | 1250 | 1250 | ✅ |
| Sem código de barras | 4 | 4 | ✅ |
| SKU sintético | **3** | **5** | 🔴 **superset: marca `IMP-4471` e `IMP-9902` legítimos** |
| NCM ausente | **4010** | **5023** | 🔴 **no-op — devolve tudo** |
| CEST ausente | **4016** | **5023** | 🔴 **no-op — devolve tudo** |

`hoje`, `semNcm` e `semCest` **não têm equivalente Prisma** e são descartados no
fallback (`cadastros.ts:1390-1392`) com apenas um `console.warn`. O operador vê o
catálogo completo e conclui que **nenhum** produto tem NCM/CEST pendente — o oposto
da verdade. Para um HUB que alimenta emissão fiscal, isso é um risco de decisão real.

`skuSintetico` usa no fallback um superset declaradamente aproximado
(`startsWith "IMP-"`, `cadastros.ts:1380-1389`) que sinaliza como "sintético" o
código de fornecedor legítimo `IMP-4471` — exatamente o caso que `sku.ts:20` foi
escrito para proteger.

### Escopo / origem

**Pré-existente na infraestrutura.** `origin/main` já tem
`Prisma.join(sqlConditions, " AND ")` + `$queryRaw` no mesmo formato, para o ranking
de relevância da busca textual — que, portanto, **também está degradado em produção
hoje** (a busca retorna as linhas certas via fallback, mas **sem ranking**).

**O que a branch faz de novo:** roteia **10 filtros de usuário** por esse caminho
quebrado. O defeito não é introduzido, mas passa de "ranking silenciosamente perdido"
para "**dados errados exibidos como verdade**".

### Correção mínima recomendada (para o próximo GOAL)

1. **Provar o bundling.** Em `app/actions/cadastros.ts`, logar
   `whereSql instanceof Prisma.Sql` antes do `$queryRaw`. Se `false`, confirma a
   duplicação de runtime.
2. **Correção estrutural (preferida):** garantir uma única instância do Prisma Client.
   Avaliar `serverExternalPackages: ["@prisma/client", ".prisma/client"]` em
   `next.config.mjs` — **área protegida, exige autorização explícita**.
3. **Correção alternativa sem tocar em config:** eliminar o `Prisma.join` do caminho
   crítico, montando uma única template tag contígua (sem nesting de `Sql`), ou
   expressar os filtros JSONB via `where` nativo do Prisma. `metadata.path` já cobre
   `batchId`/`statusRevisao`; `semNcm`/`semCest` são expressáveis com
   `OR: [{ metadata: { path: [...], equals: Prisma.DbNull } }, ...]`.
4. **Fail-closed obrigatório:** enquanto o fallback perder filtros, **não** devolver
   resultado silenciosamente. Ou propagar o erro para a UI, ou devolver
   `{ produtos: [], total: 0, degradado: true }` e exibir aviso. **Nunca** devolver o
   catálogo inteiro para um filtro restritivo.
5. **Teste de regressão que o bundler não escape:** um teste que chame a rota/Server
   Action com o build do Next (ou um `instanceof` assertion), não só o módulo importado.

---

## 6. 🟠 F-05 (P1) — Reparo não inativa produtos com preço zero

O GOAL exige, para o primeiro import: **"produtos inativos"**. **Não acontece.**

Estado dos 13 Martins **após o reparo** (`SELECT` direto):

```
 name                           | active | status | price | stock | sku |    barcode
--------------------------------+--------+--------+-------+-------+-----+---------------
 ACHOC.TODDY ORIGINAL POTE 750G | t      | Ativo  |     0 |     0 |     | 7892840819170
 ... (13 linhas, todas active = t, price = 0)
 ativos_preco_zero = 13
```

Causa: `montarAtualizacaoProduto` **omite deliberadamente** `active`
(`escrita.ts:10` — *"planilha sem preço não inativa cadastro vivo"*). Produto que já
estava ativo continua ativo.

**Assimetria comprovada:**

- produto **NOVO** sem preço → nasce **inativo** (`ativacaoDeProdutoNovo`);
- produto **EXISTENTE** sem preço → permanece **ATIVO** e portanto vendável a R$ 0,00.

Os 13 produtos reais da Martins estão hoje em produção `active = true, price = 0`.
Rodar o reparo **não fecha** esse buraco.

**Mitigação existente:** a conferência classifica-os como `incompleto` (a
incompletude domina o `statusRevisao`) e o filtro "Sem preço de venda" os encontra.
O operador **vê** o problema — mas nada o **impede** de vender.

**Decisão necessária (humana, não da auditoria):** ou
(a) o reparo passa a inativar produto com `preco <= 0` — mudança de política, precisa
ADR porque contraria o invariante declarado; ou
(b) o critério do GOAL é formalmente revisado para "permanecem ativos, sinalizados
como incompletos". Enquanto não houver decisão, o critério do GOAL está **reprovado**.

---

## 7. Fixture Martins — 26/26 asserções contra PostgreSQL real

A suíte da branch (`martins-regressao.test.ts`, 524 linhas) roda com **banco fake em
memória**. Esta readiness executou o **mesmo pipeline** (`detectarDominio` →
`agruparEMerge` → `planejarProdutosDoLote` → `persistirImportacao`) contra o
**PostgreSQL 17 real**, com os 13 produtos degradados já no banco.

### Preview 1 (sobre estado degradado)

| Critério do GOAL | Resultado |
|---|---|
| 0 criações | ✅ |
| 13 atualizações | ✅ |
| 0 conflitos | ✅ |
| 13 correspondências por nome exato | ✅ `matchPor === "nome_exato"` em todas |
| alerta de match por nome em todas | ✅ |
| nenhuma mutation durante preview | ✅ `count` e **todos os `updatedAt` inalterados**; SKU sintético e `barcode NULL` intactos |

### Import 1 (reparo real)

| Critério do GOAL | Resultado |
|---|---|
| remoção dos 13 SKUs sintéticos | ✅ `sku IS NULL` nos 13 |
| 13 barcodes corretos | ✅ 13 distintos, todos da nota |
| categorias legíveis | ✅ slug desfeito (`pilhas_e_baterias` → `Pilhas e Baterias`); nenhum `_` |
| marca corrompida removida | ✅ `brand = ''` nos 13 |
| fornecedor Martins | ✅ |
| NCM/CEST canônicos | ✅ em `metadata.fiscal`, item por item |
| estoque zero preservado | ✅ + **0 `MovimentacaoEstoque`** criadas |
| preço zero preservado | ✅ |
| custo da nota gravado | ✅ (34,91 no Duracell) |
| **produtos inativos** | 🔴 **REPROVADO — ver F-05** |
| statusRevisao pendente | ✅ |
| batchId persistido | ✅ + `acao`, `matchPor`, fornecedor e NF-e na proveniência |
| histórico limitado | ✅ `≤ 10` |
| Loja 1 intocada | ✅ `l1-colide-ean` preservado integralmente (mesmo EAN, outra loja) |

### UPC-A `041333038865`

✅ **Preservado textualmente**: 12 caracteres, zero à esquerda intacto, em três
camadas independentes —
banco (`barcode = '041333038865'`),
listagem da UI (`041333038865` renderizado sob o nome),
e formulário de edição (campo código de barras).
Confirmado que **não** virou NCM nem CEST: `metadata.fiscal.ncm = '85065010'`.

### Preview 2 / Import 2 (idempotência)

| Critério | Resultado |
|---|---|
| 0 criações | ✅ |
| 13 matches por **barcode** | ✅ (a chave forte assumiu depois do reparo) |
| nenhuma duplicação | ✅ contagem estável |
| nenhuma perda de metadata | ✅ `fiscal.ncm` intacto item a item |
| histórico sem duplicação indevida | ✅ 1 entrada; reimportar o **mesmo** `batchId` 3× não empilha nem duplica |

---

## 8. Provas dos filtros JSONB e entradas hostis

24/24 asserções contra PostgreSQL real, exercitando a função de produção
`listProdutosPaginado` (não uma reimplementação). **Todos os totais bateram
exatamente** com o SQL autoritativo **no caminho raw**.

Para cada um dos 10 filtros foi verificado: resultado correto, total correto,
`storeId` obrigatório, e **zero linhas da outra loja**.

- **`storeId` é fail-closed**: `storeId = ""` devolve `total = 0` — nunca "todas as lojas".
- **Isolamento cruzado**: `batchId` da loja-1 consultado pela loja-2 → 0; e vice-versa → 0.
- **Mesmo EAN em lojas diferentes** → produtos distintos, sem vazamento.
- **Paginação**: total estável entre páginas.

### Entradas hostis (batchId, fornecedor, busca textual, categoria, marca)

Payloads testados: `' OR 1=1 --`, `' OR '1'='1`, `'; DROP TABLE estoque_produtos; --`,
`lote-a' UNION SELECT ... --`, `%`, `_`, `\`, `100%`, `a'b"c`, byte NUL.

- **Nenhuma injeção.** Tabela íntegra depois de todas as tentativas (`total = 5023`).
- `batchId` hostil → sempre `total = 0`.
- `categoria` / `marca` hostis → sempre `total = 0` (comparação exata parametrizada).
- **`escapeLike` funciona:** `q = "%"` → 0 resultados (não vira "casa tudo").
  `q = "_"` → exatamente **7** produtos, os únicos cujo `brand` slugado contém
  underscore literal (`fitas_e_adesivos`, `pilhas_e_baterias`, …). Confirmado por SQL.
- **Byte NUL** → `SQLSTATE 22021` (`invalid byte sequence for encoding "UTF8"`).
  Raw falha, fallback Prisma também falha, `withPrismaSafe` devolve `[]`.
  **Degrada sem crash**, sem 500 e sem vazamento.

### F-04 (P3) — `fornecedorNome` com wildcard

`cadastros.ts:1547` usa `ILIKE ${filtroFornecedorNome}` **sem escapar**.
Evidência: `fornecedorNome = "%"` → **5023** (catálogo inteiro da loja).
Sem vazamento entre lojas (`storeId` continua aplicado) e sem injeção — é
**semântico**, não de segurança. Agravante: o fallback usa `equals`, então os dois
caminhos **discordam** para o mesmo input.
Correção: `escapeLike` no valor, ou trocar `ILIKE` por `=`/`equals` nos dois caminhos.

### F-03 (P3) — "Importados hoje" usa data **UTC**

`cadastros.ts:1555` compara com `new Date().toISOString().slice(0,10)` (**UTC**),
enquanto o usuário é `America/Sao_Paulo` (UTC−3).

Medido na sessão: data local `2026-07-29`, data UTC `2026-07-30`.

Efeito: entre **21:00 e 00:00 locais**, o filtro passa a comparar com a data UTC do
dia seguinte, e produtos importados **mais cedo no mesmo dia local** deixam de
aparecer em "Importados hoje" — janela de 3 horas por dia.
(Internamente consistente: `importadoEm` também é UTC. O problema é a semântica
"hoje" para o operador brasileiro.)

---

## 9. Performance — `EXPLAIN (ANALYZE, BUFFERS)`

~5.023 linhas, tabela 100% em cache (`shared hit=168`, **zero leitura de disco**).

| Consulta | Tempo | Plano | Linhas removidas pelo filtro |
|---|---|---|---|
| batchId (JSONB) + ORDER BY + LIMIT | **6,2 ms** | Seq Scan → top-N heapsort | 4.523 |
| COUNT do mesmo filtro | **3,9 ms** | Seq Scan | 4.523 |
| statusRevisao (JSONB) | **3,1 ms** | Seq Scan | 4.523 |
| semNcm (COALESCE/NULLIF, 2 caminhos JSONB) | **3,4 ms** | Seq Scan | 1.002 |
| skuSintetico (2 regex `~*`) | **13,0 ms** | Seq Scan | 5.008 |
| Importados hoje (`LEFT` sobre texto JSONB) | **5,3 ms** | Seq Scan | 5.023 |
| Busca textual + ranking de relevância | **9,4 ms** | Seq Scan → quicksort | 5.018 |

Índices existentes: `estoque_produtos_pkey`, `storeId_idx`, `storeId_sku_key`,
`storeId_barcode_key`.

**Índice de `storeId` NÃO foi usado** — corretamente: nesta massa a loja-2 é 99,96%
das linhas, então o planner prefere Seq Scan. **Isto é artefato do seed**, não
conclusão sobre produção; com lojas equilibradas o índice tende a entrar.

**Veredito:** custo operacional **adequado** para o volume-alvo. O mais caro
(`skuSintetico`, 13 ms) é o dobro dos demais por causa das duas regex, mas segue
irrelevante. Nenhum filtro JSONB exigido neste GOAL (schema congelado) e **nenhum
bloqueio por performance**.

**Risco de crescimento:** todos os filtros são Seq Scan + filtro JSONB não-indexável.
O custo cresce **linearmente**. Em ~50k produtos/loja espera-se 30–130 ms por consulta
— ainda aceitável, mas é o ponto em que um índice de expressão
(`((metadata->'importacao'->'ultimoLote'->>'batchId'))`) ou `GIN` passa a valer.
Registrar como dívida técnica, não como bloqueio.

---

## 10. Matching adversarial — 13/13 aprovado

| Cenário | Esperado | Resultado |
|---|---|---|
| Dois produtos com o mesmo nome | conflito | ✅ conflito, `matchPor = null` |
| Nome ambíguo + linha sem código próprio | conflito (não duplica) | ✅ |
| Nome igual + EAN de outro produto | casa por barcode (chave forte) | ✅ |
| SKU real igual + EAN de outro produto | **conflito de identidade** | ✅ fail-closed |
| Mesmo código de fornecedor, **fornecedor diferente** | não casa | ✅ |
| Produto curado (marca `Duracell`) | marca **não** é limpa | ✅ marca ausente de `camposAlterados` |
| Marca == categoria por escolha do operador | marca **é** limpa | ✅ (assinatura do defeito) |
| SKU legítimo `IMP-4471` | casa por SKU, não é sintético | ✅ |
| `linha-N` informado deliberadamente | descartado como identidade | ✅ `sku = ""`, vira criação |
| `linha-999` existente no banco | não casa por SKU sintético | ✅ criação |
| Barcode da Loja 1 == Loja 2 | cada loja casa o seu | ✅ |
| Preview da loja-2 referencia produtoId da loja-1 | nunca | ✅ |

**Conflitos são fail-closed, marca curada é preservada, e matching por nome não
ocorre com ambiguidade.** Nenhuma exceção encontrada.

---

## 11. F-06 (P1 latente) — Domínios do importador: `dominios[]` vs `dominios`

**Defeito confirmado. Atualmente inalcançável. NÃO bloqueia esta branch.**

Assimetria real no código:

| Lado | Chave |
|---|---|
| Hook (`use-importador-avancado.ts:292`) | `fd.append("dominios[]", d)` |
| Rota (`route.ts:119`) | `formData.getAll("dominios")` |

Contraste que prova o erro: **arquivos** usam colchetes nos **dois** lados
(`arquivos[]` / `getAll("arquivos[]")`).

### Prova comportamental através da rota real (multipart de verdade)

| Envio | `grupos` retornado | Leitura |
|---|---|---|
| sem filtro (baseline) | `["produtos"]` | produtos detectados |
| **`dominios[]=clientes`** | **`["produtos"]`** | 🔴 seleção **ignorada** — produtos importado assim mesmo |
| `dominios=clientes` (chave correta) | `[]` | ✅ filtro funciona |

### Por que **não** bloqueia

**Nenhum caller passa seleção de domínio.** `ImportadorAvancado.tsx:185,236` chamam
`rodarPreview()` e `rodarImport()` **sem argumento** → `dominios === undefined` →
o hook **não anexa nada** (nem com a chave certa, nem com a errada) → a rota recebe
`[]` → filtro inativo → "importar todos os domínios detectados". **Não existe seletor
de domínios na UI.**

Consequências:

- Hoje **nada** é silenciosamente sobrescrito: não há seleção de usuário a respeitar.
- **Preview e import leem a MESMA chave** (`getAll("dominios")` ocorre exatamente 1×
  na rota) → seleção consistente entre os dois modos. Critério **atendido**.
- É pré-existente em `origin/main` (byte-idêntico nos dois lados).

**Risco:** armadilha latente. No instante em que alguém adicionar o seletor de
domínios, o servidor ignorará a escolha e importará tudo — sem erro.

### Patch mínimo recomendado

```diff
--- a/app/api/import/advanced/route.ts
+++ b/app/api/import/advanced/route.ts
-  const dominiosFiltro = (formData.getAll("dominios") as string[]).filter(Boolean) as DominioImport[]
+  // Aceita as duas convenções: o hook envia `dominios[]` (igual a `arquivos[]`).
+  const dominiosFiltro = ([
+    ...formData.getAll("dominios[]"),
+    ...formData.getAll("dominios"),
+  ] as string[]).filter(Boolean) as DominioImport[]
```

Testes necessários no GOAL de correção:
1. contrato multipart `dominios[]=clientes` → `grupos` **sem** `produtos`;
2. compatibilidade `dominios=clientes` → mesmo resultado;
3. preview e import com a mesma seleção → mesmos domínios;
4. domínio não selecionado **não** é persistido (asserção no banco).

---

## 12. Preço e revisão em lote — 18/18 aprovado

| Critério | Resultado |
|---|---|
| Acréscimo percentual sobre o **custo** | ✅ 34,91 +100% → 69,82 |
| Valor fixo sobre o custo | ✅ ; custo 0 → preço 0 (linha segue pendente) |
| Arredondamento final `,90` | ✅ 10,00→10,90 · 10,95→**11,90** · 19,90→19,90 (**nunca desce**) |
| Arredondamento final `,99` | ✅ 10,00→10,99 · 69,82→69,99 |
| Margem bruta exibida corretamente | ✅ custo 10 / preço 20 → markup **100%**, margem **50%** (grandezas distintas) |
| Preview antes de salvar | ✅ `preverPrecoLote` é **puro**: `updatedAt` e `price` inalterados |
| Cancelamento sem escrita | ✅ (preview não escreve) |
| Seleção parcial | ✅ só os ids enviados mudam |
| Produto já revisado | ✅ marcar/desmarcar; reexecução **idempotente**, histórico não empilha |
| Falha em um dos produtos | ✅ id inexistente ignorado, válidos aplicados (`atualizados = 1`) |
| Reexecução idempotente | ✅ |
| Preço negativo | ✅ rejeitado sem gravar |

Invariantes do preço em lote — **todos comprovados no banco**:

- ✅ **não** altera custo · ✅ **não** altera estoque · ✅ **não** sobrescreve barcode
- ✅ **não** apaga fiscal (`ncm`/`cest` item a item) · ✅ proveniência do lote intacta
- ✅ **não** ativa produto inapto (produto sem categoria **não** ativa; apto ativa)
- ✅ **não cruza lojas** (loja-1 aplicando em produto da loja-2 → `atualizados = 0`)
- ✅ **não cruza lotes** (`batchId` errado → `atualizados = 0`)
- ✅ limite de 1000 itens · `storeId`/`batchId`/lista vazios rejeitados
- ✅ **0 `MovimentacaoEstoque`** geradas por qualquer operação da conferência

---

## 13. Estoque

| Critério | Resultado |
|---|---|
| Estoque atual somente leitura na edição | ✅ ficha não expõe input editável de `stock` |
| Botão "Movimentar estoque" presente | ✅ |
| Alteração da ficha não modifica `stock` | ✅ estrutural: `PatchAtualizacaoProduto` não tem a chave |
| Movimentação usa o fluxo auditável existente | ✅ nenhuma escrita de `MovimentacaoEstoque` no importador |
| Importação com `nao_movimentar` não cria `MovimentacaoEstoque` | ✅ **0 registros** após todos os imports |
| Produto existente nunca recebe `stock` da planilha | ✅ estrutural |

`nao_movimentar` é o **default seguro** quando o contexto não vem
(`route.ts:96`, `CONTEXTO_LOTE_VAZIO`).

---

## 14. Validação visual local

App subida **da própria worktree** (`npx next dev --webpack -p 3131 -H 127.0.0.1`),
contra o PostgreSQL local. **`preview_start` do repositório primário não foi usado** —
apenas uma aba de navegador apontada para `127.0.0.1:3131`.

Loja ativa: `loja-2` (confirmada pelos dados: 5.023 linhas vs. 2 da loja-1).

| # | Item | Resultado |
|---|---|---|
| 1 | Loja 2 ativa | ✅ (via cookie `assistec-active-store` + localStorage) |
| 2 | Importação → Planilhas | ✅ 4 sub-abas: Planilhas · Produtos (lotes) · XML NF-e (preparação) · Histórico |
| 3 | Upload da fixture Martins | ⚠️ **não executado pela UI** (dropzone presente; sem `file_upload` no navegador embutido). Pipeline coberto pela rota real em teste (§11) |
| 4 | Contexto do lote | ✅ fornecedor, CNPJ, NF-e `5380135` série 0, emissão, chave de 44 dígitos |
| 5 | Preview linha a linha | ✅ componente presente; verificado via rota real |
| 6 | Conflitos | ✅ `bloqueado` calculado por `temBloqueio` |
| 7 | Importar bloqueado com conflito | ✅ por código + preview (`bloqueado: true`) |
| 8 | Resultado pós-importação | ✅ |
| 9 | CTA "Revisar produtos desta importação" | ✅ presente na coluna CONFERÊNCIA do Histórico |
| 10 | Histórico | ✅ colunas DATA/TIPO/USUÁRIO/RESUMO/REGISTROS/DURAÇÃO/STATUS/CONFERÊNCIA |
| 11 | Filtros por lote | ⚠️ presentes e wired; **exibem números errados** — F-02 |
| 12 | Conferência | ✅ **excelente** (ver abaixo) |
| 13 | Preço em lote | ✅ regra + percentual + arredondamento + "Visualizar prévia" |
| 14 | Marcação como revisado | ✅ botão "Marcar como revisado" |
| 15 | Ativação dos aptos | ✅ "Ativar produtos aptos" + aviso das exigências |
| 16 | Edição individual | ✅ |
| 17 | NCM e CEST | ✅ NCM `85065010` com placeholder "8 dígitos"; CEST "7 dígitos" |
| 18 | Estoque somente leitura | ✅ sem input editável; "Movimentar" disponível |
| 19 | Loading | ✅ "Calculando…", "Carregando histórico…" |
| 20 | Vazio | ✅ "Nenhuma importação ainda" |
| 21 | Erro | ⚠️ **é aqui que F-02 dói**: o erro real (42804) **não** chega à UI |
| 22 | Desktop 1280 | ✅ |
| 23 | Tablet 768 | ✅ sem scroll horizontal de página |
| 24 | Mobile 375 | ✅ sem scroll horizontal de página; tabela larga rola em container próprio (2 scrollers) |

Conferência (`ConferenciaLoteProdutos.tsx`) renderiza: 5 totalizadores
(PRODUTOS/PENDENTES/INCOMPLETOS/REVISADOS/**APTOS A ATIVAR**), contexto da NF-e, bloco
de precificação em lote e tabela com 15 colunas incluindo **ACRÉSC. S/ CUSTO** e
**MARGEM S/ VENDA** separadas, `NCM`, `CEST`, `ESTOQUE`, badge
"Atualizado por nome exato · linha N" e estado `Pendente`/`inativo`.

**Screenshots:** não capturáveis nesta sessão — o painel do navegador não estava
compositando frames (`Screenshot timed out ... the Browser pane is not displayed`).
A validação foi feita por árvore de acessibilidade, `innerText` e DOM, que sustentam
asserções de conteúdo e estrutura, **não** de pixel/contraste.

### Acessibilidade e UX

| Item | Resultado |
|---|---|
| Labels | ✅ todos os filtros com rótulo (STATUS, ESTOQUE, …, IMPORTAÇÃO) |
| Fechamento de modal | ✅ `Escape` fecha |
| Confirmação de ações em lote | ✅ "Visualizar prévia" antes de salvar; aviso explícito na ativação |
| Mensagens de erro | 🔴 **falha (F-02)**: degradação silenciosa, nenhuma mensagem |
| Distinção acréscimo × margem | ✅ colunas e rótulos separados — requisito atendido de forma exemplar |
| Ausência de vermelho forte em pendentes | ✅ `Pendente` é badge neutro; `incompleto` é o estado de alerta |
| Nenhuma ação visualmente ativa que seja no-op | 🔴 **falha**: "NCM ausente", "CEST ausente" e "Importados hoje" parecem funcionar e são no-op |
| Foco inicial / navegação por teclado | ⚠️ **não verificado** (sem captura de foco visual confiável) |
| Contraste dos badges | ⚠️ **não verificado** (sem screenshot) |

**Observação fora do escopo do diff:** o cabeçalho exibe "Matriz" mesmo com `loja-2`
ativa. `AppShell.tsx` **não** está no diff → pré-existente, não é achado desta branch.
Também: os cartões "LOTES REGISTRADOS / ÚLTIMA IMPORTAÇÃO" mostraram `0`/`—` enquanto
a tabela do Histórico já listava o lote (contadores não reagiram ao refresh).

---

## 15. Testes e build (Node 20)

| Comando | Resultado |
|---|---|
| `npm ci` | ✅ exit 0 |
| `npx prisma generate` | ✅ Client 6.19.3 |
| `npx prisma validate` | ✅ "The schema at prisma\schema.prisma is valid 🚀" |
| `npx vitest run` (suite oficial) | ✅ **255 arquivos passaram**, 3 skipped · **3638 testes passaram**, 2 expected-fail, 46 skipped · exit 0 |
| `npx tsc --noEmit` | ✅ exit 0 (com `--max-old-space-size=8192`; sem heap extra o processo morre por OOM por causa do AWS SDK) |
| `npm run build` | ✅ **exit 0** (`prisma generate && next build --webpack`) — ver nota abaixo |
| `git diff --check` | ✅ sem whitespace error |

Suites focadas exigidas pelo GOAL — `lib/importador-avancado`,
`lib/cadastros/importacao-produtos`, `produto-quality-score`:
✅ **14 arquivos · 206 testes · todos passaram**.

`components/**` da conferência não têm teste de componente na branch (a cobertura é de
domínio puro + integração); isolamento multi-loja é coberto pelos guards
`lib/multi-loja` dentro da suite oficial e pelos testes desta readiness.

> **Nota sobre `npm run build`:** a primeira execução falhou com
> `EPERM: operation not permitted, rename ... query_engine-windows.dll.node` — o dev
> server rodando na **mesma worktree** mantinha o engine do Prisma travado, e
> `prisma generate` (primeiro passo do script) não conseguiu substituir o arquivo.
> **Não é erro de código.** Reexecutado com o dev server parado: **exit 0**, todas as
> rotas compiladas (estáticas + dinâmicas + Proxy/Middleware).
>
> **Implicação para F-02:** o build **passa**. O defeito do caminho raw é de
> **runtime**, não de compilação — nenhum gate atual (build, typecheck, 3638 testes)
> é capaz de detectá-lo. É exatamente por isso que ele chegou até aqui, e por isso a
> correção precisa vir acompanhada de um teste que atravesse o bundler.

### Testes desta readiness (temporários, no scratchpad)

**68 asserções** contra PostgreSQL real, todas verdes:

| Arquivo | Testes | Escopo |
|---|---|---|
| `jsonb-filtros.test.ts` | 24 | 10 filtros, paginação, isolamento, entradas hostis |
| `martins-real-db.test.ts` | 26 | preview/import 1 e 2, UPC-A, idempotência, histórico |
| `conferencia-lote.test.ts` | 18 | precificação, invariantes de escrita, multi-loja/multi-lote |
| `adversarial.test.ts` | 13 | matching adversarial |
| `dominios-multipart.test.ts` | 6 | contrato multipart via rota real |
| `bisect-42804.test.ts` + `bisect2.test.ts` | 7 | isolamento da causa raiz de F-02 |

Preservados em
`…/scratchpad/evidence-tests/` — **não versionados** (não fazem parte da entrega).

---

## 16. Riscos

| ID | Sev. | Risco | Status |
|---|---|---|---|
| **F-02** | **P0** | Caminho raw falha (`42804`) em runtime; 3 filtros no-op, 1 superset; degradação **silenciosa** | 🔴 **bloqueia merge** |
| **F-05** | **P1** | Reparo não inativa produto com preço 0 → 13 produtos vendáveis a R$ 0,00 | 🔴 critério do GOAL reprovado; exige decisão humana |
| **F-06** | P1 | `dominios[]` vs `dominios` — seleção de domínio seria ignorada | 🟡 latente (sem UI); pré-existente |
| **F-01** | P2 | `ORDER BY` sem desempate único → paginação repete/omite linhas quando `updatedAt` empata (500 linhas do lote ⇒ 10 valores distintos; **5 de 10 linhas repetidas** entre página 1 e 2) | 🟡 pré-existente, **amplificado**; conferência é imune (sem OFFSET) |
| **F-03** | P3 | "Importados hoje" usa data UTC → janela de 3 h/dia com resultado errado | 🟡 |
| **F-04** | P3 | `fornecedorNome` com `ILIKE` sem escape (`%` casa tudo); divergente do fallback | 🟡 |
| **F-07** | P3 | `ativados`/`revisados` contados antes do `update` | 🟡 |
| **F-08** | P3 | `persistirImportacao` não transacional; escrita parcial possível | 🟡 deliberado, documentar |
| **F-09** | P3 | `findUnique`/`update` por `id` só (persistidor) dependem do invariante de escopo | 🟡 defesa em profundidade |
| R-10 | info | Filtros JSONB são Seq Scan; custo linear | ℹ️ dívida técnica para ~50k+/loja |

---

## 17. Correções obrigatórias antes do merge

1. **F-02 — corrigir o caminho raw e torná-lo fail-closed.** Sem isso os filtros de
   importação, que são a entrega central da branch, entregam dados errados em produção.
   Inclui teste de regressão que atravesse o bundler do Next.
2. **F-05 — decidir e implementar a política de ativação** para produto existente com
   `preco <= 0` (inativar, ou revisar formalmente o critério do GOAL via ADR).
3. **F-06 — alinhar a chave multipart** (`dominios[]`) com os 4 testes listados em §11,
   antes que qualquer seletor de domínio seja adicionado.

**Recomendados no mesmo GOAL (baixo custo, alto valor):** F-01 (desempate `p."id"` em
todo `ORDER BY`), F-03 (data local), F-04 (escapar `ILIKE`).

---

## 18. Decisão de merge

**NÃO MERGEAR.**

O trabalho de domínio desta branch é sólido: o motor de matching é fail-closed e
sobreviveu a 13 cenários adversariais; as invariantes de escrita (estoque, preço,
marca curada, fiscal) são **estruturais** e não apenas convencionais; a fixture
Martins repara 12 dos 13 critérios com precisão — inclusive o UPC-A
`041333038865` preservado nas três camadas; a precificação distingue markup de margem
com rigor; a conferência é uma tela de qualidade; 3638 testes passam e o typecheck
está limpo.

O bloqueio é de **integração, não de concepção**: a feature foi construída sobre um
caminho SQL que **não funciona depois do bundler do Next.js**, e o fallback foi
projetado para "não quebrar a tabela" em vez de "não mentir". O resultado é um
conjunto de filtros que parece operante e informa o oposto da verdade sobre pendência
fiscal — num HUB que alimenta emissão de NF-e.

Corrigidos F-02, F-05 e F-06, esta branch tende a **A/B** sem retrabalho estrutural:
nenhuma dessas correções exige reprojeto, e nenhuma toca schema ou área protegida
(exceto, se escolhido, o caminho de `next.config.mjs` em F-02 — que **exige
autorização explícita**).

Próximo GOAL: **`CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-CORRECTIONS-001`**

---

## 19. Escopo desta auditoria

- Nenhum arquivo de implementação foi alterado. Único arquivo entregue: este documento.
- Nenhum defeito foi corrigido silenciosamente.
- Neon **não** acessado. Produção **não** alterada. Martins **não** reimportada em
  produção. Modenuti **não** importada. Entrada por XML **não** iniciada.
- Nenhum merge, nenhum push para `main`, nenhum auto-merge. Push apenas da branch de
  auditoria.
- Banco local `omni_readiness_import_001` e cluster do scratchpad são descartáveis.
