"use server";

import { prisma, withPrismaSafe } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import type {
  ChecklistTecnicoItem,
  EventoTimeline,
  Garantia,
  GarantiaOperacionalModo,
  Orcamento,
  OrdemServico,
  OSStatus,
  ObservacaoTecnica,
  PecaUsada,
  RetiradaCliente,
  Servico,
} from "@/types/os";
import type { Venda, VendaStatus, VendaOrigem } from "@/types/venda";
import { snapshotGarantia, snapshotGarantiaOperacional } from "@/lib/os/garantia";
import { cancelContaReceberFromOS, upsertContaReceberFromOS } from "@/lib/financeiro/adapters/os-faturamento";
import { asOperacoesPayload, nowIso } from "@/lib/operacoes/services/os-helpers";
import { listOrdens as listOrdensRead } from "@/app/actions/ordens";
import { mergePayload, computeEffectiveOperacaoStatus, validatePatchIdentifiers } from "@/lib/operacoes/services/payload-service";
import {
  syncFinanceiroAfterOSPayloadUpdate,
  shouldSyncFinanceiroFromPatch,
  type OperacoesSyncPatch,
} from "@/lib/operacoes/services/financeiro-sync-service";
import { verificarPeriodoFechado } from "@/lib/financeiro/services/fechamento-service";
import { appendTimelineEvent, makeTimelineEvent } from "@/lib/operacoes/services/timeline-service";
import { toPrismaStatus } from "@/lib/operacoes/services/status-service";
import { applyApprovedBudgetPolicy } from "@/lib/operacoes/services/orcamento-policy-service";
import { applyEstoqueDelta, buildEstoqueMovimentosFromOS, consumeEstoqueFromOS, restoreEstoqueFromOS } from "@/lib/operacoes/adapters/os-estoque";
import {
  normalizeOperacaoStatus,
  prismaStatusToOperacaoStatus,
} from "@/components/operacoes/lovable/utils/os-status";
import { emitOsFinalizadaOmniEvent } from "@/lib/omni-agent/domain-events";
import {
  assertOperacaoStatusTransition,
  type OperacaoTransitionOptions,
  assertOrcamentoAprovavel,
  assertOrcamentoRecusavel,
  assertPodeAguardarPeca,
  assertPodeEnviarOrcamento,
  assertPodeIniciarDiagnostico,
  assertPodeMarcarPronta,
  readTimelinePayload,
} from "@/lib/operacoes/services/operacao-hub-flow";
import { buildFaturamentoFromOrcamento, buildFaturamentoRecusadoOrcamento } from "@/lib/os/faturamento";
import { syncOrdemServicoDraftItensFromOrcamento, loadOrcamentoFromOsRow } from "@/lib/operacoes/services/os-prisma-itens-sync";
import {
  cancelarGarantiasAtivasOrdem,
  criarGarantiaOrdemServicoDb,
  expirarGarantiasVencidas,
  possuiGarantiaAtiva,
} from "@/lib/operacoes/services/garantia-operacional-service"
import { auth } from "@/auth"
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise"
import type { EnterprisePermissions } from "@/lib/auth/enterprise-permissions"
import { getOperatorLabelFromSession } from "@/lib/auth/session-operator";
import { registrarAuditoriaFinanceira } from "@/lib/financeiro/services/auditoria-financeira-service";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { resolveSaleNumberingWriter } from "@/lib/vendas/sale-numbering-runtime-gate"
import { SALE_WRITER_FLOW } from "@/lib/vendas/sale-identity-contracts"
import { allocateSaleNumberForWriter } from "@/lib/vendas/sale-writer-v2"

export type OSPrioridade = "baixa" | "media" | "alta" | "critica";

export type OperacoesClienteSnapshot = {
  id: string;
  nome: string;
  documento?: string;
  telefone?: string;
  email?: string;
  whatsapp?: string;
  cidade?: string;
};

export type OperacoesTecnicoSnapshot = {
  id: string;
  nome: string;
  especialidades?: string[];
  cargo?: string;
};

export type OperacoesEquipamentoSnapshot = {
  id: string;
  tipo: string;
  marca: string;
  modelo: string;
  numeroSerie?: string;
  acessorios?: string[];
  defeitoRelatado: string;
  defeitosComuns?: string[];
  checklistRecomendado?: string[];
};

export type OperacoesServicoLinha = {
  servicoId: string;
  descricao: string;
  custoInterno: number;
  valorVenda: number;
  prazoGarantiaDias: number;
  termoGarantia: string;
};

export type OperacoesOSPayload = OrdemServico & {
  /**
   * Status granular do Operações HUB (preservado no payload).
   * `status` continua sendo o status operacional do hub; `ordens_servico.status` (Prisma enum) permanece colapsado.
   */
  operacaoStatus?: OSStatus;
};

async function nextCodigo(storeId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await withPrismaSafe(
    (db) => db.ordemServico.count({ where: { storeId } }),
    0
  );
  const seq = String(count + 1).padStart(5, "0");
  return `OS-${year}-${seq}`;
}

async function requireOperacaoAuth(
  storeId: string,
  check: (p: EnterprisePermissions) => boolean,
  message: string,
): Promise<void> {
  assertActiveStoreId(storeId, "Operações");
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Faça login para acessar o módulo de Operações.");
  }
  const g = await requireEnterpriseWith(storeId, check, message);
  if (!g.ok) throw new Error(g.error);
}

async function resolveOperador(autor?: string): Promise<string> {
  const t = autor?.trim();
  if (t && t !== "Operador") return t;
  return getOperatorLabelFromSession(await auth());
}

/**
 * Helper interno: registra auditoria operacional/financeira a partir da sessão NextAuth.
 * Falha-silenciosa (`registrarAuditoriaFinanceira` já é safe).
 */
