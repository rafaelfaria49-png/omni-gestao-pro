/**
 * Contador HUB · DTO de alerta (GOAL 017).
 *
 * Allowlist estrita. Sem valor, PII, storageRef, URL, token ou snapshot.
 */
import { formatCompetencia } from "@/lib/contador/competencia"
import { alertIdDe, montarChave } from "./chave"
import type { AlertaCandidato, AlertaDto, CompetenciaAlerta, DedupeKey } from "./tipos"

const CAMPOS_PROIBIDOS = [
  "valor",
  "valorCentavos",
  "storageRef",
  "signedUrl",
  "token",
  "email",
  "telefone",
  "cpf",
  "imei",
  "snapshot",
] as const

export function chaveDoCandidato(
  candidato: AlertaCandidato,
  storeId: string,
  competenciaId: string,
): DedupeKey {
  return montarChave({
    regra: candidato.regra,
    alvo: candidato.alvo,
    storeId,
    competenciaId,
    janela: candidato.janela,
  })
}

export function toAlertaDto(
  candidato: AlertaCandidato,
  competencia: CompetenciaAlerta,
  flags: Readonly<{ tratado: boolean; materializado: boolean }>,
): AlertaDto {
  const chave = chaveDoCandidato(candidato, competencia.storeId, competencia.id)
  const dto: AlertaDto = Object.freeze({
    id: alertIdDe(chave),
    regra: candidato.regra,
    origem: candidato.origem,
    severidade: candidato.severidade,
    competencia: formatCompetencia({ ano: competencia.ano, mes: competencia.mes }),
    alvo: candidato.alvo,
    titulo: candidato.titulo,
    prazo: candidato.prazo,
    janela: candidato.janela,
    tratado: flags.tratado,
    materializado: flags.materializado,
  })
  for (const k of CAMPOS_PROIBIDOS) {
    if (Object.prototype.hasOwnProperty.call(dto, k)) {
      throw new Error(`DTO de alerta não pode expor ${k}.`)
    }
  }
  return dto
}
