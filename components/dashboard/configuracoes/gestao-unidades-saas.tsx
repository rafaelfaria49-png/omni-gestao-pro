"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Store, RefreshCw, AlertTriangle, Trash2, ShieldCheck, Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { NumeracaoVendaLojas } from "@/components/dashboard/configuracoes/numeracao-venda-lojas"
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { isWhitelistedProtectedStore } from "@/lib/store-defaults"
import { cn } from "@/lib/utils"

type StoreProfile = "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO"

type StoreRow = {
  id: string
  name: string
  cnpj: string
  phone: string
  logoUrl: string
  address: any
  profile: StoreProfile
  subscriptionPlan?: "BRONZE" | "PRATA" | "OURO"
}

type StoreSettings = {
  receiptFooter: string
  printerConfig?: any
  cardFees?: any
}

type StoreSummary = {
  hasLinks: boolean
  clientes: number
  os: number
  produtos: number
  tecnicos: number
}

function emptyAddress() {
  return { rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "" }
}

function planLabel(plan: StoreRow["subscriptionPlan"]): string {
  if (!plan) return "—"
  const map: Record<string, string> = { BRONZE: "Bronze", PRATA: "Prata", OURO: "Ouro" }
  return map[plan] || plan
}

function profileLabel(profile: StoreProfile): string {
  const map: Record<StoreProfile, string> = {
    ASSISTENCIA: "Assistência",
    VARIEDADES: "Variedades",
    SUPERMERCADO: "Supermercado",
  }
  return map[profile] ?? profile
}

export type GestaoUnidadesSaasProps = {
  /** Esconde o cabeçalho duplicado quando embutido em Configurações V3 (Lojas). */
  embed?: boolean
}

