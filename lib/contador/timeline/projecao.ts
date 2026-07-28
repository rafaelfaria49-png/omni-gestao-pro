/**
 * Contador HUB · projeção da timeline (GOAL 011).
 *
 * PURA e SOMENTE LEITURA: combina `ContadorEvento` (trilha append-only) com
 * `ContadorComentario` numa lista única, ordenada de forma determinística.
 *
 * O DTO é a fronteira de segurança da timeline. Ele NUNCA carrega:
 *  - `storageRef` / caminho interno do storage;
 *  - URL assinada ou permanente;
 *  - token, secret, cookie, stack;
 *  - metadata bruta do evento (só chaves de uma ALLOWLIST explícita);
 *  - comentário `interna` quando o contexto é `compartilhado`;
 *  - dado de outra loja (o escopo é resolvido antes, na consulta).
 *
 * Ordem: `em` DESC (mais recente primeiro) com desempate estável por `id`
 * composto (`evento:<id>` / `comentario:<id>`), que é único e imutável — dois
 * registros no mesmo milissegundo saem sempre na mesma ordem.
 */
import type { ContextoLeitura, Visibilidade } from "@/lib/contador/comentarios/service"

/* ───────────────────────────── entrada ───────────────────────────── */

export type EventoTimeline = Readonly<{
  id: string
  tipo: string
  atorTipo: string
  atorId: string
  entidade: string | null
  entidadeId: string | null
  origem: string | null
  metadata: unknown
  createdAt: Date
}>

export type ComentarioTimeline = Readonly<{
  id: string
  documentoId: string | null
  autorTipo: string
  autorId: string
  visibilidade: string
  texto: string
  createdAt: Date
}>

/* ───────────────────────────── saída ───────────────────────────── */

export type TimelineOrigem = "evento" | "comentario"

export type TimelineItemDto = Readonly<{
  /** Chave estável e única na lista (`evento:<id>` / `comentario:<id>`). */
  id: string
  origem: TimelineOrigem
  /** Tipo do evento, ou `comentario` para comentários. */
  tipo: string
  em: string
  atorTipo: string
  atorId: string
  /** Alvo do evento (`documento`, `comentario`, …). Comentário: `documento` ou null. */
  entidade: string | null
  entidadeId: string | null
  /** Só comentários. */
  visibilidade: Visibilidade | null
  texto: string | null
  /** Subconjunto SANEADO da metadata do evento (allowlist + primitivos). */
  detalhes: Readonly<Record<string, string | number | boolean>>
}>

export type TimelineDto = Readonly<{
  contexto: ContextoLeitura
  total: number
  itens: readonly TimelineItemDto[]
}>

/**
 * ALLOWLIST de chaves de `ContadorEvento.metadata` que podem sair no DTO.
 * Nada fora desta lista é projetado — chave nova só aparece se for adicionada aqui
 * de propósito, depois de avaliada quanto a PII/segredo.
 */
export const METADATA_PERMITIDA: readonly string[] = Object.freeze([
  "acao",
  "ano",
  "bytes",
  "categoria",
  "competencia",
  "documentoId",
  "mes",
  "mime",
  "motivoComentarioId",
  "motivoLen",
  "statusAnterior",
  "statusNovo",
  "substituiu",
  "textoLen",
  "visibilidade",
])

const CHAVES_PROIBIDAS = /(^|[._-])(url|token|secret|senha|password|assinad|signed|path|ref|stack|cookie|authorization|storage)/i

const TIPO_COMENTARIO = "comentario" as const

export type EntradaProjecao = Readonly<{
  eventos: readonly EventoTimeline[]
  comentarios: readonly ComentarioTimeline[]
  contexto: ContextoLeitura
  /** Corte de tamanho aplicado DEPOIS da ordenação (0 = sem corte). */
  limite?: number
}>

/** Monta a timeline determinística e saneada de uma competência. */
export function montarTimeline(entrada: EntradaProjecao): TimelineDto {
  const contexto: ContextoLeitura = entrada.contexto === "compartilhado" ? "compartilhado" : "interno"

  const itensEvento = entrada.eventos.map(projetarEvento)
  const itensComentario = entrada.comentarios
    // Fronteira do portal: comentário interno nunca entra em contexto compartilhado.
    .filter((c) => contexto === "interno" || normalizarVisibilidade(c.visibilidade) === "compartilhada")
    .map(projetarComentario)

  const todos = [...itensEvento, ...itensComentario].sort(compararItens)
  const limite = typeof entrada.limite === "number" && entrada.limite > 0 ? entrada.limite : todos.length
  const itens = todos.slice(0, limite)

  return Object.freeze({ contexto, total: todos.length, itens: Object.freeze(itens) })
}

/* ───────────────────────────── internos ───────────────────────────── */

/** `em` DESC; empate resolvido pelo id composto (ASC) — estável e reproduzível. */
export function compararItens(a: TimelineItemDto, b: TimelineItemDto): number {
  if (a.em !== b.em) return a.em < b.em ? 1 : -1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function projetarEvento(e: EventoTimeline): TimelineItemDto {
  return Object.freeze({
    id: `evento:${e.id}`,
    origem: "evento" as const,
    tipo: e.tipo,
    em: e.createdAt.toISOString(),
    atorTipo: e.atorTipo,
    atorId: e.atorId,
    entidade: e.entidade,
    entidadeId: e.entidadeId,
    visibilidade: null,
    texto: null,
    detalhes: sanitizarMetadata(e.metadata),
  })
}

function projetarComentario(c: ComentarioTimeline): TimelineItemDto {
  const visibilidade = normalizarVisibilidade(c.visibilidade)
  return Object.freeze({
    id: `comentario:${c.id}`,
    origem: "comentario" as const,
    tipo: TIPO_COMENTARIO,
    em: c.createdAt.toISOString(),
    atorTipo: c.autorTipo,
    atorId: c.autorId,
    entidade: c.documentoId ? "documento" : null,
    entidadeId: c.documentoId,
    visibilidade,
    texto: c.texto,
    detalhes: Object.freeze({ visibilidade }),
  })
}

/**
 * Deixa passar apenas chaves da allowlist com valor primitivo simples.
 * Chave suspeita (url/token/path/ref/…) é descartada mesmo se entrar na allowlist
 * por engano — dupla barreira contra vazamento em evolução futura do metadata.
 */
export function sanitizarMetadata(bruto: unknown): Readonly<Record<string, string | number | boolean>> {
  const saida: Record<string, string | number | boolean> = {}
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
      if (!METADATA_PERMITIDA.includes(k)) continue
      if (CHAVES_PROIBIDAS.test(k)) continue
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") saida[k] = v
    }
  }
  return Object.freeze(saida)
}

function normalizarVisibilidade(valor: string): Visibilidade {
  // Fail-closed: qualquer valor desconhecido é tratado como interno.
  return valor === "compartilhada" ? "compartilhada" : "interna"
}
