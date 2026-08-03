/**
 * Contador HUB · Portal externo read-only — pacotes oficiais (GOAL 015).
 *
 * Listagem REUSA `carregarEstadoFechamento` (`.pacotes`) com capacidades
 * somente-leitura; `geradoPorId` interno é pseudonimizado na fronteira (P2-2).
 *
 * O download NÃO reusa `autorizarDownloadPacote` do domínio (evento com atorTipo
 * "interno" hardcoded): fluxo próprio com evento `pacote_baixado` EXTERNO +
 * IP/UA gravado ANTES da emissão da URL, presigned com teto de 300s e DTO sem
 * `storageRef`.
 *
 * `confirmarRecebimentoPacotePortal` é NOVO no domínio: a confirmação de
 * recebimento é um EVENTO (`pacote_recebimento_confirmado`) — sem tabela nova.
 * Idempotente por (usuarioId externo, competenciaId, versao): a 2ª chamada
 * encontra o evento já gravado e devolve o MESMO estado, sem duplicar a trilha.
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { DOWNLOAD_EXPIRACAO_SEG } from "@/lib/contador/documentos/config"
import { pseudonimoAtor } from "@/lib/contador/fechamento/canonico"
import {
  carregarEstadoFechamento,
  CompetenciaNaoEncontradaError,
  PacoteNaoEncontradoError,
  type FechamentoRepo,
  type PacoteVersaoDto,
  type StoragePacotePort,
} from "@/lib/contador/fechamento/service"
import { nomeArquivoPacote, type DownloadPacoteDto } from "@/lib/contador/pacote/versoes"
import { CAPACIDADES_PORTAL_READONLY, escopoEstruturalPortal } from "./escopo"
import {
  EVENTO_PORTAL_PACOTE_BAIXADO,
  EVENTO_PORTAL_PACOTE_RECEBIDO,
  montarEventoPortal,
  resolverAtorPortal,
  type ContextoAtorPortal,
  type PortalEventosRepo,
} from "./eventos"

export type DepsPacotesPortal = Readonly<{
  repo: Pick<FechamentoRepo, "acharCompetencia" | "listarPacotes" | "acharPacote">
}>

export type DepsDownloadPacotePortal = DepsPacotesPortal &
  Readonly<{ storage: StoragePacotePort; eventos: PortalEventosRepo }>

export type DepsRecebimentoPacotePortal = DepsPacotesPortal &
  Readonly<{ eventos: PortalEventosRepo }>

/** Pseudonimiza o gerador INTERNO da versão (P2-2); ator externo permanece. */
function pseudonimizarGeracao(dto: PacoteVersaoDto): PacoteVersaoDto {
  if (dto.geradoPorTipo !== "interno") return dto
  return Object.freeze({ ...dto, geradoPorId: pseudonimoAtor(dto.geradoPorId) })
}

/** Lista as versões materializadas do pacote oficial da competência. Read-only. */
export async function listarPacotesPortal(
  escopo: ContadorScopeExterno,
  comp: Competencia,
  deps: DepsPacotesPortal,
): Promise<PacoteVersaoDto[]> {
  const estado = await carregarEstadoFechamento(
    escopoEstruturalPortal(escopo),
    CAPACIDADES_PORTAL_READONLY,
    comp,
    { repo: deps.repo as FechamentoRepo },
  )
  return estado.pacotes.map(pseudonimizarGeracao)
}

/**
 * Autoriza o download de UMA versão persistida. Competência/pacote de outra loja
 * ou inexistente → 404 sem confirmar existência; linha commitada sem blob → 404
 * honesto (coerência storage × banco). Evento externo ANTES da URL.
 */
export async function autorizarDownloadPacotePortal(
  escopo: ContadorScopeExterno,
  comp: Competencia,
  versao: number,
  contexto: ContextoAtorPortal,
  deps: DepsDownloadPacotePortal,
): Promise<DownloadPacoteDto> {
  const codigo = formatCompetencia(comp)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()

  const pacote = await deps.repo.acharPacote(competencia.id, versao)
  if (!pacote) throw new PacoteNaoEncontradoError()

  const existe = await deps.storage.verificarExistencia(pacote.storageRef)
  if (!existe) throw new PacoteNaoEncontradoError()

  const ator = await resolverAtorPortal(contexto)
  await deps.eventos.registrarEvento(
    montarEventoPortal({
      escopo,
      ator,
      competenciaId: competencia.id,
      tipo: EVENTO_PORTAL_PACOTE_BAIXADO,
      entidade: "competencia",
      entidadeId: competencia.id,
      // Metadata saneada: ponteiros de integridade, nunca storageRef nem URL assinada.
      metadata: {
        competencia: codigo,
        versao: pacote.versao,
        manifestoHash: pacote.manifestoHash,
        bytes: pacote.bytes,
        expiresInSec: DOWNLOAD_EXPIRACAO_SEG,
      },
    }),
  )

  const nomeArquivo = nomeArquivoPacote(codigo, pacote.versao)
  const { signedUrl, expiresInSec } = await deps.storage.criarDownloadAssinado(
    pacote.storageRef,
    nomeArquivo,
    DOWNLOAD_EXPIRACAO_SEG,
  )

  return Object.freeze({
    versao: pacote.versao,
    manifestoHash: pacote.manifestoHash,
    bytes: pacote.bytes,
    nomeArquivo,
    url: signedUrl,
    expiresInSec,
  })
}

export type RecebimentoPacoteDto = Readonly<{
  confirmado: true
  confirmadoEm: string
}>

/**
 * Confirma o recebimento de uma versão do pacote — IDEMPOTENTE.
 *
 * A confirmação É o evento `pacote_recebimento_confirmado` (append-only). A
 * repetição consulta a trilha e devolve o mesmo `{ confirmado, confirmadoEm }`
 * da primeira vez, sem gravar nada — o instante vem SEMPRE da trilha (o
 * `createdAt` do evento), nunca do relógio da rota. Só se confirma versão que
 * EXISTE (pacote materializado) — versão inexistente é 404, não confirmação vazia.
 */
export async function confirmarRecebimentoPacotePortal(
  escopo: ContadorScopeExterno,
  comp: Competencia,
  versao: number,
  contexto: ContextoAtorPortal,
  deps: DepsRecebimentoPacotePortal,
): Promise<RecebimentoPacoteDto> {
  const codigo = formatCompetencia(comp)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()

  const pacote = await deps.repo.acharPacote(competencia.id, versao)
  if (!pacote) throw new PacoteNaoEncontradoError()

  const existente = await deps.eventos.acharRecebimentoPacote({
    storeId: escopo.storeId,
    competenciaId: competencia.id,
    atorId: escopo.usuario.id,
    versao: pacote.versao,
  })
  if (existente) {
    return Object.freeze({ confirmado: true, confirmadoEm: existente.criadoEm.toISOString() })
  }

  const ator = await resolverAtorPortal(contexto)
  const registro = await deps.eventos.registrarEvento(
    montarEventoPortal({
      escopo,
      ator,
      competenciaId: competencia.id,
      tipo: EVENTO_PORTAL_PACOTE_RECEBIDO,
      entidade: "competencia",
      entidadeId: competencia.id,
      metadata: { competencia: codigo, versao: pacote.versao, manifestoHash: pacote.manifestoHash },
    }),
  )
  // O instante devolvido é o DA TRILHA: a 1ª e as próximas chamadas respondem igual.
  return Object.freeze({ confirmado: true, confirmadoEm: registro.criadoEm.toISOString() })
}
