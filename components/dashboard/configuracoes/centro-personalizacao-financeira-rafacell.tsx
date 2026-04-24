"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Banknote,
  Building2,
  Calculator,
  CreditCard,
  Landmark,
  Pencil,
  Plus,
  QrCode,
  Target,
  Trash2,
  Wallet,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import {
  type CentroFinanceiroV3,
  type ContaBanco,
  type ContaTemplate,
  defaultCentroFinanceiroV3,
  loadCentroFinanceiroV3ForStore,
  normalizeCentroV3,
  novaMaquininhaVazia,
  persistCentroFinanceiroV3ForStore,
  taxasSugeridasPagBank,
} from "@/lib/centro-financeiro"

export type { ContaTemplate, MaquininhaSlug } from "@/lib/centro-financeiro"

const TEMPLATES: Array<{
  template: ContaTemplate
  labelDefault: string
  Icon: typeof Landmark
  accent: string
}> = [
  { template: "pagbank", labelDefault: "PagBank", Icon: CreditCard, accent: "from-green-600/20 to-green-600/5" },
  { template: "nubank", labelDefault: "Nubank", Icon: Wallet, accent: "from-purple-600/20 to-purple-600/5" },
  { template: "sicredi", labelDefault: "Sicredi", Icon: Landmark, accent: "from-emerald-700/20 to-emerald-700/5" },
  {
    template: "mercado_pago",
    labelDefault: "Mercado Pago",
    Icon: CreditCard,
    accent: "from-blue-500/20 to-blue-500/5",
  },
  { template: "santander", labelDefault: "Santander", Icon: Building2, accent: "from-red-600/15 to-red-600/5" },
  {
    template: "caixa_fisico",
    labelDefault: "Caixa físico",
    Icon: Banknote,
    accent: "from-amber-600/20 to-amber-600/5",
  },
]

