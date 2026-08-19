/**
 * Fixtures fiscais locais do DANFC-e (GOAL 021).
 *
 * XML NFC-e 4.00 assinado com certificado de TESTE. URLs oficiais SP do catálogo.
 * Sem A1 real, sem rede, sem SEFAZ.
 */

import { DRY_RUN_TEST_CERT } from "@/lib/fiscal/dry-run"
import { signNfceXmlDetailed } from "@/lib/fiscal/signing"
import {
  buildNfceXmlAssinavelResult,
  type NfceXmlContext,
} from "@/lib/fiscal/xml"
import { sanitizeProdutoFiscal } from "@/lib/produto-fiscal"
import {
  buildVendaFiscalSnapshot,
  type BuildSnapshotInput,
  type SnapshotClienteInput,
  type SnapshotItemInput,
  type SnapshotLojaInput,
} from "@/lib/fiscal/venda-fiscal-snapshot"
import { createQrV3OfflinePemSigner } from "../qr-v3"
import { selectNfceSpPublicUrls, type NfceSpAmbientePublico } from "../urls-sp"
import type { AuthorizedXmlDocument } from "@/lib/fiscal/storage"

const LOJA: SnapshotLojaInput = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "RafaCell Comércio LTDA",
  nomeFantasia: "RafaCell",
  inscricaoEstadual: "123456789",
  inscricaoMunicipal: "987654",
  regimeTributario: "SIMPLES_NACIONAL",
  crt: 1,
  ambiente: "HOMOLOGACAO",
  modeloFiscal: "NFCE",
  fiscalEnabled: false,
  logradouro: "Rua das Flores",
  numero: "100",
  complemento: "",
  bairro: "Centro",
  codigoMunicipioIbge: "3550308",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01001-000",
  codigoPais: "1058",
  fone: "",
  email: "",
}

function item(over: Partial<SnapshotItemInput> = {}): SnapshotItemInput {
  return {
    itemVendaId: "iv-1",
    produtoId: "prod-1",
    codigoProduto: "SKU-1",
    descricao: "Cabo USB-C",
    gtin: "7891234567890",
    quantidade: 2,
    valorUnitario: 25,
    valorDesconto: 0,
    valorTotal: 50,
    fiscal: sanitizeProdutoFiscal({ ncm: "85176200", cfop: "5102", csosn: "102", origem: "0", unidade: "UN" }),
    ...over,
  }
}

export type DanfceFixtureKind =
  | "autorizado_simples"
  | "homologacao"
  | "consumidor_ausente"
  | "consumidor_cpf"
  | "consumidor_cnpj"
  | "multiplos_itens"
  | "multiplos_pagamentos"
  | "producao"
  | "contingencia_tpemis_9"
  | "contingencia_sem_protocolo"

const CLIENTE_CPF: SnapshotClienteInput = {
  nome: "Maria Consumidora",
  documento: "123.456.789-09",
  kind: "PF",
  telefone: "",
  email: "",
  municipio: "São Paulo",
}

const CLIENTE_CNPJ: SnapshotClienteInput = {
  nome: "Empresa Destino LTDA",
  documento: "33.445.556/0001-77",
  kind: "PJ",
  telefone: "",
  email: "",
  municipio: "São Paulo",
}

function snapshotInput(kind: DanfceFixtureKind): BuildSnapshotInput {
  const base: BuildSnapshotInput = {
    storeId: "loja-1",
    vendaId: `venda-${kind}`,
    loja: LOJA,
    cliente: null,
    venda: {
      pedidoId: `VDA-${kind}`,
      data: "2026-06-18T12:00:00.000Z",
      total: 50,
      desconto: 0,
      operador: "João",
      terminal: "PDV1",
      paymentBreakdown: { dinheiro: 50 },
    },
    itens: [item()],
  }
  switch (kind) {
    case "consumidor_cpf":
    case "homologacao":
    case "autorizado_simples":
      return { ...base, cliente: CLIENTE_CPF }
    case "consumidor_ausente":
      return base
    case "consumidor_cnpj":
      return { ...base, cliente: CLIENTE_CNPJ }
    case "multiplos_itens":
      return {
        ...base,
        venda: { ...base.venda, total: 400, paymentBreakdown: { dinheiro: 400 } },
        itens: [
          item({ itemVendaId: "a", descricao: "Película", quantidade: 1, valorUnitario: 100, valorTotal: 100 }),
          item({ itemVendaId: "b", descricao: "Capa", quantidade: 2, valorUnitario: 150, valorTotal: 300 }),
        ],
      }
    case "multiplos_pagamentos":
      return {
        ...base,
        venda: { ...base.venda, paymentBreakdown: { dinheiro: 20, pix: 30 } },
      }
    case "producao":
      return { ...base, loja: { ...LOJA!, ambiente: "PRODUCAO" }, cliente: CLIENTE_CPF }
    case "contingencia_tpemis_9":
    case "contingencia_sem_protocolo":
      return { ...base, cliente: CLIENTE_CPF }
  }
}

