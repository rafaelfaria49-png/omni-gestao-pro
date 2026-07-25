/**
 * GOAL: PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001
 *
 * Campos de sincronização que existem SOMENTE no cliente (estado do
 * `operations-store` / localStorage do PDV) e NUNCA podem viver em `Venda.payload`.
 *
 * O PDV envia o `SaleRecord` inteiro para `/api/ops/venda-persist` (incluindo
 * `syncPending: true`, que é justamente o marcador de "ainda não confirmada"), e o
 * servidor gravava o objeto como veio. Resultado: uma venda JÁ confirmada no banco
 * voltava de `/api/ops/vendas-list` carregando `syncPending: true` e era reclassificada
 * como pendente por qualquer navegador que ainda não a tivesse localmente — pendência
 * fantasma (auditoria PDV-PENDENCIAS-FANTASMAS-SERVER-PAYLOAD-AUDIT-001: 520 payloads
 * contaminados, 20 na loja-1 e 500 na loja-2).
 *
 * Usado nos três pontos da fronteira cliente↔servidor:
 *  - escrita  (`lib/ops-upsert-venda.ts`)      — não persistir;
 *  - leitura  (`lib/vendas/sale-from-db-row.ts`) — ignorar o que já está gravado;
 *  - merge    (`lib/operations-sales-merge.ts`)  — não reinjetar no estado local.
 *
 * Blacklist (nunca whitelist): campos legítimos de venda ainda não tipados continuam
 * passando. Função PURA, sem React/Prisma — testável isoladamente.
 */

/** Marcadores locais de sincronização. Fonte única para código, testes e documentação. */
export const SALE_CLIENT_ONLY_SYNC_FIELDS = ["syncPending", "syncBlockedCode"] as const

/** Cópia rasa de `sale` sem os marcadores locais. Não muta o objeto recebido. */
export function stripClientSyncFlags<T extends object>(sale: T): T {
  const copia = { ...sale } as Record<string, unknown>
  for (const campo of SALE_CLIENT_ONLY_SYNC_FIELDS) {
    delete copia[campo]
  }
  return copia as T
}
