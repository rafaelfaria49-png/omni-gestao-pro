/**
 * Contador HUB (interno) · catálogos ESTÁTICOS de apoio à UI.
 *
 * ⚠️ Regra deste arquivo (GOAL CONTADOR-HUB-INTERNAL-REALIFICATION-023): aqui só
 * podem viver **catálogos** — a lista de seções do HUB, a lista de documentos que
 * compõem cada dossiê empresarial, o que o portal externo faz e não faz. Nada
 * neste arquivo pode afirmar **estado da empresa do usuário**: sem funcionário,
 * sem escritório contábil, sem CNPJ/razão social, sem faturamento, sem contagem
 * de pendências, sem "atualizado/vencido" por documento.
 *
 * Todo dado empresarial exibido pelo HUB vem de leitura real:
 * `ContadorDadosReais` (GOAL 006), documentos (010), timeline (011), fechamento
 * (012), permissões/acesso externo (014), obrigações (016), avisos (017),
 * fiscal (018) e identificação da loja (`lib/contador/readers/loja.ts`).
 */
import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Eye,
  FileText,
  FolderClosed,
  LayoutGrid,
  Landmark,
  Lock,
  Users,
  Send,
  ShieldCheck,
  TrendingDown,
  LineChart,
  Package,
  type LucideIcon,
} from "lucide-react"

/** Máquina de status única do HUB (espelha o design). */
export type ChipVariant = "pend" | "env" | "conf" | "res" | "venc" | "warn"

export type ContadorSectionId =
  | "visao"
  | "fechamento"
  | "documentos"
  | "obrigacoes"
  | "relatorios"
  | "dossies"
  | "folha"
  | "portal"
  | "permissoes"
  | "timeline"
  | "config"

export type ContadorSection = {
  id: ContadorSectionId
  label: string
  icon: LucideIcon
  /**
   * Badge textual da navegação. Só pode qualificar a MATURIDADE da seção
   * ("Parcial"); nunca um número — contagem sem leitura real é dado inventado.
   */
  badge?: string
  /** Só o lojista/equipe vê — some no "Modo contador". */
  ownerOnly?: boolean
  /** Agrupador de seção acima do item. */
  group?: string
}

export const CONTADOR_SECTIONS: ContadorSection[] = [
  { id: "visao", label: "Visão geral", icon: LayoutGrid },
  { id: "fechamento", label: "Fechamento mensal", icon: ClipboardCheck },
  { id: "documentos", label: "Documentos", icon: FileText },
  { id: "obrigacoes", label: "Obrigações", icon: CalendarClock },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "dossies", label: "Dossiês", icon: FolderClosed, badge: "Parcial" },
  { id: "folha", label: "Folha & DP", icon: Users },
  { id: "portal", label: "Portal do contador", icon: Eye, group: "Acesso do contador" },
  { id: "permissoes", label: "Permissões & acesso", icon: Lock, ownerOnly: true },
  { id: "timeline", label: "Timeline / atividade", icon: Clock },
  { id: "config", label: "Configurações", icon: ShieldCheck, ownerOnly: true },
]

/* ─────────────────────────── RELATÓRIOS ─────────────────────────── */

/**
 * Catálogo dos relatórios que o contador costuma pedir. O HUB **não** exporta
 * cada um isoladamente nesta fase: os dados equivalentes saem no Pacote do
 * Contador (ZIP real da competência). `arquivoPacote` aponta o arquivo exato
 * dentro do ZIP; `null` = o pacote não cobre este relatório.
 */
