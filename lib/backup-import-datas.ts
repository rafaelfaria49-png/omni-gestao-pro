/**
 * Utilitários de data / status para importação de backup (GestãoClick e similares).
 */

export function parseDataBrFlex(raw: unknown): string {
  const s = String(raw ?? "").trim()
  if (!s) return new Date().toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    const d = parseInt(m[1]!, 10)
    const mo = parseInt(m[2]!, 10)
    let y = parseInt(m[3]!, 10)
    if (y < 100) y += y >= 70 ? 1900 : 2000
    const mm = String(mo).padStart(2, "0")
    const dd = String(d).padStart(2, "0")
    return `${String(y).padStart(4, "0")}-${mm}-${dd}`
  }
  const tryDate = new Date(s)
  if (!Number.isNaN(tryDate.getTime())) return tryDate.toISOString().slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

export function mapGestaoClickSituacaoOs(raw: unknown): "aguardando_peca" | "em_reparo" | "pronto" | "finalizado" | "pago" {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (!t) return "em_reparo"
  if (t.includes("pront") && !t.includes("não") && !t.includes("nao")) return "pronto"
  if (t.includes("finaliz") || t.includes("entreg")) return "finalizado"
  if (t.includes("pago") || t.includes("quitad") || t.includes("faturad")) return "pago"
  if (t.includes("aguard") || t.includes("abert") || t.includes("pend")) return "aguardando_peca"
  return "em_reparo"
}

export function mapStatusFinanceiroConta(raw: unknown): "pendente" | "pago" | "atrasado" {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (t.includes("pago") || t.includes("receb") || t.includes("liquid")) return "pago"
  if (t.includes("atras")) return "atrasado"
  return "pendente"
}

function normStatusTxt(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Situação da planilha indica título quitado (GestãoClick / backups). */
export function isSituacaoConfirmadaOuConcretizada(raw: unknown): boolean {
  const t = normStatusTxt(raw)
  return t.includes("confirmado") || t.includes("concretizado")
}

/**
 * Data de vencimento ou pagamento estritamente anterior ao dia atual (meia-noite local).
 * Usada na blindagem para não manter títulos antigos como pendentes quando a situação indica quitação.
 */
export function isDataReferenciaPassada(dataRaw: unknown): boolean {
  if (dataRaw == null) return false
  const ds = parseDataBrFlex(dataRaw)
  const parts = ds.split("-").map((x) => parseInt(x, 10))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return false
  const [y, m, d] = parts
  const ref = new Date(y!, m! - 1, d!)
  const today = new Date()
  ref.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return ref.getTime() < today.getTime()
}

/** Importação Contas a Receber: Situação "Confirmado" → pago; "Atrasado" → pendente (não duplicar total a receber). */
export function mapStatusContasReceberImport(raw: unknown): "pendente" | "pago" | "atrasado" {
  const t = normStatusTxt(raw)
  if (t.includes("confirmado")) return "pago"
  if (t.includes("concretizado")) return "pago"
  if (t.includes("atrasad")) return "pendente"
  if (t.includes("pago") || t.includes("receb") || t.includes("liquid") || t.includes("quitad")) return "pago"
  return "pendente"
}

/** Data de confirmação preenchida (Excel pode vir como número serial ou texto). */
export function hasDataConfirmacaoPreenchida(raw: unknown): boolean {
  if (raw == null) return false
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0
  if (typeof raw === "boolean") return false
  const s = String(raw).trim()
  if (!s) return false
  if (/^(?:-+|—+|null|n\/a|na|undefined)$/i.test(s)) return false
  return true
}

/**
 * Prioridade: se há data de confirmação, título foi recebido → pago (mesmo com Situação "Atrasado" desatualizada).
 */
export function mapStatusContasReceberImportWithData(
  situacaoRaw: unknown,
  dataConfirmacaoRaw: unknown
): "pendente" | "pago" | "atrasado" {
  if (hasDataConfirmacaoPreenchida(dataConfirmacaoRaw)) return "pago"
  return mapStatusContasReceberImport(situacaoRaw)
}

/**
 * Blindagem financeira: data de vencimento (ou referência) passada + Confirmado/Concretizado → Pago.
 * Evita que títulos antigos entrem como pendentes quando a situação indica quitação.
 * Opcionalmente cruza com chave externa (ex.: Nº do pedido) presente na planilha de pagamentos.
 */
export function mapStatusContasReceberImportBlindagem(
  situacaoRaw: unknown,
  dataConfirmacaoRaw: unknown,
  _dataReferenciaRaw: unknown,
  chaveExternaPaga?: boolean
): "pendente" | "pago" | "atrasado" {
  if (hasDataConfirmacaoPreenchida(dataConfirmacaoRaw)) return "pago"
  if (chaveExternaPaga) return "pago"
  /** Confirmado / Concretizado → sempre Pago (evita contas resolvidas como atrasadas, inclusive com datas antigas). */
  if (isSituacaoConfirmadaOuConcretizada(situacaoRaw)) return "pago"
  return mapStatusContasReceberImportWithData(situacaoRaw, dataConfirmacaoRaw)
}

/**
 * Contas a pagar: Confirmado/Concretizado → sempre Pago; senão regra base do extrato.
 */
export function mapStatusContasPagarImportBlindagem(
  statusRaw: unknown,
  _dataVencimentoRaw: unknown,
  _dataPagamentoRaw?: unknown
): "pendente" | "pago" | "atrasado" {
  if (isSituacaoConfirmadaOuConcretizada(statusRaw)) return "pago"
  return mapStatusFinanceiroConta(statusRaw)
}
