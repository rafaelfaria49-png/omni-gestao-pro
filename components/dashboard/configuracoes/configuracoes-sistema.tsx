"use client"

import { useState, useEffect } from "react"
import { 
  Building2, 
  Save, 
  RotateCcw,
  Shield,
  Phone,
  Mail,
  Receipt,
  MessageCircle,
  Plus,
  Pencil,
  Trash2,
  Store,
  Settings,
  LayoutGrid,
  UtensilsCrossed,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  useConfigEmpresa,
  configPadrao,
  WHITELABEL_CNPJ_PADRAO,
  WHITELABEL_EMAIL_PADRAO,
  WHITELABEL_NOME_FANTASIA_PADRAO,
  WHITELABEL_TELEFONE_PADRAO,
} from "@/lib/config-empresa"
import { LEGACY_PRIMARY_STORE_ID } from "@/lib/store-defaults"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { useToast } from "@/hooks/use-toast"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import { ASSISTEC_STORES_SYNC_STORAGE_KEY, useLojaAtiva } from "@/lib/loja-ativa"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import type { StoreSettingsBlob, StorePdvParams } from "@/lib/store-settings-types"

const ATALHOS_PDV_MAX = 24
const PDV_LAYOUT_STORAGE_KEY = "@omnigestao:pdv-layout"
const RAMO_ATUACAO_STORAGE_PREFIX = "@omnigestao:ramo-atuacao:"

type RamoAtuacao = "assistencia" | "supermercado" | "moda" | "outros"

function ramoLabel(r: RamoAtuacao): string {
  if (r === "assistencia") return "Assistência Técnica"
  if (r === "supermercado") return "Supermercado/Mercearia"
  if (r === "moda") return "Moda/Vestuário"
  return "Variedades/Outros"
}

function assistenciaDefaultGarantiasProfissionais(): Array<{ id: string; servico: string; detalhes: string }> {
  return [
    {
      id: "troca_tela",
      servico: "Troca de Tela",
      detalhes:
        "Garantia de 90 dias. Cobre: Perda de sensibilidade ao toque (touch) e falhas de imagem de fábrica. NÃO COBRE: Vidro trincado, display vazado, manchas por pressão ou danos por líquidos. A remoção do selo de garantia anula este termo.",
    },
    {
      id: "troca_bateria",
      servico: "Troca de Bateria",
      detalhes:
        "Garantia de 90 dias. Cobre: Estufamento ou vício de carga (descarregando rápido de forma anormal). NÃO COBRE: Desgaste natural por ciclos de carga, danos por carregadores paralelos ou oxidação.",
    },
    {
      id: "desoxidacao",
      servico: "Desoxidação (Banho Químico)",
      detalhes:
        "Procedimento de tentativa de recuperação. Sem garantia de funcionamento pleno posterior devido à natureza corrosiva da água. O cliente declara ciência do risco de o aparelho parar de funcionar durante ou após o processo.",
    },
  ]
}

/** Lista editável de cards rápidos: pelo menos uma linha vazia se não houver dados. */
function atalhosParaEdicao(
  list: Array<{ id: string; nome: string; preco: number }>
): Array<{ id: string; nome: string; preco: number }> {
  if (!list?.length) {
    return [{ id: `atalho-${Date.now()}`, nome: "", preco: 0 }]
  }
  return list.map((a, idx) => ({
    id: a.id || `atalho-${idx}`,
    nome: a.nome ?? "",
    preco: typeof a.preco === "number" ? a.preco : 0,
  }))
}

