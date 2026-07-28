/**
 * Contador HUB · Documentos — contrato (porta) do adapter de storage privado.
 *
 * O service depende SOMENTE desta porta; o adapter real produzivo Cloudflare R2
 * (`storage-r2.ts`, GOAL 012C), o adapter legado Supabase (`storage-supabase.ts`,
 * `@deprecated` — caminho de rollback manual, GOAL 012B §7.1) e o fake de teste
 * a implementam. Nenhum método devolve URL pública permanente: uploads e
 * downloads usam URLs assinadas de curta duração, e `storageRef` é sempre o path
 * privado. Provider-agnostic desde o desenho do GOAL 010.
 */

/** URL assinada de upload direto do navegador ao storage (o binário não passa pela API). */
export type UploadAssinado = Readonly<{
  /** Path privado definitivo do objeto (é o que vira `storageRef`). */
  storageRef: string
  /** URL assinada para o PUT direto do navegador. */
  signedUrl: string
  /**
   * Token de upload. Legado Supabase o devolvia preenchido (`createSignedUploadUrl`).
   * No adapter R2 (S3-compatible) o URL presigned é auto-contido — devolvemos `""`.
   * O frontend faz PUT cru à `signedUrl` e descarta este campo (GOAL 012B §1.7);
   * mantido no contrato para NÃO quebrar a API estável.
   */
  token: string
  /** Validade da autorização de upload, em segundos. */
  expiresInSec: number
}>

/** URL assinada de download (attachment) de curta duração. */
export type DownloadAssinado = Readonly<{
  signedUrl: string
  expiresInSec: number
}>

/** Metadados mínimos do objeto armazenado. */
export type ObjetoMetadata = Readonly<{
  bytes: number
  /** MIME reportado pelo storage (pode ser `null` quando não disponível). */
  mime: string | null
}>

/** Estado do bucket configurado (para o setup/diagnóstico). */
export type BucketEstado = Readonly<{
  existe: boolean
  /** `true` se público; o Contador exige `false`. `null` quando indeterminado. */
  publico: boolean | null
}>

/**
 * Porta de storage privado. Implementada pelo adapter Cloudflare R2 (server-only,
 * `storage-r2.ts`, GOAL 012C); o adapter Supabase (`storage-supabase.ts`) está
 * `@deprecated` e por um fake in-memory nos testes. Erros externos são convertidos
 * em `StorageError`.
 */
export interface StorageDocumentosPort {
  /** Verifica existência e visibilidade do bucket (nunca cria). */
  verificarBucket(): Promise<BucketEstado>
  /** Cria a autorização assinada de upload direto para `storageRef`. `upsert` desabilitado. */
  criarUploadAssinado(storageRef: string, expiresInSec?: number): Promise<UploadAssinado>
  /**
   * Upload SERVER-SIDE de conteúdo já em memória (GOAL 012 — ZIP do pacote oficial).
   *
   * Diferente de `criarUploadAssinado`, aqui o binário é produzido no servidor e nunca
   * passa pelo navegador. `upsert` é habilitado de propósito: o path do pacote é
   * endereçado por conteúdo (`…/{manifestoHash}.zip`), então reescrever é sempre
   * reescrever bytes idênticos — o que torna o retry idempotente em vez de conflitar.
   */
  enviarConteudoPrivado(storageRef: string, conteudo: Uint8Array, mime: string): Promise<void>
  /** Metadados do objeto, ou `null` se não existir. */
  obterMetadata(storageRef: string): Promise<ObjetoMetadata | null>
  /** Baixa o conteúdo privado inteiro para validação/hash server-side. */
  abrirConteudoPrivado(storageRef: string): Promise<Buffer>
  /** Cria URL assinada de download (attachment) com validade curta. */
  criarDownloadAssinado(
    storageRef: string,
    nomeArquivo: string,
    expiresInSec?: number,
  ): Promise<DownloadAssinado>
  /** Remove o objeto (usado só na limpeza pós-validação inválida). */
  removerObjeto(storageRef: string): Promise<void>
  /** `true` se o objeto existe no storage. */
  verificarExistencia(storageRef: string): Promise<boolean>
}

/** Erro externo de storage já convertido — mensagem SEGURA, sem token/URL assinada. */
export class StorageError extends Error {
  readonly code = "STORAGE_ERRO" as const
  readonly operacao: string
  constructor(operacao: string, message: string) {
    super(message)
    this.name = "StorageError"
    this.operacao = operacao
  }
}
