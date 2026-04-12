/**
 * Camada de dados dos relatórios gerenciais.
 * Hoje usa mocks; substituir por chamadas fetch/API quando o banco estiver disponível.
 */

import {
  subDays,
  startOfDay,
  endOfDay,
  eachDayOfInterval,
  format,
} from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"

export type PeriodoRelatorio = "hoje" | "7dias" | "mes" | "personalizado"

export interface IntervaloDatas {
  inicio: Date
  fim: Date
}

export interface ResumoGerencial {
  faturamentoBruto: number
  custoMercadoria: number
  despesas: number
  lucroLiquido: number
  totalVendas: number
  totalOs: number
}

export interface RecebimentosPorCanal {
  pix: number
  dinheiro: number
  cartao: number
  carneAReceber: number
}

export interface PontoGraficoDiario {
  dia: string
  diaLabel: string
  vendasBalcao: number
  ordensServico: number
}

export interface ProdutoMaisVendido {
  id: string
  nome: string
  quantidade: number
  receita: number
}

export interface VendaPorVendedor {
  vendedorId: string
  nome: string
  total: number
  quantidadeVendas: number
}

export interface MetricasVendas {
  ticketMedio: number
  produtosMaisVendidos: ProdutoMaisVendido[]
  vendasPorVendedor: VendaPorVendedor[]
}

export interface MetricasOS {
  tempoMedioConsertoHoras: number
  osComGarantiaNoPeriodo: number
  taxaRetornoGarantiaPct: number
}

export interface ItemEstoqueBaixo {
  id: string
  nome: string
  sku: string
  quantidade: number
  minimo: number
  valorUnitario: number
}

export interface MetricasEstoque {
  valorTotalEstoque: number
  itensBaixoEstoque: ItemEstoqueBaixo[]
}

export interface LancamentoFluxo {
  id: string
  data: string
  descricao: string
  entrada: number
  saida: number
}

export interface InadimplenteCarne {
  id: string
  cliente: string
  parcela: string
  valor: number
  vencimento: string
  diasAtraso: number
}

export interface MetricasFinanceiro {
  saldoFluxoPeriodo: number
  lancamentos: LancamentoFluxo[]
  inadimplentesCarne: InadimplenteCarne[]
}

export interface DocumentoHistorico {
  id: string
  tipo: "nf" | "contrato_garantia"
  numero: string
  referencia: string
  data: string
  status: string
}

function resolverIntervalo(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): IntervaloDatas {
  const hoje = new Date()
  switch (periodo) {
    case "hoje":
      return { inicio: startOfDay(hoje), fim: endOfDay(hoje) }
    case "7dias":
      return { inicio: startOfDay(subDays(hoje, 6)), fim: endOfDay(hoje) }
    case "mes": {
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      return { inicio: startOfDay(inicioMes), fim: endOfDay(hoje) }
    }
    case "personalizado":
      if (custom?.inicio && custom?.fim) {
        return {
          inicio: startOfDay(new Date(custom.inicio)),
          fim: endOfDay(new Date(custom.fim)),
        }
      }
      return { inicio: startOfDay(subDays(hoje, 6)), fim: endOfDay(hoje) }
    default:
      return { inicio: startOfDay(subDays(hoje, 6)), fim: endOfDay(hoje) }
  }
}

/** Seed determinístico simples para números estáveis por período */
function seed(n: number): number {
  const x = Math.sin(n) * 10000
  return x - Math.floor(x)
}

