/**
 * Contador HUB · portas de produção do fechamento (GOAL 012).
 *
 * Liga o serviço puro aos ativos reais já existentes:
 *  - `PacotePort`  → gerador do GOAL 008 (`gerarPacoteContador`);
 *  - `StoragePacotePort` → adapter privado atual — Cloudflare R2 (`storageR2`,
 *    GOAL 012C) — substituindo o adapter Supabase (`@deprecated`).
 *
 * Fica num módulo próprio para que as rotas não importem R2/Prisma direto e para
 * que os testes possam injetar fakes sem tocar em nada disto.
 */
import { gerarPacoteContador } from "@/lib/contador/pacote/builder"
import { storageR2 } from "@/lib/contador/documentos/storage-r2"
import type { PacotePort, StoragePacotePort } from "./service"

/** MIME do pacote oficial. */
export const MIME_PACOTE = "application/zip" as const

export const pacotePortProducao: PacotePort = {
  gerar: (input) => gerarPacoteContador(input),
}

export const storagePacotePortProducao: StoragePacotePort = {
  enviarPacote: (storageRef, bytes) =>
    storageR2.enviarConteudoPrivado(storageRef, bytes, MIME_PACOTE),
  verificarExistencia: (storageRef) => storageR2.verificarExistencia(storageRef),
  criarDownloadAssinado: (storageRef, nomeArquivo, expiresInSec) =>
    storageR2.criarDownloadAssinado(storageRef, nomeArquivo, expiresInSec),
}

/** Portas reais prontas para espalhar no objeto de deps das rotas. */
export function criarPortasFechamento(): {
  pacote: PacotePort
  storage: StoragePacotePort
} {
  return { pacote: pacotePortProducao, storage: storagePacotePortProducao }
}
