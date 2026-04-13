"use client"

import { useState, useEffect } from "react"
import { 
  Building2, 
  Upload, 
  FileKey, 
  Save, 
  RotateCcw,
  Shield,
  AlertTriangle,
  Check,
  Image as ImageIcon,
  MapPin,
  Phone,
  Mail,
  Palette,
  Plus,
  Pencil,
  Trash2,
  Database,
  Store,
  Download,
  Settings,
  MessageCircle,
  LayoutGrid,
  UtensilsCrossed,
  Wallet,
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
  type ConfigSistema,
  type EnderecoEmpresa,
  type PerfilLojaUnidade,
} from "@/lib/config-empresa"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import { PERFIL_LOJA_LABELS, type PerfilLojaId } from "@/lib/perfil-loja-types"
import { maxLojasPermitidas } from "@/lib/plano-lojas"
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
import { CentroPersonalizacaoFinanceiraRafacell } from "@/components/dashboard/configuracoes/centro-personalizacao-financeira-rafacell"
import { ImportadorDadosExternos } from "@/components/dashboard/configuracoes/backup-importador/importador-dados-externos"

const ATALHOS_PDV_MAX = 24

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

function emptyEnderecoLoja(): EnderecoEmpresa {
  return { rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "" }
}

function emptyPerfilLoja(id: string): PerfilLojaUnidade {
  return {
    id,
    nomeFantasia: "",
    razaoSocial: "",
    cnpj: "",
    endereco: emptyEnderecoLoja(),
    logoUrl: "",
  }
}

function padPerfisLojas(lojas: PerfilLojaUnidade[], count: number): PerfilLojaUnidade[] {
  const out: PerfilLojaUnidade[] = []
  for (let i = 0; i < count; i++) {
    const existing = lojas[i]
    const id = `loja-${i + 1}`
    out.push(
      existing
        ? { ...existing, id: existing.id?.trim() || id }
        : emptyPerfilLoja(id)
    )
  }
  return out
}

function buildPerfisFromConfig(c: ConfigSistema): PerfilLojaUnidade[] {
  const max = maxLojasPermitidas(c.assinatura.plano)
  const saved = c.minhasLojas?.lojas ?? []
  if (saved.length > 0) return padPerfisLojas(saved, max)
  return padPerfisLojas(
    [
      {
        id: "loja-1",
        nomeFantasia: c.empresa.nomeFantasia,
        razaoSocial: c.empresa.razaoSocial,
        cnpj: c.empresa.cnpj,
        endereco: { ...c.empresa.endereco },
        logoUrl: c.empresa.identidadeVisual.logoUrl || "",
      },
    ],
    max
  )
}

interface ConfiguracoesSistemaProps {
  initialTab?: string
}