export function GestaoUnidadesSaas({ embed = false }: GestaoUnidadesSaasProps) {
  const { toast } = useToast()
  const { lojaAtivaId, setLojaAtivaId } = useLojaAtiva()

  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(false)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [draft, setDraft] = useState<StoreRow | null>(null)
  const [settings, setSettings] = useState<StoreSettings>({ receiptFooter: "" })

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<StoreRow | null>(null)
  const [deleteSummary, setDeleteSummary] = useState<StoreSummary | null>(null)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // The first store (sorted by id asc from API) is the account's principal store
  const primaryStoreId = useMemo(() => stores[0]?.id ?? "", [stores])

  const selected = useMemo(() => stores.find((s) => s.id === selectedId) ?? null, [stores, selectedId])

  const selectStore = useCallback(
    (id: string) => {
      setSelectedId(id)
      setLojaAtivaId(id)
    },
    [setLojaAtivaId],
  )

  const fetchStoresWithRetry = useCallback(async (signal?: AbortSignal): Promise<StoreRow[]> => {
    const MAX_ATTEMPTS = 3
    const DELAYS = [0, 1500, 3000]
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      if (DELAYS[attempt] > 0) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, DELAYS[attempt])
          signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")) }, { once: true })
        })
      }
      try {
        const r = await fetch("/api/stores", { credentials: "include", cache: "no-store", signal })
        if (r.ok) {
          const j = (await r.json()) as { stores?: StoreRow[] }
          return Array.isArray(j.stores) ? j.stores : []
        }
        lastErr = new Error(`HTTP ${r.status}`)
      } catch (e) {
        if ((e as any)?.name === "AbortError") throw e
        lastErr = e
      }
    }
    throw lastErr
  }, [])

  const loadStores = useCallback(async () => {
    setLoading(true)
    setApiError(false)
    try {
      const list = await fetchStoresWithRetry()
      setStores(list)
      const first = list[0]?.id ?? ""
      setSelectedId((prev) => (list.some((s) => s.id === prev) ? prev : first))
    } catch {
      setApiError(true)
    } finally {
      setLoading(false)
    }
  }, [fetchStoresWithRetry])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setApiError(false)
    fetchStoresWithRetry(ac.signal)
      .then((list) => {
        setStores(list)
        const first = list[0]?.id ?? ""
        setSelectedId((prev) => (list.some((s) => s.id === prev) ? prev : first))
      })
      .catch((e) => {
        if ((e as any)?.name !== "AbortError") setApiError(true)
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [fetchStoresWithRetry])

  useEffect(() => {
    if (stores.length === 0 || !lojaAtivaId) return
    if (stores.some((s) => s.id === lojaAtivaId)) setSelectedId(lojaAtivaId)
  }, [stores, lojaAtivaId])

  useEffect(() => {
    if (!selected) {
      setDraft(null)
      setSettings({ receiptFooter: "" })
      return
    }
    setDraft({
      ...selected,
      address: selected.address && typeof selected.address === "object" ? selected.address : emptyAddress(),
    })
    void (async () => {
      try {
        const r = await fetch(`/api/stores/${encodeURIComponent(selected.id)}/settings`, {
          credentials: "include",
          cache: "no-store",
        })
        const j = (await r.json()) as { settings?: StoreSettings | null }
        setSettings({
          receiptFooter: j.settings?.receiptFooter || "",
          printerConfig: j.settings?.printerConfig,
        })
      } catch {
        setSettings({ receiptFooter: "", printerConfig: undefined })
      }
    })()
  }, [selected?.id])

  const save = async () => {
    if (!draft) return
    try {
      const r1 = await fetch(`/api/stores/${encodeURIComponent(draft.id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          cnpj: draft.cnpj,
          phone: draft.phone,
          logoUrl: draft.logoUrl,
          address: draft.address,
          profile: draft.profile,
          subscriptionPlan: draft.subscriptionPlan,
        }),
      })
      if (!r1.ok) throw new Error("Falha ao salvar unidade")

      const r2 = await fetch(`/api/stores/${encodeURIComponent(draft.id)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptFooter: settings.receiptFooter, printerConfig: settings.printerConfig }),
      })
      if (!r2.ok) throw new Error("Falha ao salvar settings")

      const rr = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
      const jj = (await rr.json()) as { stores?: StoreRow[] }
      setStores(Array.isArray(jj.stores) ? jj.stores : [])

      toast({ title: "Unidade salva", description: `Configurações aplicadas em ${draft.id}` })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: e instanceof Error ? e.message : "Falha",
      })
    }
  }

  /** Opens the premium delete confirmation modal, fetching link summary first. */
  const openDeleteModal = useCallback(async (store: StoreRow) => {
    setDeleteTarget(store)
    setDeleteSummary(null)
    setLoadingLinks(true)
    try {
      const r = await fetch(`/api/stores/${encodeURIComponent(store.id)}/summary`, {
        credentials: "include",
        cache: "no-store",
      })
      const j = (await r.json()) as StoreSummary
      setDeleteSummary(j)
    } catch {
      setDeleteSummary({ hasLinks: false, clientes: 0, os: 0, produtos: 0, tecnicos: 0 })
    } finally {
      setLoadingLinks(false)
    }
  }, [])

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/stores/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, storeId: deleteTarget.id }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok !== true) {
        throw new Error(j.error || "Falha ao excluir unidade")
      }
      setDeleteTarget(null)
      setDeleteSummary(null)
      const rr = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
      const jj = (await rr.json()) as { stores?: StoreRow[] }
      const list = Array.isArray(jj.stores) ? jj.stores : []
      setStores(list)
      const first = list[0]?.id || ""
      setSelectedId((prev) => (list.some((s) => s.id === prev) ? prev : first))
      toast({ title: "Unidade removida", description: `A unidade foi excluída com sucesso.` })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: e instanceof Error ? e.message : "Falha ao excluir",
      })
    } finally {
      setDeleting(false)
    }
  }

  const createStore = async () => {
    try {
      const r = await fetch("/api/stores", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nova unidade", profile: "VARIEDADES" }),
      })
      if (!r.ok) throw new Error("Falha ao criar unidade")
      const j = (await r.json()) as { store?: StoreRow }
      const id = j.store?.id
      const rr = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
      const jj = (await rr.json()) as { stores?: StoreRow[] }
      setStores(Array.isArray(jj.stores) ? jj.stores : [])
      if (id) {
        setSelectedId(id)
        setLojaAtivaId(id)
      }
      toast({ title: "Unidade criada", description: id ? `Criada ${id}` : "Criada" })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao criar",
        description: e instanceof Error ? e.message : "Falha",
      })
    }
  }

  const body = (
    <div className="space-y-6">
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Carregando unidades…
          </p>
        </div>
      ) : apiError ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              Não foi possível carregar as unidades
            </p>
            <p className="text-sm text-muted-foreground">
              Ocorreu um erro ao buscar os dados. Seus dados estão seguros — tente novamente.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadStores}
            className="gap-2 cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      ) : stores.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pb-1">
          {stores.map((s) => {
            const isSelected = s.id === selectedId
            const isPrincipal = s.id === primaryStoreId
            const isActive = s.id === lojaAtivaId
            const isProtectedReal = isWhitelistedProtectedStore(s.id)
            // Fase 1 — Proteção de lojas: bloqueia exclusão de loja real protegida,
            // loja principal e unidade ativa atual.
            const isProtected = isPrincipal || isProtectedReal || isActive
            const protectedReason = isProtectedReal
              ? "Unidade real protegida — não pode ser excluída."
              : isPrincipal
                ? "A loja principal da conta não pode ser excluída."
                : "Esta é a unidade ativa. Troque de unidade antes de excluí-la."
            const name = (s.name || "Unidade").trim()
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => selectStore(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    selectStore(s.id)
                  }
                }}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border p-4 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 cursor-pointer",
                  isSelected
                    ? "border-primary bg-card shadow-md ring-1 ring-primary/30"
                    : "border-border bg-card/60 hover:bg-card hover:border-border-hover/60 hover:shadow-sm"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      isSelected
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Store className="h-5 w-5" aria-hidden />
                  </div>
                  {(isPrincipal || isProtectedReal) && (
                    <Badge
                      className="shrink-0 gap-1 border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                      variant="outline"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {isPrincipal ? "Principal" : "Protegida"}
                    </Badge>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p
                    className="truncate text-base font-semibold leading-tight text-foreground"
                    title={name}
                  >
                    {name}
                  </p>
                  <p
                    className="truncate font-mono text-[11px] text-muted-foreground/75"
                    title={s.id}
                  >
                    {s.id}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="font-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  >
                    Ativa
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {profileLabel(s.profile)}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground/90">
                    Plano:{" "}
                    <span className="text-foreground">{planLabel(s.subscriptionPlan)}</span>
                  </span>
                </div>
                <div className="mt-auto flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className="flex-1 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectStore(s.id)
                    }}
                  >
                    Gerenciar
                  </Button>
                  {isProtected ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled
                      title={protectedReason}
                      className="shrink-0 cursor-not-allowed opacity-30 text-muted-foreground/40"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                      title="Excluir unidade"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openDeleteModal(s)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Empty / onboarding state ── */
        <div className={cn(
          "flex flex-col items-center gap-5 rounded-xl border border-dashed px-8 py-14 text-center",
          "border-border",
        )}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Store className="h-7 w-7 text-muted-foreground/70" />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-semibold text-foreground">
              Configure sua primeira unidade
            </p>
            <p className="text-sm max-w-xs text-muted-foreground">
              Cadastre sua loja principal para começar a usar vendas, financeiro, estoque e operações.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={createStore}
            disabled={loading}
            className="gap-2 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Criar primeira unidade
          </Button>
        </div>
      )}

      {/* ── Bottom action bar ── */}
      <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-6 mt-2">
        <Button
          type="button"
          variant="outline"
          onClick={createStore}
          disabled={loading}
          className="cursor-pointer"
        >
          Nova unidade
        </Button>
        <Button type="button" className="cursor-pointer" onClick={save} disabled={!draft}>
          Salvar unidade
        </Button>
      </div>

      {!draft ? (
        <p className="text-center text-sm text-muted-foreground">
          {stores.length ? "Selecione uma unidade para editar os dados." : ""}
        </p>
      ) : (
        <div className="mt-8 space-y-5 pt-2">
          <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
            Dados da unidade selecionada
          </h3>
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Nome</Label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>CNPJ</Label>
                    <Input value={draft.cnpj} onChange={(e) => setDraft({ ...draft, cnpj: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Telefone</Label>
                    <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Logotipo (URL)</Label>
                  <Input value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Perfil</Label>
                  <Select value={draft.profile} onValueChange={(v) => setDraft({ ...draft, profile: v as StoreProfile })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ASSISTENCIA">Assistência</SelectItem>
                      <SelectItem value="VARIEDADES">Variedades</SelectItem>
                      <SelectItem value="SUPERMERCADO">Supermercado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Plano (SaaS)</Label>
                  <Select
                    value={draft.subscriptionPlan || "BRONZE"}
                    onValueChange={(v) => setDraft({ ...draft, subscriptionPlan: v as any })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BRONZE">Bronze</SelectItem>
                      <SelectItem value="PRATA">Prata</SelectItem>
                      <SelectItem value="OURO">Ouro</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Campo oficial da unidade (salvo na tabela `stores`).</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold">Endereço</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["rua", "numero", "bairro", "cidade", "estado", "cep"] as const).map((k) => (
                    <div key={k} className="space-y-1">
                      <Label className="capitalize">{k}</Label>
                      <Input
                        value={String(draft.address?.[k] ?? "")}
                        onChange={(e) =>
                          setDraft({ ...draft, address: { ...(draft.address || emptyAddress()), [k]: e.target.value } })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label>Rodapé do cupom (por unidade)</Label>
                  <Input
                    value={settings.receiptFooter}
                    onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })}
                    placeholder="Ex.: Obrigado pela preferência — Trocas em até 7 dias..."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Numeração de venda por unidade (GOAL 002C-0b — não ativa o writer v2) ── */}
      <NumeracaoVendaLojas />

      {/* ── Premium delete confirmation modal ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteSummary(null)
          }
        }}
      >
        <AlertDialogContent className="border-border bg-card text-foreground shadow-card sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold">Excluir unidade?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 pt-1">
                <p className="text-sm text-muted-foreground">
                  Essa ação poderá remover acessos e vínculos operacionais da unidade.
                </p>
                {deleteTarget && (
                  <div className="rounded-xl border border-border bg-panel/60 px-4 py-3 space-y-1.5">
                    <p className="font-semibold text-foreground">{deleteTarget.name || deleteTarget.id}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{profileLabel(deleteTarget.profile)}</span>
                      {deleteTarget.cnpj && <span>· {deleteTarget.cnpj}</span>}
                    </div>
                  </div>
                )}
                {loadingLinks && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Verificando vínculos…
                  </div>
                )}
                {!loadingLinks && deleteSummary?.hasLinks && (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Esta unidade possui dados vinculados e não pode ser removida.
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-1">
                      {deleteSummary.clientes > 0 && <li>· {deleteSummary.clientes} cliente{deleteSummary.clientes !== 1 ? "s" : ""}</li>}
                      {deleteSummary.os > 0 && <li>· {deleteSummary.os} ordem{deleteSummary.os !== 1 ? "s" : ""} de serviço</li>}
                      {deleteSummary.produtos > 0 && <li>· {deleteSummary.produtos} produto{deleteSummary.produtos !== 1 ? "s" : ""}</li>}
                      {deleteSummary.tecnicos > 0 && <li>· {deleteSummary.tecnicos} técnico{deleteSummary.tecnicos !== 1 ? "s" : ""}</li>}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" disabled={deleting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={loadingLinks || deleteSummary?.hasLinks === true || deleting}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Excluir unidade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  if (embed) {
    return body
  }

  return (
    <Card className="border border-border bg-card text-foreground transition-colors duration-300">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-foreground">
          Gestão de Unidades (SaaS)
        </CardTitle>
        <CardDescription className="text-muted-foreground/85">
          Cadastre filiais, defina perfil (Assistência / Variedades / Supermercado) e personalize rodapé do cupom por
          unidade.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
