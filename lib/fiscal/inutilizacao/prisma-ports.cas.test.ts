/**
 * CAS da baixa da marca: o UPDATE precisa condicionar payload.mark no predicado.
 */
import { describe, expect, it, vi } from "vitest"
import { createPrismaInutilizacaoPorts } from "./prisma-ports"
import { INUTILIZACAO_MARK } from "./mark"

describe("createPrismaInutilizacaoPorts.updateJobPayload", () => {
  it("coloca expectedMark no predicado do UPDATE (path JSON mark)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const client = {
      $transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(client as never),
      fiscalEmissaoJob: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        updateMany,
      },
      notaFiscal: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      notaFiscalItem: { findMany: vi.fn(), createMany: vi.fn() },
      eventoFiscal: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
      fiscalLog: { create: vi.fn() },
      venda: { updateMany: vi.fn() },
      configuracaoFiscalLoja: { findUnique: vi.fn() },
    }
    const ports = createPrismaInutilizacaoPorts(client as never)
    const ok = await ports.updateJobPayload({
      jobId: "job-1",
      storeId: "loja-1",
      expectedMark: INUTILIZACAO_MARK.A_INUTILIZAR,
      payload: {
        version: 1,
        operation: "INUTILIZACAO",
        mark: INUTILIZACAO_MARK.INUTILIZADO,
        storeId: "loja-1",
        modelo: "NFCE",
        ambiente: "HOMOLOGACAO",
        serie: 1,
        numeroInicial: 3,
        numeroFinal: 3,
        justificativa: "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar.",
        motivo: "rejeicao_definitiva",
        notaFiscalId: "nf-1",
        vendaId: "venda-1",
        protocolo: "135260000000001",
        cStat: "102",
        xMotivo: "ok",
        inutilizadoEm: "2026-08-25T00:00:00.000Z",
        requestedAt: "2026-08-25T00:00:00.000Z",
        requestedBy: "op",
      },
      status: "CONCLUIDO",
    })
    expect(ok).toBe(true)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          storeId: "loja-1",
          tipo: "INUTILIZACAO",
          payload: { path: ["mark"], equals: INUTILIZACAO_MARK.A_INUTILIZAR },
        }),
      }),
    )
  })

  it("concorrência: UPDATE com mark divergente devolve count 0", async () => {
    const updateMany = vi.fn(async (args: { where: { payload?: { equals?: string } } }) => {
      if (args.where.payload?.equals === INUTILIZACAO_MARK.A_INUTILIZAR) return { count: 0 }
      return { count: 1 }
    })
    const client = {
      $transaction: async <T>(fn: (tx: never) => Promise<T>) => fn(client as never),
      fiscalEmissaoJob: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        updateMany,
      },
      notaFiscal: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      notaFiscalItem: { findMany: vi.fn(), createMany: vi.fn() },
      eventoFiscal: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
      fiscalLog: { create: vi.fn() },
      venda: { updateMany: vi.fn() },
      configuracaoFiscalLoja: { findUnique: vi.fn() },
    }
    const ports = createPrismaInutilizacaoPorts(client as never)
    const ok = await ports.updateJobPayload({
      jobId: "job-1",
      storeId: "loja-1",
      expectedMark: INUTILIZACAO_MARK.A_INUTILIZAR,
      payload: {
        version: 1,
        operation: "INUTILIZACAO",
        mark: INUTILIZACAO_MARK.INUTILIZADO,
        storeId: "loja-1",
        modelo: "NFCE",
        ambiente: "HOMOLOGACAO",
        serie: 1,
        numeroInicial: 3,
        numeroFinal: 3,
        justificativa: "Numero NFC-e rejeitado pela SEFAZ; faixa inutilizada para nao reutilizar.",
        motivo: "rejeicao_definitiva",
        notaFiscalId: "nf-1",
        vendaId: "venda-1",
        protocolo: "135260000000001",
        cStat: "102",
        xMotivo: "ok",
        inutilizadoEm: "2026-08-25T00:00:00.000Z",
        requestedAt: "2026-08-25T00:00:00.000Z",
        requestedBy: "op",
      },
    })
    expect(ok).toBe(false)
  })
})
