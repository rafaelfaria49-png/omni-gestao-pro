/**
 * Parser/leitor do XML fiscal persistido para o modelo DANFC-e.
 *
 * Consome bytes já gravados (`xmlAutorizado` / `xmlAssinado` + metadados).
 * Não lê Venda, Produto, Cliente, carrinho ou estado de PDV.
 * Não recalcula QR: usa `qrCodeData` persistido (coluna ou infNFeSupl).
 */

import { attrOf, childElements, findAll, findFirst, parseXml, textOf, type C14nElement } from "@/lib/fiscal/signing/c14n"
import { QR_V3_OFFLINE_TP_EMIS, tpEmisDaChave } from "./qr-v3/canonical"
import {
  DANFCE_DOCUMENTO,
  DANFCE_LAYOUT,
  DANFCE_MSG_CONSULTA,
  DANFCE_MSG_CONTINGENCIA,
  DANFCE_MSG_CONTINGENCIA_PENDENTE,
  DANFCE_MSG_HOMOLOGACAO,
  DANFCE_MSG_SEM_PROTOCOLO,
  DanfceParseError,
  type DanfceAmbiente,
  type DanfceConsumidor,
  type DanfceItem,
  type DanfceModel,
  type DanfcePagamento,
} from "./types"
import { labelTPag } from "./format"
import {
  isOfficialNfceSpQrBaseUrl,
  isOfficialNfceSpUrlChave,
  qrCodeBaseFromPersisted,
  selectNfceSpPublicUrlsByTpAmb,
} from "./urls-sp"

export type PersistedFiscalArtifacts = {
  readonly storeId: string
  readonly notaFiscalId: string
  readonly xmlAutorizado?: string | null
  readonly xmlAssinado?: string | null
  readonly chaveAcesso?: string | null
  readonly protocolo?: string | null
  readonly dataAutorizacao?: Date | string | null
  readonly qrCodeData?: string | null
  readonly urlConsulta?: string | null
  readonly ambiente?: string | null
  readonly digestValue?: string | null
}

function textPath(root: C14nElement, names: readonly string[]): string {
  let current: C14nElement | null = root
  for (const name of names) {
    if (!current) return ""
    current = findFirst(current, name)
  }
  return textOf(current)
}

function firstText(root: C14nElement, name: string): string {
  return textOf(findFirst(root, name))
}

function joinEndereco(ender: C14nElement | null): string {
  if (!ender) return ""
  const parts = [
    firstText(ender, "xLgr"),
    firstText(ender, "nro"),
    firstText(ender, "xCpl"),
    firstText(ender, "xBairro"),
    firstText(ender, "xMun"),
    firstText(ender, "UF"),
    firstText(ender, "CEP"),
  ].filter((part) => part.length > 0)
  return parts.join(", ")
}

function parseConsumidor(infNFe: C14nElement): DanfceConsumidor {
  const dest = findFirst(infNFe, "dest")
  if (!dest) return { kind: "ausente" }
  const cpf = firstText(dest, "CPF")
  const cnpj = firstText(dest, "CNPJ")
  const nome = firstText(dest, "xNome") || null
  if (cpf) return { kind: "cpf", cpf, nome }
  if (cnpj) return { kind: "cnpj", cnpj, nome }
  return { kind: "ausente" }
}

function parseItens(infNFe: C14nElement): DanfceItem[] {
  return findAll(infNFe, "det").map((det) => {
    const prod = findFirst(det, "prod")
    return {
      nItem: attrOf(det, "nItem") || "",
      codigo: prod ? firstText(prod, "cProd") : "",
      descricao: prod ? firstText(prod, "xProd") : "",
      quantidade: prod ? firstText(prod, "qCom") : "",
      unidade: prod ? firstText(prod, "uCom") : "",
      valorUnitario: prod ? firstText(prod, "vUnCom") : "",
      valorTotal: prod ? firstText(prod, "vProd") : "",
    }
  })
}

function parsePagamentos(infNFe: C14nElement): { pagamentos: DanfcePagamento[]; troco: string | null } {
  const pag = findFirst(infNFe, "pag")
  if (!pag) return { pagamentos: [], troco: null }
  const pagamentos = childElements(pag, "detPag").map((det) => {
    const tPag = firstText(det, "tPag")
    return {
      tPag,
      descricao: labelTPag(tPag),
      valor: firstText(det, "vPag"),
    }
  })
  const trocoRaw = firstText(pag, "vTroco")
  return { pagamentos, troco: trocoRaw || null }
}

