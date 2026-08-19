/**
 * Contador HUB (interno) · dados ESTÁTICOS de pré-visualização.
 *
 * ⚠️ TODOS os valores aqui são fixos e ilustrativos (espelham o design aprovado
 * do Cloud Design). NADA neste arquivo consulta banco, Financeiro, Caixa, Fiscal
 * ou o portal externo `/contador`. É a "casca visual" da fase preview: os números
 * são gerenciais/fictícios e não devem ser confundidos com persistência real.
 *
 * A integração real (Financeiro, documentos, obrigações, folha, portal do
 * contador) é uma fase futura — ver GOAL CONTADOR-HUB-VISUAL-PREVIEW-ONLY-001.
 */
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Eye,
  FileText,
  FileWarning,
  FolderClosed,
  LayoutGrid,
  Landmark,
  Lock,
  Users,
  Send,
  CheckCheck,
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
  /** Badge textual (ex.: "Preview", "Novo"). */
  badge?: string
  /** Contador numérico à direita (ex.: nº de documentos). */
  count?: number
  /** Só o lojista/equipe vê — some no "Modo contador". */
  ownerOnly?: boolean
  /** Agrupador de seção acima do item. */
  group?: string
}

export const CONTADOR_SECTIONS: ContadorSection[] = [
  { id: "visao", label: "Visão geral", icon: LayoutGrid },
  { id: "fechamento", label: "Fechamento mensal", icon: ClipboardCheck },
  { id: "documentos", label: "Documentos", icon: FileText, count: 4 },
  { id: "obrigacoes", label: "Obrigações", icon: CalendarClock },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "dossies", label: "Dossiês", icon: FolderClosed, badge: "Novo" },
  { id: "folha", label: "Folha & DP", icon: Users, badge: "Preview" },
  { id: "portal", label: "Portal do contador", icon: Eye, group: "Acesso do contador" },
  { id: "permissoes", label: "Permissões & acesso", icon: Lock, ownerOnly: true },
  { id: "timeline", label: "Timeline / atividade", icon: Clock },
  { id: "config", label: "Configurações", icon: ShieldCheck, ownerOnly: true },
]

/* ─────────────────────────── VISÃO GERAL ─────────────────────────── */

export type Kpi = { label: string; value: string; unit?: string; foot: string; icon: LucideIcon }
export const VISAO_KPIS: Kpi[] = [
  { label: "Pendências", value: "3", foot: "aguardando você", icon: Clock },
  { label: "A enviar", value: "4", foot: "documentos", icon: Send },
  { label: "Vencimentos", value: "2", unit: "/ próx. 7 dias", foot: "validar com contador", icon: CalendarClock },
  { label: "Recebidos", value: "5", foot: "do contador", icon: CheckCheck },
]

export type FinResumo = { label: string; value: string }
export const RESUMO_FINANCEIRO: FinResumo[] = [
  { label: "Vendas", value: "R$ 48,2k" },
  { label: "Despesas", value: "R$ 21,7k" },
  { label: "A pagar", value: "R$ 9,4k" },
  { label: "A receber", value: "R$ 12,1k" },
]

export type Alerta = {
  tone: "danger" | "warn" | "info"
  cat: string
  title: string
  desc: string
  when?: string
  icon: LucideIcon
}
export const VISAO_ALERTAS: Alerta[] = [
  {
    tone: "danger",
    cat: "Fiscal · validar com contador",
    title: "Guia vencendo",
    desc: "DAS — Simples Nacional · apuração com o contador",
    when: "20/07",
    icon: AlertTriangle,
  },
  {
    tone: "warn",
    cat: "Documentos pendentes",
    title: "Nota sem anexo",
    desc: "Recibo de serviço sem comprovante",
    icon: FileWarning,
  },
  {
    tone: "info",
    cat: "Folha & DP",
    title: "Funcionário sem documento",
    desc: "Carlos Lima · falta contrato",
    icon: Users,
  },
  {
    tone: "warn",
    cat: "Fechamento mensal",
    title: "Fechamento incompleto",
    desc: "6 itens ainda em aberto",
    icon: ClipboardCheck,
  },
]

