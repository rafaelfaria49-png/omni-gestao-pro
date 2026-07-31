/**
 * Precificação em lote da conferência pós-importação.
 *
 * Vocabulário deliberado: "acréscimo sobre o custo" (markup) e "margem bruta sobre o
 * preço de venda" são grandezas diferentes e aparecem separadas na tela. Chamar markup
 * de margem foi um dos vícios da revisão manual dos produtos do Martins.
 */

export type RegraPrecoLote =
  | { tipo: "definir"; valor: number }
  | { tipo: "acrescimo_percentual"; percentual: number }
  | { tipo: "acrescimo_fixo"; valor: number }

export type ArredondamentoPreco = "nenhum" | "90" | "99"

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

/**
 * Sobe o valor para o próximo final `,90` / `,99`. Nunca desce — um preço já em
 * `19,90` permanece `19,90`.
 */
export function arredondarParaFinal(valor: number, centavos: 90 | 99): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0
  const base = Math.floor(valor + 1e-9)
  let alvo = base + centavos / 100
  if (alvo + 1e-9 < valor) alvo += 1
  return round2(alvo)
}

export function aplicarArredondamento(valor: number, modo: ArredondamentoPreco): number {
  if (modo === "90") return arredondarParaFinal(valor, 90)
  if (modo === "99") return arredondarParaFinal(valor, 99)
  return round2(valor)
}

/**
 * Calcula o novo preço de venda. Acréscimos incidem sobre o CUSTO (nunca sobre o
 * preço atual) — custo zero devolve 0 e a linha continua marcada como pendente.
 */
export function calcularPrecoLote(
  custo: number,
  regra: RegraPrecoLote,
  arredondamento: ArredondamentoPreco = "nenhum",
): number {
  const custoSeguro = Number.isFinite(custo) && custo > 0 ? custo : 0
  let bruto = 0
  if (regra.tipo === "definir") {
    bruto = Number.isFinite(regra.valor) ? Math.max(0, regra.valor) : 0
  } else if (regra.tipo === "acrescimo_percentual") {
    const pct = Number.isFinite(regra.percentual) ? regra.percentual : 0
    bruto = custoSeguro * (1 + pct / 100)
  } else {
    const add = Number.isFinite(regra.valor) ? regra.valor : 0
    bruto = custoSeguro > 0 ? custoSeguro + add : 0
  }
  if (bruto <= 0) return 0
  return aplicarArredondamento(bruto, arredondamento)
}

/** Markup: quanto o preço de venda está acima do custo, em % do CUSTO. */
export function acrescimoSobreCusto(custo: number, preco: number): number {
  if (!Number.isFinite(custo) || custo <= 0) return 0
  if (!Number.isFinite(preco) || preco <= 0) return 0
  return round2(((preco - custo) / custo) * 100)
}

/** Margem bruta: quanto sobra do preço de venda, em % do PREÇO. */
export function margemBrutaSobreVenda(custo: number, preco: number): number {
  if (!Number.isFinite(preco) || preco <= 0) return 0
  const custoSeguro = Number.isFinite(custo) && custo > 0 ? custo : 0
  return round2(((preco - custoSeguro) / preco) * 100)
}

/** Prévia de uma linha antes de salvar em lote — a tela mostra antes/depois. */
export type PreviaPrecoLinha = {
  produtoId: string
  custo: number
  precoAtual: number
  precoNovo: number
  acrescimoSobreCusto: number
  margemBrutaSobreVenda: number
  /** `true` quando o custo é zero e a regra depende dele. */
  semCusto: boolean
}

export function preverPrecoLote(
  linhas: ReadonlyArray<{ produtoId: string; custo: number; preco: number }>,
  regra: RegraPrecoLote,
  arredondamento: ArredondamentoPreco = "nenhum",
): PreviaPrecoLinha[] {
  return linhas.map((l) => {
    const precoNovo = calcularPrecoLote(l.custo, regra, arredondamento)
    return {
      produtoId: l.produtoId,
      custo: l.custo,
      precoAtual: l.preco,
      precoNovo,
      acrescimoSobreCusto: acrescimoSobreCusto(l.custo, precoNovo),
      margemBrutaSobreVenda: margemBrutaSobreVenda(l.custo, precoNovo),
      semCusto: regra.tipo !== "definir" && (!Number.isFinite(l.custo) || l.custo <= 0),
    }
  })
}
