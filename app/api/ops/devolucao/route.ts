import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { opsLojaIdFromRequestForWrite } from "@/lib/ops-api-gate"
import { apiGuardEnterpriseOrOps } from "@/lib/auth/api-enterprise-guard"
import { auth } from "@/auth"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator"
import { createSaida } from "@/lib/financeiro/services/movimentacoes-service"
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service"
import { isVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"
import type { Prisma } from "@/generated/prisma"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

function arredonda2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

const itemSchema = z.object({
  inventoryId: z.string().optional(),
  nome: z.string().default(""),
  quantidade: z.number().int().min(1),
  valorUnitario: z.number().min(0).default(0),
  valorTotal: z.number().min(0).default(0),
})

const schema = z.object({
  localId: z.string().min(1),
  vendaLocalId: z.string().default(""),
  sessaoId: z.string().optional(),
  tipo: z.enum(["vale_credito", "somente_estoque", "troca", "devolucao"]),
  valorTotal: z.number().min(0).default(0),
  creditoEmitido: z.number().min(0).default(0),
  clienteNome: z.string().default(""),
  clienteDoc: z.string().default(""),
  operador: z.string().default(""),
  motivo: z.string().default(""),
  observacao: z.string().default(""),
  itens: z.array(itemSchema).min(1),
  /** Snapshot JSON da devolução para auditoria. */
  payload: z.record(z.unknown()).optional(),
})

export async function POST(req: Request) {
  const lojaId = opsLojaIdFromRequestForWrite(req)
  if (!lojaId) {
    return NextResponse.json(
      { error: "Unidade obrigatória: envie o header x-assistec-loja-id." },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 422 })
  }

  const denied = await apiGuardEnterpriseOrOps(
    lojaId,
    (p) => p.pdv.devolucao,
    "Sem permissão para registrar devoluções.",
  )
  if (denied) return denied

  const data = parsed.data
  const session = await auth()
  const operadorFinal =
    data.operador?.trim() || (session?.user ? getOperatorLabelFromSession(session) : "")

  // ── Idempotência: se já existir, retornar como sucesso ──────────────────────
  const existing = await prisma.devolucaoVenda.findUnique({
    where: { storeId_localId: { storeId: lojaId, localId: data.localId } },
    select: { id: true, localId: true },
  })
  if (existing) {
    return NextResponse.json({ ok: true, devolucaoId: existing.id, idempotente: true })
  }

  const lock = await verificarPeriodoFechado(lojaId, new Date())
  if (lock.fechado) {
    return NextResponse.json(
      { error: "Período financeiro fechado. Reabra o fechamento para registrar devoluções.", code: "periodo_fechado" },
      { status: 409 },
    )
  }

  // ── Validar sessão se fornecida ─────────────────────────────────────────────
  if (data.sessaoId) {
    const sessao = await prisma.sessaoCaixa.findFirst({
      where: { id: data.sessaoId, storeId: lojaId },
      select: { id: true, status: true },
    })
    if (!sessao) {
      return NextResponse.json({ error: "Sessão de caixa não encontrada." }, { status: 404 })
    }
    // Aviso (não bloqueia): caixa fechado com override
    if (sessao.status === "FECHADA") {
      console.warn(`[ops/devolucao] sessão ${data.sessaoId} já fechada — devolução permitida com override`)
    }
  }

  try {
    // Valor autoritativo — pode ser recalculado DENTRO da transação (passo 0) e
    // é usado fora dela pela integração financeira (createSaida).
    let valorTotalEfetivo = data.valorTotal
    const devolucao = await prisma.$transaction(async (tx) => {
      // 0. Valor autoritativo — quando a venda de origem existe no banco, o valor
      // devolvido e o crédito emitido são RECALCULADOS dos itens persistidos
      // (unitário = lineTotal/quantidade da venda original × qtd devolvida) e o
      // crédito é limitado ao valor efetivamente devolvido — o client nunca é
      // autoridade financeira. Só substitui quando TODAS as linhas resolvem na
      // venda original; caso contrário (venda legada fora do banco), mantém os
      // valores do client com warning.
      let creditoEfetivo = data.tipo === "somente_estoque" ? 0 : data.creditoEmitido
      if (data.vendaLocalId) {
        const vendaOrigem = await tx.venda.findFirst({
          where: { pedidoId: data.vendaLocalId, storeId: lojaId },
          select: { itens: { select: { inventoryId: true, quantidade: true, lineTotal: true } } },
        })
        if (vendaOrigem) {
          let totalCalc = 0
          let todasResolvidas = true
          for (const it of data.itens) {
            const orig = vendaOrigem.itens.find((iv) => iv.inventoryId === it.inventoryId)
            if (!orig || orig.quantidade <= 0) {
              todasResolvidas = false
              break
            }
            totalCalc += (orig.lineTotal / orig.quantidade) * it.quantidade
          }
          if (todasResolvidas) {
            valorTotalEfetivo = arredonda2(totalCalc)
            if (creditoEfetivo > valorTotalEfetivo) {
              console.warn(
                "[ops/devolucao] credito-emitido-reduzido-ao-valor-devolvido",
                JSON.stringify({ localId: data.localId, venda: data.vendaLocalId, creditoEmitido: data.creditoEmitido, valorDevolvido: valorTotalEfetivo }),
              )
              creditoEfetivo = valorTotalEfetivo
            }
            if (Math.abs(valorTotalEfetivo - data.valorTotal) > 0.01) {
              console.warn(
                "[ops/devolucao] valor-total-divergente-do-client",
                JSON.stringify({ localId: data.localId, client: data.valorTotal, servidor: valorTotalEfetivo }),
              )
            }
          }
        }
      }

      // 1. Criar documento de devolução
      const dev = await tx.devolucaoVenda.create({
        data: {
          storeId: lojaId,
          localId: data.localId,
          vendaLocalId: data.vendaLocalId,
          sessaoId: data.sessaoId ?? null,
          tipo: data.tipo,
          valorTotal: valorTotalEfetivo,
          creditoEmitido: creditoEfetivo,
          clienteNome: data.clienteNome,
          clienteDoc: data.clienteDoc,
          operador: operadorFinal,
          motivo: data.motivo,
          observacao: data.observacao,
          payload: data.payload ? (data.payload as Prisma.InputJsonValue) : undefined,
          itens: {
            create: data.itens.map((it) => ({
              inventoryId: it.inventoryId ?? null,
              nome: it.nome,
              quantidade: it.quantidade,
              valorUnitario: it.valorUnitario,
              valorTotal: it.valorTotal,
            })),
          },
        },
        include: { itens: true },
      })

      // 2. Estoque REAL — devolve itens ao estoque + ledger auditável.
      // Mesmo padrão do adapter OS → Estoque (MovimentacaoEstoque + decrement/increment de Produto.stock).
      // origem: "devolucao" diferencia de "pdv" (saída de venda) e "os".
      // Idempotência: a devolução só é criada uma vez (guard `existing` no topo); o findFirst
      // por documento+produto+origem é defesa extra contra reprocessamento na mesma tx.
      for (const it of data.itens) {
        const rawInvId = (it.inventoryId ?? "").trim()
        if (!rawInvId || isVirtualSaleLine(rawInvId)) continue
        const qty = Math.max(0, Math.round(it.quantidade))
        if (qty <= 0) continue

        const produto = await tx.produto.findFirst({
          where: { storeId: lojaId, OR: [{ id: rawInvId }, { sku: rawInvId }, { barcode: rawInvId }] },
          select: { id: true, stock: true, precoCusto: true, sku: true, name: true },
        })
        if (!produto) continue

        const jaExiste = await tx.movimentacaoEstoque.findFirst({
          where: { storeId: lojaId, documento: data.localId, produtoId: produto.id, origem: "devolucao" },
          select: { id: true },
        })
        if (jaExiste) continue

        const estoqueAntes = produto.stock
        const custo = arredonda2(Math.max(0, produto.precoCusto))
        await tx.produto.update({ where: { id: produto.id }, data: { stock: { increment: qty } } })
        await tx.movimentacaoEstoque.create({
          data: {
            storeId: lojaId,
            produtoId: produto.id,
            produtoSku: produto.sku ?? null,
            produtoNome: produto.name,
            tipo: "entrada",
            origem: "devolucao",
            quantidade: qty,
            estoqueAntes,
            estoqueDepois: estoqueAntes + qty,
            custoUnitario: custo,
            custoMedioAntes: custo,
            custoMedioDepois: custo,
            valorTotal: arredonda2(qty * custo),
            documento: data.localId,
            motivo: data.motivo?.trim() || `Devolução ${data.localId}`,
            usuario: operadorFinal || null,
          },
        })
      }

      // 3. Status da Venda — parcialmente_devolvida / devolvida (com base no total devolvido).
      // Agrega as quantidades de todas as devoluções da venda (inclui a recém-criada) e
      // compara com o total vendido. Best-effort: venda pode não existir no banco.
      if (data.vendaLocalId) {
        const venda = await tx.venda.findFirst({
          where: { pedidoId: data.vendaLocalId, storeId: lojaId },
          select: { id: true, status: true, itens: { select: { quantidade: true } } },
        })
        if (venda && venda.status !== "cancelada") {
          const totalVendido = venda.itens.reduce((s, i) => s + (i.quantidade || 0), 0)
          const devs = await tx.devolucaoVenda.findMany({
            where: { storeId: lojaId, vendaLocalId: data.vendaLocalId },
            select: { itens: { select: { quantidade: true } } },
          })
          const totalDevolvido = devs.reduce(
            (s, d) => s + d.itens.reduce((a, i) => a + (i.quantidade || 0), 0),
            0,
          )
          const novoStatus =
            totalVendido > 0 && totalDevolvido >= totalVendido
              ? "devolvida"
              : totalDevolvido > 0
                ? "parcialmente_devolvida"
                : venda.status
          if (novoStatus !== venda.status) {
            await tx.venda.update({ where: { id: venda.id }, data: { status: novoStatus } })
          }
        }
      }

      // 4. Crédito persistente — cria ClienteCredito quando vale é emitido.
      // Uma devolução gera crédito UMA única vez: o guard de idempotência por
      // [storeId, localId] no topo já devolve replay antes daqui, e o crédito é
      // criado na MESMA transação do documento de devolução.
      if (creditoEfetivo > 0 && data.tipo !== "somente_estoque") {
        const docNorm = data.clienteDoc.replace(/\D/g, "")
        if (docNorm) {
          await tx.clienteCredito.create({
            data: {
              storeId: lojaId,
              clienteDoc: docNorm,
              clienteNome: data.clienteNome,
              devolucaoId: dev.id,
              vendaOrigemId: data.vendaLocalId,
              valorOriginal: arredonda2(creditoEfetivo),
              saldoAtual: arredonda2(creditoEfetivo),
              status: "ativo",
            },
          })
        }
      }

      return dev
    })

    // 4. Integração financeira — saída por devolução (fora da tx para não bloquear)
    // Só cria movimentação se há valor devolvido real (não apenas troca de estoque).
    // Vale-Troca NÃO é dinheiro novo: a saída financeira representa o valor que
    // sai do caixa/financeiro pela devolução (reembolso real), nunca entrada
    // simulada do vale; devolução parcial movimenta somente o valor devolvido.
    if (valorTotalEfetivo > 0 && data.tipo !== "somente_estoque") {
      try {
        await createSaida({
          storeId: lojaId,
          valor: valorTotalEfetivo,
          descricao: `Devolução PDV — ${data.localId}${data.clienteNome ? ` | ${data.clienteNome}` : ""}`,
          origem: "devolucao_pdv",
          referenciaId: devolucao.id,
        })
      } catch (finErr) {
        // Financeiro não deve bloquear a devolução
        console.warn("[ops/devolucao] Falha ao criar movimentação financeira:", finErr)
      }
    }

    return NextResponse.json({ ok: true, devolucaoId: devolucao.id, devolucao })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[ops/devolucao]", msg)
    return NextResponse.json({ error: "Falha ao persistir devolução" }, { status: 500 })
  }
}
