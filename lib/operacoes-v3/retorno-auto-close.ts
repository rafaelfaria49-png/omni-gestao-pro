// ============================================================================
// Operações V3 — auto-close do retorno original na entrega da OS vinculada.
// ----------------------------------------------------------------------------
// Puro (sem I/O). Decide se o vínculo filho→original é inequívoco e aplica a
// finalização no payload. Replay não duplica evento nem reabre/refecha.
// ============================================================================

import type { EventoTimeline, OrdemServico } from "@/types/os";
import { lerRetornosV3, lerVinculoRetornoV3, type RetornoV3, type VinculoRetornoV3 } from "./pos-venda-model";

export type AutoCloseSkipMotivo =
  | "sem_vinculo"
  | "vinculo_incompleto"
  | "auto_referencia"
  | "retorno_ausente"
  | "vinculo_divergente";

export type AutoCloseResolucaoV3 =
  | { ok: false; motivo: AutoCloseSkipMotivo }
  | { ok: true; vinculo: VinculoRetornoV3; retorno: RetornoV3; jaFinalizado: boolean };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meta(evento: EventoTimeline | null | undefined): Record<string, unknown> {
  return evento?.metadata && typeof evento.metadata === "object" ? (evento.metadata as Record<string, unknown>) : {};
}

export function timelineTemAutoCloseOriginalV3(
  timeline: EventoTimeline[] | undefined,
  retornoId: string,
  osFilhaId: string,
): boolean {
  const rid = text(retornoId);
  const filha = text(osFilhaId);
  if (!rid || !filha) return false;
  return (timeline ?? []).some((evento) => {
    const m = meta(evento);
    return (
      text(m.evento) === "retorno_finalizado" &&
      text(m.origem) === "entrega_vinculada" &&
      text(m.retornoId) === rid &&
      text(m.osRetornoId) === filha
    );
  });
}

export function timelineTemAutoCloseFilhaV3(
  timeline: EventoTimeline[] | undefined,
  osOrigemId: string,
  retornoId: string,
): boolean {
  const origem = text(osOrigemId);
  const rid = text(retornoId);
  if (!origem || !rid) return false;
  return (timeline ?? []).some((evento) => {
    const m = meta(evento);
    return text(m.evento) === "retorno_origem_finalizado" && text(m.osOrigemId) === origem && text(m.retornoId) === rid;
  });
}

/** Só fecha quando o vínculo é inequívoco nos dois lados. */
export function resolverRetornoParaAutoCloseV3(
  osFilha: OrdemServico | null | undefined,
  osOriginal: OrdemServico | null | undefined,
): AutoCloseResolucaoV3 {
  const filhaId = text(osFilha?.id);
  const vinculo = lerVinculoRetornoV3(osFilha);
  if (!filhaId || !vinculo) return { ok: false, motivo: "sem_vinculo" };

  const osOrigemId = text(vinculo.osOrigemId);
  const retornoId = text(vinculo.retornoId);
  if (!osOrigemId || !retornoId) return { ok: false, motivo: "vinculo_incompleto" };
  if (osOrigemId === filhaId) return { ok: false, motivo: "auto_referencia" };

  const originalId = text(osOriginal?.id);
  if (!originalId || originalId !== osOrigemId) return { ok: false, motivo: "vinculo_divergente" };

  const originalCodigo = text(osOriginal?.codigo);
  const origemCodigo = text(vinculo.osOrigemCodigo);
  if (originalCodigo && origemCodigo && originalCodigo !== origemCodigo) {
    return { ok: false, motivo: "vinculo_divergente" };
  }

  const alvos = lerRetornosV3(osOriginal).filter((retorno) => retorno.id === retornoId);
  if (alvos.length === 0) return { ok: false, motivo: "retorno_ausente" };
  if (alvos.length !== 1) return { ok: false, motivo: "vinculo_divergente" };

  const retorno = alvos[0]!;
  const osRetornoId = text(retorno.osRetornoId);
  if (!osRetornoId || osRetornoId !== filhaId) return { ok: false, motivo: "vinculo_divergente" };

  const filhaCodigo = text(osFilha?.codigo);
  const osRetornoCodigo = text(retorno.osRetornoCodigo);
  if (filhaCodigo && osRetornoCodigo && filhaCodigo !== osRetornoCodigo) {
    return { ok: false, motivo: "vinculo_divergente" };
  }

  return { ok: true, vinculo, retorno, jaFinalizado: retorno.status === "finalizado" };
}

