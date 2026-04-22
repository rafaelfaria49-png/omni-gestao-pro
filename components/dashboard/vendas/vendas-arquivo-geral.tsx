"use client"

import { useEffect, useMemo, useState } from "react"
import { Banknote, MoreHorizontal, RotateCcw, Search, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { contasReceberStorageKey } from "@/lib/contas-receber-storage"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { opsLojaIdFromStorageKey } from "@/lib/ops-loja-id"
import { useOperationsStore, type SaleRecord } from "@/lib/operations-store"
import type { ContaReceberRow } from "@/lib/contas-receber-types"

type HistoricoItem =
  | { kind: "pdv"; id: string; at: string; cliente: string; valor: number; status: "pago"; ref: SaleRecord }
  | {
      kind: "financeiro"
      id: string
      at: string
      cliente: string
      valor: number
      status: "pago" | "pendente" | "atrasado"
      ref: ContaReceberRow
    }

function normTxt(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function formatBrl(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function parseBrDateToIsoLike(br: string): string {
  const m = String(br || "")
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return ""
  return `${m[3]}-${m[2]}-${m[1]}`
}

function extractSaleIdFromDescricao(desc: string): string | null {
  const t = String(desc || "").trim()
  const m = t.match(/\b(VDA-\d{4}-\d{4,})\b/i)
  if (m?.[1]) return m[1].toUpperCase()
  const m2 = t.match(/^venda\s+(.+)$/i)
  if (m2?.[1]) return m2[1].trim()
  return null
}

export function VendasArquivoGeral(props: { onNavigateToTrocas?: (saleId: string) => void }) {
  const { toast } = useToast()
  const { lojaAtivaId, opsStorageKey } = useLojaAtiva()
  const lojaKey = lojaAtivaId ?? opsLojaIdFromStorageKey(opsStorageKey)
  const { sales } = useOperationsStore()
  const [busca, setBusca] = useState("")
  const [contasVersion, setContasVersion] = useState(0)

  useEffect(() => {
    const on = () => setContasVersion((x) => x + 1)
    window.addEventListener("assistec-contas-receber-imported", on)
    return () => window.removeEventListener("assistec-contas-receber-imported", on)
  }, [])

  const list = useMemo(() => {
    const q = normTxt(busca)
    const out: HistoricoItem[] = []

    for (const s of sales ?? []) {
      out.push({
        kind: "pdv",
        id: s.id,
        at: s.at,
        cliente: (s.customerName || "Cliente").trim() || "Cliente",
        valor: Math.round((s.total || 0) * 100) / 100,
        status: "pago",
        ref: s,
      })
    }

    try {
      const key = contasReceberStorageKey(lojaKey)
      const raw = localStorage.getItem(key)
      const contas = raw ? (JSON.parse(raw) as ContaReceberRow[]) : []
      if (Array.isArray(contas)) {
        for (const c of contas) {
          const iso = parseBrDateToIsoLike(c.vencimento)
          out.push({
            kind: "financeiro",
            id: String(c.id),
            at: iso ? `${iso}T12:00:00.000Z` : new Date().toISOString(),
            cliente: (c.cliente || "—").trim() || "—",
            valor: Math.round((Number(c.valor) || 0) * 100) / 100,
            status: (String(c.status || "").toLowerCase() as any) || "pendente",
            ref: c,
          })
        }
      }
    } catch {
      // ignore
    }

    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    if (!q) return out
    return out.filter((it) => {
      const id = normTxt(it.kind === "pdv" ? it.ref.id : it.ref.descricao)
      const nome = normTxt(it.cliente)
      return id.includes(q) || nome.includes(q)
    })
  }, [sales, busca, lojaKey, contasVersion])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    console.log("[vendas-arquivo] DADOS_RECEBIDOS:", {
      lojaKey,
      opsStorageKey,
      salesLen: sales?.length ?? 0,
      listLen: list.length,
      storageKeyContas: contasReceberStorageKey(lojaKey),
    })
  }, [lojaKey, opsStorageKey, sales, list.length, contasVersion])

  const criarContaReceber = (sale: SaleRecord) => {
    try {
      const key = contasReceberStorageKey(lojaKey)
      const raw = localStorage.getItem(key)
      const prev = raw ? (JSON.parse(raw) as any[]) : []
      const cliente = (sale.customerName || "Cliente").trim() || "Cliente"
      const row = {
        id: `cr-sale-${sale.id}-${Date.now()}`,
        descricao: `Venda ${sale.id}`,
        cliente,
        valor: Math.round((sale.total || 0) * 100) / 100,
        vencimento: new Date().toLocaleDateString("pt-BR"),
        status: "pendente",
        tipo: "Venda (arquivo geral)",
      }
      localStorage.setItem(key, JSON.stringify([row, ...prev]))
      window.dispatchEvent(new Event("assistec-contas-receber-imported"))
      toast({ title: "Conta a receber criada", description: `${cliente} — ${formatBrl(row.valor)}` })
    } catch {
      toast({ title: "Não foi possível criar", variant: "destructive" })
    }
  }

  const abrirTroca = (it: HistoricoItem) => {
    const saleId = it.kind === "pdv" ? it.ref.id : extractSaleIdFromDescricao(it.ref.descricao) ?? it.ref.descricao
    props.onNavigateToTrocas?.(saleId)
  }

  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Histórico de Vendas</CardTitle>
          <CardDescription>Base central: PDV + Financeiro (Contas a Receber), com status real.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <Label className="text-xs text-black/70" htmlFor="vda-busca">
              Buscar por cliente / pedido / venda
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/70" />
              <Input
                id="vda-busca"
                className="pl-10 w-72"
                placeholder="Ex: Nome do cliente ou ID da venda"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-black/70">Total: {list.length} item(ns)</p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {list.map((it) => (
          <div
            key={`${it.kind}-${it.id}`}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">
                {it.kind === "pdv" ? it.ref.id : it.ref.descricao}
                <span className="ml-2 text-[11px] text-black/70">{it.kind === "pdv" ? "PDV" : "Financeiro"}</span>
              </p>
              <div className="flex items-center gap-2 text-sm text-black/70 flex-wrap">
                <User className="w-3 h-3" />
                <span className="truncate text-black">{it.cliente}</span>
                <span className="text-xs">· {new Date(it.at).toLocaleString("pt-BR")}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <div className="text-right">
                <p className="font-semibold text-black">{formatBrl(it.valor || 0)}</p>
                <p className="text-[11px] text-black/70">{String(it.status).toUpperCase()}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => abrirTroca(it)}>
                <RotateCcw className="w-4 h-4 mr-1" />
                Troca/Devolução
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Ações">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onClick={() => (it.kind === "pdv" ? criarContaReceber(it.ref) : null)} disabled={it.kind !== "pdv"}>
                    <Banknote className="w-4 h-4 mr-2" />
                    Transformar em conta pendente
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => abrirTroca(it)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Abrir troca/devolução
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
        {list.length === 0 ? (
          <p className="text-sm text-black/70 rounded-lg border border-dashed border-border p-6 text-center leading-relaxed">
            Nenhum registro nesta visão. Esta lista usa vendas do PDV (armazenamento local) e títulos de Contas a Receber
            da unidade <span className="font-mono text-xs">{lojaKey}</span> — não o catálogo de produtos do banco (estoque).
          </p>
        ) : null}
      </div>
    </div>
  )
}