export type DossieProgress = { label: string; done: number; total: number; pct: number }
export const VISAO_DOSSIE_PROGRESS: DossieProgress[] = [
  { label: "Banco & Crédito", done: 11, total: 17, pct: 65 },
  { label: "CNPJ & Cadastro", done: 8, total: 14, pct: 57 },
  { label: "Fiscal / Regularidade", done: 7, total: 13, pct: 54 },
]

/* ─────────────────────────── FECHAMENTO ─────────────────────────── */

export type ChecklistItem = {
  label: string
  sub: string
  state: "done" | "partial" | "todo"
  status: { label: string; variant: ChipVariant }
  validar?: boolean
}
export const FECHAMENTO_CHECKLIST: ChecklistItem[] = [
  { label: "Enviar notas fiscais de venda", sub: "12 NF-e da competência", state: "done", status: { label: "resolvido", variant: "res" } },
  { label: "Conferir contas a pagar e a receber", sub: "conferido pelo contador", state: "done", status: { label: "conferido", variant: "conf" } },
  { label: "Enviar notas de compra / entrada", sub: "aguardando conferência", state: "partial", status: { label: "enviado", variant: "env" } },
  { label: "Enviar extratos bancários", sub: "Banco principal · Junho", state: "todo", status: { label: "pendente", variant: "pend" } },
  { label: "Conferir despesas do mês", sub: "21 lançamentos", state: "todo", status: { label: "pendente", variant: "pend" } },
  { label: "Enviar folha do mês", sub: "sem cálculo no sistema", state: "todo", status: { label: "pendente", variant: "pend" }, validar: true },
  { label: "Anexar comprovantes de impostos", sub: "guias pagas no período", state: "todo", status: { label: "pendente", variant: "pend" } },
  { label: "Revisar pró-labore", sub: "registro manual", state: "todo", status: { label: "pendente", variant: "pend" }, validar: true },
  { label: "Fechar competência", sub: "trava a edição da competência", state: "todo", status: { label: "pendente", variant: "pend" } },
]

/* ─────────────────────────── DOCUMENTOS ─────────────────────────── */

export type DocSeg = "all" | "send" | "recv"
export type DocumentoRow = {
  name: string
  sub: string
  tipo: string
  seg: DocSeg
  status: { label: string; variant: ChipVariant }
  /** preview badge no nome. */
  preview?: boolean
  /** tipo de drawer aberto pelo "Ver" (doc) ou download direto (recv). */
  kind: "doc" | "recv"
}
export const DOCUMENTOS_ROWS: DocumentoRow[] = [
  { name: "Extrato bancário", sub: "Banco principal · PDF", tipo: "A enviar", seg: "send", status: { label: "pendente", variant: "pend" }, kind: "doc" },
  { name: "Folha do mês", sub: "manual · sem cálculo", tipo: "A enviar", seg: "send", status: { label: "pendente", variant: "pend" }, preview: true, kind: "doc" },
  { name: "NF-e de venda 001234", sub: "XML · R$ 1.240,00", tipo: "Nota fiscal", seg: "send", status: { label: "enviado", variant: "env" }, preview: true, kind: "doc" },
  { name: "NF-e de compra 5678", sub: "XML · entrada", tipo: "Nota fiscal", seg: "send", status: { label: "conferido", variant: "conf" }, preview: true, kind: "doc" },
  { name: "Balancete de Maio/2026", sub: "recebido do contador · PDF", tipo: "Recebido", seg: "recv", status: { label: "resolvido", variant: "res" }, kind: "recv" },
]

/* ─────────────────────────── OBRIGAÇÕES ─────────────────────────── */

export type ObrigacaoRow = {
  name: string
  comp: string
  venc: string
  valor: string | null
  status: { label: string; variant: ChipVariant }
  preview?: boolean
  /** obrigações "preview" abrem drawer de guia; honorário abre no-op. */
  kind: "guia" | "acao"
}
export const OBRIGACOES_ROWS: ObrigacaoRow[] = [
  { name: "DAS — Simples Nacional", comp: "06/2026", venc: "20/07/2026", valor: null, status: { label: "pendente", variant: "pend" }, preview: true, kind: "guia" },
  { name: "FGTS Digital", comp: "06/2026", venc: "20/07/2026", valor: null, status: { label: "pendente", variant: "pend" }, preview: true, kind: "guia" },
  { name: "INSS / Pró-labore", comp: "06/2026", venc: "20/07/2026", valor: null, status: { label: "pendente", variant: "pend" }, preview: true, kind: "guia" },
  { name: "ISS retido", comp: "05/2026", venc: "10/06/2026", valor: null, status: { label: "vencido", variant: "venc" }, preview: true, kind: "guia" },
  { name: "Honorários do contador", comp: "06/2026", venc: "10/07/2026", valor: "R$ 480,00", status: { label: "pendente", variant: "pend" }, preview: true, kind: "acao" },
]

