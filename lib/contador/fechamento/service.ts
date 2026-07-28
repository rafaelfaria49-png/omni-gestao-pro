/**
 * Contador HUB · fechamento, reabertura e divergência (GOAL 012 · ADR-004/ADR-005).
 *
 * PURO em relação a IO: depende de três portas injetadas (`repo`, `pacote`, `storage`).
 * A implementação Prisma/Supabase vive em `repo-prisma.ts`; os testes injetam fakes com
 * semântica real de transação e um storage in-memory — a atomicidade verificada é a do
 * código que vai para produção.
 *
 * ORDEM DELIBERADA do fechamento (toda recusa acontece ANTES da primeira escrita):
 *   permissão → confirmação → competência existe → estado permitido → pendências
 *   → gerar pacote → subir ZIP → transação (status + pacote + itens + evento)
 *
 * Storage NÃO participa da transação PostgreSQL. Por isso o `storageRef` é
 * ENDEREÇADO POR CONTEÚDO (`…/v{N}/{manifestoHash}.zip`):
 *  - se a transação falhar depois do upload, o blob fica órfão mas INALCANÇÁVEL — a
 *    aplicação só resolve `storageRef` a partir de uma linha `ContadorPacote` commitada;
 *  - um retry com o mesmo conteúdo reescreve o MESMO path (idempotente), sem duplicar;
 *  - nunca existe competência FECHADA apontando para pacote inexistente, porque o
 *    upload é confirmado antes de a transação começar.
 */
import { randomUUID } from "node:crypto"
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import { serializarManifesto } from "@/lib/contador/pacote/manifest"
import { sha256Hex } from "@/lib/contador/pacote/seguranca"
import type { MontarExtras } from "@/lib/contador/pacote/builder"
import type { PacoteContador } from "@/lib/contador/pacote/tipos"
import type { ContadorScopeInterno } from "@/lib/contador/scope-core"
import type { CapacidadesContador } from "@/lib/contador/status/permissoes"
import { compararTotais, EVENTO_ALTERACAO_POS_FECHAMENTO, type Divergencia } from "./divergencia"
import {
  contarDocumentos,
  extrairTotais,
  hashSnapshot,
  montarSnapshot,
  serializarSnapshotParaPacote,
  SNAPSHOT_CAMINHO_PACOTE,
  type DocumentoParaSnapshot,
  type SnapshotFechamentoV1,
  type TotaisSnapshot,
} from "./snapshot"
import type { ChecklistFechamento } from "./tipos"

/* ───────────────────────────── constantes ───────────────────────────── */

export const EVENTO_COMPETENCIA_FECHADA = "competencia_fechada" as const
export const EVENTO_COMPETENCIA_REABERTA = "competencia_reaberta" as const
export const EVENTO_PACOTE_BAIXADO = "pacote_baixado" as const
export const ORIGEM_FECHAMENTO = "contador.fechamento" as const
export const ALVO_COMPETENCIA = "competencia" as const
export const ATOR_TIPO_INTERNO = "interno" as const
export const VISIBILIDADE_INTERNA = "interna" as const

export const STATUS_FECHADA = "FECHADA" as const
/** Estados a partir dos quais fechar é legítimo (o resto é 409). */
export const STATUS_FECHAVEIS = ["ABERTA", "ENVIADA", "COM_PENDENCIA"] as const

const MOTIVO_MAX = 2000

/* ───────────────────────────── erros tipados ───────────────────────────── */

export class PermissaoFechamentoError extends Error {
  readonly code = "PERMISSAO_FECHAMENTO" as const
  constructor(readonly acao: "fechar" | "reabrir") {
    super("Sua conta não tem permissão para fechar ou reabrir competências.")
    this.name = "PermissaoFechamentoError"
  }
}

export class ConfirmacaoInvalidaError extends Error {
  readonly code = "CONFIRMACAO_INVALIDA" as const
  constructor(readonly esperado: string) {
    super(`Confirmação inválida. Digite exatamente ${esperado} para confirmar.`)
    this.name = "ConfirmacaoInvalidaError"
  }
}

