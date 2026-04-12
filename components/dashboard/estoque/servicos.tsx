"use client"

import { useState, useRef } from "react"
import { usePerfilLoja } from "@/lib/perfil-loja-provider"
import { 
  Search, 
  Plus, 
  Edit,
  Trash2,
  Clock,
  DollarSign,
  Camera,
  Upload,
  X,
  Image as ImageIcon,
  Wrench
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Servico = {
  id: string
  nome: string
  descricao: string
  preco: number
  tempoEstimado: string
  categoria: string
}

type FotoLaudo = {
  id: string
  url: string
  descricao: string
}

const servicos: Servico[] = [
  {
    id: "1",
    nome: "Troca de Tela",
    descricao: "Substituição de display LCD ou AMOLED com garantia de 90 dias",
    preco: 150.00,
    tempoEstimado: "2h",
    categoria: "Manutenção"
  },
  {
    id: "2",
    nome: "Troca de Bateria",
    descricao: "Substituição de bateria original ou compatível",
    preco: 80.00,
    tempoEstimado: "1h",
    categoria: "Manutenção"
  },
  {
    id: "3",
    nome: "Troca de Conector de Carga",
    descricao: "Reparo do módulo de carregamento",
    preco: 100.00,
    tempoEstimado: "1h30",
    categoria: "Manutenção"
  },
  {
    id: "4",
    nome: "Limpeza Interna",
    descricao: "Limpeza de componentes e troca de pasta térmica",
    preco: 60.00,
    tempoEstimado: "45min",
    categoria: "Manutenção Preventiva"
  },
  {
    id: "5",
    nome: "Backup e Restauração",
    descricao: "Backup completo e restauração de dados",
    preco: 50.00,
    tempoEstimado: "1h",
    categoria: "Software"
  },
]

export function Servicos() {
  const { mostraTecnicoLaudoOs } = usePerfilLoja()
  const [searchTerm, setSearchTerm] = useState("")
  const [isNewServiceOpen, setIsNewServiceOpen] = useState(false)
  const [isLaudoOpen, setIsLaudoOpen] = useState(false)
  const [fotosLaudo, setFotosLaudo] = useState<FotoLaudo[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredServicos = servicos.filter(s => 
    s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.categoria.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files) {
      Array.from(files).forEach((file) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          setFotosLaudo(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            url: e.target?.result as string,
            descricao: ""
          }])
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const removeFoto = (id: string) => {
    setFotosLaudo(fotosLaudo.filter(f => f.id !== id))
  }

  const updateFotoDescricao = (id: string, descricao: string) => {
    setFotosLaudo(fotosLaudo.map(f => 
      f.id === id ? { ...f, descricao } : f
    ))
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
                placeholder="Buscar serviço..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-secondary border-border"
              />
            </div>
            <div className="flex gap-2">
              {mostraTecnicoLaudoOs && (
              <Dialog open={isLaudoOpen} onOpenChange={setIsLaudoOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
                    <Camera className="w-4 h-4 mr-2" />
                    Laudo com Fotos
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Camera className="w-5 h-5" />
                      Anexar Fotos do Aparelho
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-6 py-4">
                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30">
                      <p className="text-sm text-foreground">
                        Anexe fotos do aparelho para documentar o estado de entrada. 
                        Isso ajuda na comprovação de defeitos pré-existentes e protege sua assistência.
                      </p>
                    </div>

                    {/* Upload de Fotos */}
                    <div className="space-y-4">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept="image/*"
                        multiple
                        className="hidden"
                      />
                      
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                      >
                        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">Clique para adicionar fotos</p>
                        <p className="text-xs text-muted-foreground mt-1">ou arraste e solte aqui</p>
                      </div>

                      {/* Preview das Fotos */}
                      {fotosLaudo.length > 0 && (
                        <div className="space-y-4">
                          <Label>Fotos Anexadas ({fotosLaudo.length})</Label>
                          <div className="grid grid-cols-2 gap-4">
                            {fotosLaudo.map((foto) => (
                              <div key={foto.id} className="relative group">
                                <div className="aspect-video rounded-lg overflow-hidden bg-secondary">
                                  <img 
                                    src={foto.url} 
                                    alt="Foto do aparelho"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => removeFoto(foto.id)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                                <Input
                                  placeholder="Descrição da foto..."
                                  value={foto.descricao}
                                  onChange={(e) => updateFotoDescricao(foto.id, e.target.value)}
                                  className="mt-2 text-sm bg-secondary"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Info do Aparelho */}
                    <div className="space-y-4">
                      <Label>Informações do Aparelho</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <Input placeholder="Modelo do aparelho" className="bg-secondary" />
                        <Input placeholder="IMEI / Número de Série" className="bg-secondary" />
                      </div>
                      <Textarea 
                        placeholder="Descreva o estado do aparelho na entrada (riscos, amassados, defeitos visíveis)..."
                        className="bg-secondary min-h-[100px]"
                      />
                    </div>

                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => setIsLaudoOpen(false)}>
                        Cancelar
                      </Button>
                      <Button className="flex-1 bg-primary hover:bg-primary/90">
                        Salvar Laudo
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              )}

              <Dialog open={isNewServiceOpen} onOpenChange={setIsNewServiceOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-primary hover:bg-primary/90">
                    <Plus className="w-4 h-4 mr-2" />
                    Novo Serviço
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Cadastrar Novo Serviço</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="nome">Nome do Serviço</Label>
                      <Input id="nome" placeholder="Ex: Troca de Tela" className="bg-secondary" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="categoria">Categoria</Label>
                      <Select>
                        <SelectTrigger className="bg-secondary">
                          <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manutencao">Manutenção</SelectItem>
                          <SelectItem value="preventiva">Manutenção Preventiva</SelectItem>
                          <SelectItem value="software">Software</SelectItem>
                          <SelectItem value="acessorios">Acessórios</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="preco">Preço (R$)</Label>
                        <Input id="preco" type="number" placeholder="0.00" className="bg-secondary" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tempo">Tempo Estimado</Label>
                        <Input id="tempo" placeholder="Ex: 2h" className="bg-secondary" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="descricao">Descrição</Label>
                      <Textarea 
                        id="descricao" 
                        placeholder="Descreva o serviço..." 
                        className="bg-secondary min-h-[80px]"
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" onClick={() => setIsNewServiceOpen(false)}>
                        Cancelar
                      </Button>
                      <Button className="flex-1 bg-primary hover:bg-primary/90">
                        Salvar Serviço
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Serviços */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredServicos.map((servico) => (
          <Card key={servico.id} className="bg-card border-border hover:border-primary/50 transition-colors">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Wrench className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{servico.nome}</h3>
                    <Badge variant="secondary" className="text-xs mt-1">
                      {servico.categoria}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                {servico.descricao}
              </p>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">{servico.tempoEstimado}</span>
                </div>
                <div className="flex items-center gap-1 text-primary font-bold">
                  <DollarSign className="w-4 h-4" />
                  <span>R$ {servico.preco.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
