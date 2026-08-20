import type { Prisma } from "@/generated/prisma";
import type { OrdemServico, Orcamento, PecaUsada, EventoTimeline } from "@/types/os";
import { prisma } from "@/lib/prisma";
import { nowIso } from "@/lib/operacoes/services/os-helpers";
import { selectEstoquePecaSource } from "@/lib/operacoes/services/orcamento-builder";

export type EstoqueMovimentoPayload = {
  id: string;
  produtoId: string;
  nome: string;
  quantidade: number;
  estoqueAnterior: number;
  estoqueDepois: number;
  origem: "operacoes-hub-v2";
  ordemServicoId: string;
  createdAt: string;
};

export type EstoqueBuildIgnored = {
  source: "payload.pecas" | "payload.orcamento.pecas";
  ref: string;
  reason: "no_produto_match" | "invalid_qty";
};

export type EstoqueBuildItem = {
  source: "payload.pecas" | "payload.orcamento.pecas";
  produtoId: string;
  nome: string;
  quantidade: number;
  precoUnitario?: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function safeQty(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : 0;
}

function arredonda2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function getEstoqueLocalKey(storeId: string, ordemServicoId: string): string {
  return `os-estoque:${storeId}:${ordemServicoId}`;
}

export function hasEstoqueAlreadyConsumed(os: Partial<OrdemServico> & { estoqueConsumido?: unknown }): boolean {
  return os.estoqueConsumido === true;
}

export function isOSEstoqueConsumivel(os: Partial<OrdemServico> & { storeId?: unknown; id?: unknown; status?: unknown }): boolean {
  return typeof os?.storeId === "string" && typeof os?.id === "string";
}

function listCandidatePecas(os: Partial<OrdemServico>): { source: EstoqueBuildItem["source"]; rows: PecaUsada[] }[] {
  const direct = Array.isArray((os as { pecas?: unknown }).pecas) ? ((os as { pecas?: unknown }).pecas as PecaUsada[]) : [];
  const orc: Orcamento | undefined = isRecord((os as { orcamento?: unknown }).orcamento) ? ((os as { orcamento?: unknown }).orcamento as Orcamento) : undefined;
  const orcPecas = Array.isArray((orc as { pecas?: unknown } | undefined)?.pecas) ? ((orc as { pecas?: unknown }).pecas as PecaUsada[]) : [];
  // Fonte ÚNICA de peças (anti dupla-baixa): o orçamento é autoritativo quando tem peças
  // (pode ter sido editado); senão usa payload.pecas. Antes, ambas eram somadas por produtoId.
  return [selectEstoquePecaSource(direct, orcPecas)];
}

async function resolveProdutoId(params: { storeId: string; peca: PecaUsada }): Promise<{ produtoId: string; nome: string; precoUnitario?: number } | null> {
  // 1) tentativa por produtoId (novo padrão)
  const produtoId = safeStr((params.peca as unknown as { produtoId?: unknown }).produtoId);
  if (produtoId) {
    const byProdutoId = await prisma.produto.findFirst({
      where: { id: produtoId, storeId: params.storeId },
      select: { id: true, name: true, price: true },
    });
    if (byProdutoId) return { produtoId: byProdutoId.id, nome: byProdutoId.name, precoUnitario: byProdutoId.price };
  }

  // 2) tentativa por id direto (legado: algumas peças usam `id` como Produto.id)
  const byId = await prisma.produto.findFirst({
    where: { id: params.peca.id, storeId: params.storeId },
    select: { id: true, name: true, price: true },
  });
  if (byId) return { produtoId: byId.id, nome: byId.name, precoUnitario: byId.price };

  // 3) tentativa por SKU (fallback obrigatório)
  const sku = safeStr((params.peca as { sku?: unknown }).sku);
  if (sku) {
    const bySku = await prisma.produto.findFirst({
      where: { sku, storeId: params.storeId },
      select: { id: true, name: true, price: true },
    });
    if (bySku) return { produtoId: bySku.id, nome: bySku.name, precoUnitario: bySku.price };
  }

  return null;
}

export async function buildEstoqueMovimentosFromOS(os: OrdemServico): Promise<{
  items: EstoqueBuildItem[];
  ignored: EstoqueBuildIgnored[];
}> {
  const storeId = os.storeId;
  const items: EstoqueBuildItem[] = [];
  const ignored: EstoqueBuildIgnored[] = [];

  for (const group of listCandidatePecas(os)) {
    for (const p of group.rows) {
      const quantidade = safeQty(p.quantidade);
      if (quantidade < 1) {
        ignored.push({ source: group.source, ref: p.id, reason: "invalid_qty" });
        continue;
      }
      const resolved = await resolveProdutoId({ storeId, peca: p });
      if (!resolved) {
        ignored.push({ source: group.source, ref: p.id || p.nome, reason: "no_produto_match" });
        continue;
      }
      const unitFromPeca =
        typeof (p as { valorUnitario?: unknown }).valorUnitario === "number"
          ? Number((p as { valorUnitario?: number }).valorUnitario)
          : undefined;
      items.push({
        source: group.source,
        produtoId: resolved.produtoId,
        nome: resolved.nome,
        quantidade,
        precoUnitario:
          unitFromPeca !== undefined && Number.isFinite(unitFromPeca) && unitFromPeca >= 0
            ? unitFromPeca
            : resolved.precoUnitario,
      });
    }
  }

  // merge por produtoId (evita duplicidade)
  const m = new Map<string, EstoqueBuildItem>();
  for (const it of items) {
    const prev = m.get(it.produtoId);
    if (!prev) {
      m.set(it.produtoId, { ...it });
    } else {
      m.set(it.produtoId, { ...prev, quantidade: prev.quantidade + it.quantidade });
    }
  }

  return { items: [...m.values()], ignored };
}

type ConsumeResult =
  | { ok: true; status: "consumed" | "already_consumed" | "nothing_to_consume"; movimentos: EstoqueMovimentoPayload[]; ignored: EstoqueBuildIgnored[] }
  | { ok: false; status: "error"; error: string; ignored: EstoqueBuildIgnored[] };

function newId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `${prefix}_${(crypto as Crypto).randomUUID()}` : `${prefix}_${Date.now()}`;
}

