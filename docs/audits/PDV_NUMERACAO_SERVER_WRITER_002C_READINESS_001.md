# PDV-NUMERACAO-SERVER-WRITER-002C-READINESS-001

## 1. Veredito executivo

| Item | Resultado |
|---|---|
| Veredito | **APTO COM RESSALVAS** — implementação autorizada somente após os gates G1–G4 |
| Classificação | **Classe B** |
| Base auditada | `origin/main@69fb4190362b7f850632fcb1dcb0020371a957a1` |
| Branch | `audit/pdv-numeracao-server-writer-002c-readiness` |
| Reaplicação de `dd4a86d` | ✅ limpa, sem conflito, 3 arquivos exatos |
| Precondição de governança de migrations | ✅ **satisfeita** (era o bloqueio Classe C anterior) |
| Escritas em código, testes, configuração, SQL, banco ou Vercel | **Zero** |
| Writer canônico de venda real | `lib/ops-upsert-venda.ts#upsertVendaInTransaction` |
| Fontes atuais de número | **3** — navegador (`nextSaleId`), `count()+1` da O.S., número externo do importador |
| Gate bloqueante remanescente mais grave | **G1** — nenhuma superfície configura `Store.codigoNumeracaoVenda` |
| GOAL 002C | **não iniciado** — writer não implementado, PDVs não modificados |

A auditoria **Classe C** anterior
([`PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md`](./PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md))
bloqueou o 002C por um único motivo declarado: dois projetos Production aplicando
migrations em bancos diferentes, sem autoridade única. Esse motivo **deixou de existir**
— ver [`DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`](./DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md).

O 002C **não** é promovido a Classe A porque a auditoria encontrou três condições
independentes que, isoladas, quebrariam venda real em Production se o writer fosse
integrado como está. Nenhuma delas é irreparável; todas são endereçáveis por gates
explícitos, e é isso que caracteriza Classe B e não Classe C.

## 2. Escopo, método e limites

Worktree isolada em `C:\tmp\omni-gestao-pdv-numeracao-002c-readiness`, criada a partir de
`origin/main`, preservando o checkout principal e todos os WIPs externos.

Foram usados apenas: código versionado, migrations, schema Prisma, testes, documentação e
histórico Git.

**Não** foram executados: SQL, DDL, DML, Prisma contra qualquer banco, migration, `db push`,
deploy, alteração de projeto/variável/domínio Vercel, correção ou reenvio de pendências
antigas, nem qualquer etapa de implementação do 002C.

### 2.1 Limites declarados (o que esta auditoria NÃO prova)

| Limite | Consequência |
|---|---|
| **Nenhuma suíte de testes foi executada** neste GOAL | As afirmações sobre testes descrevem o que o código de teste **assere**, não um resultado de execução observado aqui |
| `lib/vendas/server-sale-numbering.integration.test.ts` é **opt-in** (`SALE_NUMBERING_TEST_DATABASE_URL`, `integration = rawUrl ? describe : describe.skip`, linha 21) e recusa host não-local (linhas 26–37) | Sem essa variável, a suíte que prova lock de linha, P2002 e rollback **não roda**. Em CI padrão ela é pulada silenciosamente |
| Nenhuma consulta aos bancos Production | Contagens de `SerieVenda`, de vendas com campos novos preenchidos e de lojas com `codigoNumeracaoVenda` permanecem **UNKNOWN**, como já registrado na auditoria 002B |
| Estado físico das constraints em Production | **Não reverificado**; herda o `UNKNOWN` da auditoria 002B (seção 5.2) |

## 3. Reaplicação do commit documental `dd4a86d`

| Verificação | Resultado |
|---|---|
| Pai de `dd4a86d` | `69fb419` — **idêntico** ao `origin/main` atual |
| Cherry-pick | limpo, **zero conflito** (semântico ou textual) |
| Commit resultante | `c4e9a69` |
| Arquivos alterados | exatamente **3**, conforme exigido |

Arquivos, sem excedentes:

1. `docs/audits/DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md` (novo, 220 linhas);
2. `docs/ai/DEPLOY.md`;
3. `docs/ai/CURRENT_STATUS.md`.

Como `dd4a86d` foi escrito diretamente sobre a `main` atual, não houve deriva de base e
nenhuma decisão de conflito precisou ser tomada.

## 4. Auditoria do contrato existente (GOAL 002B)

### 4.1 Migration `0016_add_sale_numbering_infrastructure`

Arquivo: `prisma/migrations/0016_add_sale_numbering_infrastructure/migration.sql` (174 linhas).

