"use client"

import { useState, useEffect, useCallback } from "react"
import { 
  Search, 
  Plus, 
  Phone, 
  Mail, 
  MapPin, 
  Smartphone,
  Edit,
  Eye,
  MessageCircle,
  User,
  FileText
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { ASSISTEC_LOJA_HEADER } from "@/lib/assistec-headers"
import { subscribeClientesRevalidate } from "@/lib/clientes-revalidate"
import { useLojaAtiva } from "@/lib/loja-ativa"

type ScoreInterno = {
  valor: number
  faixa: "critico" | "alerta" | "confiavel"
}

type Cliente = {
  id: string
  nome: string
  cpf: string
  telefone: string
  email: string
  endereco: string
  aparelhosRecorrentes: string[]
  totalOS: number
  ultimaVisita: string
}

interface CadastroClientesProps {
  /** Incrementado pelo fluxo de voz (página principal) para abrir o modal de novo cliente. */
  voiceOpenNewCliente?: number
  onVoiceOpenNewClienteConsumed?: () => void
}

export function CadastroClientes({
  voiceOpenNewCliente = 0,
  onVoiceOpenNewClienteConsumed,
}: CadastroClientesProps = {}) {
  const { lojaAtivaId } = useLojaAtiva()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clientesLoading, setClientesLoading] = useState(true)
  const [clientesError, setClientesError] = useState<string | null>(null)

  const loadClientes = useCallback(async () => {
    setClientesError(null)
    setClientesLoading(true)
    try {
      const res = await fetch("/api/ops/import/clientes", {
        credentials: "include",
        headers: lojaAtivaId ? { [ASSISTEC_LOJA_HEADER]: lojaAtivaId } : {},
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || `Falha ao carregar (HTTP ${res.status})`)
      }
      const data = (await res.json()) as { clientes?: Cliente[] }
      setClientes(Array.isArray(data.clientes) ? data.clientes : [])
    } catch (e) {
      setClientesError(e instanceof Error ? e.message : "Falha ao carregar clientes")
      setClientes([])
    } finally {
      setClientesLoading(false)
    }
  }, [lojaAtivaId])

  useEffect(() => {
    void loadClientes()
  }, [loadClientes])

  useEffect(() => {
    return subscribeClientesRevalidate(() => {
      void loadClientes()
    })
  }, [loadClientes])

  const [searchTerm, setSearchTerm] = useState("")
  const [isNewClientOpen, setIsNewClientOpen] = useState(false)

  const openNewClienteModal = useCallback(() => {
    setIsNewClientOpen(true)
  }, [])
  const [isPullingWhatsApp, setIsPullingWhatsApp] = useState(false)
  const [isConsultingDoc, setIsConsultingDoc] = useState(false)
  const [docInput, setDocInput] = useState("")
  const [nomeInput, setNomeInput] = useState("")
  const [telefoneInput, setTelefoneInput] = useState("")
  const [emailInput, setEmailInput] = useState("")
  const [enderecoInput, setEnderecoInput] = useState("")
  const [observacoesInput, setObservacoesInput] = useState("")
  const [docFeedback, setDocFeedback] = useState("")
  const [scoreInterno, setScoreInterno] = useState<ScoreInterno | null>(null)
  const [showScore, setShowScore] = useState(false)
  const [whatsAvatar, setWhatsAvatar] = useState<string | null>(null)
  const [newAparelho, setNewAparelho] = useState("")
  const [aparelhosLista, setAparelhosLista] = useState<string[]>([])

  useEffect(() => {
    if (!voiceOpenNewCliente) return
    openNewClienteModal()
    onVoiceOpenNewClienteConsumed?.()
  }, [voiceOpenNewCliente, onVoiceOpenNewClienteConsumed, openNewClienteModal])

  const mockConsultaDocumento: Record<string, { nome: string; telefone: string; email: string; endereco: string }> = {
    "48241205000195": {
      nome: "RAFACELL ASSISTEC",
      telefone: "(14) 99856-4545",
      email: "contato@rafacell.com.br",
      endereco: "Rua Dona Beni, 000 - Centro, Taguaí/SP",
    },
    "12345678900": {
      nome: "João Silva",
      telefone: "(11) 99999-1234",
      email: "joao@email.com",
      endereco: "Rua das Flores, 123 - Centro",
    },
  }

  const formatDoc = (numericDoc: string) => {
    if (numericDoc.length === 11) {
      return numericDoc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    }
    if (numericDoc.length === 14) {
      return numericDoc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    }
    return numericDoc
  }

  const filteredClientes = clientes.filter(c => 
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cpf.includes(searchTerm) ||
    c.telefone.includes(searchTerm)
  )

  const handlePuxarWhatsApp = () => {
    const telefone = telefoneInput.replace(/\D/g, "")
    if (!telefone) {
      setDocFeedback("Informe um telefone para buscar dados no WhatsApp.")
      return
    }
    setIsPullingWhatsApp(true)
    setTimeout(() => {
      const sufixo = telefone.slice(-4)
      if (!nomeInput.trim()) {
        setNomeInput(`Cliente WhatsApp ${sufixo}`)
      }
      setWhatsAvatar(`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nomeInput || `Cliente ${sufixo}`)}`)
      setDocFeedback("Dados simulados do WhatsApp carregados com sucesso.")
      setIsPullingWhatsApp(false)
    }, 2000)
  }

  const gerarScoreInterno = (numericDoc: string): ScoreInterno => {
    const base = parseInt(numericDoc.slice(-4) || "0", 10)
    const valor = Math.min(1000, 120 + (base % 881))
    if (valor <= 300) return { valor, faixa: "critico" }
    if (valor <= 700) return { valor, faixa: "alerta" }
    return { valor, faixa: "confiavel" }
  }

  const addAparelho = () => {
    if (newAparelho.trim()) {
      setAparelhosLista([...aparelhosLista, newAparelho.trim()])
      setNewAparelho("")
    }
  }

  const removeAparelho = (index: number) => {
    setAparelhosLista(aparelhosLista.filter((_, i) => i !== index))
  }

  const handleConsultarDocumento = async () => {
    const numericDoc = docInput.replace(/\D/g, "")
    if (!(numericDoc.length === 11 || numericDoc.length === 14)) {
      setDocFeedback("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.")
      setShowScore(false)
      return
    }
    setIsConsultingDoc(true)
    setDocFeedback("")
    setShowScore(false)
    try {
      if (numericDoc.length === 14) {
        const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${numericDoc}`)
        if (!resp.ok) throw new Error("CNPJ não localizado")
        const data = await resp.json()
        setDocInput(formatDoc(numericDoc))
        setNomeInput(data.razao_social || data.nome_fantasia || "")
        const enderecoApi = [data.logradouro, data.numero, data.bairro, data.municipio, data.uf]
          .filter(Boolean)
          .join(", ")
        if (enderecoApi) setEnderecoInput(enderecoApi)
        setDocFeedback("Dados do CNPJ localizados automaticamente via BrasilAPI.")
        setScoreInterno(null)
      } else {
        const resp = await fetch(`https://brasilapi.com.br/api/cpf/v1/${numericDoc}`)
        if (!resp.ok) throw new Error("CPF não localizado")
        const data = await resp.json()
        setDocInput(formatDoc(numericDoc))
        setNomeInput(data.name || "")
        setDocFeedback("Dados do CPF localizados automaticamente via BrasilAPI.")
        setScoreInterno(null)
      }
    } catch {
      const encontrado = mockConsultaDocumento[numericDoc]
      if (encontrado) {
        setDocInput(formatDoc(numericDoc))
        setNomeInput(encontrado.nome)
        setTelefoneInput(encontrado.telefone)
        setEmailInput(encontrado.email)
        setEnderecoInput(encontrado.endereco)
        setDocFeedback("BrasilAPI indisponível. Dados preenchidos pelo cache local.")
        setScoreInterno(null)
      } else {
        setDocFeedback(
          `Dados não encontrados na base pública. Iniciando análise de crédito interna (${APP_DISPLAY_NAME})...`
        )
        setScoreInterno(gerarScoreInterno(numericDoc))
        setShowScore(true)
      }
    }
    setIsConsultingDoc(false)
  }

  return (
    <div className="space-y-6">
      {/* Barra de busca e ações */}
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF ou telefone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
            <Dialog open={isNewClientOpen} onOpenChange={setIsNewClientOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90">
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Cliente
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Cadastrar Novo Cliente</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  {/* Botão Puxar WhatsApp */}
                  <Button
                    variant="outline"
                    onClick={handlePuxarWhatsApp}
                    disabled={isPullingWhatsApp}
                    className="w-full border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    {isPullingWhatsApp ? "Buscando dados..." : "Puxar Dados do WhatsApp"}
                  </Button>
                  
                  {isPullingWhatsApp && (
                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 text-center">
                      <p className="text-sm text-primary">Conectando ao WhatsApp para buscar informações do cliente...</p>
                    </div>
                  )}
                  {whatsAvatar && (
                    <div className="flex items-center gap-3 rounded-lg bg-secondary p-3 border border-border">
                      <img src={whatsAvatar} alt="Avatar WhatsApp" className="w-10 h-10 rounded-full border border-border" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{nomeInput || "Cliente identificado"}</p>
                        <p className="text-xs text-muted-foreground">Perfil simulado via WhatsApp</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="nome">Nome Completo</Label>
                      <Input
                        id="nome"
                        placeholder="Nome do cliente"
                        className="bg-secondary"
                        value={nomeInput}
                        onChange={(e) => setNomeInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpfcnpj">CPF/CNPJ</Label>
                      <div className="flex gap-2">
                        <Input
                          id="cpfcnpj"
                          placeholder="000.000.000-00 ou 00.000.000/0000-00"
                          className="bg-secondary"
                          value={docInput}
                          onChange={(e) => setDocInput(e.target.value)}
                          onBlur={handleConsultarDocumento}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleConsultarDocumento}
                          disabled={isConsultingDoc}
                          className="border-primary/40 hover:bg-primary/10"
                        >
                          {isConsultingDoc ? "Consultando..." : "Consultar"}
                        </Button>
                      </div>
                      {docFeedback && (
                        <p className="text-xs text-primary">{docFeedback}</p>
                      )}
                      {showScore && scoreInterno && (
                        <div className="mt-2 p-3 rounded-lg border border-border bg-secondary/40 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Score interno ({APP_DISPLAY_NAME})</span>
                            <span className="font-semibold">{scoreInterno.valor}/1000</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${
                                scoreInterno.faixa === "confiavel"
                                  ? "bg-green-500"
                                  : scoreInterno.faixa === "alerta"
                                  ? "bg-yellow-500"
                                  : "bg-red-500"
                              }`}
                              style={{ width: `${(scoreInterno.valor / 1000) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="telefone">Telefone/WhatsApp</Label>
                      <Input
                        id="telefone"
                        placeholder="(00) 00000-0000"
                        className="bg-secondary"
                        value={telefoneInput}
                        onChange={(e) => setTelefoneInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">E-mail</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@exemplo.com"
                        className="bg-secondary"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="endereco">Endereço</Label>
                      <Input
                        id="endereco"
                        placeholder="Rua, número, bairro, cidade"
                        className="bg-secondary"
                        value={enderecoInput}
                        onChange={(e) => setEnderecoInput(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Aparelhos Recorrentes */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4" />
                      Aparelhos Recorrentes
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Cadastre os aparelhos que o cliente costuma trazer para manutenção
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Ex: iPhone 13, Samsung S21..."
                        value={newAparelho}
                        onChange={(e) => setNewAparelho(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && addAparelho()}
                        className="bg-secondary"
                      />
                      <Button variant="outline" onClick={addAparelho}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {aparelhosLista.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {aparelhosLista.map((aparelho, index) => (
                          <Badge 
                            key={index} 
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => removeAparelho(index)}
                          >
                            {aparelho} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="observacoes">Observações</Label>
                    <Textarea 
                      id="observacoes" 
                      placeholder="Anotações sobre o cliente..." 
                      className="bg-secondary min-h-[80px]"
                      value={observacoesInput}
                      onChange={(e) => setObservacoesInput(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setIsNewClientOpen(false)}>
                      Cancelar
                    </Button>
                    <Button className="flex-1 bg-primary hover:bg-primary/90">
                      Salvar Cliente
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Clientes */}
      <div className="grid gap-4">
        {clientesLoading && (
          <p className="text-sm text-muted-foreground">Carregando clientes…</p>
        )}
        {clientesError && !clientesLoading && (
          <p className="text-sm text-destructive">{clientesError}</p>
        )}
        {!clientesLoading && !clientesError && clientes.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado. Importe na aba Backup ou cadastre manualmente.</p>
        )}
        {!clientesLoading && !clientesError && clientes.length > 0 && filteredClientes.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum cliente corresponde à busca.</p>
        )}
        {filteredClientes.map((cliente) => (
          <Card key={cliente.id} className="bg-card border-border hover:border-primary/50 transition-colors">
            <CardContent className="pt-6">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground">{cliente.nome}</h3>
                    <p className="text-sm text-muted-foreground">{cliente.cpf}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span>{cliente.telefone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span className="truncate">{cliente.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4" />
                    <span>{cliente.totalOS} OS</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="w-4 h-4" />
                    <span className="truncate">
                      {cliente.endereco?.includes(" - ")
                        ? cliente.endereco.split(" - ")[1]
                        : cliente.endereco || "—"}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" size="icon">
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-primary">
                    <MessageCircle className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Aparelhos Recorrentes */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2 mb-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Aparelhos Recorrentes:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cliente.aparelhosRecorrentes.map((aparelho, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {aparelho}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
