/**
 * Contador HUB · chave de dedupe e alertId determinístico (GOAL 017).
 *
 * alertId NÃO vem do cliente. É SHA-256 da chave
 * `regra + alvo + storeId + competenciaId + janela`.
 */
import { createHash } from "node:crypto"
import type { DedupeKey, RegraId } from "./tipos"

export function chaveCanonico(k: DedupeKey): string {
  return [k.regra, k.alvo, k.storeId, k.competenciaId, k.janela].join("\0")
}

export function alertIdDe(k: DedupeKey): string {
  return createHash("sha256").update(chaveCanonico(k), "utf8").digest("hex")
}

export function janelaDiaCivil(dia: string): string {
  return `dia:${dia}`
}

export function janelaCompetencia(codigo: string): string {
  return `comp:${codigo}`
}

export function janelaPacote(versao: number): string {
  return `pacote:v${versao}`
}

export function janelaDiff(diffHash: string): string {
  return `diff:${diffHash}`
}

export function montarChave(args: {
  regra: RegraId
  alvo: string
  storeId: string
  competenciaId: string
  janela: string
}): DedupeKey {
  return Object.freeze({
    regra: args.regra,
    alvo: args.alvo,
    storeId: args.storeId,
    competenciaId: args.competenciaId,
    janela: args.janela,
  })
}
