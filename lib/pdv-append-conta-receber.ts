"use client"

import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import type { ContaReceberRow } from "@/lib/contas-receber-types"
import { contasReceberStorageKey } from "@/lib/contas-receber-storage"

/**
 * Cria/atualiza um título em Contas a Receber para valor “à prazo” de venda PDV
 * (localStorage + espelho em `/api/ops/contas-receber-persist`).
 */
export function appendContaReceberTituloPdvAprazo(params: {
  lojaId: string
  saleId: string
  clienteNome: string
  valor: number
}): void {
  if (typeof window === "undefined") return
  const valor = Math.round(params.valor * 100) / 100
  if (!(valor > 0)) return

  const k = contasReceberStorageKey(params.lojaId)
  let rows: ContaReceberRow[] = []
  try {
    const raw = localStorage.getItem(k)
    if (raw) {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) rows = p as ContaReceberRow[]
    }
  } catch {
    rows = []
  }

  const venc = new Date()
  venc.setDate(venc.getDate() + 30)
  const id = `pdv-aprazo-${params.saleId}`
  const row: ContaReceberRow = {
    id,
    descricao: `Venda PDV ${params.saleId} — À prazo`,
    cliente: (params.clienteNome || "Cliente").trim(),
    valor,
    vencimento: venc.toLocaleDateString("pt-BR"),
    status: "pendente",
    tipo: "pdv_aprazo",
    total_value: valor,
    vendas: [{ saleId: params.saleId, total: valor }],
  }

  const next = [...rows.filter((r) => String(r.id) !== id), row]
  try {
    localStorage.setItem(k, JSON.stringify(next))
  } catch {
    return
  }

  void fetch("/api/ops/contas-receber-persist", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [ASSISTEC_LOJA_HEADER]: params.lojaId,
    },
    body: JSON.stringify({ rows: [row] }),
  }).catch(() => {})

  window.dispatchEvent(new Event("assistec-contas-receber-imported"))
}
