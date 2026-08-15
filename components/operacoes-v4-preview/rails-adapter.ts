/**
 * Operações V4 Preview — adaptadores READ-ONLY das telas de rail (Visão geral,
 * SLA, PDV de serviço). A Fila operacional vive em `lib/operacoes-v4/fila-v4.ts`.
 * A Bancada operacional vive em `lib/operacoes-v4/producao-v4.ts`.
 * `buildFilaItens` / `buildBancadaView` permanecem como projeções leves de lista.
 *
 * Recebe a lista de `OrdemServico` REAIS da loja ativa (carregadas por `listOrdens`,
 * somente leitura) e produz os view-models que cada tela de módulo consome. Puro,
 * sem efeitos colaterais, sem Prisma/Server Action. Onde não há dado real suficiente,
 * o builder sinaliza `temDados: false` para a UI exibir um estado vazio honesto e
 * ESPECÍFICO do módulo — nunca um número, técnico, SLA ou valor fabricado.
 *
 * Princípio (GOAL OPS-V4-REAL-SEARCH-AND-RAILS-001): só dado real ou vazio honesto.
 */
import type { OrdemServico } from "@/types/os";
import type { FinancialProjectionOSV4, FinancialStatusV4 } from "@/lib/operacoes-v4/financial-projection";
import type { V4Status, V4Tone } from "./types";
import { STATUS_LABEL, TONE } from "./mock-data";
import { aparelhoLabel, fmtData, resolverStatusV4 } from "./os-adapter";
import { isOrcamentoPreOsAtivoV4 } from "@/lib/operacoes-v4/orcamento-pre-os";
import { C, fmt } from "./tokens";

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Status que NÃO contam como "ativo na operação" (fora da fila/bancada/SLA). */
const STATUS_FINALIZADO: V4Status[] = ["entregue", "cancelada"];

// "desconhecido" NÃO entra em STATUS_FINALIZADO de propósito: uma OS com status
// inconsistente continua VISÍVEL na fila (some-la esconderia o problema) — o que
// ela perde é a ação primária (`PRIMARY.desconhecido === null`).
function isAtivo(os: OrdemServico): boolean {
  if (isOrcamentoPreOsAtivoV4(os)) return false;
  return !STATUS_FINALIZADO.includes(resolverStatusV4(os));
}

/** Linha de OS reutilizada por Fila / Bancada / SLA (apenas dados reais). */
export interface RailOsRow {
  id: string;
  codigo: string;
  cliente: string;
  aparelho: string;
  status: V4Status;
  statusLabel: string;
  tone: V4Tone;
  entrada: string;
  previsao: string;
}

function toRow(os: OrdemServico): RailOsRow {
  const status = resolverStatusV4(os);
  return {
    id: os.id,
    codigo: txt(os.codigo) || "OS",
    cliente: txt(os.cliente?.nome) || "Cliente não informado",
    aparelho: aparelhoLabel(os),
    status,
    statusLabel: STATUS_LABEL[status] || status,
    tone: TONE[status] || TONE.em_execucao,
    entrada: fmtData(os.criadoEm),
    previsao: os.sla?.prazo ? fmtData(os.sla.prazo) : "",
  };
}

/** Ordena por entrada (mais antiga primeiro = frente da fila); sem data vai ao fim. */
function ordemEntrada(a: OrdemServico, b: OrdemServico): number {
  const ta = new Date(a.criadoEm ?? "").getTime();
  const tb = new Date(b.criadoEm ?? "").getTime();
  const va = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
  const vb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
  return va - vb;
}

function temSlaReal(os: OrdemServico): boolean {
  return !!os.sla && (!!os.sla.prazo || !!os.sla.status);
}

// ---- Visão geral (dashboard) -----------------------------------------------

export interface DashboardBucket {
  key: V4Status;
  label: string;
  count: number;
}

export interface DashboardResumo {
  /** false quando a loja não tem nenhuma OS → empty state honesto. */
  temDados: boolean;
  total: number;
  ativos: number;
  buckets: DashboardBucket[];
  /** true quando ao menos uma OS tem SLA real → habilita o KPI de atrasadas. */
  temSla: boolean;
  atrasadas: number;
}

