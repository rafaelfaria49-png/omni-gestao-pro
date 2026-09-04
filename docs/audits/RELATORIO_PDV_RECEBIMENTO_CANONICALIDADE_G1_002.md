# PDV · Receber conta — G1: canonicalidade e hardening (relatório)

| | |
|---|---|
| **GOAL** | `PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002` (G1 da sequência G1→G2→G3) |
| **Tipo** | Correção técnica de pré-requisitos. **Sem schema, sem multitítulo, sem redesign.** |
| **Data** | 2026-09-03 |
| **Base** | `origin/main` @ `9978e30` |
| **Branch** | `fix/pdv-recebimento-canonicalidade-002` |
| **Design aprovado** | [`AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`](./AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md) (copiado sem alteração) |

---

## 1. Causa corrigida

O `payload` JSONB do título acumulava **dois papéis incompatíveis**: snapshot de
apresentação do painel legado (localStorage / import / sync) *e* livro-razão do servidor
(`payload.historico`, única fonte de `saldoAberto`).

`replacePayload: true` reescrevia o payload inteiro com o snapshot do cliente. Como
`ContaReceberRow` não tem a chave `historico`, cada sincronização do painel **apagava o
ledger** — e `saldoAberto = valor − soma(historico)` ressuscitava dívida já recebida. Na
direção contrária, a listagem devolvia o snapshot cru como autoridade, então a tela do PDV
exibia "pendente / valor bruto" para títulos quitados no servidor.

Sobre essa base insegura, a baixa singular ainda gravava título, `MovimentacaoFinanceira` e
`CaixaOperacao` em **três escritas independentes** — a movimentação com
`.catch(console.error)` — e carimbava `Date.now()` no `localId` da operação de caixa, de
modo que todo retry criava uma segunda entrada no caixa.

---

## 2. Invariantes estabelecidas

| # | Invariante | Onde vive |
|---|---|---|
| I1 | Snapshot de cliente **não apaga** chave server-owned do payload (`historico` e carimbos de cancelamento/estorno). O chamador só é autoridade sobre o `historico` enquanto o **servidor nunca gravou lançamento** naquele título; a partir do 1º lançamento do PDV/Financeiro, o ledger é do servidor. | `contas-receber-service.ts` · `CONTA_RECEBER_SERVER_OWNED_PAYLOAD_KEYS` · `temLedgerDoServidor` |
| I2 | Estado terminal do servidor (`pago`/`cancelado`/`estornado`) **não é reaberto** por snapshot antigo; e o status nunca contradiz o ledger preservado (com pagamentos, deriva `parcial`/`pago`). A guarda é **unidirecional**: impede reabrir dívida, não impede encerrá-la — `cancelado`/`estornado` pedidos pelo chamador continuam sendo atendidos. | `canonicalSnapshotStatus` |
| I3 | A listagem apresenta **status e valor do registro server-side**, preserva a metadata visual do snapshot e expõe `saldoAberto` canônico por linha. | `app/api/ops/contas-receber-list/route.ts` |
| I4 | "Em aberto" é **saldo > `PAY_EPS`**, nunca status textual. O corte pelo epsilon vem antes do arredondamento em centavos. | `lib/contas-receber-aberto.ts` |
| I5 | Liquidar título já pago devolve `ok:false / ja_pago` — **zero** movimentação, **zero** operação de caixa. Nunca o valor bruto como fallback. | `contas-receber-service.ts` · rota PDV |
| I6 | Título + histórico + movimentação + `CaixaOperacao` numa **única** `$transaction`. Falha em qualquer etapa desfaz todas. Erro de escrita financeira **propaga**. | `app/api/pdv/receber-conta/route.ts` |
| I7 | `payload.localId` **determinístico** (sem `Date.now()`), verificado dentro da transação antes de qualquer escrita. Retry não duplica caixa nem reaplica pagamento. | `buildRecebimentoLocalId` |
| I8 | Toda consulta, chave de idempotência e escrita continua escopada por `storeId`; o `localId` carrega a loja. | rota PDV · services |

**Porta `db` injetável (pré-requisito do G2):** `contas-receber-service`,
`movimentacoes-service` e `carteiras-service` aceitam `db?: Prisma.TransactionClient` e caem
no singleton global quando ausente — **nenhum chamador existente mudou**. Padrão idêntico ao
já usado em `lib/estoque/deposito-core.ts`.

---

## 3. Testes

`npx vitest run` nos escopos afetados: **43 arquivos / 556 testes, todos passando.**
Os 4 arquivos novos somam 57 testes.

