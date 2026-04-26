"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"
import type { Orcamento } from "@/lib/orcamento-types"
import { normalizeDocDigits } from "@/lib/cpf"
import { OPS_KEY_LEGACY } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import type { DevolucaoRecord, PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"
import { isOsVirtualSaleLine } from "@/lib/os-pdv-virtual-lines"

export type { DevolucaoRecord, PaymentBreakdownFull, SaleLineRecord, SaleRecord } from "@/lib/operations-sale-types"

/** Variação de produto (tamanho, cor, sabor, etc.) */
export type ProdutoAtributoDef = {
  id: string
  nome: string
  opcoes: string[]
}

export interface InventoryItem {
  id: string
  name: string
  /** Código de barras (EAN/GTIN) — usado no PDV Alta Performance. */
  barcode?: string
  stock: number
  cost: number
  price: number
  category: string
  /** Se true, `price` é preço por kg; venda = preço/kg × peso da balança. */
  vendaPorPeso?: boolean
  /** Quando `vendaPorPeso`, deve refletir o mesmo que `price` (R$/kg). */
  precoPorKg?: number
  atributos?: ProdutoAtributoDef[]
}

export interface CaixaState {
  isOpen: boolean
  saldoInicial: number
  dataAbertura: Date | null
  totalEntradas: number
  totalSaidas: number
}

/** Resumo do dia para fechamento cego (por forma de pagamento). */
export interface DailyLedger {
  date: string
  vendasDinheiro: number
  vendasPix: number
  vendasCartaoDebito: number
  vendasCartaoCredito: number
  vendasCarne: number
  /** Valor de compras pagas com crédito/vale de troca (não é dinheiro físico). */
  vendasCreditoVale: number
  totalVendas: number
  osAbertas: number
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

function emptyLedger(): DailyLedger {
  return {
    date: todayStr(),
    vendasDinheiro: 0,
    vendasPix: 0,
    vendasCartaoDebito: 0,
    vendasCartaoCredito: 0,
    vendasCarne: 0,
    vendasCreditoVale: 0,
    totalVendas: 0,
    osAbertas: 0,
  }
}

/** Migra ledger antigo (vendasCartao) e garante campos novos. */
export function ensureLedger(ledger: DailyLedger | undefined): DailyLedger {
  const t = todayStr()
  if (!ledger || ledger.date !== t) return emptyLedger()
  const legacy = ledger as DailyLedger & { vendasCartao?: number }
  const oldC = legacy.vendasCartao ?? 0
  return {
    date: ledger.date,
    vendasDinheiro: ledger.vendasDinheiro ?? 0,
    vendasPix: ledger.vendasPix ?? 0,
    vendasCartaoDebito: (ledger.vendasCartaoDebito ?? 0) + oldC,
    vendasCartaoCredito: ledger.vendasCartaoCredito ?? 0,
    vendasCarne: ledger.vendasCarne ?? 0,
    vendasCreditoVale: ledger.vendasCreditoVale ?? 0,
    totalVendas: ledger.totalVendas ?? 0,
    osAbertas: ledger.osAbertas ?? 0,
  }
}

function normalizePaymentBreakdown(pb?: Partial<PaymentBreakdownFull> & { cartao?: number }): PaymentBreakdownFull {
  const legacyCartao = pb?.cartao ?? 0
  return {
    dinheiro: pb?.dinheiro ?? 0,
    pix: pb?.pix ?? 0,
    cartaoDebito: pb?.cartaoDebito ?? legacyCartao,
    cartaoCredito: pb?.cartaoCredito ?? 0,
    carne: pb?.carne ?? 0,
    aPrazo: pb?.aPrazo ?? 0,
    creditoVale: pb?.creditoVale ?? 0,
  }
}

function nextSaleId(sales: SaleRecord[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const s of sales) {
    const m = s.id.match(/^VDA-(\d{4})-(\d+)$/)
    if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10))
  }
  return `VDA-${year}-${String(max + 1).padStart(4, "0")}`
}