export function buildDashboardResumo(ordens: OrdemServico[]): DashboardResumo {
  const count = (s: V4Status) => ordens.filter((o) => resolverStatusV4(o) === s).length;
  const buckets: DashboardBucket[] = [
    { key: "aberta", label: "Abertas", count: count("aberta") },
    { key: "diagnostico", label: "Em diagnóstico", count: count("diagnostico") },
    { key: "aguardando_aprovacao", label: "Aguardando aprovação", count: count("aguardando_aprovacao") },
    { key: "aprovado", label: "Aprovadas", count: count("aprovado") },
    { key: "aguardando_peca", label: "Aguardando peça", count: count("aguardando_peca") },
    { key: "em_execucao", label: "Em execução", count: count("em_execucao") },
    { key: "pronta", label: "Prontas", count: count("pronta") },
    { key: "entregue", label: "Entregues", count: count("entregue") },
  ];
  return {
    temDados: ordens.length > 0,
    total: ordens.length,
    ativos: ordens.filter(isAtivo).length,
    buckets,
    temSla: ordens.some(temSlaReal),
    atrasadas: ordens.filter((o) => o.sla?.status === "estourado").length,
  };
}

// ---- Fila ------------------------------------------------------------------

export function buildFilaItens(ordens: OrdemServico[]): RailOsRow[] {
  return ordens.filter(isAtivo).slice().sort(ordemEntrada).map(toRow);
}

// ---- Bancada por técnico ---------------------------------------------------

export interface BancadaGrupo {
  tecnico: string;
  itens: RailOsRow[];
}

export interface BancadaView {
  /** false quando nenhuma OS ativa tem técnico real → empty honesto (sem inventar técnico). */
  temDados: boolean;
  grupos: BancadaGrupo[];
}

export function buildBancadaView(ordens: OrdemServico[]): BancadaView {
  const comTecnico = ordens.filter((o) => isAtivo(o) && txt(o.tecnico?.nome));
  if (comTecnico.length === 0) return { temDados: false, grupos: [] };

  const map = new Map<string, OrdemServico[]>();
  for (const o of comTecnico) {
    const t = txt(o.tecnico?.nome);
    const list = map.get(t);
    if (list) list.push(o);
    else map.set(t, [o]);
  }
  const grupos: BancadaGrupo[] = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([tecnico, list]) => ({ tecnico, itens: list.slice().sort(ordemEntrada).map(toRow) }));
  return { temDados: true, grupos };
}

// ---- SLA & atrasos ---------------------------------------------------------

export interface SlaView {
  /** false quando nenhuma OS tem SLA real → empty honesto (sem inventar prazo). */
  temDados: boolean;
  atrasadas: RailOsRow[];
  vencendo: RailOsRow[];
  noPrazo: number;
}

export function buildSlaView(ordens: OrdemServico[]): SlaView {
  const comSla = ordens.filter(temSlaReal);
  if (comSla.length === 0) return { temDados: false, atrasadas: [], vencendo: [], noPrazo: 0 };

  const ativos = comSla.filter(isAtivo);
  return {
    temDados: true,
    atrasadas: ativos.filter((o) => o.sla?.status === "estourado").slice().sort(ordemEntrada).map(toRow),
    vencendo: ativos.filter((o) => o.sla?.status === "atencao").slice().sort(ordemEntrada).map(toRow),
    noPrazo: ativos.filter((o) => o.sla?.status === "ok").length,
  };
}

// ---- PDV de serviço ---------------------------------------------------------
// Badge, recebido e saldo usam a mesma projeção server-side da aba Financeiro.
// Ausência/erro de projeção permanece indisponível, nunca "Sem pendência".

