"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Minus, Plus, Search, Trash2, ArrowRightToLine } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { useOperationsStore } from "@/lib/operations-store"
import {
  PDV_PRODUCTS_BASE,
  mergePdvCatalogWithInventory,
  newPdvLineId,
  type PdvCatalogProduct,
} from "@/lib/pdv-catalog"
import { PDV_IMPORT_COMANDA_KEY } from "@/lib/pdv-comanda-bridge"
import { AttrProductDialog, WeightProductDialog } from "./pdv-product-dialogs"
import {
  isWebSerialSupported,
  openScalePort,
  closeScalePort,
  waitForStableWeightKg,
  peekLastWeightKg,
} from "@/services/hardware-bridge"

const MESAS_STORAGE_KEY = "assistec-controle-consumo-mesas-v1"

type ComandaCartItem = {
  lineId: string
  inventoryId: string
  name: string
  price: number
  quantity: number
  vendaPorPeso?: boolean
  atributosLabel?: string
}

type MesaRecord = {
  id: string
  label: string
  itens: ComandaCartItem[]
}

function defaultMesas(): MesaRecord[] {
  return Array.from({ length: 16 }, (_, i) => ({
    id: `mesa-${i + 1}`,
    label: `Mesa ${i + 1}`,
    itens: [],
  }))
}

function loadMesas(): MesaRecord[] {
  try {
    const raw = localStorage.getItem(MESAS_STORAGE_KEY)
    if (!raw) return defaultMesas()
    const parsed = JSON.parse(raw) as MesaRecord[]
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultMesas()
    return parsed
  } catch {
    return defaultMesas()
  }
}

type ControleConsumoProps = {
  onNavigateToPdv: () => void
}

