# PRODUTO-FISCAL-METADATA-PARTIAL-MERGE-READINESS-001

**Tipo:** readiness independente (auditoria empírica de terceiro)
**Branch auditada:** `goal/produto-fiscal-metadata-partial-merge-fix-001`
**Branch da auditoria:** `audit/produto-fiscal-metadata-partial-merge-readiness-001`
**Data:** 31/07/2026
**Autor:** Claude Code (Opus 5) — sessão de readiness

> Esta auditoria **não presumiu** que o relatório da branch estava correto. O contrato
> canônico foi **descoberto no código**, o defeito original foi **reproduzido contra a
> implementação real de `origin/main`**, e as portas foram exercitadas contra
> **PostgreSQL 17 real** e contra a **aplicação rodando por HTTP**.

---

## 1. Classificação

### 🟡 **B — PRONTO COM RESSALVAS NÃO BLOQUEANTES. Merge recomendado.**

O defeito é real, foi reproduzido de forma independente, e a correção o fecha em todas
as portas de escrita. A fixture Martins passa ponta a ponta pelo **persistidor real**
contra **PostgreSQL real**, preservando identidade fiscal, proveniência, preço e estoque,
com segunda passada idempotente. Schema e migrations estão intactos. Suíte completa,
TypeScript e build verdes.

Restam **três ressalvas**, nenhuma bloqueante, **nenhuma delas regressão introduzida por
esta branch** — todas verificadas contra `origin/main`:

| # | Ressalva | Severidade | Introduzida aqui? |
|---|---|---|---|
| R-1 | Cadastros V2 descarta chaves não canônicas dentro de `metadata.fiscal` | P3 | ❌ Não — idêntico em `origin/main` |
| R-2 | Promoção do legado em estado MISTO diverge entre V2 e REST/importador | P2 | ⚠️ Mudança nova, mas **recupera** dado (nunca apaga) |
| R-3 | `upsertProduto` é upsert de FORMULÁRIO: payload parcial zera preço/custo/garantia | P2 | ❌ Não — pré-existente, fora do diff |

Próximo GOAL: **`PRODUTO-FISCAL-METADATA-PARTIAL-MERGE-MERGE-001`**

### Checklist de gate A/B

| Exigência | Resultado |
|---|---|
| Defeito original reproduzido | ✅ `origin/main` perde 3 campos não reenviados |
| Merge parcial aprovado | ✅ 109/109 asserções do contrato |
| Campos canônicos preservados | ✅ 10/10 campos × 8 cenários |
| Todas as portas aprovadas | ✅ paridade nos campos canônicos (2 divergências fora do contrato → R-1/R-2) |
| Promoção do legado aprovada | ✅ legado PURO promovido em todas as portas · MISTO diverge (R-2) |
| Fixture Martins aprovada | ✅ 13/13 pelo persistidor real contra PostgreSQL real |
| Isolamento multi-loja aprovado | ✅ zero cross-store em Prisma e HTTP |
| PostgreSQL real aprovado | ✅ PostgreSQL 17.10 descartável, porta 55433 |
| HTTP real aprovado | ✅ 18/18 contra `next start` — ver §12 |
| Suíte / TypeScript / build verdes | ✅ ver §14 |
| Schema e migrations intactos | ✅ `git diff --exit-code` limpo em ambos |

---

## 2. Pré-flight — SHAs e diff

Todas as quatro relações exigidas bateram **exatamente**:

```
origin/main                            654ceedea73eb27fc5f3a2c439590f93298a3958   ✅
origin/goal/…partial-merge-fix-001     96ae3203c8d0ed59aedb10e870671ee9fa16fc29   ✅
merge-base                             654ceedea73eb27fc5f3a2c439590f93298a3958   ✅
git rev-list --left-right --count      0 atrás / 3 à frente                        ✅
```

### Commits auditados

| SHA | Assunto |
|---|---|
| `aa5b0f6` | `fix(fiscal): preservar identidade fiscal em atualizacoes parciais` |
| `0519cbd` | `test(fiscal): cobrir merge parcial de metadata de produto` |
| `96ae320` | `docs(fiscal): documentar merge fiscal nao destrutivo` |

### Inventário do diff — exatamente os 5 arquivos previstos

