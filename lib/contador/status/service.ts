/**
 * Contador HUB · serviço de transição de status (GOAL 011).
 *
 * PURO em relação a IO: depende de uma única porta injetada (`StatusRepo`). A
 * implementação Prisma vive em `repo-prisma.ts`; os testes injetam um cliente fake
 * com semântica real de transação (commit/rollback) — assim regra e atomicidade são
 * testáveis sem banco.
 *
 * Escreve SOMENTE em `ContadorDocumento.status`, `ContadorComentario` (motivo da
 * rejeição) e `ContadorEvento`. Nunca toca Financeiro, PDV, Operações ou Fiscal.
 *
 * Invariantes:
 *  - escopo (loja) e ator vêm do servidor; o cliente informa apenas `documentoId`,
 *    `para` e `motivo`;
 *  - transição fora da matriz → erro tipado, zero escrita;
 *  - rejeição sem motivo → erro tipado ANTES de qualquer escrita;
 *  - status e evento nascem na MESMA transação (nunca evento órfão, nunca status
 *    alterado sem trilha).
 */
import { randomUUID } from "node:crypto"
import { formatCompetencia } from "@/lib/contador/competencia"
import {
  DocumentoNaoEncontradoError,
  CompetenciaFechadaError,
} from "@/lib/contador/documentos/service"
import {
  MotivoObrigatorioError,
  PermissaoTransicaoError,
  normalizarStatus,
  resolverTransicao,
  transicoesDisponiveis,
  type AcaoTransicao,
  type StatusItem,
  type Transicao,
} from "./matriz"
import { estaVencido } from "./vencido"
import type { CapacidadesContador } from "./permissoes"

/* ───────────────────────────── constantes de domínio ───────────────────────────── */

export const EVENTO_STATUS_ALTERADO = "status_alterado" as const
export const ORIGEM_STATUS = "contador.status" as const
/** Alvo da transição neste GOAL (obrigações/guias entram no GOAL 016). */
export const ALVO_DOCUMENTO = "documento" as const
/** Quem opera pelo HUB interno é sempre parte interna (lojista/equipe). */
export const ATOR_TIPO_INTERNO = "interno" as const
/** O motivo da rejeição nasce como comentário INTERNO — nunca vai ao portal externo. */
export const VISIBILIDADE_INTERNA = "interna" as const

const STATUS_COMPETENCIA_FECHADA = "FECHADA"
const MOTIVO_MAX = 2000

/* ───────────────────────────── tipos de fronteira ───────────────────────────── */

/** Escopo mínimo — produzido pelo gate server-side, nunca pelo cliente. */
export type EscopoStatus = Readonly<{ storeId: string; userId: string }>

/** Projeção do documento suficiente para decidir e responder a transição. */
export type DocumentoStatusRow = {
  id: string
  competenciaId: string
  storeId: string
  titulo: string
  categoria: string
  status: string
  vencimento: Date | null
  excluidoEm: Date | null
  updatedAt: Date
  /** Status da competência dona — bloqueia transição em competência fechada. */
  competenciaStatus: string
  competenciaAno: number
  competenciaMes: number
}

export type NovoEventoStatus = Readonly<{
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
  documentoId: string
  autorTipo: string
  autorId: string
  visibilidade: string
  texto: string
}>

export type AplicarTransicaoArgs = Readonly<{
  documentoId: string
  storeId: string
  /** Estado esperado — a escrita só ocorre se o documento ainda estiver nele. */
  de: StatusItem
  para: StatusItem
  comentario: NovoComentarioMotivo | null
  evento: NovoEventoStatus
}>

/** Porta de persistência — Prisma em produção, fake com rollback nos testes. */
export interface StatusRepo {
  acharDocumentoParaTransicao(id: string, storeId: string): Promise<DocumentoStatusRow | null>
  /** Atômico: status + (comentário) + evento numa única transação. */
  aplicarTransicao(args: AplicarTransicaoArgs): Promise<DocumentoStatusRow>
}

export type DepsStatus = Readonly<{ repo: StatusRepo }>

/** DTO seguro para a UI — sem `storageRef`, sem caminho de storage, sem PII extra. */
export type DocumentoStatusDto = Readonly<{
  id: string
  competenciaId: string
  competencia: string
  titulo: string
  categoria: string
  status: StatusItem
  vencido: boolean
  vencimento: string | null
  atualizadoEm: string
  /** Transições que ESTE papel pode executar agora (a UI não inventa botões). */
  transicoes: readonly Readonly<{
    para: StatusItem
    acao: AcaoTransicao
    rotulo: string
    exigeMotivo: boolean
  }>[]
}>

export type EntradaTransicao = Readonly<{
  documentoId: unknown
  para: unknown
  motivo?: unknown
}>

/* ───────────────────────────── caso de uso ───────────────────────────── */

