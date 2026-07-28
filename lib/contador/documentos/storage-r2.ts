/**
 * Contador HUB · Documentos — adapter de storage privado (Cloudflare R2). GOAL 012C.
 *
 * SERVER-ONLY. Implementa `StorageDocumentosPort` (o MESMO contrato do service —
 * provider-agnostic) sobre a API S3-compatible do R2, via `@aws-sdk/client-s3`
 * + `@aws-sdk/s3-request-presigner`. Regras (idênticas ao adapter Supabase que
 * substitui — ver GOAL 010/012B):
 *  - `storageRef` é sempre o path privado — nunca URL pública, nunca bucket público;
 *  - upload direto do navegador via URL assinada (presigned PUT) — o binário não
 *    passa pela API Next.js;
 *  - upload server-side (ZIP oficial do pacote) via PutObject;
 *  - download sempre como attachment (Content-Disposition), por URL assinada de
 *    curta duração (<= 300s);
 *  - erros externos viram `StorageError` com mensagem segura (sem token/URL);
 *  - nada de secret, token ou URL assinada em log.
 *
 * Bucket PRIVADO. No R2, "privado" é a política default; não há propriedade
 * `public` consultável pela API S3 (por isso `verificarBucket` devolve
 * `publico: null` para "indeterminado" — o desenho operacional garante privado).
 *
 * Nenhum fallback automático para o adapter Supabase descontinuado
 * (`storage-supabase.ts`, mantido `@deprecated` apenas como caminho de rollback
 * manual — ver GOAL 012B §7.1). A configuração R2 ausente é **fail-closed**
 * (`StorageConfigError`), nunca redireciona para outro provider.
 *
 * Path namespace canônico (preservado do GOAL 012 §4):
 *   documentos → `contador/{storeId}/{AAAA-MM}/{documentoId}/{nomeSanitizado}`
 *   pacotes    → `contador/{storeId}/{AAAA-MM}/pacotes/v{N}/{manifestoHash}.zip`
 * O adapter NÃO normaliza/reescreve `storageRef` — passa-o verbatim ao S3 Key.
 * Toda defesa contra path traversal/cross-store fica no service (`validacao.ts`
 * · `storageRefPertence` · `sanitizarSegmentoPath`).
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  DOWNLOAD_EXPIRACAO_SEG,
  UPLOAD_EXPIRACAO_SEG,
  lerStorageR2Config,
  type StorageR2Config,
} from "./config"
import {
  StorageError,
  type BucketEstado,
  type DownloadAssinado,
  type ObjetoMetadata,
  type StorageDocumentosPort,
  type UploadAssinado,
} from "./storage-types"

let clienteMemo: { client: S3Client; cfg: StorageR2Config } | null = null

/** Cria (uma vez) o cliente S3 apontando para o endpoint R2. Sem sessão persistida. */
function resolverCliente(): { client: S3Client; cfg: StorageR2Config } {
  if (clienteMemo) return clienteMemo
  const cfg = lerStorageR2Config()
  const s3Config: S3ClientConfig = {
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Path-style é suportado e evita ambiguidade com buckets que contenham `.`.
    // Compat-verificado com R2 (Cloudflare accepts path-style requests).
    forcePathStyle: true,
  }
  const client = new S3Client(s3Config)
  clienteMemo = { client, cfg }
  return clienteMemo
}

/** Converte erro/exceção externa em `StorageError` — mensagem genérica e segura. */
function falha(operacao: string): StorageError {
  return new StorageError(operacao, `Falha na operação de storage (${operacao}).`)
}

/**
 * Teto default de TTL para signed URLs. Se o caller não passar `expiresInSec`,
 * usa `R2_SIGNED_URL_TTL_SECONDS` (se definido), senão o tete hard-coded do
 * contrato (`UPLOAD_EXPIRACAO_SEG` / `DOWNLOAD_EXPIRACAO_SEG`). O adapter sempre
 * capa o resultado no tete correspondente (upload 120s / download 300s).
 */
function ttlDefault(cfg: StorageR2Config, tetoContrato: number): number {
  if (cfg.signedUrlTtlSeconds && cfg.signedUrlTtlSeconds > 0) {
    return Math.min(cfg.signedUrlTtlSeconds, tetoContrato)
  }
  return tetoContrato
}

