"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Search, Package, Wallet, RotateCcw, Printer } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useOperationsStore, type SaleRecord } from "@/lib/operations-store"
import { normalizeDocDigits } from "@/lib/cpf"
import { buildValeTrocaEscPos } from "@/lib/escpos"
import { sendEscPosViaProxy, downloadEscPosFile, openThermalHtmlPrint, escapeHtml } from "@/lib/thermal-print"
import { appendAuditLog } from "@/lib/audit-log"
import { useToast } from "@/hooks/use-toast"

export function TrocasDevolucao() {
  const { config } = useConfigEmpresa()
  const { toast } = useToast()
  const { sales, registrarDevolucao, inventory } = useOperationsStore()
  const searchParams = useSearchParams()

  const [busca, setBusca] = useState("")
  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<"vale_credito" | "somente_estoque">("vale_credito")
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

  // Prefill via URL: /?page=trocas&sale=VDA-...
  useEffect(() => {
    const id = (searchParams.get("sale") || "").trim()
    if (!id) return
    setBusca(id)
    const upper = id.toUpperCase()
    const s = sales.find(
      (x) => x.id.toUpperCase() === upper || x.id.replace(/\s/g, "").toUpperCase() === upper.replace(/\s/g, "")
    )
    if (s) {
      setSale(s)
      toast({ title: "Venda localizada", description: s.id })
    }
  }, [searchParams, sales, toast])

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

    const r = registrarDevolucao({
      saleId: sale.id,
      lines,
      mode,
      customerCpf: cpf,
      customerName: nome,
    })
    if (!r.ok) {
      toast({ title: "Devolução não registrada", description: r.reason, variant: "destructive" })
      return
    }

    appendAuditLog({
      action: "devolucao_vale",
      userLabel: `${nomeLoja} (PDV)`,
      detail: `${r.devolucaoId} | venda ${sale.id} | modo ${mode} | crédito ${r.creditIssued.toFixed(2)}`,
    })

    setLastDevolucao({
      id: r.devolucaoId,
      credit: r.creditIssued,
      nome,
      cpf,
    })
    toast({
      title: mode === "vale_credito" ? "Crédito em haver gerado" : "Estoque atualizado",
      description: mode === "vale_credito" ? `${formatBrl(r.creditIssued)} para ${nome}` : "Itens retornaram ao estoque.",
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
    <div className="space-y-6 max-w-3xl">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-primary" />
            Troca e devolução
          </CardTitle>
          <CardDescription>
            Busque pelo <strong>ID do cupom</strong>, <strong>nome do cliente</strong> ou <strong>código/bip do produto</strong>.
            Ao bipar um item, listamos as últimas vendas em que ele aparece para você escolher a origem da troca. Os itens
            retornam ao estoque; use <strong>crédito em haver</strong> vinculado ao CPF quando aplicável.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 space-y-2">
              <Label>Venda, cliente ou código de barras do produto</Label>
              <Input
                placeholder="VDA-2026-0001 · João Silva · código do produto"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") encontrarVenda()
                }}
                className="h-11 font-mono text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button type="button" className="h-11 bg-primary" onClick={encontrarVenda}>
                <Search className="w-4 h-4 mr-2" />
                Buscar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {candidateSales && candidateSales.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{candidateLabel || "Escolha a venda"}</CardTitle>
            <CardDescription>Selecione o cupom de origem da troca ou devolução.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidateSales.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="outline"
                className="h-auto w-full flex-col items-start gap-0.5 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
                onClick={() => aplicarVenda(s)}
              >
                <span className="font-mono text-sm font-semibold">{s.id}</span>
                <span className="text-sm text-muted-foreground">
                  {s.customerName || "—"} · {formatBrl(s.total)}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString("pt-BR")}</span>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {sale && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="w-5 h-5" />
              {sale.id}
            </CardTitle>
            <CardDescription>
              Total da venda: {formatBrl(sale.total)} · {new Date(sale.at).toLocaleString("pt-BR")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>CPF/CNPJ (se não veio na venda)</Label>
                <Input value={cpfExtra} onChange={(e) => setCpfExtra(e.target.value)} placeholder="Somente números" />
              </div>
              <div className="space-y-2">
                <Label>Nome do cliente</Label>
                <Input value={nomeExtra} onChange={(e) => setNomeExtra(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Modo</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "vale_credito" | "somente_estoque")}
                className="flex flex-col gap-2"
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="vale_credito" id="m1" />
                  <span className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-primary" />
                    Crédito em haver (vale-troca) — cliente não leva produto novo agora
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="somente_estoque" id="m2" />
                  <span>Apenas devolver ao estoque (sem gerar crédito)</span>
                </label>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>Quantidades a devolver (máx. por linha)</Label>
              {linhasComMax.map((l) => (
                <div key={l.inventoryId} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border bg-secondary/30">
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Vendido: {l.quantity} · Já devolvido: {l.qtyReturned ?? 0} · Pode devolver: {l.maxReturn}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={l.maxReturn}
                    className="w-24 h-10"
                    disabled={l.maxReturn <= 0}
                    value={qtyByLine[l.inventoryId] ?? "0"}
                    onChange={(e) =>
                      setQtyByLine((prev) => ({ ...prev, [l.inventoryId]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" className="bg-primary" onClick={handleRegistrar}>
                Confirmar devolução
              </Button>
              {lastDevolucao && lastDevolucao.credit > 0 && (
                <Button type="button" variant="outline" onClick={() => void imprimirVale()}>
                  <Printer className="w-4 h-4 mr-2" />
                  Imprimir comprovante 80mm
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatBrl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