export type RelatorioCard = {
  title: string
  sub: string
  icon: LucideIcon
  tint: "primary" | "info" | "danger" | "conf"
  /** Caminho(s) dentro do ZIP do Pacote do Contador que cobrem este relatório. */
  arquivosPacote: string[]
}
export const RELATORIO_CARDS: RelatorioCard[] = [
  {
    title: "DRE / Resumo mensal",
    sub: "visão gerencial — não é a DRE contábil oficial",
    icon: LineChart,
    tint: "primary",
    arquivosPacote: ["00-LEIA-ME/resumo.md"],
  },
  {
    title: "Relatório de vendas",
    sub: "do módulo de Vendas",
    icon: Send,
    tint: "info",
    arquivosPacote: ["01-VENDAS/vendas.csv", "01-VENDAS/itens.csv", "01-VENDAS/devolucoes.csv"],
  },
  {
    title: "Relatório de despesas",
    sub: "do módulo Financeiro",
    icon: TrendingDown,
    tint: "danger",
    arquivosPacote: ["02-FINANCEIRO/movimentacoes.csv", "02-FINANCEIRO/contas_pagar.csv"],
  },
  {
    title: "Posição de estoque",
    sub: "do módulo de Estoque",
    icon: Package,
    tint: "conf",
    arquivosPacote: [],
  },
]

/* ─────────────────────────── DOSSIÊS ─────────────────────────── */

/**
 * Itens que valem acompanhar na regularidade do CNPJ. É um **roteiro**, não um
 * diagnóstico: o OmniGestão não consulta Receita, Junta, Sefaz, Prefeitura,
 * Caixa nem e-CAC, então nenhum item carrega situação ("válida", "vencida").
 */
export type RadarItem = { label: string; onde: string }
export const RADAR_CNPJ: RadarItem[] = [
  { label: "Situação cadastral do CNPJ", onde: "Receita Federal" },
  { label: "Opção pelo Simples Nacional", onde: "Portal do Simples Nacional" },
  { label: "CND Federal (Receita + PGFN)", onde: "e-CAC" },
  { label: "Certidão Estadual", onde: "Sefaz" },
  { label: "Certidão Municipal", onde: "Prefeitura" },
  { label: "DAS do período", onde: "PGDAS-D / PGMEI" },
  { label: "DEFIS", onde: "Portal do Simples Nacional" },
  { label: "Certificado digital", onde: "sua certificadora" },
  { label: "Alvará / licença de funcionamento", onde: "Prefeitura / Vigilância" },
  { label: "Procuração do contador", onde: "e-CAC" },
  { label: "Pendências fiscais", onde: "e-CAC" },
]

export type DossieOrigem = "sistema" | "anexar" | "portal" | "solicitar"

/**
 * Métrica REAL do DTO da competência (GOAL 006) que cobre um item de dossiê de
 * origem `sistema`. Só entra aqui o que tem correspondência inequívoca no DTO —
 * série histórica, DRE contábil, recebíveis de adquirente, dívidas/parcelamentos
 * e estoque **não** têm, e por isso ficam sem métrica (nunca com valor fabricado).
 */
export type MetricaSistema = "fluxo" | "contas_pagar" | "contas_receber" | "formas_pagamento"

export type DossieRow = {
  doc: string
  sub: string
  origem: DossieOrigem
  /** Só para `origem: "sistema"` com correspondência real no DTO da competência. */
  metrica?: MetricaSistema
  validar?: boolean
}
export type Dossie = {
  id: string
  title: string
  sub: string
  icon: LucideIcon
  tint: "primary" | "warn" | "info"
  rows: DossieRow[]
}

