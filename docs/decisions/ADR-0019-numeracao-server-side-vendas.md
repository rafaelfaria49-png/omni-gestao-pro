---
title: ADR-0019 · Numeração server-side de vendas por loja e ano
status: aceita
data: 2026-07-30
autor: Codex
revisores: [Rafael Faria]
hub: pdv
tags: [vendas, numeracao, multi-loja, prisma, concorrencia]
---

# ADR-0019 · Numeração server-side de vendas por loja e ano

> **Status:** aceita
> **Decisão:** a futura API de venda reservará `VDA-{CODIGO_LOJA}-{ANO}-{NNNNNN}`
> num contador transacional por `(storeId, ano)`, sem `count`, `MAX()+1` ou relógio do cliente.

## Contexto

`Venda.id` já é a chave técnica; `Venda.pedidoId` é a chave comercial globalmente
única e também aparece em payloads e satélites legados. O PDV v1 gera
`VDA-AAAA-NNNN` no navegador a partir do maior número no cache local, permitindo
colisões entre lojas, terminais e abas. A auditoria 002A definiu uma transição
aditiva, sem alterar o writer v1 nesta fase.

## Decisão

- `Store.codigoNumeracaoVenda` é nullable, único, explícito e nunca inferido.
- `SerieVenda` guarda `proximoNumero` por loja/ano; `(storeId, ano)` é unique.
- A primeira série anual é criada sob advisory lock transacional por loja/ano.
- A reserva usa um único `UPDATE` com incremento, condicionado à loja, ano, estado e faixa.
- A venda futura persistirá série, ano e componente numérico; unique
  `(serieVendaId, numeroSequencial)` e FK composta `(serieVendaId, storeId)` protegem a chave.
- Todos os novos campos em `Venda` são nullable. Não há backfill, renumeração nem coluna
  obrigatória no histórico.
- O ano é o ano civil de aceitação no servidor em `America/Sao_Paulo`; o teto é 999.999.
- O futuro writer chamará `allocateSaleNumber(tx, ...)` dentro da mesma transação que
  cria a venda e seus efeitos. Rollback reverte o contador.
- Retry genérico só vale para a transação inteira em `P2034`, com limite. `P2002`
  exige classificação e nunca autoriza pular número ou fazer update fallback.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| `count + 1`, `MAX + 1` ou último registro | Janela de concorrência e reutilização |
| sequência global sem código de loja | Não expressa a série comercial multi-loja |
| contador por terminal | Fragmenta a série e não resolve abas/navegadores |
| gerar no cliente e validar depois | Mantém o cliente como autoridade |

## Consequências e limites

- A infraestrutura permanece dormente: nenhum writer, rota, PDV, importador ou O.S. a chama.
- `pedidoId` histórico continua intacto e globalmente unique.
- Nenhuma loja recebe código automaticamente.
- A convergência da primeira série pressupõe `READ COMMITTED`, validado fisicamente em
  PostgreSQL 17.10. No probe concorrente com snapshot forte, `RepeatableRead` propagou
  `P2002` e `Serializable` propagou `P2034`; nenhum deles é convertido em sucesso.
  O futuro writer poderá repetir com limite somente a transação inteira em `P2034`.
  `P2002` continua sujeito a classificação e nunca recebe retry global.
- Os CHECKs da migration não são representáveis no schema Prisma; `db push` não os cria.

## Referências

- `docs/audits/PDV_PEDIDO_ID_NUMERACAO_SERVER_SAFE_AUDIT_002A.md`
- `prisma/migrations/0016_add_sale_numbering_infrastructure/migration.sql`
- `lib/vendas/server-sale-numbering.ts`
