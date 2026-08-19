import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { localKeyContaReceberOSV3 } from "./payment-model";

const mocks = vi.hoisted(() => ({
  osFindFirst: vi.fn(),
  osUpdate: vi.fn(),
  tituloFindUnique: vi.fn(),
  auth: vi.fn(),
  requireEnterpriseWith: vi.fn(),
  consumirEstoque: vi.fn(),
  emitirEvento: vi.fn(),
  revalidatePath: vi.fn(),
  autoClose: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ordemServico: { findFirst: mocks.osFindFirst, update: mocks.osUpdate },
    contaReceberTitulo: { findUnique: mocks.tituloFindUnique },
  },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/guard-enterprise", () => ({ requireEnterpriseWith: mocks.requireEnterpriseWith }));
vi.mock("@/lib/operacoes/assert-active-store", () => ({ assertActiveStoreId: vi.fn() }));
vi.mock("./estoque-sync", () => ({ consumirEstoqueOSV3: mocks.consumirEstoque }));
vi.mock("./event-publisher", () => ({ emitirEventoOperacaoV3: mocks.emitirEvento }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./retorno-auto-close-actions", () => ({ finalizarRetornoPorEntregaVinculadaV3: mocks.autoClose }));

import { registrarEntregaV3 } from "./entrega-actions";

const storeId = "store-a";
const osId = "os-1";
const localKey = localKeyContaReceberOSV3(storeId, osId);

function payload(total = 100, over: Record<string, unknown> = {}) {
  return {
    id: osId,
    codigo: "OS-1",
    status: "pronta",
    operacaoStatusV3: "pronta",
    cliente: { id: "cli-1", nome: "Cliente" },
    timeline: [],
    orcamento: {
      id: "orc-1",
      status: "aprovado",
      sintetizado: false,
      total,
      desconto: 0,
      servicos: total > 0 ? [{ id: "serv-1", descricao: "Serviço", valor: total }] : [],
      pecas: [],
      criadoEm: "2026-07-01T10:00:00.000Z",
    },
    ...over,
  };
}

function row(total = 100, over: Record<string, unknown> = {}) {
  return { id: osId, valorTotal: total, payload: payload(total, over) };
}

function titulo(over: Record<string, unknown> = {}) {
  return {
    id: "titulo-1",
    storeId,
    localKey,
    valor: 100,
    status: "pago",
    payload: { ordemServicoId: osId, historico: [{ tipo: "liquidacao", valor: 100 }] },
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T15:30:00.000Z"));
  mocks.osFindFirst.mockReset().mockResolvedValue(row());
  mocks.osUpdate.mockReset().mockResolvedValue({});
  mocks.tituloFindUnique.mockReset().mockResolvedValue(titulo());
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "server-user", name: "Operadora Server", email: "server@example.com" } });
  mocks.requireEnterpriseWith.mockReset().mockResolvedValue({ ok: true });
  mocks.consumirEstoque.mockReset().mockResolvedValue({ status: "consumed", itens: 1 });
  mocks.emitirEvento.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.autoClose.mockReset().mockResolvedValue({ status: "skipped" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registrarEntregaV3 — guard financeiro server-side", () => {
  it("permite OS quitada e só executa estoque/evento depois do write de entrega", async () => {
    await registrarEntregaV3(storeId, osId);

    expect(mocks.tituloFindUnique).toHaveBeenCalledWith({ where: { storeId_localKey: { storeId, localKey } } });
    expect(mocks.osUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.consumirEstoque).toHaveBeenCalledTimes(1);
    expect(mocks.emitirEvento).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ decisaoFinanceira: "ALLOW_PAID", entregaSemCobranca: false }),
    }));
    expect(mocks.osUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.consumirEstoque.mock.invocationCallOrder[0]);
  });

  it("bloqueia chamada direta com saldo aberto e não produz efeito parcial", async () => {
    mocks.tituloFindUnique.mockResolvedValue(titulo({ status: "pendente", payload: { ordemServicoId: osId, historico: [] } }));

    await expect(registrarEntregaV3(storeId, osId)).rejects.toThrow(
      "Esta OS possui saldo pendente. Receba o valor ou autorize o pagamento a prazo antes de confirmar a entrega.",
    );
    expect(mocks.osUpdate).not.toHaveBeenCalled();
    expect(mocks.consumirEstoque).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.autoClose).not.toHaveBeenCalled();
  });

  it("bloqueia pagamento parcial na chamada direta", async () => {
    mocks.tituloFindUnique.mockResolvedValue(titulo({ status: "parcial", payload: { historico: [{ tipo: "pagamento", valor: 40 }] } }));
    await expect(registrarEntregaV3(storeId, osId)).rejects.toThrow(/saldo pendente/i);
    expect(mocks.osUpdate).not.toHaveBeenCalled();
  });

  it("bloqueia total positivo sem título", async () => {
    mocks.tituloFindUnique.mockResolvedValue(null);
    await expect(registrarEntregaV3(storeId, osId)).rejects.toThrow(/Não foi possível confirmar a situação financeira/i);
    expect(mocks.osUpdate).not.toHaveBeenCalled();
  });

  it("persiste cortesia com ator/loja/horário do servidor e evento de timeline", async () => {
    mocks.osFindFirst.mockResolvedValue(row(0));
    mocks.tituloFindUnique.mockResolvedValue(null);

    await registrarEntregaV3(storeId, osId, {
      semCobranca: {
        categoria: "cortesia",
        motivo: "  Relacionamento comercial  ",
        autorizadoPorId: "client-user",
        autorizadoPorNome: "Cliente forjado",
        autorizadoEm: "2000-01-01T00:00:00.000Z",
        storeId: "store-forjada",
      } as never,
    });

    const write = mocks.osUpdate.mock.calls[0]![0] as { data: { payload: Record<string, unknown> } };
    const next = write.data.payload;
    expect(next.entregaSemCobrancaV3).toMatchObject({
      versao: 1,
      categoria: "cortesia",
      motivo: "Relacionamento comercial",
      autorizadoPorId: "server-user",
      autorizadoPorNome: "Operadora Server",
      autorizadoEm: "2026-07-15T15:30:00.000Z",
      storeId,
      status: "ativo",
      snapshotFinanceiro: { decisao: "ALLOW_AUTHORIZED_NO_CHARGE" },
    });
    expect(next.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tipo: "observacao",
        metadata: expect.objectContaining({ evento: "entrega_sem_cobranca_autorizada", entregaSemCobranca: true }),
      }),
      expect.objectContaining({
        tipo: "entrega_cliente",
        metadata: expect.objectContaining({ decisaoFinanceira: "ALLOW_AUTHORIZED_NO_CHARGE", entregaSemCobranca: true }),
      }),
    ]));
  });

  it("persiste garantia sem cobrança e permite entrega", async () => {
    mocks.osFindFirst.mockResolvedValue(row(0));
    mocks.tituloFindUnique.mockResolvedValue(null);
    await registrarEntregaV3(storeId, osId, { semCobranca: { categoria: "garantia", motivo: "Retorno coberto" } });
    const next = (mocks.osUpdate.mock.calls[0]![0] as { data: { payload: Record<string, unknown> } }).data.payload;
    expect(next.entregaSemCobrancaV3).toMatchObject({ categoria: "garantia", autorizadoPorId: "server-user" });
  });

  it("rejeita categoria inválida e motivo vazio no servidor", async () => {
    mocks.osFindFirst.mockResolvedValue(row(0));
    mocks.tituloFindUnique.mockResolvedValue(null);
    await expect(registrarEntregaV3(storeId, osId, { semCobranca: { categoria: "outra", motivo: "Motivo" } as never })).rejects.toThrow(/categoria válida/i);
    await expect(registrarEntregaV3(storeId, osId, { semCobranca: { categoria: "cortesia", motivo: "  " } })).rejects.toThrow(/motivo/i);
    expect(mocks.osUpdate).not.toHaveBeenCalled();
  });

  it("permite contrato a prazo existente somente quando espelho e título são válidos", async () => {
    mocks.osFindFirst.mockResolvedValue(row(100, {
      aPrazoV3: {
        modo: "a_prazo",
        status: "pendente",
        valor: 100,
        vencimento: "2026-08-15",
        tituloLocalKey: localKey,
        autorizadoEntrega: true,
        autorizadoEm: "2026-07-15T12:00:00.000Z",
        autorizadoPor: "Operadora Server",
      },
    }));
    mocks.tituloFindUnique.mockResolvedValue(titulo({
      status: "pendente",
      payload: { ordemServicoId: osId, historico: [{ tipo: "a_prazo_autorizado", valor: 100 }] },
    }));

    await registrarEntregaV3(storeId, osId);
    expect(mocks.emitirEvento).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ decisaoFinanceira: "ALLOW_AUTHORIZED_CREDIT" }),
    }));
  });

  it("falha fechada quando a leitura da Conta a Receber lança erro", async () => {
    mocks.tituloFindUnique.mockRejectedValue(new Error("database unavailable"));
    await expect(registrarEntregaV3(storeId, osId)).rejects.toThrow(
      "Não foi possível confirmar a situação financeira desta OS. Revise a cobrança antes de entregar.",
    );
    expect(mocks.osUpdate).not.toHaveBeenCalled();
    expect(mocks.consumirEstoque).not.toHaveBeenCalled();
  });

  it("bloqueia tentativa cross-store antes da leitura financeira", async () => {
    mocks.osFindFirst.mockResolvedValue(null);
    await expect(registrarEntregaV3("store-b", osId)).rejects.toThrow("OS não encontrada.");
    expect(mocks.osFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: osId, storeId: "store-b" } }));
    expect(mocks.tituloFindUnique).not.toHaveBeenCalled();
    expect(mocks.osUpdate).not.toHaveBeenCalled();
  });

  it("OS já entregue preserva idempotência sem reler financeiro nem repetir efeitos", async () => {
    const entregue = payload(100, { operacaoStatusV3: "entregue", status: "entregue" });
    mocks.osFindFirst.mockResolvedValue({ id: osId, valorTotal: 100, payload: entregue });

    await expect(registrarEntregaV3(storeId, osId)).resolves.toBe(entregue);
    expect(mocks.tituloFindUnique).not.toHaveBeenCalled();
    expect(mocks.osUpdate).not.toHaveBeenCalled();
    expect(mocks.consumirEstoque).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
    expect(mocks.autoClose).toHaveBeenCalledTimes(1);
    expect(mocks.autoClose).toHaveBeenCalledWith(expect.objectContaining({
      storeId,
      osFilha: expect.objectContaining({ id: osId }),
    }));
  });

  it("após persistir a entrega, tenta finalizar o retorno original vinculado", async () => {
    await registrarEntregaV3(storeId, osId);
    expect(mocks.osUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.autoClose).toHaveBeenCalledTimes(1);
    expect(mocks.osUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.autoClose.mock.invocationCallOrder[0]);
  });
});