async function auditOS(params: {
  storeId: string;
  osId: string;
  acao: "criar" | "editar" | "liquidar" | "estornar" | "cancelar";
  antes?: unknown;
  depois?: unknown;
}): Promise<void> {
  const session = await auth();
  await registrarAuditoriaFinanceira({
    storeId: params.storeId,
    entidade: "os",
    entidadeId: params.osId,
    acao: params.acao,
    antes: params.antes,
    depois: params.depois,
    usuarioId: session?.user?.id?.trim() || undefined,
    usuarioNome: getOperatorLabelFromSession(session),
  });
}

export async function listOS(storeId: string): Promise<OperacoesOSPayload[]> {
  await requireOperacaoAuth(
    storeId,
    (p) => p.hubs.operacoes,
    "Sem permissão para listar ordens de serviço.",
  );
  const rows = await listOrdensRead(storeId);
  return rows as OperacoesOSPayload[];
}

export async function createOS(
  storeId: string,
  input: Omit<OperacoesOSPayload, "id" | "codigo" | "criadoEm" | "atualizadoEm">
): Promise<OperacoesOSPayload> {
  await requireOperacaoAuth(storeId, (p) => p.operacoes.criarOs, "Sem permissão para criar OS.");
  const codigo = await nextCodigo(storeId);
  const createdAtIso = nowIso();
  const payload: OperacoesOSPayload = {
    ...(input as unknown as OperacoesOSPayload),
    operacaoStatus: normalizeOperacaoStatus((input as unknown as OperacoesOSPayload).operacaoStatus ?? input.status),
    id: "", // preenchido após create
    codigo,
    storeId,
    criadoEm: createdAtIso,
    atualizadoEm: createdAtIso,
  };

  const created = await prisma.ordemServico.create({
    data: {
      storeId,
      numero: codigo,
      clienteId: input.clienteId || null,
      equipamento: `${input.equipamento.marca} ${input.equipamento.modelo}`.trim(),
      defeito: input.equipamento.defeitoRelatado,
      valorBase: 0,
      valorTotal: Number(
        (input.servicosCatalogo ?? []).reduce((acc, s) => acc + Number(s.valorVenda || 0), 0)
      ),
      status: toPrismaStatus(input.status),
      payload: {} as Prisma.InputJsonValue, // atualizado abaixo com id
    },
    select: { id: true, createdAt: true, updatedAt: true },
  });

  payload.id = created.id;
  payload.criadoEm = created.createdAt.toISOString();
  payload.atualizadoEm = created.updatedAt.toISOString();

  await prisma.ordemServico.update({
    where: { id: created.id },
    data: { payload: payload as unknown as Prisma.InputJsonValue },
  });

  void auditOS({
    storeId,
    osId: created.id,
    acao: "criar",
    depois: {
      codigo,
      clienteId: input.clienteId || null,
      equipamento: payload.equipamento ? `${payload.equipamento.marca} ${payload.equipamento.modelo}`.trim() : null,
      status: input.status,
    },
  });

  revalidatePath("/dashboard/operacoes-v2");
  return payload;
}

export async function updateOSStatus(
  storeId: string,
  osId: string,
  status: OSStatus,
  options?: OperacaoTransitionOptions & { appendTimeline?: EventoTimeline[] },
): Promise<OperacoesOSPayload> {
  const existing = await prisma.ordemServico.findFirst({
    where: { id: osId, storeId },
    select: { id: true, payload: true, createdAt: true },
  });
  if (!existing) throw new Error("OS não encontrada");

  const current = asOperacoesPayload<OperacoesOSPayload>(existing.payload as unknown);
  if (!current) throw new Error("OS sem payload (incompatível)");

  const currentEff = normalizeOperacaoStatus((current as OperacoesOSPayload).status);
  const effective = normalizeOperacaoStatus(status);
  let statusPerm: (p: EnterprisePermissions) => boolean;
  if (effective === "entregue") statusPerm = (p) => p.operacoes.entregarOs;
  else if (effective === "cancelada") statusPerm = (p) => p.operacoes.cancelarOs;
  else statusPerm = (p) => p.operacoes.editarOs;
  await requireOperacaoAuth(storeId, statusPerm, "Sem permissão para alterar o status desta OS.");
  assertOperacaoStatusTransition(currentEff, effective, options);

  const next: OperacoesOSPayload = {
    ...(current as OperacoesOSPayload),
    status: effective,
    operacaoStatus: effective,
    atualizadoEm: nowIso(),
  };
  if (effective === "entregue") {
    const entregueEm = next.entregueEm ?? nowIso();
    next.entregueEm = entregueEm;

    const snap = snapshotGarantiaOperacional(next, entregueEm);
    if (snap?.prazoDias && snap.prazoDias > 0) {
      next.garantia = snap;
    }
  }

  if (options?.appendTimeline?.length) {
    next.timeline = [...(next.timeline ?? []), ...options.appendTimeline];
  }

  if (currentEff === "entregue" && effective !== "entregue") {
    await cancelarGarantiasAtivasOrdem(prisma, { storeId, ordemServicoId: osId });
  }

  await prisma.ordemServico.update({
    where: { id: osId },
    data: { status: toPrismaStatus(effective), payload: next as unknown as Prisma.InputJsonValue },
  });

  if (currentEff !== effective) {
    void auditOS({
      storeId,
      osId,
      acao: effective === "cancelada" ? "cancelar" : "editar",
      antes: { status: currentEff },
      depois: { status: effective },
    });
  }

  // Operador da sessão — fonte única para auditoria das movimentações de estoque desta transição.
  const operadorEstoque = getOperatorLabelFromSession(await auth());

  // Restauração automática do estoque quando a OS sai de "entregue" ou é cancelada.
  // Importante: falhas NÃO podem quebrar a transição de status.
  if (normalizeOperacaoStatus((current as OperacoesOSPayload).status) === "entregue" && effective !== "entregue") {
    const r = await restoreEstoqueFromOS({ storeId, osId, motivo: "automatico", operador: operadorEstoque });
    if (!r.ok) {
      await appendTimelineEvent<OperacoesOSPayload>(prisma, {
        storeId,
        osId,
        ev: makeTimelineEvent("estoque_sync_erro", "Falha ao restaurar estoque automaticamente ao reabrir/cancelar a OS.", { error: r.error }),
      });
    }
  } else if (effective === "cancelada") {
    const r = await restoreEstoqueFromOS({ storeId, osId, motivo: "automatico", operador: operadorEstoque });
    if (!r.ok) {
      await appendTimelineEvent<OperacoesOSPayload>(prisma, {
        storeId,
        osId,
        ev: makeTimelineEvent("estoque_sync_erro", "Falha ao restaurar estoque automaticamente ao cancelar a OS.", { error: r.error }),
      });
    }
  }

  // Consumo real de estoque (idempotente) apenas quando a OS vira entregue.
  // Importante: falhas NÃO podem quebrar a transição de status.
  if (effective === "entregue") {
    const r = await consumeEstoqueFromOS({ storeId, osId, osPayload: next as unknown as OrdemServico, operador: operadorEstoque });
    if (!r.ok) {
      await appendTimelineEvent<OperacoesOSPayload>(prisma, {
        storeId,
        osId,
        ev: makeTimelineEvent("estoque_sync_erro", "Falha ao consumir estoque real ao finalizar a OS.", { error: r.error }),
      });
    }
  }

  if (effective === "entregue" && next.garantia?.ativa && (next.garantia.prazoDias ?? 0) > 0) {
    try {
      await expirarGarantiasVencidas(prisma, { storeId, ordemServicoId: osId });
      const created = await criarGarantiaOrdemServicoDb(prisma, {
        storeId,
        ordemServicoId: osId,
        garantia: next.garantia as Garantia,
      });
      if (created) {
        await appendTimelineEvent<OperacoesOSPayload>(prisma, {
          storeId,
          osId,
          ev: makeTimelineEvent(
            "garantia_gerada",
            `Garantia operacional registrada (${created.prazoDias} dias).`,
            { garantiaId: created.id },
          ),
        });
      }
    } catch {
      // Não quebra transição de status se persistência de garantia falhar.
    }
  }

  // Automações Omni Agent: OS entregue (API legada PATCH está desativada — fonte única aqui).
  if (currentEff !== "entregue" && effective === "entregue") {
    const phoneDigits = String(next.cliente?.telefone ?? next.cliente?.whatsapp ?? "").replace(/\D/g, "")
    const orcTotal = next.orcamento?.total
    const valorTotal =
      typeof orcTotal === "number" && Number.isFinite(orcTotal) ? orcTotal : undefined
    void emitOsFinalizadaOmniEvent(storeId, osId, {
      status: effective,
      phoneDigits,
      valorTotal,
    })
  }

  revalidatePath("/dashboard/operacoes-v2");
  return next as unknown as OperacoesOSPayload;
}

