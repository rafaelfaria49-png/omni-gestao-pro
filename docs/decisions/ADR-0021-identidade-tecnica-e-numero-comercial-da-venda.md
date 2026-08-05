---
title: ADR-0021 · Identidade técnica (`clientSaleId`) e número comercial (`pedidoId`) da venda
status: aceita
data: 2026-08-04
autor: Claude Opus 5 (GOAL PDV-NUMERACAO-SERVER-WRITER-002C-0-CONTRACTS-008)
revisores: [Rafael Faria]
hub: pdv
tags: [vendas, numeracao, idempotencia, multi-loja, gate-runtime, deploy]
superado_por:
substitui:
---

# ADR-0021 · Identidade técnica e número comercial da venda

> **Status:** aceita
> **Decisão em uma frase:** a venda passa a ter **duas identidades separadas** — `clientSaleId`,
> técnica, criada no cliente e usada para reconciliação e idempotência; e `pedidoId`,
> comercial, alocado **exclusivamente pelo servidor** no fluxo v2 e usado em recibo, exibição
> e integrações.

---

## 1. Contexto

A [ADR-0019](./ADR-0019-numeracao-server-side-vendas.md) decidiu **como** o servidor aloca o
número (`VDA-{CODIGO}-{ANO}-{NNNNNN}`, contador transacional por `(storeId, ano)`) e a
migration `0016_add_sale_numbering_infrastructure` criou a infraestrutura **dormente**. Ela
**não** decidiu qual chave reconcilia cliente e servidor — e é exatamente isso que a
auditoria de readiness
[`PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md`](../audits/PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md)
classificou como **Classe B**, com três P0 confirmados:

1. **`Store.codigoNumeracaoVenda` não tem provisionamento versionado** (§9.1 da readiness):
   nenhuma UI, API, action, seed ou script atribui o código. O writer server-side falharia
   em 100% das vendas de 100% das lojas se fosse ligado hoje.
2. **`mergeSalesById` reconcilia local↔remoto por `pedidoId`** (§6.6, §9.10): se o servidor
   devolvesse um número diferente do gerado no navegador, a venda local nunca encontraria a
   contraparte remota — pendência fantasma permanente, com reenvio indefinido.
3. **O reenvio não tem identidade estável separada do número comercial** (§5.4, §7.5): a
   chave de idempotência de hoje **é** o `pedidoId`. Um reenvio após commit perdido na rede
   alocaria um segundo número e criaria uma segunda venda.

**Restrições que a decisão precisa respeitar:**

- vender é caminho de receita: nenhum gate pode impedir uma venda do fluxo atual;
- os dois projetos Vercel constroem **o mesmo commit da mesma branch `main`**, contra bancos
  **diferentes** (readiness §8.1);
- `pedidoId` é a chave de junção universal entre cliente, servidor e satélites — estoque,
  financeiro, título, crédito, devolução, fiscal, caixa, contador, recibo (readiness §6.2);
- vendas históricas não podem exigir backfill: todas as colunas da `0016` são nullable.

**Estado atual relevante:**

- `docs/ai/CURRENT_STATUS.md` em 04/08/2026: readiness do 002C publicada, Classe B, gates
  G1–G4, fatiamento 002C-0..002C-3 recomendado;
- infraestrutura 002B **dormente**: `lib/vendas/server-sale-numbering.ts` existe e não tem
  nenhum call site produtivo.

---

## 2. Decisão

**Separar identidade técnica de número comercial, e alocar o número apenas no servidor.**

### 2.1 `clientSaleId` — identidade técnica

- **criado no cliente**, como token opaco (UUID/ULID), sem semântica de contador;
- **obrigatório** para toda venda nova do fluxo v2;
- **estável** durante retries e reenvios: o mesmo carrinho finalizado uma vez mantém o mesmo
  `clientSaleId` em todas as tentativas de POST, inclusive após reinício do navegador;
- **único por `storeId`** — a unique é composta `(storeId, clientSaleId)`. Lojas diferentes
  podem legitimamente usar o mesmo valor;
- **nunca exibido** como número comercial: não vai a recibo, tela, relatório, CSV do contador
  ou integração;
- **nunca gerado no servidor.** Se o cliente não mandar, o servidor recusa — não inventa.
  Gerar no servidor destruiria a estabilidade entre tentativas, que é a razão do campo;
- **nunca derivado de `pedidoId`.** Não há fallback, nem silencioso nem explícito. Um valor
  com forma de número comercial (`VDA-…`, `VND-…`) é **rejeitado** como `clientSaleId`.

