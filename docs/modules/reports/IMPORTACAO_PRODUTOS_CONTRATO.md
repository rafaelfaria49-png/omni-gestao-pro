# Importação de produtos por planilha — contrato

Origem: `CADASTROS-IMPORTACAO-PRODUTOS-REVIEW-HARDENING-001`.
Motivador: a importação de teste da **NF-e 5.380.135 (MARTINS COM SERV DISTR SA)** na
Loja 2 criou 13 produtos com SKU `linha-1..13`, sem código de barras, sem fornecedor,
categoria slugada e copiada para a marca.

Núcleo puro: [`lib/cadastros/importacao-produtos/`](../../../lib/cadastros/importacao-produtos)
(sem Prisma, sem React). O persistidor
[`lib/importador-avancado/persistidor.ts`](../../../lib/importador-avancado/persistidor.ts)
faz as consultas escopadas por `storeId` e delega **toda** decisão de identidade ao núcleo.

## 1. Resolução semântica por domínio

`resolverCampoSemantico(header, dominio?)` aceita o domínio da planilha. Quando vale
`"produtos"`, o `DICIONARIO_PRODUTOS` tem precedência sobre o dicionário genérico:

| Header | Sem domínio (antes) | Domínio `produtos` |
|---|---|---|
| `Código` | `cliente.codigo` | `produto.sku` |
| `Marca` / `Fabricante` | `equipamento.marca` | `produto.marca` |
| `Código de barras` (plural) | **não resolvia** | `produto.barcode` |
| `CEST` | **não resolvia** | `produto.cest` |
| `Fornecedor` | **não resolvia** | `produto.fornecedor` |

Aliases de código de barras: `Código de barras`, `Código de barra`, `Código barras`,
`Cod barras`, `Barras`, `EAN`, `GTIN`, `GTIN/EAN`, `Código usado na importação`.
`EAN comercial` / `EAN tributável` são campos fiscais próprios (`gtinComercial`,
`gtinTributavel`), não o barcode.

Os demais domínios (OS, vendas, clientes, financeiro) continuam vendo **só** o mapa
genérico — nenhuma planilha existente muda de classificação.

## 2. Identidade: o que é SKU e o que é resíduo

`linha-N` é o índice interno que o merger usa quando a planilha não tem coluna-chave.
**Nunca** pode ser persistido.

- `isSyntheticImportSku(v)` — reconhece `linha-N` (com ou sem prefixo `gc-`/`prod-`/`id-`)
  e o fallback histórico `IMP-<categoria>-<nome>`. Um código legítimo como `IMP-4471`
  **não** casa (exige os dois segmentos).
- `isRealProductSku(v)` — único predicado que autoriza gravar/pontuar/deduplicar por SKU.
- `normalizeImportSku(v)` — devolve o SKU real ou `null`. **Ausência permanece ausência**:
  o importador não gera mais `IMP-*` silencioso.
- Código de barras nunca é copiado para SKU; código do fornecedor nunca substitui o SKU.

## 3. Política de matching

Ordem, sempre dentro da mesma loja:

1. **código de barras** exato normalizado (só dígitos);
2. **SKU real** exato (o mesmo código com e sem prefixo `gc-` é o mesmo produto);
3. **código do fornecedor**, apenas com vínculo do **mesmo** fornecedor
   (`metadata.fornecedor.codigo` + `supplierName`);
4. **nome normalizado exato**, e somente se **todas** valerem:
   - existe exatamente 1 produto com aquele nome na loja;
   - esse produto não tem barcode **ou** tem SKU sintético;
   - a linha traz barcode **ou** NCM que enriqueça o cadastro;
   - o barcode/SKU da linha não pertence a outro produto.

Vira **conflito** (não persiste, exige decisão humana):

- dois ou mais produtos com o mesmo nome normalizado;
- barcode e SKU da linha apontando para produtos diferentes;
- mais de um produto com o mesmo código do fornecedor;
- candidato homônimo recusado **e** linha sem código próprio.

Duas linhas do mesmo arquivo nunca caem no mesmo produto (`consumidos`).

O preview mostra por linha: resultado previsto, motivo do match, campos que serão
alterados e campos preservados. **Conflito trava o botão Importar.**

## 4. Persistência