export function ControleConsumo({ onNavigateToPdv }: ControleConsumoProps) {
  const { inventory } = useOperationsStore()
  const { toast } = useToast()
  const [mesas, setMesas] = useState<MesaRecord[]>(() => loadMesas())
  const [selectedMesaId, setSelectedMesaId] = useState(() => loadMesas()[0]?.id ?? "mesa-1")
  const [searchTerm, setSearchTerm] = useState("")

  const [weightDialogOpen, setWeightDialogOpen] = useState(false)
  const [weightProduct, setWeightProduct] = useState<PdvCatalogProduct | null>(null)
  const [weightKgInput, setWeightKgInput] = useState("")
  const [scaleBusy, setScaleBusy] = useState(false)
  const [attrDialogOpen, setAttrDialogOpen] = useState(false)
  const [attrProduct, setAttrProduct] = useState<PdvCatalogProduct | null>(null)
  const [attrSelections, setAttrSelections] = useState<Record<string, string>>({})

  const products = useMemo(
    () => mergePdvCatalogWithInventory(PDV_PRODUCTS_BASE, inventory),
    [inventory]
  )

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    )
  }, [products, searchTerm])

  useEffect(() => {
    try {
      localStorage.setItem(MESAS_STORAGE_KEY, JSON.stringify(mesas))
    } catch {
      /* ignore */
    }
  }, [mesas])

  const selectedMesa = mesas.find((m) => m.id === selectedMesaId)

  const appendToMesa = useCallback(
    (mesaId: string, item: Omit<ComandaCartItem, "lineId">) => {
      setMesas((prev) =>
        prev.map((m) =>
          m.id === mesaId
            ? {
                ...m,
                itens: [
                  ...m.itens,
                  { ...item, lineId: newPdvLineId(item.inventoryId) },
                ],
              }
            : m
        )
      )
    },
    []
  )

  const addProduct = (product: PdvCatalogProduct) => {
    if (product.stock <= 0) {
      toast({ title: "Sem estoque", description: `${product.name} está sem saldo.` })
      return
    }
    if (product.atributos && product.atributos.length > 0) {
      setAttrProduct(product)
      const init: Record<string, string> = {}
      for (const a of product.atributos) {
        init[a.id] = a.opcoes[0] ?? ""
      }
      setAttrSelections(init)
      setAttrDialogOpen(true)
      return
    }
    if (product.vendaPorPeso) {
      setAttrSelections({})
      setWeightProduct(product)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return
    }
    appendToMesa(selectedMesaId, {
      inventoryId: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
    })
    toast({ title: "Item lançado", description: `${product.name} na ${selectedMesa?.label ?? "mesa"}.` })
  }

  const confirmAttrDialog = () => {
    if (!attrProduct) return
    const parts = attrProduct.atributos?.map((a) => attrSelections[a.id]).filter(Boolean) ?? []
    const label = parts.length ? `${attrProduct.name} (${parts.join(" · ")})` : attrProduct.name
    setAttrDialogOpen(false)
    if (attrProduct.vendaPorPeso) {
      setWeightProduct(attrProduct)
      setWeightKgInput("")
      setWeightDialogOpen(true)
      return
    }
    appendToMesa(selectedMesaId, {
      inventoryId: attrProduct.id,
      name: label,
      price: attrProduct.price,
      quantity: 1,
      atributosLabel: parts.join(" · "),
    })
    setAttrProduct(null)
    toast({ title: "Item lançado", description: label })
  }

  const confirmWeightDialog = () => {
    if (!weightProduct) return
    const kg = parseFloat(weightKgInput.replace(",", "."))
    if (!Number.isFinite(kg) || kg <= 0) {
      toast({ title: "Peso inválido", description: "Informe o peso em kg.", variant: "destructive" })
      return
    }
    const inv = inventory.find((i) => i.id === weightProduct.id)
    if (inv && kg > inv.stock + 0.0001) {
      toast({ title: "Estoque", description: "Peso maior que o disponível.", variant: "destructive" })
      return
    }
    const pKg = weightProduct.precoPorKg ?? weightProduct.price
    const parts = weightProduct.atributos?.length
      ? weightProduct.atributos.map((a) => attrSelections[a.id]).filter(Boolean)
      : []
    const baseName =
      parts.length > 0 ? `${weightProduct.name} (${parts.join(" · ")})` : weightProduct.name
    appendToMesa(selectedMesaId, {
      inventoryId: weightProduct.id,
      name: `${baseName} — ${kg.toFixed(3)} kg`,
      price: pKg,
      quantity: kg,
      vendaPorPeso: true,
      atributosLabel: parts.length ? parts.join(" · ") : undefined,
    })
    setWeightDialogOpen(false)
    setWeightProduct(null)
    setAttrProduct(null)
    toast({ title: "Item lançado", description: `${baseName}` })
  }

  const handleLerBalança = async () => {
    if (!isWebSerialSupported()) {
      toast({
        title: "Web Serial",
        description: "Use Chrome ou Edge em HTTPS ou localhost.",
        variant: "destructive",
      })
      return
    }
    setScaleBusy(true)
    try {
      await openScalePort({ baudRate: 9600 })
      const w = await waitForStableWeightKg("auto", 3200)
      await closeScalePort()
      if (w != null && w > 0) {
        setWeightKgInput(w.toFixed(3))
        toast({ title: "Peso lido", description: `${w.toFixed(3)} kg` })
      } else {
        const peek = peekLastWeightKg("auto")
        if (peek != null && peek > 0) setWeightKgInput(peek.toFixed(3))
        else
          toast({
            title: "Peso",
            description: "Não estabilizou a tempo. Digite manualmente.",
            variant: "destructive",
          })
      }
    } catch (e) {
      await closeScalePort()
      toast({
        title: "Balança",
        description: e instanceof Error ? e.message : "Falha na leitura",
        variant: "destructive",
      })
    } finally {
      setScaleBusy(false)
    }
  }

  const updateQty = (lineId: string, delta: number) => {
    setMesas((prev) =>
      prev.map((m) => {
        if (m.id !== selectedMesaId) return m
        return {
          ...m,
          itens: m.itens
            .map((it) => {
              if (it.lineId !== lineId) return it
              const step = it.vendaPorPeso ? 0.05 : 1
              const q = it.quantity + delta * step
              return q > 0 ? { ...it, quantity: q } : it
            })
            .filter((it) => it.quantity > 0),
        }
      })
    )
  }

  const removeLine = (lineId: string) => {
    setMesas((prev) =>
      prev.map((m) =>
        m.id === selectedMesaId
          ? { ...m, itens: m.itens.filter((it) => it.lineId !== lineId) }
          : m
      )
    )
  }

  const subtotalMesa =
    selectedMesa?.itens.reduce((s, it) => s + it.price * it.quantity, 0) ?? 0

  const enviarAoCaixa = () => {
    if (!selectedMesa?.itens.length) {
      toast({ title: "Mesa vazia", description: "Adicione itens antes de enviar ao caixa." })
      return
    }
    try {
      sessionStorage.setItem(
        PDV_IMPORT_COMANDA_KEY,
        JSON.stringify({
          mesaLabel: selectedMesa.label,
          lines: selectedMesa.itens.map((it) => ({
            inventoryId: it.inventoryId,
            name: it.name,
            price: it.price,
            quantity: it.quantity,
            vendaPorPeso: it.vendaPorPeso,
            atributosLabel: it.atributosLabel,
          })),
        })
      )
    } catch {
      toast({ title: "Erro", description: "Não foi possível preparar a comanda.", variant: "destructive" })
      return
    }
    setMesas((prev) =>
      prev.map((m) => (m.id === selectedMesaId ? { ...m, itens: [] } : m))
    )
    onNavigateToPdv()
    toast({
      title: "Enviado ao PDV",
      description: "Os itens foram carregados no caixa para pagamento.",
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(200px,280px)_1fr] gap-4">
      <Card className="bg-card border-border h-fit lg:sticky lg:top-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Mesas</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2 max-h-[min(60vh,520px)] overflow-y-auto">
          {mesas.map((m) => (
            <Button
              key={m.id}
              variant={selectedMesaId === m.id ? "default" : "outline"}
              className="h-12 text-sm justify-center"
              onClick={() => setSelectedMesaId(m.id)}
            >
              {m.label}
              {m.itens.length > 0 ? (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1">
                  {m.itens.length}
                </Badge>
              ) : null}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">
              {selectedMesa?.label ?? "Mesa"} — consumo
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="text-xl font-bold text-primary">
                R$ {subtotalMesa.toFixed(2)}
              </span>
              <Button className="gap-2" onClick={enviarAoCaixa} disabled={!selectedMesa?.itens.length}>
                <ArrowRightToLine className="w-4 h-4" />
                Cobrar no caixa (PDV)
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {selectedMesa && selectedMesa.itens.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum item nesta mesa. Adicione produtos ao lado.
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedMesa?.itens.map((it) => (
                  <li
                    key={it.lineId}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border border-border bg-secondary/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.vendaPorPeso
                          ? `R$ ${it.price.toFixed(2)}/kg × ${it.quantity.toFixed(3)} kg`
                          : `R$ ${it.price.toFixed(2)} × ${it.quantity}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQty(it.lineId, -1)}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQty(it.lineId, 1)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeLine(it.lineId)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Adicionar à mesa selecionada</CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-secondary border-border"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[min(50vh,480px)] overflow-y-auto">
              {filteredProducts.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  className="h-auto min-h-[72px] flex flex-col items-stretch p-3 text-left border-border hover:border-primary/50"
                  disabled={p.stock <= 0}
                  onClick={() => addProduct(p)}
                >
                  <span className="font-medium line-clamp-2">{p.name}</span>
                  <span className="text-xs text-muted-foreground mt-1">
                    {p.vendaPorPeso
                      ? `R$ ${(p.precoPorKg ?? p.price).toFixed(2)}/kg`
                      : `R$ ${p.price.toFixed(2)}`}
                    {p.stock > 0 ? ` · estq. ${p.vendaPorPeso ? `${p.stock} kg` : p.stock}` : " · sem estoque"}
                  </span>
                </Button>
              ))}
            </div>
            {filteredProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum produto encontrado.</p>
            ) : null}
          </CardContent>
        </Card>

        <Separator className="opacity-50" />
        <p className="text-xs text-muted-foreground">
          Os dados das mesas ficam no navegador deste computador. Use &quot;Cobrar no caixa&quot; para carregar os itens no PDV e
          finalizar o pagamento.
        </p>
      </div>

      <AttrProductDialog
        open={attrDialogOpen}
        onOpenChange={(open) => {
          setAttrDialogOpen(open)
          if (!open) setAttrProduct(null)
        }}
        product={attrProduct}
        attrSelections={attrSelections}
        onAttrSelectionsChange={setAttrSelections}
        onConfirm={confirmAttrDialog}
      />

      <WeightProductDialog
        open={weightDialogOpen}
        onOpenChange={(open) => {
          setWeightDialogOpen(open)
          if (!open) setWeightProduct(null)
        }}
        product={weightProduct}
        weightKgInput={weightKgInput}
        onWeightKgInputChange={setWeightKgInput}
        onConfirm={confirmWeightDialog}
        onReadScale={handleLerBalança}
        scaleBusy={scaleBusy}
      />
    </div>
  )
}