function makeEv(tipo: EventoTimeline["tipo"], conteudo: string, metadata?: Record<string, unknown>): EventoTimeline {
  return { id: newId("ev"), tipo, autor: "Sistema", autorTipo: "sistema", conteudo, metadata, criadoEm: nowIso() };
}

/**
 * Registra a baixa/retorno no livro-razão de estoque (MovimentacaoEstoque).
 * Best-effort: roda dentro da transação da OS, mas NUNCA quebra o fluxo — se falhar,
 * apenas loga (o estoque já é a fonte da verdade; a trilha é complementar).
 */
async function registrarLedgerOS(
  tx: Prisma.TransactionClient,
  params: {
    storeId: string;
    osId: string;
    osNumero?: string | null;
    operador?: string | null;
    produtoId: string;
    sku: string | null;
    nome: string;
    custoMedio: number;
    tipo: "saida" | "entrada";
    quantidadeAbs: number;
    estoqueAntes: number;
    estoqueDepois: number;
  }
): Promise<void> {
  try {
    const numero = (params.osNumero ?? "").trim();
    const docLabel = numero || `OS ${params.osId}`;
    const operador = (params.operador ?? "").trim() || null;
    // Custo unitário e valor total refletem o custo médio atual do produto — base para KPIs de
    // valor consumido por OS. Em entrada (restauração), representa o valor reintegrado ao estoque.
    const custoUnitario = arredonda2(Math.max(0, params.custoMedio));
    const valorTotal = arredonda2(params.quantidadeAbs * custoUnitario);
    await tx.movimentacaoEstoque.create({
      data: {
        storeId: params.storeId,
        produtoId: params.produtoId,
        produtoSku: params.sku,
        produtoNome: params.nome,
        tipo: params.tipo,
        origem: "os",
        quantidade: params.tipo === "saida" ? -params.quantidadeAbs : params.quantidadeAbs,
        estoqueAntes: params.estoqueAntes,
        estoqueDepois: params.estoqueDepois,
        custoUnitario,
        custoMedioAntes: params.custoMedio,
        custoMedioDepois: params.custoMedio,
        valorTotal,
        documento: docLabel,
        motivo: docLabel,
        usuario: operador,
      },
    });
  } catch (e) {
    console.error(
      "[os-estoque] falha ao registrar movimentação no livro-razão (ignorado):",
      e instanceof Error ? e.message : e
    );
  }
}