Exclusivamente aditiva. Nenhum `DROP`, `RENAME`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`,
backfill ou renumeração. Todo statement é idempotente (`IF NOT EXISTS` / guarda
`pg_constraint`).

| Objeto | Definição |
|---|---|
| enum `VendaNumeracaoOrigem` | `LEGACY_CLIENT`, `SERVER_V1`, `IMPORTED` (linha 27) |
| `stores.codigoNumeracaoVenda` | `VARCHAR(8)` **NULLABLE**, unique, check `^[A-Z0-9]{2,8}$` (linhas 32–36, 113–118) |
| tabela `series_venda` | `id`, `storeId`, `ano`, `prefixo`, `proximoNumero` (default 1), `ativo`, timestamps (linhas 39–49) |
| 8 colunas em `vendas` | `clientSaleId`, `idempotencyHash`, `idempotencyHashVersion`, `serieVendaId`, `anoNumero`, `numeroSequencial`, `numeradaEm`, `numeracaoOrigem` — **todas NULLABLE, todas sem DEFAULT** (linhas 76–83) |

Índices e constraints relevantes:

| Nome | Papel |
|---|---|
| `series_venda_storeId_ano_key` | uma série por loja/ano |
| `series_venda_prefixo_ano_key` | impede duas lojas com o mesmo prefixo no mesmo ano |
| `series_venda_id_storeId_key` | alvo da FK composta — trava `storeId` junto com a série |
| `vendas_storeId_clientSaleId_key` | uma chave de tentativa por loja; múltiplos `NULL` preservam o histórico |
| `vendas_serieVendaId_numeroSequencial_key` | um número por série; múltiplos `(NULL, NULL)` permitidos |
| `vendas_serieVendaId_storeId_fkey` | FK composta `(serieVendaId, storeId)` → `series_venda(id, storeId)`, `ON DELETE RESTRICT` |
| `vendas_storeId_anoNumero_numeroSequencial_idx` | ordenação/consulta por loja/ano/número |
| checks de faixa | `ano` 2000–9999; `proximoNumero` 1–1.000.000; `numeroSequencial` NULL ou 1–999.999 |

**Nota operacional preservada do próprio arquivo (linhas 19–22):** `db push` cria o shape
Prisma mas **não** cria os CHECKs; e a cadeia histórica de migrations **não é
bootstrap-complete em banco vazio** (falha preexistente na `0005`). Isso restringe como um
ambiente de teste pode ser construído (ver §10.4).

### 4.2 Modelos Prisma

`prisma/schema.prisma`:

- `SerieVenda` (linhas 1395–1416) — `prefixo` documentado como *snapshot write-once* de
  `Store.codigoNumeracaoVenda` na criação da série;
- `Venda` (linhas 1421–1495) — os 8 campos novos são todos `?` (opcionais); `pedidoId`
  permanece `@unique` **global** (linha 1428);
- `Venda.storeId` mantém `@default("loja-1")` (linha 1423) — default de schema legado que o
  allocator **não** honra: `normalizeStoreId` recusa `storeId` vazio sem fallback
  (`server-sale-numbering.ts:200-209`).

### 4.3 Allocator server-side

Arquivo: `lib/vendas/server-sale-numbering.ts` (426 linhas), `import "server-only"`.

Contratos públicos exportados:

| Símbolo | Tipo |
|---|---|
| `SaleNumberingTransactionClient` | alias de `Prisma.TransactionClient` |
| `SaleNumberingError`, `isSaleNumberingError`, `SALE_NUMBERING_ERROR_CODES`, `SaleNumberingErrorCode`, `SaleNumberingErrorContext` | erro tipado e classificação |
| `SALE_NUMBERING_PREFIX`, `SALE_NUMBERING_TIMEZONE`, `SALE_NUMBER_MIN/MAX`, `SALE_SEQUENCE_EXHAUSTED_AT`, `SALE_NUMBER_PADDING`, `SALE_NUMBERING_ANO_MIN/MAX` | constantes do formato |
| `normalizeSaleNumberingCode`, `isValidSaleNumberingCode`, `isValidSaleNumberingAno`, `isValidSaleNumero` | validadores puros |
| `resolveSaleNumberingAno` | ano civil em `America/Sao_Paulo` |
| `formatSalePedidoId` | formatação do número |
| `saleNumberingAdvisoryKey` | chave int4 FNV-1a do advisory lock |
| `isRetryableSaleNumberingTransactionError` | **somente** `P2034` |
| `resolveStoreSaleNumberingCode`, `ensureSerieVenda`, `allocateSaleNumber` | operações transacionais |
| `SerieVendaResolvida`, `SaleNumberAllocation` | tipos de retorno |

Códigos de erro: `SALE_NUMBERING_NOT_CONFIGURED`, `SALE_SEQUENCE_EXHAUSTED`,
`SALE_NUMBERING_INVARIANT_BROKEN`.

### 4.4 Comportamento por `storeId`

- `storeId` é **sempre explícito**; string vazia/ausente lança
  `SALE_NUMBERING_NOT_CONFIGURED` — **não há fallback para `loja-1`** (linhas 200–209);
- a loja precisa existir **e** ter `codigoNumeracaoVenda` válido, senão
  `SALE_NUMBERING_NOT_CONFIGURED` (linhas 211–236);
- `assertSerieUsavel` recusa série de outra loja/ano, prefixo divergente do código
  configurado, série inativa, contador inválido e série esgotada (linhas 252–300);
- o advisory lock é escopado por `(hash(storeId), ano)` (linha 337), então lojas distintas
  não se bloqueiam mutuamente na criação da primeira série do ano.

### 4.5 Formato e ciclo do número

`VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}` — `formatSalePedidoId`, linhas 152–155.

- prefixo literal fixo `VDA`;
- `CODIGO_LOJA` = `Store.codigoNumeracaoVenda` normalizado (`[A-Z0-9]{2,8}`);
- `ANO` = ano civil **de aceitação no servidor**, `America/Sao_Paulo`
  (`resolveSaleNumberingAno`, linhas 101–123) — o relógio do cliente nunca é usado;
- `NNNNNN` = 6 dígitos com zero-padding, faixa 1..999.999;
- virada de ano cria série nova automaticamente; o contador **não** é reiniciado
  manualmente;
- esgotamento em 999.999 falha fechado com `SALE_SEQUENCE_EXHAUSTED`, sem avançar o
  contador (linhas 292–298).

**O formato novo é incompatível com o formato antigo** (`VDA-2026-0001`, 4 dígitos, sem
código de loja) e com o da O.S. (`VND-2026-00001`). Ver §7.

### 4.6 Garantias reais de unicidade e ordenação

Provadas **pelo código e pelas constraints**:

| Garantia | Mecanismo | Onde |
|---|---|---|
| Uma série por loja/ano | unique `(storeId, ano)` no banco | migration linha 51 |
| Um número por série | unique `(serieVendaId, numeroSequencial)` | migration linha 90 |
| Série não cruza loja | FK composta `(serieVendaId, storeId)` | migration linha 101 |
| Incremento atômico | **um único** `UPDATE ... increment: 1` sob lock de linha do Postgres, com predicado de loja/ano/estado/faixa no `WHERE` | `server-sale-numbering.ts:369-379` |
| Sem `count`/`MAX`/último registro | asserido estaticamente | `server-sale-numbering.contract.test.ts:35-40` |
| Ordenação | índice `(storeId, anoNumero, numeroSequencial)` | migration linha 93 |

**Ordenação:** a ordem **numérica** por `(storeId, anoNumero, numeroSequencial)` é garantida
pelas colunas inteiras. A ordenação **lexicográfica de `pedidoId`** só é estável dentro de
uma mesma loja e ano, por causa do padding fixo. Não há, no repositório, nenhum
`orderBy: { pedidoId: ... }` — a busca não retornou ocorrências, então nenhum relatório
existente depende de ordenação por string de número.

**Atenção — a ordem de alocação não é a ordem temporal de `Venda.at`.** `at` é a data
**original** da venda no cliente (`ops-upsert-venda.ts:427-433`, comentário em 546–547),
preservada inclusive em sync retroativo. Uma venda pendente de ontem sincronizada hoje
receberia um número **posterior** ao de vendas de hoje. Número e cronologia divergem por
construção.

### 4.7 Rollback e lacunas — o que está e o que **não** está provado

O incremento vive na transação do chamador; `abort` reverte o contador. O teste unitário
`"rollback após incremento não consome número"` (`server-sale-numbering.test.ts:282`) e o
teste de integração `"rollback após o incremento não consome número"`
(`server-sale-numbering.integration.test.ts:291`) asserem exatamente isso.

O teste `"50 alocações concorrentes não duplicam nem deixam lacuna"`
(`integration.test.ts:164`) assere ausência de lacuna sob concorrência.

**Não é correto afirmar que a numeração é gapless.** Três razões concretas:

1. **A suíte que proveria isso é opt-in e não foi executada aqui** (§2.1). O que existe é
   asserção de teste, não resultado observado.
2. **A garantia é condicional ao chamador.** O allocator não impõe que a alocação e o
   `Venda.create` compartilhem a transação — é convenção documentada
   (`server-sale-numbering.ts:8-10`), não constraint. Um chamador que alocasse e falhasse
   **depois** do commit criaria lacuna.
3. **`DELETE` de venda cria lacuna permanente.** A FK é `ON DELETE RESTRICT` sobre a
   *série*, não sobre a venda; nada impede remover uma `Venda` numerada. Cancelamento
   também nunca decrementa nem reutiliza número (migration, linha 15) — o número fica
   consumido por uma venda cancelada, o que é correto fiscalmente mas **não** é
   "sequência sem buracos" para quem lê apenas as vendas ativas.

Conclusão factual: a numeração é **atômica, única por série e sem reuso**. Ela **não é
declarada gapless** por esta auditoria.

### 4.8 Testes existentes da infraestrutura

| Arquivo | Natureza | Casos |
|---|---|---|
| `server-sale-numbering.test.ts` | unitário, fakes | 12 |
| `server-sale-numbering.contract.test.ts` | estático, lê os arquivos-fonte | 5 |
| `server-sale-numbering.integration.test.ts` | PostgreSQL real, **opt-in** | 15 |

Script dedicado: `npm run test:vendas-numeracao:integration` (`package.json:21`).

**Fato crítico para o 002C — o contrato estático proíbe o call site que o 002C precisa
criar.** `server-sale-numbering.contract.test.ts:42-52` assere que
`server-sale-numbering` e `allocateSaleNumber` **não aparecem** em:

- `app/api/ops/venda-persist/route.ts`
- `app/api/ops/sync-legacy-vendas/route.ts`
- `lib/ops-upsert-venda.ts`
- `lib/operations-store.tsx`

Integrar o writer **fará esse teste falhar por design**. Ele precisa ser reescrito no mesmo
GOAL, invertendo a asserção (passa a exigir o call site no ponto único e a proibi-lo em
todos os demais). Isso é uma edição obrigatória, não uma regressão.

## 5. Mapa dos writers

### 5.1 Caminhos que criam ou persistem venda real

| # | Caminho | Arquivo | Ação | Numera? |
|---|---|---|---|---|
| W1 | **PDV ao vivo** (todos os PDVs) | `app/api/ops/venda-persist/route.ts:75` → `upsertVendaInTransaction` | **cria** venda nova | recebe `sale.id` do cliente |
| W2 | **Replay/sync legado** | `app/api/ops/sync-legacy-vendas/route.ts:62` → mesmo motor | **cria** venda histórica | recebe `sale.id` do cliente |
| W3 | **Faturamento de O.S.** | `app/actions/operacoes.ts:1152-1201` (`criarVendaDeOSAction`) | **cria** venda | **numera sozinho** — `count()+1` |
| W4 | **Importador avançado** | `lib/importador-avancado/persistidor.ts:821` | **upsert** de venda importada | número **externo**, do arquivo |
| W5 | Correção de itens | `app/api/vendas/[id]/corrigir-itens/route.ts:271` | recria `ItemVenda` de venda existente | não |
| W6 | Correção de cliente/título/parcelas/meta | `app/api/vendas/[id]/corrigir*`, `corrigir-titulo`, `corrigir-item-meta` | **atualiza** venda existente | não |
| W7 | Cancelamento | `app/api/vendas/[id]/cancelar/route.ts` | **atualiza** status | não |
| W8 | Enriquecimento enterprise | `app/actions/vendas-enterprise.ts#enrichVendaEnterprise` | **atualiza** `payload` | não — mas **busca por `pedidoId`** |
| W9 | Devolução / troca | `app/api/ops/devolucao/route.ts` | cria `DevolucaoVenda`, referencia `vendaLocalId` | não |