```
 docs/modules/reports/IMPORTACAO_PRODUTOS_CONTRATO.md   |  44 ++-
 lib/produto-fiscal.test.ts                             | 127 ++++++++
 lib/produto-fiscal.ts                                  |  37 ++-
 lib/produtos/produto-fiscal-merge-parcial.test.ts      | 327 ++++++++++++++++++
 lib/produtos/produto-fiscal-upsert.ts                  |  34 +--
 5 files changed, 543 insertions(+), 26 deletions(-)
```

Nenhum arquivo fora da lista. `git diff --check` limpo.

---

## 3. Ambiente controlado

| Item | Valor |
|---|---|
| Worktree | `C:\tmp\omni-gestao-produto-fiscal-metadata-readiness-001` |
| Node | **20.19.5** portátil (zip no scratchpad — a máquina só tem Node 24 global) |
| PostgreSQL | **17.10** descartável, `initdb` próprio, **porta 55433** (nunca 5432) |
| Banco | `omni_audit` — schema aplicado com `prisma db push` |
| Remoto | ❌ **Nenhum acesso a Neon/Supabase.** Nenhum produto real tocado. |
| `npm ci` | exit 0 |
| `prisma validate` | `The schema at prisma\schema.prisma is valid 🚀` |
| `prisma generate` | Prisma Client v6.19.3 |

---

## 4. Auditoria do código — mapa real de escritores

Mapeamento refeito do zero por `grep` sobre `app/`, `lib/`, `components/`, `scripts/`,
**sem confiar no relatório da branch**.

### As 5 portas de escrita fiscal (únicas)

| # | Porta | Arquivo:linha | Helper usado |
|---|---|---|---|
| 1 | Cadastros V2 (`upsertProduto`) | `app/actions/cadastros.ts:1488` | `canonicalizeProdutoFiscalMetadata` |
| 2 | REST **POST** `/api/produtos` | `app/api/produtos/route.ts:161` | `mergeProdutoFiscalIntoMetadata` |
| 3 | REST **PATCH** `/api/produtos/[id]` | `app/api/produtos/[id]/route.ts:191` | `mergeProdutoFiscalIntoMetadata` |
| 4 | Importador avançado | `lib/importador-avancado/persistidor.ts:542` (update) · `:598` (create) | `mergeProdutoFiscalIntoMetadata` |
| 5 | Importador especializado | `lib/importador-produtos/persist.ts:274` (**só criação**) | `mergeProdutoFiscalIntoMetadata` |

### Nenhum writer monta `metadata.fiscal` à mão

```
grep -rn "\.fiscal\s*=[^=]" app lib components scripts (não-teste)
→ lib/produto-fiscal.ts:183:  base.fiscal = compact        ← única atribuição do repo
```

Único ponto que produz um literal `fiscal:` num body de produto é o **cliente**
`components/cadastros/lovable/…/produto-ia.tsx:1172` (`fiscal: { ncm, cest }`) — dois
campos **canônicos**, que entram pela porta 1 via `fiscalInputFromBody`. Não é semântica
concorrente.

### Nenhum reader fora do contrato

Todos os leitores produtivos passam por `getProdutoFiscal()`:
`app/actions/cadastros.ts:1647` · `app/api/ops/inventory/route.ts:89` ·
`lib/cadastros/produto-quality-score.ts:180` · `lib/fiscal/venda-fiscal-snapshot-service.ts:182` ·
`lib/importador-avancado/persistidor.ts:520` · `components/…/CadastrosHub.tsx:2325-2326` ·
`components/…/produto-ia.tsx:389`.

Nenhum lê chave de `metadata.fiscal` fora dos 10 campos canônicos.

### O que a branch de fato muda

`sanitizeProdutoFiscal` e `getProdutoFiscal` são **byte a byte idênticos** a `origin/main`
(verificado por `diff` das funções extraídas). A mudança de comportamento está
concentrada em `mergeProdutoFiscalIntoMetadata`; `produto-fiscal-upsert.ts` é
majoritariamente **refatoração para delegar ao contrato compartilhado** (ver §7).

---

## 5. Defeito original — reproduzido de forma independente

Executado fora da worktree auditada, importando as **duas implementações reais**
(`git show origin/main:lib/produto-fiscal.ts` vs. a da branch), com o metadata e o patch
exatos do GOAL.

