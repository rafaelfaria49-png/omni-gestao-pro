import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Correção 2A.1 — uma OS NUNCA pode ter duas Contas a Receber simultâneas.
// ----------------------------------------------------------------------------
// Exercita as funções de PRODUÇÃO (receberOSV3, lerPagamentoOSV3,
// aplicarTransicaoStatusV3) e o adapter financeiro V2 REAL
// (upsertContaReceberFromOS) operando sobre um Prisma EM MEMÓRIA — o ÚNICO I/O
// mockado. Cobre: V2→V3, V3→V2, recebimento parcial, recebimento total,
// cancelamento e round-trip. Em todos, o invariante é: 1 título por OS.
// ============================================================================

const h = vi.hoisted(() => {
  type Row = any;
  const titulos = new Map<string, Row>();
  const byId = new Map<string, Row>();
  const ordens = new Map<string, any>();
  const caixaOps: any[] = [];
  let seq = 0;
  let caixaAberta = true;
  let relogio = Date.parse("2026-09-04T12:00:00.000Z");

  const tick = () => new Date(++relogio);

  const ck = (storeId: string, localKey: string) => `${storeId}::${localKey}`;

  function put(row: Row): Row {
    titulos.set(ck(row.storeId, row.localKey), row);
    byId.set(row.id, row);
    return row;
  }
  function makeRow(data: any): Row {
    const storeId = data.storeId ?? data?.store?.connect?.id;
    return {
      id: `cr-${++seq}`,
      storeId,
      localKey: data.localKey,
      descricao: data.descricao ?? "",
      cliente: data.cliente ?? "",
      valor: data.valor ?? 0,
      vencimento: data.vencimento ?? "",
      status: data.status ?? "pendente",
      payload: data.payload ?? {},
      createdAt: tick(),
      updatedAt: tick(),
    };
  }
  function applyScalars(row: Row, data: any): Row {
    for (const k of ["descricao", "cliente", "valor", "vencimento", "status", "payload"]) {
      if (data[k] !== undefined) row[k] = data[k];
    }
    row.updatedAt = tick();
    return row;
  }
  function snapshot(row: Row | null | undefined): Row | null {
    return row ? { ...row } : null;
  }

  const prisma: any = {
    contaReceberTitulo: {
      findUnique: async ({ where }: any) => {
        const { storeId, localKey } = where.storeId_localKey;
        return snapshot(titulos.get(ck(storeId, localKey)));
      },
      findFirst: async ({ where }: any) => {
        if (where?.id) {
          const r = byId.get(where.id);
          if (r && (!where.storeId || r.storeId === where.storeId)) return snapshot(r);
          return null;
        }
        for (const r of titulos.values()) if (!where?.storeId || r.storeId === where.storeId) return snapshot(r);
        return null;
      },
      findMany: async ({ where }: any) =>
        [...titulos.values()].filter((r) => !where?.storeId || r.storeId === where.storeId).map((r) => snapshot(r)),
      upsert: async ({ where, create, update }: any) => {
        const { storeId, localKey } = where.storeId_localKey;
        const existing = titulos.get(ck(storeId, localKey));
        if (existing) return snapshot(applyScalars(existing, update));
        return snapshot(put(makeRow(create)));
      },
      update: async ({ where, data }: any) => {
        let row: Row | undefined;
        if (where.id) row = byId.get(where.id);
        else if (where.storeId_localKey) {
          const { storeId, localKey } = where.storeId_localKey;
          row = titulos.get(ck(storeId, localKey));
        }
        if (!row) throw new Error("Record to update not found.");
        return snapshot(applyScalars(row, data));
      },
      updateMany: async ({ where, data }: any) => {
        const row = where.id ? byId.get(where.id) : undefined;
        if (!row || (where.storeId && row.storeId !== where.storeId)) return { count: 0 };
        const atual = row.updatedAt as Date | undefined;
        const token = where.updatedAt as Date | undefined;
        if (!atual || !token || atual.getTime() !== token.getTime()) return { count: 0 };
        applyScalars(row, data);
        return { count: 1 };
      },
      create: async ({ data }: any) => snapshot(put(makeRow(data))),
    },
    ordemServico: {
      findFirst: async ({ where }: any) => {
        const r = ordens.get(where.id);
        if (r && (!where.storeId || r.storeId === where.storeId)) return { id: r.id, payload: r.payload };
        return null;
      },
      update: async ({ where, data }: any) => {
        const r = ordens.get(where.id);
        if (r && data.payload !== undefined) r.payload = data.payload;
        return r ?? null;
      },
    },
    sessaoCaixa: {
      findFirst: async () => (caixaAberta ? { id: "sess-1", operador: "Tester", abertaEm: new Date() } : null),
    },
    caixaOperacao: {
      create: async ({ data }: any) => {
        const row = { id: `op-${++seq}`, ...data };
        caixaOps.push(row);
        return row;
      },
    },
  };

  return {
    prisma,
    titulos,
    ordens,
    caixaOps,
    setCaixa: (v: boolean) => {
      caixaAberta = v;
    },
    reset: () => {
      titulos.clear();
      byId.clear();
      ordens.clear();
      caixaOps.length = 0;
      seq = 0;
      caixaAberta = true;
      relogio = Date.parse("2026-09-04T12:00:00.000Z");
    },
  };
});

