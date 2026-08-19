/**
 * Superfície pura/read-only de reimpressão DANFC-e (GOAL 021).
 *
 * Recebe `notaFiscalId` + `storeId` (e `vendaId` opcional) e carrega somente o
 * documento fiscal persistido via `FiscalXmlReader`. Nenhuma leitura de
 * Venda/Produto/Cliente vivos. QR não é recalculado.
 */

import type { AuthorizedXmlDocument, FiscalXmlReader } from "@/lib/fiscal/storage"
import { parseDanfceFromPersisted } from "./parse-persisted"
import { DanfceParseError, type DanfceModel, type DanfceReprintLocator } from "./types"

export type DanfceReprintPorts = {
  readonly readAuthorizedDocument: FiscalXmlReader["readAuthorizedDocument"]
}

function toArtifacts(doc: AuthorizedXmlDocument) {
  return {
    storeId: doc.storeId,
    notaFiscalId: doc.notaFiscalId,
    xmlAutorizado: doc.xmlAutorizado,
    xmlAssinado: doc.xmlAssinado,
    chaveAcesso: doc.chaveAcesso,
    protocolo: doc.protocolo,
    dataAutorizacao: doc.dataAutorizacao,
    qrCodeData: doc.qrCodeData,
    urlConsulta: doc.urlConsulta,
    ambiente: doc.ambiente,
    digestValue: doc.digestValue,
  }
}

export async function loadDanfceForReprint(
  locator: DanfceReprintLocator,
  ports: DanfceReprintPorts,
): Promise<DanfceModel> {
  if (!locator?.storeId?.trim()) {
    throw new DanfceParseError("store_id_obrigatorio", "Reimpressão DANFC-e exige storeId.")
  }
  if (!locator.notaFiscalId?.trim()) {
    throw new DanfceParseError("nota_nao_encontrada", "Reimpressão DANFC-e exige notaFiscalId.")
  }
  const doc = await ports.readAuthorizedDocument({
    storeId: locator.storeId,
    notaFiscalId: locator.notaFiscalId,
    vendaId: locator.vendaId ?? "",
  })
  if (!doc) {
    throw new DanfceParseError("nota_nao_encontrada", "Documento fiscal persistido não encontrado nesta loja.")
  }
  return parseDanfceFromPersisted(toArtifacts(doc))
}

export function danfceFingerprint(model: DanfceModel): string {
  return JSON.stringify({
    documento: model.documento,
    variante: model.variante,
    ambiente: model.ambiente,
    tpEmis: model.tpEmis,
    chaveAcesso: model.chaveAcesso,
    protocolo: model.protocolo,
    qrCodeData: model.qrCodeData,
    urlConsulta: model.urlConsulta,
    numero: model.numero,
    serie: model.serie,
    dhEmi: model.dhEmi,
    valorTotal: model.valorTotal,
    quantidadeTotalItens: model.quantidadeTotalItens,
    itens: model.itens,
    pagamentos: model.pagamentos,
    troco: model.troco,
    consumidor: model.consumidor,
    emitente: model.emitente,
    mensagensFiscais: model.mensagensFiscais,
    homologacaoSemValorFiscal: model.homologacaoSemValorFiscal,
    contingencia: model.contingencia,
  })
}
