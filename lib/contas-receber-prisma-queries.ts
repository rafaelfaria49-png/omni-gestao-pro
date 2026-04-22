/**
 * Consultas Prisma para títulos em Contas a Receber com vendas/itens.
 * O painel continua usando localStorage por padrão; use estas funções em APIs ou jobs de sync.
 */

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma"

const tituloComVendasInclude = {
  vendas: {
    include: { itens: true },
    orderBy: { at: "desc" as const },
  },
} satisfies Prisma.ContaReceberTituloInclude

export type ContaReceberTituloComVendas = Prisma.ContaReceberTituloGetPayload<{
  include: typeof tituloComVendasInclude
}>

export async function listarContasReceberComVendas(storeId?: string): Promise<ContaReceberTituloComVendas[]> {
  return prisma.contaReceberTitulo.findMany({
    where: storeId ? { storeId } : undefined,
    include: tituloComVendasInclude,
    orderBy: { updatedAt: "desc" },
  })
}

export async function buscarContaReceberPorIdComVendas(
  id: string
): Promise<ContaReceberTituloComVendas | null> {
  return prisma.contaReceberTitulo.findUnique({
    where: { id },
    include: tituloComVendasInclude,
  })
}
