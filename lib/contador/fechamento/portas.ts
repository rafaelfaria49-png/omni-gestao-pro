/**
 * Contador HUB · portas de produção do fechamento (GOAL 012).
 *
 * Liga o serviço puro aos ativos reais já existentes:
 *  - `PacotePort`  → gerador do GOAL 008 (`gerarPacoteContador`);
 *  - `StoragePacotePort` → adapter privado resolvido pelo GATE central
 *    (`resolverStorageDocumentos`, GOAL 012E · P2), hoje Cloudflare R2 (GOAL 012C).
 *
 * O adapter concreto NÃO é importado aqui: o gate é quem valida
 * `CONTADOR_STORAGE_PROVIDER` e decide. Assim o fechamento/pacote obedece ao mesmo
 * portão das rotas de documento, sem caminho paralelo que o contorne.
 *
 * Fica num módulo próprio para que as rotas não importem storage/Prisma direto e para
 * que os testes possam injetar fakes sem tocar em nada disto.
 */
import { gerarPacoteContador } from "@/lib/contador/pacote/builder"
import { resolverStorageDocumentos } from "@/lib/contador/documentos/storage"
import type { PacotePort, StoragePacotePort } from "./service"

/** MIME do pacote oficial. */
export const MIME_PACOTE = "application/zip" as const

export const pacotePortProducao: PacotePort = {
  gerar: (input) => gerarPacoteContador(input),
}

// O gate é consultado a cada operação (não na carga do módulo): provider inválido
// falha na chamada real, e não num import que poderia ser feito por engano em build.
export const storagePacotePortProducao: StoragePacotePort = {
  enviarPacote: (storageRef, bytes) =>
    resolverStorageDocumentos().enviarConteudoPrivado(storageRef, bytes, MIME_PACOTE),
  verificarExistencia: (storageRef) => resolverStorageDocumentos().verificarExistencia(storageRef),
  criarDownloadAssinado: (storageRef, nomeArquivo, expiresInSec) =>
    resolverStorageDocumentos().criarDownloadAssinado(storageRef, nomeArquivo, expiresInSec),
}

/** Portas reais prontas para espalhar no objeto de deps das rotas. */
export function criarPortasFechamento(): {
  pacote: PacotePort
  storage: StoragePacotePort
} {
  return { pacote: pacotePortProducao, storage: storagePacotePortProducao }
}
