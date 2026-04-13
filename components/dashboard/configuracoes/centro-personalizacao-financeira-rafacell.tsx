"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Banknote,
  Building2,
  Calculator,
  CreditCard,
  Landmark,
  QrCode,
  Target,
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

const STORAGE_KEY = "rafacell-centro-financeiro-v1"

export type BancoPixId =
  | "pagbank"
  | "nubank"
  | "sicredi"
  | "mercado_pago"
  | "santander"
  | "caixa_fisico"

type Persisted = {
  saldos: Record<BancoPixId, number>
  pagbankTaxas: {
    debito: number
    credito: number
    parcelas2a12: number[]
  }
  pixPadrao: BancoPixId
  metaFaturamento: number
  metaObservacao: string
}

const BANCOS: Array<{
  id: BancoPixId
  label: string
  short: string
  Icon: typeof Landmark
  accent: string
}> = [
  { id: "pagbank", label: "PagBank", short: "PagBank", Icon: CreditCard, accent: "from-green-600/20 to-green-600/5" },
  { id: "nubank", label: "Nubank", short: "Nubank", Icon: Wallet, accent: "from-purple-600/20 to-purple-600/5" },
  { id: "sicredi", label: "Sicredi", short: "Sicredi", Icon: Landmark, accent: "from-emerald-700/20 to-emerald-700/5" },
  {
    id: "mercado_pago",
    label: "Mercado Pago",
    short: "Mercado Pago",
    Icon: CreditCard,
    accent: "from-blue-500/20 to-blue-500/5",
  },
  { id: "santander", label: "Santander", short: "Santander", Icon: Building2, accent: "from-red-600/15 to-red-600/5" },
  {
    id: "caixa_fisico",
    label: "Caixa físico",
    short: "Caixa físico",
    Icon: Banknote,
    accent: "from-amber-600/20 to-amber-600/5",
  },
]