export async function consumeEstoqueFromOS(params: { storeId: string; osId: string; osPayload?: OrdemServico; operador?: string | null }): Promise<ConsumeResult> {
  if (!params.storeId || !params.osId) return { ok: false, status: "error", error: "Parâmetros inválidos", ignored: [] };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.ordemServico.findFirst({
        where: { id: params.osId, storeId: params.storeId },
        select: { id: true, storeId: true, numero: true, payload: true },
      });
      if (!row) throw new Error("OS não encontrada");
      const osNumero = row.numero ?? null;

      const payload = (params.osPayload ?? (row.payload as unknown as OrdemServico)) as OrdemServico;
      if (!isOSEstoqueConsumivel(payload)) throw new Error("OS inválida para consumo de estoque");

      if (hasEstoqueAlreadyConsumed(payload)) {
        return { ok: true as const, status: "already_consumed" as const, movimentos: [] as EstoqueMovimentoPayload[], ignored: [] as EstoqueBuildIgnored[] };
      }

      const { items, ignored } = await buildEstoqueMovimentosFromOS(payload);
      if (items.length === 0) {
        // Marca como consumido só se não houver nada para consumir? Nesta fase, não: evita bloquear consumo futuro quando IDs forem normalizados.
        return { ok: true as const, status: "nothing_to_consume" as const, movimentos: [] as EstoqueMovimentoPayload[], ignored };
      }

      const movimentos: EstoqueMovimentoPayload[] = [];

      // Valida tudo primeiro (evita baixa parcial)
      for (const it of items) {
        const p = await tx.produto.findFirst({ where: { id: it.produtoId, storeId: params.storeId }, select: { id: true, stock: true, name: true } });
        if (!p) throw new Error(`Produto não encontrado: ${it.produtoId}`);
        if (p.stock < it.quantidade) throw new Error(`Estoque insuficiente para "${p.name}" (disponível: ${p.stock}).`);
      }

      // Aplica baixa + cria itens da OS
      for (const it of items) {
        const p = await tx.produto.findFirstOrThrow({ where: { id: it.produtoId, storeId: params.storeId }, select: { id: true, stock: true, name: true, price: true, sku: true, precoCusto: true } });
        const anterior = p.stock;
        const depois = anterior - it.quantidade;

        await tx.produto.update({ where: { id: p.id }, data: { stock: { decrement: it.quantidade } } });
        const unit =
          typeof it.precoUnitario === "number" && Number.isFinite(it.precoUnitario) && it.precoUnitario >= 0
            ? it.precoUnitario
            : p.price;
        await tx.ordemServicoItem.create({
          data: {
            ordemServicoId: params.osId,
            produtoId: p.id,
            tipo: "peca",
            descricao: it.nome || p.name,
            quantidade: it.quantidade,
            precoUnitario: unit,
            observacao: "",
          },
        });

        await registrarLedgerOS(tx, {
          storeId: params.storeId,
          osId: params.osId,
          osNumero,
          operador: params.operador ?? null,
          produtoId: p.id,
          sku: p.sku,
          nome: p.name,
          custoMedio: p.precoCusto ?? 0,
          tipo: "saida",
          quantidadeAbs: it.quantidade,
          estoqueAntes: anterior,
          estoqueDepois: depois,
        });

        movimentos.push({
          id: newId("mov"),
          produtoId: p.id,
          nome: p.name,
          quantidade: it.quantidade,
          estoqueAnterior: anterior,
          estoqueDepois: depois,
          origem: "operacoes-hub-v2",
          ordemServicoId: params.osId,
          createdAt: nowIso(),
        });
      }

      const ts = nowIso();
      const nextPayload: OrdemServico & Record<string, unknown> = {
        ...(payload as OrdemServico & Record<string, unknown>),
        estoqueConsumido: true,
        estoqueConsumidoEm: ts,
        estoqueMovimentos: [...(Array.isArray((payload as any).estoqueMovimentos) ? (payload as any).estoqueMovimentos : []), ...movimentos],
        atualizadoEm: ts,
      };

      const timeline = Array.isArray((nextPayload as any).timeline) ? ((nextPayload as any).timeline as EventoTimeline[]) : [];
      const evs: EventoTimeline[] = [
        makeEv("estoque_consumido", "Estoque consumido (baixa real) da OS.", { count: movimentos.length, ignored: ignored.length, origem: "os" }),
        ...movimentos.map((m) => makeEv("estoque_item_consumido", `Item consumido: ${m.quantidade}× ${m.nome}.`, { produtoId: m.produtoId, quantidade: m.quantidade })),
      ];
      (nextPayload as any).timeline = [...timeline, ...evs];

      await tx.ordemServico.update({
        where: { id: params.osId },
        data: { payload: nextPayload as unknown as Prisma.InputJsonValue },
      });

      return { ok: true as const, status: "consumed" as const, movimentos, ignored };
    });

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Não quebra o fluxo: quem chama decide como registrar.
    return { ok: false, status: "error", error: msg, ignored: [] };
  }
}

