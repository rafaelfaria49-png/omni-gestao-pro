import { describe, expect, it } from "vitest"

import { classifyLocalSaleSync } from "@/lib/vendas/local-sale-identity"
import {
  QUARANTINE_RECOVERY_CHUNK,
  applyRecoveryConfirmations,
  buildRecoveryConfirmations,
  chunk,
  isQuarantinedLocalSale,
  summarizePlanItems,
  summarizeRecoveryResults,
  type LocalSaleShape,
  type RecoveryResultShape,
} from "@/lib/vendas/quarantine-local-reconciliation"

function localSale(overrides: Partial<LocalSaleShape> = {}): LocalSaleShape {
  return {
    id: "VDA-2026-0615",
    clientSaleId: "cs_attempt_111111",
    syncPending: true,
    syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    ...overrides,
  }
}

function result(overrides: Partial<RecoveryResultShape> = {}): RecoveryResultShape {
  return {
    conflictingPedidoId: "VDA-2026-0615",
    clientSaleId: "cs_attempt_111111",
    status: "RECOVERED",
    venda: { id: "venda-b", pedidoId: "VDA-RC02-2026-000099", clientSaleId: "cs_attempt_111111" },
    ...overrides,
  }
}

describe("isQuarantinedLocalSale", () => {
  it("reconhece quarentena de identidade", () => {
    expect(isQuarantinedLocalSale(localSale())).toBe(true)
    expect(isQuarantinedLocalSale(localSale({ syncBlockedCode: "PEDIDO_ID_DE_OUTRA_LOJA" }))).toBe(true)
  })

  it("não confunde pendência comum nem venda confirmada", () => {
    expect(isQuarantinedLocalSale(localSale({ syncBlockedCode: "CAIXA_ORIGINAL_FECHADO" }))).toBe(false)
    expect(isQuarantinedLocalSale(localSale({ syncBlockedCode: undefined }))).toBe(false)
    expect(isQuarantinedLocalSale(localSale({ syncPending: false }))).toBe(false)
    expect(isQuarantinedLocalSale(localSale({ id: "" }))).toBe(false)
  })
})

describe("buildRecoveryConfirmations", () => {
  it("aceita RECOVERED e ALREADY_RECOVERED com venda completa", () => {
    const confirmations = buildRecoveryConfirmations([
      result(),
      result({
        conflictingPedidoId: "VDA-2026-0616",
        clientSaleId: "cs_attempt_222222",
        status: "ALREADY_RECOVERED",
        venda: { id: "venda-c", pedidoId: "VDA-RC02-2026-000100" },
      }),
    ])
    expect(confirmations).toEqual([
      { clientSaleId: "cs_attempt_111111", pedidoId: "VDA-RC02-2026-000099", serverId: "venda-b" },
      { clientSaleId: "cs_attempt_222222", pedidoId: "VDA-RC02-2026-000100", serverId: "venda-c" },
    ])
  })

  it("NUNCA confirma sem evidência server-side", () => {
    // A quarentena só termina com venda real no servidor. Nenhum destes vira confirmação.
    expect(
      buildRecoveryConfirmations([
        result({ status: "REQUIRES_CONFIRMATION", venda: null }),
        result({ status: "BLOCKED", venda: null }),
        result({ status: "FAILED", venda: null }),
        // Status bom, mas sem venda — não confirma.
        result({ status: "RECOVERED", venda: null }),
        // Venda sem `pedidoId` utilizável — não confirma.
        result({ venda: { id: "venda-x", pedidoId: "   " } }),
        // Venda sem id técnico — não confirma.
        result({ venda: { id: "", pedidoId: "VDA-RC02-2026-000101" } }),
      ]),
    ).toEqual([])
  })

  it("não confirma quando não há clientSaleId em lugar nenhum", () => {
    expect(
      buildRecoveryConfirmations([
        result({
          clientSaleId: null,
          venda: { id: "venda-b", pedidoId: "VDA-RC02-2026-000099", clientSaleId: null },
        }),
      ]),
    ).toEqual([])
  })

  it("usa o clientSaleId da venda quando o resultado não o traz", () => {
    const confirmations = buildRecoveryConfirmations([
      result({
        clientSaleId: null,
        venda: { id: "venda-b", pedidoId: "VDA-RC02-2026-000099", clientSaleId: "cs_attempt_999999" },
      }),
    ])
    expect(confirmations).toEqual([
      { clientSaleId: "cs_attempt_999999", pedidoId: "VDA-RC02-2026-000099", serverId: "venda-b" },
    ])
  })

  it("deduplica o mesmo clientSaleId", () => {
    expect(buildRecoveryConfirmations([result(), result()])).toHaveLength(1)
  })
})