**Estado inicial** — `fiscal: { ncm, unidadeComercial: "UN", unidadeTributavel: "UN", origemMercadoria: "0" }` + `importacao.ultimoLote.batchId`
**Patch** — `{ ncm: "85094010", cest: "2104100" }`

| Campo | Antes | `origin/main` | Branch |
|---|---|---|---|
| `unidadeComercial` | `"UN"` | ❌ **perdido** | ✅ `"UN"` |
| `unidadeTributavel` | `"UN"` | ❌ **perdido** | ✅ `"UN"` |
| `origemMercadoria` | `"0"` | ❌ **perdido** | ✅ `"0"` |
| `cest` (do patch) | — | ✅ aplicado | ✅ aplicado |
| namespace `importacao` | presente | ✅ preservado | ✅ preservado |

**Causa raiz:** `origin/main` fazia *whole-block replace* — `base.fiscal = compact`, onde
`compact` era construído **apenas** a partir do input saneado, ignorando o que já estava
gravado. Qualquer campo não reenviado desaparecia.

**Correção:** a branch parte da identidade **já gravada** (`const atual = getProdutoFiscal(base)`)
e sobrepõe campo a campo somente os valores válidos do input.

> Nuance registrada: o defeito era **restrito ao bloco `fiscal`**. Namespaces irmãos
> (`importacao`, `acessorios`) já sobreviviam em `origin/main`, porque só a chave `fiscal`
> era substituída.

---

## 6. Contrato canônico real

Descoberto de `PRODUTO_FISCAL_VAZIO` — **10 campos**, não a lista do relatório:

`ncm` · `cest` · `cfop` · `cst` · `csosn` · `origemMercadoria` · `unidadeComercial` ·
`unidadeTributavel` · `codigoAnp` · `exTipi`

Cada campo foi testado nos 8 cenários exigidos (**109 asserções, todas verdes**):

| Cenário | Resultado |
|---|---|
| valor já existente + campo ausente no patch | ✅ preserva |
| `undefined` | ✅ preserva |
| `null` | ✅ preserva |
| string vazia / só espaços | ✅ preserva |
| valor inválido | ✅ preserva, **sem tocar irmãos** |
| valor válido diferente | ✅ substitui **somente** aquele campo |
| objeto fiscal vazio | ✅ não apaga; e **não cria** a chave se não havia |
| reaplicação | ✅ idempotente |

### Validação real por campo (importante — difere do senso comum)

| Campo | Regra efetiva de `sanitizeProdutoFiscal` |
|---|---|
| `ncm` | exatamente **8** dígitos, senão descartado |
| `cest` | dígitos; **1–7 dígitos são zero-padded à esquerda** → `"21041"` vira `"0021041"` |
| `cfop` | exatamente **4** dígitos |
| `cst` / `csosn` | dígitos truncados em 3 / 4 — **sem validação de comprimento** |
| `origemMercadoria` | 1 char em `0..8` |
| `unidadeComercial` / `unidadeTributavel` | uppercase, truncado em 6 — **sem allowlist** |
| `codigoAnp` / `exTipi` | dígitos truncados em 9 / 3 — **sem validação de comprimento** |

> ⚠️ **"CEST curto" não é rejeitado** — é completado com zeros. Quem depende de rejeição
> de CEST curto deve fazê-la **antes** do helper (o importador já faz, em `linha.ts`).

> ⚠️ **Quirk pré-existente (idêntico em `origin/main`, fora do escopo):** em
> `origemMercadoria` o `slice(0,1)` ocorre **antes** da validação, então `"-1"` e `"10"`
> viram `"1"` em vez de serem rejeitados.

### Imutabilidade

- ✅ Não muta o `metadata` recebido.
- ✅ Não muta o `fiscalInput` recebido.
- ✅ Aceita objetos `Object.freeze`ados em ambas as posições sem lançar.
- ✅ `PRODUTO_FISCAL_VAZIO` (congelado) não é corrompido.
- ℹ️ O merge é **shallow**: namespaces irmãos são copiados **por referência**
  (`out.importacao === base.importacao`). Nenhum caller os muta hoje; registrado como
  característica, não defeito.

---

## 7. Matriz de paridade entre portas

Mesma identidade inicial, mesmo patch `{ ncm: "85176200", cest: "2106400" }`.
Identidade: `fiscal` com os 10 campos + `importacao` + `acessorios`.