export function ConfiguracoesSistema({ initialTab = "dados-empresa" }: ConfiguracoesSistemaProps) {
  const {
    config,
    updateEmpresa,
    updateTermosGarantia,
    updateCategoriaGarantia,
    addCategoriaGarantia,
    removeCategoriaGarantia,
    resetConfig,
    updatePdv,
    updateMinhasLojas,
  } = useConfigEmpresa()
  const isBronze = config.assinatura.plano === "bronze"
  
  const [activeTab, setActiveTab] = useState(initialTab)
  const [isSaving, setIsSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState("")
  
  // Estado local para formulário (sincronizado com o contexto)
  const [nomeFantasia, setNomeFantasia] = useState(config.empresa.nomeFantasia)
  const [razaoSocial, setRazaoSocial] = useState(config.empresa.razaoSocial)
  const [cnpj, setCnpj] = useState(config.empresa.cnpj)
  const [rua, setRua] = useState(config.empresa.endereco.rua)
  const [numero, setNumero] = useState(config.empresa.endereco.numero)
  const [bairro, setBairro] = useState(config.empresa.endereco.bairro)
  const [cidade, setCidade] = useState(config.empresa.endereco.cidade)
  const [estado, setEstado] = useState(config.empresa.endereco.estado)
  const [cep, setCep] = useState(config.empresa.endereco.cep)
  const [telefone, setTelefone] = useState(config.empresa.contato.telefone)
  const [whatsapp, setWhatsapp] = useState(config.empresa.contato.whatsapp)
  const [whatsappDono, setWhatsappDono] = useState(config.empresa.contato.whatsappDono ?? "")
  const [email, setEmail] = useState(config.empresa.contato.email)
  const [logo, setLogo] = useState<string | null>(config.empresa.identidadeVisual.logoUrl || null)
  const [certificado, setCertificado] = useState<File | null>(null)
  const [senhaCertificado, setSenhaCertificado] = useState("")
  const [statusCertificado, setStatusCertificado] = useState(config.empresa.fiscal.certificadoDigitalStatus)

  // Cores do tema
  const [corPrimaria, setCorPrimaria] = useState("#FF0000")
  const [corFundo, setCorFundo] = useState("#000000")
  const [corTexto, setCorTexto] = useState("#FFFFFF")

  /** Texto da garantia legal + rascunho por id de categoria (sincronizado com o contexto). */
  const [textosTermos, setTextosTermos] = useState<Record<string, string>>(() => ({
    garantiaLegal: config.termosGarantia.garantiaLegal,
    ...Object.fromEntries(config.termosGarantia.categorias.map((c) => [c.id, c.detalhes])),
  }))

  // Estado para novo termo
  const [novoTermo, setNovoTermo] = useState({ titulo: "", texto: "" })
  const [isAddingTermo, setIsAddingTermo] = useState(false)
  const [editingTermoId, setEditingTermoId] = useState<string | null>(null)
  const [editingTermo, setEditingTermo] = useState({ titulo: "", texto: "" })
  const [atalhosPDV, setAtalhosPDV] = useState(() => atalhosParaEdicao(config.pdv.atalhosRapidos))
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
  const [isGeneratingBackup, setIsGeneratingBackup] = useState(false)
  const [deleteTermoId, setDeleteTermoId] = useState<string | null>(null)
  const [perfisLojas, setPerfisLojas] = useState<PerfilLojaUnidade[]>(() => buildPerfisFromConfig(configPadrao))
  const { perfilLoja, setPerfilLoja, perfilHydrated } = usePerfilLoja()
  const maxLojas = maxLojasPermitidas(config.assinatura.plano)

  // Atualizar aba quando prop mudar
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  // Sincronizar com o contexto quando ele mudar
  useEffect(() => {
    setNomeFantasia(config.empresa.nomeFantasia)
    setRazaoSocial(config.empresa.razaoSocial)
    setCnpj(config.empresa.cnpj)
    setRua(config.empresa.endereco.rua)
    setNumero(config.empresa.endereco.numero)
    setBairro(config.empresa.endereco.bairro)
    setCidade(config.empresa.endereco.cidade)
    setEstado(config.empresa.endereco.estado)
    setCep(config.empresa.endereco.cep)
    setTelefone(config.empresa.contato.telefone)
    setWhatsapp(config.empresa.contato.whatsapp)
    setWhatsappDono(config.empresa.contato.whatsappDono ?? "")
    setEmail(config.empresa.contato.email)
    setStatusCertificado(config.empresa.fiscal.certificadoDigitalStatus)
    setLogo(config.empresa.identidadeVisual.logoUrl || null)
    const [cf, cp, ct] = config.empresa.identidadeVisual.coresTema
    if (cf) setCorFundo(cf)
    if (cp) setCorPrimaria(cp)
    if (ct) setCorTexto(ct)
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
    setPerfisLojas(buildPerfisFromConfig(config))
  }, [config])

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogo(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleCertificadoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCertificado(file)
      setStatusCertificado("Ativo")
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    
    // Atualizar contexto com os dados do formulário
    updateEmpresa({
      nomeFantasia,
      razaoSocial,
      cnpj,
      endereco: { rua, numero, bairro, cidade, estado, cep },
      contato: { telefone, whatsapp, whatsappDono, email },
      identidadeVisual: { logoUrl: logo || "", coresTema: [corFundo, corPrimaria, corTexto] },
      fiscal: { 
        certificadoDigitalStatus: statusCertificado, 
        tipoCertificado: "A1",
        senhaCertificado 
      }
    })

    updateTermosGarantia({ garantiaLegal: textosTermos.garantiaLegal ?? "" })
    config.termosGarantia.categorias.forEach((c) => {
      const detalhes = textosTermos[c.id]
      if (detalhes !== undefined) updateCategoriaGarantia(c.id, detalhes)
    })
    const rawG = Math.round(Number(garantiaPadraoDias)) || configPadrao.pdv.garantiaPadraoDias
    const rawV = Math.round(Number(validadeOrcamentoDias)) || configPadrao.pdv.validadeOrcamentoDias
    const diasG = Math.max(1, Math.min(365, rawG))
    const diasV = Math.max(1, Math.min(365, rawV))
    const ali = Math.max(0, Math.min(100, Number(aliquotaImpostoEstimadoPdv) || 0))
    updatePdv({
      atalhosRapidos: atalhosPDV
        .filter((a) => a.nome.trim() && a.preco > 0)
        .map((a, idx) => ({ id: a.id || `atalho-${idx + 1}`, nome: a.nome.trim(), preco: a.preco })),
      garantiaPadraoDias: diasG,
      validadeOrcamentoDias: diasV,
      incluirImpostoEstimadoNoPdv,
      aliquotaImpostoEstimadoPdv: ali,
      ocultarCategoriasNoPdv,
      categoriasOcultasNoPdv: parseCategoriasOcultasText(categoriasOcultasText),
      moduloControleConsumo,
    })

    updateMinhasLojas({
      lojas: padPerfisLojas(perfisLojas, maxLojas).map((p, idx) => ({
        ...p,
        id: p.id?.trim() || `loja-${idx + 1}`,
      })),
    })
    
    // Simular salvamento no banco
    await new Promise(resolve => setTimeout(resolve, 1500))
    setIsSaving(false)
    setSavedMessage("Alterações salvas com sucesso!")
    setTimeout(() => setSavedMessage(""), 3000)
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
  }

  const handleAddTermo = () => {
    if (novoTermo.titulo && novoTermo.texto) {
      const id = novoTermo.titulo.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
      addCategoriaGarantia({
        id,
        servico: novoTermo.titulo,
        detalhes: novoTermo.texto
      })
      setNovoTermo({ titulo: "", texto: "" })
      setIsAddingTermo(false)
      setSavedMessage("Novo termo cadastrado!")
      setTimeout(() => setSavedMessage(""), 3000)
    }
  }

  const handleEditTermo = (id: string) => {
    const termo = config.termosGarantia.categorias.find(c => c.id === id)
    if (termo) {
      setEditingTermoId(id)
      setEditingTermo({ titulo: termo.servico, texto: termo.detalhes })
    }
  }

  const handleSaveEditTermo = () => {
    if (editingTermoId && editingTermo.titulo && editingTermo.texto) {
      updateCategoriaGarantia(editingTermoId, editingTermo.texto, editingTermo.titulo)
      setEditingTermoId(null)
      setEditingTermo({ titulo: "", texto: "" })
      setSavedMessage("Termo atualizado!")
      setTimeout(() => setSavedMessage(""), 3000)
    }
  }

  const confirmDeleteTermo = () => {
    if (!deleteTermoId) return
    const cat = config.termosGarantia.categorias.find((c) => c.id === deleteTermoId)
    appendAuditLog({
      action: "registro_excluido",
      userLabel: `${(config.empresa.nomeFantasia || "Loja").trim() || "Administrador"} (sessão local)`,
      detail: `Termo de garantia excluído: ${cat?.servico ?? deleteTermoId}`,
    })
    removeCategoriaGarantia(deleteTermoId)
    setDeleteTermoId(null)
    setSavedMessage("Termo excluído!")
    setTimeout(() => setSavedMessage(""), 3000)
  }

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14)
    return digits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2")
  }

  const handleBackup = async () => {
    setIsGeneratingBackup(true)
    const backupPayload = {
      generatedAt: new Date().toISOString(),
      empresa: {
        ...config.empresa,
        nomeFantasia: config.empresa.nomeFantasia || "RAFACELL ASSISTEC",
        cnpj: config.empresa.cnpj || "48.241.205/0001-95",
      },
      termosGarantia: config.termosGarantia,
      minhasLojas: config.minhasLojas,
    }
    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
      type: "application/json;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `backup-rafacell-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    await new Promise((r) => setTimeout(r, 400))
    setIsGeneratingBackup(false)
    setSavedMessage("Backup gerado com sucesso!")
    setTimeout(() => setSavedMessage(""), 3000)
  }

  const handleLogoLojaUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      const url = reader.result as string
      setPerfisLojas((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], logoUrl: url }
        return next
      })
    }
    reader.readAsDataURL(file)
  }

  const handleRestaurarPadroesPdv = () => {
    const def = configPadrao.pdv
    setAtalhosPDV(atalhosParaEdicao(def.atalhosRapidos))
    setOcultarCategoriasNoPdv(def.ocultarCategoriasNoPdv)
    setCategoriasOcultasText(def.categoriasOcultasNoPdv.join("\n"))
    setModuloControleConsumo(def.moduloControleConsumo)
    updatePdv({
      atalhosRapidos: def.atalhosRapidos,
      ocultarCategoriasNoPdv: def.ocultarCategoriasNoPdv,
      categoriasOcultasNoPdv: [...def.categoriasOcultasNoPdv],
      moduloControleConsumo: def.moduloControleConsumo,
    })
    setSavedMessage("Personalização do PDV restaurada aos padrões.")
    setTimeout(() => setSavedMessage(""), 3000)
  }

  return (
    <>
    <div className="space-y-6">
      {/* Mensagem de sucesso */}
      {savedMessage && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-500 px-4 py-3 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5" />
          {savedMessage}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 h-auto gap-1 bg-secondary p-1">
          <TabsTrigger 
            value="dados-empresa" 
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Building2 className="w-4 h-4 mr-2 hidden sm:inline" />
            Dados
          </TabsTrigger>
          <TabsTrigger
            value="ajustes"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Settings className="w-4 h-4 mr-2 hidden sm:inline" />
            Ajustes
          </TabsTrigger>
          <TabsTrigger
            value="pdv-personalizacao"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Wallet className="w-4 h-4 mr-2 hidden sm:inline" />
            <span className="hidden xl:inline">Financeiro RAFACELL</span>
            <span className="xl:hidden">Financeiro</span>
          </TabsTrigger>
          <TabsTrigger 
            value="marca-logo"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Palette className="w-4 h-4 mr-2 hidden sm:inline" />
            Marca/Logo
          </TabsTrigger>
          <TabsTrigger 
            value="certificado"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <FileKey className="w-4 h-4 mr-2 hidden sm:inline" />
            Certificado
          </TabsTrigger>
          <TabsTrigger 
            value="termos-garantia"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Shield className="w-4 h-4 mr-2 hidden sm:inline" />
            Garantia
          </TabsTrigger>
          <TabsTrigger
            value="backup"
            className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Database className="w-4 h-4 mr-2 hidden sm:inline" />
            Backup
          </TabsTrigger>
          {!isBronze && (
            <TabsTrigger
              value="multilojas"
              className="text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Store className="w-4 h-4 mr-2 hidden sm:inline" />
              Minhas Lojas
            </TabsTrigger>
          )}
        </TabsList>

        {/* ABA 1: DADOS DA EMPRESA */}
        <TabsContent value="dados-empresa" className="mt-6">
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
                  <Label htmlFor="nome">Nome</Label>
                  <Input
                    id="nome"
                    value={nomeFantasia}
                    onChange={(e) => setNomeFantasia(e.target.value)}
                    placeholder="RAFACELL ASSISTEC"
                    className="h-12 text-base"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ / CPF</Label>
                  <Input
                    id="cnpj"
                    value={cnpj}
                    onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                    placeholder="48.241.205/0001-95"
                    className="h-12 text-base"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Endereço Completo
                </Label>
                <div className="grid grid-cols-4 gap-2">
                  <Input
                    value={rua}
                    onChange={(e) => setRua(e.target.value)}
                    placeholder="Rua Dona Beni"
                    className="col-span-3 h-10"
                  />
                  <Input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="Nº"
                    className="h-10"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Input
                    value={bairro}
                    onChange={(e) => setBairro(e.target.value)}
                    placeholder="Centro"
                    className="h-10"
                  />
                  <Input
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    placeholder="Taguaí"
                    className="col-span-2 h-10"
                  />
                  <Input
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    placeholder="SP"
                    className="h-10"
                    maxLength={2}
                  />
                </div>
                <Input
                  value={cep}
                  onChange={(e) => setCep(e.target.value)}
                  placeholder="CEP: 18890-000"
                  className="h-10 max-w-[200px]"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ajustes: contatos, mensagens WhatsApp (orçamento), atalhos PDV */}
        <TabsContent value="ajustes" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-primary" />
                Perfil da Loja
              </CardTitle>
              <CardDescription>
                Padrão: Assistência Técnica. Em Supermercado ou Variedades, os campos de técnico e laudo de OS ficam
                ocultos; estoque e vendas seguem iguais. A preferência é salva no servidor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 max-w-lg">
              <Label htmlFor="perfil-loja-select">Perfil</Label>
              <Select
                value={perfilLoja}
                onValueChange={(v) => void setPerfilLoja(v as PerfilLojaId)}
                disabled={!perfilHydrated}
              >
                <SelectTrigger id="perfil-loja-select" className="h-12 bg-secondary border-border">
                  <SelectValue placeholder="Carregando…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERFIL_LOJA_LABELS) as PerfilLojaId[]).map((id) => (
                    <SelectItem key={id} value={id}>
                      {PERFIL_LOJA_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ao trocar o perfil, a aba Laudo na ordem de serviço e o laudo em Serviços somem automaticamente.
              </p>
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
                    placeholder="(14) 99856-4545"
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
                    placeholder="(14) 99856-4545"
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
                    placeholder="contato@rafacell.com.br"
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

        </TabsContent>

        <TabsContent value="pdv-personalizacao" className="mt-6 space-y-6">
          <CentroPersonalizacaoFinanceiraRafacell />
        </TabsContent>

        {/* ABA 2: MARCA E LOGO */}
        <TabsContent value="marca-logo" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Upload de Logo */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary" />
                  Logo da Empresa
                </CardTitle>
                <CardDescription>
                  Imagem que aparecerá nos documentos (PNG, JPG)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-6">
                  {/* Preview da Logo */}
                  <div className="w-40 h-40 border-2 border-dashed border-border rounded-lg flex items-center justify-center bg-secondary/50 overflow-hidden">
                    {logo ? (
                      <img 
                        src={logo} 
                        alt="Logo" 
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <ImageIcon className="w-12 h-12 mx-auto mb-2" />
                        <span className="text-sm">Sem logo</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Botão de Upload */}
                  <div className="w-full space-y-3">
                    <Label 
                      htmlFor="logo-upload" 
                      className="flex items-center justify-center gap-2 h-12 px-4 bg-secondary hover:bg-secondary/80 rounded-lg cursor-pointer transition-colors w-full"
                    >
                      <Upload className="w-5 h-5" />
                      Escolher Imagem
                    </Label>
                    <input
                      id="logo-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Recomendado: 200x200px, fundo transparente (PNG)
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cores do Tema */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5 text-primary" />
                  Cores do Tema
                </CardTitle>
                <CardDescription>
                  Tema visual: Preto, Vermelho e Branco
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Cor Primária (Botões/Destaques)</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={corPrimaria}
                        onChange={(e) => setCorPrimaria(e.target.value)}
                        className="w-12 h-12 rounded-lg border border-border cursor-pointer"
                      />
                      <Input
                        value={corPrimaria}
                        onChange={(e) => setCorPrimaria(e.target.value)}
                        className="h-10 flex-1 uppercase"
                        maxLength={7}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Cor de Fundo</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={corFundo}
                        onChange={(e) => setCorFundo(e.target.value)}
                        className="w-12 h-12 rounded-lg border border-border cursor-pointer"
                      />
                      <Input
                        value={corFundo}
                        onChange={(e) => setCorFundo(e.target.value)}
                        className="h-10 flex-1 uppercase"
                        maxLength={7}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Cor do Texto</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={corTexto}
                        onChange={(e) => setCorTexto(e.target.value)}
                        className="w-12 h-12 rounded-lg border border-border cursor-pointer"
                      />
                      <Input
                        value={corTexto}
                        onChange={(e) => setCorTexto(e.target.value)}
                        className="h-10 flex-1 uppercase"
                        maxLength={7}
                      />
                    </div>
                  </div>
                </div>

                {/* Preview do Tema */}
                <div className="p-4 rounded-lg border border-border" style={{ backgroundColor: corFundo }}>
                  <p className="text-sm font-medium mb-2" style={{ color: corTexto }}>Preview do Tema</p>
                  <Button size="sm" style={{ backgroundColor: corPrimaria, color: corTexto }}>
                    Botão Exemplo
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ABA 3: CERTIFICADO DIGITAL */}
        <TabsContent value="certificado" className="mt-6">
          <Card className="bg-card border-border max-w-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileKey className="w-5 h-5 text-primary" />
                Certificado Digital A1
              </CardTitle>
              <CardDescription>
                Necessário para emissão de NF-e (.pfx ou .p12)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Status do Certificado */}
              <div className="flex items-center gap-4 p-4 bg-secondary/50 rounded-lg">
                <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center">
                  <FileKey className="w-7 h-7 text-primary" />
                </div>
                <div className="flex-1">
                  {certificado ? (
                    <>
                      <p className="font-medium text-foreground text-lg">
                        {certificado.name}
                      </p>
                      <p className="text-sm text-green-500 flex items-center gap-1">
                        <Check className="w-4 h-4" />
                        Status: Ativo
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-foreground text-lg">
                        Nenhum certificado enviado
                      </p>
                      <p className="text-sm text-yellow-500">
                        Status: {statusCertificado}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Upload */}
              <div className="space-y-4">
                <Label 
                  htmlFor="cert-upload" 
                  className="flex items-center justify-center gap-2 h-14 px-4 bg-secondary hover:bg-secondary/80 rounded-lg cursor-pointer transition-colors text-base"
                >
                  <Upload className="w-5 h-5" />
                  {certificado ? "Substituir Certificado" : "Enviar Certificado A1"}
                </Label>
                <input
                  id="cert-upload"
                  type="file"
                  accept=".pfx,.p12"
                  onChange={handleCertificadoUpload}
                  className="hidden"
                />

                {certificado && (
                  <div className="space-y-2">
                    <Label htmlFor="cert-senha">Senha do Certificado</Label>
                    <Input
                      id="cert-senha"
                      type="password"
                      value={senhaCertificado}
                      onChange={(e) => setSenhaCertificado(e.target.value)}
                      placeholder="Digite a senha do certificado"
                      className="h-12"
                    />
                  </div>
                )}
              </div>

              {/* Instruções */}
              <div className="p-4 bg-muted/50 rounded-lg text-sm text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">Instruções:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Apenas certificados do tipo A1 são suportados</li>
                  <li>Formatos aceitos: .pfx ou .p12</li>
                  <li>A senha é necessária para validar o certificado</li>
                  <li>Certifique-se de que o certificado está válido (não expirado)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA 4: TERMOS DE GARANTIA */}
        <TabsContent value="termos-garantia" className="mt-6">
          <div className="space-y-6">
            {/* Header com Botões */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-semibold">{config.termosGarantia.tituloGeral}</h3>
                <p className="text-sm text-muted-foreground">
                  Cadastre, edite ou exclua os termos que aparecerão nas OS
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={() => setIsAddingTermo(true)}
                  className="bg-primary hover:bg-primary/90"
                >
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
                      onChange={(e) => setNovoTermo(prev => ({ ...prev, titulo: e.target.value }))}
                      placeholder="Ex: Serviço de Software"
                      className="h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Texto da Garantia *</Label>
                    <Textarea
                      value={novoTermo.texto}
                      onChange={(e) => setNovoTermo(prev => ({ ...prev, texto: e.target.value }))}
                      rows={4}
                      placeholder="Digite as condições de garantia para este serviço..."
                      className="resize-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => { setIsAddingTermo(false); setNovoTermo({ titulo: "", texto: "" }) }}>
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
                  onChange={(e) =>
                    setTextosTermos((prev) => ({ ...prev, garantiaLegal: e.target.value }))
                  }
                  rows={3}
                  className="resize-none text-sm"
                />
              </CardContent>
            </Card>

            {/* Lista de Termos Cadastrados */}
            {config.termosGarantia.categorias.map((categoria) => (
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
                            onChange={(e) => setEditingTermo(prev => ({ ...prev, titulo: e.target.value }))}
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
                            onClick={() => { setEditingTermoId(null); setEditingTermo({ titulo: "", texto: "" }) }}
                            className="text-muted-foreground"
                          >
                            Cancelar
                          </Button>
                          <Button 
                            size="sm"
                            onClick={handleSaveEditTermo}
                            className="bg-primary hover:bg-primary/90"
                          >
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
                      onChange={(e) => setEditingTermo(prev => ({ ...prev, texto: e.target.value }))}
                      rows={4}
                      className="resize-none text-sm"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {categoria.detalhes}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="backup" className="mt-6">
          <div className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary" />
                  Backup do Sistema
                </CardTitle>
                <CardDescription>
                  Gere um arquivo JSON com dados da RAFACELL ASSISTEC (CNPJ 48.241.205/0001-95), termos e lojas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-sm text-muted-foreground">
                  Recomendação: gerar backup diário ao final do expediente para manter histórico e segurança jurídica.
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleBackup}
                    className="bg-primary hover:bg-primary/90"
                    disabled={isGeneratingBackup}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {isGeneratingBackup ? "Gerando..." : "Gerar Backup"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-primary" />
                  Importar Dados Externos
                </CardTitle>
                <CardDescription>
                  Importe dados do GestãoClick. Produtos são enviados ao banco em lotes de 500, com progresso em tempo real.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ImportadorDadosExternos />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="multilojas" className="mt-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Limite por plano: 1 unidade (Bronze), 2 (Prata), até 5 (Ouro). CNPJ e logotipo por unidade. Use o seletor
            &quot;Unidade ativa&quot; no menu lateral para alternar estoque e vendas. Salve com o botão no rodapé.
          </p>
          {Array.from({ length: maxLojas }, (_, idx) => idx).map((idx) => {
            const p =
              perfisLojas[idx] ?? emptyPerfilLoja(`loja-${idx + 1}`)
            const titulo = `Loja ${idx + 1}`
            return (
              <Card key={idx} className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5 text-primary" />
                    {titulo}
                  </CardTitle>
                  <CardDescription>Nome fantasia, razão social, CNPJ, endereço e logotipo desta unidade.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-24 h-24 rounded-lg border border-border bg-secondary flex items-center justify-center overflow-hidden">
                        {p.logoUrl ? (
                          <img src={p.logoUrl} alt="" className="max-w-full max-h-full object-contain" />
                        ) : (
                          <ImageIcon className="w-10 h-10 text-muted-foreground" />
                        )}
                      </div>
                      <Label className="cursor-pointer">
                        <span className="text-xs text-primary">Enviar logo</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoLojaUpload(idx, e)} />
                      </Label>
                    </div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Nome fantasia</Label>
                        <Input
                          value={p.nomeFantasia}
                          onChange={(e) => {
                            const v = e.target.value
                            setPerfisLojas((prev) => {
                              const next = [...padPerfisLojas(prev, maxLojas)]
                              next[idx] = { ...next[idx], nomeFantasia: v }
                              return next
                            })
                          }}
                          className="bg-secondary border-border"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <Label>Razão social</Label>
                        <Input
                          value={p.razaoSocial}
                          onChange={(e) => {
                            const v = e.target.value
                            setPerfisLojas((prev) => {
                              const next = [...padPerfisLojas(prev, maxLojas)]
                              next[idx] = { ...next[idx], razaoSocial: v }
                              return next
                            })
                          }}
                          className="bg-secondary border-border"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>CNPJ</Label>
                        <Input
                          value={p.cnpj}
                          onChange={(e) => {
                            const v = formatCnpj(e.target.value)
                            setPerfisLojas((prev) => {
                              const next = [...padPerfisLojas(prev, maxLojas)]
                              next[idx] = { ...next[idx], cnpj: v }
                              return next
                            })
                          }}
                          className="bg-secondary border-border"
                          placeholder="00.000.000/0000-00"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(
                      [
                        ["rua", "Rua", p.endereco.rua],
                        ["numero", "Número", p.endereco.numero],
                        ["bairro", "Bairro", p.endereco.bairro],
                        ["cidade", "Cidade", p.endereco.cidade],
                        ["estado", "UF", p.endereco.estado],
                        ["cep", "CEP", p.endereco.cep],
                      ] as const
                    ).map(([key, label, val]) => (
                      <div key={key} className="space-y-1">
                        <Label>{label}</Label>
                        <Input
                          value={val}
                          onChange={(e) => {
                            const v = e.target.value
                            setPerfisLojas((prev) => {
                              const next = [...padPerfisLojas(prev, maxLojas)]
                              next[idx] = {
                                ...next[idx],
                                endereco: { ...next[idx].endereco, [key]: v },
                              }
                              return next
                            })
                          }}
                          className="bg-secondary border-border"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>
      </Tabs>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 mt-4 border-t border-border">
        <p className="text-sm text-muted-foreground max-w-xl">
          Um único salvamento aplica empresa, marca, certificado, termos de garantia, contatos, mensagens de orçamento e atalhos do PDV.
        </p>
        <Button
          size="lg"
          className="h-12 px-8 bg-primary hover:bg-primary/90 shrink-0"
          onClick={handleSave}
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
              Salvar alterações
            </>
          )}
        </Button>
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
