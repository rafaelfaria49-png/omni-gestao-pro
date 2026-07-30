# CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-FINAL-READINESS-001

**Tipo:** readiness final independente (read-only sobre código)
**Data:** 2026-07-30
**Auditor:** Claude Code (Opus 5) — sessão de auditoria isolada
**Branch auditada:** `goal/cadastros-importacao-produtos-review-hardening-corrections-001`
**Branch desta auditoria:** `audit/cadastros-importacao-produtos-final-readiness-001`
**Worktree:** `C:\tmp\omni-gestao-cadastros-import-final-readiness`

> Esta sessão **não alterou código de aplicação**. O único arquivo criado é este documento.
> Nenhum acesso a Neon, Supabase ou Vercel. Nenhum produto real tocado.

---

## 1. Classificação

# 🟢 **B — pronto com ressalvas não bloqueantes**

Os três bloqueios da readiness anterior (**F-02**, **F-05**, **F-06**) estão **fechados e provados
empiricamente**, inclusive **depois do bundle do Next.js** — que era exatamente onde o F-02 se
manifestava e onde a readiness anterior não tinha prova.

As ressalvas remanescentes são **de processo e de teste**, não de comportamento do produto:
nenhuma delas altera o que o operador vê ou o que o banco grava. Estão listadas na §12 com
o encaminhamento proposto.

**Decisão de integração: LIBERADA** para
`CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-MERGE-001`.

---

## 2. SHAs auditados

| Item | SHA |
|---|---|
| `origin/main` | `79176891ccc8e336339df69bfa2fc2e609cfc0db` |
| `origin/goal/cadastros-importacao-produtos-review-hardening-corrections-001` | `efef2d898f1a68c59802945542376d95c6f9dd27` |
| `merge-base(main, branch)` | `79176891ccc8e336339df69bfa2fc2e609cfc0db` |

`merge-base == origin/main` → **`origin/main` não avançou**; a branch é fast-forwardable.
Não houve necessidade de auditar conflitos nem de rebasear.

### 2.1 Os cinco commits de correção posteriores a `ad180a2`

| SHA | Data | Assunto |
|---|---|---|
| `0932799` | 2026-07-30 | `fix(cadastros): corrigir filtros SQL apos bundle Next` |
| `4f98ad1` | 2026-07-30 | `fix(importacao): bloquear produtos sem preco ate revisao` |
| `b43bbd9` | 2026-07-30 | `fix(importacao): normalizar contrato multipart de dominios` |
| `81a669d` | 2026-07-30 | `test(importacao): fechar bloqueios da readiness de produtos` |
| `efef2d8` | 2026-07-30 | `docs(importacao): alinhar contrato a politica de ativacao e filtros` |

---

## 3. Pré-flight

| Verificação | Resultado |
|---|---|
| Branch remota limpa | ✅ `git status --short` vazio na worktree recém-criada |
| Merge commit no intervalo `main..branch` | ✅ **nenhum** (`git log --merges` vazio) |
| `prisma/schema.prisma` | ✅ **intacto** — não aparece no diff |
| `prisma/migrations/**` | ✅ **intacto** — não aparece no diff |
| Fiscal · Contador · PDV · Caixa · Financeiro · `auth*` · `proxy.ts` | ✅ **nenhum arquivo tocado** |
| `next.config.mjs` · `tsconfig.json` · `lib/prisma.ts` | ✅ intactos |
| Snapshot fiscal com CRLF | ✅ **ausente** dos commits publicados — `git diff origin/main...branch` tem **0 caracteres CR** |
| `git diff --check` | ✅ limpo |

O único commit cujo título menciona "fiscal" é `4f4264f fix(cadastros): alinhar ficha fiscal
estoque e score`, que toca apenas `CadastrosHub.tsx` e `produto-ia.tsx` — é a **ficha fiscal do
produto na UI de Cadastros**, não o módulo Fiscal/NFC-e.

### 3.1 Superfície do diff

- **`origin/main...branch` (10 commits):** 50 arquivos, +9.820 / −497.
- **`ad180a2..efef2d8` (as 5 correções):** **22 arquivos**, +2.517 / −537 — bate exatamente com o
  escopo declarado no GOAL.