export class CompetenciaJaFechadaError extends Error {
  readonly code = "COMPETENCIA_JA_FECHADA" as const
  constructor() {
    super("Esta competência já está fechada. Reabra antes de fechar de novo.")
    this.name = "CompetenciaJaFechadaError"
  }
}

export class CompetenciaNaoFechadaError extends Error {
  readonly code = "COMPETENCIA_NAO_FECHADA" as const
  constructor() {
    super("Só é possível reabrir uma competência fechada.")
    this.name = "CompetenciaNaoFechadaError"
  }
}

export class PendenciasNaoAssumidasError extends Error {
  readonly code = "PENDENCIAS_NAO_ASSUMIDAS" as const
  constructor(readonly faltantes: readonly string[]) {
    super("Há pendências do checklist que precisam ser assumidas explicitamente para fechar.")
    this.name = "PendenciasNaoAssumidasError"
  }
}

export class PendenciaDesconhecidaError extends Error {
  readonly code = "PENDENCIA_DESCONHECIDA" as const
  constructor(readonly desconhecidas: readonly string[]) {
    super("A lista de pendências assumidas contém itens que não existem no checklist.")
    this.name = "PendenciaDesconhecidaError"
  }
}

export class MotivoReaberturaObrigatorioError extends Error {
  readonly code = "MOTIVO_REABERTURA_OBRIGATORIO" as const
  constructor() {
    super("A reabertura exige um motivo não vazio.")
    this.name = "MotivoReaberturaObrigatorioError"
  }
}

/** Perdeu a corrida: estado/versão mudaram entre a leitura e a escrita. */
export class FechamentoConcorrenteError extends Error {
  readonly code = "FECHAMENTO_CONCORRENTE" as const
  constructor() {
    super("A competência mudou durante a operação. Recarregue e tente de novo.")
    this.name = "FechamentoConcorrenteError"
  }
}

export class CompetenciaNaoEncontradaError extends Error {
  readonly code = "COMPETENCIA_NAO_ENCONTRADA" as const
  constructor() {
    super("Competência não encontrada para esta unidade.")
    this.name = "CompetenciaNaoEncontradaError"
  }
}

export class PacoteNaoEncontradoError extends Error {
  readonly code = "PACOTE_NAO_ENCONTRADO" as const
  constructor() {
    super("Versão de pacote não encontrada para esta competência.")
    this.name = "PacoteNaoEncontradoError"
  }
}

/* ───────────────────────────── tipos de fronteira ───────────────────────────── */

export type EscopoFechamento = Readonly<{ storeId: string; userId: string }>

export type CompetenciaFechamentoRow = {
  id: string
  storeId: string
  ano: number
  mes: number
  status: string
  versao: number
  snapshot: unknown
  snapshotHash: string | null
  fechadaEm: Date | null
  fechadaPorId: string | null
  reabertaEm: Date | null
  updatedAt: Date
}

export type PacoteRow = {
  id: string
  competenciaId: string
  versao: number
  manifestoHash: string
  storageRef: string
  bytes: number
  geradoPorTipo: string
  geradoPorId: string
  geradoEm: Date
}

export type PacoteItemRow = { caminho: string; bytes: number; sha256: string; fonte: string }

export type NovoEventoFechamento = Readonly<{
  storeId: string
  competenciaId: string
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string
  entidadeId: string
  origem: string
  metadata: Record<string, string | number | boolean>
}>

export type NovoComentarioMotivo = Readonly<{
  id: string
  competenciaId: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: string
  texto: string
}>

export type AplicarFechamentoArgs = Readonly<{
  competenciaId: string
  storeId: string
  /** Trava otimista: estado e versão esperados no momento da escrita. */
  statusEsperados: readonly string[]
  versaoEsperada: number
  snapshot: SnapshotFechamentoV1
  snapshotHash: string
  fechadaEm: Date
  fechadaPorId: string
  pacote: Readonly<{
    versao: number
    manifestoHash: string
    storageRef: string
    bytes: number
    geradoPorTipo: string
    geradoPorId: string
    geradoEm: Date
  }>
  itens: readonly PacoteItemRow[]
  evento: NovoEventoFechamento
}>