/** Mescla vendas do Postgres sem sobrescrever o que já veio do localStorage (mesmo `id`). */
function mergeSalesById(local: SaleRecord[], remote: SaleRecord[]): SaleRecord[] {
  const ids = new Set(local.map((s) => s.id))
  const extra = remote.filter((s) => s.id && !ids.has(s.id))
  if (extra.length === 0) return local
  return [...local, ...extra].sort((a, b) => a.at.localeCompare(b.at))
}

function nextDevolucaoId(list: DevolucaoRecord[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const d of list) {
    const m = d.id.match(/^DEV-(\d{4})-(\d+)$/)
    if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10))
  }
  return `DEV-${year}-${String(max + 1).padStart(4, "0")}`
}

type OpsState = {
  inventory: InventoryItem[]
  ordens: OrdemServico[]
  caixa: CaixaState
  dailyLedger: DailyLedger
  sales: SaleRecord[]
  devolucoes: DevolucaoRecord[]
  orcamentos: Orcamento[]
  /** chave = CPF/CNPJ só dígitos */
  customerCredits: Record<string, { nome: string; saldo: number }>
}

type SaleLine = {
  inventoryId: string
  quantity: number
}

const defaultState: OpsState = {
  inventory: [],
  ordens: [],
  caixa: {
    isOpen: false,
    saldoInicial: 0,
    dataAbertura: null,
    totalEntradas: 0,
    totalSaidas: 0,
  },
  dailyLedger: emptyLedger(),
  sales: [],
  devolucoes: [],
  orcamentos: [],
  customerCredits: {},
}

interface OperationsContextType {
  inventory: InventoryItem[]
  ordens: OrdemServico[]
  caixa: CaixaState
  dailyLedger: DailyLedger
  sales: SaleRecord[]
  devolucoes: DevolucaoRecord[]
  orcamentos: Orcamento[]
  customerCredits: Record<string, { nome: string; saldo: number }>
  setOrdens: React.Dispatch<React.SetStateAction<OrdemServico[]>>
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>
  setOrcamentos: React.Dispatch<React.SetStateAction<Orcamento[]>>
  abrirCaixa: (saldoInicial: number) => void
  fecharCaixa: () => void
  adicionarEntrada: (valor: number) => void
  adicionarSaida: (valor: number) => void
  getSaldoAtual: () => number
  incrementOsAbertasDia: () => void
  getSaldoCreditoCliente: (cpf: string) => number
  finalizeSaleTransaction: (input: {
    lines: Array<SaleLine & { name?: string; unitPrice?: number }>
    total: number
    linkedOsId?: string | null
    paymentBreakdown?: Partial<PaymentBreakdownFull> & { cartao?: number }
    customerCpf?: string
    customerName?: string
    openCaixaIfClosed?: boolean
    saldoInicialAoAbrir?: number
    auditMeta?: {
      cashierId?: string
      discountAuthorizedByAdminId?: string
      discountReais?: number
      discountPercent?: number
    }
  }) => { ok: true; saleId: string } | { ok: false; reason: string }
  registrarDevolucao: (input: {
    saleId: string
    lines: { inventoryId: string; quantity: number }[]
    mode: "vale_credito" | "somente_estoque"
    customerCpf: string
    customerName: string
  }) => { ok: true; devolucaoId: string; creditIssued: number } | { ok: false; reason: string }
}

const OperationsContext = createContext<OperationsContextType | null>(null)

/** Restaurado só do localStorage (estoque e OS vêm do servidor). */
function parseLocalRest(raw: string, prev: OpsState): Partial<OpsState> | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OpsState>
    return {
      dailyLedger: parsed.dailyLedger ? ensureLedger(parsed.dailyLedger as DailyLedger) : prev.dailyLedger,
      caixa: {
        ...prev.caixa,
        ...parsed.caixa,
        dataAbertura: parsed.caixa?.dataAbertura ? new Date(parsed.caixa.dataAbertura) : prev.caixa.dataAbertura,
      },
      sales: Array.isArray(parsed.sales) ? parsed.sales : prev.sales,
      devolucoes: Array.isArray(parsed.devolucoes) ? parsed.devolucoes : prev.devolucoes,
      customerCredits:
        parsed.customerCredits && typeof parsed.customerCredits === "object"
          ? parsed.customerCredits
          : prev.customerCredits,
      orcamentos: Array.isArray(parsed.orcamentos) ? parsed.orcamentos : prev.orcamentos,
    }
  } catch {
    return null
  }
}

