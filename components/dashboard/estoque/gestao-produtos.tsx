"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
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
  Wallet,
  Sparkles,
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { mergeCadastroRelampago } from "@/lib/merge-cadastro-relampago"
import type { VisionProductResult } from "@/lib/vision-product-openai"
import type { ProductVoiceMetadata } from "@/lib/product-voice-metadata-openai"
import type { VoiceFormExtract } from "@/lib/product-ncm-fiscal-ai"
import {
  getSpeechRecognitionConstructor,
  disposeSpeechRecognition,
  logSpeechRecognitionError,
  humanizeSpeechError,
  isBenignSpeechError,
  logVoiceEnvironmentOnce,
} from "@/lib/web-speech-recognition"
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
  SpeechRecognitionErrorEventLike,
} from "@/lib/web-speech-recognition"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { useLojaAtiva } from "@/lib/loja-ativa"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"
import { pickCostPrice, pickSalePrice } from "@/lib/inventory-item-from-api"
import { TypeToConfirmDialog } from "@/components/dashboard/safety/type-to-confirm-dialog"
import { cn } from "@/lib/utils"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { vincularPendenciaInventario } from "@/app/actions/inventario"
import {
  stripAutoCodigoPrefixes,
  buildProdutoFormCodigos,
} from "@/lib/produtos/produto-form-codigos"
import {
  ProdutoCompatibilidadeAparelhos,
  emptyCompatibilidade,
  type CompatibilidadeValue,
} from "@/components/dashboard/estoque/produto-compatibilidade-aparelhos"
import type { CatalogoAparelhosMetadata } from "@/lib/catalogo-aparelhos/produto-metadata"

interface Product {
  id: string
  /** Id persistido no Prisma (cuid) — usado em PATCH/DELETE na API. */
  dbId?: string
  nome: string
  /** SKU comercial (opcional). */
  sku?: string
  codigo: string
  /** Código de barras alternativo (opcional); mesma coluna que `barcode` na API se só um for preenchido. */
  codigoBarras?: string
  /** Código de barras (EAN) para bipar no cadastro e usar no PDV. */
  barcode?: string
  /** Slug da categoria (`peca`, `servico`, ou slug criado na importação). */
  categoria: string
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

const emptyProduct: Omit<Product, "id"> = {
  nome: "",
  sku: "",
  codigo: "",
  barcode: "",
  codigoBarras: "",
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

const CATEGORIAS_SUGERIDAS_ESTOQUE = [
  "Eletrônicos",
  "Cabos de celular",
  "Suportes",
  "Caixa de som/ radio",
  "Carregador de celular",
  "Case iphone",
  "Capinha silicone",
  "Capinha transparente",
  "Fontes",
  "Video game",
  "Controles",
  "Copos e garrafa termicos",
  "Fones ouvido",
  "Lampadas luzes led",
  "Maquina cabelo",
  "Teclado mouse",
  "Peliculas",
  "Tv box",
] as const

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

/** Rótulo legível para um model_key salvo (fallback quando não temos o nome canônico). */
function humanizeModelKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

export type VoiceStockHint = {
  key: number
  searchQuery?: string
  openNovo?: boolean
  openImport?: boolean
}

/**
 * CADASTROS-PRODUTOS-DUPLICIDADE-001 — aviso de produto já cadastrado no cadastro manual.
 * `forte` = mesmo SKU/EAN na loja (API responde 409 e bloqueia). `provavel` = mesmo nome
 * sem código (a regra permite, então só avisa e deixa confirmar).
 */
type DuplicateProdutoInfo = {
  mode: "forte" | "provavel"
  message: string
  field?: string
  produto: {
    id: string
    name: string
    sku?: string | null
    barcode?: string | null
    stock?: number | null
  }
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
  const { lojaAtivaId } = useLojaAtiva()
  const lojaHeader = useMemo(() => resolveLojaIdParaConsultaClientes(lojaAtivaId), [lojaAtivaId])
  const auditUser = () =>
    `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`
  const [products, setProducts] = useState<Product[]>([])
  /** Slug → rótulo (API `categorias_produto` + padrões locais). */
  const [categoriaNomePorSlug, setCategoriaNomePorSlug] = useState<Map<string, string>>(() => new Map())
  const [searchTerm, setSearchTerm] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [formData, setFormData] = useState<Omit<Product, "id">>(emptyProduct)
  // CATALOGO-APARELHOS-METADATA-MVP-001 — seção "Compatibilidade com aparelhos".
  const [catalogoValue, setCatalogoValue] = useState<CompatibilidadeValue>(() => emptyCompatibilidade())
  // true após carregar (ou zerar) o catálogo salvo na edição — evita limpar por engano
  // quando um fetch falha (só envia `null` de limpeza se de fato carregamos o estado).
  const catalogoLoadedRef = useRef(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<string>("")
  const [chaveAcesso, setChaveAcesso] = useState("")
  const [nfeItens, setNfeItens] = useState<NFeItem[]>([])
  const [dePara, setDePara] = useState<Record<string, { modo: "existente" | "novo"; existingId?: string }>>({})
  const [activeTab, setActiveTab] = useState("geral")
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false)
  const [singleDeleting, setSingleDeleting] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateProdutoInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [iaSyncLoading, setIaSyncLoading] = useState(false)
  const [visionQuickScanLoading, setVisionQuickScanLoading] = useState(false)
  const [ncmSuggestLoading, setNcmSuggestLoading] = useState(false)
  const [fiscalClassifyLoading, setFiscalClassifyLoading] = useState(false)
  const [formVoiceProcessing, setFormVoiceProcessing] = useState(false)
  const [formVoiceListening, setFormVoiceListening] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [relampagoImageDataUrl, setRelampagoImageDataUrl] = useState<string | null>(null)
  const [relampagoAudioBlob, setRelampagoAudioBlob] = useState<Blob | null>(null)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const visionScanInputRef = useRef<HTMLInputElement>(null)
  const relampagoAudioInputRef = useRef<HTMLInputElement>(null)
  const formVoiceFileInputRef = useRef<HTMLInputElement>(null)
  const formSpeechRecRef = useRef<SpeechRecognitionInstance | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const importInputRef = useRef<HTMLInputElement>(null)

  // Contexto de vínculo de inventário — preenchido via URL quando o operador veio da fila de
  // reconciliação do Inventário Assistido. Só o create usa (não o edit); lido do window.location
  // via useEffect (client-only) para não afetar SSR nem a assinatura de renderização do componente.
  const inventarioCtxRef = useRef<{ contagemId: string; sessaoId: string; storeId: string } | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const p = new URLSearchParams(window.location.search)
    const contagemId = p.get("inventarioContagemId")
    const sessaoId = p.get("inventarioSessaoId")
    const invStoreId = p.get("inventarioStoreId")
    if (!contagemId || !sessaoId || !invStoreId) return

    inventarioCtxRef.current = { contagemId, sessaoId, storeId: invStoreId }

    const barcode = p.get("prefillBarcode") ?? ""
    const nome = p.get("prefillNome") ?? ""
    const qtd = Math.max(0, Math.trunc(Number(p.get("prefillQtd")) || 0))
    if (!barcode) return

    setFormData((prev) => ({
      ...prev,
      barcode: barcode || prev.barcode,
      nome: nome || prev.nome,
      estoqueAtual: qtd > 0 ? qtd : prev.estoqueAtual,
    }))
    setIsModalOpen(true)
  }, [])

