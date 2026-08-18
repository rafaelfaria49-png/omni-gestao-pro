/**
 * Canonicalização determinística dos campos do QR NFC-e v3.
 *
 * Regras extraídas somente do pacote regulatório GOAL 047 (Manual v6.0 Tabela 6/7,
 * NT 2025.001 v1.03, XSD PL_010e QRCODE V3). Sem CSC. Sem percent-encoding.
 */
import { calcularDigitoVerificadorChave } from "@/lib/fiscal/xml/nfce-chave-acesso"
import { QR_V3_VERSAO, type QrV3Ambiente, type QrV3Destinatario, type QrV3Err, type QrV3TpId } from "./types"

function onlyDigits(value: string): string {
  return String(value ?? "").replace(/\D+/g, "")
}

/** Literal da versão do QR. Nunca 2, nunca 100. */
export const QR_V3_NVERSAO = QR_V3_VERSAO

const CHAVE_CORPO = /^[0-9]{6}[0-9A-Z]{12}[0-9]{16}([1349])[0-9]{8}[0-9]$/
const TP_AMB = /^(1|2)$/
const DIA = /^(0[1-9]|[12][0-9]|3[01])$/
const VNF = /^(0|0\.[0-9]{2}|[1-9][0-9]{0,12}(\.[0-9]{2})?)$/
const VNF_DUAS_CASAS = /^(0\.[0-9]{2}|[1-9][0-9]{0,12}\.[0-9]{2})$/
const DH_EMI = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
const CNPJ_QR = /^[0-9A-Z]{12}[0-9]{2}$/
const CPF_QR = /^[0-9]{11}$/
const ASSINATURA_B64 = /^[A-Za-z0-9+/]+={0,2}$/
const URL_BASE = /^https?:\/\/[^?\s]+$/i

export const QR_V3_ONLINE_TP_EMIS = new Set(["1", "3", "4"])
export const QR_V3_OFFLINE_TP_EMIS = "9"

export function fail(code: QrV3Err["code"]): QrV3Err {
  return { ok: false, code }
}

export function parseTpAmb(raw: unknown): QrV3Ambiente | null {
  const value = String(raw ?? "").trim()
  return TP_AMB.test(value) ? (value as QrV3Ambiente) : null
}

export function tpEmisDaChave(chave: string): string | null {
  if (chave.length !== 44) return null
  return chave[34] ?? null
}

export function parseChaveAcesso(raw: unknown): string | null {
  const chave = String(raw ?? "").trim().toUpperCase()
  if (!CHAVE_CORPO.test(chave)) return null
  if (/^\d{44}$/.test(chave)) {
    const dv = calcularDigitoVerificadorChave(chave.slice(0, 43))
    if (chave[43] !== dv) return null
  }
  return chave
}

export function diaDeDhEmi(dhEmi: string): string | null {
  const match = DH_EMI.exec(String(dhEmi ?? "").trim())
  if (!match) return null
  const dia = match[3]
  if (!dia || !DIA.test(dia)) return null
  const month = Number(match[2])
  const day = Number(dia)
  const year = Number(match[1])
  if (month < 1 || month > 12) return null
  const utc = Date.UTC(year, month - 1, day)
  const probe = new Date(utc)
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return dia
}

/**
 * Representação W16/`TDec_1302` usada no QR: ponto decimal, sem milhar, sem sinal.
 * Números seguem o mesmo `toFixed(2)` do builder XML (`vNF`).
 * Strings já no pattern XSD do QR v3 são preservadas (sem reescrita).
 */
export function canonicalVnf(raw: string | number): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return null
    const rounded = Math.round(raw * 100) / 100
    const formatted = rounded.toFixed(2)
    return VNF.test(formatted) ? formatted : null
  }
  const value = String(raw ?? "").trim()
  if (!VNF.test(value)) return null
  return value
}

export function canonicalDestinatario(
  dest: QrV3Destinatario | null | undefined,
): { tpId: QrV3TpId | ""; idDest: string } | null {
  if (dest == null || dest.kind === "ausente") return { tpId: "", idDest: "" }
  if (dest.kind === "estrangeiro") return { tpId: "3", idDest: "" }
  if (dest.kind === "cpf") {
    const cpf = onlyDigits(dest.cpf)
    if (!CPF_QR.test(cpf)) return null
    return { tpId: "2", idDest: cpf }
  }
  if (dest.kind === "cnpj") {
    const compact = String(dest.cnpj ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "")
    if (!CNPJ_QR.test(compact)) return null
    return { tpId: "1", idDest: compact }
  }
  return null
}

export function canonicalAssinaturaBase64(raw: string): string | null {
  const value = String(raw ?? "").replace(/\s+/g, "")
  if (!ASSINATURA_B64.test(value) || value.length < 24) return null
  return value
}

export function composeQrV3Url(baseUrl: string, payload: string): string | QrV3Err {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "")
  if (!URL_BASE.test(base)) return fail("url_base_invalida")
  return `${base}?p=${payload}`
}

export function assertNoCsc(text: string): boolean {
  return !/csc|idcsc|cidtoken|chashqrcode/i.test(text)
}

export const QR_V3_XSD = Object.freeze({
  vnf: VNF,
  vnfDuasCasas: VNF_DUAS_CASAS,
  dia: DIA,
  cnpj: CNPJ_QR,
  cpf: CPF_QR,
  assinatura: ASSINATURA_B64,
})
