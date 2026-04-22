/**
 * Agregações para o Dashboard 360 (vendas PDV, OS, financeiro, importações).
 */

import { startOfDay, endOfDay, isWithinInterval } from "date-fns"
import type { SaleRecord, InventoryItem } from "@/lib/operations-store"
import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"
import type { MovimentoFinanceiro } from "@/lib/financeiro-types"
import type { ContaPagarItem } from "@/lib/financeiro-types"
import type { VendasProdutosPorPedidoPayload, OsEquipamentosPayload } from "@/lib/import-cross-analytics"

export type FonteDados360 = "todos" | "pdv" | "planilhas"

export type CategoriaMix360 = "todos" | "produto" | "servico"

export interface Dashboard360Filters {
  inicio: Date
  fim: Date
  fonte: FonteDados360
  categoriaMix: CategoriaMix360
  vendedorTexto: string
}

export interface LucroRealResult {
  totalVendasPdv: number
  totalVendasPlanilha: number
  totalOs: number
  faturamentoBruto: number
  totalContasPagar: number
  lucroLiquido: number
}

export interface RankingProduto {
  nome: string
  quantidade: number
  receita: number
  custoTotal?: number
  /** receita − custo quando ambos existem nas importações */
  lucroEstimado?: number
}

export interface RankingServicoOs {
  label: string
  quantidade: number
  receita?: number
}

export interface TicketMedioResult {
  /** Total de vendas (transações) no período */
  qtdTransacoesVenda: number
  /** Total de OS no período */
  qtdTransacoesOs: number
  /** Valor médio por venda (transação) */
  ticketMedioPorVenda: number
  /** Valor médio por OS (transação) */
  ticketMedioPorOs: number
  /** Média de gasto por cliente distinto (vendas) */
  mediaPorClienteVenda: number
  clientesDistintosVenda: number
  /** Média de gasto por cliente distinto (OS) */
  mediaPorClienteOs: number
  clientesDistintosOs: number
}

export type TimelineItem =
  | {
      tipo: "venda"
      id: string
      at: string
      titulo: string
      detalhe: string
      valor: number
    }
  | {
      tipo: "os"
      id: string
      at: string
      titulo: string
      detalhe: string
      valor: number
    }

function inRange(isoDate: string, inicio: Date, fim: Date): boolean {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return false
  return isWithinInterval(d, { start: startOfDay(inicio), end: endOfDay(fim) })
}

function normCliente(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function digitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "")
}

function lineCategory(inv: InventoryItem | undefined, categoriaMix: CategoriaMix360): "produto" | "servico" | "outro" {
  if (!inv) return "outro"
  const c = (inv.category || "").toLowerCase()
  if (c === "servico" || c.includes("servi")) return "servico"
  return "produto"
}

function saleLineMatchesMix(
  inv: InventoryItem | undefined,
  categoriaMix: CategoriaMix360
): boolean {
  if (categoriaMix === "todos") return true
  const lc = lineCategory(inv, categoriaMix)
  if (categoriaMix === "produto") return lc === "produto"
  if (categoriaMix === "servico") return lc === "servico"
  return true
}

function matchesVendedorTexto(descricao: string, v: string): boolean {
  const t = v.trim().toLowerCase()
  if (!t) return true
  return descricao.toLowerCase().includes(t)
}

/**
 * Vendas importadas como movimentos (categoria típica "Vendas no balcão").
 */
function isMovimentoVendaPlanilha(m: MovimentoFinanceiro): boolean {
  if (m.tipo !== "entrada") return false
  const c = (m.categoria || "").toLowerCase()
  return c.includes("venda") && (m.status ?? "Pago") === "Pago"
}

export function computeLucroReal(
  sales: SaleRecord[],
  ordens: OrdemServico[],
  contasPagar: ContaPagarItem[],
  movimentos: MovimentoFinanceiro[],
  filters: Dashboard360Filters
): LucroRealResult {
  const { inicio, fim, fonte, vendedorTexto } = filters

  let totalVendasPdv = 0
  if (fonte === "todos" || fonte === "pdv") {
    for (const s of sales) {
      if (!inRange(s.at, inicio, fim)) continue
      totalVendasPdv += s.total
    }
  }

  let totalVendasPlanilha = 0
  if (fonte === "todos" || fonte === "planilhas") {
    for (const m of movimentos) {
      if (!inRange(m.at, inicio, fim)) continue
      if (!isMovimentoVendaPlanilha(m)) continue
      if (!matchesVendedorTexto(m.descricao, vendedorTexto)) continue
      totalVendasPlanilha += m.valor
    }
  }

  let totalOs = 0
  if (fonte === "todos" || fonte === "pdv") {
    for (const o of ordens) {
      const entrada = `${o.dataEntrada}T12:00:00.000Z`
      if (!inRange(entrada, inicio, fim)) continue
      totalOs += o.valorServico + o.valorPecas
    }
  }

  const faturamentoBruto = totalVendasPdv + totalVendasPlanilha + totalOs

  let totalContasPagar = 0
  for (const c of contasPagar) {
    const vd = `${c.dataVencimento}T12:00:00.000Z`
    if (!inRange(vd, inicio, fim)) continue
    totalContasPagar += c.valor
  }

  return {
    totalVendasPdv,
    totalVendasPlanilha,
    totalOs,
    faturamentoBruto,
    totalContasPagar,
    lucroLiquido: faturamentoBruto - totalContasPagar,
  }
}

