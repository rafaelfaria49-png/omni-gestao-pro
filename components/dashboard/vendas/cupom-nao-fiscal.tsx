"use client"

import { useCallback } from "react"
import { Printer, Copy, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { escapeHtml, openThermalHtmlPrint } from "@/lib/thermal-print"
import { sanitizeOperatorLabel } from "@/lib/pdv-operator-label"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CupomItem {
  nome: string
  quantidade: number
  precoUnitario: number
  lineTotal: number
}

export interface CupomPagamento {
  label: string
  valor: number
}

export interface CupomData {
  /** ID da venda (ex: VDA-2026-0001) */
  numeroPedido: string
  at: string
  /** Nome da loja */
  lojaNome: string
  lojaCnpj?: string
  lojaEndereco?: string
  clienteNome?: string | null
  clienteCpf?: string | null
  operador?: string | null
  sessaoId?: string | null
  itens: CupomItem[]
  pagamentos: CupomPagamento[]
  total: number
  desconto?: number
  status?: string
  tipoVenda?: string
  observacaoGeral?: string
}

interface CupomNaoFiscalProps {
  isOpen: boolean
  onClose: () => void
  data: CupomData
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return iso
  }
}

function buildTexto(d: CupomData): string {
  // Guarda central de comprovante: nunca imprime id técnico como operador.
  const operador = sanitizeOperatorLabel(d.operador)
  const lines: string[] = []
  lines.push("================================")
  lines.push(d.lojaNome.toUpperCase())
  if (d.lojaCnpj) lines.push(`CNPJ: ${d.lojaCnpj}`)
  if (d.lojaEndereco) lines.push(d.lojaEndereco)
  lines.push("================================")
  lines.push("    DOCUMENTO NÃO FISCAL")
  lines.push("  Este comprovante não é DANFC-e / NFC-e.")
  lines.push("================================")
  lines.push(`Venda:    ${d.numeroPedido}`)
  lines.push(`Data:     ${fmtDate(d.at)}`)
  if (operador) lines.push(`Operador: ${operador}`)
  if (d.clienteNome) lines.push(`Cliente:  ${d.clienteNome}`)
  if (d.clienteCpf) lines.push(`CPF:      ${d.clienteCpf}`)
  if (d.tipoVenda) lines.push(`Tipo:     ${d.tipoVenda}`)
  if (d.observacaoGeral) lines.push(`Obs:      ${d.observacaoGeral}`)
  lines.push("--------------------------------")
  lines.push("ITENS")
  lines.push("--------------------------------")
  for (const it of d.itens) {
    lines.push(`${it.nome}`)
    lines.push(`  ${it.quantidade}x ${fmt(it.precoUnitario)} = ${fmt(it.lineTotal)}`)
  }
  lines.push("--------------------------------")
  if ((d.desconto ?? 0) > 0) {
    lines.push(`Subtotal:  ${fmt(d.total + (d.desconto ?? 0))}`)
    lines.push(`Desconto:  -${fmt(d.desconto ?? 0)}`)
  }
  lines.push(`TOTAL:     ${fmt(d.total)}`)
  lines.push("--------------------------------")
  lines.push("PAGAMENTO")
  for (const pg of d.pagamentos) {
    lines.push(`  ${pg.label}: ${fmt(pg.valor)}`)
  }
  lines.push("================================")
  lines.push("  Obrigado pela preferência!")
  lines.push("================================")
  return lines.join("\n")
}