export const DOSSIES: Dossie[] = [
  {
    id: "cnpj",
    title: "Dossiê CNPJ & Cadastro",
    sub: "Identificação e existência legal do CNPJ · 14 itens",
    icon: Building2,
    tint: "primary",
    rows: [
      { doc: "Cartão CNPJ / Comprovante de Inscrição e Situação Cadastral", sub: "Receita Federal · REDESIM", origem: "portal" },
      { doc: "Contrato Social / Requerimento de Empresário", sub: "arquivo registrado na Junta", origem: "anexar" },
      { doc: "Alterações contratuais", sub: "aditivos registrados", origem: "anexar" },
      { doc: "Certidão Simplificada da Junta Comercial", sub: "Junta Comercial", origem: "portal" },
      { doc: "Certidão de Inteiro Teor", sub: "Junta Comercial", origem: "portal" },
      { doc: "QSA / Quadro de Sócios", sub: "Receita Federal / e-CAC", origem: "portal" },
      { doc: "Inscrição Estadual", sub: "Sintegra / Sefaz", origem: "portal" },
      { doc: "Inscrição Municipal", sub: "Prefeitura", origem: "portal" },
      { doc: "Alvará / Licença de funcionamento", sub: "Prefeitura / Vigilância", origem: "anexar" },
      { doc: "Comprovante de endereço", sub: "conta recente em nome do CNPJ", origem: "anexar" },
      { doc: "Dados bancários PJ", sub: "conta PJ para movimentação", origem: "anexar" },
      { doc: "Certificado digital", sub: "e-CAC · A1 / A3", origem: "anexar" },
      { doc: "Procuração e-CAC / contador", sub: "acesso e-CAC do contador", origem: "solicitar", validar: true },
      { doc: "CCMEI — quando MEI", sub: "Portal do Empreendedor", origem: "portal" },
    ],
  },
  {
    id: "fiscal",
    title: "Dossiê Fiscal / Regularidade",
    sub: "Regularidade e situação fiscal · 13 itens · validar com contador",
    icon: ShieldCheck,
    tint: "warn",
    rows: [
      { doc: "CND Federal — Receita + PGFN", sub: "certidão conjunta", origem: "portal", validar: true },
      { doc: "Certidão Estadual", sub: "Sefaz", origem: "portal", validar: true },
      { doc: "Certidão Municipal", sub: "Prefeitura", origem: "portal", validar: true },
      { doc: "CRF FGTS — quando houver funcionário", sub: "Caixa", origem: "portal", validar: true },
      { doc: "Relatório de Situação Fiscal / Pendências e-CAC", sub: "e-CAC", origem: "portal", validar: true },
      { doc: "Consulta Optante Simples Nacional", sub: "Simples Nacional", origem: "portal", validar: true },
      { doc: "Extrato do Simples Nacional", sub: "PGDAS / e-CAC", origem: "portal", validar: true },
      { doc: "PGDAS-D", sub: "declaração mensal do Simples", origem: "portal", validar: true },
      { doc: "DEFIS", sub: "declaração anual do Simples", origem: "portal", validar: true },
      { doc: "DAS pagos", sub: "comprovantes do período", origem: "anexar", validar: true },
      { doc: "DAS em aberto", sub: "gerar no PGDAS / PGMEI", origem: "portal", validar: true },
      { doc: "Parcelamentos", sub: "e-CAC / Simples Nacional", origem: "portal", validar: true },
      { doc: "Comprovantes de pagamento de tributos", sub: "guias quitadas", origem: "anexar", validar: true },
    ],
  },
  {
    id: "banco",
    title: "Dossiê Banco & Crédito",
    sub: "Comprovação de faturamento e saúde financeira · 17 itens",
    icon: Landmark,
    tint: "info",
    rows: [
      { doc: "Faturamento dos últimos 12 meses", sub: "série histórica — o HUB lê uma competência por vez", origem: "sistema" },
      { doc: "Faturamento mês a mês", sub: "série histórica — o HUB lê uma competência por vez", origem: "sistema" },
      { doc: "Declaração de faturamento assinada pelo contador", sub: "assinatura do contador", origem: "solicitar", validar: true },
      { doc: "DRE gerencial", sub: "sem plano de contas contábil no sistema", origem: "sistema", validar: true },
      { doc: "Fluxo de caixa", sub: "entradas e saídas realizadas na competência", origem: "sistema", metrica: "fluxo" },
      { doc: "Contas a pagar", sub: "títulos em aberto com vencimento na competência", origem: "sistema", metrica: "contas_pagar" },
      { doc: "Contas a receber", sub: "títulos em aberto com vencimento na competência", origem: "sistema", metrica: "contas_receber" },
      { doc: "Extratos bancários PJ", sub: "conciliação bancária", origem: "anexar" },
      { doc: "Relatório de vendas por forma de pagamento", sub: "quebra declarada nas vendas da competência", origem: "sistema", metrica: "formas_pagamento" },
      { doc: "Relatório de recebíveis / cartões", sub: "sem integração com adquirente", origem: "sistema" },
      { doc: "Relação de dívidas e parcelamentos", sub: "sem cadastro de dívida no sistema", origem: "sistema", validar: true },
      { doc: "Relatório de estoque", sub: "fora do DTO do Contador nesta fase", origem: "sistema" },
      { doc: "Certidões negativas", sub: "CND", origem: "portal", validar: true },
      { doc: "Cartão CNPJ", sub: "Receita Federal", origem: "portal" },
      { doc: "Contrato social", sub: "arquivo registrado", origem: "anexar" },
      { doc: "Certidão simplificada", sub: "Junta Comercial", origem: "portal" },
      { doc: "Comprovante de endereço", sub: "conta recente", origem: "anexar" },
    ],
  },
]