export interface AutoCloseApplyInputV3 {
  operador: string;
  agora: string;
}

export function aplicarAutoCloseOriginalV3(
  osOriginal: OrdemServico,
  osFilha: OrdemServico,
  input: AutoCloseApplyInputV3,
): { next: OrdemServico; changed: boolean; evento?: EventoTimeline } {
  const resolucao = resolverRetornoParaAutoCloseV3(osFilha, osOriginal);
  if (!resolucao.ok || resolucao.jaFinalizado) return { next: osOriginal, changed: false };

  const filhaId = text(osFilha.id);
  const timeline = Array.isArray(osOriginal.timeline) ? osOriginal.timeline : [];
  if (timelineTemAutoCloseOriginalV3(timeline, resolucao.retorno.id, filhaId)) {
    return { next: osOriginal, changed: false };
  }

  const codigoFilha = text(osFilha.codigo) || filhaId;
  const observacaoFinal = `Finalizado automaticamente na entrega do atendimento ${codigoFilha}.`;
  const retornos = lerRetornosV3(osOriginal).map((retorno) =>
    retorno.id === resolucao.retorno.id
      ? {
          ...retorno,
          status: "finalizado" as const,
          finalizadoEm: input.agora,
          finalizadoPor: input.operador,
          observacaoFinal,
        }
      : retorno,
  );
  const evento: EventoTimeline = {
    id: `ret-close-${resolucao.retorno.id}-${filhaId}`,
    tipo: "observacao",
    autor: input.operador,
    autorTipo: "usuario",
    conteudo: `Retorno finalizado pela entrega do atendimento ${codigoFilha}.`,
    metadata: {
      evento: "retorno_finalizado",
      origem: "entrega_vinculada",
      retornoId: resolucao.retorno.id,
      osRetornoId: filhaId,
      osRetornoCodigo: text(osFilha.codigo) || undefined,
      motivo: resolucao.retorno.motivo,
    },
    criadoEm: input.agora,
  };

  return {
    next: {
      ...osOriginal,
      retornosV3: retornos,
      timeline: [...timeline, evento],
      atualizadoEm: input.agora,
    } as OrdemServico,
    changed: true,
    evento,
  };
}

export function aplicarAuditoriaFilhaAutoCloseV3(
  osFilha: OrdemServico,
  input: { osOrigemId: string; osOrigemCodigo?: string; retornoId: string; operador: string; agora: string },
): { next: OrdemServico; changed: boolean } {
  const timeline = Array.isArray(osFilha.timeline) ? osFilha.timeline : [];
  if (timelineTemAutoCloseFilhaV3(timeline, input.osOrigemId, input.retornoId)) {
    return { next: osFilha, changed: false };
  }

  const codigoOrigem = text(input.osOrigemCodigo) || input.osOrigemId;
  const vinculo = lerVinculoRetornoV3(osFilha);
  const evento: EventoTimeline = {
    id: `ret-src-close-${input.retornoId}-${input.osOrigemId}`,
    tipo: "observacao",
    autor: input.operador,
    autorTipo: "usuario",
    conteudo: `Retorno da OS ${codigoOrigem} finalizado por esta entrega.`,
    metadata: {
      evento: "retorno_origem_finalizado",
      origem: "entrega_vinculada",
      osOrigemId: input.osOrigemId,
      osOrigemCodigo: text(input.osOrigemCodigo) || undefined,
      retornoId: input.retornoId,
    },
    criadoEm: input.agora,
  };

  return {
    next: {
      ...osFilha,
      vinculoRetornoV3: {
        ...(vinculo ?? { osOrigemId: input.osOrigemId }),
        osOrigemId: input.osOrigemId,
        osOrigemCodigo: text(input.osOrigemCodigo) || vinculo?.osOrigemCodigo,
        retornoId: input.retornoId,
        finalizadoEm: input.agora,
        finalizadoPorEntrega: true,
      },
      timeline: [...timeline, evento],
      atualizadoEm: input.agora,
    } as OrdemServico,
    changed: true,
  };
}