**Somente W1, W2, W3 e W4 criam `Venda`.** W1 e W2 compartilham o mesmo motor
(`upsertVendaInTransaction`), o que torna esse arquivo o **ponto único de integração** do
002C. W3 e W4 são caminhos separados que precisam de decisão explícita (§6.3, §6.4).

### 5.2 Origem dos PDVs (todos convergem em W1)

`finalizeSaleTransaction` (`lib/operations-store.tsx:1438`) é o único produtor de venda no
cliente. Chamadores:

| PDV / tela | Arquivo |
|---|---|
| PDV Classic | `components/dashboard/vendas/pdv-classic.tsx:1900` |
| PDV Supermercado | `components/dashboard/vendas/pdv-supermercado.tsx:1443` |
| PDV Assistência Enterprise | `components/dashboard/vendas/pdv-assistencia-enterprise.tsx:1890` |
| PDV Venda Completa Enterprise | `components/dashboard/vendas/pdv-venda-completa-enterprise.tsx:497` |
| Venda Completa Enterprise | `components/dashboard/vendas/venda-completa-enterprise.tsx:645` |
| Trocas e devolução (venda de troca) | `components/dashboard/vendas/trocas-devolucao.tsx:431` |

`components/pdv-github-original/**` é **cópia congelada** (tem `route.ts`, `operations-store.tsx`
e `ops-upsert-venda.ts` próprios) e **não** está no caminho produtivo. Não deve ser alterada
pelo 002C — alterá-la ampliaria escopo sem efeito operacional.

**"Vendas em espera"** (`pdv-classic.tsx`, `pdv-supermercado.tsx`,
`pdv-assistencia-enterprise.tsx`) é estado **puramente local** de carrinho: não cria `Venda`
e não consome número. Só numera quando o operador finaliza, via `finalizeSaleTransaction`.
Não é writer.

### 5.3 Distinção exigida pelo GOAL

| Classe | Caminhos | Efeito na numeração |
|---|---|---|
| **Criação de venda nova** | W1, W2, W3, W4 | única classe que deve consumir número |
| **Atualização de venda existente** | W6, W8 | nunca renumera |
| **Correção** | W5, W6 | nunca renumera; `corrigir-itens` recria itens e reprocessa estoque |
| **Cancelamento** | W7 | nunca decrementa nem libera número |
| **Reenvio idempotente** | `flushPendingSales` (`operations-store.tsx:962`), `doRetrySyncSale` (linha 1041), `retrySyncSaleRetroactive` (linha 1112) | **precisa** devolver o mesmo número, nunca alocar novo |
| **Registro de pendência** | `syncPending: true` no `SaleRecord` local (linha 1601) | venda existe no cliente **antes** de existir no servidor |

### 5.4 Idempotência de reenvio hoje

O motor é **create-only com replay fail-closed** (`ops-upsert-venda.ts:397-424`):

1. `findUnique({ where: { pedidoId } })` é a **primeira** operação, antes de qualquer
   leitura de negócio, gate de caixa ou escrita;
2. se a venda existe, `classifyExistingVendaReplay` (linhas 336–365) decide:
   - outra loja → `PedidoIdDeOutraLojaError` (409, fail-closed);
   - mesma loja, fatos divergentes (fingerprint) → `PedidoIdConflitoMesmaLojaError` (409);
   - mesma loja, mesmos fatos → **replay idempotente**, retorna a venda existente;
3. corrida perdida na unique global vira `VendaCreateUniqueConflictError`; a rota relê o
   vencedor **fora** da transação abortada e reclassifica
   (`venda-persist/route.ts:96-113`).

**A chave de idempotência de hoje é o próprio `pedidoId`.** É exatamente isso que o 002C
remove do cliente — daí a necessidade de `clientSaleId` (§6.5).

## 6. Fonte atual do número

### 6.1 Geração no cliente (fonte dominante)

`lib/operations-store.tsx:145-153`:

```
function nextSaleId(sales: SaleRecord[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const s of sales) {
    const m = s.id.match(/^VDA-(\d{4})-(\d+)$/)
    if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10))
  }
  return `VDA-${year}-${String(max + 1).padStart(4, "0")}`
}
```

Propriedades reais, todas adversas:

- **MAX+1 sobre o cache local** (`localStorage`), não sobre o banco;
- **ano do relógio do navegador** (`new Date().getFullYear()`), não do servidor;
- **reinicia em `0001` em cada loja**, produzindo colisão entre lojas — o defeito está
  documentado com evidência de campo em `ops-upsert-venda.ts:95-114`: a loja-2 tem
  `VDA-2026-0001..0505` com exatamente **5 buracos** (0046, 0047, 0111, 0221, 0288), todos
  ocupados por vendas íntegras da loja-1;
- colide também entre **terminais e abas** da mesma loja, porque cada navegador tem seu
  próprio cache;
- padding de **4 dígitos** (o formato server-side usa 6).