describe("applyRecoveryConfirmations", () => {
  it("tira da quarentena só a venda confirmada, adotando o novo número", () => {
    const sales = [localSale(), localSale({ id: "VDA-2026-0616", clientSaleId: "cs_attempt_222222" })]
    const { sales: next, reconciled } = applyRecoveryConfirmations(
      sales,
      buildRecoveryConfirmations([result()]),
    )

    expect(reconciled).toBe(1)
    expect(next[0]).toMatchObject({
      id: "VDA-RC02-2026-000099",
      serverId: "venda-b",
      syncPending: false,
      syncBlockedCode: undefined,
    })
    // A venda NÃO confirmada segue intacta em quarentena.
    expect(next[1]).toMatchObject({
      id: "VDA-2026-0616",
      syncPending: true,
      syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    })
  })

  it("casa por clientSaleId EXATO — nunca pelo número antigo compartilhado", () => {
    // Cenário do incidente: duas quarentenas com o MESMO `VDA-2026-0615`. Confirmar a
    // primeira não pode limpar o bloqueio da segunda, que nunca foi persistida.
    const sales = [
      localSale({ clientSaleId: "cs_attempt_111111" }),
      localSale({ clientSaleId: "cs_attempt_222222" }),
    ]
    const { sales: next, reconciled } = applyRecoveryConfirmations(
      sales,
      buildRecoveryConfirmations([result({ clientSaleId: "cs_attempt_111111" })]),
    )

    expect(reconciled).toBe(1)
    expect(next[0].syncPending).toBe(false)
    expect(next[1]).toMatchObject({
      id: "VDA-2026-0615",
      syncPending: true,
      syncBlockedCode: "PEDIDO_ID_CONFLITO_MESMA_LOJA",
    })
  })

  it("ignora venda local sem clientSaleId", () => {
    const sales = [localSale({ clientSaleId: undefined })]
    const { sales: next, reconciled } = applyRecoveryConfirmations(
      sales,
      buildRecoveryConfirmations([result()]),
    )
    expect(reconciled).toBe(0)
    expect(next[0]).toMatchObject({ syncPending: true })
  })

  it("lote sem confirmações não altera nada", () => {
    const sales = [localSale()]
    const { sales: next, reconciled } = applyRecoveryConfirmations(sales, [])
    expect(reconciled).toBe(0)
    expect(next[0]).toEqual(sales[0])
  })

  it("é puro: não muta o array nem os objetos de entrada", () => {
    const sales = [localSale()]
    const snapshot = JSON.stringify(sales)
    applyRecoveryConfirmations(sales, buildRecoveryConfirmations([result()]))
    expect(JSON.stringify(sales)).toBe(snapshot)
  })
})

describe("chunk", () => {
  it("fatia preservando ordem e sem perder itens", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]])
    expect(chunk([], 5)).toEqual([])
  })

  it("nunca entra em laço infinito com tamanho inválido", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]])
    expect(chunk([1, 2], -3)).toEqual([[1], [2]])
  })

  it("o teto do cliente é menor que o teto da rota (500)", () => {
    expect(QUARANTINE_RECOVERY_CHUNK).toBeLessThan(500)
    expect(QUARANTINE_RECOVERY_CHUNK).toBeGreaterThan(0)
  })

  it("uma instalação carregada é fatiada em vez de recusada", () => {
    // 780 quarentenas não podem virar um 400 sem caminho de recuperação.
    const slices = chunk(Array.from({ length: 780 }, (_, i) => i), QUARANTINE_RECOVERY_CHUNK)
    expect(slices.flat()).toHaveLength(780)
    expect(Math.max(...slices.map((s) => s.length))).toBeLessThanOrEqual(QUARANTINE_RECOVERY_CHUNK)
  })
})

