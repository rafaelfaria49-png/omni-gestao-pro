/**
 * Contador HUB · Retenção — POLÍTICA (pura, sem IO) — GOAL 019.
 *
 * Fonte dos números: decisões humanas de Rafael registradas em
 * `docs/contador/CONTADOR_HUB_PORTAL_EXTERNO_ROADMAP_014_019.md` (pré-GOAL 019) e
 * publicadas em `main`. Este módulo é a ÚNICA fonte da verdade dos prazos — nenhum
 * outro ponto do HUB pode recalcular ou "ajustar" uma janela de retenção.
 *
 * Três garantias de desenho:
 *  1. `FISCAL`, `JURIDICO` e `FOLHA` são `PURGE_DISABLED` — não existe caminho de
 *     código que produza um corte por idade para essas categorias (o retorno é
 *     `null`, não uma data antiga que "nunca casaria").
 *  2. A aritmética é de CALENDÁRIO CIVIL em UTC, não múltiplo fixo de 86 400 000 ms:
 *     "5 anos" é a mesma data cinco anos antes, com clamp de fim de mês
 *     (29/02 menos 5 anos = 28/02), nunca 1825 ou 1826 dias arbitrários.
 *  3. Os predicados falham FECHADO: item exatamente na borda da janela é PROTEGIDO
 *     nas janelas de idade (comparação estrita). A única borda inclusiva é a do blob
 *     soft-deletado, porque a decisão aprovada é literal: `excluidoEm + 90d <= agora`.
 */

/** Categorias do enum `ContadorDocumentoCategoria` (prisma/schema.prisma). */
export const CATEGORIAS_DOCUMENTO = ["FISCAL", "FINANCEIRO", "FOLHA", "JURIDICO", "OUTRO"] as const
export type CategoriaDocumentoRetencao = (typeof CATEGORIAS_DOCUMENTO)[number]

/* ───────────────────────────── números aprovados ───────────────────────────── */

/** Documentos `FINANCEIRO` — janela aprovada. */
export const FINANCEIRO_RETENCAO_ANOS = 5
/** Documentos `OUTRO` — janela aprovada. */
export const OUTRO_RETENCAO_ANOS = 5
/** Artefato ZIP de um pacote de fechamento — janela aprovada, a contar de `geradoEm`. */
export const PACOTE_RETENCAO_MESES = 12
/** Blob de documento soft-deletado — janela aprovada, a contar de `excluidoEm`. */
export const BLOB_SOFT_DELETADO_RETENCAO_DIAS = 90

/* ───────────────────────────── tipos da política ───────────────────────────── */

export type UnidadeJanela = "anos" | "meses" | "dias"

export type PoliticaRetencao =
  | Readonly<{ tipo: "PURGE_DISABLED"; fundamento: string }>
  | Readonly<{ tipo: "JANELA"; unidade: UnidadeJanela; quantidade: number; fundamento: string }>

/** Sentinela legível da decisão "sem purga automática nesta fase". */
export const PURGE_DISABLED = "PURGE_DISABLED" as const

function purgaDesabilitada(fundamento: string): PoliticaRetencao {
  return Object.freeze({ tipo: PURGE_DISABLED, fundamento })
}

function janela(unidade: UnidadeJanela, quantidade: number, fundamento: string): PoliticaRetencao {
  return Object.freeze({ tipo: "JANELA" as const, unidade, quantidade, fundamento })
}

/* ───────────────────────────── política por alvo ───────────────────────────── */

const FUNDAMENTO_SEM_PURGA =
  "Decisao humana (Rafael, 2026-08-20): sem purga automatica nesta fase. Mantem automaticamente satisfeita a regra de processo pendente do RICMS/SP art. 202."

const FUNDAMENTO_CINCO_ANOS =
  "Decisao humana (Rafael, 2026-08-20): 5 anos. Antes de ativar APPLY, resolver a pendencia de processo pendente registrada no runbook."

/**
 * Política por categoria de documento. O `Record` é exaustivo de propósito:
 * acrescentar uma categoria ao enum do Prisma sem decidir a política aqui quebra a
 * compilação, em vez de cair num default silencioso.
 */
export const RETENCAO_DOCUMENTOS: Readonly<Record<CategoriaDocumentoRetencao, PoliticaRetencao>> =
  Object.freeze({
    FISCAL: purgaDesabilitada(FUNDAMENTO_SEM_PURGA),
    JURIDICO: purgaDesabilitada(FUNDAMENTO_SEM_PURGA),
    FOLHA: purgaDesabilitada(FUNDAMENTO_SEM_PURGA),
    FINANCEIRO: janela("anos", FINANCEIRO_RETENCAO_ANOS, FUNDAMENTO_CINCO_ANOS),
    OUTRO: janela("anos", OUTRO_RETENCAO_ANOS, FUNDAMENTO_CINCO_ANOS),
  })

/**
 * Artefato ZIP do pacote de fechamento. O pacote é DERIVADO: competência, snapshot
 * congelado, versão, manifesto e itens permanecem, então o ZIP é regenerável.
 */
export const RETENCAO_PACOTE: PoliticaRetencao = janela(
  "meses",
  PACOTE_RETENCAO_MESES,
  "Decisao humana (Rafael, 2026-08-20): 12 meses apos a geracao. O ZIP e derivado do snapshot congelado e regeneravel.",
)

/**
 * Blob de documento soft-deletado. Aplica-se a QUALQUER categoria — inclusive as
 * `PURGE_DISABLED` —, porque a exclusão foi ato humano explícito com motivo, não
 * envelhecimento. O registro, o motivo e o evento `documento_excluido` permanecem.
 */
