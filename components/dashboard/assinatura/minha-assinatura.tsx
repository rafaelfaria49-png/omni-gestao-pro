"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Check, CheckCircle2, Crown, FileClock, QrCode, Sparkles, XCircle, Zap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useConfigEmpresa } from "@/lib/config-empresa"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const recursosPorPlano = {
  bronze: [
    ["Gestão básica + WhatsApp", true],
    ["Consulta de Crédito", false],
    ["Relatórios avançados", false],
    ["Multiloja", false],
    ["Emissão de boletos", false],
  ],
  prata: [
    ["Gestão básica + WhatsApp", true],
    ["Consulta de Crédito", true],
    ["Relatórios avançados", true],
    ["Multiloja", false],
    ["Emissão de boletos", false],
  ],
  ouro: [
    ["Gestão básica + WhatsApp", true],
    ["Consulta de Crédito", true],
    ["Relatórios avançados", true],
    ["Multiloja", true],
    ["Emissão de boletos", true],
  ],
} as const

const PLAN_ORDER: Record<"bronze" | "prata" | "ouro", number> = {
  bronze: 0,
  prata: 1,
  ouro: 2,
}

const GRID_PLANOS = [
  {
    id: "bronze" as const,
    nome: "Bronze",
    preco: 49.9,
    icone: Zap,
    subtitulo: "Gestão básica + WhatsApp",
    bullets: ["PDV e Ordens de Serviço", "Integração WhatsApp", "Ideal para começar"],
  },
  {
    id: "prata" as const,
    nome: "Prata",
    preco: 99.9,
    icone: Sparkles,
    subtitulo: "Tudo do Bronze, mais performance",
    bullets: ["Consulta de Crédito", "Relatórios avançados", "Suporte prioritário"],
  },
  {
    id: "ouro" as const,
    nome: "Ouro",
    preco: 149.9,
    icone: Crown,
    subtitulo: "Operação completa",
    bullets: ["Multiloja", "Emissão de boletos", "Máxima escala para sua rede"],
  },
]

const notasFiscaisServico = [
  { id: "NF-000213", emissao: "2026-02-10", valor: 99.9, situacao: "Pago" },
  { id: "NF-000214", emissao: "2026-03-10", valor: 99.9, situacao: "Pago" },
  { id: "NF-000215", emissao: "2026-04-10", valor: 99.9, situacao: "Em aberto" },
]