function somaQuantidades(itens: readonly DanfceItem[]): string {
  const total = itens.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0)
  if (!Number.isFinite(total)) return String(itens.length)
  return Number.isInteger(total) ? String(total) : total.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
}

function ambienteDe(tpAmb: "1" | "2"): DanfceAmbiente {
  return tpAmb === "1" ? "PRODUCAO" : "HOMOLOGACAO"
}

function dataAutorizacaoIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const raw = String(value).trim()
  return raw.length > 0 ? raw : null
}

function resolvePersistedQr(
  xmlQr: string,
  columnQr: string | null | undefined,
): string {
  const fromColumn = String(columnQr ?? "").trim()
  const fromXml = String(xmlQr ?? "").trim()
  if (fromColumn && fromXml && fromColumn !== fromXml) {
    throw new DanfceParseError(
      "qr_divergente",
      "qrCodeData persistido diverge do qrCode do XML fiscal.",
    )
  }
  const qr = fromColumn || fromXml
  if (!qr) {
    throw new DanfceParseError("qr_ausente", "Documento persistido sem qrCodeData.")
  }
  return qr
}

function resolvePersistedUrlChave(
  xmlUrl: string,
  columnUrl: string | null | undefined,
  tpAmb: "1" | "2",
): string {
  const fromColumn = String(columnUrl ?? "").trim()
  const fromXml = String(xmlUrl ?? "").trim()
  const chosen = fromColumn || fromXml || selectNfceSpPublicUrlsByTpAmb(tpAmb).urlChave
  const ambiente = tpAmb === "1" ? "PRODUCAO" : "HOMOLOGACAO"
  if (!isOfficialNfceSpUrlChave(chosen, ambiente)) {
    throw new DanfceParseError(
      "url_nao_oficial",
      "urlConsulta persistida não pertence ao catálogo oficial SEFAZ-SP.",
    )
  }
  return chosen
}

/**
 * Monta o modelo DANFC-e a partir dos artefatos persistidos.
 * Preferência de XML: `xmlAutorizado` (nfeProc) → `xmlAssinado` (NFe).
 */