O guard `PedidoIdDeOutraLojaError` hoje **contém** o dano (fail-closed, nada é gravado), mas
não elimina a causa: a venda fica presa em `syncPending` e a recuperação exige renumeração
administrada.

### 6.2 Campos que recebem o número

`Venda.pedidoId` é a chave de negócio e se propaga, **como string**, para:

| Destino | Campo | Onde |
|---|---|---|
| Ledger de estoque | `MovimentacaoEstoque.documento` e `.motivo` | `ops-upsert-venda.ts:730-731` |
| Financeiro | `MovimentacaoFinanceira.referenciaId` + descrição | linhas 762–764 |
| Contas a Receber | `ContaReceberTitulo.localKey` = `pdv-aprazo-{pedidoId}[-{n}]` | linha 849 |
| Crédito/vale | `UsoCreditoCliente.vendaId` | linha 798 |
| Devolução | `DevolucaoVenda.vendaLocalId` | `app/api/ops/devolucao/route.ts:118,195,201` |
| Cancelamento | busca devoluções por `vendaLocalId` | `app/api/vendas/[id]/cancelar/route.ts:108` |
| Enriquecimento | chave de busca com retry | `app/actions/vendas-enterprise.ts` |
| Fiscal | chave de busca da venda | `lib/fiscal/queue/queue-producer.ts:146` |
| Caixa/conferência | escopo de vendas da sessão | `lib/caixa/sessao-vendas-escopo.ts` |
| Contador | pacote/CSV | `lib/contador/pacote/carregar-fontes.ts:400` |
| Recibo/impressão | identificador impresso | `lib/escpos.ts:94` |
| Cliente | `SaleRecord.id` no `localStorage`; junção local↔remoto | `lib/operations-sales-merge.ts#mergeSalesById` |

`pedidoId` é, na prática, a **chave de junção universal** entre cliente, servidor e todos os
satélites. Essa é a razão técnica pela qual o 002C não é um GOAL localizado.

### 6.3 O.S. — segunda fonte de verdade, com defeito próprio

`app/actions/operacoes.ts:1159-1161`:

```
const year = new Date().getFullYear();
const count = await prisma.venda.count({ where: { storeId: os.storeId } })
const pedidoId = `VND-${year}-${(count + 1).toString().padStart(5, "0")}`
```

Problemas comprovados por leitura:

- usa **`count()+1`** — exatamente o padrão que a ADR-0019 rejeita explicitamente
  ("Janela de concorrência e reutilização");
- roda **fora de transação**: `count` e `create` são chamadas separadas;
- conta **todas** as vendas da loja, não as do ano — na virada de ano o contador **não**
  reinicia e pode colidir com números já emitidos;
- usa prefixo **`VND-`**, distinto de `VDA-`, então não colide com o PDV hoje — o que
  significa que a loja tem **duas séries comerciais paralelas**;
- não cria `MovimentacaoEstoque`, `MovimentacaoFinanceira` nem título; é um caminho de
  venda com efeitos diferentes.

Chamado por `components/operacoes/lovable/api/vendas.ts:11`.

### 6.4 Importador — número externo

`lib/importador-avancado/persistidor.ts:821` faz `upsert` por `pedidoId` vindo do arquivo
importado. É a razão de existir o valor `IMPORTED` no enum `VendaNumeracaoOrigem`. **Não deve
consumir número da série** — o número já existe no documento de origem.

### 6.5 Contratos que aceitam número vindo do cliente

| Superfície | Aceita `sale.id` do cliente | Consequência |
|---|---|---|
| `POST /api/ops/venda-persist` | **sim** — `sale.id` obrigatório, 400 se ausente (`route.ts:55-58`) | cliente é a autoridade |
| `POST /api/ops/sync-legacy-vendas` | **sim** — array de `SalePayload` | idem, em lote |
| `upsertVendaInTransaction` | **sim** — `throw new Error("sale.id inválido")` se vazio (linha 407) | contrato interno |

Nenhuma dessas superfícies tem hoje um caminho em que o servidor **produz** o número.

### 6.6 Fila offline / localStorage

- A venda é criada **primeiro no cliente**, com `syncPending: true`
  (`operations-store.tsx:1601`), e o POST é **fire-and-forget** (`void fetch`, linha 1622);
- `flushPendingSales` (linha 962) reenvia periodicamente, com cooldown de 5 min para
  rejeições 4xx (linhas 959–960) — rejeição de regra não é re-POSTada em laço;
- `mergeSalesById` junta local e remoto **por `id`**;
- `refreshSalesFromServer` (linha 1010) traz `pedidoId` do servidor como `id` do
  `SaleRecord`.

**Implicação direta e crítica:** se o servidor atribuir um `pedidoId` diferente do `sale.id`
local, `mergeSalesById` deixa de casar as duas cópias e a **mesma venda aparece duas vezes**
no cliente — uma local pendente eterna e uma remota. Isso não é hipótese: é a semântica
literal de uma junção por chave que mudou de valor.

### 6.7 Risco de duas fontes de verdade

Hoje já existem **três** fontes (§6.1, §6.3, §6.4). O 002C introduz uma quarta enquanto as
anteriores continuarem vivas. O plano precisa **neutralizar**, não apenas adicionar (§10.3).

## 7. Transação e concorrência

### 7.1 Fronteira transacional recomendada

A transação já existente em `venda-persist/route.ts:73-88` é a fronteira correta. Ela usa
`prisma.$transaction(async (tx) => ...)` com `{ maxWait: 15_000, timeout: 20_000 }` e
**sem `isolationLevel` explícito** — ou seja, o default do PostgreSQL, **READ COMMITTED**,
que é precisamente o nível exigido pelo allocator (`server-sale-numbering.ts:302-310`).
Nenhuma mudança de isolamento é necessária, e **nenhuma deve ser feita**: RepeatableRead
propaga P2002 e Serializable propaga P2034 na disputa inicial da série (ADR-0019,
"Consequências e limites").

Ordem recomendada dentro da mesma transação:

| Ordem | Passo | Justificativa |
|---|---|---|
| 0 | Guard de identidade / replay por `clientSaleId` | fail-closed antes de consumir número |
| 1 | Gate de caixa (`requireCaixaSession`) | hoje é passo 0 do motor; falha aqui **não pode** ter consumido número |
| 2 | Resolução de produtos / validação de linhas | idem |
| 3 | **`allocateSaleNumber(tx, { storeId })`** | o mais tarde possível — ver §7.2 |
| 4 | `Venda.create` com `pedidoId`, `serieVendaId`, `anoNumero`, `numeroSequencial`, `numeradaEm`, `numeracaoOrigem: SERVER_V1`, `clientSaleId` | |
| 5 | `ItemVenda` | |
| 6 | Baixa de estoque + `MovimentacaoEstoque` | |
| 7 | `MovimentacaoFinanceira` | |
| 8 | Débito de `ClienteCredito` + `UsoCreditoCliente` | |
| 9 | `ContaReceberTitulo` (parcelas) + FK na venda | |
| 10 | Eventos posteriores (fiscal, WhatsApp, enrich) | **fora** da transação, após commit |

**Confirmação exigida pelo GOAL:** sim, o allocator **pode** executar dentro da transação
existente. Ele recebe `Prisma.TransactionClient`, não abre transação própria
(`contract.test.ts:32` assere `not.toMatch(/\.\$transaction\s*\(/)`), não importa
`@/lib/prisma` (linha 31) e usa apenas `tx.serieVenda.*`, `tx.store.findUnique` e
`tx.$executeRaw` — todos disponíveis no `TransactionClient`.