export const RETENCAO_BLOB_SOFT_DELETADO: PoliticaRetencao = janela(
  "dias",
  BLOB_SOFT_DELETADO_RETENCAO_DIAS,
  "Decisao humana (Rafael, 2026-08-20): 90 dias apos excluidoEm. Vale para todas as categorias: exclusao e ato humano com motivo, nao idade.",
)

/* ───────────────────────────── calendário civil (UTC) ───────────────────────────── */

/** Último dia do mês `mes` (0-11) do ano `ano`, em UTC. */
function ultimoDiaDoMesUtc(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
}

/**
 * Subtrai meses de calendário preservando hora/minuto/segundo e fazendo CLAMP do dia
 * ao último dia do mês de destino: 31/03 menos 1 mês = 28/02 (ou 29/02), nunca 03/03.
 */
export function subtrairMesesUtc(referencia: Date, meses: number): Date {
  const ano = referencia.getUTCFullYear()
  const mes = referencia.getUTCMonth()
  const dia = referencia.getUTCDate()

  const totalMeses = ano * 12 + mes - meses
  const anoAlvo = Math.floor(totalMeses / 12)
  const mesAlvo = ((totalMeses % 12) + 12) % 12
  const diaAlvo = Math.min(dia, ultimoDiaDoMesUtc(anoAlvo, mesAlvo))

  return new Date(
    Date.UTC(
      anoAlvo,
      mesAlvo,
      diaAlvo,
      referencia.getUTCHours(),
      referencia.getUTCMinutes(),
      referencia.getUTCSeconds(),
      referencia.getUTCMilliseconds(),
    ),
  )
}

/** Subtrai anos de calendário. 29/02 menos 1 ano = 28/02 (clamp), não 01/03. */
export function subtrairAnosUtc(referencia: Date, anos: number): Date {
  return subtrairMesesUtc(referencia, anos * 12)
}

/**
 * Subtrai dias corridos. Dia é a única unidade em que o múltiplo fixo é o significado
 * correto — e o cálculo é em UTC, então não há salto de horário de verão distorcendo.
 */
export function subtrairDiasUtc(referencia: Date, dias: number): Date {
  return new Date(referencia.getTime() - dias * 24 * 60 * 60 * 1000)
}

/**
 * Data de corte da política em relação a `agora`.
 *
 * `null` significa PURGE_DISABLED — a ausência de corte é representada pela AUSÊNCIA
 * de data, nunca por uma data distante.
 */
export function limiteDeCorte(politica: PoliticaRetencao, agora: Date): Date | null {
  if (politica.tipo === PURGE_DISABLED) return null
  switch (politica.unidade) {
    case "anos":
      return subtrairAnosUtc(agora, politica.quantidade)
    case "meses":
      return subtrairMesesUtc(agora, politica.quantidade)
    case "dias":
      return subtrairDiasUtc(agora, politica.quantidade)
  }
}

/** Corte da categoria de documento (ou `null` quando a purga está desabilitada). */
export function corteDocumento(categoria: CategoriaDocumentoRetencao, agora: Date): Date | null {
  return limiteDeCorte(RETENCAO_DOCUMENTOS[categoria], agora)
}

/** Corte do artefato ZIP do pacote. Nunca `null` (a política é uma janela). */
export function cortePacote(agora: Date): Date {
  return limiteDeCorte(RETENCAO_PACOTE, agora) as Date
}

/** Corte do blob soft-deletado. Nunca `null` (a política é uma janela). */
export function corteBlobSoftDeletado(agora: Date): Date {
  return limiteDeCorte(RETENCAO_BLOB_SOFT_DELETADO, agora) as Date
}

/* ───────────────────────────── predicados ───────────────────────────── */

/** `true` quando a categoria NUNCA é descartada por idade. */
export function purgaPorIdadeDesabilitada(categoria: CategoriaDocumentoRetencao): boolean {
  return RETENCAO_DOCUMENTOS[categoria].tipo === PURGE_DISABLED
}

/**
 * Referência de idade de um documento: o MAIS RECENTE entre o fim da competência a
 * que ele pertence e o seu `createdAt`.
 *
 * Escolha conservadora e deliberada: o relógio contábil corre pelo exercício, mas um
 * documento anexado tarde não pode nascer já vencido. Tomar o máximo garante que
 * nenhuma das duas leituras encurte a janela.
 */
export function referenciaIdadeDocumento(entrada: {
  competenciaFimExclusivo: Date
  createdAt: Date
}): Date {
  return entrada.competenciaFimExclusivo.getTime() >= entrada.createdAt.getTime()
    ? entrada.competenciaFimExclusivo
    : entrada.createdAt
}

/**
 * Elegibilidade por idade. Borda EXCLUSIVA: item exatamente com a idade da janela é
 * PROTEGIDO — a decisão fala em "além da retenção", e empate protege.
 */
export function documentoElegivelPorIdade(
  entrada: {
    categoria: CategoriaDocumentoRetencao
    competenciaFimExclusivo: Date
    createdAt: Date
  },
  agora: Date,
): boolean {
  const corte = corteDocumento(entrada.categoria, agora)
  if (corte === null) return false
  return referenciaIdadeDocumento(entrada).getTime() < corte.getTime()
}

/** Pacote elegível quando gerado ANTES do corte de 12 meses (empate protege). */
export function pacoteElegivel(geradoEm: Date, agora: Date): boolean {
  return geradoEm.getTime() < cortePacote(agora).getTime()
}

/**
 * Blob soft-deletado elegível. Borda INCLUSIVA por decisão literal aprovada:
 * `excluidoEm + 90 dias <= agora`.
 */
export function blobSoftDeletadoElegivel(excluidoEm: Date | null, agora: Date): boolean {
  if (!excluidoEm) return false
  return excluidoEm.getTime() <= corteBlobSoftDeletado(agora).getTime()
}
