/**
 * Operações V4 — projeção pura do consumo de estoque da OS.
 *
 * Reusa a fonte única de peças do adapter oficial (`selectEstoquePecaSource`)
 * para a Execução mostrar o que será baixado, sem SQL e sem segundo motor.
 * A baixa real continua em `consumeEstoqueFromOS`.
 */
import type { OrdemServico, PecaUsada } from "@/types/os";
import { selectEstoquePecaSource } from "@/lib/operacoes/services/orcamento-builder";

export interface PecaConsumoV4 {
  id: string;
  nome: string;
  quantidade: number;
  /** Tem `produtoId` ou SKU — o adapter ainda confirma o match no servidor. */
  vinculada: boolean;
  origem: "payload.pecas" | "payload.orcamento.pecas";
}

export interface ConsumoEstoqueViewV4 {
  pecas: PecaConsumoV4[];
  vinculadaCount: number;
  semVinculoCount: number;
  jaConsumido: boolean;
  /** Há peça com vínculo e a OS ainda não baixou. */
  podeBaixar: boolean;
}

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function qty(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pecasArray(v: unknown): PecaUsada[] {
  return Array.isArray(v) ? (v as PecaUsada[]) : [];
}

function pecaVinculada(p: PecaUsada): boolean {
  return !!txt((p as { produtoId?: unknown }).produtoId) || !!txt((p as { sku?: unknown }).sku);
}

export function projetarConsumoEstoqueV4(os: OrdemServico | null | undefined): ConsumoEstoqueViewV4 {
  if (!os) {
    return { pecas: [], vinculadaCount: 0, semVinculoCount: 0, jaConsumido: false, podeBaixar: false };
  }

  const jaConsumido = os.estoqueConsumido === true;
  const fonte = selectEstoquePecaSource(pecasArray(os.pecas), pecasArray(os.orcamento?.pecas));
  const pecas: PecaConsumoV4[] = [];

  for (const [i, p] of fonte.rows.entries()) {
    const quantidade = qty(p.quantidade);
    if (quantidade < 1) continue;
    const vinculada = pecaVinculada(p);
    pecas.push({
      id: txt(p.id) || txt((p as { produtoId?: unknown }).produtoId) || `peca_${i}`,
      nome: txt(p.nome) || "Peça",
      quantidade,
      vinculada,
      origem: fonte.source,
    });
  }

  const vinculadaCount = pecas.filter((p) => p.vinculada).length;
  return {
    pecas,
    vinculadaCount,
    semVinculoCount: pecas.length - vinculadaCount,
    jaConsumido,
    podeBaixar: !jaConsumido && vinculadaCount > 0,
  };
}
