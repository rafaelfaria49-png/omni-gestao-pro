/**
 * Regra pura do recebimento multitítulo do PDV (G3) — seleção, payload, idempotência
 * e leitura de conflito. Nada aqui toca React ou rede: o modal
 * `components/dashboard/vendas/pdv-recebimento-modal.tsx` é só a casca visual, e o
 * harness `node` do Vitest (que não compila `.tsx`) consegue exercitar a decisão
 * financeira inteira a partir daqui.
 *
 * Contrato do servidor: `POST /api/pdv/receber-conta-lote`
 * (`lib/financeiro/services/recebimento-lote-service.ts`, GOAL G2).
 *
 * Invariantes que este módulo protege:
 *  - **Saldo canônico.** O valor a receber sai sempre do `saldoAberto` que o servidor
 *    calculou; `row.valor` é o valor BRUTO e não diminui em baixa parcial.
 *  - **Distribuição explícita.** Cada item carrega `valorReceber` próprio. Não existe
 *    "mais antigo primeiro" implícito — a UI nunca decide sozinha onde o dinheiro cai.
 *  - **Total do servidor.** O total daqui serve para exibir e para travar a CTA; o
 *    valor confirmado é o `totalRecebido` da resposta.
 */
import { PAY_EPS } from "@/lib/financeiro/contracts/valores"
import { RECEBER_STATUS, normalizeReceberStatus } from "@/lib/financeiro/contracts/status"

/**
 * Teto de itens por lote. Espelha `RECEBIMENTO_LOTE_MAX_ITENS` do service — que não
 * pode ser importado aqui porque arrasta `@/generated/prisma` para o bundle do
 * cliente. `contas-receber-lote.test.ts` lê o arquivo do service e falha se os dois
 * números divergirem.
 */
export const RECEBIMENTO_LOTE_UI_MAX_ITENS = 25

/** Linha da lista, já reduzida ao que a decisão financeira precisa. */
export type LoteTitulo = {
  /** `ContaReceberRow.id` — é o `localKey` do título (chave financeira). */
  localKey: string
  /** `ContaReceberTitulo.id` real, quando a listagem trouxe o audit. */
  tituloId?: string
  /** Saldo em aberto CANÔNICO do servidor. */
  saldoAberto: number
}

export type LoteItemPayload = {
  localKey: string
  tituloId?: string
  saldoEsperado: number
  valorReceber: number
}

