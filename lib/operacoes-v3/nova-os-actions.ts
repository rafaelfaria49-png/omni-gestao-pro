"use server";

// ============================================================================
// Operações V3 — Nova OS Enterprise · write-path de ABERTURA (caminho seguro)
// ----------------------------------------------------------------------------
// Cria a OS REAL reutilizando o caminho seguro existente do HUB:
//   • cliente novo  → `criarCliente` (@/api/clientes → createCliente do Cadastros).
//   • OS            → `criarOS` (@/api/os → createOS), que numera, audita e
//     persiste o payload. Campos extras da V3 viajam no payload (JSONB) e
//     sobrevivem à hidratação pelo spread — mesma disciplina de
//     `operacaoStatusV3` (Fase 1B) e do orçamento (Fase 1C).
//
// NÃO faz nesta fase (por decisão de escopo): baixa de estoque, criação de
// Conta a Receber, recebimento no caixa, disparo de WhatsApp. O pagamento é
// apenas PREVISTO; o recebimento real acontece depois no PDV de Serviço.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import type { OrdemServico } from "@/types/os";
import { auth } from "@/auth";
import { requireEnterpriseWith } from "@/lib/auth/guard-enterprise";
import { assertActiveStoreId } from "@/lib/operacoes/assert-active-store";
import { criarOS as criarOSImpl } from "@/api/os";
import { resolverClienteOperacoesV3 } from "./cliente-resolver";
import {
  computeTotaisNovaOSV3,
  garantiaModeloV3,
  type NovaOSDraftV3,
  validarNovaOSDraftV3,
} from "./nova-os-model";
import { emitirEventoOperacaoV3 } from "./event-publisher";

