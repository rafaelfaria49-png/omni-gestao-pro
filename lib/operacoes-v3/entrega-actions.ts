"use server";

// ============================================================================
// Operações V3 — Fase 3A · ENTREGA da OS (finalização PRONTA/RECEBIDA → ENTREGUE)
// ----------------------------------------------------------------------------
// Registra a entrega formal do equipamento: data/hora + operador + observação +
// quem retirou. Grava SOMENTE o payload (status entregue + entregaV3 + retirada +
// timeline). Antes de qualquer write, relê OS + Conta a Receber e aplica o guard
// financeiro fail-closed. Não altera Financeiro/V2/schema; a baixa de estoque
// idempotente continua ocorrendo somente depois da entrega persistida.
//
// Usa a MÁQUINA ÚNICA (status-machine) como fonte das REGRAS de status. A entrega
// aceita "pronta" ou "recebida" e finaliza em "entregue"; quando vem de "pronta",
// registra na timeline a passagem implícita por "recebida" (PRONTA→RECEBIDA→ENTREGUE).
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { Prisma } from "@/generated/prisma";
import type { EventoTimeline, OrdemServico } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { operacaoStatusToPrismaStatus } from "@/components/operacoes/lovable/utils/os-status";
import { projetarStatusV2, statusV3FromOS } from "./status-machine";
import { emitirEventoOperacaoV3 } from "./event-publisher";
import { consumirEstoqueOSV3 } from "./estoque-sync";
import { bytesDeDataUrlV3, validarAssinaturaV3, validarFotoEntradaV3 } from "./prova-entrada-model";
import { lerFotosSaidaV3, type CategoriaFotoSaidaV3, type FotoSaidaV3 } from "./pos-venda-model";
import {
  autorizadaParaEntregaFinanceiraV3,
  criarAutorizacaoEntregaSemCobrancaV3,
  mensagemBloqueioEntregaFinanceiraV3,
  projetarEntregaFinanceiraV3,
  type EntregaSemCobrancaSolicitacaoV3,
  type EntregaSemCobrancaV3,
} from "./delivery-financial-guard";
import { localKeyContaReceberOSV3 } from "./payment-model";
import { finalizarRetornoPorEntregaVinculadaV3 } from "./retorno-auto-close-actions";

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

export interface RegistrarEntregaInputV3 {
  /** Quem retirou o aparelho (cliente/portador). Default: nome do cliente. */
  recebidoPor?: string;
  observacao?: string;
  /** Assinatura digital de retirada (data URL PNG) — SPRINT_3E.2. */
  assinaturaRetirada?: string;
  /** Solicitação do operador; ator, loja e horário são sempre derivados no servidor. */
  semCobranca?: EntregaSemCobrancaSolicitacaoV3;
}

