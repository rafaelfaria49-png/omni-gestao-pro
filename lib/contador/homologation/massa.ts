/**
 * Massa mínima HOMOLOGACAO do GOAL 018 (auditoria de prontidão).
 * Nenhuma linha é transmitida à SEFAZ. StoreIds sintéticos — não são loja de Production.
 */
import {
  XML_AUTORIZADA_COMPETENCIA,
  XML_AUTORIZADA_DHEMI_INVALIDO,
  XML_AUTORIZADA_FORA,
  XML_REJEITADA_COMPETENCIA,
} from "./xml-fixtures"

export const STORE_A = "homolog-contador-a"
export const STORE_B = "homolog-contador-b"
export const STORE_IDS = Object.freeze([STORE_A, STORE_B] as const)
export const COMPETENCIA_REF = Object.freeze({ ano: 2026, mes: 7 })

export type CasoMassa =
  | "autorizada_homologacao_vigente_dhemi_ok"
  | "autorizada_fora_competencia"
  | "autorizada_dhemi_invalido"
  | "rejeitada"
  | "cancelada_sintetica_politica_negativa"
  | "outra_storeId"
  | "producao_caso_negativo"

export type LinhaMassa = Readonly<{
  caso: CasoMassa
  storeId: typeof STORE_A | typeof STORE_B
  vendaId: string
  pedidoId: string
  notaId: string
  chaveAcesso: string
  localKey: string
  modelo: "NFCE"
  serie: 1
  numero: number
  status: "AUTORIZADA" | "REJEITADA" | "CANCELADA"
  ambiente: "HOMOLOGACAO" | "PRODUCAO"
  vigente: boolean
  protocolo: string | null
  xmlAutorizado: string | null
}>

function chave(n: number): string {
  return `352607${String(n).padStart(38, "0")}`
}

export const LINHAS_MASSA: readonly LinhaMassa[] = Object.freeze([
  {
    caso: "autorizada_homologacao_vigente_dhemi_ok",
    storeId: STORE_A,
    vendaId: "venda-homolog-ok",
    pedidoId: "HML-2026-0001",
    notaId: "nota-homolog-ok",
    chaveAcesso: chave(1),
    localKey: "homolog:ok",
    modelo: "NFCE",
    serie: 1,
    numero: 1,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000001",
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
  },
  {
    caso: "autorizada_fora_competencia",
    storeId: STORE_A,
    vendaId: "venda-homolog-fora",
    pedidoId: "HML-2026-0002",
    notaId: "nota-homolog-fora",
    chaveAcesso: chave(2),
    localKey: "homolog:fora",
    modelo: "NFCE",
    serie: 1,
    numero: 2,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000002",
    xmlAutorizado: XML_AUTORIZADA_FORA,
  },
  {
    caso: "autorizada_dhemi_invalido",
    storeId: STORE_A,
    vendaId: "venda-homolog-dhemi",
    pedidoId: "HML-2026-0003",
    notaId: "nota-homolog-dhemi",
    chaveAcesso: chave(3),
    localKey: "homolog:dhemi",
    modelo: "NFCE",
    serie: 1,
    numero: 3,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000003",
    xmlAutorizado: XML_AUTORIZADA_DHEMI_INVALIDO,
  },
  {
    caso: "rejeitada",
    storeId: STORE_A,
    vendaId: "venda-homolog-rej",
    pedidoId: "HML-2026-0004",
    notaId: "nota-homolog-rej",
    chaveAcesso: chave(4),
    localKey: "homolog:rej",
    modelo: "NFCE",
    serie: 1,
    numero: 4,
    status: "REJEITADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: null,
    // Sem dhEmi válido a nota não entra em nenhuma competência (fail-closed).
    // XML sintético HOMOLOGACAO com 1 dhEmi + offset em 2026-07 para REJECTED_COUNT=1.
    xmlAutorizado: XML_REJEITADA_COMPETENCIA,
  },
  {
    caso: "cancelada_sintetica_politica_negativa",
    storeId: STORE_A,
    vendaId: "venda-homolog-canc",
    pedidoId: "HML-2026-0005",
    notaId: "nota-homolog-canc",
    chaveAcesso: chave(5),
    localKey: "homolog:canc",
    modelo: "NFCE",
    serie: 1,
    numero: 5,
    status: "CANCELADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000005",
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
  },
  {
    caso: "outra_storeId",
    storeId: STORE_B,
    vendaId: "venda-homolog-loja-b",
    pedidoId: "HML-2026-0006",
    notaId: "nota-homolog-loja-b",
    chaveAcesso: chave(6),
    localKey: "homolog:loja-b",
    modelo: "NFCE",
    serie: 1,
    numero: 1,
    status: "AUTORIZADA",
    ambiente: "HOMOLOGACAO",
    vigente: true,
    protocolo: "135260000000006",
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
  },
  {
    caso: "producao_caso_negativo",
    storeId: STORE_A,
    vendaId: "venda-homolog-prod",
    pedidoId: "HML-2026-0007",
    notaId: "nota-homolog-prod",
    chaveAcesso: chave(7),
    localKey: "homolog:prod",
    modelo: "NFCE",
    serie: 1,
    numero: 7,
    status: "AUTORIZADA",
    ambiente: "PRODUCAO",
    vigente: true,
    protocolo: "135260000000007",
    xmlAutorizado: XML_AUTORIZADA_COMPETENCIA,
  },
])
