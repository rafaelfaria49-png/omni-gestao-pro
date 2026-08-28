/**
 * GET /api/ops/credito-cliente
 *
 * Consulta de créditos ativos (vale-troca) da loja — usados pelo PDV para
 * consultar saldo e pelo bootstrap do operations-store para reconciliar.
 *
 * Query params:
 *   lojaId     — obrigatório (ou header x-assistec-loja-id)
 *   doc        — opcional; filtra um CPF/CNPJ específico (somente dígitos)
 *   clienteId  — opcional; filtra por cliente cadastrado
 *   codigo     — opcional; localiza o vale pelo código impresso no comprovante
 *                (localId da devolução de origem, ex.: DEV-2026-0001). Retorna
 *                `credito` com valor original, saldo, origem e usos.
 *
 * Response:
 *   doc/clienteId → { creditos: Record<doc, { nome, saldo }>,
 *                     detalhes?: Array<{ id, codigo, clienteDoc, clienteNome,
 *                                       vendaOrigemId, devolucaoId, valorOriginal,
 *                                       saldoAtual, status, at }> }
 *   codigo        → { credito: { ...mesma forma, usos: [...] } } | 404
 *
 * Usado por:
 *   - operations-store.tsx bootstrap para reconciliar customerCredits com o DB
 *   - vendas-arquivo-geral.tsx drawer para mostrar saldo atual do cliente
 *   - pdv-classic + PaymentModal para localizar crédito por doc/código no pagamento
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { opsLojaIdFromRequest } from "@/lib/ops-api-gate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type ClienteCreditoRow = {
  id: string
  clienteDoc: string
  clienteNome: string
  vendaOrigemId: string
  devolucaoId: string | null
  valorOriginal: number
  saldoAtual: number
  status: string
  createdAt: Date
  devolucao?: { localId: string } | null
}

/** Projeta um crédito para o formato público (código = localId da devolução). */
function projetarCredito(r: ClienteCreditoRow) {
  return {
    id: r.id,
    codigo: r.devolucao?.localId ?? "",
    clienteDoc: r.clienteDoc,
    clienteNome: r.clienteNome,
    vendaOrigemId: r.vendaOrigemId,
    devolucaoId: r.devolucaoId,
    valorOriginal: Math.round(r.valorOriginal * 100) / 100,
    saldoAtual: Math.round(r.saldoAtual * 100) / 100,
    status: r.status,
    at: r.createdAt.toISOString(),
  }
}

export async function GET(req: Request) {
  const lojaId = opsLojaIdFromRequest(req)
  if (!lojaId) {
    return NextResponse.json({ error: "lojaId obrigatório" }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const docFilter = (searchParams.get("doc") ?? "").replace(/\D/g, "")
  const clienteIdFilter = searchParams.get("clienteId")?.trim() ?? ""
  const codigoFilter = searchParams.get("codigo")?.trim().toUpperCase() ?? ""

  try {
    // ── Lookup por código do vale (comprovante impresso) ────────────────────────
    if (codigoFilter) {
      const devolucao = await prisma.devolucaoVenda.findFirst({
        where: { storeId: lojaId, localId: codigoFilter },
        select: { id: true },
      })
      if (!devolucao) {
        return NextResponse.json({ error: "Vale não encontrado para este código." }, { status: 404 })
      }
      const rows = (await prisma.clienteCredito.findMany({
        where: { storeId: lojaId, devolucaoId: devolucao.id },
        orderBy: { createdAt: "asc" },
        include: { devolucao: { select: { localId: true } } },
      })) as ClienteCreditoRow[]
      const creditos = rows.map(projetarCredito)
      const saldoTotal =
        Math.round(
          creditos
            .filter((c) => c.status === "ativo")
            .reduce((s, c) => s + c.saldoAtual, 0) * 100,
        ) / 100
      // Trilha auditável: vendas que consumiram cada vale.
      const credito = creditos[0]
        ? {
            ...creditos[0],
            saldoTotal,
            creditos,
            usos: await prisma.usoCreditoCliente.findMany({
              where: { storeId: lojaId, creditoId: { in: rows.map((r) => r.id) } },
              orderBy: { at: "asc" },
              select: {
                vendaId: true,
                valor: true,
                saldoAntes: true,
                saldoDepois: true,
                operador: true,
                at: true,
              },
            }),
          }
        : null
      if (!credito) {
        return NextResponse.json({ error: "Vale não encontrado para este código." }, { status: 404 })
      }
      return NextResponse.json({ credito })
    }

    // ── Lookup por doc / clienteId (saldo agregado + detalhes de origem) ────────
    const where = docFilter
      ? { storeId: lojaId, clienteDoc: docFilter, status: "ativo" as const, saldoAtual: { gt: 0 } }
      : clienteIdFilter
      ? { storeId: lojaId, clienteId: clienteIdFilter, status: "ativo" as const, saldoAtual: { gt: 0 } }
      : { storeId: lojaId, status: "ativo" as const, saldoAtual: { gt: 0 } }

    const rows = (await prisma.clienteCredito.findMany({
      where,
      select: {
        id: true,
        clienteDoc: true,
        clienteNome: true,
        vendaOrigemId: true,
        devolucaoId: true,
        valorOriginal: true,
        saldoAtual: true,
        status: true,
        createdAt: true,
        devolucao: { select: { localId: true } },
      },
      orderBy: { createdAt: "asc" },
    })) as ClienteCreditoRow[]

    // Agrega saldos por CPF/CNPJ (um cliente pode ter vários vales ativos)
    const creditos: Record<string, { nome: string; saldo: number }> = {}
    for (const r of rows) {
      const existing = creditos[r.clienteDoc]
      if (existing) {
        existing.saldo = Math.round((existing.saldo + r.saldoAtual) * 100) / 100
      } else {
        creditos[r.clienteDoc] = {
          nome: r.clienteNome,
          saldo: Math.round(r.saldoAtual * 100) / 100,
        }
      }
    }

    // Detalhes de origem só quando a consulta é pontual (doc/clienteId) — o
    // bootstrap da loja inteira não precisa carregar origem de cada vale.
    const detalhes = docFilter || clienteIdFilter ? rows.map(projetarCredito) : undefined

    return NextResponse.json({ creditos, ...(detalhes ? { detalhes } : {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[credito-cliente/GET]", msg)
    return NextResponse.json({ error: "Falha ao buscar créditos" }, { status: 503 })
  }
}