### 7.2 Consequência de concorrência subestimada (P1)

O `UPDATE` de `proximoNumero` toma **lock de linha** na série `(storeId, ano)` e o
PostgreSQL o mantém **até o fim da transação** — não até o fim do statement. Como a
transação da venda inclui estoque, financeiro, crédito e até 24 parcelas de título, **todas
as vendas concorrentes da mesma loja passam a serializar pela duração inteira da transação
de venda**, não apenas pelo instante da alocação.

Agravantes concretos, ambos já documentados no próprio código:

- `DATABASE_URL` usa `connection_limit=1` (pooler) — comentário em
  `venda-persist/route.ts:81-87` explica que os defaults do Prisma (maxWait 2s/timeout 5s)
  **já estouravam** neste cenário, motivando 15s/20s;
- o advisory lock de `ensureSerieVenda` (linha 337) é adicional e só ocorre na **primeira
  venda do ano** de cada loja — ali a espera soma-se ao `maxWait`.

Mitigação: alocar o mais tarde possível (passo 3 acima, depois das validações que podem
abortar) e medir p95 de `venda-persist` no smoke. **Não** mitigar movendo a alocação para
fora da transação — isso quebraria a reversão do contador.

### 7.3 P2034 (write conflict / deadlock)

- Único código que autoriza retry: `isRetryableSaleNumberingTransactionError`
  (`server-sale-numbering.ts:196-198`) devolve `true` **apenas** para `P2034`;
- retry deve ser da **transação inteira**, com limite explícito (recomendado: 3 tentativas,
  backoff curto). Como a transação abortou por completo, nada foi gravado e nada é
  duplicado;
- o número alocado na tentativa perdida **é revertido** junto com a transação, então o retry
  não gera lacuna;
- **proibido** retry parcial: continuar dentro de uma transação abortada, ou realocar número
  sem refazer a transação, duplicaria efeitos. O teste unitário
  `"retry controlado repete a transação inteira e preserva a sequência"`
  (`server-sale-numbering.test.ts:300`) descreve exatamente essa forma.

### 7.4 P2002 (unique violation)

**P2002 nunca é retry genérico.** Com o writer server-side existirão quatro uniques capazes
de dispará-lo, e cada uma exige tratamento distinto:

| Unique | Significado | Tratamento correto |
|---|---|---|
| `vendas_pedidoId_key` | número já existe | não deve mais acontecer com número server-side; se acontecer, é invariante quebrada → 409/500 classificado, nunca retry |
| `vendas_storeId_clientSaleId_key` | **reenvio da mesma tentativa** | **replay idempotente** — relê a venda vencedora fora da transação e devolve `ok: true, replayed: true` |
| `vendas_serieVendaId_numeroSequencial_key` | dois números iguais na série | invariante quebrada → falha explícita |
| `series_venda_storeId_ano_key` | corrida na criação da primeira série | já tratado por advisory lock + re-leitura; sob READ COMMITTED converge (`integration.test.ts:342`) |

O mecanismo de releitura-fora-da-transação já existe e está correto
(`VendaCreateUniqueConflictError` + `venda-persist/route.ts:96-113`). O 002C deve
**estendê-lo** para `clientSaleId`, não substituí-lo.

### 7.5 Duplicação por reenvio

Sem `clientSaleId`, um reenvio no qual o cliente não soube da resposta (timeout, aba
fechada, rede caída **após** o commit) **alocaria um segundo número e criaria uma segunda
venda** — a `pedidoId` server-side seria diferente, então o guard de replay por `pedidoId`
não dispararia. Este é o risco de duplicidade central do 002C e o motivo pelo qual
`clientSaleId` não é opcional (§10.2, gate G3).

### 7.6 Falha depois da alocação e rollback do contador

- Falha **dentro** da transação (estoque insuficiente, caixa fechado, produto não resolvido,
  FK) → rollback total, contador revertido, nada gravado;
- falha **depois** do commit (resposta perdida na rede) → venda existe e está numerada; a
  proteção é exclusivamente `clientSaleId` no reenvio;
- cancelamento posterior → número permanece consumido, por decisão explícita (migration,
  linha 15). Correto.

### 7.7 Concorrência entre lojas e entre terminais

| Cenário | Comportamento |
|---|---|
| Lojas diferentes | séries independentes; advisory lock escopado por `(storeId, ano)`; sem contenção cruzada. Asserido em `integration.test.ts:216` e `:364` |
| Terminais da mesma loja | serializam no lock de linha da série — números únicos e consecutivos. Asserido em `integration.test.ts:145` e `:164` |
| Abas do mesmo navegador | deixam de colidir: o número passa a ser server-side |
| Timeout + repetição automática do cliente | `flushPendingSales` reenvia a cada ciclo com cooldown 4xx de 5 min; **cada reenvio precisa carregar o mesmo `clientSaleId`**, senão duplica |

## 8. Legado e bancos diferentes — respostas obrigatórias

### 8.1 O writer novo também ficará ativo no projeto legado?

**Sim.** Não há gate de runtime. Os dois projetos Vercel constroem **o mesmo commit da mesma
branch `main`** (`DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`, §7 e risco P3
§10). `MIGRATION_AUTHORITY_ENABLED` governa **exclusivamente** `prisma migrate deploy` em
`scripts/vercel-build.mjs` — não governa código de aplicação. Qualquer writer integrado à
`main` roda nos dois projetos.

### 8.2 O schema necessário existe nos dois bancos?

**Sim, com a ressalva já registrada.** A `0016` foi aplicada nos **dois** bancos em
03/08/2026, antes do guard existir (`PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md`,
§3.2). A estrutura física continua **não verificada independentemente** (§5.2 daquele
relatório) e esta auditoria não a reverificou.

**Assimetria criada pelo guard:** a partir de agora só o canônico recebe migrations novas. A
`0016` é a **última** migration que os dois bancos compartilham por acidente histórico.
Qualquer migration futura existirá apenas no canônico — o que é o comportamento desejado,
mas significa que o legado passa a divergir progressivamente do schema que o código espera.

### 8.3 Isso cria risco de vendas divergentes?

**Sim, e de duas naturezas distintas:**

1. **Séries independentes.** Os bancos são `DIFFERENT_DATABASES`. Uma venda no legado e uma
   no canônico, na mesma loja e ano, receberiam **o mesmo `pedidoId`** — cada banco tem seu
   próprio `series_venda`. Os números deixariam de ser globalmente únicos **entre
   ambientes**, embora únicos dentro de cada banco.
2. **Falha total no legado.** Se as lojas do banco legado não tiverem
   `codigoNumeracaoVenda` configurado — e não há superfície para configurá-lo (§9.1) — o
   allocator falha fechado com `SALE_NUMBERING_NOT_CONFIGURED` e **nenhuma venda é gravada**
   naquele ambiente.

O cenário (2) é o mais provável e o mais grave. O tráfego residual medido no legado é
predominantemente PWA/assets, **sem** `/api/ops/**` observado na janela auditada
(`DEPLOY_LEGACY_PROJECT_REAL_USAGE_AUDIT_001.md`, §3), mas essa ausência foi classificada
como **Classe B — não é prova histórica absoluta**. Uma instalação PWA antiga que ainda
aponte para `omni-gestao-pi.vercel.app` passaria a falhar toda venda, **silenciosamente para
o servidor** e com toast de pendência para o operador.