export async function restoreEstoqueFromOS(params: {
  storeId: string;
  osId: string;
  motivo?: "manual" | "automatico";
  operador?: string | null;
}): Promise<{ ok: boolean; status: string; error?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.ordemServico.findFirst({ where: { id: params.osId, storeId: params.storeId }, select: { numero: true, payload: true } });
      if (!row) throw new Error("OS não encontrada");
      const osNumero = row.numero ?? null;
      const payload = row.payload as unknown as (OrdemServico & Record<string, unknown>);
      if (payload.estoqueConsumido !== true) {
        return;
      }
      if (payload.estoqueRestaurado === true) {
        return;
      }

      // Restaura estoque a partir de OrdemServicoItem real
      const itens = await tx.ordemServicoItem.findMany({ where: { ordemServicoId: params.osId } });
      for (const it of itens) {
        if (!it.produtoId) continue;
        const p = await tx.produto.findFirst({
          where: { id: it.produtoId, storeId: params.storeId },
          select: { id: true, stock: true, name: true, sku: true, precoCusto: true },
        });
        await tx.produto.update({ where: { id: it.produtoId }, data: { stock: { increment: it.quantidade } } });
        if (p) {
          await registrarLedgerOS(tx, {
            storeId: params.storeId,
            osId: params.osId,
            osNumero,
            operador: params.operador ?? null,
            produtoId: p.id,
            sku: p.sku,
            nome: p.name,
            custoMedio: p.precoCusto ?? 0,
            tipo: "entrada",
            quantidadeAbs: it.quantidade,
            estoqueAntes: p.stock,
            estoqueDepois: p.stock + it.quantidade,
          });
        }
      }
      await tx.ordemServicoItem.deleteMany({ where: { ordemServicoId: params.osId } });

      const ts = nowIso();
      const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
      const nextPayload = {
        ...payload,
        estoqueRestaurado: true,
        estoqueRestauradoEm: ts,
        atualizadoEm: ts,
        timeline: [
          ...timeline,
          makeEv(
            params.motivo === "automatico" ? "estoque_restaurado_automaticamente" : "estoque_restaurado",
            params.motivo === "automatico"
              ? "Estoque restaurado automaticamente ao reabrir/cancelar a OS."
              : "Estoque restaurado (estorno) para a OS.",
            { count: itens.length }
          ),
        ],
      };
      await tx.ordemServico.update({ where: { id: params.osId }, data: { payload: nextPayload as unknown as Prisma.InputJsonValue } });
    });
    return { ok: true, status: "restored" };
  } catch (e) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export type EstoqueDeltaItem = {
  produtoId: string;
  quantidadeAnterior: number;
  quantidadeNova: number;
  diferenca: number;
  tipo: "consumo" | "restauracao";
  createdAt: string;
};

