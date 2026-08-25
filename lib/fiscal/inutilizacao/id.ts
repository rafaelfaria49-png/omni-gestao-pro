/**
 * Composição do atributo Id de `infInut` — somente o grafo oficial da inutilização.
 *
 * Padrão vigente (`leiauteInutNFe_v4.00.xsd` em `PL_010d_v1.03`):
 *   `ID[0-9]{4}[0-9A-Z]{12}[0-9]{25}`
 *
 * MOC 7.0 DP04: literal "ID" + cUF(2) + ano(2) + CNPJ(14) + modelo(2) + série(3)
 * + nNFIni(9) + nNFFin(9) = 43 caracteres.
 *
 * A NT 2026.004 não se lê do evento 110111: o próprio schema parte o CNPJ em
 * 12 alfanuméricos + 2 dígitos finais, alinhado a `TCnpj` `[0-9A-Z]{12}[0-9]{2}`.
 */

import { INF_INUT_ID_PATTERN, TCNPJ_PATTERN, type InutilizacaoPedidoNormalizado } from "./types"

function padDigits(value: string, len: number): string {
  if (!/^[0-9]+$/.test(value)) return value
  return value.padStart(len, "0")
}

export function montarIdInutilizacao(p: {
  readonly cUF: string
  readonly ano: string
  readonly cnpj: string
  readonly modelo: string
  readonly serie: string
  readonly nNFIni: string
  readonly nNFFin: string
}): string {
  const cnpj = p.cnpj.toUpperCase()
  return (
    "ID" +
    padDigits(p.cUF, 2) +
    padDigits(p.ano, 2) +
    cnpj +
    padDigits(p.modelo, 2) +
    padDigits(p.serie, 3) +
    padDigits(p.nNFIni, 9) +
    padDigits(p.nNFFin, 9)
  )
}

export function idConferePedido(id: string, pedido: InutilizacaoPedidoNormalizado): boolean {
  if (!INF_INUT_ID_PATTERN.test(id)) return false
  if (!TCNPJ_PATTERN.test(pedido.cnpj)) return false
  return id === montarIdInutilizacao(pedido)
}
