/**
 * @deprecated Adapter de storage privado (Supabase Storage) — REJEITADO como
 *   provider produtivo desde a decisão GOAL 012B e substituído por Cloudflare R2
 *   (`storage-r2.ts`, GOAL 012C). Mantido no tree APENAS como caminho de rollback
 *   manual (GOAL 012B §7.1). NENHUM import produtivo aponta para este arquivo.
 *
 *   Para reverter de intenção, trocar manualmente os 4 imports produtivos
 *   (`app/api/contador/documentos/{upload-intent,complete,[id]/download}` e
 *   `lib/contador/documentos/fechamento/portas.ts`) de `storage-r2` para
 *   `storage-supabase` E cadastrar as três vars Supabase Storage inexistentes
 *   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`)
 *   hoje ausentes da Vercel. Há custo humano real de rollback — intencional.
 *
 *   Risco da reativação (motivo da rejeição): `service_role` Supabase é project-wide
 *   e bypassa RLS — vazamento = acesso a tudo do projeto Supabase, sem isolamento
 *   Preview × Production nativo; recriaria exatamente o risco que motivou o
 *   congelamento do Supabase como contingência.
 *
 * Contador HUB · Documentos — adapter de storage privado (Supabase Storage). GOAL 010.
 *
 * SERVER-ONLY. Usa a `service_role` para operar sobre um bucket PRIVADO. Regras:
 *  - `storageRef` é sempre o path privado — nunca `getPublicUrl`, nunca bucket público;
 *  - upload direto do navegador via `createSignedUploadUrl` (upsert desabilitado);
 *  - download sempre como attachment, por URL assinada de curta duração;
 *  - erros externos viram `StorageError` com mensagem segura (sem token/URL assinada);
 *  - nada de secret, token ou URL assinada em log.
 *
 * O binário NUNCA passa por este processo no upload (o navegador envia direto ao
 * Supabase). O processo só LÊ o objeto para validar/hash no passo de `complete`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { lerStorageConfig, DOWNLOAD_EXPIRACAO_SEG, UPLOAD_EXPIRACAO_SEG } from "./config"
import {
  StorageError,
  type BucketEstado,
  type DownloadAssinado,
  type ObjetoMetadata,
  type StorageDocumentosPort,
  type UploadAssinado,
} from "./storage-types"

let clienteMemo: { client: SupabaseClient; bucket: string } | null = null

/** Cria (uma vez) o cliente Supabase com a service role. Sem sessão persistida. */
function resolverCliente(): { client: SupabaseClient; bucket: string } {
  if (clienteMemo) return clienteMemo
  const cfg = lerStorageConfig()
  const client = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  clienteMemo = { client, bucket: cfg.bucket }
  return clienteMemo
}

function dividirPath(storageRef: string): { dir: string; base: string } {
  const idx = storageRef.lastIndexOf("/")
  if (idx <= 0) return { dir: "", base: storageRef }
  return { dir: storageRef.slice(0, idx), base: storageRef.slice(idx + 1) }
}

/** Converte erro/exceção externa em `StorageError` — mensagem genérica e segura. */
function falha(operacao: string): StorageError {
  return new StorageError(operacao, `Falha na operação de storage (${operacao}).`)
}

export const storageSupabase: StorageDocumentosPort = {
  async verificarBucket(): Promise<BucketEstado> {
    const { client, bucket } = resolverCliente()
    try {
      const { data, error } = await client.storage.getBucket(bucket)
      if (error || !data) return { existe: false, publico: null }
      return { existe: true, publico: Boolean(data.public) }
    } catch {
      throw falha("verificarBucket")
    }
  },

  async criarUploadAssinado(storageRef, expiresInSec = UPLOAD_EXPIRACAO_SEG): Promise<UploadAssinado> {
    const { client, bucket } = resolverCliente()
    try {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUploadUrl(storageRef, { upsert: false })
      if (error || !data) throw falha("criarUploadAssinado")
      return Object.freeze({
        storageRef,
        signedUrl: data.signedUrl,
        token: data.token,
        expiresInSec,
      })
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("criarUploadAssinado")
    }
  },

  /** GOAL 012 — sobe o ZIP oficial gerado no servidor. Ver contrato em `storage-types`. */
  async enviarConteudoPrivado(storageRef, conteudo, mime): Promise<void> {
    const { client, bucket } = resolverCliente()
    try {
      const { error } = await client.storage
        .from(bucket)
        // `upsert` seguro: o path carrega o hash do manifesto, então reescrever é
        // reescrever o mesmo conteúdo (retry idempotente, nunca sobrescrita silenciosa).
        .upload(storageRef, Buffer.from(conteudo), { contentType: mime, upsert: true })
      if (error) throw falha("enviarConteudoPrivado")
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("enviarConteudoPrivado")
    }
  },

  async obterMetadata(storageRef): Promise<ObjetoMetadata | null> {
    const { client, bucket } = resolverCliente()
    const { dir, base } = dividirPath(storageRef)
    try {
      const { data, error } = await client.storage.from(bucket).list(dir, { search: base, limit: 100 })
      if (error || !data) return null
      const item = data.find((f) => f.name === base)
      if (!item) return null
      const meta = (item.metadata ?? {}) as { size?: number; mimetype?: string }
      return Object.freeze({
        bytes: typeof meta.size === "number" ? meta.size : 0,
        mime: typeof meta.mimetype === "string" ? meta.mimetype : null,
      })
    } catch {
      throw falha("obterMetadata")
    }
  },

  async abrirConteudoPrivado(storageRef): Promise<Buffer> {
    const { client, bucket } = resolverCliente()
    try {
      const { data, error } = await client.storage.from(bucket).download(storageRef)
      if (error || !data) throw falha("abrirConteudoPrivado")
      const arrayBuffer = await data.arrayBuffer()
      return Buffer.from(arrayBuffer)
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("abrirConteudoPrivado")
    }
  },

  async criarDownloadAssinado(
    storageRef,
    nomeArquivo,
    expiresInSec = DOWNLOAD_EXPIRACAO_SEG,
  ): Promise<DownloadAssinado> {
    const { client, bucket } = resolverCliente()
    // Nunca acima do teto aprovado (300s).
    const expira = Math.min(Math.max(1, Math.floor(expiresInSec)), DOWNLOAD_EXPIRACAO_SEG)
    try {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(storageRef, expira, { download: nomeArquivo })
      if (error || !data) throw falha("criarDownloadAssinado")
      return Object.freeze({ signedUrl: data.signedUrl, expiresInSec: expira })
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("criarDownloadAssinado")
    }
  },

  async removerObjeto(storageRef): Promise<void> {
    const { client, bucket } = resolverCliente()
    try {
      const { error } = await client.storage.from(bucket).remove([storageRef])
      if (error) throw falha("removerObjeto")
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("removerObjeto")
    }
  },

  async verificarExistencia(storageRef): Promise<boolean> {
    const meta = await this.obterMetadata(storageRef)
    return meta !== null
  },
}