Faixa física: `vendas."clientSaleId" VARCHAR(128)`, NULLABLE. Contrato do repositório:
8 a 128 caracteres em `[A-Za-z0-9_-]`, começando por alfanumérico, comparação
**case-sensitive** (como a unique do PostgreSQL).

### 2.2 `pedidoId` — número comercial

- **alocado pelo servidor** via `allocateSaleNumber` (ADR-0019), **dentro da transação** que
  cria a venda e todos os seus efeitos — rollback reverte o contador;
- **nunca aceito do cliente no fluxo v2**, mesmo quando bem-formado;
- é o valor que vai a recibo, exibição, satélites e integrações comerciais;
- **pode ter lacunas.** As garantias reais do allocator são: **atômico, único por série e sem
  reuso**. Não é gapless — `DELETE` de venda, falha do chamador após o commit e cancelamento
  (que nunca decrementa) produzem buracos legítimos (readiness §4.7);
- **número provisório nunca é persistido como `pedidoId` definitivo.** O formato
  `VDA-{ANO}-{NNNN}` gerado pelo navegador é reconhecível e recusado no fluxo v2.

### 2.3 Replay

- a chave de replay é **`(storeId, clientSaleId)`** — nunca `pedidoId`;
- mesma chave ⇒ **retorna a venda existente**, com o `pedidoId` já alocado;
- replay **não aloca número novo** e **não duplica** estoque, caixa, financeiro, crédito,
  título ou eventos;
- qualquer divergência é **conflito fail-closed**, nunca replay: venda de outra loja,
  `clientSaleId` diferente, venda existente sem `clientSaleId` (histórico/v1) e venda sem
  `pedidoId` (invariante quebrada);
- a unique `vendas_storeId_clientSaleId_key` é a rede de segurança física: perder a corrida
  nela significa **replay**, e o vencedor é relido **fora** da transação abortada — extensão
  do mecanismo que já existe para `pedidoId` (readiness §7.4), não substituição.

### 2.4 Compatibilidade

- o **fluxo v1 permanece intacto** enquanto o gate v2 estiver desligado: mesmo writer, mesmo
  número do cliente, mesmos guards;
- **vendas antigas sem `clientSaleId` continuam legíveis** — a coluna é nullable, sem
  default e sem backfill; `NULL` nunca casa como replay;
- **importações com número externo permanecem fora do writer v2**: o número já existe no
  documento de origem (`VendaNumeracaoOrigem.IMPORTED`);
- o faturamento de O.S. (`count()+1`, prefixo `VND-`) **não** é corrigido por esta decisão —
  segue como pendência própria (readiness §6.3, R-09).

### 2.5 Gate de runtime

Um gate server-only decide entre writer v1 e v2, com **polaridade inversa** à do guard de
migrations: lá fail-closed protege o banco; aqui fail-closed **impediria vender**. Toda
ausência, divergência ou ambiente desconhecido devolve **v1**.

Condições cumulativas para v2, todas de comparação **exata** (sem `trim`, sem case-fold):

1. `VERCEL_ENV === "production"`;
2. `VERCEL_PROJECT_ID` igual ao projeto canônico;
3. `SALE_SERVER_NUMBERING_ENABLED === "true"`.

O projeto **legado nunca ativa v2**, mesmo com a flag configurada por engano: falha na
condição 2, avaliada **antes** da flag. O ID canônico é **reexportado** de
`scripts/migration-authority-guard.mjs` por `lib/deploy/canonical-deployment.ts` — fonte
única, sem cópia e **sem alterar o guard**. A decisão é `{ writer, reason }` com `reason`
sempre literal fixo: nenhum valor lido do ambiente atravessa para log ou resposta.

### 2.6 O que esta decisão NÃO inclui (escopo fechado)

- não integra o writer real: `lib/ops-upsert-venda.ts`, `venda-persist` e
  `sync-legacy-vendas` seguem intocados;
- não altera PDVs, `operations-store.tsx`, `operations-sales-merge.ts` nem recibos;
- não provisiona `Store.codigoNumeracaoVenda` em loja alguma (**gate G1**, GOAL próprio);
- não configura a flag em ambiente algum;
- não decide o que gravar em `payload.id` quando local e servidor divergirem (readiness §9.8);
- não altera schema, migration, banco, Vercel ou o guard de migrations.

---

## 3. Alternativas consideradas