export async function registrarEntregaV3(storeId: string, osId: string, input: RegistrarEntregaInputV3 = {}): Promise<OrdemServico> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para registrar a entrega.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.entregarOs, "Sem permissão para entregar esta OS.");
  if (!guard.ok) throw new Error(guard.error);

  const row = await prisma.ordemServico.findFirst({
    where: { id, storeId: sid },
    select: { id: true, payload: true, valorTotal: true },
  });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");

  const from = statusV3FromOS(payload);
  // Idempotência (SPRINT_3D.2): entrega já registrada → NO-OP. Não re-executa
  // entrega/garantia/estoque/evento; devolve o estado atual. Isso torna seguro o
  // caminho unificado (Kanban/Command Bar/PDV/PosVenda) contra duplo-clique e
  // chamadas concorrentes de superfícies diferentes — efeitos rodam UMA vez.
  if (from === "entregue") {
    await finalizarRetornoPorEntregaVinculadaV3({
      storeId: sid,
      osFilha: { ...(payload as unknown as OrdemServico), id },
      operador: operadorLabel(session),
    });
    return payload as unknown as OrdemServico;
  }
  if (from !== "pronta" && from !== "recebida") {
    throw new Error("A OS precisa estar Pronta ou Recebida para registrar a entrega.");
  }

  const operador = operadorLabel(session);
  const recebidoPor = (input.recebidoPor ?? "").trim() || (payload as unknown as OrdemServico).cliente?.nome || "Cliente";
  const observacao = (input.observacao ?? "").trim() || undefined;
  const now = nowIso();

  // P0: a decisão financeira é refeita no servidor imediatamente antes do
  // primeiro efeito de entrega. Ator, loja e horário nunca vêm do navegador.
  const autorizacaoSolicitada = input.semCobranca
    ? criarAutorizacaoEntregaSemCobrancaV3({
        solicitacao: input.semCobranca,
        storeId: sid,
        autorizadoPorId: session.user.id,
        autorizadoPorNome: operador,
        autorizadoEm: now,
      })
    : null;
  const payloadParaGuard: OSPayloadFull = autorizacaoSolicitada
    ? { ...payload, entregaSemCobrancaV3: autorizacaoSolicitada }
    : payload;

  let titulo: Awaited<ReturnType<typeof prisma.contaReceberTitulo.findUnique>> = null;
  let falhaLeituraTitulo = false;
  try {
    titulo = await prisma.contaReceberTitulo.findUnique({
      where: { storeId_localKey: { storeId: sid, localKey: localKeyContaReceberOSV3(sid, id) } },
    });
  } catch {
    falhaLeituraTitulo = true;
  }

  const projecaoFinanceira = projetarEntregaFinanceiraV3({
    storeId: sid,
    osId: id,
    payload: payloadParaGuard,
    prismaValorTotal: Number(row.valorTotal ?? 0),
    titulo,
    falhaLeituraTitulo,
  });
  if (!autorizadaParaEntregaFinanceiraV3(projecaoFinanceira.decisao)) {
    throw new Error(mensagemBloqueioEntregaFinanceiraV3(projecaoFinanceira.decisao));
  }

  const autorizacaoSemCobranca =
    projecaoFinanceira.decisao === "ALLOW_AUTHORIZED_NO_CHARGE"
      ? ({
          ...((autorizacaoSolicitada ?? payload.entregaSemCobrancaV3) as EntregaSemCobrancaV3),
          snapshotFinanceiro: {
            totalEsperado: projecaoFinanceira.totalEsperado,
            origensTotal: projecaoFinanceira.origensTotal,
            tituloEncontrado: projecaoFinanceira.tituloEncontrado,
            tituloLocalKey: titulo?.localKey ?? undefined,
            valorTitulo: projecaoFinanceira.valorTitulo,
            totalRecebido: projecaoFinanceira.totalRecebido,
            saldo: projecaoFinanceira.saldo,
            decisao: "ALLOW_AUTHORIZED_NO_CHARGE",
          },
        } satisfies EntregaSemCobrancaV3)
      : null;

  // Assinatura de retirada (opcional) — validada e embarcada no entregaV3.
  const assinaturaInput = (input.assinaturaRetirada ?? "").trim();
  const assinaturaRetirada = assinaturaInput && validarAssinaturaV3(assinaturaInput).ok ? assinaturaInput : undefined;

  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const eventos: EventoTimeline[] = [];
  // Passagem implícita por RECEBIDA quando a entrega parte de PRONTA (auditável).
  if (from === "pronta") {
    eventos.push(makeEvento("mudanca_status", operador, 'Status alterado para "Recebida".', { de: "pronta", para: "recebida", engine: "operacoes-v3", origem: "entrega" }));
  }
  if (autorizacaoSemCobranca) {
    eventos.push(
      makeEvento("observacao", operador, `Entrega sem cobrança autorizada (${autorizacaoSemCobranca.categoria}): ${autorizacaoSemCobranca.motivo}`, {
        evento: "entrega_sem_cobranca_autorizada",
        categoria: autorizacaoSemCobranca.categoria,
        motivo: autorizacaoSemCobranca.motivo,
        autorizadoPorId: autorizacaoSemCobranca.autorizadoPorId,
        autorizadoEm: autorizacaoSemCobranca.autorizadoEm,
        entregaSemCobranca: true,
      }),
    );
  }
  eventos.push(
    makeEvento("entrega_cliente", operador, `Equipamento entregue a ${recebidoPor}.${observacao ? " Obs.: " + observacao : ""}`, {
      de: from === "pronta" ? "recebida" : from,
      para: "entregue",
      recebidoPor,
      observacao,
      decisaoFinanceira: projecaoFinanceira.decisao,
      entregaSemCobranca: !!autorizacaoSemCobranca,
    }),
  );
  if (assinaturaRetirada) {
    eventos.push(makeEvento("observacao", operador, "Assinatura de retirada capturada.", { evento: "assinatura_retirada_capturada" }));
  }

  const prevEntrega =
    payload.entregaV3 && typeof payload.entregaV3 === "object" ? (payload.entregaV3 as Record<string, unknown>) : {};
  const next: OSPayloadFull = {
    ...payload,
    operacaoStatusV3: "entregue",
    operacaoStatus: projetarStatusV2("entregue"),
    status: projetarStatusV2("entregue"),
    entregueEm: now,
    retirada: { confirmado: true, retiradoPor: recebidoPor, retiradoEm: now, observacao },
    entregaV3: {
      ...prevEntrega,
      entregueEm: now,
      entreguePor: operador,
      recebidoPor,
      observacao,
      ...(assinaturaRetirada ? { assinaturaRetirada: { dataUrl: assinaturaRetirada, criadoEm: now, por: recebidoPor } } : {}),
    },
    ...(autorizacaoSemCobranca ? { entregaSemCobrancaV3: autorizacaoSemCobranca } : {}),
    timeline: [...timeline, ...eventos],
    atualizadoEm: now,
  } as OSPayloadFull;

  await prisma.ordemServico.update({
    where: { id },
    data: {
      status: operacaoStatusToPrismaStatus(projetarStatusV2("entregue")),
      payload: next as unknown as Prisma.InputJsonValue,
    },
  });

  // SPRINT_3D.1 — baixa REAL de estoque ao entregar, via adapter oficial
  // (`consumeEstoqueFromOS`). Idempotente (não baixa a mesma OS duas vezes) e
  // best-effort: uma falha NÃO desfaz a entrega — vira `estoque_sync_erro` na
  // timeline. Passa o payload pós-entrega (com id/storeId garantidos) para o
  // adapter resolver as peças do orçamento/`payload.pecas`.
  const estoque = await consumirEstoqueOSV3({
    storeId: sid,
    osId: id,
    osPayload: { ...(next as unknown as OrdemServico), id, storeId: sid },
    operador,
  });

  // Espinha de eventos (3C.0): entrega formal do equipamento. Este é o ÚNICO
  // caminho canônico de "entregue" (SPRINT_3D.2) — a máquina de status delega a
  // transição "entregue" para cá, então `os_entregue` é emitido uma única vez.
  emitirEventoOperacaoV3({
    tipo: "os_entregue",
    os: next as unknown as OrdemServico,
    storeId: sid,
    origem: "entrega",
    metadata: {
      de: from,
      recebidoPor,
      viaEntregaFormal: true,
      decisaoFinanceira: projecaoFinanceira.decisao,
      entregaSemCobranca: !!autorizacaoSemCobranca,
      estoque: estoque.status,
      estoqueItens: estoque.itens,
    },
  });

  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");

  await finalizarRetornoPorEntregaVinculadaV3({
    storeId: sid,
    osFilha: { ...(next as unknown as OrdemServico), id, storeId: sid },
    operador,
  });

  return next as unknown as OrdemServico;
}