// Único I/O mockado: Prisma em memória. Demais mocks só evitam acoplar auth/caixa.
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", name: "Tester" } })) }));
vi.mock("@/lib/auth/guard-enterprise", () => ({ requireEnterpriseWith: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/financeiro/services/fechamento-service", () => ({
  verificarPeriodoFechado: vi.fn(async () => ({ fechado: false })),
}));
vi.mock("@/lib/financeiro/services/movimentacoes-service", () => ({
  createMovimentacaoEntradaFromReceber: vi.fn(async () => ({})),
}));
// GOAL OPS-V3-CANCELAR-OS-CONTRATO-SEGURO-019: cancelamento restaura estoque via
// adapter oficial — mockado aqui porque este arquivo testa a chave única de CR
// (não estoque, que tem suíte própria em estoque-sync.test.ts) e o harness Prisma
// em memória acima não modela as tabelas de produto/depósito.
vi.mock("./estoque-sync", () => ({ restaurarEstoqueOSV3: vi.fn(async () => ({ status: "restored" })) }));

import { receberOSV3, lerPagamentoOSV3, estornarRecebimentoOSV3 } from "./pdv-servico-actions";
import { aplicarTransicaoStatusV3 } from "./status-actions";
import { localKeyContaReceberOSV3 } from "./payment-model";
import { upsertContaReceberFromOS } from "@/lib/financeiro/adapters/os-faturamento";
import {
  getContaReceberByLocalKey,
  sumPagamentosFromHistoricoPayload,
} from "@/lib/financeiro/services/contas-receber-service";

const STORE = "loja-2";
const OS = "os-700";
const dinheiro = "dinheiro" as const;

function buildOrcamento(valor = 480) {
  return {
    id: "orc-1",
    status: "aprovado",
    criadoEm: "2026-06-01T00:00:00Z",
    desconto: 0,
    total: 0,
    servicos: [{ id: "s1", descricao: "Troca de tela", valor, kindV3: "cobrado" }],
    pecas: [],
  };
}

function seedOS(valor = 480) {
  h.ordens.set(OS, {
    id: OS,
    storeId: STORE,
    payload: {
      id: OS,
      codigo: "OS-100",
      operacaoStatusV3: "aberta",
      cliente: { nome: "Cliente Teste" },
      orcamento: buildOrcamento(valor),
      timeline: [],
    },
  });
}

type FatOS = Parameters<typeof upsertContaReceberFromOS>[0];
function faturamentoV2(total = 480): FatOS {
  return {
    id: OS,
    storeId: STORE,
    clienteId: "cli-1",
    cliente: { nome: "Cliente Teste" },
    status: "pronta",
    codigo: "OS-100",
    orcamento: buildOrcamento(total),
    faturamentoPendente: true,
    faturamentoStatus: "pendente",
    faturamentoOrigem: "orcamento_os",
    faturamentoTotal: total,
    faturamentoCriadoEm: "2026-06-01T00:00:00Z",
    faturamentoReferencia: `OS-100 · ${OS}`,
  } as unknown as FatOS;
}

beforeEach(() => h.reset());

