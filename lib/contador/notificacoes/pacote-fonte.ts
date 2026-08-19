/**
 * Contador HUB · fonte canônica de pendências do pacote (GOAL 017).
 *
 * A regra `pacote_com_pendencias` consome `manifesto.pendencias` da versão
 * efetiva já lida do ZIP oficial. Não reconstrói a partir do checklist.
 * Itens stale do 017 são filtrados depois da leitura, sem recriar a lista.
 */
import { CHECKLIST_IDS_STALE, type PacoteAlerta } from "./tipos"

const STALE = new Set<string>(CHECKLIST_IDS_STALE)
const PREFIXO_FONTE_PARCIAL = /^Fonte parcial:/i

function eLinhaStale(linha: string): boolean {
  if (PREFIXO_FONTE_PARCIAL.test(linha)) return false
  if (STALE.has(linha)) return true
  return CHECKLIST_IDS_STALE.some((id) => new RegExp(`(^|[^A-Za-z0-9_])${id}([^A-Za-z0-9_]|$)`, "i").test(linha))
}

/** Pendências operacionais do manifesto da versão — itens stale nunca reaparecem. */
export function pendenciasOperacionaisDoManifesto(
  pendencias: readonly string[],
): readonly string[] {
  return pendencias.filter((p) => {
    const linha = String(p ?? "").trim()
    if (!linha) return false
    if (PREFIXO_FONTE_PARCIAL.test(linha)) return true
    if (STALE.has(linha)) return false
    return !eLinhaStale(linha)
  })
}

export function pacoteEfetivo(pacotes: readonly PacoteAlerta[]): PacoteAlerta | null {
  if (pacotes.length === 0) return null
  return pacotes.reduce((a, b) => (b.versao > a.versao ? b : a))
}

export function fontePacoteDasFontes(
  pacotes: readonly PacoteAlerta[],
): "ok" | "indisponivel" | "ausente" {
  const p = pacoteEfetivo(pacotes)
  if (!p) return "ausente"
  return p.fonte
}