| Campo | Regra |
|---|---|
| `name` | sempre da planilha |
| `sku` | real da planilha; sintético do banco é **limpo**; ausência preserva o existente |
| `barcode` | gravado quando a planilha traz |
| `category` | nome **legível** (`Pilhas e Baterias`), nunca slug. Reaproveita a grafia da `CategoriaCadastro` da loja quando já existir |
| `brand` | só quando informado **e** diferente da categoria. Marca que é cópia da categoria (defeito `brand = category`) é limpa; marca curada pelo operador é preservada |
| `supplierName` | do contexto do lote ou da linha |
| `precoCusto` / `price` | só sobrescrevem quando a planilha traz valor > 0 |
| `stock` | ver §5 |
| `warrantyDays` | quando informado |
| `metadata.fiscal` | via `mergeProdutoFiscalIntoMetadata` (contrato canônico) |
| `metadata.importacao` | ver §6 |

Categorias **não** são criadas automaticamente: a importação reaproveita
`CategoriaCadastro` existente, senão grava o nome legível direto no produto.

### Fiscal

Só campos já aceitos por `lib/produto-fiscal.ts` — sem namespace paralelo.
Persistidos: `ncm`, `cest`, `unidadeComercial`, `unidadeTributavel`, `gtinComercial`,
`gtinTributavel`.

- **NCM**: vazio ou exatamente 8 dígitos após remover pontuação. Valor com outro
  comprimento é **descartado e vira alerta visível** — não é completado com zero.
- **CEST**: vazio ou exatamente 7 dígitos, mesma regra.
- `gtinComercial` espelha o código de barras do item (é o `cEAN` da NF-e — o mesmo dado
  sob o nome fiscal). `gtinTributavel` só é preenchido quando explicitamente informado.
- Tributação, CST, CSOSN e CFOP **não** são automatizados.

## 5. Política de estoque

Escolhida pelo operador no bloco de contexto do lote:

1. **`nao_movimentar`** (padrão, recomendado para nota antiga) — produtos novos entram
   com saldo **0**.
2. **`planilha_somente_novos`** — usa a quantidade da planilha **apenas** na criação.

Em **nenhuma** das opções o estoque de produto existente é sobrescrito
(`montarAtualizacaoProduto` simplesmente não emite a chave `stock`).
A importação não cria `MovimentacaoEstoque` — entrada física/fiscal por XML é outro fluxo.

## 6. Proveniência — `Produto.metadata.importacao`

Sem migration: namespace aditivo no JSONB existente, convivendo com `fiscal`,
`atributos`, `acessorios`, `catalogoAparelhos`, `barcodeLookup`.

```jsonc
{
  "ultimoLote": {
    "batchId": "adv-...",
    "origem": "planilha",
    "arquivo": "nfe-5380135-martins.xlsx",
    "importadoEm": "2026-07-29T10:00:00.000Z",
    "acao": "criado" | "atualizado",
    "matchPor": "barcode" | "sku" | "codigo_fornecedor" | "nome_exato" | null,
    "fornecedor": { "nome": "...", "documento": "..." } | null,
    "documento": { "tipo": "nfe" | "outro", "numero": "", "serie": "", "chave": "", "dataEmissao": "" } | null,
    "linhaOrigem": 1,
    "statusRevisao": "pendente" | "revisado",
    "revisadoEm": null,
    "revisadoPor": null
  },
  "historico": [ /* ...mesma forma, mais recente primeiro... */ ]
}
```

**Histórico limitado a `IMPORTACAO_HISTORICO_MAX = 10`.** Reimportar o mesmo `batchId`
atualiza o lote no lugar, sem duplicar histórico. Todos os outros namespaces de
`metadata` são preservados.

## 7. Ativação

- Produto **novo** sem preço de venda nasce `active: false` / `status: "Inativo"` —
  visível na conferência, fora do PDV.
- Produto **existente e ativo** nunca é inativado por planilha sem preço.
- Ativar exige: nome + categoria + preço > 0 + ausência de conflito de SKU/barcode.
- Barcode, fornecedor, NCM e CEST geram **alerta**, nunca bloqueio — há produtos que
  legitimamente não têm esses dados.

## 8. Conferência pós-importação

`Cadastros HUB → Importação → Histórico → Revisar produtos`
(`components/cadastros/lovable/components/cadastros/ConferenciaLoteProdutos.tsx`).