describe("Correção 2A.1 — chave única: nunca duas Contas a Receber por OS", () => {
  it("a chave da V3 é exatamente a do adapter financeiro V2 (os-faturamento:*)", () => {
    expect(localKeyContaReceberOSV3(STORE, OS)).toBe(`os-faturamento:${STORE}:${OS}`);
  });

  it("V3 sozinha — recebimento PARCIAL: 1 título, saldo correto", async () => {
    seedOS(480);
    const res = await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    expect(res.op).toBe("parcial");
    expect(res.pagamento).toMatchObject({ total: 480, recebido: 200, saldo: 280, status: "parcial" });
    expect(h.titulos.size).toBe(1);
    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t).not.toBeNull();
    expect(t!.localKey).toBe(`os-faturamento:${STORE}:${OS}`);
  });

  it("V3 sozinha — recebimento TOTAL: quita, 1 título", async () => {
    seedOS(480);
    const res = await receberOSV3(STORE, OS, { valor: 480, forma: dinheiro, sessaoId: "sess-1" });
    expect(res.op).toBe("liquidar");
    expect(res.pagamento).toMatchObject({ total: 480, recebido: 480, saldo: 0, status: "quitado" });
    expect(h.titulos.size).toBe(1);
  });

  it("V2 → V3: V3 recebe NO MESMO título do adapter (não cria 2º)", async () => {
    seedOS(480);
    const v2 = await upsertContaReceberFromOS(faturamentoV2(480));
    expect(v2.ok).toBe(true);
    if (!v2.ok) throw new Error("V2 deveria faturar");
    expect(h.titulos.size).toBe(1);
    const idV2 = v2.id;

    const res = await receberOSV3(STORE, OS, { valor: 480, forma: dinheiro, sessaoId: "sess-1" });
    expect(res.pagamento.status).toBe("quitado");
    expect(h.titulos.size).toBe(1);
    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t!.id).toBe(idV2); // recebeu no título criado pela V2
    expect(t!.status).toBe("pago");
  });

  it("V3 → V2: faturar depois NÃO cria 2º título e preserva o pagamento da V3", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    expect(h.titulos.size).toBe(1);
    const idV3 = (await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS)))!.id;

    const v2 = await upsertContaReceberFromOS(faturamentoV2(480));
    expect(v2.ok).toBe(true);
    if (!v2.ok) throw new Error("V2 deveria faturar");
    expect(v2.action).toBe("updated"); // atualizou o título existente, não criou outro
    expect(h.titulos.size).toBe(1);
    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t!.id).toBe(idV3);
    // o pagamento de R$200 feito na V3 sobrevive ao upsert do adapter V2
    expect(sumPagamentosFromHistoricoPayload(t!.payload)).toBe(200);
  });

  it("round-trip V3 parcial → V2 faturar → V3 quita: sempre 1 título", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    await upsertContaReceberFromOS(faturamentoV2(480));
    const lido = await lerPagamentoOSV3(STORE, OS);
    expect(lido.recebido).toBe(200);
    expect(lido.saldo).toBe(280);
    const res = await receberOSV3(STORE, OS, { valor: lido.saldo, forma: dinheiro, sessaoId: "sess-1" });
    expect(res.pagamento.status).toBe("quitado");
    expect(h.titulos.size).toBe(1);
  });

  it("GOAL OPS-V3-CANCELAR-OS-CONTRATO-SEGURO-019 — cancelamento sem motivo é rejeitado (nada muda)", async () => {
    seedOS(480);
    await expect(aplicarTransicaoStatusV3(STORE, OS, "cancelada")).rejects.toThrow(/motivo/i);
    expect(h.ordens.get(OS).payload.operacaoStatusV3).toBe("aberta");
  });

  it("cancelamento com motivo curto (<5 caracteres) é rejeitado", async () => {
    seedOS(480);
    await expect(aplicarTransicaoStatusV3(STORE, OS, "cancelada", { motivo: "abc" })).rejects.toThrow(/mín/i);
    expect(h.ordens.get(OS).payload.operacaoStatusV3).toBe("aberta");
  });

  it("cancelamento com pagamento PARCIAL recebido: BLOQUEADO — título e status da OS permanecem intactos", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    expect(h.titulos.size).toBe(1);

    await expect(
      aplicarTransicaoStatusV3(STORE, OS, "cancelada", { motivo: "Cliente desistiu do serviço" }),
    ).rejects.toThrow("Esta OS possui pagamento recebido. Estorne o recebimento antes de cancelar.");

    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t!.status).toBe("parcial");
    expect(h.titulos.size).toBe(1);
    expect(h.ordens.get(OS).payload.operacaoStatusV3).toBe("aberta");
  });

  it("cancelamento com pagamento TOTAL recebido: BLOQUEADO — título e status da OS permanecem intactos", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 480, forma: dinheiro, sessaoId: "sess-1" });

    await expect(
      aplicarTransicaoStatusV3(STORE, OS, "cancelada", { motivo: "Cliente desistiu do serviço" }),
    ).rejects.toThrow("Esta OS possui pagamento recebido. Estorne o recebimento antes de cancelar.");

    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t!.status).toBe("pago");
    expect(h.ordens.get(OS).payload.operacaoStatusV3).toBe("aberta");
  });

  it("cancelamento SEM pagamento recebido: sucesso — cancela o CR em aberto, muda status e grava motivo na timeline", async () => {
    seedOS(480);
    await upsertContaReceberFromOS(faturamentoV2(480));
    expect(h.titulos.size).toBe(1);

    await aplicarTransicaoStatusV3(STORE, OS, "cancelada", { motivo: "Cliente desistiu do serviço" });

    const t = await getContaReceberByLocalKey(STORE, localKeyContaReceberOSV3(STORE, OS));
    expect(t!.status).toBe("cancelado");
    expect(h.titulos.size).toBe(1); // continua único, agora cancelado

    const osRow = h.ordens.get(OS);
    expect(osRow.payload.operacaoStatusV3).toBe("cancelada");
    const evento = osRow.payload.timeline.at(-1);
    expect(evento.conteudo).toContain("Cliente desistiu do serviço");
    expect(evento.metadata.motivo).toBe("Cliente desistiu do serviço");
  });

  it("cancelamento de OS nunca cobrada (sem título nenhum): sucesso, nada órfão", async () => {
    seedOS(480);
    expect(h.titulos.size).toBe(0);

    await aplicarTransicaoStatusV3(STORE, OS, "cancelada", { motivo: "Aberta por engano" });

    expect(h.titulos.size).toBe(0);
    expect(h.ordens.get(OS).payload.operacaoStatusV3).toBe("cancelada");
  });

  it("nenhuma chave receber:os:* é criada em nenhum fluxo", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    await upsertContaReceberFromOS(faturamentoV2(480));
    for (const k of h.titulos.keys()) expect(k).not.toContain("receber:os:");
  });
});

