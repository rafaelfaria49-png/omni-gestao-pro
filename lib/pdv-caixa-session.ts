/**
 * Contrato compartilhado de reconciliação da sessão de caixa dos PDVs.
 *
 * O servidor é a fonte da verdade da sessão ativa: o cliente só guarda uma
 * REFERÊNCIA (`caixaSessaoId`) que pode ficar ausente ou obsoleta depois de
 * F5, nova aba, novo login, travamento do navegador ou reinício do computador.
 *
 * Módulo puro (sem React, sem fetch, sem localStorage) para ser reusado pelo
 * `OperationsProvider`, pela barra de caixa e pelos testes em ambiente node.
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
 *
 * Regras:
 * - servidor com sessão da loja atual vence sempre que a referência local não
 *   corresponde a ela (ausente, obsoleta, ou cliente achando que está fechado);
 * - servidor sem sessão aberta fecha o caixa local (não se vende sem sessão);
 * - sessão de outra loja nunca é adotada — e também não fecha o caixa local,
 *   porque a resposta é inconsistente com a loja consultada.
 */
export function decideCaixaSessionSync(input: {
  storeId: string
  local: LocalCaixaReference
  server: ServerCaixaSession | null
}): CaixaSessionDecision {
  const { storeId, local, server } = input
  const localSessaoId = trimmed(local.sessaoId)

  if (!server) {
    return local.isOpen
      ? { action: "close", reason: "servidor-sem-sessao-aberta" }
      : { action: "keep", reason: "sem-sessao-em-ambos" }
  }

  const serverStoreId = trimmed(server.storeId)
  if (serverStoreId && serverStoreId !== trimmed(storeId)) {
    return { action: "keep", reason: "sessao-de-outra-loja" }
  }

  if (!local.isOpen) {
    return {
      action: "adopt",
      reason: "local-fechado",
      sessaoId: server.id,
      saldoInicial: server.saldoInicial,
      abertaEm: server.abertaEm,
      replaced: localSessaoId || null,
    }
  }

  if (!localSessaoId) {
    return {
      action: "adopt",
      reason: "referencia-ausente",
      sessaoId: server.id,
      saldoInicial: server.saldoInicial,
      abertaEm: server.abertaEm,
      replaced: null,
    }
  }

  if (localSessaoId !== server.id) {
    return {
      action: "adopt",
      reason: "referencia-obsoleta",
      sessaoId: server.id,
      saldoInicial: server.saldoInicial,
      abertaEm: server.abertaEm,
      replaced: localSessaoId,
    }
  }

  return { action: "keep", reason: "em-sincronia" }
}

/**
 * Resultado de uma reconciliação completa (consulta + decisão + aplicação no
 * estado do cliente). É o que a ação "Atualizar caixa" mostra ao operador.
 */
export type CaixaRefreshOutcome =
  | {
      ok: true
      status: "adotada"
      sessaoId: string
      substituiu: string | null
      motivo: CaixaAdoptReason
    }
  | { ok: true; status: "em-sincronia"; sessaoId: string }
  | { ok: true; status: "sem-caixa-aberto" }
  | { ok: true; status: "outra-loja" }
  | { ok: false; status: "falha"; reason: "http" | "rede" | "resposta-invalida" }

/**
 * Resultado da consulta da sessão ativa.
 *
 * `ok: true` + `sessao: null` significa "o servidor respondeu e NÃO há caixa
 * aberto". Falha de rede/permissão devolve `ok: false` — nunca pode ser lida
 * como "sem caixa", senão o cliente fecharia um caixa que está aberto.
 */
export type CaixaSessionFetchResult =
  | { ok: true; sessao: ServerCaixaSession | null }
  | { ok: false; reason: "http" | "rede" | "resposta-invalida"; status?: number }

function parseServerSession(raw: unknown): ServerCaixaSession | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  const id = trimmed(typeof s.id === "string" ? s.id : "")
  if (!id) return null
  const abertaEm = typeof s.abertaEm === "string" ? s.abertaEm : ""
  return {
    id,
    storeId: typeof s.storeId === "string" ? s.storeId : null,
    saldoInicial: Number(s.saldoInicial) || 0,
    abertaEm,
  }
}

/** URL canônica da sessão ativa da loja (a mais recente ABERTA, sem filtro de terminal). */
export function activeCaixaSessionUrl(lojaId: string): string {
  return `/api/ops/caixa/sessoes?lojaId=${encodeURIComponent(lojaId)}&status=ABERTA&take=1`
}

/** Consulta a sessão de caixa ABERTA da loja. `fetchImpl` injetável para teste. */
export async function fetchActiveCaixaSession(
  lojaId: string,
  fetchImpl: typeof fetch,
): Promise<CaixaSessionFetchResult> {
  let res: Response
  try {
    res = await fetchImpl(activeCaixaSessionUrl(lojaId), {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-assistec-loja-id": lojaId,
      },
    })
  } catch {
    return { ok: false, reason: "rede" }
  }

  if (!res.ok) return { ok: false, reason: "http", status: res.status }

  try {
    const body = (await res.json()) as { sessoes?: unknown }
    if (!Array.isArray(body.sessoes)) return { ok: false, reason: "resposta-invalida" }
    return { ok: true, sessao: parseServerSession(body.sessoes[0]) }
  } catch {
    return { ok: false, reason: "resposta-invalida" }
  }
}