| # | Porta | Campos canônicos resultantes | Namespaces irmãos |
|---|---|---|---|
| 1 | `mergeProdutoFiscalIntoMetadata` | ✅ idêntico | ✅ preservados |
| 2 | `canonicalizeProdutoFiscalMetadata` | ✅ idêntico | ✅ preservados |
| 3 | REST **POST** (criação) | ✅ só o patch (parte do vazio) | — |
| 4 | REST **PATCH** | ✅ idêntico | ✅ preservados |
| 5 | Importador avançado | ✅ idêntico | ✅ preservados |
| 6 | Importador especializado (criação) | ✅ só o patch | — |

**Criação vs. atualização:** a porta de criação parte de metadata vazio, mas produz a
**mesma forma** — bloco compacto, só campos não vazios, mesmas chaves canônicas.
Verificado que criação e atualização equivalente convergem.

### O que a branch muda na porta Cadastros V2

`canonicalizeProdutoFiscalMetadata` **já fazia merge parcial em `origin/main`** (tinha o
próprio loop `FISCAL_KEYS`). Ou seja: **o defeito nunca atingiu o Cadastros V2** — atingia
REST e os dois importadores. A branch remove a semântica duplicada e passa a delegar ao
helper compartilhado.

Comparação direta `V2(main)` vs `V2(branch)` em 4 estados:

| Caso | `main` | `branch` | Veredito |
|---|---|---|---|
| A) identidade canônica curada + patch NCM | `{ncm:85176200, cest, origem, uCom, uTrib}` | idêntico | ✅ sem mudança |
| B) chave não canônica em `metadata.fiscal` | descartada | descartada | ✅ sem mudança (**R-1 é pré-existente**) |
| C) **MISTO** legado(topo) + `fiscal` parcial | `{cfop, uCom}` | `{ncm, cest, cfop, uCom}` | ⚠️ **mudança — R-2** |
| D) legado PURO no topo | `{ncm, cest, cfop}` | idêntico | ✅ sem mudança |

Único comportamento alterado na porta V2 é o caso C, e ele **recupera** dado que antes
ficava invisível. Nada é apagado.

---

## 8. Chaves não canônicas (R-1) — ressalva não bloqueante

Estado: `metadata.fiscal = { ncm: "85094010", chaveNaoCanonica: "preservar-ou-descartar" }`.

| Porta | Comportamento |
|---|---|
| `mergeProdutoFiscalIntoMetadata` | ✅ **preserva** (bloco `extras`, novo nesta branch) |
| REST PATCH | ✅ preserva |
| Importador avançado | ✅ preserva |
| **Cadastros V2** | ❌ **descarta** |

Causa: `canonicalizeProdutoFiscalMetadata` faz `delete semFiscal.fiscal` antes do merge,
para rejeitar resíduo não canônico vindo do body. Com o bloco apagado, o `extras` do
helper não encontra nada para reter.

### Classificação — critérios do GOAL aplicados

| Pergunta | Resposta verificada |
|---|---|
| Algum writer atual do repositório produz essa chave? | ❌ **Não.** Nenhum. |
| Alguma leitura atual depende dela? | ❌ **Não.** Todo read passa por `getProdutoFiscal`, que lê só os 10 canônicos. |
| Existem fixtures/seeds/contratos versionados que a usam? | Apenas os **testes da própria branch** (`gtinComercial` como chave-exemplo) — e eles exercitam o **helper/importador**, nunca a porta V2. Não há overclaim. |
| Comportamento documentado? | ✅ Sim, em `IMPORTACAO_PRODUTOS_CONTRATO.md`, com a exceção do V2 explícita. |
| Introduzido por esta branch? | ❌ **Não** — `origin/main` já descartava (caso B da §7). |

→ **Ressalva não bloqueante.** O contrato **não** foi ampliado nesta readiness.

---

## 9. Promoção do legado

`getProdutoFiscal` prefere `metadata.fiscal`; só cai no fallback `metadata.ncm`/`metadata.cest`
(topo) quando **não existe** `metadata.fiscal`. Como o merge parte de `getProdutoFiscal(base)`,
a promoção herda exatamente essa regra.