export async function fetchResumoGerencial(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): Promise<ResumoGerencial> {
  await new Promise((r) => setTimeout(r, 80))
  const { inicio, fim } = resolverIntervalo(periodo, custom)
  const dias = Math.max(
    1,
    Math.ceil((fim.getTime() - inicio.getTime()) / (86400000))
  )
  const base = 1200 + dias * 180 + seed(dias) * 4000
  const faturamentoBruto = Math.round(base * 8.5 * 100) / 100
  const custoMercadoria = Math.round(faturamentoBruto * (0.28 + seed(dias + 1) * 0.08) * 100) / 100
  const despesas = Math.round(faturamentoBruto * (0.12 + seed(dias + 2) * 0.05) * 100) / 100
  const lucroLiquido = Math.round(
    (faturamentoBruto - custoMercadoria - despesas) * 100
  ) / 100
  return {
    faturamentoBruto,
    custoMercadoria,
    despesas,
    lucroLiquido,
    totalVendas: Math.floor(12 + dias * 1.2 + seed(dias + 3) * 8),
    totalOs: Math.floor(5 + dias * 0.4 + seed(dias + 4) * 5),
  }
}

export async function fetchRecebimentos(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): Promise<RecebimentosPorCanal> {
  await new Promise((r) => setTimeout(r, 60))
  const { inicio, fim } = resolverIntervalo(periodo, custom)
  const dias = Math.max(1, Math.ceil((fim.getTime() - inicio.getTime()) / 86400000))
  const total = 8000 + dias * 900
  return {
    pix: Math.round(total * 0.38 * 100) / 100,
    dinheiro: Math.round(total * 0.22 * 100) / 100,
    cartao: Math.round(total * 0.28 * 100) / 100,
    carneAReceber: Math.round(total * 0.12 * 100) / 100,
  }
}

export async function fetchGraficoBalcaoVsOSUltimos30Dias(): Promise<PontoGraficoDiario[]> {
  await new Promise((r) => setTimeout(r, 100))
  const fim = endOfDay(new Date())
  const inicio = startOfDay(subDays(fim, 29))
  const dias = eachDayOfInterval({ start: inicio, end: fim })
  return dias.map((d, i) => {
    const s = seed(i + 40)
    const vendasBalcao = Math.round((800 + s * 2200) * 100) / 100
    const ordensServico = Math.round((400 + seed(i + 99) * 1800) * 100) / 100
    return {
      dia: format(d, "yyyy-MM-dd"),
      diaLabel: format(d, "dd/MM", { locale: ptBR }),
      vendasBalcao,
      ordensServico,
    }
  })
}

export async function fetchMetricasVendas(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): Promise<MetricasVendas> {
  await new Promise((r) => setTimeout(r, 90))
  const { inicio, fim } = resolverIntervalo(periodo, custom)
  const dias = Math.max(1, Math.ceil((fim.getTime() - inicio.getTime()) / 86400000))
  const produtosMaisVendidos: ProdutoMaisVendido[] = [
    { id: "1", nome: "Película 3D", quantidade: 45 + dias, receita: 890 + dias * 12 },
    { id: "2", nome: "Capa Anti-impacto", quantidade: 32 + Math.floor(dias / 2), receita: 1280 },
    { id: "3", nome: "Carregador Turbo 25W", quantidade: 28, receita: 1960 },
    { id: "4", nome: "Fone Bluetooth TWS", quantidade: 18, receita: 2150 },
    { id: "5", nome: "Cabo USB-C 2m", quantidade: 52, receita: 780 },
  ]
  const vendasPorVendedor: VendaPorVendedor[] = [
    { vendedorId: "v1", nome: "Rafael", total: 12400 + dias * 100, quantidadeVendas: 42 },
    { vendedorId: "v2", nome: "Atend. Balcão 2", total: 8900 + dias * 80, quantidadeVendas: 31 },
    { vendedorId: "v3", nome: "Loja Online", total: 3200, quantidadeVendas: 12 },
  ]
  const totalV = vendasPorVendedor.reduce((a, v) => a + v.total, 0)
  const qtd = vendasPorVendedor.reduce((a, v) => a + v.quantidadeVendas, 0)
  return {
    ticketMedio: Math.round((totalV / qtd) * 100) / 100,
    produtosMaisVendidos,
    vendasPorVendedor,
  }
}