function peekLegacyInventoryOrdens(raw: string | null): { inventory: InventoryItem[]; ordens: OrdemServico[] } {
  if (!raw) return { inventory: [], ordens: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<OpsState>
    return {
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      ordens: Array.isArray(parsed.ordens) ? parsed.ordens : [],
    }
  } catch {
    return { inventory: [], ordens: [] }
  }
}

function toPersistedRest(state: OpsState): Omit<OpsState, "inventory" | "ordens"> {
  return {
    caixa: state.caixa,
    dailyLedger: state.dailyLedger,
    sales: state.sales,
    devolucoes: state.devolucoes,
    orcamentos: state.orcamentos,
    customerCredits: state.customerCredits,
  }
}

export function OperationsProvider({
  children,
  storageKey = OPS_KEY_LEGACY,
}: {
  children: ReactNode
  /** Por unidade (multiloja); padrão único = assistec-pro-ops-v1 */
  storageKey?: string
}) {
  const [state, setState] = useState<OpsState>({
    ...defaultState,
    dailyLedger: emptyLedger(),
  })
  const [opsDbReady, setOpsDbReady] = useState(false)
  const stateRef = useRef(state)
  const lastSentOpsRef = useRef<string>("")

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const partial = parseLocalRest(raw, stateRef.current)
        if (partial) {
          setState((prev) => ({ ...prev, ...partial }))
        }
        return
      }
      if (storageKey !== OPS_KEY_LEGACY && storageKey.endsWith(`-${LEGACY_PRIMARY_STORE_ID}`)) {
        const legacy = localStorage.getItem(OPS_KEY_LEGACY)
        if (legacy) {
          const partial = parseLocalRest(legacy, stateRef.current)
          if (partial) {
            setState((prev) => ({ ...prev, ...partial }))
            localStorage.setItem(storageKey, legacy)
          }
        }
      }
    } catch {
      // ignore
    }
  }, [storageKey])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(toPersistedRest(state)))
    } catch {
      // ignore
    }
  }, [state, storageKey])

  useEffect(() => {
    setOpsDbReady(false)
    let cancelled = false
    async function loadDb() {
      const lj = opsLojaIdFromStorageKey(storageKey)
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-assistec-loja-id": lj,
      }
      try {
        const [rInv, rOs] = await Promise.all([
          fetch(`/api/ops/inventory?lojaId=${encodeURIComponent(lj)}`, { credentials: "include" }),
          fetch(`/api/ops/ordens?lojaId=${encodeURIComponent(lj)}`, { credentials: "include" }),
        ])
        if (cancelled) return
        if (!rInv.ok || !rOs.ok) {
          lastSentOpsRef.current = JSON.stringify({
            inv: stateRef.current.inventory,
            ord: stateRef.current.ordens,
          })
          return
        }
        const jInv = (await rInv.json()) as { items?: InventoryItem[] }
        const jOs = (await rOs.json()) as { ordens?: OrdemServico[] }
        let items = jInv.items ?? []
        let ordens = jOs.ordens ?? []

        if (items.length === 0 && ordens.length === 0) {
          const raw = localStorage.getItem(storageKey)
          const peek = peekLegacyInventoryOrdens(raw)
          const legInv = peek.inventory
          const legOrd = peek.ordens
          if (legInv.length > 0 || legOrd.length > 0) {
            await fetch("/api/ops/inventory", {
              method: "PUT",
              credentials: "include",
              headers,
              body: JSON.stringify({ items: legInv }),
            })
            await fetch("/api/ops/ordens", {
              method: "PUT",
              credentials: "include",
              headers,
              body: JSON.stringify({ ordens: legOrd }),
            })
            items = legInv
            ordens = legOrd
          }
        }

        const snap = JSON.stringify({ inv: items, ord: ordens })
        lastSentOpsRef.current = snap

        let remoteSales: SaleRecord[] = []
        try {
          const rV = await fetch(`/api/ops/vendas-list?lojaId=${encodeURIComponent(lj)}`, {
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              [ASSISTEC_LOJA_HEADER]: lj,
            },
          })
          if (rV.ok) {
            const jV = (await rV.json()) as { sales?: SaleRecord[] }
            remoteSales = jV.sales ?? []
          }
        } catch {
          /* ignore */
        }

        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            inventory: items,
            ordens,
            sales: mergeSalesById(prev.sales, remoteSales),
          }))
        }
      } catch {
        if (!cancelled) {
          lastSentOpsRef.current = JSON.stringify({
            inv: stateRef.current.inventory,
            ord: stateRef.current.ordens,
          })
        }
      } finally {
        if (!cancelled) {
          setOpsDbReady(true)
        }
      }
    }
    void loadDb()
    return () => {
      cancelled = true
    }
  }, [storageKey])

  useEffect(() => {
    if (!opsDbReady) return
    const snap = JSON.stringify({ inv: state.inventory, ord: state.ordens })
    if (snap === lastSentOpsRef.current) return
    const t = setTimeout(() => {
      lastSentOpsRef.current = snap
      const lj = opsLojaIdFromStorageKey(storageKey)
      const headers: HeadersInit = {
        "Content-Type": "application/json",
        "x-assistec-loja-id": lj,
      }
      void fetch("/api/ops/inventory", {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({ items: state.inventory }),
      }).catch(() => {})
      void fetch("/api/ops/ordens", {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({ ordens: state.ordens }),
      }).catch(() => {})
    }, 750)
    return () => clearTimeout(t)
  }, [opsDbReady, state.inventory, state.ordens, storageKey])

  const ledgerKey = JSON.stringify(state.dailyLedger)
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        try {
          const lj = opsLojaIdFromStorageKey(storageKey)
          const res = await fetch("/api/ops/sync-ledger", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              [ASSISTEC_LOJA_HEADER]: lj,
            },
            body: ledgerKey,
          })
          if (cancelled) return
          if (!res.ok && process.env.NODE_ENV === "development") {
            const txt = await res.text().catch(() => "")
            console.warn("[ops] sync-ledger HTTP", res.status, txt)
          }
        } catch (e) {
          if (!cancelled && process.env.NODE_ENV === "development") {
            console.warn("[ops] sync-ledger", e)
          }
        }
      })()
    }, 1200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [ledgerKey, storageKey])

  const setOrdens: OperationsContextType["setOrdens"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      ordens: typeof updater === "function" ? (updater as (value: OrdemServico[]) => OrdemServico[])(prev.ordens) : updater,
    }))
  }, [])

  const setInventory: OperationsContextType["setInventory"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      inventory:
        typeof updater === "function"
          ? (updater as (value: InventoryItem[]) => InventoryItem[])(prev.inventory)
          : updater,
    }))
  }, [])

  const setOrcamentos: OperationsContextType["setOrcamentos"] = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      orcamentos:
        typeof updater === "function"
          ? (updater as (value: Orcamento[]) => Orcamento[])(prev.orcamentos)
          : updater,
    }))
  }, [])

  const abrirCaixa = useCallback((saldoInicial: number) => {
    setState((prev) => ({
      ...prev,
      caixa: {
        isOpen: true,
        saldoInicial,
        dataAbertura: new Date(),
        totalEntradas: 0,
        totalSaidas: 0,
      },
    }))
  }, [])

  const fecharCaixa = useCallback(() => {
    setState((prev) => ({
      ...prev,
      caixa: {
        isOpen: false,
        saldoInicial: 0,
        dataAbertura: null,
        totalEntradas: 0,
        totalSaidas: 0,
      },
    }))
  }, [])

  const adicionarEntrada = useCallback((valor: number) => {
    setState((prev) => ({
      ...prev,
      caixa: { ...prev.caixa, totalEntradas: prev.caixa.totalEntradas + valor },
    }))
  }, [])

  const adicionarSaida = useCallback((valor: number) => {
    setState((prev) => ({
      ...prev,
      caixa: { ...prev.caixa, totalSaidas: prev.caixa.totalSaidas + valor },
    }))
  }, [])

  const getSaldoAtual = useCallback(() => {
    const c = stateRef.current.caixa
    return c.saldoInicial + c.totalEntradas - c.totalSaidas
  }, [])

  const getSaldoCreditoCliente = useCallback((cpf: string) => {
    const k = normalizeDocDigits(cpf)
    if (!k) return 0
    return stateRef.current.customerCredits[k]?.saldo ?? 0
  }, [])

  const incrementOsAbertasDia = useCallback(() => {
    setState((prev) => {
      const dailyLedger = ensureLedger(prev.dailyLedger)
      dailyLedger.osAbertas += 1
      return { ...prev, dailyLedger }
    })
  }, [])

  const finalizeSaleTransaction = useCallback<OperationsContextType["finalizeSaleTransaction"]>(
    ({
      lines,
      total,
      linkedOsId,
      paymentBreakdown,
      customerCpf,
      customerName,
      openCaixaIfClosed,
      saldoInicialAoAbrir,
      auditMeta,
    }) => {
      const current = stateRef.current
      const next: OpsState = {
        inventory: current.inventory.map((i) => ({ ...i })),
        ordens: current.ordens.map((o) => ({ ...o })),
        caixa: { ...current.caixa },
        dailyLedger: ensureLedger(current.dailyLedger),
        sales: [...current.sales],
        devolucoes: [...current.devolucoes],
        orcamentos: [...current.orcamentos],
        customerCredits: { ...current.customerCredits },
      }

      if (!next.caixa.isOpen) {
        if (openCaixaIfClosed) {
          next.caixa = {
            isOpen: true,
            saldoInicial: saldoInicialAoAbrir ?? 0,
            dataAbertura: new Date(),
            totalEntradas: 0,
            totalSaidas: 0,
          }
        } else {
          return { ok: false, reason: "Caixa fechado." }
        }
      }

      for (const line of lines) {
        if (isOsVirtualSaleLine(line.inventoryId)) {
          if (line.quantity <= 0) return { ok: false, reason: "Quantidade inválida." }
          continue
        }
        const item = next.inventory.find((i) => i.id === line.inventoryId)
        if (!item) return { ok: false, reason: `Item de estoque não encontrado: ${line.inventoryId}` }
        if (line.quantity <= 0) return { ok: false, reason: "Quantidade inválida." }
        if (item.stock < line.quantity) {
          return { ok: false, reason: `Estoque insuficiente para ${item.name}.` }
        }
      }

      if (linkedOsId) {
        const os = next.ordens.find((o) => o.id === linkedOsId)
        if (!os) return { ok: false, reason: "O.S. vinculada não encontrada." }
      }

      const pb = normalizePaymentBreakdown(paymentBreakdown)
      const sumPb =
        pb.dinheiro +
        pb.pix +
        pb.cartaoDebito +
        pb.cartaoCredito +
        pb.carne +
        pb.aPrazo +
        pb.creditoVale
      if (Math.abs(sumPb - total) > 0.02) {
        return { ok: false, reason: "Soma das formas de pagamento difere do total." }
      }

      const cpfNorm = customerCpf ? normalizeDocDigits(customerCpf) : ""
      if (pb.aPrazo > 0 && !cpfNorm) {
        return { ok: false, reason: "Selecione o cliente (com CPF) para venda à prazo em Contas a Receber." }
      }
      if (pb.creditoVale > 0) {
        if (!cpfNorm) return { ok: false, reason: "Informe o cliente (CPF) para usar crédito/vale." }
        const saldo = next.customerCredits[cpfNorm]?.saldo ?? 0
        if (pb.creditoVale > saldo + 0.01) {
          return { ok: false, reason: "Saldo de crédito insuficiente." }
        }
        const nome = customerName?.trim() || next.customerCredits[cpfNorm]?.nome || "Cliente"
        next.customerCredits[cpfNorm] = {
          nome,
          saldo: Math.round((saldo - pb.creditoVale) * 100) / 100,
        }
      }

      for (const line of lines) {
        if (isOsVirtualSaleLine(line.inventoryId)) continue
        const item = next.inventory.find((i) => i.id === line.inventoryId)!
        item.stock -= line.quantity
      }

      next.caixa.totalEntradas += total

      next.dailyLedger.totalVendas += total
      next.dailyLedger.vendasDinheiro += pb.dinheiro
      next.dailyLedger.vendasPix += pb.pix
      next.dailyLedger.vendasCartaoDebito += pb.cartaoDebito
      next.dailyLedger.vendasCartaoCredito += pb.cartaoCredito
      next.dailyLedger.vendasCarne += pb.carne + pb.aPrazo
      next.dailyLedger.vendasCreditoVale += pb.creditoVale

      const saleId = nextSaleId(next.sales)
      const saleLines: SaleLineRecord[] = lines.map((ln) => {
        if (isOsVirtualSaleLine(ln.inventoryId)) {
          const unit = typeof ln.unitPrice === "number" && Number.isFinite(ln.unitPrice) ? ln.unitPrice : 0
          return {
            inventoryId: ln.inventoryId,
            name: (typeof ln.name === "string" && ln.name.trim()) || "Serviço O.S.",
            quantity: ln.quantity,
            unitPrice: unit,
            lineTotal: Math.round(unit * ln.quantity * 100) / 100,
            qtyReturned: 0,
          }
        }
        const item = next.inventory.find((i) => i.id === ln.inventoryId)!
        const unit = ln.unitPrice ?? item.price
        return {
          inventoryId: ln.inventoryId,
          name: ln.name ?? item.name,
          quantity: ln.quantity,
          unitPrice: unit,
          lineTotal: Math.round(unit * ln.quantity * 100) / 100,
          qtyReturned: 0,
        }
      })
      next.sales.push({
        id: saleId,
        at: new Date().toISOString(),
        lines: saleLines,
        total,
        customerCpf: cpfNorm || undefined,
        customerName: customerName?.trim() || undefined,
        paymentBreakdown: pb,
        cashierId: auditMeta?.cashierId,
        discountAuthorizedByAdminId: auditMeta?.discountAuthorizedByAdminId,
        discountReais: auditMeta?.discountReais,
        discountPercent: auditMeta?.discountPercent,
      })

      if (linkedOsId) {
        next.ordens = next.ordens.map((o) =>
          o.id === linkedOsId
            ? {
                ...o,
                status: "finalizado",
                dataSaida: new Date().toISOString().split("T")[0],
                horaSaida: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
              }
            : o
        )
      }

      setState(next)
      const lj = opsLojaIdFromStorageKey(storageKey)
      const saleRow = next.sales[next.sales.length - 1]
      if (saleRow) {
        void fetch("/api/ops/venda-persist", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            [ASSISTEC_LOJA_HEADER]: lj,
          },
          body: JSON.stringify({ sale: saleRow }),
        }).catch(() => {})
      }
      return { ok: true, saleId }
    },
    [storageKey]
  )

  const registrarDevolucao = useCallback<OperationsContextType["registrarDevolucao"]>((input) => {
    const { saleId, lines, mode, customerCpf, customerName } = input
    const k = normalizeDocDigits(customerCpf)
    if (!k) return { ok: false, reason: "CPF/CNPJ do cliente obrigatório." }

    const prev = stateRef.current
    const sale = prev.sales.find((s) => s.id === saleId)
    if (!sale) return { ok: false, reason: "Venda/cupom não encontrado." }

    const next: OpsState = {
      ...prev,
      inventory: prev.inventory.map((i) => ({ ...i })),
      sales: prev.sales.map((s) =>
        s.id === saleId ? { ...s, lines: s.lines.map((l) => ({ ...l })) } : { ...s }
      ),
      devolucoes: [...prev.devolucoes],
      customerCredits: { ...prev.customerCredits },
    }

    const saleCopy = next.sales.find((s) => s.id === saleId)!
    let creditIssued = 0
    const outLines: DevolucaoRecord["lines"] = []

    for (const req of lines) {
      const saleLine = saleCopy.lines.find((l) => l.inventoryId === req.inventoryId)
      if (!saleLine) {
        return { ok: false, reason: `Item não consta na venda: ${req.inventoryId}` }
      }
      const already = saleLine.qtyReturned ?? 0
      const canReturn = saleLine.quantity - already
      if (req.quantity <= 0) {
        return { ok: false, reason: "Quantidade inválida." }
      }
      if (canReturn < req.quantity) {
        return { ok: false, reason: `Devolução maior que o disponível para ${saleLine.name}.` }
      }
      const inv = next.inventory.find((i) => i.id === req.inventoryId)
      if (!inv) return { ok: false, reason: "Produto não está mais no cadastro de estoque." }

      const unit = saleLine.lineTotal / saleLine.quantity
      const valor = Math.round(unit * req.quantity * 100) / 100
      inv.stock += req.quantity
      saleLine.qtyReturned = already + req.quantity
      creditIssued += mode === "vale_credito" ? valor : 0
      outLines.push({
        inventoryId: req.inventoryId,
        name: saleLine.name,
        quantity: req.quantity,
        valor,
      })
    }

    if (outLines.length === 0) {
      return { ok: false, reason: "Nenhuma linha de devolução válida." }
    }

    const devolucaoId = nextDevolucaoId(next.devolucoes)
    if (mode === "vale_credito" && creditIssued > 0) {
      const cur = next.customerCredits[k]?.saldo ?? 0
      const nome = customerName.trim() || next.customerCredits[k]?.nome || "Cliente"
      next.customerCredits[k] = {
        nome,
        saldo: Math.round((cur + creditIssued) * 100) / 100,
      }
    }

    next.devolucoes.push({
      id: devolucaoId,
      at: new Date().toISOString(),
      saleId,
      customerCpf: k,
      customerName: customerName.trim(),
      lines: outLines,
      mode,
      creditIssued: mode === "vale_credito" ? creditIssued : 0,
    })

    setState(next)
    return { ok: true, devolucaoId, creditIssued: mode === "vale_credito" ? creditIssued : 0 }
  }, [])

  const value = useMemo<OperationsContextType>(
    () => ({
      inventory: state.inventory,
      ordens: state.ordens,
      caixa: state.caixa,
      dailyLedger: state.dailyLedger,
      sales: state.sales,
      devolucoes: state.devolucoes,
      orcamentos: state.orcamentos,
      customerCredits: state.customerCredits,
      setOrdens,
      setInventory,
      setOrcamentos,
      abrirCaixa,
      fecharCaixa,
      adicionarEntrada,
      adicionarSaida,
      getSaldoAtual,
      incrementOsAbertasDia,
      getSaldoCreditoCliente,
      finalizeSaleTransaction,
      registrarDevolucao,
    }),
    [
      state,
      setOrdens,
      setInventory,
      setOrcamentos,
      abrirCaixa,
      fecharCaixa,
      adicionarEntrada,
      adicionarSaida,
      getSaldoAtual,
      incrementOsAbertasDia,
      getSaldoCreditoCliente,
      finalizeSaleTransaction,
      registrarDevolucao,
    ]
  )

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}

export function useOperationsStore() {
  const ctx = useContext(OperationsContext)
  if (!ctx) {
    throw new Error("useOperationsStore must be used within OperationsProvider")
  }
  return ctx
}