| Alternativa | Prós | Contras | Por que não escolhida |
|---|---|---|---|
| A) `pedidoId` continua do cliente; número server-side vira campo paralelo de exibição | zero mudança em cliente, merge, recibo e satélites | **não resolve** a colisão entre lojas — o contador do navegador continua sendo a chave; cria dois números por venda | Honestamente mais barata e honestamente não entrega o objetivo do 002B/ADR-0019 |
| B) Servidor gera o `clientSaleId` quando ausente | contrato de entrada mais tolerante | destrói a estabilidade entre tentativas: cada reenvio geraria uma identidade nova e **duplicaria** a venda | Anula a única proteção contra duplicação pós-commit |
| C) Usar `pedidoId` como `clientSaleId` quando o cliente não mandar | migração incremental sem tocar o PDV | reintroduz o defeito por outro caminho: o número do navegador volta a ser a chave de idempotência | É o fallback silencioso que esta ADR proíbe explicitamente |
| D) Gate fail-closed (sem flag ⇒ recusa vender) | simetria com o guard de migrations | uma variável ausente pararia o balcão | Polaridade errada para caminho de receita |
| E) `clientSaleId` como identidade + `pedidoId` server-side + gate fail-open **(escolhida)** | elimina colisão entre lojas/terminais/abas; idempotência real de reenvio; rollback barato | superfície de mudança no cliente é grande e precisa ser fatiada (002C-1..002C-3) | — |

---

## 4. Consequências

### 4.1 Positivas

- a colisão entre lojas deixa de existir **por construção**: o código da loja entra no número;
- reenvio ganha idempotência real, ancorada numa unique física, não em convenção;
- o rollback mais barato passa a ser remover uma variável de ambiente — sem revert de código,
  sem rollback de migration;
- os contratos são puros e testáveis sem banco, o que permite decidir antes de integrar.

### 4.2 Negativas / Custos

- o cliente passa a ter **duas** noções de identidade durante a transição, e a migração de
  `mergeSalesById`, do recibo e das referências locais (devolução, vale) é obrigatória;
- o recibo entregue no balcão precisa aguardar a resposta do servidor **ou** ser reimpresso:
  hoje ele é gerado antes do POST, que é fire-and-forget (readiness §9.5);
- passam a conviver três formatos de número em telas e relatórios;
- o lock de linha da série é mantido por toda a transação da venda: vendas concorrentes da
  mesma loja serializam pela duração inteira, com `connection_limit=1` (readiness §7.2).

### 4.3 Riscos introduzidos

- **Pendência fantasma** se o cliente for migrado sem reconciliar `id` local com o `pedidoId`
  retornado · mitigação: 002C-2 é pré-requisito de 002C-3; o gate só é ligado no fim.
- **Bancos divergentes**: canônico e legado teriam séries independentes e poderiam emitir o
  mesmo número · mitigação: o gate exige o projeto canônico, avaliado antes da flag.
- **Duplicação do ID canônico de projeto** · mitigação: reexportação a partir do guard, com
  teste estático que proíbe o literal `prj_` nos módulos novos.
- **Falso senso de sequência sem buracos** · mitigação: a ADR declara explicitamente que a
  numeração **não** é gapless.

### 4.4 O que muda imediatamente

- Arquivos criados: `lib/vendas/sale-identity-contracts.ts`,
  `lib/vendas/store-sale-numbering-code.ts`, `lib/vendas/sale-numbering-runtime-gate.ts`,
  `lib/deploy/canonical-deployment.ts` e seus testes.
- **Nenhum comportamento muda:** os contratos não têm call site produtivo, e um teste
  estático prova isso arquivo a arquivo.
- Docs atualizados: `docs/decisions/INDEX.md`, `docs/ai/CURRENT_STATUS.md`.
- Decisões afetadas: complementa a [ADR-0019](./ADR-0019-numeracao-server-side-vendas.md);
  herda de [ADR-0003](./ADR-0003-eliminar-fallback-legacy-primary-store-id.md) a proibição de
  fallback para `loja-1`.

### 4.5 O que muda no longo prazo

`pedidoId` deixa de ser chave de idempotência e passa a ser apenas número comercial. Toda
lógica futura de reconciliação, retry e deduplicação de venda deve usar
`(storeId, clientSaleId)`.

---

## 5. Plano de implementação

**Esta ADR fixa o contrato; a integração vai para os GOALs seguintes**, no fatiamento da
readiness §10.10:

| GOAL | Conteúdo | Gate |
|---|---|---|
| **002C-0** (este) | contratos puros + gate de runtime, sem call site | — |
| **002C-0b** | provisionamento versionado de `Store.codigoNumeracaoVenda` | **G1** |
| **002C-1** | writer server-side atrás do gate; servidor aceita `clientSaleId` opcional, ausente ⇒ v1 | G2 |
| **002C-2** | cliente migrado para `clientSaleId` + reconciliação de `id` + recibo | G3 |
| **002C-3** | neutralização de `nextSaleId` e ativação da flag em Production | G4 |

- Owner humano: Rafael Faria.
- Pré-requisitos de ativação: G1 cumprido, `npm run test:vendas-numeracao:integration`
  executado contra PostgreSQL real com resultado publicado.
- Critério de pronto: smoke da readiness §10.7 verde no canônico **e** venda normal no
  legado pelo writer v1.

⚠️ **Edição obrigatória em 002C-1:** `lib/vendas/server-sale-numbering.contract.test.ts`
assere hoje que o allocator **não** tem call site nas rotas/writer. Criar o call site fará
esse teste falhar **por design**; ele deve ser reescrito para exigir o ponto único e proibir
todos os demais — não removido (readiness §4.8, R-08).

---

## 6. Validação / como saberemos que deu certo

- **Contratos (agora):** 63 testes novos (mais os 34 do 002B, sem regressão) cobrindo
  `clientSaleId`, `pedidoId`, create/replay/conflito, `codigoNumeracaoVenda` e a matriz
  completa do gate; teste estático provando zero call site produtivo.
- **Writer (002C-1+):** mesmo `clientSaleId` reenviado N vezes ⇒ 1 venda, 1 número, 1
  movimentação de estoque, 1 movimentação financeira, 1 título por parcela.
- **Produção (002C-3):** zero venda duplicada e zero pendência fantasma nova na janela de
  observação; `omni-gestao-pi.vercel.app` continua gravando venda pelo writer v1.
- Janela de observação: 14 dias após a ativação da flag.

---

## 7. Referências

- ADRs relacionados: [ADR-0019](./ADR-0019-numeracao-server-side-vendas.md) (numeração
  server-side por loja/ano) · [ADR-0003](./ADR-0003-eliminar-fallback-legacy-primary-store-id.md)
  (proibição de fallback `loja-1`).
- Auditorias: [`PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md`](../audits/PDV_NUMERACAO_SERVER_WRITER_002C_READINESS_001.md) ·
  [`PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md`](../audits/PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md) ·
  [`PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md`](../audits/PDV_NUMERACAO_002B_PRODUCTION_MIGRATION_STATE_AUDIT_001.md) ·
  [`DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md`](../audits/DEPLOY_PRODUCTION_MIGRATION_AUTHORITY_ACTIVATION_006.md).
- Código: `lib/vendas/sale-identity-contracts.ts` · `lib/vendas/store-sale-numbering-code.ts` ·
  `lib/vendas/sale-numbering-runtime-gate.ts` · `lib/deploy/canonical-deployment.ts` ·
  `lib/vendas/server-sale-numbering.ts` ·
  `prisma/migrations/0016_add_sale_numbering_infrastructure/migration.sql`.

---

## 8. Notas / discussão

**Por que o servidor não gera `clientSaleId`.** É a pergunta mais natural e a resposta é
categórica: o valor do campo é ser **o mesmo** em todas as tentativas de uma finalização. Um
valor gerado no servidor seria novo a cada POST, e o reenvio de uma venda cujo commit se
perdeu na rede criaria uma segunda venda — exatamente o defeito que o campo existe para
impedir. Por isso a criação é do cliente e a ausência é erro, não oportunidade de fallback.

**Por que a polaridade do gate é oposta à do guard de migrations.** O guard protege o banco
de uma escrita indevida: na dúvida, não escreve. O writer protege o balcão: na dúvida,
**vende do jeito conhecido**. Aplicar fail-closed aqui transformaria um erro de configuração
num balcão parado.

**Sobre compartilhar o ID canônico.** A alternativa auditada era duplicar o literal no
código de aplicação. Foi rejeitada: duas cópias divergem em silêncio. A reexportação a partir
de `scripts/migration-authority-guard.mjs` não exigiu **nenhuma** alteração no guard — a
dependência é unidirecional (app → guard) e o guard segue sendo a autoridade fail-closed
exclusiva de `prisma migrate deploy`, sem conhecer o writer.

**Sobre "gapless".** A readiness recusou declarar a numeração sem lacunas, e esta ADR mantém
a recusa. O que está provado é atomicidade, unicidade por série e ausência de reuso. Prometer
sequência sem buracos criaria uma expectativa contábil que o sistema não sustenta.
