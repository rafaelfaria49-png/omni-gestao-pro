"use server";

// ============================================================================
// Operações V3 — Fase 3A · RETORNO em garantia (retrabalho/reincidência)
// ----------------------------------------------------------------------------
// Abre/finaliza um retorno VINCULADO à OS original em `payload.retornosV3[]`
// (`osOriginalId` + timeline). Quando a original já foi entregue (status final),
// também cria o atendimento novo pelo contrato existente `criarOSEnterpriseV3`
// (origem retorno/garantia) e grava o vínculo nos dois lados. Sem schema novo,
// sem Financeiro/estoque/V2.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { Prisma } from "@/generated/prisma";
import type { EventoTimeline, OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { lerEntregaV3, lerGarantiaV3, lerRetornosV3, type RetornoV3 } from "./pos-venda-model";
import { emitirEventoOperacaoV3 } from "./event-publisher";
import { criarOSEnterpriseV3 } from "./nova-os-actions";
import { validarNovaOSDraftV3 } from "./nova-os-model";
import { buildRetornoAtendimentoDraftV3 } from "./retorno-atendimento";

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
  revalidatePath("/dashboard/operacoes-v4-preview");
  return next as unknown as OrdemServico;
}

export interface AbrirRetornoV3Input {
  motivo: string;
  observacao?: string;
}

export interface AbrirRetornoV3Result {
  os: OrdemServico;
  atendimento: OrdemServico | null;
}

/** Abre um retorno em garantia vinculado à OS original. Registra motivo + timeline. */
export async function abrirRetornoV3(storeId: string, osId: string, input: AbrirRetornoV3Input): Promise<AbrirRetornoV3Result> {
  const { id, session, payload } = await carregar(storeId, osId);
  const motivo = (input.motivo ?? "").trim();
  const observacao = (input.observacao ?? "").trim() || undefined;
  if (!motivo) throw new Error("Informe o motivo do retorno.");

  const os = payload as unknown as OrdemServico;
  const existentes = lerRetornosV3(os);
  const aberto = existentes.find((retorno) => retorno.status === "aberto");
  if (aberto?.osRetornoId) {
    throw new Error("Já existe um retorno em andamento para esta OS.");
  }
  const garantia = lerGarantiaV3(os);
  const garantiaAtivaNaAbertura = garantia.situacao === "ativa";
  const operador = operadorLabel(session);
  const sid = (storeId ?? "").trim();
  const entregue = !!lerEntregaV3(os).entregue;
  const retornoId = aberto?.id ?? eventId();
  const motivoFinal = textOr(aberto?.motivo, motivo);
  const observacaoFinal = aberto?.observacao ?? observacao;

  let atendimento: OrdemServico | null = null;
  if (entregue) {
    const guardCriar = await requireEnterpriseWith(sid, (p) => p.operacoes.criarOs, "Sem permissão para abrir o atendimento de retorno.");
    if (!guardCriar.ok) throw new Error(guardCriar.error);
    const draft = buildRetornoAtendimentoDraftV3(os, {
      motivo: motivoFinal,
      observacao: observacaoFinal,
      garantiaAtiva: garantiaAtivaNaAbertura,
    });
    const invalido = validarNovaOSDraftV3(draft);
    if (invalido) throw new Error(invalido);
    const criado = await criarOSEnterpriseV3(sid, draft, {
      tags: ["retorno-garantia", `origem:${os.codigo ?? id}`],
      vinculoRetornoV3: {
        osOrigemId: id,
        osOrigemCodigo: os.codigo ?? undefined,
        retornoId,
        motivo: motivoFinal,
        garantiaAtivaNaAbertura,
      },
    });
    const avisoNova = garantiaAtivaNaAbertura ? "" : " (garantia expirada/não ativa na abertura)";
    const tlNova = Array.isArray(criado.os.timeline) ? criado.os.timeline : [];
    atendimento = await gravar(criado.os.id, {
      ...(criado.os as OSPayloadFull),
      timeline: [
        ...tlNova,
        makeEvento(
          "garantia_acionada",
          operador,
          `Atendimento de retorno da OS ${os.codigo ?? id}. Motivo: ${motivoFinal}${avisoNova}`,
          { osOriginalId: id, osOriginalCodigo: os.codigo, retornoId, motivo: motivoFinal },
        ),
      ],
      atualizadoEm: nowIso(),
    });
  } else if (aberto) {
    throw new Error("Já existe um retorno em andamento para esta OS.");
  }

  const retorno: RetornoV3 = {
    id: retornoId,
    osOriginalId: id,
    osOriginalCodigo: os.codigo ?? undefined,
    motivo: motivoFinal,
    observacao: observacaoFinal,
    criadoEm: aberto?.criadoEm ?? nowIso(),
    criadoPor: aberto?.criadoPor ?? operador,
    status: "aberto",
    garantiaAtivaNaAbertura,
    osRetornoId: atendimento?.id,
    osRetornoCodigo: atendimento?.codigo,
  };
  const retornos = aberto ? existentes.map((item) => (item.id === retornoId ? retorno : item)) : [...existentes, retorno];

  const aviso = garantiaAtivaNaAbertura ? "" : " (garantia expirada/não ativa na abertura)";
  const vinculoTxt = atendimento?.codigo ? ` Atendimento ${atendimento.codigo} aberto.` : "";
  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const evento = aberto
    ? null
    : makeEvento(
        "garantia_acionada",
        operador,
        `Retorno em garantia aberto: ${motivoFinal}${aviso}.${vinculoTxt}`,
        {
          retornoId: retorno.id,
          motivo: motivoFinal,
          observacao: observacaoFinal,
          garantiaAtivaNaAbertura,
          osOriginalId: id,
          osRetornoId: atendimento?.id,
          osRetornoCodigo: atendimento?.codigo,
        },
      );

  const next: OSPayloadFull = {
    ...payload,
    retornosV3: retornos,
    timeline: evento ? [...timeline, evento] : timeline,
    atualizadoEm: nowIso(),
  } as OSPayloadFull;
  const salva = await gravar(id, next);

  if (!aberto) {
    emitirEventoOperacaoV3({
      tipo: "os_retorno_aberto",
      os: salva,
      storeId: sid,
      origem: "retorno",
      metadata: {
        retornoId: retorno.id,
        motivo: motivoFinal,
        garantiaAtivaNaAbertura,
        osRetornoId: atendimento?.id,
        osRetornoCodigo: atendimento?.codigo,
      },
    });
  }
  return { os: salva, atendimento };
}

function textOr(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
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
