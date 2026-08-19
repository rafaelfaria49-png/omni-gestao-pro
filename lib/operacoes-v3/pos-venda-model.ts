// ============================================================================
// Operações V3 — Fase 3A · MODELO de PÓS-VENDA (puro, fonte de verdade)
// ----------------------------------------------------------------------------
// Módulo PURO (sem I/O, sem React, sem Prisma). Lê entrega, garantia e retornos
// a partir do que JÁ existe + extras no `payload` (JSONB):
//   • entrega  → `payload.entregaV3` (+ fallback os.entregueEm / os.retirada)
//   • garantia → `payload.aberturaV3.garantiaPrevista` (+ fallback os.garantia)
//   • retornos → `payload.retornosV3[]`
// A garantia de reparo conta a partir da ENTREGA. Sem entrega → "prevista".
// Nada aqui escreve; nada inventa data.
// ============================================================================

import type { OrdemServico } from "@/types/os";
import { garantiaCatalogoV3 } from "./garantia-textos";

const DIA_MS = 86400000;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function parseIso(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDaysIso(iso: string, dias: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

// ----------------------------------------------------------------------------
// Entrega (item 1)
// ----------------------------------------------------------------------------

export interface EntregaV3View {
  entregue: boolean;
  entregueEm?: string;
  /** Operador que realizou a entrega (sessão). */
  entreguePor?: string;
  /** Quem retirou o aparelho (cliente/portador). */
  recebidoPor?: string;
  observacao?: string;
  /** Assinatura digital de retirada (data URL) — SPRINT_3E.2. */
  assinaturaRetiradaDataUrl?: string;
}

export type CategoriaFotoSaidaV3 = "reparado" | "acessorio" | "outro";

export const CATEGORIAS_FOTO_SAIDA_V3: { id: CategoriaFotoSaidaV3; label: string }[] = [
  { id: "reparado", label: "Aparelho reparado" },
  { id: "acessorio", label: "Acessório na saída" },
  { id: "outro", label: "Outra" },
];

export interface FotoSaidaV3 {
  id: string;
  categoria: CategoriaFotoSaidaV3;
  nome?: string;
  dataUrl: string;
  tamanho: number;
  criadoEm: string;
}

function categoriaFotoSaidaV3(v: unknown): CategoriaFotoSaidaV3 {
  return v === "acessorio" || v === "outro" ? v : "reparado";
}

/** Fotos de saída reais em `payload.entregaV3.fotosSaida` (data URL). Lista vazia = honesto. */
export function lerFotosSaidaV3(os: OrdemServico | null | undefined): FotoSaidaV3[] {
  const e = (os as { entregaV3?: { fotosSaida?: unknown } } | null | undefined)?.entregaV3;
  const lista = Array.isArray(e?.fotosSaida) ? e.fotosSaida : [];
  const out: FotoSaidaV3[] = [];
  for (const raw of lista) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const dataUrl = s(f.dataUrl);
    if (!dataUrl.startsWith("data:image/")) continue;
    out.push({
      id: s(f.id) || `foto_saida_${out.length + 1}`,
      categoria: categoriaFotoSaidaV3(f.categoria),
      nome: s(f.nome) || undefined,
      dataUrl,
      tamanho: typeof f.tamanho === "number" && Number.isFinite(f.tamanho) ? f.tamanho : 0,
      criadoEm: s(f.criadoEm),
    });
  }
  return out;
}

export function lerEntregaV3(os: OrdemServico | null | undefined): EntregaV3View {
  const e = (os as { entregaV3?: Record<string, unknown> } | null | undefined)?.entregaV3;
  const entregueEm = s(e?.entregueEm) || s(os?.entregueEm) || s(os?.retirada?.retiradoEm) || undefined;
  const assin = (e?.assinaturaRetirada ?? undefined) as { dataUrl?: unknown } | undefined;
  const assinaturaRetiradaDataUrl = s(assin?.dataUrl).startsWith("data:image/") ? s(assin?.dataUrl) : undefined;
  return {
    entregue: !!entregueEm,
    entregueEm,
    entreguePor: s(e?.entreguePor) || undefined,
    recebidoPor: s(e?.recebidoPor) || s(os?.retirada?.retiradoPor) || undefined,
    observacao: s(e?.observacao) || s(os?.retirada?.observacao) || undefined,
    assinaturaRetiradaDataUrl,
  };
}

// ----------------------------------------------------------------------------
// Garantia (itens 3/4) — situação derivada da entrega + prazo
// ----------------------------------------------------------------------------

export type GarantiaSituacaoV3 = "nenhuma" | "sem_garantia" | "prevista" | "ativa" | "vencida";

export const GARANTIA_SITUACAO_META_V3: Record<GarantiaSituacaoV3, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  nenhuma: { label: "Sem garantia definida", tone: "neutral" },
  sem_garantia: { label: "Sem cobertura", tone: "neutral" },
  prevista: { label: "Prevista (aguardando entrega)", tone: "info" },
  ativa: { label: "Ativa", tone: "success" },
  vencida: { label: "Vencida", tone: "danger" },
};