export type AplicarReaberturaArgs = Readonly<{
  competenciaId: string
  storeId: string
  versaoEsperada: number
  novaVersao: number
  reabertaEm: Date
  reabertaPorId: string
  reabertaMotivo: string
  comentario: NovoComentarioMotivo
  evento: NovoEventoFechamento
}>

/** Porta de persistência. Prisma em produção, fake transacional nos testes. */
export interface FechamentoRepo {
  getOrCreateCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaFechamentoRow>
  acharCompetencia(storeId: string, comp: Competencia): Promise<CompetenciaFechamentoRow | null>
  listarDocumentosParaSnapshot(
    competenciaId: string,
    storeId: string,
  ): Promise<DocumentoParaSnapshot[]>
  /** Atômico: competência + pacote + itens + evento numa única transação. */
  aplicarFechamento(args: AplicarFechamentoArgs): Promise<CompetenciaFechamentoRow>
  /** Atômico: competência + comentário do motivo + evento. */
  aplicarReabertura(args: AplicarReaberturaArgs): Promise<CompetenciaFechamentoRow>
  listarPacotes(competenciaId: string): Promise<PacoteRow[]>
  acharPacote(competenciaId: string, versao: number): Promise<PacoteRow | null>
  listarItensPacote(pacoteId: string): Promise<PacoteItemRow[]>
  /** Cria o evento SÓ se não existir um igual (dedupe por metadata). */
  registrarEventoUnico(
    evento: NovoEventoFechamento,
    dedupe: Readonly<{ competenciaId: string; tipo: string; versao: number; diffHash: string }>,
  ): Promise<{ criado: boolean }>
  registrarEvento(evento: NovoEventoFechamento): Promise<void>
}

/** Porta do gerador de pacote (GOAL 008). */
export interface PacotePort {
  gerar(input: {
    scope: ContadorScopeInterno
    competencia: Competencia
    agora: Date
    /** GOAL 012A — injeta `00-FECHAMENTO/snapshot.json` antes do manifesto. */
    montarExtras?: MontarExtras
  }): Promise<PacoteContador>
}

/** Porta de storage do ZIP oficial (adapter do GOAL 010). */
export interface StoragePacotePort {
  /** Grava (ou sobrescreve com conteúdo idêntico) o ZIP no path determinístico. */
  enviarPacote(storageRef: string, bytes: Uint8Array): Promise<void>
  verificarExistencia(storageRef: string): Promise<boolean>
  criarDownloadAssinado(
    storageRef: string,
    nomeArquivo: string,
    expiresInSec?: number,
  ): Promise<{ signedUrl: string; expiresInSec: number }>
}

export type DepsFechamento = Readonly<{
  repo: FechamentoRepo
  pacote: PacotePort
  storage: StoragePacotePort
}>

/* ───────────────────────────── DTOs ───────────────────────────── */

/** DTO seguro: sem `storageRef`, sem URL assinada, sem secret. */
export type PacoteVersaoDto = Readonly<{
  versao: number
  manifestoHash: string
  bytes: number
  geradoEm: string
  geradoPorTipo: string
  /** Pseudônimo — nunca nome/e-mail. */
  geradoPorId: string
}>

export type EstadoFechamentoDto = Readonly<{
  competencia: string
  competenciaId: string | null
  status: string
  versao: number
  fechada: boolean
  fechadaEm: string | null
  reabertaEm: string | null
  snapshotHash: string | null
  /** Transições que ESTE papel pode executar agora. */
  podeFechar: boolean
  podeReabrir: boolean
  pacotes: readonly PacoteVersaoDto[]
}>