function defaultPersisted(): Persisted {
  const parcelas2a12 = Array.from({ length: 11 }, (_, i) => {
    const n = i + 2
    return 2.2 + (n - 2) * 0.35
  })
  return {
    saldos: {
      pagbank: 0,
      nubank: 0,
      sicredi: 0,
      mercado_pago: 0,
      santander: 0,
      caixa_fisico: 0,
    },
    pagbankTaxas: {
      debito: 1.99,
      credito: 3.19,
      parcelas2a12,
    },
    pixPadrao: "pagbank",
    metaFaturamento: 0,
    metaObservacao: "",
  }
}

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return defaultPersisted()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPersisted()
    const p = JSON.parse(raw) as Partial<Persisted>
    const base = defaultPersisted()
    return {
      saldos: { ...base.saldos, ...p.saldos },
      pagbankTaxas: {
        debito: typeof p.pagbankTaxas?.debito === "number" ? p.pagbankTaxas.debito : base.pagbankTaxas.debito,
        credito: typeof p.pagbankTaxas?.credito === "number" ? p.pagbankTaxas.credito : base.pagbankTaxas.credito,
        parcelas2a12:
          Array.isArray(p.pagbankTaxas?.parcelas2a12) && p.pagbankTaxas.parcelas2a12.length === 11
            ? p.pagbankTaxas.parcelas2a12.map((x) => (typeof x === "number" ? x : 0))
            : base.pagbankTaxas.parcelas2a12,
      },
      pixPadrao: (p.pixPadrao as BancoPixId) && BANCOS.some((b) => b.id === p.pixPadrao) ? p.pixPadrao! : base.pixPadrao,
      metaFaturamento: typeof p.metaFaturamento === "number" ? p.metaFaturamento : 0,
      metaObservacao: typeof p.metaObservacao === "string" ? p.metaObservacao : "",
    }
  } catch {
    return defaultPersisted()
  }
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function CentroPersonalizacaoFinanceiraRafacell() {
  const [data, setData] = useState<Persisted>(() => defaultPersisted())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setData(loadPersisted())
    setHydrated(true)
  }, [])

  const persist = useCallback((next: Persisted) => {
    setData(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  const setSaldo = (id: BancoPixId, v: number) => {
    persist({
      ...data,
      saldos: { ...data.saldos, [id]: Number.isFinite(v) ? v : 0 },
    })
  }

  const setTaxa = (field: "debito" | "credito", v: number) => {
    persist({
      ...data,
      pagbankTaxas: { ...data.pagbankTaxas, [field]: Number.isFinite(v) ? v : 0 },
    })
  }

  const setParcela = (index: number, v: number) => {
    const next = [...data.pagbankTaxas.parcelas2a12]
    next[index] = Number.isFinite(v) ? v : 0
    persist({
      ...data,
      pagbankTaxas: { ...data.pagbankTaxas, parcelas2a12: next },
    })
  }

  /** Preço de venda mínimo para cobrir custo após descontar a taxa (taxa em %). */
  const precoParaCobrirCusto = (custo: number, taxaPercent: number): number => {
    if (custo <= 0) return 0
    const t = Math.min(Math.max(taxaPercent, 0), 99.99)
    return custo / (1 - t / 100)
  }

  const [custoPeca, setCustoPeca] = useState("")
  const [modoRepasse, setModoRepasse] = useState<string>("debito")

  const custoNum = parseFloat(custoPeca.replace(",", ".")) || 0

  const taxaAtualRepasse = useMemo(() => {
    if (modoRepasse === "debito") return data.pagbankTaxas.debito
    if (modoRepasse === "credito") return data.pagbankTaxas.credito
    const m = /^p(\d+)$/.exec(modoRepasse)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 2 && n <= 12) return data.pagbankTaxas.parcelas2a12[n - 2] ?? 0
    }
    return data.pagbankTaxas.debito
  }, [modoRepasse, data.pagbankTaxas])

  const precoSugerido = precoParaCobrirCusto(custoNum, taxaAtualRepasse)

  const labelModo = useMemo(() => {
    if (modoRepasse === "debito") return "débito"
    if (modoRepasse === "credito") return "crédito à vista"
    const m = /^p(\d+)$/.exec(modoRepasse)
    if (m) return `crédito ${m[1]}x`
    return modoRepasse
  }, [modoRepasse])

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
          RAFACELL ASSISTEC — contas, taxas PagBank, metas e calculadora de repasse para não perder margem no cartão.
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
                Saldo de referência por conta (uso interno). O QR Code de Pix usará o banco padrão abaixo.
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
                    value={data.pixPadrao}
                    onValueChange={(v) => persist({ ...data, pixPadrao: v as BancoPixId })}
                  >
                    <SelectTrigger className="h-11 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {BANCOS.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    O PDV e emissões de cobrança podem usar esta conta como destino do Pix.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {BANCOS.map(({ id, label, Icon, accent }) => (
                  <Card
                    key={id}
                    className={`border-border overflow-hidden bg-gradient-to-br ${accent} to-card`}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Icon className="w-5 h-5 text-primary shrink-0" />
                        {label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Label htmlFor={`saldo-${id}`} className="text-xs text-muted-foreground">
                        Saldo atual
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                          R$
                        </span>
                        <Input
                          id={`saldo-${id}`}
                          type="number"
                          step="0.01"
                          min={0}
                          className="pl-10 h-11 bg-background/80 border-border"
                          value={data.saldos[id] === 0 ? "" : data.saldos[id]}
                          placeholder="0,00"
                          onChange={(e) => setSaldo(id, parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxas" className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="w-5 h-5 text-primary" />
                Taxas de cartão — PagBank
              </CardTitle>
              <CardDescription>
                Informe os percentuais cobrados pela maquininha (MCC). Usados na calculadora de repasse.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="tx-debito">Débito (%)</Label>
                  <Input
                    id="tx-debito"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={data.pagbankTaxas.debito}
                    onChange={(e) => setTaxa("debito", parseFloat(e.target.value) || 0)}
                    className="h-11 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-credito">Crédito à vista (%)</Label>
                  <Input
                    id="tx-credito"
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={data.pagbankTaxas.credito}
                    onChange={(e) => setTaxa("credito", parseFloat(e.target.value) || 0)}
                    className="h-11 bg-secondary border-border"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Parcelamento crédito (2x a 12x) — % por parcela</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Taxa efetiva de cada opção de parcelamento.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {data.pagbankTaxas.parcelas2a12.map((pct, idx) => {
                    const n = idx + 2
                    return (
                      <div key={n} className="space-y-1.5">
                        <Label htmlFor={`tx-p${n}`} className="text-xs text-muted-foreground">
                          {n}x
                        </Label>
                        <Input
                          id={`tx-p${n}`}
                          type="number"
                          step="0.01"
                          min={0}
                          max={100}
                          value={pct}
                          onChange={(e) => setParcela(idx, parseFloat(e.target.value) || 0)}
                          className="h-10 bg-secondary border-border text-sm"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              <Separator />

              <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Calculator className="w-5 h-5" />
                  <span className="font-semibold">Calculadora de repasse</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Digite quanto você pagou na peça (custo). O sistema calcula o valor mínimo a cobrar no cartão para
                  cobrir custo + taxa PagBank (sem lucro extra).
                </p>
                <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
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
                  <div className="space-y-2">
                    <Label>Forma de pagamento na maquininha</Label>
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
                      Taxa considerada: <span className="font-medium text-foreground">{taxaAtualRepasse.toFixed(2)}%</span>{" "}
                      ({labelModo})
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      Venda mínima sugerida: {formatBRL(precoSugerido)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Fórmula: custo ÷ (1 − taxa/100). Ajuste à vista se quiser incluir lucro ou frete.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metas" className="mt-6 space-y-6">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="w-5 h-5 text-primary" />
                Metas RAFACELL
              </CardTitle>
              <CardDescription>Faturamento e anotações de gestão (referência local neste aparelho).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="meta-fat">Meta de faturamento mensal (R$)</Label>
                <Input
                  id="meta-fat"
                  type="number"
                  step="0.01"
                  min={0}
                  value={data.metaFaturamento === 0 ? "" : data.metaFaturamento}
                  onChange={(e) =>
                    persist({ ...data, metaFaturamento: parseFloat(e.target.value) || 0 })
                  }
                  className="h-11 bg-secondary border-border"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-obs">Observações / lembretes</Label>
                <Textarea
                  id="meta-obs"
                  value={data.metaObservacao}
                  onChange={(e) => persist({ ...data, metaObservacao: e.target.value })}
                  placeholder="Ex.: foco em películas em novembro; reforçar estoque de baterias…"
                  className="min-h-[120px] bg-secondary border-border resize-y"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const next = { ...data, metaFaturamento: 0, metaObservacao: "" }
                  persist(next)
                }}
              >
                Limpar metas
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