| Cenário | Resultado |
|---|---|
| Legado **PURO** (`{ncm, cest}`, sem `fiscal`) + patch parcial | ✅ promovido em **todas** as portas |
| Só NCM legado | ✅ promovido |
| Só CEST legado | ✅ promovido |
| Chave legada do topo após promoção | ✅ **preservada** (nunca apagada) |
| Demais namespaces | ✅ preservados |
| Legado **inválido** (`ncm:"123"`) | ✅ não promovido, não quebra, topo intacto |
| Segunda execução | ✅ idempotente (inclusive pela porta V2) |
| **MISTO** (`{ncm, cest, fiscal:{uCom}}`) | ⚠️ **divergente — R-2** |

### Precedência (documentada)

1. **Patch válido vence tudo** — substitui inclusive o valor promovido.
2. **Canônico vence legado** — com `fiscal.ncm` e `metadata.ncm` ambos presentes, prevalece `fiscal.ncm`.
3. **Legado só é lido quando `metadata.fiscal` não existe** (helper/REST/importador).

### R-2 — divergência no estado MISTO

| Porta | `{ncm:"85094010", cest:"2104100", fiscal:{unidadeComercial:"UN"}}` + patch `{cfop:"5102"}` |
|---|---|
| helper / REST / importador | `{cfop:"5102", unidadeComercial:"UN"}` — **não promove** |
| Cadastros V2 | `{ncm, cest, cfop, unidadeComercial}` — **promove** |

**Por que não bloqueia:**

- **Não é regressão.** `getProdutoFiscal` — o leitor canônico, **idêntico a `origin/main`** —
  já ignora o legado do topo quando `metadata.fiscal` existe. Um produto nesse estado
  **já hoje** lê como "sem NCM", antes e depois da branch. A escrita apenas espelha a leitura.
- **A direção da divergência é segura:** V2 **recupera** dado; ninguém **apaga** dado.
- **Não afeta o reparo Martins.** Os 13 produtos degradados têm `metadata: null`
  (fixture `martinsProdutosDegradados`) — sem chave legada no topo. Confirmado em execução real.
- **O gerador do estado MISTO era o próprio defeito.** Produtos criados por
  `lib/importador-produtos/persist.ts` recebem topo **e** `metadata.fiscal` com os **mesmos**
  valores — não nascem mistos. O estado misto surgia quando o merge destrutivo de
  `origin/main` apagava `fiscal.ncm` e deixava `metadata.ncm` no topo.

**Recomendação (fora desta readiness):** se houver intenção de recuperar produtos
danificados pelo defeito antigo, o caminho correto é alinhar `getProdutoFiscal` (leitura)
para mesclar o fallback legado campo a campo — não alargar o merge. Isso é mudança de
contrato de **leitura** e merece GOAL próprio.

---

## 10. GTIN — confirmado fora do contrato

| Verificação | Resultado |
|---|---|
| `gtinComercial`/`gtinTributavel` são lidos da planilha? | ✅ Sim — `importacao-produtos/linha.ts:111-112`, aliases em `importador-avancado/detector.ts:299-302` |
| Fazem parte do contrato canônico persistido? | ❌ **Não** — `fiscalInputDaLinha` (`escrita.ts:55-67`) devolve **só** `ncm`, `cest`, `unidadeComercial`, `unidadeTributavel` |
| Algum writer os grava em `metadata.fiscal`? | ❌ **Nenhum** |
| Alguma UI/API afirma que ficam gravados? | ❌ Não — a doc foi **corrigida por esta branch** para dizer que só os quatro primeiros persistem |
| Alguma regra fiscal depende da persistência deles? | ❌ Não |
| Consumidor produtivo de GTIN persistido? | ❌ **Nenhum.** As únicas referências fora do parser são asserções de teste sobre o parse (`martins-regressao.test.ts:306-307`, `detector-produtos.test.ts:30-33`) |

GTIN **não** foi adicionado ao contrato. Nenhum risco separado; **não bloqueia** o reparo
Martins. A correção de documentação feita pela branch está **correta e necessária** — a
versão anterior afirmava que os seis campos eram persistidos.

---

## 11. PostgreSQL real — portas reais contra o banco

PostgreSQL 17.10 descartável, porta 55433. Massa criada em **duas lojas** com metadata
fiscal completo, legado, misto, namespaces irmãos, chave não canônica e os 13 Martins.

**10/10 asserções verdes** (`upsertProduto` real + Prisma real):

