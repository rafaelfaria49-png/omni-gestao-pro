# PDV · Receber conta — G2: backend do recebimento multitítulo (relatório)

| | |
|---|---|
| **GOAL** | `PDV-RECEBIMENTO-MULTITITULO-BACKEND-003` (G2 da sequência G1→G2→G3) |
| **Tipo** | Backend novo. **Sem schema, sem UI, sem recibo.** |
| **Data** | 2026-09-04 |
| **Base** | `origin/main` @ `44fc74e` |
| **Branch** | `feat/pdv-recebimento-multititulo-backend-003` |
| **Design aprovado** | [`AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md`](./AUDITORIA_PDV_RECEBIMENTO_MULTITITULO_DESIGN_001.md) — §3 (visual) segue **exclusivo do G3**, intocado |
| **Pré-requisito** | [`RELATORIO_PDV_RECEBIMENTO_CANONICALIDADE_G1_002.md`](./RELATORIO_PDV_RECEBIMENTO_CANONICALIDADE_G1_002.md) (PR #157, `44fc74e`) |

---

## 1. O que foi entregue

`POST /api/pdv/receber-conta-lote` — recebe **N títulos de Contas a Receber numa única
operação lógica e transacional**. Nenhuma UI multitítulo foi implementada; o endpoint
ainda **não tem chamador** no repositório (é a fundação do G3).

**Criados**

- `app/api/pdv/receber-conta-lote/route.ts` — borda HTTP (contrato, unidade, permissão, mapeamento de erro)
- `lib/financeiro/services/recebimento-lote-service.ts` — domínio do lote (lock, revalidação, escrita, idempotência)
- `app/api/pdv/receber-conta-lote/recebimento-lote.test.ts` — 43 testes com banco fake transacional
- `app/api/pdv/receber-conta-lote/recebimento-lote-lock.postgres.test.ts` — 4 testes contra PostgreSQL REAL (opt-in)

**Alterados (aditivo; nenhum chamador existente muda de comportamento)**

- `lib/financeiro/services/contas-receber-service.ts` — parâmetro opcional `loteId`, carimbado no histórico
- `lib/financeiro/services/movimentacoes-service.ts` — dois opts opcionais em `createMovimentacaoEntradaFromReceber` (§5)

**Não tocados:** `prisma/schema.prisma`, migrations, auth/proxy, Fiscal,
`app/api/pdv/receber-conta/route.ts` (a rota singular do G1 segue servindo "Quitar este
título"), painel Financeiro, modal do PDV, recibo.

`docs/ai/CURRENT_STATUS.md` **não** foi atualizado, de propósito: nenhum módulo mudou de
estado observável — o endpoint é fundação dormente, sem chamador. A mudança de estado do
"Receber conta" acontece no G3, quando a UI passar a usá-lo. Mesmo critério do G1.

---

## 2. Contrato final da API

### Request

```
POST /api/pdv/receber-conta-lote
Header: x-assistec-loja-id: <storeId>   (obrigatório — cookie não é aceito em escrita)
```

```jsonc
{
  "lojaId": "loja-1",              // opcional; se vier, tem de bater com o header
  "sessaoId": "ckx...",            // sessão de caixa ABERTA da loja
  "formaPagamento": "dinheiro",    // obrigatório
  "observacao": "acerto do mês",   // opcional
  "idempotencyKey": "b1f0c9e2-...", // obrigatório — /^[A-Za-z0-9._-]{8,120}$/
  "itens": [                        // 1..25
    {
      "localKey": "cr-crediario-77", // OBRIGATÓRIO — única chave financeira
      "tituloId": "ckx...",          // opcional, só conferência extra
      "saldoEsperado": 262.38,
      "valorReceber": 100.00
    }
  ]
}
```

**Regras do contrato** (validadas antes de qualquer I/O, em `validarRecebimentoLote`):

| Regra | Recusa |
|---|---|
| `idempotencyKey` obrigatória, 8–120 chars `[A-Za-z0-9._-]` | `400 idempotency_key_invalida` |
| 1 a **25** itens (teto explícito, §7) | `400 lote_vazio` / `400 lote_excede_teto` (26+ já barra no zod) |
| `localKey` obrigatório em todo item | `400 valor_invalido` |
| nenhum item repetido (por `localKey` **e** por `tituloId`) | `400 item_duplicado` |
| `valorReceber > PAY_EPS` (0,009), sem negativo | `400 valor_invalido` |
| `saldoEsperado >= valorReceber` e `saldoEsperado >= 0` | `400 saldo_esperado_insuficiente` |

Nome, documento e telefone **não existem no contrato**. A chave financeira é sempre
`localKey`; `tituloId` só serve para reprovar o lote se a lista do cliente estiver
desalinhada.

O cliente **não envia total**. `totalRecebido` é somado no servidor a partir dos itens
revalidados — um `total` no corpo é simplesmente ignorado (o zod descarta chaves
desconhecidas), e existe teste para isso.

### Response 200

```jsonc
{
  "ok": true,
  "jaRegistrado": false,       // true = replay do mesmo lote; nada foi gravado de novo
  "totalRecebido": 150.00,
  "sessaoId": "ckx...",
  "itens": [
    { "tituloId": "...", "localKey": "A", "saldoAntes": 100, "valorRecebido": 100, "saldoDepois": 0,   "statusFinal": "pago" },
    { "tituloId": "...", "localKey": "B", "saldoAntes": 200, "valorRecebido": 50,  "saldoDepois": 150, "statusFinal": "parcial" }
  ]
}
```

A resposta tem **exatamente** essas 5 chaves de topo e 6 por item — há teste que falha se
o formato crescer. Nada de payload bruto, `historico`, segredo ou dado do título além do
necessário.

### Erros

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `dados_invalidos` + os códigos do contrato acima | corpo malformado / contrato violado |
| 400 | — | unidade ausente ou `lojaId` ≠ header |
| 401/403 | — | `apiGuardFinanceiroEditEnterpriseOrLegacy` |
| 409 | `periodo_fechado` | fechamento financeiro do dia/mês |
| 409 | `caixa_fechado` | sessão inexistente, de outra loja, ou não `ABERTA` |
| 409 | `saldo_divergente` | `saldoEsperado` ≠ saldo real, ou `valorReceber` > saldo real |
| 409 | `titulo_alterado` | título sumiu/não é da loja, `tituloId` não bate, título pago/cancelado/estornado, ou recusado pelo service na hora da gravação |
| 503 | — | falha de infraestrutura (inclui `movimentacao_financeira_falhou`) |

Todo 4xx/5xx acima é **zero writes**: a recusa é lançada e a transação inteira volta atrás.

`detalhes[]` acompanha os 409 com `{ localKey, motivo, saldoReal?, saldoEsperado? }` —
é o que a UI do G3 precisa para marcar as linhas que mudaram.

> **Divergência consciente da rota singular:** título não encontrado devolve **409
> `titulo_alterado`**, não 404. O GOAL define "confirmar que pertencem à loja atual" como
> item da revalidação, cujo resultado é 409; e para a UI de lote "sumiu" e "mudou" pedem a
> mesma ação (recarregar a lista). A rota singular do G1 continua devolvendo 404 —
> nenhum comportamento existente mudou.

---

## 3. Estratégia de advisory lock

**O problema (P2-B do G1).** `findFirst(payload.localId)` dentro da transação cobre retry
sequencial, mas **não** dois POSTs simultâneos: ambos leem "não existe" e ambos gravam.
Não há índice único sobre `payload.localId` e o GOAL veda schema novo.

**A primitiva.** `pg_advisory_xact_lock(hashtext(<chave>))::text AS lock` via `$queryRaw`,
**dentro da mesma `$transaction`** — a mesma já comprovada no repositório em
`lib/fiscal/provider/sefaz/wsdl/wsdl-ephemeral-execution-window.ts`. O cast `::text` não é
decorativo: sem ele, `pg_advisory_xact_lock()` devolve `void` e o Prisma estoura **P2010**
(lição paga na trilha Fiscal, GOAL 134/135). Há teste contra Postgres real que prova as
duas coisas — que a expressão nova funciona e que a antiga quebra.

**A chave.** A mesma string do `localId`:

```
pdv-rc-lote:<storeId>:<sessaoId>:<idempotencyKey>
```

Escopada por **loja + sessão + lote**. Colisão de `hashtext` só faz uma transação esperar
a outra; a autoridade continua sendo o `localId` conferido logo depois — o lock não decide
nada, só serializa.

**A ordem importa e está testada.** O lock é a **primeira** instrução da transação, antes
da sessão e antes da checagem de replay. Um teste assere literalmente
`ordem[0] === "lock:pdv-rc-lote:loja-1:sess-1:<key>"`, `ordem[1] === "sessao_for_update"`,
`ordem[2] === "caixa_replay_findFirst"`. Removido o lock do código, **3 testes quebram**
(controle negativo executado, §6).

**Por que a `idempotencyKey` é exigida longa.** Ela é a *única* identidade do lote. Dois
lotes diferentes com a mesma chave na mesma sessão colapsariam num replay — e o segundo
pagamento sumiria. O padrão `[A-Za-z0-9._-]{8,120}` bloqueia chaves triviais e, ao proibir
`:`, impede que uma chave forjada produza um `localId` que se pareça com o de outra
loja/sessão.

---

## 4. Sessão de caixa: relida **e travada** dentro da transação

O GOAL pede mais que reler: *"evite corrida entre fechamento do caixa e gravação do lote"*.
Só reler não resolve — `POST /api/ops/caixa/fechar` faz um `sessaoCaixa.update` em
autocommit, que poderia commitar entre a leitura e a escrita do lote.

A leitura é, então, um `SELECT ... FOR UPDATE` sobre a linha da sessão:

```sql
SELECT "id", "storeId", "status"::text AS status
FROM "sessoes_caixa"
WHERE "id" = $1 AND "storeId" = $2
FOR UPDATE
```

- Se o fechamento chegar **depois**, ele espera o lote terminar.
- Se chegar **antes** e commitar, esta leitura já enxerga `FECHADA` e o lote inteiro é
  recusado com `409 caixa_fechado`, zero writes.

Não há inversão de ordem de lock possível: o lote toma advisory → linha da sessão; o
fechamento toma só a linha. O `::text` no enum segue a mesma lição do P2010.

SQL cru amarra nomes físicos de tabela/coluna, que banco fake nenhum valida — por isso a
consulta é executada contra **PostgreSQL real** num dos testes (§6).

> **Preservado do G1 (P2-E):** `verificarPeriodoFechado` continua **antes** da transação —
> `fechamento-service` ainda não tem porta `db`. Não é regressão; é o mesmo comportamento
> da rota singular.

---

## 5. Financeiro: uma movimentação por título, sem a heurística antiga

Cada item gera **uma** `MovimentacaoFinanceira` com `referenciaId = titulo.id`,
`tipo="entrada"` e `origem="receber"` (quitação) ou `"receber_parcial"` (parcial) — idêntico
ao que a rota singular grava. Nada muda para DRE, `movimentacao-financeira-classify`,
relatórios ou `estornarMovimentacaoPorReferencia` (que agrega todas as entradas da
referência, sem filtrar origem).

**O risco que o GOAL manda evitar.** `createMovimentacaoEntradaFromReceber`, no ramo
parcial, decide idempotência por soma: *"já gravei ≥ este valor para esta referência ⇒ é
retry"*. Num lote isso é falso — duas parciais legítimas de **mesmo valor** no mesmo
título seriam suprimidas, e o dinheiro sumiria do financeiro enquanto o título e o caixa
registram o recebimento.

**A decisão.** Dois opts **aditivos** e opcionais no helper (default = comportamento atual,
byte-idêntico para todos os chamadores existentes):

| Opt | Efeito | Justificativa |
|---|---|---|
| `idempotenciaDoChamador` | pula as duas checagens (estrita e heurística) | no lote, a autoridade é o advisory lock + `localId` da `CaixaOperacao`. Fora dele, quem grava não tem essa garantia e a heurística continua valendo |
| `adiarRecalculoCarteira` | não recalcula a carteira por lançamento | um lote pode ter 25 lançamentos na mesma carteira; `recalcularSaldoCarteira` varre **todas** as movimentações dela. Roda **uma vez por carteira distinta**, no fim, no mesmo `TransactionClient` |

**Metadata por lançamento: não é possível sem schema.** `MovimentacaoFinanceira` não tem
coluna JSON — só `descricao` livre, que é texto de tela. Poluí-la com o id do lote seria
pior que o problema. A rastreabilidade do lote vive então em dois lugares que **já
existem**: `payload.itens` da `CaixaOperacao` (com `tituloId`, `localKey`, valor, saldo
antes/depois e status final) e o `loteId` carimbado no `payload.historico` de cada título.
Decisão registrada aqui a pedido do GOAL.

Teste de regressão: duas parciais de R$ 25 no mesmo título, com chaves de lote distintas,
produzem **2** movimentações e 2 operações de caixa. Reativado o flag para `false`, o teste
quebra (controle negativo, §6).

---

## 6. Provas

### 6.1 Atomicidade

Todo o lote roda numa `prisma.$transaction` (`maxWait: 5 s`, `timeout: 15 s` — os mesmos
do G1): lock → sessão travada → replay → carga e revalidação → `update` de cada título com
histórico → uma `MovimentacaoFinanceira` por título → recálculo das carteiras → **uma**
`CaixaOperacao` consolidada.

**Nenhuma recusa é devolvida de dentro da transação** — todas são `RecebimentoLoteError`
**lançadas**. Isso não é estilo: retornar erro faria o Prisma commitar o que já tivesse
sido escrito. A rota converte a exceção em HTTP do lado de fora.

Nada de `.catch(console.error)` em escrita transacional; nenhum `fetch`, rede externa,
impressão, PDF, sleep ou chamada a outro endpoint dentro da transação.

O banco fake dos testes implementa `$transaction` com snapshot/restore real, **e o cliente
global recusa qualquer acesso enquanto há transação aberta** — um service que ignorasse a
porta `db` estouraria em vez de passar despercebido (o controle negativo do G1 foi
reproduzido aqui).

Cenários provados com falha injetada (todos: 5 títulos seguem em aberto, 0 movimentações,
0 `CaixaOperacao`):

| Falha injetada | Teste |
|---|---|
| gravação do **3º de 5 títulos** | T6 |
| `MovimentacaoFinanceira` do 2º título | T7 |
| `CaixaOperacao` (última escrita, depois de tudo) | T8 |
| título quitado por outra sessão **depois** da revalidação, com 2 títulos já gravados | T5b |
| `saldoEsperado` divergente | T4 |
| `valorReceber` acima do saldo real | T4b |

T5b é o que prova rollback **depois de escritas reais** — as outras recusas acontecem antes
da primeira escrita. O cenário proibido pelo design (*"1 e 2 quitados, 3 falha, 4 e 5
intactos"*) tem teste próprio.

### 6.2 Concorrência e idempotência

| Cenário | Resultado |
|---|---|
| Retry **sequencial** da mesma `idempotencyKey` (T9) | `200 jaRegistrado:true`, 1 `CaixaOperacao`, 3 movimentações, saldos inalterados |
| Replay quando os títulos **já estão pagos** (T9b) | continua `200 ok:true` — não vira erro; itens reconstruídos do estado persistido, idênticos ao lote original |
| Dois POSTs **simultâneos** com a mesma chave (T10) | um `jaRegistrado:false` + um `true`; **1** `CaixaOperacao`; 3 movimentações; **um único** lançamento no `historico` de cada título |
| Chaves diferentes na mesma sessão | dois lotes distintos, nada é engolido |
| Mesma chave em **lojas diferentes** (T12) | dois lotes independentes, dois `localId`, sem cruzamento |

### 6.3 Multi-loja

- Mesmo `localKey` **e** mesma `idempotencyKey` em loja A e loja B: lotes independentes, sem colisão de lock lógico (T12).
- Lotes concorrentes de lojas diferentes: duas chaves de lock distintas, ambos concluem (T12b).
- Título da loja A com header da loja B: `409`, zero escritas, saldo de A intacto (T12c).
- Sessão da loja B com header da loja A: `409 caixa_fechado`, zero escritas.

### 6.4 PostgreSQL real (não-produtivo)

`recebimento-lote-lock.postgres.test.ts` segue a convenção da trilha Fiscal: **pulado**
quando não há URL de teste (CI padrão segue verde e sem banco) e **recusa explicitamente**
o dbname exato `omnigestao_prod`.

Executado em **`omnigestao_prod_candidate`** (Neon, `sa-east-1`) — apenas locks, `SELECT` e
transações que terminam em rollback intencional; **nenhuma escrita**:

```
PDV_LOTE_LOCK_TEST_DATABASE_URL=<direct url da candidate> \
  npx vitest run app/api/pdv/receber-conta-lote/recebimento-lote-lock.postgres.test.ts
→ Test Files 1 passed · Tests 4 passed
```

| Teste | Prova |
|---|---|
| `pg_advisory_xact_lock(hashtext($1))::text AS lock` via `$queryRaw` | roda sem erro de desserialização |
| a mesma chamada **sem** o cast | falha com `P2010` — o cast não é decorativo |
| A segura a chave e fica aberta; B na **mesma** chave espera; B em **outra** chave passa na hora | o lock é transacional, exclusivo e escopado por chave |
| `SELECT ... FROM "sessoes_caixa" ... FOR UPDATE` | o SQL cru compila contra o schema real (nomes físicos + cast do enum) |

Sem a variável de ambiente: `Test Files 1 skipped · Tests 4 skipped`.

### 6.5 Controles negativos (os testes provam alguma coisa?)

Três mutações aplicadas ao código e revertidas em seguida:

| Mutação | Testes que quebraram |
|---|---|
| advisory lock removido | 3 — T10 (concorrência), ordem do lock, T12b |
| `idempotenciaDoChamador: false` (heurística antiga de volta) | 3 — parciais legítimas, chaves diferentes, "heurística não roda no lote" |
| título recusado pelo service vira `continue` em vez de derrubar o lote | 1 — T5b (rollback total) |

---

## 7. Teto e forma da transação

`RECEBIMENTO_LOTE_MAX_ITENS = 25`.

Evidência: a app conecta via pgBouncer em **modo transação** com `connection_limit=1`
(`.env.example:11`); uma transação interativa fixa a conexão enquanto dura. Com 25 itens o
pior caso fica em ~85 queries — 1 leitura em bloco dos títulos, 3 por título (releitura do
service + `update` + `create` da movimentação), 3 por carteira distinta e a operação de
caixa —, folgado dentro do `timeout: 15 s` herdado do G1 e acima de qualquer seleção que a
tela de PDV produza.

Otimizações que mantêm a transação curta sem perder correção:

- os títulos são carregados numa **única** `findMany`, não N `findFirst`;
- a `carteiraId` do payload é validada **uma vez por carteira**, não por título;
- `recalcularSaldoCarteira` roda **uma vez por carteira distinta**, no fim (§5).

---

## 8. Distribuição parcial

O servidor aplica **exatamente** a distribuição recebida, item a item. Não existe
"mais antigos primeiro" no backend — esse cálculo é da UI (G3); aqui ele seria uma segunda
autoridade sobre o dinheiro do cliente.

Por item, dentro da transação:

```
saldoAntes  = saldo canônico (valor − ledger do payload.historico), lido na transação
saldoDepois = saldo canônico do registro ATUALIZADO   ← lido, não subtraído
statusFinal = "pago" se saldoDepois <= PAY_EPS, senão "parcial"
```

`valorReceber` e `saldoEsperado` são normalizados em centavos (`safeMoney`) na entrada.
Isso torna o corte "quita o título" **exato**: quando `valorReceber + PAY_EPS >= saldoReal`,
os dois valores já são o mesmo número em centavos. Nunca o valor **bruto** da coluna.

E o `totalRecebido` da `CaixaOperacao` **não** é somado a partir do que o cliente pediu:
ele é somado depois da escrita, a partir do que foi de fato aplicado em cada título. A
igualdade "valor do caixa = soma dos lançamentos" vira **estrutural** em vez de depender de
um argumento sobre arredondamento.

Exemplo do GOAL, coberto por teste (T3): título A saldo 100 → 100 ⇒ **PAGO**; título B
saldo 200 → 50 ⇒ **PARCIAL** com `saldoDepois: 150`. Total no caixa: 150.

Histórico apendado por título: `tipo`, `valor`, `formaPagamento`, `observacao`,
`userLabel` e **`loteId`** (a `idempotencyKey`, já saneada pelo padrão do contrato). O
`payload` legado **não** é reescrito — só o `historico` recebe uma entrada, via
`appendFinanceiroHistorico`.

---

## 9. Caixa

**Uma única** `CaixaOperacao` por lote:

```jsonc
{
  "tipo": "recebimento_cr",
  "valor": 150.00,                  // soma recalculada no servidor
  "motivo": "Recebimento CR — 2 títulos (dinheiro)",
  "payload": {
    "localId": "pdv-rc-lote:loja-1:sess-1:b1f0c9e2-...",
    "origem": "pdv_lote",
    "formaPagamento": "dinheiro",
    "idempotencyKey": "b1f0c9e2-...",
    "itens": [
      { "tituloId": "...", "localKey": "A", "valor": 100, "saldoAntes": 100, "saldoDepois": 0,   "statusFinal": "pago" },
      { "tituloId": "...", "localKey": "B", "valor": 50,  "saldoAntes": 200, "saldoDepois": 150, "statusFinal": "parcial" }
    ]
  }
}
```

Compatível com o fechamento sem nenhuma mudança: `aggregateCaixaOperacoes`
(`lib/caixa-fechamento-resumo.ts`) soma por `tipo === "recebimento_cr"` e lê
`payload.formaPagamento` para a gaveta de dinheiro — ambos preservados. `payload.itens`
guarda a rastreabilidade completa exigida para estorno futuro.

`payload.itens` também é o que torna o **replay fiel**: o retry reconstrói `saldoAntes`,
`saldoDepois` e `statusFinal` a partir do estado persistido, em vez de devolver um
resultado empobrecido.

---

## 10. Testes e gates

| Escopo | Resultado |
|---|---|
| `recebimento-lote.test.ts` (novo) | **43 testes** — contrato, revalidação, atomicidade, idempotência, concorrência, multi-loja, carteira, superfície de persistência |
| `recebimento-lote-lock.postgres.test.ts` (novo, opt-in) | **4 testes** contra Postgres real; pulados sem a env |
| Regressão do singular G1 (18 testes) + canonicalidade + movimentações + caixa/fechamento | **219 passando**, 4 pulados (os do Postgres) em 15 arquivos |
| Suíte completa | 7103 passando · 5 falhas pré-existentes (§10.1) |
| `npm run typecheck` | ✅ exit 0 |
| `git diff --check` | ✅ limpo |
| `npx eslint` (arquivos tocados) | ✅ 0 erros, 0 warnings |
| `npm run build` | ✅ exit 0 · `✓ Compiled successfully in 3.9min` · a rota aparece no manifesto como `ƒ /api/pdv/receber-conta-lote` |
| `git diff origin/main -- prisma/schema.prisma` | ✅ **vazio** |

Comando da regressão focada:

```bash
npx vitest run app/api/pdv/receber-conta app/api/pdv/receber-conta-lote app/api/financeiro/receber app/api/ops/contas-receber-list lib/financeiro lib/caixa lib/contas-receber-aberto.test.ts lib/caixa-fechamento-resumo.test.ts components/operacoes-v4-preview/recebimento-transversal.test.ts
```

### 10.1 Suíte completa

`npx vitest run` (493 arquivos): **7103 passando**, 198 pulados, 2 *expected fail* e
**5 falhas — todas pré-existentes e ambientais**, nenhuma importando qualquer módulo
alterado aqui:

| Falha | Causa | Confirmação |
|---|---|---|
| 3× `lib/fiscal/xml/nfce-xml-builder.test.ts` | `xmllint` ausente do PATH (o teste falha-fechado de propósito) | já registrado no baseline do G1 |
| `lib/ops-inventory-sync-safety.test.ts` | timeout de 5 s num scan de arquivos sob carga paralela | **passa isolado** (verificado) |
| `lib/whatsapp-legacy-quarantine.test.ts` | idem | **passa isolado** (verificado) |
| `tools/fiscal-dry-run-integrity-proof/proof.test.ts` (suíte) | Java local é 8; o verificador foi compilado para 17 (`class file version 61.0`) | trilha Fiscal, ambiente |
| `scripts/contador/setup-storage.test.ts` (suíte) | `SyntaxError` pré-existente no arquivo | trilha Contador, arquivo não tocado |

Os dois primeiros scans passam quando executados sozinhos — mesma classe de falha já
documentada no baseline do G1.

---

## 11. Pendências (P0/P1/P2)

**P0: nenhum. P1: nenhum.**

### P2-1 — o endpoint ainda não tem chamador
Fundação dormente até o G3, por decisão do GOAL. Consequência honesta: o caminho é provado
por testes (inclusive contra Postgres real para o lock), mas **não** por tráfego de
produção.

### P2-2 — `verificarPeriodoFechado` continua fora da transação
Herdado do G1 (P2-E). Um fechamento de período criado entre a checagem e o commit do lote
não seria visto. Risco baixo (fechar período é ação humana deliberada e rara) e
comportamento **idêntico** ao da rota singular. Fechar exige porta `db` em
`fechamento-service` — fora do escopo deste GOAL.

### P2-3 — a Conferência de Caixa conta 1 recebimento por lote, não 1 por título
`app/api/ops/caixa/sessao-detalhe/route.ts:146` e `aggregateCaixaOperacoes` derivam
`qtdRecebimentosContas` da **contagem de `CaixaOperacao`**. Um lote de 5 títulos aparece
como **um** recebimento — o que é a semântica correta da operação consolidada (um pagamento
do cliente) e o que o GOAL exige, mas muda o número exibido em relação a 5 baixas
singulares. O **valor** total está certo. Se a tela do G3 quiser o número de títulos, ele
está em `payload.itens.length`.

### P2-4 — a heurística de soma do helper de parcial continua ativa fora do lote
`createMovimentacaoEntradaFromReceber` mantém, para quem não passa `idempotenciaDoChamador`,
a regra "já gravei ≥ este valor ⇒ retry" (P2-C do G1). Duas parciais legítimas de mesmo
valor pela **rota singular** continuam podendo suprimir a segunda movimentação. Não
corrigido aqui de propósito: mudar o default alteraria o comportamento de rotas de produção
fora do escopo deste GOAL.

### P2-5 — busca de replay sem índice sobre `payload.localId`
A checagem de replay filtra por `(storeId, sessaoId, tipo)` — que usa o índice
`@@index([sessaoId])` — e só então compara `payload.localId`. Não existe índice GIN sobre o
JSONB (criá-lo seria schema change, vedado). Escopar por `sessaoId` mantém a varredura no
tamanho de uma sessão de caixa, mas a busca segue sendo um filtro em memória sobre esse
recorte. A rota singular do G1 tem a mesma consulta **sem** o recorte de sessão.

### P2-6 — herdadas do G1, não reabertas
P2-A (status pelo caminho de merge), P2-D (matching fuzzy do cliente — G3), P2-F (o painel
Financeiro descarta a listagem canônica com `local wins`), P2-G (`liquidarContaPagar` com o
mesmo defeito do outro lado), P2-I e P2-J. Nenhuma foi tocada por este GOAL.

---

## 12. Critérios de aceite

```
BATCH_ENDPOINT_CREATED=true
BATCH_ATOMIC=true
BATCH_CONCURRENT_IDEMPOTENCY=true
BATCH_REPLAY_SAFE=true
SERVER_SIDE_BALANCE_REVALIDATION=true
SESSION_REVALIDATED_IN_TX=true
ONE_FINANCIAL_MOVEMENT_PER_TITLE=true
ONE_CAIXA_OPERATION_PER_BATCH=true
PARTIAL_DISTRIBUTION_SUPPORTED=true
STORE_ISOLATION=true
SINGULAR_RECEIPT_REGRESSION_FREE=true
SCHEMA_CHANGED=false
G3_UI_IMPLEMENTED=false
```

Não implementado, conforme o ponto de parada: checkboxes, "Selecionar todos", modal do
Claude Design, abas Em aberto/Recebidos, recibo consolidado, distribuição automática
visual, P2-F do painel Financeiro, migration/schema, qualquer mudança em Fiscal ou
auth/proxy.
