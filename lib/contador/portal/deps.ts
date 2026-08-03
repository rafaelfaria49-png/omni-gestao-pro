/**
 * Contador HUB · Portal externo read-only — RESOLUÇÃO DE DEPENDÊNCIAS (GOAL 015).
 *
 * Ponto único onde as ROTAS (fase 2, `app/api/contador-externo/**`) obtêm as
 * portas de produção dos serviços do portal — e onde os testes de rota injetam
 * os fakes in-memory (`__setDepsPortalParaTestes`), no mesmo espírito de
 * `__setRepoAuthExternaParaTestes` do GOAL 014: sem `vi.mock("@/lib/prisma")`,
 * sem banco real.
 *
 * Cada resolvedor é uma FUNÇÃO chamada pela rota no momento do uso (lazy):
 * `resolverStorageDocumentos()` valida `CONTADOR_STORAGE_PROVIDER` a cada chamada
 * (gate central do GOAL 012E) e não pode ser avaliado na carga do módulo — uma
 * rota de GET nunca toca storage.
 *
 * O storage de pacotes é o MESMO adapter privado dos documentos (o ZIP oficial
 * vive no mesmo bucket/R2 — ver `fechamento/portas.ts`), mas com `enviarPacote`
 * fail-closed: o portal é read-only e nunca grava blob.
 */
import { criarRepoComentarios } from "@/lib/contador/comentarios/repo-prisma"
import type { ComentariosRepo } from "@/lib/contador/comentarios/service"
import { criarRepoPrisma as criarRepoDocumentos } from "@/lib/contador/documentos/repo-prisma"
import type { DocumentosRepo } from "@/lib/contador/documentos/service"
import { resolverStorageDocumentos } from "@/lib/contador/documentos/storage"
import type { StorageDocumentosPort } from "@/lib/contador/documentos/storage-types"
import { criarRepoFechamento } from "@/lib/contador/fechamento/repo-prisma"
import type { FechamentoRepo, StoragePacotePort } from "@/lib/contador/fechamento/service"
import { criarRepoStatus } from "@/lib/contador/status/repo-prisma"
import type { StatusRepo } from "@/lib/contador/status/service"
import { criarRepoTimeline } from "@/lib/contador/timeline/repo-prisma"
import type { TimelineRepo } from "@/lib/contador/timeline/service"
import { construirDadosContador } from "@/lib/contador/readers"
import { criarRepoEventosPortal, type PortalEventosRepo } from "./eventos"
import type { CarregarDadosVivos } from "./resumo"

export type OverridesDepsPortal = Partial<{
  repoFechamento: FechamentoRepo
  repoDocumentos: DocumentosRepo
  repoComentarios: ComentariosRepo
  repoTimeline: TimelineRepo
  repoStatus: StatusRepo
  repoEventos: PortalEventosRepo
  storageDocumentos: StorageDocumentosPort
  storagePacotes: StoragePacotePort
  carregarDados: CarregarDadosVivos
}>

let overrides: OverridesDepsPortal | null = null

/** Uso exclusivo dos testes de rota — injeta fakes (ou null para restaurar). */
export function __setDepsPortalParaTestes(o: OverridesDepsPortal | null): void {
  overrides = o
}

export function repoFechamentoPortal(): FechamentoRepo {
  return overrides?.repoFechamento ?? criarRepoFechamento()
}

export function repoDocumentosPortal(): DocumentosRepo {
  return overrides?.repoDocumentos ?? criarRepoDocumentos()
}

export function repoComentariosPortal(): ComentariosRepo {
  return overrides?.repoComentarios ?? criarRepoComentarios()
}

export function repoTimelinePortal(): TimelineRepo {
  return overrides?.repoTimeline ?? criarRepoTimeline()
}

export function repoStatusPortal(): StatusRepo {
  return overrides?.repoStatus ?? criarRepoStatus()
}

export function repoEventosPortal(): PortalEventosRepo {
  return overrides?.repoEventos ?? criarRepoEventosPortal()
}

export function storageDocumentosPortal(): StorageDocumentosPort {
  return overrides?.storageDocumentos ?? resolverStorageDocumentos()
}

/** Adapter do ZIP oficial sobre o MESMO storage privado — escrita fail-closed. */
const storagePacotesProducao: StoragePacotePort = {
  enviarPacote: () =>
    Promise.reject(new Error("O portal externo é read-only: nunca grava pacote.")),
  verificarExistencia: (storageRef) => resolverStorageDocumentos().verificarExistencia(storageRef),
  criarDownloadAssinado: (storageRef, nomeArquivo, expiresInSec) =>
    resolverStorageDocumentos().criarDownloadAssinado(storageRef, nomeArquivo, expiresInSec),
}

export function storagePacotesPortal(): StoragePacotePort {
  return overrides?.storagePacotes ?? storagePacotesProducao
}

export function carregarDadosPortal(): CarregarDadosVivos {
  return overrides?.carregarDados ?? construirDadosContador
}