| Prova | Resultado |
|---|---|
| `upsertProduto` grava o merge parcial no JSONB real | ✅ `fiscal` mesclado, `importacao`/`acessorios` intactos |
| **Cross-store por ID** — `storeId` da loja 1, produto da loja 2 | ✅ `NOT_FOUND`; metadata, nome e **`updatedAt` inalterados** |
| Mesmo EAN em duas lojas — patch numa não vaza para a outra | ✅ |
| Legado promovido; chave do topo sobrevive no banco | ✅ |
| Estado MISTO — V2 promove (R-2 confirmada em disco) | ✅ divergência reproduzida no banco |
| Chave não canônica — V2 descarta (R-1 confirmada em disco) | ✅ |
| 13 Martins: unidades, origem e proveniência preservadas | ✅ |
| Segunda passada idempotente (JSONB byte a byte) | ✅ |
| `price` / `stock` / `active` / `status` inalterados | ✅ |
| **Zero `MovimentacaoEstoque` criada** | ✅ `count = 0` |
| Zero produto órfão / fora de loja | ✅ |

### Fixture Martins pelo persistidor REAL — 4/4

Executado `detectarDominio` → `agruparEMerge` → **`persistirImportacao`** (a função de
produção) contra o banco local, com os 13 produtos **pré-existentes** carregando
`unidadeComercial`, `unidadeTributavel`, `origemMercadoria`, `importacao.ultimoLote`,
`acessorios` e `atributos`; planilha trazendo **somente NCM/CEST**.

| Exigência | Resultado |
|---|---|
| Campos antigos preservados | ✅ unidades e origem intactas nos 13 |
| NCM/CEST atualizados | ✅ conforme a NF-e 5.380.135 |
| Proveniência preservada **e** atualizada | ✅ `ultimoLote.batchId` → `martins-lote-2` |
| Estoque e preço intactos | ✅ |
| Política de ativação publicada obedecida | ✅ produtos com preço não são rebaixados |
| Segunda importação idempotente | ✅ `fiscal` byte a byte igual |
| Nenhuma duplicata criada | ✅ 13 antes, 13 depois |
| Isolamento multi-loja | ✅ |
| Nenhuma `MovimentacaoEstoque` | ✅ |

---

## 12. HTTP real — aplicação rodando

`next build` + `next start` na porta 3111, contra o PostgreSQL local. Cookie de assinatura
assinado (HMAC-SHA256) para atravessar `requireCadastrosHubApi`.

**18/18 PASS.**

| # | Prova | Resultado |
|---|---|---|
| 1 | **POST** produto com fiscal parcial (`ncm` + `unidadeComercial`) | `201` · persistiu `{"ncm":"85094010","unidadeComercial":"UN"}` — só o que veio |
| 2 | **PATCH** apenas NCM | `200` · `{"ncm":"85176200","cest":"0000000","cfop":"5102","origemMercadoria":"0","unidadeComercial":"UN","unidadeTributavel":"UN"}` — 5 campos não reenviados sobreviveram |
| 3 | PATCH apenas NCM — namespaces irmãos | ✅ `importacao` e `acessorios` intactos |
| 4 | **PATCH** apenas CEST | `200` · NCM e unidades preservados |
| 5 | **PATCH sem qualquer campo fiscal** (só `name`) | `200` · `metadata.fiscal` **byte a byte inalterado** |
| 6 | **PATCH com valor inválido** (`ncm:"123"`, `origemMercadoria:"9"`) | `200` · bloco fiscal **inalterado** — não apagou nem corrompeu |
| 7 | **PATCH de produto de OUTRA loja** | `404` · `{"error":"Produto não encontrado"}` |
| 8 | PATCH cross-store — vazamento na resposta | ✅ nenhum dado do produto alheio no corpo |
| 9 | PATCH cross-store — efeito colateral | ✅ produto da loja 2 **inalterado** (`{"fiscal":{"ncm":"11111111"}}`) |
| 10 | PATCH **sem sessão** | `401` — gate `requireCadastrosHubApi` ativo |
| 11 | Colunas escalares após todos os PATCHes fiscais | ✅ `price=199.9`, `stock=9`, `active=true`, `status="Ativo"` |
| 12 | `MovimentacaoEstoque` criada | ✅ `0` |

