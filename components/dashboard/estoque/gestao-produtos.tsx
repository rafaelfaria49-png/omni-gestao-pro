"use client"

import { useState, useRef, useEffect } from "react"
import { 
  Plus, 
  Search, 
  Package, 
  Wrench, 
  Headphones,
  Upload,
  Image as ImageIcon,
  Edit,
  Trash2,
  AlertTriangle,
  FileSpreadsheet,
  X,
  Barcode,
  Camera,
  Loader2,
  Mic,
  Smartphone,
  Shield,
  Wallet
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { mergeCadastroRelampago } from "@/lib/merge-cadastro-relampago"
import type { VisionProductResult } from "@/lib/vision-product-openai"
import type { ProductVoiceMetadata } from "@/lib/product-voice-metadata-openai"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { appendAuditLog } from "@/lib/audit-log"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface Product {
  id: string
  nome: string
  codigo: string
  categoria: "peca" | "acessorio" | "servico"
  precoCusto: number
  precoVenda: number
  estoqueAtual: number
  estoqueMinimo: number
  imagem?: string
  // Novos campos fiscais
  ncm?: string
  cest?: string
  origemMercadoria?: string
  cfop?: string
  // Campos para celulares
  imei?: string
  numeroSerie?: string
  possuiGarantia?: boolean
  diasGarantia?: number
  /** Texto de vitrine / anúncio (ex.: preenchido pela IA Vision). */
  descricaoVenda?: string
}

type NFeItem = {
  id: string
  nome: string
  codigo: string
  ncm: string
  cfop: string
  quantidade: number
  valorUnitario: number
}

const mockProducts: Product[] = [
  {
    id: "1",
    nome: "Tela iPhone 13",
    codigo: "7891234567890",
    categoria: "peca",
    precoCusto: 180.00,
    precoVenda: 350.00,
    estoqueAtual: 8,
    estoqueMinimo: 5,
    ncm: "85177090",
    cfop: "5102",
    origemMercadoria: "1",
  },
  {
    id: "2",
    nome: "Tela iPhone 12",
    codigo: "7891234567891",
    categoria: "peca",
    precoCusto: 150.00,
    precoVenda: 280.00,
    estoqueAtual: 3,
    estoqueMinimo: 5,
    ncm: "85177090",
    cfop: "5102",
  },
  {
    id: "3",
    nome: "Bateria iPhone 11",
    codigo: "7891234567892",
    categoria: "peca",
    precoCusto: 45.00,
    precoVenda: 120.00,
    estoqueAtual: 15,
    estoqueMinimo: 10,
    ncm: "85076000",
    cfop: "5102",
  },
  {
    id: "4",
    nome: "Película de Vidro Universal",
    codigo: "7891234567893",
    categoria: "acessorio",
    precoCusto: 5.00,
    precoVenda: 25.00,
    estoqueAtual: 50,
    estoqueMinimo: 20,
    ncm: "70072900",
    cfop: "5102",
  },
  {
    id: "5",
    nome: "Capinha Silicone iPhone 14",
    codigo: "7891234567894",
    categoria: "acessorio",
    precoCusto: 12.00,
    precoVenda: 45.00,
    estoqueAtual: 2,
    estoqueMinimo: 10,
    ncm: "39269090",
    cfop: "5102",
  },
  {
    id: "6",
    nome: "Troca de Tela",
    codigo: "SERV001",
    categoria: "servico",
    precoCusto: 0,
    precoVenda: 80.00,
    estoqueAtual: 999,
    estoqueMinimo: 0,
  },
  {
    id: "7",
    nome: "iPhone 12 Pro Max 128GB",
    codigo: "7891234567897",
    categoria: "peca",
    precoCusto: 2800.00,
    precoVenda: 3500.00,
    estoqueAtual: 2,
    estoqueMinimo: 1,
    ncm: "85171231",
    cfop: "5102",
    imei: "354678091234567",
    possuiGarantia: true,
    diasGarantia: 90,
  },
]

const emptyProduct: Omit<Product, "id"> = {
  nome: "",
  codigo: "",
  categoria: "peca",
  precoCusto: 0,
  precoVenda: 0,
  estoqueAtual: 0,
  estoqueMinimo: 5,
  ncm: "",
  cest: "",
  origemMercadoria: "0",
  cfop: "5102",
  imei: "",
  numeroSerie: "",
  possuiGarantia: false,
  diasGarantia: 90,
  descricaoVenda: "",
}

const origensOptions = [
  { value: "0", label: "0 - Nacional" },
  { value: "1", label: "1 - Estrangeira (Importação Direta)" },
  { value: "2", label: "2 - Estrangeira (Mercado Interno)" },
  { value: "3", label: "3 - Nacional (Conteúdo Importação > 40%)" },
  { value: "4", label: "4 - Nacional (Processos Produtivos)" },
  { value: "5", label: "5 - Nacional (Conteúdo Importação <= 40%)" },
  { value: "6", label: "6 - Estrangeira (Importação Direta, sem similar)" },
  { value: "7", label: "7 - Estrangeira (Mercado Interno, sem similar)" },
  { value: "8", label: "8 - Nacional (Conteúdo Importação > 70%)" },
]

export type VoiceStockHint = {
  key: number
  searchQuery?: string
  openNovo?: boolean
  openImport?: boolean
}

interface GestaoProdutosProps {
  voiceStockHint?: VoiceStockHint | null
  onVoiceStockHintConsumed?: () => void
}

export function GestaoProdutos({
  voiceStockHint = null,
  onVoiceStockHintConsumed,
}: GestaoProdutosProps) {
  const { toast } = useToast()
  const { config } = useConfigEmpresa()
  const auditUser = () =>
    `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`
  const [products, setProducts] = useState<Product[]>(mockProducts)
  const [searchTerm, setSearchTerm] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [formData, setFormData] = useState<Omit<Product, "id">>(emptyProduct)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<string>("")
  const [chaveAcesso, setChaveAcesso] = useState("")
  const [nfeItens, setNfeItens] = useState<NFeItem[]>([])
  const [dePara, setDePara] = useState<Record<string, { modo: "existente" | "novo"; existingId?: string }>>({})
  const [activeTab, setActiveTab] = useState("geral")
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [iaSyncLoading, setIaSyncLoading] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [relampagoImageDataUrl, setRelampagoImageDataUrl] = useState<string | null>(null)
  const [relampagoAudioBlob, setRelampagoAudioBlob] = useState<Blob | null>(null)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const visionScanInputRef = useRef<HTMLInputElement>(null)
  const relampagoAudioInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!iaSyncLoading) {
      setSyncProgress(0)
      return
    }
    const id = window.setInterval(() => {
      setSyncProgress((p) => (p >= 88 ? 12 : p + 11))
    }, 220)
    return () => window.clearInterval(id)
  }, [iaSyncLoading])

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (product.imei && product.imei.includes(searchTerm))
    const matchesCategory = categoryFilter === "all" || product.categoria === categoryFilter
    return matchesSearch && matchesCategory
  })

  const lowStockCount = products.filter(p => p.categoria !== "servico" && p.estoqueAtual <= p.estoqueMinimo).length

  const stats = {
    totalProdutos: products.filter(p => p.categoria !== "servico").length,
    totalServicos: products.filter(p => p.categoria === "servico").length,
    valorEstoque: products.reduce((acc, p) => acc + (p.precoCusto * p.estoqueAtual), 0),
  }

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product)
      setFormData({
        nome: product.nome,
        codigo: product.codigo,
        categoria: product.categoria,
        precoCusto: product.precoCusto,
        precoVenda: product.precoVenda,
        estoqueAtual: product.estoqueAtual,
        estoqueMinimo: product.estoqueMinimo,
        imagem: product.imagem,
        ncm: product.ncm || "",
        cest: product.cest || "",
        origemMercadoria: product.origemMercadoria || "0",
        cfop: product.cfop || "5102",
        imei: product.imei || "",
        numeroSerie: product.numeroSerie || "",
        possuiGarantia: product.possuiGarantia || false,
        diasGarantia: product.diasGarantia || 90,
        descricaoVenda: product.descricaoVenda || "",
      })
      setPreviewImage(product.imagem || null)
    } else {
      setEditingProduct(null)
      setFormData(emptyProduct)
      setPreviewImage(null)
    }
    setActiveTab("geral")
    setIaSyncLoading(false)
    setRelampagoImageDataUrl(null)
    setRelampagoAudioBlob(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  useEffect(() => {
    if (!voiceStockHint?.key) return
    if (voiceStockHint.searchQuery != null && voiceStockHint.searchQuery !== "") {
      setSearchTerm(voiceStockHint.searchQuery)
    }
    if (voiceStockHint.openNovo) {
      setEditingProduct(null)
      setFormData(emptyProduct)
      setPreviewImage(null)
      setRelampagoImageDataUrl(null)
      setRelampagoAudioBlob(null)
      setIaSyncLoading(false)
      setActiveTab("geral")
      setIsModalOpen(true)
    }
    if (voiceStockHint.openImport) {
      setIsImportModalOpen(true)
    }
    onVoiceStockHintConsumed?.()
  }, [voiceStockHint, onVoiceStockHintConsumed])

  const handleSave = () => {
    if (editingProduct) {
      appendAuditLog({
        action: "stock_manual",
        userLabel: auditUser(),
        detail: `${formData.nome}: estoque ${editingProduct.estoqueAtual} → ${formData.estoqueAtual}`,
      })
      setProducts(prev => prev.map(p => 
        p.id === editingProduct.id 
          ? { ...p, ...formData, imagem: previewImage || undefined }
          : p
      ))
    } else {
      const newProduct: Product = {
        id: Date.now().toString(),
        ...formData,
        imagem: previewImage || undefined,
      }
      appendAuditLog({
        action: "stock_manual",
        userLabel: auditUser(),
        detail: `Cadastro "${formData.nome}", estoque inicial ${formData.estoqueAtual}`,
      })
      setProducts(prev => [...prev, newProduct])
    }
    toast({
      title: editingProduct ? "Item atualizado" : "Item cadastrado",
      description: "Cadastro de estoque salvo com sucesso.",
    })
    handleCloseModal()
  }

  const confirmDeleteProduct = () => {
    if (!pendingDeleteId) return
    const product = products.find((p) => p.id === pendingDeleteId)
    if (product) {
      appendAuditLog({
        action: "registro_excluido",
        userLabel: auditUser(),
        detail: `Estoque: exclusão do item "${product.nome}" (estoque era ${product.estoqueAtual})`,
      })
    }
    setProducts((prev) => prev.filter((p) => p.id !== pendingDeleteId))
    toast({ title: "Item removido do estoque" })
    setPendingDeleteId(null)
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("Leitura do áudio falhou"))
      reader.readAsDataURL(blob)
    })

  const handleVisionScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !file.type.startsWith("image/")) {
      toast({
        title: "Imagem inválida",
        description: "Selecione um arquivo de imagem (JPG, PNG, etc.).",
        variant: "destructive",
      })
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("Leitura do arquivo falhou"))
      reader.readAsDataURL(file)
    })

    setPreviewImage(dataUrl)
    setRelampagoImageDataUrl(dataUrl)
    setRelampagoAudioBlob(null)
    toast({
      title: "Foto do cadastro relâmpago",
      description:
        "Opcional: grave áudio com custo, venda e estoque. Depois toque em Sincronizar dados do produto.",
    })
  }

  const startRelampagoRecording = async () => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "Áudio indisponível",
        description: "Use o botão para enviar arquivo de áudio ou outro navegador.",
        variant: "destructive",
      })
      return
    }
    if (typeof window !== "undefined") {
      console.info("[OmniGestão Voice] getUserMedia ambiente", {
        isSecureContext: window.isSecureContext,
        hostname: window.location.hostname,
      })
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : ""
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      mr.ondataavailable = (ev) => {
        if (ev.data.size) audioChunksRef.current.push(ev.data)
      }
      mr.onstop = () => {
        setRelampagoAudioBlob(
          new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" })
        )
        stream.getTracks().forEach((t) => t.stop())
      }
      mr.start(250)
      mediaRecorderRef.current = mr
      setIsRecordingAudio(true)
    } catch (err) {
      console.error("[OmniGestão Voice] gestao-produtos getUserMedia", err)
      setIsRecordingAudio(false)
      mediaRecorderRef.current = null
      const name = err instanceof DOMException ? err.name : "Erro"
      const msg = err instanceof Error ? err.message : String(err)
      toast({
        title: "Microfone",
        description:
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? "Permissão do microfone negada. Permita no ícone do cadeado e tente de novo."
            : `Não foi possível acessar o microfone (${name}: ${msg.slice(0, 120)})`,
        variant: "destructive",
      })
    }
  }

  const stopRelampagoRecording = () => {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== "inactive") mr.stop()
    mediaRecorderRef.current = null
    setIsRecordingAudio(false)
  }

  const handleRelampagoAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !file.type.startsWith("audio/")) {
      toast({
        title: "Áudio inválido",
        description: "Selecione um arquivo de áudio.",
        variant: "destructive",
      })
      return
    }
    setRelampagoAudioBlob(file)
  }

  const handleRelampagoSincronizar = async () => {
    if (!relampagoImageDataUrl) return
    setIaSyncLoading(true)
    try {
      const visionP = fetch("/api/vision/product-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: relampagoImageDataUrl }),
      }).then(async (res) => {
        const data = (await res.json()) as VisionProductResult & { error?: string }
        if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
        return data
      })

      const voiceP: Promise<ProductVoiceMetadata | null> = relampagoAudioBlob
        ? (async () => {
            const audioBase64 = await blobToDataUrl(relampagoAudioBlob)
            const res = await fetch("/api/product/voice-metadata", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audioBase64 }),
            })
            const data = (await res.json()) as ProductVoiceMetadata & { error?: string }
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            return {
              preco_custo: data.preco_custo ?? null,
              preco_venda: data.preco_venda ?? null,
              quantidade_estoque: data.quantidade_estoque ?? null,
            }
          })()
        : Promise.resolve(null)

      const [visionRaw, voiceMeta] = await Promise.all([visionP, voiceP])

      const cat = visionRaw.categoria as Product["categoria"] | undefined
      const categoriaOk =
        cat === "peca" || cat === "acessorio" || cat === "servico" ? cat : "peca"

      const vision: VisionProductResult = {
        nome: (visionRaw.nome ?? "").trim() || "Produto",
        categoria: categoriaOk,
        ncm: (visionRaw.ncm ?? "").replace(/\D/g, "").slice(0, 8),
        descricaoVenda: (visionRaw.descricaoVenda ?? "").trim(),
      }

      setFormData((prev) => ({
        ...prev,
        ...mergeCadastroRelampago(vision, voiceMeta, {
          nome: prev.nome,
          categoria: prev.categoria,
          ncm: prev.ncm || "",
          descricaoVenda: prev.descricaoVenda ?? "",
          precoCusto: prev.precoCusto,
          precoVenda: prev.precoVenda,
          estoqueAtual: prev.estoqueAtual,
        }),
      }))

      toast({
        title: "Cadastro relâmpago",
        description:
          "Dados da foto e do áudio unificados. Revise NCM e valores antes de salvar.",
      })
      setRelampagoImageDataUrl(null)
    } catch (err) {
      toast({
        title: "Falha ao sincronizar",
        description:
          err instanceof Error ? err.message : "Tente novamente ou preencha manualmente.",
        variant: "destructive",
      })
    } finally {
      setIaSyncLoading(false)
    }
  }

  const safeText = (root: Element, selectors: string[]): string => {
    for (const selector of selectors) {
      const el = root.querySelector(selector)
      const value = el?.textContent?.trim()
      if (value) return value
    }
    return ""
  }

  const parseNFeXmlProducts = (xmlText: string): NFeItem[] => {
    const xml = new DOMParser().parseFromString(xmlText, "application/xml")
    const detNodes = Array.from(xml.querySelectorAll("det"))
    return detNodes
      .map((det) => {
        const nome = safeText(det, ["prod > xProd", "xProd"])
        const codigo = safeText(det, ["prod > cProd", "cProd"]) || `XML-${Date.now()}`
        const ncm = safeText(det, ["prod > NCM", "NCM"])
        const cfop = safeText(det, ["prod > CFOP", "CFOP"]) || "5102"
        const valorUnitario = parseFloat(
          safeText(det, ["prod > vUnCom", "vUnCom"]).replace(",", ".")
        ) || 0
        const quantidade = parseFloat(
          safeText(det, ["prod > qCom", "qCom"]).replace(",", ".")
        ) || 0
        if (!nome) return null
        return {
          id: `${codigo}-${nome}`,
          nome,
          codigo,
          ncm,
          cfop,
          quantidade,
          valorUnitario,
        } satisfies NFeItem
      })
      .filter((p): p is NFeItem => p !== null)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith(".xml")) {
      setImportFeedback("Formato ainda não suportado nesta versão. Use XML da NF-e.")
      return
    }
    const xmlText = await file.text()
    const imported = parseNFeXmlProducts(xmlText)
    if (imported.length === 0) {
      setImportFeedback("Nenhum item de produto foi encontrado no XML informado.")
      return
    }
    setNfeItens(imported)
    setDePara(
      Object.fromEntries(
        imported.map((item) => [item.id, { modo: "novo" as const }])
      )
    )
    setImportFeedback(`${imported.length} item(ns) lido(s) do XML. Configure o De-Para e confirme a entrada.`)
  }

  const handleLerQrCode = () => {
    const leitura = prompt("Cole a chave de acesso da NF-e (44 dígitos):", chaveAcesso)
    if (!leitura) return
    const digits = leitura.replace(/\D/g, "")
    if (digits.length !== 44) {
      setImportFeedback("Chave de acesso inválida. Informe exatamente 44 dígitos.")
      return
    }
    setChaveAcesso(digits)
    setImportFeedback("Chave de acesso validada. Agora envie o XML correspondente para leitura.")
  }

  const confirmarEntradaMercadoria = () => {
    if (nfeItens.length === 0) {
      setImportFeedback("Nenhum item de NF-e para confirmar.")
      return
    }
    setProducts((prev) => {
      let next = [...prev]
      nfeItens.forEach((item) => {
        const map = dePara[item.id]
        if (map?.modo === "existente" && map.existingId) {
          next = next.map((p) =>
            p.id === map.existingId
              ? {
                  ...p,
                  estoqueAtual: p.estoqueAtual + item.quantidade,
                  precoCusto: item.valorUnitario || p.precoCusto,
                }
              : p
          )
          return
        }
        next.push({
          id: `${Date.now()}-${item.id}`,
          nome: item.nome,
          codigo: item.codigo,
          categoria: "peca",
          precoCusto: item.valorUnitario,
          precoVenda: +(item.valorUnitario * 1.7).toFixed(2),
          estoqueAtual: item.quantidade,
          estoqueMinimo: Math.max(1, Math.floor(item.quantidade * 0.2)),
          ncm: item.ncm,
          cfop: item.cfop,
          cest: "",
          origemMercadoria: "0",
          imei: "",
          numeroSerie: "",
          possuiGarantia: false,
          diasGarantia: 90,
          descricaoVenda: "",
        })
      })
      return next
    })
    toast({
      title: "Entrada de mercadoria concluída",
      description: `${nfeItens.length} item(ns) processado(s) no estoque.`,
    })
    setNfeItens([])
    setImportFeedback("Estoque atualizado com sucesso.")
  }

  const getCategoryIcon = (categoria: string) => {
    switch (categoria) {
      case "peca": return <Package className="w-4 h-4" />
      case "acessorio": return <Headphones className="w-4 h-4" />
      case "servico": return <Wrench className="w-4 h-4" />
      default: return <Package className="w-4 h-4" />
    }
  }

  const getCategoryLabel = (categoria: string) => {
    switch (categoria) {
      case "peca": return "Peça"
      case "acessorio": return "Acessório"
      case "servico": return "Serviço"
      default: return categoria
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(value)
  }

  const isLowStock = (product: Product) => {
    return product.categoria !== "servico" && product.estoqueAtual <= product.estoqueMinimo
  }

  const calculateMargin = () => {
    if (formData.precoVenda > 0 && formData.precoCusto > 0) {
      return ((formData.precoVenda - formData.precoCusto) / formData.precoVenda * 100).toFixed(1)
    }
    return "0"
  }

  return (
    <div className="space-y-6">
      {/* Header com acoes */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button 
            size="lg" 
            className="bg-primary hover:bg-primary/90 h-12 px-6 text-base font-semibold"
            onClick={() => handleOpenModal()}
          >
            <Plus className="w-5 h-5 mr-2" />
            Novo Produto ou Serviço
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            className="h-12 px-6 border-primary/30 hover:bg-primary/10"
            onClick={() => setIsImportModalOpen(true)}
          >
            <FileSpreadsheet className="w-5 h-5 mr-2" />
            Importar XML NF-e
          </Button>
        </div>
      </div>

      {/* Cards de estatisticas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.totalProdutos}</p>
                <p className="text-sm text-muted-foreground">Produtos</p>
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
                <p className="text-2xl font-bold text-foreground">{stats.totalServicos}</p>
                <p className="text-sm text-muted-foreground">Serviços</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{formatCurrency(stats.valorEstoque)}</p>
                <p className="text-sm text-muted-foreground">Valor em Estoque</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-border ${lowStockCount > 0 ? "bg-primary/5 border-primary/30" : "bg-card"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${lowStockCount > 0 ? "bg-primary/20" : "bg-muted"}`}>
                <AlertTriangle className={`w-5 h-5 ${lowStockCount > 0 ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div>
                <p className={`text-2xl font-bold ${lowStockCount > 0 ? "text-primary" : "text-foreground"}`}>{lowStockCount}</p>
                <p className="text-sm text-muted-foreground">Estoque Baixo</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros e busca */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, código ou IMEI..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-12 text-base bg-secondary border-border"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-48 h-12 bg-secondary border-border">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Categorias</SelectItem>
                <SelectItem value="peca">Peças</SelectItem>
                <SelectItem value="acessorio">Acessórios</SelectItem>
                <SelectItem value="servico">Serviços</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de produtos */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Itens Cadastrados ({filteredProducts.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden sm:table-cell">Código</TableHead>
                  <TableHead className="hidden md:table-cell">Categoria</TableHead>
                  <TableHead className="text-right">P. Custo</TableHead>
                  <TableHead className="text-right">P. Venda</TableHead>
                  <TableHead className="text-center">Estoque</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id} className="border-border">
                    <TableCell>
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                        {product.imagem ? (
                          <img 
                            src={product.imagem} 
                            alt={product.nome}
                            className="w-10 h-10 rounded-lg object-cover"
                          />
                        ) : (
                          getCategoryIcon(product.categoria)
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{product.nome}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground sm:hidden">{product.codigo}</p>
                          {product.imei && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Smartphone className="w-3 h-3" />
                              IMEI
                            </Badge>
                          )}
                          {product.possuiGarantia && (
                            <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                              <Shield className="w-3 h-3" />
                              {product.diasGarantia}d
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <code className="text-xs bg-secondary px-2 py-1 rounded">{product.codigo}</code>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className="gap-1">
                        {getCategoryIcon(product.categoria)}
                        {getCategoryLabel(product.categoria)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.categoria === "servico" ? "-" : formatCurrency(product.precoCusto)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground">
                      {formatCurrency(product.precoVenda)}
                    </TableCell>
                    <TableCell className="text-center">
                      {product.categoria === "servico" ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span className={`font-bold ${isLowStock(product) ? "text-primary" : "text-foreground"}`}>
                          {product.estoqueAtual}
                          {isLowStock(product) && (
                            <AlertTriangle className="w-4 h-4 inline ml-1 text-primary" />
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleOpenModal(product)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDeleteId(product.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Cadastro/Edicao com Abas */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open)
          if (!open) {
            setEditingProduct(null)
            setFormData(emptyProduct)
            setPreviewImage(null)
            setIaSyncLoading(false)
            setRelampagoImageDataUrl(null)
            setRelampagoAudioBlob(null)
            stopRelampagoRecording()
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editingProduct ? "Editar Item" : "Novo Produto ou Serviço"}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="geral">Dados Gerais</TabsTrigger>
              <TabsTrigger value="fiscal">Dados Fiscais</TabsTrigger>
              <TabsTrigger value="controle">Controle</TabsTrigger>
            </TabsList>

            {/* Aba Dados Gerais */}
            <TabsContent value="geral" className="space-y-6">
              {/* Upload de imagem */}
              <div className="flex items-start gap-4">
                <div 
                  className="w-28 h-28 rounded-xl bg-secondary border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors overflow-hidden"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {previewImage ? (
                    <img src={previewImage} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <ImageIcon className="w-8 h-8 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">Arrastar foto</span>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <div className="flex-1 space-y-3">
                  <Label>Foto do Produto</Label>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="w-4 h-4 mr-2" /> Enviar
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="w-4 h-4 mr-2" /> Câmera
                    </Button>
                    {previewImage && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-destructive"
                        onClick={() => {
                          setPreviewImage(null)
                          setRelampagoImageDataUrl(null)
                          setRelampagoAudioBlob(null)
                        }}
                      >
                        <X className="w-4 h-4 mr-1" /> Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {relampagoImageDataUrl && (
                <div className="rounded-lg border border-primary/35 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-primary shrink-0" />
                    <Label className="text-foreground">Áudio (opcional)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Fale custo, preço de venda e quantidade em estoque. Ex.: &quot;custo dez reais, vender por
                    trinta, estoque cinco peças&quot;.
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {!isRecordingAudio ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={startRelampagoRecording}
                        disabled={iaSyncLoading}
                      >
                        <Mic className="w-4 h-4 mr-2" />
                        Gravar áudio
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={stopRelampagoRecording}
                      >
                        Parar gravação
                      </Button>
                    )}
                    <input
                      ref={relampagoAudioInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={handleRelampagoAudioFile}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => relampagoAudioInputRef.current?.click()}
                      disabled={iaSyncLoading}
                    >
                      Enviar áudio
                    </Button>
                    {relampagoAudioBlob ? (
                      <span className="text-xs font-medium text-primary">Áudio pronto</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    onClick={handleRelampagoSincronizar}
                    disabled={iaSyncLoading}
                  >
                    {iaSyncLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    Sincronizar dados do produto
                  </Button>
                </div>
              )}

              {iaSyncLoading ? (
                <div className="space-y-2" role="status" aria-live="polite">
                  <p className="text-sm font-medium text-primary">Sincronizando dados do produto...</p>
                  <Progress value={syncProgress} className="h-2.5" />
                </div>
              ) : null}

              <Separator />

              {/* Campos basicos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label htmlFor="nome">Nome do Item *</Label>
                  <div className="flex gap-2 items-stretch">
                    <Input
                      id="nome"
                      value={formData.nome}
                      onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
                      placeholder="Ex: Tela iPhone 13 ou iPhone 12 Pro Max 128GB"
                      className="h-12 flex-1 min-w-0 bg-secondary border-border"
                      disabled={iaSyncLoading}
                    />
                    <input
                      ref={visionScanInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleVisionScanFile}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 shrink-0 border-primary/40"
                      disabled={iaSyncLoading}
                      title="Cadastro relâmpago: foto, depois áudio opcional com valores; em seguida Sincronizar"
                      onClick={() => visionScanInputRef.current?.click()}
                    >
                      {iaSyncLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      ) : (
                        <Camera className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="sm:col-span-2 space-y-2">
                  <Label htmlFor="descricaoVenda">Descrição para venda</Label>
                  <Textarea
                    id="descricaoVenda"
                    value={formData.descricaoVenda ?? ""}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, descricaoVenda: e.target.value }))
                    }
                    placeholder="Texto para vitrine, WhatsApp ou etiqueta (pode ser gerado pela IA ao usar o botão da câmera ao lado do nome)"
                    rows={4}
                    className="resize-y min-h-[88px] bg-secondary border-border text-sm"
                    disabled={iaSyncLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="codigo">Código / EAN</Label>
                  <div className="relative">
                    <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="codigo"
                      value={formData.codigo}
                      onChange={(e) => setFormData(prev => ({ ...prev, codigo: e.target.value }))}
                      placeholder="7891234567890"
                      className="h-12 pl-10 bg-secondary border-border"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Categoria *</Label>
                  <Select 
                    value={formData.categoria} 
                    onValueChange={(value: "peca" | "acessorio" | "servico") => 
                      setFormData(prev => ({ ...prev, categoria: value }))
                    }
                  >
                    <SelectTrigger className="h-12 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="peca">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4" /> Peça
                        </div>
                      </SelectItem>
                      <SelectItem value="acessorio">
                        <div className="flex items-center gap-2">
                          <Headphones className="w-4 h-4" /> Acessório
                        </div>
                      </SelectItem>
                      <SelectItem value="servico">
                        <div className="flex items-center gap-2">
                          <Wrench className="w-4 h-4" /> Serviço
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="precoCusto">Preço de Custo (R$)</Label>
                  <Input
                    id="precoCusto"
                    type="number"
                    step="0.01"
                    value={formData.precoCusto || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, precoCusto: parseFloat(e.target.value) || 0 }))}
                    placeholder="0,00"
                    className="h-12 bg-secondary border-border"
                    disabled={formData.categoria === "servico"}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="precoVenda">Preço de Venda (R$) *</Label>
                  <Input
                    id="precoVenda"
                    type="number"
                    step="0.01"
                    value={formData.precoVenda || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, precoVenda: parseFloat(e.target.value) || 0 }))}
                    placeholder="0,00"
                    className="h-12 bg-secondary border-border"
                  />
                </div>

                {formData.categoria !== "servico" && formData.precoVenda > 0 && formData.precoCusto > 0 && (
                  <div className="sm:col-span-2">
                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-sm text-primary">
                        <span className="font-semibold">Margem de lucro:</span> {calculateMargin()}% 
                        ({formatCurrency(formData.precoVenda - formData.precoCusto)} por unidade)
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Aba Dados Fiscais */}
            <TabsContent value="fiscal" className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ncm">NCM</Label>
                  <Input
                    id="ncm"
                    value={formData.ncm || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, ncm: e.target.value }))}
                    placeholder="Ex: 85177090"
                    className="h-12 bg-secondary border-border"
                    maxLength={8}
                  />
                  <p className="text-xs text-muted-foreground">Nomenclatura Comum do Mercosul (8 dígitos)</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cest">CEST</Label>
                  <Input
                    id="cest"
                    value={formData.cest || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, cest: e.target.value }))}
                    placeholder="Ex: 2106500"
                    className="h-12 bg-secondary border-border"
                    maxLength={7}
                  />
                  <p className="text-xs text-muted-foreground">Código Especificador da Substituição Tributária</p>
                </div>

                <div className="space-y-2">
                  <Label>Origem da Mercadoria</Label>
                  <Select 
                    value={formData.origemMercadoria || "0"} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, origemMercadoria: value }))}
                  >
                    <SelectTrigger className="h-12 bg-secondary border-border">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {origensOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cfop">CFOP Padrão</Label>
                  <Input
                    id="cfop"
                    value={formData.cfop || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, cfop: e.target.value }))}
                    placeholder="Ex: 5102"
                    className="h-12 bg-secondary border-border"
                    maxLength={4}
                  />
                  <p className="text-xs text-muted-foreground">Código Fiscal de Operações e Prestações</p>
                </div>
              </div>

              <Separator />

              {/* Campos para celulares/aparelhos */}
              <div className="space-y-4">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Smartphone className="w-5 h-5" />
                  Dados do Aparelho (Celulares/Eletrônicos)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="imei">IMEI</Label>
                    <Input
                      id="imei"
                      value={formData.imei || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, imei: e.target.value }))}
                      placeholder="Ex: 354678091234567"
                      className="h-12 bg-secondary border-border"
                      maxLength={15}
                    />
                    <p className="text-xs text-muted-foreground">International Mobile Equipment Identity (15 dígitos)</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="numeroSerie">Número de Série</Label>
                    <Input
                      id="numeroSerie"
                      value={formData.numeroSerie || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, numeroSerie: e.target.value }))}
                      placeholder="Ex: F2LXYZ123ABC"
                      className="h-12 bg-secondary border-border"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg bg-secondary">
                  <Checkbox 
                    id="possuiGarantia"
                    checked={formData.possuiGarantia}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, possuiGarantia: checked === true }))
                    }
                  />
                  <div className="flex-1">
                    <Label htmlFor="possuiGarantia" className="cursor-pointer">
                      <Shield className="w-4 h-4 inline mr-2 text-primary" />
                      Produto com Garantia
                    </Label>
                    <p className="text-xs text-muted-foreground">Marque se este produto oferece garantia ao cliente</p>
                  </div>
                  {formData.possuiGarantia && (
                    <div className="w-24">
                      <Input
                        type="number"
                        value={formData.diasGarantia || 90}
                        onChange={(e) => setFormData(prev => ({ ...prev, diasGarantia: parseInt(e.target.value) || 90 }))}
                        className="h-10 bg-background border-border text-center"
                        min={1}
                      />
                      <p className="text-xs text-muted-foreground text-center mt-1">dias</p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Aba Controle de Estoque */}
            <TabsContent value="controle" className="space-y-6">
              {formData.categoria !== "servico" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="estoqueAtual">Estoque Atual</Label>
                    <Input
                      id="estoqueAtual"
                      type="number"
                      value={formData.estoqueAtual || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, estoqueAtual: parseInt(e.target.value) || 0 }))}
                      placeholder="0"
                      className="h-12 bg-secondary border-border"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="estoqueMinimo">Estoque Mínimo (Alerta)</Label>
                    <Input
                      id="estoqueMinimo"
                      type="number"
                      value={formData.estoqueMinimo || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, estoqueMinimo: parseInt(e.target.value) || 0 }))}
                      placeholder="5"
                      className="h-12 bg-secondary border-border"
                    />
                    <p className="text-xs text-muted-foreground">
                      Quando o estoque atingir este valor, será exibido um alerta vermelho no Dashboard
                    </p>
                  </div>

                  {formData.estoqueAtual > 0 && formData.estoqueAtual <= formData.estoqueMinimo && (
                    <div className="sm:col-span-2">
                      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-3">
                        <AlertTriangle className="w-6 h-6 text-primary" />
                        <div>
                          <p className="font-semibold text-primary">Atenção: Estoque baixo!</p>
                          <p className="text-sm text-muted-foreground">
                            O estoque atual está igual ou abaixo do mínimo configurado. Reponha o estoque.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 rounded-lg bg-secondary text-center">
                  <Wrench className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    Serviços não possuem controle de estoque.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <Separator className="my-4" />

          {/* Acoes do modal */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleCloseModal}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.nome || !formData.precoVenda}
              className="bg-primary hover:bg-primary/90"
            >
              {editingProduct ? "Salvar Alterações" : "Cadastrar Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Importacao */}
      <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-primary" />
              Importar XML NF-e
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p className="text-muted-foreground">
              Entrada de mercadoria via XML: leia a NF-e, faça o De-Para e confirme a atualização do estoque.
            </p>

            <div className="grid gap-2">
              <Label>Chave de Acesso (44 dígitos)</Label>
              <div className="flex gap-2">
                <Input
                  value={chaveAcesso}
                  onChange={(e) => setChaveAcesso(e.target.value.replace(/\D/g, "").slice(0, 44))}
                  placeholder="Cole a chave da NF-e"
                  className="bg-secondary border-border"
                />
                <Button type="button" variant="outline" className="border-primary/30 hover:bg-primary/10" onClick={handleLerQrCode}>
                  Leitura QR Code
                </Button>
              </div>
            </div>

            <div 
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-foreground">Clique para selecionar o arquivo</p>
              <p className="text-sm text-muted-foreground mt-1">ou arraste e solte aqui</p>
              <p className="text-xs text-muted-foreground mt-3">Formato aceito: .xml (NF-e)</p>
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={handleImportFile}
            />

            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-sm text-muted-foreground">
                <strong>Dica:</strong> O XML da NF-e deve conter as tags de produto (`det/prod`). Os itens serão incluídos com custo automático.
              </p>
            </div>
            {nfeItens.length > 0 && (
              <div className="space-y-3 max-h-64 overflow-auto pr-1">
                <p className="text-sm font-medium">De-Para dos itens da nota</p>
                {nfeItens.map((item) => (
                  <div key={item.id} className="p-3 rounded-lg border border-border bg-secondary/20 space-y-2">
                    <p className="text-sm font-medium">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">Qtd: {item.quantidade} | Custo: {formatCurrency(item.valorUnitario)}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        value={dePara[item.id]?.modo || "novo"}
                        onValueChange={(v: "existente" | "novo") =>
                          setDePara((prev) => ({ ...prev, [item.id]: { ...prev[item.id], modo: v } }))
                        }
                      >
                        <SelectTrigger className="bg-card border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="novo">Criar novo produto</SelectItem>
                          <SelectItem value="existente">Vincular existente</SelectItem>
                        </SelectContent>
                      </Select>
                      {dePara[item.id]?.modo === "existente" ? (
                        <Select
                          value={dePara[item.id]?.existingId}
                          onValueChange={(v) =>
                            setDePara((prev) => ({ ...prev, [item.id]: { ...prev[item.id], existingId: v } }))
                          }
                        >
                          <SelectTrigger className="bg-card border-border">
                            <SelectValue placeholder="Produto do estoque" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.filter((p) => p.categoria !== "servico").map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="h-10 rounded-md border border-border bg-card px-3 flex items-center text-xs text-muted-foreground">
                          Sera criado automaticamente
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {importFeedback && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/10 text-sm text-primary">
                {importFeedback}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsImportModalOpen(false)}>
              Cancelar
            </Button>
            <Button className="bg-primary hover:bg-primary/90" onClick={confirmarEntradaMercadoria} disabled={nfeItens.length === 0}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Confirmar Entrada
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir item do estoque?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o cadastro do produto. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDeleteProduct}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