function toPacoteDto(p: PacoteRow): PacoteVersaoDto {
  return Object.freeze({
    versao: p.versao,
    manifestoHash: p.manifestoHash,
    bytes: p.bytes,
    geradoEm: p.geradoEm.toISOString(),
    geradoPorTipo: p.geradoPorTipo,
    geradoPorId: p.geradoPorId,
  })
}

/* ───────────────────────────── consulta de estado ───────────────────────────── */

/** Estado de fechamento da competência. SOMENTE LEITURA — não cria competência. */
export async function carregarEstadoFechamento(
  escopo: EscopoFechamento,
  capacidades: CapacidadesContador,
  comp: Competencia,
  deps: Pick<DepsFechamento, "repo">,
): Promise<EstadoFechamentoDto> {
  const codigo = formatCompetencia(comp)
  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) {
    return Object.freeze({
      competencia: codigo,
      competenciaId: null,
      status: "ABERTA",
      versao: 1,
      fechada: false,
      fechadaEm: null,
      reabertaEm: null,
      snapshotHash: null,
      podeFechar: capacidades.podeConferir,
      podeReabrir: false,
      pacotes: Object.freeze([]),
    })
  }

  const pacotes = await deps.repo.listarPacotes(competencia.id)
  const fechada = competencia.status === STATUS_FECHADA
  return Object.freeze({
    competencia: codigo,
    competenciaId: competencia.id,
    status: competencia.status,
    versao: competencia.versao,
    fechada,
    fechadaEm: competencia.fechadaEm ? competencia.fechadaEm.toISOString() : null,
    reabertaEm: competencia.reabertaEm ? competencia.reabertaEm.toISOString() : null,
    snapshotHash: competencia.snapshotHash,
    podeFechar: capacidades.podeConferir && !fechada,
    podeReabrir: capacidades.podeConferir && fechada,
    pacotes: Object.freeze(
      [...pacotes].sort((a, b) => a.versao - b.versao).map(toPacoteDto),
    ),
  })
}

/* ───────────────────────────── fechamento ───────────────────────────── */

export type EntradaFechamento = Readonly<{
  confirmacao: unknown
  pendenciasAssumidas?: unknown
}>

export type ResultadoFechamento = Readonly<{
  competencia: string
  versao: number
  status: string
  fechadaEm: string
  snapshotHash: string
  pacote: PacoteVersaoDto
}>

/**
 * Fecha a competência da loja ativa.
 *
 * `scope` nominal é exigido porque o gerador de pacote (GOAL 008) só aceita o escopo
 * validado pelo gate server-side — loja/usuário nunca chegam do cliente.
 */