const FATURA_TONE: Record<"aReceber" | "quitado" | "incompleto" | "cancelado" | "semCobranca" | "indisponivel", V4Tone> = {
  aReceber: { bg: C.warnBg, fg: C.warnFg, dot: C.warn },
  quitado: { bg: C.successBg, fg: C.successFg, dot: C.success },
  incompleto: { bg: C.infoBg, fg: C.infoFg, dot: C.info },
  cancelado: { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger },
  semCobranca: { bg: C.line3, fg: C.bodySoft, dot: C.subtle },
  indisponivel: { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger },
};

export interface PdvRow {
  id: string;
  codigo: string;
  cliente: string;
  total: string;
  totalNum: number | null;
  statusFaturamento: string;
  statusTone: V4Tone;
  /** "Saldo: R$ X" — só quando há cobrança real (aReceber/quitado); "" caso contrário. */
  saldoLinha: string;
}

export interface PdvView {
  /** false quando nenhuma OS tem valor/faturamento real → empty honesto. */
  temDados: boolean;
  itens: PdvRow[];
  totalGeral: string;
  aReceberCount: number;
}

type ToneKey = keyof typeof FATURA_TONE;

/**
 * Prioridade do badge: cancelado > saldo REAL do motor V3 (autoritativo,
 * corrige o P1 da auditoria) > sinal legado (`faturamentoPendente`, só quando
 * não há orçamento/pagamento V3 nenhum — mesmo sinal que o card Financeiro
 * mostra como "status do faturamento") > prévia sintetizada > sem cobrança.
 */
function toneKeyDaProjecao(status: FinancialStatusV4): ToneKey {
  if (status === "PAID") return "quitado";
  if (status === "OPEN" || status === "PARTIAL" || status === "AUTHORIZED_CREDIT") return "aReceber";
  if (status === "CANCELLED" || status === "REVERSED") return "cancelado";
  if (status === "NO_PRICE" || status === "AUTHORIZED_NO_CHARGE") return "semCobranca";
  if (status === "PRICE_DEFINED" || status === "CHARGE_NOT_CREATED") return "incompleto";
  return "indisponivel";
}

const STATUS_FATURAMENTO_LABEL: Record<ToneKey, string> = {
  cancelado: "Faturamento cancelado",
  aReceber: "A receber",
  quitado: "Quitado",
  incompleto: "Revisar cobrança",
  semCobranca: "Sem cobrança",
  indisponivel: "Financeiro indisponível",
};

export function buildPdvView(
  ordens: OrdemServico[],
  projectionsByOsId: ReadonlyMap<string, FinancialProjectionOSV4>,
): PdvView {
  const comFin = ordens.filter((os) => projectionsByOsId.has(os.id));
  if (comFin.length === 0) {
    return { temDados: false, itens: [], totalGeral: "—", aReceberCount: 0 };
  }

  const itens: PdvRow[] = comFin
    .slice()
    .sort((a, b) => (projectionsByOsId.get(b.id)?.expectedTotal ?? -1) - (projectionsByOsId.get(a.id)?.expectedTotal ?? -1))
    .map((os) => {
      const projection = projectionsByOsId.get(os.id)!;
      const toneKey = toneKeyDaProjecao(projection.financialStatus);
      const totalNum = projection.expectedTotal;
      const saldoLinha = projection.balance != null ? `Saldo: ${fmt(projection.balance)}` : "";
      return {
        id: os.id,
        codigo: txt(os.codigo) || "OS",
        cliente: txt(os.cliente?.nome) || "Cliente não informado",
        total: totalNum != null ? fmt(totalNum) : "Indisponível",
        totalNum,
        statusFaturamento: STATUS_FATURAMENTO_LABEL[toneKey],
        statusTone: FATURA_TONE[toneKey],
        saldoLinha,
      };
    });

  const totals = itens.map((item) => item.totalNum).filter((value): value is number => value != null);
  const totalGeral = totals.length === itens.length ? fmt(totals.reduce((sum, value) => sum + value, 0)) : "Parcialmente indisponível";
  const aReceberCount = comFin.filter((os) => toneKeyDaProjecao(projectionsByOsId.get(os.id)!.financialStatus) === "aReceber").length;
  return { temDados: true, itens, totalGeral, aReceberCount };
}
