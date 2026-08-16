"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Search, Package, Wallet, RotateCcw, Printer, Plus, Minus, X, ShoppingCart } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useOperationsStore, type SaleRecord, type InventoryItem } from "@/lib/operations-store"
import { normalizeDocDigits } from "@/lib/cpf"
import { buildValeTrocaEscPos } from "@/lib/escpos"
import { sendEscPosViaProxy, downloadEscPosFile, openThermalHtmlPrint, escapeHtml } from "@/lib/thermal-print"
import { appendAuditLog } from "@/lib/audit-log"
import { useToast } from "@/hooks/use-toast"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useCaixa } from "@/components/dashboard/caixa/caixa-provider"

/** Modos de operação expostos na UI. `troca`/`vale_credito` geram crédito local; `devolucao`/`somente_estoque` não. */
type DevMode = "devolucao" | "troca" | "vale_credito" | "somente_estoque"

export function TrocasDevolucao({
  initialSaleId,
  initialSale,
  onRegistered,
}: {
  /** Pré-carrega uma venda pelo ID (ex.: abertura a partir do Histórico de Vendas). */
  initialSaleId?: string
  /** Snapshot da venda (ex.: de `/api/ops/vendas-list`) quando ainda não está no localStorage. */
  initialSale?: SaleRecord
  /** Disparado após o servidor confirmar a devolução — usado para refresh externo (histórico). */
  onRegistered?: () => void
} = {}) {
  const { config } = useConfigEmpresa()
  const { toast } = useToast()
  const { sales, registrarDevolucao, inventory, finalizeSaleTransaction, caixa } = useOperationsStore()
  const { lojaAtivaId } = useLojaAtiva()
  const { sessaoId } = useCaixa()
  const searchParams = useSearchParams()

  const [busca, setBusca] = useState("")
  const [showSearch, setShowSearch] = useState(!initialSaleId)
  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<DevMode>("vale_credito")
  const [motivo, setMotivo] = useState("")
  const [cpfExtra, setCpfExtra] = useState("")
  const [nomeExtra, setNomeExtra] = useState("")
  const [lastDevolucao, setLastDevolucao] = useState<{
    id: string
    credit: number
    nome: string
    cpf: string
  } | null>(null)
  const [candidateSales, setCandidateSales] = useState<SaleRecord[] | null>(null)
  const [candidateLabel, setCandidateLabel] = useState("")

  // ── Troca imediata (modo `troca`): mini-carrinho de novos itens ────────────
  type TrocaCartLine = { inventoryId: string; name: string; unitPrice: number; quantity: number }
  const [trocaCart, setTrocaCart] = useState<TrocaCartLine[]>([])
  const [trocaSearch, setTrocaSearch] = useState("")
  /** Forma de pagamento da DIFERENÇA (quando novo > devolvido). */
  const [diffPayMethod, setDiffPayMethod] = useState<"dinheiro" | "pix" | "debito" | "credito">("dinheiro")
  /** Destino quando devolvido > novo: gerar vale com saldo restante, ou devolver dinheiro. */
  const [excessHandling, setExcessHandling] = useState<"vale_credito" | "dinheiro">("vale_credito")

  // ── Cupom de troca/devolução (abre automaticamente após confirmar) ────────
  type CupomTrocaData = {
    tipo: "devolucao" | "vale_credito" | "troca" | "somente_estoque"
    devolucaoId: string
    vendaOrigemId: string
    novaVendaId?: string | null
    clienteNome: string
    clienteCpf: string
    operador: string
    itensDevolvidos: { nome: string; quantidade: number; valorTotal: number }[]
    itensNovos: { nome: string; quantidade: number; valorTotal: number }[]
    valorDevolvido: number
    totalNovaCompra: number
    creditoGerado: number
    creditoUtilizado: number
    saldoFinal: number
    diferencaPaga: number
    diferencaForma: string | null
    motivo: string
    at: string
  }
  const [cupomData, setCupomData] = useState<CupomTrocaData | null>(null)
  const [cupomOpen, setCupomOpen] = useState(false)

  // Prefill via prop `initialSaleId` (Histórico) ou query `?sale=` em /dashboard/vendas-arquivo-geral
  useEffect(() => {
    const id = (initialSaleId || searchParams.get("sale") || "").trim()
    if (!id) return
    setBusca(id)
    setShowSearch(false)
    const upper = id.toUpperCase()
    const idNorm = id.replace(/\s/g, "").toUpperCase()

    if (initialSale && (initialSale.id.toUpperCase() === upper || initialSale.id.replace(/\s/g, "").toUpperCase() === idNorm)) {
      aplicarVenda(initialSale)
      return
    }

    const s = sales.find(
      (x) =>
        x.id.toUpperCase() === upper ||
        x.id.replace(/\s/g, "").toUpperCase() === idNorm
    )
    if (s) {
      aplicarVenda(s)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- aplicarVenda estável o suficiente para prefill
  }, [initialSaleId, initialSale, searchParams, sales])

  useEffect(() => {
    if (!sale) return
    const fresh = sales.find((x) => x.id === sale.id)
    if (!fresh) return
    if (JSON.stringify(fresh.lines) !== JSON.stringify(sale.lines)) setSale(fresh)
  }, [sales, sale])

  const nomeLoja =
    (config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia

  const aplicarVenda = (s: SaleRecord) => {
    setSale(s)
    setCandidateSales(null)
    setCandidateLabel("")
    setShowSearch(false)
    const q: Record<string, string> = {}
    for (const l of s.lines) {
      const max = l.quantity - (l.qtyReturned ?? 0)
      q[l.inventoryId] = max > 0 ? "0" : "0"
    }
    setQtyByLine(q)
    setCpfExtra(s.customerCpf ?? "")
    setNomeExtra(s.customerName ?? "")
    setLastDevolucao(null)
    toast({ title: "Venda localizada", description: s.id })
  }

  const encontrarVenda = () => {
    const raw = busca.trim()
    if (!raw) {
      toast({ title: "Informe a busca", description: "ID da venda, nome do cliente ou código do produto.", variant: "destructive" })
      return
    }
    setCandidateSales(null)
    setCandidateLabel("")

    const idUpper = raw.toUpperCase()
    const idNorm = raw.replace(/\s/g, "").toUpperCase()
    const qLower = raw.toLowerCase()
    const digitsOnly = raw.replace(/\D/g, "")

    const byId = sales.find(
      (x) =>
        x.id.toUpperCase() === idUpper ||
        x.id.replace(/\s/g, "").toUpperCase() === idNorm
    )
    if (byId) {
      aplicarVenda(byId)
      return
    }

    const byName = sales.filter((s) => (s.customerName || "").toLowerCase().includes(qLower))
    if (byName.length === 1) {
      aplicarVenda(byName[0]!)
      return
    }
    if (byName.length > 1) {
      setCandidateSales(byName.slice(0, 8))
      setCandidateLabel(`Vendas com cliente contendo “${raw}”`)
      toast({ title: "Várias vendas", description: "Escolha o cupom correto na lista abaixo." })
      return
    }

    const invMatch =
      inventory.find(
        (i) =>
          i.id === raw ||
          (digitsOnly.length >= 8 && i.id.replace(/\D/g, "") === digitsOnly) ||
          i.name.toLowerCase().includes(qLower)
      ) ?? null

    if (invMatch) {
      const last5 = sales
        .filter((s) => s.lines.some((l) => l.inventoryId === invMatch.id))
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 5)
      if (last5.length === 0) {
        setSale(null)
        toast({
          title: "Nenhuma venda",
          description: `O produto “${invMatch.name}” ainda não consta em vendas registradas.`,
          variant: "destructive",
        })
        return
      }
      if (last5.length === 1) {
        aplicarVenda(last5[0]!)
        return
      }
      setCandidateSales(last5)
      setCandidateLabel(`Últimas vendas com “${invMatch.name}” (origem da troca)`)
      toast({ title: "Selecione a venda", description: "Escolha de qual cupom sairá a devolução." })
      return
    }

    setSale(null)
    setLastDevolucao(null)
    toast({
      title: "Não encontrado",
      description: "Nenhuma venda, cliente ou produto correspondente.",
      variant: "destructive",
    })
  }

  const linhasComMax = useMemo(() => {
    if (!sale) return []
    return sale.lines.map((l) => ({
      ...l,
      maxReturn: l.quantity - (l.qtyReturned ?? 0),
    }))
  }, [sale])

  // ── Cálculos da troca imediata ─────────────────────────────────────────────
  /** Valor devolvido baseado nas quantidades atuais × preço unitário da venda original. */
  const valorDevolvido = useMemo(() => {
    if (!sale) return 0
    let total = 0
    for (const l of linhasComMax) {
      const q = Math.max(0, parseInt(qtyByLine[l.inventoryId] || "0", 10) || 0)
      if (q > 0 && l.quantity > 0) total += (l.lineTotal / l.quantity) * q
    }
    return Math.round(total * 100) / 100
  }, [sale, linhasComMax, qtyByLine])

  const totalNovaCompra = useMemo(
    () => Math.round(trocaCart.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100,
    [trocaCart],
  )

  const diferenca = Math.round((totalNovaCompra - valorDevolvido) * 100) / 100
  /** Quanto cabe abater do vale (= mínimo entre devolvido e nova compra). */
  const valePassivelAbatimento = Math.round(Math.min(valorDevolvido, totalNovaCompra) * 100) / 100
  const creditoRestante = Math.round(Math.max(0, valorDevolvido - totalNovaCompra) * 100) / 100

  /** Buscar produtos para a aba "Troca imediata" — limitado a 8 sugestões. */
  const trocaSearchResults = useMemo<InventoryItem[]>(() => {
    const q = trocaSearch.trim().toLowerCase()
    if (!q) return []
    const digits = q.replace(/\D/g, "")
    return inventory
      .filter((i) => {
        if (i.name.toLowerCase().includes(q)) return true
        if (i.id.toLowerCase() === q) return true
        if (i.sku && i.sku.toLowerCase() === q) return true
        if (i.barcode && i.barcode === digits) return true
        if (i.codigo && i.codigo.toLowerCase() === q) return true
        return false
      })
      .slice(0, 8)
  }, [trocaSearch, inventory])

  const addTrocaItem = (item: InventoryItem) => {
    const isService = item.category === "Servicos"
    if (!isService && item.stock <= 0) {
      toast({ title: "Sem estoque", description: `${item.name} está sem estoque.`, variant: "destructive" })
      return
    }
    const existing = trocaCart.find((l) => l.inventoryId === item.id)
    const used = existing?.quantity ?? 0
    if (!isService && used + 1 > item.stock) {
      toast({ title: "Estoque insuficiente", description: `${item.name}: máx ${item.stock}.`, variant: "destructive" })
      return
    }
    setTrocaCart((prev) => {
      const i = prev.findIndex((l) => l.inventoryId === item.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = { ...next[i], quantity: next[i].quantity + 1 }
        return next
      }
      return [...prev, { inventoryId: item.id, name: item.name, unitPrice: item.price, quantity: 1 }]
    })
    setTrocaSearch("")
  }

  const decTrocaItem = (inventoryId: string) => {
    setTrocaCart((prev) =>
      prev
        .map((l) => (l.inventoryId === inventoryId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    )
  }

  const incTrocaItem = (inventoryId: string) => {
    const item = inventory.find((i) => i.id === inventoryId)
    if (!item) return
    const isService = item.category === "Servicos"
    const existing = trocaCart.find((l) => l.inventoryId === inventoryId)
    const used = existing?.quantity ?? 0
    if (!isService && used + 1 > item.stock) {
      toast({ title: "Estoque insuficiente", description: `${item.name}: máx ${item.stock}.`, variant: "destructive" })
      return
    }
    setTrocaCart((prev) =>
      prev.map((l) => (l.inventoryId === inventoryId ? { ...l, quantity: l.quantity + 1 } : l)),
    )
  }

  const removeTrocaItem = (inventoryId: string) => {
    setTrocaCart((prev) => prev.filter((l) => l.inventoryId !== inventoryId))
  }

  // Limpa o mini-carrinho ao trocar de venda ou mudar de modo (sai de "troca")
  useEffect(() => {
    if (mode !== "troca") setTrocaCart([])
  }, [mode, sale?.id])

  /**
   * Finalização da TROCA IMEDIATA (mode === "troca" + mini-carrinho preenchido):
   * 1) Registra devolução normalmente (estoque dos itens devolvidos sobe, vale emitido = valorDevolvido);
   * 2) Cria nova venda via `finalizeSaleTransaction`, abatendo o vale recém-emitido (`creditoVale`) e
   *    cobrando apenas a diferença na forma escolhida (quando positiva);
   * 3) Se devolvido > nova compra e cliente escolheu "dinheiro", o saldo remanescente do vale é
   *    devolvido em dinheiro (debita do `customerCredits` local).
   */
  const handleFinalizarTroca = async () => {
    if (!sale) return
    if (!caixa.isOpen) {
      toast({ title: "Caixa fechado", description: "Abra o caixa antes de finalizar a troca.", variant: "destructive" })
      return
    }
    const cpf = normalizeDocDigits(sale.customerCpf || "") || normalizeDocDigits(cpfExtra)
    const nome = (sale.customerName || nomeExtra).trim()
    if (!cpf) {
      toast({ title: "CPF obrigatório", description: "Informe o CPF/CNPJ do cliente para a troca.", variant: "destructive" })
      return
    }
    if (!nome) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do cliente.", variant: "destructive" })
      return
    }

    // Linhas devolvidas (mesma validação do fluxo padrão)
    const lines: { inventoryId: string; quantity: number }[] = []
    for (const l of linhasComMax) {
      const q = Math.max(0, parseInt(qtyByLine[l.inventoryId] || "0", 10) || 0)
      if (q > 0) {
        if (q > l.maxReturn) {
          toast({ title: "Quantidade inválida", description: `${l.name}: máximo ${l.maxReturn}`, variant: "destructive" })
          return
        }
        lines.push({ inventoryId: l.inventoryId, quantity: q })
      }
    }
    if (lines.length === 0) {
      toast({ title: "Nada a devolver", description: "Informe quantidades do item a trocar.", variant: "destructive" })
      return
    }
    if (trocaCart.length === 0) {
      toast({ title: "Sem itens novos", description: "Adicione ao menos um produto/serviço à nova compra.", variant: "destructive" })
      return
    }

    const excessoDinheiro = creditoRestante > 0 && excessHandling === "dinheiro" ? creditoRestante : 0
    const creditoFinal = Math.max(0, creditoRestante - excessoDinheiro)
    const usaVale = valePassivelAbatimento
    const diff = Math.round((totalNovaCompra - usaVale) * 100) / 100

    const payload = {
      saleId: sale.id,
      linhas: lines,
      modo: "troca_imediata",
      vendaOriginalId: sale.id,
      novaVendaId: null,
      valorDevolvido,
      totalNovaCompra,
      diferencaPaga: diff > 0 ? diff : 0,
      diferencaForma: diff > 0 ? diffPayMethod : null,
      creditoRestante: creditoFinal,
      excessoDinheiro,
      motivo: motivo.trim(),
    }

    // Step 1 — devolução com modo "vale_credito" (gera saldo local de `valorDevolvido`)
    const dev = registrarDevolucao({
      saleId: sale.id,
      lines,
      mode: "vale_credito",
      customerCpf: cpf,
      customerName: nome,
      sessaoId: sessaoId ?? undefined,
      tipo: "troca",
      motivo: motivo.trim(),
      payload,
    })
    if (!dev.ok) {
      toast({ title: "Devolução não registrada", description: dev.reason, variant: "destructive" })
      return
    }
    const creditEmitido = dev.creditIssued

    // Step 2 — nova venda abatendo o vale recém-emitido
    const pb = { dinheiro: 0, pix: 0, cartaoDebito: 0, cartaoCredito: 0, carne: 0, aPrazo: 0, creditoVale: usaVale }
    if (diff > 0) {
      if (diffPayMethod === "dinheiro") pb.dinheiro = diff
      else if (diffPayMethod === "pix") pb.pix = diff
      else if (diffPayMethod === "debito") pb.cartaoDebito = diff
      else if (diffPayMethod === "credito") pb.cartaoCredito = diff
    }

    const novaVenda = await finalizeSaleTransaction({
      lines: trocaCart.map((l) => ({ inventoryId: l.inventoryId, quantity: l.quantity, name: l.name, unitPrice: l.unitPrice })),
      total: totalNovaCompra,
      paymentBreakdown: pb,
      customerCpf: cpf,
      customerName: nome,
    })
    if (!novaVenda.ok) {
      // Não tentamos reverter a devolução automaticamente — o operador deve cancelar a venda manualmente
      // se necessário. Avisamos com clareza para evitar estado inconsistente silencioso.
      toast({
        title: "Devolução registrada, nova venda falhou",
        description: `${novaVenda.reason} — devolução ${dev.devolucaoId} mantida. Registre a nova venda manualmente.`,
        variant: "destructive",
      })
      return
    }

    onRegistered?.()

    // Excesso em dinheiro: debita o vale local pelo valor a devolver
    // (o customerCredits ainda guarda `creditoRestante` da devolução; o operador entrega o $ ao cliente)
    if (creditoRestante > 0 && excessHandling === "dinheiro") {
      // Não há API direta no store; o crédito persiste como "vale" no localStorage até a Fase 1.
      // Aqui apenas registramos no audit-log para rastreabilidade operacional.
      appendAuditLog({
        action: "devolucao_vale",
        userLabel: `${nomeLoja} (PDV)`,
        detail: `[troca_excesso_dinheiro] Troca ${dev.devolucaoId} | venda ${sale.id} | excesso devolvido em dinheiro: ${creditoRestante.toFixed(2)}`,
      })
    }

    appendAuditLog({
      action: "devolucao_vale",
      userLabel: `${nomeLoja} (PDV)`,
      detail: `[troca_imediata] dev ${dev.devolucaoId} → venda ${novaVenda.saleId} | devolvido ${valorDevolvido.toFixed(2)} | nova ${totalNovaCompra.toFixed(2)} | diff ${diff.toFixed(2)} (${diffPayMethod}) | excesso ${creditoRestante.toFixed(2)} (${excessHandling})`,
    })

    setLastDevolucao({ id: dev.devolucaoId, credit: creditEmitido, nome, cpf })

    // Abre o cupom de troca automaticamente (resumo operacional para o cliente)
    const itensDevolvidos = lines.map((req) => {
      const sl = sale.lines.find((l) => l.inventoryId === req.inventoryId)
      const valorUnit = sl ? sl.lineTotal / sl.quantity : 0
      return {
        nome: sl?.name ?? req.inventoryId,
        quantidade: req.quantity,
        valorTotal: Math.round(valorUnit * req.quantity * 100) / 100,
      }
    })
    const itensNovos = trocaCart.map((l) => ({
      nome: l.name,
      quantidade: l.quantity,
      valorTotal: Math.round(l.unitPrice * l.quantity * 100) / 100,
    }))
    const excessoDinheiroFinal = creditoRestante > 0 && excessHandling === "dinheiro" ? creditoRestante : 0
    const saldoFinal = Math.max(0, creditoRestante - excessoDinheiroFinal)
    setCupomData({
      tipo: "troca",
      devolucaoId: dev.devolucaoId,
      vendaOrigemId: sale.id,
      novaVendaId: novaVenda.pending ? null : novaVenda.saleId,
      clienteNome: nome,
      clienteCpf: cpf,
      operador: nomeLoja,
      itensDevolvidos,
      itensNovos,
      valorDevolvido,
      totalNovaCompra,
      creditoGerado: creditEmitido,
      creditoUtilizado: valePassivelAbatimento,
      saldoFinal,
      diferencaPaga: diff > 0 ? diff : 0,
      diferencaForma: diff > 0 ? diffPayMethod : null,
      motivo: motivo.trim(),
      at: new Date().toISOString(),
    })
    setCupomOpen(true)

    toast({
      title: "Troca finalizada",
      description:
        diff > 0
          ? `Cobrado ${formatBrl(diff)} em ${diffPayMethod}.`
          : creditoRestante > 0 && excessHandling === "dinheiro"
            ? `Devolva ${formatBrl(creditoRestante)} em dinheiro ao cliente.`
            : creditoRestante > 0
              ? `Crédito de ${formatBrl(creditoRestante)} gerado.`
              : "Troca casada sem diferença.",
    })

    // Reset do mini-carrinho (a venda original é atualizada via efeito)
    setTrocaCart([])
    setQtyByLine({})
  }

  const handleRegistrar = () => {
    if (!sale) return
    const cpf =
      normalizeDocDigits(sale.customerCpf || "") || normalizeDocDigits(cpfExtra)
    const nome = (sale.customerName || nomeExtra).trim()
    if (!cpf) {
      toast({ title: "CPF obrigatório", description: "Informe o CPF/CNPJ do cliente para devolução.", variant: "destructive" })
      return
    }
    if (!nome) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do cliente.", variant: "destructive" })
      return
    }
    const lines: { inventoryId: string; quantity: number }[] = []
    for (const l of linhasComMax) {
      const q = Math.max(0, parseInt(qtyByLine[l.inventoryId] || "0", 10) || 0)
      if (q > 0) {
        if (q > l.maxReturn) {
          toast({
            title: "Quantidade inválida",
            description: `${l.name}: máximo ${l.maxReturn}`,
            variant: "destructive",
          })
          return
        }
        lines.push({ inventoryId: l.inventoryId, quantity: q })
      }
    }
    if (lines.length === 0) {
      toast({ title: "Nada a devolver", description: "Informe quantidades.", variant: "destructive" })
      return
    }

    // `troca` e `vale_credito` geram crédito local (vale); `devolucao` e `somente_estoque` não.
    const localMode: "vale_credito" | "somente_estoque" =
      mode === "troca" || mode === "vale_credito" ? "vale_credito" : "somente_estoque"

    const r = registrarDevolucao({
      saleId: sale.id,
      lines,
      mode: localMode,
      customerCpf: cpf,
      customerName: nome,
      sessaoId: sessaoId ?? undefined,
      tipo: mode,
      motivo: motivo.trim(),
      payload: { saleId: sale.id, linhas: lines, modo: mode, motivo: motivo.trim() },
    })
    if (!r.ok) {
      toast({ title: "Devolução não registrada", description: r.reason, variant: "destructive" })
      return
    }

    appendAuditLog({
      action: "devolucao_vale",
      userLabel: `${nomeLoja} (PDV)`,
      detail: `${r.devolucaoId} | venda ${sale.id} | modo ${mode} | crédito ${r.creditIssued.toFixed(2)}${motivo.trim() ? ` | motivo ${motivo.trim()}` : ""}`,
    })

    onRegistered?.()

    setLastDevolucao({
      id: r.devolucaoId,
      credit: r.creditIssued,
      nome,
      cpf,
    })

    // Abre cupom de devolução/vale/estoque para conferência do cliente
    const itensDev = lines.map((req) => {
      const sl = sale.lines.find((l) => l.inventoryId === req.inventoryId)
      const valorUnit = sl ? sl.lineTotal / sl.quantity : 0
      return {
        nome: sl?.name ?? req.inventoryId,
        quantidade: req.quantity,
        valorTotal: Math.round(valorUnit * req.quantity * 100) / 100,
      }
    })
    const valorDevTotal = itensDev.reduce((s, i) => s + i.valorTotal, 0)
    setCupomData({
      tipo: mode === "devolucao" || mode === "vale_credito" || mode === "somente_estoque" ? mode : "devolucao",
      devolucaoId: r.devolucaoId,
      vendaOrigemId: sale.id,
      novaVendaId: null,
      clienteNome: nome,
      clienteCpf: cpf,
      operador: nomeLoja,
      itensDevolvidos: itensDev,
      itensNovos: [],
      valorDevolvido: valorDevTotal,
      totalNovaCompra: 0,
      creditoGerado: r.creditIssued,
      creditoUtilizado: 0,
      saldoFinal: r.creditIssued,
      diferencaPaga: 0,
      diferencaForma: null,
      motivo: motivo.trim(),
      at: new Date().toISOString(),
    })
    setCupomOpen(true)

    const gerouCredito = r.creditIssued > 0
    toast({
      title: gerouCredito ? "Crédito em haver gerado" : "Devolução registrada",
      description: gerouCredito ? `${formatBrl(r.creditIssued)} para ${nome}` : "Itens retornaram ao estoque.",
    })
  }

  const imprimirVale = async () => {
    if (!lastDevolucao || lastDevolucao.credit <= 0) {
      toast({ title: "Sem comprovante", description: "Gere um vale (modo crédito) antes de imprimir.", variant: "destructive" })
      return
    }
    const bytes = buildValeTrocaEscPos({
      nomeFantasia: nomeLoja,
      nomeCliente: lastDevolucao.nome,
      cpfCliente: lastDevolucao.cpf,
      valorCredito: lastDevolucao.credit,
      dataLabel: new Date().toLocaleString("pt-BR"),
      devolucaoId: lastDevolucao.id,
    })
    const res = await sendEscPosViaProxy(bytes)
    if (res.ok) {
      toast({ title: "Enviado à impressora", description: "Comprovante ESC/POS." })
      return
    }
    toast({ title: "Impressora indisponível", description: res.error, variant: "destructive" })
    downloadEscPosFile(bytes, `vale-${lastDevolucao.id}.bin`)
    const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    openThermalHtmlPrint(
      `
      <div style="text-align:center;font-weight:700">COMPROVANTE VALE-TROCA</div>
      <div style="text-align:center;font-size:10px;margin:4px 0">${escapeHtml(nomeLoja)}</div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <p><strong>Cliente:</strong> ${escapeHtml(lastDevolucao.nome)}</p>
      <p><strong>CPF/CNPJ:</strong> ${escapeHtml(lastDevolucao.cpf)}</p>
      <p><strong>Crédito:</strong> ${br.format(lastDevolucao.credit)}</p>
      <p><strong>Data:</strong> ${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>
      <p><strong>ID devolução:</strong> ${escapeHtml(lastDevolucao.id)}</p>
    `,
      "Vale-troca"
    )
  }

  return (
    <div className="space-y-6 w-full">
      {(!sale || showSearch) && (
        <Card className="bg-card border-border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl font-bold">
              <RotateCcw className="w-6 h-6 text-primary" />
              Troca e Devolução
            </CardTitle>
            <CardDescription className="text-sm">
              Busque pelo <strong>ID do cupom</strong>, <strong>nome do cliente</strong> ou <strong>código/bip do produto</strong>.
              Ao bipar um item, listamos as últimas vendas em que ele aparece para você escolher a origem da troca. Os itens
              retornam ao estoque; use <strong>crédito em haver</strong> vinculado ao CPF quando aplicável.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">Venda, cliente ou código de barras do produto</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="VDA-2026-0001 · João Silva · código do produto"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") encontrarVenda()
                    }}
                    className="h-11 pl-9 font-mono text-sm border-border bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              <div className="flex items-end">
                <Button type="button" className="h-11 bg-primary hover:bg-primary/95 text-primary-foreground font-semibold px-6" onClick={encontrarVenda}>
                  Buscar Venda
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {candidateSales && candidateSales.length > 0 && (
        <Card className="border-primary/30 bg-primary/5 shadow-inner">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{candidateLabel || "Escolha a venda"}</CardTitle>
            <CardDescription>Selecione o cupom de origem da troca ou devolução.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidateSales.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="outline"
                className="h-auto w-full flex-col items-start gap-1 py-3 px-4 text-left border-border/80 hover:border-primary hover:bg-background/80 transition-all sm:flex-row sm:items-center sm:justify-between"
                onClick={() => aplicarVenda(s)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-primary">{s.id}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-sm font-medium text-foreground">
                    {s.customerName || "Consumidor Final"}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatBrl(s.total)}</span>
                  <span className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString("pt-BR")}</span>
                </div>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {sale && (
        <div className="w-full space-y-4">
          {/* Cabeçalho Compacto da Venda de Origem */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl border border-border bg-muted/15">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Package className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-muted-foreground uppercase tracking-wider">Origem:</span>
                  <span className="font-mono text-sm font-bold text-primary">{sale.id}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span>Realizada em {new Date(sale.at).toLocaleString("pt-BR")}</span>
                  {initialSaleId && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSale(null)
                          setShowSearch(true)
                          setBusca("")
                        }}
                        className="text-primary hover:underline font-semibold"
                      >
                        Trocar venda
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Total da Venda</span>
              <span className="text-base font-extrabold text-foreground tabular-nums">{formatBrl(sale.total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Coluna Esquerda: Dados do Cliente e Modo de Operação (lg:col-span-4) */}
            <div className="lg:col-span-4 space-y-3">
              {/* CPF / Nome */}
              <div className="space-y-2 rounded-lg border border-border/50 bg-muted/10 p-2.5">
                <h3 className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Search className="w-3 h-3 text-primary" />
                  Identificação do Cliente
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-[9px] font-semibold text-muted-foreground">CPF/CNPJ (se não veio)</Label>
                    <Input
                      value={cpfExtra}
                      onChange={(e) => setCpfExtra(e.target.value)}
                      placeholder="Somente números"
                      className="h-7 text-xs border-border bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[9px] font-semibold text-muted-foreground">Nome do Cliente</Label>
                    <Input
                      value={nomeExtra}
                      onChange={(e) => setNomeExtra(e.target.value)}
                      placeholder="Nome completo"
                      className="h-7 text-xs border-border bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
              </div>

                {/* Modo de Operação */}
                <div className="space-y-1.5">
                  <Label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Modo de Operação
                  </Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* Tile 1: Troca Imediata */}
                    <button
                      type="button"
                      onClick={() => setMode("troca")}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border text-left transition-all ${
                        mode === "troca"
                          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${mode === "troca" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="font-semibold text-[11px] text-foreground font-sans leading-none">Troca Imediata</span>
                    </button>

                    {/* Tile 2: Vale Crédito */}
                    <button
                      type="button"
                      onClick={() => setMode("vale_credito")}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border text-left transition-all ${
                        mode === "vale_credito"
                          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <Wallet className={`w-3.5 h-3.5 shrink-0 ${mode === "vale_credito" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="font-semibold text-[11px] text-foreground font-sans leading-none">Vale-Troca</span>
                    </button>

                    {/* Tile 3: Devolução/Reembolso */}
                    <button
                      type="button"
                      onClick={() => setMode("devolucao")}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border text-left transition-all ${
                        mode === "devolucao"
                          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${mode === "devolucao" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="font-semibold text-[11px] text-foreground font-sans leading-none">Reembolso</span>
                    </button>

                    {/* Tile 4: Somente Estoque */}
                    <button
                      type="button"
                      onClick={() => setMode("somente_estoque")}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border text-left transition-all ${
                        mode === "somente_estoque"
                          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <Package className={`w-3.5 h-3.5 shrink-0 ${mode === "somente_estoque" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="font-semibold text-[11px] text-foreground font-sans leading-none">Apenas Estoque</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Coluna Direita: Quantidades, Carrinho (se Troca), Resumo e Ações (lg:col-span-8) */}
              <div className="lg:col-span-8 space-y-3">
                {/* Seleção de Itens a Devolver */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                    <Package className="w-3.5 h-3.5 text-primary" />
                    <h3 className="font-bold text-xs text-foreground">Selecione as Quantidades a Devolver</h3>
                  </div>

                  <div className="space-y-2">
                    {linhasComMax.map((l) => {
                      const currentQty = parseInt(qtyByLine[l.inventoryId] || "0", 10) || 0
                      return (
                        <div
                          key={l.inventoryId}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5 px-3 rounded-lg border border-border bg-muted/20"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-xs text-foreground truncate">{l.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Vendido: {l.quantity} · Devolvido: {l.qtyReturned ?? 0} · Disponível: <span className="font-medium text-foreground">{l.maxReturn}</span>
                            </p>
                          </div>

                          {/* Incrementador +/- Premium Compacto */}
                          <div className="flex items-center gap-1 bg-background border border-border rounded-md p-0.5 self-start sm:self-center shadow-sm">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6.5 w-6.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                              disabled={l.maxReturn <= 0 || currentQty <= 0}
                              onClick={() => {
                                const val = Math.max(0, currentQty - 1)
                                setQtyByLine((prev) => ({ ...prev, [l.inventoryId]: String(val) }))
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <input
                              type="text"
                              className="w-10 text-center bg-transparent border-0 font-bold text-xs text-foreground tabular-nums focus:ring-0 focus:outline-none"
                              value={qtyByLine[l.inventoryId] ?? "0"}
                              readOnly
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6.5 w-6.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                              disabled={l.maxReturn <= 0 || currentQty >= l.maxReturn}
                              onClick={() => {
                                const val = Math.min(l.maxReturn, currentQty + 1)
                                setQtyByLine((prev) => ({ ...prev, [l.inventoryId]: String(val) }))
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Motivo (Opcional) */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-semibold text-muted-foreground">Motivo da Troca/Devolução (opcional)</Label>
                  <Input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: produto com defeito, tamanho incorreto, insatisfação..."
                    className="h-7 text-xs border-border bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                  />
                </div>

                {/* Carrinho da Nova Compra - Apenas se modo "troca" */}
                {mode === "troca" && (
                  <div className="space-y-3 pt-3 border-t border-border/80">
                    <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                      <ShoppingCart className="h-3.5 w-3.5 text-primary" />
                      <h3 className="font-bold text-xs text-foreground">Carrinho da Nova Compra</h3>
                    </div>

                    {/* Busca Inline */}
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Buscar Novo Produto</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={trocaSearch}
                          onChange={(e) => setTrocaSearch(e.target.value)}
                          placeholder="Buscar por nome, SKU, código de barras..."
                          className="pl-8.5 h-7.5 text-xs border-border bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
                        />
                      </div>

                      {/* Resultados Inline */}
                      {trocaSearchResults.length > 0 && (
                        <div className="rounded-lg border border-border bg-muted/20 overflow-hidden divide-y divide-border/60 max-h-40 overflow-y-auto shadow-inner mt-1">
                          {trocaSearchResults.map((p) => {
                            const isService = p.category === "Servicos"
                            const out = !isService && p.stock <= 0
                            return (
                              <button
                                key={p.id}
                                type="button"
                                disabled={out}
                                onClick={() => addTrocaItem(p)}
                                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-primary/5 transition-colors disabled:opacity-40"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-foreground">{p.name}</p>
                                  <p className="text-[9px] text-muted-foreground">
                                    {p.category} · {isService ? "Serviço" : out ? "Sem estoque" : `Estoque: ${p.stock}`}
                                  </p>
                                </div>
                                <span className="shrink-0 font-bold text-primary tabular-nums">{formatBrl(p.price)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Mini-carrinho */}
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold text-muted-foreground">Itens da Nova Compra</Label>
                      {trocaCart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-3 border border-dashed border-border/80 rounded-lg bg-muted/10 text-center">
                          <ShoppingCart className="w-6 h-6 text-muted-foreground/45 mb-1" />
                          <p className="text-[11px] text-muted-foreground">Busque produtos acima para adicionar ao carrinho.</p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          {trocaCart.map((l) => (
                            <div key={l.inventoryId} className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg border border-border bg-background shadow-sm text-xs">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-foreground truncate">{l.name}</p>
                                <p className="text-[10px] text-muted-foreground">{formatBrl(l.unitPrice)} cada</p>
                              </div>
                              <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5 rounded-md hover:bg-muted"
                                  onClick={() => decTrocaItem(l.inventoryId)}
                                >
                                  <Minus className="h-2.5 w-2.5" />
                                </Button>
                                <span className="w-5 text-center font-bold tabular-nums text-xs text-foreground">{l.quantity}</span>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5 rounded-md hover:bg-muted"
                                  onClick={() => incTrocaItem(l.inventoryId)}
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </Button>
                              </div>
                              <div className="text-right w-16 shrink-0 font-bold tabular-nums text-foreground">
                                {formatBrl(l.unitPrice * l.quantity)}
                              </div>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 rounded-md"
                                onClick={() => removeTrocaItem(l.inventoryId)}
                              >
                                <X className="h-2.5 w-2.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Resumo Financeiro e Ações da Devolução (se modo NÃO troca) */}
                {mode !== "troca" && (
                  <div className="rounded-lg border border-border bg-muted/15 p-2.5 flex items-center justify-between gap-3 shadow-sm">
                    <div className="min-w-0">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Total a Devolver</span>
                      <span className="font-extrabold text-lg text-foreground tabular-nums leading-none">{formatBrl(valorDevolvido)}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {lastDevolucao && lastDevolucao.credit > 0 && (
                        <Button type="button" variant="outline" size="sm" className="rounded-md h-8.5 px-3 text-xs" onClick={() => void imprimirVale()}>
                          <Printer className="w-3.5 h-3.5 mr-1.5" />
                          Imprimir Comprovante
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold h-8.5 px-4 rounded-md text-xs"
                        onClick={handleRegistrar}
                        disabled={valorDevolvido <= 0}
                      >
                        Confirmar Devolução
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resumo Financeiro da Troca Imediata */}
                {mode === "troca" && (
                  <div className="rounded-lg border border-border bg-muted/15 p-2.5 space-y-2 shadow-sm">
                    <div className="grid grid-cols-3 gap-2 text-center bg-background p-1.5 rounded border border-border/60">
                      <div>
                        <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">Devolvido</p>
                        <p className="font-extrabold text-xs text-foreground mt-0.5 tabular-nums">{formatBrl(valorDevolvido)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">Nova Compra</p>
                        <p className="font-extrabold text-xs text-foreground mt-0.5 tabular-nums">{formatBrl(totalNovaCompra)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">
                          {diferenca > 0 ? "Diferença" : diferenca < 0 ? "Crédito" : "Saldo"}
                        </p>
                        <p
                          className={`font-extrabold text-xs mt-0.5 tabular-nums ${
                            diferenca > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : diferenca < 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {formatBrl(Math.abs(diferenca))}
                        </p>
                      </div>
                    </div>

                    {/* Forma de pagamento da diferença */}
                    {diferenca > 0 && (
                      <div className="space-y-1 pt-1.5 border-t border-border/60">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Forma de pagamento da diferença</Label>
                        <div className="grid grid-cols-4 gap-1">
                          {(["dinheiro", "pix", "debito", "credito"] as const).map((m) => (
                            <Button
                              key={m}
                              type="button"
                              size="sm"
                              variant={diffPayMethod === m ? "default" : "outline"}
                              onClick={() => setDiffPayMethod(m)}
                              className="capitalize text-[10px] h-7 border-border/80 px-1"
                            >
                              {m === "debito" ? "Débito" : m === "credito" ? "Crédito" : m}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Excesso devolvido — escolher destino */}
                    {creditoRestante > 0 && (
                      <div className="space-y-1 pt-1.5 border-t border-border/60">
                        <Label className="text-[9px] uppercase font-bold text-muted-foreground tracking-wide">Sobrou {formatBrl(creditoRestante)} — tratar como:</Label>
                        <RadioGroup
                          value={excessHandling}
                          onValueChange={(v) => setExcessHandling(v as "vale_credito" | "dinheiro")}
                          className="flex flex-row gap-4"
                        >
                          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer text-foreground font-medium">
                            <RadioGroupItem value="vale_credito" id="ex1" className="h-3.5 w-3.5" />
                            <span>Gerar vale</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] cursor-pointer text-foreground font-medium">
                            <RadioGroupItem value="dinheiro" id="ex2" className="h-3.5 w-3.5" />
                            <span>Devolver dinheiro</span>
                          </label>
                        </RadioGroup>
                      </div>
                    )}

                    {/* Ações da Troca Imediata */}
                    <div className="pt-1.5 flex gap-1.5">
                      {lastDevolucao && lastDevolucao.credit > 0 && (
                        <Button type="button" size="sm" variant="outline" className="flex-1 h-8.5 border-border/80 text-xs" onClick={() => void imprimirVale()}>
                          <Printer className="w-3.5 h-3.5 mr-1.5" />
                          Imprimir
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold flex-1 h-8.5 text-xs"
                        onClick={handleFinalizarTroca}
                        disabled={trocaCart.length === 0 || valorDevolvido <= 0}
                      >
                        Finalizar Troca Imediata
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      {cupomData && (
        <CupomTroca
          open={cupomOpen}
          onClose={() => setCupomOpen(false)}
          data={cupomData}
          nomeLoja={nomeLoja}
          onImprimirVale={() => void imprimirVale()}
        />
      )}
    </div>
  )
}

// ─── Cupom Troca/Devolução ────────────────────────────────────────────────
// Reaproveita o helper de impressão térmica (`openThermalHtmlPrint`) e o ESC/POS
// do vale (`buildValeTrocaEscPos`). Não substitui o `CupomNaoFiscal` da venda — é
// um comprovante operacional dedicado ao fluxo de troca.
function CupomTroca({
  open,
  onClose,
  data,
  nomeLoja,
  onImprimirVale,
}: {
  open: boolean
  onClose: () => void
  data: {
    tipo: "devolucao" | "vale_credito" | "troca" | "somente_estoque"
    devolucaoId: string
    vendaOrigemId: string
    novaVendaId?: string | null
    clienteNome: string
    clienteCpf: string
    operador: string
    itensDevolvidos: { nome: string; quantidade: number; valorTotal: number }[]
    itensNovos: { nome: string; quantidade: number; valorTotal: number }[]
    valorDevolvido: number
    totalNovaCompra: number
    creditoGerado: number
    creditoUtilizado: number
    saldoFinal: number
    diferencaPaga: number
    diferencaForma: string | null
    motivo: string
    at: string
  }
  nomeLoja: string
  onImprimirVale: () => void
}) {
  const { toast } = useToast()
  const tipoLabel =
    data.tipo === "troca"
      ? "TROCA IMEDIATA"
      : data.tipo === "vale_credito"
        ? "VALE-TROCA"
        : data.tipo === "somente_estoque"
          ? "DEVOLUÇÃO AO ESTOQUE"
          : "DEVOLUÇÃO"
  const dataLabel = new Date(data.at).toLocaleString("pt-BR")

  const copiarResumo = useCallback(() => {
    const linhas: string[] = [
      `${nomeLoja} — ${tipoLabel}`,
      `Data: ${dataLabel}`,
      `Operador: ${data.operador}`,
      `Venda origem: ${data.vendaOrigemId}`,
      data.novaVendaId ? `Nova venda: ${data.novaVendaId}` : "",
      `Cliente: ${data.clienteNome} (${data.clienteCpf})`,
      "",
      "ITENS DEVOLVIDOS",
      ...data.itensDevolvidos.map((i) => `  ${i.quantidade}× ${i.nome} — ${formatBrl(i.valorTotal)}`),
      `  Total devolvido: ${formatBrl(data.valorDevolvido)}`,
    ]
    if (data.itensNovos.length > 0) {
      linhas.push("", "ITENS NOVOS")
      linhas.push(...data.itensNovos.map((i) => `  ${i.quantidade}× ${i.nome} — ${formatBrl(i.valorTotal)}`))
      linhas.push(`  Total nova compra: ${formatBrl(data.totalNovaCompra)}`)
    }
    linhas.push("")
    if (data.creditoGerado > 0) linhas.push(`Crédito gerado: ${formatBrl(data.creditoGerado)}`)
    if (data.creditoUtilizado > 0) linhas.push(`Crédito utilizado: ${formatBrl(data.creditoUtilizado)}`)
    if (data.diferencaPaga > 0) linhas.push(`Diferença paga: ${formatBrl(data.diferencaPaga)} (${data.diferencaForma ?? "—"})`)
    if (data.saldoFinal > 0) linhas.push(`Saldo final em haver: ${formatBrl(data.saldoFinal)}`)
    if (data.motivo) linhas.push("", `Motivo: ${data.motivo}`)
    linhas.push("", `ID devolução: ${data.devolucaoId}`)
    const texto = linhas.filter((l) => l !== null).join("\n")
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(texto).then(
        () => toast({ title: "Resumo copiado", description: "Cole onde precisar." }),
        () => toast({ title: "Falha ao copiar", variant: "destructive" }),
      )
    }
  }, [data, nomeLoja, tipoLabel, dataLabel, toast])

  const imprimirHtml = useCallback(() => {
    const esc = (s: string) => escapeHtml(s)
    const linhasDev = data.itensDevolvidos
      .map((i) => `<tr><td>${esc(i.nome)}</td><td style="text-align:right">${i.quantidade}</td><td style="text-align:right">${formatBrl(i.valorTotal)}</td></tr>`)
      .join("")
    const linhasNovos = data.itensNovos
      .map((i) => `<tr><td>${esc(i.nome)}</td><td style="text-align:right">${i.quantidade}</td><td style="text-align:right">${formatBrl(i.valorTotal)}</td></tr>`)
      .join("")
    openThermalHtmlPrint(
      `
      <div style="text-align:center;font-weight:700">${esc(nomeLoja)}</div>
      <div style="text-align:center;font-size:11px;margin:2px 0">${esc(tipoLabel)}</div>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <p style="margin:2px 0;font-size:11px">Data: ${esc(dataLabel)}</p>
      <p style="margin:2px 0;font-size:11px">Operador: ${esc(data.operador)}</p>
      <p style="margin:2px 0;font-size:11px">Venda origem: ${esc(data.vendaOrigemId)}</p>
      ${data.novaVendaId ? `<p style="margin:2px 0;font-size:11px">Nova venda: ${esc(data.novaVendaId)}</p>` : ""}
      <p style="margin:2px 0;font-size:11px">Cliente: ${esc(data.clienteNome)} (${esc(data.clienteCpf)})</p>
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      <p style="font-weight:700;margin:4px 0">Itens devolvidos</p>
      <table style="width:100%;font-size:11px;border-collapse:collapse">${linhasDev}</table>
      <p style="text-align:right;margin:4px 0">Total devolvido: <strong>${formatBrl(data.valorDevolvido)}</strong></p>
      ${
        data.itensNovos.length > 0
          ? `<div style="border-top:1px dashed #000;margin:6px 0"></div>
             <p style="font-weight:700;margin:4px 0">Itens novos</p>
             <table style="width:100%;font-size:11px;border-collapse:collapse">${linhasNovos}</table>
             <p style="text-align:right;margin:4px 0">Total nova compra: <strong>${formatBrl(data.totalNovaCompra)}</strong></p>`
          : ""
      }
      <div style="border-top:1px dashed #000;margin:6px 0"></div>
      ${data.creditoGerado > 0 ? `<p style="margin:2px 0">Crédito gerado: ${formatBrl(data.creditoGerado)}</p>` : ""}
      ${data.creditoUtilizado > 0 ? `<p style="margin:2px 0">Crédito utilizado: ${formatBrl(data.creditoUtilizado)}</p>` : ""}
      ${data.diferencaPaga > 0 ? `<p style="margin:2px 0">Diferença paga: ${formatBrl(data.diferencaPaga)} (${esc(data.diferencaForma ?? "—")})</p>` : ""}
      ${data.saldoFinal > 0 ? `<p style="margin:2px 0"><strong>Saldo em haver: ${formatBrl(data.saldoFinal)}</strong></p>` : ""}
      ${data.motivo ? `<p style="margin:6px 0 2px 0;font-size:11px">Motivo: ${esc(data.motivo)}</p>` : ""}
      <p style="margin:6px 0 0 0;font-size:10px;color:#555">ID devolução: ${esc(data.devolucaoId)}</p>
      `,
      tipoLabel,
    )
  }, [data, nomeLoja, tipoLabel, dataLabel])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-primary" />
            Comprovante — {tipoLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm">
          <div className="space-y-1 text-center">
            <p className="font-semibold">{nomeLoja}</p>
            <p className="text-xs text-muted-foreground">{tipoLabel}</p>
            <p className="text-xs text-muted-foreground">{dataLabel}</p>
          </div>
          <Separator className="my-3" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">Operador</p>
              <p className="font-medium">{data.operador}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Venda origem</p>
              <p className="font-mono font-medium">{data.vendaOrigemId}</p>
            </div>
            {data.novaVendaId && (
              <div className="col-span-2">
                <p className="text-muted-foreground">Nova venda</p>
                <p className="font-mono font-medium">{data.novaVendaId}</p>
              </div>
            )}
            <div className="col-span-2">
              <p className="text-muted-foreground">Cliente</p>
              <p className="font-medium">
                {data.clienteNome} <span className="text-xs text-muted-foreground">({data.clienteCpf})</span>
              </p>
            </div>
          </div>

          <Separator className="my-3" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens devolvidos</p>
          <div className="mt-1 space-y-1">
            {data.itensDevolvidos.map((i, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <span>{i.quantidade}× {i.nome}</span>
                <span className="font-medium">{formatBrl(i.valorTotal)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-1 text-xs">
              <span className="text-muted-foreground">Total devolvido</span>
              <span className="font-semibold">{formatBrl(data.valorDevolvido)}</span>
            </div>
          </div>

          {data.itensNovos.length > 0 && (
            <>
              <Separator className="my-3" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens novos</p>
              <div className="mt-1 space-y-1">
                {data.itensNovos.map((i, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span>{i.quantidade}× {i.nome}</span>
                    <span className="font-medium">{formatBrl(i.valorTotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1 text-xs">
                  <span className="text-muted-foreground">Total nova compra</span>
                  <span className="font-semibold">{formatBrl(data.totalNovaCompra)}</span>
                </div>
              </div>
            </>
          )}

          <Separator className="my-3" />
          <div className="space-y-1 text-xs">
            {data.creditoGerado > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Crédito gerado</span>
                <span className="font-medium">{formatBrl(data.creditoGerado)}</span>
              </div>
            )}
            {data.creditoUtilizado > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Crédito utilizado</span>
                <span className="font-medium">{formatBrl(data.creditoUtilizado)}</span>
              </div>
            )}
            {data.diferencaPaga > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Diferença paga ({data.diferencaForma ?? "—"})</span>
                <span className="font-medium">{formatBrl(data.diferencaPaga)}</span>
              </div>
            )}
            {data.saldoFinal > 0 && (
              <div className="flex justify-between border-t border-border pt-1">
                <span className="font-semibold">Saldo em haver</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatBrl(data.saldoFinal)}</span>
              </div>
            )}
          </div>

          {data.motivo && (
            <>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">Motivo: {data.motivo}</p>
            </>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground">ID: {data.devolucaoId}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <Button type="button" size="sm" onClick={imprimirHtml}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
          {data.creditoGerado > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={onImprimirVale}>
              Imprimir vale 80mm
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={copiarResumo}>
            <Search className="mr-2 h-4 w-4" /> Copiar resumo
          </Button>
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatBrl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