Carrega **somente** `(batchId, storeId)`. Server Actions:
`getConferenciaLote` (leitura) e `aplicarConferenciaLote` (escrita, com escopo duplo:
id pertencente ao lote **E** `storeId` da sessão).

Permite: edição individual de preço, seleção em lote, definir preço, acréscimo % sobre
o custo, valor fixo sobre o custo, arredondamento `,90` / `,99`, prévia antes de salvar,
marcar como revisado e ativar apenas os produtos aptos. Nenhuma ação em massa salva sem
confirmação. Estoque é exibido somente leitura.

**Vocabulário:** *acréscimo sobre custo* (markup) e *margem bruta sobre preço de venda*
são colunas separadas. Markup nunca é chamado de margem.

## 9. Filtros da listagem

`listProdutosPaginado(storeId, { filters: { importacao, batchId, fornecedorNome } })`:
`ultimoLote`, `hoje`, `pendenteRevisao`, `revisado`, `semBarcode`, `skuSintetico`,
`semNcm`, `semCest`.

Resolvidos em SQL sobre o JSONB (exatos), no mesmo caminho `$queryRaw` que já servia ao
ranking de busca. Paginação e busca seguem server-side. Se o caminho raw falhar, há
fallback Prisma com os equivalentes expressáveis; `semNcm`, `semCest` e `hoje` são
registrados como descartados no log em vez de silenciosamente ignorados.

## 10. Score de qualidade

`lib/cadastros/produto-quality-score.ts` — base **0** (antes eram 35 de graça). Pesos
somam 100: nome 18, identificador real 14, barcode 14, categoria 14, preço 18, marca
real 6, fornecedor 6, NCM 6, revisão concluída 4.

Não pontuam: SKU `linha-N`/sintético, placeholder (`—`, `-`, `n/a`), marca igual à
categoria, preço zero, fornecedor vazio, barcode vazio. `explicarQualityScore` devolve
item por item com o motivo — base do tooltip/painel.

## 11. Reparo dos 13 produtos do Martins após o deploy

Os 13 produtos da Loja 2 **não** foram alterados por este GOAL (nenhum acesso a banco).
Depois do deploy, o reparo é feito pela própria UI:

1. `Cadastros HUB → Importação → Planilhas → Importador Avançado`, com a **Loja 2** ativa.
2. Enviar a mesma planilha da NF-e 5.380.135.
3. Em **Contexto da importação de produtos**, preencher:
   - Fornecedor: `MARTINS COM SERV DISTR SA`
   - CNPJ: `43.214.055/0040-13`
   - Tipo: `NF-e` · Número: `5380135` · Série: `0`
   - Chave: `52260143214055004013550000053801351857035145`
   - Data de emissão: `02/01/2026`
   - Política de estoque: **Cadastro sem movimentar estoque**
4. Conferir o preview: deve mostrar **0 criações, 13 atualizações, 0 conflitos** e o
   alerta "Correspondência por nome exato" nas 13 linhas.
5. Importar. Os SKUs `linha-1..13` são limpos, os 13 barcodes gravados, o fornecedor
   preenchido, as categorias voltam a legíveis, a marca copiada da categoria é limpa e
   NCM/CEST entram em `metadata.fiscal`. Estoque e preço permanecem em zero.
6. Clicar em **Revisar produtos desta importação**, definir os preços de venda
   (acréscimo % sobre o custo + arredondamento `,90` costuma bastar), conferir na prévia,
   salvar, marcar como revisado e **Ativar produtos aptos**.

Rodar a importação uma segunda vez é seguro e idempotente: os 13 passam a casar por
**código de barras**, sem criar nada e sem duplicar histórico.

## 12. Testes

`lib/cadastros/importacao-produtos/*.test.ts`,
`lib/cadastros/produto-quality-score.test.ts`,
`lib/importador-avancado/detector-produtos.test.ts`.

A regressão da nota Martins vive em
[`martins-regressao.test.ts`](../../../lib/cadastros/importacao-produtos/martins-regressao.test.ts)
com a fixture em
[`fixtures/martins-nfe-5380135.ts`](../../../lib/cadastros/importacao-produtos/fixtures/martins-nfe-5380135.ts):
roda detector → merger → linha canônica → matching → escrita → metadata contra um banco
simulado em memória, cobrindo a primeira importação (13 matches por nome), a segunda
(13 por barcode) e o isolamento multi-loja com os mesmos EANs.
