/**
 * Contador HUB · snapshot oficial do fechamento (GOAL 012 · ADR-001/ADR-004).
 *
 * O snapshot é a fotografia AGREGADA e IMUTÁVEL da competência no instante do
 * fechamento. É o que dá sentido a "fechar": depois dele, qualquer divergência
 * contra os dados vivos é detectável (ver `./divergencia`).
 *
 * O que ENTRA (tudo agregado, tudo determinístico):
 *  - identificação da competência, versão e instante do fechamento;
 *  - totais/contagens dos readers reais (valor + disponibilidade honesta);
 *  - resultado do checklist (estados por item + contagem);
 *  - pendências explicitamente assumidas pelo responsável;
 *  - contagens de documentos por categoria e por status;
 *  - referências de integridade do pacote (versão, manifestoHash, bytes);
 *  - responsável em forma PSEUDÔNIMA.
 *
 * O que NUNCA entra (ADR-001 + ajuste G2-05):
 *  - linha operacional (venda, item, título, movimento) — só agregados;
 *  - PII: nome, CPF, e-mail, telefone, endereço, IMEI, observação livre;
 *  - `storageRef`, URL assinada, token, secret;
 *  - qualquer coleção cuja ordem dependa do banco (tudo é ordenado antes).
 *
 * PURO: recebe dados já carregados; não toca Prisma, storage nem sessão.
 */
import { formatCompetencia, type Competencia } from "@/lib/contador/competencia"
import type { ContadorDadosReais, DisponibilidadeDado } from "@/lib/contador/readers/tipos"
import type { ChecklistFechamento } from "./tipos"
import { hashCanonico, normalizarDecimal, ordenarPorChave, pseudonimoAtor } from "./canonico"

export const SNAPSHOT_SCHEMA = "omni.contador.fechamento.snapshot/v1" as const

/* ───────────────────────────── formato ───────────────────────────── */

/** Métrica agregada: valor normalizado + honestidade da fonte. */
export type MetricaSnapshot = Readonly<{
  valor: number | null
  disponibilidade: DisponibilidadeDado
}>

/**
 * Totais-chave da competência. É EXATAMENTE este subconjunto que a detecção de
 * alteração pós-fechamento compara contra os dados vivos — por isso vive numa
 * função só, usada no fechamento e na comparação.
 */
export type TotaisSnapshot = Readonly<Record<string, MetricaSnapshot>>

export type ContagemDocumentosSnapshot = Readonly<{
  total: number
  /** Chaves ordenadas; categorias sem documento não aparecem. */
  porCategoria: Readonly<Record<string, number>>
  porStatus: Readonly<Record<string, number>>
}>

export type SnapshotFechamentoV1 = Readonly<{
  schemaVersion: typeof SNAPSHOT_SCHEMA
  competencia: Readonly<{ storeId: string; ano: number; mes: number; codigo: string }>
  versao: number
  fechadaEm: string
  /** Pseudônimo do responsável — nunca nome/e-mail (G2-05). */
  responsavel: Readonly<{ tipo: "interno"; id: string }>
  totais: TotaisSnapshot
  checklist: Readonly<{
    contagem: Readonly<Record<string, number>>
    /** Ordenado por `id` — a ordem do checklist não pode influenciar o hash. */
    itens: readonly Readonly<{ id: string; estado: string }>[]
  }>
  /** Ids das pendências assumidas, ordenados e deduplicados. */
  pendenciasAssumidas: readonly string[]
  documentos: ContagemDocumentosSnapshot
  /** Integridade do pacote oficial desta versão. Sem storageRef, sem URL. */
  pacote: Readonly<{ versao: number; manifestoHash: string; bytes: number; arquivos: number }>
}>

/* ───────────────────────────── totais ───────────────────────────── */

function m(d: { valor: number | null; disponibilidade: DisponibilidadeDado }): MetricaSnapshot {
  return Object.freeze({ valor: normalizarDecimal(d.valor), disponibilidade: d.disponibilidade })
}

/**
 * Extrai os totais-chave do DTO dos readers.
 *
 * Fonte ÚNICA da comparação pós-fechamento: se um total novo passar a importar,
 * ele entra aqui e passa a valer nos dois lados (snapshot e dados vivos) de uma vez.
 * `fonte`/`observacao` dos readers ficam de fora de propósito — são texto explicativo
 * que muda sem que o número mude, e fariam o hash oscilar sem divergência real.
 */
