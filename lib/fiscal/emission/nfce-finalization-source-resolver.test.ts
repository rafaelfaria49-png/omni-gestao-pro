/**
 * GOAL 022 — source resolver da NFC-e a partir da fonte fiscal persistida.
 *
 * Prova: só reconstrói `VendaFiscalSnapshot` da NotaFiscal congelada.
 * Sem Produto/Cliente/Venda vivos, sem carrinho PDV, sem inventar numeração.
 */
import { describe, expect, it, vi } from "vitest"
import { dryRunSnapshot } from "@/lib/fiscal/dry-run"
import {
  createPersistedNfceFinalizationSourceResolver,
  NfceFinalizationSourceError,
} from "./nfce-finalization-source-resolver"

const SNAPSHOT = dryRunSnapshot("simples")
const LOCATOR = {
  storeId: SNAPSHOT.storeId,
  vendaId: SNAPSHOT.vendaId,
  notaFiscalId: "nota-persistida-1",
}

function notaPersistida(over: Record<string, unknown> = {}) {
  return {
    id: LOCATOR.notaFiscalId,
    storeId: LOCATOR.storeId,
    vendaId: LOCATOR.vendaId,
    modelo: "NFCE",
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numero: 42,
    tipoEmissao: "NORMAL",
    localKey: "nfce:loja:venda:1",
    snapshotEmitente: SNAPSHOT.emitente,
    snapshotDestinatario: SNAPSHOT.destinatario,
    snapshotPagamento: {
      versao: SNAPSHOT.versao,
      geradoEm: SNAPSHOT.geradoEm,
      venda: SNAPSHOT.venda,
      totais: SNAPSHOT.totais,
      diagnostico: SNAPSHOT.diagnostico,
    },
    itens: SNAPSHOT.itens.map((it) => ({
      itemVendaId: it.itemVendaId,
      produtoId: it.produtoId,
      numeroItem: it.numeroItem,
      codigoProduto: it.codigoProduto,
      descricao: it.descricao,
      gtin: it.gtin,
      ncm: it.ncm,
      cest: it.cest,
      cfop: it.cfop,
      cst: it.cst,
      csosn: it.csosn,
      origemMercadoria: Number(it.origemMercadoria) || 0,
      unidadeComercial: it.unidadeComercial,
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      valorDesconto: it.valorDesconto,
      valorTotal: it.valorTotal,
    })),
    ...over,
  }
}

function clientWith(nota: unknown) {
  return {
    notaFiscal: {
      findFirst: vi.fn(async () => nota),
    },
  }
}

describe("createPersistedNfceFinalizationSourceResolver", () => {
  it("reconstrói a fonte a partir do snapshot congelado persistido", async () => {
    const client = clientWith(notaPersistida())
    const resolve = createPersistedNfceFinalizationSourceResolver(client)
    const source = await resolve(LOCATOR)

    expect(source).toMatchObject({
      ...LOCATOR,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie: 1,
      numero: 42,
      tpEmis: 1,
      uf: "SP",
      correlationId: "nfce:loja:venda:1",
    })
    expect(source.snapshot.storeId).toBe(LOCATOR.storeId)
    expect(source.snapshot.vendaId).toBe(LOCATOR.vendaId)
    expect(source.snapshot.itens).toHaveLength(SNAPSHOT.itens.length)
    expect(Object.isFrozen(source.snapshot)).toBe(true)
    expect(client.notaFiscal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: LOCATOR.notaFiscalId,
          storeId: LOCATOR.storeId,
          vendaId: LOCATOR.vendaId,
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
        }),
      }),
    )
  })

  it("contingência offline persistida vira tpEmis=9 sem reler produto vivo", async () => {
    const client = clientWith(notaPersistida({ tipoEmissao: "CONTINGENCIA_OFFLINE" }))
    const source = await createPersistedNfceFinalizationSourceResolver(client)(LOCATOR)
    expect(source.tpEmis).toBe(9)
  })

  it("falha fechado quando a nota persistida não existe", async () => {
    const resolve = createPersistedNfceFinalizationSourceResolver(clientWith(null))
    await expect(resolve(LOCATOR)).rejects.toMatchObject({
      name: "NfceFinalizationSourceError",
      code: "nota_nao_encontrada",
    })
  })

  it("falha fechado sem inventar snapshot quando os blocos congelados faltam", async () => {
    const resolve = createPersistedNfceFinalizationSourceResolver(
      clientWith(notaPersistida({ snapshotEmitente: null, snapshotPagamento: null })),
    )
    await expect(resolve(LOCATOR)).rejects.toBeInstanceOf(NfceFinalizationSourceError)
    await expect(resolve(LOCATOR)).rejects.toMatchObject({ code: "fonte_fiscal_insuficiente" })
  })

  it("não inventa numeração se série/número persistidos estão ausentes", async () => {
    const resolve = createPersistedNfceFinalizationSourceResolver(
      clientWith(notaPersistida({ serie: null, numero: null })),
    )
    await expect(resolve(LOCATOR)).rejects.toMatchObject({ code: "numeracao_ausente" })
  })

  it("não consulta Produto, Cliente, Venda viva nem carrinho", async () => {
    const raw = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./nfce-finalization-source-resolver.ts", import.meta.url), "utf8"),
    )
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(src).not.toMatch(/produto\.find|cliente\.find|venda\.find/i)
    expect(src).not.toMatch(/buildVendaFiscalSnapshot|createVendaFiscalSnapshot/)
    expect(src).not.toMatch(/carrinho|useOSStore|from\s+["']react["']/)
  })
})