export function computeRankingProdutos(
  sales: SaleRecord[],
  inventory: InventoryItem[],
  filters: Dashboard360Filters,
  importVendas: VendasProdutosPorPedidoPayload | null
): RankingProduto[] {
  const { inicio, fim, fonte, categoriaMix } = filters
  const invById = new Map(inventory.map((i) => [i.id, i]))
  const map = new Map<string, { q: number; receita: number }>()

  if (fonte === "todos" || fonte === "pdv") {
    for (const s of sales) {
      if (!inRange(s.at, inicio, fim)) continue
      for (const ln of s.lines) {
        const inv = invById.get(ln.inventoryId)
        if (!saleLineMatchesMix(inv, categoriaMix)) continue
        const nome = ln.name.trim() || "Item"
        const cur = map.get(nome) ?? { q: 0, receita: 0 }
        cur.q += ln.quantity
        cur.receita += ln.lineTotal
        map.set(nome, cur)
      }
    }
  }

  if (
    (fonte === "todos" || fonte === "planilhas") &&
    categoriaMix !== "servico" &&
    importVendas?.linhas?.length
  ) {
    type Agg = { q: number; receita: number; custo: number }
    const mapLucro = new Map<string, Agg>()
    for (const l of importVendas.linhas) {
      if (l.dataVenda) {
        const d = `${l.dataVenda}T12:00:00.000Z`
        if (!inRange(d, inicio, fim)) continue
      }
      const nome = l.produtoNome.trim()
      if (!nome) continue
      const cur = mapLucro.get(nome) ?? { q: 0, receita: 0, custo: 0 }
      cur.q += l.quantidade
      cur.receita += l.valor ?? 0
      cur.custo += l.custo ?? 0
      mapLucro.set(nome, cur)
    }
    for (const [nome, v] of mapLucro) {
      const cur = map.get(nome) ?? { q: 0, receita: 0 }
      cur.q += v.q
      cur.receita += v.receita
      map.set(nome, cur)
    }
    const entries = [...map.entries()].map(([nome, v]) => {
      const imp = mapLucro.get(nome)
      const custoTotal = imp && imp.custo > 0 ? imp.custo : undefined
      const lucroEstimado =
        imp && imp.custo > 0 ? Math.round((imp.receita - imp.custo) * 100) / 100 : undefined
      return { nome, quantidade: v.q, receita: v.receita, custoTotal, lucroEstimado }
    })
    const anyLucro = entries.some((e) => e.custoTotal != null && e.custoTotal > 0)
    entries.sort((a, b) => {
      if (anyLucro) return (b.lucroEstimado ?? b.receita) - (a.lucroEstimado ?? a.receita)
      return b.receita - a.receita
    })
    return entries.slice(0, 10)
  }

  return [...map.entries()]
    .map(([nome, v]) => ({ nome, quantidade: v.q, receita: v.receita }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 10)
}

/** Usa defeito (ou serviço importado) como rótulo; soma valor de serviço quando a planilha trouxer. */
export function computeRankingServicosOs(
  ordens: OrdemServico[],
  filters: Dashboard360Filters,
  importOs: OsEquipamentosPayload | null
): RankingServicoOs[] {
  const { inicio, fim, fonte } = filters
  const map = new Map<string, { q: number; receita: number }>()

  if (fonte === "todos" || fonte === "pdv") {
    for (const o of ordens) {
      const entrada = `${o.dataEntrada}T12:00:00.000Z`
      if (!inRange(entrada, inicio, fim)) continue
      const raw = (o.defeito || o.solucao || "").trim()
      const label = raw ? raw.slice(0, 80) : `${o.aparelho.marca} ${o.aparelho.modelo}`.trim() || "OS"
      const cur = map.get(label) ?? { q: 0, receita: 0 }
      cur.q += 1
      cur.receita += o.valorServico + o.valorPecas
      map.set(label, cur)
    }
  }

  if ((fonte === "todos" || fonte === "planilhas") && importOs?.linhas?.length) {
    /**
     * Importações D360 podem trazer múltiplas linhas por OS (equipamento/serviço/histórico)
     * com o MESMO valor total repetido, o que inflaria a receita se somarmos linha a linha.
     *
     * Regra: considerar 1 transação por `osNumero` e usar UM valor (preferindo o maior valor encontrado).
     */
    const byOs = new Map<string, { label: string; receita: number }>()
    for (const l of importOs.linhas) {
      const os = String(l.osNumero ?? "").trim()
      if (!os) continue
      const label = (l.servicoNome || l.equipamento || `OS ${os}`).trim().slice(0, 80)
      const receita = typeof l.valorServico === "number" && Number.isFinite(l.valorServico) ? l.valorServico : 0
      const cur = byOs.get(os)
      if (!cur) {
        byOs.set(os, { label, receita })
        continue
      }
      // mantém um label estável (prioriza serviço) e a maior receita vista
      const curIsServico = Boolean(cur.label && !cur.label.toLowerCase().startsWith("os "))
      const nextIsServico = Boolean(l.servicoNome && String(l.servicoNome).trim())
      byOs.set(os, {
        label: curIsServico ? cur.label : nextIsServico ? label : cur.label,
        receita: Math.max(cur.receita, receita),
      })
    }

    for (const { label, receita } of byOs.values()) {
      const cur = map.get(label) ?? { q: 0, receita: 0 }
      cur.q += 1
      cur.receita += receita
      map.set(label, cur)
    }
  }

  const rows = [...map.entries()].map(([label, v]) => ({
    label,
    quantidade: v.q,
    receita: v.receita > 0 ? Math.round(v.receita * 100) / 100 : undefined,
  }))
  const anyVal = rows.some((r) => (r.receita ?? 0) > 0)
  rows.sort((a, b) => {
    if (anyVal) return (b.receita ?? 0) - (a.receita ?? 0)
    return b.quantidade - a.quantidade
  })
  return rows.slice(0, 5)
}

export function computeTicketMedio(
  sales: SaleRecord[],
  ordens: OrdemServico[],
  filters: Dashboard360Filters
): TicketMedioResult {
  const { inicio, fim, fonte } = filters

  const byClienteVenda = new Map<string, number>()
  let qtdVendas = 0
  let sumVendas = 0
  if (fonte === "todos" || fonte === "pdv") {
    for (const s of sales) {
      if (!inRange(s.at, inicio, fim)) continue
      qtdVendas += 1
      sumVendas += s.total
      const nome = (s.customerName || "").trim()
      if (!nome) continue
      const k = normCliente(nome) + "|" + digitsOnly(s.customerCpf || "")
      byClienteVenda.set(k, (byClienteVenda.get(k) ?? 0) + s.total)
    }
  }

  const byClienteOs = new Map<string, number>()
  let qtdOs = 0
  let sumOs = 0
  if (fonte === "todos" || fonte === "pdv") {
    for (const o of ordens) {
      const entrada = `${o.dataEntrada}T12:00:00.000Z`
      if (!inRange(entrada, inicio, fim)) continue
      qtdOs += 1
      const tot = o.valorServico + o.valorPecas
      sumOs += tot
      const nome = (o.cliente?.nome || "").trim()
      if (!nome) continue
      const k = normCliente(nome) + "|" + digitsOnly(o.cliente?.cpf || "")
      byClienteOs.set(k, (byClienteOs.get(k) ?? 0) + tot)
    }
  }

  const sumVCliente = [...byClienteVenda.values()].reduce((a, b) => a + b, 0)
  const nClienteV = byClienteVenda.size
  const sumOCliente = [...byClienteOs.values()].reduce((a, b) => a + b, 0)
  const nClienteO = byClienteOs.size

  return {
    qtdTransacoesVenda: qtdVendas,
    qtdTransacoesOs: qtdOs,
    ticketMedioPorVenda: qtdVendas > 0 ? Math.round((sumVendas / qtdVendas) * 100) / 100 : 0,
    ticketMedioPorOs: qtdOs > 0 ? Math.round((sumOs / qtdOs) * 100) / 100 : 0,
    mediaPorClienteVenda: nClienteV > 0 ? Math.round((sumVCliente / nClienteV) * 100) / 100 : 0,
    clientesDistintosVenda: nClienteV,
    mediaPorClienteOs: nClienteO > 0 ? Math.round((sumOCliente / nClienteO) * 100) / 100 : 0,
    clientesDistintosOs: nClienteO,
  }
}

export function buildTimelineCliente(
  query: string,
  sales: SaleRecord[],
  ordens: OrdemServico[]
): TimelineItem[] {
  const q = normCliente(query)
  if (q.length < 2) return []

  const items: TimelineItem[] = []

  for (const s of sales) {
    const nome = (s.customerName || "").trim()
    if (!nome || !normCliente(nome).includes(q)) continue
    const lines = s.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")
    items.push({
      tipo: "venda",
      id: s.id,
      at: s.at,
      titulo: "Venda PDV",
      detalhe: lines || "Itens",
      valor: s.total,
    })
  }

  for (const o of ordens) {
    const nome = (o.cliente?.nome || "").trim()
    if (!nome || !normCliente(nome).includes(q)) continue
    const ap = `${o.aparelho.marca} ${o.aparelho.modelo}`.trim()
    items.push({
      tipo: "os",
      id: o.id,
      at: `${o.dataEntrada}T12:00:00.000Z`,
      titulo: `OS ${o.numero}`,
      detalhe: ap + (o.defeito ? ` — ${o.defeito.slice(0, 120)}` : ""),
      valor: o.valorServico + o.valorPecas,
    })
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return items
}