export async function updateOSPayload(
  storeId: string,
  osId: string,
  patch: Partial<OperacoesOSPayload>,
  transitionOpts?: OperacaoTransitionOptions,
): Promise<OperacoesOSPayload> {
  const existing = await prisma.ordemServico.findFirst({
    where: { id: osId, storeId },
    select: { id: true, payload: true },
  });
  if (!existing) throw new Error("OS não encontrada");
  const current = asOperacoesPayload<OperacoesOSPayload>(existing.payload as unknown);
  if (!current) throw new Error("OS sem payload (incompatível)");
  await requireOperacaoAuth(storeId, (p) => p.operacoes.editarOs, "Sem permissão para editar a OS.");
  validatePatchIdentifiers({ storeId, osId, patch });
  const effectiveOperacao = computeEffectiveOperacaoStatus(patch);
  const next = mergePayload<OperacoesOSPayload>({
    current: current as unknown as OperacoesOSPayload,
    patch,
    storeId,
    osId,
    effectiveOperacao,
  }) satisfies OperacoesOSPayload;
  const nextWithPolicy = applyApprovedBudgetPolicy<OperacoesOSPayload>({
    current: current as unknown as OperacoesOSPayload,
    next,
    makeTimelineEvent,
  });

  const nextEff = normalizeOperacaoStatus((nextWithPolicy as OperacoesOSPayload).status);
  const curEff = normalizeOperacaoStatus((current as OperacoesOSPayload).status);
  if (nextEff !== curEff) {
    assertOperacaoStatusTransition(curEff, nextEff, transitionOpts);
  }

  const prismaSt = toPrismaStatus(nextEff);
  const rowUpdate: Prisma.OrdemServicoUpdateInput = {
    payload: nextWithPolicy as unknown as Prisma.InputJsonValue,
    status: prismaSt,
  };
  const orcTotal = (nextWithPolicy as OperacoesOSPayload).orcamento?.total;
  if (typeof orcTotal === "number" && Number.isFinite(orcTotal)) {
    rowUpdate.valorTotal = orcTotal;
  }

  if (shouldSyncFinanceiroFromPatch(patch as Partial<OperacoesSyncPatch>)) {
    const lock = await verificarPeriodoFechado(storeId, new Date());
    if (lock.fechado) {
      throw new Error(
        "Período financeiro fechado. Reabra o fechamento para alterar cobrança ou faturamento desta OS.",
      );
    }
  }

  await prisma.ordemServico.update({
    where: { id: osId },
    data: rowUpdate,
  });

  // Delta de estoque após revisão de orçamento aprovado (se já consumiu estoque real e ainda não restaurou).
  // Importante: falhas NÃO podem quebrar o update do payload.
  const revisaoKey = (nextWithPolicy as any)?.orcamentoRevisaoAtual?.revisadoEm as string | undefined;
  if (typeof revisaoKey === "string" && revisaoKey) {
    const operadorDelta = getOperatorLabelFromSession(await auth());
    const r = await applyEstoqueDelta({ storeId, osId, osPayload: nextWithPolicy as unknown as OrdemServico, revisaoKey, operador: operadorDelta });
    if (!r.ok) {
      await appendTimelineEvent<OperacoesOSPayload>(prisma, {
        storeId,
        osId,
        ev: makeTimelineEvent("estoque_delta_erro", "Falha ao aplicar delta de estoque após revisão de orçamento.", { error: r.error }),
      });
    }
  }

  await syncFinanceiroAfterOSPayloadUpdate({
    storeId,
    osId,
    patch,
    next: nextWithPolicy,
    upsertContaReceberFromOS,
    cancelContaReceberFromOS,
    makeTimelineEvent,
    appendTimelineEvent: ({ storeId: s, osId: o, ev }) => appendTimelineEvent<OperacoesOSPayload>(prisma, { storeId: s, osId: o, ev }),
    onContaReceberChanged: async ({ contaReceberTituloId, localKey, action, valor }) => {
      const session = await auth();
      await registrarAuditoriaFinanceira({
        storeId,
        entidade: "receber",
        entidadeId: contaReceberTituloId,
        acao: action === "cancelled" ? "cancelar" : "criar",
        usuarioId: session?.user?.id?.trim() || undefined,
        usuarioNome: getOperatorLabelFromSession(session),
        depois: { localKey, valor, origemAdapter: "os-faturamento", osId },
      });
    },
  });

  revalidatePath("/dashboard/operacoes-v2");
  return nextWithPolicy;
}

