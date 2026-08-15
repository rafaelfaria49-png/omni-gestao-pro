"use server";

// ============================================================================
// Operações V3 — Fase 3A · RETORNO em garantia (retrabalho/reincidência)
// ----------------------------------------------------------------------------
// Abre/finaliza um retorno VINCULADO à OS original. O retorno é um registro
// embutido em `payload.retornosV3[]` (sem schema, sem nova entidade/linha de OS),
// carregando o vínculo `osOriginalId`. Cada ação grava timeline na OS (auditável).
// NÃO toca Financeiro/estoque/V2/schema.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { Prisma } from "@/generated/prisma";
import type { EventoTimeline, OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { lerGarantiaV3, lerRetornosV3, type RetornoV3 } from "./pos-venda-model";
import { emitirEventoOperacaoV3 } from "./event-publisher";

type OSPayloadFull = OrdemServico & Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}
function eventId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev_${Date.now()}`;
}
function operadorLabel(session: Session | null): string {
  const u = session?.user;
  return (u?.name || u?.email || "Você").trim() || "Você";
}
function makeEvento(tipo: EventoTimeline["tipo"], autor: string, conteudo: string, metadata?: Record<string, unknown>): EventoTimeline {
  return { id: eventId(), tipo, autor, autorTipo: "usuario", conteudo, metadata, criadoEm: nowIso() };
}

async function carregar(storeId: string, osId: string): Promise<{ id: string; session: Session | null; payload: OSPayloadFull }> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");
  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para gerenciar retornos.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para gerenciar retornos desta OS.");
  if (!guard.ok) throw new Error(guard.error);
  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");
  return { id, session, payload };
}

async function gravar(id: string, next: OSPayloadFull): Promise<OrdemServico> {
  await prisma.ordemServico.update({ where: { id }, data: { payload: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/dashboard/operacoes-v3");
  return next as unknown as OrdemServico;
}

/** Abre um retorno em garantia vinculado à OS original. Registra motivo + timeline. */
export async function abrirRetornoV3(storeId: string, osId: string, input: { motivo: string }): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const motivo = (input.motivo ?? "").trim();
  if (!motivo) throw new Error("Informe o motivo do retorno.");

  const os = payload as unknown as OrdemServico;
  const existentes = lerRetornosV3(os);
  if (existentes.some((retorno) => retorno.status === "aberto")) {
    throw new Error("Já existe um retorno em andamento para esta OS.");
  }
  const garantia = lerGarantiaV3(os);
  const garantiaAtivaNaAbertura = garantia.situacao === "ativa";
  const operador = operadorLabel(session);

  const retorno: RetornoV3 = {
    id: eventId(),
    osOriginalId: id,
    osOriginalCodigo: os.codigo ?? undefined,
    motivo,
    criadoEm: nowIso(),
    criadoPor: operador,
    status: "aberto",
    garantiaAtivaNaAbertura,
  };
  const retornos = [...existentes, retorno];

  const aviso = garantiaAtivaNaAbertura ? "" : " (garantia expirada/não ativa na abertura)";
  const evento = makeEvento(
    "garantia_acionada",
    operador,
    `Retorno em garantia aberto: ${motivo}${aviso}.`,
    { retornoId: retorno.id, motivo, garantiaAtivaNaAbertura, osOriginalId: id },
  );

  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next: OSPayloadFull = { ...payload, retornosV3: retornos, timeline: [...timeline, evento], atualizadoEm: nowIso() } as OSPayloadFull;
  const salva = await gravar(id, next);

  // Espinha de eventos (3C.0): retorno em garantia aberto.
  emitirEventoOperacaoV3({
    tipo: "os_retorno_aberto",
    os: salva,
    storeId: (storeId ?? "").trim(),
    origem: "retorno",
    metadata: { retornoId: retorno.id, motivo, garantiaAtivaNaAbertura },
  });
  return salva;
}

/** Finaliza um retorno (conclui o retrabalho). Registra observação + timeline. */
export async function finalizarRetornoV3(storeId: string, osId: string, retornoId: string, input: { observacao?: string } = {}): Promise<OrdemServico> {
  const { id, session, payload } = await carregar(storeId, osId);
  const rid = (retornoId ?? "").trim();
  if (!rid) throw new Error("Retorno não informado.");

  const lista = lerRetornosV3(payload as unknown as OrdemServico);
  const alvo = lista.find((r) => r.id === rid);
  if (!alvo) throw new Error("Retorno não encontrado nesta OS.");
  if (alvo.status === "finalizado") throw new Error("Este retorno já está finalizado.");

  const operador = operadorLabel(session);
  const observacao = (input.observacao ?? "").trim() || undefined;
  const now = nowIso();

  const retornos = lista.map((r) =>
    r.id === rid ? { ...r, status: "finalizado" as const, finalizadoEm: now, finalizadoPor: operador, observacaoFinal: observacao } : r,
  );

  const evento = makeEvento(
    "observacao",
    operador,
    `Retorno finalizado.${observacao ? " " + observacao : ""}`,
    { retornoId: rid, evento: "retorno_finalizado", motivo: alvo.motivo },
  );

  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next: OSPayloadFull = { ...payload, retornosV3: retornos, timeline: [...timeline, evento], atualizadoEm: now } as OSPayloadFull;
  const salva = await gravar(id, next);

  // Espinha de eventos (3C.0): retorno concluído.
  emitirEventoOperacaoV3({
    tipo: "os_retorno_finalizado",
    os: salva,
    storeId: (storeId ?? "").trim(),
    origem: "retorno",
    metadata: { retornoId: rid, motivo: alvo.motivo },
  });
  return salva;
}
