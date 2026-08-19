/**
 * Contador HUB · rascunho pt-BR (GOAL 017).
 *
 * Contrato: RASCUNHO · ação = copiar · envio = proibido.
 * Sem valor de guia, imposto, storageRef, URL, token, PII ou snapshot bruto.
 */
import { MICROCOPY_INFORMADO } from "@/lib/contador/agenda/tipos"
import type { AlertaCandidato, RascunhoDto } from "./tipos"

const PROIBIDO =
  /\b(storageRef|signedUrl|token|cpf|cnpj|imei|@|https?:\/\/|tel:|mailto:)\b/i

export function gerarRascunho(
  alerta: AlertaCandidato,
  ctx: Readonly<{ competencia: string; lojaRef: string }>,
): RascunhoDto {
  const linhas = [
    "RASCUNHO",
    "",
    `Competência: ${ctx.competencia}`,
    `Unidade: ${ctx.lojaRef}`,
    `Alerta: ${alerta.titulo}`,
    `Origem: ${alerta.origem} · regra ${alerta.regra}`,
  ]
  if (alerta.alvo) linhas.push(`Alvo: ${alerta.alvo}`)
  if (alerta.prazo) linhas.push(`Prazo informado: ${alerta.prazo}`)
  if (alerta.microcopyAgenda) linhas.push(`Agenda: ${MICROCOPY_INFORMADO}`)
  linhas.push("")
  linhas.push("Este texto é um rascunho interno. Envio pelo sistema é proibido.")
  linhas.push("Ação: copiar. O responsável decide se usa fora do OmniGestão.")

  const texto = linhas.join("\n")
  if (PROIBIDO.test(texto)) {
    throw new Error("Rascunho recusado: conteúdo fora do contrato mínimo.")
  }

  return Object.freeze({
    estado: "rascunho",
    idioma: "pt-BR",
    acao: "copiar",
    envio: "proibido",
    texto,
  })
}