export async function fecharCompetencia(
  scope: ContadorScopeInterno,
  capacidades: CapacidadesContador,
  comp: Competencia,
  entrada: EntradaFechamento,
  deps: DepsFechamento,
  agora: Date = new Date(),
): Promise<ResultadoFechamento> {
  if (!capacidades.podeConferir) throw new PermissaoFechamentoError("fechar")

  const codigo = formatCompetencia(comp)
  exigirConfirmacao(entrada.confirmacao, codigo)

  const competencia = await deps.repo.getOrCreateCompetencia(scope.storeId, comp)
  if (competencia.status === STATUS_FECHADA) throw new CompetenciaJaFechadaError()
  if (!(STATUS_FECHAVEIS as readonly string[]).includes(competencia.status)) {
    throw new FechamentoConcorrenteError()
  }

  const versao = competencia.versao
  const assumidas = normalizarPendencias(entrada.pendenciasAssumidas)
  // Acervo lido ANTES da geração: o snapshot precisa entrar DENTRO do pacote.
  const documentos = await deps.repo.listarDocumentosParaSnapshot(competencia.id, scope.storeId)

  // O snapshot é montado por callback, a partir da MESMA carga do pacote, e devolvido
  // como `00-FECHAMENTO/snapshot.json`. Ordem das dependências (acíclica):
  //   dados/checklist → snapshot → snapshot.json → manifesto → manifestoHash
  // O snapshot NUNCA lê o manifesto; por isso perdeu o bloco `pacote` da v1.
  let snapshot: SnapshotFechamentoV1 | null = null
  let snapshotHash = ""

  const pacote = await deps.pacote.gerar({
    scope,
    competencia: comp,
    agora,
    montarExtras: ({ dados, checklist }) => {
      // Recusa cedo: aborta antes de compactar, sem escrita nenhuma.
      validarPendencias(checklist, assumidas)
      snapshot = montarSnapshot({
        competencia: comp,
        versao,
        fechadaEm: agora,
        userId: scope.userId,
        dados,
        checklist,
        pendenciasAssumidas: assumidas,
        documentos,
      })
      snapshotHash = hashSnapshot(snapshot)
      return {
        arquivos: [
          {
            caminho: SNAPSHOT_CAMINHO_PACOTE,
            categoria: "snapshot",
            fonte: "fechamento",
            descricao: "Snapshot canônico e imutável desta versão do fechamento.",
            // Bytes EXATOS do JSON canônico: sha256(arquivo) === snapshotHash.
            conteudo: serializarSnapshotParaPacote(snapshot),
          },
        ],
        snapshotHash,
      }
    },
  })

  if (!snapshot) throw new FechamentoConcorrenteError()

  const manifestoSerializado = serializarManifesto(pacote.manifesto)
  const manifestoHash = sha256Hex(manifestoSerializado)
  const storageRef = montarStorageRefPacote(scope.storeId, codigo, versao, manifestoHash)

  // Upload ANTES da transação (storage não é transacional). Path endereçado por
  // conteúdo ⇒ retry idempotente; blob órfão de transação falha fica inalcançável.
  await deps.storage.enviarPacote(storageRef, pacote.bytes)

  const atualizada = await deps.repo.aplicarFechamento({
    competenciaId: competencia.id,
    storeId: scope.storeId,
    statusEsperados: STATUS_FECHAVEIS,
    versaoEsperada: versao,
    snapshot,
    snapshotHash,
    fechadaEm: agora,
    fechadaPorId: scope.userId,
    pacote: {
      versao,
      manifestoHash,
      storageRef,
      bytes: pacote.bytes.byteLength,
      geradoPorTipo: ATOR_TIPO_INTERNO,
      geradoPorId: pacote.manifesto.geradoPor.id,
      geradoEm: agora,
    },
    itens: pacote.manifesto.arquivos.map((a) => ({
      caminho: a.caminho,
      bytes: a.bytes,
      sha256: a.sha256,
      fonte: a.fonte,
    })),
    evento: {
      storeId: scope.storeId,
      competenciaId: competencia.id,
      tipo: EVENTO_COMPETENCIA_FECHADA,
      atorTipo: ATOR_TIPO_INTERNO,
      atorId: scope.userId,
      entidade: ALVO_COMPETENCIA,
      entidadeId: competencia.id,
      origem: ORIGEM_FECHAMENTO,
      // Metadata SANEADA: só ponteiros de integridade e contagens (G2-05).
      metadata: {
        competencia: codigo,
        versao,
        snapshotHash,
        manifestoHash,
        pacoteBytes: pacote.bytes.byteLength,
        arquivos: pacote.manifesto.arquivos.length,
        pendenciasAssumidas: assumidas.length,
      },
    },
  })

  return Object.freeze({
    competencia: codigo,
    versao,
    status: atualizada.status,
    fechadaEm: (atualizada.fechadaEm ?? agora).toISOString(),
    snapshotHash,
    pacote: Object.freeze({
      versao,
      manifestoHash,
      bytes: pacote.bytes.byteLength,
      geradoEm: agora.toISOString(),
      geradoPorTipo: ATOR_TIPO_INTERNO,
      geradoPorId: pacote.manifesto.geradoPor.id,
    }),
  })
}

/* ───────────────────────────── reabertura ───────────────────────────── */

export type EntradaReabertura = Readonly<{
  confirmacao: unknown
  motivo: unknown
}>

