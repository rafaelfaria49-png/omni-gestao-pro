"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Pencil, Plus, Printer, Trash2 } from "lucide-react"
import type { StatusOrdemServico } from "@/generated/prisma"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { digitsToMoneyBrString, formatFloatToMoneyBr, parseMoneyBrToNumber } from "@/lib/money-br"
import { STATUS_OS_OPTIONS, labelStatusOS } from "@/lib/os-status"
import { imprimirViaCliente } from "@/lib/print-os-via-cliente"
import { abrirWhatsAppCliente, buildMensagemWhatsAppOs } from "@/lib/whatsapp-os"
import { useToast } from "@/hooks/use-toast"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { resolveLojaIdParaConsultaClientes } from "@/lib/clientes-loja-resolve"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { formatPhoneBrInput, isValidPhoneBr } from "@/lib/phone-br"

type ClienteOpt = { id: string; name: string; phone: string | null }

type ProdutoOpt = { id: string; name: string; stock: number; price: number; precoCusto?: number }

type OrdemItemRow = {
  id: string
  quantidade: number
  precoUnitario: number
  produto: { id: string; name: string; price: number }
}

type OrdemRow = {
  id: string
  clienteId: string | null
  equipamento: string
  defeito: string
  laudoTecnico: string | null
  valorBase: number
  valorTotal: number
  status: StatusOrdemServico
  createdAt: string
  /**
   * Pode vir null quando a OS foi importada de planilha e não existe `clienteId` (relação).
   * Nesses casos, o nome/telefone podem vir em campos "soltos" (ex.: `clienteNome`, `clienteTelefone`) no payload da API.
   */
  cliente: (ClienteOpt & { email: string | null }) | null
  clienteNome?: string | null
  clienteTelefone?: string | null
  payload?: unknown
  itens: OrdemItemRow[]
}

type LinhaForm = {
  key: string
  produtoId: string
  nome: string
  quantidade: number
  precoUnitario: number
  custoUnitario: number
}

type ChecklistEntradaKey = "liga" | "touch" | "cameras" | "botoes" | "wifi"
type ChecklistEntradaStatus = "ok" | "nok" | "nt"

type OsExtraPayload = {
  aparelho?: {
    imei?: string | null
    cor?: string | null
    senha?: string | null
    senhaTipo?: "numerica" | "padrao" | null
  }
  checklistEntrada?: Partial<Record<ChecklistEntradaKey, ChecklistEntradaStatus>>
  acessorios?: {
    chip?: boolean
    cartaoSd?: boolean
    capinha?: boolean
    carregador?: boolean
  }
  financeiro?: {
    custoPecas?: number
    valorMaoObra?: number
    valorPecas?: number
    valorTotal?: number
    formaPagamento?: string | null
    valorEntrada?: number
    dataPrevistaEntrega?: string | null
  }
}

const toastRafacell = {
  className: "border-red-600/45 bg-zinc-950 text-white shadow-xl shadow-red-900/20",
  duration: 4000,
}

