"use client"

import { useEffect, useMemo, useState } from "react"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { Pencil, Trash2 } from "lucide-react"
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
import { formatPhoneBrInput, isValidPhoneBr } from "@/lib/phone-br"
import { useToast } from "@/hooks/use-toast"

type ClienteRow = {
  id: string
  name: string
  phone: string
  email: string
  createdAt: string
}

function formatDateBr(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("pt-BR", { year: "numeric", month: "2-digit", day: "2-digit" })
}

function displayPhone(raw: string | null) {
  if (!raw?.trim()) return "-"
  return formatPhoneBrInput(raw)
}

const toastRafacell = {
  className: "border-red-600/45 bg-zinc-950 text-white shadow-xl shadow-red-900/20",
  duration: 4000,
}

async function fetchClientes(q: string, lojaId: string): Promise<ClienteRow[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
  const r = await fetch(`/api/clientes${qs}`, {
    cache: "no-store",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  const j = (await r.json()) as {
    clientes: Array<{ id: string; name: string; phone: string | null; email: string | null; createdAt: string | Date }>
  }
  return j.clientes.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? "",
    email: c.email ?? "",
    createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
  }))
}

async function createCliente(lojaId: string, payload: { name: string; phone: string; email?: string }): Promise<void> {
  const r = await fetch("/api/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
    credentials: "include",
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function updateCliente(lojaId: string, id: string, payload: { name: string; phone: string; email?: string }): Promise<void> {
  const r = await fetch(`/api/clientes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaId },
    credentials: "include",
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function deleteCliente(lojaId: string, id: string): Promise<void> {
  const r = await fetch(`/api/clientes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaId },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

export default function DashboardClientesPage() {
  const { lojaAtivaId } = useLojaAtiva()
  const lojaHeader = useMemo(() => resolveLojaIdParaConsultaClientes(lojaAtivaId), [lojaAtivaId])
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [rows, setRows] = useState<ClienteRow[]>([])

  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")

  const [deleteTarget, setDeleteTarget] = useState<ClienteRow | null>(null)

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError(null)
    void fetchClientes(query, lojaHeader)
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
  }, [query, lojaHeader])

  const canSubmit =
    name.trim().length > 0 && phone.trim().length > 0 && isValidPhoneBr(phone) && !submitting

  const openCreateModal = () => {
    setFormError(null)
    setModalMode("create")
    setEditingId(null)
    setName("")
    setPhone("")
    setEmail("")
    setModalOpen(true)
  }

  const openEditModal = (row: ClienteRow) => {
    setFormError(null)
    setModalMode("edit")
    setEditingId(row.id)
    setName(row.name)
    setPhone(formatPhoneBrInput(row.phone || ""))
    setEmail(row.email?.trim() ?? "")
    setModalOpen(true)
  }

  const closeModal = () => {
    if (submitting) return
    setModalOpen(false)
  }

  const reload = async () => {
    setLoading(true)
    try {
      const data = await fetchClientes(query, lojaHeader)
      setRows(data)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    const n = name.trim()
    const p = phone.trim()
    const e = email.trim()
    if (!n) {
      setFormError('O campo "Nome" é obrigatório.')
      return
    }
    if (!p) {
      setFormError('O campo "Telefone" é obrigatório.')
      return
    }
    if (!isValidPhoneBr(p)) {
      setFormError("Informe um telefone válido com DDD (10 ou 11 dígitos).")
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (modalMode === "edit" && editingId) {
        await updateCliente(lojaHeader, editingId, { name: n, phone: p, ...(e ? { email: e } : {}) })
        toast({
          title: "Cliente atualizado",
          description: `${n} foi salvo com sucesso.`,
          ...toastRafacell,
        })
      } else {
        await createCliente(lojaHeader, { name: n, phone: p, ...(e ? { email: e } : {}) })
        toast({
          title: "Cliente cadastrado",
          description: `${n} foi adicionado.`,
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
      await deleteCliente(lojaHeader, deleteTarget.id)
      toast({
        title: "Cliente excluído",
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
            <h1 className="text-2xl font-bold text-black">Clientes</h1>
            <p className="text-sm text-black/70">Cadastro e gerenciamento de clientes</p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="h-10 rounded-md bg-red-600 px-4 text-white transition-colors hover:bg-red-500 active:bg-red-700"
          >
            Novo Cliente
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <label className="text-sm text-black/70">Buscar por nome</label>
              <div className="mt-1 flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setQuery(search)
                  }}
                  placeholder="Ex.: João"
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

            <div className="text-sm text-black/70">{loading ? "Carregando…" : `${filteredRows.length} cliente(s)`}</div>
          </div>

          {listError ? (
            <div className="mt-4 rounded-md border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">{listError}</div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-background/60">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold text-black">Nome</th>
                  <th className="px-4 py-3 font-semibold text-black">Telefone</th>
                  <th className="px-4 py-3 font-semibold text-black">Data de Cadastro</th>
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
                      Nenhum cliente encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-border transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 text-black">{r.name}</td>
                      <td className="px-4 py-3 text-black">{displayPhone(r.phone)}</td>
                      <td className="px-4 py-3 text-black/70">{formatDateBr(r.createdAt)}</td>
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
                  ))
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
                  {modalMode === "edit" ? "Editar Cliente" : "Novo Cliente"}
                </h2>
                <p className="text-sm text-black/70">
                  {modalMode === "edit" ? "Atualize os dados do cliente." : "Informe os dados básicos para cadastro."}
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
                  Nome <span className="text-red-400">*</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>
              <div>
                <label className="text-sm text-black/70">
                  Telefone <span className="text-red-400">*</span>
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneBrInput(e.target.value))}
                  placeholder="(14) 99999-9999"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>
              <div>
                <label className="text-sm text-black/70">E-mail (opcional)</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@email.com"
                  type="email"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
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
                {submitting ? "Salvando…" : modalMode === "edit" ? "Salvar alterações" : "Criar Cliente"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {deleteTarget ? (
                <>
                  Tem certeza que deseja excluir <span className="font-medium text-black">{deleteTarget.name}</span>? Esta ação
                  não pode ser desfeita.
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
