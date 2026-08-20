/**
 * Contador HUB · Observabilidade — métricas nomeadas do HUB (GOAL 019).
 *
 * Usa a infraestrutura que já existe no projeto: log estruturado JSON de UMA linha
 * em `console.info`, o mesmo padrão de `lib/contador/documentos/http.ts` e de
 * `app/api/contador/pacote/route.ts`. Não introduz cliente de métrica, agente,
 * dependência nova nem endpoint — o coletor da plataforma lê o stdout.
 *
 * O masterplan §22 descreve as métricas em prosa e NÃO fixa identificadores
 * canônicos; os nomes abaixo são, portanto, os canônicos a partir deste GOAL.
 *
 * ─────────────────────────── contrato de privacidade ───────────────────────────
 * Label é um ROTULO OPERACIONAL, nunca um dado. Duas defesas independentes:
 *
 *  1. ALLOWLIST DE CHAVES — só as chaves de `CHAVES_LABEL_PERMITIDAS` sobrevivem.
 *     Uma chave nova inventada no futuro é descartada por construção.
 *  2. FORMATO DE VALOR — o valor precisa ser um slug curto que **começa por letra**
 *     e usa apenas `[A-Za-z0-9_-]`. Duas exigências, não uma, e a primeira é a que
 *     importa: exigir letra inicial elimina toda a família de identificadores
 *     numéricos de pessoa. Isso exclui ESTRUTURALMENTE `storageRef` (tem `/`), URL
 *     assinada (tem `://`, `?`, `&`), e-mail (tem `@`), nome de cliente (tem espaço
 *     e acento), CPF com ou sem máscara (`123.456.789-00` e `12345678900` começam
 *     por dígito), CNPJ (idem), telefone (idem) e conteúdo de documento (excede 40
 *     caracteres e tem espaço).
 *
 * Valor fora do formato é DESCARTADO, nunca truncado: prefixo de `storageRef` ainda
 * é `storageRef`, e prefixo de CPF ainda é parte de um CPF.
 *
 * Consequência assumida: um valor puramente numérico NUNCA vira label — número é
 * dado, e dado de métrica vai em `valor`. `loja` (storeId) é permitido, porque é o
 * escopo do tenant e não PII de cliente (já vive em `ContadorEvento.storeId`); um
 * storeId que não comece por letra simplesmente perde a label, em vez de arriscar.
 */

/** Nomes canônicos das métricas do HUB. */
export const METRICAS = Object.freeze({
  /** Execuções do job de retenção em modo dry-run. */
  retencaoDryRunTotal: "retention_dry_run_total",
  /** Itens selecionados pela política (por alvo). */
  retencaoCandidatosTotal: "retention_candidates_total",
  /** Execuções do job de retenção em modo apply. */
  retencaoApplyTotal: "retention_apply_total",
  /** Falhas do job de retenção (leitura, storage ou evento). */
  retencaoFalhasTotal: "retention_failures_total",
  /** Bytes estimados dos candidatos (liberação potencial). */
  retencaoBytesCandidatos: "retention_bytes_candidate",
  /** Duração da geração do pacote do contador, em milissegundos. */
  pacoteGeracaoDuracaoMs: "package_generation_duration_ms",
  /** Falhas na geração do pacote do contador. */
  pacoteGeracaoFalhasTotal: "package_generation_failures_total",
  /** Acessos negados no portal do contador (v2). */
  portalAcessoNegadoTotal: "contador_portal_access_denied_total",
} as const)

export type NomeMetrica = (typeof METRICAS)[keyof typeof METRICAS]

/**
 * Chaves de label permitidas. Fechada de propósito — ver defesa 1 no cabeçalho.
 *
 *  - `alvo`      documentos | blobs_soft_deletados | pacotes
 *  - `modo`      dry-run | apply
 *  - `categoria` categoria do documento (FISCAL, FINANCEIRO, …)
 *  - `resultado` ok | falha | protegido | ja_ausente | descartado
 *  - `motivo`    rótulo curto e técnico do motivo (nunca mensagem livre)
 *  - `loja`      storeId (escopo do tenant — não é PII de cliente)
 *  - `politica`  PURGE_DISABLED | anos_5 | meses_12 | dias_90
 *  - `origem`    módulo que emitiu (pacote_sob_demanda, portal_pagina, …)
 */
