"use client"

import { useState, useMemo, useCallback, type Dispatch, type SetStateAction } from "react"
import {
  Plus,
  Search,
  FileText,
  ArrowRight,
  Edit,
  MessageCircle,
  User,
  Smartphone,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  useConfigEmpresa,
  IDS_GARANTIA_OS,
  configPadrao,
  type CategoriaGarantia,
} from "@/lib/config-empresa"
import { useToast } from "@/hooks/use-toast"
import {
  type OrdemServico,
  getNextNumeroOS,
  defaultChecklist,
  horaAtualHHMM,
} from "@/components/dashboard/os/ordens-servico"
import { buildOrcamentoWhatsAppMessage } from "@/lib/whatsapp-orcamento-message"
import { useOperationsStore } from "@/lib/operations-store"
import type { Orcamento } from "@/lib/orcamento-types"

export type { Orcamento }

/** Migra orçamentos antigos (valor serviço + peças) para custo + valor final. */
export function normalizeOrcamento(o: Orcamento & { valorServico?: number; valorPecas?: number }): Orcamento {
  const hasNew =
    typeof o.custoPeca === "number" &&
    typeof o.valorFinalCliente === "number" &&
    o.valorServico === undefined &&
    o.valorPecas === undefined
  if (hasNew) {
    return {
      id: o.id,
      numero: o.numero,
      cliente: o.cliente,
      aparelho: o.aparelho,
      defeito: o.defeito,
      validadeAte: o.validadeAte,
      custoPeca: o.custoPeca,
      valorFinalCliente: o.valorFinalCliente,
      termoGarantia: o.termoGarantia,
      status: o.status,
      convertidoParaNumeroOS: o.convertidoParaNumeroOS,
      pagamentoCliente: o.pagamentoCliente,
    }
  }
  const vs = o.valorServico ?? 0
  const vp = o.valorPecas ?? 0
  return {
    ...o,
    custoPeca: o.custoPeca ?? vp,
    valorFinalCliente: o.valorFinalCliente ?? vs + vp,
  }
}

function lucroBruto(o: Orcamento & { valorServico?: number; valorPecas?: number }) {
  const n = normalizeOrcamento(o)
  return n.valorFinalCliente - n.custoPeca
}

function getNextNumeroOrcamento(lista: Orcamento[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const o of lista) {
    const m = o.numero.match(/^ORC-(\d{4})-(\d+)$/)
    if (!m) continue
    const y = parseInt(m[1], 10)
    const n = parseInt(m[2], 10)
    if (y === year && !Number.isNaN(n) && n > max) max = n
  }
  return `ORC-${year}-${String(max + 1).padStart(3, "0")}`
}

interface OrcamentosProps {
  ordens: OrdemServico[]
  setOrdens: Dispatch<SetStateAction<OrdemServico[]>>
}

