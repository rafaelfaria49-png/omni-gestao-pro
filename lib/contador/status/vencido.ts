/**
 * Contador HUB · derivação da flag `vencido` (GOAL 011 · ADR-CONTADOR-005).
 *
 * `vencido` NUNCA é persistido: não existe no enum `ContadorItemStatus` e não é
 * gravado em `ContadorDocumento.status`. É sempre DERIVADO de dois fatos:
 *
 *   1. o item tem `vencimento` e esse dia já passou;
 *   2. o item ainda não está `RESOLVIDO`.
 *
 * Os dois lados da comparação são DIAS CIVIS, mas em referenciais deliberadamente
 * diferentes — porque as duas grandezas são diferentes:
 *
 *   - `vencimento` é uma DATA, não um instante. O formulário envia `AAAA-MM-DD` e
 *     `new Date("AAAA-MM-DD")` grava meia-noite UTC; ler esse valor no fuso de São
 *     Paulo o jogaria para o dia anterior (21:00 do dia -1). Por isso o vencimento é
 *     lido pelo seu dia UTC — exatamente o dia que o usuário digitou.
 *   - "hoje" é o dia do operador, em `America/Sao_Paulo`.
 *
 * Resultado: vence dia 28 → em 28/07 (Brasil) ainda NÃO está vencido; a virada
 * acontece na meia-noite brasileira do dia 29. Puro e determinístico: o mesmo
 * cálculo roda no servidor e no navegador sem divergir de fuso.
 */
import { TIMEZONE_CONTADOR } from "@/lib/contador/competencia"
import { type StatusItem } from "./matriz"

/** Status terminal: item resolvido nunca aparece como vencido. */
const STATUS_TERMINAL: StatusItem = "RESOLVIDO"

const DIA_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE_CONTADOR,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Dia civil em America/Sao_Paulo no formato ordenável `AAAA-MM-DD` ("hoje"). */
export function diaLocal(date: Date): string {
  // `en-CA` já emite AAAA-MM-DD; formatToParts evita depender do separador do locale.
  const partes: Record<string, string> = {}
  for (const p of DIA_FMT.formatToParts(date)) {
    if (p.type !== "literal") partes[p.type] = p.value
  }
  return `${partes.year}-${partes.month}-${partes.day}`
}

/** Dia civil UTC no formato ordenável `AAAA-MM-DD` (leitura de uma DATA gravada). */
export function diaUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export type ItemVencivel = Readonly<{
  status: string
  vencimento: Date | string | null | undefined
}>

/**
 * `true` somente quando o dia do vencimento é ANTERIOR ao dia de hoje em São Paulo
 * e o item não está resolvido. Sem vencimento → nunca vencido. No dia do vencimento
 * → ainda não vencido.
 */
export function estaVencido(item: ItemVencivel, agora: Date = new Date()): boolean {
  if (String(item.status ?? "").toUpperCase() === STATUS_TERMINAL) return false
  const venc = normalizarData(item.vencimento)
  if (!venc) return false
  return diaUtc(venc) < diaLocal(agora)
}

function normalizarData(valor: Date | string | null | undefined): Date | null {
  if (valor == null || valor === "") return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}
