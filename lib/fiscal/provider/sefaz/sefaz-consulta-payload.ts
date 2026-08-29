/**
 * Construtor do payload oficial de `NFeConsultaProtocolo4` — `consSitNFe`
 * (GOAL 020 · live readiness interna · leiaute PL_010e_v1.02).
 *
 * Consulta POR CHAVE: o payload é composto apenas de `tpAmb` (2 = homologação,
 * o único ambiente do piloto), `xServ` fixo `CONSULTAR` e a `chNFe` de 44
 * dígitos já persistida no documento. **Nenhuma numeração é criada e nenhum
 * documento é reconstruído** — a chave vem do documento persistido e o serviço
 * de consulta é LEITURA.
 *
 * Saída EMBUTÍVEL: sem declaração XML e sem BOM, pronta para
 * `buildSefazSoap12Envelope` (que exige exatamente um elemento raiz sem
 * declaração).
 */
import { SEFAZ_NFE_NS } from "./sefaz-lote-envinfe"
import { SEFAZ_LAYOUT_VERSAO } from "./sefaz-endpoint-catalog"

const CHAVE_ACESSO = /^\d{44}$/

export type SefazConsultaPayloadRejectionCode =
  | "consulta_chave_invalida"
  | "consulta_tpamb_invalido"

export type SefazConsultaPayload =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly codigo: SefazConsultaPayloadRejectionCode; readonly mensagem: string }

/**
 * Compõe o `consSitNFe` da consulta por chave, ou RECUSE de forma fail-closed.
 *
 * `tpAmb` é fixo `2`: os guards D4 (1 e 2) só admitem homologação, e um payload
 * divergente do ambiente autorizado seria recusado pela SEFAZ de qualquer forma.
 */
export function buildConsSitNFePayload(input: {
  chaveAcesso: string
  /** Fixo do piloto; override existe apenas para prova em teste. */
  tpAmb?: "2"
}): SefazConsultaPayload {
  const chaveAcesso = typeof input.chaveAcesso === "string" ? input.chaveAcesso.trim() : ""
  if (!CHAVE_ACESSO.test(chaveAcesso)) {
    return {
      ok: false,
      codigo: "consulta_chave_invalida",
      mensagem: "Consulta por chave exige chNFe de exatamente 44 dígitos.",
    }
  }
  const tpAmb = input.tpAmb ?? "2"
  if (tpAmb !== "2") {
    return {
      ok: false,
      codigo: "consulta_tpamb_invalido",
      mensagem: "Somente tpAmb 2 (homologação) é permitido no piloto.",
    }
  }

  const xml =
    `<consSitNFe xmlns="${SEFAZ_NFE_NS}" versao="${SEFAZ_LAYOUT_VERSAO}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `</consSitNFe>`

  return { ok: true, bytes: new TextEncoder().encode(xml) }
}