function buildHtml(d: CupomData): string {
  const esc = escapeHtml
  const operador = sanitizeOperatorLabel(d.operador)
  const isCancelada = d.status === "cancelada"

  const itensHtml = d.itens
    .map(
      (it) =>
        `<tr>
          <td style="padding:2px 0">${esc(it.nome)}</td>
          <td style="text-align:center;padding:2px 4px">${it.quantidade}x</td>
          <td style="text-align:right;padding:2px 0">${esc(fmt(it.precoUnitario))}</td>
          <td style="text-align:right;padding:2px 0">${esc(fmt(it.lineTotal))}</td>
        </tr>`
    )
    .join("")

  const pgHtml = d.pagamentos
    .map(
      (pg) =>
        `<div style="display:flex;justify-content:space-between"><span>${esc(pg.label)}</span><span><b>${esc(fmt(pg.valor))}</b></span></div>`
    )
    .join("")

  return `
    <div style="text-align:center;font-weight:700;font-size:13px">${esc(d.lojaNome.toUpperCase())}</div>
    ${d.lojaCnpj ? `<div style="text-align:center;font-size:10px">CNPJ: ${esc(d.lojaCnpj)}</div>` : ""}
    ${d.lojaEndereco ? `<div style="text-align:center;font-size:10px">${esc(d.lojaEndereco)}</div>` : ""}
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="text-align:center;font-size:11px;font-weight:600;letter-spacing:1px">
      ${isCancelada ? "⚠ VENDA CANCELADA ⚠" : "DOCUMENTO NÃO FISCAL"}
    </div>
    ${isCancelada ? "" : `<div style="text-align:center;font-size:9px">Este comprovante não é DANFC-e / NFC-e.</div>`}
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="font-size:10px">
      <div style="display:flex;justify-content:space-between"><span>Venda:</span><span><b>${esc(d.numeroPedido)}</b></span></div>
      <div style="display:flex;justify-content:space-between"><span>Data:</span><span>${esc(fmtDate(d.at))}</span></div>
      ${operador ? `<div style="display:flex;justify-content:space-between"><span>Operador:</span><span>${esc(operador)}</span></div>` : ""}
      ${d.clienteNome ? `<div style="display:flex;justify-content:space-between"><span>Cliente:</span><span>${esc(d.clienteNome)}</span></div>` : ""}
      ${d.clienteCpf ? `<div style="display:flex;justify-content:space-between"><span>CPF:</span><span>${esc(d.clienteCpf)}</span></div>` : ""}
      ${d.tipoVenda ? `<div style="display:flex;justify-content:space-between"><span>Tipo:</span><span>${esc(d.tipoVenda)}</span></div>` : ""}
      ${d.observacaoGeral ? `<div style="display:flex;justify-content:space-between"><span>Obs:</span><span>${esc(d.observacaoGeral)}</span></div>` : ""}
    </div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="font-size:10px;font-weight:600;margin-bottom:3px">ITENS</div>
    <table style="width:100%;font-size:10px;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:1px solid #ccc">
          <th style="text-align:left;font-weight:500">Descrição</th>
          <th style="text-align:center;font-weight:500">Qtd</th>
          <th style="text-align:right;font-weight:500">Unit.</th>
          <th style="text-align:right;font-weight:500">Total</th>
        </tr>
      </thead>
      <tbody>${itensHtml}</tbody>
    </table>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="font-size:10px">
      ${(d.desconto ?? 0) > 0 ? `<div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>${esc(fmt(d.total + (d.desconto ?? 0)))}</span></div><div style="display:flex;justify-content:space-between;color:red"><span>Desconto:</span><span>-${esc(fmt(d.desconto ?? 0))}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-top:4px"><span>TOTAL:</span><span>${esc(fmt(d.total))}</span></div>
    </div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="font-size:10px;font-weight:600;margin-bottom:3px">PAGAMENTO</div>
    <div style="font-size:10px">${pgHtml}</div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="text-align:center;font-size:9px">Obrigado pela preferência!</div>
  `
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CupomNaoFiscal({ isOpen, onClose, data }: CupomNaoFiscalProps) {
  const { toast } = useToast()
  const isCancelada = data.status === "cancelada"
  const operador = sanitizeOperatorLabel(data.operador)

  const handleImprimir = useCallback(() => {
    openThermalHtmlPrint(buildHtml(data), `Cupom ${data.numeroPedido}`)
  }, [data])

  const handleCopiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildTexto(data))
      toast({ title: "Copiado", description: "Cupom copiado para a área de transferência." })
    } catch {
      toast({ title: "Erro", description: "Não foi possível copiar.", variant: "destructive" })
    }
  }, [data, toast])

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-border bg-card p-0">
        <div className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader className="shrink-0 px-5 pt-5 pb-2">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-bold text-foreground">
                {isCancelada ? "Cupom — VENDA CANCELADA" : "Cupom / Recibo Não Fiscal"}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
            {/* Cupom preview */}
            <div className="rounded-xl border border-dashed border-border bg-background/60 p-4 font-mono text-xs leading-relaxed">
              {/* Store header */}
              <div className="text-center space-y-0.5 mb-3">
                <p className="font-bold text-sm text-foreground">{data.lojaNome.toUpperCase()}</p>
                {data.lojaCnpj && (
                  <p className="text-muted-foreground">CNPJ: {data.lojaCnpj}</p>
                )}
                {data.lojaEndereco && (
                  <p className="text-muted-foreground text-[10px]">{data.lojaEndereco}</p>
                )}
              </div>

              <Separator className="border-dashed my-2" />

              <p className={`text-center font-bold text-[11px] tracking-widest mb-2 ${isCancelada ? "text-destructive" : "text-muted-foreground"}`}>
                {isCancelada ? "⚠ VENDA CANCELADA ⚠" : "DOCUMENTO NÃO FISCAL"}
              </p>
              {!isCancelada && (
                <p className="text-center text-[10px] text-muted-foreground mb-2">
                  Este comprovante não é DANFC-e / NFC-e.
                </p>
              )}

              <Separator className="border-dashed my-2" />

              {/* Sale info */}
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Venda:</span>
                  <span className="font-semibold text-foreground">{data.numeroPedido}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Data:</span>
                  <span>{fmtDate(data.at)}</span>
                </div>
                {operador && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Operador:</span>
                    <span>{operador}</span>
                  </div>
                )}
                {data.clienteNome && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente:</span>
                    <span>{data.clienteNome}</span>
                  </div>
                )}
                {data.clienteCpf && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CPF:</span>
                    <span>{data.clienteCpf}</span>
                  </div>
                )}
                {data.tipoVenda && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tipo:</span>
                    <span className="font-medium">{data.tipoVenda}</span>
                  </div>
                )}
                {data.observacaoGeral && (
                  <div className="flex justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Obs:</span>
                    <span className="text-right">{data.observacaoGeral}</span>
                  </div>
                )}
              </div>

              <Separator className="border-dashed my-2" />

              {/* Items */}
              <p className="font-semibold text-[11px] mb-1 text-foreground">ITENS</p>
              <div className="space-y-1">
                {data.itens.map((it, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="text-foreground truncate">{it.nome}</div>
                    <div className="flex justify-between text-muted-foreground pl-2">
                      <span>{it.quantidade}x {fmt(it.precoUnitario)}</span>
                      <span className="text-foreground font-medium">{fmt(it.lineTotal)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="border-dashed my-2" />

              {/* Totals */}
              <div className="space-y-0.5 text-[11px]">
                {(data.desconto ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal:</span>
                      <span>{fmt(data.total + (data.desconto ?? 0))}</span>
                    </div>
                    <div className="flex justify-between text-destructive">
                      <span>Desconto:</span>
                      <span>-{fmt(data.desconto ?? 0)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-bold text-sm text-foreground">
                  <span>TOTAL:</span>
                  <span>{fmt(data.total)}</span>
                </div>
              </div>

              <Separator className="border-dashed my-2" />

              {/* Payments */}
              <p className="font-semibold text-[11px] mb-1 text-foreground">PAGAMENTO</p>
              <div className="space-y-0.5 text-[11px]">
                {data.pagamentos.length === 0 ? (
                  <p className="text-muted-foreground">—</p>
                ) : (
                  data.pagamentos.map((pg, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-muted-foreground">{pg.label}:</span>
                      <span className="font-semibold text-foreground">{fmt(pg.valor)}</span>
                    </div>
                  ))
                )}
              </div>

              <Separator className="border-dashed my-2" />
              <p className="text-center text-[10px] text-muted-foreground">Obrigado pela preferência!</p>
            </div>
          </div>

          {/* Actions */}
          <div className="shrink-0 border-t border-border px-5 py-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="h-10 flex-1 gap-2 border-border text-sm"
                onClick={handleImprimir}
              >
                <Printer className="h-4 w-4" />
                Imprimir cupom
              </Button>
              <Button
                variant="outline"
                className="h-10 flex-1 gap-2 border-border text-sm"
                onClick={() => void handleCopiar()}
              >
                <Copy className="h-4 w-4" />
                Copiar resumo
              </Button>
            </div>
            <Button
              variant="ghost"
              className="mt-2 h-9 w-full text-sm text-muted-foreground"
              onClick={onClose}
            >
              <X className="mr-2 h-4 w-4" />
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