### 8.4 É necessário um gate runtime canônico para o writer?

**Sim — recomendação firme.** Um gate por variável de ambiente, presente **somente** no
projeto canônico, exatamente no molde já validado por `MIGRATION_AUTHORITY_ENABLED`. Sem
ele, o 002C entra em Production em dois ambientes com bancos distintos, um dos quais não
pode ser configurado nem observado com as superfícies disponíveis.

Semântica recomendada (fail-**open para o writer v1**, não fail-closed):

- gate **ausente ou falso** → mantém o writer v1 (número do cliente). Comportamento atual,
  legado continua funcionando exatamente como hoje;
- gate **presente e verdadeiro** → writer server-side.

Essa polaridade é deliberada e inverte a do guard de migrations: ali, fail-closed protege o
banco de escrita indevida; aqui, fail-closed **impediria vender**. A decisão segura para um
caminho de receita é degradar para o comportamento conhecido.

### 8.5 Desabilitar o writer no legado quebraria leitura ou build?

**Não.**

- **Build:** o gate é leitura de `process.env` em runtime; o código do allocator é compilado
  nos dois projetos de qualquer forma. Nada quebra em build time.
- **Leitura:** as colunas novas são todas nullable e **nenhuma UI as consome** — confirmado
  na auditoria 002B (§6, `NO_UI_NEW_FIELDS`) e reconfirmado aqui: a única referência a
  `codigoNumeracaoVenda` fora do allocator está em testes. `vendas-list` devolve `pedidoId`
  e não seleciona campo novo algum.

### 8.6 Qual comportamento é seguro enquanto o legado continua conectado?

1. Writer server-side **somente** sob gate presente no canônico;
2. legado permanece no writer v1, com o número do cliente e o guard
   `PedidoIdDeOutraLojaError` intacto;
3. **nenhuma** alteração de projeto, flag, domínio ou Git do legado — a decisão sobre
   desativá-lo continua pendente e fora deste GOAL;
4. o gate é a superfície de rollback mais barata: removê-lo volta ao writer v1 **sem
   rollback de migration e sem deploy de reversão de código** (§10.6).

## 9. Compatibilidade

### 9.1 Gate G1 — nenhuma loja pode ser numerada hoje (P0)

Busca exaustiva por `codigoNumeracaoVenda` em todo o repositório (excluindo
`node_modules` e `generated/prisma`) devolve **6 ocorrências, todas em testes ou no próprio
allocator**:

```
lib/vendas/server-sale-numbering.integration.test.ts:74
lib/vendas/server-sale-numbering.test.ts:20,53,54
lib/vendas/server-sale-numbering.ts:218,227
```

Não existe **nenhuma** UI de administração, API, Server Action, seed ou script de
provisionamento que atribua `Store.codigoNumeracaoVenda`. Como o campo é NULLABLE e nasce
`NULL`, e `resolveStoreSaleNumberingCode` lança `SALE_NUMBERING_NOT_CONFIGURED` quando o
código é inválido ou ausente (`server-sale-numbering.ts:227-234`), o writer server-side
**falharia em 100% das vendas de 100% das lojas** no dia em que fosse ligado.

Este é o gate mais duro e o principal motivo da Classe B.

### 9.2 Vendas antigas e números já persistidos

Sem impacto. Todos os campos novos são nullable, sem default, sem backfill. O teste
`"vendas históricas continuam válidas com todos os novos campos NULL"`
(`integration.test.ts:468`) cobre isso. O índice `vendas_serieVendaId_numeroSequencial_key`
tolera múltiplos `(NULL, NULL)` — semântica padrão de unique com NULL no PostgreSQL,
explicitada no comentário da migration (linha 89).

### 9.3 Múltiplas lojas

Melhora estrutural: o código da loja entra **no próprio número**, eliminando por construção
a colisão entre lojas que hoje é contida por guard. As 5 vendas da loja-2 bloqueadas por
colisão (`ops-upsert-venda.ts:107-109`) **não** são corrigidas por este GOAL — permanecem
como estão, conforme instrução explícita.

### 9.4 Relatórios e ordenação

Nenhum `orderBy: { pedidoId }` no repositório. Relatórios ordenam por `at`/`createdAt`. A
convivência de três formatos (`VDA-2026-0001`, `VND-2026-00001`, `VDA-XX-2026-000001`) é
**visual e de agrupamento**, não de ordenação. Filtros por prefixo/`startsWith` de `pedidoId`
devem ser revisados no GOAL de implementação.

### 9.5 Recibos e comprovantes (P1)

`lib/escpos.ts:94` imprime o identificador da venda. O recibo é gerado a partir do
`SaleRecord` local **imediatamente** após `finalizeSaleTransaction`, enquanto o POST é
fire-and-forget (`operations-store.tsx:1622`). Consequência direta: **o recibo entregue ao
cliente carregaria o número local, não o número server-side**, salvo se o fluxo passar a
aguardar a resposta antes de imprimir. Essa é uma mudança de UX no caminho crítico do
balcão e precisa de decisão explícita (§10.2, opção A vs. B).

### 9.6 Fiscal

`lib/fiscal/queue/queue-producer.ts:146` busca a venda por `{ pedidoId, storeId }`. Com
número server-side a busca continua correta **desde que** o chamador use o número devolvido
pelo servidor. Fixtures e testes fiscais usam `pedidoId` literal e não são afetados. Não há
emissão ativa (Gate Fiscal global aberto), então o risco fiscal real deste GOAL é baixo.

### 9.7 Caixa e Financeiro

`MovimentacaoFinanceira.referenciaId`, `MovimentacaoEstoque.documento` e
`ContaReceberTitulo.localKey` são gravados **dentro da mesma transação**, a partir da
variável `pedidoId` local à função. Se o writer server-side substituir essa variável pelo
número alocado **antes** do passo 1, todos os satélites herdam o número correto sem qualquer
outra alteração. Este é o principal argumento a favor de `upsertVendaInTransaction` como
ponto único de integração.

`lib/caixa/sessao-vendas-escopo.ts` opera sobre `pedidoId` vindos do banco — indiferente ao
formato.

### 9.8 `payload.lines` e metadados

`Venda.payload` guarda o `SaleRecord` do cliente, incluindo `payload.id` = número **local**.
`sanitizeSaleLinesPayload` e `stripClientSyncFlags` já reescrevem partes do payload no
servidor (`ops-upsert-venda.ts:452,521`). Com número server-side, `payload.id` e
`Venda.pedidoId` **divergiriam**, e `factsFromExistingVenda` (linha 305–316) usa
`id: existing.pedidoId` para reconstruir os fatos do fingerprint. A decisão sobre o que
gravar em `payload.id` precisa ser tomada explicitamente no GOAL de implementação — não
pode ficar implícita.

### 9.9 APIs consumidas pelos PDVs

| Rota | Impacto |
|---|---|
| `POST /api/ops/venda-persist` | contrato de **entrada** muda (`clientSaleId`); resposta **já** devolve `venda.pedidoId` (`route.ts:90`) — o campo necessário existe |
| `GET /api/ops/vendas-list` | devolve `pedidoId` (`route.ts:42`); sem mudança |
| `POST /api/ops/sync-legacy-vendas` | replay histórico — **não deve** alocar número novo |
| `POST /api/ops/devolucao` | usa `vendaLocalId`; precisa do número correto |

### 9.10 Filas offline e pendências fantasmas (P0)

