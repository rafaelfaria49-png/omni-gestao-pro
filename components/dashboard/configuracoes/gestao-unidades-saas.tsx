"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"

type StoreProfile = "ASSISTENCIA" | "VARIEDADES" | "SUPERMERCADO"

type StoreRow = {
  id: string
  name: string
  cnpj: string
  phone: string
  logoUrl: string
  address: any
  profile: StoreProfile
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
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle>Gestão de Unidades (SaaS)</CardTitle>
        <CardDescription>
          Cadastre Loja 2/3, defina perfil (Assistência/Variedades/Supermercado) e personalize rodapé do cupom por CNPJ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Label>Unidade</Label>
            {stores.length > 0 ? (
              <Select value={selectedId || stores[0]!.id} onValueChange={setSelectedId}>
                <SelectTrigger className="w-[min(24rem,100%)]">
                  <SelectValue placeholder={loading ? "Carregando..." : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.id} — {(s.name || "Unidade").trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">{loading ? "Carregando unidades…" : "Nenhuma unidade cadastrada."}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={createStore} disabled={loading}>
              Nova unidade
            </Button>
            <Button type="button" onClick={save} disabled={!draft}>
              Salvar unidade
            </Button>
          </div>
        </div>

        {!draft ? (
          <p className="text-sm text-muted-foreground">Selecione uma unidade para editar.</p>
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
                <Label>Plano (override por unidade)</Label>
                <Select
                  value={String((settings.printerConfig as any)?.planoAssinaturaOverride || "bronze")}
                  onValueChange={(v) =>
                    setSettings({
                      ...settings,
                      printerConfig: {
                        ...(settings.printerConfig && typeof settings.printerConfig === "object" ? (settings.printerConfig as any) : {}),
                        planoAssinaturaOverride: v,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bronze">Bronze</SelectItem>
                    <SelectItem value="prata">Prata</SelectItem>
                    <SelectItem value="ouro">Ouro</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Salva no banco por unidade para testes (IA e gatilhos de UI podem respeitar esse override).
                </p>
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