/* ─────────────────────────── RELATÓRIOS ─────────────────────────── */

export type RelatorioCard = {
  title: string
  sub: string
  icon: LucideIcon
  tint: "primary" | "info" | "danger" | "conf"
  formats: string[]
  preview?: boolean
}
export const RELATORIO_CARDS: RelatorioCard[] = [
  { title: "DRE / Resumo mensal", sub: "visão gerencial — não é a DRE contábil oficial", icon: LineChart, tint: "primary", formats: ["PDF"], preview: true },
  { title: "Relatório de vendas", sub: "do módulo de Vendas", icon: Send, tint: "info", formats: ["CSV", "PDF"] },
  { title: "Relatório de despesas", sub: "do módulo Financeiro", icon: TrendingDown, tint: "danger", formats: ["CSV", "PDF"] },
  { title: "Posição de estoque", sub: "do módulo de Estoque", icon: Package, tint: "conf", formats: ["CSV"] },
]

/* ─────────────────────────── DOSSIÊS ─────────────────────────── */

export type RadarState = "ok" | "warn" | "venc"
export type RadarItem = { label: string; state: RadarState; status: string }
export const RADAR_CNPJ: RadarItem[] = [
  { label: "CNPJ ativo", state: "ok", status: "ativo" },
  { label: "Simples Nacional ativo", state: "ok", status: "ativo" },
  { label: "CND Federal válida", state: "ok", status: "válida" },
  { label: "Certidão Estadual válida", state: "ok", status: "válida" },
  { label: "Certidão Municipal válida", state: "venc", status: "vencida" },
  { label: "DAS em dia", state: "ok", status: "em dia" },
  { label: "DEFIS entregue", state: "ok", status: "entregue" },
  { label: "Certificado digital válido", state: "warn", status: "vence 30d" },
  { label: "Alvará atualizado", state: "venc", status: "vencido" },
  { label: "Procuração contador ativa", state: "ok", status: "ativa" },
  { label: "Pendências e-CAC", state: "warn", status: "2 pendências" },
]

