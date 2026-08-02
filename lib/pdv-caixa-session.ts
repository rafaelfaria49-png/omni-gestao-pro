/**
 * Contrato compartilhado de reconciliação da sessão de caixa dos PDVs.
 *
 * O servidor é a fonte da verdade da sessão ativa: o cliente só guarda uma
 * REFERÊNCIA (`caixaSessaoId`) que pode ficar ausente ou obsoleta depois de
 * F5, nova aba, novo login, travamento do navegador ou reinício do computador.
 *
 * Módulo puro (sem React, sem fetch, sem localStorage) para ser reusado pelo
 * `OperationsProvider`, pela barra de caixa e pelos testes em ambiente node.
 *
 * ESTADO ATUAL (extração fiel do `OperationsProvider`): a reconciliação só
 * trata dois casos — servidor aberto + local fechado, e servidor sem sessão +
 * local aberto. Os demais casos caem em "keep".
 */

/** Sessão ABERTA como o servidor devolve em `GET /api/ops/caixa/sessoes?status=ABERTA`. */
export type ServerCaixaSession = {
  id: string
  /** Loja dona da sessão. Ausente em respostas legadas — ver `decideCaixaSessionSync`. */
  storeId?: string | null
  saldoInicial: number
  abertaEm: string
}

/** Referência de caixa que o cliente restaurou do localStorage. */
export type LocalCaixaReference = {
  isOpen: boolean
  sessaoId: string | null
}

export type CaixaAdoptReason =
  /** Servidor tem caixa aberto e o cliente achava que estava fechado. */
  | "local-fechado"
  /** Cliente mostra caixa aberto mas perdeu o `sessaoId` (abertura não confirmada / quota / crash). */
  | "referencia-ausente"
  /** Cliente aponta para uma sessão diferente da que está aberta agora no servidor. */
  | "referencia-obsoleta"

export type CaixaKeepReason =
  | "em-sincronia"
  | "sem-sessao-em-ambos"
  /** Servidor respondeu com sessão de OUTRA loja: nunca adotar, nunca fechar às cegas. */
  | "sessao-de-outra-loja"
  /** Caso não coberto pela reconciliação atual. */
  | "nao-reconciliado"

export type CaixaSessionDecision =
  | {
      action: "adopt"
      reason: CaixaAdoptReason
      sessaoId: string
      saldoInicial: number
      abertaEm: string
      /** Referência local que está sendo substituída (`null` quando não havia). */
      replaced: string | null
    }
  | { action: "close"; reason: "servidor-sem-sessao-aberta" }
  | { action: "keep"; reason: CaixaKeepReason }

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Caixa aberto na tela mas sem referência de sessão utilizável: o operador vê
 * "Caixa Aberto" e mesmo assim a finalização é bloqueada. Estado degradado que
 * a UI precisa sinalizar e oferecer "Atualizar caixa".
 */
export function isCaixaReferenceStale(local: LocalCaixaReference): boolean {
  return local.isOpen && !trimmed(local.sessaoId)
}

/**
 * Decide o que fazer com o estado local de caixa diante da sessão ativa do servidor.
 */
export function decideCaixaSessionSync(input: {
  storeId: string
  local: LocalCaixaReference
  server: ServerCaixaSession | null
}): CaixaSessionDecision {
  const { local, server } = input
  const localSessaoId = trimmed(local.sessaoId)

  if (server && !local.isOpen) {
    return {
      action: "adopt",
      reason: "local-fechado",
      sessaoId: server.id,
      saldoInicial: server.saldoInicial,
      abertaEm: server.abertaEm,
      replaced: localSessaoId || null,
    }
  }

  if (!server && local.isOpen) {
    return { action: "close", reason: "servidor-sem-sessao-aberta" }
  }

  return { action: "keep", reason: "nao-reconciliado" }
}