O `SQLSTATE 42804` **não foi alvo** — o GOAL dispensa esse vetor, e com razão: a mudança
é merge de objeto JSON em memória, não construção de query. Ainda assim, todas as rotas
responderam `2xx`/`4xx` corretos, sem `500` e sem degradação silenciosa.

> Artefato de ambiente local, sem relação com a branch: o middleware NextAuth emitiu
> `UntrustedHost` para `/api/auth/session` em `127.0.0.1:3111`. Não afeta `/api/produtos`
> — as 18 provas passaram, incluindo o `401` sem sessão.

---

## 13. Testes adversariais

Cobertos e verdes:

| Vetor | Comportamento |
|---|---|
| `metadata` `null` / `undefined` | ✅ trata como vazio |
| `metadata` array / string / número | ✅ tratado como vazio, sem lançar |
| `metadata.fiscal` não objeto (string/array/número) | ✅ substituído quando há input válido; **preservado** quando não há (nenhuma escrita ocorre) |
| Campo canônico com **número** em vez de string | ✅ coagido (`85094010` → `"85094010"`) |
| Whitespace | ✅ aparado; unidade normalizada para uppercase |
| NCM curto | ✅ rejeitado, preserva o atual |
| CEST curto | ⚠️ **zero-padded** (não rejeitado) — comportamento documentado em §6 |
| Origem fora de `0..8` | ✅ rejeitada (com o quirk de truncamento pré-existente registrado) |
| Objeto congelado (metadata **e** input) | ✅ não lança |
| Referência compartilhada entre dois produtos | ✅ sem escrita cruzada |
| Namespace desconhecido | ✅ preservado |
| Payload fiscal com 5.000 chaves extras | ✅ só o campo do contrato entra |
| Mesma operação em duas lojas | ✅ isolada (Prisma e HTTP) |

Toda falha é **segura e não destrutiva**: o pior caso é "não aplica o valor" — nunca
"apaga o que existia".

---

## 14. Validações

Todas com **Node 20.19.5 portátil**.