function operadorLabel(session: Session | null): string {
  const u = session?.user;
  return (u?.name || u?.email || "Você").trim() || "Você";
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Origem rica da V3 → OSOrigem válida do V2 (a versão completa fica no payload). */
function origemV2(origem: NovaOSDraftV3["recepcao"]["origem"]): "whatsapp" | "balcao" {
  return origem === "whatsapp" ? "whatsapp" : "balcao";
}

export interface CriarOSEnterpriseV3Result {
  os: OrdemServico;
}

/**
 * Abre uma OS completa a partir do rascunho da Nova OS Enterprise.
 * Lança Error com mensagem amigável em falha de validação/permissão.
 */
export async function criarOSEnterpriseV3(
  storeId: string,
  draft: NovaOSDraftV3,
  extras?: Record<string, unknown>,
): Promise<CriarOSEnterpriseV3Result> {
  const sid = (storeId ?? "").trim();
  assertActiveStoreId(sid, "Operações V3");

  const session = await auth();
  if (!session?.user?.id) throw new Error("Faça login para abrir uma OS.");
  const guard = await requireEnterpriseWith(sid, (p) => p.operacoes.criarOs, "Sem permissão para abrir OS nesta unidade.");
  if (!guard.ok) throw new Error(guard.error);

  const erro = validarNovaOSDraftV3(draft);
  if (erro) throw new Error(erro);

  const operador = operadorLabel(session);

  // 1. Resolve um cliente REAL — nunca um id temporário (evita violar a FK da OS).
  //    GOAL 022: helper único (`resolverClienteOperacoesV3`), sem Cliente Balcão
  //    aqui (`permitirBalcao: false`) e com documento/email/tipo PJ habilitados
  //    (`permitirCamposEstendidos: true`) — mesmo fallthrough de antes.
  const draftClienteId = draft.cliente.id?.trim() || undefined;
  const clienteResolvido = await resolverClienteOperacoesV3(
    sid,
    {
      modo: draftClienteId ? "existente" : "novo",
      clienteId: draftClienteId,
      nome: draft.cliente.nome.trim(),
      telefone: draft.cliente.telefone?.trim() || undefined,
      documento: draft.cliente.documento?.trim() || undefined,
      email: draft.cliente.email?.trim() || undefined,
      tipo: draft.cliente.tipo,
    },
    { permitirBalcao: false, permitirCamposEstendidos: true },
  );
  const clienteId = clienteResolvido.id;
  const nome = clienteResolvido.nome;
  const telefone = clienteResolvido.telefone;
  const documento = clienteResolvido.documento;
  const email = clienteResolvido.email;

  // 2. Itens → peças (PecaUsada + extras kindV3/baixaEstoqueV3) e serviços (servicosCatalogo + kindV3).
  //    Para brinde/interno o valor ao cliente é zerado na persistência (R$ 0,00 ao cliente),
  //    preservando o custo interno. createOS soma `servicosCatalogo.valorVenda` no valorTotal.
  const pecas = draft.itens
    .filter((it) => it.categoria === "peca")
    .map((it) => {
      // SPRINT_3D.1B — peça vinculada ao catálogo carrega produtoId/sku/barcode,
      // o que faz o adapter oficial baixar estoque na entrega (sem "nothing_to_consume").
      const produtoId = it.produtoId?.trim() || "";
      return {
        id: `nova-${it.id}`,
        nome: it.descricao.trim(),
        quantidade: Math.max(1, Math.trunc(it.quantidade) || 1),
        valorUnitario: it.kind === "cobrado" ? Math.max(0, it.valorUnitario) : 0,
        custoUnitario: Math.max(0, it.custoUnitario),
        produtoOrigem: produtoId ? ("prisma" as const) : ("manual" as const),
        ...(produtoId ? { produtoId } : {}),
        ...(it.sku?.trim() ? { sku: it.sku.trim() } : {}),
        ...(it.barcode?.trim() ? { barcode: it.barcode.trim() } : {}),
        kindV3: it.kind,
        baixaEstoqueV3: it.baixaEstoque,
      };
    });

  const servicosCatalogo = draft.itens
    .filter((it) => it.categoria === "servico")
    .map((it) => {
      const qtd = Math.max(1, Math.trunc(it.quantidade) || 1);
      return {
        servicoId: `nova-${it.id}`,
        descricao: it.descricao.trim(),
        custoInterno: Math.max(0, it.custoUnitario) * qtd,
        valorVenda: it.kind === "cobrado" ? Math.max(0, it.valorUnitario) * qtd : 0,
        prazoGarantiaDias: Math.max(0, Math.trunc(it.garantiaDias ?? draft.garantia.prazoDias ?? 0)),
        termoGarantia: "",
        kindV3: it.kind,
      };
    });

  // 3. Garantia prevista (snapshot para impressão/termo futuro).
  const modeloGarantia = garantiaModeloV3(draft.garantia.modelo);
  const prazoGarantia = draft.garantia.prazoDias ?? modeloGarantia.prazoDias;
  const garantia =
    prazoGarantia && prazoGarantia > 0
      ? { ativa: false, prazoDias: prazoGarantia, termo: draft.garantia.termo?.trim() || undefined }
      : { ativa: false as const };

  // 4. SLA a partir da previsão de entrega (ou +2 dias como padrão).
  const slaPrazo = draft.recepcao.previsaoEntrega?.trim() || new Date(Date.now() + 2 * 86400000).toISOString();

  // 5. Observações internas viram observação técnica interna (igual à V2).
  const observacoes = draft.problema.observacoesInternas?.trim()
    ? [
        {
          id: `obs-${Date.now()}`,
          autor: operador,
          conteudo: draft.problema.observacoesInternas.trim(),
          interna: true,
          criadoEm: nowIso(),
        },
      ]
    : [];

  const totais = computeTotaisNovaOSV3(draft.itens, draft.desconto);

  // 6. Extras V3 — viajam no payload (JSONB) sem tocar `@/types/os` nem o schema.
  const aberturaV3 = {
    versao: 1,
    criadoEm: nowIso(),
    criadoPor: operador,
    recepcao: {
      dataEntrada: draft.recepcao.dataEntrada,
      previsaoEntrega: draft.recepcao.previsaoEntrega,
      origem: draft.recepcao.origem,
      recebidoPor: draft.recepcao.recebidoPor?.trim() || operador,
      prioridade: draft.recepcao.prioridade,
      localFisico: draft.recepcao.localFisico,
    },
    diagnosticoInicial: {
      diagnosticoTecnico: draft.diagnostico.diagnosticoTecnico?.trim() || undefined,
      solucaoPrevista: draft.diagnostico.solucaoPrevista?.trim() || undefined,
    },
    condicaoAparelho: draft.problema.condicaoAparelho?.trim() || undefined,
    pagamentoPrevisto: {
      forma: draft.pagamento.forma,
      vencimentoPrevisto: draft.pagamento.vencimentoPrevisto,
      observacao: draft.pagamento.observacao?.trim() || undefined,
      sinal: draft.pagamento.sinal && draft.pagamento.sinal > 0 ? draft.pagamento.sinal : undefined,
    },
    garantiaPrevista: {
      modelo: modeloGarantia.id,
      label: modeloGarantia.label,
      prazoDias: prazoGarantia,
      termo: draft.garantia.termo?.trim() || undefined,
    },
    totaisPrevistos: totais,
    desconto: totais.desconto,
    itensV3: draft.itens,
  };

  const input = {
    storeId: sid,
    clienteId,
    cliente: {
      id: clienteId,
      nome,
      telefone: telefone || undefined,
      whatsapp: telefone || undefined,
      documento: documento || undefined,
      email: email || undefined,
    },
    equipamento: {
      id: `eq-${Date.now()}`,
      tipo: draft.equipamento.tipo.trim() || "Equipamento",
      marca: draft.equipamento.marca.trim(),
      modelo: draft.equipamento.modelo.trim(),
      numeroSerie: draft.equipamento.imei?.trim() || undefined,
      acessorios: draft.equipamento.acessorios.filter(Boolean),
      defeitoRelatado: draft.problema.defeitoRelatado.trim(),
    },
    status: "aberta" as const,
    prioridade: draft.recepcao.prioridade,
    origem: origemV2(draft.recepcao.origem),
    sla: { prazo: slaPrazo, status: "ok" as const },
    pecas,
    observacoes,
    anexos: [],
    garantia,
    senhaEquipamento: draft.equipamento.senha?.trim() || undefined,
    senhaEquipamentoTipo: draft.equipamento.senha?.trim() ? draft.equipamento.senhaTipo : undefined,
    servicosCatalogo,
    // Extras V3 (sobrevivem ao spread do payload):
    operacaoStatusV3: "aberta",
    aberturaV3,
    ...(extras ?? {}),
  };

  const criada = await criarOSImpl(input as unknown as Parameters<typeof criarOSImpl>[0], operador);

  // Espinha de eventos (3C.0): anuncia a abertura — produtora-only, best-effort.
  emitirEventoOperacaoV3({
    tipo: "os_criada",
    os: criada as unknown as OrdemServico,
    storeId: sid,
    origem: "nova-os",
    metadata: { origemRecepcao: draft.recepcao.origem, total: totais.total },
  });

  revalidatePath("/dashboard/operacoes-v3");
  return { os: criada as unknown as OrdemServico };
}
