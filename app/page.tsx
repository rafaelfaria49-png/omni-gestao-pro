"use client"

// Importação/listagem de clientes: Server Actions em `clientes-import-actions.ts` (revalidatePath após importar).
import { Suspense, useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { AiMestreCommandBar } from "@/components/dashboard/ai-mestre-command-bar"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { VoiceCommandButton } from "@/components/dashboard/voice-command-button"
import { ActivityList } from "@/components/dashboard/activity-list"
import { MobileNav } from "@/components/dashboard/mobile-nav"
import { WhatsAppConnection } from "@/components/dashboard/whatsapp-connection"
import { FluxoCaixa } from "@/components/dashboard/financeiro/fluxo-caixa"
import { GestaoCarteiras } from "@/components/dashboard/financeiro/gestao-carteiras"
import { ContasPagar } from "@/components/dashboard/financeiro/contas-pagar"
import { ContasReceber } from "@/components/dashboard/financeiro/contas-receber"
import { RelatoriosFinanceiros } from "@/components/dashboard/financeiro/relatorios-financeiros"
import { CadastroClientes } from "@/components/dashboard/clientes/cadastro-clientes"
import { ConsultaCredito } from "@/components/dashboard/clientes/consulta-credito"
import { Servicos } from "@/components/dashboard/estoque/servicos"
import { StockAlertBanner } from "@/components/dashboard/stock-alert-banner"
import { DailyCloseScheduler } from "@/components/dashboard/daily-close-scheduler"
import { OrdensServico, type OrdemServico } from "@/components/dashboard/os/ordens-servico"
import { Orcamentos } from "@/components/dashboard/orcamentos/orcamentos"
import { ConfiguracoesSistema } from "@/components/dashboard/configuracoes/configuracoes-sistema"
import { GestaoUnidadesSaas } from "@/components/dashboard/configuracoes/gestao-unidades-saas"
import { AppOpsProviders } from "@/components/dashboard/app-ops-providers"
import { AccessGate } from "@/components/auth/AccessGate"
import { FirstAccessWizard } from "@/components/onboarding/first-access-wizard"
import { useConfigEmpresa } from "@/lib/config-empresa"
import { useLojaAtiva } from "@/lib/loja-ativa"
import { useStoreSettings } from "@/lib/store-settings-provider"
import { useOperationsStore } from "@/lib/operations-store"
import { useToast } from "@/hooks/use-toast"
import type { VoiceIntent } from "@/lib/voice-intents"
import { APP_DISPLAY_NAME } from "@/lib/app-brand"
import { useStudioTheme } from "@/components/theme/ThemeProvider"
import { cn } from "@/lib/utils"

const VendasPDV = dynamic(
  () => import("@/components/dashboard/vendas/vendas-pdv").then((m) => m.VendasPDV),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando PDV...</div> }
)
const TrocasDevolucao = dynamic(
  () => import("@/components/dashboard/vendas/trocas-devolucao").then((m) => m.TrocasDevolucao),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando…</div> }
)
const VendasArquivoGeral = dynamic(
  () => import("@/components/dashboard/vendas/vendas-arquivo-geral").then((m) => m.VendasArquivoGeral),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando…</div> }
)
const ControleConsumo = dynamic(
  () => import("@/components/dashboard/vendas/controle-consumo").then((m) => m.ControleConsumo),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando…</div> }
)
const GestaoProdutos = dynamic(
  () => import("@/components/dashboard/estoque/gestao-produtos").then((m) => m.GestaoProdutos),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando estoque...</div> }
)
const RelatoriosGerenciais = dynamic(
  () => import("@/components/dashboard/relatorios/relatorios-gerenciais").then((m) => m.RelatoriosGerenciais),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando relatorios...</div> }
)
const Dashboard360 = dynamic(
  () => import("@/components/dashboard/relatorios/dashboard-360").then((m) => m.Dashboard360),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando Dashboard 360…</div> }
)
const PlanejamentoCompras = dynamic(
  () => import("@/components/dashboard/estoque/planejamento-compras").then((m) => m.PlanejamentoCompras),
  { loading: () => <div className="text-sm text-muted-foreground">Carregando planejamento...</div> }
)

/** Módulos que revalidam o selo no servidor a cada entrada (PDV, O.S., Financeiro). */
const CRITICAL_SUBSCRIPTION_PAGES = new Set([
  "vendas",
  "vendas-arquivo",
  "trocas",
  "controle-consumo",
  "os",
  "carteiras",
  "fluxo-caixa",
  "contas-pagar",
  "contas-receber",
  "relatorios-financeiros",
  "dashboard-360",
])