export function MinhaAssinatura() {
  const searchParams = useSearchParams()
  const { config, updateAssinatura } = useConfigEmpresa()
  const { toast } = useToast()
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false)
  const [serverTrustExpired, setServerTrustExpired] = useState<boolean | null>(null)
  const pixPayload = "00020126330014BR.GOV.BCB.PIX0111482412050001955204000053039865802BR5920RAFACELL ASSISTEC6008TAGUAI62070503***6304ABCD"
  const vencimento = new Date(`${config.assinatura.vencimento}T00:00:00`)
  const expiradoLocal = new Date() > vencimento
  const expirado = serverTrustExpired ?? expiradoLocal
  const recursos = useMemo(() => recursosPorPlano[config.assinatura.plano], [config.assinatura.plano])
  const blockedFlow = searchParams.get("blocked") === "1"

  useEffect(() => {
    void (async () => {
      for (let i = 0; i < 30; i++) {
        try {
          const r = await fetch("/api/subscription/verify", { credentials: "include", cache: "no-store" })
          const j = (await r.json()) as { expired?: boolean; pendingSeal?: boolean }
          if (j.pendingSeal) {
            await new Promise((res) => setTimeout(res, 200))
            continue
          }
          setServerTrustExpired(!!j.expired)
          return
        } catch {
          setServerTrustExpired(true)
          return
        }
      }
      setServerTrustExpired(true)
    })()
  }, [config.assinatura.vencimento, config.assinatura.status])

  useEffect(() => {
    const renew = searchParams.get("renew") === "1"
    const blocked = searchParams.get("blocked") === "1"
    if (renew || blocked) setIsRenewModalOpen(true)
  }, [searchParams])

  const formatDate = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR")
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)

  const planoAtual = config.assinatura.plano
  const tierAtual = PLAN_ORDER[planoAtual]

  const handleEscolherPlano = (id: "bronze" | "prata" | "ouro", valor: number) => {
    if (id === planoAtual) return
    updateAssinatura({ plano: id, valor })
    toast({
      title: "Plano atualizado",
      description: `Seu plano agora é ${id.charAt(0).toUpperCase() + id.slice(1)} (${formatCurrency(valor)}/mês).`,
    })
  }

  return (
    <div className="space-y-8 rounded-xl bg-background p-4 lg:p-6">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-bold text-foreground">Minha Assinatura</h1>
        <p className="text-muted-foreground">Gerencie plano, mensalidade e recursos liberados</p>
      </div>
      {blockedFlow && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          Seu plano precisa estar ativo para usar PDV, Ordens de Serviço e o Financeiro. Renove abaixo com
          segurança via Pix — em instantes você recupera o acesso completo.
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-foreground text-center mb-2">
          Planos {APP_DISPLAY_NAME}
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-6 max-w-2xl mx-auto">
          Compare os níveis e faça upgrade quando precisar de mais recursos.
        </p>
        <div className="grid gap-6 md:grid-cols-3 max-w-6xl mx-auto">
          {GRID_PLANOS.map((p) => {
            const Icon = p.icone
            const tier = PLAN_ORDER[p.id]
            const isCurrent = p.id === planoAtual
            return (
              <Card
                key={p.id}
                className={`relative flex flex-col border bg-card text-card-foreground shadow-sm transition-colors ${
                  isCurrent
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {p.id === "ouro" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                    Completo
                  </div>
                )}
                <CardHeader className="pb-2 pt-6">
                  <div className="flex items-center gap-2 text-primary">
                    <Icon className="h-6 w-6" />
                    <CardTitle className="text-xl">{p.nome}</CardTitle>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{p.subtitulo}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{formatCurrency(p.preco)}</span>
                    <span className="text-sm text-muted-foreground">/mês</span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4 pt-0">
                  <ul className="space-y-2 text-sm text-muted-foreground flex-1">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex gap-2">
                        <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button disabled className="w-full bg-secondary text-secondary-foreground cursor-default">
                      Plano Atual
                    </Button>
                  ) : tier > tierAtual ? (
                    <Button
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => handleEscolherPlano(p.id, p.preco)}
                    >
                      Fazer Upgrade
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full border-border bg-secondary/50 hover:bg-secondary"
                      onClick={() => handleEscolherPlano(p.id, p.preco)}
                    >
                      Alterar para este plano
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Plano Contratado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableBody>
                  <TableRow><TableCell className="font-medium">Nome do Plano</TableCell><TableCell className="text-right uppercase">{config.assinatura.plano}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Vencimento</TableCell><TableCell className="text-right">{formatDate(config.assinatura.vencimento)}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Período</TableCell><TableCell className="text-right capitalize">{config.assinatura.periodo}</TableCell></TableRow>
                  <TableRow><TableCell className="font-medium">Valor</TableCell><TableCell className="text-right">{formatCurrency(config.assinatura.valor)}</TableCell></TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Situação</TableCell>
                    <TableCell className="text-right">
                      <Badge className={expirado ? "bg-amber-500 text-white" : "bg-green-600 text-white"}>
                        {expirado ? "Expirado" : "Ativo"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Forma de Pagamento</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="border-border bg-secondary hover:bg-secondary/80"
                  onClick={() => toast({ title: "Funcionalidade em breve", description: "Edicao de forma de pagamento sera integrada ao gateway." })}
                >
                  Editar Forma
                </Button>
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => toast({ title: "Historico exibido abaixo", description: "Consulte a tabela de notas fiscais de servico." })}
                >
                  Historico de Pagamentos
                </Button>
                <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setIsRenewModalOpen(true)}>
                  Renovar Assinatura
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Recursos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recursos.map(([nome, liberado]) => (
              <div key={nome} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 bg-secondary/30">
                <span className="text-sm">{nome}</span>
                {liberado ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="w-5 h-5 text-primary" />
            Notas Fiscais de Serviço
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notasFiscaisServico.map((nf) => (
                <TableRow key={nf.id}>
                  <TableCell className="font-medium">{nf.id}</TableCell>
                  <TableCell>{formatDate(nf.emissao)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(nf.valor)}</TableCell>
                  <TableCell className="text-right">{nf.situacao}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isRenewModalOpen} onOpenChange={setIsRenewModalOpen}>
        <DialogContent className="max-w-lg bg-card border-border text-card-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              Renovar Assinatura via Pix
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-secondary p-3 text-xs break-all">
              {pixPayload}
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={async () => {
                await navigator.clipboard.writeText(pixPayload)
                toast({ title: "Pix Copia e Cola copiado" })
              }}
            >
              <Crown className="w-4 h-4 mr-2" />
              Copiar Código Pix
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const novoVencimento = new Date()
                novoVencimento.setMonth(novoVencimento.getMonth() + 1)
                updateAssinatura({
                  status: "ativa",
                  vencimento: novoVencimento.toISOString().split("T")[0],
                })
                setIsRenewModalOpen(false)
                toast({ title: "Assinatura renovada", description: "Vencimento atualizado com sucesso." })
              }}
            >
              Simular confirmação de pagamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

