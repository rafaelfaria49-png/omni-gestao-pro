/**
 * Histórico estruturado de recebimentos em Contas a Receber (localStorage).
 * Mantém compatibilidade com `observacoesPagamento` em texto livre + linhas "Recebido via…".
 */

export type PagamentoLinhaStatus = "PAGO" | "PENDENTE"

export type PagamentoLinha = {
  id: string
  /** yyyy-mm-dd ou null após estorno */
  dataPagamento: string | null
  valor: number
  forma: string
  status: PagamentoLinhaStatus
  movimentoId?: string
  /** Índice 0-based da parcela no plano (quando recebimento foi feito com N parcelas). */
  parcelaIndex?: number
  /** Id estável da parcela no plano persistido (localStorage); evita baixa duplicada da mesma parcela. */
  parcelaId?: string
  /** Vencimento original da parcela (dd/mm/aaaa), gravado na baixa para exibição e estorno. */
  vencimentoParcelaBr?: string
}

export type ContaReceberPagamentosExtras = {
  historicoPagamentos?: PagamentoLinha[]
}

function gerarIdPagamento(): string {
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Captura até o fim da linha após "R$ " (valores pt-BR como 1.234,56). */
const RE_LINE_RECEBIDO =
  /^(\d{2}\/\d{2}\/\d{4})\s*-\s*Recebido via\s*(.+?):\s*R\$\s*(.+)$/i

function parseValorMoedaBr(s: string): number {
  const x = s
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
  if (!x) return 0
  const norm = x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "")
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function brParaIso(dataBr: string): string | null {
  const m = String(dataBr || "")
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  const yy = Number(m[3])
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null
  const d = new Date(yy, mm - 1, dd, 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function isoParaBr(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ""
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10))
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0)
  return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleDateString("pt-BR")
}

/** Linhas que são claramente de sistema ou movimento legado (não entram em “observação livre”). */
export function isLinhaSistemaOuEstorno(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (/^\[SISTEMA\]/i.test(t)) return true
  if (/estorno de pagamento/i.test(t)) return true
  if (/^[^:]+:\s*Estorno/i.test(t)) return false
  return false
}

/** Detecta linha gerada pelo recebimento automático. */
export function isLinhaRecebidoAutomatico(line: string): boolean {
  return RE_LINE_RECEBIDO.test(line.trim())
}

/**
 * Extrai texto livre do usuário (sem linhas de recebimento automáticas nem sistema).
 */
export function extrairObservacoesLivres(observacoesPagamento: string | undefined): string {
  const lines = String(observacoesPagamento ?? "")
    .split("\n")
    .filter((ln) => {
      const t = ln.trim()
      if (!t) return false
      if (isLinhaSistemaOuEstorno(t)) return false
      if (isLinhaRecebidoAutomatico(t)) return false
      return true
    })
  return lines.join("\n").trim()
}

/**
 * Parseia linhas legadas "DD/MM/AAAA - Recebido via …: R$ …" em registros PAGO.
 */
export function parseHistoricoFromObservacoes(observacoesPagamento: string | undefined): PagamentoLinha[] {
  const out: PagamentoLinha[] = []
  const lines = String(observacoesPagamento ?? "").split("\n")
  for (const ln of lines) {
    const t = ln.trim()
    const m = t.match(RE_LINE_RECEBIDO)
    if (!m) continue
    const [, dbr, forma, valRaw] = m
    const valor = parseValorMoedaBr(String(valRaw).trim())
    const iso = brParaIso(dbr)
    out.push({
      id: gerarIdPagamento(),
      dataPagamento: iso,
      valor,
      forma: forma.trim(),
      status: "PAGO",
    })
  }
  return out
}

export function formatLinhaRecebidoObs(p: PagamentoLinha): string {
  const br = isoParaBr(p.dataPagamento)
  const valor = Math.round((Number(p.valor) || 0) * 100) / 100
  const valorFmt = valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
  const n = p.parcelaIndex != null ? p.parcelaIndex + 1 : null
  const venc = (p.vencimentoParcelaBr || "").trim()
  if (n != null && venc) {
    return `Parcela ${n} (Venc: ${venc}) - Recebido em: ${br} — via ${p.forma}: R$ ${valorFmt}`
  }
  return `${br} - Recebido via ${p.forma}: R$ ${valorFmt}`
}

/** Texto de cabeçalho da linha no histórico (UI): vencimento original + data do recebimento. */
export function tituloExibicaoHistoricoPagamento(
  h: PagamentoLinha,
  conta?: { parcelas?: Array<{ vencimento: string }>; vencimento?: string }
): string {
  const receb = isoParaBr(h.dataPagamento) || "—"
  const n = h.parcelaIndex != null ? h.parcelaIndex + 1 : null
  let venc = (h.vencimentoParcelaBr || "").trim()
  if (!venc && n != null && conta?.parcelas?.[h.parcelaIndex!]?.vencimento) {
    venc = String(conta.parcelas[h.parcelaIndex!].vencimento).trim()
  }
  if (!venc && conta?.parcelas?.length === 1 && conta.parcelas[0]?.vencimento) {
    venc = String(conta.parcelas[0].vencimento).trim()
  }
  if (!venc && conta?.vencimento) {
    venc = String(conta.vencimento).trim()
  }
  if (n != null && venc) {
    return `Parcela ${n} (Venc: ${venc}) - Recebido em: ${receb}`
  }
  if (venc) {
    return `Venc: ${venc} - Recebido em: ${receb}`
  }
  return `Recebido em: ${receb}`
}

