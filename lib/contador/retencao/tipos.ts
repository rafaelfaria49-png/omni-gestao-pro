/**
 * Contador HUB · Retenção — contratos (portas e relatório) — GOAL 019.
 *
 * A separação em DUAS portas é o mecanismo que torna o dry-run verificável: a porta
 * de LEITURA não tem um único método que escreva, e a porta de ESCRITA é OPCIONAL
 * nas dependências do job. Em dry-run o job nem sequer recebe a porta de escrita, de
 * modo que "dry-run não altera nada" não é uma promessa de comentário — é a ausência
 * do objeto capaz de alterar.
 */
import type { CategoriaDocumentoRetencao } from "./politica"

/** Modo de operação. `dry-run` é o default em todo ponto de entrada. */
export type ModoRetencao = "dry-run" | "apply"

/** Alvos da política. Um alvo é uma classe de artefato, não uma tabela. */
export type AlvoRetencao = "documentos" | "blobs_soft_deletados" | "pacotes"

/**
 * Linha mínima de um candidato. Deliberadamente estreita: só o que a política e a
 * remoção precisam. NÃO carrega título, nome de arquivo, motivo de exclusão nem
 * qualquer campo textual do usuário — nada disso sai do banco por este caminho.
 */
export type CandidatoRetencao = Readonly<{
  /** Id do registro (`ContadorDocumento.id` ou `ContadorPacote.id`). */
  id: string
  storeId: string
  /** Competência do item — usada para o evento de auditoria. */
  competenciaId: string
  /** Caminho privado do blob. Nunca vai para log nem para label de métrica. */
  storageRef: string
  bytes: number
  /** Presente apenas no alvo `documentos` / `blobs_soft_deletados`. */
  categoria?: CategoriaDocumentoRetencao
  /** Presente apenas no alvo `pacotes`. */
  versao?: number
}>

/**
 * Porta SOMENTE LEITURA. Toda consulta é escopada por `storeId` (CORE_RULES §11):
 * não existe assinatura capaz de varrer o banco inteiro.
 */
export interface RetencaoLeituraPort {
  /** Documentos vivos (não soft-deletados) além da janela da categoria. */
  documentosAlemDaRetencao(args: {
    storeId: string
    categoria: CategoriaDocumentoRetencao
    corte: Date
  }): Promise<readonly CandidatoRetencao[]>

  /** Documentos vivos protegidos pela política, por categoria (só contagem). */
  contarDocumentosProtegidos(args: {
    storeId: string
    categoria: CategoriaDocumentoRetencao
    corte: Date | null
  }): Promise<number>

  /** Documentos soft-deletados com `excluidoEm` além da janela de 90 dias. */
  blobsSoftDeletadosAlemDaRetencao(args: {
    storeId: string
    corte: Date
  }): Promise<readonly CandidatoRetencao[]>

  /** Soft-deletados ainda dentro dos 90 dias (protegidos). */
  contarBlobsSoftDeletadosProtegidos(args: { storeId: string; corte: Date }): Promise<number>

  /** Pacotes gerados antes do corte de 12 meses. */
  pacotesAlemDaRetencao(args: { storeId: string; corte: Date }): Promise<readonly CandidatoRetencao[]>

  /** Pacotes ainda dentro dos 12 meses (protegidos). */
  contarPacotesProtegidos(args: { storeId: string; corte: Date }): Promise<number>
}

/** Evento de auditoria emitido por um descarte efetivo (somente no modo apply). */
export type EventoDescarte = Readonly<{
  storeId: string
  competenciaId: string
  tipo: string
  entidade: string
  entidadeId: string
  /** Metadata SANEADA: sem storageRef, sem nome, sem URL. */
  metadata: Readonly<Record<string, string | number>>
}>

/**
 * Porta de ESCRITA. Só o modo apply a recebe. Note o que ela NÃO tem: nenhum método
 * que apague linha de `ContadorDocumento`, `ContadorPacote`, `ContadorPacoteItem`,
 * `ContadorEvento` ou o snapshot da competência. O descarte é do BLOB, e só.
 */
export interface RetencaoEscritaPort {
  /** `true` se o objeto ainda existe no storage. É o marcador de idempotência. */
  blobExiste(storageRef: string): Promise<boolean>
  /** Remove o objeto do storage. Só é chamado quando `blobExiste` respondeu `true`. */
  removerBlob(storageRef: string): Promise<void>
  /** Anexa UM evento à trilha append-only. Nunca edita nem remove evento existente. */
  registrarEventoDescarte(evento: EventoDescarte): Promise<void>
}

/** Falha isolada — não interrompe o job, entra no relatório. */
export type FalhaRetencao = Readonly<{
  alvo: AlvoRetencao
  /** Rótulo técnico curto, nunca a mensagem crua do provider. */
  motivo: string
  /** Id do registro afetado (`null` quando a falha é da leitura do lote). */
  registroId: string | null
  storeId: string
}>

/** Resumo de um alvo. `descartados`, `jaAusentes` e `falhas` são 0 em dry-run. */
export type ResumoAlvoRetencao = Readonly<{
  alvo: AlvoRetencao
  candidatos: number
  bytesCandidatos: number
  protegidos: number
  /** Contagem por categoria (só nos alvos de documento). */
  porCategoria: Readonly<Record<string, number>>
  descartados: number
  /** Blob que já não existia — idempotência, não erro. */
  jaAusentes: number
  falhas: number
}>

/** Relatório completo de uma execução. Serializável e livre de PII/storageRef. */
export type RelatorioRetencao = Readonly<{
  modo: ModoRetencao
  executadoEm: string
  /** Lojas efetivamente varridas nesta execução. */
  lojas: readonly string[]
  /** Corte por categoria; `null` = PURGE_DISABLED (sem corte, por decisão). */
  cortesDocumentos: Readonly<Record<string, string | null>>
  cortePacotes: string
  corteBlobsSoftDeletados: string
  documentos: ResumoAlvoRetencao
  blobsSoftDeletados: ResumoAlvoRetencao
  pacotes: ResumoAlvoRetencao
  /** Soma dos bytes dos candidatos — liberação ESTIMADA, nunca confirmada. */
  bytesEstimadosLiberados: number
  /** Itens protegidos pela política em todos os alvos. */
  protegidosPorPolitica: number
  erros: readonly FalhaRetencao[]
}>