/**
 * Altera o status de um documento da loja ativa.
 *
 * Ordem deliberada: escopo → existência → competência aberta → matriz → motivo →
 * permissão → escrita atômica. Toda recusa acontece ANTES da primeira escrita.
 */
export async function alterarStatusDocumento(
  escopo: EscopoStatus,
  capacidades: CapacidadesContador,
  entrada: EntradaTransicao,
  deps: DepsStatus,
  agora: Date = new Date(),
): Promise<DocumentoStatusDto> {
  const documentoId = String(entrada.documentoId ?? "").trim()
  if (!documentoId) throw new DocumentoNaoEncontradoError()

  // `para` é validado ANTES da busca: entrada lixo não vira consulta ao banco.
  const para = normalizarStatus(entrada.para)

  // Escopo por loja resolvido no servidor: documento de outra loja simplesmente
  // não existe para este escopo (404, não 403 — não confirma existência alheia).
  const doc = await deps.repo.acharDocumentoParaTransicao(documentoId, escopo.storeId)
  if (!doc || doc.excluidoEm) throw new DocumentoNaoEncontradoError()
  if (doc.competenciaStatus === STATUS_COMPETENCIA_FECHADA) throw new CompetenciaFechadaError()

  const de = normalizarStatus(doc.status)
  const transicao = resolverTransicao(de, para)

  const motivo = normalizarMotivo(entrada.motivo)
  if (transicao.exigeMotivo && !motivo) throw new MotivoObrigatorioError()

  if (transicao.exigePapelElevado && !capacidades.podeConferir) {
    throw new PermissaoTransicaoError(transicao.acao)
  }

  const competencia = formatCompetencia({ ano: doc.competenciaAno, mes: doc.competenciaMes })
  const comentario = montarComentarioMotivo(escopo, doc, transicao, motivo)

  const atualizado = await deps.repo.aplicarTransicao({
    documentoId,
    storeId: escopo.storeId,
    de,
    para,
    comentario,
    evento: {
      storeId: escopo.storeId,
      competenciaId: doc.competenciaId,
      tipo: EVENTO_STATUS_ALTERADO,
      atorTipo: ATOR_TIPO_INTERNO,
      atorId: escopo.userId,
      entidade: ALVO_DOCUMENTO,
      entidadeId: documentoId,
      origem: ORIGEM_STATUS,
      // Metadata SANEADA (ajuste G2-05): o texto do motivo vive no comentário
      // append-only; aqui só ficam o ponteiro e o tamanho — nunca o texto livre.
      metadata: {
        statusAnterior: de,
        statusNovo: para,
        acao: transicao.acao,
        competencia,
        ...(comentario ? { motivoComentarioId: comentario.id, motivoLen: comentario.texto.length } : {}),
      },
    },
  })

  return toStatusDto(atualizado, capacidades, agora)
}

/* ───────────────────────────── projeção ───────────────────────────── */

export function toStatusDto(
  row: DocumentoStatusRow,
  capacidades: CapacidadesContador,
  agora: Date = new Date(),
): DocumentoStatusDto {
  const status = normalizarStatus(row.status)
  return Object.freeze({
    id: row.id,
    competenciaId: row.competenciaId,
    competencia: formatCompetencia({ ano: row.competenciaAno, mes: row.competenciaMes }),
    titulo: row.titulo,
    categoria: row.categoria,
    status,
    vencido: estaVencido({ status, vencimento: row.vencimento }, agora),
    vencimento: row.vencimento ? row.vencimento.toISOString() : null,
    atualizadoEm: row.updatedAt.toISOString(),
    transicoes: Object.freeze(
      transicoesDisponiveis(status, capacidades).map((t) =>
        Object.freeze({ para: t.para, acao: t.acao, rotulo: t.rotulo, exigeMotivo: t.exigeMotivo }),
      ),
    ),
  })
}

/* ───────────────────────────── internos ───────────────────────────── */

function normalizarMotivo(valor: unknown): string {
  const t = typeof valor === "string" ? valor.trim() : ""
  return t.length > MOTIVO_MAX ? t.slice(0, MOTIVO_MAX) : t
}

/** Rejeição materializa o motivo como comentário interno imutável (ADR-005). */
function montarComentarioMotivo(
  escopo: EscopoStatus,
  doc: DocumentoStatusRow,
  transicao: Transicao,
  motivo: string,
): NovoComentarioMotivo | null {
  if (!transicao.exigeMotivo || !motivo) return null
  return Object.freeze({
    id: `cmt-${randomUUID()}`,
    competenciaId: doc.competenciaId,
    documentoId: doc.id,
    autorTipo: ATOR_TIPO_INTERNO,
    autorId: escopo.userId,
    visibilidade: VISIBILIDADE_INTERNA,
    texto: motivo,
  })
}
