/**
 * Contador HUB · portas de produção do fechamento (GOAL 012).
 *
 * Liga o serviço puro aos ativos reais já existentes:
 *  - `PacotePort`  → gerador do GOAL 008 (`gerarPacoteContador`);
 *  - `StoragePacotePort` → adapter privado do GOAL 010 (`storageSupabase`).
 *
 * Fica num módulo próprio para que as rotas não importem Supabase/Prisma direto e para
 * que os testes possam injetar fakes sem tocar em nada disto.
 */
import { gerarPacoteContador } from "@/lib/contador/pacote/builder"
import { storageSupabase } from "@/lib/contador/documentos/storage-supabase"
import type { PacotePort, StoragePacotePort } from "./service"

/** MIME do pacote oficial. */
export const MIME_PACOTE = "application/zip" as const

export const pacotePortProducao: PacotePort = {
  gerar: (input) => gerarPacoteContador(input),
}

export const storagePacotePortProducao: StoragePacotePort = {
  enviarPacote: (storageRef, bytes) =>
    storageSupabase.enviarConteudoPrivado(storageRef, bytes, MIME_PACOTE),
  verificarExistencia: (storageRef) => storageSupabase.verificarExistencia(storageRef),
  criarDownloadAssinado: (storageRef, nomeArquivo, expiresInSec) =>
    storageSupabase.criarDownloadAssinado(storageRef, nomeArquivo, expiresInSec),
}

/** Portas reais prontas para espalhar no objeto de deps das rotas. */
export function criarPortasFechamento(): {
  pacote: PacotePort
  storage: StoragePacotePort
} {
  return { pacote: pacotePortProducao, storage: storagePacotePortProducao }
}
