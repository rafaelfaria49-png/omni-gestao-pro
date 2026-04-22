"use client"

import { useState, useRef, useMemo, useEffect, type Dispatch, type SetStateAction } from "react"
import { 
  Plus, 
  Search, 
  Mic,
  ClipboardList,
  Smartphone,
  User,
  Calendar,
  Clock,
  Camera,
  Upload,
  X,
  Check,
  Phone,
  MessageCircle,
  Printer,
  FileText,
  ChevronRight,
  Edit,
  Eye,
  DollarSign,
  Package,
  Wrench,
  CheckCircle2,
  Circle,
  Timer,
  Bell
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import {
  useConfigEmpresa,
  IDS_GARANTIA_OS,
  configPadrao,
  type CategoriaGarantia,
} from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { appendAuditLog } from "@/lib/audit-log"
import { buildOsTicketEscPos } from "@/lib/escpos"
import {
  sendEscPosViaProxy,
  downloadEscPosFile,
  openThermalHtmlPrint,
  escapeHtml,
} from "@/lib/thermal-print"
import { useOperationsStore } from "@/lib/operations-store"
import { playVoiceBeep } from "@/lib/voice-beep"
import {
  parseOsVoiceUtterance,
  clienteJaExisteNasOrdens,
  resolveAparelhoParaOS,
} from "@/lib/voice-os-nlp"
import {
  humanizeSpeechError,
  isBenignSpeechError,
  logSpeechRecognitionError,
  logVoiceEnvironmentOnce,
} from "@/lib/web-speech-recognition"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import { cn } from "@/lib/utils"

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { resultIndex: number; results: unknown }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

interface ChecklistItem {
  id: string
  label: string
  checked: boolean
}

export interface OrdemServico {
  id: string
  numero: string
  cliente: {
    nome: string
    telefone: string
    cpf: string
  }
  aparelho: {
    marca: string
    modelo: string
    imei: string
    cor: string
  }
  checklist: ChecklistItem[]
  defeito: string
  solucao: string
  status: "aguardando_peca" | "em_reparo" | "pronto" | "finalizado" | "pago"
  dataEntrada: string
  horaEntrada: string
  dataPrevisao: string
  dataSaida: string | null
  horaSaida: string | null
  valorServico: number
  valorPecas: number
  fotos: string[]
  observacoes: string
  termoGarantia: string // ID do termo de garantia aplicado
  textoGarantiaEditado: string // Texto editado para impressão
}

export function horaAtualHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function asText(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (v instanceof Date) return v.toISOString()
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function lowerText(v: unknown): string {
  return asText(v).toLowerCase()
}

export const defaultChecklist: ChecklistItem[] = [
  { id: "1", label: "Liga normalmente?", checked: false },
  { id: "2", label: "Tela quebrada?", checked: false },
  { id: "3", label: "Tem riscos no corpo?", checked: false },
  { id: "4", label: "Tem senha/bloqueio?", checked: false },
  { id: "5", label: "Botões funcionando?", checked: false },
  { id: "6", label: "Câmera funcionando?", checked: false },
  { id: "7", label: "Microfone/Alto-falante OK?", checked: false },
  { id: "8", label: "Bateria original?", checked: false },
]

export const INITIAL_ORDENS: OrdemServico[] = [
  {
    id: "1",
    numero: "OS-2024-001",
    cliente: {
      nome: "João Silva",
      telefone: "(11) 99999-1234",
      cpf: "123.456.789-00"
    },
    aparelho: {
      marca: "Apple",
      modelo: "iPhone 13",
      imei: "354678091234567",
      cor: "Preto"
    },
    checklist: [
      { id: "1", label: "Liga normalmente?", checked: true },
      { id: "2", label: "Tela quebrada?", checked: true },
      { id: "3", label: "Tem riscos no corpo?", checked: false },
      { id: "4", label: "Tem senha/bloqueio?", checked: true },
    ],
    defeito: "Tela trincada após queda. Display funcionando parcialmente com manchas.",
    solucao: "",
    status: "em_reparo",
    dataEntrada: "2024-01-15",
    horaEntrada: "09:30",
    dataPrevisao: "2024-01-17",
    dataSaida: null,
    horaSaida: null,
    valorServico: 80.00,
    valorPecas: 350.00,
    fotos: [],
    observacoes: "Cliente informou que caiu na água também",
    termoGarantia: "garantia_troca_tela",
    textoGarantiaEditado: "",
  },
  {
    id: "2",
    numero: "OS-2024-002",
    cliente: {
      nome: "Maria Santos",
      telefone: "(11) 98888-5678",
      cpf: "987.654.321-00"
    },
    aparelho: {
      marca: "Samsung",
      modelo: "Galaxy S22",
      imei: "358765432109876",
      cor: "Branco"
    },
    checklist: [
      { id: "1", label: "Liga normalmente?", checked: false },
      { id: "2", label: "Tela quebrada?", checked: false },
    ],
    defeito: "Não liga. Possível problema na placa.",
    solucao: "Troca de CI de carga. Aparelho funcionando normalmente.",
    status: "pronto",
    dataEntrada: "2024-01-14",
    horaEntrada: "14:00",
    dataPrevisao: "2024-01-16",
    dataSaida: "2024-01-16",
    horaSaida: "16:45",
    valorServico: 150.00,
    valorPecas: 80.00,
    fotos: [],
    observacoes: "",
    termoGarantia: "garantia_bateria",
    textoGarantiaEditado: "",
  },
  {
    id: "3",
    numero: "OS-2024-003",
    cliente: {
      nome: "Carlos Oliveira",
      telefone: "(11) 97777-9012",
      cpf: "456.789.123-00"
    },
    aparelho: {
      marca: "Motorola",
      modelo: "Moto G52",
      imei: "352143658709123",
      cor: "Azul"
    },
    checklist: [
      { id: "1", label: "Liga normalmente?", checked: true },
      { id: "2", label: "Tela quebrada?", checked: false },
    ],
    defeito: "Bateria viciada, descarrega muito rápido.",
    solucao: "",
    status: "aguardando_peca",
    dataEntrada: "2024-01-16",
    horaEntrada: "11:15",
    dataPrevisao: "2024-01-20",
    dataSaida: null,
    horaSaida: null,
    valorServico: 50.00,
    valorPecas: 65.00,
    fotos: [],
    observacoes: "Bateria encomendada - chega dia 19",
    termoGarantia: "garantia_bateria",
    textoGarantiaEditado: ""
  },
]

function criarFormularioOSVazio(): Omit<OrdemServico, "id" | "numero"> {
  const d = new Date()
  return {
    cliente: { nome: "", telefone: "", cpf: "" },
    aparelho: { marca: "", modelo: "", imei: "", cor: "" },
    checklist: defaultChecklist.map((c) => ({ ...c })),
    defeito: "",
    solucao: "",
    status: "em_reparo",
    dataEntrada: d.toISOString().split("T")[0],
    horaEntrada: horaAtualHHMM(),
    dataPrevisao: "",
    dataSaida: null,
    horaSaida: null,
    valorServico: 0,
    valorPecas: 0,
    fotos: [],
    observacoes: "",
    termoGarantia: "garantia_troca_tela",
    textoGarantiaEditado: "",
  }
}

export function getNextNumeroOS(ordens: OrdemServico[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const o of ordens) {
    const m = o.numero.match(/^OS-(\d{4})-(\d+)$/)
    if (!m) continue
    const y = parseInt(m[1], 10)
    const n = parseInt(m[2], 10)
    if (y === year && !Number.isNaN(n) && n > max) max = n
  }
  return `OS-${year}-${String(max + 1).padStart(3, "0")}`
}

function normalizarTermoGarantiaId(id: string): string {
  const allowed = IDS_GARANTIA_OS as readonly string[]
  if ((allowed as string[]).includes(id)) return id
  if (id === "garantia_carcaca") return "conectores_oxidacao"
  return "garantia_troca_tela"
}

interface OrdensServicoProps {
  ordens: OrdemServico[]
  setOrdens: Dispatch<SetStateAction<OrdemServico[]>>
  onGerarVenda?: (os: OrdemServico) => void
  voiceNewOs?: { key: number; clienteNome?: string } | null
  onVoiceNewOsConsumed?: () => void
  /** Quando o nome não existe nas OS, sugerir cadastro em Clientes. */
  onAbrirCadastroCliente?: (nome: string) => void
}

export function OrdensServico({
  ordens,
  setOrdens,
  onGerarVenda,
  voiceNewOs = null,
  onVoiceNewOsConsumed,
  onAbrirCadastroCliente,
}: OrdensServicoProps) {
  const { config } = useConfigEmpresa()
  const { mostraTecnicoLaudoOs } = usePerfilLoja()
  const { empresaDocumentos, getEnderecoDocumentos } = useLojaAtiva()
  const { termosGarantia, getGarantiaById } = useStoreSettings()
  const { incrementOsAbertasDia } = useOperationsStore()
  const { toast } = useToast()
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false)
  const [editingOS, setEditingOS] = useState<OrdemServico | null>(null)
  const [viewingOS, setViewingOS] = useState<OrdemServico | null>(null)
  const [formData, setFormData] = useState<Omit<OrdemServico, "id" | "numero">>(() =>
    criarFormularioOSVazio()
  )
  const [activeTab, setActiveTab] = useState("cliente")
  useEffect(() => {
    if (!mostraTecnicoLaudoOs && activeTab === "laudo") setActiveTab("cliente")
  }, [mostraTecnicoLaudoOs, activeTab])
  const [photoPreview, setPhotoPreview] = useState<string[]>([])
  const [parcelasCarne, setParcelasCarne] = useState("3")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const voiceChunksRef = useRef<string[]>([])
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceConfirmOpen, setVoiceConfirmOpen] = useState(false)
  const [voiceTranscriptPreview, setVoiceTranscriptPreview] = useState("")
  const [voiceConfirmNome, setVoiceConfirmNome] = useState("")
  const [voiceConfirmAparelho, setVoiceConfirmAparelho] = useState("")
  const [voiceConfirmDefeito, setVoiceConfirmDefeito] = useState("")
  const [voiceConfirmValorStr, setVoiceConfirmValorStr] = useState("")
  const [useVoiceNome, setUseVoiceNome] = useState(true)
  const [useVoiceAparelho, setUseVoiceAparelho] = useState(true)
  const [useVoiceDefeito, setUseVoiceDefeito] = useState(true)
  const [useVoiceValor, setUseVoiceValor] = useState(true)
  const [isHoldingVoice, setIsHoldingVoice] = useState(false)

  const filteredOrdens = ordens.filter(os => {
    const q = lowerText(searchTerm)
    const matchesSearch = 
      lowerText(os?.numero).includes(q) ||
      lowerText(os?.cliente?.nome).includes(q) ||
      lowerText(os?.aparelho?.marca).includes(q) ||
      lowerText(os?.aparelho?.modelo).includes(q) ||
      asText(os?.aparelho?.imei).includes(asText(searchTerm))
    const matchesStatus = statusFilter === "all" || os.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const stats = {
    total: ordens.length,
    aguardandoPeca: ordens.filter(os => os.status === "aguardando_peca").length,
    emReparo: ordens.filter(os => os.status === "em_reparo").length,
    prontas: ordens.filter(os => os.status === "pronto").length,
  }

  const getNextOSNumber = () => getNextNumeroOS(ordens)

  const garantiasParaSeletorOS = useMemo((): CategoriaGarantia[] => {
    return (IDS_GARANTIA_OS as readonly string[])
      .map((id) => {
        return (
          getGarantiaById(id) ??
          configPadrao.termosGarantia.categorias.find((c) => c.id === id)
        )
      })
      .filter((c): c is CategoriaGarantia => c != null)
  }, [getGarantiaById])

  const nomeEmpresaRodape =
    (empresaDocumentos.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia
  const cnpjRodape = (empresaDocumentos.cnpj || "").trim() || configPadrao.empresa.cnpj
  const whatsappRodape =
    (empresaDocumentos.contato.whatsapp || "").trim() || configPadrao.empresa.contato.whatsapp
  const logoEmpresa = empresaDocumentos.identidadeVisual.logoUrl
  const totalOS = formData.valorServico + formData.valorPecas

  const gerarParcelasCarne = (valor: number, qtd: number) => {
    const base = new Date()
    return Array.from({ length: qtd }, (_, i) => {
      const venc = new Date(base)
      venc.setMonth(venc.getMonth() + i + 1)
      return {
        numero: i + 1,
        valor: valor / qtd,
        vencimento: venc.toLocaleDateString("pt-BR"),
      }
    })
  }

  const handleGerarBoletoCarneOS = () => {
    const qtd = Math.max(1, parseInt(parcelasCarne || "1", 10))
    const parcelas = gerarParcelasCarne(totalOS, qtd)
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Boleto/Carnê OS</title></head>
      <body style="font-family:Arial,sans-serif;padding:24px">
        <h2>${nomeEmpresaRodape} - Carnê da Ordem de Serviço</h2>
        <p><strong>CNPJ:</strong> ${cnpjRodape}</p>
        <p><strong>Cliente:</strong> ${formData.cliente.nome || "Não informado"}</p>
        <p><strong>Total da OS:</strong> ${formatCurrency(totalOS)}</p>
        <hr />
        ${parcelas
          .map(
            (p) =>
              `<p><strong>${p.numero}/${qtd}</strong> - ${formatCurrency(p.valor)} - vencimento ${p.vencimento}</p>`
          )
          .join("")}
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  const handleOpenModal = (os?: OrdemServico) => {
    if (os) {
      setEditingOS(os)
      setFormData({
        cliente: { ...os.cliente },
        aparelho: { ...os.aparelho },
        checklist: [...os.checklist],
        defeito: os.defeito,
        solucao: os.solucao,
        status: os.status,
        dataEntrada: os.dataEntrada,
        horaEntrada: os.horaEntrada ?? horaAtualHHMM(),
        dataPrevisao: os.dataPrevisao,
        dataSaida: os.dataSaida ?? null,
        horaSaida: os.horaSaida ?? null,
        valorServico: os.valorServico,
        valorPecas: os.valorPecas,
        fotos: [...os.fotos],
        observacoes: os.observacoes,
        termoGarantia: normalizarTermoGarantiaId(os.termoGarantia),
        textoGarantiaEditado: os.textoGarantiaEditado ?? "",
      })
      setPhotoPreview([...os.fotos])
    } else {
      setEditingOS(null)
      setFormData(criarFormularioOSVazio())
      setPhotoPreview([])
    }
    setActiveTab("cliente")
    setIsModalOpen(true)
  }

  const handleViewOS = (os: OrdemServico) => {
    setViewingOS(os)
    setIsViewModalOpen(true)
  }

  const handleSave = () => {
    if (editingOS) {
      setOrdens(prev => prev.map(os => 
        os.id === editingOS.id 
          ? { ...os, ...formData, fotos: photoPreview }
          : os
      ))
    } else {
      const newOS: OrdemServico = {
        id: Date.now().toString(),
        numero: getNextOSNumber(),
        ...formData,
        fotos: photoPreview
      }
      setOrdens(prev => [...prev, newOS])
      incrementOsAbertasDia()
      appendAuditLog({
        action: "os_created",
        userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
        detail: `OS ${newOS.numero} — ${newOS.cliente.nome || "Cliente"}`,
      })
    }
    toast({
      title: editingOS ? "O.S. atualizada" : "O.S. criada",
      description: editingOS ? "Alteracoes salvas com sucesso." : "Nova ordem de servico registrada.",
    })
    setIsModalOpen(false)
  }

  const handleUpdateStatus = (osId: string, newStatus: OrdemServico["status"]) => {
    setOrdens((prev) => {
      const cur = prev.find((o) => o.id === osId)
      if (cur && cur.status !== newStatus) {
        appendAuditLog({
          action: "os_status_alterado",
          userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
          detail: `OS ${cur.numero}: status ${cur.status} → ${newStatus}`,
        })
      }
      return prev.map((os) => (os.id === osId ? { ...os, status: newStatus } : os))
    })
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader()
        reader.onloadend = () => {
          setPhotoPreview(prev => [...prev, reader.result as string])
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const removePhoto = (index: number) => {
    setPhotoPreview(prev => prev.filter((_, i) => i !== index))
  }

  const handleChecklistChange = (itemId: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      checklist: prev.checklist.map(item =>
        item.id === itemId ? { ...item, checked } : item
      )
    }))
  }

  const handlePrintOS = async (os: OrdemServico, type: "termica" | "a4") => {
    setViewingOS(os)
    setIsPrintModalOpen(true)

    if (type === "termica") {
      const g = getGarantiaById(os.termoGarantia)
      const bytes = buildOsTicketEscPos({
        os,
        nomeFantasia: nomeEmpresaRodape,
        cnpj: cnpjRodape,
        enderecoLinha: getEnderecoDocumentos(),
        labelGarantia: g ? `${g.servico}` : undefined,
      })
      const result = await sendEscPosViaProxy(bytes)
      if (result.ok) {
        toast({
          title: "Cupom ESC/POS enviado",
          description: "Dados enviados por TCP para a impressora (raw 9100). Ajuste THERMAL_PRINT_HOST no servidor.",
        })
        return
      }
      toast({
        title: "Impressora raw indisponível",
        description: `${result.error} — baixamos o .bin e abrimos impressão HTML 80mm.`,
        variant: "destructive",
      })
      downloadEscPosFile(bytes, `os-${os.numero.replace(/[^\w-]+/g, "_")}.bin`)
      const br = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
      openThermalHtmlPrint(
        `
        <div style="text-align:center;font-weight:700">ORDEM DE SERVIÇO</div>
        <div style="text-align:center;font-size:11px;margin:4px 0">${escapeHtml(nomeEmpresaRodape)}</div>
        <div style="text-align:center;font-size:10px">CNPJ ${escapeHtml(cnpjRodape)}</div>
        <div style="text-align:center;font-size:9px;margin-bottom:6px">${escapeHtml(getEnderecoDocumentos())}</div>
        <div style="border-top:1px dashed #000;margin:6px 0"></div>
        <p style="font-weight:700">${escapeHtml(asText(os?.numero))}</p>
        <p>${escapeHtml(asText(os?.dataEntrada))} ${escapeHtml(asText(os?.horaEntrada))}</p>
        <p>${escapeHtml(asText(os?.cliente?.nome))}</p>
        <p>${escapeHtml(asText(os?.aparelho?.marca))} ${escapeHtml(asText(os?.aparelho?.modelo))}</p>
        <p>${escapeHtml(asText(os?.defeito))}</p>
        <div style="border-top:1px dashed #000;margin:6px 0"></div>
        <p>Total: ${br.format(os.valorServico + os.valorPecas)}</p>
      `,
        `OS ${asText(os?.numero)}`
      )
      return
    }

    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(asText(os?.numero))}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: system-ui, sans-serif; font-size: 12px; }
  .wrap { padding: 12mm; box-sizing: border-box; }
  @media print { @page { margin: 0; } }
</style></head><body>
<div class="wrap">
  <h2 style="margin:0 0 8px">${escapeHtml(asText(nomeEmpresaRodape))} — OS ${escapeHtml(asText(os?.numero))}</h2>
  <p><strong>Cliente:</strong> ${escapeHtml(asText(os?.cliente?.nome))}</p>
  <p><strong>Aparelho:</strong> ${escapeHtml(asText(os?.aparelho?.marca))} ${escapeHtml(asText(os?.aparelho?.modelo))}</p>
  <p><strong>Defeito:</strong> ${escapeHtml(asText(os?.defeito))}</p>
  <p><strong>Total:</strong> ${escapeHtml(formatCurrency(os.valorServico + os.valorPecas))}</p>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body></html>`)
    w.document.close()
    toast({
      title: "Impressão A4",
      description: "Desative cabeçalhos e rodapés no diálogo de impressão, se aparecerem.",
    })
  }

  const handleGerarVenda = (os: OrdemServico) => {
    if (onGerarVenda) {
      onGerarVenda(os)
    } else {
      toast({
        title: "Geracao de venda iniciada",
        description: `${os.numero} no valor de R$ ${(os.valorServico + os.valorPecas).toFixed(2)}.`,
      })
    }
  }

  const handleEnviarOSWhatsApp = (os: OrdemServico) => {
    const numero = asText(os?.cliente?.telefone).replace(/\D/g, "")
    if (!numero) {
      toast({
        title: "Telefone ausente",
        description: "Telefone do cliente nao informado para envio via WhatsApp.",
      })
      return
    }
    const base = typeof window !== "undefined" ? window.location.origin : ""
    const linkRastreio = `${base}/rastreio/os/${os.id}`
    const mensagem = encodeURIComponent(
      `${nomeEmpresaRodape}\n` +
        `OS: ${asText(os?.numero)}\n` +
        `Cliente: ${asText(os?.cliente?.nome)}\n` +
        `Status: ${os.status.replace("_", " ")}\n` +
        `Total: ${formatCurrency(os.valorServico + os.valorPecas)}\n` +
        `Link de rastreio: ${linkRastreio}\n` +
        `CNPJ: ${cnpjRodape}`
    )
    window.open(`https://wa.me/55${numero}?text=${mensagem}`, "_blank")
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "aguardando_peca":
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">Aguardando Peça</Badge>
      case "em_reparo":
        return <Badge className="bg-primary/15 text-primary border-primary/35">Em Reparo</Badge>
      case "pronto":
        return <Badge className="bg-primary/20 text-primary border-primary/40">Pronto - Avisar Cliente</Badge>
      case "finalizado":
        return <Badge className="bg-muted text-black/70">Finalizado</Badge>
      case "pago":
        return <Badge className="bg-emerald-600/90 text-white border-emerald-500/40">Pago</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "aguardando_peca":
        return <Timer className="w-4 h-4 text-yellow-500" />
      case "em_reparo":
        return <Wrench className="w-4 h-4 text-primary" />
      case "pronto":
        return <Bell className="w-4 h-4 text-primary" />
      case "finalizado":
        return <CheckCircle2 className="w-4 h-4 text-black/70" />
      case "pago":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
      default:
        return <Circle className="w-4 h-4" />
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("pt-BR")
  }

  const abrirConfirmacaoVoz = (texto: string) => {
    const parsed = parseOsVoiceUtterance(texto)
    setVoiceTranscriptPreview(texto)
    setVoiceConfirmNome(parsed.clienteNome)
    setVoiceConfirmAparelho(parsed.aparelhoTexto)
    setVoiceConfirmDefeito(parsed.defeito)
    setVoiceConfirmValorStr(
      parsed.valorTotal != null && !Number.isNaN(parsed.valorTotal)
        ? String(parsed.valorTotal)
        : ""
    )
    setUseVoiceNome(true)
    setUseVoiceAparelho(true)
    setUseVoiceDefeito(true)
    setUseVoiceValor(parsed.valorTotal != null)
    setVoiceConfirmOpen(true)
  }

  const encerrarCapturaVoz = () => {
    const rec = voiceRecognitionRef.current
    if (!rec) return
    playVoiceBeep("end")
    setIsHoldingVoice(false)
    try {
      rec.stop()
    } catch {
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
    }
  }

    const iniciarCapturaVoz = () => {
    logVoiceEnvironmentOnce()
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition
    if (!SR) {
      toast({
        title: "Voz indisponível",
        description: "Use Chrome ou Edge para reconhecimento de voz.",
        variant: "destructive",
      })
      return
    }
    if (voiceRecognitionRef.current) return

    playVoiceBeep("start")
    voiceChunksRef.current = []
    const recognition: SpeechRecognitionLike = new SR()
    recognition.lang = "pt-BR"
    recognition.continuous = true
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event: { resultIndex: number; results: unknown }) => {
      const res = event.results as {
        length: number
        [i: number]: { isFinal: boolean; 0: { transcript: string } }
      }
      for (let i = event.resultIndex; i < res.length; i++) {
        const row = res[i]
        if (row.isFinal) {
          voiceChunksRef.current.push(row[0].transcript)
        }
      }
    }
    recognition.onerror = (ev) => {
      logSpeechRecognitionError("OrdensServico.iniciarCapturaVoz.onerror", ev as Event)
      const code = (ev as { error?: string }).error
      if (isBenignSpeechError(code)) return
      toast({
        title: "Erro no microfone",
        description: humanizeSpeechError(code),
        variant: "destructive",
      })
      setIsHoldingVoice(false)
    }
    recognition.onend = () => {
      voiceRecognitionRef.current = null
      const text = voiceChunksRef.current.join(" ").replace(/\s+/g, " ").trim()
      voiceChunksRef.current = []
      if (!text) {
        toast({
          title: "Nada ouvido",
          description: "Segure o botão, fale com calma e solte ao terminar.",
        })
        return
      }
      abrirConfirmacaoVoz(text)
    }
    voiceRecognitionRef.current = recognition
    setIsHoldingVoice(true)
    try {
      recognition.start()
    } catch (err) {
      console.error("[OmniGestão Voice] OrdensServico recognition.start()", err)
      voiceRecognitionRef.current = null
      setIsHoldingVoice(false)
      toast({
        title: "Microfone",
        description: "Não foi possível iniciar a captura. Solte o botão e tente novamente.",
        variant: "destructive",
      })
    }
  }

  const handleConfirmarOsVoz = () => {
    const nome = useVoiceNome ? voiceConfirmNome.trim() : ""
    const apTexto = useVoiceAparelho ? voiceConfirmAparelho.trim() : ""
    const defeito = useVoiceDefeito ? voiceConfirmDefeito.trim() : ""
    let valorNum = 0
    if (useVoiceValor && voiceConfirmValorStr.trim()) {
      const v = parseFloat(voiceConfirmValorStr.replace(",", "."))
      valorNum = Number.isFinite(v) ? v : 0
    }

    if (!nome) {
      toast({ title: "Nome obrigatório", description: "Marque e preencha o nome do cliente.", variant: "destructive" })
      return
    }
    if (!defeito && !apTexto) {
      toast({
        title: "Defeito ou aparelho",
        description: "Informe ao menos o defeito ou o aparelho.",
        variant: "destructive",
      })
      return
    }

    const { marca, modelo } = resolveAparelhoParaOS(apTexto)
    const base = criarFormularioOSVazio()
    const newOS: OrdemServico = {
      id: Date.now().toString(),
      numero: getNextNumeroOS(ordens),
      ...base,
      cliente: { nome, telefone: "", cpf: "" },
      aparelho: {
        marca: marca || "",
        modelo: modelo || apTexto || "",
        imei: "",
        cor: "",
      },
      defeito: defeito || "Não informado",
      valorServico: valorNum,
      valorPecas: 0,
    }

    setOrdens((prev) => [...prev, newOS])
    incrementOsAbertasDia()
    appendAuditLog({
      action: "os_created",
      userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
      detail: `OS ${newOS.numero} (voz) — ${nome}`,
    })
    toast({
      title: "O.S. gerada",
      description: `${newOS.numero} registrada com os dados confirmados.`,
    })
    setVoiceConfirmOpen(false)
  }

  useEffect(() => {
    if (!voiceNewOs?.key) return
    setEditingOS(null)
    const base = criarFormularioOSVazio()
    if (voiceNewOs.clienteNome?.trim()) {
      base.cliente = { ...base.cliente, nome: voiceNewOs.clienteNome.trim() }
    }
    setFormData(base)
    setPhotoPreview([])
    setActiveTab("cliente")
    setIsModalOpen(true)
    onVoiceNewOsConsumed?.()
  }, [voiceNewOs?.key, voiceNewOs, onVoiceNewOsConsumed])

  return (
    <div className="space-y-6">
      {/* Header com acoes */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 h-12 px-6 text-base font-semibold text-primary-foreground"
            onClick={() => handleOpenModal()}
          >
            <Plus className="w-5 h-5 mr-2" />
            Nova OS
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className={`h-12 px-4 border-primary/40 touch-none select-none ${
              isHoldingVoice ? "ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse" : ""
            }`}
            title="Segure, fale os dados da OS e solte para confirmar"
            onPointerDown={(e) => {
              e.preventDefault()
              if (e.button !== 0 && e.pointerType === "mouse") return
              iniciarCapturaVoz()
            }}
            onPointerUp={encerrarCapturaVoz}
            onPointerLeave={encerrarCapturaVoz}
            onPointerCancel={encerrarCapturaVoz}
          >
            <Mic className={`w-5 h-5 mr-2 ${isHoldingVoice ? "text-primary" : ""}`} />
            {isHoldingVoice ? "Solte ao terminar…" : "Segurar para Falar"}
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/70" />
            <Input
              placeholder="Buscar OS, cliente ou IMEI..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-12 bg-secondary border-border"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48 h-12 bg-secondary border-border">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              <SelectItem value="aguardando_peca">Aguardando Peça</SelectItem>
              <SelectItem value="em_reparo">Em Reparo</SelectItem>
              <SelectItem value="pronto">Pronto</SelectItem>
              <SelectItem value="finalizado">Finalizado</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cards de estatisticas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ClipboardList className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{stats.total}</p>
                <p className="text-sm text-black/70">Total de OS</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Timer className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{stats.aguardandoPeca}</p>
                <p className="text-sm text-black/70">Aguard. Peça</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wrench className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{stats.emReparo}</p>
                <p className="text-sm text-black/70">Em Reparo</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-border ${stats.prontas > 0 ? "bg-primary/5 border-primary/30" : "bg-card"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stats.prontas > 0 ? "bg-primary/15" : "bg-muted"}`}>
                <Bell className={`w-5 h-5 ${stats.prontas > 0 ? "text-primary" : "text-black/70"}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${stats.prontas > 0 ? "text-primary" : "text-foreground"}`}>
                  {stats.prontas}
                </p>
                <p className="text-sm text-black/70">Prontas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de OS */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Ordens de Serviço ({filteredOrdens.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>OS</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Aparelho</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Entrada</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrdens.map((os) => (
                  <TableRow key={os.id} className="border-border">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(os.status)}
                        <span className="font-mono font-semibold text-black">{os.numero}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-black">{asText(os?.cliente?.nome)}</p>
                        <p className="text-xs text-black/70">{asText(os?.cliente?.telefone)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-black/70" />
                        <span className="text-black">{asText(os?.aparelho?.marca)} {asText(os?.aparelho?.modelo)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(os.status)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-black/70">
                      <span className="block">{formatDate(os.dataEntrada)}</span>
                      {os.horaEntrada && (
                        <span className="text-xs">{os.horaEntrada}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-black">
                      {formatCurrency(os.valorServico + os.valorPecas)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleViewOS(os)}
                          title="Visualizar"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleOpenModal(os)}
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handlePrintOS(os, "termica")}
                          title="Imprimir"
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        {os.status === "pronto" && (
                          <Button 
                            variant="ghost" 
                            size="icon"
                            className="text-primary hover:text-primary"
                            onClick={() => handleGerarVenda(os)}
                            title="Gerar Venda"
                          >
                            <DollarSign className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={voiceConfirmOpen} onOpenChange={setVoiceConfirmOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>Confirmar OS por voz</DialogTitle>
            <DialogDescription>
              Os campos abaixo foram extraídos da fala (cliente após &quot;para&quot;/&quot;cliente&quot;, defeito,
              valor, aparelho). Ajuste e marque o que entra na OS.
            </DialogDescription>
          </DialogHeader>
          {voiceTranscriptPreview ? (
            <p className="text-xs text-black/70 rounded-md border border-border bg-muted/40 p-2 font-mono leading-relaxed">
              {voiceTranscriptPreview}
            </p>
          ) : null}
          {voiceConfirmNome.trim() &&
          !clienteJaExisteNasOrdens(ordens, voiceConfirmNome.trim()) ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-sm space-y-2">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Cliente novo — não encontrado nas ordens atuais
              </p>
              <p className="text-black/70">
                A OS será criada com este nome. Cadastre o cliente em Clientes para histórico e contato
                completos.
              </p>
              {onAbrirCadastroCliente ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-amber-600/40"
                  onClick={() => onAbrirCadastroCliente(voiceConfirmNome.trim())}
                >
                  Abrir cadastro de clientes
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                id="voz-nome"
                checked={useVoiceNome}
                onCheckedChange={(c) => setUseVoiceNome(c === true)}
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="voz-nome-input" className="text-sm font-semibold">
                  Nome
                </Label>
                <Input
                  id="voz-nome-input"
                  value={voiceConfirmNome}
                  onChange={(e) => setVoiceConfirmNome(e.target.value)}
                  placeholder="Cliente"
                  className="h-10 bg-secondary"
                />
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                id="voz-ap"
                checked={useVoiceAparelho}
                onCheckedChange={(c) => setUseVoiceAparelho(c === true)}
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="voz-ap-input" className="text-sm font-semibold">
                  Aparelho
                </Label>
                <Input
                  id="voz-ap-input"
                  value={voiceConfirmAparelho}
                  onChange={(e) => setVoiceConfirmAparelho(e.target.value)}
                  placeholder="Ex.: iPhone 13"
                  className="h-10 bg-secondary"
                />
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                id="voz-def"
                checked={useVoiceDefeito}
                onCheckedChange={(c) => setUseVoiceDefeito(c === true)}
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="voz-def-input" className="text-sm font-semibold">
                  Defeito
                </Label>
                <Textarea
                  id="voz-def-input"
                  value={voiceConfirmDefeito}
                  onChange={(e) => setVoiceConfirmDefeito(e.target.value)}
                  placeholder="Descreva o problema"
                  rows={3}
                  className="resize-y bg-secondary text-sm min-h-[72px]"
                />
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Checkbox
                id="voz-val"
                checked={useVoiceValor}
                onCheckedChange={(c) => setUseVoiceValor(c === true)}
              />
              <div className="flex-1 space-y-1">
                <Label htmlFor="voz-val-input" className="text-sm font-semibold">
                  Valor (R$)
                </Label>
                <Input
                  id="voz-val-input"
                  inputMode="decimal"
                  value={voiceConfirmValorStr}
                  onChange={(e) => setVoiceConfirmValorStr(e.target.value)}
                  placeholder="0,00"
                  className="h-10 bg-secondary"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setVoiceConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirmarOsVoz}>
              Confirmar e Gerar OS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Cadastro/Edicao de OS */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" />
              {editingOS ? `Editar ${editingOS.numero}` : "Nova Ordem de Serviço"}
            </DialogTitle>
          </DialogHeader>

          {/* Garantia visível em qualquer aba (Telas / Baterias / Conectores) */}
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <Label className="text-base font-semibold text-foreground">Tipo de garantia</Label>
            </div>
            <Select
              value={formData.termoGarantia}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, termoGarantia: value }))}
            >
              <SelectTrigger className="h-12 w-full bg-card border-primary/30">
                <SelectValue placeholder="Selecione: Telas, Baterias ou Conectores" />
              </SelectTrigger>
              <SelectContent>
                {garantiasParaSeletorOS.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.servico}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.termoGarantia && (
              <p className="text-xs text-black/70 leading-relaxed line-clamp-3">
                {getGarantiaById(formData.termoGarantia)?.detalhes}
              </p>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList
              className={cn(
                "grid w-full mb-4",
                mostraTecnicoLaudoOs ? "grid-cols-4" : "grid-cols-3"
              )}
            >
              <TabsTrigger value="cliente">Cliente</TabsTrigger>
              <TabsTrigger value="aparelho">Aparelho</TabsTrigger>
              {mostraTecnicoLaudoOs && <TabsTrigger value="laudo">Laudo</TabsTrigger>}
              <TabsTrigger value="valores">Valores</TabsTrigger>
            </TabsList>

            {/* Aba Cliente */}
            <TabsContent value="cliente" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label>Nome do Cliente *</Label>
                  <Input
                    value={formData.cliente.nome}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      cliente: { ...prev.cliente, nome: e.target.value }
                    }))}
                    placeholder="Nome completo"
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Telefone / WhatsApp *</Label>
                  <Input
                    value={formData.cliente.telefone}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      cliente: { ...prev.cliente, telefone: e.target.value }
                    }))}
                    placeholder="(11) 99999-0000"
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CPF</Label>
                  <Input
                    value={formData.cliente.cpf}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      cliente: { ...prev.cliente, cpf: e.target.value }
                    }))}
                    placeholder="000.000.000-00"
                    className="h-12 bg-secondary border-border"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Aba Aparelho */}
            <TabsContent value="aparelho" className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Marca *</Label>
                  <Select 
                    value={formData.aparelho.marca}
                    onValueChange={(value) => setFormData(prev => ({
                      ...prev,
                      aparelho: { ...prev.aparelho, marca: value }
                    }))}
                  >
                    <SelectTrigger className="h-12 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
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
                    value={formData.aparelho.modelo}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      aparelho: { ...prev.aparelho, modelo: e.target.value }
                    }))}
                    placeholder="Ex: iPhone 13"
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>IMEI</Label>
                  <Input
                    value={formData.aparelho.imei}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      aparelho: { ...prev.aparelho, imei: e.target.value }
                    }))}
                    placeholder="15 dígitos"
                    maxLength={15}
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cor</Label>
                  <Input
                    value={formData.aparelho.cor}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      aparelho: { ...prev.aparelho, cor: e.target.value }
                    }))}
                    placeholder="Ex: Preto"
                    className="h-12 bg-secondary border-border"
                  />
                </div>
              </div>

              <Separator />

              {/* Checklist de Entrada */}
              <div className="space-y-3">
                <h3 className="font-semibold text-foreground">Checklist de Entrada</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {formData.checklist.map((item) => (
                    <div 
                      key={item.id}
                      className={`flex items-center gap-2 p-3 rounded-lg border transition-colors cursor-pointer ${
                        item.checked 
                          ? "bg-primary/10 border-primary/30" 
                          : "bg-secondary border-border hover:border-primary/30"
                      }`}
                      onClick={() => handleChecklistChange(item.id, !item.checked)}
                    >
                      <Checkbox 
                        checked={item.checked}
                        onCheckedChange={(checked) => handleChecklistChange(item.id, checked === true)}
                      />
                      <span className="text-sm">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Aba Laudo (somente Assistência Técnica) */}
            {mostraTecnicoLaudoOs && (
            <TabsContent value="laudo" className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Defeito Relatado / Observação do Técnico *</Label>
                  <Textarea
                    value={formData.defeito}
                    onChange={(e) => setFormData(prev => ({ ...prev, defeito: e.target.value }))}
                    placeholder="Descreva o defeito informado pelo cliente e suas observações..."
                    className="min-h-24 bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Solução Aplicada</Label>
                  <Textarea
                    value={formData.solucao}
                    onChange={(e) => setFormData(prev => ({ ...prev, solucao: e.target.value }))}
                    placeholder="Descreva o que foi feito para resolver o problema..."
                    className="min-h-24 bg-secondary border-border"
                  />
                </div>

                <Separator />

                {/* Upload de Fotos do Laudo */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Fotos do Aparelho (Laudo de Entrada)</Label>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-primary/40 hover:bg-primary/10 hover:text-primary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-4 h-4 mr-2" /> Galeria
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-primary/40 hover:bg-primary/10 hover:text-primary"
                        onClick={() => cameraInputRef.current?.click()}
                      >
                        <Camera className="w-4 h-4 mr-2" /> Câmera
                      </Button>
                    </div>
                  </div>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />

                  {photoPreview.length > 0 ? (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                      {photoPreview.map((photo, index) => (
                        <div key={index} className="relative group">
                          <img 
                            src={photo} 
                            alt={`Foto ${index + 1}`}
                            className="w-full h-24 object-cover rounded-lg"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removePhoto(index)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div 
                      className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="w-10 h-10 text-black/70 mx-auto mb-2" />
                      <p className="text-sm text-black/70">
                        Clique ou arraste fotos do aparelho para anexar ao laudo
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Observações Internas</Label>
                  <Textarea
                    value={formData.observacoes}
                    onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                    placeholder="Notas internas (não aparece no comprovante do cliente)..."
                    className="min-h-20 bg-secondary border-border"
                  />
                </div>
              </div>
            </TabsContent>
            )}

            {/* Aba Valores */}
            <TabsContent value="valores" className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status da OS</Label>
                  <Select 
                    value={formData.status}
                    onValueChange={(value: OrdemServico["status"]) =>
                      setFormData((prev) => {
                        const next = { ...prev, status: value }
                        if (
                          (value === "pronto" || value === "finalizado") &&
                          (!prev.dataSaida || !prev.horaSaida)
                        ) {
                          const d = new Date()
                          return {
                            ...next,
                            dataSaida: d.toISOString().split("T")[0],
                            horaSaida: horaAtualHHMM(),
                          }
                        }
                        return next
                      })
                    }
                  >
                    <SelectTrigger className="h-12 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="aguardando_peca">Aguardando Peça</SelectItem>
                      <SelectItem value="em_reparo">Em Reparo</SelectItem>
                      <SelectItem value="pronto">Pronto - Avisar Cliente</SelectItem>
                      <SelectItem value="finalizado">Finalizado</SelectItem>
                      <SelectItem value="pago">Pago</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Previsão de Entrega</Label>
                  <Input
                    type="date"
                    value={formData.dataPrevisao}
                    onChange={(e) => setFormData(prev => ({ ...prev, dataPrevisao: e.target.value }))}
                    className="h-12 bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Data de Entrada
                  </Label>
                  <Input
                    type="date"
                    value={formData.dataEntrada}
                    onChange={(e) => setFormData((prev) => ({ ...prev, dataEntrada: e.target.value }))}
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Hora de Entrada
                  </Label>
                  <Input
                    type="time"
                    value={formData.horaEntrada}
                    onChange={(e) => setFormData((prev) => ({ ...prev, horaEntrada: e.target.value }))}
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Data de Saída
                  </Label>
                  <Input
                    type="date"
                    value={formData.dataSaida ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        dataSaida: e.target.value || null,
                      }))
                    }
                    className="h-12 bg-secondary border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Hora de Saída
                  </Label>
                  <Input
                    type="time"
                    value={formData.horaSaida ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        horaSaida: e.target.value || null,
                      }))
                    }
                    className="h-12 bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Valor do Serviço (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valorServico || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, valorServico: parseFloat(e.target.value) || 0 }))}
                    placeholder="0,00"
                    className="h-12 bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Valor das Peças (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.valorPecas || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, valorPecas: parseFloat(e.target.value) || 0 }))}
                    placeholder="0,00"
                    className="h-12 bg-secondary border-border"
                  />
                </div>

                <div className="sm:col-span-2">
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-semibold text-foreground">Total da OS:</span>
                      <span className="text-2xl font-bold text-primary">
                        {formatCurrency(totalOS)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="sm:col-span-2 p-4 rounded-lg border border-border bg-secondary/30 space-y-3">
                  <p className="font-medium">Parcelamento via Carnê</p>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={parcelasCarne}
                      onChange={(e) => setParcelasCarne(e.target.value)}
                      className="w-24 bg-card border-border"
                    />
                    <span className="text-sm text-black/70">parcelas mensais</span>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                      onClick={handleGerarBoletoCarneOS}
                    >
                      Gerar Boleto/Carnê
                    </Button>
                  </div>
                  <div className="text-xs text-black/70 space-y-1">
                    {gerarParcelasCarne(totalOS, Math.max(1, parseInt(parcelasCarne || "1", 10))).map((p) => (
                      <p key={p.numero}>{p.numero}/{parcelasCarne} - {formatCurrency(p.valor)} - vence em {p.vencimento}</p>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Separator className="my-4" />

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              className="border-primary/40 hover:bg-primary/10"
              onClick={() => setIsModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.cliente.nome || !formData.aparelho.marca || !formData.aparelho.modelo}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {editingOS ? "Salvar Alterações" : "Criar OS"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Visualização de OS */}
      <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border">
          {viewingOS && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <ClipboardList className="w-6 h-6 text-primary" />
                  {viewingOS.numero}
                </DialogTitle>
              </DialogHeader>

              {logoEmpresa && (
                <div className="flex justify-center">
                  <img
                    src={logoEmpresa}
                    alt={`Logo ${nomeEmpresaRodape}`}
                    className="h-14 w-auto object-contain rounded border border-border bg-card p-1"
                  />
                </div>
              )}

              <div className="space-y-6 py-4">
                {/* Status Timeline */}
                <div className="flex items-center justify-between p-4 rounded-lg bg-secondary overflow-x-auto gap-1">
                  {(["aguardando_peca", "em_reparo", "pronto", "finalizado", "pago"] as const).map((status, index, arr) => {
                    const steps = arr
                    const idxCurrent = steps.indexOf(viewingOS.status as (typeof steps)[number])
                    const stepIndex = steps.indexOf(status)
                    const done = idxCurrent > stepIndex
                    const current = viewingOS.status === status
                    return (
                    <div key={status} className="flex items-center shrink-0">
                      <div className={`flex flex-col items-center ${
                        current ? "text-primary" : done ? "text-primary" : "text-black/70"
                      }`}>
                        {done ? (
                          <CheckCircle2 className="w-6 h-6" />
                        ) : current ? (
                          <div className="w-6 h-6 rounded-full border-2 border-current flex items-center justify-center">
                            <div className="w-3 h-3 rounded-full bg-current" />
                          </div>
                        ) : (
                          <Circle className="w-6 h-6" />
                        )}
                        <span className="text-xs mt-1 hidden sm:block max-w-[4.5rem] text-center">
                          {status === "aguardando_peca" ? "Aguard." :
                           status === "em_reparo" ? "Reparo" :
                           status === "pronto" ? "Pronto" :
                           status === "finalizado" ? "Final" : "Pago"}
                        </span>
                      </div>
                      {index < arr.length - 1 && (
                        <div className={`w-6 sm:w-10 h-0.5 mx-0.5 ${done ? "bg-primary" : "bg-border"}`} />
                      )}
                    </div>
                  )})}
                </div>

                {/* Info do Cliente */}
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                      <User className="w-4 h-4" /> Cliente
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-black/70">Nome:</span>
                        <p className="font-medium text-black">{viewingOS.cliente.nome}</p>
                      </div>
                      <div>
                        <span className="text-black/70">Telefone:</span>
                        <p className="font-medium text-black">{viewingOS.cliente.telefone}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Info do Aparelho */}
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                      <Smartphone className="w-4 h-4" /> Aparelho
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-black/70">Marca/Modelo:</span>
                        <p className="font-medium text-black">{viewingOS.aparelho.marca} {viewingOS.aparelho.modelo}</p>
                      </div>
                      <div>
                        <span className="text-black/70">IMEI:</span>
                        <p className="font-mono text-black">{viewingOS.aparelho.imei || "-"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-secondary border-border">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Entrada e saída
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-black/70">Entrada:</span>
                        <p className="font-medium text-black">
                          {formatDate(viewingOS.dataEntrada)}
                          {viewingOS.horaEntrada ? ` · ${viewingOS.horaEntrada}` : ""}
                        </p>
                      </div>
                      <div>
                        <span className="text-black/70">Saída:</span>
                        <p className="font-medium text-black">
                          {viewingOS.dataSaida && viewingOS.horaSaida
                            ? `${formatDate(viewingOS.dataSaida)} · ${viewingOS.horaSaida}`
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Laudo */}
                {mostraTecnicoLaudoOs && (
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-black mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Laudo Técnico
                    </h3>
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="text-black/70">Defeito:</span>
                        <p className="font-medium text-black">{viewingOS.defeito}</p>
                      </div>
                      {viewingOS.solucao && (
                        <div>
                          <span className="text-black/70">Solução:</span>
                          <p className="font-medium text-primary">{viewingOS.solucao}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                )}

                {/* Valores */}
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-sm text-black/70">Serviço</p>
                      <p className="text-lg font-semibold text-black">{formatCurrency(viewingOS.valorServico)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-black/70">Peças</p>
                      <p className="text-lg font-semibold text-black">{formatCurrency(viewingOS.valorPecas)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-black/70">Total</p>
                      <p className="text-xl font-bold text-primary">
                        {formatCurrency(viewingOS.valorServico + viewingOS.valorPecas)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Acoes */}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-primary/40 hover:bg-primary/10"
                  onClick={() => handleEnviarOSWhatsApp(viewingOS)}
                >
                  <MessageCircle className="w-4 h-4 mr-2" /> Enviar WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="border-primary/40 hover:bg-primary/10"
                  onClick={() => handlePrintOS(viewingOS, "termica")}
                >
                  <Printer className="w-4 h-4 mr-2" /> Térmica 80mm
                </Button>
                <Button
                  variant="outline"
                  className="border-primary/40 hover:bg-primary/10"
                  onClick={() => handlePrintOS(viewingOS, "a4")}
                >
                  <FileText className="w-4 h-4 mr-2" /> Imprimir A4
                </Button>
                {viewingOS.status === "pronto" && (
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => handleGerarVenda(viewingOS)}>
                    <DollarSign className="w-4 h-4 mr-2" /> Gerar Venda
                  </Button>
                )}
              </div>

              {/* Termo de Garantia */}
              {viewingOS.termoGarantia && (
                <Card className="bg-secondary border-border">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" /> Termo de Garantia
                    </h3>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="font-semibold text-primary">
                          {getGarantiaById(viewingOS.termoGarantia)?.servico}
                        </p>
                        <p className="text-black/70 mt-1 leading-relaxed">
                          {getGarantiaById(viewingOS.termoGarantia)?.detalhes}
                        </p>
                      </div>
                      <Separator />
                      <p className="text-xs text-black/70 italic">
                        {termosGarantia.garantiaLegal}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Campo de Assinatura (para impressao) */}
              <Card className="bg-secondary border-border print:block">
                <CardContent className="p-4">
                  <h3 className="font-semibold text-foreground mb-4 text-center">
                    Declaracao de Ciencia e Aceite
                  </h3>
                  <p className="text-xs text-black/70 text-center mb-6">
                    Declaro que estou ciente das condicoes de garantia acima e concordo com os termos de servico.
                  </p>
                  <div className="grid grid-cols-2 gap-8 mt-6">
                    <div className="text-center">
                      <div className="border-t border-foreground pt-2">
                        <p className="text-xs text-black/70">Assinatura do Cliente</p>
                        <p className="text-sm font-medium mt-1">{viewingOS.cliente.nome}</p>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="border-t border-foreground pt-2">
                        <p className="text-xs text-black/70">Assinatura do Tecnico</p>
                        <p className="text-sm font-medium mt-1">{nomeEmpresaRodape}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-center text-black/70 mt-4">
                    Entrada: {formatDate(viewingOS.dataEntrada)}
                    {viewingOS.horaEntrada ? ` às ${viewingOS.horaEntrada}` : ""}
                    {viewingOS.dataSaida && viewingOS.horaSaida
                      ? ` · Saída: ${formatDate(viewingOS.dataSaida)} às ${viewingOS.horaSaida}`
                      : ""}
                  </p>
                </CardContent>
              </Card>

              {/* Rodape com dados da empresa */}
              <div className="mt-6 pt-4 border-t border-border text-center text-xs text-black/70">
                <p className="font-semibold text-black">{nomeEmpresaRodape}</p>
                <p>{getEnderecoDocumentos()}</p>
                <p>
                  CNPJ: {cnpjRodape} | WhatsApp: {whatsappRodape}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
