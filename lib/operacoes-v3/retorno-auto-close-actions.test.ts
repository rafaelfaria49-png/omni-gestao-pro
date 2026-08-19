import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  emitirEvento: vi.fn(),
  revalidatePath: vi.fn(),
  assertStore: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { ordemServico: { findFirst: mocks.findFirst, update: mocks.update } },
}));
vi.mock("@/lib/operacoes/assert-active-store", () => ({ assertActiveStoreId: mocks.assertStore }));
vi.mock("./event-publisher", () => ({ emitirEventoOperacaoV3: mocks.emitirEvento }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { finalizarRetornoPorEntregaVinculadaV3 } from "./retorno-auto-close-actions";
import type { OrdemServico } from "@/types/os";

const storeId = "store-real";
const filha = {
  id: "os-filha",
  codigo: "OS-2001",
  vinculoRetornoV3: { osOrigemId: "os-orig", osOrigemCodigo: "OS-1042", retornoId: "ret-1" },
  timeline: [],
} as unknown as OrdemServico;

function originalPayload(over: Record<string, unknown> = {}) {
  return {
    id: "os-orig",
    codigo: "OS-1042",
    retornosV3: [{
      id: "ret-1",
      osOriginalId: "os-orig",
      osOriginalCodigo: "OS-1042",
      motivo: "Touch falhou",
      criadoEm: "2026-08-18T12:00:00.000Z",
      status: "aberto",
      osRetornoId: "os-filha",
      osRetornoCodigo: "OS-2001",
    }],
    timeline: [],
    ...over,
  };
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.update.mockReset().mockResolvedValue({});
  mocks.emitirEvento.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.assertStore.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("finalizarRetornoPorEntregaVinculadaV3", () => {
  it("não toca o banco quando o vínculo é incompleto", async () => {
    const out = await finalizarRetornoPorEntregaVinculadaV3({
      storeId,
      osFilha: { id: "os-filha", codigo: "OS-1" } as OrdemServico,
      operador: "Ana",
    });
    expect(out).toEqual({ status: "skipped", motivo: "sem_vinculo" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
  });

  it("fecha o retorno original uma vez e audita a filha", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ id: "os-orig", payload: originalPayload() })
      .mockResolvedValueOnce({ id: "os-filha", payload: filha });

    const out = await finalizarRetornoPorEntregaVinculadaV3({ storeId, osFilha: filha, operador: "Ana" });
    expect(out.status).toBe("closed");
    expect(mocks.update).toHaveBeenCalledTimes(2);
    const originalNext = mocks.update.mock.calls[0]![0].data.payload;
    expect(originalNext.retornosV3[0].status).toBe("finalizado");
    expect(originalNext.timeline).toHaveLength(1);
    const filhaNext = mocks.update.mock.calls[1]![0].data.payload;
    expect(filhaNext.vinculoRetornoV3.finalizadoPorEntrega).toBe(true);
    expect(mocks.emitirEvento).toHaveBeenCalledTimes(1);
    expect(mocks.emitirEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: "os_retorno_finalizado",
      metadata: expect.objectContaining({ origem: "entrega_vinculada", osRetornoId: "os-filha" }),
    }));
  });

  it("replay não duplica fechamento nem eventos", async () => {
    const fechado = originalPayload({
      retornosV3: [{
        id: "ret-1",
        osOriginalId: "os-orig",
        motivo: "Touch falhou",
        criadoEm: "t",
        status: "finalizado",
        osRetornoId: "os-filha",
        osRetornoCodigo: "OS-2001",
        observacaoFinal: "já fechado",
      }],
      timeline: [{
        id: "ret-close-ret-1-os-filha",
        tipo: "observacao",
        metadata: { evento: "retorno_finalizado", origem: "entrega_vinculada", retornoId: "ret-1", osRetornoId: "os-filha" },
      }],
    });
    const filhaJa = {
      ...filha,
      vinculoRetornoV3: { osOrigemId: "os-orig", osOrigemCodigo: "OS-1042", retornoId: "ret-1", finalizadoEm: "t", finalizadoPorEntrega: true },
      timeline: [{
        id: "ret-src-close-ret-1-os-orig",
        tipo: "observacao",
        metadata: { evento: "retorno_origem_finalizado", osOrigemId: "os-orig", retornoId: "ret-1" },
      }],
    } as unknown as OrdemServico;

    mocks.findFirst
      .mockResolvedValueOnce({ id: "os-orig", payload: fechado })
      .mockResolvedValueOnce({ id: "os-filha", payload: filhaJa });

    const out = await finalizarRetornoPorEntregaVinculadaV3({ storeId, osFilha: filhaJa, operador: "Ana" });
    expect(out.status).toBe("already");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
  });

  it("não fecha quando o osRetornoId aponta para outra OS", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: "os-orig",
      payload: originalPayload({
        retornosV3: [{
          id: "ret-1",
          osOriginalId: "os-orig",
          motivo: "x",
          criadoEm: "t",
          status: "aberto",
          osRetornoId: "os-outra",
          osRetornoCodigo: "OS-9",
        }],
      }),
    });

    const out = await finalizarRetornoPorEntregaVinculadaV3({ storeId, osFilha: filha, operador: "Ana" });
    expect(out).toEqual({ status: "skipped", motivo: "vinculo_divergente" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.emitirEvento).not.toHaveBeenCalled();
  });
});