function formatMoney(n: number) {
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

async function fetchOrdens(q: string, lojaHeader: string): Promise<OrdemRow[]> {
  const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
  const r = await fetch(`/api/ordens-servico${qs}`, {
    cache: "no-store",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  const j = (await r.json()) as { ordens: OrdemRow[] }
  return j.ordens.map((o) => {
    const payload = (o as unknown as { payload?: unknown }).payload
    const legacyNome =
      payload && typeof payload === "object"
        ? (payload as { cliente?: unknown; clienteNome?: unknown }).cliente ??
          (payload as { cliente?: unknown; clienteNome?: unknown }).clienteNome
        : null
    const legacyTel =
      payload && typeof payload === "object"
        ? (payload as { clienteTelefone?: unknown; telefone?: unknown }).clienteTelefone ??
          (payload as { clienteTelefone?: unknown; telefone?: unknown }).telefone
        : null

    return {
      ...o,
      clienteId: o.clienteId ?? null,
      clienteNome:
        typeof o.clienteNome === "string" && o.clienteNome.trim()
          ? o.clienteNome
          : typeof legacyNome === "string" && legacyNome.trim()
            ? legacyNome
            : null,
      clienteTelefone:
        typeof o.clienteTelefone === "string" && o.clienteTelefone.trim()
          ? o.clienteTelefone
          : typeof legacyTel === "string" && legacyTel.trim()
            ? legacyTel
            : null,
      valorBase: typeof o.valorBase === "number" ? o.valorBase : 0,
      itens: Array.isArray(o.itens) ? o.itens : [],
      createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date(o.createdAt as unknown as string).toISOString(),
    }
  })
}

async function fetchClientes(lojaHeader: string): Promise<ClienteOpt[]> {
  const r = await fetch("/api/clientes", {
    cache: "no-store",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  const j = (await r.json()) as { clientes: Array<{ id: string; name: string; phone: string | null }> }
  return j.clientes.map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }))
}

async function fetchProdutos(lojaHeader: string): Promise<ProdutoOpt[]> {
  const r = await fetch("/api/produtos", {
    cache: "no-store",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
  const j = (await r.json()) as { produtos: ProdutoOpt[] }
  return j.produtos
}

async function createOrdem(payload: Record<string, unknown>, lojaHeader: string): Promise<void> {
  const r = await fetch("/api/ordens-servico", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaHeader },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function updateOrdem(id: string, payload: Record<string, unknown>, lojaHeader: string): Promise<void> {
  const r = await fetch(`/api/ordens-servico/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaHeader },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

async function deleteOrdem(id: string, lojaHeader: string): Promise<void> {
  const r = await fetch(`/api/ordens-servico/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: { [ASSISTEC_LOJA_HEADER]: lojaHeader },
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

function valorBaseExibicao(row: OrdemRow): number {
  if (row.itens.length === 0 && (row.valorBase === 0 || row.valorBase == null)) {
    return row.valorTotal
  }
  return row.valorBase
}

function clienteNomeExibicao(row: OrdemRow): string {
  return (
    row.cliente?.name ||
    (typeof row.clienteNome === "string" ? row.clienteNome : "") ||
    "Cliente não identificado"
  )
}

function clienteTelefoneExibicao(row: OrdemRow): string | null {
  const t = row.cliente?.phone ?? (typeof row.clienteTelefone === "string" ? row.clienteTelefone : null)
  return t && t.trim() ? t : null
}

function readExtraPayload(rowPayload: unknown): OsExtraPayload {
  if (!rowPayload || typeof rowPayload !== "object") return {}
  const p = rowPayload as Record<string, unknown>
  const aparelho = p.aparelho && typeof p.aparelho === "object" ? (p.aparelho as Record<string, unknown>) : null
  const checklistEntrada =
    p.checklistEntrada && typeof p.checklistEntrada === "object" ? (p.checklistEntrada as Record<string, unknown>) : null
  const acessorios =
    p.acessorios && typeof p.acessorios === "object" ? (p.acessorios as Record<string, unknown>) : null
  const financeiro =
    p.financeiro && typeof p.financeiro === "object" ? (p.financeiro as Record<string, unknown>) : null

  const pickStatus = (v: unknown): ChecklistEntradaStatus | undefined =>
    v === "ok" || v === "nok" || v === "nt" ? v : undefined

  return {
    aparelho: aparelho
      ? {
          imei: typeof aparelho.imei === "string" ? aparelho.imei : null,
          cor: typeof aparelho.cor === "string" ? aparelho.cor : null,
          senha: typeof aparelho.senha === "string" ? aparelho.senha : null,
          senhaTipo: aparelho.senhaTipo === "numerica" || aparelho.senhaTipo === "padrao" ? aparelho.senhaTipo : null,
        }
      : undefined,
    checklistEntrada: checklistEntrada
      ? {
          liga: pickStatus(checklistEntrada.liga),
          touch: pickStatus(checklistEntrada.touch),
          cameras: pickStatus(checklistEntrada.cameras),
          botoes: pickStatus(checklistEntrada.botoes),
          wifi: pickStatus(checklistEntrada.wifi),
        }
      : undefined,
    acessorios: acessorios
      ? {
          chip: acessorios.chip === true,
          cartaoSd: acessorios.cartaoSd === true,
          capinha: acessorios.capinha === true,
          carregador: acessorios.carregador === true,
        }
      : undefined,
    financeiro: financeiro
      ? {
          custoPecas: typeof financeiro.custoPecas === "number" && Number.isFinite(financeiro.custoPecas) ? financeiro.custoPecas : undefined,
          valorMaoObra:
            typeof financeiro.valorMaoObra === "number" && Number.isFinite(financeiro.valorMaoObra) ? financeiro.valorMaoObra : undefined,
          valorPecas: typeof financeiro.valorPecas === "number" && Number.isFinite(financeiro.valorPecas) ? financeiro.valorPecas : undefined,
          valorTotal: typeof financeiro.valorTotal === "number" && Number.isFinite(financeiro.valorTotal) ? financeiro.valorTotal : undefined,
          formaPagamento: typeof financeiro.formaPagamento === "string" ? financeiro.formaPagamento : null,
          valorEntrada:
            typeof financeiro.valorEntrada === "number" && Number.isFinite(financeiro.valorEntrada) ? financeiro.valorEntrada : undefined,
          dataPrevistaEntrega: typeof financeiro.dataPrevistaEntrega === "string" ? financeiro.dataPrevistaEntrega : null,
        }
      : undefined,
  }
}

async function fetchIsAdmin(): Promise<boolean> {
  const r = await fetch("/api/auth/admin", { method: "GET", cache: "no-store", credentials: "include" })
  if (!r.ok) return false
  const j = (await r.json().catch(() => ({}))) as { authenticated?: boolean }
  return j.authenticated === true
}

async function createClienteInline(lojaHeader: string, payload: { name: string; phone: string; email?: string }): Promise<void> {
  const r = await fetch("/api/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json", [ASSISTEC_LOJA_HEADER]: lojaHeader },
    credentials: "include",
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `HTTP ${r.status}`)
  }
}

export default function DashboardOsPage() {
  const { toast } = useToast()
  const { lojaAtivaId } = useLojaAtiva()
  const lojaHeader = useMemo(() => resolveLojaIdParaConsultaClientes(lojaAtivaId), [lojaAtivaId])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [rows, setRows] = useState<OrdemRow[]>([])
  const [clientes, setClientes] = useState<ClienteOpt[]>([])
  const [clientesError, setClientesError] = useState<string | null>(null)
  const [produtos, setProdutos] = useState<ProdutoOpt[]>([])
  const [produtosError, setProdutosError] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"dispositivo" | "checklist" | "financeiro">("dispositivo")
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)
  const [clientePickerOpen, setClientePickerOpen] = useState(false)
  const [clienteSearch, setClienteSearch] = useState("")
  const [novoClienteOpen, setNovoClienteOpen] = useState(false)
  const [novoClienteNome, setNovoClienteNome] = useState("")
  const [novoClienteTel, setNovoClienteTel] = useState("")
  const [novoClienteEmail, setNovoClienteEmail] = useState("")
  const [novoClienteError, setNovoClienteError] = useState<string | null>(null)
  const [clienteId, setClienteId] = useState("")
  const [equipamento, setEquipamento] = useState("")
  const [imei, setImei] = useState("")
  const [corAparelho, setCorAparelho] = useState("")
  const [senhaAparelho, setSenhaAparelho] = useState("")
  const [senhaTipo, setSenhaTipo] = useState<"numerica" | "padrao">("numerica")
  const [checkLiga, setCheckLiga] = useState<ChecklistEntradaStatus>("nt")
  const [checkTouch, setCheckTouch] = useState<ChecklistEntradaStatus>("nt")
  const [checkCameras, setCheckCameras] = useState<ChecklistEntradaStatus>("nt")
  const [checkBotoes, setCheckBotoes] = useState<ChecklistEntradaStatus>("nt")
  const [checkWifi, setCheckWifi] = useState<ChecklistEntradaStatus>("nt")
  const [accChip, setAccChip] = useState(false)
  const [accCartaoSd, setAccCartaoSd] = useState(false)
  const [accCapinha, setAccCapinha] = useState(false)
  const [accCarregador, setAccCarregador] = useState(false)
  const [defeito, setDefeito] = useState("")
  const [laudoTecnico, setLaudoTecnico] = useState("")
  const [valorBaseStr, setValorBaseStr] = useState("")
  const [formaPagamento, setFormaPagamento] = useState<string>("")
  const [valorEntradaStr, setValorEntradaStr] = useState("")
  const [dataPrevistaEntrega, setDataPrevistaEntrega] = useState("")
  const [linhas, setLinhas] = useState<LinhaForm[]>([])
  const [pickProdutoId, setPickProdutoId] = useState<string>("")
  const [status, setStatus] = useState<StatusOrdemServico>("Aberto")

  const [deleteTarget, setDeleteTarget] = useState<OrdemRow | null>(null)

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.equipamento.toLowerCase().includes(q) ||
        clienteNomeExibicao(r).toLowerCase().includes(q) ||
        r.defeito.toLowerCase().includes(q)
    )
  }, [rows, query])

  const loadClientes = useCallback(async (): Promise<ClienteOpt[]> => {
    setClientesError(null)
    try {
      const list = await fetchClientes(lojaHeader)
      setClientes(list)
      return list
    } catch (e) {
      setClientesError(e instanceof Error ? e.message : String(e))
      setClientes([])
      return []
    }
  }, [lojaHeader])

  const loadProdutos = useCallback(async () => {
    setProdutosError(null)
    try {
      const list = await fetchProdutos(lojaHeader)
      setProdutos(list)
    } catch (e) {
      setProdutosError(e instanceof Error ? e.message : String(e))
    }
  }, [lojaHeader])

  useEffect(() => {
    void loadClientes()
    void loadProdutos()
  }, [loadClientes, loadProdutos])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const ok = await fetchIsAdmin()
        if (!cancelled) setIsAdmin(ok)
      } catch {
        if (!cancelled) setIsAdmin(false)
      } finally {
        if (!cancelled) setAdminChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError(null)
    void fetchOrdens(query, lojaHeader)
      .then((data) => {
        if (cancelled) return
        setRows(data)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setListError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, lojaHeader])

  const parsedValorBase = useMemo(() => parseMoneyBrToNumber(valorBaseStr), [valorBaseStr])
  const parsedValorEntrada = useMemo(() => parseMoneyBrToNumber(valorEntradaStr), [valorEntradaStr])

  const somaPecas = useMemo(() => linhas.reduce((acc, l) => acc + l.precoUnitario * l.quantidade, 0), [linhas])
  const somaCustoPecas = useMemo(() => linhas.reduce((acc, l) => acc + l.custoUnitario * l.quantidade, 0), [linhas])

  const totalOs = useMemo(() => parsedValorBase + somaPecas, [parsedValorBase, somaPecas])
  const lucroBrutoEstimado = useMemo(() => totalOs - somaCustoPecas, [totalOs, somaCustoPecas])

  const canSubmit =
    (clienteId || "").trim() &&
    equipamento.trim() &&
    defeito.trim() &&
    Number.isFinite(parsedValorBase) &&
    parsedValorBase >= 0 &&
    !submitting

  const reload = async () => {
    setLoading(true)
    try {
      const data = await fetchOrdens(query, lojaHeader)
      setRows(data)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const addLinhaProduto = () => {
    const pid = pickProdutoId.trim()
    if (!pid) return
    const p = produtos.find((x) => x.id === pid)
    if (!p) return
    setLinhas((prev) => {
      const idx = prev.findIndex((l) => l.produtoId === pid)
      if (idx >= 0) {
        const next = [...prev]
        const q = next[idx].quantidade + 1
        if (p.stock < q) {
          toast({
            title: "Estoque insuficiente",
            description: `Disponível: ${p.stock} · ${p.name}`,
            variant: "destructive",
          })
          return prev
        }
        next[idx] = { ...next[idx], quantidade: q }
        return next
      }
      if (p.stock < 1) {
        toast({ title: "Produto esgotado", description: p.name, variant: "destructive" })
        return prev
      }
      return [
        ...prev,
        {
          key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          produtoId: p.id,
          nome: p.name,
          quantidade: 1,
          precoUnitario: p.price,
          custoUnitario: typeof p.precoCusto === "number" && Number.isFinite(p.precoCusto) ? p.precoCusto : 0,
        },
      ]
    })
    setPickProdutoId("")
  }

  const updateQtyLinha = (key: string, q: number) => {
    const qty = Math.max(1, Math.floor(q))
    setLinhas((prev) => {
      const next = prev.map((l) => {
        if (l.key !== key) return l
        const p = produtos.find((x) => x.id === l.produtoId)
        const max = p?.stock ?? 0
        if (qty > max) {
          toast({
            title: "Estoque insuficiente",
            description: `Máximo disponível agora: ${max} · ${l.nome}`,
            variant: "destructive",
          })
          return { ...l, quantidade: max }
        }
        return { ...l, quantidade: qty }
      })
      return next
    })
  }

  const removeLinha = (key: string) => {
    setLinhas((prev) => prev.filter((l) => l.key !== key))
  }

  const openCreateModal = () => {
    setFormError(null)
    setModalMode("create")
    setEditingId(null)
    setActiveTab("dispositivo")
    setClienteId(clientes[0]?.id ?? "")
    setEquipamento("")
    setImei("")
    setCorAparelho("")
    setSenhaAparelho("")
    setSenhaTipo("numerica")
    setCheckLiga("nt")
    setCheckTouch("nt")
    setCheckCameras("nt")
    setCheckBotoes("nt")
    setCheckWifi("nt")
    setAccChip(false)
    setAccCartaoSd(false)
    setAccCapinha(false)
    setAccCarregador(false)
    setDefeito("")
    setLaudoTecnico("")
    setValorBaseStr(formatFloatToMoneyBr(0))
    setFormaPagamento("")
    setValorEntradaStr(formatFloatToMoneyBr(0))
    setDataPrevistaEntrega("")
    setLinhas([])
    setPickProdutoId("")
    setStatus("Aberto")
    setModalOpen(true)
  }

  const openEditModal = (row: OrdemRow) => {
    setFormError(null)
    setModalMode("edit")
    setEditingId(row.id)
    setActiveTab("dispositivo")
    if (row.clienteId) {
      setClienteId(row.clienteId)
    } else {
      const nome = (row.clienteNome || "").trim()
      const hit = nome
        ? clientes.find((c) => c.name.trim().toLowerCase() === nome.toLowerCase())
        : undefined
      setClienteId(hit?.id ?? "")
    }
    setEquipamento(row.equipamento)
    const extra = readExtraPayload(row.payload)
    setImei((extra.aparelho?.imei || "").trim())
    setCorAparelho((extra.aparelho?.cor || "").trim())
    setSenhaAparelho((extra.aparelho?.senha || "").trim())
    setSenhaTipo(extra.aparelho?.senhaTipo === "padrao" ? "padrao" : "numerica")
    setCheckLiga(extra.checklistEntrada?.liga ?? "nt")
    setCheckTouch(extra.checklistEntrada?.touch ?? "nt")
    setCheckCameras(extra.checklistEntrada?.cameras ?? "nt")
    setCheckBotoes(extra.checklistEntrada?.botoes ?? "nt")
    setCheckWifi(extra.checklistEntrada?.wifi ?? "nt")
    setAccChip(extra.acessorios?.chip === true)
    setAccCartaoSd(extra.acessorios?.cartaoSd === true)
    setAccCapinha(extra.acessorios?.capinha === true)
    setAccCarregador(extra.acessorios?.carregador === true)
    setDefeito(row.defeito)
    setLaudoTecnico(row.laudoTecnico ?? "")
    setValorBaseStr(formatFloatToMoneyBr(valorBaseExibicao(row)))
    setFormaPagamento((extra.financeiro?.formaPagamento || "").trim())
    setValorEntradaStr(formatFloatToMoneyBr(extra.financeiro?.valorEntrada ?? 0))
    setDataPrevistaEntrega((extra.financeiro?.dataPrevistaEntrega || "").trim())
    const costsFromPayload =
      row.payload && typeof row.payload === "object" ? (row.payload as { itensCost?: unknown }).itensCost : null
    const costByProdutoId = new Map<string, number>()
    if (Array.isArray(costsFromPayload)) {
      for (const c of costsFromPayload) {
        if (!c || typeof c !== "object") continue
        const o = c as { produtoId?: unknown; custoUnitario?: unknown }
        const pid = typeof o.produtoId === "string" ? o.produtoId : ""
        const cu = typeof o.custoUnitario === "number" && Number.isFinite(o.custoUnitario) ? o.custoUnitario : NaN
        if (pid && Number.isFinite(cu)) costByProdutoId.set(pid, cu)
      }
    }
    setLinhas(
      row.itens.map((it) => ({
        key: it.id,
        produtoId: it.produto.id,
        nome: it.produto.name,
        quantidade: it.quantidade,
        precoUnitario: it.precoUnitario,
        custoUnitario:
          costByProdutoId.get(it.produto.id) ??
          (typeof (it.produto as any).precoCusto === "number" && Number.isFinite((it.produto as any).precoCusto)
            ? (it.produto as any).precoCusto
            : 0),
      }))
    )
    setPickProdutoId("")
    setStatus(row.status)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (submitting) return
    setModalOpen(false)
  }

  const submit = async () => {
    if (!(clienteId || "").trim()) {
      setFormError("Selecione um cliente.")
      return
    }
    if (!equipamento.trim()) {
      setFormError("Informe o equipamento.")
      return
    }
    if (!defeito.trim()) {
      setFormError("Descreva o defeito.")
      return
    }
    if (!Number.isFinite(parsedValorBase) || parsedValorBase < 0) {
      setFormError("Informe um valor base válido (mão de obra / serviço sem peças).")
      return
    }
    if (Number.isFinite(parsedValorEntrada) && parsedValorEntrada < 0) {
      setFormError("Informe um valor de entrada válido.")
      return
    }
    const payload = {
      clienteId: (clienteId || "").trim(),
      equipamento: equipamento.trim(),
      defeito: defeito.trim(),
      laudoTecnico: laudoTecnico.trim() || undefined,
      valorBase: parsedValorBase,
      itens: linhas.map((l) => ({ produtoId: l.produtoId, quantidade: l.quantidade })),
      payload: {
        clienteNome: clientes.find((c) => c.id === (clienteId || "").trim())?.name || null,
        clienteTelefone: clientes.find((c) => c.id === (clienteId || "").trim())?.phone || null,
        aparelho: {
          imei: imei.trim() || null,
          cor: corAparelho.trim() || null,
          senha: senhaAparelho.trim() || null,
          senhaTipo,
        },
        checklistEntrada: {
          liga: checkLiga,
          touch: checkTouch,
          cameras: checkCameras,
          botoes: checkBotoes,
          wifi: checkWifi,
        },
        acessorios: {
          chip: accChip,
          cartaoSd: accCartaoSd,
          capinha: accCapinha,
          carregador: accCarregador,
        },
        itensCost: linhas.map((l) => ({
          produtoId: l.produtoId,
          custoUnitario: Number.isFinite(l.custoUnitario) ? l.custoUnitario : 0,
        })),
        financeiro: {
          custoPecas: somaCustoPecas,
          valorMaoObra: parsedValorBase,
          valorPecas: somaPecas,
          valorTotal: totalOs,
          formaPagamento: formaPagamento.trim() || null,
          valorEntrada: parsedValorEntrada,
          dataPrevistaEntrega: dataPrevistaEntrega.trim() || null,
        },
      },
      status,
    }
    setSubmitting(true)
    setFormError(null)
    try {
      if (modalMode === "edit" && editingId) {
        await updateOrdem(editingId, payload, lojaHeader)
        toast({ title: "OS atualizada", description: "Ordem salva com sucesso.", ...toastRafacell })
      } else {
        await createOrdem(payload, lojaHeader)
        toast({ title: "OS aberta", description: "Nova ordem de serviço criada.", ...toastRafacell })
      }
      setModalOpen(false)
      await reload()
      void loadProdutos()
    } catch (e2) {
      setFormError(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteOrdem(deleteTarget.id, lojaHeader)
      toast({ title: "OS excluída", description: "A ordem foi removida.", ...toastRafacell })
      setDeleteTarget(null)
      await reload()
      void loadProdutos()
    } catch (e2) {
      setDeleteError(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setDeleting(false)
    }
  }

  const handlePrint = (row: OrdemRow) => {
    const extra = readExtraPayload(row.payload)
    imprimirViaCliente({
      id: row.id,
      clienteNome: clienteNomeExibicao(row),
      clienteTelefone: clienteTelefoneExibicao(row),
      equipamento: row.equipamento,
      imei: extra.aparelho?.imei ?? null,
      corAparelho: extra.aparelho?.cor ?? null,
      senhaAparelho: extra.aparelho?.senha ?? null,
      checklistEntrada: extra.checklistEntrada,
      acessorios: extra.acessorios,
      valorMaoObra: extra.financeiro?.valorMaoObra ?? row.valorBase,
      custoPecas: extra.financeiro?.custoPecas,
      valorPecas: extra.financeiro?.valorPecas,
      defeito: row.defeito,
      laudoTecnico: row.laudoTecnico,
      valorTotal: row.valorTotal,
      status: row.status,
      createdAt: row.createdAt,
    })
  }

  const handleWhatsApp = (row: OrdemRow) => {
    const msg = buildMensagemWhatsAppOs({
      clienteNome: clienteNomeExibicao(row),
      equipamento: row.equipamento,
      defeito: row.defeito,
      status: row.status,
      valorTotal: row.valorTotal,
      osId: row.id,
    })
    const ok = abrirWhatsAppCliente(clienteTelefoneExibicao(row), msg)
    if (!ok) {
      toast({
        title: "WhatsApp",
        description: "Cadastre um telefone válido no cliente para enviar mensagem.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-black">Ordens de Serviço</h1>
            <p className="text-sm text-black/70">Gestão de ordens de serviço</p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            disabled={clientes.length === 0 && !clientesError}
            className="h-10 rounded-md bg-red-600 px-4 text-white transition-colors hover:bg-red-500 active:bg-red-700 disabled:opacity-50"
          >
            Nova OS
          </button>
        </div>

        {clientesError ? (
          <div className="rounded-md border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Não foi possível carregar clientes: {clientesError}. Cadastre clientes em Gestão de Clientes.
          </div>
        ) : null}

        {produtosError ? (
          <div className="rounded-md border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Estoque indisponível para vínculo: {produtosError}
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <label className="text-sm text-black/70">Buscar (cliente, equipamento, defeito)</label>
              <div className="mt-1 flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setQuery(search)
                  }}
                  placeholder="Ex.: iPhone ou nome do cliente"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
                <button
                  type="button"
                  onClick={() => setQuery(search)}
                  className="h-10 rounded-md border border-border bg-background px-4 text-black transition-colors hover:bg-muted"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("")
                    setQuery("")
                  }}
                  className="h-10 rounded-md border border-border bg-background px-4 text-black/70 transition-colors hover:bg-muted"
                >
                  Limpar
                </button>
              </div>
            </div>

            <div className="text-sm text-black/70">{loading ? "Carregando…" : `${filteredRows.length} OS`}</div>
          </div>

          {listError ? (
            <div className="mt-4 rounded-md border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">{listError}</div>
          ) : null}

          <div className="mt-4 overflow-x-auto overflow-hidden rounded-lg border border-border">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-background/60">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold text-black">Cliente</th>
                  <th className="px-4 py-3 font-semibold text-black">Equipamento</th>
                  <th className="px-4 py-3 font-semibold text-black">Status</th>
                  <th className="px-4 py-3 font-semibold text-black">Valor</th>
                  <th className="px-4 py-3 text-right font-semibold text-black">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-black/70">
                      Carregando…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-black/70">
                      Nenhuma OS encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className="border-t border-border transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 text-black">
                        <div className="font-medium">{clienteNomeExibicao(r)}</div>
                        <div className="text-xs text-black/70 tabular-nums">OS {r.id.slice(0, 8)}…</div>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-black" title={r.equipamento}>
                        {r.equipamento}
                      </td>
                      <td className="px-4 py-3 text-black">{labelStatusOS(r.status)}</td>
                      <td className="px-4 py-3 tabular-nums text-black">{formatMoney(r.valorTotal)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handlePrint(r)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-600 bg-transparent px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Via cliente
                          </button>
                          <button
                            type="button"
                            onClick={() => handleWhatsApp(r)}
                            title="WhatsApp"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#1AAE52] bg-[#25D366] text-white shadow-sm transition-colors hover:bg-[#1FB85A] active:bg-[#169947]"
                          >
                            <WhatsAppIcon className="h-4 w-4 drop-shadow-[0_1px_0_rgba(0,0,0,0.45)]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 active:bg-blue-800"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null)
                              setDeleteTarget(r)
                            }}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-500 active:bg-red-800"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-black">{modalMode === "edit" ? "Editar OS" : "Nova OS"}</h2>
                <p className="text-sm text-black/70">Cliente, equipamento, peças do estoque e valores.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="h-9 w-9 shrink-0 rounded-md border border-border bg-background text-black/70 transition-colors hover:bg-muted"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="dispositivo">1. Dispositivo</TabsTrigger>
                  <TabsTrigger value="checklist">2. Checklist</TabsTrigger>
                  <TabsTrigger value="financeiro">3. Financeiro</TabsTrigger>
                </TabsList>

                <TabsContent value="dispositivo" className="mt-4 space-y-3">
              <div>
                <label className="text-sm text-black/70">
                  Cliente <span className="text-red-400">*</span>
                </label>
                <Popover open={clientePickerOpen} onOpenChange={setClientePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "mt-1 flex h-10 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-left text-black",
                        !(clienteId || "").trim() && "text-black/50"
                      )}
                      aria-expanded={clientePickerOpen}
                    >
                      <span className="truncate">
                        {clientes.find((c) => c.id === (clienteId || "").trim())?.name || "Buscar cliente…"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput
                        value={clienteSearch}
                        onValueChange={setClienteSearch}
                        placeholder="Digite nome/telefone…"
                        className="text-black placeholder:text-black/50"
                      />
                      <CommandList>
                        <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            onSelect={() => {
                              setClientePickerOpen(false)
                              setNovoClienteError(null)
                              setNovoClienteNome("")
                              setNovoClienteTel("")
                              setNovoClienteEmail("")
                              setNovoClienteOpen(true)
                            }}
                            className="text-black"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            + Novo Cliente
                          </CommandItem>
                        </CommandGroup>
                        <CommandSeparator />
                        <CommandGroup>
                          {clientes
                            .filter((c) => {
                              const q = clienteSearch.trim().toLowerCase()
                              if (!q) return true
                              return c.name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q)
                            })
                            .slice(0, 60)
                            .map((c) => (
                              <CommandItem
                                key={c.id}
                                value={`${c.name} ${c.phone ?? ""}`}
                                onSelect={() => {
                                  setClienteId(c.id)
                                  setClientePickerOpen(false)
                                }}
                                className="text-black"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    c.id === (clienteId || "").trim() ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">
                                  {c.name}
                                  {c.phone ? ` · ${c.phone}` : ""}
                                </span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {novoClienteOpen ? (
                <div className="rounded-lg border border-border bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-black">Novo cliente</p>
                    <button
                      type="button"
                      className="text-xs text-black/70 hover:underline"
                      onClick={() => setNovoClienteOpen(false)}
                    >
                      fechar
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-sm text-black/70">Nome *</label>
                      <input
                        value={novoClienteNome}
                        onChange={(e) => setNovoClienteNome(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black"
                        placeholder="Nome do cliente"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-black/70">Telefone *</label>
                      <input
                        value={novoClienteTel}
                        onChange={(e) => setNovoClienteTel(formatPhoneBrInput(e.target.value))}
                        className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black"
                        placeholder="(11) 99999-0000"
                        inputMode="tel"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-black/70">E-mail (opcional)</label>
                      <input
                        value={novoClienteEmail}
                        onChange={(e) => setNovoClienteEmail(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black"
                        placeholder="cliente@email.com"
                        inputMode="email"
                      />
                    </div>
                  </div>
                  {novoClienteError ? <p className="mt-2 text-sm text-red-600">{novoClienteError}</p> : null}
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm text-black hover:bg-muted"
                      onClick={() => setNovoClienteOpen(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-md bg-black px-3 text-sm font-semibold text-white hover:bg-zinc-900"
                      onClick={async () => {
                        const n = novoClienteNome.trim()
                        const t = novoClienteTel.trim()
                        const e = novoClienteEmail.trim()
                        if (!n) return setNovoClienteError('O campo "Nome" é obrigatório.')
                        if (!t || !isValidPhoneBr(t)) return setNovoClienteError("Informe um telefone válido com DDD.")
                        setNovoClienteError(null)
                        try {
                          await createClienteInline(lojaHeader, { name: n, phone: t, ...(e ? { email: e } : {}) })
                          const list = await loadClientes()
                          const hit =
                            list.find(
                              (c) => c.name.trim().toLowerCase() === n.toLowerCase() && (c.phone ?? "") === t
                            ) ?? null
                          if (hit?.id) setClienteId(hit.id)
                          setNovoClienteOpen(false)
                        } catch (err) {
                          setNovoClienteError(err instanceof Error ? err.message : String(err))
                        }
                      }}
                    >
                      Salvar cliente
                    </button>
                  </div>
                </div>
              ) : null}
              <div>
                <label className="text-sm text-black/70">
                  Equipamento <span className="text-red-400">*</span>
                </label>
                <input
                  value={equipamento}
                  onChange={(e) => setEquipamento(e.target.value)}
                  placeholder="Ex.: iPhone 11"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-sm text-black/70">IMEI</label>
                  <input
                    value={imei}
                    onChange={(e) => setImei(e.target.value)}
                    placeholder="Somente números"
                    inputMode="numeric"
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                  />
                </div>
                <div>
                  <label className="text-sm text-black/70">Cor</label>
                  <input
                    value={corAparelho}
                    onChange={(e) => setCorAparelho(e.target.value)}
                    placeholder="Ex.: Preto, Azul"
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                  />
                </div>
                <div>
                  <label className="text-sm text-black/70">Senha do aparelho</label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <Select value={senhaTipo} onValueChange={(v) => setSenhaTipo(v as any)}>
                      <SelectTrigger className="h-10 w-full border-border bg-background text-black">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="numerica">Senha Numérica</SelectItem>
                        <SelectItem value="padrao">Desenho/Padrão</SelectItem>
                      </SelectContent>
                    </Select>
                    <input
                      value={senhaAparelho}
                      onChange={(e) => setSenhaAparelho(e.target.value)}
                      placeholder={senhaTipo === "numerica" ? "Ex.: 1234" : "Ex.: padrão"}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm text-black/70">
                  Defeito <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={defeito}
                  onChange={(e) => setDefeito(e.target.value)}
                  placeholder="Descrição do problema"
                  rows={3}
                  className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>
              <div>
                <label className="text-sm text-black/70">Laudo técnico (opcional)</label>
                <textarea
                  value={laudoTecnico}
                  onChange={(e) => setLaudoTecnico(e.target.value)}
                  placeholder="Observações internas / laudo"
                  rows={3}
                  className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-black placeholder:text-black/50 focus:outline-none focus:ring-2 focus:ring-red-600/40"
                />
              </div>

                </TabsContent>

                <TabsContent value="checklist" className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-sm font-medium text-black">Checklist de entrada</p>
                <p className="text-xs text-black/70">Marque rapidamente o estado do aparelho na entrada.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Liga", checkLiga, setCheckLiga],
                      ["Touch", checkTouch, setCheckTouch],
                      ["Câmeras", checkCameras, setCheckCameras],
                      ["Botões", checkBotoes, setCheckBotoes],
                      ["Wi‑Fi", checkWifi, setCheckWifi],
                    ] as const
                  ).map(([label, value, setValue]) => (
                    <div key={label} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
                      <span className="text-sm font-medium text-black">{label}</span>
                      <div className="inline-flex overflow-hidden rounded-md border border-border">
                        <button
                          type="button"
                          onClick={() => setValue("ok")}
                          className={cn(
                            "h-8 px-3 text-xs font-semibold transition-colors",
                            value === "ok" ? "bg-emerald-600 text-white" : "bg-background text-black hover:bg-muted"
                          )}
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setValue("nok")}
                          className={cn(
                            "h-8 px-3 text-xs font-semibold transition-colors border-l border-border",
                            value === "nok" ? "bg-red-600 text-white" : "bg-background text-black hover:bg-muted"
                          )}
                        >
                          N/OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setValue("nt")}
                          className={cn(
                            "h-8 px-3 text-xs font-semibold transition-colors border-l border-border",
                            value === "nt" ? "bg-black text-white" : "bg-background text-black hover:bg-muted"
                          )}
                        >
                          N/T
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-sm font-medium text-black">Acessórios</p>
                <p className="text-xs text-black/70">Selecione o que veio junto com o aparelho.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-black">
                    <input type="checkbox" checked={accChip} onChange={(e) => setAccChip(e.target.checked)} />
                    Chip
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-black">
                    <input type="checkbox" checked={accCartaoSd} onChange={(e) => setAccCartaoSd(e.target.checked)} />
                    Cartão SD
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-black">
                    <input type="checkbox" checked={accCapinha} onChange={(e) => setAccCapinha(e.target.checked)} />
                    Capinha
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-black">
                    <input type="checkbox" checked={accCarregador} onChange={(e) => setAccCarregador(e.target.checked)} />
                    Carregador
                  </label>
                </div>
              </div>

                </TabsContent>

                <TabsContent value="financeiro" className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-sm font-medium text-black">Peças do estoque</p>
                <p className="text-xs text-black/70">Ao salvar, o sistema dá baixa no estoque e soma ao total da OS.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="text-xs text-black/70">Produto</label>
                    <Select value={pickProdutoId || undefined} onValueChange={setPickProdutoId}>
                      <SelectTrigger className="mt-0.5 h-10 w-full border-border bg-background text-black">
                        <SelectValue placeholder="Selecione uma peça" />
                      </SelectTrigger>
                      <SelectContent>
                        {produtos.map((p) => (
                          <SelectItem key={p.id} value={p.id} disabled={p.stock < 1}>
                            {p.name} — est. {p.stock} — {formatMoney(p.price)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={addLinhaProduto}
                    className="h-10 shrink-0 rounded-md border border-red-600/60 bg-red-950/30 px-4 text-sm font-medium text-red-300 hover:bg-red-900/40"
                  >
                    Adicionar
                  </button>
                </div>
                {linhas.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {linhas.map((l) => (
                      <li
                        key={l.key}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-black">{l.nome}</span>
                        <span className="text-black/70 tabular-nums">{formatMoney(l.precoUnitario)} venda</span>
                        <span className="text-black/70 tabular-nums">{formatMoney(l.custoUnitario)} custo</span>
                        <input
                          type="number"
                          min={1}
                          value={l.quantidade}
                          onChange={(e) => updateQtyLinha(l.key, parseInt(e.target.value, 10) || 1)}
                          className="h-8 w-16 rounded border border-border bg-background px-2 text-center text-black tabular-nums"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={Number.isFinite(l.custoUnitario) ? l.custoUnitario : 0}
                          onChange={(e) => {
                            const v = Number(String(e.target.value ?? "0").replace(",", "."))
                            const custoUnitario = Number.isFinite(v) && v >= 0 ? v : 0
                            setLinhas((prev) => prev.map((x) => (x.key === l.key ? { ...x, custoUnitario } : x)))
                          }}
                          className="h-8 w-24 rounded border border-border bg-background px-2 text-center text-black tabular-nums"
                          aria-label="Custo unitário"
                        />
                        <span className="tabular-nums text-black">{formatMoney(l.precoUnitario * l.quantidade)}</span>
                        <button
                          type="button"
                          onClick={() => removeLinha(l.key)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          remover
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-black/70">Nenhuma peça vinculada.</p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm text-black/70">
                    Valor mão de obra (serviço / sem peças) <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={valorBaseStr}
                    onChange={(e) => setValorBaseStr(digitsToMoneyBrString(e.target.value))}
                    placeholder="R$ 0,00"
                    inputMode="decimal"
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black focus:outline-none focus:ring-2 focus:ring-red-600/40"
                  />
                </div>
                <div>
                  <label className="text-sm text-black/70">Forma de pagamento</label>
                  <Select value={formaPagamento || undefined} onValueChange={setFormaPagamento}>
                    <SelectTrigger className="mt-1 h-10 w-full border-border bg-background text-black">
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      {["Dinheiro", "PIX", "Cartão de Crédito", "Cartão de Débito", "Boleto/Carnê", "Transferência"].map((x) => (
                        <SelectItem key={x} value={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-black/70">Valor de entrada (sinal)</label>
                  <input
                    value={valorEntradaStr}
                    onChange={(e) => setValorEntradaStr(digitsToMoneyBrString(e.target.value))}
                    placeholder="R$ 0,00"
                    inputMode="decimal"
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black focus:outline-none focus:ring-2 focus:ring-red-600/40"
                  />
                </div>
                <div>
                  <label className="text-sm text-black/70">Data prevista de entrega</label>
                  <input
                    type="date"
                    value={dataPrevistaEntrega}
                    onChange={(e) => setDataPrevistaEntrega(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-black focus:outline-none focus:ring-2 focus:ring-red-600/40"
                  />
                </div>
                <div>
                  <label className="text-sm text-black/70">Status</label>
                  <Select value={status} onValueChange={(v) => setStatus(v as StatusOrdemServico)}>
                    <SelectTrigger className="mt-1 h-10 w-full border-border bg-background text-black">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-red-900/40 bg-zinc-950/50 px-4 py-3">
                <div className="flex justify-between text-sm text-black/70">
                  <span>Subtotal peças</span>
                  <span className="tabular-nums text-black">{formatMoney(somaPecas)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm text-black/70">
                  <span>Custo peças</span>
                  <span className="tabular-nums text-black">{formatMoney(somaCustoPecas)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm text-black/70">
                  <span>Valor base</span>
                  <span className="tabular-nums text-black">{formatMoney(parsedValorBase)}</span>
                </div>
                {adminChecked && isAdmin ? (
                  <div className="mt-1 flex justify-between text-sm text-black/70">
                    <span>Lucro bruto (admin)</span>
                    <span className="tabular-nums text-black">{formatMoney(lucroBrutoEstimado)}</span>
                  </div>
                ) : null}
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold text-black">
                  <span>Total da OS</span>
                  <span className="tabular-nums text-red-400">{formatMoney(totalOs)}</span>
                </div>
              </div>
                </TabsContent>
              </Tabs>
            </div>

            {formError ? (
              <div className="mt-4 rounded-md border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-200">{formError}</div>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="h-10 rounded-md border border-border bg-background px-4 text-black transition-colors hover:bg-muted"
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                className="h-10 rounded-md bg-red-600 px-4 text-white transition-colors hover:bg-red-500 active:bg-red-700 disabled:opacity-60"
                disabled={!canSubmit}
              >
                {submitting ? "Salvando…" : modalMode === "edit" ? "Salvar" : "Abrir OS"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-black">Excluir ordem de serviço?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {deleteTarget ? (
                <>
                  Confirma a exclusão da OS de{" "}
                  <span className="font-medium text-black">{clienteNomeExibicao(deleteTarget)}</span> —{" "}
                  {deleteTarget.equipamento}? O estoque das peças será devolvido.
                </>
              ) : null}
              {deleteError ? <p className="text-sm text-red-400">{deleteError}</p> : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className={cn(buttonVariants(), "bg-red-600 text-white hover:bg-red-500")}
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
