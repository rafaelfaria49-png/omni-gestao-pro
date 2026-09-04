/**
 * Saldo em aberto CANÔNICO de um título de Contas a Receber, do lado do consumidor.
 *
 * Contrato (GOAL PDV-RECEBIMENTO-CANONICALIDADE-HARDENING-002 · §2 do design aprovado):
 *  - "em aberto" é **saldo > PAY_EPS**, nunca status textual;
 *  - o saldo canônico vem do servidor em `row.saldoAberto` (`/api/ops/contas-receber-list`),
 *    calculado como `valor − ledger efetivo` sobre a coluna + `payload.historico`;
 *  - `row.valor` é o valor BRUTO e NÃO diminui em baixas parciais — usá-lo como saldo
 *    fazia título quitado aparecer como dívida aberta na tela do PDV.
 *
 * Módulo puro (sem Prisma, sem React): serve à API e ao componente do PDV, e é testável
 * no harness `node` do Vitest.
 */
import { PAY_EPS } from "@/lib/financeiro/contracts/valores"
import type { ContaReceberRow } from "@/lib/contas-receber-types"

export { PAY_EPS }

/**
 * Normaliza o saldo em centavos. O corte pelo epsilon vem ANTES do arredondamento:
 * arredondar primeiro transformaria um resíduo de 0,009 em R$ 0,01 e o título voltaria
 * a contar como dívida aberta — exatamente o que o epsilon existe para evitar.
 */
function money(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n) || n <= PAY_EPS) return 0
  return Math.round(n * 100) / 100
}

/**
 * Saldo em aberto da linha. Ordem de autoridade:
 *  1. `row.saldoAberto` — canônico do servidor;
 *  2. `fallbackPorId` — mapa `id/localKey → saldoAberto` da mesma resposta (`audit`);
 *  3. `row.valor` — ÚLTIMO recurso, apenas para linhas que nunca passaram pelo servidor.
 */
export function saldoAbertoDaRow(
  row: Pick<ContaReceberRow, "id" | "valor"> & { saldoAberto?: number },
  fallbackPorId?: Record<string, number>,
): number {
  if (typeof row.saldoAberto === "number" && Number.isFinite(row.saldoAberto)) return money(row.saldoAberto)
  const alt = fallbackPorId?.[String(row.id)]
  if (typeof alt === "number" && Number.isFinite(alt)) return money(alt)
  return money(row.valor)
}

/** Um título só é operacionalmente cobrável quando ainda há saldo acima do epsilon. */
export function isTituloEmAberto(
  row: Pick<ContaReceberRow, "id" | "valor"> & { saldoAberto?: number },
  fallbackPorId?: Record<string, number>,
): boolean {
  return saldoAbertoDaRow(row, fallbackPorId) > PAY_EPS
}

/** Soma dos saldos em aberto — o "Saldo total" honesto do cabeçalho. */
export function somaSaldoEmAberto(
  rows: Array<Pick<ContaReceberRow, "id" | "valor"> & { saldoAberto?: number }>,
  fallbackPorId?: Record<string, number>,
): number {
  let t = 0
  for (const r of rows) t += saldoAbertoDaRow(r, fallbackPorId)
  return Math.round(t * 100) / 100
}
