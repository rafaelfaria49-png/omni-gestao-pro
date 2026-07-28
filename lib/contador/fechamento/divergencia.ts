/**
 * Contador HUB · alteração operacional posterior ao fechamento (GOAL 012).
 *
 * Fechar uma competência não congela o PDV nem o Financeiro — congela apenas o
 * domínio contábil. Uma venda cancelada, um título quitado ou um caixa reaberto
 * DEPOIS do fechamento fazem os dados vivos divergirem do snapshot oficial.
 *
 * Este módulo detecta isso comparando o MESMO subconjunto de totais que o snapshot
 * gravou (`extrairTotais`) contra os readers vivos, e produz:
 *  - um diff determinístico (ordenado por chave);
 *  - um `diffHash` estável, usado como chave de deduplicação do evento.
 *
 * PURO e SEM ESCRITA: a comparação pode rodar em qualquer GET/render. A persistência
 * do evento `alteracao_pos_fechamento` é decisão de um POST explícito (ver `./service`),
 * nunca efeito colateral de leitura.
 */
import { hashCanonico } from "./canonico"
import type { MetricaSnapshot, TotaisSnapshot } from "./snapshot"

export const EVENTO_ALTERACAO_POS_FECHAMENTO = "alteracao_pos_fechamento" as const

/** Uma métrica que mudou entre o snapshot e os dados vivos. */
export type ItemDivergencia = Readonly<{
  chave: string
  snapshot: MetricaSnapshot
  atual: MetricaSnapshot
  /** `valor` (número mudou) · `disponibilidade` (honestidade da fonte mudou) · `ambos`. */
  natureza: "valor" | "disponibilidade" | "ambos"
  /** `atual - snapshot` quando ambos são numéricos; `null` se algum lado for null. */
  delta: number | null
}>

export type Divergencia = Readonly<{
  divergente: boolean
  /** Ordenado por `chave` — a ordem não pode influenciar o `diffHash`. */
  itens: readonly ItemDivergencia[]
  /** SHA-256 do diff canônico. Estável para a MESMA divergência. */
  diffHash: string
}>

const AUSENTE: MetricaSnapshot = Object.freeze({ valor: null, disponibilidade: "indisponivel" })

/**
 * Compara os totais do snapshot com os totais vivos.
 *
 * Considera a UNIÃO das chaves: um total que sumiu (ou que passou a existir depois de
 * uma evolução do reader) também é divergência — tratar ausência como "igual" esconderia
 * exatamente o caso que este mecanismo existe para pegar.
 */
export function compararTotais(
  snapshot: TotaisSnapshot,
  atual: TotaisSnapshot,
): Divergencia {
  const chaves = [...new Set([...Object.keys(snapshot), ...Object.keys(atual)])].sort()
  const itens: ItemDivergencia[] = []

  for (const chave of chaves) {
    const a = snapshot[chave] ?? AUSENTE
    const b = atual[chave] ?? AUSENTE
    const valorMudou = !mesmoValor(a.valor, b.valor)
    const dispMudou = a.disponibilidade !== b.disponibilidade
    if (!valorMudou && !dispMudou) continue

    itens.push(
      Object.freeze({
        chave,
        snapshot: a,
        atual: b,
        natureza: valorMudou && dispMudou ? "ambos" : valorMudou ? "valor" : "disponibilidade",
        delta: a.valor != null && b.valor != null ? arredondar(b.valor - a.valor) : null,
      }),
    )
  }

  return Object.freeze({
    divergente: itens.length > 0,
    itens: Object.freeze(itens),
    // O hash cobre APENAS o diff — dois fechamentos diferentes com a mesma divergência
    // produzem o mesmo hash, e o dedupe do evento usa (competenciaId, versao, diffHash).
    diffHash: hashCanonico({ itens }),
  })
}

function mesmoValor(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b
  // Tolerância de meio centavo: ruído de ponto flutuante não é alteração operacional.
  return Math.abs(a - b) < 0.005
}

function arredondar(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100
  return r === 0 ? 0 : r
}

/** Microcopy única exibida quando há divergência (a UI não inventa variações). */
export const AVISO_DIVERGENCIA =
  "Dados operacionais mudaram após o fechamento. Considere reabrir a competência."
