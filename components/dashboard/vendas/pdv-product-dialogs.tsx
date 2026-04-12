"use client"

import { Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PdvCatalogProduct } from "@/lib/pdv-catalog"

type AttrProductDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: PdvCatalogProduct | null
  attrSelections: Record<string, string>
  onAttrSelectionsChange: (next: Record<string, string>) => void
  onConfirm: () => void
}

export function AttrProductDialog({
  open,
  onOpenChange,
  product,
  attrSelections,
  onAttrSelectionsChange,
  onConfirm,
}: AttrProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Variações do produto</DialogTitle>
          <DialogDescription>
            {product ? `Escolha as opções para ${product.name}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {product?.atributos && product.atributos.length > 0 ? (
          <div className="space-y-4 py-2">
            {product.atributos.map((a) => (
              <div key={a.id} className="space-y-2">
                <Label>{a.nome}</Label>
                <Select
                  value={attrSelections[a.id] ?? ""}
                  onValueChange={(v) =>
                    onAttrSelectionsChange({ ...attrSelections, [a.id]: v })
                  }
                >
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue placeholder={`Selecione ${a.nome}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {a.opcoes.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="bg-primary" onClick={onConfirm}>
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type WeightProductDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: PdvCatalogProduct | null
  weightKgInput: string
  onWeightKgInputChange: (v: string) => void
  onConfirm: () => void
  onReadScale: () => void
  scaleBusy: boolean
}

export function WeightProductDialog({
  open,
  onOpenChange,
  product,
  weightKgInput,
  onWeightKgInputChange,
  onConfirm,
  onReadScale,
  scaleBusy,
}: WeightProductDialogProps) {
  const pKg = product ? product.precoPorKg ?? product.price : 0
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            Venda por peso
          </DialogTitle>
          <DialogDescription>
            {product
              ? `${product.name} — informe o peso em kg ou leia na balança (USB/Web Serial).`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Preço:{" "}
            <span className="font-medium text-foreground">
              R$ {pKg.toFixed(2)} / kg
            </span>
          </p>
          <div className="space-y-2">
            <Label htmlFor="pdv-peso-kg">Peso (kg)</Label>
            <Input
              id="pdv-peso-kg"
              inputMode="decimal"
              placeholder="0,000"
              value={weightKgInput}
              onChange={(e) => onWeightKgInputChange(e.target.value)}
              className="bg-secondary border-border text-lg"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={scaleBusy}
            onClick={onReadScale}
          >
            {scaleBusy ? "Lendo balança…" : "Ler balança (USB)"}
          </Button>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="bg-primary" onClick={onConfirm}>
            Adicionar ao carrinho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
