"use client"

import { useState, useEffect } from "react"
import { 
  Banknote, 
  CreditCard, 
  QrCode, 
  FileText, 
  Printer, 
  FileCheck, 
  X,
  Plus,
  Minus,
  Calculator,
  Eye,
  EyeOff,
  Receipt,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useToast } from "@/hooks/use-toast"
import type { MaquininhaConfig } from "@/lib/rafacell-centro-financeiro"
import { getMaquininhasAtivas, temMaquininhaAtivaNoCaixa } from "@/lib/rafacell-centro-financeiro"

export type PaymentMethodType =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "carne"
  | "credito_vale"

export interface PaymentMethod {
  id: string
  type: PaymentMethodType
  value: number
  installments?: number
  /** Maquininha usada no caixa (cartão débito/crédito). */
  maquininhaId?: string
  maquininhaNome?: string
}

interface Customer {
  id: string
  name: string
  cpf: string
  phone: string
  saldoDevedor?: number
}

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  /** Subtotal do carrinho (antes de desconto). */
  cartSubtotal: number
  total: number
  discountReais: number
  discountPercent: number
  onDiscountReaisChange: (value: number) => void
  onDiscountPercentChange: (value: number) => void
  custoPeca?: number
  selectedCustomer?: Customer | null
  /** Saldo de crédito/vale (mesmo CPF) para abatimento. */
  customerStoreCredit?: number
  onConfirm?: (payments: PaymentMethod[]) => void
}