function initialTabConfiguracoes(page: string): string {
  if (page === "config-multilojas") return "rede"
  if (page === "config-backup") return "sistema"
  if (page === "logs-sistema") return "sistema"
  if (page === "whatsapp") return "sistema"
  if (page === "plano") return "sistema"
  if (page === "config-pdv") return "pdv"
  if (page === "config-garantia") return "pdv"
  if (page === "config-ajustes") return "pdv"
  // Dados/Marca/Certificado caem em Unidade Atual
  return "unidade"
}

export default function DashboardPage() {
  return (
    <AppOpsProviders>
      <AccessGate>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando…</div>}>
          <DashboardContent />
        </Suspense>
      </AccessGate>
    </AppOpsProviders>
  )
}

function DashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [currentPage, setCurrentPage] = useState("dashboard")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [linkedOsSaleId, setLinkedOsSaleId] = useState<string | null>(null)
  const [subscriptionGate, setSubscriptionGate] = useState<"loading" | "ok" | "blocked">("loading")
  const [voicePdvCart, setVoicePdvCart] = useState<{
    key: number
    itemName: string
    price?: number
  } | null>(null)
  const [voiceCaixaSignal, setVoiceCaixaSignal] = useState(0)
  const [voiceOs, setVoiceOs] = useState<{ key: number; clienteNome?: string } | null>(null)
  const [voiceClienteSignal, setVoiceClienteSignal] = useState(0)
  const [voiceStockHint, setVoiceStockHint] = useState<{
    key: number
    searchQuery?: string
    openNovo?: boolean
    openImport?: boolean
  } | null>(null)
  const { config } = useConfigEmpresa()
  const { empresaDocumentos, cadastroBasicoIncompleto } = useLojaAtiva()
  const { pdvParams } = useStoreSettings()
  const { ordens, setOrdens } = useOperationsStore()
  const isBronze = config.assinatura.plano === "bronze"
  const { toast } = useToast()
  const { mode } = useStudioTheme()
  const isBlack = mode === "black"
  const shellSurface = isBlack ? "bg-[#000000]" : "bg-slate-50"

  // UX PDV: ao entrar no PDV, recolher a sidebar automaticamente para maximizar área do caixa.
  useEffect(() => {
    if (currentPage === "vendas") setSidebarCollapsed(true)
  }, [currentPage])

  const pollSubscriptionUntilResolved = useCallback(async (): Promise<boolean> => {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch("/api/subscription/verify", { credentials: "include", cache: "no-store" })
        const j = (await r.json()) as { valid?: boolean | null; pendingSeal?: boolean }
        if (j.pendingSeal) {
          await new Promise((res) => setTimeout(res, 200))
          continue
        }
        return j.valid === true
      } catch {
        return false
      }
    }
    return false
  }, [])

  /** Assinatura não depende de `configHydrated` — esperar só a config bloqueava o gate e deixava o dashboard em “Verificando assinatura…” indefinidamente. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await pollSubscriptionUntilResolved()
      if (cancelled) return
      setSubscriptionGate(ok ? "ok" : "blocked")
      if (!ok) {
        router.replace("/meu-plano?blocked=1&renew=1")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pollSubscriptionUntilResolved, router])

  useEffect(() => {
    if (subscriptionGate !== "ok") return
    const raw = searchParams.get("page")
    if (raw === "plano") {
      router.replace("/meu-plano")
      return
    }
    if (raw === "suporte") {
      router.replace("/suporte")
      return
    }
    if (raw === "dashboard-omni") {
      router.replace("/dashboard")
      return
    }
    if (raw === "logs-sistema") {
      router.replace("/logs-sistema")
      return
    }
    if (raw === "clientes-gestao") {
      router.replace("/dashboard/clientes")
      return
    }
    setCurrentPage(raw ?? "dashboard")
  }, [subscriptionGate, searchParams, router])

  const goToPage = (page: string) => {
    if (page === "logs-sistema") {
      router.push("/logs-sistema")
      return
    }
    if (page === "plano") {
      router.push("/meu-plano")
      return
    }
    if (page === "suporte") {
      router.push("/suporte")
      return
    }
    void (async () => {
      const [base, ...rest] = String(page || "").split("&")
      const basePage = base || page
      if (CRITICAL_SUBSCRIPTION_PAGES.has(basePage)) {
        const ok = await pollSubscriptionUntilResolved()
        if (!ok) {
          router.push("/meu-plano?blocked=1&renew=1")
          return
        }
      }
      setCurrentPage(basePage)
      if (basePage === "dashboard") {
        router.replace("/", { scroll: false })
      } else {
        // permite extras: "trocas&sale=VDA-..."
        const extra = rest.length ? `&${rest.join("&")}` : ""
        router.replace(`/?page=${encodeURIComponent(basePage)}${extra}`, { scroll: false })
      }
    })()
  }

  const voiceNavigate = async (page: string): Promise<boolean> => {
    if (page === "plano" || page === "suporte") {
      goToPage(page)
      return true
    }
    if (CRITICAL_SUBSCRIPTION_PAGES.has(page)) {
      const ok = await pollSubscriptionUntilResolved()
      if (!ok) {
        router.push("/meu-plano?blocked=1&renew=1")
        return false
      }
    }
    setCurrentPage(page)
    if (page === "dashboard") {
      router.replace("/", { scroll: false })
    } else {
      router.replace(`/?page=${encodeURIComponent(page)}`, { scroll: false })
    }
    return true
  }

  const handleVoiceIntent = async (intent: VoiceIntent) => {
    switch (intent.kind) {
      case "pdv_sale": {
        const ok = await voiceNavigate("vendas")
        if (!ok) return
        const name = intent.itemName.trim()
        if (name || intent.price != null) {
          setVoicePdvCart({
            key: Date.now(),
            itemName: name || "Item",
            price: intent.price,
          })
        }
        return
      }
      case "os_new": {
        const ok = await voiceNavigate("os")
        if (!ok) return
        setVoiceOs({ key: Date.now(), clienteNome: intent.clienteNome })
        return
      }
      case "cadastro_cliente":
        await voiceNavigate("clientes")
        setVoiceClienteSignal((s) => s + 1)
        return
      case "cadastro_produto":
        await voiceNavigate("produtos")
        setVoiceStockHint({ key: Date.now(), openNovo: true })
        return
      case "cadastro_fornecedor": {
        const ok = await voiceNavigate("contas-pagar")
        if (!ok) return
        toast({
          title: "Fornecedores",
          description: "Cadastre e acompanhe fornecedores em Contas a Pagar.",
          duration: 5000,
        })
        return
      }
      case "estoque_view":
        await voiceNavigate("produtos")
        return
      case "preco_consulta":
        await voiceNavigate("produtos")
        setVoiceStockHint({ key: Date.now(), searchQuery: intent.produtoQuery })
        return
      case "entrada_mercadoria":
        await voiceNavigate("produtos")
        setVoiceStockHint({ key: Date.now(), openImport: true })
        return
      case "abrir_caixa": {
        const ok = await voiceNavigate("vendas")
        if (!ok) return
        setVoiceCaixaSignal((s) => s + 1)
        return
      }
      case "relatorio_vendas":
        await voiceNavigate("relatorios-financeiros")
        return
      case "faturamento":
        await voiceNavigate("fluxo-caixa")
        return
      case "orcamento":
        await voiceNavigate("orcamentos")
        return
      case "consultar_credito":
        goToPage(isBronze ? "plano" : "credito")
        return
      case "fechar_dia": {
        void fetch("/api/whatsapp/send-daily", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: config.empresa.contato.whatsappDono || config.empresa.contato.whatsapp,
            empresaNome: empresaDocumentos.nomeFantasia || config.empresa.nomeFantasia,
          }),
        }).then((r) => {
          if (r.ok) {
            toast({ title: "Fechamento", description: "Resumo enviado ao WhatsApp do dono." })
          } else {
            toast({
              title: "Fechamento",
              description: "Não foi possível enviar pela API. Verifique WHATSAPP_API_* ou use o link manual.",
            })
          }
        })
        return
      }
    }
  }

  if (subscriptionGate === "loading") {
    return (
      <div
        className={cn(
          "flex min-h-screen min-h-[100dvh] w-full items-center justify-center text-sm",
          shellSurface,
          isBlack ? "text-white/70" : "text-slate-600"
        )}
      >
        Verificando assinatura…
      </div>
    )
  }

  if (subscriptionGate === "blocked") {
    return (
      <div
        className={cn(
          "flex min-h-screen min-h-[100dvh] w-full items-center justify-center text-sm",
          shellSurface,
          isBlack ? "text-white/70" : "text-slate-600"
        )}
      >
        Redirecionando para renovação…
      </div>
    )
  }

  return (
    <div
      className={cn(
        currentPage === "vendas"
          ? "flex h-screen max-h-screen w-full min-h-0 overflow-hidden"
          : "flex min-h-screen min-h-[100dvh] w-full",
        shellSurface
      )}
    >
      <FirstAccessWizard />
      <DailyCloseScheduler />
      <Sidebar
        onNavigate={goToPage}
        currentPage={currentPage}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      <div
        className={
          currentPage === "vendas"
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <Header />
        {currentPage === "dashboard" ? <AiMestreCommandBar /> : null}
        <main
          className={
            currentPage === "vendas"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : `flex-1 p-4 lg:p-6 pb-24 lg:pb-6 overflow-auto ${currentPage === "dashboard" ? "pt-20 md:pt-24" : ""}`
          }
        >
          <div
            className={
              currentPage === "vendas"
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "max-w-6xl mx-auto space-y-6"
            }
          >
            {currentPage === "whatsapp" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Conexão WhatsApp</h1>
                  <p className="text-muted-foreground">Configure a integração com o robô de comandos via WhatsApp.</p>
                </div>
                <WhatsAppConnection />
              </>
            ) : currentPage === "carteiras" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Carteiras</h1>
                  <p className="text-muted-foreground">
                    Carteiras pessoais e da empresa, lançamentos por voz ou texto e transferências
                  </p>
                </div>
                <GestaoCarteiras />
              </>
            ) : currentPage === "fluxo-caixa" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Fluxo de Caixa</h1>
                  <p className="text-muted-foreground">Visão geral de entradas e saídas em tempo real</p>
                </div>
                <FluxoCaixa />
              </>
            ) : currentPage === "contas-pagar" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Contas a Pagar</h1>
                  <p className="text-muted-foreground">Gerencie despesas fixas, compras e pagamentos a fornecedores</p>
                </div>
                <ContasPagar />
              </>
            ) : currentPage === "contas-receber" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Contas a Receber</h1>
                  <p className="text-muted-foreground">Controle pagamentos de OS, vendas e carnês</p>
                </div>
                <ContasReceber />
              </>
            ) : currentPage === "relatorios-financeiros" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Relatórios Financeiros</h1>
                  <p className="text-muted-foreground">Acompanhe o lucro mensal e a saúde financeira da empresa</p>
                </div>
                <RelatoriosFinanceiros />
              </>
            ) : currentPage === "vendas" ? (
              <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
                <VendasPDV
                  linkedOsId={linkedOsSaleId}
                  onSaleCompleted={() => setLinkedOsSaleId(null)}
                  voiceCartSeed={voicePdvCart}
                  onVoiceCartSeedConsumed={() => setVoicePdvCart(null)}
                  voiceOpenCaixaSignal={voiceCaixaSignal}
                />
              </div>
            ) : currentPage === "vendas-arquivo" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Histórico de Vendas</h1>
                  <p className="text-muted-foreground">Base central (PDV + Financeiro) com status real</p>
                </div>
                <VendasArquivoGeral onNavigateToTrocas={(saleId) => goToPage(`trocas&sale=${encodeURIComponent(saleId)}`)} />
              </>
            ) : currentPage === "trocas" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Trocas e devolução</h1>
                  <p className="text-muted-foreground">Busque vendas por ID, devolva ao estoque e gere crédito em haver (vale-troca)</p>
                </div>
                <TrocasDevolucao />
              </>
            ) : currentPage === "controle-consumo" ? (
              pdvParams.moduloControleConsumo ? (
                <>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">Controle de Consumo</h1>
                    <p className="text-muted-foreground">
                      Mesas e comandas: lance consumo sem pagamento na hora e envie a conta ao PDV para cobrança
                    </p>
                  </div>
                  <ControleConsumo onNavigateToPdv={() => goToPage("vendas")} />
                </>
              ) : (
                <div className="p-6 rounded-xl border border-border bg-card max-w-lg">
                  <h2 className="text-xl font-semibold text-foreground">Controle de Consumo</h2>
                  <p className="text-muted-foreground mt-2">
                    Ative o módulo em Configurações → Parâmetros do PDV para usar mesas e comandas.
                  </p>
                  <button
                    type="button"
                    className="mt-4 h-10 px-4 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => goToPage("config-pdv")}
                  >
                    Abrir Configurações (Parâmetros do PDV)
                  </button>
                </div>
              )
            ) : currentPage === "clientes" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Cadastro de Clientes</h1>
                  <p className="text-muted-foreground">Gerencie seus clientes e aparelhos recorrentes</p>
                </div>
                <CadastroClientes voiceOpenNewCliente={voiceClienteSignal} />
              </>
            ) : currentPage === "credito" ? (
              isBronze ? (
                <div className="p-6 rounded-xl border border-primary/40 bg-primary/5">
                  <h2 className="text-xl font-semibold text-foreground">Consulta de Crédito disponível no Plano Prata+</h2>
                  <p className="text-muted-foreground mt-2">
                    Faça upgrade em Meu Plano para liberar score de crédito e análise de restrições.
                  </p>
                  <button
                    className="mt-4 h-10 px-4 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => goToPage("plano")}
                  >
                    Fazer upgrade
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">Consulta de Crédito</h1>
                    <p className="text-muted-foreground">Verifique score (0 a 1000) e restrições financeiras</p>
                  </div>
                  <ConsultaCredito />
                </>
              )
            ) : currentPage === "orcamentos" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Orçamentos</h1>
                  <p className="text-muted-foreground">
                    Cadastre orçamentos e converta em ordem de serviço com um clique
                  </p>
                </div>
                <Orcamentos ordens={ordens} setOrdens={setOrdens} />
              </>
            ) : currentPage === "os" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Ordens de Serviço</h1>
                  <p className="text-muted-foreground">Gerencie suas OS com controle completo de entrada e saída</p>
                </div>
                <OrdensServico
                  ordens={ordens}
                  setOrdens={setOrdens}
                  voiceNewOs={voiceOs}
                  onVoiceNewOsConsumed={() => setVoiceOs(null)}
                  onAbrirCadastroCliente={(nome) => {
                    void goToPage("clientes")
                    toast({
                      title: "Cadastro de cliente",
                      description: `Cadastre "${nome}" na tela Clientes para histórico completo e contato.`,
                    })
                  }}
                  onGerarVenda={(os) => {
                    setLinkedOsSaleId(os.id)
                    goToPage("vendas")
                  }}
                />
              </>
            ) : currentPage === "servicos" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Servicos</h1>
                  <p className="text-muted-foreground">Cadastre servicos e anexe fotos de laudo de entrada</p>
                </div>
                <Servicos />
              </>
            ) : currentPage === "produtos" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Produtos e Servicos</h1>
                  <p className="text-muted-foreground">Gerencie seu estoque de pecas, acessorios e servicos</p>
                </div>
                <GestaoProdutos
                  voiceStockHint={voiceStockHint}
                  onVoiceStockHintConsumed={() => setVoiceStockHint(null)}
                />
              </>
            ) : currentPage === "planejamento-compras" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Planejamento de Compras</h1>
                  <p className="text-muted-foreground">
                    Reposição com base no estoque e no histórico de vendas dos últimos 30 dias
                  </p>
                </div>
                <PlanejamentoCompras />
              </>
            ) : currentPage === "relatorios" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Relatórios Gerenciais</h1>
                  <p className="text-muted-foreground">Visão completa do desempenho do seu negócio</p>
                </div>
                <RelatoriosGerenciais />
              </>
            ) : currentPage === "dashboard-360" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Dashboard 360</h1>
                  <p className="text-muted-foreground">
                    Lucro real, rankings, ticket médio e linha do tempo por cliente (PDV + importações)
                  </p>
                </div>
                <Dashboard360 />
              </>
            ) : currentPage === "config-multilojas" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Gestão da Rede</h1>
                  <p className="text-muted-foreground">Adicione e gerencie unidades (Loja 1, Loja 2...) e o perfil de cada uma</p>
                </div>
                <GestaoUnidadesSaas />
              </>
            ) : currentPage === "configuracoes" || currentPage === "config-empresa" || currentPage === "config-ajustes" || currentPage === "config-pdv" || currentPage === "config-marca" || currentPage === "config-certificado" || currentPage === "config-garantia" || currentPage === "config-backup" ? (
              <>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Configurações do Sistema</h1>
                  <p className="text-muted-foreground">Gerencie os dados da empresa, marca e termos de garantia</p>
                </div>
                <ConfiguracoesSistema initialTab={initialTabConfiguracoes(currentPage)} />
              </>
            ) : (
              <>
                <StockAlertBanner onNavigate={goToPage} />
                
                <div className="hidden lg:block">
                  <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
                  <p className="text-muted-foreground">
                    Bem-vindo ao {APP_DISPLAY_NAME}. Aqui está o resumo do seu negócio.
                  </p>
                </div>
                
                <StatsCards />
                
                <VoiceCommandButton
                  onIntent={handleVoiceIntent}
                  onQuickSale={() => goToPage("vendas")}
                />
                
                <ActivityList />
              </>
            )}
          </div>
        </main>
      </div>
      
      <MobileNav onNavigate={goToPage} currentPage={currentPage} />
    </div>
  )
}
