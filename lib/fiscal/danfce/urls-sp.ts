/**
 * Catálogo oficial das URLs públicas NFC-e da SEFAZ-SP (GOAL 021 · P-URL-SP).
 *
 * Somente consulta pública / QR Code impresso no DANFC-e. Não é catálogo SOAP,
 * não autoriza transmissão, não chama Web Service, não lê env.
 *
 * Fonte oficial confirmada em 2026-08-18:
 * https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx
 *
 * A página lista, por ambiente, o endereço longo histórico e o atalho curto.
 * Este GOAL adjudica os atalhos curtos como canônicos do DANFC-e/QR v3
 * (`qrcode` / `consulta`), e aceita os longos como alias oficiais da mesma fonte.
 *
 * Homologação (página oficial):
 *   QR:  https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode
 *        https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx
 *   chave: https://www.homologacao.nfce.fazenda.sp.gov.br/consulta
 *          https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica
 *
 * Produção (página oficial):
 *   QR:  https://www.nfce.fazenda.sp.gov.br/qrcode
 *        https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx
 *   chave: a página lista https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica
 *          o atalho https://www.nfce.fazenda.sp.gov.br/consulta é adjudicado neste
 *          GOAL por paralelismo com o atalho de homologação publicado na mesma fonte.
 *
 * Confirmação auxiliar (ENCAT, URLs por UF): https://nfce.encat.org/desenvolvedor/qrcode/
 */

export const NFCE_SP_URL_CATALOG_VERSAO = "2026-08-18" as const
export const NFCE_SP_URL_FONTE_OFICIAL =
  "https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx" as const
export const NFCE_SP_URL_CONFIRMADO_EM = "2026-08-18" as const

export type NfceSpAmbientePublico = "HOMOLOGACAO" | "PRODUCAO"

export type NfceSpPublicUrls = {
  readonly uf: "SP"
  readonly ambiente: NfceSpAmbientePublico
  readonly tpAmb: "1" | "2"
  readonly qrCodeBaseUrl: string
  readonly urlChave: string
  readonly qrCodeBaseUrlAliases: readonly string[]
  readonly urlChaveAliases: readonly string[]
  readonly fonteOficial: typeof NFCE_SP_URL_FONTE_OFICIAL
  readonly confirmadoEm: typeof NFCE_SP_URL_CONFIRMADO_EM
  readonly catalogoVersao: typeof NFCE_SP_URL_CATALOG_VERSAO
}

const HOMOLOGACAO: NfceSpPublicUrls = Object.freeze({
  uf: "SP",
  ambiente: "HOMOLOGACAO",
  tpAmb: "2",
  qrCodeBaseUrl: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
  urlChave: "https://www.homologacao.nfce.fazenda.sp.gov.br/consulta",
  qrCodeBaseUrlAliases: Object.freeze([
    "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
    "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx",
  ]),
  urlChaveAliases: Object.freeze([
    "https://www.homologacao.nfce.fazenda.sp.gov.br/consulta",
    "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
  ]),
  fonteOficial: NFCE_SP_URL_FONTE_OFICIAL,
  confirmadoEm: NFCE_SP_URL_CONFIRMADO_EM,
  catalogoVersao: NFCE_SP_URL_CATALOG_VERSAO,
})

const PRODUCAO: NfceSpPublicUrls = Object.freeze({
  uf: "SP",
  ambiente: "PRODUCAO",
  tpAmb: "1",
  qrCodeBaseUrl: "https://www.nfce.fazenda.sp.gov.br/qrcode",
  urlChave: "https://www.nfce.fazenda.sp.gov.br/consulta",
  qrCodeBaseUrlAliases: Object.freeze([
    "https://www.nfce.fazenda.sp.gov.br/qrcode",
    "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx",
  ]),
  urlChaveAliases: Object.freeze([
    "https://www.nfce.fazenda.sp.gov.br/consulta",
    "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
  ]),
  fonteOficial: NFCE_SP_URL_FONTE_OFICIAL,
  confirmadoEm: NFCE_SP_URL_CONFIRMADO_EM,
  catalogoVersao: NFCE_SP_URL_CATALOG_VERSAO,
})

export const NFCE_SP_PUBLIC_URL_CATALOG: readonly NfceSpPublicUrls[] = Object.freeze([HOMOLOGACAO, PRODUCAO])

function normalizeUrl(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\/+$/, "")
}

export function selectNfceSpPublicUrls(ambiente: NfceSpAmbientePublico): NfceSpPublicUrls {
  if (ambiente === "PRODUCAO") return PRODUCAO
  if (ambiente === "HOMOLOGACAO") return HOMOLOGACAO
  throw new Error("Ambiente público NFC-e SP desconhecido.")
}

export function selectNfceSpPublicUrlsByTpAmb(tpAmb: "1" | "2" | 1 | 2 | string): NfceSpPublicUrls {
  const value = String(tpAmb).trim()
  if (value === "1") return PRODUCAO
  if (value === "2") return HOMOLOGACAO
  throw new Error("tpAmb público NFC-e SP desconhecido.")
}

export function isOfficialNfceSpQrBaseUrl(url: string, ambiente?: NfceSpAmbientePublico): boolean {
  const normalized = normalizeUrl(url)
  const catalogs = ambiente ? [selectNfceSpPublicUrls(ambiente)] : NFCE_SP_PUBLIC_URL_CATALOG
  return catalogs.some((entry) => entry.qrCodeBaseUrlAliases.some((alias) => normalizeUrl(alias) === normalized))
}

export function isOfficialNfceSpUrlChave(url: string, ambiente?: NfceSpAmbientePublico): boolean {
  const normalized = normalizeUrl(url)
  const catalogs = ambiente ? [selectNfceSpPublicUrls(ambiente)] : NFCE_SP_PUBLIC_URL_CATALOG
  return catalogs.some((entry) => entry.urlChaveAliases.some((alias) => normalizeUrl(alias) === normalized))
}

/** Extrai a URL base (sem `?p=`) de um qrCode persistido. */
export function qrCodeBaseFromPersisted(qrCodeData: string): string {
  const raw = String(qrCodeData ?? "").trim()
  const marker = raw.indexOf("?p=")
  if (marker <= 0) return normalizeUrl(raw)
  return normalizeUrl(raw.slice(0, marker))
}