export type ResultadoReabertura = Readonly<{
  competencia: string
  status: string
  versaoAnterior: number
  versao: number
  reabertaEm: string
}>

/**
 * Reabre a competência fechada, incrementando a versão.
 *
 * Preserva pacote, snapshot e eventos anteriores — a reabertura é uma transição
 * auditada, nunca um desfazer. O motivo vira comentário interno imutável (precedente
 * do GOAL 011) e o evento guarda só o ponteiro + tamanho.
 */
export async function reabrirCompetencia(
  escopo: EscopoFechamento,
  capacidades: CapacidadesContador,
  comp: Competencia,
  entrada: EntradaReabertura,
  deps: Pick<DepsFechamento, "repo">,
  agora: Date = new Date(),
  novoId: () => string = gerarIdComentario,
): Promise<ResultadoReabertura> {
  if (!capacidades.podeConferir) throw new PermissaoFechamentoError("reabrir")

  const codigo = formatCompetencia(comp)
  exigirConfirmacao(entrada.confirmacao, codigo)

  const motivo = normalizarMotivo(entrada.motivo)
  if (!motivo) throw new MotivoReaberturaObrigatorioError()

  const competencia = await deps.repo.acharCompetencia(escopo.storeId, comp)
  if (!competencia) throw new CompetenciaNaoEncontradaError()
  if (competencia.status !== STATUS_FECHADA) throw new CompetenciaNaoFechadaError()

  const versaoAnterior = competencia.versao
  const novaVersao = versaoAnterior + 1
  const comentarioId = novoId()

  const atualizada = await deps.repo.aplicarReabertura({
    competenciaId: competencia.id,
    storeId: escopo.storeId,
    versaoEsperada: versaoAnterior,
    novaVersao,
    reabertaEm: agora,
    reabertaPorId: escopo.userId,
    reabertaMotivo: motivo,
    comentario: {
      id: comentarioId,
      competenciaId: competencia.id,
      documentoId: null,
      autorTipo: ATOR_TIPO_INTERNO,
      autorId: escopo.userId,
      visibilidade: VISIBILIDADE_INTERNA,
      texto: motivo,
    },
    evento: {
      storeId: escopo.storeId,
      competenciaId: competencia.id,
      tipo: EVENTO_COMPETENCIA_REABERTA,
      atorTipo: ATOR_TIPO_INTERNO,
      atorId: escopo.userId,
      entidade: ALVO_COMPETENCIA,
      entidadeId: competencia.id,
      origem: ORIGEM_FECHAMENTO,
      // Sem texto livre: só ponteiro para o comentário + tamanho (G2-05).
      metadata: {
        competencia: codigo,
        versaoAnterior,
        versao: novaVersao,
        motivoComentarioId: comentarioId,
        motivoLen: motivo.length,
      },
    },
  })

  return Object.freeze({
    competencia: codigo,
    status: atualizada.status,
    versaoAnterior,
    versao: novaVersao,
    reabertaEm: (atualizada.reabertaEm ?? agora).toISOString(),
  })
}

/* ───────────────────────────── divergência ───────────────────────────── */

export type ResultadoDivergencia = Readonly<{
  competencia: string
  versao: number
  aplicavel: boolean
  divergencia: Divergencia | null
  aviso: string | null
}>

/**
 * Compara o snapshot vigente com os dados vivos. SOMENTE LEITURA — nada é gravado
 * aqui, nem sequer o evento; persistir é decisão de `registrarDivergencia`.
 */
export function avaliarDivergencia(
  competencia: CompetenciaFechamentoRow,
  totaisVivos: TotaisSnapshot,
): Divergencia | null {
  if (competencia.status !== STATUS_FECHADA) return null
  const snap = competencia.snapshot as SnapshotFechamentoV1 | null
  if (!snap || typeof snap !== "object" || !snap.totais) return null
  return compararTotais(snap.totais, totaisVivos)
}

/** Extrai os totais vivos a partir do DTO dos readers (mesma função do snapshot). */
export { extrairTotais }

