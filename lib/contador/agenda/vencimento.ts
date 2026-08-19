/**
 * Contador HUB · calendário civil da agenda (GOAL 016).
 *
 * Sem calendário fiscal: 31 em abril vira 30; fevereiro não-bissexto vira 28;
 * bissexto vira 29. `vencido`/`vencendo` são flags DERIVADAS — nunca persistidas.
 */
import { diaLocal, diaUtc, estaVencido } from "@/lib/contador/status/vencido"
import { GUIAS_VENCENDO_DIAS } from "./tipos"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Último dia civil do mês (mês 1–12), em UTC. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

/**
 * Resolve o dia informado (1–31) contra o mês civil. Nunca calcula tributo:
 * só impede datas impossíveis (31/abril → 30, 31/fev → 28 ou 29).
 */
export function resolverDiaVencimento(ano: number, mes: number, dia: number): string {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) {
    throw new RangeError("resolverDiaVencimento exige ano, mês e dia inteiros.")
  }
  if (mes < 1 || mes > 12) throw new RangeError("Mês inválido.")
  if (dia < 1 || dia > 31) throw new RangeError("Dia de vencimento inválido.")
  const ultimo = ultimoDiaDoMes(ano, mes)
  const d = Math.min(dia, ultimo)
  return `${ano}-${pad2(mes)}-${pad2(d)}`
}

/** `AAAA-MM-DD` → Date em meia-noite UTC (mesmo contrato do GOAL 011). */
export function dataUtcDeDia(isoDia: string): Date {
  return new Date(`${isoDia}T00:00:00.000Z`)
}

export function adicionarDiasUtc(isoDia: string, dias: number): string {
  const d = dataUtcDeDia(isoDia)
  d.setUTCDate(d.getUTCDate() + dias)
  return diaUtc(d)
}

function normalizarData(valor: Date | string | null | undefined): Date | null {
  if (valor == null || valor === "") return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * `true` quando o vencimento cai entre hoje (SP) e hoje+7 dias (inclusive),
 * o item não está vencido e não está terminal (RESOLVIDO / pago).
 */
export function estaVencendo(
  item: Readonly<{
    status: string
    vencimento: Date | string | null | undefined
    pagaEm?: Date | string | null
  }>,
  agora: Date = new Date(),
): boolean {
  if (item.pagaEm) return false
  if (String(item.status ?? "").toUpperCase() === "RESOLVIDO") return false
  if (estaVencido({ status: item.status, vencimento: item.vencimento }, agora)) return false
  const venc = normalizarData(item.vencimento)
  if (!venc) return false
  const diaVenc = diaUtc(venc)
  const hoje = diaLocal(agora)
  const limite = adicionarDiasUtc(hoje, GUIAS_VENCENDO_DIAS)
  return diaVenc >= hoje && diaVenc <= limite
}

/** Status efetivo da guia para `estaVencido` (pago ≡ RESOLVIDO). */
export function statusEfetivoGuia(pagaEm: Date | string | null | undefined): "RESOLVIDO" | "PENDENTE" {
  return pagaEm ? "RESOLVIDO" : "PENDENTE"
}