function newTimelineId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev_${Date.now()}`;
}

function recalcularOrcamentoTotals(o: Orcamento): Orcamento {
  const pecasSum = o.pecas.reduce(
    (s, p) => s + Math.max(0, p.quantidade * p.valorUnitario - (p.desconto ?? 0)),
    0,
  );
  const servSum = o.servicos.reduce((s, x) => s + Math.max(0, x.valor - (x.desconto ?? 0)), 0);
  const total = Math.max(0, pecasSum + servSum - o.desconto);
  return { ...o, total, atualizadoEm: nowIso() };
}

export type OperacaoHubAcaoInput =
  | { kind: "iniciar_diagnostico" }
  | { kind: "enviar_orcamento" }
  | { kind: "aprovar_orcamento" }
  | { kind: "reprovar_orcamento"; motivo?: string }
  | { kind: "iniciar_servico"; iniciarSemAprovacaoConfirmado?: boolean }
  | { kind: "aguardar_peca" }
  | { kind: "marcar_pronta" }
  | { kind: "entregar_cliente" }
  | { kind: "cancelar"; motivo?: string }
  | { kind: "adicionar_observacao"; texto: string; interna?: boolean };

/**
 * Ações operacionais seguras do Operações HUB (Fase 2): valida fluxo, atualiza payload/timeline e sincroniza status Prisma.
 */
export async function applyOperacaoHubAcao(
  storeId: string,
  osId: string,
  acao: OperacaoHubAcaoInput,
  autor = "Operador",
): Promise<OperacoesOSPayload> {
  const existing = await prisma.ordemServico.findFirst({
    where: { id: osId, storeId },
    select: { payload: true },
  });
  if (!existing?.payload) throw new Error("OS não encontrada");

  const base = asOperacoesPayload<OperacoesOSPayload>(existing.payload as unknown);
  if (!base) throw new Error("OS sem payload (incompatível)");
  const current = base as OperacoesOSPayload;
  const st = normalizeOperacaoStatus(current.status);
  const tl = readTimelinePayload(current);

  const permForAcao = (): ((p: EnterprisePermissions) => boolean) => {
    switch (acao.kind) {
      case "entregar_cliente":
        return (p) => p.operacoes.entregarOs;
      case "cancelar":
        return (p) => p.operacoes.cancelarOs;
      default:
        return (p) => p.operacoes.editarOs;
    }
  };
  await requireOperacaoAuth(storeId, permForAcao(), "Sem permissão para esta ação na OS.");
  const autorEfetivo = await resolveOperador(autor);

  switch (acao.kind) {
    case "iniciar_diagnostico": {
      assertPodeIniciarDiagnostico(current);
      assertOperacaoStatusTransition(st, "diagnostico");
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "diagnostico_registrado",
        titulo: "Diagnóstico",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "Diagnóstico iniciado.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        status: "diagnostico",
        operacaoStatus: "diagnostico",
        timeline: [...tl, ev],
      });
    }
    case "enviar_orcamento": {
      assertPodeEnviarOrcamento(current);
      const orc = current.orcamento;
      if (!orc) throw new Error("Crie um orçamento antes de enviar.");
      assertOperacaoStatusTransition(st, "aguardando_aprovacao");
      const orcamento = recalcularOrcamentoTotals({
        ...orc,
        status: "enviado",
        enviadoEm: orc.enviadoEm ?? nowIso(),
      });
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "orcamento_enviado",
        titulo: "Orçamento",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "Orçamento enviado ao cliente.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        orcamento,
        status: "aguardando_aprovacao",
        timeline: [...tl, ev],
      });
    }
    case "aprovar_orcamento": {
      assertOrcamentoAprovavel(current.orcamento);
      assertOperacaoStatusTransition(st, "aprovado");
      const orcamento = recalcularOrcamentoTotals({
        ...current.orcamento!,
        status: "aprovado",
        respondidoEm: nowIso(),
      });
      const virtual: OrdemServico = { ...(current as unknown as OrdemServico), orcamento, status: "aprovado" };
      const garantiaSnap = snapshotGarantia(virtual, nowIso());
      const garantia: Garantia = garantiaSnap ?? (current.garantia ?? { ativa: false });
      const faturamento = buildFaturamentoFromOrcamento({
        os: { id: current.id, codigo: current.codigo },
        orcamento,
        criadoEm: nowIso(),
      });
      const ev1: EventoTimeline = {
        id: newTimelineId(),
        tipo: "orcamento_aprovado",
        titulo: "Orçamento aprovado",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "Orçamento aprovado.",
        criadoEm: nowIso(),
      };
      const ev2: EventoTimeline = {
        id: newTimelineId(),
        tipo: "faturamento_os_pendente",
        titulo: "Faturamento",
        autor: "Sistema",
        autorTipo: "sistema",
        conteudo: "Orçamento aprovado e faturamento pendente criado.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        status: "aprovado",
        orcamento,
        garantia,
        timeline: [...tl, ev1, ev2],
        ...faturamento,
      } as Partial<OperacoesOSPayload>);
    }
    case "reprovar_orcamento": {
      assertOrcamentoRecusavel(current.orcamento);
      assertOperacaoStatusTransition(st, "diagnostico");
      const orcamento = recalcularOrcamentoTotals({
        ...current.orcamento!,
        status: "recusado",
        respondidoEm: nowIso(),
      });
      const faturamento = buildFaturamentoRecusadoOrcamento();
      const ev1: EventoTimeline = {
        id: newTimelineId(),
        tipo: "orcamento_recusado",
        titulo: "Orçamento recusado",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: acao.motivo?.trim() ? acao.motivo.trim() : "Orçamento recusado.",
        criadoEm: nowIso(),
      };
      const ev2: EventoTimeline = {
        id: newTimelineId(),
        tipo: "faturamento_os_cancelado",
        titulo: "Faturamento",
        autor: "Sistema",
        autorTipo: "sistema",
        conteudo: "Orçamento recusado; faturamento cancelado.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        status: "diagnostico",
        orcamento,
        timeline: [...tl, ev1, ev2],
        ...faturamento,
      } as Partial<OperacoesOSPayload>);
    }
    case "iniciar_servico": {
      const transitionOpts: OperacaoTransitionOptions | undefined = acao.iniciarSemAprovacaoConfirmado
        ? { allowIniciarServicoSemAprovacao: true }
        : undefined;
      assertOperacaoStatusTransition(st, "em_execucao", transitionOpts);
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "servico_iniciado",
        titulo: "Serviço em execução",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: acao.iniciarSemAprovacaoConfirmado
          ? "Serviço iniciado sem aprovação formal (confirmado pelo operador)."
          : "Serviço iniciado após aprovação do orçamento.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(
        storeId,
        osId,
        {
          status: "em_execucao",
          timeline: [...tl, ev],
        },
        transitionOpts,
      );
    }
    case "aguardar_peca": {
      assertPodeAguardarPeca(current);
      assertOperacaoStatusTransition(st, "aguardando_peca");
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "mudanca_status",
        titulo: "Aguardando peça",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "Serviço pausado aguardando peça.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        status: "aguardando_peca",
        timeline: [...tl, ev],
      });
    }
    case "marcar_pronta": {
      assertPodeMarcarPronta(current);
      assertOperacaoStatusTransition(st, "pronta");
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "servico_concluido",
        titulo: "Serviço concluído",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "OS marcada como pronta para retirada.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        status: "pronta",
        timeline: [...tl, ev],
      });
    }
    case "entregar_cliente": {
      assertOperacaoStatusTransition(st, "entregue");
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "entrega_cliente",
        titulo: "Entrega",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: "Equipamento entregue ao cliente.",
        criadoEm: nowIso(),
      };
      return updateOSStatus(storeId, osId, "entregue", { appendTimeline: [ev] });
    }
    case "cancelar": {
      assertOperacaoStatusTransition(st, "cancelada");
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "os_cancelada",
        titulo: "Cancelamento",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: acao.motivo?.trim() ? `OS cancelada. Motivo: ${acao.motivo.trim()}` : "OS cancelada.",
        criadoEm: nowIso(),
      };
      return updateOSStatus(storeId, osId, "cancelada", { appendTimeline: [ev] });
    }
    case "adicionar_observacao": {
      const txt = acao.texto.trim();
      if (!txt) throw new Error("Digite uma observação.");
      if (st === "entregue") throw new Error("OS entregue não aceita novas observações por este fluxo.");
      const obs: ObservacaoTecnica = {
        id: `ob_${newTimelineId()}`,
        autor: autorEfetivo,
        conteudo: txt,
        interna: acao.interna ?? false,
        criadoEm: nowIso(),
      };
      const observacoes = [...(current.observacoes ?? []), obs];
      const ev: EventoTimeline = {
        id: newTimelineId(),
        tipo: "observacao",
        titulo: obs.interna ? "Observação interna" : "Observação",
        autor: autorEfetivo,
        autorTipo: "usuario",
        conteudo: obs.interna ? "Observação interna registrada." : "Observação registrada.",
        criadoEm: nowIso(),
      };
      return updateOSPayload(storeId, osId, {
        observacoes,
        timeline: [...tl, ev],
      });
    }
    default: {
      const k = (acao as { kind?: string }).kind ?? "desconhecida";
      throw new Error(`Ação não suportada: ${k}`);
    }
  }
}

export async function syncOperacaoItensComOrcamento(storeId: string, osId: string): Promise<void> {
  await requireOperacaoAuth(storeId, (p) => p.operacoes.editarOs, "Sem permissão para sincronizar itens da OS.");
  const { orcamento, payload } = await loadOrcamentoFromOsRow(storeId, osId);
  if (!orcamento || !payload) return;
  await syncOrdemServicoDraftItensFromOrcamento({ storeId, osId, orcamento, payload });
}

export type EstoqueOrcamentoIssue = {
  produtoId: string;
  nome: string;
  necessario: number;
  disponivel: number;
};

export async function validateOrcamentoEstoqueAction(
  storeId: string,
  osId: string,
): Promise<{ ok: boolean; issues: EstoqueOrcamentoIssue[] }> {
  await requireOperacaoAuth(storeId, (p) => p.hubs.operacoes, "Sem permissão para validar estoque do orçamento.");
  const row = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const current = asOperacoesPayload<OperacoesOSPayload>(row?.payload as unknown);
  if (!current) return { ok: true, issues: [] };
  const { items } = await buildEstoqueMovimentosFromOS(current as unknown as OrdemServico);
  const issues: EstoqueOrcamentoIssue[] = [];
  for (const it of items) {
    const p = await prisma.produto.findFirst({
      where: { id: it.produtoId, storeId },
      select: { stock: true, name: true },
    });
    if (!p) {
      issues.push({ produtoId: it.produtoId, nome: it.nome, necessario: it.quantidade, disponivel: 0 });
      continue;
    }
    if (p.stock < it.quantidade) {
      issues.push({ produtoId: it.produtoId, nome: p.name, necessario: it.quantidade, disponivel: p.stock });
    }
  }
  return { ok: issues.length === 0, issues };
}

export type GerarCobrancaModo = "avista" | "parcelado" | "carteira" | "dinheiro_pix_cartao";

export type GerarCobrancaParcelaOS = { numero: number; valor: number; vencimentoIso: string };

function montarParcelasCobranca(total: number, modo: GerarCobrancaModo, numParcelas?: number): GerarCobrancaParcelaOS[] {
  const t = Math.round(Number(total) * 100) / 100;
  const base = new Date();
  if (modo === "parcelado") {
    const n = Math.min(24, Math.max(2, Math.floor(numParcelas ?? 2)));
    const cents = Math.round(t * 100);
    const each = Math.floor(cents / n);
    const rest = cents - each * n;
    const out: GerarCobrancaParcelaOS[] = [];
    for (let i = 0; i < n; i++) {
      const c = each + (i < rest ? 1 : 0);
      const d = new Date(base);
      d.setMonth(d.getMonth() + i + 1);
      d.setHours(12, 0, 0, 0);
      out.push({ numero: i + 1, valor: c / 100, vencimentoIso: d.toISOString() });
    }
    return out;
  }
  const d = new Date(base);
  d.setDate(d.getDate() + 30);
  d.setHours(12, 0, 0, 0);
  return [{ numero: 1, valor: t, vencimentoIso: d.toISOString() }];
}

export async function gerarCobrancaOSAction(
  storeId: string,
  osId: string,
  input: { modo: GerarCobrancaModo; numParcelas?: number },
  autor = "Operador",
): Promise<OperacoesOSPayload> {
  const existing = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const current = asOperacoesPayload<OperacoesOSPayload>(existing?.payload as unknown);
  if (!current) throw new Error("OS não encontrada");

  await requireOperacaoAuth(storeId, (p) => p.operacoes.gerarCobranca, "Sem permissão para gerar cobrança.");
  const autorCob = await resolveOperador(autor);

  const st = normalizeOperacaoStatus(current.status);
  const allowed: OSStatus[] = ["aprovado", "em_execucao", "aguardando_peca", "pronta", "entregue"];
  if (!allowed.includes(st)) {
    throw new Error("Gere cobrança somente com OS aprovada, em execução, pronta ou entregue.");
  }
  const pendenteOk =
    current.faturamentoPendente === true &&
    current.faturamentoStatus === "pendente" &&
    Number(current.faturamentoTotal) > 0;
  if (!pendenteOk) {
    throw new Error("Não há faturamento pendente nesta OS (aprove o orçamento primeiro).");
  }

  const lockCobranca = await verificarPeriodoFechado(storeId, new Date());
  if (lockCobranca.fechado) {
    throw new Error(
      "Período financeiro fechado. Reabra o fechamento para registrar ou alterar a cobrança desta OS.",
    );
  }

  const total = Number(current.faturamentoTotal);
  const parcelas = montarParcelasCobranca(total, input.modo, input.numParcelas);
  const formaPagamento =
    input.modo === "carteira"
      ? "carteira"
      : input.modo === "dinheiro_pix_cartao"
        ? "dinheiro_pix_cartao"
        : input.modo === "avista"
          ? "avista"
          : "parcelado";

  const tl = readTimelinePayload(current);
  const ev: EventoTimeline = {
    id: newTimelineId(),
    tipo: "operacao_cobranca_gerada",
    titulo: "Cobrança",
    autor: autorCob,
    autorTipo: "usuario",
    conteudo: `Cobrança registrada no financeiro (modo: ${input.modo}).`,
    metadata: { modo: input.modo, parcelas: parcelas.length },
    criadoEm: nowIso(),
  };

  const patched = await updateOSPayload(storeId, osId, {
    faturamentoModoCobranca: input.modo,
    faturamentoParcelas: parcelas,
    faturamentoFormaPagamento: formaPagamento,
    timeline: [...tl, ev],
  } as Partial<OperacoesOSPayload>);

  void auditOS({
    storeId,
    osId,
    acao: "editar",
    depois: {
      tipo: "cobranca_gerada",
      modo: input.modo,
      formaPagamento,
      parcelas: parcelas.length,
      total,
    },
  });

  const stAfter = normalizeOperacaoStatus(patched.status);
  if (stAfter === "entregue" && patched.garantia?.ativa && (patched.garantia.prazoDias ?? 0) > 0) {
    try {
      await expirarGarantiasVencidas(prisma, { storeId, ordemServicoId: osId });
      const has = await possuiGarantiaAtiva(prisma, { storeId, ordemServicoId: osId });
      if (!has) {
        const created = await criarGarantiaOrdemServicoDb(prisma, {
          storeId,
          ordemServicoId: osId,
          garantia: patched.garantia as Garantia,
        });
        if (created) {
          await appendTimelineEvent<OperacoesOSPayload>(prisma, {
            storeId,
            osId,
            ev: makeTimelineEvent(
              "garantia_gerada",
              `Garantia operacional sincronizada (${created.prazoDias} dias) após registro de cobrança.`,
              { garantiaId: created.id },
            ),
          });
        }
      }
    } catch {
      // Cobrança já persistida; falha de garantia não reverte financeiro.
    }
  }

  const refreshed = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const out = asOperacoesPayload<OperacoesOSPayload>(refreshed?.payload as unknown);
  if (!out) return patched;
  return out;
}

export async function salvarChecklistTecnicoOperacaoAction(
  storeId: string,
  osId: string,
  checklistTecnico: ChecklistTecnicoItem[],
  autor = "Operador",
): Promise<OperacoesOSPayload> {
  await requireOperacaoAuth(storeId, (p) => p.operacoes.checklist, "Sem permissão para editar o checklist técnico.");
  const autorCh = await resolveOperador(autor);
  const existing = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const current = asOperacoesPayload<OperacoesOSPayload>(existing?.payload as unknown);
  if (!current) throw new Error("OS não encontrada");
  const prev = Array.isArray(current.checklistTecnico) ? current.checklistTecnico : [];
  const allOk = checklistTecnico.length > 0 && checklistTecnico.every((x) => x.ok);
  const wasAllOk = prev.length > 0 && prev.every((x) => x.ok);
  const tl = readTimelinePayload(current);
  const timeline =
    allOk && !wasAllOk
      ? [
          ...tl,
          makeTimelineEvent("checklist_finalizado", `Checklist técnico concluído (${checklistTecnico.length} itens).`, {
            autor: autorCh,
          }),
        ]
      : tl;
  return updateOSPayload(storeId, osId, { checklistTecnico, timeline } as Partial<OperacoesOSPayload>);
}

export async function confirmarRetiradaOperacaoAction(
  storeId: string,
  osId: string,
  input: RetiradaCliente,
  autor = "Operador",
): Promise<OperacoesOSPayload> {
  await requireOperacaoAuth(storeId, (p) => p.operacoes.retirada, "Sem permissão para registrar retirada.");
  const autorRt = await resolveOperador(autor);
  const existing = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const current = asOperacoesPayload<OperacoesOSPayload>(existing?.payload as unknown);
  if (!current) throw new Error("OS não encontrada");
  const tl = readTimelinePayload(current);
  const retirada: RetiradaCliente = {
    confirmado: Boolean(input.confirmado),
    retiradoPor: input.retiradoPor?.trim() || undefined,
    retiradoEm: input.confirmado ? (input.retiradoEm ?? nowIso()) : undefined,
    observacao: input.observacao?.trim() || undefined,
    assinaturaTexto: input.assinaturaTexto?.trim() || undefined,
  };
  const nome = retirada.retiradoPor?.trim();
  const timeline = input.confirmado
    ? [
        ...tl,
        makeTimelineEvent(
          "retirada_confirmada",
          nome ? `Retirada confirmada por ${nome}.` : "Retirada confirmada.",
          { autor: autorRt },
        ),
      ]
    : tl;
  return updateOSPayload(storeId, osId, { retirada, timeline } as Partial<OperacoesOSPayload>);
}

export async function registrarDocumentoImpressoAction(
  storeId: string,
  osId: string,
  autor = "Operador",
): Promise<void> {
  await requireOperacaoAuth(
    storeId,
    (p) => p.operacoes.editarOs,
    "Sem permissão para registrar impressão de documento.",
  );
  const autorDoc = await resolveOperador(autor);
  await appendTimelineEvent<OperacoesOSPayload>(prisma, {
    storeId,
    osId,
    ev: makeTimelineEvent("documento_impresso", "Documento operacional impresso ou copiado.", { autor: autorDoc }),
  });
  revalidatePath("/dashboard/operacoes-v2");
}

export async function salvarPreferenciaGarantiaOperacionalAction(
  storeId: string,
  osId: string,
  input: { modo: GarantiaOperacionalModo; prazoCustom?: number },
): Promise<OperacoesOSPayload> {
  await requireOperacaoAuth(
    storeId,
    (p) => p.operacoes.garantia,
    "Sem permissão para alterar preferências de garantia operacional.",
  );
  return updateOSPayload(storeId, osId, {
    garantiaOperacionalModo: input.modo,
    garantiaOperacionalPrazoCustom: input.modo === "personalizada" ? input.prazoCustom : undefined,
  } as Partial<OperacoesOSPayload>);
}

export async function criarGarantiaOperacionalManualAction(
  storeId: string,
  osId: string,
  input: { prazoDias: number; observacoes?: string },
  autor = "Operador",
): Promise<OperacoesOSPayload> {
  await requireOperacaoAuth(storeId, (p) => p.operacoes.garantia, "Sem permissão para registrar garantia operacional.");
  const autorG = await resolveOperador(autor);
  const existing = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const current = asOperacoesPayload<OperacoesOSPayload>(existing?.payload as unknown);
  if (!current) throw new Error("OS não encontrada");
  const st = normalizeOperacaoStatus(current.status);
  if (!["pronta", "entregue"].includes(st)) {
    throw new Error("Garantia manual disponível apenas com OS pronta ou entregue.");
  }
  const dias = Math.min(3650, Math.max(1, Math.trunc(Number(input.prazoDias))));
  const inicio = current.entregueEm ?? nowIso();
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + dias);
  const garantia: Garantia = {
    ...(current.garantia ?? { ativa: false }),
    ativa: true,
    prazoDias: dias,
    inicioEm: inicio,
    fimEm: fim.toISOString(),
    termo: current.garantia?.termo ?? `Garantia operacional de ${dias} dias (registro manual).`,
  };
  await updateOSPayload(storeId, osId, { garantia } as Partial<OperacoesOSPayload>);
  try {
    await expirarGarantiasVencidas(prisma, { storeId, ordemServicoId: osId });
    const created = await criarGarantiaOrdemServicoDb(prisma, {
      storeId,
      ordemServicoId: osId,
      garantia,
      observacoes: input.observacoes,
    });
    if (created) {
      await appendTimelineEvent<OperacoesOSPayload>(prisma, {
        storeId,
        osId,
        ev: makeTimelineEvent(
          "garantia_gerada",
          `Garantia operacional registrada manualmente (${created.prazoDias} dias).`,
          { garantiaId: created.id, autor: autorG },
        ),
      });
    }
  } catch {
    // Payload já atualizado; persistência de linha em garantia é best-effort.
  }
  const refreshed = await prisma.ordemServico.findFirst({ where: { id: osId, storeId }, select: { payload: true } });
  const out = asOperacoesPayload<OperacoesOSPayload>(refreshed?.payload as unknown);
  if (!out) throw new Error("OS não encontrada");
  revalidatePath("/dashboard/operacoes-v2");
  return out;
}

// ── Vendas (para o HUB de Operações) ─────────────────────────────────────────

function safePayloadObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export async function listVendasHub(storeId: string): Promise<Venda[]> {
  await requireOperacaoAuth(storeId, (p) => p.hubs.vendas, "Sem permissão para listar vendas.");
  const rows = await prisma.venda.findMany({
    where: { storeId },
    include: { itens: true },
    orderBy: { at: "desc" },
    take: 200,
  })
  return rows.map((r) => {
    const pl = safePayloadObj(r.payload)
    const itens: PecaUsada[] = Array.isArray(pl?.itens)
      ? (pl!.itens as PecaUsada[])
      : r.itens.map((i) => ({
          id: i.inventoryId ?? i.id,
          nome: i.nome,
          quantidade: i.quantidade,
          valorUnitario: i.precoUnitario,
        }))
    const servicos: Servico[] = Array.isArray(pl?.servicos) ? (pl!.servicos as Servico[]) : []
    return {
      id: r.id,
      storeId: r.storeId,
      numero: r.pedidoId,
      clienteId: (pl?.clienteId as string) ?? "",
      origem: ((pl?.origem as VendaOrigem | undefined) ?? "balcao") as VendaOrigem,
      origemRefId: (pl?.origemRefId as string | undefined),
      itens,
      servicos,
      desconto: typeof pl?.desconto === "number" ? pl.desconto : 0,
      total: r.total,
      status: ((pl?.status as VendaStatus | undefined) ?? "emitida") as VendaStatus,
      criadoEm: r.at.toISOString(),
      pagoEm: (pl?.pagoEm as string | undefined),
    }
  })
}

export async function criarVendaDeOSAction(os: OrdemServico): Promise<Venda> {
  if (!os.orcamento) throw new Error("OS sem orçamento — impossível faturar");
  const orcamento = os.orcamento
  await requireOperacaoAuth(
    os.storeId,
    (p) => p.hubs.vendas && p.operacoes.editarOs,
    "Sem permissão para criar venda a partir da OS.",
  );
  const year = new Date().getFullYear();
  const gate = resolveSaleNumberingWriter()
  const numberingV2 = gate.writer === SALE_WRITER_FLOW.V2
  // Writer V1: contrato legado VND-{ano}-{count+1}. Writer V2: mesma série server-side do PDV.
  const pedidoIdLegado = numberingV2
    ? null
    : `VND-${year}-${((await prisma.venda.count({ where: { storeId: os.storeId } })) + 1).toString().padStart(5, "0")}`
  // Resolve nome do cliente sem cair em ID quando o snapshot do payload não trouxe nome.
  const clienteNomeOS = (os.cliente?.nome ?? "").trim()
  const clienteIdOS = (os.clienteId ?? "").trim() || null
  const clienteNomeFallback = clienteIdOS
    ? (await prisma.cliente
        .findFirst({ where: { id: clienteIdOS, storeId: os.storeId }, select: { name: true } })
        .catch(() => null))?.name?.trim() ?? ""
    : ""
  const clienteNome = clienteNomeOS || clienteNomeFallback || "Cliente"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    clienteId: clienteIdOS,
    origem: "os",
    origemRefId: os.id,
    itens: orcamento.pecas,
    servicos: orcamento.servicos,
    desconto: orcamento.desconto,
    status: "emitida",
  }
  const venda = numberingV2
    ? await prisma.$transaction(async (tx) => {
        const numbering = await allocateSaleNumberForWriter(tx, os.storeId)
        payload.id = numbering.pedidoId
        return tx.venda.create({
          data: {
            storeId: os.storeId,
            pedidoId: numbering.pedidoId,
            total: orcamento.total,
            clienteNome,
            ...(clienteIdOS ? { clienteId: clienteIdOS } : {}),
            payload,
            serieVendaId: numbering.serieVendaId,
            anoNumero: numbering.anoNumero,
            numeroSequencial: numbering.numeroSequencial,
            numeradaEm: new Date(),
            numeracaoOrigem: "SERVER_V1",
            itens: {
              create: orcamento.pecas.map((p) => ({
                inventoryId: p.produtoId ?? p.id,
                nome: p.nome,
                quantidade: p.quantidade,
                precoUnitario: p.valorUnitario ?? 0,
                lineTotal: p.quantidade * (p.valorUnitario ?? 0),
              })),
            },
          },
        })
      })
    : await prisma.venda.create({
    data: {
      storeId: os.storeId,
      pedidoId: pedidoIdLegado!,
      total: orcamento.total,
      clienteNome,
      // FK real Venda → Cliente (Goal 4 Cadastros). Mantém o vínculo histórico
      // mesmo se o nome do cliente mudar depois no cadastro.
      ...(clienteIdOS ? { clienteId: clienteIdOS } : {}),
      payload,
      itens: {
        create: orcamento.pecas.map((p) => ({
          inventoryId: p.produtoId ?? p.id,
          nome: p.nome,
          quantidade: p.quantidade,
          precoUnitario: p.valorUnitario ?? 0,
          lineTotal: p.quantidade * (p.valorUnitario ?? 0),
        })),
      },
    },
  })
  const pedidoId = venda.pedidoId
  return {
    id: venda.id,
    storeId: venda.storeId,
    numero: pedidoId,
    clienteId: os.clienteId,
    origem: "os",
    origemRefId: os.id,
    itens: orcamento.pecas,
    servicos: orcamento.servicos,
    desconto: orcamento.desconto,
    total: orcamento.total,
    status: "emitida",
    criadoEm: venda.at.toISOString(),
  }
}