/** Cabeçalho Content-Disposition forçando attachment (nunca inline). */
function contentDisposition(nomeArquivo: string): string {
  // Sanitiza minimamente para evitar injection no header; o nome já vem saneado
  // pelo service (`sanitizarNomeArquivo`), isto é defesa em profundidade.
  const limpo = String(nomeArquivo).replace(/["\r\n]/g, "")
  return `attachment; filename="${limpo}"`
}

export const storageR2: StorageDocumentosPort = {
  async verificarBucket(): Promise<BucketEstado> {
    const { client, cfg } = resolverCliente()
    try {
      await client.send(
        new HeadBucketCommand({ Bucket: cfg.bucket }),
      )
      // R2 não expõe flag "public" via S3 API; buckets são private-by-default.
      // `publico: null` é honesto — a privacidade é garantida pelo provisioning.
      return Object.freeze({ existe: true, publico: null })
    } catch (e) {
      // 404 = bucket não existe nesse account; tratado como "não existe".
      const name = (e as { name?: string } | null)?.name ?? ""
      const code = (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
      if (name === "NotFound" || code === 404) {
        return Object.freeze({ existe: false, publico: null })
      }
      throw falha("verificarBucket")
    }
  },

  async criarUploadAssinado(storageRef, expiresInSec): Promise<UploadAssinado> {
    const { client, cfg } = resolverCliente()
    const teto = ttlDefault(cfg, UPLOAD_EXPIRACAO_SEG)
    const ttl = Math.min(
      Math.max(1, Math.floor(expiresInSec ?? teto)),
      UPLOAD_EXPIRACAO_SEG,
    )
    try {
      const signedUrl = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: cfg.bucket, Key: storageRef }),
        { expiresIn: ttl },
      )
      // O frontend faz PUT cru à `signedUrl` e descarta `token` (GOAL 012B §1.7).
      // R2/S3 não emitem token separado — o URL é auto-contido. Mantemos o campo
      // do contrato como string vazia para NÃO quebrar a API (front descarta).
      return Object.freeze({
        storageRef,
        signedUrl,
        token: "",
        expiresInSec: ttl,
      })
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("criarUploadAssinado")
    }
  },

  /**
   * GOAL 012 — sobe o ZIP oficial gerado no servidor (`PutObject`).
   *
   * `PutObject` no R2 sobrescreve o objeto existente — equivalente ao
   * `upsert: true` do desenho 012 §4 (idempotente por path content-addressed).
   */
  async enviarConteudoPrivado(storageRef, conteudo, mime): Promise<void> {
    const { client, cfg } = resolverCliente()
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: storageRef,
          Body: Buffer.from(conteudo),
          ContentType: mime,
        }),
      )
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("enviarConteudoPrivado")
    }
  },

  async obterMetadata(storageRef): Promise<ObjetoMetadata | null> {
    const { client, cfg } = resolverCliente()
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: storageRef }),
      )
      const bytes = out.ContentLength
      const mime = out.ContentType ?? null
      return Object.freeze({
        bytes: typeof bytes === "number" ? bytes : 0,
        mime,
      })
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? ""
      const code = (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode
      if (name === "NotFound" || code === 404) return null
      throw falha("obterMetadata")
    }
  },

  async abrirConteudoPrivado(storageRef): Promise<Buffer> {
    const { client, cfg } = resolverCliente()
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: storageRef }),
      )
      if (!out.Body) throw falha("abrirConteudoPrivado")
      const arrayBuffer = await out.Body.transformToByteArray()
      return Buffer.from(arrayBuffer)
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("abrirConteudoPrivado")
    }
  },

  async criarDownloadAssinado(
    storageRef,
    nomeArquivo,
    expiresInSec,
  ): Promise<DownloadAssinado> {
    const { client, cfg } = resolverCliente()
    const teto = ttlDefault(cfg, DOWNLOAD_EXPIRACAO_SEG)
    // Nunca acima do teto aprovado (300s).
    const expira = Math.min(
      Math.max(1, Math.floor(expiresInSec ?? teto)),
      DOWNLOAD_EXPIRACAO_SEG,
    )
    try {
      const signedUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: cfg.bucket,
          Key: storageRef,
          ResponseContentDisposition: contentDisposition(nomeArquivo),
        }),
        { expiresIn: expira },
      )
      return Object.freeze({ signedUrl, expiresInSec: expira })
    } catch (e) {
      if (e instanceof StorageError) throw e
      throw falha("criarDownloadAssinado")
    }
  },

  async removerObjeto(storageRef): Promise<void> {
    const { client, cfg } = resolverCliente()
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: cfg.bucket, Key: storageRef }),
      )
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