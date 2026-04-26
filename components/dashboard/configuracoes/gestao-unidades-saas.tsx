"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Check } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
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

function emptyAddress() {
  return { rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "" }
}

export function GestaoUnidadesSaas() {
  const { mode } = useStudioTheme()
  const isBlack = mode === "black"
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<StoreRow[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [draft, setDraft] = useState<StoreRow | null>(null)
  const [settings, setSettings] = useState<StoreSettings>({ receiptFooter: "" })
  const selected = useMemo(() => stores.find((s) => s.id === selectedId) ?? null, [stores, selectedId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const r = await fetch("/api/stores", { credentials: "include", cache: "no-store" })
        const j = (await r.json()) as { stores?: StoreRow[] }
        const list = Array.isArray(j.stores) ? j.stores : []
        if (!cancelled) {
          setStores(list)
          const first = list[0]?.id || LEGACY_PRIMARY_STORE_ID
          setSelectedId((prev) => (list.some((s) => s.id === prev) ? prev : first))
        }
      } catch {
        if (!cancelled) setStores([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      if (id) setSelectedId(id)
      toast({ title: "Unidade criada", description: id ? `Criada ${id}` : "Criada" })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao criar",
        description: e instanceof Error ? e.message : "Falha",
      })
    }
  }

  return (
    <Card
      className={cn(
        "border transition-colors duration-300",
        isBlack
          ? "border-white/10 bg-[#000000] text-white"
          : "border-slate-200 bg-white text-foreground"
      )}
    >
      <CardHeader>
        <CardTitle
          className={cn("text-2xl font-bold", isBlack ? "text-white" : "text-slate-900")}
        >
          Gestão de Unidades (SaaS)
        </CardTitle>
        <CardDescription
          className={cn(
            isBlack ? "text-white/65" : "text-slate-600"
          )}
        >
          Cadastre Loja 2/3, defina perfil (Assistência/Variedades/Supermercado) e personalize rodapé do cupom por
          CNPJ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className={cn("text-center text-sm", isBlack ? "text-white/60" : "text-slate-600")}>
            Carregando unidades…
          </p>
        ) : stores.length > 0 ? (
          <div className="flex flex-wrap items-stretch justify-center gap-4">
            {stores.map((s) => {
              const active = s.id === selectedId
              const name = (s.name || "Unidade").trim()
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "flex h-40 w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 p-3 text-center transition-all duration-200",
                    isBlack
                      ? active
                        ? "border-primary bg-[#000000] shadow-[0_0_0_1px] shadow-primary/40"
                        : "border-white/10 bg-[#000000] hover:border-white/25"
                      : active
                        ? "border-primary bg-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-lg",
                      active
                        ? "bg-primary/15 text-primary"
                        : isBlack
                          ? "text-white/80"
                          : "text-slate-700"
                    )}
                  >
                    {active ? <Check className="h-6 w-6" /> : <Building2 className="h-6 w-6" />}
                  </div>
                  <span
                    className={cn(
                      "w-full break-words text-xs font-medium leading-tight",
                      isBlack ? "text-white" : "text-slate-900"
                    )}
                  >
                    {name}
                  </span>
                  <span
                    className={cn("w-full truncate font-mono text-[10px]", isBlack ? "text-white/55" : "text-slate-500")}
                    title={s.id}
                  >
                    {s.id}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p
            className={cn(
              "text-center text-sm",
              isBlack ? "text-white/60" : "text-slate-600"
            )}
          >
            Nenhuma unidade cadastrada.
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={createStore}
            disabled={loading}
            className={cn(
              isBlack
                ? "border-white/20 bg-[#000000] text-white hover:bg-white/10 hover:text-white"
                : "border-slate-200 bg-white"
            )}
          >
            Nova unidade
          </Button>
          <Button type="button" onClick={save} disabled={!draft}>
            Salvar unidade
          </Button>
        </div>

        {!draft ? (
          <p
            className={cn("text-center text-sm", isBlack ? "text-white/55" : "text-slate-600")}
          >
            {stores.length ? "Toque em uma unidade para editar." : ""}
          </p>
        ) : (
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
                <Select
                  value={draft.profile}
                  onValueChange={(v) => setDraft({ ...draft, profile: v as StoreProfile })}
                >
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
        )}
      </CardContent>
    </Card>
  )
}