export interface GarantiaV3View {
  temGarantia: boolean;
  modeloId: string;
  label: string;
  prazoDias: number;
  semCobertura: boolean;
  situacao: GarantiaSituacaoV3;
  /** ISO do início (= entrega), quando já iniciada. */
  inicio?: string;
  /** ISO do vencimento (= início + prazo), quando já iniciada. */
  vencimento?: string;
  /** Dias restantes até o vencimento (negativo = vencida há N dias). */
  diasRestantes?: number;
}

function garantiaPrevistaDe(os: OrdemServico | null | undefined): { modelo?: string; label?: string; prazoDias?: number; termo?: string } | undefined {
  return (os as { aberturaV3?: { garantiaPrevista?: { modelo?: string; label?: string; prazoDias?: number; termo?: string } } } | null | undefined)?.aberturaV3
    ?.garantiaPrevista;
}

export function lerGarantiaV3(os: OrdemServico | null | undefined, now: Date = new Date()): GarantiaV3View {
  const gp = garantiaPrevistaDe(os);
  const g2 = os?.garantia;
  const g2Inicio = s((g2 as { inicioEm?: unknown } | undefined)?.inicioEm) || undefined;
  const g2op = os?.garantiasOperacionais?.[0];

  const modeloId = s(gp?.modelo) || "personalizado";
  const cat = garantiaCatalogoV3(modeloId);
  const label = s(gp?.label) || cat.titulo;
  const prazoDias = numOr(gp?.prazoDias, numOr(g2?.prazoDias, numOr(g2op?.prazoDias, cat.prazoDiasPadrao)));

  const definida = !!gp || !!g2?.fimEm || !!g2?.ativa || !!g2op || !!g2Inicio;
  if (!definida) {
    return { temGarantia: false, modeloId, label, prazoDias, semCobertura: cat.semCobertura, situacao: "nenhuma" };
  }

  const semCobertura = cat.semCobertura || prazoDias <= 0;
  if (semCobertura) {
    return { temGarantia: true, modeloId, label, prazoDias: 0, semCobertura: true, situacao: "sem_garantia" };
  }

  const entrega = lerEntregaV3(os);
  const inicioIso = entrega.entregueEm || g2Inicio;
  if (!inicioIso) {
    return { temGarantia: true, modeloId, label, prazoDias, semCobertura: false, situacao: "prevista" };
  }

  // Vencimento: usa o fim explícito do V2 quando não há garantia V3; senão início + prazo.
  const vencimentoIso = g2?.fimEm && !gp ? (g2.fimEm as string) : addDaysIso(inicioIso, prazoDias);
  const venc = parseIso(vencimentoIso);
  const diasRestantes = venc ? Math.ceil((venc.getTime() - now.getTime()) / DIA_MS) : undefined;
  const situacao: GarantiaSituacaoV3 = venc && venc.getTime() >= now.getTime() ? "ativa" : "vencida";

  return { temGarantia: true, modeloId, label, prazoDias, semCobertura: false, situacao, inicio: inicioIso, vencimento: vencimentoIso, diasRestantes };
}

export interface GarantiaLinhaV3 {
  os: OrdemServico;
  garantia: GarantiaV3View;
}

export interface ClassificacaoGarantiasV3 {
  ativas: GarantiaLinhaV3[];
  vencendo: GarantiaLinhaV3[];
  vencidas: GarantiaLinhaV3[];
  previstas: GarantiaLinhaV3[];
}