export async function fetchMetricasOS(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): Promise<MetricasOS> {
  await new Promise((r) => setTimeout(r, 70))
  const { fim } = resolverIntervalo(periodo, custom)
  const n = fim.getDate()
  return {
    tempoMedioConsertoHoras: Math.round((4.2 + seed(n) * 8) * 10) / 10,
    osComGarantiaNoPeriodo: 12 + Math.floor(seed(n + 1) * 20),
    taxaRetornoGarantiaPct: Math.round((1.2 + seed(n + 2) * 3) * 10) / 10,
  }
}

export async function fetchMetricasEstoque(): Promise<MetricasEstoque> {
  await new Promise((r) => setTimeout(r, 70))
  return {
    valorTotalEstoque: 84250.0,
    itensBaixoEstoque: [
      { id: "e1", nome: "Tela iPhone 11", sku: "TEL-IP11", quantidade: 2, minimo: 5, valorUnitario: 120 },
      { id: "e2", nome: "Bateria Samsung A32", sku: "BAT-A32", quantidade: 1, minimo: 4, valorUnitario: 45 },
      { id: "e3", nome: "Conector de carga USB-C", sku: "CC-USBC", quantidade: 3, minimo: 10, valorUnitario: 8.5 },
      { id: "e4", nome: "Película Universal", sku: "PEL-UNI", quantidade: 8, minimo: 20, valorUnitario: 5 },
    ],
  }
}

export async function fetchMetricasFinanceiro(
  periodo: PeriodoRelatorio,
  custom?: { inicio?: string; fim?: string }
): Promise<MetricasFinanceiro> {
  await new Promise((r) => setTimeout(r, 90))
  const { inicio, fim } = resolverIntervalo(periodo, custom)
  const lancamentos: LancamentoFluxo[] = [
    { id: "1", data: format(fim, "dd/MM/yyyy"), descricao: "Entrada PDV / Pix", entrada: 4200, saida: 0 },
    { id: "2", data: format(fim, "dd/MM/yyyy"), descricao: "Compra peças fornecedor", entrada: 0, saida: 2100 },
    { id: "3", data: format(inicio, "dd/MM/yyyy"), descricao: "Pagamento aluguel", entrada: 0, saida: 3500 },
  ]
  const entradas = lancamentos.reduce((a, l) => a + l.entrada, 0)
  const saidas = lancamentos.reduce((a, l) => a + l.saida, 0)
  return {
    saldoFluxoPeriodo: Math.round((entradas - saidas) * 100) / 100,
    lancamentos,
    inadimplentesCarne: [
      { id: "i1", cliente: "Márcio Alves", parcela: "3/6", valor: 120, vencimento: "01/03/2026", diasAtraso: 40 },
      { id: "i2", cliente: "Juliana Rocha", parcela: "2/4", valor: 85.5, vencimento: "15/03/2026", diasAtraso: 25 },
      { id: "i3", cliente: "Tiago Nunes", parcela: "5/10", valor: 45, vencimento: "28/03/2026", diasAtraso: 12 },
    ],
  }
}

export async function fetchDocumentosHistorico(): Promise<DocumentoHistorico[]> {
  await new Promise((r) => setTimeout(r, 60))
  return [
    { id: "d1", tipo: "nf", numero: "NF-e 12458", referencia: "Venda #V-8821", data: "09/04/2026 14:20", status: "Autorizada" },
    { id: "d2", tipo: "contrato_garantia", numero: "CTR-GAR-2026-0142", referencia: "OS-2026-089", data: "08/04/2026 18:00", status: "Assinado" },
    { id: "d3", tipo: "nf", numero: "NF-e 12457", referencia: "OS #OS-2026-088", data: "08/04/2026 11:15", status: "Autorizada" },
    { id: "d4", tipo: "contrato_garantia", numero: "CTR-GAR-2026-0141", referencia: "Venda seminovo", data: "07/04/2026 16:45", status: "Pendente assinatura" },
  ]
}

export function getLabelPeriodo(periodo: PeriodoRelatorio): string {
  switch (periodo) {
    case "hoje":
      return "Hoje"
    case "7dias":
      return "Últimos 7 dias"
    case "mes":
      return "Mês atual"
    case "personalizado":
      return "Período personalizado"
    default:
      return ""
  }
}
