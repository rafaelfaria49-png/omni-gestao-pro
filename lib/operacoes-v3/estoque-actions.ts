"use server";

// ============================================================================
// Operações V3 — write-path de CONSUMO de estoque da OS (reuso do adapter oficial)
// ----------------------------------------------------------------------------
// Não reimplementa baixa: só autentica, recorta a loja ativa e chama
// `consumirEstoqueOSV3` → `consumeEstoqueFromOS`. Idempotente (replay não baixa
// de novo). Timeline + livro-razão (`origem=os`, documento da OS) ficam no
// adapter. A V4 recarrega a OS imediatamente após o retorno.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { consumirEstoqueOSV3, type ConsumoEstoqueV3Result } from "./estoque-sync";

function operadorLabel(session: Session | null): string {
  const u = session?.user;
  return (u?.name || u?.email || "Você").trim() || "Você";
}

export type ConsumirEstoqueOSActionV3Result = {
  status: Exclude<ConsumoEstoqueV3Result["status"], "error">;
  itens: number;
};

/**
 * Baixa real das peças da OS via adapter oficial. Não cria motor paralelo.
 * `already_consumed` é sucesso (replay). `nothing_to_consume` e falha lançam.
 */
export async function consumirEstoqueOSActionV3(
  storeId: string,
  osId: string,
): Promise<ConsumirEstoqueOSActionV3Result> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para baixar o estoque desta OS.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para alterar esta OS.");
  if (!guard.ok) throw new Error(guard.error);

  const row = await prisma.ordemServico.findFirst({
    where: { id, storeId: sid },
    select: { id: true, payload: true },
  });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OrdemServico | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");

  const r = await consumirEstoqueOSV3({
    storeId: sid,
    osId: id,
    osPayload: { ...payload, id, storeId: sid },
    operador: operadorLabel(session),
  });

  if (r.status === "error") {
    throw new Error(r.error || "Não foi possível baixar o estoque desta OS.");
  }
  if (r.status === "nothing_to_consume") {
    throw new Error(
      "Nenhuma peça desta OS está vinculada ao catálogo de produtos. Vincule a peça no orçamento para baixar o estoque.",
    );
  }

  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");
  return { status: r.status, itens: r.itens };
}
