/**
 * Builder XML determinístico do pedido `inutNFe` 4.00.
 *
 * Reusa `serializeXmlEmbeddable` / `leaf` / `group` — não duplica writer nem escaping.
 * Não assina. A assinatura entra pelo boundary em `sign-boundary.ts`.
 */

import { group, leafRequired, serializeXmlEmbeddable } from "../xml/xml-writer"
import {
  INUTILIZACAO_VERSAO,
  INUTILIZACAO_XMLNS,
  INUTILIZACAO_XSERV,
  type InutilizacaoBuildResult,
  type InutilizacaoPedidoInput,
} from "./types"
import { validateInutilizacaoPedido } from "./validation"

export function buildInutilizacaoXml(input: InutilizacaoPedidoInput): InutilizacaoBuildResult {
  const validado = validateInutilizacaoPedido(input)
  if (!validado.ok) {
    return { ok: false, xml: null, id: null, issues: validado.issues }
  }
  const p = validado.pedido
  const xml = serializeXmlEmbeddable(
    group(
      "inutNFe",
      [
        group(
          "infInut",
          [
            leafRequired("tpAmb", p.tpAmb),
            leafRequired("xServ", INUTILIZACAO_XSERV),
            leafRequired("cUF", p.cUF),
            leafRequired("ano", p.ano),
            leafRequired("CNPJ", p.cnpj),
            leafRequired("mod", p.modelo),
            leafRequired("serie", p.serie),
            leafRequired("nNFIni", p.nNFIni),
            leafRequired("nNFFin", p.nNFFin),
            leafRequired("xJust", p.xJust),
          ],
          { Id: p.id },
        ),
      ],
      { xmlns: INUTILIZACAO_XMLNS, versao: INUTILIZACAO_VERSAO },
    ),
  )
  return { ok: true, xml, id: p.id, pedido: p }
}