describe("agregação no cliente", () => {
  it("summarizePlanItems soma buckets, classes e valores das fatias", () => {
    const summary = summarizePlanItems([
      { bucket: "READY", klass: "READY", total: 18 },
      { bucket: "REQUIRES_CONFIRMATION", klass: "REQUIRES_CLOSED_SESSION_CONFIRM", total: 50 },
      { bucket: "ALREADY_RECOVERED", klass: "ALREADY_RECOVERED", total: 7 },
      { bucket: "BLOCKED", klass: "INVALID_PAYLOAD", total: 5 },
      { bucket: "BLOCKED", klass: "INVALID_PAYLOAD", total: 5 },
    ])
    expect(summary).toMatchObject({
      total: 5,
      ready: 1,
      requiresConfirmation: 1,
      alreadyRecovered: 1,
      blocked: 2,
      valorTotal: 85,
      // Somente executáveis: 18 + 50.
      valorExecutavel: 68,
    })
    expect(summary.byClass.INVALID_PAYLOAD).toBe(2)
  })

  it("summarizePlanItems ignora total inválido sem virar NaN", () => {
    const summary = summarizePlanItems([
      { bucket: "READY", klass: "READY", total: Number.NaN },
      { bucket: "READY", klass: "READY", total: 10 },
    ])
    expect(summary.valorTotal).toBe(10)
    expect(Number.isNaN(summary.valorTotal)).toBe(false)
  })

  it("summarizeRecoveryResults conta cada status e trata desconhecido como falha", () => {
    expect(
      summarizeRecoveryResults([
        { status: "RECOVERED" },
        { status: "RECOVERED" },
        { status: "ALREADY_RECOVERED" },
        { status: "REQUIRES_CONFIRMATION" },
        { status: "BLOCKED" },
        { status: "FAILED" },
        { status: "ALGO_INESPERADO" },
      ]),
    ).toEqual({
      total: 7,
      recovered: 2,
      alreadyRecovered: 1,
      requiresConfirmation: 1,
      blocked: 1,
      failed: 2,
    })
  })
})

describe("estado final da venda recuperada", () => {
  it("passa a classificar como REMOTE_CONFIRMED — habilita o menu normal", () => {
    // `REMOTE_CONFIRMED` é a classe que libera Workspace · Corrigir, Troca / Devolução,
    // Cancelar venda e impressão em `vendas-arquivo-geral.tsx`.
    const antes = localSale()
    expect(classifyLocalSaleSync(antes)).toBe("LOCAL_QUARANTINED")

    const { sales: next } = applyRecoveryConfirmations(
      [antes],
      buildRecoveryConfirmations([result()]),
    )
    expect(classifyLocalSaleSync(next[0])).toBe("REMOTE_CONFIRMED")
  })

  it("aparece uma única vez: o número local passa a ser o número server-side", () => {
    // O merge do histórico suprime a linha local quando ela deixa de ser `syncPending`
    // e quando o `clientSaleId` já veio na página remota. Após a reconciliação a cópia
    // local carrega o MESMO número da venda remota — nunca duas linhas divergentes.
    const { sales: next } = applyRecoveryConfirmations(
      [localSale()],
      buildRecoveryConfirmations([result()]),
    )
    expect(next[0].id).toBe("VDA-RC02-2026-000099")
    expect(next[0].clientSaleId).toBe("cs_attempt_111111")
    expect(next[0].syncPending).toBe(false)
  })

  it("venda que aguarda autorização continua em quarentena após o lote", () => {
    const { sales: next, reconciled } = applyRecoveryConfirmations(
      [localSale()],
      buildRecoveryConfirmations([result({ status: "REQUIRES_CONFIRMATION", venda: null })]),
    )
    expect(reconciled).toBe(0)
    expect(classifyLocalSaleSync(next[0])).toBe("LOCAL_QUARANTINED")
  })
})