export type DossieOrigem = "sistema" | "anexar" | "portal" | "solicitar"
export type DossieStatus = "pendente" | "atualizado" | "vencido"
export type DossieRow = {
  doc: string
  sub: string
  origem: DossieOrigem
  status: DossieStatus
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
      { doc: "Cartão CNPJ / Comprovante de Inscrição e Situação Cadastral", sub: "Receita Federal · REDESIM", origem: "portal", status: "atualizado" },
      { doc: "Contrato Social / Requerimento de Empresário", sub: "arquivo registrado na Junta", origem: "anexar", status: "atualizado" },
      { doc: "Alterações contratuais", sub: "aditivos registrados", origem: "anexar", status: "pendente" },
      { doc: "Certidão Simplificada da Junta Comercial", sub: "Junta Comercial", origem: "portal", status: "pendente" },
      { doc: "Certidão de Inteiro Teor", sub: "Junta Comercial", origem: "portal", status: "pendente" },
      { doc: "QSA / Quadro de Sócios", sub: "Receita Federal / e-CAC", origem: "portal", status: "atualizado" },
      { doc: "Inscrição Estadual", sub: "Sintegra / Sefaz", origem: "portal", status: "atualizado" },
      { doc: "Inscrição Municipal", sub: "Prefeitura", origem: "portal", status: "atualizado" },
      { doc: "Alvará / Licença de funcionamento", sub: "Prefeitura / Vigilância", origem: "anexar", status: "vencido" },
      { doc: "Comprovante de endereço", sub: "conta recente em nome do CNPJ", origem: "anexar", status: "pendente" },
      { doc: "Dados bancários PJ", sub: "conta PJ para movimentação", origem: "anexar", status: "atualizado" },
      { doc: "Certificado digital", sub: "e-CAC · A1 / A3", origem: "anexar", status: "atualizado" },
      { doc: "Procuração e-CAC / contador", sub: "acesso e-CAC do contador", origem: "solicitar", status: "pendente", validar: true },
      { doc: "CCMEI — quando MEI", sub: "Portal do Empreendedor", origem: "portal", status: "atualizado" },
    ],
  },
  {
    id: "fiscal",
    title: "Dossiê Fiscal / Regularidade",
    sub: "Regularidade e situação fiscal · 13 itens · validar com contador",
    icon: ShieldCheck,
    tint: "warn",
    rows: [
      { doc: "CND Federal — Receita + PGFN", sub: "certidão conjunta", origem: "portal", status: "pendente", validar: true },
      { doc: "Certidão Estadual", sub: "Sefaz", origem: "portal", status: "atualizado", validar: true },
      { doc: "Certidão Municipal", sub: "Prefeitura", origem: "portal", status: "vencido", validar: true },
      { doc: "CRF FGTS — quando houver funcionário", sub: "Caixa", origem: "portal", status: "atualizado", validar: true },
      { doc: "Relatório de Situação Fiscal / Pendências e-CAC", sub: "e-CAC", origem: "portal", status: "pendente", validar: true },
      { doc: "Consulta Optante Simples Nacional", sub: "Simples Nacional", origem: "portal", status: "atualizado", validar: true },
      { doc: "Extrato do Simples Nacional", sub: "PGDAS / e-CAC", origem: "portal", status: "atualizado", validar: true },
      { doc: "PGDAS-D", sub: "declaração mensal do Simples", origem: "portal", status: "atualizado", validar: true },
      { doc: "DEFIS", sub: "declaração anual do Simples", origem: "portal", status: "pendente", validar: true },
      { doc: "DAS pagos", sub: "comprovantes do período", origem: "anexar", status: "atualizado", validar: true },
      { doc: "DAS em aberto", sub: "gerar no PGDAS / PGMEI", origem: "portal", status: "pendente", validar: true },
      { doc: "Parcelamentos", sub: "e-CAC / Simples Nacional", origem: "portal", status: "pendente", validar: true },
      { doc: "Comprovantes de pagamento de tributos", sub: "guias quitadas", origem: "anexar", status: "atualizado", validar: true },
    ],
  },
  {
    id: "banco",
    title: "Dossiê Banco & Crédito",
    sub: "Comprovação de faturamento e saúde financeira · 17 itens",
    icon: Landmark,
    tint: "info",
    rows: [
      { doc: "Faturamento dos últimos 12 meses", sub: "relatório gerencial", origem: "sistema", status: "atualizado" },
      { doc: "Faturamento mês a mês", sub: "relatório gerencial", origem: "sistema", status: "atualizado" },
      { doc: "Declaração de faturamento assinada pelo contador", sub: "assinatura do contador", origem: "solicitar", status: "pendente", validar: true },
      { doc: "DRE gerencial", sub: "não substitui a DRE contábil", origem: "sistema", status: "atualizado", validar: true },
      { doc: "Fluxo de caixa", sub: "relatório gerencial", origem: "sistema", status: "atualizado" },
      { doc: "Contas a pagar", sub: "relatório gerencial", origem: "sistema", status: "atualizado" },
      { doc: "Contas a receber", sub: "relatório gerencial", origem: "sistema", status: "atualizado" },
      { doc: "Extratos bancários PJ", sub: "conciliação bancária", origem: "anexar", status: "pendente" },
      { doc: "Relatório de vendas por forma de pagamento", sub: "módulo de Vendas", origem: "sistema", status: "atualizado" },
      { doc: "Relatório de recebíveis / cartões", sub: "adquirentes", origem: "sistema", status: "atualizado" },
      { doc: "Relação de dívidas e parcelamentos", sub: "conferir com contador", origem: "sistema", status: "pendente", validar: true },
      { doc: "Relatório de estoque", sub: "módulo de Estoque", origem: "sistema", status: "atualizado" },
      { doc: "Certidões negativas", sub: "CND", origem: "portal", status: "pendente", validar: true },
      { doc: "Cartão CNPJ", sub: "Receita Federal", origem: "portal", status: "atualizado" },
      { doc: "Contrato social", sub: "arquivo registrado", origem: "anexar", status: "atualizado" },
      { doc: "Certidão simplificada", sub: "Junta Comercial", origem: "portal", status: "pendente" },
      { doc: "Comprovante de endereço", sub: "conta recente", origem: "anexar", status: "pendente" },
    ],
  },
]

