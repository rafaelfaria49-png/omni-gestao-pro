/**
 * Contador HUB · serialização canônica e hash determinístico (GOAL 012).
 *
 * Base de integridade do fechamento: o `snapshotHash` e o `diffHash` só têm valor
 * probatório se a MESMA informação produzir sempre a MESMA string — independente da
 * ordem em que as chaves foram montadas em memória ou devolvidas pelo banco.
 *
 * Regras da forma canônica:
 *  - chaves de objeto em ordem lexicográfica (`localeCompare` NÃO é usado — comparação
 *    por code unit, estável entre locales e plataformas);
 *  - `undefined` é omitido (em objeto) e vira `null` (em array, para não deslocar índices);
 *  - `Date` vira ISO 8601 UTC;
 *  - número não finito (`NaN`/`Infinity`) é recusado — jamais vira `null` silencioso;
 *  - `-0` é normalizado para `0` (senão `Object.is` e o hash divergiriam de `0`);
 *  - arrays preservam a ordem recebida: quem monta é responsável por ordenar o que
 *    vem do banco (ver `ordenarPorChave`).
 *
 * PURO: sem IO, Prisma, React ou sessão.
 */
import { createHash } from "node:crypto"

/** Valor aceito na forma canônica (o que sobrevive a um round-trip JSON). */
export type ValorCanonico =
  | string
  | number
  | boolean
  | null
  | readonly ValorCanonico[]
  | { readonly [k: string]: ValorCanonico }

export class ValorNaoCanonicoError extends Error {
  readonly code = "VALOR_NAO_CANONICO" as const
  constructor(
    readonly caminho: string,
    motivo: string,
  ) {
    super(`Valor não canonizável em "${caminho}": ${motivo}.`)
    this.name = "ValorNaoCanonicoError"
  }
}

/**
 * Converte um valor arbitrário na sua forma canônica.
 * Lança `ValorNaoCanonicoError` em vez de degradar silenciosamente — um snapshot com
 * `NaN` virando `null` produziria um hash "válido" para um dado corrompido.
 */
export function canonizar(valor: unknown, caminho = "$"): ValorCanonico {
  if (valor === null) return null
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw new ValorNaoCanonicoError(caminho, "Date inválida")
    return valor.toISOString()
  }

  const tipo = typeof valor
  if (tipo === "string" || tipo === "boolean") return valor as string | boolean
  if (tipo === "number") {
    const n = valor as number
    if (!Number.isFinite(n)) throw new ValorNaoCanonicoError(caminho, `número não finito (${n})`)
    // `Object.is(-0, 0)` é falso; sem isto, -0 e 0 gerariam JSON iguais mas semântica distinta.
    return n === 0 ? 0 : n
  }
  if (tipo === "bigint") throw new ValorNaoCanonicoError(caminho, "bigint não é serializável")
  if (tipo === "function" || tipo === "symbol") {
    throw new ValorNaoCanonicoError(caminho, `tipo não serializável (${tipo})`)
  }

  if (Array.isArray(valor)) {
    // `undefined` dentro de array vira null: omitir deslocaria os índices seguintes.
    return valor.map((v, i) => (v === undefined ? null : canonizar(v, `${caminho}[${i}]`)))
  }

  if (tipo === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const saida: Record<string, ValorCanonico> = {}
    for (const [k, v] of entradas) saida[k] = canonizar(v, `${caminho}.${k}`)
    return saida
  }

  throw new ValorNaoCanonicoError(caminho, `tipo inesperado (${tipo})`)
}

/** JSON canônico compacto — a string que é efetivamente hasheada. */
export function serializarCanonico(valor: unknown): string {
  return JSON.stringify(canonizar(valor))
}

/** SHA-256 (hex) de uma string já serializada — usado para VERIFICAR bytes preservados. */
export function sha256Texto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** SHA-256 (hex) da forma canônica. Mesma informação ⇒ mesmo hash, sempre. */
export function hashCanonico(valor: unknown): string {
  return sha256Texto(serializarCanonico(valor))
}

/**
 * Ordena uma lista por uma chave textual estável.
 * Usar SEMPRE antes de colocar no snapshot algo que veio do banco: a ordem de
 * `findMany` não é garantida sem `orderBy`, e o hash não pode depender dela.
 */
export function ordenarPorChave<T>(itens: readonly T[], chave: (item: T) => string): T[] {
  return [...itens].sort((a, b) => {
    const ka = chave(a)
    const kb = chave(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/**
 * Normaliza valor monetário para 2 casas — evita que ruído de ponto flutuante
 * (0.1 + 0.2) altere o hash de dados equivalentes.
 */
export function normalizarDecimal(n: number | null | undefined): number | null {
  if (n == null) return null
  if (!Number.isFinite(n)) return null
  const r = Math.round((n + Number.EPSILON) * 100) / 100
  return r === 0 ? 0 : r
}

/** Pseudônimo estável do responsável — nunca nome, e-mail ou telefone (G2-05). */
export function pseudonimoAtor(userId: string): string {
  return `u_${createHash("sha256").update(String(userId ?? ""), "utf8").digest("hex").slice(0, 16)}`
}