describe("Fase 2B — split, intenção, estorno", () => {
  function caixaRec(tipo: string) {
    return h.caixaOps.filter((o) => o.tipo === tipo);
  }

  it("split: soma das formas baixa o saldo e cria 1 operação de caixa POR FORMA", async () => {
    seedOS(480);
    const res = await receberOSV3(STORE, OS, {
      linhas: [
        { forma: "pix", valor: 100 },
        { forma: "dinheiro", valor: 50 },
        { forma: "credito", valor: 200 },
      ],
      sessaoId: "sess-1",
      intencao: "entrada",
    });
    expect(res.op).toBe("parcial");
    expect(res.pagamento).toMatchObject({ total: 480, recebido: 350, saldo: 130, status: "parcial" });
    expect(h.titulos.size).toBe(1);
    // uma operação de caixa por forma (fechamento separa por forma)
    const ops = caixaRec("recebimento_cr");
    expect(ops).toHaveLength(3);
    expect(ops.map((o: any) => o.payload.formaPagamento).sort()).toEqual(["credito", "dinheiro", "pix"]);
    expect(ops.reduce((s: number, o: any) => s + o.valor, 0)).toBe(350);
    // comprovante reflete o split
    expect(res.recibo.formas).toHaveLength(3);
    expect(res.recibo.valorPago).toBe(350);
    expect(res.recibo.intencaoLabel).toBe("Entrada");
  });

  it("split que cobre o saldo é registrado como Quitação", async () => {
    seedOS(480);
    const res = await receberOSV3(STORE, OS, {
      linhas: [
        { forma: "pix", valor: 280 },
        { forma: "dinheiro", valor: 200 },
      ],
      sessaoId: "sess-1",
      intencao: "parcial",
    });
    expect(res.op).toBe("liquidar");
    expect(res.pagamento.status).toBe("quitado");
    expect(res.recibo.intencaoLabel).toBe("Quitação");
  });

  it("split acima do saldo é rejeitado (não recebe mais que o saldo)", async () => {
    seedOS(480);
    await expect(
      receberOSV3(STORE, OS, {
        linhas: [
          { forma: "pix", valor: 300 },
          { forma: "dinheiro", valor: 300 },
        ],
        sessaoId: "sess-1",
      }),
    ).rejects.toThrow();
    // nada recebido
    const lido = await lerPagamentoOSV3(STORE, OS);
    expect(lido.recebido).toBe(0);
  });

  it("estorno auditado reverte o último recebimento e registra operação de caixa", async () => {
    seedOS(480);
    await receberOSV3(STORE, OS, { valor: 200, forma: dinheiro, sessaoId: "sess-1" });
    let lido = await lerPagamentoOSV3(STORE, OS);
    expect(lido.recebido).toBe(200);

    const res = await estornarRecebimentoOSV3(STORE, OS, { sessaoId: "sess-1", motivo: "Correção" });
    expect(res.estornado).toBe(200);
    expect(res.pagamento).toMatchObject({ recebido: 0, saldo: 480, status: "aberto" });
    expect(h.titulos.size).toBe(1); // sem duplicar título
    expect(caixaRec("estorno_recebimento_cr")).toHaveLength(1);

    lido = await lerPagamentoOSV3(STORE, OS);
    expect(lido.recebido).toBe(0);
  });

  it("estorno sem recebimento prévio é rejeitado", async () => {
    seedOS(480);
    await expect(estornarRecebimentoOSV3(STORE, OS, { sessaoId: "sess-1" })).rejects.toThrow();
  });
});