export function PaymentModal({ 
  isOpen, 
  onClose, 
  cartSubtotal = 0,
  total = 450.00,
  discountReais = 0,
  discountPercent = 0,
  onDiscountReaisChange,
  onDiscountPercentChange,
  custoPeca = 120.00,
  selectedCustomer,
  customerStoreCredit = 0,
  onConfirm 
}: PaymentModalProps) {
  const { config } = useConfigEmpresa()
  const { toast } = useToast()
  const [payments, setPayments] = useState<PaymentMethod[]>([])
  const [currentValue, setCurrentValue] = useState("")
  const [selectedType, setSelectedType] = useState<PaymentMethodType | null>(null)
  const [carneInstallments, setCarneInstallments] = useState("3")
  const [showMerchantPanel, setShowMerchantPanel] = useState(false)

  const totalPaid = payments.reduce((sum, p) => sum + p.value, 0)
  const remaining = Math.max(0, total - totalPaid)
  const [cartaoLiberado, setCartaoLiberado] = useState(true)
  const [maquininhasAtivasPdv, setMaquininhasAtivasPdv] = useState<MaquininhaConfig[]>([])
  const [maquininhaPdvId, setMaquininhaPdvId] = useState("")
  useEffect(() => {
    if (!isOpen) return
    setCartaoLiberado(temMaquininhaAtivaNoCaixa())
    const ativas = getMaquininhasAtivas()
    setMaquininhasAtivasPdv(ativas)
    setMaquininhaPdvId((prev) => {
      if (ativas.length === 0) return ""
      if (prev && ativas.some((m) => m.id === prev)) return prev
      return ativas[0]!.id
    })
  }, [isOpen])
  const lucro = total - custoPeca
  const margemLucro = ((lucro / total) * 100).toFixed(1)

  useEffect(() => {
    if (!isOpen) {
      setPayments([])
      setCurrentValue("")
      setSelectedType(null)
    }
  }, [isOpen])

  const handleAddPayment = (type: PaymentMethodType) => {
    let max = remaining
    if (type === "credito_vale") {
      max = Math.min(remaining, Math.max(0, customerStoreCredit))
    }
    const value = parseFloat(currentValue) || max
    if (value <= 0) return

    const maq =
      type === "cartao_debito" || type === "cartao_credito"
        ? maquininhasAtivasPdv.find((m) => m.id === maquininhaPdvId) ?? maquininhasAtivasPdv[0]
        : undefined

    const newPayment: PaymentMethod = {
      id: Date.now().toString(),
      type,
      value: Math.min(value, max),
      installments: type === "carne" ? parseInt(carneInstallments) : undefined,
      ...(maq
        ? { maquininhaId: maq.id, maquininhaNome: maq.nome }
        : {}),
    }

    setPayments([...payments, newPayment])
    setCurrentValue("")
    setSelectedType(null)
  }

  const handleRemovePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id))
  }

  const handleQuickValue = (value: number) => {
    setCurrentValue(value.toString())
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const gerarParcelasCarne = (valorTotal: number, qtd: number) => {
    const baseDate = new Date()
    return Array.from({ length: qtd }, (_, i) => {
      const venc = new Date(baseDate)
      venc.setMonth(venc.getMonth() + i + 1)
      return {
        numero: i + 1,
        valor: valorTotal / qtd,
        vencimento: venc.toLocaleDateString("pt-BR"),
      }
    })
  }

  const handleGerarBoletoCarne = () => {
    const valorTotal = parseFloat(currentValue) || remaining
    const qtd = Math.max(1, parseInt(carneInstallments || "1", 10))
    const parcelas = gerarParcelasCarne(valorTotal, qtd)
    const empresa = config.empresa
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Carnê RAFACELL ASSISTEC</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px">
        <h2>RAFACELL ASSISTEC - Carnê de Parcelamento</h2>
        <p><strong>CNPJ:</strong> ${empresa.cnpj}</p>
        <p><strong>Cliente:</strong> ${selectedCustomer?.name || "Consumidor"} | <strong>CPF:</strong> ${selectedCustomer?.cpf || "-"}</p>
        <p><strong>Valor Total:</strong> ${formatCurrency(valorTotal)}</p>
        <hr />
        ${parcelas
          .map(
            (p) =>
              `<p><strong>${p.numero}/${qtd}</strong> - Valor: ${formatCurrency(p.valor)} | Vencimento: ${p.vencimento}</p>`
          )
          .join("")}
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  const getPaymentIcon = (type: string) => {
    switch (type) {
      case "dinheiro": return <Banknote className="w-4 h-4" />
      case "pix": return <QrCode className="w-4 h-4" />
      case "cartao_debito": return <CreditCard className="w-4 h-4" />
      case "cartao_credito": return <CreditCard className="w-4 h-4" />
      case "carne": return <FileText className="w-4 h-4" />
      case "credito_vale": return <Wallet className="w-4 h-4" />
      default: return null
    }
  }

  const getPaymentLabel = (payment: PaymentMethod) => {
    const nomeMaq = payment.maquininhaNome ? ` — ${payment.maquininhaNome}` : ""
    switch (payment.type) {
      case "dinheiro":
        return "Dinheiro"
      case "pix":
        return "Pix"
      case "cartao_debito":
        return `Cartão débito${nomeMaq}`
      case "cartao_credito":
        return `Cartão crédito${nomeMaq}`
      case "carne":
        return "Carnê"
      case "credito_vale":
        return "Crédito/Vale"
      default:
        return payment.type
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto bg-card border-border">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            Finalizar Pagamento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatCurrency(cartSubtotal)}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Desconto (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={discountReais || ""}
                  onChange={(e) => onDiscountReaisChange(parseFloat(e.target.value) || 0)}
                  className="h-10 bg-secondary border-border"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Desconto (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={discountPercent || ""}
                  onChange={(e) => onDiscountPercentChange(parseFloat(e.target.value) || 0)}
                  className="h-10 bg-secondary border-border"
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O percentual incide sobre o subtotal; o valor em R$ soma ao desconto (limitado ao subtotal).
            </p>
          </div>

          {/* Total em Destaque - Visível para o Cliente */}
          <Card className="bg-secondary border-2 border-primary">
            <CardContent className="pt-6 pb-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground uppercase tracking-wide mb-1">Total a Pagar</p>
                <p className="text-5xl font-bold text-primary">{formatCurrency(total)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Status de Pagamento */}
          {payments.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-green-500/10 border-green-500/30">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-green-400 uppercase mb-1">Pago</p>
                  <p className="text-2xl font-bold text-green-500">{formatCurrency(totalPaid)}</p>
                </CardContent>
              </Card>
              <Card className={`${remaining > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                <CardContent className="pt-4 pb-4">
                  <p className={`text-xs uppercase mb-1 ${remaining > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {remaining > 0 ? 'Restante' : 'Completo'}
                  </p>
                  <p className={`text-2xl font-bold ${remaining > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                    {formatCurrency(remaining)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Pagamentos Adicionados */}
          {payments.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Formas de Pagamento Adicionadas</Label>
              <div className="flex flex-wrap gap-2">
                {payments.map((payment) => (
                  <Badge 
                    key={payment.id} 
                    variant="secondary" 
                    className="px-3 py-2 text-sm flex items-center gap-2 bg-secondary"
                  >
                    {getPaymentIcon(payment.type)}
                    {getPaymentLabel(payment)}
                    {payment.installments && ` ${payment.installments}x`}
                    : {formatCurrency(payment.value)}
                    <button
                      onClick={() => handleRemovePayment(payment.id)}
                      className="ml-1 hover:text-primary transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Input de Valor */}
          {remaining > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Valor a Adicionar</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    placeholder={remaining.toFixed(2)}
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                    className="pl-10 h-12 text-lg font-semibold bg-secondary border-border"
                  />
                </div>
              </div>
              
              {/* Valores Rápidos */}
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(50)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 50
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(100)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 100
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(200)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  R$ 200
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleQuickValue(remaining)}
                  className="border-border hover:bg-primary hover:text-primary-foreground"
                >
                  Total Restante
                </Button>
              </div>
            </div>
          )}

          {/* Botões de Forma de Pagamento */}
          {remaining > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-muted-foreground">Escolha a Forma de Pagamento</Label>
              {selectedCustomer && customerStoreCredit > 0 && (
                <p className="text-xs text-muted-foreground">
                  Crédito em haver disponível: <span className="text-primary font-medium">{formatCurrency(customerStoreCredit)}</span>
                </p>
              )}
              {!cartaoLiberado && (
                <p className="text-xs text-amber-600/90">
                  Cartão débito/crédito: ative uma maquininha em{" "}
                  <strong>Configurações → Financeiro RAFACELL</strong> (aba Taxas de cartão).
                </p>
              )}
              {cartaoLiberado && maquininhasAtivasPdv.length > 1 && (
                <div className="space-y-2 max-w-md">
                  <Label className="text-xs text-muted-foreground">Maquininha (nome no caixa)</Label>
                  <Select value={maquininhaPdvId} onValueChange={setMaquininhaPdvId}>
                    <SelectTrigger className="h-11 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {maquininhasAtivasPdv.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Button
                  size="lg"
                  variant={selectedType === "dinheiro" ? "default" : "outline"}
                  onClick={() => {
                    setSelectedType("dinheiro")
                    handleAddPayment("dinheiro")
                  }}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "dinheiro" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <Banknote className="w-5 h-5" />
                  <span className="font-semibold">Dinheiro</span>
                </Button>
                
                <Button
                  size="lg"
                  variant={selectedType === "pix" ? "default" : "outline"}
                  onClick={() => {
                    setSelectedType("pix")
                    handleAddPayment("pix")
                  }}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "pix" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <QrCode className="w-5 h-5" />
                  <span className="font-semibold">Pix</span>
                </Button>
                
                <Button
                  size="lg"
                  variant={selectedType === "cartao_debito" ? "default" : "outline"}
                  disabled={!cartaoLiberado}
                  title={
                    !cartaoLiberado
                      ? "Ative pelo menos uma maquininha em Configurações → Financeiro RAFACELL"
                      : undefined
                  }
                  onClick={() => {
                    setSelectedType("cartao_debito")
                    handleAddPayment("cartao_debito")
                  }}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "cartao_debito" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span className="font-semibold">Débito</span>
                </Button>
                
                <Button
                  size="lg"
                  variant={selectedType === "cartao_credito" ? "default" : "outline"}
                  disabled={!cartaoLiberado}
                  title={
                    !cartaoLiberado
                      ? "Ative pelo menos uma maquininha em Configurações → Financeiro RAFACELL"
                      : undefined
                  }
                  onClick={() => {
                    setSelectedType("cartao_credito")
                    handleAddPayment("cartao_credito")
                  }}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "cartao_credito" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span className="font-semibold">Crédito</span>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  disabled={!selectedCustomer || customerStoreCredit <= 0}
                  onClick={() => {
                    setSelectedType("credito_vale")
                    handleAddPayment("credito_vale")
                  }}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "credito_vale" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <Wallet className="w-5 h-5" />
                  <span className="font-semibold">Crédito/Vale</span>
                </Button>
                
                <Button
                  size="lg"
                  variant={selectedType === "carne" ? "default" : "outline"}
                  onClick={() => setSelectedType("carne")}
                  className={`h-14 flex flex-col gap-0.5 text-xs ${
                    selectedType === "carne" 
                      ? "bg-primary text-primary-foreground" 
                      : "border-border hover:bg-primary/10 hover:border-primary"
                  }`}
                >
                  <FileText className="w-5 h-5" />
                  <span className="font-semibold">Carnê</span>
                </Button>
              </div>
            </div>
          )}

          {/* Módulo Carnê */}
          {selectedType === "carne" && remaining > 0 && (
            <Card className="border-primary bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Configurar Carnê
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Parcelas</Label>
                    <Select value={carneInstallments} onValueChange={setCarneInstallments}>
                      <SelectTrigger className="bg-secondary border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n}x de {formatCurrency((parseFloat(currentValue) || remaining) / n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Valor Total Carnê</Label>
                    <div className="h-10 px-3 flex items-center bg-secondary rounded-md border border-border">
                      <span className="font-semibold">{formatCurrency(parseFloat(currentValue) || remaining)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-primary hover:bg-primary/90"
                    onClick={() => handleAddPayment("carne")}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Carnê {carneInstallments}x
                  </Button>
                  <Button
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={handleGerarBoletoCarne}
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Gerar Boleto/Carnê
                  </Button>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {gerarParcelasCarne(parseFloat(currentValue) || remaining, parseInt(carneInstallments || "1", 10)).map((p) => (
                    <p key={p.numero}>{p.numero}/{carneInstallments} - {formatCurrency(p.valor)} - vence em {p.vencimento}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Separator className="bg-border" />

          {/* Painel do Lojista (Discreto) */}
          <div className="space-y-2">
            <button
              onClick={() => setShowMerchantPanel(!showMerchantPanel)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showMerchantPanel ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showMerchantPanel ? "Ocultar informações do lojista" : "Ver informações do lojista"}
            </button>
            
            {showMerchantPanel && (
              <Card className="bg-muted/30 border-dashed border-muted">
                <CardContent className="pt-4 pb-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Custo da Peça</p>
                      <p className="font-semibold text-foreground">{formatCurrency(custoPeca)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Lucro da Operação</p>
                      <p className="font-semibold text-green-500">{formatCurrency(lucro)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Margem</p>
                      <p className="font-semibold text-primary">{margemLucro}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <Separator className="bg-border" />

          {/* Botões de Impressão */}
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">Impressão e Documentos</Label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                variant="outline"
                className="h-14 border-border hover:bg-secondary"
                disabled={remaining > 0}
                onClick={() => toast({ title: "Cupom pronto para impressão", description: "Envie para a impressora térmica conectada." })}
              >
                <Printer className="w-5 h-5 mr-2" />
                <div className="text-left">
                  <p className="text-sm font-semibold">Imprimir Cupom</p>
                  <p className="text-xs text-muted-foreground">Térmica 80mm</p>
                </div>
              </Button>
              
              <Button
                size="lg"
                variant="outline"
                className="h-14 border-border hover:bg-secondary"
                disabled={remaining > 0}
                onClick={() => toast({ title: "Contrato de garantia gerado", description: "Documento preparado para impressão A4." })}
              >
                <FileCheck className="w-5 h-5 mr-2" />
                <div className="text-left">
                  <p className="text-sm font-semibold">Gerar Contrato</p>
                  <p className="text-xs text-muted-foreground">Garantia A4</p>
                </div>
              </Button>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12 border-border"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                onConfirm?.(payments)
                onClose()
              }}
              disabled={remaining > 0}
              className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {remaining > 0 ? `Falta ${formatCurrency(remaining)}` : "Confirmar Pagamento"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
