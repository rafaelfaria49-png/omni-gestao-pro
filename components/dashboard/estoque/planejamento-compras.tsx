"use client"

import { useMemo } from "react"
import { FileDown, Info, Package } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useOperationsStore } from "@/lib/operations-store"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import {
  computePurchasePlanning,
  PURCHASE_COVERAGE_ALERT_DAYS,
  PURCHASE_WINDOW_DAYS,
  suggestedOrderQty,
} from "@/lib/purchase-planning"
import { openPurchaseListPrintWindow } from "@/lib/purchase-planning-pdf"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function PlanejamentoCompras() {
  const { inventory, sales, devolucoes } = useOperationsStore()
  const { config } = useConfigEmpresa()
  const { empresaDocumentos } = useLojaAtiva()

  const rows = useMemo(
    () => computePurchasePlanning(inventory, sales, devolucoes),
    [inventory, sales, devolucoes]
  )

  const empresaNome =
    (empresaDocumentos.nomeFantasia || "").trim() || config.empresa.nomeFantasia || configPadrao.empresa.nomeFantasia

  const suggestedCount = rows.filter((r) => r.suggestPurchase).length

  const fmtBrl = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Package className="w-6 h-6 text-primary" />
                Planejamento de Compras
              </CardTitle>
              <CardDescription>
                Estoque atual cruzado com vendas líquidas dos últimos {PURCHASE_WINDOW_DAYS} dias (vendas
                menos devoluções no período). Itens com cobertura estimada inferior a{" "}
                {PURCHASE_COVERAGE_ALERT_DAYS} dias aparecem em vermelho como sugestão de compra.
              </CardDescription>
            </div>
            <Button
              type="button"
              className="shrink-0 bg-primary hover:bg-primary/90"
              onClick={() => openPurchaseListPrintWindow(rows, empresaNome, { onlySuggested: true })}
            >
              <FileDown className="w-4 h-4 mr-2" />
              Lista de Compras em PDF
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              O botão abre uma página para impressão. No diálogo, use <strong>Salvar como PDF</strong> ou
              envie direto à impressora.
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Itens em alerta:</span>{" "}
              <span className="font-semibold text-foreground">{suggestedCount}</span>
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reposição e giro</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Vendas líq. (30d)</TableHead>
                    <TableHead className="text-right">Média/dia</TableHead>
                    <TableHead className="text-right">Cobertura (dias)</TableHead>
                    <TableHead className="text-right">Sug. qtd</TableHead>
                    <TableHead>Critério</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                        Nenhum produto cadastrado no estoque.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow
                        key={r.inventoryId}
                        className={
                          r.suggestPurchase
                            ? "bg-destructive/10 border-l-4 border-l-destructive"
                            : undefined
                        }
                      >
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>{r.category}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.stock}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.qtyNet30d}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.avgDaily.toFixed(3)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.coverageDays != null ? r.coverageDays.toFixed(1) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{suggestedOrderQty(r)}</TableCell>
                        <TableCell>
                          {r.suggestPurchase ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="destructive" className="font-normal">
                                Sugestão de Compra
                              </Badge>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    aria-label="Detalhes"
                                  >
                                    <Info className="w-4 h-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  <p className="text-xs">{r.motivo}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Dentro do limite</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Custo médio de reposição estimado (sugestão × custo):{" "}
          {fmtBrl(
            rows
              .filter((r) => r.suggestPurchase)
              .reduce((s, r) => s + r.cost * suggestedOrderQty(r), 0)
          )}
        </p>
      </div>
    </TooltipProvider>
  )
}