function sumByProdutoIdFromItens(itens: { produtoId: string | null; quantidade: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of itens) {
    const pid = typeof it.produtoId === "string" ? it.produtoId.trim() : "";
    if (!pid) continue;
    const prev = m.get(pid) ?? 0;
    m.set(pid, prev + Math.floor(Number(it.quantidade) || 0));
  }
  return m;
}

export function computeEstoqueDelta(params: {
  consumedByProdutoId: Map<string, number>;
  desiredByProdutoId: Map<string, number>;
  createdAt?: string;
}): EstoqueDeltaItem[] {
  const ts = params.createdAt ?? nowIso();
  const keys = new Set<string>([...params.consumedByProdutoId.keys(), ...params.desiredByProdutoId.keys()]);
  const out: EstoqueDeltaItem[] = [];
  for (const produtoId of keys) {
    const anterior = params.consumedByProdutoId.get(produtoId) ?? 0;
    const nova = params.desiredByProdutoId.get(produtoId) ?? 0;
    const diff = nova - anterior;
    if (diff === 0) continue;
    out.push({
      produtoId,
      quantidadeAnterior: anterior,
      quantidadeNova: nova,
      diferenca: diff,
      tipo: diff > 0 ? "consumo" : "restauracao",
      createdAt: ts,
    });
  }
  return out;
}