export type DossieFilter =
  | "all"
  | "sistema"
  | "anexar"
  | "portal"
  | "solicitar"
  | "validar"
  | "pendente"
  | "atualizado"
  | "vencido"

export const DOSSIE_FILTERS: { id: DossieFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "sistema", label: "Gerado pelo OmniGestão" },
  { id: "anexar", label: "Anexar manualmente" },
  { id: "portal", label: "Abrir portal oficial" },
  { id: "solicitar", label: "Solicitar ao contador" },
  { id: "validar", label: "Validar com contador" },
  { id: "pendente", label: "Pendente" },
  { id: "atualizado", label: "Atualizado" },
  { id: "vencido", label: "Vencido" },
]

/** Um dossiê row passa no filtro selecionado? (espelha applyDossieFilter do design.) */
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
    case "pendente":
    case "atualizado":
    case "vencido":
      return row.status === filter
    default:
      return true
  }
}

export function dossieFilterCount(filter: DossieFilter): number {
  const rows = DOSSIES.flatMap((d) => d.rows)
  return rows.filter((r) => dossieRowMatches(r, filter)).length
}

/* ─────────────────────────── FOLHA & DP ─────────────────────────── */

export type Funcionario = {
  nome: string
  iniciais: string
  cargo: string
  admissao: string
  docs: { label: string; variant: ChipVariant }
}
export const FOLHA_FUNCIONARIOS: Funcionario[] = [
  { nome: "Ana Souza", iniciais: "AS", cargo: "Vendedora", admissao: "02/2023", docs: { label: "completo", variant: "res" } },
  { nome: "Carlos Lima", iniciais: "CL", cargo: "Técnico", admissao: "08/2024", docs: { label: "falta contrato", variant: "venc" } },
  { nome: "Marina Reis", iniciais: "MR", cargo: "Atendente", admissao: "11/2025", docs: { label: "completo", variant: "res" } },
]

/* ─────────────────────────── PORTAL ─────────────────────────── */

export const PORTAL_PODE: string[] = [
  "Baixar o Pacote do Contador e relatórios",
  "Enviar documentos (upload)",
  "Comentar e abrir solicitações de pendência",
  "Marcar itens como conferido",
]
export const PORTAL_NAO_PODE: string[] = [
  "Editar vendas, estoque ou caixa",
  "Alterar o financeiro",
  "Mudar configurações do sistema",
  "Ver dados que não precisa (minimização LGPD)",
]

/* ─────────────────────────── PERMISSÕES ─────────────────────────── */

export type PermissaoRow = { label: string; sub: string; on: boolean }
export const PERMISSOES_ROWS: PermissaoRow[] = [
  { label: "Documentos", sub: "enviar e baixar arquivos", on: true },
  { label: "Obrigações & vencimentos", sub: "acompanhar prazos", on: true },
  { label: "Relatórios & Pacote", sub: "baixar relatórios", on: true },
  { label: "Folha & DP", sub: "dados sensíveis · cuidado LGPD", on: false },
  { label: "Resumo financeiro", sub: "números gerenciais", on: true },
]

/* ─────────────────────────── TIMELINE ─────────────────────────── */
//
// GOAL 011: a seção Timeline passou a ler `ContadorEvento` + `ContadorComentario`
// reais (`timeline/contador-timeline-real.tsx`). O array ilustrativo `TIMELINE_ITEMS`
// e a "conversa com o contador" mockada foram REMOVIDOS — não existe mais atividade
// fictícia no HUB.

/* ─────────────────────────── COMPETÊNCIA ─────────────────────────── */

export const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
]

export const COMPETENCIA_INICIAL = { mesIdx: 5, ano: 2026 } // Junho / 2026