export const CHAVES_LABEL_PERMITIDAS: ReadonlySet<string> = new Set([
  "alvo",
  "modo",
  "categoria",
  "resultado",
  "motivo",
  "loja",
  "politica",
  "origem",
])

/**
 * Slug curto iniciado por LETRA: sem `/`, `@`, `?`, `.`, espaço, acento nem nada
 * longo — e, por começar obrigatoriamente com letra, sem CPF, CNPJ ou telefone,
 * mascarados ou não.
 */
const VALOR_LABEL_SEGURO = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

export type LabelsMetrica = Readonly<Record<string, unknown>>

/**
 * Aplica as duas defesas e devolve apenas o que é seguro publicar. Chave fora da
 * allowlist e valor fora do formato somem — sem exceção, sem truncamento.
 */
export function sanearLabels(labels: LabelsMetrica | undefined): Record<string, string> {
  const limpo: Record<string, string> = {}
  if (!labels) return limpo
  for (const [chave, valor] of Object.entries(labels)) {
    if (!CHAVES_LABEL_PERMITIDAS.has(chave)) continue
    if (typeof valor !== "string" && typeof valor !== "number") continue
    const texto = String(valor)
    if (!VALOR_LABEL_SEGURO.test(texto)) continue
    limpo[chave] = texto
  }
  return limpo
}

/** Uma amostra de métrica já saneada, no formato que vai para o log. */
export type AmostraMetrica = Readonly<{
  evento: "metrica"
  metrica: NomeMetrica
  valor: number
  labels: Readonly<Record<string, string>>
}>

/** Destino da amostra. O padrão escreve no log estruturado; testes injetam o seu. */
export type SinkMetricas = (amostra: AmostraMetrica) => void

/** Sink padrão — uma linha JSON em `console.info`, igual ao resto do HUB. */
export const sinkLogEstruturado: SinkMetricas = (amostra) => {
  try {
    console.info(JSON.stringify(amostra))
  } catch {
    // Serialização nunca pode derrubar o caminho de negócio que está instrumentado.
    console.info(`${amostra.evento}:${amostra.metrica}`)
  }
}

/**
 * Emite UMA amostra. Valor não-finito é normalizado para 0 (uma métrica com `NaN`
 * corrompe o painel silenciosamente; zero é honesto e visível).
 *
 * Nunca lança: instrumentação que quebra o fluxo instrumentado é pior que ausência
 * de instrumentação.
 */
export function registrarMetrica(
  metrica: NomeMetrica,
  valor: number,
  labels?: LabelsMetrica,
  sink: SinkMetricas = sinkLogEstruturado,
): void {
  const amostra: AmostraMetrica = Object.freeze({
    evento: "metrica" as const,
    metrica,
    valor: Number.isFinite(valor) ? valor : 0,
    labels: Object.freeze(sanearLabels(labels)),
  })
  try {
    sink(amostra)
  } catch {
    // idem: o sink é infraestrutura, não regra de negócio.
  }
}

/** Porta de métricas para módulos que precisam injetar um sink em teste. */
export type MetricasPort = Readonly<{
  registrar: (metrica: NomeMetrica, valor: number, labels?: LabelsMetrica) => void
}>

/** Porta padrão (log estruturado). */
export const metricasPadrao: MetricasPort = Object.freeze({
  registrar: (metrica, valor, labels) => registrarMetrica(metrica, valor, labels),
})

/** Porta inerte — para caminhos que não devem emitir (ex.: script de carga sintética). */
export const metricasSilenciosas: MetricasPort = Object.freeze({ registrar: () => {} })