/**
 * SPRINT_3E.2 — captura/atualiza a assinatura de retirada APÓS a entrega já
 * registrada (caso não tenha sido assinada no momento). Só atualiza `entregaV3`
 * + timeline; não muda status/estoque.
 */
export async function salvarAssinaturaRetiradaV3(storeId: string, osId: string, dataUrl: string, por?: string): Promise<OrdemServico> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para registrar a assinatura.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.entregarOs, "Sem permissão para registrar a assinatura de retirada.");
  if (!guard.ok) throw new Error(guard.error);

  const veredito = validarAssinaturaV3(dataUrl ?? "");
  if (!veredito.ok) throw new Error(veredito.motivo ?? "Assinatura inválida.");

  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");

  if (statusV3FromOS(payload) !== "entregue") {
    throw new Error("A assinatura de retirada só pode ser registrada após a entrega.");
  }

  const now = nowIso();
  const operador = operadorLabel(session);
  const entregaV3 = (payload.entregaV3 && typeof payload.entregaV3 === "object" ? payload.entregaV3 : {}) as Record<string, unknown>;
  const recebidoPor =
    (por ?? "").trim() || (typeof entregaV3.recebidoPor === "string" ? entregaV3.recebidoPor : "") || (payload as unknown as OrdemServico).cliente?.nome || "Cliente";
  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next: OSPayloadFull = {
    ...payload,
    entregaV3: { ...entregaV3, assinaturaRetirada: { dataUrl: dataUrl.trim(), criadoEm: now, por: recebidoPor } },
    timeline: [...timeline, makeEvento("observacao", operador, "Assinatura de retirada capturada.", { evento: "assinatura_retirada_capturada" })],
    atualizadoEm: now,
  } as OSPayloadFull;

  await prisma.ordemServico.update({ where: { id }, data: { payload: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");
  return next as unknown as OrdemServico;
}

function fotoSaidaId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `foto_${crypto.randomUUID()}` : `foto_${Date.now()}`;
}

export interface AdicionarFotoSaidaInputV3 {
  categoria?: CategoriaFotoSaidaV3;
  nome?: string;
  dataUrl: string;
}

/** Persiste foto de saída em `entregaV3.fotosSaida` (mesmo downscale/limites da prova de entrada). */
export async function adicionarFotoSaidaV3(
  storeId: string,
  osId: string,
  input: AdicionarFotoSaidaInputV3,
): Promise<OrdemServico> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para registrar a foto de saída.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para editar esta OS.");
  if (!guard.ok) throw new Error(guard.error);

  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");
  if (statusV3FromOS(payload) === "cancelada") {
    throw new Error("Não é possível adicionar foto de saída em OS cancelada.");
  }

  const atuais = lerFotosSaidaV3(payload as unknown as OrdemServico);
  const veredito = validarFotoEntradaV3(input?.dataUrl ?? "", atuais.length);
  if (!veredito.ok) throw new Error(veredito.motivo ?? "Foto inválida.");

  const categoria: CategoriaFotoSaidaV3 =
    input?.categoria === "acessorio" || input?.categoria === "outro" || input?.categoria === "reparado"
      ? input.categoria
      : "reparado";
  const now = nowIso();
  const foto: FotoSaidaV3 = {
    id: fotoSaidaId(),
    categoria,
    nome: (input?.nome ?? "").trim() || undefined,
    dataUrl: input.dataUrl.trim(),
    tamanho: bytesDeDataUrlV3(input.dataUrl),
    criadoEm: now,
  };
  const entregaV3 = payload.entregaV3 && typeof payload.entregaV3 === "object" ? (payload.entregaV3 as Record<string, unknown>) : {};
  const operador = operadorLabel(session);
  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next: OSPayloadFull = {
    ...payload,
    entregaV3: { ...entregaV3, fotosSaida: [...atuais, foto] },
    timeline: [...timeline, makeEvento("anexo_adicionado", operador, `Foto de saída adicionada (${categoria}).`, { evento: "foto_saida_adicionada", categoria, fotoId: foto.id })],
    atualizadoEm: now,
  } as OSPayloadFull;
  await prisma.ordemServico.update({ where: { id }, data: { payload: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");
  return next as unknown as OrdemServico;
}

export async function removerFotoSaidaV3(storeId: string, osId: string, fotoId: string): Promise<OrdemServico> {
  const sid = (storeId ?? "").trim();
  const id = (osId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");
  if (!id) throw new Error("OS não informada.");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para remover a foto de saída.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.editarOs, "Sem permissão para editar esta OS.");
  if (!guard.ok) throw new Error(guard.error);

  const row = await prisma.ordemServico.findFirst({ where: { id, storeId: sid }, select: { id: true, payload: true } });
  if (!row) throw new Error("OS não encontrada.");
  const payload = row.payload as unknown as OSPayloadFull | null;
  if (!payload || typeof payload !== "object") throw new Error("OS sem payload compatível.");

  const atuais = lerFotosSaidaV3(payload as unknown as OrdemServico);
  const fid = (fotoId ?? "").trim();
  const alvo = atuais.find((f) => f.id === fid);
  if (!alvo) throw new Error("Foto de saída não encontrada nesta OS.");

  const now = nowIso();
  const entregaV3 = payload.entregaV3 && typeof payload.entregaV3 === "object" ? (payload.entregaV3 as Record<string, unknown>) : {};
  const operador = operadorLabel(session);
  const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
  const next: OSPayloadFull = {
    ...payload,
    entregaV3: { ...entregaV3, fotosSaida: atuais.filter((f) => f.id !== fid) },
    timeline: [...timeline, makeEvento("anexo_removido", operador, `Foto de saída removida (${alvo.categoria}).`, { evento: "foto_saida_removida", categoria: alvo.categoria, fotoId: fid })],
    atualizadoEm: now,
  } as OSPayloadFull;
  await prisma.ordemServico.update({ where: { id }, data: { payload: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/dashboard/operacoes-v3");
  revalidatePath("/dashboard/operacoes-v4-preview");
  return next as unknown as OrdemServico;
}
