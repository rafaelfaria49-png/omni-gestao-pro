"use client"

import { useState } from "react"
import { Check, X, Crown, Mic, MessageSquare, CreditCard, Search } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

const plans = [
  {
    name: "Start",
    description: "Ideal para quem está começando",
    priceMonthly: 49.90,
    priceYearly: 479.04,
    features: [
      { name: "Comandos por Voz", included: false, icon: Mic },
      { name: "Integração WhatsApp", included: false, icon: MessageSquare },
      { name: "Consulta CPF/CNPJ", included: false, icon: Search },
      { name: "Carnê Digital", included: false, icon: CreditCard },
      { name: "Ordens de Serviço", included: true },
      { name: "Controle de Estoque", included: true },
      { name: "Cadastro de Clientes", included: true },
      { name: "Relatórios Básicos", included: true },
      { name: "1 Usuário", included: true },
    ],
    highlight: false,
    buttonText: "Assinar Agora",
    buttonVariant: "outline" as const,
  },
  {
    name: "Business",
    description: "Para negócios em crescimento",
    priceMonthly: 99.90,
    priceYearly: 959.04,
    features: [
      { name: "Comandos por Voz", included: true, icon: Mic },
      { name: "Integração WhatsApp", included: true, icon: MessageSquare },
      { name: "Consulta CPF/CNPJ", included: true, icon: Search },
      { name: "Carnê Digital", included: true, icon: CreditCard },
      { name: "Ordens de Serviço", included: true },
      { name: "Controle de Estoque", included: true },
      { name: "Cadastro de Clientes", included: true },
      { name: "Relatórios Avançados", included: true },
      { name: "3 Usuários", included: true },
    ],
    highlight: true,
    badge: "MAIS VENDIDO",
    buttonText: "Assinar Agora",
    buttonVariant: "default" as const,
  },
  {
    name: "Pro",
    description: "Solução completa para sua empresa",
    priceMonthly: 199.90,
    priceYearly: 1919.04,
    features: [
      { name: "Comandos por Voz", included: true, icon: Mic },
      { name: "Integração WhatsApp", included: true, icon: MessageSquare },
      { name: "Consulta CPF/CNPJ", included: true, icon: Search },
      { name: "Carnê Digital", included: true, icon: CreditCard },
      { name: "Ordens de Serviço", included: true },
      { name: "Controle de Estoque", included: true },
      { name: "Cadastro de Clientes", included: true },
      { name: "Relatórios Premium + BI", included: true },
      { name: "Usuários Ilimitados", included: true },
      { name: "Suporte Prioritário 24h", included: true },
      { name: "API de Integração", included: true },
    ],
    highlight: false,
    buttonText: "Fazer Upgrade",
    buttonVariant: "outline" as const,
  },
]

export function PricingPlans() {
  const [isYearly, setIsYearly] = useState(false)

  const formatPrice = (price: number) => {
    return price.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    })
  }

  const getMonthlyFromYearly = (yearlyPrice: number) => {
    return yearlyPrice / 12
  }

  return (
    <div className="space-y-8">
      {/* Toggle Anual/Mensal */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-4 p-1 rounded-full bg-secondary">
          <button
            onClick={() => setIsYearly(false)}
            className={cn(
              "px-6 py-2 rounded-full text-sm font-medium transition-all",
              !isYearly
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Mensal
          </button>
          <button
            onClick={() => setIsYearly(true)}
            className={cn(
              "px-6 py-2 rounded-full text-sm font-medium transition-all",
              isYearly
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Anual
          </button>
        </div>
        {isYearly && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
            <span className="text-sm font-semibold text-primary">20% de desconto no plano anual!</span>
          </div>
        )}
      </div>

      {/* Cards de Planos */}
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            className={cn(
              "relative flex flex-col transition-all duration-300 hover:scale-[1.02]",
              plan.highlight
                ? "border-primary border-2 shadow-xl shadow-primary/10"
                : "border-border hover:border-primary/50"
            )}
          >
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg">
                  <Crown className="w-3.5 h-3.5" />
                  {plan.badge}
                </div>
              </div>
            )}

            <CardHeader className={cn("text-center", plan.badge && "pt-8")}>
              <CardTitle className="text-2xl font-bold">{plan.name}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {plan.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col">
              {/* Preço */}
              <div className="text-center mb-6">
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold text-foreground">
                    {formatPrice(
                      isYearly
                        ? getMonthlyFromYearly(plan.priceYearly)
                        : plan.priceMonthly
                    )}
                  </span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
                {isYearly && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-muted-foreground line-through">
                      {formatPrice(plan.priceMonthly * 12)}/ano
                    </p>
                    <p className="text-sm font-medium text-primary">
                      {formatPrice(plan.priceYearly)}/ano
                    </p>
                  </div>
                )}
              </div>

              {/* Features */}
              <div className="flex-1 space-y-3 mb-6">
                {plan.features.map((feature, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center gap-3 text-sm",
                      feature.included
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {feature.included ? (
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <span className={cn(!feature.included && "line-through")}>
                      {feature.name}
                    </span>
                  </div>
                ))}
              </div>

              {/* Botão */}
              <Button
                variant={plan.buttonVariant}
                size="lg"
                className={cn(
                  "w-full h-12 text-base font-semibold",
                  plan.highlight
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25"
                    : "border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                )}
              >
                {plan.buttonText}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Garantia */}
      <div className="text-center p-6 rounded-xl bg-secondary/50 border border-border">
        <p className="text-sm text-muted-foreground">
          Todos os planos incluem <span className="font-semibold text-foreground">7 dias grátis</span> para você testar.
          Cancele a qualquer momento sem taxas ou multas.
        </p>
      </div>
    </div>
  )
}