export function extrairTotais(dados: ContadorDadosReais): TotaisSnapshot {
  return Object.freeze({
    "vendas.quantidade": m(dados.vendas.quantidade),
    "vendas.total": m(dados.vendas.total),
    "vendas.canceladasQuantidade": m(dados.vendas.canceladasQuantidade),
    "vendas.canceladasTotal": m(dados.vendas.canceladasTotal),
    "devolucoes.quantidade": m(dados.devolucoes.quantidade),
    "devolucoes.total": m(dados.devolucoes.total),
    liquidoCompetencia: m(dados.liquidoCompetencia),
    "financeiro.entradasRealizadas": m(dados.financeiro.entradasRealizadas),
    "financeiro.saidasRealizadas": m(dados.financeiro.saidasRealizadas),
    "financeiro.estornos": m(dados.financeiro.estornos),
    "financeiro.transferencias": m(dados.financeiro.transferencias),
    "financeiro.titulosReceberAberto": m(dados.financeiro.titulosReceberAberto),
    "financeiro.titulosReceberQuantidade": m(dados.financeiro.titulosReceberQuantidade),
    "financeiro.titulosPagarAberto": m(dados.financeiro.titulosPagarAberto),
    "financeiro.titulosPagarQuantidade": m(dados.financeiro.titulosPagarQuantidade),
    "caixa.sessoes": m(dados.caixa.sessoes),
    "caixa.sessoesAbertas": m(dados.caixa.sessoesAbertas),
    "caixa.sangriasTotal": m(dados.caixa.sangriasTotal),
    "caixa.suprimentosTotal": m(dados.caixa.suprimentosTotal),
    "caixa.diferencas": m(dados.caixa.diferencas),
  })
}

/* ───────────────────────────── documentos ───────────────────────────── */

/** Linha mínima de documento necessária para as contagens do snapshot. */
export type DocumentoParaSnapshot = Readonly<{ categoria: string; status: string }>

/** Contagens por categoria/status com chaves ordenadas (independe da ordem do banco). */
export function contarDocumentos(
  docs: readonly DocumentoParaSnapshot[],
): ContagemDocumentosSnapshot {
  const porCategoria: Record<string, number> = {}
  const porStatus: Record<string, number> = {}
  for (const d of docs) {
    const cat = String(d.categoria ?? "").toUpperCase() || "DESCONHECIDA"
    const st = String(d.status ?? "").toUpperCase() || "DESCONHECIDO"
    porCategoria[cat] = (porCategoria[cat] ?? 0) + 1
    porStatus[st] = (porStatus[st] ?? 0) + 1
  }
  return Object.freeze({
    total: docs.length,
    // `canonizar` já ordena chaves no hash; ordenar aqui deixa o JSON legível igual.
    porCategoria: Object.freeze(ordenarChaves(porCategoria)),
    porStatus: Object.freeze(ordenarChaves(porStatus)),
  })
}

function ordenarChaves(r: Record<string, number>): Record<string, number> {
  const saida: Record<string, number> = {}
  for (const k of Object.keys(r).sort()) saida[k] = r[k]
  return saida
}

/* ───────────────────────────── montagem ───────────────────────────── */

export type MontarSnapshotInput = Readonly<{
  storeId: string
  competencia: Competencia
  versao: number
  fechadaEm: Date
  userId: string
  dados: ContadorDadosReais
  checklist: ChecklistFechamento
  pendenciasAssumidas: readonly string[]
  documentos: readonly DocumentoParaSnapshot[]
  pacote: Readonly<{ versao: number; manifestoHash: string; bytes: number; arquivos: number }>
}>

/** Monta o snapshot v1. Determinístico: mesma entrada ⇒ mesmo objeto ⇒ mesmo hash. */
export function montarSnapshot(input: MontarSnapshotInput): SnapshotFechamentoV1 {
  const itens = ordenarPorChave(input.checklist.itens, (i) => i.id).map((i) =>
    Object.freeze({ id: i.id, estado: i.estado }),
  )
  const pendencias = [...new Set(input.pendenciasAssumidas.map((p) => String(p).trim()).filter(Boolean))].sort()

  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA,
    competencia: Object.freeze({
      storeId: input.storeId,
      ano: input.competencia.ano,
      mes: input.competencia.mes,
      codigo: formatCompetencia(input.competencia),
    }),
    versao: input.versao,
    fechadaEm: input.fechadaEm.toISOString(),
    responsavel: Object.freeze({ tipo: "interno" as const, id: pseudonimoAtor(input.userId) }),
    totais: extrairTotais(input.dados),
    checklist: Object.freeze({
      contagem: Object.freeze({ ...input.checklist.contagem }),
      itens: Object.freeze(itens),
    }),
    pendenciasAssumidas: Object.freeze(pendencias),
    documentos: contarDocumentos(input.documentos),
    pacote: Object.freeze({ ...input.pacote }),
  })
}

/** Hash oficial do snapshot — SHA-256 do JSON canônico. */
export function hashSnapshot(snapshot: SnapshotFechamentoV1): string {
  return hashCanonico(snapshot)
}
