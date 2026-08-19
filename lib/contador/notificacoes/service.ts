/**
 * Contador HUB · orquestração de avisos (GOAL 017).
 *
 * GET  → carrega fontes + avalia + cruza histórico. Zero escrita.
 * POST avaliar → persiste só `alerta_emitido` novos (dedupe + lock).
 * POST tratar  → reavalia, garante trilha `alerta_emitido` → `alerta_tratado`
 *                na mesma transação (não exige POST /avaliar prévio).
 * GET rascunho → só alerta atualmente ativo. Nunca envia.
 */
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { alertIdDe } from "./chave"
import { avaliarRegras } from "./regras"
import { gerarRascunho } from "./rascunhos"
import { chaveDoCandidato, toAlertaDto } from "./sanear"
import { fontePacoteDasFontes } from "./pacote-fonte"
import type { NotificacoesRepo, NotificacoesRepoLeitura } from "./repo"
import {
  ATOR_TIPO_INTERNO,
  EVENTO_ALERTA_EMITIDO,
  EVENTO_ALERTA_SUPRIMIDO,
  EVENTO_ALERTA_TRATADO,
  EVENTO_ALTERACAO_POS_FECHAMENTO,
  ORIGEM_NOTIFICACOES,
  type AlertaCandidato,
  type AlertaDto,
  type EscopoNotificacoes,
  type EventoAlertaRow,
  type FontesAvaliacao,
  type RascunhoDto,
} from "./tipos"

const TIPOS_ALERTA = [EVENTO_ALERTA_EMITIDO, EVENTO_ALERTA_TRATADO, EVENTO_ALERTA_SUPRIMIDO] as const

export class AlertaNaoEncontradoError extends Error {
  readonly code = "ALERTA_NAO_ENCONTRADO" as const
  constructor() {
    super("Alerta não encontrado nesta loja e competência.")
    this.name = "AlertaNaoEncontradoError"
  }
}

export class CompetenciaNotificacaoInvalidaError extends Error {
  readonly code = "COMPETENCIA_INVALIDA" as const
  constructor() {
    super("Competência inválida. Use AAAA-MM.")
    this.name = "CompetenciaNotificacaoInvalidaError"
  }
}

function metaIgual(ev: EventoAlertaRow, regra: string, alvo: string, janela: string): boolean {
  const m = (ev.metadata ?? {}) as Record<string, unknown>
  return m.regra === regra && m.alvo === alvo && m.janela === janela
}

function silenciado(eventos: readonly EventoAlertaRow[], c: AlertaCandidato): boolean {
  return eventos.some(
    (e) =>
      (e.tipo === EVENTO_ALERTA_TRATADO || e.tipo === EVENTO_ALERTA_SUPRIMIDO) &&
      metaIgual(e, c.regra, c.alvo, c.janela),
  )
}

function materializado(eventos: readonly EventoAlertaRow[], c: AlertaCandidato): boolean {
  return eventos.some((e) => e.tipo === EVENTO_ALERTA_EMITIDO && metaIgual(e, c.regra, c.alvo, c.janela))
}

async function carregarFontes(
  escopo: EscopoNotificacoes,
  comp: Competencia,
  repo: NotificacoesRepoLeitura,
): Promise<FontesAvaliacao> {
  const competencia = await repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) {
    return Object.freeze({
      competencia: null,
      documentos: Object.freeze([]),
      guias: Object.freeze([]),
      pacotes: Object.freeze([]),
      eventosPosFechamento: Object.freeze([]),
      eventosAlerta: Object.freeze([]),
    })
  }

  const [documentos, guias, pacotes, eventosAlerta, eventosPos] = await Promise.all([
    repo.listarDocumentos(competencia.id, escopo.storeId),
    repo.listarGuias(competencia.id, escopo.storeId),
    repo.listarPacotes(competencia.id, escopo.storeId),
    repo.listarEventos(competencia.id, escopo.storeId, TIPOS_ALERTA),
    repo.listarEventos(competencia.id, escopo.storeId, [EVENTO_ALTERACAO_POS_FECHAMENTO]),
  ])

  return Object.freeze({
    competencia,
    documentos: Object.freeze(documentos),
    guias: Object.freeze(guias),
    pacotes: Object.freeze(pacotes),
    eventosAlerta: Object.freeze(eventosAlerta),
    eventosPosFechamento: Object.freeze(eventosPos),
  })
}

function dtosAtivos(fontes: FontesAvaliacao, agora: Date): AlertaDto[] {
  const competencia = fontes.competencia
  if (!competencia) return []
  const candidatos = avaliarRegras(fontes, agora)
  const ativos: AlertaDto[] = []
  for (const c of candidatos) {
    const tratado = silenciado(fontes.eventosAlerta, c)
    if (tratado) continue
    ativos.push(
      toAlertaDto(c, competencia, {
        tratado: false,
        materializado: materializado(fontes.eventosAlerta, c),
      }),
    )
  }
  return ativos
}

function acharCandidatoPorId(
  fontes: FontesAvaliacao,
  alertId: string,
  agora: Date,
): AlertaCandidato | null {
  const competencia = fontes.competencia
  if (!competencia) return null
  for (const c of avaliarRegras(fontes, agora)) {
    const chave = chaveDoCandidato(c, competencia.storeId, competencia.id)
    if (alertIdDe(chave) === alertId) return c
  }
  return null
}