function templateMeta(t: ContaTemplate) {
  return TEMPLATES.find((x) => x.template === t) ?? TEMPLATES[0]
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function CentroPersonalizacaoFinanceiraRafacell() {
  const { toast } = useToast()
  const { lojaAtivaId } = useLojaAtiva()
  const effectiveStoreId = useMemo(
    () => (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim() || LEGACY_PRIMARY_STORE_ID,
    [lojaAtivaId]
  )
  const [hydrated, setHydrated] = useState(false)
  const [draft, setDraft] = useState<CentroFinanceiroV3>(() => defaultCentroFinanceiroV3())
  const [baselineJson, setBaselineJson] = useState("")

  const [editConta, setEditConta] = useState<ContaBanco | null>(null)
  const [editNome, setEditNome] = useState("")
  const [editSaldo, setEditSaldo] = useState("")

  const [editMaqId, setEditMaqId] = useState<string | null>(null)
  const [editMaqNome, setEditMaqNome] = useState("")
  const [deleteMaqId, setDeleteMaqId] = useState<string | null>(null)

  const [custoPeca, setCustoPeca] = useState("")
  const [modoRepasse, setModoRepasse] = useState<string>("debito")

  useEffect(() => {
    let cancelled = false
    setHydrated(false)
    void (async () => {
      let loaded = loadCentroFinanceiroV3ForStore(effectiveStoreId)
      try {
        const r = await fetch(`/api/stores/${encodeURIComponent(effectiveStoreId)}/settings`, {
          credentials: "include",
          cache: "no-store",
        })
        const j = (await r.json().catch(() => null)) as { settings?: { cardFees?: unknown } | null } | null
        const cf = j?.settings?.cardFees
        if (cf && typeof cf === "object") {
          const o = cf as Partial<CentroFinanceiroV3> & { maquininhas?: unknown }
          if (Array.isArray(o.maquininhas) && o.maquininhas.length > 0) {
            loaded = normalizeCentroV3({
              ...loaded,
              ...o,
              maquininhas: o.maquininhas as CentroFinanceiroV3["maquininhas"],
            })
          }
        }
      } catch {
        /* mantém local */
      }
      if (cancelled) return
      setDraft(loaded)
      setBaselineJson(JSON.stringify(loaded))
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [effectiveStoreId])

  const isDirty = useMemo(
    () => hydrated && JSON.stringify(draft) !== baselineJson,
    [draft, baselineJson, hydrated]
  )

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const maquininhasAtivas = useMemo(() => draft.maquininhas.filter((m) => m.ativo), [draft.maquininhas])

  const calcMaquininhaIdEfetivo = useMemo(() => {
    if (maquininhasAtivas.some((m) => m.id === draft.maquininhaEdicaoId)) {
      return draft.maquininhaEdicaoId
    }
    return maquininhasAtivas[0]?.id ?? draft.maquininhas[0]?.id ?? ""
  }, [draft.maquininhaEdicaoId, draft.maquininhas, maquininhasAtivas])

  const taxasCalculadora = useMemo(() => {
    const m = draft.maquininhas.find((x) => x.id === calcMaquininhaIdEfetivo)
    return m?.taxas ?? taxasSugeridasPagBank()
  }, [draft.maquininhas, calcMaquininhaIdEfetivo])

  const salvarAlteracoes = useCallback(async () => {
    const normalized = normalizeCentroV3(draft)
    setDraft(normalized)
    persistCentroFinanceiroV3ForStore(effectiveStoreId, normalized)
    try {
      await fetch(`/api/stores/${encodeURIComponent(effectiveStoreId)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardFees: normalized }),
      })
    } catch {
      /* rede — local já persistido */
    }
    setBaselineJson(JSON.stringify(normalized))
    toast({
      title: "Alterações salvas",
      description: "Taxas e maquininhas gravadas para esta unidade (navegador + servidor).",
    })
  }, [draft, toast, effectiveStoreId])

  const setAtivoMaquininha = (id: string, ativo: boolean) => {
    setDraft((prev) => {
      const nextM = prev.maquininhas.map((m) => (m.id === id ? { ...m, ativo } : m))
      let ed = prev.maquininhaEdicaoId
      if (!ativo && ed === id) {
        const firstOn = nextM.find((m) => m.ativo)
        ed = firstOn?.id ?? nextM[0]?.id ?? ""
      }
      if (ativo && !nextM.find((m) => m.id === ed)?.ativo) {
        ed = id
      }
      return { ...prev, maquininhas: nextM, maquininhaEdicaoId: ed }
    })
  }

  const setTaxaCampo = (id: string, field: "debito" | "credito", v: number) => {
    const val = Number.isFinite(v) ? v : 0
    setDraft((prev) => ({
      ...prev,
      maquininhas: prev.maquininhas.map((m) =>
        m.id === id
          ? {
              ...m,
              taxas: {
                ...m.taxas,
                [field]: val,
              },
            }
          : m
      ),
    }))
  }

  const setParcela = (id: string, index: number, v: number) => {
    setDraft((prev) => ({
      ...prev,
      maquininhas: prev.maquininhas.map((m) => {
        if (m.id !== id) return m
        const next = [...m.taxas.parcelas2a12]
        next[index] = Number.isFinite(v) ? v : 0
        return { ...m, taxas: { ...m.taxas, parcelas2a12: next } }
      }),
    }))
  }

  const adicionarMaquininha = () => {
    const nova = novaMaquininhaVazia()
    setDraft((prev) => ({
      ...prev,
      maquininhas: [...prev.maquininhas, nova],
      maquininhaEdicaoId: nova.id,
    }))
  }

  const confirmarExcluirMaquininha = () => {
    if (!deleteMaqId) return
    setDraft((prev) => {
      const nextM = prev.maquininhas.filter((m) => m.id !== deleteMaqId)
      let ed = prev.maquininhaEdicaoId
      if (ed === deleteMaqId) {
        const firstOn = nextM.find((m) => m.ativo)
        ed = firstOn?.id ?? nextM[0]?.id ?? ""
      }
      return { ...prev, maquininhas: nextM, maquininhaEdicaoId: ed }
    })
    setDeleteMaqId(null)
  }

  const abrirRenomearMaquininha = (id: string, nomeAtual: string) => {
    setEditMaqId(id)
    setEditMaqNome(nomeAtual)
  }

  const aplicarRenomearMaquininha = () => {
    if (!editMaqId) return
    const nome = editMaqNome.trim()
    if (!nome) {
      setEditMaqId(null)
      return
    }
    setDraft((prev) => ({
      ...prev,
      maquininhas: prev.maquininhas.map((m) => (m.id === editMaqId ? { ...m, nome } : m)),
    }))
    setEditMaqId(null)
  }

  const precoParaCobrirCusto = (custo: number, taxaPercent: number): number => {
    if (custo <= 0) return 0
    const t = Math.min(Math.max(taxaPercent, 0), 99.99)
    return custo / (1 - t / 100)
  }

  const custoNum = parseFloat(custoPeca.replace(",", ".")) || 0

  const taxaAtualRepasse = useMemo(() => {
    if (maquininhasAtivas.length === 0) return 0
    if (modoRepasse === "debito") return taxasCalculadora.debito
    if (modoRepasse === "credito") return taxasCalculadora.credito
    const m = /^p(\d+)$/.exec(modoRepasse)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 2 && n <= 12) return taxasCalculadora.parcelas2a12[n - 2] ?? 0
    }
    return taxasCalculadora.debito
  }, [modoRepasse, taxasCalculadora, maquininhasAtivas.length])

  const precoSugerido = precoParaCobrirCusto(custoNum, taxaAtualRepasse)

  const labelModo = useMemo(() => {
    if (modoRepasse === "debito") return "débito"
    if (modoRepasse === "credito") return "crédito à vista"
    const m = /^p(\d+)$/.exec(modoRepasse)
    if (m) return `crédito ${m[1]}x`
    return modoRepasse
  }, [modoRepasse])

  const abrirEditarConta = (c: ContaBanco) => {
    setEditConta(c)
    setEditNome(c.nomeExibicao)
    setEditSaldo(c.saldo === 0 ? "" : String(c.saldo))
  }

  const aplicarEdicaoConta = () => {
    if (!editConta) return
    const saldo = parseFloat(editSaldo.replace(",", ".")) || 0
    setDraft((prev) => ({
      ...prev,
      contas: prev.contas.map((c) =>
        c.id === editConta.id ? { ...c, nomeExibicao: editNome.trim() || c.nomeExibicao, saldo } : c
      ),
    }))
    setEditConta(null)
  }

  if (!hydrated) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
        Carregando centro financeiro…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Landmark className="w-6 h-6 text-primary" />
          Centro de Personalização Financeira
        </h2>
        <p className="text-sm text-muted-foreground">
          Contas bancárias, maquininhas e taxas de cartão.{" "}
          {isDirty && <span className="text-amber-600 font-medium">Alterações não salvas.</span>}
        </p>
      </div>

      <Tabs defaultValue="bancos" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3 h-auto gap-1 bg-secondary p-1">
          <TabsTrigger value="bancos" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Landmark className="w-4 h-4 shrink-0" />
            Bancos
          </TabsTrigger>
          <TabsTrigger value="taxas" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <CreditCard className="w-4 h-4 shrink-0" />
            Taxas de cartão
          </TabsTrigger>
          <TabsTrigger value="metas" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Target className="w-4 h-4 shrink-0" />
            Metas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bancos" className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wallet className="w-5 h-5 text-primary" />
                Gerenciamento de contas / bancos
              </CardTitle>
              <CardDescription>
                Saldo de referência por conta. Use <strong>Editar</strong> para alterar o nome exibido ou o saldo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
                <div className="space-y-2 flex-1 max-w-md">
                  <Label className="flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-primary" />
                    Banco padrão para Pix (QR Code)
                  </Label>
                  <Select
                    value={draft.pixPadraoContaId}
                    onValueChange={(v) => setDraft((prev) => ({ ...prev, pixPadraoContaId: v }))}
                  >
                    <SelectTrigger className="h-11 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {draft.contas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nomeExibicao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {draft.contas.map((conta) => {
                  const { Icon, accent } = templateMeta(conta.template)
                  return (
                    <Card
                      key={conta.id}
                      className={`border-border overflow-hidden bg-gradient-to-br ${accent} to-card`}
                    >
                      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
                        <CardTitle className="text-base flex items-center gap-2 pr-2">
                          <Icon className="w-5 h-5 text-primary shrink-0" />
                          <span className="line-clamp-2">{conta.nomeExibicao}</span>
                        </CardTitle>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="shrink-0 h-8"
                          onClick={() => abrirEditarConta(conta)}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Editar
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-1">
                        <p className="text-xs text-muted-foreground">Saldo atual (referência)</p>
                        <p className="text-lg font-semibold tabular-nums">{formatBRL(conta.saldo)}</p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxas" className="mt-6 space-y-6">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
            Ative a sua maquininha abaixo para configurar as taxas e habilitar a calculadora de repasse no caixa.
          </p>

          {draft.maquininhas.length === 0 && (
            <p className="text-sm text-amber-600/90 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              Nenhuma maquininha cadastrada. Use o botão abaixo para adicionar e preencher as taxas.
            </p>
          )}

          {draft.maquininhas.map((maq) => {
            const editavel = maq.ativo
            return (
              <Card key={maq.id} className="border-border bg-card">
                <CardHeader className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg flex flex-wrap items-center gap-2">
                        <span className="break-words">{maq.nome}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                          onClick={() => abrirRenomearMaquininha(maq.id, maq.nome)}
                          aria-label="Renomear maquininha"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </CardTitle>
                      <CardDescription>
                        Taxas sugeridas pré-preenchidas; só é possível alterar com a maquininha{" "}
                        <strong>ativada</strong>.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() => setDeleteMaqId(maq.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Excluir
                      </Button>
                      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 bg-secondary/40">
                        <Label htmlFor={`ativar-${maq.id}`} className="text-sm cursor-pointer whitespace-nowrap">
                          Ativar no caixa
                        </Label>
                        <Switch
                          id={`ativar-${maq.id}`}
                          checked={maq.ativo}
                          onCheckedChange={(v) => setAtivoMaquininha(maq.id, v)}
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={`space-y-6 ${!editavel ? "opacity-55" : ""}`}>
                  <div className="grid gap-6 sm:grid-cols-2 max-w-xl">
                    <div className="space-y-2">
                      <Label htmlFor={`tx-debito-${maq.id}`}>Débito (%)</Label>
                      <Input
                        id={`tx-debito-${maq.id}`}
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        disabled={!editavel}
                        value={maq.taxas.debito}
                        onChange={(e) => setTaxaCampo(maq.id, "debito", parseFloat(e.target.value) || 0)}
                        className="h-11 bg-secondary border-border disabled:cursor-not-allowed"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`tx-credito-${maq.id}`}>Crédito à vista (%)</Label>
                      <Input
                        id={`tx-credito-${maq.id}`}
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        disabled={!editavel}
                        value={maq.taxas.credito}
                        onChange={(e) => setTaxaCampo(maq.id, "credito", parseFloat(e.target.value) || 0)}
                        className="h-11 bg-secondary border-border disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Parcelamento crédito (2x a 12x) — % por parcela</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-3">
                      {maq.taxas.parcelas2a12.map((pct, idx) => {
                        const n = idx + 2
                        return (
                          <div key={`${maq.id}-p${n}`} className="space-y-1.5">
                            <Label htmlFor={`tx-${maq.id}-p${n}`} className="text-xs text-muted-foreground">
                              {n}x
                            </Label>
                            <Input
                              id={`tx-${maq.id}-p${n}`}
                              type="number"
                              step="0.01"
                              min={0}
                              max={100}
                              disabled={!editavel}
                              value={pct}
                              onChange={(e) => setParcela(maq.id, idx, parseFloat(e.target.value) || 0)}
                              className="h-10 bg-secondary border-border text-sm disabled:cursor-not-allowed"
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed border-primary/40 text-primary hover:bg-primary/10"
            onClick={adicionarMaquininha}
          >
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Outra Maquininha
          </Button>

          <Separator />

          <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <Calculator className="w-5 h-5" />
              <span className="font-semibold">Calculadora de repasse</span>
            </div>
            {maquininhasAtivas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ative pelo menos uma maquininha acima para usar a calculadora e liberar débito/crédito no PDV.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Maquininha usada nos cálculos: escolha entre as que estão <strong>ativas no caixa</strong>.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                  <div className="space-y-2">
                    <Label>Maquininha (ativas)</Label>
                    <Select
                      value={calcMaquininhaIdEfetivo}
                      onValueChange={(v) => setDraft((prev) => ({ ...prev, maquininhaEdicaoId: v }))}
                    >
                      <SelectTrigger className="h-11 bg-background border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {maquininhasAtivas.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custo-peca">Custo da peça (R$)</Label>
                    <Input
                      id="custo-peca"
                      inputMode="decimal"
                      placeholder="Ex: 120,00 — tela iPhone 11"
                      value={custoPeca}
                      onChange={(e) => setCustoPeca(e.target.value)}
                      className="h-11 bg-background border-border"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Forma de pagamento</Label>
                    <Select value={modoRepasse} onValueChange={setModoRepasse}>
                      <SelectTrigger className="h-11 bg-background border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debito">Débito</SelectItem>
                        <SelectItem value="credito">Crédito à vista</SelectItem>
                        {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                          <SelectItem key={n} value={`p${n}`}>
                            Crédito {n}x
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {custoNum > 0 && (
                  <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Taxa: <span className="font-medium text-foreground">{taxaAtualRepasse.toFixed(2)}%</span> ({labelModo})
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      Venda mínima sugerida: {formatBRL(precoSugerido)}
                    </p>
                    <p className="text-xs text-muted-foreground">custo ÷ (1 − taxa/100)</p>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="metas" className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Metas financeiras
              </CardTitle>
              <CardDescription>Metas e anotações (gravadas ao salvar).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="meta-fat">Meta de faturamento mensal (R$)</Label>
                <Input
                  id="meta-fat"
                  type="number"
                  step="0.01"
                  min={0}
                  value={draft.metaFaturamento === 0 ? "" : draft.metaFaturamento}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, metaFaturamento: parseFloat(e.target.value) || 0 }))
                  }
                  className="h-11 bg-secondary border-border"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-obs">Observações / lembretes</Label>
                <Textarea
                  id="meta-obs"
                  value={draft.metaObservacao}
                  onChange={(e) => setDraft((prev) => ({ ...prev, metaObservacao: e.target.value }))}
                  placeholder="Ex.: foco em películas em novembro…"
                  className="min-h-[120px] bg-secondary border-border resize-y"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraft((prev) => ({ ...prev, metaFaturamento: 0, metaObservacao: "" }))}
              >
                Limpar metas (ainda não salvo até confirmar)
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-4 pb-2 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 -mx-1 px-1">
        {isDirty && (
          <p className="text-sm text-amber-600 sm:mr-auto order-2 sm:order-1">
            Você tem alterações não salvas.
          </p>
        )}
        <Button type="button" size="lg" className="order-1 sm:order-2 min-w-[200px]" onClick={salvarAlteracoes}>
          Salvar alterações
        </Button>
      </div>

      <Dialog open={!!editConta} onOpenChange={(o) => !o && setEditConta(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>Editar conta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nome">Nome exibido</Label>
              <Input
                id="edit-nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                placeholder="Ex.: Sicredi — conta loja"
                className="h-11 bg-secondary border-border"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-saldo">Saldo atual (R$)</Label>
              <Input
                id="edit-saldo"
                type="number"
                step="0.01"
                value={editSaldo}
                onChange={(e) => setEditSaldo(e.target.value)}
                placeholder="0,00"
                className="h-11 bg-secondary border-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setEditConta(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={aplicarEdicaoConta}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editMaqId} onOpenChange={(o) => !o && setEditMaqId(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>Nome da maquininha</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-maq-nome">Como aparece no caixa e nas taxas</Label>
              <Input
                id="edit-maq-nome"
                value={editMaqNome}
                onChange={(e) => setEditMaqNome(e.target.value)}
                placeholder="Ex.: PagBank loja 2"
                className="h-11 bg-secondary border-border"
                onKeyDown={(e) => {
                  if (e.key === "Enter") aplicarRenomearMaquininha()
                }}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setEditMaqId(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={aplicarRenomearMaquininha}>
              Salvar nome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteMaqId} onOpenChange={(o) => !o && setDeleteMaqId(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta maquininha?</AlertDialogTitle>
            <AlertDialogDescription>
              As taxas e o nome serão removidos deste navegador. Se não houver nenhuma maquininha ativa, débito e
              crédito ficam desativados no PDV até você adicionar outra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarExcluirMaquininha}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
