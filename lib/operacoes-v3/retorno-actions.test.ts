import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  auth: vi.fn(),
  guard: vi.fn(),
  assertStore: vi.fn(),
  emitirEvento: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { ordemServico: { findFirst: mocks.findFirst, update: mocks.update } },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/guard-enterprise", () => ({ requireEnterpriseWith: mocks.guard }));
vi.mock("@/lib/operacoes/assert-active-store", () => ({ assertActiveStoreId: mocks.assertStore }));
vi.mock("./event-publisher", () => ({ emitirEventoOperacaoV3: mocks.emitirEvento }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { abrirRetornoV3, finalizarRetornoV3 } from "./retorno-actions";

const storeId = "store-real";
const osId = "os-1042";

function payload(extra: Record<string, unknown> = {}) {
  return {
    id: osId,
    codigo: "OS-1042",
    status: "entregue",
    operacaoStatusV3: "entregue",
    cliente: { nome: "Cliente" },
    entregaV3: { entregueEm: "2026-08-01T12:00:00.000Z" },
    aberturaV3: { garantiaPrevista: { modelo: "tela", label: "Troca de tela", prazoDias: 90 } },
    timeline: [],
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
  mocks.findFirst.mockReset().mockResolvedValue({ id: osId, payload: payload() });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "user-1", name: "Operadora" } });
  mocks.guard.mockReset().mockResolvedValue({ ok: true });
  mocks.assertStore.mockReset();
  mocks.emitirEvento.mockReset();
  mocks.revalidatePath.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("abrirRetornoV3", () => {
  it("rejeita storeId vazio antes de autenticação ou I/O", async () => {
    mocks.assertStore.mockImplementationOnce(() => {
      throw new Error("Loja ativa inválida.");
    });

    await expect(abrirRetornoV3("", osId, { motivo: "Touch voltou a falhar" })).rejects.toThrow("Loja ativa inválida.");

    expect(mocks.assertStore).toHaveBeenCalledWith("", "Operações V3");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("valida loja/ACL, persiste na OS original e grava cobertura/timeline", async () => {
    await abrirRetornoV3(storeId, osId, { motivo: "  Touch voltou a falhar  " });

    expect(mocks.assertStore).toHaveBeenCalledWith(storeId, "Operações V3");
    expect(mocks.guard).toHaveBeenCalledWith(storeId, expect.any(Function), expect.any(String));
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: osId, storeId }, select: { id: true, payload: true } });
    const next = mocks.update.mock.calls[0]![0].data.payload;
    expect(next.retornosV3).toEqual([
      expect.objectContaining({
        osOriginalId: osId,
        osOriginalCodigo: "OS-1042",
        motivo: "Touch voltou a falhar",
        status: "aberto",
        garantiaAtivaNaAbertura: true,
      }),
    ]);
    expect(next.timeline).toEqual([
      expect.objectContaining({ tipo: "garantia_acionada", metadata: expect.objectContaining({ osOriginalId: osId }) }),
    ]);
    expect(mocks.emitirEvento).toHaveBeenCalledWith(expect.objectContaining({ tipo: "os_retorno_aberto", storeId }));
  });

  it("permite fora da garantia, mas registra snapshot sem cobertura", async () => {
    mocks.findFirst.mockResolvedValue({ id: osId, payload: payload({ entregaV3: { entregueEm: "2025-01-01T12:00:00.000Z" } }) });
    await abrirRetornoV3(storeId, osId, { motivo: "Falha recorrente" });
    const retorno = mocks.update.mock.calls[0]![0].data.payload.retornosV3[0];
    expect(retorno.garantiaAtivaNaAbertura).toBe(false);
  });

  it("exige motivo e não grava estado parcial", async () => {
    await expect(abrirRetornoV3(storeId, osId, { motivo: "  " })).rejects.toThrow("Informe o motivo do retorno.");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
  });

  it("bloqueia retry/segundo retorno enquanto já existe um aberto", async () => {
    mocks.findFirst.mockResolvedValue({ id: osId, payload: payload({ retornosV3: [{ id: "ret-open", osOriginalId: osId, motivo: "Primeiro", criadoEm: "2026-08-14T12:00:00.000Z", status: "aberto" }] }) });
    await expect(abrirRetornoV3(storeId, osId, { motivo: "Segundo" })).rejects.toThrow("Já existe um retorno em andamento para esta OS.");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("finalizarRetornoV3", () => {
  it("finaliza o retorno correto, preserva vínculo e registra resolução uma vez", async () => {
    mocks.findFirst.mockResolvedValue({ id: osId, payload: payload({ retornosV3: [{ id: "ret-1", osOriginalId: osId, osOriginalCodigo: "OS-1042", motivo: "Touch", criadoEm: "2026-08-14T12:00:00.000Z", status: "aberto", garantiaAtivaNaAbertura: true }] }) });
    await finalizarRetornoV3(storeId, osId, "ret-1", { observacao: "  Tela substituída novamente  " });
    const next = mocks.update.mock.calls[0]![0].data.payload;
    expect(next.retornosV3).toEqual([
      expect.objectContaining({
        id: "ret-1",
        osOriginalId: osId,
        status: "finalizado",
        observacaoFinal: "Tela substituída novamente",
        finalizadoPor: "Operadora",
      }),
    ]);
    expect(next.timeline).toEqual([
      expect.objectContaining({ tipo: "observacao", metadata: expect.objectContaining({ retornoId: "ret-1", evento: "retorno_finalizado" }) }),
    ]);
    expect(mocks.emitirEvento).toHaveBeenCalledWith(expect.objectContaining({ tipo: "os_retorno_finalizado", storeId }));
  });

  it("rejeita retorno já finalizado sem duplicar timeline", async () => {
    mocks.findFirst.mockResolvedValue({ id: osId, payload: payload({ retornosV3: [{ id: "ret-1", osOriginalId: osId, motivo: "Touch", criadoEm: "2026-08-14T12:00:00.000Z", status: "finalizado" }] }) });
    await expect(finalizarRetornoV3(storeId, osId, "ret-1")).rejects.toThrow("Este retorno já está finalizado.");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
  });
});
