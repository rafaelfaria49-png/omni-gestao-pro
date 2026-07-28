/**
 * Contador HUB · Documentos — RESOLUÇÃO CENTRAL do adapter de storage (GOAL 012E · P2).
 *
 * Até o 012C o gate `lerStorageProvider()` existia mas era decorativo: as rotas
 * importavam `storageR2` direto, então declarar outro provider não mudava nada — o
 * R2 era usado de qualquer jeito. Este módulo é o ÚNICO ponto autorizado a devolver
 * um adapter concreto, e ele consulta o gate antes.
 *
 * Regras:
 *  - `CONTADOR_STORAGE_PROVIDER` deve estar declarada e valer `r2`;
 *  - ausente, vazia ou qualquer outro valor ⇒ falha (`StorageProviderError`);
 *  - NÃO existe fallback automático para o Supabase descontinuado — nem por ausência
 *    de configuração, nem por erro do R2;
 *  - nenhuma rota produtiva importa `storage-r2` (ou `storage-supabase`) diretamente.
 *
 * O adapter Supabase (`storage-supabase.ts`) permanece `@deprecated` no tree como
 * caminho de rollback MANUAL (GOAL 012B §7.1) e não é alcançável a partir daqui.
 */
import { lerStorageProvider } from "./config"
import { storageR2 } from "./storage-r2"
import type { StorageDocumentosPort } from "./storage-types"

/**
 * Devolve o adapter do provider declarado. Chamar por request (barato: o cliente S3
 * é memoizado dentro do adapter) para que uma troca de configuração não fique presa
 * num módulo já carregado.
 */
export function resolverStorageDocumentos(
  env: Record<string, string | undefined> = process.env,
): StorageDocumentosPort {
  const provider = lerStorageProvider(env)
  // Exaustivo de propósito: acrescentar um provider ao tipo quebra a compilação aqui,
  // e não silenciosamente cai em algum default.
  switch (provider) {
    case "r2":
      return storageR2
  }
}
