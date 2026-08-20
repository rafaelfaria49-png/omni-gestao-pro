/**
 * Contador HUB · Limites e quotas — INVENTÁRIO FECHADO (GOAL 019).
 *
 * Este módulo não cria teto nenhum. Ele REÚNE, num só lugar auditável, os números
 * que já vigoram no HUB e declara explicitamente onde NÃO existe número canônico.
 *
 * Regra que governou a escrita deste arquivo: **nenhum limite foi criado, elevado ou
 * reduzido no GOAL 019**. Onde o repositório já tinha número aceito, ele é
 * reexportado da sua fonte original (a fonte continua sendo a autoridade — aqui é só
 * a vitrine). Onde não havia número canônico, o campo é `null` e a coluna `observacao`
 * diz qual é o comportamento atual preservado, em vez de um teto inventado.
 *
 * Consequência de desenho: `null` NÃO significa "ilimitado". Significa "não há teto
 * dedicado; vale o teto do nível acima". Nenhum caminho de upload ficou sem teto —
 * todo arquivo continua limitado por `MAX_BYTES_DOCUMENTO`, e todo pacote pelos
 * tetos de registros, bytes descompactados, bytes de ZIP e número de arquivos.
 */
import {
  DOWNLOAD_EXPIRACAO_SEG,
  MAX_BYTES_DOCUMENTO,
  UPLOAD_EXPIRACAO_SEG,
} from "@/lib/contador/documentos/config"
import {
  MAX_ARQUIVOS_PACOTE,
  MAX_BYTES_DESCOMPACTADO,
  MAX_BYTES_ZIP,
  MAX_REGISTROS_POR_FONTE,
  TIMEOUT_LOGICO_MS,
} from "@/lib/contador/pacote/seguranca"

/** Escopo ao qual o limite se aplica. */
export type EscopoLimite = "arquivo" | "categoria" | "competencia" | "pacote"

export type LimiteContador = Readonly<{
  /** Chave estável do limite (usada em runbook e mensagens). */
  id: string
  escopo: EscopoLimite
  /** Valor vigente; `null` = sem teto dedicado (ver `observacao`). */
  valor: number | null
  unidade: "bytes" | "registros" | "arquivos" | "segundos" | "milissegundos" | null
  /** Módulo que é a AUTORIDADE do número. `null` quando não há número canônico. */
  fonte: string | null
  observacao: string
}>

/**
 * Inventário. Ordem: arquivo → categoria → competência → pacote, o mesmo eixo pedido
 * pelo GOAL 019.
 */
export const LIMITES_CONTADOR: readonly LimiteContador[] = Object.freeze([
  /* ── arquivo ── */
  Object.freeze({
    id: "documento.bytes_max",
    escopo: "arquivo" as const,
    valor: MAX_BYTES_DOCUMENTO,
    unidade: "bytes" as const,
    fonte: "lib/contador/documentos/config.ts",
    observacao: "Teto por documento, decisao aprovada no GOAL 010B. Inalterado no 019.",
  }),
  Object.freeze({
    id: "documento.upload_url_ttl",
    escopo: "arquivo" as const,
    valor: UPLOAD_EXPIRACAO_SEG,
    unidade: "segundos" as const,
    fonte: "lib/contador/documentos/config.ts",
    observacao: "Validade da URL assinada de upload. Inalterado no 019.",
  }),
  Object.freeze({
    id: "documento.download_url_ttl",
    escopo: "arquivo" as const,
    valor: DOWNLOAD_EXPIRACAO_SEG,
    unidade: "segundos" as const,
    fonte: "lib/contador/documentos/config.ts",
    observacao: "Validade da URL assinada de download. Inalterado no 019.",
  }),

  /* ── categoria ── */
  Object.freeze({
    id: "categoria.documentos_max",
    escopo: "categoria" as const,
    valor: null,
    unidade: null,
    fonte: null,
    observacao:
      "NAO EXISTE numero canonico de quota por categoria no repositorio. O GOAL 019 nao inventou teto: o comportamento atual e preservado — cada arquivo continua limitado por documento.bytes_max e o pacote pelos tetos de pacote. Definir exige decisao humana.",
  }),

  /* ── competência ── */
  Object.freeze({
    id: "competencia.documentos_max",
    escopo: "competencia" as const,
    valor: null,
    unidade: null,
    fonte: null,
    observacao:
      "NAO EXISTE numero canonico de quota por competencia. Comportamento atual preservado. O teto efetivo que ja existe e indireto: o pacote da competencia recusa acima de pacote.registros_por_fonte_max e de pacote.bytes_descompactados_max.",
  }),

  /* ── pacote ── */
  Object.freeze({
    id: "pacote.registros_por_fonte_max",
    escopo: "pacote" as const,
    valor: MAX_REGISTROS_POR_FONTE,
    unidade: "registros" as const,
    fonte: "lib/contador/pacote/seguranca.ts",
    observacao: "Teto por fonte do pacote; excedeu, o endpoint responde 413 e NAO trunca.",
  }),
  Object.freeze({
    id: "pacote.bytes_descompactados_max",
    escopo: "pacote" as const,
    valor: MAX_BYTES_DESCOMPACTADO,
    unidade: "bytes" as const,
    fonte: "lib/contador/pacote/seguranca.ts",
    observacao: "Teto do conteudo antes da compactacao. Inalterado no 019.",
  }),
  Object.freeze({
    id: "pacote.bytes_zip_max",
    escopo: "pacote" as const,
    valor: MAX_BYTES_ZIP,
    unidade: "bytes" as const,
    fonte: "lib/contador/pacote/seguranca.ts",
    observacao: "Teto do ZIP final. Inalterado no 019.",
  }),
  Object.freeze({
    id: "pacote.arquivos_max",
    escopo: "pacote" as const,
    valor: MAX_ARQUIVOS_PACOTE,
    unidade: "arquivos" as const,
    fonte: "lib/contador/pacote/seguranca.ts",
    observacao: "14 da estrutura fixa (008B) + snapshot do fechamento (012A). Inalterado no 019.",
  }),
  Object.freeze({
    id: "pacote.timeout_logico",
    escopo: "pacote" as const,
    valor: TIMEOUT_LOGICO_MS,
    unidade: "milissegundos" as const,
    fonte: "lib/contador/pacote/seguranca.ts",
    observacao: "Teto logico de duracao da geracao; estourou, o endpoint responde 503.",
  }),
])

/** Busca um limite pelo id. `undefined` quando o id não existe no inventário. */
export function limitePorId(id: string): LimiteContador | undefined {
  return LIMITES_CONTADOR.find((l) => l.id === id)
}

/** Limites sem número canônico — a lista que o runbook precisa mostrar ao operador. */
export function limitesSemNumeroCanonico(): readonly LimiteContador[] {
  return LIMITES_CONTADOR.filter((l) => l.valor === null)
}
