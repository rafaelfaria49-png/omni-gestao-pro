/**
 * Sincroniza títulos de Contas a Receber a partir dos dados do Dashboard 360
 * (localStorage `import-cross-analytics` + lookups de pagamento).
 * Usa a mesma chave que `ContasReceber`: `contasReceberStorageKey(lojaId)`.
 */

import { contasReceberStorageKey } from "@/lib/contas-receber-storage"
import { loadOsEquipamentos, loadVendasProdutosPorPedido } from "@/lib/import-cross-analytics"
import {
  getNumerosOsPagas,
  getNumerosOsPagasValores,
  getPedidosPagosVendas,
  getPedidosPagosVendasValores,
} from "@/lib/import-pagamentos-lookup"

/** Mesmo formato que `ContaReceberRow` em contas-receber.tsx (evita import lib → client). */
type CrRow = {
  id: string | number
  descricao: string
  cliente: string
  valor: number
  vencimento: string
  status: string
  tipo: string
  movimentoBaixaId?: string
}

function isoParaVencBr(iso: string): string {
  const parts = iso.split("-").map((x) => parseInt(x, 10))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso
  const [y, m, d] = parts
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String(y)}`
}

function statusVenda(pedido: string, vencIso: string, pagos: Set<string>): "pago" | "pendente" | "atrasado" {
  if (pagos.has(pedido)) return "pago"
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const v = new Date(`${vencIso}T12:00:00`)
  v.setHours(0, 0, 0, 0)
  return v.getTime() < hoje.getTime() ? "atrasado" : "pendente"
}

function statusOs(numero: string, pagos: Set<string>): "pago" | "pendente" {
  return pagos.has(numero) ? "pago" : "pendente"
}

/**
 * Remove títulos gerados por importações D360 (`id` começa com `d360-`) e recria
 * a partir dos snapshots atuais em localStorage (vendas_produtos + OS).
 * Mantém títulos manuais / backup que não sejam `d360-*`.
 */
export function syncContasReceberFromDashboard360Storage(lojaId: string): {
  titulosD360Gerados: number
  totalTitulosNaTabela: number
} {
  if (typeof window === "undefined") {
    return { titulosD360Gerados: 0, totalTitulosNaTabela: 0 }
  }

  const key = contasReceberStorageKey(lojaId)
  let existentes: CrRow[] = []
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      existentes = Array.isArray(p) ? (p as CrRow[]) : []
    }
  } catch {
    existentes = []
  }

  const semD360 = existentes.filter((r) => !String(r.id).startsWith("d360-"))

  const vendas = loadVendasProdutosPorPedido()
  const osPayload = loadOsEquipamentos()
  const pedidosPagos = getPedidosPagosVendas()
  const pedidosPagosValores = getPedidosPagosVendasValores()
  const osPagos = getNumerosOsPagas()
  const osPagosValores = getNumerosOsPagasValores()

  const porPedido = new Map<string, { sum: number; max: number; n: number; data?: string; clienteNome?: string }>()
  for (const l of vendas.linhas) {
    const cur = porPedido.get(l.pedido) ?? { sum: 0, max: 0, n: 0, data: l.dataVenda }
    const v = l.valor ?? 0
    cur.sum += v
    cur.max = Math.max(cur.max, v)
    cur.n += 1
    if (l.dataVenda) cur.data = l.dataVenda
    if ((l as any).clienteNome) {
      const nome = String((l as any).clienteNome ?? "").trim()
      if (nome) cur.clienteNome = nome
    }
    porPedido.set(l.pedido, cur)
  }

  const titulosVenda: CrRow[] = []
  for (const [pedido, agg] of porPedido) {
    const vencIso = agg.data ?? new Date().toISOString().slice(0, 10)
    // Se o valor do pedido veio repetido por item (linhas múltiplas), use o maior (evita multiplicar).
    const receita =
      agg.n > 1 && agg.max > 0 && agg.sum > agg.max * 1.05 ? agg.max : agg.sum
    const pago = Math.max(0, pedidosPagosValores.get(pedido) ?? 0)
    const saldo = Math.max(0, Math.round((receita - pago) * 100) / 100)
    const st: "pago" | "pendente" | "atrasado" =
      saldo <= 0.009 ? "pago" : statusVenda(pedido, vencIso, new Set()) // se há saldo, não força pago por lookup
    titulosVenda.push({
      id: `d360-v-${pedido}`,
      descricao: `Venda · Pedido ${pedido}`,
      cliente: agg.clienteNome ? agg.clienteNome : `Pedido ${pedido}`,
      // Em parcial, o valor do título é o saldo devedor (o que ainda falta receber).
      valor: Math.round((st === "pago" ? receita : saldo) * 100) / 100,
      vencimento: isoParaVencBr(vencIso),
      status: st,
      tipo: st === "pago" ? "Importação D360 · Vendas" : pago > 0 ? "Importação D360 · Vendas (Parcial)" : "Importação D360 · Vendas",
    })
  }

  const porOs = new Map<string, { sum: number; max: number; n: number; clienteNome?: string }>()
  for (const l of osPayload.linhas) {
    const k = String(l.osNumero ?? "").trim()
    if (!k) continue
    const cur = porOs.get(k) ?? { sum: 0, max: 0, n: 0 }
    const v = l.valorServico ?? 0
    cur.sum += v
    cur.max = Math.max(cur.max, v)
    cur.n += 1
    if ((l as any).clienteNome) {
      const nome = String((l as any).clienteNome ?? "").trim()
      if (nome) cur.clienteNome = nome
    }
    porOs.set(k, cur)
  }

  const titulosOs: CrRow[] = []
  for (const [numOs, agg] of porOs) {
    const hoje = new Date().toISOString().slice(0, 10)
    const total =
      agg.n > 1 && agg.max > 0 && agg.sum > agg.max * 1.05 ? agg.max : agg.sum
    const pago = Math.max(0, osPagosValores.get(numOs) ?? 0)
    const saldo = Math.max(0, Math.round((total - pago) * 100) / 100)
    const st: "pago" | "pendente" = saldo <= 0.009 ? "pago" : "pendente"
    titulosOs.push({
      id: `d360-os-${numOs}`,
      descricao: `OS ${numOs} · importação D360`,
      cliente: agg.clienteNome ? agg.clienteNome : `OS ${numOs}`,
      valor: Math.round((st === "pago" ? total : saldo) * 100) / 100,
      vencimento: isoParaVencBr(hoje),
      status: st,
      tipo: st === "pago" ? "Importação D360 · OS" : pago > 0 ? "Importação D360 · OS (Parcial)" : "Importação D360 · OS",
    })
  }

  const novosD360 = [...titulosVenda, ...titulosOs]
  const merged = [...semD360, ...novosD360]

  try {
    localStorage.setItem(key, JSON.stringify(merged))
    window.dispatchEvent(new Event("assistec-contas-receber-imported"))
  } catch {
    /* ignore */
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      "[Contas a Receber · sync D360]",
      `títulos gerados (d360): ${novosD360.length}`,
      `| total na tabela: ${merged.length}`,
      `| loja: ${lojaId}`
    )
  }

  return { titulosD360Gerados: novosD360.length, totalTitulosNaTabela: merged.length }
}
