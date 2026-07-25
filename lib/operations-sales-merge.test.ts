import { describe, expect, it } from "vitest"
import type { SaleRecord } from "@/lib/operations-sale-types"
import { mergeSalesById } from "./operations-sales-merge"

/** Venda mínima para o merge (só os campos que a função lê/preserva). */
function venda(opts: Partial<SaleRecord> & { id: string }): SaleRecord {
  return {
    at: opts.at ?? "2026-06-22T10:00:00.000Z",
    lines: opts.lines ?? [
      { inventoryId: "p1", name: "Produto", quantity: 1, unitPrice: 24, lineTotal: 24, qtyReturned: 0 },
    ],
    total: opts.total ?? 24,
    paymentBreakdown: opts.paymentBreakdown ?? {
      dinheiro: 24,
      pix: 0,
      cartaoDebito: 0,
      cartaoCredito: 0,
      carne: 0,
      aPrazo: 0,
      creditoVale: 0,
    },
    ...opts,
  } as SaleRecord
}

describe("mergeSalesById — propagação de status autoritativo", () => {
  it("propaga status 'cancelada' do servidor para a venda local (que estava sem status)", () => {
    const local = [venda({ id: "VDA-2026-0001" })] // status undefined => tratada como concluída
    const remote = [venda({ id: "VDA-2026-0001", status: "cancelada" })]
    const merged = mergeSalesById(local, remote)
    expect(merged[0]!.status).toBe("cancelada")
  })

  it("limpa syncPending E propaga status quando a venda já existe no servidor", () => {
    const local = [venda({ id: "VDA-2026-0001", syncPending: true })]
    const remote = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const merged = mergeSalesById(local, remote)
    expect(merged[0]!.syncPending).toBe(false)
    expect(merged[0]!.status).toBe("concluida")
  })

  it("NUNCA apaga o status local com undefined remoto (servidor legado sem status)", () => {
    const local = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const remote = [venda({ id: "VDA-2026-0001", status: undefined })]
    const merged = mergeSalesById(local, remote)
    expect(merged[0]!.status).toBe("concluida")
  })

  it("NÃO sobrescreve lines/qtyReturned locais (preserva devolução offline pendente)", () => {
    const local = [
      venda({
        id: "VDA-2026-0001",
        lines: [{ inventoryId: "p1", name: "P", quantity: 2, unitPrice: 10, lineTotal: 20, qtyReturned: 1 }],
      }),
    ]
    const remote = [
      venda({
        id: "VDA-2026-0001",
        status: "cancelada",
        lines: [{ inventoryId: "p1", name: "P", quantity: 2, unitPrice: 10, lineTotal: 20, qtyReturned: 0 }],
      }),
    ]
    const merged = mergeSalesById(local, remote)
    expect(merged[0]!.status).toBe("cancelada")
    expect(merged[0]!.lines[0]!.qtyReturned).toBe(1) // mantém o estado local
  })

  it("adiciona vendas remotas inexistentes localmente, ordenadas por `at`", () => {
    const local = [venda({ id: "VDA-2026-0002", at: "2026-06-22T12:00:00.000Z" })]
    const remote = [
      venda({ id: "VDA-2026-0002", at: "2026-06-22T12:00:00.000Z", status: "concluida" }),
      venda({ id: "VDA-2026-0001", at: "2026-06-22T09:00:00.000Z", status: "concluida" }),
    ]
    const merged = mergeSalesById(local, remote)
    expect(merged.map((s) => s.id)).toEqual(["VDA-2026-0001", "VDA-2026-0002"])
  })

  it("retorna a MESMA referência quando nada muda (sem churn de render)", () => {
    const local = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const remote = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const merged = mergeSalesById(local, remote)
    expect(merged).toBe(local)
  })
})

/**
 * GOAL: PDV-PEDIDO-ID-COLISAO-MULTILOJA-FIX-001 — estar no `remote` significa estar no
 * banco, ou seja, confirmada. Nenhum marcador local pode sobreviver ao merge nem ser
 * reinjetado por uma venda remota extra (payload legado com `syncPending: true`).
 */
describe("mergeSalesById — marcadores client-only nunca voltam do servidor", () => {
  it("9. venda remota EXTRA nunca entra no estado como pendente", () => {
    const local: SaleRecord[] = []
    const remote = [
      venda({ id: "VDA-2026-0046", syncPending: true, syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }),
    ]
    const merged = mergeSalesById(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.syncPending).toBeUndefined()
    expect(merged[0]!.syncBlockedCode).toBeUndefined()
    // Campos legítimos da venda remota preservados.
    expect(merged[0]!.id).toBe("VDA-2026-0046")
    expect(merged[0]!.total).toBe(24)
  })

  it("10. venda local já existente no servidor tem syncPending E syncBlockedCode limpos", () => {
    const local = [
      venda({ id: "VDA-2026-0001", syncPending: true, syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }),
    ]
    const remote = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const merged = mergeSalesById(local, remote)
    expect(merged[0]!.syncPending).toBe(false)
    expect(merged[0]!.syncBlockedCode).toBeUndefined()
    expect(merged[0]!.status).toBe("concluida")
  })

  it("10b. limpeza converge: o merge seguinte devolve a MESMA referência", () => {
    const local = [venda({ id: "VDA-2026-0001", status: "concluida", syncBlockedCode: "X" })]
    const remote = [venda({ id: "VDA-2026-0001", status: "concluida" })]
    const primeiro = mergeSalesById(local, remote)
    expect(primeiro).not.toBe(local)
    const segundo = mergeSalesById(primeiro, remote)
    expect(segundo).toBe(primeiro)
  })

  it("venda local pendente AUSENTE no servidor continua pendente", () => {
    const local = [venda({ id: "VDA-2026-0046", syncPending: true })]
    const remote = [venda({ id: "VDA-2026-0500", status: "concluida" })]
    const merged = mergeSalesById(local, remote)
    const pendente = merged.find((s) => s.id === "VDA-2026-0046")!
    expect(pendente.syncPending).toBe(true)
  })

  it("preserva syncBlockedCode da venda local ausente no servidor (orientação da UI)", () => {
    const local = [
      venda({ id: "VDA-2026-0046", syncPending: true, syncBlockedCode: "PEDIDO_ID_DE_OUTRA_LOJA" }),
    ]
    const merged = mergeSalesById(local, [])
    expect(merged[0]!.syncBlockedCode).toBe("PEDIDO_ID_DE_OUTRA_LOJA")
    expect(merged[0]!.syncPending).toBe(true)
  })
})