| Comando | Resultado |
|---|---|
| `npm ci` | ✅ exit 0 |
| `npx prisma generate` | ✅ Prisma Client v6.19.3 |
| `npx prisma validate` | ✅ `The schema at prisma\schema.prisma is valid 🚀` |
| Testes focados do GOAL | ✅ **12 arquivos · 189 testes · 0 falhas** |
| `npx vitest run --testTimeout=20000` (suíte completa) | ✅ **264 arquivos (260 ok · 4 skip) · 3.844 testes: 3.780 pass · 2 expected-fail · 62 skip · 0 falha** — exit 0 |
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` | ✅ **exit 0, zero erro** |
| `npm run build` | ✅ **exit 0** — compilado em 5.9 min, 103/103 páginas estáticas |
| `git diff --check` | ✅ limpo |

### Testes desta readiness (temporários, no scratchpad — não commitados)

| Harness | Testes | Resultado |
|---|---|---|
| Contrato canônico + paridade + legado + adversariais | 109 | ✅ 100% |
| Portas reais contra PostgreSQL 17 | 10 | ✅ 100% |
| Fixture Martins pelo persistidor real | 4 | ✅ 100% |
| HTTP real contra `next start` | 18 | ✅ 100% |
| **Total** | **141** | ✅ |

### Ocorrência registrada — snapshot fiscal

`lib/fiscal/tax-engine/__snapshots__/calculator.test.ts.snap` apareceu como modificado
após a suíte, mas o diff de conteúdo é **vazio** — apenas re-toque de fim de linha
(LF→CRLF) pelo vitest, **sem mudança de bytes semânticos**. Conforme o GOAL, o arquivo foi
**restaurado** (`git checkout --`) e a ocorrência fica registrada aqui.

### Testes PostgreSQL executados sem skip

`lib/cadastros/produtos-listagem-sql.integration.test.ts` foi rodado com
`PRODUTOS_LISTAGEM_SQL_IT=1` contra o banco local: **7 pass · 9 fail**. As 9 falhas são
**todas** pré-condições de banco vazio — `expected 0 to be greater than 5000`,
`expected null to be truthy`, `expected [] to have a length of 25`, `expected 0 to be
greater than 0` — e não asserções de comportamento. O arquivo exige um corpus semeado
(> 5.000 produtos) que este GOAL não provê, está **fora do diff** da branch, e cobre a
camada de **listagem SQL**, não o merge de metadata. Seu estado padrão (skip) é o mesmo
em `origin/main` — a suíte verde não esconde regressão desta branch.

### Invariantes

```
git diff --exit-code origin/main -- prisma/schema.prisma   → limpo ✅
git diff --exit-code origin/main -- prisma/migrations      → limpo ✅
git diff --check origin/main...HEAD                        → limpo ✅
```

Zero alteração em: emissão fiscal · configuração tributária da loja · PDV · Caixa ·
Financeiro · Operações · Contador · auth · proxy · numeração de vendas.
Verificado por `git diff --name-only` sobre `auth.ts`, `auth.config.ts`, `proxy.ts`,
`app/actions/auth.ts`, `lib/prisma.ts`, `next.config.mjs`, `tsconfig.json`,
`lib/fiscal/**`, `lib/financeiro/**`, `lib/operacoes/**`, `lib/contador/**`,
`components/vendas/**`, `app/api/ops/**` — **saída vazia**.

Snapshot fiscal: **não foi tocado** por build nem por teste — nada a restaurar.

---

## 15. Riscos

| # | Risco | Sev. | Bloqueia? | Mitigação |
|---|---|---|---|---|
| R-1 | Cadastros V2 descarta chave não canônica em `metadata.fiscal` | P3 | ❌ | Sem writer nem reader atual; pré-existente; documentado |
| R-2 | Estado MISTO: V2 promove legado, REST/importador não | P2 | ❌ | Não é regressão (leitura já era assim); direção segura; não afeta Martins |
| R-3 | `upsertProduto` zera `price`/`precoCusto`/`warrantyDays` com payload parcial | P2 | ❌ | Pré-existente e **fora do diff**; a UI real envia o formulário completo; `stock` e `metadata` já têm semântica "não tocar" |
| R-4 | `origemMercadoria` trunca antes de validar (`"10"` → `"1"`) | P3 | ❌ | Pré-existente, idêntico em `origin/main`, fora do escopo |
| R-5 | CEST curto é zero-padded em vez de rejeitado | P3 | ❌ | Comportamento pré-existente; o importador já rejeita antes do helper |
| R-6 | Merge é shallow — irmãos compartilham referência com a entrada | P3 | ❌ | Nenhum caller muta o resultado; registrado |

**R-3 é o único com relevância operacional imediata:** um reparo manual feito via
Cadastros V2 com payload parcial (só campos fiscais) zeraria preço, custo e garantia.
O reparo Martins **não** usa esse caminho — usa o importador avançado, cuja
`montarAtualizacaoProduto` omite `stock` e não mexe em preço.

---

## 16. Decisão de merge

**Aprovado para integração — classe B.**

O defeito que motivou o GOAL é real, foi reproduzido de forma independente contra a
implementação de `origin/main`, e está fechado. A reimportação dos 13 produtos Martins
pode prosseguir: a fixture real passou pelo persistidor real contra PostgreSQL real,
preservando a identidade fiscal curada, a proveniência, o preço e o estoque, com segunda
passada idempotente.

As três ressalvas são **pré-existentes ou seguras por direção**, nenhuma com writer ou
consumer produtivo dependente, e todas documentadas. Nenhuma amplia o contrato.

Próximo GOAL: **`PRODUTO-FISCAL-METADATA-PARTIAL-MERGE-MERGE-001`**

---

## 17. O que esta readiness NÃO cobriu

- **Nenhum banco remoto** (Neon/Supabase) foi acessado — proibido pelo GOAL.
- **Nenhum produto real** foi alterado.
- **Nenhuma correção de código** foi feita; a branch de implementação não foi tocada.
- `lib/cadastros/produtos-listagem-sql.integration.test.ts` foi executado **sem skip**,
  mas exige um corpus semeado (> 5.000 produtos) que este GOAL não provê: as 9 falhas são
  **todas** pré-condições de banco vazio (`0 > 5000`, `null truthy`, `[] length 25`),
  nenhuma asserção de comportamento. O arquivo está **fora do diff** da branch e o GOAL
  dispensa o vetor `SQLSTATE 42804` — "o vetor desta mudança é merge de objeto JSON, não
  query builder".
- Validação visual de UI não foi executada — o diff não altera componente algum.
