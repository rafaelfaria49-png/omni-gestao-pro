/**
 * Contador HUB · fonte canônica de pendências do pacote (GOAL 017).
 *
 * A regra `pacote_com_pendencias` NÃO lê `competencia.snapshot.checklist`.
 * Fonte: `manifesto.pendencias` da versão efetiva (`ContadorPacote` de maior versão).
 *
 * `montarPendencias` (GOAL 008/012) é a função que MONTA essas linhas. Não copiamos
 * a regra. O adapter Prisma só a reutiliza quando o JSON do manifesto não está na
 * linha persistida (schema fora do 017).
 */
import { resolvePeriodoUtc, type Competencia } from "@/lib/contador/competencia"
import { montarPendencias } from "@/lib/contador/pacote/fontes"
import type { FontesDetalhadasPacote } from "@/lib/contador/pacote/carregar-fontes"
import type { ChecklistFechamento, ChecklistItemFechamento, EstadoChecklistItem } from "@/lib/contador/fechamento/tipos"
import { CHECKLIST_IDS_STALE, type PacoteAlerta } from "./tipos"

const STALE = new Set<string>(CHECKLIST_IDS_STALE)
const ESTADOS: readonly EstadoChecklistItem[] = ["ok", "atencao", "pendente", "nao_disponivel"]

function eLinhaStale(linha: string): boolean {
  return CHECKLIST_IDS_STALE.some((id) => new RegExp(`(^|[^A-Za-z0-9_])${id}([^A-Za-z0-9_]|$)`, "i").test(linha))
}

/** Pendências operacionais do manifesto da versão — itens stale nunca reaparecem. */
export function pendenciasOperacionaisDoManifesto(
  pendencias: readonly string[],
): readonly string[] {
  return pendencias.filter((p) => {
    const linha = String(p ?? "").trim()
    if (!linha) return false
    if (STALE.has(linha)) return false
    return !eLinhaStale(linha)
  })
}

export function pacoteEfetivo(pacotes: readonly PacoteAlerta[]): PacoteAlerta | null {
  if (pacotes.length === 0) return null
  return pacotes.reduce((a, b) => (b.versao > a.versao ? b : a))
}

function fonteVazia(): { linhas: readonly never[]; registros: number; estado: "real" } {
  return Object.freeze({ linhas: Object.freeze([]), registros: 0, estado: "real" as const })
}

/**
 * Stub de fontes detalhadas sem parciais. `montarPendencias` só usa estado/registros
 * das fontes; o agregado não entra na lista de pendências.
 */
function detalhadasSemParcial(): FontesDetalhadasPacote {
  const vazia = fonteVazia()
  return {
    vendas: vazia,
    itens: vazia,
    devolucoes: vazia,
    movimentacoes: vazia,
    contasReceber: vazia,
    contasPagar: vazia,
    sessoes: vazia,
    operacoes: vazia,
    agregado: {} as FontesDetalhadasPacote["agregado"],
    totalQueries: 0,
  } as FontesDetalhadasPacote
}

function estadoItem(raw: unknown): EstadoChecklistItem | null {
  const s = String(raw ?? "")
  return (ESTADOS as readonly string[]).includes(s) ? (s as EstadoChecklistItem) : null
}

/**
 * Reconstrói `manifesto.pendencias` via a função canônica `montarPendencias`,
 * quando o JSON do manifesto não está na linha `ContadorPacote`.
 *
 * Entrada = checklist congelado (id+estado) do snapshot da MESMA versão efetiva.
 * Não é a regra do alerta — a regra consome só o array já montado.
 */
export function reconstruirPendenciasViaMontarPendencias(
  snapshot: unknown,
  competencia: Competencia,
): readonly string[] {
  if (!snapshot || typeof snapshot !== "object") return Object.freeze([])
  const checklist = (snapshot as { checklist?: { itens?: unknown } }).checklist
  const itensRaw = checklist && typeof checklist === "object" ? checklist.itens : null
  if (!Array.isArray(itensRaw)) return Object.freeze([])

  const itens: ChecklistItemFechamento[] = []
  for (const raw of itensRaw) {
    if (!raw || typeof raw !== "object") continue
    const id = String((raw as { id?: unknown }).id ?? "").trim()
    const estado = estadoItem((raw as { estado?: unknown }).estado)
    if (!id || !estado) continue
    itens.push({
      id,
      titulo: id,
      estado,
      origem: "snapshot-congelado",
      explicacao: "",
    })
  }

  const agora = new Date(0)
  const periodo = resolvePeriodoUtc(competencia)
  const dto: ChecklistFechamento = {
    competencia: { ano: competencia.ano, mes: competencia.mes },
    itens,
    contagem: { ok: 0, atencao: 0, pendente: 0, nao_disponivel: 0, total: itens.length },
    disclaimer: "",
    geradoEm: agora.toISOString(),
  }

  return Object.freeze(
    montarPendencias({
      detalhadas: detalhadasSemParcial(),
      dados: {} as never,
      checklist: dto,
      competencia,
      periodo,
      agora,
    }),
  )
}