function parseCategoriasOcultasText(text: string): string[] {
  const parts = text.split(/[\n,]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const t = p.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

// (limpeza total) helpers legados de "marca/logo", "certificado" e "rede" removidos.

interface ConfiguracoesSistemaProps {
  initialTab?: string
}

function normalizeConfigTab(input: string | undefined): "geral" | "pdv-vendas" | "servicos-garantias" {
  const t = String(input || "").trim()
  if (t === "pdv-vendas" || t === "pdv") return "pdv-vendas"
  if (t === "servicos-garantias" || t === "garantias") return "servicos-garantias"
  return "geral"
}

export function ConfiguracoesSistema({ initialTab = "geral" }: ConfiguracoesSistemaProps) {
  const {
    config,
  } = useConfigEmpresa()
  const isBronze = config.assinatura.plano === "bronze"
  const { lojaAtivaId, refreshStoresList } = useLojaAtiva()
  const { toast } = useToast()
  const [remotePrinterConfig, setRemotePrinterConfig] = useState<Record<string, unknown>>({})
  const [remoteReceiptFooter, setRemoteReceiptFooter] = useState("")
  const [termosTitulo, setTermosTitulo] = useState(configPadrao.termosGarantia.tituloGeral)
  const [termosCategorias, setTermosCategorias] = useState(() => [...configPadrao.termosGarantia.categorias])
  
  const [activeTab, setActiveTab] = useState(() => normalizeConfigTab(initialTab))
  const [isSaving, setIsSaving] = useState(false)
  // Estado local para formulário (sincronizado com o contexto)
  const [nomeFantasia, setNomeFantasia] = useState(config.empresa.nomeFantasia)
  const [cnpj, setCnpj] = useState(config.empresa.cnpj)
  const [telefone, setTelefone] = useState(config.empresa.contato.telefone)
  const [whatsapp, setWhatsapp] = useState(config.empresa.contato.whatsapp)
  const [whatsappDono, setWhatsappDono] = useState(config.empresa.contato.whatsappDono ?? "")
  const [email, setEmail] = useState(config.empresa.contato.email)

  /** Texto da garantia legal + rascunho por id de categoria (sincronizado com o contexto). */
  const [textosTermos, setTextosTermos] = useState<Record<string, string>>(() => ({
    garantiaLegal: configPadrao.termosGarantia.garantiaLegal,
    ...Object.fromEntries(configPadrao.termosGarantia.categorias.map((c) => [c.id, c.detalhes])),
  }))

  // Estado para novo termo
  const [novoTermo, setNovoTermo] = useState({ titulo: "", texto: "" })
  const [isAddingTermo, setIsAddingTermo] = useState(false)
  const [editingTermoId, setEditingTermoId] = useState<string | null>(null)
  const [editingTermo, setEditingTermo] = useState({ titulo: "", texto: "" })
  const [atalhosPDV, setAtalhosPDV] = useState(() => atalhosParaEdicao(config.pdv.atalhosRapidos))
  const [pdvLayout, setPdvLayout] = useState<"classic" | "supermercado">("classic")
  const [ramoAtuacao, setRamoAtuacao] = useState<RamoAtuacao>("assistencia")
  const [remoteHasTermosGarantia, setRemoteHasTermosGarantia] = useState(false)
  const [ocultarCategoriasNoPdv, setOcultarCategoriasNoPdv] = useState(
    () => config.pdv.ocultarCategoriasNoPdv ?? configPadrao.pdv.ocultarCategoriasNoPdv
  )
  const [categoriasOcultasText, setCategoriasOcultasText] = useState(() =>
    (config.pdv.categoriasOcultasNoPdv ?? configPadrao.pdv.categoriasOcultasNoPdv).join("\n")
  )
  const [garantiaPadraoDias, setGarantiaPadraoDias] = useState(
    () => config.pdv.garantiaPadraoDias ?? configPadrao.pdv.garantiaPadraoDias
  )
  const [validadeOrcamentoDias, setValidadeOrcamentoDias] = useState(
    () => config.pdv.validadeOrcamentoDias ?? configPadrao.pdv.validadeOrcamentoDias
  )
  const [incluirImpostoEstimadoNoPdv, setIncluirImpostoEstimadoNoPdv] = useState(
    () => config.pdv.incluirImpostoEstimadoNoPdv ?? configPadrao.pdv.incluirImpostoEstimadoNoPdv
  )
  const [aliquotaImpostoEstimadoPdv, setAliquotaImpostoEstimadoPdv] = useState(
    () => config.pdv.aliquotaImpostoEstimadoPdv ?? configPadrao.pdv.aliquotaImpostoEstimadoPdv
  )
  const [moduloControleConsumo, setModuloControleConsumo] = useState(
    () => config.pdv.moduloControleConsumo ?? configPadrao.pdv.moduloControleConsumo
  )
  const [deleteTermoId, setDeleteTermoId] = useState<string | null>(null)
  const { perfilLoja } = usePerfilLoja()

  // Atualizar aba quando prop mudar
  useEffect(() => {
    setActiveTab(normalizeConfigTab(initialTab))
  }, [initialTab])

  useEffect(() => {
    try {
      const raw = String(localStorage.getItem(PDV_LAYOUT_STORAGE_KEY) || "").trim()
      if (raw === "supermercado" || raw === "classic") setPdvLayout(raw)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const id = (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim()
    const k = `${RAMO_ATUACAO_STORAGE_PREFIX}${id}`
    try {
      const raw = String(localStorage.getItem(k) || "").trim()
      if (raw === "assistencia" || raw === "supermercado" || raw === "moda" || raw === "outros") {
        setRamoAtuacao(raw)
        return
      }
    } catch {
      /* ignore */
    }
    setRamoAtuacao(perfilLoja === "supermercado" ? "supermercado" : perfilLoja === "variedades" ? "outros" : "assistencia")
  }, [lojaAtivaId, perfilLoja])

  // Sincronizar com o contexto quando ele mudar
  useEffect(() => {
    // Multi-tenant: para dados por unidade, carregamos do banco abaixo (não do config global).
    if (lojaAtivaId) return
    setNomeFantasia(config.empresa.nomeFantasia)
    setCnpj(config.empresa.cnpj)
    setTelefone(config.empresa.contato.telefone)
    setWhatsapp(config.empresa.contato.whatsapp)
    setWhatsappDono(config.empresa.contato.whatsappDono ?? "")
    setEmail(config.empresa.contato.email)
    setTextosTermos({
      garantiaLegal: config.termosGarantia.garantiaLegal,
      ...Object.fromEntries(config.termosGarantia.categorias.map((c) => [c.id, c.detalhes])),
    })
    setAtalhosPDV(atalhosParaEdicao(config.pdv.atalhosRapidos))
    setOcultarCategoriasNoPdv(config.pdv.ocultarCategoriasNoPdv ?? configPadrao.pdv.ocultarCategoriasNoPdv)
    setCategoriasOcultasText(
      (config.pdv.categoriasOcultasNoPdv ?? configPadrao.pdv.categoriasOcultasNoPdv).join("\n")
    )
    setGarantiaPadraoDias(config.pdv.garantiaPadraoDias ?? configPadrao.pdv.garantiaPadraoDias)
    setValidadeOrcamentoDias(config.pdv.validadeOrcamentoDias ?? configPadrao.pdv.validadeOrcamentoDias)
    setIncluirImpostoEstimadoNoPdv(
      config.pdv.incluirImpostoEstimadoNoPdv ?? configPadrao.pdv.incluirImpostoEstimadoNoPdv
    )
    setAliquotaImpostoEstimadoPdv(
      config.pdv.aliquotaImpostoEstimadoPdv ?? configPadrao.pdv.aliquotaImpostoEstimadoPdv
    )
    setModuloControleConsumo(config.pdv.moduloControleConsumo ?? configPadrao.pdv.moduloControleConsumo)
    setTermosTitulo(config.termosGarantia.tituloGeral)
    setTermosCategorias([...config.termosGarantia.categorias])
  }, [config])

  // Multi-tenant: carregar dados da unidade ativa (Store + StoreSettings).
  useEffect(() => {
    if (!lojaAtivaId) return
    let cancelled = false
    void (async () => {
      try {
        const [rStore, rSettings] = await Promise.all([
          fetch(`/api/stores/${encodeURIComponent(lojaAtivaId)}`, { credentials: "include", cache: "no-store" }),
          fetch(`/api/stores/${encodeURIComponent(lojaAtivaId)}/settings`, { credentials: "include", cache: "no-store" }),
        ])
        const jStore = (await rStore.json().catch(() => ({}))) as { store?: any }
        const jSettings = (await rSettings.json().catch(() => ({}))) as { settings?: any }
        if (cancelled) return
        const s = jStore.store ?? {}
        const st = jSettings.settings ?? {}
        const printerCfg = st.printerConfig && typeof st.printerConfig === "object" ? (st.printerConfig as Record<string, unknown>) : {}
        const blob: StoreSettingsBlob = {
          pdvParams: (printerCfg.pdvParams as any) || undefined,
          termosGarantia: (printerCfg.termosGarantia as any) || undefined,
        }
        setRemotePrinterConfig(printerCfg)
        setRemoteReceiptFooter(String(st.receiptFooter || ""))

        // Loja nova: campos vêm vazios para preencher.
        setNomeFantasia(String(s.name || ""))
        setCnpj(String(s.cnpj || ""))
        setTelefone(String(s.phone || ""))

        setEmail(String(st.contactEmail || ""))
        setWhatsapp(String(st.contactWhatsapp || ""))
        setWhatsappDono(String(st.contactWhatsappDono || ""))

        // PDV params por unidade
        const pdv: Partial<StorePdvParams> = (blob.pdvParams as any) || {}
        setAtalhosPDV(atalhosParaEdicao(Array.isArray(pdv.atalhosRapidos) ? (pdv.atalhosRapidos as any) : configPadrao.pdv.atalhosRapidos))
        setOcultarCategoriasNoPdv(Boolean(pdv.ocultarCategoriasNoPdv ?? configPadrao.pdv.ocultarCategoriasNoPdv))
        setCategoriasOcultasText(
          (Array.isArray(pdv.categoriasOcultasNoPdv) ? (pdv.categoriasOcultasNoPdv as string[]) : configPadrao.pdv.categoriasOcultasNoPdv).join("\n")
        )
        setGarantiaPadraoDias(Number(pdv.garantiaPadraoDias ?? configPadrao.pdv.garantiaPadraoDias) || configPadrao.pdv.garantiaPadraoDias)
        setValidadeOrcamentoDias(Number(pdv.validadeOrcamentoDias ?? configPadrao.pdv.validadeOrcamentoDias) || configPadrao.pdv.validadeOrcamentoDias)
        setIncluirImpostoEstimadoNoPdv(Boolean(pdv.incluirImpostoEstimadoNoPdv ?? configPadrao.pdv.incluirImpostoEstimadoNoPdv))
        setAliquotaImpostoEstimadoPdv(Number(pdv.aliquotaImpostoEstimadoPdv ?? configPadrao.pdv.aliquotaImpostoEstimadoPdv) || 0)
        setModuloControleConsumo(Boolean(pdv.moduloControleConsumo ?? configPadrao.pdv.moduloControleConsumo))

        // Termos de garantia por unidade
        if (blob.termosGarantia && typeof blob.termosGarantia === "object") {
          setRemoteHasTermosGarantia(true)
          const tg = blob.termosGarantia as any
          const legal = String(tg.garantiaLegal ?? configPadrao.termosGarantia.garantiaLegal)
          const categorias = Array.isArray(tg.categorias) ? tg.categorias : configPadrao.termosGarantia.categorias
          setTermosTitulo(String(tg.tituloGeral ?? configPadrao.termosGarantia.tituloGeral))
          setTermosCategorias((categorias as any[]).map((c) => ({
            id: String(c.id),
            servico: String(c.servico ?? ""),
            detalhes: String(c.detalhes ?? ""),
          })))
          setTextosTermos((prev) => ({
            ...prev,
            garantiaLegal: legal,
            ...Object.fromEntries((categorias as any[]).map((c) => [String(c.id), String(c.detalhes ?? "")])),
          }))
        } else {
          setRemoteHasTermosGarantia(false)
        }

        // Certificado/identidade visual/backup removidos desta tela (limpeza total)
      } catch {
        if (!cancelled) {
          // se falhar, não herda da RafaCell (mantém vazio)
          setNomeFantasia("")
          setCnpj("")
          setTelefone("")
          setEmail("")
          setWhatsapp("")
          setWhatsappDono("")
          setRemotePrinterConfig({})
          setRemoteReceiptFooter("")
          setTermosTitulo(configPadrao.termosGarantia.tituloGeral)
          setTermosCategorias([...configPadrao.termosGarantia.categorias])
          setRemoteHasTermosGarantia(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lojaAtivaId])

  useEffect(() => {
    // Defaults profissionais só para Assistência e somente se a unidade não tiver termos customizados no banco
    if (ramoAtuacao !== "assistencia") return
    if (remoteHasTermosGarantia) return
    const profissionais = assistenciaDefaultGarantiasProfissionais()
    setTermosCategorias(profissionais)
    setTextosTermos((prev) => ({
      ...prev,
      ...Object.fromEntries(profissionais.map((c) => [c.id, c.detalhes])),
    }))
  }, [ramoAtuacao, remoteHasTermosGarantia])

  const handleSave = async () => {
    const nomeTrim = nomeFantasia.trim()
    if (!nomeTrim) {
      toast({
        title: "Nome fantasia obrigatório",
        description: "Preencha o nome da empresa para identificar a unidade no sistema e no cabeçalho.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    try {
      // Hardening: arquitetura primária storeId-only. Sem loja ativa, não salva.
      if (!lojaAtivaId) {
        throw new Error("Nenhuma unidade ativa selecionada.")
      }

      const lojaHeader = lojaAtivaId.trim()
      const storeRes = await fetch(`/api/stores/${encodeURIComponent(lojaHeader)}`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaHeader,
        },
        body: JSON.stringify({
          name: nomeTrim,
          cnpj,
          phone: telefone,
        }),
      })
      if (!storeRes.ok) {
        const err = (await storeRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Falha ao salvar unidade (HTTP ${storeRes.status})`)
      }
      await fetch(`/api/stores/${encodeURIComponent(lojaHeader)}/settings`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [ASSISTEC_LOJA_HEADER]: lojaHeader,
        },
        body: JSON.stringify({
          contactEmail: email,
          contactWhatsapp: whatsapp,
          contactWhatsappDono: whatsappDono,
          receiptFooter: remoteReceiptFooter,
          printerConfig: {
            ...(remotePrinterConfig || {}),
            pdvParams: {
              atalhosRapidos: atalhosPDV
                .filter((a) => a.nome.trim() && a.preco > 0)
                .map((a, idx) => ({ id: a.id || `atalho-${idx + 1}`, nome: a.nome.trim(), preco: a.preco })),
              garantiaPadraoDias: Math.max(1, Math.min(365, Math.round(Number(garantiaPadraoDias)) || configPadrao.pdv.garantiaPadraoDias)),
              validadeOrcamentoDias: Math.max(1, Math.min(365, Math.round(Number(validadeOrcamentoDias)) || configPadrao.pdv.validadeOrcamentoDias)),
              incluirImpostoEstimadoNoPdv,
              aliquotaImpostoEstimadoPdv: Math.max(0, Math.min(100, Number(aliquotaImpostoEstimadoPdv) || 0)),
              ocultarCategoriasNoPdv,
              categoriasOcultasNoPdv: parseCategoriasOcultasText(categoriasOcultasText),
              moduloControleConsumo,
            },
            termosGarantia: {
              ...configPadrao.termosGarantia,
              tituloGeral: termosTitulo,
              garantiaLegal: textosTermos.garantiaLegal ?? "",
              categorias: termosCategorias.map((c) => ({
                ...c,
                detalhes: textosTermos[c.id] ?? c.detalhes,
              })),
            },
          },
        }),
      })
      await refreshStoresList()
      try {
        localStorage.setItem(ASSISTEC_STORES_SYNC_STORAGE_KEY, String(Date.now()))
      } catch {
        /* ignore */
      }

      // Perfil da Loja não é global: é coluna do Store (editar em Minhas Lojas / Gestão de Unidades).

    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestaurarTermos = (tipo: string) => {
    const termoPadrao = configPadrao.termosGarantia.categorias.find((c) => c.id === tipo)
    if (termoPadrao) {
      setTextosTermos((prev) => ({ ...prev, [tipo]: termoPadrao.detalhes }))
    } else if (tipo === "garantiaLegal") {
      setTextosTermos((prev) => ({
        ...prev,
        garantiaLegal: configPadrao.termosGarantia.garantiaLegal,
      }))
    }
  }

  const handleRestaurarTodosTermos = () => {
    setTextosTermos({
      garantiaLegal: configPadrao.termosGarantia.garantiaLegal,
      ...Object.fromEntries(configPadrao.termosGarantia.categorias.map((c) => [c.id, c.detalhes])),
    })
    setTermosTitulo(configPadrao.termosGarantia.tituloGeral)
    setTermosCategorias([...configPadrao.termosGarantia.categorias])
  }

  const handleAddTermo = () => {
    if (novoTermo.titulo && novoTermo.texto) {
      const id = novoTermo.titulo.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
      const next = { id, servico: novoTermo.titulo, detalhes: novoTermo.texto }
      setTermosCategorias((prev) => [...prev, next])
      setTextosTermos((prev) => ({ ...prev, [id]: novoTermo.texto }))
      setNovoTermo({ titulo: "", texto: "" })
      setIsAddingTermo(false)
      toast({ title: "Termo cadastrado", description: "Novo termo adicionado com sucesso." })
    }
  }

  const handleEditTermo = (id: string) => {
    const termo = termosCategorias.find((c) => c.id === id)
    if (termo) {
      setEditingTermoId(id)
      setEditingTermo({ titulo: termo.servico, texto: termo.detalhes })
    }
  }

  const handleSaveEditTermo = () => {
    if (editingTermoId && editingTermo.titulo && editingTermo.texto) {
      setTermosCategorias((prev) =>
        prev.map((c) => (c.id === editingTermoId ? { ...c, servico: editingTermo.titulo, detalhes: editingTermo.texto } : c))
      )
      setTextosTermos((prev) => ({ ...prev, [editingTermoId]: editingTermo.texto }))
      setEditingTermoId(null)
      setEditingTermo({ titulo: "", texto: "" })
      toast({ title: "Termo atualizado", description: "Alterações salvas no termo." })
    }
  }

  const confirmDeleteTermo = () => {
    if (!deleteTermoId) return
    const cat = termosCategorias.find((c) => c.id === deleteTermoId)
    appendAuditLog({
      action: "registro_excluido",
      userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
      detail: `Termo de garantia excluído: ${cat?.servico ?? deleteTermoId}`,
    })
    setTermosCategorias((prev) => prev.filter((c) => c.id !== deleteTermoId))
    setTextosTermos((prev) => {
      const next = { ...prev }
      delete next[deleteTermoId]
      return next
    })
    setDeleteTermoId(null)
    toast({ title: "Termo excluído", description: "O termo foi removido." })
  }

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14)
    return digits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2")
  }

  const handleRestaurarPadroesPdv = () => {
    const def = configPadrao.pdv
    setAtalhosPDV(atalhosParaEdicao(def.atalhosRapidos))
    setOcultarCategoriasNoPdv(def.ocultarCategoriasNoPdv)
    setCategoriasOcultasText(def.categoriasOcultasNoPdv.join("\n"))
    setModuloControleConsumo(def.moduloControleConsumo)
    toast({ title: "PDV restaurado", description: "Parâmetros do PDV restaurados aos padrões." })
  }

  return (
    <>
    <div className="space-y-6 pb-28">

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList
          className={cn(
            "grid w-full h-auto gap-1 bg-secondary p-1",
            ramoAtuacao === "assistencia" ? "grid-cols-3" : "grid-cols-2"
          )}
        >
          <TabsTrigger value="geral" className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Building2 className="w-4 h-4 mr-2 hidden sm:inline" />
            Geral
          </TabsTrigger>
          <TabsTrigger value="pdv-vendas" className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <LayoutGrid className="w-4 h-4 mr-2 hidden sm:inline" />
            PDV e Vendas
          </TabsTrigger>
          {ramoAtuacao === "assistencia" ? (
            <TabsTrigger value="servicos-garantias" className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Shield className="w-4 h-4 mr-2 hidden sm:inline" />
              Serviços e Garantias
            </TabsTrigger>
          ) : null}
        </TabsList>

        {/* ABA 1: GERAL */}
        <TabsContent value="geral" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-primary" />
                Ramo de Atuação
              </CardTitle>
              <CardDescription>
                Ajusta a experiência do sistema para o seu nicho. A aba “Serviços e Garantias” só aparece para Assistência.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-w-xl">
              <Label>Ramo de Atuação</Label>
              <Select
                value={ramoAtuacao}
                onValueChange={(v) => {
                  const next: RamoAtuacao =
                    v === "supermercado" ? "supermercado" : v === "moda" ? "moda" : v === "outros" ? "outros" : "assistencia"
                  setRamoAtuacao(next)
                  const id = (lojaAtivaId || LEGACY_PRIMARY_STORE_ID).trim()
                  const k = `${RAMO_ATUACAO_STORAGE_PREFIX}${id}`
                  try {
                    localStorage.setItem(k, next)
                  } catch {
                    /* ignore */
                  }
                  if (next !== "assistencia" && activeTab === "servicos-garantias") setActiveTab("geral")
                  toast({ title: "Ramo atualizado", description: `Agora: ${ramoLabel(next)}.` })
                }}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Selecione o ramo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assistencia">Assistência Técnica</SelectItem>
                  <SelectItem value="supermercado">Supermercado/Mercearia</SelectItem>
                  <SelectItem value="moda">Moda/Vestuário</SelectItem>
                  <SelectItem value="outros">Variedades/Outros</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Preferência salva no navegador por unidade ativa.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Informações da Empresa
              </CardTitle>
              <CardDescription>
                Cadastro fixo: identificação e endereço nos documentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome fantasia</Label>
                  <Input
                    id="nome"
                    value={nomeFantasia}
                    onChange={(e) => setNomeFantasia(e.target.value)}
                    placeholder={WHITELABEL_NOME_FANTASIA_PADRAO}
                    className="h-12 text-base"
                    required
                    aria-invalid={!nomeFantasia.trim()}
                  />
                  <p className="text-xs text-muted-foreground">Obrigatório — aparece no cabeçalho e no seletor de unidades.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ / CPF</Label>
                  <Input
                    id="cnpj"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                    placeholder={WHITELABEL_CNPJ_PADRAO}
                    className="h-12 text-base"
                  />
                </div>
              </div>

            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-primary" />
                Contato da loja
              </CardTitle>
              <CardDescription>Telefone, WhatsApp, e-mail e número do dono para automações</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telefone-aj" className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Telefone
                  </Label>
                  <Input
                    id="telefone-aj"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder={WHITELABEL_TELEFONE_PADRAO}
                    className="h-12 text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-aj" className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    WhatsApp
                  </Label>
                  <Input
                    id="whatsapp-aj"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder={WHITELABEL_TELEFONE_PADRAO}
                    className="h-12 text-base"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-aj" className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    E-mail
                  </Label>
                  <Input
                    id="email-aj"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={WHITELABEL_EMAIL_PADRAO}
                    className="h-12 text-base"
                  />
                </div>
              </div>
              <div className="space-y-2 max-w-md">
                <Label htmlFor="whatsapp-dono-aj">WhatsApp do dono (fechamento automático)</Label>
                <Input
                  id="whatsapp-dono-aj"
                  value={whatsappDono}
                  onChange={(e) => setWhatsappDono(e.target.value)}
                  placeholder="Mesmo formato do WhatsApp da loja"
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Recebe o resumo diário via API Evolution e o comando &quot;fechar dia&quot; pelo webhook.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 2: PDV E VENDAS */}
        <TabsContent value="pdv-vendas" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-primary" />
                Personalização do PDV
              </CardTitle>
              <CardDescription>
                Escolha o layout do caixa para esta máquina (preferência salva no navegador).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-w-xl">
              <div className="space-y-2">
                <Label>Layout do PDV</Label>
                <Select
                  value={pdvLayout}
                  onValueChange={(v) => {
                    const next = v === "supermercado" ? "supermercado" : "classic"
                    setPdvLayout(next)
                    try {
                      localStorage.setItem(PDV_LAYOUT_STORAGE_KEY, next)
                    } catch {
                      /* ignore */
                    }
                    toast({
                      title: "Layout do PDV atualizado",
                      description:
                        next === "supermercado"
                          ? "Layout Alta Performance ativado."
                          : "Layout Serviços ativado.",
                    })
                  }}
                >
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Selecione o layout do PDV" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="classic">Layout Serviços (Foco em Assistência e Orçamentos)</SelectItem>
                    <SelectItem value="supermercado">Layout Alta Performance (Foco em Agilidade)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Dica: o PDV muda na próxima abertura da tela (ou recarregando a página).
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-primary" />
                Tipo da unidade (por loja)
              </CardTitle>
              <CardDescription>
                O perfil não é global. Cada unidade (storeId) tem seu próprio tipo: Assistência/Variedades/Supermercado.
                Altere em <strong>Gestão da Rede → Gestão de Unidades</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Unidade atual: <strong>{lojaAtivaId || LEGACY_PRIMARY_STORE_ID}</strong> · Perfil: <strong>{perfilLoja}</strong>
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-primary" />
                Rodapé do cupom (por unidade)
              </CardTitle>
              <CardDescription>Texto impresso no final do cupom/recibo do PDV desta loja</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-w-2xl">
              <Textarea
                value={remoteReceiptFooter}
                onChange={(e) => setRemoteReceiptFooter(e.target.value)}
                placeholder="Ex.: Obrigado pela preferência. Trocas em até 7 dias com apresentação do cupom."
                className="min-h-[110px] resize-y"
              />
              <p className="text-xs text-muted-foreground">
                Gravado no <strong>StoreSettings</strong> da unidade ativa. Ao trocar de loja no cabeçalho, este texto muda.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-primary" />
                Mensagens de orçamento (WhatsApp)
              </CardTitle>
              <CardDescription>
                Texto da garantia e prazo padrão ao criar um orçamento novo
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="garantia-dias">Garantia padrão (dias)</Label>
                <Input
                  id="garantia-dias"
                  type="number"
                  min={1}
                  max={365}
                  value={garantiaPadraoDias}
                  onChange={(e) => setGarantiaPadraoDias(Number(e.target.value))}
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Usado na linha &quot;Garantia: X dias&quot; ao enviar o orçamento pelo WhatsApp.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="validade-dias">Validade do orçamento (dias)</Label>
                <Input
                  id="validade-dias"
                  type="number"
                  min={1}
                  max={365}
                  value={validadeOrcamentoDias}
                  onChange={(e) => setValidadeOrcamentoDias(Number(e.target.value))}
                  className="h-12 text-base"
                />
                <p className="text-xs text-muted-foreground">
                  Data inicial sugerida ao abrir &quot;Novo orçamento&quot; (pode alterar no formulário).
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-primary" />
                PDV — Imposto estimado no total
              </CardTitle>
              <CardDescription>
                Por padrão o carrinho não soma impostos ao total. Ative apenas se quiser exibir e incluir uma estimativa
                (ex.: Simples).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="pdv-imposto-toggle">Incluir imposto estimado no total do PDV</Label>
                  <p className="text-xs text-muted-foreground">
                    Desligado: total = subtotal − descontos. Ligado: total = subtotal + imposto estimado − descontos.
                  </p>
                </div>
                <Switch
                  id="pdv-imposto-toggle"
                  checked={incluirImpostoEstimadoNoPdv}
                  onCheckedChange={setIncluirImpostoEstimadoNoPdv}
                />
              </div>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="pdv-aliquota">Alíquota estimada (% sobre o subtotal)</Label>
                <Input
                  id="pdv-aliquota"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={aliquotaImpostoEstimadoPdv}
                  onChange={(e) => setAliquotaImpostoEstimadoPdv(parseFloat(e.target.value) || 0)}
                  disabled={!incluirImpostoEstimadoNoPdv}
                  className="h-11"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UtensilsCrossed className="w-5 h-5 text-primary" />
                Controle de Consumo (mesas / comandas)
              </CardTitle>
              <CardDescription>
                Ative para exibir no menu Vendas a tela de mesas: consumo sem pagamento na hora e envio da conta ao PDV para
                cobrança.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 max-w-xl">
                <Label htmlFor="modulo-controle-consumo" className="text-sm font-normal leading-snug">
                  Mostrar módulo &quot;Controle de Consumo&quot;
                </Label>
                <Switch
                  id="modulo-controle-consumo"
                  checked={moduloControleConsumo}
                  onCheckedChange={setModuloControleConsumo}
                />
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        {ramoAtuacao === "assistencia" ? (
          <TabsContent value="servicos-garantias" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-primary" />
                  Cards de serviço rápido
                </CardTitle>
                <CardDescription>
                  Três botões grandes de serviço (nome e valor) e o quarto botão fixo &quot;Nova O.S.&quot; no PDV. Até{" "}
                  {ATALHOS_PDV_MAX} cards de serviço.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (atalhosPDV.length >= ATALHOS_PDV_MAX) return
                    setAtalhosPDV((prev) => [
                      ...prev,
                      { id: `atalho-${Date.now()}`, nome: "", preco: 0 },
                    ])
                  }}
                  disabled={atalhosPDV.length >= ATALHOS_PDV_MAX}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Adicionar card
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
                  onClick={handleRestaurarPadroesPdv}
                >
                  <RotateCcw className="w-4 h-4 mr-1" />
                  Restaurar padrões
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {atalhosPDV.map((atalho, idx) => (
                  <div
                    key={atalho.id || idx}
                    className="p-3 rounded-lg border border-border bg-secondary/40 space-y-2 relative group"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-xs text-muted-foreground">Card {idx + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        title="Excluir card"
                        onClick={() =>
                          setAtalhosPDV((prev) => {
                            const next = prev.filter((_, i) => i !== idx)
                            return next.length ? next : atalhosParaEdicao([])
                          })
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <Input
                      value={atalho.nome}
                      onChange={(e) =>
                        setAtalhosPDV((prev) =>
                          prev.map((a, i) => (i === idx ? { ...a, nome: e.target.value } : a))
                        )
                      }
                      placeholder="Nome exibido no PDV"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={atalho.preco || ""}
                      onChange={(e) =>
                        setAtalhosPDV((prev) =>
                          prev.map((a, i) => (i === idx ? { ...a, preco: parseFloat(e.target.value) || 0 } : a))
                        )
                      }
                      placeholder="Preço (R$)"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Use &quot;Salvar alterações&quot; no rodapé para gravar. Cards sem nome ou com preço zero são ignorados na
                loja.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Visibilidade de categorias</CardTitle>
              <CardDescription>
                Oculte categorias técnicas na grade principal até o cliente ou vendedor buscar pelo nome.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-2xl">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="ocultar-cat-pdv">Ocultar categorias no PDV</Label>
                  <p className="text-xs text-muted-foreground">
                    Com a busca vazia, produtos das categorias listadas abaixo não aparecem. Ao digitar na busca, todos os
                    resultados válidos são mostrados.
                  </p>
                </div>
                <Switch
                  id="ocultar-cat-pdv"
                  checked={ocultarCategoriasNoPdv}
                  onCheckedChange={setOcultarCategoriasNoPdv}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categorias-ocultas">Categorias ocultas (uma por linha ou separadas por vírgula)</Label>
                <Textarea
                  id="categorias-ocultas"
                  value={categoriasOcultasText}
                  onChange={(e) => setCategoriasOcultasText(e.target.value)}
                  disabled={!ocultarCategoriasNoPdv}
                  placeholder={"Telas\nBaterias\nConectores"}
                  className="min-h-[120px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  O nome deve coincidir com a categoria do produto no estoque (ex.: Telas, Baterias, Acessorios).
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {/* Header com Botões */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-semibold">{termosTitulo}</h3>
                <p className="text-sm text-muted-foreground">
                  Cadastre, edite ou exclua os termos que aparecerão nas OS
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setIsAddingTermo(true)} className="bg-primary hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Termo
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRestaurarTodosTermos}
                  className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Restaurar
                </Button>
              </div>
            </div>

            {/* Formulário para Novo Termo */}
            {isAddingTermo && (
              <Card className="bg-primary/5 border-primary/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Plus className="w-4 h-4 text-primary" />
                    Cadastrar Novo Termo
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Título do Termo *</Label>
                    <Input
                      value={novoTermo.titulo}
                      onChange={(e) => setNovoTermo((prev) => ({ ...prev, titulo: e.target.value }))}
                      placeholder="Ex: Troca de Tela"
                      className="h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Texto da Garantia *</Label>
                    <Textarea
                      value={novoTermo.texto}
                      onChange={(e) => setNovoTermo((prev) => ({ ...prev, texto: e.target.value }))}
                      rows={4}
                      placeholder="Digite as condições de garantia para este serviço..."
                      className="resize-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsAddingTermo(false)
                        setNovoTermo({ titulo: "", texto: "" })
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleAddTermo}
                      disabled={!novoTermo.titulo || !novoTermo.texto}
                      className="bg-primary hover:bg-primary/90"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Salvar Termo
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Garantia Legal (sempre fixo) */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Garantia Legal (90 dias - CDC)</CardTitle>
                      <CardDescription className="text-xs">
                        Texto padrão conforme Código de Defesa do Consumidor
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRestaurarTermos("garantiaLegal")}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={textosTermos.garantiaLegal ?? ""}
                  onChange={(e) => setTextosTermos((prev) => ({ ...prev, garantiaLegal: e.target.value }))}
                  rows={3}
                  className="resize-none text-sm"
                />
              </CardContent>
            </Card>

            {/* Lista de Termos Cadastrados */}
            {termosCategorias.map((categoria) => (
              <Card key={categoria.id} className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                        <Shield className="w-5 h-5 text-foreground" />
                      </div>
                      <div className="flex-1">
                        {editingTermoId === categoria.id ? (
                          <Input
                            value={editingTermo.titulo}
                            onChange={(e) => setEditingTermo((prev) => ({ ...prev, titulo: e.target.value }))}
                            className="h-8 text-base font-semibold"
                          />
                        ) : (
                          <>
                            <CardTitle className="text-base">{categoria.servico}</CardTitle>
                            <CardDescription className="text-xs">ID: {categoria.id}</CardDescription>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {editingTermoId === categoria.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingTermoId(null)
                              setEditingTermo({ titulo: "", texto: "" })
                            }}
                            className="text-muted-foreground"
                          >
                            Cancelar
                          </Button>
                          <Button size="sm" onClick={handleSaveEditTermo} className="bg-primary hover:bg-primary/90">
                            <Save className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditTermo(categoria.id)}
                            className="text-muted-foreground hover:text-primary h-8 w-8"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTermoId(categoria.id)}
                            className="text-muted-foreground hover:text-red-500 h-8 w-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {editingTermoId === categoria.id ? (
                    <Textarea
                      value={editingTermo.texto}
                      onChange={(e) => setEditingTermo((prev) => ({ ...prev, texto: e.target.value }))}
                      rows={4}
                      className="resize-none text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">{categoria.detalhes}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

        </TabsContent>
        ) : null}
      </Tabs>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:-mx-0 sm:rounded-b-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-muted-foreground max-w-xl">
            Salve as configurações da unidade ativa. O layout do PDV também é gravado no navegador.
          </p>
          <Button
            size="lg"
            className="h-12 px-8 bg-primary hover:bg-primary/90 shrink-0"
            onClick={() => {
              handleSave()
              toast({ title: "Configurações salvas", description: "Preferências atualizadas com sucesso." })
            }}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="w-5 h-5 mr-2" />
                Salvar Configurações
              </>
            )}
          </Button>
        </div>
      </div>
    </div>

    <AlertDialog open={deleteTermoId !== null} onOpenChange={(open) => !open && setDeleteTermoId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir este termo?</AlertDialogTitle>
          <AlertDialogDescription>
            O termo será removido permanentemente da lista de garantias.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDeleteTermo}>
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
