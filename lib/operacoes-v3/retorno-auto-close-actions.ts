"use server";

// ============================================================================
// Auto-finaliza o retorno da OS original quando a OS vinculada é entregue.
// Chamado só por `registrarEntregaV3`. Sem schema, sem Financeiro/PDV/Caixa.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import type { OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { lerVinculoRetornoV3 } from "./pos-venda-model";
import { emitirEventoOperacaoV3 } from "./event-publisher";
import {
  aplicarAuditoriaFilhaAutoCloseV3,
  aplicarAutoCloseOriginalV3,
  resolverRetornoParaAutoCloseV3,
} from "./retorno-auto-close";

export type AutoCloseStatusV3 = "skipped" | "closed" | "already";

export interface FinalizarRetornoPorEntregaResultV3 {
  status: AutoCloseStatusV3;
  motivo?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function finalizarRetornoPorEntregaVinculadaV3(input: {
  storeId: string;
  osFilha: OrdemServico;
  operador: string;
}): Promise<FinalizarRetornoPorEntregaResultV3> {
  const sid = (input.storeId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  const filha = input.osFilha;
  const filhaId = (filha?.id ?? "").trim();
  const vinculo = lerVinculoRetornoV3(filha);
  if (!filhaId || !vinculo?.osOrigemId?.trim() || !vinculo.retornoId?.trim()) {
    return { status: "skipped", motivo: "sem_vinculo" };
  }

  const origemId = vinculo.osOrigemId.trim();
  const row = await prisma.ordemServico.findFirst({
    where: { id: origemId, storeId: sid },
    select: { id: true, payload: true },
  });
  if (!row?.payload || typeof row.payload !== "object") {
    return { status: "skipped", motivo: "retorno_ausente" };
  }

  const original = { ...(row.payload as unknown as OrdemServico), id: row.id };
  const resolucao = resolverRetornoParaAutoCloseV3({ ...filha, id: filhaId }, original);
  if (!resolucao.ok) return { status: "skipped", motivo: resolucao.motivo };

  const agora = nowIso();
  const operador = (input.operador ?? "").trim() || "Sistema";
  const originalAplicado = aplicarAutoCloseOriginalV3(original, { ...filha, id: filhaId }, { operador, agora });

  if (originalAplicado.changed) {
    await prisma.ordemServico.update({
      where: { id: row.id },
      data: { payload: originalAplicado.next as unknown as Prisma.InputJsonValue },
    });
    emitirEventoOperacaoV3({
      tipo: "os_retorno_finalizado",
      os: originalAplicado.next,
      storeId: sid,
      origem: "retorno",
      metadata: {
        retornoId: resolucao.retorno.id,
        motivo: resolucao.retorno.motivo,
        origem: "entrega_vinculada",
        osRetornoId: filhaId,
        osRetornoCodigo: filha.codigo,
      },
    });
  }

  const filhaRow = await prisma.ordemServico.findFirst({
    where: { id: filhaId, storeId: sid },
    select: { id: true, payload: true },
  });
  const filhaAtual = filhaRow?.payload && typeof filhaRow.payload === "object"
    ? ({ ...(filhaRow.payload as unknown as OrdemServico), id: filhaRow.id } as OrdemServico)
    : ({ ...filha, id: filhaId } as OrdemServico);
  const filhaAplicada = aplicarAuditoriaFilhaAutoCloseV3(filhaAtual, {
    osOrigemId: origemId,
    osOrigemCodigo: resolucao.vinculo.osOrigemCodigo || original.codigo,
    retornoId: resolucao.retorno.id,
    operador,
    agora,
  });
  if (filhaAplicada.changed) {
    await prisma.ordemServico.update({
      where: { id: filhaId },
      data: { payload: filhaAplicada.next as unknown as Prisma.InputJsonValue },
    });
  }

  if (originalAplicado.changed || filhaAplicada.changed) {
    revalidatePath("/dashboard/operacoes-v3");
    revalidatePath("/dashboard/operacoes-v4-preview");
  }

  if (originalAplicado.changed) return { status: "closed" };
  if (resolucao.jaFinalizado) return { status: "already" };
  return { status: "already" };
}
