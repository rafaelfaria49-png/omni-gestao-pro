import type { Prisma } from "@/generated/prisma"

export type ItemInput = { produtoId: string; quantidade: number }

type Tx = Prisma.TransactionClient

function mergeItensPorProduto(itens: ItemInput[]): ItemInput[] {
  const m = new Map<string, number>()
  for (const it of itens) {
    const id = it.produtoId.trim()
    if (!id) continue
    const q = Math.floor(Number(it.quantidade))
    if (!Number.isFinite(q) || q < 1) continue
    m.set(id, (m.get(id) ?? 0) + q)
  }
  return [...m.entries()].map(([produtoId, quantidade]) => ({ produtoId, quantidade }))
}

export async function somaPecasEValidaEstoque(
  tx: Tx,
  itens: ItemInput[],
  storeId: string
): Promise<{ sumPecas: number; rows: { produtoId: string; quantidade: number; precoUnitario: number }[] }> {
  const merged = mergeItensPorProduto(itens)
  let sumPecas = 0
  const rows: { produtoId: string; quantidade: number; precoUnitario: number }[] = []

  for (const it of merged) {
    const p = await tx.produto.findFirst({ where: { id: it.produtoId, storeId } })
    if (!p) {
      throw new Error(`Produto não encontrado.`)
    }
    if (p.stock < it.quantidade) {
      throw new Error(`Estoque insuficiente para "${p.name}" (disponível: ${p.stock}).`)
    }
    const line = p.price * it.quantidade
    sumPecas += line
    rows.push({ produtoId: p.id, quantidade: it.quantidade, precoUnitario: p.price })
  }

  return { sumPecas, rows }
}

export async function restaurarEstoqueItensOrdem(tx: Tx, ordemServicoId: string): Promise<void> {
  const antigos = await tx.ordemServicoItem.findMany({ where: { ordemServicoId } })
  for (const a of antigos) {
    await tx.produto.update({
      where: { id: a.produtoId },
      data: { stock: { increment: a.quantidade } },
    })
  }
  await tx.ordemServicoItem.deleteMany({ where: { ordemServicoId } })
}

export async function baixarEstoqueECriarItens(
  tx: Tx,
  ordemServicoId: string,
  rows: { produtoId: string; quantidade: number; precoUnitario: number }[]
): Promise<void> {
  for (const row of rows) {
    await tx.produto.update({
      where: { id: row.produtoId },
      data: { stock: { decrement: row.quantidade } },
    })
    await tx.ordemServicoItem.create({
      data: {
        ordemServicoId,
        produtoId: row.produtoId,
        quantidade: row.quantidade,
        precoUnitario: row.precoUnitario,
      },
    })
  }
}