/**
 * Persiste o evento de alteração pós-fechamento — SÓ por POST explícito.
 * Idempotente: dedupe por (competenciaId, versao, diffHash), então repetir o mesmo
 * diff não cria um segundo evento.
 */
export async function registrarDivergencia(
  escopo: EscopoFechamento,
  comp: Competencia,
  competencia: CompetenciaFechamentoRow,
  divergencia: Divergencia,
  deps: Pick<DepsFechamento, "repo">,
): Promise<{ criado: boolean }> {
  if (!divergencia.divergente) return { criado: false }

  return deps.repo.registrarEventoUnico(
    {
      storeId: escopo.storeId,
      competenciaId: competencia.id,
      tipo: EVENTO_ALTERACAO_POS_FECHAMENTO,
      atorTipo: ATOR_TIPO_INTERNO,
      atorId: escopo.userId,
      entidade: ALVO_COMPETENCIA,
      entidadeId: competencia.id,
      origem: ORIGEM_FECHAMENTO,
      metadata: {
        competencia: formatCompetencia(comp),
        versao: competencia.versao,
        diffHash: divergencia.diffHash,
        metricas: divergencia.itens.length,
      },
    },
    {
      competenciaId: competencia.id,
      tipo: EVENTO_ALTERACAO_POS_FECHAMENTO,
      versao: competencia.versao,
      diffHash: divergencia.diffHash,
    },
  )
}

/* ───────────────────────────── internos ───────────────────────────── */

/**
 * Path determinístico e endereçado por conteúdo do ZIP oficial.
 * `manifestoHash` no nome garante que o MESMO pacote sempre ocupe o MESMO objeto.
 */
export function montarStorageRefPacote(
  storeId: string,
  codigoCompetencia: string,
  versao: number,
  manifestoHash: string,
): string {
  return `contador/${storeId}/${codigoCompetencia}/pacotes/v${versao}/${manifestoHash}.zip`
}

function exigirConfirmacao(valor: unknown, esperado: string): void {
  const v = typeof valor === "string" ? valor.trim() : ""
  if (v !== esperado) throw new ConfirmacaoInvalidaError(esperado)
}

function normalizarMotivo(valor: unknown): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  return t.length > MOTIVO_MAX ? t.slice(0, MOTIVO_MAX) : t
}

function normalizarPendencias(valor: unknown): readonly string[] {
  if (!Array.isArray(valor)) return []
  const ids = valor
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v): v is string => v.length > 0)
  return [...new Set(ids)].sort()
}

/**
 * Todo item do checklist que NÃO está `ok` precisa ser assumido explicitamente.
 * É o que dá sentido ao modal: fechar com pendência é uma decisão registrada, nunca
 * um efeito colateral silencioso.
 */
export function validarPendencias(
  checklist: ChecklistFechamento,
  assumidas: readonly string[],
): void {
  const idsChecklist = new Set(checklist.itens.map((i) => i.id))
  const desconhecidas = assumidas.filter((id) => !idsChecklist.has(id))
  if (desconhecidas.length > 0) throw new PendenciaDesconhecidaError(desconhecidas)

  const exigidas = checklist.itens.filter((i) => i.estado !== "ok").map((i) => i.id)
  const assumidasSet = new Set(assumidas)
  const faltantes = exigidas.filter((id) => !assumidasSet.has(id)).sort()
  if (faltantes.length > 0) throw new PendenciasNaoAssumidasError(faltantes)
}

/** Ids de pendência que o cliente precisa assumir para fechar (alimenta o modal). */
export function pendenciasExigidas(checklist: ChecklistFechamento): readonly string[] {
  return Object.freeze(
    checklist.itens
      .filter((i) => i.estado !== "ok")
      .map((i) => i.id)
      .sort(),
  )
}

/** Id do comentário do motivo — injetável nos testes para evento determinístico. */
function gerarIdComentario(): string {
  return `cmt-${randomUUID()}`
}

export { contarDocumentos }