export function Orcamentos({ ordens, setOrdens }: OrcamentosProps) {
  const { config } = useConfigEmpresa()
  const { toast } = useToast()
  const { orcamentos, setOrcamentos } = useOperationsStore()

  const criarOrcamentoVazio = useCallback((): Omit<Orcamento, "id" | "numero" | "status"> => {
    const d = new Date()
    const validade = new Date(d)
    const dias =
      typeof config.pdv.validadeOrcamentoDias === "number"
        ? config.pdv.validadeOrcamentoDias
        : configPadrao.pdv.validadeOrcamentoDias
    const clamped = Math.max(1, Math.min(365, dias))
    validade.setDate(validade.getDate() + clamped)
    return {
      cliente: { nome: "", telefone: "", cpf: "" },
      aparelho: { marca: "", modelo: "", imei: "", cor: "" },
      defeito: "",
      validadeAte: validade.toISOString().split("T")[0],
      custoPeca: 0,
      valorFinalCliente: 0,
      termoGarantia: "garantia_troca_tela",
    }
  }, [config.pdv.validadeOrcamentoDias])

  const [searchTerm, setSearchTerm] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Orcamento | null>(null)
  const [form, setForm] = useState<Omit<Orcamento, "id" | "numero" | "status">>(() => {
    const d = new Date()
    const validade = new Date(d)
    const dias = configPadrao.pdv.validadeOrcamentoDias ?? 7
    validade.setDate(validade.getDate() + Math.max(1, Math.min(365, dias)))
    return {
      cliente: { nome: "", telefone: "", cpf: "" },
      aparelho: { marca: "", modelo: "", imei: "", cor: "" },
      defeito: "",
      validadeAte: validade.toISOString().split("T")[0],
      custoPeca: 0,
      valorFinalCliente: 0,
      termoGarantia: "garantia_troca_tela",
    }
  })

  const garantiasSelect = useMemo((): CategoriaGarantia[] => {
    return (IDS_GARANTIA_OS as readonly string[])
      .map((id) => {
        return (
          config.termosGarantia.categorias.find((c) => c.id === id) ??
          configPadrao.termosGarantia.categorias.find((c) => c.id === id)
        )
      })
      .filter((c): c is CategoriaGarantia => c != null)
  }, [config.termosGarantia.categorias])

  const filtered = orcamentos.filter(
    (o) =>
      o.numero.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.cliente.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.aparelho.modelo.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const lucroBrutoListaFiltrada = useMemo(
    () => filtered.reduce((sum, o) => sum + lucroBruto(o), 0),
    [filtered]
  )

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

  const formatDate = (d: string) => new Date(d).toLocaleDateString("pt-BR")

  const openNovo = () => {
    setEditing(null)
    setForm(criarOrcamentoVazio())
    setModalOpen(true)
  }

  const openEditar = (o: Orcamento & { valorServico?: number; valorPecas?: number }) => {
    const n = normalizeOrcamento(o)
    setEditing(n)
    setForm({
      cliente: { ...n.cliente },
      aparelho: { ...n.aparelho },
      defeito: n.defeito,
      validadeAte: n.validadeAte,
      custoPeca: n.custoPeca,
      valorFinalCliente: n.valorFinalCliente,
      termoGarantia: (IDS_GARANTIA_OS as readonly string[]).includes(n.termoGarantia)
        ? n.termoGarantia
        : "garantia_troca_tela",
    })
    setModalOpen(true)
  }

  const salvarOrcamento = () => {
    const payload: Omit<Orcamento, "id" | "numero" | "status" | "convertidoParaNumeroOS"> = {
      cliente: form.cliente,
      aparelho: form.aparelho,
      defeito: form.defeito,
      validadeAte: form.validadeAte,
      custoPeca: form.custoPeca,
      valorFinalCliente: form.valorFinalCliente,
      termoGarantia: form.termoGarantia,
    }
    if (editing) {
      setOrcamentos((prev) =>
        prev.map((o) =>
          o.id === editing.id
            ? {
                id: o.id,
                numero: o.numero,
                status: o.status,
                convertidoParaNumeroOS: o.convertidoParaNumeroOS,
                pagamentoCliente: o.pagamentoCliente,
                ...payload,
              }
            : o
        )
      )
    } else {
      const novo: Orcamento = {
        id: Date.now().toString(),
        numero: getNextNumeroOrcamento(orcamentos),
        status: "pendente",
        ...payload,
      }
      setOrcamentos((prev) => [...prev, novo])
    }
    toast({
      title: editing ? "Orcamento atualizado" : "Orcamento criado",
      description: "Dados salvos com sucesso.",
    })
    setModalOpen(false)
  }

  const converterEmOS = (orc: Orcamento & { valorServico?: number; valorPecas?: number }) => {
    const n = normalizeOrcamento(orc)
    const custo = n.custoPeca
    const valorServicoOs = Math.max(0, n.valorFinalCliente - custo)
    const d = new Date()
    const numero = getNextNumeroOS(ordens)
    const novaOS: OrdemServico = {
      id: Date.now().toString(),
      numero,
      cliente: { ...n.cliente },
      aparelho: { ...n.aparelho },
      checklist: defaultChecklist.map((c) => ({ ...c })),
      defeito: n.defeito,
      solucao: "",
      status: "em_reparo",
      dataEntrada: d.toISOString().split("T")[0],
      horaEntrada: horaAtualHHMM(),
      dataPrevisao: n.validadeAte,
      dataSaida: null,
      horaSaida: null,
      valorServico: valorServicoOs,
      valorPecas: custo,
      fotos: [],
      observacoes: `Convertido do ${n.numero}`,
      termoGarantia: n.termoGarantia,
      textoGarantiaEditado: "",
    }
    setOrdens((prev) => [...prev, novaOS])
    setOrcamentos((prev) =>
      prev.map((o) =>
        o.id === n.id
          ? {
              ...normalizeOrcamento(o),
              status: "convertido" as const,
              convertidoParaNumeroOS: numero,
            }
          : o
      )
    )
    toast({
      title: "Orcamento convertido em O.S.",
      description: `${n.numero} convertido para ${numero}.`,
    })
  }

  const imprimirOrcamento = (orc: Orcamento & { valorServico?: number; valorPecas?: number }) => {
    const n = normalizeOrcamento(orc)
    const nomeEmpresa = (config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
    const logo = config.empresa.identidadeVisual.logoUrl
    const total = n.valorFinalCliente
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Orcamento ${n.numero}</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px">
        ${logo ? `<img src="${logo}" style="height:56px;object-fit:contain" />` : ""}
        <h2>${nomeEmpresa}</h2>
        <p><strong>CNPJ:</strong> ${config.empresa.cnpj || configPadrao.empresa.cnpj}</p>
        <p><strong>Orcamento:</strong> ${n.numero}</p>
        <hr />
        <p><strong>Cliente:</strong> ${n.cliente.nome}</p>
        <p><strong>Aparelho:</strong> ${n.aparelho.marca} ${n.aparelho.modelo}</p>
        <p><strong>Defeito:</strong> ${n.defeito}</p>
        <p><strong>Total:</strong> ${formatCurrency(total)}</p>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  const getStatusBadge = (status: Orcamento["status"], osNumero?: string) => {
    switch (status) {
      case "aprovado":
        return <Badge className="bg-primary/20 text-primary border-primary/40">Aprovado</Badge>
      case "recusado":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/40">Recusado</Badge>
      case "convertido":
        return <Badge className="bg-primary/15 text-primary border-primary/35">OS {osNumero}</Badge>
      default:
        return <Badge variant="outline">Pendente</Badge>
    }
  }

  const enviarViaWhatsApp = (orc: Orcamento & { valorServico?: number; valorPecas?: number }) => {
    const n = normalizeOrcamento(orc)
    const numero = n.cliente.telefone.replace(/\D/g, "")
    if (!numero) {
      toast({
        title: "Telefone ausente",
        description: "Telefone do cliente nao informado para envio.",
      })
      return
    }
    const aparelhoTexto = [n.aparelho.marca, n.aparelho.modelo].filter(Boolean).join(" ").trim()
    const texto = buildOrcamentoWhatsAppMessage({
      numero: n.numero,
      clienteNome: n.cliente.nome,
      aparelhoTexto,
      servico: n.defeito,
      valorTotal: n.valorFinalCliente,
      validadeAte: n.validadeAte,
      garantiaPadraoDias:
        typeof config.pdv.garantiaPadraoDias === "number"
          ? config.pdv.garantiaPadraoDias
          : configPadrao.pdv.garantiaPadraoDias,
    })
    const msg = encodeURIComponent(texto)
    window.open(`https://api.whatsapp.com/send?phone=55${numero}&text=${msg}`, "_blank")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <Button
          size="lg"
          className="bg-primary hover:bg-primary/90 h-12 px-6 text-base font-semibold text-primary-foreground"
          onClick={openNovo}
        >
          <Plus className="w-5 h-5 mr-2" />
          Novo orçamento
        </Button>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Buscar orçamento, cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-12 bg-secondary border-border"
          />
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex flex-col gap-1 items-start">
            <span className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Orçamentos ({filtered.length})
            </span>
            {filtered.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                Lucro bruto (lista filtrada): {formatCurrency(lucroBrutoListaFiltrada)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Nenhum orçamento cadastrado. Clique em &quot;Novo orçamento&quot; para começar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>Número</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Aparelho</TableHead>
                    <TableHead className="hidden sm:table-cell">Validade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Lucro</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => {
                    const row = normalizeOrcamento(o)
                    const lb = lucroBruto(o)
                    return (
                    <TableRow key={o.id} className="border-border">
                      <TableCell className="font-mono font-semibold">{row.numero}</TableCell>
                      <TableCell>
                        <p className="font-medium">{o.cliente.nome}</p>
                        <p className="text-xs text-muted-foreground">{o.cliente.telefone}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {o.aparelho.marca} {o.aparelho.modelo}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {formatDate(o.validadeAte)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(o.status, o.convertidoParaNumeroOS)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-xs hidden lg:table-cell ${
                          lb < 0 ? "text-amber-600/80 dark:text-amber-500/90" : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(lb)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(row.valorFinalCliente)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          <Select
                            value={o.status}
                            onValueChange={(value: Orcamento["status"]) =>
                              setOrcamentos((prev) =>
                                prev.map((item) => {
                                  if (item.id !== o.id || item.status === "convertido") return item
                                  const next: Orcamento = { ...item, status: value }
                                  if (value === "aprovado" && next.pagamentoCliente !== "pago") {
                                    next.pagamentoCliente = "pendente"
                                  }
                                  if (value !== "aprovado" && value !== "convertido") {
                                    next.pagamentoCliente = undefined
                                  }
                                  return next
                                })
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-[130px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pendente">Pendente</SelectItem>
                              <SelectItem value="aprovado">Aprovado</SelectItem>
                              <SelectItem value="recusado">Recusado</SelectItem>
                              {o.status === "convertido" && (
                                <SelectItem value="convertido">Convertido</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Editar"
                            onClick={() => openEditar(o)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Enviar via WhatsApp"
                            onClick={() => enviarViaWhatsApp(o)}
                          >
                            <MessageCircle className="w-4 h-4 text-primary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Imprimir Orçamento"
                            onClick={() => imprimirOrcamento(o)}
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                          {o.status !== "convertido" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-primary"
                              title="Converter em OS"
                              onClick={() => converterEmOS(o)}
                            >
                              <ArrowRight className="w-4 h-4 mr-1" />
                              OS
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              {editing ? `Editar ${editing.numero}` : "Novo orçamento"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <User className="w-4 h-4" /> Cliente
            </div>
            <div className="grid gap-3">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  value={form.cliente.nome}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      cliente: { ...p.cliente, nome: e.target.value },
                    }))
                  }
                  className="h-11 bg-secondary border-border"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Telefone *</Label>
                  <Input
                    value={form.cliente.telefone}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        cliente: { ...p.cliente, telefone: e.target.value },
                      }))
                    }
                    className="h-11 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CPF</Label>
                  <Input
                    value={form.cliente.cpf}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        cliente: { ...p.cliente, cpf: e.target.value },
                      }))
                    }
                    className="h-11 bg-secondary border-border"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm font-medium text-foreground pt-2">
              <Smartphone className="w-4 h-4" /> Aparelho
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Marca *</Label>
                <Select
                  value={form.aparelho.marca}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, aparelho: { ...p.aparelho, marca: v } }))
                  }
                >
                  <SelectTrigger className="h-11 bg-secondary border-border">
                    <SelectValue placeholder="Marca" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Apple">Apple</SelectItem>
                    <SelectItem value="Samsung">Samsung</SelectItem>
                    <SelectItem value="Motorola">Motorola</SelectItem>
                    <SelectItem value="Xiaomi">Xiaomi</SelectItem>
                    <SelectItem value="LG">LG</SelectItem>
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Modelo *</Label>
                <Input
                  value={form.aparelho.modelo}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      aparelho: { ...p.aparelho, modelo: e.target.value },
                    }))
                  }
                  className="h-11 bg-secondary border-border"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>IMEI</Label>
                <Input
                  value={form.aparelho.imei}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      aparelho: { ...p.aparelho, imei: e.target.value },
                    }))
                  }
                  maxLength={15}
                  className="h-11 bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <Input
                  value={form.aparelho.cor}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      aparelho: { ...p.aparelho, cor: e.target.value },
                    }))
                  }
                  className="h-11 bg-secondary border-border"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Serviço / defeito relatado *</Label>
              <Textarea
                value={form.defeito}
                onChange={(e) => setForm((p) => ({ ...p, defeito: e.target.value }))}
                className="min-h-20 bg-secondary border-border"
              />
            </div>

            <div className="space-y-2">
              <Label>Validade do orçamento</Label>
              <Input
                type="date"
                value={form.validadeAte}
                onChange={(e) => setForm((p) => ({ ...p, validadeAte: e.target.value }))}
                className="h-11 bg-secondary border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Valor da peça (custo) (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.custoPeca || ""}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      custoPeca: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="h-11 bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Valor final ao cliente (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.valorFinalCliente || ""}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      valorFinalCliente: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="h-11 bg-secondary border-border"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Lucro bruto (só para você):{" "}
              <span
                className={
                  form.valorFinalCliente - form.custoPeca < 0
                    ? "text-amber-600 dark:text-amber-500"
                    : ""
                }
              >
                {formatCurrency(form.valorFinalCliente - form.custoPeca)}
              </span>
            </p>

            <div className="space-y-2">
              <Label>Garantia (tipo)</Label>
              <Select
                value={form.termoGarantia}
                onValueChange={(v) => setForm((p) => ({ ...p, termoGarantia: v }))}
              >
                <SelectTrigger className="h-11 bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {garantiasSelect.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.servico}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                className="border-primary/40 hover:bg-primary/10"
                onClick={() => setModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={salvarOrcamento}
                disabled={
                  !form.cliente.nome ||
                  !form.cliente.telefone ||
                  !form.aparelho.marca ||
                  !form.aparelho.modelo ||
                  !form.defeito.trim()
                }
              >
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