/**
 * Filtros por ORIGEM do item (o que fazer para obtê-lo) e pelo selo "validar com
 * contador". Não há filtro por situação do documento: o HUB não sabe se a sua
 * certidão está válida ou vencida, e inventar esse estado era o mock removido no
 * GOAL 023.
 */
export type DossieFilter = "all" | "sistema" | "anexar" | "portal" | "solicitar" | "validar"

export const DOSSIE_FILTERS: { id: DossieFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "sistema", label: "Lido do OmniGestão" },
  { id: "anexar", label: "Anexar manualmente" },
  { id: "portal", label: "Abrir portal oficial" },
  { id: "solicitar", label: "Solicitar ao contador" },
  { id: "validar", label: "Validar com contador" },
]

/** Um dossiê row passa no filtro selecionado? */
export function dossieRowMatches(row: DossieRow, filter: DossieFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "sistema":
    case "anexar":
    case "portal":
    case "solicitar":
      return row.origem === filter
    case "validar":
      return row.validar === true
    default:
      return true
  }
}

export function dossieFilterCount(filter: DossieFilter): number {
  const rows = DOSSIES.flatMap((d) => d.rows)
  return rows.filter((r) => dossieRowMatches(r, filter)).length
}

/* ─────────────────────────── FOLHA & DP ─────────────────────────── */
//
// GOAL 023: a lista de funcionários fictícios do preview e os cartões
// de pró-labore/holerite ilustrativos foram REMOVIDOS. A aba passou a listar os
// documentos REAIS de categoria `folha` (`folha/contador-folha-real.tsx`). O HUB
// não tem — e não terá neste escopo — cadastro de colaborador, cálculo de folha,
// holerite, encargos, eSocial ou ponto.

/* ─────────────────────────── PORTAL ─────────────────────────── */

/**
 * O que o portal externo v2 (`/contador-externo`, GOAL 015) realmente faz. Cada
 * linha corresponde a um caminho existente em `lib/contador/portal/**`. Não
 * listar capacidade inexistente é parte do critério de honestidade do GOAL 023 —
 * o portal, por exemplo, **não** recebe upload.
 */
export const PORTAL_PODE: string[] = [
  "Ver o resumo e a timeline da competência das lojas com vínculo ativo",
  "Baixar o Pacote do Contador oficial e confirmar o recebimento",
  "Baixar documentos enviados pela loja",
  "Comentar na competência e nos documentos",
  "Marcar documento como conferido — somente no papel Conferência",
]
export const PORTAL_NAO_PODE: string[] = [
  "Editar vendas, estoque ou caixa",
  "Alterar o financeiro",
  "Enviar documentos (o upload é sempre da loja)",
  "Fechar ou reabrir a competência",
  "Mudar configurações, convites ou permissões",
  "Ver qualquer loja sem vínculo ativo (minimização LGPD)",
]

/* ─────────────────────────── COMPETÊNCIA ─────────────────────────── */
//
// GOAL 023: os nomes de mês e a competência-semente do preview foram removidos —
// não tinham consumidor produtivo. A competência canônica vive em
// `lib/contador/competencia.ts` e vem da URL (`?c=AAAA-MM`).
