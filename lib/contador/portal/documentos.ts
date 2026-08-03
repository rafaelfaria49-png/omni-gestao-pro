/**
 * Contador HUB · Portal externo read-only — documentos (GOAL 015).
 *
 * Listagem REUSA `listarDocumentos` do domínio (GOAL 010) com o escopo estrutural
 * do portal — o DTO já nasce sem `storageRef`. A pseudonimização (P2-2 da
 * auditoria 013) é aplicada na fronteira do portal: `enviadoPorId` de ator
 * INTERNO vira pseudônimo estável; id de ator externo permanece (identifica o
 * próprio contador).
 *
 * O download NÃO reusa `autorizarDownload` do domínio: lá o evento sai com
 * `atorTipo: "interno"` hardcoded. Aqui o fluxo é próprio, com a mesma ordem de
 * defesas — lookup composto (id, storeId) → 404 sem confirmar existência →
 * existência no storage → EVENTO EXTERNO COM IP/UA ANTES de emitir a URL →
 * presigned com teto de 300s.
 */
import type { ContadorScopeExterno } from "@/lib/contador/auth-externa/escopo-externo"
import {
  DocumentoNaoEncontradoError,
  listarDocumentos,
  type DocumentoDto,
  type DocumentosRepo,
  type DownloadAutorizado,
  type FiltrosListagem,
} from "@/lib/contador/documentos/service"
import { DOWNLOAD_EXPIRACAO_SEG } from "@/lib/contador/documentos/config"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import { pseudonimoAtor } from "@/lib/contador/fechamento/canonico"
import { escopoEstruturalPortal } from "./escopo"
import {
  EVENTO_PORTAL_DOCUMENTO_DOWNLOAD,
  montarEventoPortal,
  resolverAtorPortal,
  type ContextoAtorPortal,
  type PortalEventosRepo,
} from "./eventos"

export type DepsDocumentosPortal = Readonly<{ repo: DocumentosRepo }>

export type DepsDownloadPortal = Readonly<{
  repo: DocumentosRepo
  storage: StorageDocumentosPort
  eventos: PortalEventosRepo
}>

/** Pseudonimiza o remetente INTERNO (P2-2); ator externo permanece identificável. */
function pseudonimizarEnvio(dto: DocumentoDto): DocumentoDto {
  if (dto.enviadoPorTipo !== "interno") return dto
  return Object.freeze({ ...dto, enviadoPorId: pseudonimoAtor(dto.enviadoPorId) })
}

/** Lista documentos não-excluídos da competência (sem `storageRef` no DTO). */
export async function listarDocumentosPortal(
  escopo: ContadorScopeExterno,
  competenciaCodigo: string,
  filtros: FiltrosListagem,
  deps: DepsDocumentosPortal,
  agora: Date = new Date(),
): Promise<DocumentoDto[]> {
  const lista = await listarDocumentos(
    escopoEstruturalPortal(escopo),
    competenciaCodigo,
    filtros,
    deps,
    agora,
  )
  return lista.map(pseudonimizarEnvio)
}

/**
 * Autoriza o download de um documento da loja do escopo.
 *
 * O evento `documento_download_autorizado` (ator externo + ipHash + UA) é gravado
 * ANTES da emissão da URL assinada: a auditoria registra a AUTORIZAÇÃO, e uma
 * falha na assinatura nunca produz URL sem trilha.
 */
export async function autorizarDownloadPortal(
  escopo: ContadorScopeExterno,
  id: string,
  contexto: ContextoAtorPortal,
  deps: DepsDownloadPortal,
): Promise<DownloadAutorizado> {
  const docId = String(id ?? "").trim()
  if (!docId) throw new DocumentoNaoEncontradoError()

  // Lookup COMPOSTO (id + storeId): documento de outra loja é o mesmo 404 de um
  // id inexistente — a existência alheia nunca é confirmada.
  const doc = await deps.repo.acharDocumentoDaLoja(docId, escopo.storeId)
  if (!doc || doc.excluidoEm) throw new DocumentoNaoEncontradoError()

  const existe = await deps.storage.verificarExistencia(doc.storageRef)
  if (!existe) throw new DocumentoNaoEncontradoError()

  const ator = await resolverAtorPortal(contexto)
  await deps.eventos.registrarEvento(
    montarEventoPortal({
      escopo,
      ator,
      competenciaId: doc.competenciaId,
      tipo: EVENTO_PORTAL_DOCUMENTO_DOWNLOAD,
      entidade: "documento",
      entidadeId: doc.id,
      metadata: { categoria: doc.categoria, expiresInSec: DOWNLOAD_EXPIRACAO_SEG },
    }),
  )

  const assinado = await deps.storage.criarDownloadAssinado(
    doc.storageRef,
    doc.nomeArquivo,
    DOWNLOAD_EXPIRACAO_SEG,
  )
  return Object.freeze({ signedUrl: assinado.signedUrl, expiresInSec: assinado.expiresInSec })
}
