import { describe, expect, it } from "vitest"

import type { SaleRecord } from "@/lib/operations-sale-types"
import { mergeSalesById } from "./operations-sales-merge"

function venda(opts: Partial<SaleRecord> & { id: string }): SaleRecord {
  return {
    at: opts.at ?? "2026-06-15T18:00:00.000Z",
    lines: opts.lines ?? [
      {
        inventoryId: "p-tvbox",
        name: "CONTROLE TV BOX",
        quantity: 1,
        unitPrice: 18,
        lineTotal: 18,
        qtyReturned: 0,
      },
    ],
    total: opts.total ?? 18,
    paymentBreakdown: opts.paymentBreakdown ?? {
      dinheiro: 18,
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

describe("merge V2 — clientSaleId e colisão de pedidoId", () => {
  it("reconcilia PEND→VDA in-place quando o clientSaleId é o mesmo", () => {
    const local = [
      venda({
        id: "PEND-cs_localattempt01",
        clientSaleId: "cs_localattempt01",
        syncPending: true,
      }),
    ]
    const remote = [
      venda({
        id: "VDA-RC02-2026-000001",
        clientSaleId: "cs_localattempt01",
        serverId: "cuid_venda_1",
        status: "concluida",
      }),
    ]
    const merged = mergeSalesById(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: "VDA-RC02-2026-000001",
      clientSaleId: "cs_localattempt01",
      serverId: "cuid_venda_1",
      syncPending: false,
    })
    expect(merged[0]!.syncBlockedCode).toBeUndefined()
  })

  it("fixture VDA-2026-0615: ocupante remoto e local quarentenada coexistem", () => {
    const local = [
      venda({
        id: "VDA-2026-0615",
        clientSaleId: "cs_local_tvbox18",
        total: 18,
        syncPending: true,
        syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
        customerName: "Consumidor",
        lines: [
          {
            inventoryId: "p-tvbox",
            name: "CONTROLE TV BOX",
            quantity: 1,
            unitPrice: 18,
            lineTotal: 18,
            qtyReturned: 0,
          },
        ],
        paymentBreakdown: {
          dinheiro: 18,
          pix: 0,
          cartaoDebito: 0,
          cartaoCredito: 0,
          carne: 0,
          aPrazo: 0,
          creditoVale: 0,
        },
      }),
    ]
    const remote = [
      venda({
        id: "VDA-2026-0615",
        clientSaleId: "cs_remote_occupant",
        serverId: "cuid_venda_a",
        status: "concluida",
        total: 240,
        customerName: "Cliente A",
        paymentBreakdown: {
          dinheiro: 0,
          pix: 240,
          cartaoDebito: 0,
          cartaoCredito: 0,
          carne: 0,
          aPrazo: 0,
          creditoVale: 0,
        },
      }),
    ]

    const merged = mergeSalesById(local, remote)
    expect(merged).toHaveLength(2)

    const localB = merged.find((s) => s.clientSaleId === "cs_local_tvbox18")
    const remoteA = merged.find((s) => s.clientSaleId === "cs_remote_occupant")

    expect(localB).toMatchObject({
      id: "VDA-2026-0615",
      total: 18,
      syncPending: true,
      syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    })
    expect(localB!.lines[0]!.name).toBe("CONTROLE TV BOX")
    expect(localB!.paymentBreakdown.dinheiro).toBe(18)

    expect(remoteA).toMatchObject({
      id: "VDA-2026-0615",
      total: 240,
      status: "concluida",
      serverId: "cuid_venda_a",
    })
    expect(remoteA!.syncPending).toBeUndefined()
    expect(remoteA!.syncBlockedCode).toBeUndefined()
  })

  it("não trata a remota como confirmação da local quando os clientSaleId diferem", () => {
    const local = [
      venda({
        id: "VDA-2026-0615",
        clientSaleId: "cs_attempt_bbbb",
        syncPending: true,
        total: 18,
      }),
    ]
    const remote = [
      venda({
        id: "VDA-2026-0615",
        clientSaleId: "cs_attempt_aaaa",
        status: "concluida",
        total: 99,
      }),
    ]
    const merged = mergeSalesById(local, remote)
    expect(merged).toHaveLength(2)
    expect(merged.find((s) => s.clientSaleId === "cs_attempt_bbbb")!.syncPending).toBe(true)
    expect(merged.find((s) => s.clientSaleId === "cs_attempt_aaaa")!.status).toBe("concluida")
  })
})