Detalhado em §6.6. Resumo: `mergeSalesById` casa local↔remoto por `id`. Um número
server-side diferente do local **produz pendência fantasma permanente** — a venda local
nunca encontra sua contraparte remota, `syncPending` nunca é baixado, e `flushPendingSales`
reenvia indefinidamente (contido apenas pelo cooldown de 5 min em respostas 4xx; uma resposta
`200` não gera cooldown algum).

Este é o mecanismo exato que produziu a classe de defeito "pendências fantasmas" já conhecida
no projeto. Ligar o writer sem resolver a identidade do cliente **reintroduz o defeito por
outro caminho**.

### 9.11 As seis pendências antigas

**Fora do escopo**, conforme instrução. Não foram lidas, reenviadas, corrigidas nem
alteradas. Nenhum arquivo relacionado foi tocado.

## 10. Plano de implementação para o GOAL 002C

### 10.1 Ponto único de integração

**`lib/ops-upsert-venda.ts#upsertVendaInTransaction`.** É o único motor compartilhado por W1
e W2, roda inteiramente dentro da transação da rota, e já produz `pedidoId` como variável
local propagada a todos os satélites (§9.7). Integrar ali, e **somente** ali, mantém estoque,
financeiro, crédito e títulos consistentes sem tocar em nenhum dos seus consumidores.

W3 (O.S.) e W4 (importador) **não** entram no mesmo ponto: têm ciclo, efeitos e origem de
número diferentes.

### 10.2 Decisão obrigatória antes de codificar — identidade do cliente

Duas opções, mutuamente exclusivas. **Nenhuma deve ser escolhida implicitamente.**

**Opção A — `clientSaleId` como identidade, `pedidoId` como número (recomendada).**
O cliente gera um `clientSaleId` opaco (UUID/ULID, sem semântica de contador). O servidor
aloca o `pedidoId`. Ao receber `ok`, o cliente reescreve o `id` do `SaleRecord` local para o
`pedidoId` retornado. Requer: migração de `mergeSalesById`, do recibo (§9.5) e das
referências locais a devolução/vale.

- ✅ elimina definitivamente colisão entre lojas/terminais/abas;
- ✅ idempotência real de reenvio via `vendas_storeId_clientSaleId_key`;
- ⚠️ maior superfície de mudança no cliente; recibo precisa aguardar a resposta ou ser
  reimpresso.

**Opção B — `pedidoId` continua vindo do cliente; número server-side vira campo paralelo.**
O servidor aloca e grava `serieVendaId`/`anoNumero`/`numeroSequencial` como **número
comercial de exibição**, mantendo `pedidoId` como chave técnica do cliente.

- ✅ zero mudança no cliente, no merge, no recibo e nos satélites;
- ❌ **não resolve** o defeito original: a colisão entre lojas permanece, porque `pedidoId`
  continua sendo o contador do navegador;
- ❌ cria dois números por venda, com risco de confusão operacional.

A Opção B é honestamente mais barata e honestamente **não entrega o objetivo do 002B/ADR-0019**.
Esta auditoria recomenda a **Opção A**, com a ressalva de que ela deve ser fatiada
(§10.10).

### 10.3 Código legado a remover ou neutralizar

| Alvo | Ação |
|---|---|
| `nextSaleId` (`lib/operations-store.tsx:145`) | substituir por gerador de `clientSaleId` opaco (Opção A) — **não** apagar antes do gate existir, sob pena de quebrar o legado |
| `criarVendaDeOSAction` (`app/actions/operacoes.ts:1159-1161`) | `count()+1` fora de transação é defeito próprio. **Não** corrigir neste GOAL; registrar em `docs/PENDENCIAS.md` e tratar em GOAL dedicado |
| `lib/importador-avancado/persistidor.ts:821` | manter número externo; marcar `numeracaoOrigem: IMPORTED` quando/se for tocado |
| `components/pdv-github-original/**` | **não tocar** — cópia congelada, fora do caminho produtivo |
| `server-sale-numbering.contract.test.ts:42-52` | **reescrever obrigatoriamente** — a asserção de "zero call sites" passa a ser "call site único e exclusivo" |

### 10.4 Arquivos prováveis do GOAL 002C

| Arquivo | Mudança |
|---|---|
| `lib/ops-upsert-venda.ts` | chamada a `allocateSaleNumber`, gate, replay por `clientSaleId`, persistência dos 8 campos |
| `app/api/ops/venda-persist/route.ts` | aceitar `clientSaleId`, retry limitado em P2034, classificação de P2002 por constraint |
| `app/api/ops/sync-legacy-vendas/route.ts` | garantir que replay histórico **não** aloca número |
| `lib/vendas/server-sale-numbering.contract.test.ts` | inverter a asserção de call site |
| `lib/operations-store.tsx` | `clientSaleId`, reconciliação de `id` após resposta (Opção A) |
| `lib/operations-sales-merge.ts` | casar por `clientSaleId`, não por `id` (Opção A) |
| novo — gate de runtime | leitura da env canônica, com teste |
| novo — provisionamento de `codigoNumeracaoVenda` | UI de administração de loja **ou** script auditado (gate G1) |
| `docs/decisions/` | ADR de decisão A/B + polaridade do gate |

### 10.5 Testes obrigatórios

| Categoria | Conteúdo mínimo |
|---|---|
| **Unitários** | allocator já coberto (12 casos); acrescentar: writer aloca exatamente uma vez por venda nova; writer **não** aloca em replay; writer **não** aloca com gate desligado |
| **Concorrência** | executar `npm run test:vendas-numeracao:integration` contra PostgreSQL real — **é gate, não opcional** (§2.1) |
| **Por loja** | duas lojas concorrentes não cruzam série (já em `integration.test.ts:216`); estender ao writer completo, com estoque e financeiro |
| **Idempotência** | mesmo `clientSaleId` reenviado N vezes ⇒ 1 venda, 1 número, 1 movimentação de estoque, 1 movimentação financeira, 1 título por parcela |
| **Regressão dos PDVs** | os 6 chamadores de `finalizeSaleTransaction` (§5.2), incluindo à prazo com parcelas, crédito/vale, linha virtual de O.S., item avulso e acessórios |
| **Regressão de guards** | `CAIXA_FECHADO`, `CAIXA_ORIGINAL_FECHADO`, `PRODUTO_NAO_RESOLVIDO`, `ESTOQUE_INSUFICIENTE` continuam fail-closed **sem** consumir número |
| **Gate** | env ausente ⇒ writer v1 byte a byte idêntico ao comportamento atual |
| **Fila offline** | venda pendente reenviada após reinício do navegador não duplica e não vira pendência fantasma |

### 10.6 Sequência de deploy

1. **G1 primeiro, em GOAL próprio (`002C-0`)** — provisionar `codigoNumeracaoVenda` nas
   lojas do banco canônico, com auditoria dos valores. Sem isso, nada mais pode ser ligado;
2. merge do 002C com o gate **ausente** ⇒ writer v1 em ambos os projetos, comportamento
   inalterado, migration já aplicada;
3. verificar que o deploy do canônico executou `migrate deploy` sem migration pendente e que
   o legado registrou `MIGRATION_SKIPPED`;
4. ativar o gate **somente** no canônico, escopo Production, nível de projeto — mesmo
   procedimento de `MIGRATION_AUTHORITY_ENABLED`;
5. redeploy controlado do canônico;
6. smoke (§10.7);
7. legado permanece sem gate, indefinidamente.