export async function applyEstoqueDelta(params: {
  storeId: string;
  osId: string;
  osPayload?: OrdemServico;
  revisaoKey: string; // idempotência por revisão (ex.: orcamentoRevisaoAtual.revisadoEm)
  operador?: string | null;
}): Promise<{ ok: boolean; status: "applied" | "no_delta" | "already_applied" | "skipped" | "error"; error?: string; delta?: EstoqueDeltaItem[] }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.ordemServico.findFirst({ where: { id: params.osId, storeId: params.storeId }, select: { numero: true, payload: true } });
      if (!row) throw new Error("OS não encontrada");
      const osNumero = row.numero ?? null;
      const payload = (params.osPayload ?? (row.payload as unknown as OrdemServico)) as (OrdemServico & Record<string, unknown>);

      if (payload.estoqueConsumido !== true) return { ok: true as const, status: "skipped" as const };
      if (payload.estoqueRestaurado === true) return { ok: true as const, status: "skipped" as const };

      const ultima = typeof payload.estoqueUltimaRevisaoEm === "string" ? payload.estoqueUltimaRevisaoEm : "";
      if (ultima && ultima === params.revisaoKey) {
        return { ok: true as const, status: "already_applied" as const };
      }

      const itens = await tx.ordemServicoItem.findMany({ where: { ordemServicoId: params.osId }, select: { id: true, produtoId: true, quantidade: true } });
      const consumed = sumByProdutoIdFromItens(itens);

      const { items } = await buildEstoqueMovimentosFromOS(payload as unknown as OrdemServico);
      const desired = new Map<string, number>();
      for (const it of items) {
        const prev = desired.get(it.produtoId) ?? 0;
        desired.set(it.produtoId, prev + Math.floor(Number(it.quantidade) || 0));
      }

      const delta = computeEstoqueDelta({ consumedByProdutoId: consumed, desiredByProdutoId: desired, createdAt: nowIso() });
      if (delta.length === 0) {
        const ts = nowIso();
        const nextPayload = {
          ...payload,
          estoqueUltimaRevisaoEm: params.revisaoKey,
          atualizadoEm: ts,
        };
        await tx.ordemServico.update({ where: { id: params.osId }, data: { payload: nextPayload as unknown as Prisma.InputJsonValue } });
        return { ok: true as const, status: "no_delta" as const, delta };
      }

      // Valida consumo adicional antes de aplicar (evita parcial)
      for (const d of delta) {
        if (d.tipo !== "consumo") continue;
        const p = await tx.produto.findFirst({ where: { id: d.produtoId, storeId: params.storeId }, select: { id: true, stock: true, name: true } });
        if (!p) throw new Error(`Produto não encontrado: ${d.produtoId}`);
        if (p.stock < d.diferenca) throw new Error(`Estoque insuficiente para "${p.name}" (necessário: ${d.diferenca}, disponível: ${p.stock}).`);
      }

      // Aplica delta (consumo/restauração parcial)
      for (const d of delta) {
        if (d.tipo === "consumo") {
          const p = await tx.produto.findFirstOrThrow({
            where: { id: d.produtoId, storeId: params.storeId },
            select: { id: true, price: true, stock: true, name: true, sku: true, precoCusto: true },
          });
          await tx.produto.update({ where: { id: d.produtoId }, data: { stock: { decrement: d.diferenca } } });
          await tx.ordemServicoItem.create({
            data: {
              ordemServicoId: params.osId,
              produtoId: d.produtoId,
              tipo: "peca",
              descricao: "",
              quantidade: d.diferenca,
              precoUnitario: p.price,
              observacao: "",
            },
          });
          await registrarLedgerOS(tx, {
            storeId: params.storeId,
            osId: params.osId,
            osNumero,
            operador: params.operador ?? null,
            produtoId: p.id,
            sku: p.sku,
            nome: p.name,
            custoMedio: p.precoCusto ?? 0,
            tipo: "saida",
            quantidadeAbs: d.diferenca,
            estoqueAntes: p.stock,
            estoqueDepois: p.stock - d.diferenca,
          });
        } else {
          const toRestore = Math.abs(d.diferenca);
          const pRest = await tx.produto.findFirst({
            where: { id: d.produtoId, storeId: params.storeId },
            select: { id: true, stock: true, name: true, sku: true, precoCusto: true },
          });
          await tx.produto.update({ where: { id: d.produtoId }, data: { stock: { increment: toRestore } } });
          if (pRest) {
            await registrarLedgerOS(tx, {
              storeId: params.storeId,
              osId: params.osId,
              osNumero,
              operador: params.operador ?? null,
              produtoId: pRest.id,
              sku: pRest.sku,
              nome: pRest.name,
              custoMedio: pRest.precoCusto ?? 0,
              tipo: "entrada",
              quantidadeAbs: toRestore,
              estoqueAntes: pRest.stock,
              estoqueDepois: pRest.stock + toRestore,
            });
          }

          let remaining = toRestore;
          const rows = itens.filter((it) => it.produtoId && it.produtoId === d.produtoId);
          for (const it of rows) {
            if (remaining <= 0) break;
            const q = Math.floor(Number(it.quantidade) || 0);
            if (q <= 0) continue;
            if (q <= remaining) {
              await tx.ordemServicoItem.delete({ where: { id: it.id } });
              remaining -= q;
            } else {
              await tx.ordemServicoItem.update({ where: { id: it.id }, data: { quantidade: q - remaining } });
              remaining = 0;
            }
          }
        }
      }

      const ts = nowIso();
      const timeline = Array.isArray(payload.timeline) ? (payload.timeline as EventoTimeline[]) : [];
      const hist = Array.isArray(payload.estoqueDeltaHistorico) ? (payload.estoqueDeltaHistorico as EstoqueDeltaItem[]) : [];
      const nextPayload = {
        ...payload,
        estoqueUltimaRevisaoEm: params.revisaoKey,
        estoqueDeltaHistorico: [...hist, ...delta],
        atualizadoEm: ts,
        timeline: [
          ...timeline,
          makeEv("estoque_delta_aplicado", "Delta de estoque aplicado após revisão.", { revisaoKey: params.revisaoKey, itens: delta.length }),
        ],
      };

      await tx.ordemServico.update({ where: { id: params.osId }, data: { payload: nextPayload as unknown as Prisma.InputJsonValue } });
      return { ok: true as const, status: "applied" as const, delta };
    });

    return result;
  } catch (e) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

