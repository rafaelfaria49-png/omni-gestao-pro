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
import {
  hashCanonico,
  normalizarDecimal,
  ordenarPorChave,
  pseudonimoAtor,
  serializarCanonico,
  sha256Texto,
} from "./canonico"

/**
 * v2 (GOAL 012A) — mudou por DUAS razões estruturais, não cosméticas:
 *
 *  1. **Quebra do ciclo de hashes.** Na v1 o snapshot continha `pacote.manifestoHash`.
 *     Como o snapshot agora vive DENTRO do pacote (`00-FECHAMENTO/snapshot.json`), o
 *     manifesto passa a listar o hash do snapshot — se o snapshot também dependesse do
 *     manifesto, nenhum dos dois poderia ser calculado. O snapshot ficou com os FATOS
 *     CONTÁBEIS; os metadados do pacote (versão, manifestoHash, bytes, arquivos) vivem
 *     no `ContadorPacote` e no evento. Dependência é unidirecional: manifesto → snapshot.
 *  2. **Privacidade do pacote.** `assertPacoteSeguro` proíbe o `storeId` em qualquer
 *     arquivo que não seja o `manifest.json` (regra do 008B). O snapshot perdeu
 *     `competencia.storeId` — que já é redundante: está no manifesto e na própria linha
 *     `ContadorCompetencia`.
 */
export const SNAPSHOT_SCHEMA = "omni.contador.fechamento.snapshot/v2" as const

/** Caminho canônico do snapshot dentro do pacote versionado. */
export const SNAPSHOT_CAMINHO_PACOTE = "00-FECHAMENTO/snapshot.json" as const

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

export type SnapshotFechamentoV2 = Readonly<{
  schemaVersion: typeof SNAPSHOT_SCHEMA
  /** Sem `storeId`: o pacote só admite storeId no `manifest.json` (regra do 008B). */
  competencia: Readonly<{ ano: number; mes: number; codigo: string }>
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
  competencia: Competencia
  versao: number
  fechadaEm: Date
  userId: string
  dados: ContadorDadosReais
  checklist: ChecklistFechamento
  pendenciasAssumidas: readonly string[]
  documentos: readonly DocumentoParaSnapshot[]
}>

/** Monta o snapshot v2. Determinístico: mesma entrada ⇒ mesmo objeto ⇒ mesmo hash. */
export function montarSnapshot(input: MontarSnapshotInput): SnapshotFechamentoV2 {
  const itens = ordenarPorChave(input.checklist.itens, (i) => i.id).map((i) =>
    Object.freeze({ id: i.id, estado: i.estado }),
  )
  const pendencias = [...new Set(input.pendenciasAssumidas.map((p) => String(p).trim()).filter(Boolean))].sort()

  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA,
    competencia: Object.freeze({
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
  })
}

/**
 * Bytes EXATOS do `00-FECHAMENTO/snapshot.json` dentro do pacote.
 *
 * É o JSON canônico puro — **sem** quebra de linha final e **sem** indentação. Essa
 * escolha é o que torna a verificação trivial e à prova de ambiguidade:
 *
 *     sha256(bytes do arquivo no ZIP) === snapshotHash === ContadorPacoteItem.sha256
 *
 * Qualquer "embelezamento" (indentar, acrescentar `\n`) quebraria essa igualdade e
 * transformaria a verificação num exercício de adivinhar a serialização original.
 */
export function serializarSnapshotParaPacote(snapshot: SnapshotFechamentoV2): string {
  return serializarCanonico(snapshot)
}

/** Hash oficial do snapshot — SHA-256 do JSON canônico (= sha256 do arquivo no pacote). */
export function hashSnapshot(snapshot: SnapshotFechamentoV2): string {
  return hashCanonico(snapshot)
}

/**
 * Reconstrói e VERIFICA um snapshot a partir dos bytes preservados no pacote.
 * Devolve `null` quando o conteúdo não corresponde ao hash esperado — prova de
 * adulteração ou de versão de serialização divergente.
 */
export function verificarSnapshotDoPacote(
  conteudo: string,
  hashEsperado: string,
): SnapshotFechamentoV2 | null {
  const bruto = sha256Texto(conteudo)
  if (bruto !== hashEsperado) return null
  try {
    return JSON.parse(conteudo) as SnapshotFechamentoV2
  } catch {
    return null
  }
}