function stripDecl(xml: string): string {
  return xml.replace(/^\uFEFF/, "").replace(/^<\?xml[^?]*\?>\s*/i, "")
}

function wrapNfeProc(signedXml: string, args: {
  chave: string
  nProt: string
  tpAmb: "1" | "2"
  digestValue: string
}): string {
  const nfe = stripDecl(signedXml)
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}<protNFe versao="4.00"><infProt><tpAmb>${args.tpAmb}</tpAmb><verAplic>SP_NFCE_TESTE</verAplic><chNFe>${args.chave}</chNFe><dhRecbto>2026-06-18T12:01:00-03:00</dhRecbto><nProt>${args.nProt}</nProt><digVal>${args.digestValue}</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`
}

function withTroco(xml: string): string {
  if (xml.includes("<vTroco>")) return xml
  return xml.replace("</pag>", "<vTroco>10.00</vTroco></pag>")
}

export type DanfcePersistedFixture = {
  kind: DanfceFixtureKind
  document: AuthorizedXmlDocument
}

export function buildPersistedDanfceFixture(kind: DanfceFixtureKind): DanfcePersistedFixture {
  const builtSnap = buildVendaFiscalSnapshot(snapshotInput(kind))
  if (!builtSnap.ok) throw new Error(`fixture snapshot inválida (${kind}): ${builtSnap.code}`)
  const contingencia = kind === "contingencia_tpemis_9" || kind === "contingencia_sem_protocolo"
  const ambiente: NfceSpAmbientePublico = kind === "producao" ? "PRODUCAO" : "HOMOLOGACAO"
  const urls = selectNfceSpPublicUrls(ambiente)
  const ctx: NfceXmlContext = contingencia
    ? {
        serie: 1,
        numero: 42,
        tpEmis: 9,
        qrOfflineV3: {
          qrCodeBaseUrl: urls.qrCodeBaseUrl,
          urlChave: urls.urlChave,
          sign: createQrV3OfflinePemSigner(DRY_RUN_TEST_CERT.privateKeyPem),
        },
      }
    : {
        serie: 1,
        numero: 42,
        qrOnlineV3: { qrCodeBaseUrl: urls.qrCodeBaseUrl, urlChave: urls.urlChave },
      }
  const built = buildNfceXmlAssinavelResult(builtSnap.snapshot, ctx)
  if (!built.infNFeSupl) throw new Error(`fixture sem infNFeSupl (${kind})`)
  const signed = signNfceXmlDetailed(built.xml, DRY_RUN_TEST_CERT, "")
  const tpAmb = ambiente === "PRODUCAO" ? "1" : "2"
  const protocolo = contingencia && kind === "contingencia_sem_protocolo" ? null : "135260000000042"
  let xmlAssinado = signed.xml
  let xmlAutorizado: string | null = null
  if (kind === "multiplos_pagamentos") {
    xmlAssinado = withTroco(xmlAssinado)
  }
  if (protocolo) {
    xmlAutorizado = wrapNfeProc(kind === "multiplos_pagamentos" ? withTroco(signed.xml) : signed.xml, {
      chave: built.chaveAcesso,
      nProt: protocolo,
      tpAmb,
      digestValue: signed.digestValue,
    })
  }
  const document: AuthorizedXmlDocument = {
    storeId: "loja-1",
    vendaId: `venda-${kind}`,
    notaFiscalId: `nota-${kind}`,
    chaveAcesso: built.chaveAcesso,
    serie: built.serie,
    numero: built.numero,
    modelo: "NFCE",
    ambiente,
    status: protocolo ? "AUTORIZADA" : "EM_CONTINGENCIA",
    xmlAutorizado,
    xmlAssinado,
    xmlAutorizadoSha256: null,
    xmlAssinadoSha256: null,
    protocolo,
    cStat: protocolo ? "100" : null,
    xMotivo: protocolo ? "Autorizado o uso da NF-e" : null,
    dataAutorizacao: protocolo ? new Date("2026-06-18T15:01:00.000Z") : null,
    digestValue: signed.digestValue,
    qrCodeData: built.infNFeSupl.qrCode,
    urlConsulta: built.infNFeSupl.urlChave,
    xmlStorageRef: null,
  }
  return { kind, document }
}