/** Vencimento para mensagens de confirmação (estorno). */
export function vencimentoParcelaParaEstorno(
  linha: PagamentoLinha,
  conta: { parcelas?: Array<{ vencimento: string }>; vencimento?: string }
): string | null {
  const v = (linha.vencimentoParcelaBr || "").trim()
  if (v) return v
  if (linha.parcelaIndex != null && conta.parcelas?.[linha.parcelaIndex]?.vencimento) {
    return String(conta.parcelas[linha.parcelaIndex].vencimento).trim()
  }
  if (conta.parcelas?.length === 1 && conta.parcelas[0]?.vencimento) {
    return String(conta.parcelas[0].vencimento).trim()
  }
  if (conta.vencimento) return String(conta.vencimento).trim()
  return null
}

/** Linhas de log de estorno já gravadas (ex.: "Estorno de R$ … realizado em …"). */
export function extrairLinhasEstornoLog(observacoesPagamento: string | undefined): string[] {
  return String(observacoesPagamento ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^estorno de r\$/i.test(l))
}

/**
 * Reconstrói `observacoesPagamento`: observações livres + linhas PAGO + [SISTEMA] + logs de estorno.
 */
export function rebuildObservacoesPagamento(opts: {
  observacoesLivre: string
  historico: PagamentoLinha[]
  linhasSistemaExtras?: string[]
  /** Logs de estorno (preservados + novos); exibidos após recebimentos. */
  linhasLogsEstorno?: string[]
}): string {
  const livre = opts.observacoesLivre.trim()
  const pagas = opts.historico.filter((h) => h.status === "PAGO" && (Number(h.valor) > 0 || h.forma))
  const linhasPag = pagas.map(formatLinhaRecebidoObs)
  const sistema = [...(opts.linhasSistemaExtras ?? [])].filter(Boolean)
  const logs = [...(opts.linhasLogsEstorno ?? [])].filter(Boolean)
  return [livre, ...linhasPag, ...sistema, ...logs].filter((x) => String(x).trim().length > 0).join("\n")
}

/** Extrai linhas [SISTEMA] já gravadas para preservá-las no rebuild. */
export function extrairLinhasSistema(observacoesPagamento: string | undefined): string[] {
  return String(observacoesPagamento ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\[SISTEMA\]/i.test(l))
}

export function appendLinhaSistemaEstorno(observacoesPagamento: string | undefined, dataBr: string): string {
  const linha = `[SISTEMA]: Estorno realizado em ${dataBr}`
  const prev = String(observacoesPagamento ?? "").trim()
  if (!prev) return linha
  if (prev.includes(linha)) return prev
  return `${prev}\n${linha}`
}

/**
 * Garante `historicoPagamentos` populado (parse legado) sem duplicar entradas já estruturadas.
 */
export function ensureHistoricoMigrado<T extends { observacoesPagamento?: string; historicoPagamentos?: PagamentoLinha[] }>(
  row: T
): T & { historicoPagamentos: PagamentoLinha[] } {
  const existing = Array.isArray(row.historicoPagamentos) ? row.historicoPagamentos : []
  if (existing.length > 0) {
    return { ...row, historicoPagamentos: existing }
  }
  const parsed = parseHistoricoFromObservacoes(row.observacoesPagamento)
  if (parsed.length === 0) {
    if (row.historicoPagamentos !== undefined) {
      return { ...row, historicoPagamentos: [] }
    }
    return { ...row, historicoPagamentos: [] }
  }
  return { ...row, historicoPagamentos: parsed }
}

/** `true` se a migração preencheu histórico a partir do texto legado (vale persistir no storage). */
export function precisaPersistirMigracaoHistorico<T extends { historicoPagamentos?: PagamentoLinha[] }>(
  antes: T,
  depois: T & { historicoPagamentos: PagamentoLinha[] }
): boolean {
  const tinha = Array.isArray(antes.historicoPagamentos) && antes.historicoPagamentos.length > 0
  const tem = depois.historicoPagamentos.length > 0
  return !tinha && tem
}

export function listarPagamentosEfetivos(historico: PagamentoLinha[] | undefined): PagamentoLinha[] {
  const h = Array.isArray(historico) ? historico : []
  return h.filter((x) => x.status === "PAGO" && Number(x.valor) > 0)
}

/**
 * Verifica se a parcela (id estável ou índice) já tem recebimento PAGO no histórico.
 * Para título sem parcelamento (1x), use trava de UI + saldo; não bloqueia aqui.
 */
export function parcelaJaConstaComoPaga(
  historico: PagamentoLinha[] | undefined,
  opts: { parcelasInformadas: number; parcelaIndex?: number; parcelaId?: string; valorRestanteParcela?: number }
): boolean {
  const h = Array.isArray(historico) ? historico : []
  const { parcelasInformadas, parcelaIndex, parcelaId, valorRestanteParcela } = opts
  if (parcelasInformadas <= 1) return false
  if (valorRestanteParcela != null && Number.isFinite(valorRestanteParcela)) {
    return valorRestanteParcela <= 0.02
  }
  if (parcelaId && String(parcelaId).trim()) {
    return h.some((x) => x.status === "PAGO" && x.parcelaId === parcelaId)
  }
  if (parcelaIndex != null && Number.isFinite(parcelaIndex)) {
    return h.some((x) => x.status === "PAGO" && x.parcelaIndex === parcelaIndex)
  }
  return false
}

export function gerarIdParcelaPlano(): string {
  return `parc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export { gerarIdPagamento, isoParaBr, brParaIso }