### 10.7 Smoke mínimo em Production (canônico)

1. Uma venda à vista, uma loja, um terminal ⇒ `pedidoId` no formato
   `VDA-{CODIGO}-{ANO}-{NNNNNN}`, `numeracaoOrigem = SERVER_V1`;
2. venda seguinte ⇒ número **consecutivo**;
3. venda em segunda loja ⇒ série independente, prefixo distinto;
4. venda com caixa fechado ⇒ 409 e **número não consumido** (a venda seguinte usa o número
   que a rejeitada teria usado);
5. reenvio manual da mesma venda ⇒ `replayed: true`, sem segunda venda e sem segundo número;
6. venda à prazo com 2+ parcelas ⇒ `localKey` dos títulos coerente com o número novo;
7. conferência de caixa da sessão inclui as vendas novas;
8. `omni-gestao-pi.vercel.app` ⇒ writer v1, venda gravada normalmente com número do cliente.

### 10.8 Rollback de código sem rollback de migration

Ordem de preferência, do mais barato ao mais caro:

1. **Remover o gate** no projeto canônico + redeploy ⇒ volta ao writer v1 imediatamente.
   Sem tocar em banco, migration ou Git;
2. revert do commit de aplicação ⇒ `main` volta ao writer v1;
3. **jamais** reverter a `0016`. Ela é aditiva, nullable, está nos dois bancos e não tem
   consumidor obrigatório. Rollback de migration criaria divergência entre schema e
   `_prisma_migrations`, exatamente o que a auditoria 002B recomendou evitar (§8, item 7).

Vendas já numeradas pelo servidor permanecem válidas após qualquer rollback: seus campos
novos continuam preenchidos e o `pedidoId` continua único.

### 10.9 Gates de entrada do GOAL 002C

| Gate | Condição de saída |
|---|---|
| **G1** | `Store.codigoNumeracaoVenda` provisionado e auditado para todas as lojas ativas do banco canônico, por superfície versionada (P0) |
| **G2** | Gate de runtime canônico implementado, testado, com polaridade decidida por ADR (P0) |
| **G3** | Decisão A/B (§10.2) registrada em ADR, com o caminho de identidade do cliente completo — merge, recibo, devolução, vale (P0) |
| **G4** | `npm run test:vendas-numeracao:integration` **executado** contra PostgreSQL real, com resultado publicado (P1) |

### 10.10 Fatiamento recomendado

O 002C, como escrito, é grande demais para um único GOAL seguro. Sugestão:

- **002C-0** — provisionamento de `codigoNumeracaoVenda` + gate de runtime (sem writer);
- **002C-1** — writer server-side atrás do gate, com `clientSaleId`, sem mudar o cliente
  (servidor aceita `clientSaleId` opcional; ausente ⇒ writer v1);
- **002C-2** — migração do cliente para `clientSaleId` + reconciliação de `id` + recibo;
- **002C-3** — neutralização de `nextSaleId` e ativação do gate em Production.

## 11. Riscos

| Sev | ID | Risco | Evidência |
|---|---|---|---|
| **P0** | R-01 | Nenhuma superfície provisiona `Store.codigoNumeracaoVenda` ⇒ writer falharia em 100% das vendas | §9.1 |
| **P0** | R-02 | Pendência fantasma permanente se o número server-side não for reconciliado no cliente (`mergeSalesById` casa por `id`) | §6.6, §9.10 |
| **P0** | R-03 | Duplicação por reenvio pós-commit sem `clientSaleId` — o guard de replay por `pedidoId` deixa de funcionar | §7.5 |
| **P1** | R-04 | Writer ativo no projeto legado, banco diferente, sem gate ⇒ números duplicados entre ambientes ou falha total de venda | §8.1, §8.3 |
| **P1** | R-05 | Lock de linha da série mantido por toda a transação da venda ⇒ serialização por loja, com `connection_limit=1` e timeout de 20s | §7.2 |
| **P1** | R-06 | Recibo impresso antes da resposta do servidor carregaria número diferente do persistido | §9.5 |
| **P1** | R-07 | Suíte de integração é opt-in e pulada silenciosamente em CI ⇒ concorrência real pode não ser exercitada antes do deploy | §2.1 |
| **P2** | R-08 | `contract.test.ts` falha por design ao criar o call site; se "consertado" removendo a asserção, perde-se a proteção contra call sites espúrios | §4.8 |
| **P2** | R-09 | `criarVendaDeOSAction` mantém `count()+1` fora de transação — segunda fonte de verdade com defeito próprio | §6.3 |
| **P2** | R-10 | Divergência entre número (ordem de aceitação) e `Venda.at` (data original) em sync retroativo | §4.6 |
| **P2** | R-11 | `payload.id` (local) divergindo de `Venda.pedidoId` (servidor) afeta `factsFromExistingVenda`/fingerprint | §9.8 |
| **P3** | R-12 | Três formatos de número convivendo em relatórios e telas | §9.4 |
| **P3** | R-13 | Estado físico das constraints em Production permanece não verificado desde a auditoria 002B | §2.1 |
| **P3** | R-14 | Legado seguirá divergindo do schema canônico a cada migration futura | §8.2 |

## 12. Classificação e recomendação

**Classe B — apto com ressalvas e gates adicionais claramente definidos.**

Não é Classe C: o bloqueio declarado da auditoria anterior (autoridade de migrations) está
resolvido e comprovado em Production; a infraestrutura 002B é sólida, aditiva, reversível e
compatível com a transação existente; e o allocator pode ser chamado sem qualquer alteração
de isolamento ou de fronteira transacional.

Não é Classe A: três condições independentes — R-01, R-02 e R-03 — quebrariam venda real em
Production se o writer fosse integrado como está, e nenhuma delas é resolvida por código
existente.

**Recomendação objetiva:** **liberar a implementação 002C**, condicionada ao cumprimento de
**G1–G4** e ao fatiamento de §10.10. Implementar o writer em um único GOAL monolítico, sem
os gates, **não** é recomendado.

## 13. Confirmação de zero alteração operacional

| Verificação | Resultado |
|---|---|
| Código de aplicação alterado | **Zero** |
| Testes alterados | **Zero** |
| Configuração alterada | **Zero** |
| SQL executado | **Zero** |
| Migration criada, alterada ou aplicada | **Zero** |
| Deploy disparado | **Zero** |
| Alteração em projeto, flag, domínio ou variável Vercel | **Zero** |
| Pendências antigas tocadas | **Zero** |
| Projeto legado alterado | **Zero** |
| Writer 002C implementado | **Não** — ponto de parada respeitado |

## 14. Referências

- [`PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md`](./PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md)
- [`PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md`](./PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md)
- [`DEPLOY_PRODUCTION_MIGRATION_GOVERNANCE_AUDIT_001.md`](./DEPLOY_PRODUCTION_MIGRATION_GOVERNANCE_AUDIT_001.md)
- [`DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`](./DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md)
- [`DEPLOY_LEGACY_PROJECT_REAL_USAGE_AUDIT_001.md`](./DEPLOY_LEGACY_PROJECT_REAL_USAGE_AUDIT_001.md)
- [`ADR-0019-numeracao-server-side-vendas.md`](../decisions/ADR-0019-numeracao-server-side-vendas.md)
- `prisma/migrations/0016_add_sale_numbering_infrastructure/migration.sql`
- `lib/vendas/server-sale-numbering.ts`
- `lib/ops-upsert-venda.ts`
