/**
 * Contador HUB · regras puras de alerta (GOAL 017).
 *
 * (estado + agora) → candidatos. Sem IO, sem Prisma, sem envio.
 * Não lê os itens stale `documentos` / `fechamento_oficial` do checklist.
 */
import { type Competencia } from "@/lib/contador/competencia"
import { estaVencido, diaLocal, diaUtc } from "@/lib/contador/status/vencido"
import { estaVencendo, ultimoDiaDoMes, statusEfetivoGuia } from "@/lib/contador/agenda/vencimento"
import { MICROCOPY_INFORMADO } from "@/lib/contador/agenda/tipos"
import { JANELA_OPERACIONAL_DIAS } from "./limiares"
import { janelaDiaCivil, janelaDiff, janelaPacote } from "./chave"
import {
  CHECKLIST_IDS_STALE,
  EVENTO_ALTERACAO_POS_FECHAMENTO,
  type AlertaCandidato,
  type ChecklistItemAlerta,
  type FontesAvaliacao,
} from "./tipos"

const STATUS_FECHADA = "FECHADA"
const STATUS_PENDENTE = "PENDENTE"
const STALE = new Set<string>(CHECKLIST_IDS_STALE)

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function metaStr(meta: Record<string, unknown> | null, chave: string): string | null {
  if (!meta || typeof meta !== "object") return null
  const v = meta[chave]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** Dias civis até o último dia da competência (negativo = mês já passou). */
export function diasAteFimCompetencia(comp: Competencia, agora: Date): number {
  const fim = `${comp.ano}-${pad2(comp.mes)}-${pad2(ultimoDiaDoMes(comp.ano, comp.mes))}`
  const hoje = diaLocal(agora)
  const a = Date.parse(`${hoje}T00:00:00.000Z`)
  const b = Date.parse(`${fim}T00:00:00.000Z`)
  return Math.round((b - a) / 86_400_000)
}

function pendenciasOperacionaisDoSnapshot(snapshot: unknown): ChecklistItemAlerta[] {
  if (!snapshot || typeof snapshot !== "object") return []
  const checklist = (snapshot as { checklist?: { itens?: unknown } }).checklist
  const itens = checklist && typeof checklist === "object" ? checklist.itens : null
  if (!Array.isArray(itens)) return []
  const out: ChecklistItemAlerta[] = []
  for (const raw of itens) {
    if (!raw || typeof raw !== "object") continue
    const id = String((raw as { id?: unknown }).id ?? "")
    const estado = String((raw as { estado?: unknown }).estado ?? "")
    if (!id || STALE.has(id)) continue
    if (estado === "ok" || estado === "nao_disponivel") continue
    out.push({ id, estado })
  }
  return out
}

export function avaliarRegras(fontes: FontesAvaliacao, agora: Date = new Date()): readonly AlertaCandidato[] {
  const compRow = fontes.competencia
  if (!compRow) return Object.freeze([])

  const dia = diaLocal(agora)
  const janelaDia = janelaDiaCivil(dia)
  const out: AlertaCandidato[] = []

  for (const doc of fontes.documentos) {
    if (String(doc.status).toUpperCase() !== STATUS_PENDENTE) continue
    out.push({
      regra: "documento_pendente",
      alvo: doc.id,
      origem: "documento",
      severidade: "media",
      titulo: "Documento pendente",
      prazo: doc.vencimento ? diaUtc(new Date(doc.vencimento)) : null,
      janela: janelaDia,
    })
  }

  if (compRow.status !== STATUS_FECHADA) {
    const dias = diasAteFimCompetencia({ ano: compRow.ano, mes: compRow.mes }, agora)
    if (dias <= JANELA_OPERACIONAL_DIAS) {
      out.push({
        regra: "fechamento_proximo",
        alvo: compRow.id,
        origem: "competencia",
        severidade: dias < 0 ? "alta" : "media",
        titulo: dias < 0 ? "Competência aberta após o período" : "Fechamento próximo",
        prazo: `${compRow.ano}-${pad2(compRow.mes)}-${pad2(ultimoDiaDoMes(compRow.ano, compRow.mes))}`,
        janela: janelaDia,
      })
    }
  }

  for (const guia of fontes.guias) {
    const status = statusEfetivoGuia(guia.pagaEm)
    const vencido = estaVencido({ status, vencimento: guia.vencimento }, agora)
    const vencendo = estaVencendo(
      { status, vencimento: guia.vencimento, pagaEm: guia.pagaEm },
      agora,
    )
    if (vencido) {
      out.push({
        regra: "guia_vencida",
        alvo: guia.id,
        origem: "agenda",
        severidade: "alta",
        titulo: "Guia vencida",
        prazo: diaUtc(new Date(guia.vencimento)),
        janela: janelaDia,
        microcopyAgenda: MICROCOPY_INFORMADO,
      })
    } else if (vencendo) {
      out.push({
        regra: "guia_vencendo",
        alvo: guia.id,
        origem: "agenda",
        severidade: "media",
        titulo: "Guia vencendo",
        prazo: diaUtc(new Date(guia.vencimento)),
        janela: janelaDia,
        microcopyAgenda: MICROCOPY_INFORMADO,
      })
    }
  }

  const pendencias = pendenciasOperacionaisDoSnapshot(compRow.snapshot)
  if (fontes.pacotes.length > 0 && pendencias.length > 0) {
    const versao = Math.max(...fontes.pacotes.map((p) => p.versao))
    out.push({
      regra: "pacote_com_pendencias",
      alvo: `v${versao}`,
      origem: "pacote",
      severidade: "media",
      titulo: "Pacote com pendências",
      prazo: null,
      janela: janelaPacote(versao),
    })
  }

  const vistos = new Set<string>()
  for (const ev of fontes.eventosPosFechamento) {
    if (ev.tipo !== EVENTO_ALTERACAO_POS_FECHAMENTO) continue
    const diffHash = metaStr(ev.metadata, "diffHash")
    if (!diffHash || vistos.has(diffHash)) continue
    vistos.add(diffHash)
    out.push({
      regra: "alteracao_pos_fechamento",
      alvo: diffHash,
      origem: "fechamento",
      severidade: "alta",
      titulo: "Alteração após o fechamento",
      prazo: null,
      janela: janelaDiff(diffHash),
    })
  }

  return Object.freeze(out)
}
