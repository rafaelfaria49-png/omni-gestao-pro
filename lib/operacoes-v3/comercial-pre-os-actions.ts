"use server";

// ============================================================================
// Operações V3 — carimbo comercial pré-OS (GOAL OPS-V4-NOVO-ATENDIMENTO-COMERCIAL-001).
// Payload-only. Sem schema, sem Financeiro, sem estoque. Reusa o mesmo
// write-path de dados-basicos-actions (Prisma direto, sem updateOSPayload).
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import type { EventoTimeline, OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import type { ComercialV4, StatusComercialOrcamentoV4 } from "@/lib/operacoes-v4/orcamento-pre-os";
import { lerComercialV4 } from "@/lib/operacoes-v4/orcamento-pre-os";

type OSPayloadFull = OrdemServico & Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}
function eventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev_${Date.now()}`;
}
function operadorLabel(): string {
  return "Operador";
}

async function carregar(storeId: string, osId: string): Promise<{ id: string; payload: OSPayloadFull; autor: string }> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");
  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para editar o orçamento.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para editar esta OS.");
  if (!guard.ok) throw new Error(guard.error);
  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");
  const autor = (session.user.name || session.user.email || operadorLabel()).trim() || operadorLabel();
  return { id, payload, autor };
}

async function gravar(id: string, next: OSPayloadFull): Promise<OrdemServico> {
  const data: Prisma.OrdemServicoUpdateInput = { payload: next as unknown as Prisma.InputJsonValue };
  await prisma.ordemServico.update({ where: { id }, data });
  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");
  return next as unknown as OrdemServico;
}

export interface MarcarPreOsInputV3 {
  origemAtendimento?: string;
  validadeDias?: number;
  prazoEstimado?: string;
  observacaoCliente?: string;
  observacaoInterna?: string;
  diagnosticoInicial?: ComercialV4["diagnosticoInicial"];
  aparelho?: { tipo?: string; imei?: string; cor?: string };
  statusComercial?: StatusComercialOrcamentoV4;
}

export async function marcarOrcamentoPreOsV3(storeId: string, osId: string, input: MarcarPreOsInputV3 = {}): Promise<OrdemServico> {
  const { id, payload, autor } = await carregar(storeId, osId);
  const atual = lerComercialV4(payload);
  if (atual?.statusComercial === "convertido") return payload as unknown as OrdemServico;

  const comercialV4: ComercialV4 = {
    tipo: "orcamento_pre_os",
    statusComercial: input.statusComercial ?? atual?.statusComercial ?? "rascunho",
    origemAtendimento: input.origemAtendimento ?? atual?.origemAtendimento,
    validadeDias: input.validadeDias ?? atual?.validadeDias,
    prazoEstimado: input.prazoEstimado ?? atual?.prazoEstimado,
    observacaoCliente: input.observacaoCliente ?? atual?.observacaoCliente,
    observacaoInterna: input.observacaoInterna ?? atual?.observacaoInterna,
    diagnosticoInicial: input.diagnosticoInicial ?? atual?.diagnosticoInicial,
    opcaoAprovadaId: atual?.opcaoAprovadaId,
    opcaoAprovadaRotulo: atual?.opcaoAprovadaRotulo,
    convertidoEm: atual?.convertidoEm,
    convertidoPor: atual?.convertidoPor,
  };

  const equipamentoAtual = payload.equipamento && typeof payload.equipamento === "object"
    ? (payload.equipamento as unknown as Record<string, unknown>)
    : {};
  const equipamento = {
    ...equipamentoAtual,
    ...(input.aparelho?.tipo ? { tipo: input.aparelho.tipo } : {}),
    ...(input.aparelho?.imei ? { numeroSerie: input.aparelho.imei } : {}),
    ...(input.aparelho?.cor ? { cor: input.aparelho.cor } : {}),
  };

  const evento: EventoTimeline = {
    id: eventId(),
    tipo: "observacao",
    autor,
    autorTipo: "usuario",
    conteudo: "Orçamento comercial classificado como pré-OS.",
    metadata: { evento: "orcamento_pre_os" },
    criadoEm: nowIso(),
  };
  const timeline: EventoTimeline[] = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];

  const next = { ...payload, comercialV4, equipamento, timeline: [...timeline, evento], atualizadoEm: nowIso() } as unknown as OSPayloadFull;
  return gravar(id, next);
}

export async function atualizarStatusComercialV3(
  storeId: string,
  osId: string,
  statusComercial: StatusComercialOrcamentoV4,
  extra: Partial<ComercialV4> = {},
): Promise<OrdemServico> {
  const { id, payload, autor } = await carregar(storeId, osId);
  const atual = lerComercialV4(payload);
  if (!atual || atual.tipo !== "orcamento_pre_os") {
    throw new Error("Este registro não é um orçamento pré-OS.");
  }
  if (atual.statusComercial === "convertido") return payload as unknown as OrdemServico;

  const comercialV4: ComercialV4 = { ...atual, ...extra, tipo: "orcamento_pre_os", statusComercial };
  const evento: EventoTimeline = {
    id: eventId(),
    tipo: "observacao",
    autor,
    autorTipo: "usuario",
    conteudo: `Status comercial do orçamento: ${statusComercial}.`,
    metadata: { evento: "status_comercial", statusComercial },
    criadoEm: nowIso(),
  };
  const timeline: EventoTimeline[] = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next = { ...payload, comercialV4, timeline: [...timeline, evento], atualizadoEm: nowIso() } as OSPayloadFull;
  return gravar(id, next);
}

export interface ConverterOrcamentoInputV3 {
  prioridade?: string;
  localFisico?: string;
  previsaoEntrega?: string;
  recebidoPor?: string;
}

/**
 * Promove o MESMO registro (sem duplicar OS). Idempotente: se já convertido, devolve.
 */
export async function converterOrcamentoEmOSV3(
  storeId: string,
  osId: string,
  input: ConverterOrcamentoInputV3 = {},
): Promise<{ osId: string; jaConvertido: boolean }> {
  const { id, payload, autor } = await carregar(storeId, osId);
  const atual = lerComercialV4(payload);
  if (atual?.statusComercial === "convertido") {
    return { osId: id, jaConvertido: true };
  }
  if (!atual || atual.tipo !== "orcamento_pre_os") {
    throw new Error("Só é possível converter um orçamento pré-OS.");
  }
  const orc = payload.orcamento && typeof payload.orcamento === "object"
    ? (payload.orcamento as { status?: string })
    : null;
  if (atual.statusComercial !== "aprovado" && orc?.status !== "aprovado") {
    throw new Error("Aprove o orçamento (e a opção escolhida) antes de converter em OS.");
  }

  const aberturaAtual = payload.aberturaV3 && typeof payload.aberturaV3 === "object"
    ? (payload.aberturaV3 as Record<string, unknown>)
    : {};
  const recepcaoAtual = aberturaAtual.recepcao && typeof aberturaAtual.recepcao === "object"
    ? (aberturaAtual.recepcao as Record<string, unknown>)
    : {};
  const aberturaV3 = {
    ...aberturaAtual,
    recepcao: {
      ...recepcaoAtual,
      ...(input.prioridade ? { prioridade: input.prioridade } : {}),
      ...(input.localFisico ? { localFisico: input.localFisico } : {}),
      ...(input.previsaoEntrega ? { previsaoEntrega: input.previsaoEntrega } : {}),
      ...(input.recebidoPor ? { recebidoPor: input.recebidoPor } : {}),
    },
  };
  const comercialV4: ComercialV4 = {
    ...atual,
    tipo: "orcamento_pre_os",
    statusComercial: "convertido",
    convertidoEm: nowIso(),
    convertidoPor: autor,
  };
  const evento: EventoTimeline = {
    id: eventId(),
    tipo: "observacao",
    autor,
    autorTipo: "usuario",
    conteudo: "Orçamento convertido em Ordem de Serviço (mesmo registro).",
    metadata: { evento: "orcamento_convertido_os" },
    criadoEm: nowIso(),
  };
  const timeline: EventoTimeline[] = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next = {
    ...payload,
    comercialV4,
    aberturaV3,
    timeline: [...timeline, evento],
    atualizadoEm: nowIso(),
  } as OSPayloadFull;
  await gravar(id, next);
  return { osId: id, jaConvertido: false };
}