| Arquivo | Cobre |
|---|---|
| `lib/financeiro/services/contas-receber-canonicalidade.test.ts` (15) | critérios 1, 2, 5, 9, 10, 11 · autoridade do importador · terminal não reabre |
| `app/api/ops/contas-receber-list/canonical-list.test.ts` (8) | critérios 3, 4 · metadata visual preservada · isolamento de loja |
| `app/api/pdv/receber-conta/recebimento-atomico.test.ts` (18) | critérios 5, 6, 7, 8, 9, 10, 11 · porta `db` |
| `lib/contas-receber-aberto.test.ts` (18) | critério 4 · epsilon · contrato com o fonte do modal |

**O harness de atomicidade não é um mock passivo.** O banco fake implementa `$transaction`
com snapshot/restore real, e o cliente **global recusa qualquer acesso enquanto há transação
aberta** — se um service ignorasse a porta `db`, a chamada estouraria em vez de passar
despercebida. Há um **controle negativo explícito** que prova isso: uma leitura sem `db`
dentro de `$transaction` falha com a mensagem esperada. Sem esse controle, os testes de
rollback não provariam nada.

Um defeito real foi encontrado **pelos próprios testes**: `saldoAbertoDaRow` arredondava
para centavos *antes* de comparar com o epsilon, transformando um resíduo de `0,009` em
`R$ 0,01` — e o título voltava a contar como aberto. Corrigido na origem.

### Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `git diff --check` | ✅ limpo |
| `npx eslint` (arquivos alterados) | ✅ 0 erros · 2 warnings **pré-existentes** (`react-hooks/exhaustive-deps` sobre `rows` em `callLiquidar`/`callParcial`, arrays não tocados por este GOAL) |
| `npm run build` | ✅ (fronteira de bundling mudou: componente client passou a importar `lib/financeiro/contracts/valores`) |
| Suíte completa | 7059 passando · **4 falhas pré-existentes e ambientais**, todas na trilha Fiscal: 3 por `xmllint` ausente do PATH (os testes falham-fechado de propósito) e 1 timeout de 5 s num scan de arquivos sob carga paralela — o arquivo **passa isolado**. Nenhum importa qualquer módulo alterado aqui. |

Após as correções da revisão: **615 testes verdes em 49 arquivos** nos escopos afetados
(incluindo `lib/importador-avancado/`), `typecheck` exit 0, `build` exit 0, eslint 0 erros.

## 3.1 Revisão independente

Executada por **outra família de modelo** (Sonnet 5), em duas rodadas, read-only.

**1ª rodada — 1 achado P1, procedente e corrigido.** O guard de canonicalidade nascia
**inerte** para `importador-avancado/persistidor.ts` (ver o box em §4). A revisão também
levantou 5 P2, todos endereçados: mapeamento HTTP da rota órfã `financeiro/contas-receber/liquidar`
(corrigido), escape de `cancelado`/`estornado` em `canonicalSnapshotStatus` (corrigido) e três
comentários que generalizavam além do que o código garante (reescritos) — ver P2-G e P2-H.

**2ª rodada — P1 FECHADO, sem P0/P1 novos.** A verificação incluiu: varredura de todos os
pontos de escrita em `ContaReceberTitulo.payload.historico`; validação da premissa
"`at` ⟺ escrita do servidor" **contra o histórico do git** (antes de `appendFinanceiroHistorico`
não existia nada que gravasse pagamento nesse formato, logo nenhum dado legado pode ter
lançamento sem `at`); checagem de que `refHistoricoIndex` do estorno não desalinha; e a
confirmação de que os 3 testes `[P1-REVISÃO]` **falhariam** sob o código pré-correção. Os dois
P2 novos estão registrados como P2-I e P2-J.

---

## 4. Decisões que divergem da letra do briefing

**`ja_pago` em vez de `ja_quitado`.** O GOAL admite `ja_quitado / nada_em_aberto` "conforme
contrato existente mais compatível". `ja_pago` **já existe** no repositório para exatamente
esta condição — em `registrarPagamentoParcial` (mesmo service) e em `contas-pagar-service` —
e o modal do PDV já o traduz. Criar um sinônimo fragmentaria o contrato. O modal aceita
`ja_quitado` também, caso o G2 prefira o outro nome.

**Guarda de canonicalidade escopada ao caminho `replacePayload`.** É exatamente o caminho
dos três *writers* que a auditoria §5 aponta (`contas-receber-persist`,
`sync-legacy-financeiro`, `importador-avancado/persistidor`). Os chamadores de merge
(`vendas/corrigir`, `corrigir-parcelas`, `pdv-servico-actions`) ficam **byte-idêntico** no
comportamento — aplicar a regra a eles alteraria fluxos de produção fora do escopo deste
GOAL. Ver pendência P2-A.

