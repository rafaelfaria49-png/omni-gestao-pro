import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  osFindFirst: vi.fn(),
  auth: vi.fn(),
  requireEnterpriseWith: vi.fn(),
  consumirEstoque: vi.fn(),
  revalidatePath: vi.fn(),
  assertActiveStoreId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { ordemServico: { findFirst: mocks.osFindFirst } },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/guard-enterprise", () => ({ requireEnterpriseWith: mocks.requireEnterpriseWith }));
vi.mock("@/lib/operacoes/assert-active-store", () => ({ assertActiveStoreId: mocks.assertActiveStoreId }));
vi.mock("./estoque-sync", () => ({ consumirEstoqueOSV3: mocks.consumirEstoque }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { consumirEstoqueOSActionV3 } from "./estoque-actions";

const storeId = "store-a";
const osId = "os-1";

beforeEach(() => {
  mocks.osFindFirst.mockReset().mockResolvedValue({
    id: osId,
    payload: { pecas: [{ id: "p1", nome: "Tela", quantidade: 1, produtoId: "prod-1" }] },
  });
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "u1", name: "Ana" } });
  mocks.requireEnterpriseWith.mockReset().mockResolvedValue({ ok: true });
  mocks.consumirEstoque.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.assertActiveStoreId.mockReset();
});

describe("consumirEstoqueOSActionV3", () => {
  it("reusa o motor V3 com payload da OS + operador e recarrega a V4", async () => {
    mocks.consumirEstoque.mockResolvedValue({ status: "consumed", itens: 1 });

    const r = await consumirEstoqueOSActionV3(storeId, osId);

    expect(r).toEqual({ status: "consumed", itens: 1 });
    expect(mocks.consumirEstoque).toHaveBeenCalledWith({
      storeId,
      osId,
      osPayload: expect.objectContaining({ id: osId, storeId }),
      operador: "Ana",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/operacoes-v4-preview");
  });

  it("replay: already_consumed é sucesso (não baixa de novo)", async () => {
    mocks.consumirEstoque.mockResolvedValue({ status: "already_consumed", itens: 0 });
    const r = await consumirEstoqueOSActionV3(storeId, osId);
    expect(r).toEqual({ status: "already_consumed", itens: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("sem peça vinculada: erro honesto, sem fingir baixa", async () => {
    mocks.consumirEstoque.mockResolvedValue({ status: "nothing_to_consume", itens: 0 });
    await expect(consumirEstoqueOSActionV3(storeId, osId)).rejects.toThrow(/vinculada ao catálogo/);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falha do adapter sobe a mensagem (estoque insuficiente etc.)", async () => {
    mocks.consumirEstoque.mockResolvedValue({
      status: "error",
      itens: 0,
      error: 'Estoque insuficiente para "Tela".',
    });
    await expect(consumirEstoqueOSActionV3(storeId, osId)).rejects.toThrow(/insuficiente/);
  });

  it("sem login ou sem permissão: não chama o motor", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    await expect(consumirEstoqueOSActionV3(storeId, osId)).rejects.toThrow(/login/);
    expect(mocks.consumirEstoque).not.toHaveBeenCalled();

    mocks.requireEnterpriseWith.mockResolvedValueOnce({ ok: false, error: "Sem permissão para alterar esta OS." });
    await expect(consumirEstoqueOSActionV3(storeId, osId)).rejects.toThrow(/permissão/);
    expect(mocks.consumirEstoque).not.toHaveBeenCalled();
  });
});