  const reloadInventory = useCallback(async () => {
    setIsLoading(true)
    try {
      const headers = { [ASSISTEC_LOJA_HEADER]: lojaHeader }
      const q = `?lojaId=${encodeURIComponent(lojaHeader)}`
      const [invRes, catRes] = await Promise.all([
        fetch(`/api/ops/inventory${q}`, {
          credentials: "include",
          headers,
          cache: "no-store",
        }),
        fetch(`/api/ops/categorias-produto${q}`, {
          credentials: "include",
          headers,
          cache: "no-store",
        }),
      ])
      if (catRes.ok) {
        const catData = (await catRes.json().catch(() => null)) as { items?: Array<{ slug: string; nome: string }> } | null
        const m = new Map<string, string>()
        for (const row of catData?.items ?? []) {
          if (row.slug) m.set(row.slug, row.nome || row.slug)
        }
        setCategoriaNomePorSlug(m)
      }
      if (!invRes.ok) {
        const err = (await invRes.json().catch(() => null)) as { error?: string; detail?: string } | null
        toast({
          title: "Falha ao carregar produtos",
          description: err?.detail || err?.error || `HTTP ${invRes.status}`,
          variant: "destructive",
        })
        setProducts([])
        return
      }
      const data = (await invRes.json().catch(() => null)) as {
        items?: Array<Record<string, unknown> & { id?: string; name?: string; stock?: number }>
      } | null
      const items = data?.items ?? []
      setProducts(
        items.map((it) => {
          const row = it as Record<string, unknown>
          const precoCusto = pickCostPrice(row)
          const precoVenda = pickSalePrice(row)
          // Produto antigo sem categoria continua sem categoria no read-back; não inventa
          // "peca", pois uma edição de outro campo acabaria persistindo esse fallback.
          const rawCategory = typeof it.category === "string" ? it.category.trim() : ""
          const skuStr = typeof row.sku === "string" ? row.sku.trim() : ""
          const codigoFromApi = typeof row.codigo === "string" ? String(row.codigo).trim() : ""
          const codigoBase = codigoFromApi || skuStr
          const codigoStr =
            stripAutoCodigoPrefixes(codigoBase) ||
            stripAutoCodigoPrefixes(String(it.id ?? "")) ||
            codigoBase
          const bc =
            typeof row.barcode === "string"
              ? row.barcode.trim()
              : typeof row.codigoBarras === "string"
                ? String(row.codigoBarras).trim()
                : ""
          const dbId = typeof row.dbId === "string" ? row.dbId.trim() : ""
          // Identidade fiscal (GOAL_004): a API expõe `fiscal` (read-only) — usada na edição.
          const fiscal = (row.fiscal && typeof row.fiscal === "object" ? row.fiscal : {}) as Record<string, unknown>
          const fiscalStr = (k: string) => (typeof fiscal[k] === "string" ? (fiscal[k] as string) : "")
          return {
            id: String(it.id ?? ""),
            dbId: dbId || undefined,
            nome: String(it.name ?? ""),
            sku: skuStr || undefined,
            codigo: codigoStr || String(it.id ?? ""),
            barcode: bc || undefined,
            codigoBarras: "",
            categoria: rawCategory,
            precoCusto: Number.isFinite(precoCusto) ? precoCusto : 0,
            precoVenda: Number.isFinite(precoVenda) ? precoVenda : 0,
            estoqueAtual: typeof it.stock === "number" ? it.stock : 0,
            estoqueMinimo: 0,
            ncm: fiscalStr("ncm"),
            cest: fiscalStr("cest"),
            cfop: fiscalStr("cfop"),
            origemMercadoria: fiscalStr("origemMercadoria"),
          }
        })
      )
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false)
    }
  }, [lojaHeader, toast])

  useEffect(() => {
    void reloadInventory()
  }, [reloadInventory])

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

  // Mantida apenas para filtros e selects; tabela passa a mostrar o texto cru.
  const getCategoryLabel = useCallback(
    (slug: string) => (slug || "").trim() || "Sem Categoria",
    []
  )

  const categoryFilterSlugs = useMemo(() => {
    const u = new Set<string>(["peca", "acessorio", "servico"])
    for (const p of products) {
      if (p.categoria) u.add(p.categoria)
    }
    return Array.from(u).sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b), "pt-BR"))
  }, [products, getCategoryLabel])

  const formCategoryRows = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of ["peca", "acessorio", "servico"]) {
      m.set(s, getCategoryLabel(s))
    }
    for (const [slug, nome] of categoriaNomePorSlug) {
      m.set(slug, nome || slug)
    }
    const cur = formData.categoria?.trim()
    if (cur && !m.has(cur)) m.set(cur, getCategoryLabel(cur))
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
  }, [categoriaNomePorSlug, formData.categoria, getCategoryLabel])

  const filteredProducts = products.filter((product) => {
    const q = searchTerm.toLowerCase()
    const matchesSearch =
      product.nome.toLowerCase().includes(q) ||
      product.codigo.toLowerCase().includes(q) ||
      (product.sku && product.sku.toLowerCase().includes(q)) ||
      (product.barcode && product.barcode.toLowerCase().includes(q)) ||
      (product.codigoBarras && product.codigoBarras.toLowerCase().includes(q)) ||
      (product.imei && product.imei.includes(searchTerm))
    const matchesCategory = categoryFilter === "all" || product.categoria === categoryFilter
    return matchesSearch && matchesCategory
  })

  const allSelectedOnPage = useMemo(() => {
    if (filteredProducts.length === 0) return false
    return filteredProducts.every((p) => selectedProductIds.has(p.id))
  }, [filteredProducts, selectedProductIds])

  const someSelectedOnPage = useMemo(() => {
    return filteredProducts.some((p) => selectedProductIds.has(p.id))
  }, [filteredProducts, selectedProductIds])

  const toggleSelectAllPage = (checked: boolean) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      for (const p of filteredProducts) {
        if (checked) next.add(p.id)
        else next.delete(p.id)
      }
      return next
    })
  }

  const toggleSelectOneProduct = (id: string, checked: boolean) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectedOnPageIds = useMemo(
    () => filteredProducts.filter((p) => selectedProductIds.has(p.id)).map((p) => p.id),
    [filteredProducts, selectedProductIds]
  )

  const bulkDeleteSelectedProducts = async () => {
    const ids = Array.from(selectedProductIds)
      .map((id) => products.find((p) => p.id === id)?.dbId || id)
      .filter(Boolean)
    if (ids.length === 0) return
    setBulkDeleting(true)
    try {
      const res = await fetch("/api/produtos/bulk-delete", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaHeader,
        },
        body: JSON.stringify({ ids }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; deleted?: number; error?: string } | null
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Falha ao excluir (HTTP ${res.status})`)
      }
      setSelectedProductIds(new Set())
      await reloadInventory()
      toast({
        title: "Exclusão concluída",
        description: `${data.deleted ?? 0} item(ns) removido(s) do estoque.`,
      })
    } catch (e) {
      toast({
        title: "Não foi possível excluir",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setBulkDeleting(false)
      setConfirmBulkOpen(false)
    }
  }

  const lowStockCount = products.filter(p => p.categoria !== "servico" && p.estoqueAtual <= p.estoqueMinimo).length

  const stats = {
    totalProdutos: products.filter(p => p.categoria !== "servico").length,
    totalServicos: products.filter(p => p.categoria === "servico").length,
    valorEstoque: products.reduce((acc, p) => acc + (p.precoCusto * p.estoqueAtual), 0),
  }

  // Reidrata a seção de compatibilidade a partir do metadata salvo (edição).
  const loadCatalogoAparelhos = useCallback(
    async (dbId: string) => {
      try {
        const res = await fetch(`/api/catalogo/aparelhos/produto/${encodeURIComponent(dbId)}`, {
          credentials: "include",
          headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
          cache: "no-store",
        })
        if (!res.ok) return // não marca "carregado": evita limpar por engano ao salvar
        const data = (await res.json().catch(() => null)) as {
          catalogoAparelhos?: CatalogoAparelhosMetadata | null
        } | null
        const c = data?.catalogoAparelhos
        if (c && Array.isArray(c.deviceModelKeys) && c.deviceModelKeys.length > 0) {
          setCatalogoValue({
            models: c.deviceModelKeys.map((k) => ({ modelKey: k, canonicalName: humanizeModelKey(k), brand: "" })),
            aliases: Array.isArray(c.deviceAliases) ? c.deviceAliases : [],
            status: c.compatibilityStatus,
            types: Array.isArray(c.compatibilityTypes) ? c.compatibilityTypes : [],
            notes: typeof c.notes === "string" ? c.notes : "",
          })
        }
        catalogoLoadedRef.current = true
      } catch {
        /* rede falhou: mantém vazio e NÃO marca carregado (não limpa ao salvar) */
      }
    },
    [lojaHeader],
  )

  const handleOpenModal = (product?: Product) => {
    setCatalogoValue(emptyCompatibilidade())
    catalogoLoadedRef.current = false
    if (product) {
      setEditingProduct(product)
      const dbId = product.dbId || product.id
      if (dbId) void loadCatalogoAparelhos(dbId)
      setFormData({
        nome: product.nome,
        sku: product.sku ? stripAutoCodigoPrefixes(product.sku) : "",
        codigo: stripAutoCodigoPrefixes(product.codigo),
        barcode: product.barcode ?? "",
        codigoBarras: product.codigoBarras ?? "",
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
    setVisionQuickScanLoading(false)
    setNcmSuggestLoading(false)
    setFiscalClassifyLoading(false)
    setFormVoiceProcessing(false)
    stopFormVoiceListening()
    setRelampagoImageDataUrl(null)
    setRelampagoAudioBlob(null)
    setDuplicateInfo(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setDuplicateInfo(null)
    setIsModalOpen(false)
  }

  // CADASTROS-PRODUTOS-DUPLICIDADE-001 — abre o item já existente para editar/ajustar
  // estoque, em vez de o operador tentar cadastrar de novo. Se o item ainda não estiver
  // na lista carregada, atualiza e orienta a editar pela tabela (sem criar fluxo novo).
  const openExistingProduct = (existingId: string) => {
    setDuplicateInfo(null)
    const found = products.find((p) => p.dbId === existingId || p.id === existingId)
    if (found) {
      handleOpenModal(found)
      return
    }
    handleCloseModal()
    void reloadInventory()
    toast({
      title: "Produto já existe no estoque",
      description: "Atualizamos a lista. Localize o item e clique em editar para ajustar dados ou estoque.",
    })
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
      setCatalogoValue(emptyCompatibilidade())
      catalogoLoadedRef.current = false
      setActiveTab("geral")
      setIsModalOpen(true)
  }
    if (voiceStockHint.openImport) {
      setIsImportModalOpen(true)
    }
    onVoiceStockHintConsumed?.()
  }, [voiceStockHint, onVoiceStockHintConsumed])

  const handleSave = async (opts?: { force?: boolean }) => {
    const nome = formData.nome.trim()
    if (!nome) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do item.", variant: "destructive" })
      return
    }
    if (!(Number(formData.precoVenda) > 0)) {
      toast({ title: "Preço de venda", description: "Informe um preço de venda válido.", variant: "destructive" })
      return
    }
    setDuplicateInfo(null)
    // CADASTROS-PRODUTOS-DUPLICIDADE-001 — duplicidade PROVÁVEL: cadastro novo, sem código,
    // mesmo nome de um item já existente na loja. A regra atual permite nomes repetidos,
    // então só avisa e deixa o operador confirmar ("Cadastrar mesmo assim") — não bloqueia.
    if (!editingProduct && !opts?.force) {
      const codigos = buildProdutoFormCodigos({ sku: formData.sku, barcode: formData.barcode })
      const semCodigo = !codigos.sku && !codigos.barcode
      if (semCodigo) {
        const alvo = nome.toLowerCase()
        const existente = products.find((p) => p.nome.trim().toLowerCase() === alvo)
        if (existente) {
          setDuplicateInfo({
            mode: "provavel",
            message:
              "Já existe um produto com este mesmo nome nesta loja. Confirme se não é o mesmo item antes de cadastrar.",
            produto: {
              id: existente.dbId || existente.id,
              name: existente.nome,
              sku: existente.sku ?? null,
              barcode: existente.barcode ?? null,
              stock: existente.estoqueAtual,
            },
          })
          return
        }
      }
    }
    setSaveBusy(true)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        [ASSISTEC_LOJA_HEADER]: lojaHeader,
      }
      // CATALOGO-APARELHOS-METADATA-MVP-001 — vínculo de aparelhos → metadata.catalogoAparelhos.
      // Ausente (undefined) = não toca no catálogo salvo; `null` = limpa explicitamente (só
      // quando de fato carregamos o estado na edição, para não apagar por engano).
      const catalogoModelKeys = catalogoValue.models.map((m) => m.modelKey)
      const catalogoAparelhos =
        catalogoModelKeys.length > 0
          ? {
              deviceModelKeys: catalogoModelKeys,
              deviceAliases: catalogoValue.aliases,
              compatibilityStatus: catalogoValue.status,
              compatibilityTypes: catalogoValue.types,
              notes: catalogoValue.notes,
              source: "manual" as const,
            }
          : editingProduct && catalogoLoadedRef.current
            ? null
            : undefined
      const payload = {
        name: nome,
        stock: Math.max(0, Math.floor(Number(formData.estoqueAtual) || 0)),
        price: Number(formData.precoVenda) || 0,
        precoCusto: Math.max(0, Number(formData.precoCusto) || 0),
        // Sempre envia a string canônica. Vazio é remoção explícita no PATCH; omissão
        // fica reservada para callers que realmente querem preservar sem tocar no campo.
        category: formData.categoria?.trim() ?? "",
        // PRODUTO-CODIGOS-UI-PAYLOAD-FIX-002 — contrato limpo: só `sku` (Produto.sku) e
        // `barcode` (Produto.barcode). Sem `codigo`/`codigoBarras` duplicados disputando a
        // mesma coluna.
        ...buildProdutoFormCodigos({ sku: formData.sku, barcode: formData.barcode }),
        // Identidade fiscal (GOAL_004): a API persiste em metadata.fiscal — fim do descarte.
        ncm: formData.ncm?.trim() || "",
        cest: formData.cest?.trim() || "",
        cfop: formData.cfop?.trim() || "",
        origemMercadoria: formData.origemMercadoria?.trim() || "",
        ...(catalogoAparelhos !== undefined ? { catalogoAparelhos } : {}),
      }
      const res = editingProduct
        ? await fetch(
            `/api/produtos/${encodeURIComponent(editingProduct.dbId || editingProduct.id)}`,
            {
              method: "PATCH",
              credentials: "include",
              headers,
              body: JSON.stringify(payload),
            }
          )
        : await fetch("/api/produtos", {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(payload),
          })
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean
            error?: string
            detail?: string
            type?: string
            message?: string
            field?: string
            produto?: { id?: string; name?: string; sku?: string | null; barcode?: string | null; stock?: number | null }
          }
        | null
      if (!res.ok) {
        // CADASTROS-PRODUTOS-DUPLICIDADE-001 — duplicidade FORTE (mesmo SKU/EAN na loja):
        // a API responde 409 com os dados do item existente. Mostra aviso claro + ação,
        // em vez do antigo "Não foi possível salvar" genérico.
        if (res.status === 409 && data?.type === "DUPLICATE_PRODUCT") {
          if (data.produto?.id && data.produto.name) {
            setDuplicateInfo({
              mode: "forte",
              message: data.message || "Produto já cadastrado.",
              field: data.field,
              produto: {
                id: data.produto.id,
                name: data.produto.name,
                sku: data.produto.sku ?? null,
                barcode: data.produto.barcode ?? null,
                stock: data.produto.stock ?? null,
              },
            })
          }
          toast({
            title: "Produto já cadastrado",
            description: data.message || "Já existe um item com este código/EAN/SKU nesta loja.",
            variant: "destructive",
          })
          return
        }
        throw new Error(data?.error || data?.detail || `Falha ao salvar (HTTP ${res.status})`)
      }
      const criado = (data as { produto?: { id?: string } } | null)?.produto
      if (editingProduct) {
        appendAuditLog({
          action: "stock_manual",
          userLabel: auditUser(),
          detail: `${formData.nome}: estoque ${editingProduct.estoqueAtual} → ${formData.estoqueAtual}`,
        })
      } else {
        appendAuditLog({
          action: "stock_manual",
          userLabel: auditUser(),
          detail: `Cadastro "${formData.nome}", estoque inicial ${formData.estoqueAtual}`,
        })
        // Vínculo com pendência de inventário (Fase 6): se veio da fila de reconciliação,
        // marca a pendência como resolvida (não altera produto/estoque; só fecha a fila).
        const ctx = inventarioCtxRef.current
        const produtoId = typeof criado?.id === "string" ? criado.id : null
        if (ctx && produtoId) {
          const vinculo = await vincularPendenciaInventario(ctx.storeId, ctx.sessaoId, ctx.contagemId, produtoId, "cadastrado")
          inventarioCtxRef.current = null
          if (vinculo.ok) {
            toast({
              title: "Pendência resolvida",
              description: vinculo.codigoVinculado
                ? "Código vinculado ao produto. Nas próximas contagens ele será reconhecido automaticamente."
                : "Item removido da fila de reconciliação do inventário.",
            })
          }
        }
      }
      await reloadInventory()
      toast({
        title: editingProduct ? "Item atualizado" : "Item cadastrado",
        description: "Cadastro de estoque salvo com sucesso.",
      })
      handleCloseModal()
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setSaveBusy(false)
    }
  }

  const confirmDeleteProduct = async () => {
    if (!pendingDeleteId) return
    const product = products.find((p) => p.dbId === pendingDeleteId || p.id === pendingDeleteId)
    setSingleDeleting(true)
    try {
      const res = await fetch(`/api/produtos/${encodeURIComponent(pendingDeleteId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          [ASSISTEC_LOJA_HEADER]: lojaHeader,
        },
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Falha ao excluir (HTTP ${res.status})`)
      }
      if (product) {
        appendAuditLog({
          action: "registro_excluido",
          userLabel: auditUser(),
          detail: `Estoque: exclusão do item "${product.nome}" (estoque era ${product.estoqueAtual})`,
        })
      }
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        next.delete(pendingDeleteId)
        return next
      })
      await reloadInventory()
      toast({ title: "Item removido do estoque" })
    } catch (e) {
      toast({
        title: "Não foi possível excluir",
        description: e instanceof Error ? e.message : "Erro inesperado",
        variant: "destructive",
      })
    } finally {
      setSingleDeleting(false)
      setPendingDeleteId(null)
    }
  }

  const applyProductImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Arquivo inválido",
        description: "Envie apenas imagens (JPG, PNG, WebP…).",
        variant: "destructive",
      })
      return
    }
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) applyProductImageFile(file)
    e.target.value = ""
  }

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) applyProductImageFile(file)
  }

  const handleImageDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "copy"
  }

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("Leitura do áudio falhou"))
      reader.readAsDataURL(blob)
    })

  const applyVoiceFormExtract = (meta: VoiceFormExtract) => {
    setFormData((prev) => ({
      ...prev,
      nome: meta.nome?.trim() ? meta.nome.trim() : prev.nome,
      categoria: meta.categoria ?? prev.categoria,
      precoCusto:
        meta.preco_custo != null && meta.preco_custo >= 0 ? meta.preco_custo : prev.precoCusto,
      precoVenda:
        meta.preco_venda != null && meta.preco_venda >= 0 ? meta.preco_venda : prev.precoVenda,
      estoqueAtual:
        meta.quantidade_estoque != null && meta.quantidade_estoque >= 0
          ? meta.quantidade_estoque
          : prev.estoqueAtual,
      ncm: meta.ncm?.trim()
        ? meta.ncm.replace(/\D/g, "").slice(0, 8)
        : prev.ncm,
    }))
  }

  const submitFormVoiceText = async (transcript: string) => {
    setFormVoiceProcessing(true)
    try {
      const res = await fetch("/api/product/voice-form-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      })
      const data = (await res.json()) as VoiceFormExtract & { error?: string }
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      applyVoiceFormExtract(data)
      toast({
        title: "Campos atualizados pela fala",
        description: "Revise nome, valores e NCM antes de salvar.",
      })
    } catch (err) {
      toast({
        title: "Não foi possível interpretar a fala",
        description: err instanceof Error ? err.message : "Tente de novo ou digite manualmente.",
        variant: "destructive",
      })
    } finally {
      setFormVoiceProcessing(false)
    }
  }

  const stopFormVoiceListening = () => {
    disposeSpeechRecognition(formSpeechRecRef.current)
    formSpeechRecRef.current = null
    setFormVoiceListening(false)
  }

  const startFormVoiceListening = () => {
    if (formVoiceProcessing || iaSyncLoading || visionQuickScanLoading) return
    logVoiceEnvironmentOnce()
    const Ctor = getSpeechRecognitionConstructor()
    if (!Ctor) {
      toast({
        title: "Reconhecimento de voz indisponível",
        description: "Use o botão ao lado para enviar um arquivo de áudio com o comando.",
      })
      formVoiceFileInputRef.current?.click()
      return
    }
    disposeSpeechRecognition(formSpeechRecRef.current)
    const rec = new Ctor()
    rec.lang = "pt-BR"
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (ev: Event) => {
      const e = ev as SpeechRecognitionEventLike
      let text = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          text += e.results[i][0]?.transcript ?? ""
        }
      }
      const t = text.trim()
      if (t) void submitFormVoiceText(t)
    }
    rec.onerror = (ev: Event) => {
      logSpeechRecognitionError("gestao-produtos form voice", ev)
      const code = (ev as SpeechRecognitionErrorEventLike).error
      if (!isBenignSpeechError(code)) {
        toast({
          title: "Voz",
          description: humanizeSpeechError(code),
          variant: "destructive",
        })
      }
    }
    rec.onend = () => {
      formSpeechRecRef.current = null
      setFormVoiceListening(false)
    }
    formSpeechRecRef.current = rec
    setFormVoiceListening(true)
    try {
      rec.start()
    } catch {
      setFormVoiceListening(false)
      formSpeechRecRef.current = null
      toast({
        title: "Microfone",
        description: "Não foi possível iniciar o reconhecimento de voz.",
        variant: "destructive",
      })
    }
  }

  const handleFormVoiceAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setFormVoiceProcessing(true)
    try {
      const audioBase64 = await blobToDataUrl(file)
      const res = await fetch("/api/product/voice-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64 }),
      })
      const data = (await res.json()) as VoiceFormExtract & { error?: string; transcript?: string }
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      applyVoiceFormExtract(data)
      toast({
        title: "Áudio interpretado",
        description: data.transcript
          ? `Trecho: “${data.transcript.slice(0, 120)}${data.transcript.length > 120 ? "…" : ""}”`
          : "Revise os campos antes de salvar.",
      })
    } catch (err) {
      toast({
        title: "Falha ao processar áudio",
        description: err instanceof Error ? err.message : "Verifique OPENAI_API_KEY para transcrição.",
        variant: "destructive",
      })
    } finally {
      setFormVoiceProcessing(false)
    }
  }

  const handleSuggestNcmFromName = async () => {
    const nome = formData.nome.trim()
    if (!nome) {
      toast({
        title: "Nome obrigatório",
        description: "Preencha o nome do item para sugerir o NCM.",
        variant: "destructive",
      })
      return
    }
    setNcmSuggestLoading(true)
    try {
      const res = await fetch("/api/product/ncm-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      })
      const data = (await res.json()) as { ncm?: string; descricao?: string; error?: string }
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      const ncm = (data.ncm ?? "").replace(/\D/g, "").slice(0, 8)
      if (ncm.length === 8) {
        setFormData((prev) => ({ ...prev, ncm }))
        toast({
          title: "NCM sugerido",
          description: data.descricao || ncm,
        })
      }
    } catch (err) {
      toast({
        title: "Sugestão de NCM",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      })
    } finally {
      setNcmSuggestLoading(false)
    }
  }

  const handleFiscalClassify = async () => {
    const nome = formData.nome.trim()
    if (!nome) {
      toast({
        title: "Nome obrigatório",
        description: "Preencha o nome do item para classificar tributariamente.",
        variant: "destructive",
      })
      return
    }
    setFiscalClassifyLoading(true)
    try {
      const res = await fetch("/api/product/fiscal-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          descricao: (formData.descricaoVenda ?? "").trim() || undefined,
          categoria: formData.categoria,
        }),
      })
      const data = (await res.json()) as {
        ncm?: string
        cest?: string
        cfop?: string
        origemMercadoria?: string
        observacao?: string
        error?: string
      }
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      setFormData((prev) => ({
        ...prev,
        ncm: (data.ncm ?? prev.ncm ?? "").replace(/\D/g, "").slice(0, 8) || prev.ncm,
        cest: (data.cest ?? prev.cest ?? "").replace(/\D/g, "").slice(0, 7) || prev.cest,
        cfop: (data.cfop ?? prev.cfop ?? "").replace(/\D/g, "").slice(0, 4) || prev.cfop,
        origemMercadoria:
          data.origemMercadoria != null && /^[0-8]$/.test(String(data.origemMercadoria))
            ? String(data.origemMercadoria)
            : prev.origemMercadoria,
      }))
      toast({
        title: "Classificação tributária (IA)",
        description: data.observacao || "Revise NCM, CEST, CFOP e origem com seu contador.",
      })
    } catch (err) {
      toast({
        title: "Classificação fiscal",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      })
    } finally {
      setFiscalClassifyLoading(false)
    }
  }

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
      title: "Foto capturada",
      description:
        "Identificando o item… Opcional: grave áudio e use Sincronizar para custo, venda e estoque.",
    })

    setVisionQuickScanLoading(true)
    try {
      const res = await fetch("/api/vision/product-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      })
      const visionRaw = (await res.json()) as VisionProductResult & { error?: string }
      if (!res.ok) throw new Error(visionRaw.error || `Erro ${res.status}`)

      const cat = visionRaw.categoria as "peca" | "acessorio" | "servico" | undefined
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
        ...mergeCadastroRelampago(vision, null, {
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
        title: "Item identificado na foto",
        description: "Nome, descrição e NCM sugeridos. Revise antes de salvar.",
      })
    } catch (err) {
      toast({
        title: "Não foi possível ler a foto automaticamente",
        description:
          err instanceof Error ? err.message : "Preencha manualmente ou tente outra imagem.",
        variant: "destructive",
      })
    } finally {
      setVisionQuickScanLoading(false)
    }
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

      const cat = visionRaw.categoria as "peca" | "acessorio" | "servico" | undefined
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

  // Entrada automática por XML NÃO está disponível nesta fase (sem backend fiscal):
  // a leitura/De-Para abaixo é apenas pré-visualização para conferência — não grava no
  // estoque. O botão "Confirmar Entrada" fica desabilitado. A entrada real (com
  // livro-razão) é feita em Cadastros → Estoque (Entrada manual) ou no Importador Avançado.

  const getCategoryIcon = (categoria: string) => {
    switch (categoria) {
      case "peca": return <Package className="w-4 h-4" />
      case "acessorio": return <Headphones className="w-4 h-4" />
      case "servico": return <Wrench className="w-4 h-4" />
      default: return <Package className="w-4 h-4" />
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
                {categoryFilterSlugs.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {getCategoryLabel(slug)}
                  </SelectItem>
                ))}
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
        <CardContent className="w-full min-w-0 p-0">
          <Table className="w-full min-w-0 table-fixed">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-12 shrink-0">
                    <Checkbox
                      checked={allSelectedOnPage ? true : someSelectedOnPage ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleSelectAllPage(Boolean(v))}
                      aria-label="Selecionar todos"
                    />
                  </TableHead>
                  <TableHead className="min-w-0 w-[26%] sm:w-[28%] lg:w-[30%] whitespace-normal">Nome</TableHead>
                  <TableHead className="hidden min-w-0 max-w-[140px] sm:table-cell">Código</TableHead>
                  <TableHead className="hidden md:table-cell md:w-[120px]">Categoria</TableHead>
                  <TableHead className="w-[88px] text-right whitespace-nowrap">P. Custo</TableHead>
                  <TableHead className="w-[88px] text-right whitespace-nowrap">P. Venda</TableHead>
                  <TableHead className="w-[72px] text-center whitespace-nowrap">Estoque</TableHead>
                  <TableHead className="sticky right-0 z-20 w-[96px] border-l border-border bg-card text-right shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.12)] dark:shadow-[-6px_0_12px_-6px_rgba(0,0,0,0.35)]">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <LoadingState inline message="Carregando produtos…" />
                    </TableCell>
                  </TableRow>
                ) : filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        compact
                        icon={Package}
                        title={searchTerm || categoryFilter !== "all" ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
                        description={
                          searchTerm || categoryFilter !== "all"
                            ? "Tente ajustar o filtro ou o termo de busca."
                            : "Adicione o primeiro produto ao catálogo clicando em 'Novo Produto'."
                        }
                        action={
                          !(searchTerm || categoryFilter !== "all")
                            ? { label: "Novo Produto", onClick: () => setIsModalOpen(true) }
                            : undefined
                        }
                        dashboardLink={false}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
                {!isLoading && filteredProducts.map((product) => (
                  <TableRow key={product.id} className="group/row border-border">
                    <TableCell className="shrink-0 align-top">
                      <Checkbox
                        checked={selectedProductIds.has(product.id)}
                        onCheckedChange={(v) => toggleSelectOneProduct(product.id, Boolean(v))}
                        aria-label={`Selecionar ${product.nome}`}
                      />
                    </TableCell>
                    <TableCell className="min-w-0 w-[26%] sm:w-[28%] lg:w-[30%] whitespace-normal align-top">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                        {product.imagem ? (
                            // eslint-disable-next-line @next/next/no-img-element
                          <img 
                            src={product.imagem} 
                            alt={product.nome}
                            className="w-10 h-10 rounded-lg object-cover"
                          />
                        ) : (
                          getCategoryIcon(product.categoria)
                        )}
                      </div>
                        <div className="min-w-0">
                        <p
                          className="line-clamp-2 break-words font-medium text-foreground"
                          title={product.nome}
                        >
                          {product.nome}
                        </p>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                            <p
                              className="truncate text-xs text-muted-foreground sm:hidden"
                              title={product.codigo}
                            >
                              {product.codigo}
                            </p>
                          {product.imei && (
                              <Badge variant="outline" className="shrink-0 text-xs gap-1">
                              <Smartphone className="w-3 h-3" />
                              IMEI
                            </Badge>
                          )}
                          {product.possuiGarantia && (
                              <Badge
                                variant="outline"
                                className="shrink-0 text-xs gap-1 text-primary border-primary/30"
                              >
                              <Shield className="w-3 h-3" />
                              {product.diasGarantia}d
                            </Badge>
                          )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden min-w-0 max-w-[140px] sm:table-cell align-top">
                      <code
                        className="block max-w-full truncate rounded bg-secondary px-2 py-1 text-xs"
                        title={product.codigo}
                      >
                        {product.codigo}
                      </code>
                    </TableCell>
                    <TableCell className="hidden md:table-cell align-top">
                      <Badge variant="outline" className="gap-1">
                        {getCategoryIcon(product.categoria)}
                        {(product.categoria || "Sem Categoria").trim() || "Sem Categoria"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground whitespace-nowrap align-top">
                      {product.categoria === "servico" ? "-" : formatCurrency(product.precoCusto)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-foreground whitespace-nowrap align-top">
                      {formatCurrency(product.precoVenda)}
                    </TableCell>
                    <TableCell className="text-center align-top">
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
                    <TableCell
                      className="sticky right-0 z-10 w-[96px] border-l border-border bg-card text-right align-top shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.12)] transition-colors group-hover/row:bg-muted/50 dark:bg-card dark:shadow-[-6px_0_12px_-6px_rgba(0,0,0,0.35)]"
                    >
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
                          onClick={() => setPendingDeleteId(product.dbId || product.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            setVisionQuickScanLoading(false)
            setNcmSuggestLoading(false)
            setFiscalClassifyLoading(false)
            setFormVoiceProcessing(false)
            disposeSpeechRecognition(formSpeechRecRef.current)
            formSpeechRecRef.current = null
            setFormVoiceListening(false)
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

          {/* CADASTROS-PRODUTOS-DUPLICIDADE-001 — aviso claro de produto já cadastrado. */}
          {duplicateInfo && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-semibold text-foreground">
                    {duplicateInfo.mode === "forte"
                      ? "Produto já cadastrado"
                      : "Produto provavelmente já cadastrado"}
                  </p>
                  <p className="text-muted-foreground">{duplicateInfo.message}</p>
                  <div className="rounded-md bg-background/60 p-2 min-w-0">
                    <p className="font-medium text-foreground truncate">{duplicateInfo.produto.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        duplicateInfo.produto.sku ? `SKU ${duplicateInfo.produto.sku}` : null,
                        duplicateInfo.produto.barcode ? `EAN ${duplicateInfo.produto.barcode}` : null,
                        typeof duplicateInfo.produto.stock === "number"
                          ? `Estoque atual: ${duplicateInfo.produto.stock}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem código cadastrado"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openExistingProduct(duplicateInfo.produto.id)}
                    >
                      Abrir produto existente
                    </Button>
                    {duplicateInfo.mode === "provavel" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDuplicateInfo(null)
                          void handleSave({ force: true })
                        }}
                      >
                        Cadastrar mesmo assim
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDuplicateInfo(null)}>
                      Dispensar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="geral">Dados Gerais</TabsTrigger>
              <TabsTrigger value="compatibilidade">Compatibilidade</TabsTrigger>
              <TabsTrigger value="fiscal">Dados Fiscais</TabsTrigger>
              <TabsTrigger value="controle">Controle</TabsTrigger>
            </TabsList>

            {/* Aba Compatibilidade com aparelhos (CATALOGO-APARELHOS-METADATA-MVP-001) */}
            <TabsContent value="compatibilidade" className="space-y-6">
              <ProdutoCompatibilidadeAparelhos
                value={catalogoValue}
                onChange={setCatalogoValue}
                lojaHeader={lojaHeader}
              />
            </TabsContent>

            {/* Aba Dados Gerais */}
            <TabsContent value="geral" className="space-y-6">
              {/* Upload de imagem */}
              <div className="flex items-start gap-4">
                <div 
                  role="button"
                  tabIndex={0}
                  aria-label="Área para arrastar ou colar foto do produto"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  className={cn(
                    "flex h-28 w-28 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-secondary transition-colors",
                    "hover:border-primary hover:bg-primary/5 hover:shadow-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleImageDragOver}
                  onDrop={handleImageDrop}
                >
                  {previewImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewImage} alt="Preview" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <ImageIcon className="mb-1 h-8 w-8 text-muted-foreground" />
                      <span className="px-1 text-center text-xs text-muted-foreground">Arrastar foto</span>
                    </>
                  )}
                </div>
                <input
                  id="prod-foto-upload"
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
                  <div className="flex flex-wrap gap-2">
                    <Label
                      htmlFor="prod-foto-upload"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer gap-2")}
                    >
                      <Upload className="h-4 w-4 shrink-0" />
                      Enviar
                    </Label>
                    <Button 
                      variant="outline" 
                      size="sm"
                      type="button"
                      onClick={() =>
                        toast.info("A captura por câmera web estará disponível em breve.")
                      }
                    >
                      <Camera className="mr-2 h-4 w-4" /> Câmera
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
                    <input
                      ref={formVoiceFileInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={handleFormVoiceAudioFile}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 shrink-0 border-primary/40"
                      disabled={iaSyncLoading || visionQuickScanLoading}
                      title="Identificar na foto: nome, descrição e NCM (cadastro relâmpago: áudio opcional abaixo)"
                      onClick={() => visionScanInputRef.current?.click()}
                    >
                      {iaSyncLoading || visionQuickScanLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      ) : (
                        <Camera className="w-5 h-5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant={formVoiceListening ? "destructive" : "outline"}
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      disabled={
                        iaSyncLoading || visionQuickScanLoading || formVoiceProcessing
                      }
                      title={
                        formVoiceListening
                          ? "Parar escuta"
                          : "Falar para preencher nome, preços, estoque e NCM"
                      }
                      onClick={() =>
                        formVoiceListening ? stopFormVoiceListening() : startFormVoiceListening()
                      }
                    >
                      {formVoiceProcessing ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Mic className="w-5 h-5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 shrink-0"
                      disabled={formVoiceProcessing}
                      title="Enviar arquivo de áudio (Whisper) se o reconhecimento do navegador não existir"
                      onClick={() => formVoiceFileInputRef.current?.click()}
                    >
                      <Upload className="w-5 h-5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Câmera: identifica o produto na foto. Microfone: ditado para preencher campos. Ícone de
                    envio: áudio gravado no celular.
                  </p>
                </div>

                {/* Identificação e PDV (logo após o nome) */}
                {/*
                  PRODUTO-CODIGOS-UI-PAYLOAD-FIX-002 — dois campos com destino explícito:
                  "SKU / Código interno" grava em Produto.sku; "Código de barras (EAN/GTIN)"
                  grava em Produto.barcode (e é onde o código bipado do Inventário aparece).
                */}
                <div className="sm:col-span-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sku">SKU / Código interno</Label>
                      <div className="relative">
                        <Barcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="sku"
                          value={formData.sku ?? ""}
                          onChange={(e) => setFormData((prev) => ({ ...prev, sku: e.target.value }))}
                          placeholder="Ex.: 123, ALI-001, REF-FORNECEDOR"
                          className="h-12 border border-border bg-secondary pl-10"
                          autoComplete="off"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="barcode">Código de barras (EAN/GTIN)</Label>
                      <div className="relative">
                        <Barcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="barcode"
                          value={formData.barcode ?? ""}
                          onChange={(e) => setFormData((prev) => ({ ...prev, barcode: e.target.value }))}
                          placeholder="Bipe ou digite o EAN/GTIN"
                          className="h-12 border border-border bg-secondary pl-10"
                          inputMode="numeric"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Use o SKU para o código interno da loja. Use o EAN/GTIN para o código de barras bipado.
                  </p>
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
                  <Label>Categoria *</Label>
                  <div className="space-y-2">
                    <Input
                    value={formData.categoria} 
                      onChange={(e) => setFormData((prev) => ({ ...prev, categoria: e.target.value }))}
                      placeholder="Ex.: Eletrônicos"
                      className="h-12 bg-secondary border-border"
                      list="estoque-categorias-sugestoes"
                    />
                    <datalist id="estoque-categorias-sugestoes">
                      {CATEGORIAS_SUGERIDAS_ESTOQUE.map((c) => (
                        <option key={`cat-sug-${c}`} value={c} />
                      ))}
                      {formCategoryRows.map(([slug]) => (
                        <option key={slug} value={slug} />
                      ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">
                      Você pode escolher uma sugestão ou digitar uma categoria nova (ex.: &quot;Eletrônicos&quot;).
                    </p>
                        </div>
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-lg border border-primary/25 bg-primary/5">
                <div className="flex items-start gap-2 min-w-0">
                  <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Classificação tributária automática</p>
                    <p className="text-xs text-muted-foreground">
                      IA sugere NCM, CEST, CFOP e origem com base no nome e na categoria. Valide com seu contador.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  disabled={fiscalClassifyLoading || !formData.nome.trim()}
                  onClick={handleFiscalClassify}
                >
                  {fiscalClassifyLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Classificar com IA
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="ncm">NCM</Label>
                  <div className="flex gap-2 flex-wrap items-stretch">
                  <Input
                    id="ncm"
                    value={formData.ncm || ""}
                      onChange={(e) => setFormData(prev => ({ ...prev, ncm: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                    placeholder="Ex: 85177090"
                      className="h-12 flex-1 min-w-[10rem] bg-secondary border-border"
                    maxLength={8}
                      inputMode="numeric"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 shrink-0"
                      disabled={ncmSuggestLoading || !formData.nome.trim()}
                      onClick={handleSuggestNcmFromName}
                      title="Buscar NCM pelo nome do produto (IA)"
                    >
                      {ncmSuggestLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4 mr-2" />
                      )}
                      Sugerir pelo nome
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Nomenclatura Comum do Mercosul (8 dígitos). Use a busca automática a partir do nome ou a
                    classificação completa acima.
                  </p>
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
              onClick={() => void handleSave()}
              disabled={!formData.nome || !formData.precoVenda || saveBusy}
              className="bg-primary hover:bg-primary/90"
            >
              {saveBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : editingProduct ? (
                "Salvar Alterações"
              ) : (
                "Cadastrar Item"
              )}
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
              Pré-visualização da NF-e para conferência. A gravação automática no estoque ainda não está disponível nesta fase.
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

            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                <strong>Pré-visualização:</strong> a entrada por XML ainda não grava no estoque. Confira os itens abaixo e dê entrada real em <strong>Cadastros → Estoque</strong> (Entrada manual, com livro-razão) ou pelo Importador Avançado.
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
              Fechar
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              disabled
              title="Entrada automática por XML — em breve. Use a Entrada manual em Cadastros → Estoque."
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Confirmar Entrada (em breve)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {selectedProductIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(720px,calc(100vw-2rem))] -translate-x-1/2">
          <div className="rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">{selectedProductIds.size}</span> selecionado(s)
              {selectedOnPageIds.length > 0 ? (
                <span className="text-muted-foreground"> • {selectedOnPageIds.length} nesta lista</span>
              ) : null}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setSelectedProductIds(new Set())}>
                Limpar seleção
              </Button>
              <Button type="button" variant="destructive" onClick={() => setConfirmBulkOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir selecionados
              </Button>
            </div>
          </div>
        </div>
      )}

      <TypeToConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        title="Excluir item do estoque?"
        description="Isso remove o cadastro do produto no banco de dados. Esta ação não pode ser desfeita."
        onConfirm={confirmDeleteProduct}
        busy={singleDeleting}
      />

      <TypeToConfirmDialog
        open={confirmBulkOpen}
        onOpenChange={setConfirmBulkOpen}
        title="Excluir itens selecionados?"
        description="Isso remove os itens selecionados do estoque no banco de dados. Esta ação não pode ser desfeita."
        onConfirm={bulkDeleteSelectedProducts}
        busy={bulkDeleting}
      />
    </div>
  )
}