**Nenhum caller de `replacePayload` foi alterado.** A correção central cobre os três writers.

> **Correção após revisão independente.** A 1ª versão desta entrega afirmava essa cobertura
> sem tê-la: `importador-avancado/persistidor.ts` monta `payloadPatch` com a chave
> `historico` **sempre presente** (mesmo `[]`), então o discriminador original — "o chamador
> enviou `historico`?" — era `true` incondicionalmente ali, e a proteção nascia **inerte**
> justamente para o writer de importação. Falha real e alcançável: título importado →
> recebido no PDV → planilha de origem reimportada (que não sabe do pagamento) → ledger
> apagado e dívida ressuscitada com saldo cheio. O discriminador passou a exigir também que
> o servidor **ainda não tenha gravado** lançamento no título (`temLedgerDoServidor`, que
> reconhece o carimbo `at` posto por `appendFinanceiroHistorico` — único caminho de escrita
> do servidor no ledger, e ausente nas entradas de importação). Três testes de regressão
> cobrem o cenário.

---

## 5. Consequência intencional em rotas irmãs

`liquidarContaReceber` deixou de devolver `ok:true` para título já pago. Isso muda, **de
propósito**, o comportamento de dois chamadores fora do PDV — que passam a relatar a recusa
em vez de fingir sucesso (achado J da auditoria, mesma classe de defeito):

- `app/api/financeiro/contas-receber/liquidar/route.ts` — passa a responder erro. A rota
  mapeava **toda** recusa para `404`, o que ficaria semanticamente errado para `ja_pago`
  (o título existe; a operação é que não se aplica). Como a impropriedade seria criada por
  esta mudança, o mapeamento foi alinhado ao da rota do PDV (`not_found` → 404, demais →
  422). A rota não tem chamador no repositório e não cria movimentação nem caixa.
- `lib/operacoes-v3/pdv-servico-actions.ts` — passa a lançar `Não foi possível quitar
  (ja_pago)` em vez de seguir e registrar uma **segunda** operação de caixa para uma OS já
  quitada. Melhoria real, mas é mudança de comportamento observável.

---

## 6. Pendências explícitas

### P2-A — status pelo caminho de merge (G2)
`upsertContaReceber` sem `replacePayload` ainda aceita o `status` do chamador sem confrontá-lo
com o ledger. `vendas/corrigir` e `corrigir-parcelas` reescrevem o título-alvo com
`status: "pendente"` sem cancelá-lo antes. Não é explorável pelo snapshot legado (a via
corrigida aqui), mas merece decisão própria — fora do escopo deste GOAL.

### P2-B — idempotência concorrente
A verificação do `localId` ocorre **dentro** da transação, antes de qualquer escrita: cobre
retry e duplo POST sequenciais. Dois POSTs **simultâneos** ainda podem passar juntos pela
checagem — não há índice único sobre `payload.localId` e o GOAL veda schema novo. Para o lote
do G2, a primitiva já existente no repo é `pg_advisory_xact_lock` via `$queryRaw`
(`lib/vendas/server-sale-numbering.ts`), aplicada sobre o hash do `localId` dentro da mesma
transação.

### P2-I — o importador perde autoridade para corrigir a PRÓPRIA entrada
Consequência deliberada de I1: assim que o servidor grava um lançamento, o ledger daquele
título é dele. Se a planilha de origem tinha um pagamento **errado** e é corrigida depois que
o título já foi tocado no PDV, a reimportação não conserta mais aquela entrada — o histórico
fica com o valor errado do import **mais** o pagamento real.

Troca consciente: apagar dinheiro real é muito pior que travar uma correção de importação,
que tem outros caminhos de conserto (estorno). Levantado pela revisão independente.

### P2-J — `at` vindo do cliente não é rejeitado
`contas-receber-persist` e `sync-legacy-financeiro` repassam o `payloadPatch` como JSON
arbitrário do cliente. Um chamador não-padrão autenticado como staff poderia, na **primeira**
escrita de um título (antes de qualquer toque real do servidor), forjar uma entrada com `at`
no `historico` — e `temLedgerDoServidor` passaria a tratar aquele array como legítimo. A UI
real nunca faz isso (verificado) e não é explorável pelos clientes hoje embarcados. Defesa
natural, se esses endpoints ficarem menos confiáveis: ignorar `at` vindo de payload de
cliente. Levantado pela revisão independente.