/** Segmenta as garantias das OS em ativas / vencendo (≤ janela) / vencidas / previstas. */
export function classificarGarantiasV3(
  ordens: OrdemServico[],
  opts?: { vencendoDias?: number; now?: Date },
): ClassificacaoGarantiasV3 {
  const vencendoDias = opts?.vencendoDias ?? 15;
  const now = opts?.now ?? new Date();
  const out: ClassificacaoGarantiasV3 = { ativas: [], vencendo: [], vencidas: [], previstas: [] };
  for (const os of ordens ?? []) {
    const garantia = lerGarantiaV3(os, now);
    const linha: GarantiaLinhaV3 = { os, garantia };
    if (garantia.situacao === "ativa") {
      if (typeof garantia.diasRestantes === "number" && garantia.diasRestantes <= vencendoDias) out.vencendo.push(linha);
      else out.ativas.push(linha);
    } else if (garantia.situacao === "vencida") {
      out.vencidas.push(linha);
    } else if (garantia.situacao === "prevista") {
      out.previstas.push(linha);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Retornos em garantia (itens 5/6)
// ----------------------------------------------------------------------------

export type RetornoStatusV3 = "aberto" | "finalizado";

export const RETORNO_STATUS_META_V3: Record<RetornoStatusV3, { label: string; tone: "warning" | "success" }> = {
  aberto: { label: "Em aberto", tone: "warning" },
  finalizado: { label: "Finalizado", tone: "success" },
};

export interface RetornoV3 {
  id: string;
  /** Vínculo com a OS original (item 5). */
  osOriginalId: string;
  osOriginalCodigo?: string;
  motivo: string;
  /** Observação de abertura (relato do atendente). */
  observacao?: string;
  criadoEm: string;
  criadoPor?: string;
  status: RetornoStatusV3;
  /** Snapshot: a garantia estava ativa quando o retorno foi aberto? */
  garantiaAtivaNaAbertura?: boolean;
  /** Atendimento novo gerado para trabalhar o retorno (OS entregue é status final). */
  osRetornoId?: string;
  osRetornoCodigo?: string;
  finalizadoEm?: string;
  finalizadoPor?: string;
  observacaoFinal?: string;
}

/** Vínculo gravado no payload da OS nova (`vinculoRetornoV3`). */
export interface VinculoRetornoV3 {
  osOrigemId: string;
  osOrigemCodigo?: string;
  retornoId?: string;
  motivo?: string;
  garantiaAtivaNaAbertura?: boolean;
  finalizadoEm?: string;
  finalizadoPorEntrega?: boolean;
}

export function lerVinculoRetornoV3(os: OrdemServico | null | undefined): VinculoRetornoV3 | undefined {
  const raw = (os as { vinculoRetornoV3?: unknown } | null | undefined)?.vinculoRetornoV3;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const osOrigemId = s(o.osOrigemId);
  if (!osOrigemId) return undefined;
  return {
    osOrigemId,
    osOrigemCodigo: s(o.osOrigemCodigo) || undefined,
    retornoId: s(o.retornoId) || undefined,
    motivo: s(o.motivo) || undefined,
    garantiaAtivaNaAbertura: typeof o.garantiaAtivaNaAbertura === "boolean" ? o.garantiaAtivaNaAbertura : undefined,
    finalizadoEm: s(o.finalizadoEm) || undefined,
    finalizadoPorEntrega: o.finalizadoPorEntrega === true ? true : undefined,
  };
}

function isRetornoStatus(v: unknown): v is RetornoStatusV3 {
  return v === "aberto" || v === "finalizado";
}

/** Lê os retornos da OS (mais recentes primeiro). */
export function lerRetornosV3(os: OrdemServico | null | undefined): RetornoV3[] {
  const raw = (os as { retornosV3?: unknown } | null | undefined)?.retornosV3;
  if (!Array.isArray(raw)) return [];
  const list = raw
    .map((r): RetornoV3 | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const id = s(o.id);
      if (!id) return null;
      return {
        id,
        osOriginalId: s(o.osOriginalId) || s(os?.id),
        osOriginalCodigo: s(o.osOriginalCodigo) || undefined,
        motivo: s(o.motivo),
        observacao: s(o.observacao) || undefined,
        criadoEm: s(o.criadoEm),
        criadoPor: s(o.criadoPor) || undefined,
        status: isRetornoStatus(o.status) ? o.status : "aberto",
        garantiaAtivaNaAbertura: typeof o.garantiaAtivaNaAbertura === "boolean" ? o.garantiaAtivaNaAbertura : undefined,
        osRetornoId: s(o.osRetornoId) || undefined,
        osRetornoCodigo: s(o.osRetornoCodigo) || undefined,
        finalizadoEm: s(o.finalizadoEm) || undefined,
        finalizadoPor: s(o.finalizadoPor) || undefined,
        observacaoFinal: s(o.observacaoFinal) || undefined,
      };
    })
    .filter((r): r is RetornoV3 => r !== null);
  return list.sort((a, b) => Date.parse(b.criadoEm || "") - Date.parse(a.criadoEm || ""));
}

export interface ResumoRetornosV3 {
  total: number;
  abertos: number;
  finalizados: number;
  ultimoMotivo?: string;
  ultimoEm?: string;
}

export function resumoRetornosV3(os: OrdemServico | null | undefined): ResumoRetornosV3 {
  const list = lerRetornosV3(os);
  return {
    total: list.length,
    abertos: list.filter((r) => r.status === "aberto").length,
    finalizados: list.filter((r) => r.status === "finalizado").length,
    ultimoMotivo: list[0]?.motivo || undefined,
    ultimoEm: list[0]?.criadoEm || undefined,
  };
}

/** Chave do cliente para agregação (id quando houver, senão nome normalizado). */
export function clienteKeyV3(os: OrdemServico | null | undefined): string {
  const id = s((os as { clienteId?: unknown } | null | undefined)?.clienteId);
  if (id) return `id:${id}`;
  const nome = s(os?.cliente?.nome).toLowerCase();
  return nome ? `nome:${nome}` : "";
}

export interface RetornosClienteV3 {
  total: number;
  abertos: number;
  ordensComRetorno: number;
}

/** Agrega retornos de TODAS as OS do mesmo cliente da OS dada. */
export function retornosDoClienteV3(ordens: OrdemServico[], os: OrdemServico | null | undefined): RetornosClienteV3 {
  const key = clienteKeyV3(os);
  let total = 0;
  let abertos = 0;
  let ordensComRetorno = 0;
  if (!key) return { total, abertos, ordensComRetorno };
  for (const o of ordens ?? []) {
    if (clienteKeyV3(o) !== key) continue;
    const list = lerRetornosV3(o);
    if (list.length > 0) ordensComRetorno += 1;
    total += list.length;
    abertos += list.filter((r) => r.status === "aberto").length;
  }
  return { total, abertos, ordensComRetorno };
}

// ----------------------------------------------------------------------------
// KPIs de pós-venda (item 8) — sem BI complexo
// ----------------------------------------------------------------------------

export interface KpisPosVendaV3 {
  garantiasAtivas: number;
  garantiasVencendo: number;
  garantiasVencidas: number;
  osEntregues: number;
  totalRetornos: number;
  retornosAbertos: number;
  osComRetorno: number;
  /** % de OS entregues que tiveram ao menos um retorno. */
  taxaRetorno: number;
}

export function kpisPosVendaV3(ordens: OrdemServico[], opts?: { vencendoDias?: number; now?: Date }): KpisPosVendaV3 {
  const now = opts?.now ?? new Date();
  const cls = classificarGarantiasV3(ordens, { vencendoDias: opts?.vencendoDias ?? 15, now });
  let osEntregues = 0;
  let totalRetornos = 0;
  let retornosAbertos = 0;
  let osComRetorno = 0;
  for (const os of ordens ?? []) {
    if (lerEntregaV3(os).entregue) osEntregues += 1;
    const list = lerRetornosV3(os);
    if (list.length > 0) osComRetorno += 1;
    totalRetornos += list.length;
    retornosAbertos += list.filter((r) => r.status === "aberto").length;
  }
  const taxaRetorno = osEntregues > 0 ? Math.round((osComRetorno / osEntregues) * 1000) / 10 : 0;
  return {
    garantiasAtivas: cls.ativas.length + cls.vencendo.length,
    garantiasVencendo: cls.vencendo.length,
    garantiasVencidas: cls.vencidas.length,
    osEntregues,
    totalRetornos,
    retornosAbertos,
    osComRetorno,
    taxaRetorno,
  };
}
