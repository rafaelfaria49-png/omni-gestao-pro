/**
 * Resolve `NfceFinalizationSource` exclusivamente a partir da NotaFiscal persistida
 * (GOAL 022 · piloto dormente).
 *
 * Fonte canônica: snapshots congelados + itens + numeração já gravados em
 * `NotaFiscal`/`NotaFiscalItem`. Não lê estado React, carrinho PDV, `Produto`
 * vivo nem `Cliente` vivo. Se a foto fiscal não for suficiente, falha fechado
 * — não inventa reconstrução.
 */
import { reconstructSnapshotFromNota, type NotaFiscalRow } from "./snapshot-reader"
import type { NfceFinalizationSource } from "./finalized-nfce-preparer"
import type { FiscalDocumentLocator } from "./uncertain-state.types"

export type NfceFinalizationSourceErrorCode =
  | "nota_nao_encontrada"
  | "fonte_fiscal_insuficiente"
  | "numeracao_ausente"
  | "escopo_incompativel"

export class NfceFinalizationSourceError extends Error {
  readonly code: NfceFinalizationSourceErrorCode
  constructor(code: NfceFinalizationSourceErrorCode, message: string) {
    super(message)
    this.name = "NfceFinalizationSourceError"
    this.code = code
  }
}

type SourceResolverClient = {
  notaFiscal: {
    findFirst: (args: unknown) => Promise<unknown | null>
  }
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function tpEmisFromTipoEmissao(tipoEmissao: unknown): number {
  const raw = text(tipoEmissao)
  if (raw === "CONTINGENCIA_OFFLINE") return 9
  return 1
}

function asNotaRow(row: UnknownRecord): NotaFiscalRow {
  const itens = Array.isArray(row.itens) ? row.itens : []
  return {
    id: String(row.id ?? ""),
    storeId: String(row.storeId ?? ""),
    vendaId: String(row.vendaId ?? ""),
    modelo: String(row.modelo ?? ""),
    ambiente: String(row.ambiente ?? ""),
    snapshotEmitente: row.snapshotEmitente,
    snapshotDestinatario: row.snapshotDestinatario,
    snapshotPagamento: row.snapshotPagamento,
    itens: itens.map((item) => {
      const it = record(item)
      return {
        itemVendaId: it.itemVendaId == null ? null : String(it.itemVendaId),
        produtoId: it.produtoId == null ? null : String(it.produtoId),
        numeroItem: Number(it.numeroItem ?? 0),
        codigoProduto: String(it.codigoProduto ?? ""),
        descricao: String(it.descricao ?? ""),
        gtin: it.gtin == null ? null : String(it.gtin),
        ncm: String(it.ncm ?? ""),
        cest: it.cest == null ? null : String(it.cest),
        cfop: String(it.cfop ?? ""),
        cst: it.cst == null ? null : String(it.cst),
        csosn: it.csosn == null ? null : String(it.csosn),
        origemMercadoria: Number(it.origemMercadoria ?? 0),
        unidadeComercial: String(it.unidadeComercial ?? "UN"),
        quantidade: Number(it.quantidade ?? 0),
        valorUnitario: Number(it.valorUnitario ?? 0),
        valorDesconto: Number(it.valorDesconto ?? 0),
        valorTotal: Number(it.valorTotal ?? 0),
      }
    }),
  }
}

export function createPersistedNfceFinalizationSourceResolver(
  client: SourceResolverClient,
): (locator: FiscalDocumentLocator) => Promise<NfceFinalizationSource> {
  return async (locator) => {
    const raw = record(
      await client.notaFiscal.findFirst({
        where: {
          id: locator.notaFiscalId,
          storeId: locator.storeId,
          vendaId: locator.vendaId,
          modelo: "NFCE",
          ambiente: "HOMOLOGACAO",
        },
        select: {
          id: true,
          storeId: true,
          vendaId: true,
          modelo: true,
          ambiente: true,
          serie: true,
          numero: true,
          tipoEmissao: true,
          dataContingencia: true,
          justContingencia: true,
          localKey: true,
          snapshotEmitente: true,
          snapshotDestinatario: true,
          snapshotPagamento: true,
          itens: {
            select: {
              itemVendaId: true,
              produtoId: true,
              numeroItem: true,
              codigoProduto: true,
              descricao: true,
              gtin: true,
              ncm: true,
              cest: true,
              cfop: true,
              cst: true,
              csosn: true,
              origemMercadoria: true,
              unidadeComercial: true,
              quantidade: true,
              valorUnitario: true,
              valorDesconto: true,
              valorTotal: true,
            },
            orderBy: { numeroItem: "asc" },
          },
        },
      }),
    )
    if (!raw.id) {
      throw new NfceFinalizationSourceError(
        "nota_nao_encontrada",
        "NotaFiscal persistida não encontrada no escopo fiscal solicitado.",
      )
    }
    if (
      String(raw.storeId) !== locator.storeId ||
      String(raw.vendaId) !== locator.vendaId ||
      String(raw.id) !== locator.notaFiscalId ||
      String(raw.modelo) !== "NFCE" ||
      String(raw.ambiente) !== "HOMOLOGACAO"
    ) {
      throw new NfceFinalizationSourceError(
        "escopo_incompativel",
        "NotaFiscal persistida não pertence ao escopo NFC-e de homologação solicitado.",
      )
    }

    const snapshot = reconstructSnapshotFromNota(asNotaRow(raw))
    if (!snapshot) {
      throw new NfceFinalizationSourceError(
        "fonte_fiscal_insuficiente",
        "Snapshot fiscal congelado insuficiente; reconstrução a partir de dados vivos recusada.",
      )
    }
    if (snapshot.storeId !== locator.storeId || snapshot.vendaId !== locator.vendaId) {
      throw new NfceFinalizationSourceError(
        "escopo_incompativel",
        "Snapshot fiscal congelado não pertence ao escopo solicitado.",
      )
    }

    const serie = Number(raw.serie)
    const numero = Number(raw.numero)
    if (!Number.isInteger(serie) || serie <= 0 || !Number.isInteger(numero) || numero <= 0) {
      throw new NfceFinalizationSourceError(
        "numeracao_ausente",
        "Numeração fiscal persistida ausente; alocação não é inventada neste resolver.",
      )
    }

    const uf = text(snapshot.emitente?.endereco?.uf).toUpperCase() || undefined
    const correlationId = text(raw.localKey) || undefined
    const dataEmissao = text(snapshot.venda?.data) || undefined

    return {
      storeId: locator.storeId,
      vendaId: locator.vendaId,
      notaFiscalId: locator.notaFiscalId,
      modelo: "NFCE",
      ambiente: "HOMOLOGACAO",
      serie,
      numero,
      snapshot,
      tpEmis: tpEmisFromTipoEmissao(raw.tipoEmissao),
      ...(raw.dataContingencia ? { dhCont: raw.dataContingencia as string | Date } : {}),
      ...(text(raw.justContingencia) ? { xJust: text(raw.justContingencia) } : {}),
      ...(dataEmissao ? { dataEmissao } : {}),
      ...(uf ? { uf } : {}),
      ...(correlationId ? { correlationId } : {}),
    }
  }
}