### P2-G — `liquidarContaPagar` tem o mesmo defeito, do outro lado
`lib/financeiro/services/contas-pagar-service.ts:267` ainda devolve `{ok:true}` para título
já pago — o espelho exato do achado J corrigido aqui em Contas a Receber. Não tocado (fora do
escopo do GOAL). Pelo mesmo motivo, `contas-pagar-service` mantém a própria cópia de
`PAY_EPS` em vez de importar de `contracts/valores`.

### P2-H — retry de `liquidar` sem `idempotencyKey` não faz replay gracioso
Sem chave explícita, a identidade derivada de `liquidar` inclui o saldo — que vira 0 após a
1ª baixa. O retry então não casa a chave e é barrado um passo adiante pelo `ja_pago` do
service: **nada é duplicado** (o requisito financeiro se mantém), mas a resposta é erro em
vez do replay `jaRegistrado:true` que `parcial` recebe. O modal do PDV sempre envia chave,
então o caso está dormente. Encontrado pela revisão independente; comportamento mantido,
comentário do código corrigido para não generalizar além do que garante.

### P2-C — chamador sem `idempotencyKey` repetindo parcial idêntica
Sem chave explícita, a identidade cai em `(título, op, valor, sessão)`. Um chamador direto da
API que registre **duas parciais legítimas de mesmo valor, no mesmo título e na mesma
sessão** recebe a segunda como repetição (`jaRegistrado: true`, resposta 200, nada gravado).
O modal do PDV sempre envia chave e não é afetado. O comportamento anterior era pior
(duplicava o caixa **sempre**), mas a lacuna é real e a resposta a sinaliza.

### P2-D — matching fuzzy do cliente (G3)
`clienteMatchesTitulo` continua aceitando substring bidirecional sobre nome/documento/telefone
("Ana" casa com "Mariana"), e `saldoDevedorClienteApos` continua agregando por
`normClienteKey` — o rodapé do recibo soma homônimos. **Não endurecido aqui**: nenhuma
mutação financeira nova usa esses caminhos (o `localKey` é sempre a chave da escrita), e
trocar a agregação por `clienteId` exige mudar a resposta do servidor e os três call sites do
recibo — trabalho do G3, §8 do design. O escopo fuzzy **não foi ampliado**.

### P2-F — o painel Financeiro descarta a listagem canônica (`local wins`)
`components/dashboard/financeiro/contas-receber.tsx` funde a resposta do servidor com
`mergeContasLocalWins(prev, fromServer)`: para todo título que já exista no localStorage, a
**linha local vence por inteiro** e só títulos inéditos do servidor são anexados. Logo a
listagem canônica desta entrega chega ao PDV (que consome a resposta direta), mas **não**
muda o que esse painel desenha.

Encontrado durante a auditoria, **não corrigido**: o GOAL delimita §2 ao contrato da API e §3
ao modal do PDV, e inverter a precedência desse merge muda o comportamento de uma tela de
produção do Financeiro — decisão que não é deste GOAL. Registrado aqui para o G2/G3.

### P2-E — checagens de período/sessão fora da transação
`verificarPeriodoFechado` e a validação da sessão ABERTA seguem **antes** da transação, como
na main. O design (§7.2) as coloca dentro da transação do lote; `fechamento-service` ainda não
tem porta `db`. Não é regressão — é comportamento preservado.

---

## 7. Confirmação dos critérios de aceite

```
CANONICAL_PAYLOAD_HISTORY_PRESERVED=true
PAID_TITLE_CANNOT_RESURRECT=true
CANONICAL_LIST_STATUS=true
CANONICAL_LIST_OPEN_BALANCE=true
ZERO_BALANCE_NOT_OPEN=true
SINGULAR_RECEIPT_ATOMIC=true
SINGULAR_RECEIPT_IDEMPOTENT=true
PAID_RELIQUIDATION_ZERO_SIDE_EFFECTS=true
TRANSACTION_CLIENT_READY_FOR_G2=true
STORE_ISOLATION=true
SCHEMA_CHANGED=false
MULTITITLE_ENDPOINT_CREATED=false
DESIGN_G3_IMPLEMENTED=false
```

Não implementado, conforme o ponto de parada: `/api/pdv/receber-conta-lote`, checkboxes,
selecionar todos, distribuição parcial entre títulos, CTA "Receber N títulos", recibo
consolidado, HTML do Claude Design, migration/schema, mudança ampla do Financeiro, qualquer
mudança Fiscal.
