/**
 * Contador HUB · máquina de status de item/documento (GOAL 011).
 *
 * Biblioteca PURA: sem IO, Prisma, React, sessão ou cookies. Materializa a matriz
 * de transição aprovada na ADR-CONTADOR-005 (Gate G2) e resolve as duas pendências
 * que a própria ADR delegou a este GOAL:
 *
 *  - quem marca `conferido`/`resolvido` internamente → papel financeiro ou
 *    administrador (`exigePapelElevado`);
 *  - rejeição (`enviado`/`conferido` → `pendente`) exige comentário/motivo não vazio.
 *
 * `vencido` NÃO é estado: é flag derivada (ver `./vencido`). Qualquer par fora da
 * matriz falha com erro TIPADO — nunca com fallback silencioso.
 */

/** Estados PERSISTIDOS de um item/documento (espelha `ContadorItemStatus` do Prisma). */
export const STATUS_ITEM = ["PENDENTE", "ENVIADO", "CONFERIDO", "RESOLVIDO"] as const
export type StatusItem = (typeof STATUS_ITEM)[number]

/** Ação semântica de cada transição — usada em rótulo de UI e no evento. */
export type AcaoTransicao = "enviar" | "conferir" | "resolver" | "rejeitar"

export type Transicao = Readonly<{
  de: StatusItem
  para: StatusItem
  acao: AcaoTransicao
  /** Rejeição: o motivo vira comentário interno obrigatório. */
  exigeMotivo: boolean
  /** `conferido`/`resolvido`: exige papel financeiro ou administrador. */
  exigePapelElevado: boolean
  /** Rótulo curto para o botão da UI. */
  rotulo: string
}>

/**
 * MATRIZ CANÔNICA — a única fonte de verdade das transições permitidas.
 * Qualquer par ausente daqui é inválido por definição (fail-closed).
 */
export const TRANSICOES: readonly Transicao[] = Object.freeze([
  Object.freeze({
    de: "PENDENTE",
    para: "ENVIADO",
    acao: "enviar",
    exigeMotivo: false,
    exigePapelElevado: false,
    rotulo: "Marcar como enviado",
  }),
  Object.freeze({
    de: "ENVIADO",
    para: "CONFERIDO",
    acao: "conferir",
    exigeMotivo: false,
    exigePapelElevado: true,
    rotulo: "Marcar como conferido",
  }),
  Object.freeze({
    de: "CONFERIDO",
    para: "RESOLVIDO",
    acao: "resolver",
    exigeMotivo: false,
    exigePapelElevado: true,
    rotulo: "Marcar como resolvido",
  }),
  Object.freeze({
    de: "ENVIADO",
    para: "PENDENTE",
    acao: "rejeitar",
    exigeMotivo: true,
    exigePapelElevado: false,
    rotulo: "Rejeitar",
  }),
  Object.freeze({
    de: "CONFERIDO",
    para: "PENDENTE",
    acao: "rejeitar",
    exigeMotivo: true,
    exigePapelElevado: false,
    rotulo: "Rejeitar",
  }),
] as const)

/* ───────────────────────────── erros tipados ───────────────────────────── */

export class TransicaoInvalidaError extends Error {
  readonly code = "TRANSICAO_INVALIDA" as const
  constructor(
    readonly de: string,
    readonly para: string,
  ) {
    super(`Transição não permitida: ${de} → ${para}.`)
    this.name = "TransicaoInvalidaError"
  }
}

export class StatusInvalidoError extends Error {
  readonly code = "STATUS_INVALIDO" as const
  constructor(readonly valor: string) {
    super("Status inválido. Use pendente, enviado, conferido ou resolvido.")
    this.name = "StatusInvalidoError"
  }
}

export class MotivoObrigatorioError extends Error {
  readonly code = "MOTIVO_OBRIGATORIO" as const
  constructor() {
    super("A rejeição exige um motivo (comentário) não vazio.")
    this.name = "MotivoObrigatorioError"
  }
}

export class PermissaoTransicaoError extends Error {
  readonly code = "PERMISSAO_TRANSICAO" as const
  constructor(readonly acao: AcaoTransicao) {
    super("Sua conta não tem permissão para esta mudança de status.")
    this.name = "PermissaoTransicaoError"
  }
}

/** Perdeu a corrida: o documento saiu do estado `de` entre a leitura e a escrita. */
export class TransicaoConcorrenteError extends Error {
  readonly code = "TRANSICAO_CONCORRENTE" as const
  constructor() {
    super("O status do documento mudou durante a operação. Recarregue e tente de novo.")
    this.name = "TransicaoConcorrenteError"
  }
}

/* ───────────────────────────── consultas puras ───────────────────────────── */

export function isStatusItem(valor: unknown): valor is StatusItem {
  return typeof valor === "string" && (STATUS_ITEM as readonly string[]).includes(valor)
}

/**
 * Normaliza um status vindo da borda (query, body, banco) para a forma canônica.
 * Aceita `pendente`/`PENDENTE`; rejeita qualquer outra coisa com erro tipado.
 */
export function normalizarStatus(valor: unknown): StatusItem {
  const v = typeof valor === "string" ? valor.trim().toUpperCase() : ""
  if (!isStatusItem(v)) throw new StatusInvalidoError(String(valor ?? ""))
  return v
}

/** Transição correspondente ao par, ou `null` quando o par está fora da matriz. */
export function acharTransicao(de: StatusItem, para: StatusItem): Transicao | null {
  return TRANSICOES.find((t) => t.de === de && t.para === para) ?? null
}

/** Igual a `acharTransicao`, mas lança `TransicaoInvalidaError` em vez de devolver `null`. */
export function resolverTransicao(de: StatusItem, para: StatusItem): Transicao {
  const t = acharTransicao(de, para)
  if (!t) throw new TransicaoInvalidaError(de, para)
  return t
}

/** Transições que partem de `de` — base para renderizar apenas botões válidos. */
export function transicoesDe(de: StatusItem): readonly Transicao[] {
  return TRANSICOES.filter((t) => t.de === de)
}

/**
 * Transições que o papel autenticado pode de fato executar a partir de `de`.
 * A UI usa isto para NUNCA oferecer um botão que o servidor recusaria.
 */
export function transicoesDisponiveis(
  de: StatusItem,
  capacidades: Readonly<{ podeConferir: boolean }>,
): readonly Transicao[] {
  return transicoesDe(de).filter((t) => !t.exigePapelElevado || capacidades.podeConferir)
}
