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
  /**
   * Terminal (PDV1, PDV2…) que abriu a sessão. `null` = sessão sem terminal
   * (loja que opera sem seleção de terminal, ou sessão anterior ao multi-terminal).
   */
  terminalId?: string | null
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
  /** Servidor respondeu com sessão de OUTRO terminal da mesma loja: nunca adotar. */
  | "sessao-de-outro-terminal"

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
 * Códigos com que `/api/ops/venda-persist` recusa uma venda por causa da sessão
 * de caixa. Recebê-los significa que a referência do cliente ficou para trás —
 * a resposta é reconsultar a sessão ativa, nunca reenviar a venda.
 *
 * Hoje o servidor só emite `CAIXA_FECHADO` (`CaixaSessaoInvalidaError`);
 * `SESSAO_INVALIDA` fica aceito por antecipação do contrato.
 *
 * `CAIXA_ORIGINAL_FECHADO` NÃO entra aqui: ali o problema é a sessão em que a
 * venda nasceu, e atualizar o caixa atual não resolve — quem trata é o reenvio
 * retroativo, sempre por ação explícita do operador.
 */
export function isCaixaSessionRejectionCode(code: string | undefined | null): boolean {
  return code === "CAIXA_FECHADO" || code === "SESSAO_INVALIDA"
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
 * Porta única de pré-pagamento de TODOS os PDVs: caixa aberto **e** referência
 * de sessão utilizável. Sem `sessaoId` a venda é recusada pelo servidor
 * (`CAIXA_FECHADO`) e vira pendência local — o cenário das pendências fantasmas.
 */
export function isCaixaProntoParaFinalizar(local: LocalCaixaReference): boolean {
  return local.isOpen && !!trimmed(local.sessaoId)
}

/**
 * Decide o que fazer com o estado local de caixa diante da sessão ativa do servidor.
 *
 * Regras:
 * - servidor com sessão da loja **e do terminal atual** vence sempre que a
 *   referência local não corresponde a ela (ausente, obsoleta, ou cliente
 *   achando que está fechado);
 * - servidor sem sessão aberta para este terminal fecha o caixa local (não se
 *   vende sem sessão);
 * - sessão de outra loja nunca é adotada — e também não fecha o caixa local,
 *   porque a resposta é inconsistente com a loja consultada;
 * - sessão de OUTRO terminal da mesma loja também nunca é adotada. Sessões de
 *   caixa são por terminal (`SessaoCaixa.terminalId`, guard de `POST
 *   /api/ops/caixa/abrir` e resolução de sessão em `lib/ops-upsert-venda.ts`):
 *   uma loja com PDV1 e PDV2 abertos tem DUAS sessões ABERTAS legítimas, e
 *   adotar a mais recente jogava as vendas do PDV1 no fechamento do PDV2
 *   (F-01 da readiness PDV-CAIXA-SESSION-RECOVERY-SPLIT-READINESS-002A).
 *
 * Compatibilidade: quando um dos lados **não tem terminal** (cliente que pulou o
 * gate de terminal, ou sessão aberta sem `terminalId`), o escopo volta a ser o
 * da loja — é exatamente como o servidor resolve abertura e venda sem
 * `terminalId`. A guarda só recusa quando os DOIS lados têm terminal e divergem.
 *
 * O chamador é responsável por só entregar aqui um `local` JÁ HIDRATADO do
 * armazenamento persistido — ver `reconcileCaixaSession`.
 */
export function decideCaixaSessionSync(input: {
  storeId: string
  /** Terminal ativo neste navegador (`null` quando a loja opera sem terminal). */
  terminalId?: string | null
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

  const terminalAtual = trimmed(input.terminalId)
  const serverTerminalId = trimmed(server.terminalId)
  if (terminalAtual && serverTerminalId && serverTerminalId !== terminalAtual) {
    return { action: "keep", reason: "sessao-de-outro-terminal" }
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

/** Motivos pelos quais uma reconciliação não produz decisão sobre o estado local. */
export type CaixaRefreshFailureReason =
  | "http"
  | "rede"
  | "resposta-invalida"
  /** Estado persistido do caixa ainda não foi hidratado — decidir aqui seria decidir sobre o estado PADRÃO. */
  | "nao-hidratado"
  /** A loja ativa mudou enquanto a consulta estava em voo: a resposta não vale mais. */
  | "loja-trocada"

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
  | { ok: true; status: "outro-terminal" }
  | { ok: false; status: "falha"; reason: CaixaRefreshFailureReason }

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
    terminalId: typeof s.terminalId === "string" ? s.terminalId : null,
    saldoInicial: Number(s.saldoInicial) || 0,
    abertaEm,
  }
}

/**
 * URL canônica da sessão ativa: a mais recente ABERTA da loja **e do terminal**.
 *
 * O `terminalId` é obrigatório sempre que houver terminal selecionado — sem ele
 * a consulta devolve a sessão mais recente da loja, que pode ser a de outro PDV
 * (F-01). Sem terminal selecionado a consulta continua no escopo da loja, que é
 * como o servidor resolve abertura e venda sem `terminalId`.
 */
export function activeCaixaSessionUrl(lojaId: string, terminalId?: string | null): string {
  const base = `/api/ops/caixa/sessoes?lojaId=${encodeURIComponent(lojaId)}&status=ABERTA&take=1`
  const tid = trimmed(terminalId)
  return tid ? `${base}&terminalId=${encodeURIComponent(tid)}` : base
}

/** Consulta a sessão de caixa ABERTA da loja/terminal. `fetchImpl` injetável para teste. */
export async function fetchActiveCaixaSession(
  lojaId: string,
  fetchImpl: typeof fetch,
  terminalId?: string | null,
): Promise<CaixaSessionFetchResult> {
  let res: Response
  try {
    res = await fetchImpl(activeCaixaSessionUrl(lojaId, terminalId), {
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

/**
 * Caminho completo da recuperação: consulta a sessão ativa e decide o que fazer.
 *
 * Devolve `decision: null` quando a consulta falhou — o chamador NÃO deve mexer
 * no estado local nesse caso. É o que impede uma queda de rede de fechar um
 * caixa que está aberto no servidor.
 *
 * `hydrated: false` é recusado ANTES da consulta e sem decisão nenhuma. Sem essa
 * porta, a reconciliação de montagem decidiria contra o estado PADRÃO do
 * provider (caixa fechado, sem sessão) em vez do estado restaurado do
 * localStorage: `action: "close"` viraria inalcançável — o caixa falso aberto
 * nunca fecharia — e o saldo local seria sobrescrito pelo do servidor mesmo
 * quando as duas pontas já estavam em sincronia. É a regressão A0 da readiness
 * PDV-CAIXA-SESSION-RECOVERY-CART-DRAFT-001.
 */
export async function reconcileCaixaSession(params: {
  storeId: string
  /**
   * Terminal ativo deste navegador. Vai na consulta e na decisão: sem ele o PDV1
   * era reapontado para a sessão do PDV2 da mesma loja (F-01).
   */
  terminalId?: string | null
  local: LocalCaixaReference
  fetchImpl: typeof fetch
  /** `true` somente depois que o estado persistido do caixa foi restaurado. */
  hydrated: boolean
}): Promise<{ outcome: CaixaRefreshOutcome; decision: CaixaSessionDecision | null }> {
  if (!params.hydrated) {
    return { outcome: { ok: false, status: "falha", reason: "nao-hidratado" }, decision: null }
  }

  const fetched = await fetchActiveCaixaSession(
    params.storeId,
    params.fetchImpl,
    params.terminalId,
  )
  if (!fetched.ok) {
    return { outcome: { ok: false, status: "falha", reason: fetched.reason }, decision: null }
  }

  const decision = decideCaixaSessionSync({
    storeId: params.storeId,
    terminalId: params.terminalId,
    local: params.local,
    server: fetched.sessao,
  })

  if (decision.action === "adopt") {
    return {
      outcome: {
        ok: true,
        status: "adotada",
        sessaoId: decision.sessaoId,
        substituiu: decision.replaced,
        motivo: decision.reason,
      },
      decision,
    }
  }

  if (decision.action === "close") {
    return { outcome: { ok: true, status: "sem-caixa-aberto" }, decision }
  }

  if (decision.reason === "sessao-de-outra-loja") {
    return { outcome: { ok: true, status: "outra-loja" }, decision }
  }
  if (decision.reason === "sessao-de-outro-terminal") {
    return { outcome: { ok: true, status: "outro-terminal" }, decision }
  }
  if (decision.reason === "sem-sessao-em-ambos") {
    return { outcome: { ok: true, status: "sem-caixa-aberto" }, decision }
  }
  return {
    outcome: { ok: true, status: "em-sincronia", sessaoId: params.local.sessaoId ?? "" },
    decision,
  }
}

/** Estado mínimo do cliente que a decisão de caixa altera. */
export type CaixaSessionApplicable = {
  caixa: {
    isOpen: boolean
    saldoInicial: number
    dataAbertura: Date | null
    totalEntradas: number
    totalSaidas: number
  }
  caixaSessaoId: string | null
}

/**
 * Aplica a decisão ao estado do cliente. Genérico de propósito: recebe e devolve
 * o estado INTEIRO do `OperationsProvider`, tocando somente `caixa` e
 * `caixaSessaoId`.
 *
 * É o que garante, de forma verificável em teste, que reconciliar o caixa não
 * mexe em `sales` / `syncPending`: qualquer outro campo sai por referência,
 * então a fila de vendas pendentes (com seus `pedidoId` e chaves de
 * idempotência) é literalmente o mesmo objeto de antes.
 *
 * `keep` devolve o estado recebido sem cópia — nenhum re-render, nenhuma escrita.
 */
export function applyCaixaSessionDecision<T extends CaixaSessionApplicable>(
  prev: T,
  decision: CaixaSessionDecision,
): T {
  if (decision.action === "adopt") {
    return {
      ...prev,
      caixaSessaoId: decision.sessaoId,
      caixa: {
        ...prev.caixa,
        isOpen: true,
        saldoInicial: decision.saldoInicial,
        dataAbertura: decision.abertaEm ? new Date(decision.abertaEm) : prev.caixa.dataAbertura,
      },
    }
  }

  if (decision.action === "close") {
    // Vendas locais pendentes NÃO são perdidas (continuam em `syncPending`).
    return {
      ...prev,
      caixaSessaoId: null,
      caixa: {
        ...prev.caixa,
        isOpen: false,
        saldoInicial: 0,
        dataAbertura: null,
        totalEntradas: 0,
        totalSaidas: 0,
      },
    }
  }

  return prev
}

/** Corpo de `POST /api/ops/caixa/abrir`. */
export type AberturaCaixaServerResponse = {
  sessaoId?: string
  alreadyOpen?: boolean
  sessao?: { saldoInicial?: number; operador?: string }
}

export type AberturaCaixaDecision =
  | {
      action: "abrir"
      sessaoId: string
      saldoInicial: number
      operador: string
      /** O servidor já tinha sessão aberta: adotada em vez de criar uma segunda. */
      jaEstavaAberto: boolean
    }
  | { action: "recusar"; reason: "http" | "rede" | "resposta-sem-sessao"; status?: number }

/**
 * Decide se a abertura do caixa pode ser refletida no cliente.
 *
 * Só existe `action: "abrir"` quando o servidor respondeu 2xx COM `sessaoId`
 * utilizável — e só esse desfecho carrega saldo e sessão. Falha de rede, HTTP
 * não-2xx ou corpo sem `sessaoId` devolvem `recusar` sem dado nenhum para
 * aplicar, de modo que o cliente não tem como marcar `isOpen: true`.
 *
 * É a trava contra o estado `isOpen: true` + `sessaoId: null` — "Caixa Aberto"
 * na tela com toda venda recusada por sessão inválida, que é a causa produtora
 * das pendências fantasmas.
 */
export function decideAberturaCaixa(input: {
  saldoDigitado: number
  operadorDigitado: string
  resposta:
    | { ok: true; body: AberturaCaixaServerResponse }
    | { ok: false; reason: "http"; status: number }
    | { ok: false; reason: "rede" }
}): AberturaCaixaDecision {
  const { resposta } = input
  if (!resposta.ok) {
    return resposta.reason === "http"
      ? { action: "recusar", reason: "http", status: resposta.status }
      : { action: "recusar", reason: "rede" }
  }

  const sessaoId = trimmed(resposta.body?.sessaoId)
  if (!sessaoId) return { action: "recusar", reason: "resposta-sem-sessao" }

  const jaEstavaAberto = resposta.body.alreadyOpen === true
  // Sessão preexistente manda no saldo e no operador: evita duas sessões e
  // divergência entre o que a tela mostra e o que o servidor tem.
  const saldoServidor = resposta.body.sessao?.saldoInicial
  const operadorServidor = trimmed(resposta.body.sessao?.operador)

  return {
    action: "abrir",
    sessaoId,
    saldoInicial:
      jaEstavaAberto && typeof saldoServidor === "number" ? saldoServidor : input.saldoDigitado,
    operador: jaEstavaAberto && operadorServidor ? operadorServidor : input.operadorDigitado,
    jaEstavaAberto,
  }
}

/**
 * Serializa chamadas concorrentes: enquanto uma execução está em voo, as demais
 * recebem a MESMA promessa em vez de disparar outra consulta.
 *
 * É o que garante que clicar "Atualizar caixa" várias vezes (ou o F5 automático
 * coincidindo com o clique do operador) não vire N requisições nem N decisões.
 */
export function createSingleFlight<T>(): (task: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<T> | null = null
  return (task) => {
    if (inFlight) return inFlight
    const run = task()
    inFlight = run
    const done = () => {
      if (inFlight === run) inFlight = null
    }
    run.then(done, done)
    return run
  }
}