---

## 4. Ambiente da readiness

| Item | Valor |
|---|---|
| Node | **v20.19.5** (portátil oficial, isolado em `C:\tmp\omni-readiness-final-001\node20`) |
| npm | 10.8.2 |
| PostgreSQL | **17.10**, cluster descartável criado com `initdb` só para esta readiness |
| Porta | **5519** (≠ 5432) |
| Banco | `omni_import_final_readiness` (exclusivo; recriado por `pg_restore` entre fases) |
| `DATABASE_URL` | `postgresql://postgres:***@127.0.0.1:5519/omni_import_final_readiness` |
| Hosts proibidos | ✅ **zero** ocorrência de `neon.tech`, `supabase`, `vercel-storage` |
| Aplicação empacotada | `npm run build` (webpack) + `next start -p 3519 -H 127.0.0.1` |

`npm ci` (exit 0, 883 pacotes) · `npx prisma generate` (exit 0) · `npx prisma validate` (válido) ·
`npx prisma db push` (exit 0, schema em sincronia).

**Independência:** os scripts, a fixture e os valores esperados desta readiness foram escritos do
zero nesta sessão (`C:\tmp\omni-readiness-final-001\scripts\`). Nenhum log, script ou banco do
executor anterior foi reutilizado como prova.

---

## 5. Fixture (independente)

Semeada por SQL cru via `pg` — **sem passar pela camada auditada**, para que os valores esperados
nasçam fora do código sob auditoria.

| Conteúdo | Quantidade |
|---|---|
| Loja 1 (`loja-1`) | **125** produtos |
| Loja 2 (`loja-2`) | **5.040** produtos |
| Produtos com `metadata.importacao` | ~2.500 (3 lotes: `adv-fx-lote-A/B/C`) |
| Importados hoje (fuso America/São_Paulo) | 837 |
| Revisados / pendentes | 277 / 2.227 |
| Sem barcode | 731 |
| SKU sintético (`linha-N` + `IMP-<slug>-<slug>`) | 471 |
| Sem NCM / sem CEST | 1.040 / 1.706 |
| `metadata.fiscal` canônico **e** legado (`metadata.ncm` na raiz) | ambos presentes |
| SKUs `IMP-*` **legítimos** (`IMP-4471`, `IMP-9902`) | 2 |
| Nomes duplicados na mesma loja | 4 ocorrências |
| Mesmo EAN em lojas diferentes | `2000000000001` (L1 + L2) |
| Mesmo SKU em lojas diferentes | `SKU-L2-1` (L1 + L2) |
| Nome idêntico em lojas diferentes | `Produto Fixture 0001 Acessórios` |
| `batchId` **homônimo** nas duas lojas | `adv-fx-lote-A` |
| Fornecedor homônimo nas duas lojas | `Fornecedor Alpha` |
| Dados hostis gravados no banco | nome com `%`, `_`, `'`, `"`, `\` |
| Corpus de ranking (termo `ZETA`) | 8 produtos, um por camada de relevância |
| **Martins degradados** (NF-e 5.380.135) | **13**, `active=true` + `price=0` + `sku=linha-1..13` + `brand=<categoria slugada>` |

---

## 6. F-02 — filtros SQL: **APROVADO**, com concordância das TRÊS fontes

Fonte 1 = SQL independente (expressões diferentes das da implementação: `jsonb_extract_path_text`
no lugar de `#>>`, subqueries no lugar de `CASE` inline).
Fonte 2 = camada server-side chamada direto em Node (`listProdutosPaginado` via `tsx`).
Fonte 3 = **aplicação empacotada** (`next build` + `next start`), dirigida por navegador real
(Playwright) — Server Action sobre HTTP.

| Filtro | SQL independente | Camada server-side | **App empacotada** |
|---|---|---|---|
| total da loja | 5.040 | 5.040 | **5.040** |
| última importação (`ultimoLote`) | 837 | 837 | **837** |
| importados hoje | 837 | 837 | **837** |
| pendentes de revisão | 2.227 | 2.227 | **2.227** |
| revisados | 277 | 277 | **277** |
| `batchId` explícito | 837 | 837 | — |
| fornecedor exato | 833 | 833 | — |
| sem código de barras | 731 | 731 | **731** |
| SKU sintético | 471 | 471 | **471** |
| NCM ausente | 1.040 | 1.040 | **1.040** |
| CEST ausente | 1.706 | 1.706 | **1.706** |
| status Ativo | 4.249 | 4.249 | **4.249** |
| status Inativo | 265 | 265 | — |
| status Incompleto | 526 | 526 | **526** |
| estoque com / sem / baixo | 4.760 / 280 / 178 | idem | — |
| sem preço | 401 | 401 | **401** |
| sem fornecedor | 861 | 861 | — |
| categoria / marca | 615 / 833 | idem | — |
| busca `ZETA` | 8 | 8 | **8** |
| combinação SKU sintético ∩ Incompleto | 63 | 63 | — |
| combinação busca ∩ categoria | 7 | 7 | — |
| categoria inexistente (vazio) | 0 | 0 | **0** |

**Divergências: 0.**

> Ressalva metodológica honesta: `importacao` é um filtro de valor único no contrato, então a
> combinação `hoje ∩ semNcm` não existe como entrada da UI. A chave homônima do meu harness
> comparava coisas diferentes e foi descartada; as combinações realmente suportadas
> (`importacao` × colunas, busca × categoria) batem exatamente.

### 6.1 Requisitos duros do F-02

| Exigência | Resultado |
|---|---|
| Zero `SQLSTATE 42804` | ✅ nenhum filtro produziu 42804 em nenhuma das três fontes |
| Zero fallback descartando filtros | ✅ o fallback Prisma foi **removido**; falha devolve erro |
| Zero retorno do catálogo completo diante de falha | ✅ ver §6.3 |
| `count` e paginação coerentes | ✅ `COUNT(*) OVER ()` na mesma query; total idêntico nas páginas 1/2/3, 25+25+25 linhas, **sem repetição**, e a página 2 repetida devolve a **mesma sequência** (desempate por `p."id"`) |
| Resposta de erro tipada | ✅ ver §6.3 |
| Filtros preservados na UI após erro | ✅ ver §6.3 |

### 6.2 Entradas hostis (as três fontes)

`'`, `"`, `%`, `_`, `\`, `DROP TABLE`, `UNION SELECT`, `' OR '1'='1`, texto de **5.000 caracteres**,
`orderBy` inválido (`name"; DROP TABLE estoque_produtos --`) e `orderBy` fora da allowlist.

- **Zero injeção.** Catálogo íntegro: 5.040 na Loja 2 e 5.165 no total, antes e depois.
- Escape de curinga **funciona de verdade**: buscar `100%` devolve **1** (o produto cujo nome
  contém literalmente `%`), não o catálogo; `A_B` devolve 1; `_` devolve 8 (só quem tem `_`
  literal). Sem escape, `%` casaria tudo — provado pelo controle `busca_pct_naoescapado = 16`.
- `orderBy` fora da allowlist é **ignorado** (cai em `updatedAt DESC, id ASC`), sem erro e sem
  alterar o conjunto retornado.
- `storeId` vazio → `{ ok: true, rows: [], total: 0 }` — nunca "todas as lojas".

### 6.3 Erro tipado e recuperação (provado **na app empacotada**)

Consulta forçada a falhar renomeando a coluna `price_cost` no PostgreSQL durante a sessão:

| Evidência | Valor observado |
|---|---|
| Código | `FILTROS_PRODUTOS_SQL_FALHOU` |
| `sqlState` | `42703` |
| `filtrosSolicitados` | `["importacao:semNcm"]` — **só as chaves**, nenhum valor digitado |
| Total devolvido | `0` |
| Linhas na tabela da UI | **0** |
| Alerta `role="alert"` visível | ✅ com a mensagem canônica *"Não foi possível aplicar os filtros. Nenhum resultado foi exibido para não induzir a decisão errada. Tente novamente."* |
| Filtro selecionado após o erro | **`semNcm` preservado** |
| Após "Tentar novamente" (coluna restaurada) | volta a responder corretamente, alerta some |

Este é o comportamento oposto ao defeito original, em que o `catch` caía num fallback Prisma e
devolvia o catálogo inteiro como se o filtro tivesse funcionado.

### 6.4 Busca ranqueada

Ordem observada, **idêntica** nas três fontes (SQL independente, camada e app empacotada):

| # | Camada de relevância | Produto |
|---|---|---|
| 0 | nome inicia pelo termo | `ZETA Cabo Turbo` |
| 1 | palavra do nome inicia pelo termo | `Cabo ZETA Turbo` |
| 2 | nome contém | `Cabo TurboZETAX` |
| 3 | SKU inicia | `Carregador Bravo` (`ZETA-SKU-001`) |
| 4 | SKU contém | `Carregador Charlie` |
| 5 | barcode | `Carregador Delta` |
| 6 | marca | `Carregador Echo` |
| 7 | categoria | `Carregador Foxtrot` |

Paginação determinística confirmada (desempate final por `p."id" ASC`).

### 6.5 Revisão de código da camada SQL

`lib/cadastros/produtos-listagem-sql.ts`:

| Critério | Resultado |
|---|---|
| Camada server-only | ⚠️ **de fato sim, formalmente não** — não importa o pacote `server-only`, mas o **único** consumidor é `app/actions/cadastros.ts`, que é `"use server"`. Ver ressalva R-4. |
| `$queryRawUnsafe` / `$executeRawUnsafe` | ✅ **ausente** no código de produção (só existe no próprio teste de integração e em `components/pdv-github-original/scripts/`, fora do diff) |
| `Prisma.join` no WHERE executado | ✅ **ausente** — só aparece em comentário e em asserção de teste |
| Fragmento `Prisma.Sql` cruzando fronteira de módulo | ✅ **ausente** — template único, criado e executado no mesmo módulo |
| Parâmetros de usuário parametrizados | ✅ 100% via `${}` da tagged template (binds `$1..$n`) |
| Whitelist fechada para ordenação | ✅ `ORDENACOES_PRODUTOS` + `normalizarOrdenacaoProduto`; comparação **dentro** do SQL |
| `count` e página com o mesmo predicado | ✅ `COUNT(*) OVER ()` na mesma query — impossível divergirem |
| Isolamento por `storeId` | ✅ obrigatório; `storeId` vazio é fail-closed |
| Erro SQL sem fallback no-op | ✅ retorna `{ ok: false, erro }`; o caller devolve `erroFiltros` e zera a lista |

---

## 7. F-05 — política de ativação: **APROVADO**

Provado em PostgreSQL real, pelo pipeline real (`parsearArquivos → agruparEMerge →
persistirImportacao`).

| Caso | Exigido | Observado |
|---|---|---|
| Produto **novo** importado com preço zero | `active=false`, status `Incompleto`, revisão pendente | ✅ `active=false`, `status="Incompleto"`, `statusRevisao="pendente"` |
| Produto **existente** importado com preço zero | `active=false`, status `Incompleto`, revisão pendente | ✅ idem — e o produto estava **ativo** antes |
| Produto existente com preço > 0 | preserva `active` atual | ✅ ativo continua ativo; `stock` preservado |
| Produto existente **inativo** com preço > 0 | **não** reativa automaticamente | ✅ continua `active=false` |
| Revisado + lote **não crítico** (custo/fornecedor) | permanece revisado | ✅ `statusRevisao="revisado"`, `revisadoPor="Auditor"` preservado, preço intacto |
| Revisado + lote **crítico** (preço 90 → 199) | volta a pendente | ✅ `statusRevisao="pendente"` e `revisadoPor` limpo |

Campos críticos implementados: `preco`, `barcode`, `sku`, `categoria`, `ncm`, `cest`
(`CAMPOS_CRITICOS_IMPORT`). Marca, fornecedor, garantia e custo não reabrem revisão — decisão
documentada e coerente.

### 7.1 Conferência (lote Martins, 13 produtos)

| Ação | Resultado |
|---|---|
| "Revisar e ativar" **sem preço** | ❌ recusado para os 13 · `ativados = 0` · motivo exato: **"Defina o preço de venda antes de ativar este produto."** |
| "Marcar como revisado" | ✅ 13 revisados · **`ativos = 0`** — marcar revisado **não ativa** |
| Definir preço + ativar explicitamente | ✅ 13 ativados, 13 produtos (sem duplicação), preços 100–112 |
| Estoque durante toda a conferência | **0 em todos**, `MovimentacaoEstoque = 0` |
| Loja 1 durante toda a conferência | **byte a byte equivalente** (mesmo hash MD5 antes e depois) |

"Revisar e ativar" exige preço > 0, nome, categoria, ausência de conflito de SKU/barcode na loja,
e que o produto pertença **a esta loja e a este lote** — todos verificados no servidor.

---

## 8. Fixture Martins — **13/13**

| Fase | Exigido | Observado |
|---|---|---|
| **Preview** | 0 criações, 13 atualizações, 13 matches por nome, zero escrita | ✅ `criar=0`, `atualizar=13`, `matchPor=["nome_exato"]`, **delta de linhas no banco = 0** |
| **1ª importação** | 13 barcodes corretos | ✅ 13/13 |
| | SKUs `linha-N` removidos | ✅ 0 restantes, 13 com `sku = null` |
| | marcas corrompidas removidas | ✅ 0 com `_`, 13 com marca vazia |
| | fornecedor Martins | ✅ 13/13 |
| | 13 NCM · 7 CEST | ✅ 13 · 7 |
| | preço e estoque zero | ✅ 13 · 13 |
| | 13 inativos · 13 incompletos · 13 pendentes | ✅ 13 · 13 · 13 |
| | **UPC-A `041333038865` preservado** | ✅ com o zero à esquerda |
| | **CEST `0900500` preservado** | ✅ com o zero à esquerda |
| **Reimportação** | 0 criações, 13 matches por barcode, histórico limitado, sem duplicação | ✅ `criados=0`, `matchPor=["barcode"]`, 13 produtos, **0 barcodes duplicados** |
| **Histórico** | teto respeitado | ✅ após **14** importações, `historico.length = 10` (= `IMPORTACAO_HISTORICO_MAX`) |
| **Loja 1** | byte a byte equivalente | ✅ hash MD5 idêntico do início ao fim |

Nenhuma `MovimentacaoEstoque` criada em nenhuma fase (política `nao_movimentar`).

---

## 9. F-06 — contrato multipart: **APROVADO**

Testado na **rota real** (`app/api/import/advanced/route.ts`) em duas frentes: invocação direta do
handler com `FormData` real, e **HTTP autenticado contra a app empacotada**.

| Cenário | Preview | Importação |
|---|---|---|
| `dominios[]=produtos` (canônica) | 200 · `{produtos:2}` | 200 · **+2 produtos, +0 fornecedores** |
| `dominios=produtos` (legada) | 200 · `{produtos:2}` | 200 · **+2 / +0** |
| `produtos` + `fornecedores` | 200 · `{produtos:2, fornecedores:2}` | 200 · **+2 / +2** |
| valores duplicados (3×) | 200 · `{produtos:2}` | 200 · **+2 / +0** |
| `"  produtos  "` (espaços) | 200 · `{produtos:2}` | 200 · **+2 / +0** |
| domínio inválido | **400** · `["clientes_secretos"]` | **400** · **+0 / +0** |
| inválido misturado com válido | **400** · `["dominio_que_nao_existe"]` | **400** · **+0 / +0** |
| `desconhecido` (não selecionável) | **400** · `["desconhecido"]` | **400** · **+0 / +0** |
| string vazia + `produtos` | 200 · `{produtos:2}` | 200 · **+2 / +0** |
| sem filtro | 200 · `{produtos:2, fornecedores:2}` | 200 · **+2 / +2** |
| **só `fornecedores`** (com arquivo de produtos anexado) | 200 · `{fornecedores:2}` | 200 · **+0 produtos / +2 fornecedores** |

**A prova central:** no cenário "só fornecedores", um arquivo de produtos foi enviado e mesmo assim
**nenhum produto foi criado** — o domínio não selecionado **nunca chegou ao persistidor**.
Preview nunca escreveu (delta 0 em todos os cenários). Preview e importação usam a **mesma**
normalização, lida uma única vez antes da bifurcação de modo.

Pós-bundle por HTTP autenticado (planilha Martins real): canônica/legada/espaços → `{produtos:13}`;
inválido → 400 com o valor ofensor; `dominios[]=clientes` → `grupos: {}` (produtos corretamente
excluído).

---

## 10. Multi-loja, autorização, estoque e metadata

### 10.1 Isolamento

| Cenário | Resultado |
|---|---|
| `batchId` da Loja 2 consultado pela Loja 1 | **0** |
| `batchId` da Loja 1 consultado pela Loja 2 | **0** |
| **`batchId` homônimo** (`adv-fx-lote-A`, existe nas duas) | Loja 1 vê **1** (o seu), Loja 2 vê **837** (os seus) — sem cruzamento |
| Mesmo EAN nas duas lojas | 1 em cada, **zero vazamento de id** |
| Mesmo SKU nas duas lojas | 1 na L1, 1.000 na L2 (substring), **zero vazamento** |
| Nome idêntico nas duas lojas | 1 na L1, 4 na L2, **zero vazamento** |
| Fornecedor homônimo | recorta por loja corretamente |
| `storeId` vazio | `{ ok: true, rows: [], total: 0 }` |

### 10.2 Autorização da conferência

| Tentativa | Resultado |
|---|---|
| `productId` **de outra loja** | `atualizados=0`, `ativados=0` · produto da L1 **byte a byte inalterado** |
| `batchId` **de outra loja** com produto desta loja | `atualizados=0` · preço **não mudou** |
| `getConferenciaLote(loja-2, lote-da-loja-1)` | **`null`** |
| `getConferenciaLote(loja-1, lote-da-loja-2)` | **`null`** |

### 10.3 Estoque e metadata

| Exigência | Resultado |
|---|---|
| Importação `nao_movimentar` não altera `stock` | ✅ 13/13 permaneceram em 0 |
| Não cria `MovimentacaoEstoque` | ✅ **0** registros em toda a readiness |
| Edição cadastral não altera estoque | ✅ `montarAtualizacaoProduto` **omite** `stock` por construção |
| `metadata.importacao` preservada | ✅ |
| Histórico máximo respeitado | ✅ 10 após 14 importações |
| Outros namespaces preservados | ✅ `acessorios`, `catalogoAparelhos`, `barcodeLookup`, `atributos` **intactos** após importação |
| `metadata.fiscal` | ⚠️ `ncm`/`cest` atualizados corretamente; **subcampos ausentes na planilha são descartados** — ver ressalva R-1 |

---

## 11. Performance — `EXPLAIN (ANALYZE, BUFFERS)`

Sobre 5.040 produtos, `LIMIT 100`:

| Cenário | Execução | Planejamento | Linhas | Buffers (hit/read) | Plano |
|---|---|---|---|---|---|
| sem filtro (página 1) | 16,52 ms | 2,45 ms | 100 | 1356 / **0** | Limit › Sort › WindowAgg › Seq Scan |
| status Ativo | 6,12 ms | 0,15 ms | 100 | 1344 / **0** | idem |
| status Incompleto | 1,92 ms | 0,15 ms | 100 | 1344 / **0** | idem |
| pendentes de revisão | 4,79 ms | 0,13 ms | 100 | 1344 / **0** | idem |
| revisados | 2,18 ms | 0,14 ms | 100 | 1344 / **0** | idem |
| importados hoje | 11,35 ms | 0,15 ms | 100 | 1344 / **0** | idem |
| último lote (`batchId`) | 2,94 ms | 0,14 ms | 100 | 1344 / **0** | idem |
| fornecedor exato | 2,53 ms | 0,13 ms | 100 | 1344 / **0** | idem |
| sem barcode | 1,53 ms | 0,13 ms | 100 | 1302 / **0** | Bitmap Heap Scan › BitmapOr › Bitmap Index Scan |
| SKU sintético (regex) | 6,91 ms | 0,39 ms | 100 | 1344 / **0** | Seq Scan |
| NCM ausente | 3,17 ms | 0,13 ms | 100 | 1344 / **0** | Seq Scan |
| CEST ausente | 5,72 ms | 0,19 ms | 100 | 1344 / **0** | Seq Scan |
| busca ranqueada `ZETA` | 5,41 ms | 0,25 ms | 8 | 1350 / **0** | Seq Scan |
| página 40 (offset 3900) | 11,55 ms | 0,13 ms | 100 | 1344 / **0** | Seq Scan |

- **Sem N+1:** uma única consulta responde página **e** total (`WindowAgg` com `COUNT(*) OVER ()`).
  Nenhum `Nested Loop` sobre a tabela de produtos.
- **Limite de página aplicado** em todos os planos (nó `Limit`, 100 linhas).
- **Zero leitura de disco** (`Shared Read Blocks = 0` em todos os cenários).
- O `Seq Scan` é **explicado pela fixture**: 5.040 linhas em ~1.344 páginas, filtros de baixa
  seletividade e `ORDER BY` que exige `Sort` de qualquer forma — o planejador escolhe varredura
  sequencial porque índice não pagaria. Onde há índice útil (`barcode`), ele **é** usado
  (Bitmap Index Scan). Tempos ≤ 17 ms. **Não bloqueia.**

---

## 12. Riscos residuais e ressalvas

| # | Ressalva | Severidade | Bloqueia merge? | Encaminhamento |
|---|---|---|---|---|
| **R-1** | `mergeProdutoFiscalIntoMetadata` **substitui** `metadata.fiscal` inteiro pelo objeto compacto do input. Subcampos não trazidos pela planilha (`cfop`, `cst`, `csosn`, `origemMercadoria`, `unidadeComercial`, `unidadeTributavel`, `codigoAnp`, `exTipi`) são **perdidos** quando uma importação toca o fiscal. **Verificado:** `unidadeComercial: "UN"` desapareceu após importar planilha só com NCM/CEST. | P2 | **Não** | **Pré-existente na `main`**: `lib/produto-fiscal.ts` **não** foi alterado por esta branch e a `main` já chamava o helper com o metadata atual. Como alimenta emissão NFC-e, merece GOAL próprio. |
| **R-2** | O teste de integração publicado (`produtos-listagem-sql.integration.test.ts`) é **`skipIf` por padrão** e **acoplado a uma fixture não versionada** — o repositório não traz seeder para ele (`FORNECEDOR ALFA CORR001`, `IMP-4471`, `IMP-9902` só existem no banco do executor anterior). | P2 | Não | Versionar um seeder e um `npm script` dedicado. |
| **R-3** | Rodado contra a fixture desta readiness, o teste publicado **executa** (não fica skipped): **13 de 16 passam**. Os 3 que falham são **premissas de fixture, não defeitos**: (a) compara um conjunto de 471 SKUs sintéticos contra uma página de `pageSize: 200`; (b) assume que `batchId` nunca colide entre lojas; (c) assume que nenhum produto contém `%` literal. | P2 | Não | Corrigir as três asserções junto com R-2. |
| **R-4** | `lib/cadastros/produtos-listagem-sql.ts` não importa o pacote `server-only`. Na prática é server-only (único consumidor é `"use server"`), mas a garantia é convencional, não mecânica. | P3 | Não | Uma linha de `import "server-only"`. |
| **R-5** | Ausência de **CI com PostgreSQL**. | P2 | Não | Follow-up não bloqueante (previsto no GOAL). |
| **R-6** | Ausência de **gate automatizado pós-bundle** — o defeito F-02 só aparece depois do `next build`, e nada no CI exercita esse caminho. | P2 | Não | Follow-up não bloqueante (previsto no GOAL). É a ressalva de maior valor prático. |
| **R-7** | Falha de **rede** (não de SQL) na Server Action cai no `catch` genérico e exibe a mensagem do erro (ex.: `Failed to fetch`) em vez de texto de produto. A tabela **é** esvaziada, então não induz decisão errada. | P3 | Não | Follow-up não bloqueante (previsto no GOAL). |
| **R-8** | `Seq Scan` na fixture concentrada. | P3 | Não | Explicado pela distribuição; tempos ≤ 17 ms. |
| **R-9** | Mudança **deliberada**: importação passa a **inativar** produto existente que termine sem preço. | — | Não | **É o objetivo do F-05.** Mudança de comportamento consciente, documentada no contrato. Merece nota de release para o operador. |
| **R-10** | `getConferenciaLote` tem fallback em memória (`take: 2000`) quando o filtro JSON-path falha. Não perde o recorte (continua por `storeId` **e** `batchId`), mas trunca lotes > 2.000 itens. | P3 | Não | Fora do escopo desta entrega. |

As ressalvas **R-5, R-6 e R-7** são exatamente as três que o GOAL autoriza como follow-up não
bloqueante — e todas as provas empíricas desta readiness passaram.

---

## 13. Validações finais

| Comando | Resultado |
|---|---|
| `npm ci` (Node 20) | ✅ exit 0 — 883 pacotes |
| `npx prisma generate` | ✅ exit 0 |
| `npx prisma validate` | ✅ *"The schema at prisma\schema.prisma is valid"* |
| `npx prisma db push` | ✅ exit 0 (somente no PostgreSQL 17 local) |
| `npx vitest run` | ✅ **3.743 passaram** · 62 skipped · 2 expected-fail · **3 timeouts de 5 s** em testes-guarda que varrem o filesystem |
| ↳ re-execução dos 3 com `--testTimeout=180000` | ✅ **13/13 passaram** — timeouts eram carga de máquina (servidor Next + PostgreSQL ativos), **não** defeito da branch |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | (ver §13.1) |
| `npm run build` | ✅ exit 0 — compilado em 7,3 min, 103 páginas estáticas geradas |
| `npm run start` + harness HTTP pós-bundle | ✅ 5/5 specs Playwright passaram |
| `git diff --check` | ✅ limpo |
| Testes PostgreSQL apenas *skipped*? | ❌ **não** — a IT publicada foi executada com `PRODUTOS_LISTAGEM_SQL_IT=1` (§12 R-3), além de todo o harness independente desta readiness |

### 13.1 Type-check

`npx tsc --noEmit` com heap de 8 GB: **exit 0, nenhum erro** (log em
`C:\tmp\omni-readiness-final-001\tsc.log`, vazio).

---

## 14. Escopo desta sessão

- **Criado:** apenas este documento.
- **Alterado / removido:** nada.
- **Áreas protegidas:** nenhuma tocada.
- **Harness da readiness:** vive fora do repositório
  (`C:\tmp\omni-readiness-final-001\`); os arquivos temporários usados dentro da worktree
  (`__readiness_final_001/`, `e2e/specs/zz-readiness-final-001.spec.ts`) foram **removidos** e o
  `git status` da worktree está **vazio**.
- **Nenhum acesso remoto.** Nenhum produto real tocado.

> ⚠️ Armadilha confirmada nesta sessão: `npx vitest run` reescreve
> `lib/fiscal/tax-engine/__snapshots__/calculator.test.ts.snap` **com CRLF** (conteúdo idêntico,
> só as quebras de linha mudam). O arquivo foi restaurado com `git checkout --` antes do commit e
> **não** faz parte desta auditoria — nem dos commits publicados da branch de correções.

---

## 15. Decisão

**Classificação: B — pronto com ressalvas não bloqueantes.**

F-02 aprovado **pós-bundle** · F-05 aprovado · F-06 aprovado · fixture Martins **13/13** ·
multi-loja aprovado · visual aprovado · Node 20 · PostgreSQL 17 · nenhuma alteração estrutural ·
nenhum acesso remoto.

**Próximo GOAL: `CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-MERGE-001`.**

Recomendações para o merge (não bloqueantes):
1. Abrir GOAL separado para **R-1** (perda de subcampos de `metadata.fiscal`) — é o único item com
   potencial de impacto fiscal, e é **pré-existente na `main`**.
2. Tratar **R-2/R-3** (seeder versionado + 3 asserções acopladas à fixture) junto com **R-5/R-6**
   (CI PostgreSQL + gate pós-bundle) num GOAL de infraestrutura de teste.
3. Registrar em nota de release a mudança de comportamento **R-9**: importação passa a inativar
   produto existente que termine sem preço de venda.