/** Centavos, sem o ruído de ponto flutuante. */
function money(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/**
 * Valor digitado em pt-BR (`1.234,56`) → número. Devolve `null` para entrada vazia ou
 * não numérica, para o chamador distinguir "não informou" de "informou zero".
 */
export function parseValorBR(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  const n = Number(s.replace(/\s/g, "").replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) ? money(n) : null
}

/**
 * Valor a receber de um título: o parcial digitado quando há um, senão o saldo inteiro.
 * O parcial é limitado ao saldo — o servidor recusaria o lote inteiro por
 * `saldo_esperado_insuficiente`, e travar aqui evita perder a operação por digitação.
 */
export function valorReceberDoTitulo(titulo: LoteTitulo, parcialDigitado?: string | null): number {
  const saldo = money(titulo.saldoAberto)
  const parcial = parseValorBR(parcialDigitado)
  if (parcial == null) return saldo
  return Math.min(money(parcial), saldo)
}

export type BuildItensLoteResult = {
  itens: LoteItemPayload[]
  /** Soma dos `valorReceber` — número de tela e trava da CTA, nunca autoridade contábil. */
  total: number
  /** Selecionados que não podem ir ao servidor (saldo zerado ou valor não positivo). */
  invalidos: string[]
  /** Passou do teto do lote: o servidor recusaria com `lote_excede_teto`. */
  excedeuTeto: boolean
}

/**
 * Payload do lote a partir da seleção. A ordem da lista visível é preservada para que
 * o recibo e a tela de confirmação leiam na mesma ordem que o operador viu.
 */
export function buildItensLote(
  titulos: LoteTitulo[],
  selecionados: Iterable<string>,
  parciais: Record<string, string> = {},
): BuildItensLoteResult {
  const sel = new Set(Array.from(selecionados, (k) => String(k)))
  const itens: LoteItemPayload[] = []
  const invalidos: string[] = []
  let total = 0

  for (const t of titulos) {
    if (!sel.has(t.localKey)) continue
    const saldoEsperado = money(t.saldoAberto)
    const valorReceber = valorReceberDoTitulo(t, parciais[t.localKey])
    if (!(saldoEsperado > PAY_EPS) || !(valorReceber > PAY_EPS)) {
      invalidos.push(t.localKey)
      continue
    }
    itens.push({
      localKey: t.localKey,
      ...(t.tituloId ? { tituloId: t.tituloId } : {}),
      saldoEsperado,
      valorReceber,
    })
    total = money(total + valorReceber)
  }

  return { itens, total, invalidos, excedeuTeto: itens.length > RECEBIMENTO_LOTE_UI_MAX_ITENS }
}

/** Seleção só existe sobre título realmente em aberto — saldo acima do epsilon. */
export function selecionaveis(titulos: LoteTitulo[]): string[] {
  return titulos.filter((t) => money(t.saldoAberto) > PAY_EPS).map((t) => t.localKey)
}

/** Estado do "Selecionar todos" (some/all/none) sem depender do render. */
export function estadoSelecionarTodos(
  titulos: LoteTitulo[],
  selecionados: Iterable<string>,
): "nenhum" | "parcial" | "todos" {
  const alvo = selecionaveis(titulos)
  if (alvo.length === 0) return "nenhum"
  const sel = new Set(Array.from(selecionados, (k) => String(k)))
  const marcados = alvo.filter((k) => sel.has(k)).length
  if (marcados === 0) return "nenhum"
  return marcados === alvo.length ? "todos" : "parcial"
}

// ─── idempotência da tentativa econômica ─────────────────────────────────────

/**
 * Impressão econômica da tentativa: mesma sessão, mesma forma e mesmos pares
 * título/valor ⇒ mesma tentativa. Mudou qualquer coisa, é outra operação e merece
 * outra chave — reusar a chave antiga faria o servidor devolver `idempotency_conflict`.
 *
 * A ordenação por `localKey` é intencional: reordenar a tela não pode inventar uma
 * segunda operação econômica.
 */
export function loteEconomicFingerprint(input: {
  sessaoId: string
  formaPagamento: string
  itens: LoteItemPayload[]
}): string {
  const itens = [...input.itens]
    .map((i) => `${i.localKey}=${i.valorReceber.toFixed(2)}/${i.saldoEsperado.toFixed(2)}`)
    .sort()
    .join("|")
  return `${String(input.sessaoId).trim()}::${String(input.formaPagamento).trim()}::${itens}`
}

/**
 * `idempotencyKey` do servidor precisa casar `^[A-Za-z0-9._-]{8,120}$` — UUID serve,
 * `:` não. O fallback existe para navegador sem `crypto.randomUUID`.
 */
export function novaIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`
}

/** Mapa `fingerprint → chave` vivo enquanto a tentativa não tem desfecho definitivo. */
export type IdempotencyKeyStore = Map<string, string>

/**
 * Chave da tentativa. Enquanto a MESMA tentativa econômica não confirmar, o retry
 * reusa a chave: se o POST commitou e a resposta se perdeu, o servidor reconhece o
 * replay em vez de gravar um segundo recebimento no caixa.
 */
export function resolveIdempotencyKey(
  store: IdempotencyKeyStore,
  fingerprint: string,
  gerar: () => string = novaIdempotencyKey,
): string {
  const atual = store.get(fingerprint)
  if (atual) return atual
  const nova = gerar()
  store.set(fingerprint, nova)
  return nova
}

/**
 * Descarta a chave. Só depois de um DESFECHO DEFINITIVO — sucesso ou recusa que o
 * servidor já decidiu. Falha de rede não é desfecho: ali a chave precisa sobreviver.
 */
export function encerrarIdempotencyKey(store: IdempotencyKeyStore, fingerprint: string): void {
  store.delete(fingerprint)
}

// ─── trava de submissão ──────────────────────────────────────────────────────

/**
 * Trava SÍNCRONA do duplo envio. Estado de React só chega ao DOM no próximo render,
 * então `disabled` no botão não impede Enter + clique no mesmo tick — e dois POSTs
 * com a mesma seleção viram duas tentativas econômicas para o operador.
 */
export type TravaSubmissao = { ativo: boolean }

export function novaTravaSubmissao(): TravaSubmissao {
  return { ativo: false }
}

/** `true` = pode enviar (a trava foi tomada agora). `false` = já havia envio em curso. */
export function iniciarSubmissao(trava: TravaSubmissao): boolean {
  if (trava.ativo) return false
  trava.ativo = true
  return true
}

/** Libera a trava — sempre no `finally`, inclusive quando o POST falhou. */
export function encerrarSubmissao(trava: TravaSubmissao): void {
  trava.ativo = false
}

// ─── leitura do conflito ─────────────────────────────────────────────────────

export type RecebimentoLoteRespostaErro = {
  error?: string
  code?: string
  detalhes?: Array<{ localKey?: string; motivo?: string; saldoReal?: number; saldoEsperado?: number }>
}

export type LoteConflito = {
  code: string
  /** Mensagem para o operador — já no tom "confira antes de receber". */
  mensagem: string
  /** Títulos que o servidor apontou como mudados; a seleção deles cai. */
  localKeysAfetadas: string[]
  /** A listagem precisa ser relida antes de qualquer nova tentativa. */
  recarregar: boolean
  /** A tentativa acabou: a próxima operação nasce com `idempotencyKey` nova. */
  definitivo: boolean
  /** O caixa não está apto a receber — o modal precisa sair do fluxo de gravação. */
  caixaFechado: boolean
}

const MSG_STALE = "Os valores foram atualizados. Confira novamente antes de receber."

/**
 * Traduz a recusa do lote. Nenhum caminho aqui tenta de novo sozinho: em conflito de
 * estado o operador precisa reconferir o que vai cobrar.
 */
export function interpretarErroLote(
  status: number,
  body: RecebimentoLoteRespostaErro | null | undefined,
): LoteConflito {
  const code = String(body?.code || "").trim()
  const afetadas = (body?.detalhes ?? [])
    .map((d) => String(d?.localKey ?? "").trim())
    .filter((k) => k.length > 0)

  switch (code) {
    case "saldo_divergente":
    case "titulo_alterado":
      return {
        code,
        mensagem: MSG_STALE,
        localKeysAfetadas: afetadas,
        recarregar: true,
        definitivo: true,
        caixaFechado: false,
      }
    case "idempotency_conflict":
      return {
        code,
        mensagem:
          "Esta tentativa já foi usada com outros valores. Recarreguei a lista — confira a seleção e receba de novo.",
        localKeysAfetadas: afetadas,
        recarregar: true,
        definitivo: true,
        caixaFechado: false,
      }
    case "caixa_fechado":
      return {
        code,
        mensagem: "A sessão de caixa não está aberta. Abra o caixa no PDV antes de receber.",
        localKeysAfetadas: [],
        recarregar: false,
        definitivo: true,
        caixaFechado: true,
      }
    case "periodo_fechado":
      return {
        code,
        mensagem: "Período financeiro fechado. Reabra o fechamento para receber.",
        localKeysAfetadas: [],
        recarregar: false,
        definitivo: true,
        caixaFechado: false,
      }
    default:
      break
  }

  // 409 sem código conhecido: ainda é conflito de estado, então recarrega e reconfere.
  if (status === 409) {
    return {
      code: code || "conflito",
      mensagem: MSG_STALE,
      localKeysAfetadas: afetadas,
      recarregar: true,
      definitivo: true,
      caixaFechado: false,
    }
  }

  // 4xx de contrato: o servidor decidiu, então a chave morre — mas a lista está boa.
  const definitivo = status >= 400 && status < 500
  return {
    code: code || `http_${status}`,
    mensagem: String(body?.error || "").trim() || "Não foi possível registrar o recebimento.",
    localKeysAfetadas: afetadas,
    recarregar: false,
    definitivo,
    caixaFechado: false,
  }
}

/**
 * Seleção que sobrevive ao conflito.
 *
 * Com os títulos nomeados pelo servidor, caem só eles. Sem nome — 409 que não trouxe
 * `detalhes` — cai a seleção INTEIRA: a lista vai ser relida e reaproveitar em
 * silêncio uma seleção que já se sabe stale é justamente o que o GOAL proíbe.
 */
export function limparSelecaoAposConflito(
  selecionados: Iterable<string>,
  conflito: Pick<LoteConflito, "localKeysAfetadas" | "recarregar">,
): string[] {
  const restante = Array.from(selecionados, (k) => String(k))
  const fora = new Set(conflito.localKeysAfetadas.map((k) => String(k)))
  if (fora.size > 0) return restante.filter((k) => !fora.has(k))
  return conflito.recarregar ? [] : restante
}

// ─── abas Em aberto / Recebidos ──────────────────────────────────────────────

/**
 * Reparte a resposta canônica COMPLETA do cliente em listas derivadas.
 *
 * O modal antigo filtrava os pagos cedo demais e o título quitado simplesmente
 * sumia. Preservar a lista inteira em memória e derivar as visões aqui é o que
 * mantém a aba "Recebidos" honesta sem interferir na seleção dos abertos.
 *
 * "Em aberto" é **saldo > ε**, nunca status textual: o snapshot do `payload` pode
 * dizer "pendente" para um título já quitado no servidor. Já cancelado/estornado sai
 * das DUAS abas — não é dívida a cobrar nem dinheiro que entrou.
 */
export function partitionTitulos<T extends { saldoAberto: number; status?: string }>(
  titulos: T[],
): { abertos: T[]; recebidos: T[]; descartados: T[] } {
  const abertos: T[] = []
  const recebidos: T[] = []
  const descartados: T[] = []
  for (const t of titulos) {
    const st = normalizeReceberStatus(t.status ?? "")
    if (st === RECEBER_STATUS.CANCELADO || st === RECEBER_STATUS.ESTORNADO) {
      descartados.push(t)
      continue
    }
    if (money(t.saldoAberto) > PAY_EPS) abertos.push(t)
    else recebidos.push(t)
  }
  return { abertos, recebidos, descartados }
}
