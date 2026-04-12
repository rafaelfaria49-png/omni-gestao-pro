"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CreditCard, LogIn, QrCode, Shield, Smartphone, Sparkles, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useConfigEmpresa, configPadrao } from "@/lib/config-empresa"
import { useOperationsStore } from "@/lib/operations-store"
import { normalizeDocDigits } from "@/lib/cpf"
import { normalizeOrcamento } from "@/components/dashboard/orcamentos/orcamentos"
import type { Orcamento } from "@/lib/orcamento-types"
import type { OrdemServico } from "@/components/dashboard/os/ordens-servico"
import { useToast } from "@/hooks/use-toast"

const PLANOS_ASSINATURA = [
  {
    id: "pelicula-pro",
    nome: "Proteção de Tela Pro",
    desc: "Película premium com instalação e garantia de 90 dias contra descolamento.",
    preco: 49.9,
    periodicidade: "por aparelho",
  },
  {
    id: "suporte-vip",
    nome: "Suporte VIP",
    desc: "Prioridade no atendimento e diagnóstico rápido por 6 meses.",
    preco: 29.9,
    periodicidade: "mensal",
  },
]

export function ClientePortal() {
  const { config } = useConfigEmpresa()
  const { ordens, setOrdens, orcamentos, setOrcamentos } = useOperationsStore()
  const { toast } = useToast()
  const [cpfInput, setCpfInput] = useState("")
  const [sessionCpf, setSessionCpf] = useState<string | null>(null)

  const cpfDigits = useMemo(() => normalizeDocDigits(cpfInput), [cpfInput])

  const nomeEmpresa =
    (config.empresa.nomeFantasia || "").trim() || configPadrao.empresa.nomeFantasia

  const minhasOs = useMemo(() => {
    if (!sessionCpf) return []
    return ordens.filter((o) => normalizeDocDigits(o.cliente.cpf) === sessionCpf)
  }, [ordens, sessionCpf])

  const orcamentosPagamento = useMemo(() => {
    if (!sessionCpf) return []
    return orcamentos.filter((o) => {
      const n = normalizeOrcamento(o)
      return (
        n.status === "aprovado" &&
        n.pagamentoCliente !== "pago" &&
        normalizeDocDigits(n.cliente.cpf) === sessionCpf
      )
    })
  }, [orcamentos, sessionCpf])

  const formatBrl = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v)

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (cpfDigits.length !== 11) {
      toast({ title: "CPF inválido", description: "Informe um CPF com 11 dígitos.", variant: "destructive" })
      return
    }
    const tem =
      ordens.some((o) => normalizeDocDigits(o.cliente.cpf) === cpfDigits) ||
      orcamentos.some((o) => normalizeDocDigits(o.cliente.cpf) === cpfDigits)
    if (!tem) {
      toast({
        title: "Nenhum registro encontrado",
        description: "Não há ordem de serviço ou orçamento com este CPF neste dispositivo.",
        variant: "destructive",
      })
      return
    }
    setSessionCpf(cpfDigits)
    toast({ title: "Acesso liberado", description: "Bem-vindo ao portal." })
  }

  const pagarOs = (os: OrdemServico, metodo: "pix" | "cartao") => {
    setOrdens((prev) =>
      prev.map((o) => (o.id === os.id ? { ...o, status: "pago" as const } : o))
    )
    toast({
      title: "Pagamento registrado",
      description: `O.S. ${os.numero} marcada como Pago (${metodo === "pix" ? "PIX" : "cartão"}). O painel da loja foi atualizado.`,
    })
  }

  const pagarOrcamento = (orc: Orcamento, metodo: "pix" | "cartao") => {
    const n = normalizeOrcamento(orc)
    setOrcamentos((prev) =>
      prev.map((o) => (o.id === n.id ? { ...o, pagamentoCliente: "pago" as const } : o))
    )
    toast({
      title: "Orçamento quitado",
      description: `${n.numero} pago via ${metodo === "pix" ? "PIX" : "cartão"}.`,
    })
  }

  const assinarPlano = (planoId: string) => {
    toast({
      title: "Interesse registrado",
      description: `Plano ${planoId}: finalize na loja ou aguarde integração de pagamento online.`,
    })
  }

  const totalOs = (os: OrdemServico) => os.valorServico + os.valorPecas

  if (!sessionCpf) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <Card className="w-full max-w-md border-border shadow-xl">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <Smartphone className="w-7 h-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Portal do Cliente</CardTitle>
            <CardDescription>{nomeEmpresa}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cpf">CPF</Label>
                <Input
                  id="cpf"
                  inputMode="numeric"
                  autoComplete="username"
                  placeholder="Somente números"
                  value={cpfInput}
                  onChange={(e) => setCpfInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  className="h-11"
                />
              </div>
              <Button type="submit" className="w-full h-11 gap-2">
                <LogIn className="w-4 h-4" />
                Entrar
              </Button>
            </form>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Os dados são lidos do mesmo navegador em que a loja utiliza o sistema (armazenamento local).
            </p>
            <div className="text-center mt-4">
              <Link href="/" className="text-sm text-primary hover:underline">
                Voltar ao sistema da loja
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Portal</p>
            <p className="font-semibold text-foreground">{nomeEmpresa}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSessionCpf(null)}>
            Sair
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-8 pb-16">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Planos de assinatura
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {PLANOS_ASSINATURA.map((plano) => (
              <Card key={plano.id} className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    {plano.nome}
                  </CardTitle>
                  <CardDescription className="text-sm">{plano.desc}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-bold text-primary">{formatBrl(plano.preco)}</p>
                    <p className="text-xs text-muted-foreground">{plano.periodicidade}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => assinarPlano(plano.id)}>
                    Assinar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Orçamentos aprovados — pagamento</h2>
          {orcamentosPagamento.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum orçamento aprovado aguardando pagamento.</p>
          ) : (
            <div className="space-y-4">
              {orcamentosPagamento.map((o) => {
                const n = normalizeOrcamento(o)
                return (
                  <Card key={n.id} className="border-border">
                    <CardContent className="pt-6 space-y-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <p className="font-mono font-semibold">{n.numero}</p>
                          <p className="text-sm text-muted-foreground">{n.aparelho.marca} {n.aparelho.modelo}</p>
                        </div>
                        <Badge>Aprovado</Badge>
                      </div>
                      <p className="text-xl font-bold text-primary">{formatBrl(n.valorFinalCliente)}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="gap-2"
                          onClick={() => pagarOrcamento(o, "pix")}
                        >
                          <QrCode className="w-4 h-4" />
                          Pagar com PIX
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={() => pagarOrcamento(o, "cartao")}>
                          <CreditCard className="w-4 h-4" />
                          Cartão
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Ordens de serviço</h2>
          {minhasOs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma O.S. encontrada para seu CPF.</p>
          ) : (
            <div className="space-y-4">
              {minhasOs.map((os) => {
                const podePagar =
                  os.status !== "pago" && (os.status === "pronto" || os.status === "finalizado")
                const jaPago = os.status === "pago"
                return (
                  <Card key={os.id} className="border-border">
                    <CardContent className="pt-6 space-y-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <p className="font-mono font-semibold">{os.numero}</p>
                          <p className="text-sm text-muted-foreground">{os.aparelho.marca} {os.aparelho.modelo}</p>
                        </div>
                        {jaPago ? (
                          <Badge className="bg-emerald-600 text-white gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Pago
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{os.status.replace("_", " ")}</Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm">Total: {formatBrl(totalOs(os))}</p>
                      {podePagar && (
                        <div className="flex flex-wrap gap-2">
                          <Button className="gap-2" onClick={() => pagarOs(os, "pix")}>
                            <QrCode className="w-4 h-4" />
                            Pagar com PIX
                          </Button>
                          <Button variant="outline" className="gap-2" onClick={() => pagarOs(os, "cartao")}>
                            <CreditCard className="w-4 h-4" />
                            Cartão
                          </Button>
                        </div>
                      )}
                      {jaPago && (
                        <p className="text-xs text-emerald-600">Pagamento confirmado. Obrigado!</p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="text-primary hover:underline">
            Acesso da loja
          </Link>
        </p>
      </main>
    </div>
  )
}
