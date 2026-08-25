import type { InutilizacaoPedidoInput } from "../types"

export const PEDIDO_VALIDO: InutilizacaoPedidoInput = {
  tpAmb: "2",
  cUF: "35",
  ano: "26",
  cnpj: "11222333000181",
  modelo: "65",
  serie: "1",
  nNFIni: "1",
  nNFFin: "1",
  xJust: "Quebra de sequencia na numeracao NFC-e",
  anoCalendario: 2026,
}

/** CNPJ alfanumérico no padrão TCnpj vigente — 12 [0-9A-Z] + 2 dígitos. */
export const PEDIDO_CNPJ_ALFA: InutilizacaoPedidoInput = {
  ...PEDIDO_VALIDO,
  cnpj: "A1B2C3D4E5F601",
}

export const ID_PEDIDO_VALIDO = "ID35261122233300018165001000000001000000001"
export const ID_PEDIDO_CNPJ_ALFA = "ID3526A1B2C3D4E5F60165001000000001000000001"

export function retInutNFe(args: {
  cStat: string
  xMotivo: string
  nProt?: string
  cUF?: string
}): string {
  const prot = args.nProt ? `\n    <nProt>${args.nProt}</nProt>` : ""
  return (
    `<retInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<infInut>` +
    `<tpAmb>2</tpAmb>` +
    `<verAplic>SP_TESTE</verAplic>` +
    `<cStat>${args.cStat}</cStat>` +
    `<xMotivo>${args.xMotivo}</xMotivo>` +
    `<cUF>${args.cUF ?? "35"}</cUF>` +
    `<dhRecbto>2026-08-16T12:00:00-03:00</dhRecbto>` +
    prot +
    `</infInut>` +
    `</retInutNFe>`
  )
}

export const PROT_15 = "135260000000001"
export const PROT_17 = "13526000000000001"
