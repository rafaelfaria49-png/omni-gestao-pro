"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Pencil, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { digitsToMoneyBrString, formatFloatToMoneyBr, parseMoneyBrToNumber } from "@/lib/money-br"
import { useToast } from "@/hooks/use-toast"

type ProdutoRow = {
  id: string
  name: string
  stock: number
  price: number
  createdAt: string
}

const toastRafacell = {
  className: "border-red-600/45 bg-zinc-950 text-white shadow-xl shadow-red-900/20",
  duration: 4000,
}

function formatPriceTable(n: number) {
  if (!Number.isFinite(n)) return "-"
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

async function fetchProdutos(q: string): Promise<ProdutoRow[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
  const r = await fetch(`/api/produtos${qs}`, { cache: "no-store" })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  const j = (await r.json()) as {
    produtos: Array<{ id: string; name: string; stock: number; price: number; createdAt: string | Date }>
  }
  return j.produtos.map((p) => ({
    id: p.id,
    name: p.name,
    stock: p.stock,
    price: p.price,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date(p.createdAt).toISOString(),
  }))
}

async function createProduto(payload: { name: string; stock: number; price: number }): Promise<void> {
  const r = await fetch("/api/produtos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function updateProduto(id: string, payload: { name: string; stock: number; price: number }): Promise<void> {
  const r = await fetch(`/api/produtos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function deleteProduto(id: string): Promise<void> {
  const r = await fetch(`/api/produtos/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

export default function DashboardEstoquePage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [rows, setRows] = useState<ProdutoRow[]>([])

  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [stockStr, setStockStr] = useState("")
  const [priceStr, setPriceStr] = useState("")

  const [deleteTarget, setDeleteTarget] = useState<ProdutoRow | null>(null)

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError(null)
    void fetchProdutos(query)
      .then((data) => {
        if (cancelled) return
        setRows(data)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setListError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  const parsedStock = useMemo(() => {
    const n = parseInt(stockStr.replace(/\D/g, ""), 10)
    return Number.isFinite(n) ? n : NaN
  }, [stockStr])

  const parsedPrice = useMemo(() => parseMoneyBrToNumber(priceStr), [priceStr])

  const canSubmit =
    name.trim().length > 0 &&
    Number.isFinite(parsedStock) &&
    parsedStock >= 0 &&
    Number.isFinite(parsedPrice) &&
    parsedPrice >= 0 &&
    !submitting

  const reload = async () => {
    setLoading(true)
    try {
      const data = await fetchProdutos(query)
      setRows(data)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setFormError(null)
    setModalMode("create")
    setEditingId(null)
    setName("")
    setStockStr("0")
    setPriceStr(formatFloatToMoneyBr(0))
    setModalOpen(true)
  }

  const openEditModal = (row: ProdutoRow) => {
    setFormError(null)
    setModalMode("edit")
    setEditingId(row.id)
    setName(row.name)
    setStockStr(String(row.stock))
    setPriceStr(formatFloatToMoneyBr(row.price))
    setModalOpen(true)
  }

  const closeModal = () => {
    if (submitting) return
    setModalOpen(false)
  }

  const onPriceChange = (raw: string) => {
    setPriceStr(digitsToMoneyBrString(raw))
  }

  const submit = async () => {
    const n = name.trim()
    if (!n) {
      setFormError('O campo "Nome" é obrigatório.')
      return
    }
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      setFormError("Informe uma quantidade em estoque válida (inteiro ≥ 0).")
      return
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError("Informe um preço válido.")
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (modalMode === "edit" && editingId) {
        await updateProduto(editingId, { name: n, stock: parsedStock, price: parsedPrice })
        toast({
          title: "Produto atualizado",
          description: `${n} foi salvo com sucesso.`,
          ...toastRafacell,
        })
      } else {
        await createProduto({ name: n, stock: parsedStock, price: parsedPrice })
        toast({
          title: "Produto cadastrado",
          description: `${n} foi adicionado ao estoque.`,
          ...toastRafacell,
        })
      }
      setModalOpen(false)
      await reload()
    } catch (e2) {
      setFormError(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProduto(deleteTarget.id)
      toast({
        title: "Produto excluído",
        description: `${deleteTarget.name} foi removido.`,
        ...toastRafacell,
      })
      setDeleteTarget(null)
      await reload()
    } catch (e2) {
      setDeleteError(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">Estoque</h1>
            <p className="text-sm text-black/70">Peças e produtos</p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="h-10 rounded-md bg-red-600 px-4 text-white transition-colors hover:bg-red-500 active:bg-red-700"
          >
            Novo Produto
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <label className="text-sm text-black/70">Buscar por nome da peça</label>
              <div className="mt-1 flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setQuery(search)
                  }}
                  placeholder="Ex.: Tela iPhone"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
                <button
                  type="button"
                  onClick={() => setQuery(search)}
                  className="h-10 rounded-md border border-border bg-background px-4 text-black transition-colors hover:bg-muted"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("")
                    setQuery("")
                  }}
                  className="h-10 rounded-md border border-border bg-background px-4 text-black/70 transition-colors hover:bg-muted"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="text-sm text-black/70">{loading ? "Carregando…" : `${filteredRows.length} produto(s)`}</div>
          </div>

          {listError ? (
            <div className="mt-4 rounded-md border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">{listError}</div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-background/60">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold text-black">Nome do Produto</th>
                  <th className="px-4 py-3 font-semibold text-black">Quantidade em Estoque</th>
                  <th className="px-4 py-3 font-semibold text-black">Preço de Venda</th>
                  <th className="px-4 py-3 text-right font-semibold text-black">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-black/70">
                      Carregando lista…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-black/70">
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const zero = r.stock === 0
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-t border-border transition-colors hover:bg-muted/40",
                          zero && "bg-red-950/20"
                        )}
                      >
                        <td className={cn("px-4 py-3 text-black", zero && "font-medium text-red-200/95")}>{r.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {zero ? (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                            ) : null}
                            <span className={cn("tabular-nums", zero ? "font-semibold text-amber-400" : "text-black")}>
                              {r.stock}
                            </span>
                            {zero ? (
                              <span className="text-xs font-medium uppercase tracking-wide text-red-400/90">Esgotado</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-black">{formatPriceTable(r.price)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(r)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-600/60 bg-transparent px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/15"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null)
                                setDeleteTarget(r)
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-800/70 bg-red-950/40 px-3 text-xs font-medium text-red-200 transition-colors hover:bg-red-900/50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  {modalMode === "edit" ? "Editar Produto" : "Novo Produto"}
                </h2>
                <p className="text-sm text-black/70">
                  {modalMode === "edit" ? "Atualize nome, estoque e preço de venda." : "Cadastre a peça e o valor de venda."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="h-9 w-9 rounded-md border border-border bg-background text-black/70 transition-colors hover:bg-muted"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm text-black/70">
                  Nome da peça <span className="text-red-400">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Tela com touch"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>
              <div>
                <label className="text-sm text-black/70">
                  Quantidade em estoque <span className="text-red-400">*</span>
                </label>
                <input
                  value={stockStr}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "")
                    setStockStr(v === "" ? "" : String(parseInt(v, 10)))
                  }}
                  placeholder="0"
                  inputMode="numeric"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black tabular-nums placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>
              <div>
                <label className="text-sm text-black/70">
                  Preço de venda <span className="text-red-400">*</span>
                </label>
                <input
                  value={priceStr}
                  onChange={(e) => onPriceChange(e.target.value)}
                  placeholder="R$ 0,00"
                  inputMode="decimal"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
                <p className="mt-1 text-xs text-black/70">Valor salvo no banco como número (centavos precisos).</p>
              </div>
            </div>

            {formError ? (
              <div className="mt-4 rounded-md border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">{formError}</div>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="h-10 rounded-md border border-border bg-background px-4 text-black transition-colors hover:bg-muted"
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                className="h-10 rounded-md bg-red-600 px-4 text-white transition-colors hover:bg-red-500 active:bg-red-700 disabled:opacity-60"
                disabled={!canSubmit}
              >
                {submitting ? "Salvando…" : modalMode === "edit" ? "Salvar alterações" : "Cadastrar Produto"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {deleteTarget ? (
                <>
                  Tem certeza que deseja excluir <span className="font-medium text-black">{deleteTarget.name}</span>? Esta ação não
                  pode ser desfeita.
                </>
              ) : null}
              {deleteError ? <p className="text-sm text-red-400">{deleteError}</p> : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className={cn(buttonVariants(), "bg-red-600 text-white hover:bg-red-500")}
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