function eventoDeCandidato(
  c: AlertaCandidato,
  escopo: EscopoNotificacoes,
  competenciaId: string,
  codigo: string,
  tipo: typeof EVENTO_ALERTA_EMITIDO | typeof EVENTO_ALERTA_TRATADO,
) {
  return {
    storeId: escopo.storeId,
    competenciaId,
    tipo,
    atorTipo: ATOR_TIPO_INTERNO,
    atorId: escopo.userId,
    entidade: c.origem,
    entidadeId: c.alvo,
    origem: ORIGEM_NOTIFICACOES,
    metadata: {
      regra: c.regra,
      alvo: c.alvo,
      janela: c.janela,
      competencia: codigo,
    },
  } as const
}

/** Somente leitura. Nunca chama registrarEventoUnico. */
export async function listarAlertas(
  escopo: EscopoNotificacoes,
  comp: Competencia,
  repo: NotificacoesRepoLeitura,
  agora: Date = new Date(),
): Promise<{ competencia: string; avisos: AlertaDto[]; fontePacote: "ok" | "indisponivel" | "ausente" }> {
  const fontes = await carregarFontes(escopo, comp, repo)
  return {
    competencia: formatCompetencia(comp),
    avisos: dtosAtivos(fontes, agora),
    fontePacote: fontePacoteDasFontes(fontes.pacotes),
  }
}

export async function avaliarEPersistir(
  escopo: EscopoNotificacoes,
  comp: Competencia,
  repo: NotificacoesRepo,
  agora: Date = new Date(),
): Promise<{
  competencia: string
  avisos: AlertaDto[]
  emitidos: number
  fontePacote: "ok" | "indisponivel" | "ausente"
}> {
  const fontes = await carregarFontes(escopo, comp, repo)
  const competencia = fontes.competencia
  if (!competencia) {
    return { competencia: formatCompetencia(comp), avisos: [], emitidos: 0, fontePacote: "ausente" }
  }

  const candidatos = avaliarRegras(fontes, agora)
  let emitidos = 0
  for (const c of candidatos) {
    if (silenciado(fontes.eventosAlerta, c)) continue
    const r = await repo.registrarEventoUnico(
      {
        storeId: escopo.storeId,
        competenciaId: competencia.id,
        tipo: EVENTO_ALERTA_EMITIDO,
        atorTipo: ATOR_TIPO_INTERNO,
        atorId: escopo.userId,
        entidade: c.origem,
        entidadeId: c.alvo,
        origem: ORIGEM_NOTIFICACOES,
        metadata: {
          regra: c.regra,
          alvo: c.alvo,
          janela: c.janela,
          competencia: formatCompetencia(comp),
        },
      },
      {
        competenciaId: competencia.id,
        tipo: EVENTO_ALERTA_EMITIDO,
        regra: c.regra,
        alvo: c.alvo,
        janela: c.janela,
      },
    )
    if (r.criado) emitidos += 1
  }

  const depois = await carregarFontes(escopo, comp, repo)
  return {
    competencia: formatCompetencia(comp),
    avisos: dtosAtivos(depois, agora),
    emitidos,
    fontePacote: fontePacoteDasFontes(depois.pacotes),
  }
}

export async function tratarAlerta(
  escopo: EscopoNotificacoes,
  comp: Competencia,
  alertId: string,
  repo: NotificacoesRepo,
  agora: Date = new Date(),
): Promise<{ id: string; tratado: true }> {
  const id = String(alertId ?? "").trim()
  if (!id) throw new AlertaNaoEncontradoError()

  const fontes = await carregarFontes(escopo, comp, repo)
  const competencia = fontes.competencia
  if (!competencia) throw new AlertaNaoEncontradoError()

  const candidato = acharCandidatoPorId(fontes, id, agora)
  if (!candidato) throw new AlertaNaoEncontradoError()

  const codigo = formatCompetencia(comp)
  await repo.garantirEmitidoETratado(
    eventoDeCandidato(candidato, escopo, competencia.id, codigo, EVENTO_ALERTA_EMITIDO),
    eventoDeCandidato(candidato, escopo, competencia.id, codigo, EVENTO_ALERTA_TRATADO),
    {
      competenciaId: competencia.id,
      regra: candidato.regra,
      alvo: candidato.alvo,
      janela: candidato.janela,
    },
  )

  return { id, tratado: true }
}

export async function rascunhoAlerta(
  escopo: EscopoNotificacoes,
  comp: Competencia,
  alertId: string,
  repo: NotificacoesRepoLeitura,
  agora: Date = new Date(),
): Promise<RascunhoDto> {
  const id = String(alertId ?? "").trim()
  if (!id) throw new AlertaNaoEncontradoError()

  const fontes = await carregarFontes(escopo, comp, repo)
  const competencia = fontes.competencia
  if (!competencia) throw new AlertaNaoEncontradoError()

  const candidato = acharCandidatoPorId(fontes, id, agora)
  if (!candidato) throw new AlertaNaoEncontradoError()
  if (silenciado(fontes.eventosAlerta, candidato)) throw new AlertaNaoEncontradoError()

  return gerarRascunho(candidato, {
    competencia: formatCompetencia(comp),
    lojaRef: `loja:${escopo.storeId}`,
  })
}