export function parseDanfceFromPersisted(artifacts: PersistedFiscalArtifacts): DanfceModel {
  if (!artifacts?.storeId || artifacts.storeId.trim().length === 0) {
    throw new DanfceParseError("store_id_obrigatorio", "DANFC-e exige storeId para isolar a loja.")
  }
  if (!artifacts.notaFiscalId || artifacts.notaFiscalId.trim().length === 0) {
    throw new DanfceParseError("nota_nao_encontrada", "DANFC-e exige notaFiscalId.")
  }

  const xml = String(artifacts.xmlAutorizado ?? "").trim() || String(artifacts.xmlAssinado ?? "").trim()
  if (!xml) {
    throw new DanfceParseError("xml_ausente", "Documento persistido sem XML fiscal.")
  }

  let root: C14nElement
  try {
    root = parseXml(xml)
  } catch {
    throw new DanfceParseError("xml_invalido", "XML fiscal persistido malformado.")
  }

  const infNFe = findFirst(root, "infNFe")
  if (!infNFe) {
    throw new DanfceParseError("xml_invalido", "XML fiscal persistido sem infNFe.")
  }

  const ide = findFirst(infNFe, "ide")
  const emit = findFirst(infNFe, "emit")
  if (!ide || !emit) {
    throw new DanfceParseError("xml_invalido", "XML fiscal persistido sem ide/emit.")
  }

  const idAttr = attrOf(infNFe, "Id")
  const chaveDoId = idAttr.startsWith("NFe") ? idAttr.slice(3) : ""
  const chave = String(artifacts.chaveAcesso ?? "").trim() || firstText(root, "chNFe") || chaveDoId
  if (!chave) {
    throw new DanfceParseError("chave_ausente", "Documento persistido sem chave de acesso.")
  }

  const tpAmbRaw = firstText(ide, "tpAmb")
  const tpAmb: "1" | "2" = tpAmbRaw === "1" ? "1" : "2"
  const tpEmis = firstText(ide, "tpEmis") || tpEmisDaChave(chave) || "1"
  const ambiente = ambienteDe(tpAmb)
  const contingencia = tpEmis === QR_V3_OFFLINE_TP_EMIS
  const homologacaoSemValorFiscal = tpAmb === "2"

  const supl = findFirst(root, "infNFeSupl")
  const xmlQr = supl ? firstText(supl, "qrCode") : ""
  const xmlUrl = supl ? firstText(supl, "urlChave") : ""
  const qrCodeData = resolvePersistedQr(xmlQr, artifacts.qrCodeData)
  const qrBase = qrCodeBaseFromPersisted(qrCodeData)
  if (!isOfficialNfceSpQrBaseUrl(qrBase, ambiente)) {
    throw new DanfceParseError(
      "url_nao_oficial",
      "Base do QR persistido não pertence ao catálogo oficial SEFAZ-SP.",
    )
  }
  if (!qrCodeData.includes(chave)) {
    throw new DanfceParseError("qr_divergente", "QR persistido não corresponde à chave do documento.")
  }
  const urlConsulta = resolvePersistedUrlChave(xmlUrl, artifacts.urlConsulta, tpAmb)

  const protocoloXml = firstText(root, "nProt")
  const protocolo = String(artifacts.protocolo ?? "").trim() || protocoloXml || null
  const autorizado = Boolean(protocolo)
  if (!autorizado && !contingencia) {
    // Documento sem protocolo só é honesto na variante de contingência.
  }

  const itens = parseItens(infNFe)
  const { pagamentos, troco } = parsePagamentos(infNFe)
  const icmsTot = findFirst(infNFe, "ICMSTot")
  const vNF = icmsTot ? firstText(icmsTot, "vNF") : ""
  const vProd = icmsTot ? firstText(icmsTot, "vProd") : null
  const vDesc = icmsTot ? firstText(icmsTot, "vDesc") : null
  const vTotTrib = icmsTot ? firstText(icmsTot, "vTotTrib") : null
  const infCpl = textPath(infNFe, ["infAdic", "infCpl"]) || null

  const mensagens: string[] = []
  if (homologacaoSemValorFiscal) mensagens.push(DANFCE_MSG_HOMOLOGACAO)
  if (contingencia) mensagens.push(DANFCE_MSG_CONTINGENCIA)
  if (contingencia && !protocolo) {
    mensagens.push(DANFCE_MSG_CONTINGENCIA_PENDENTE)
    mensagens.push(DANFCE_MSG_SEM_PROTOCOLO)
  }
  mensagens.push(`${DANFCE_MSG_CONSULTA} ${urlConsulta}`)

  const nomeFantasia = firstText(emit, "xFant") || null
  const modelo: DanfceModel = {
    documento: DANFCE_DOCUMENTO,
    layout: DANFCE_LAYOUT,
    variante: contingencia && !autorizado ? "contingencia" : "autorizado",
    ambiente,
    tpAmb,
    tpEmis,
    homologacaoSemValorFiscal,
    contingencia,
    emitente: {
      razaoSocial: firstText(emit, "xNome"),
      nomeFantasia,
      cnpj: firstText(emit, "CNPJ"),
      ie: firstText(emit, "IE") || null,
      endereco: joinEndereco(findFirst(emit, "enderEmit")),
    },
    consumidor: parseConsumidor(infNFe),
    itens,
    quantidadeTotalItens: somaQuantidades(itens),
    valorTotal: vNF,
    vProd: vProd || null,
    vDesc: vDesc && Number(vDesc) > 0 ? vDesc : null,
    vTotTrib: vTotTrib && Number(vTotTrib) > 0 ? vTotTrib : null,
    pagamentos,
    troco,
    numero: firstText(ide, "nNF"),
    serie: firstText(ide, "serie"),
    dhEmi: firstText(ide, "dhEmi"),
    chaveAcesso: chave,
    protocolo: autorizado ? protocolo : null,
    dataAutorizacao: autorizado ? dataAutorizacaoIso(artifacts.dataAutorizacao) || firstText(root, "dhRecbto") || null : null,
    qrCodeData,
    urlConsulta,
    mensagensFiscais: mensagens,
    informacoesAdicionais: infCpl,
    tributosResumo: vTotTrib && Number(vTotTrib) > 0 ? vTotTrib : null,
    notaFiscalId: artifacts.notaFiscalId,
    storeId: artifacts.storeId,
  }

  return Object.freeze(modelo)
}
